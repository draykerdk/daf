'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadRecord } = require('../lib/record');
const { deriveEvents, verifyChain, foldEvents, serialize, ZERO } = require('../lib/events');
const { foldLedger } = require('../lib/ledger');
const { FIX, ROOT, tmpCopy, read, write } = require('./helpers');

// Computed once from tools/test/fixtures/basic and written here, so that any
// change to the derivation, or to the fixture's bytes, fails this test.
// Before request.decided carried an empty holder (audit DAF-C3) it was
// 4e0553ad0fb2621a95df6c8423d65f077a0977613cb0326c00888324074199f9.
const GOLDEN_HEAD = '65c6a3a9446a70174761d475f3ef0f7ec0ce94077c20c2b5758217959e73cbd7';

test('events: golden head of the basic fixture', () => {
  const d = deriveEvents(loadRecord(path.join(FIX, 'basic')));
  assert.equal(d.version, 1);
  assert.equal(d.count, 20);
  assert.equal(d.head, GOLDEN_HEAD);
  assert.deepEqual(d.events.map((e) => e.kind), [
    'unit.recorded', 'unit.recorded', 'function.delivered', 'function.delivered', 'function.delivered', 'vote.cast', 'vote.cast', 'assembly.closed',
    'unit.recorded', 'function.delivered', 'function.delivered', 'module.completed', 'penalty', 'request.decided', 'vote.cast', 'vote.cast', 'steward.intervention', 'assembly.closed',
    'vote.cast', 'assembly.closed'
  ]);
  const penalty = d.events.find((e) => e.kind === 'penalty');
  assert.equal(penalty.points, -1);
  assert.match(penalty.preimage, /\npoints=-1\n/);
  const req = d.events.find((e) => e.kind === 'request.decided');
  // The requester is not read from the request file, which can change after the decision.
  assert.deepEqual([req.holder, req.value, req.ref], ['', 'approved', 'federation/requests/1-example-tooling.md']);
  const closed = d.events[7];
  assert.equal(closed.preimage, [
    'daf-event/1', 'seq=8', 'kind=assembly.closed', 'cycle=2026-01', 'holder=', 'points=0', 'value=passed',
    'ref=federation/assemblies/2026-01.md', 'blob=' + closed.blob, 'evidence=1', 'evidence=https://github.com/draykerdk/daf/issues/101',
    'prev=' + d.events[6].hash, ''
  ].join('\n'));
  assert.equal(d.events[0].prev, ZERO);
});

test('events: the empty record has no events and a zero head', () => {
  const d = deriveEvents(loadRecord(ROOT));
  assert.deepEqual([d.count, d.head], [0, ZERO]);
});

test('events: blob is the git blob sha of the report, empty for unit and request events', () => {
  const rec = loadRecord(path.join(FIX, 'basic'));
  const events = deriveEvents(rec).events;
  for (const file of ['federation/assemblies/2026-01.md', 'federation/assemblies/2026-02.md']) {
    const want = execFileSync('git', ['hash-object', path.join(FIX, 'basic', file)], { encoding: 'utf8' }).trim();
    const mine = events.filter((x) => x.ref === file);
    assert.ok(mine.length > 0);
    for (const e of mine) assert.equal(e.blob, want, file + ' ' + e.kind);
  }
  for (const e of events.filter((x) => x.kind === 'unit.recorded' || x.kind === 'request.decided')) {
    assert.equal(e.blob, '', e.kind + ' ' + e.ref);
    assert.match(e.preimage, /\nblob=\nevidence=/);
  }
});

test('events: editing a unit or request file after its assembly keeps the head; editing a merged report changes it', () => {
  const dir = tmpCopy('basic');
  const head = () => deriveEvents(loadRecord(dir)).head;
  assert.equal(head(), GOLDEN_HEAD);
  const unit = 'federation/units/example-delta.yml';
  write(dir, unit, read(dir, unit).replace('    - https://github.com/example-delta-gh\n', '    - https://github.com/example-delta-gh\n    - https://github.com/example-delta-three-gh\n'));
  const req = 'federation/requests/1-example-tooling.md';
  write(dir, req, read(dir, req).replace('Fictional: half buys half.', 'Fictional: half buys half, edited later.'));
  assert.notEqual(read(dir, unit), read(FIX + '/basic', unit));
  assert.equal(head(), GOLDEN_HEAD, 'unit and request edits do not rewrite the chain');
  const report = 'federation/assemblies/2026-01.md';
  write(dir, report, read(dir, report).replace('Fictional founding assembly', 'Fictional founding assembly, edited'));
  assert.notEqual(head(), GOLDEN_HEAD, 'an edit to a merged report changes the head');
});

