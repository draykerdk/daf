// Interpreter tests of the pure Motoko modules (Sha256, Event, Ledger).
//
// Runs Motoko programs with node-motoko's interpreter. The actor itself is not
// run here (the interpreter cannot execute CertifiedData.set); run.mjs
// compiles it instead. Started by run.mjs in a child `node --stack-size=30000`
// because the interpreter recurses deeply.

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ICP = path.resolve(HERE, '..');
const REPO = path.resolve(ICP, '..');
const { verifyChain, preimageOf, foldEvents } = require(path.join(REPO, 'tools/lib/events.js'));

const mo = require('motoko');
mo.loadPackage(require('motoko/packages/latest/core.json'));
for (const f of ['Sha256.mo', 'Event.mo', 'Ledger.mo']) mo.write('src/' + f, readFileSync(path.join(ICP, 'src', f), 'utf8'));

const vectors = JSON.parse(readFileSync(path.join(HERE, 'vectors.json'), 'utf8'));

let passed = 0;
let failed = 0;
const fail = (name, detail) => { failed++; console.log('not ok - ' + name + (detail ? '\n    ' + detail : '')); };
const ok = (cond, name, detail) => { if (cond) passed++; else fail(name, detail); };

/** Run one Motoko program; returns its stdout lines. */
function run(name, source) {
  const file = 'test/' + name + '.mo';
  mo.write(file, source);
  const t = Date.now();
  const r = mo.run(file);
  const ms = Date.now() - t;
  console.log('# ' + name + ': ' + ms + ' ms');
  if (r.result && r.result.error) {
    fail(name + ' runs', (r.result.error.message || JSON.stringify(r.result.error)) + '\n    ' + r.stderr);
    return [];
  }
  if (r.stderr && r.stderr.trim()) console.log('# stderr: ' + r.stderr.trim().split('\n').join('\n# '));
  return r.stdout.split('\n').filter((l) => l.length);
}

const lit = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
const eventLit = (e) => '{ seq = ' + e.seq + '; kind = ' + lit(e.kind) + '; cycle = ' + lit(e.cycle) + '; holder = ' + lit(e.holder) +
  '; points = ' + (e.points < 0 ? '(' + e.points + ')' : e.points) + '; value = ' + lit(e.value) + '; ref = ' + lit(e.ref) +
  '; blob = ' + lit(e.blob) + '; evidence = [' + e.evidence.map(lit).join(', ') + ']; prev = ' + lit(e.prev) + ' }';
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

const HEADER = `import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Debug "mo:core/Debug";
import Iter "mo:core/Iter";
import Nat "mo:core/Nat";
import Int "mo:core/Int";
import Text "mo:core/Text";
import Sha256 "../src/Sha256";
import Event "../src/Event";
import Ledger "../src/Ledger";
`;

