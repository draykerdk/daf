// Builds icp/test/vectors.json from the JavaScript reference (tools/lib/events.js).
//
// Every event carries its fields, the reference preimage and hash; every
// fixture carries its head and the standing that foldEvents gives after each
// prefix of the log (0 events, 1 event, ...). The Motoko tests must reproduce
// all of it. `node test/run.mjs` regenerates this text and fails when the
// committed file differs; `node test/export-vectors.mjs` rewrites the file.

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const { loadRecord } = require(path.join(REPO, 'tools/lib/record.js'));
const { deriveEvents, foldEvents, verifyChain, ZERO } = require(path.join(REPO, 'tools/lib/events.js'));

export const VECTORS = path.join(HERE, 'vectors.json');

/** A fictional 40-hex blob for the synthetic reports. */
const fakeBlob = (s) => createHash('sha1').update('synthetic ' + s).digest('hex');

/**
 * A second, synthetic record in the shape loadRecord returns, covering what
 * the basic fixture does not: dormancy and return, a failed assembly whose
 * delivery rows are not events, a request without a requester (empty holder),
 * an assembly without a cycle issue (no evidence), a later record of a holder,
 * module bonuses over several functions, two penalties, a steward
 * intervention with two links and multi-digit points.
 */
function syntheticRecord() {
  const asm = (cycle, outcome, o) => {
    const file = 'federation/assemblies/' + cycle + '.md';
    let line = 10;
    const L = () => line++;
    return {
      cycle, file, blob: fakeBlob(file), cycleIssue: o.cycleIssue == null ? null : o.cycleIssue,
      vote: { outcome },
      newRecords: (o.newRecords || []).map(([holder, kind]) => ({ holder, kind, first: 'https://github.com/example-org/example-repo/pull/' + (100 + line), line: L() })),
      deliveries: (o.deliveries || []).map(([holder, points, issue]) => ({ holder, points, declared: '#' + issue, delivered: 'https://github.com/example-org/example-repo/pull/' + (200 + line), line: L() })),
      modules: (o.modules || []).map(([holder, bonus, fns]) => ({ holder, bonus, functions: fns.map((n) => 'https://github.com/draykerdk/daf/issues/' + n), line: L() })),
      penalties: (o.penalties || []).map(([holder, points, refs]) => ({ holder, points, commitmentRefs: refs, line: L() })),
      resources: (o.resources || []).map(([request, decision]) => ({ request, decision, line: L() })),
      votes: (o.votes || []).map(([holder, vote, weight]) => ({ holder, vote, weight, line: L() })),
      steward: o.steward ? { links: o.steward } : { none: true }
    };
  };
  return {
    requests: [
      { path: 'requests/2-example-hosting.md', from: 'example-oak' },
      { path: 'requests/3-example-unsigned.md', from: '' }
    ],
    assemblies: [
      asm('2026-05', 'passed', {
        cycleIssue: 201,
        newRecords: [['example-oak', 'participant'], ['example-pine', 'unit'], ['example-fern', 'participant']],
        deliveries: [['example-oak', 1, 31], ['example-pine', 12, 32], ['example-fern', 1, 33]],
        votes: [['example-oak', 'for', 0], ['example-pine', 'abstain', 0]]
      }),
      asm('2026-06', 'failed', {
        cycleIssue: 202,
        newRecords: [['example-elm', 'participant']],
        deliveries: [['example-fern', 1, 34]],
        votes: [['example-pine', 'against', 12]]
      }),
      asm('2026-07', 'passed', {
        newRecords: [['example-elm', 'participant']],
        deliveries: [['example-elm', 1, 35], ['example-oak', 1, 36]],
        modules: [['example-oak', 3, [31, 36, 37]]],
        penalties: [['example-pine', -3, ['https://github.com/example-org/example-repo/issues/41']], ['example-fern', -1, []]],
        resources: [['requests/2-example-hosting.md', 'partial'], ['requests/3-example-unsigned.md', 'declined']],
        votes: [['example-oak', 'for', 1], ['example-pine', 'for', 12]],
        steward: ['https://github.com/example-org/example-repo/issues/42', 'https://github.com/draykerdk/daf/issues/43']
      }),
      asm('2026-08', 'passed', {
        cycleIssue: 204,
        deliveries: [['example-elm', 1, 44]],
        votes: [['example-elm', 'for', 1]]
      }),
      asm('2026-09', 'failed', {
        cycleIssue: 205,
        votes: [['example-elm', 'against', 2]]
      }),
      asm('2026-10', 'passed', {
        cycleIssue: 206,
        newRecords: [['example-fern', 'unit']],
        deliveries: [['example-fern', 2, 45]],
        votes: [['example-fern', 'for', 0], ['example-oak', 'for', 5]]
      })
    ]
  };
}

function fixture(name, source, record, dormantAfter) {
  const d = deriveEvents(record);
  const check = verifyChain(d.events);
  if (!check.ok) throw new Error(name + ': the reference chain does not verify: ' + check.problems.join('; '));
  const params = Object.assign({}, record.parameters || {}, { dormant_after_assemblies: dormantAfter });
  const ledger = [];
  for (let k = 0; k <= d.events.length; k++) {
    const f = foldEvents(d.events.slice(0, k), params);
    for (const h of f.holders) {
      if (h.joined === null) throw new Error(name + ': holder ' + h.id + ' has standing without unit.recorded after ' + k + ' events');
    }
    ledger.push(f.holders.map((h) => ({ id: h.id, points: h.points, joined: h.joined, active: h.active })));
  }
  return {
    name, source, dormantAfter, count: d.count, head: d.head,
    events: d.events.map((e) => ({ seq: e.seq, kind: e.kind, cycle: e.cycle, holder: e.holder, points: e.points, value: e.value, ref: e.ref, blob: e.blob, evidence: e.evidence, prev: e.prev, preimage: e.preimage, hash: e.hash })),
    ledger
  };
}

/** The text of vectors.json. Deterministic: no dates, no absolute paths. */
export function buildVectors() {
  const basic = loadRecord(path.join(REPO, 'tools/test/fixtures/basic'));
  if (basic.problems && basic.problems.length) throw new Error('basic fixture: ' + basic.problems.join('; '));
  const out = {
    about: 'Derived by icp/test/export-vectors.mjs from tools/lib/events.js. Do not edit by hand.',
    version: 1,
    genesis: ZERO,
    fixtures: [
      fixture('basic', 'tools/test/fixtures/basic', basic, basic.parameters.dormant_after_assemblies),
      fixture('synthetic', 'icp/test/export-vectors.mjs syntheticRecord()', syntheticRecord(), 2)
    ]
  };
  return JSON.stringify(out, null, 2) + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(VECTORS, buildVectors());
  console.log('wrote ' + path.relative(process.cwd(), VECTORS));
}