test('events: verifyChain accepts the chain and catches tampering', () => {
  const d = deriveEvents(loadRecord(path.join(FIX, 'basic')));
  assert.equal(verifyChain(d.events).ok, true);
  const json = JSON.parse(serialize(d).json);
  assert.equal(verifyChain(json.events).ok, true, 'events.json verifies without preimages');
  const tampered = json.events.map((e) => Object.assign({}, e));
  tampered[3].points = 5;
  const v = verifyChain(tampered);
  assert.equal(v.ok, false);
  assert.match(v.problems.join(), /event 4: hash does not match/);
  const log = serialize(d).log;
  assert.ok(log.startsWith('daf-event/1\nseq=1\n'));
  assert.equal(log.split('\nhash=').length - 1, 20);
});

test('events: foldEvents gives the same standing as foldLedger', () => {
  const rec = loadRecord(path.join(FIX, 'basic'));
  const strip = (f) => ({ asOf: f.asOf, totals: f.totals, holders: f.holders.map((h) => ({ id: h.id, points: h.points, active: h.active, joined: h.joined })) });
  assert.deepEqual(strip(foldEvents(deriveEvents(rec).events, rec.parameters)), strip(foldLedger(rec)));
  for (const before of ['2026-02', '2026-03']) {
    const partial = Object.assign({}, rec, { assemblies: rec.assemblies.filter((a) => a.cycle < before) });
    assert.deepEqual(strip(foldEvents(deriveEvents(partial).events, rec.parameters)), strip(foldLedger(rec, { before })));
  }
});

test('events: values outside printable ASCII fail loudly with file and row', () => {
  const dir = tmpCopy('basic');
  const f = 'federation/assemblies/2026-02.md';
  write(dir, f, read(dir, f).replace('https://github.com/example-org/example-repo/pull/7', 'https://github.com/example-org/example-repo/pull/7é'));
  assert.throws(() => deriveEvents(loadRecord(dir)), /^Error: federation\/assemblies\/2026-02\.md row 13: cannot derive event function\.delivered: evidence "https:\/\/github\.com\/example-org\/example-repo\/pull\/7é" is not printable ASCII/);
});

test('events: T4 a closed report with parse problems stops the export, with file and row', () => {
  const { run } = require('./helpers');
  const fs = require('node:fs');
  const dir = tmpCopy('basic');
  const f = 'federation/assemblies/2026-02.md';
  write(dir, f, read(dir, f).replace('/pull/7 | 1 |', '/pull/7 | one |').replace('| `example-delta` | against | 1 |', '| `example-delta` | against | two |'));
  assert.throws(() => deriveEvents(loadRecord(dir)), /^Error: federation\/assemblies\/2026-02\.md: cannot derive events while the report has problems: federation\/assemblies\/2026-02\.md:13: points "one" is not an integer; federation\/assemblies\/2026-02\.md:\d+: weight "two"/);
  for (const cmd of ['events', 'snapshot']) {
    const out = path.join(dir, 'out-' + cmd);
    const r = run([cmd, '--root', dir, '--out', out, '--allow-undetermined']);
    assert.equal(r.code, 1, cmd);
    assert.match(r.err, /\nerror: federation\/assemblies\/2026-02\.md: cannot derive events while the report has problems: federation\/assemblies\/2026-02\.md:13: points "one"/, cmd);
    assert.ok(!fs.existsSync(out), cmd + ' writes nothing');
  }
  // A pending report is not exported, so its problems do not stop the export.
  const pending = tmpCopy('basic');
  write(pending, 'federation/assemblies/2026-04.md', require('./helpers').pendingReport().replace('/pull/10 | 1 |', '/pull/10 | one |'));
  assert.equal(deriveEvents(loadRecord(pending)).head, GOLDEN_HEAD);
});

test('events: T4 emit refuses a null or unsafe points value', () => {
  const rec = loadRecord(path.join(FIX, 'basic'));
  const a = rec.assemblies[1];
  a.deliveries[0].points = null;
  assert.throws(() => deriveEvents(rec), /^Error: federation\/assemblies\/2026-02\.md row 13: cannot derive event function\.delivered: points null is not a safe integer$/);
  a.deliveries[0].points = 2 ** 53;
  assert.throws(() => deriveEvents(rec), /row 13: cannot derive event function\.delivered: points 9007199254740992 is not a safe integer/);
  a.deliveries[0].points = 1;
  a.votes[0].weight = null;
  assert.throws(() => deriveEvents(rec), /row \d+: cannot derive event vote\.cast: points null is not a safe integer/);
});

test('events: T8 shapes require safe integers written in decimal', () => {
  const d = deriveEvents(loadRecord(path.join(FIX, 'basic')));
  const json = JSON.parse(serialize(d).json);
  for (const bad of [-1e21, 2 ** 53, 1.5]) {
    const evs = json.events.map((e) => Object.assign({}, e));
    evs[12].points = bad;
    assert.match(verifyChain(evs).problems.join('\n'), /event 13: points must be a safe integer written in decimal/, String(bad));
  }
  const seq = json.events.map((e) => Object.assign({}, e));
  seq[0].seq = 2 ** 53;
  assert.match(verifyChain(seq).problems.join('\n'), /event 1: seq must be a positive integer/);
});