// 1. SHA-256: NIST short vectors, then differential against node:crypto.
{
  const nist = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1']
  ];
  const out = run('sha_nist', HEADER + nist.map(([m], i) => `Debug.print("NIST ${i} " # Sha256.toHex(Sha256.digest(${lit(m)}.encodeUtf8().toArray())));\n`).join(''));
  nist.forEach(([m, want], i) => {
    const line = out.find((l) => l.startsWith('NIST ' + i + ' '));
    ok(line === 'NIST ' + i + ' ' + want, 'sha256 NIST vector ' + JSON.stringify(m.length > 8 ? m.slice(0, 8) + '...' : m), line);
  });

  // Lengths 0..130 cover the padding edges (55/56, 63/64, 119/120). Bytes span
  // the full 0..255 range, so this is not limited to ASCII.
  const byte = (n, i) => (i * 131 + n * 7 + 1) % 256;
  const LENGTHS = 131;
  const chunks = [[0, 44], [44, 88], [88, LENGTHS]];
  for (const [from, to] of chunks) {
    const src = HEADER + `
var n = ${from};
while (n < ${to}) {
  let bytes = Nat.range(0, n).map<Nat, Nat8>(func(i) = Nat.toNat8((i * 131 + n * 7 + 1) % 256)).toArray();
  Debug.print("LEN " # n.toText() # " " # Sha256.toHex(Sha256.digest(bytes)));
  n += 1;
};
`;
    const lines = run('sha_diff_' + from + '_' + to, src);
    for (let n = from; n < to; n++) {
      const buf = Buffer.from(Array.from({ length: n }, (_, i) => byte(n, i)));
      const line = lines.find((l) => l.startsWith('LEN ' + n + ' '));
      ok(line === 'LEN ' + n + ' ' + sha(buf), 'sha256 differential length ' + n, line + ' vs ' + sha(buf));
    }
  }

  // Blob form, hex round trip and the raw head bytes that would be certified.
  const h = vectors.fixtures[0].head;
  const out2 = run('sha_blob', HEADER + `
Debug.print("BLOB " # Sha256.toHex(Sha256.digestBlob("abc".encodeUtf8()).toArray()));
switch (Sha256.fromHex(${lit(h)})) { case (?b) Debug.print("HEX " # Sha256.toHex(b)); case null Debug.print("HEX null") };
switch (Sha256.fromHex("0g")) { case (?_) Debug.print("BADHEX accepted"); case null Debug.print("BADHEX null") };
switch (Event.headBytes(${lit(h)})) { case (?b) Debug.print("HEAD " # b.size().toText() # " " # Sha256.toHex(b.toArray())); case null Debug.print("HEAD null") };
switch (Event.headBytes(Event.ZERO)) { case (?b) Debug.print("GENESIS " # b.size().toText() # " " # Sha256.toHex(b.toArray())); case null Debug.print("GENESIS null") };
switch (Event.headBytes("ABC")) { case (?_) Debug.print("BADHEAD accepted"); case null Debug.print("BADHEAD null") };
`);
  ok(out2.includes('BLOB ' + nist[1][1]), 'sha256 digestBlob', out2.join(' | '));
  ok(out2.includes('HEX ' + h), 'hex round trip', out2.join(' | '));
  ok(out2.includes('BADHEX null'), 'fromHex rejects a non-hex text', out2.join(' | '));
  ok(out2.includes('HEAD 32 ' + h), 'headBytes gives the 32 raw bytes of the head', out2.join(' | '));
  ok(out2.includes('BADHEAD null'), 'headBytes rejects a malformed head', out2.join(' | '));
  ok(out2.includes('GENESIS 32 ' + '0'.repeat(64)), 'headBytes of the empty log is 32 zero bytes, which the canister certifies at install', out2.join(' | '));
}

