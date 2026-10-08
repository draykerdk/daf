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
const GOLDEN_HEAD = '4e0553ad0fb2621a95df6c8423d65f077a0977613cb0326c00888324074199f9';

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
  assert.deepEqual([req.holder, req.value, req.ref], ['example-delta', 'approved', 'federation/requests/1-example-tooling.md']);
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
