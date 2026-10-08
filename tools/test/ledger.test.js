'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { foldLedger } = require('../lib/ledger');
const { renderLedger } = require('../lib/render');
const { loadRecord } = require('../lib/record');
const { ROOT, FIX } = require('./helpers');

const PARAMS = { points_per_function: 1, module_bonus_per_function: 1, quorum_percent: 30, quorum_base: 'active', majority: 'simple', window_days: 7, dormant_after_assemblies: 3 };

/** A synthetic parsed assembly. */
function asm(cycle, outcome, o) {
  o = o || {};
  return {
    cycle, file: 'federation/assemblies/' + cycle + '.md', window: null, cycleIssue: null,
    deliveries: (o.deliveries || []).map((h) => ({ holder: h, points: 1 })),
    modules: o.modules || [], penalties: o.penalties || [],
    newRecords: (o.newRecords || []).map((h) => ({ holder: h, kind: 'participant' })),
    resources: [], votes: (o.votes || []).map((h) => ({ holder: h, vote: 'for', weight: 0 })),
    vote: { outcome }, steward: { none: true }
  };
}
const rec = (assemblies) => ({ units: new Map(), parameters: PARAMS, assemblies, requests: [] });
const row = (fold, id) => fold.holders.find((h) => h.id === id);

test('ledger: failed assemblies award nothing; their voters stay active', () => {
  const r = rec([
    asm('2026-01', 'passed', { deliveries: ['example-river', 'example-delta'], newRecords: ['example-river', 'example-delta'] }),
    asm('2026-02', 'failed', { deliveries: ['example-river'], votes: ['example-delta'] }),
    asm('2026-03', 'failed', { votes: ['example-delta'] }),
    asm('2026-04', 'failed', { votes: ['example-delta'] })
  ]);
  const f = foldLedger(r);
  assert.equal(row(f, 'example-river').points, 1, 'the delivery in the failed 2026-02 is not awarded');
  assert.equal(row(f, 'example-river').active, false, 'a delivery row in a failed assembly is not activity');
  assert.equal(row(f, 'example-delta').active, true);
  assert.equal(f.totals.assemblies, 4);
  assert.equal(f.asOf, '2026-04');
  assert.equal(f.totals.activePoints, 1);
  assert.equal(f.totals.points, 2);
});

test('ledger: dormant after three assemblies without voting or delivering', () => {
  const r = rec([
    asm('2026-01', 'passed', { deliveries: ['example-river', 'example-delta'], newRecords: ['example-river', 'example-delta'] }),
    asm('2026-02', 'passed', { deliveries: ['example-delta'], votes: ['example-delta'] }),
    asm('2026-03', 'failed', { votes: ['example-delta'] }),
    asm('2026-04', 'failed', { votes: ['example-delta'] })
  ]);
  assert.equal(row(foldLedger(r, { before: '2026-04' }), 'example-river').active, true, 'still inside the last three');
  const f = foldLedger(r);
  assert.equal(row(f, 'example-river').active, false);
  assert.equal(row(f, 'example-river').points, 1, 'dormant holders keep every point');
  assert.equal(f.totals.activePoints, 2);
});

test('ledger: pending reports are not folded; before stops the fold', () => {
  const r = rec([
    asm('2026-01', 'passed', { deliveries: ['example-river'], newRecords: ['example-river'] }),
    asm('2026-02', 'pending', { deliveries: ['example-river'] })
  ]);
  const f = foldLedger(r);
  assert.equal(f.totals.assemblies, 1);
  assert.equal(row(f, 'example-river').points, 1);
  assert.equal(foldLedger(r, { before: '2026-01' }).holders.length, 0);
});

test('ledger: modules, penalties, joined and ordering', () => {
  const r = rec([
    asm('2026-01', 'passed', { deliveries: ['example-river', 'example-delta', 'example-delta'], newRecords: ['example-river', 'example-delta'] }),
    asm('2026-02', 'passed', {
      deliveries: ['example-cedar'], newRecords: ['example-cedar'],
      modules: [{ holder: 'example-river', bonus: 2 }], penalties: [{ holder: 'example-delta', points: -2 }]
    })
  ]);
  const f = foldLedger(r);
  assert.deepEqual(f.holders.map((h) => [h.id, h.points, h.joined]), [['example-river', 3], ['example-cedar', 1], ['example-delta', 0]].map(([id, p]) => [id, p, id === 'example-cedar' ? '2026-02' : '2026-01']));
});

test('ledger: LEDGER.md of the real empty record is byte-identical to the file', () => {
  const r = loadRecord(ROOT);
  const text = renderLedger(foldLedger(r), r.parameters);
  assert.equal(text, fs.readFileSync(path.join(ROOT, 'federation/LEDGER.md'), 'utf8'));
});

test('ledger: LEDGER.md of the basic fixture', () => {
  const r = loadRecord(path.join(FIX, 'basic'));
  const text = renderLedger(foldLedger(r), r.parameters);
  assert.equal(text, fs.readFileSync(path.join(FIX, 'basic/federation/LEDGER.md'), 'utf8'));
  assert.match(text, /\*\*As of:\*\* assembly 2026-03\./);
  assert.match(text, /\| `example-delta` \| unit \| 4 \| yes \| 2026-01 \|/);
  assert.match(text, /3 assemblies held\. The assemblies in \[`assemblies\/`\]\(\.\/assemblies\) are the record; this file is generated from them by `node tools\/daf\.js ledger --write`\./);
});