// 2. Vectors: preimage, hash, head and the ledger after every prefix.
for (const fx of vectors.fixtures) {
  const evs = fx.events;
  const src = HEADER + `
let evs : [Event.EventV1] = [
  ${evs.map(eventLit).join(',\n  ')}
];
let D = ${fx.dormantAfter};
func show(k : Nat, st : Ledger.State) {
  let rows = Ledger.standing(st, D);
  Debug.print("LEDGER " # k.toText() # " " # rows.size().toText());
  for (r in rows.values()) {
    // kind and joined may be empty; the fields are printable ASCII without
    // spaces, so a single space still separates them.
    Debug.print("ROW " # k.toText() # " " # r.id # " " # r.kind # " " # r.points.toText() # " " # r.joined # " " # (if (r.active) "true" else "false"));
  };
};
var head = Event.ZERO;
var seq = 0;
var st = Ledger.empty();
show(0, st);
for (e in evs.values()) {
  Debug.print("PRE " # e.seq.toText() # " " # Sha256.toHex(Event.preimage(e).encodeUtf8().toArray()));
  Debug.print("HASH " # e.seq.toText() # " " # Event.hash(e));
  switch (Event.next(seq, head, e)) {
    case (#ok(h)) { head := h };
    case (#err(m)) { Debug.print("ERR " # m) };
  };
  st := Ledger.apply(st, e);
  seq += 1;
  show(seq, st);
};
Debug.print("HEAD " # head);
switch (Event.verifyChain(evs)) { case (#ok(h)) Debug.print("VERIFY " # h); case (#err(m)) Debug.print("VERIFY ERR " # m) };
// The same log appended in two batches, split inside an assembly.
let cut = ${Math.floor(evs.length / 2) + 1};
switch (Ledger.extend(0, Event.ZERO, Ledger.empty(), evs.sliceToArray(0, cut))) {
  case (#err(m)) Debug.print("EXTEND ERR " # m);
  case (#ok(a)) {
    switch (Ledger.extend(a.seq, a.head, a.state, evs.sliceToArray(cut, evs.size()))) {
      case (#err(m)) Debug.print("EXTEND ERR " # m);
      case (#ok(b)) {
        Debug.print("EXTEND " # b.seq.toText() # " " # b.head);
        show(9999, b.state);
      };
    };
  };
};
// The whole log folded without the chain checks, as the canister refolds it.
show(8888, Ledger.fold(evs.values()));
`;
  const lines = run('vectors_' + fx.name, src);
  const errs = lines.filter((l) => l.startsWith('ERR '));
  ok(errs.length === 0, fx.name + ': every event is accepted', errs.join(' | '));
  let preOk = 0;
  let hashOk = 0;
  for (const e of evs) {
    const pre = lines.find((l) => l.startsWith('PRE ' + e.seq + ' '));
    const got = pre ? Buffer.from(pre.split(' ')[2], 'hex').toString('latin1') : null;
    if (got === e.preimage) preOk++; else fail(fx.name + ': preimage of event ' + e.seq, JSON.stringify(got) + '\n    expected ' + JSON.stringify(e.preimage));
    const h = lines.find((l) => l.startsWith('HASH ' + e.seq + ' '));
    if (h === 'HASH ' + e.seq + ' ' + e.hash) hashOk++; else fail(fx.name + ': hash of event ' + e.seq, h + ' expected ' + e.hash);
  }
  ok(preOk === evs.length, fx.name + ': ' + preOk + '/' + evs.length + ' preimages equal the reference byte for byte');
  ok(hashOk === evs.length, fx.name + ': ' + hashOk + '/' + evs.length + ' hashes equal the reference');
  ok(lines.includes('HEAD ' + fx.head), fx.name + ': chain head equals the reference ' + fx.head, lines.find((l) => l.startsWith('HEAD ')));
  ok(lines.includes('VERIFY ' + fx.head), fx.name + ': verifyChain gives the same head', lines.find((l) => l.startsWith('VERIFY')));
  ok(lines.includes('EXTEND ' + evs.length + ' ' + fx.head), fx.name + ': two batches split inside an assembly give the same head', lines.find((l) => l.startsWith('EXTEND')));

  const ledgerAt = (k) => lines.filter((l) => l.startsWith('ROW ' + k + ' ')).map((l) => {
    const [, , id, kind, points, joined, active] = l.split(' ');
    return { id, kind, points: Number(points), joined, active: active === 'true' };
  });
  let foldOk = 0;
  for (let k = 0; k <= evs.length; k++) {
    const got = ledgerAt(k);
    const want = fx.ledger[k];
    const count = lines.find((l) => l.startsWith('LEDGER ' + k + ' '));
    if (JSON.stringify(got) === JSON.stringify(want) && count === 'LEDGER ' + k + ' ' + want.length) foldOk++;
    else fail(fx.name + ': ledger after ' + k + ' events', JSON.stringify(got) + '\n    expected ' + JSON.stringify(want));
  }
  ok(foldOk === evs.length + 1, fx.name + ': ledger (id, kind, points, joined, active; not the totals) equals foldEvents after each of ' + (evs.length + 1) + ' prefixes (dormant after ' + fx.dormantAfter + ')');
  ok(JSON.stringify(ledgerAt(9999)) === JSON.stringify(fx.ledger[evs.length]), fx.name + ': ledger after two batches equals foldEvents', JSON.stringify(ledgerAt(9999)));
  ok(JSON.stringify(ledgerAt(8888)) === JSON.stringify(fx.ledger[evs.length]), fx.name + ': ledger refolded from the whole log equals foldEvents', JSON.stringify(ledgerAt(8888)));
}

// 3. Rejections. Each case changes one event of the basic fixture.
{
  const evs = vectors.fixtures[0].events;
  const e1 = evs[0];
  const e2 = evs[1];
  const with1 = (o) => Object.assign({}, e1, o);
  const cases = [
    // [name, events (seq/prev already chained), expected message, does the JS reference reject it too?]
    // null: the reference's answer is not asserted (see the case).
    ['non-ASCII value', [with1({ value: 'participanté' })], /value "participant.*" is not printable ASCII/, true],
    ['space in holder', [with1({ holder: 'example river' })], /holder "example river" is not printable ASCII/, true],
    ['empty evidence entry', [with1({ evidence: [''] })], /evidence "" is not printable ASCII/, true],
    ['space in an evidence URL', [with1({ evidence: ['https://github.com/example-org/example-repo/pull/1 2'] })], /evidence "https:\/\/github\.com\/example-org\/example-repo\/pull\/1 2" is not printable ASCII/, true],
    ['non-ASCII evidence URL', [with1({ evidence: ['https://github.com/example-org/exämple-repo/pull/1'] })], /evidence "https:\/\/github\.com\/example-org\/ex.*mple-repo\/pull\/1" is not printable ASCII/, true],
    // The reference at this commit accepts 2^53 (Number.isInteger) and prints
    // it in decimal; the safe-integer check being added to it will reject it.
    // Either way the canister rejects it, which is what is asserted.
    ['points beyond 2^53 - 1', [with1({ points: 9007199254740992 })], /points must be an integer the reference prints in decimal/, null],
    ['unknown kind veto.recorded', [with1({ kind: 'veto.recorded' })], /unknown kind "veto.recorded"/, true],
    ['cycle month 13', [with1({ cycle: '2026-13' })], /cycle must be YYYY-MM/, true],
    ['uppercase blob', [with1({ blob: 'A'.repeat(40) })], /blob must be 40 lowercase hex or empty/, true],
    ['blob of g', [with1({ blob: 'g'.repeat(40) })], /blob must be 40 lowercase hex or empty/, true],
    ['prev of g', [with1({ prev: 'g'.repeat(64) })], /event 1: prev must be 64 lowercase hex/, true],
    ['empty ref', [with1({ ref: '' })], /ref must not be empty/, true],
    ['broken prev', [e1, Object.assign({}, e2, { prev: '0'.repeat(64) })], /event 2: prev does not match the previous hash/, true],
    ['seq gap', [e1, Object.assign({}, e2, { seq: 3 })], /event 3: seq must be 2/, true],
    ['seq zero', [with1({ seq: 0 })], /seq must be a positive integer/, true],
    ['bad event at the end of a valid batch', [e1, e2, Object.assign({}, evs[2], { kind: 'veto.recorded' })], /event 3: unknown kind "veto\.recorded"/, true]
  ];
  const src = HEADER + cases.map(([name, list], i) => `
switch (Ledger.extend(0, Event.ZERO, Ledger.empty(), [${list.map(eventLit).join(', ')}])) {
  case (#ok(r)) Debug.print("REJ ${i} ACCEPTED " # r.head);
  case (#err(m)) Debug.print("REJ ${i} " # m);
};`).join('\n') + `
// validate alone, and the empty-value case it must accept.
switch (Event.validate(${eventLit(with1({ kind: 'veto.recorded' }))})) { case (?m) Debug.print("VALIDATE " # m); case null Debug.print("VALIDATE null") };
switch (Event.validate(${eventLit(evs[2])})) { case (?m) Debug.print("VALIDATE-OK " # m); case null Debug.print("VALIDATE-OK null") };
`;
  const lines = run('rejections', src);
  cases.forEach(([name, list, re, jsRejects], i) => {
    const line = lines.find((l) => l.startsWith('REJ ' + i + ' ')) || '';
    ok(!/ ACCEPTED /.test(line) && re.test(line), 'rejects: ' + name, line);
    // The reference agrees, except where the canister is deliberately stricter.
    // Each changed event gets its correct hash, so the reference can only
    // object to the change itself.
    const js = verifyChain(list.map((e) => Object.assign({}, e, { preimage: undefined, hash: sha(Buffer.from(preimageOf(e), 'ascii')) })));
    if (jsRejects === true) ok(!js.ok && !/hash does not match/.test(js.problems.join()), 'the JS reference also rejects: ' + name, JSON.stringify(js.problems));
    else if (jsRejects === false) ok(js.ok, 'the JS reference accepts (the canister is stricter): ' + name, JSON.stringify(js.problems));
    else console.log('# the JS reference ' + (js.ok ? 'accepts' : 'rejects') + ': ' + name);
  });
  ok(lines.includes('VALIDATE unknown kind "veto.recorded"'), 'validate names the unknown kind', lines.find((l) => l.startsWith('VALIDATE ')));
  ok(lines.includes('VALIDATE-OK null'), 'validate accepts an empty value where the reference does', lines.find((l) => l.startsWith('VALIDATE-OK')));
}

// 4. Events for a holder with no earlier unit.recorded. The reference folds
// them without objection, so the canister accepts them and folds the same
// standing: a delivery lists the holder with empty kind and joined, and a vote
// alone lists no one.
{
  const evs = vectors.fixtures[0].events;
  const chain = (list) => {
    let prev = '0'.repeat(64);
    return list.map((e, i) => {
      const c = Object.assign({}, e, { seq: i + 1, prev, preimage: undefined, hash: undefined });
      prev = sha(Buffer.from(preimageOf(c), 'ascii'));
      return Object.assign(c, { hash: prev });
    });
  };
  const byKind = (k) => evs.find((e) => e.kind === k);
  const closed = byKind('assembly.closed');
  const cases = [
    ['a delivery without unit.recorded', chain([byKind('function.delivered'), closed])],
    ['a vote without unit.recorded', chain([byKind('vote.cast'), closed])],
    ['a vote, then a delivery in a later assembly', chain([byKind('vote.cast'), closed, Object.assign({}, byKind('function.delivered'), { holder: byKind('vote.cast').holder })])]
  ];
  const D = 3;
  const src = HEADER + cases.map(([, list], i) => `
switch (Ledger.extend(0, Event.ZERO, Ledger.empty(), [${list.map(eventLit).join(', ')}])) {
  case (#err(m)) Debug.print("ACC ${i} ERR " # m);
  case (#ok(r)) {
    Debug.print("ACC ${i} HEAD " # r.head);
    for (x in Ledger.standing(r.state, ${D}).values()) {
      Debug.print("ACCROW ${i} " # x.id # " " # x.kind # " " # x.points.toText() # " " # x.joined # " " # (if (x.active) "true" else "false"));
    };
  };
};`).join('\n');
  const lines = run('accepted', src);
  cases.forEach(([name, list], i) => {
    const js = verifyChain(list);
    ok(js.ok, 'the JS reference accepts: ' + name, JSON.stringify(js.problems));
    ok(lines.includes('ACC ' + i + ' HEAD ' + js.head), 'accepts with the reference head: ' + name, lines.find((l) => l.startsWith('ACC ' + i + ' ')));
    const want = foldEvents(list, { dormant_after_assemblies: D }).holders.map((h) => [h.id, h.kind === null ? '' : h.kind, h.points, h.joined === null ? '' : h.joined, h.active].join(' '));
    const got = lines.filter((l) => l.startsWith('ACCROW ' + i + ' ')).map((l) => l.slice(('ACCROW ' + i + ' ').length));
    ok(JSON.stringify(got) === JSON.stringify(want), 'folds like foldEvents: ' + name, JSON.stringify(got) + ' expected ' + JSON.stringify(want));
  });
}

console.log('# interp: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
