'use strict';
// The rules of `check` on the record as a whole: holdings below zero, records
// never accepted, the vote summary, unit files against their acceptance, the
// founding outcome and edits since a base commit. Fictional records only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { tmpCopy, run, read, write, comment, vote, pendingReport, commitAll } = require('./helpers');
const { computeTally, BELOW_ZERO } = require('../lib/tally');
const { loadRecord } = require('../lib/record');

const IN = '2026-04-03T12:00:00Z';
const FOUNDING_ERROR = 'ERROR: federation/assemblies/2026-01.md: the outcome "passed" cannot be recomputed: no holder had weight before this assembly. DAF-000 and DAF-001 do not specify how the founding assembly is decided; this outcome cannot be recomputed from the record (DAF-000 §8)';

/** A copy of the basic fixture with string replacements applied to one file. */
function planted(rel, pairs) {
  const dir = tmpCopy('basic');
  let text = read(dir, rel);
  for (const [from, to] of pairs) {
    assert.ok(text.includes(from), rel + ' contains ' + from);
    text = text.replace(from, to);
  }
  write(dir, rel, text);
  return dir;
}
const check = (dir, ...extra) => run(['check', '--root', dir, '--allow-undetermined', ...extra]);
const lines = (s) => s.split('\n').filter(Boolean);

/** Write a pending report for `cycle` and close it with the given comments. */
function closeCycle(dir, cycle, text, comments) {
  const base = commitAll(dir); // the default branch: every earlier report merged
  write(dir, 'federation/assemblies/' + cycle + '.md', text);
  const file = path.join(dir, 'c-' + cycle + '.json');
  fs.writeFileSync(file, JSON.stringify(comments));
  const r = run(['close', cycle, '--root', dir, '--comments', file, '--base-ref', base, '--allow-undetermined']);
  assert.equal(r.code, 0, r.err);
  return r;
}
const GAMMA = 'schema_version: 1\nunit:\n  id: example-gamma\n  name: Example Gamma\n  kind: participant\n  founding_function: >-\n    A fictional participant used only by the tests.\n  speaks_for:\n    - https://github.com/example-gamma-gh\n  work:\n    - https://github.com/example-org/example-repo\n  joined: null\n';
const RIVER_ROW = '| `example-river` | A fictional delivery under vote | #41 | https://github.com/example-org/example-repo/pull/10 | 1 |';
const GAMMA_ROW = '| `example-gamma` | A fictional delivery by a new holder | #43 | https://github.com/example-org/example-repo/pull/15 | 1 |';

test('check: F2 the founding outcome is an error unless --allow-undetermined, which downgrades exactly it', () => {
  const dir = tmpCopy('basic');
  const strict = run(['check', '--root', dir]);
  assert.equal(strict.code, 1);
  assert.deepEqual(lines(strict.err), [FOUNDING_ERROR]);
  const allowed = check(dir);
  assert.equal(allowed.code, 0, allowed.err);
  assert.deepEqual(lines(allowed.err), [FOUNDING_ERROR.replace(/^ERROR/, 'WARNING')]);
  // A failed founding assembly cannot be recomputed either.
  const failed = planted('federation/assemblies/2026-01.md', [['| **Outcome** | **passed** |', '| **Outcome** | **failed** |']]);
  assert.match(run(['check', '--root', failed]).err, /2026-01\.md: the outcome "failed" cannot be recomputed: no holder had weight before this assembly/);
  // The flag does not hide anything else.
  const other = planted('federation/assemblies/2026-03.md', [['| **Outcome** | **failed** |', '| **Outcome** | **passed** |']]);
  const r = check(other);
  assert.equal(r.code, 1);
  assert.match(r.err, /ERROR: federation\/assemblies\/2026-03\.md: the outcome is passed but the votes give failed/);
});

test('check: F2 ledger --write and events refuse a founding outcome without --allow-undetermined', () => {
  const dir = tmpCopy('basic');
  const ledger = read(dir, 'federation/LEDGER.md');
  write(dir, 'federation/LEDGER.md', 'stale\n');
  const refused = run(['ledger', '--write', '--root', dir]);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /^error: refusing to write LEDGER\.md: federation\/assemblies\/2026-01\.md: the outcome "passed" stands, but no holder had weight before this assembly\. DAF-000 and DAF-001 do not specify how the founding assembly is decided; this outcome cannot be recomputed from the record \(DAF-000 §8\)\. Pass --allow-undetermined/);
  assert.equal(read(dir, 'federation/LEDGER.md'), 'stale\n', 'nothing is written');
  const written = run(['ledger', '--write', '--root', dir, '--allow-undetermined']);
  assert.equal(written.code, 0, written.err);
  assert.match(written.err, /^WARNING: federation\/assemblies\/2026-01\.md: the outcome "passed" stands/);
  assert.equal(read(dir, 'federation/LEDGER.md'), ledger);
  const out = path.join(dir, 'ev');
  const ev = run(['events', '--root', dir, '--out', out]);
  assert.equal(ev.code, 1);
  assert.match(ev.err, /refusing to export the events: federation\/assemblies\/2026-01\.md/);
  assert.ok(!fs.existsSync(out));
  assert.equal(run(['events', '--root', dir, '--out', out, '--allow-undetermined']).code, 0);
  const tally = run(['tally', '--root', dir, '--cycle', '2026-04', '--comments', path.join(dir, 'none.json')]);
  assert.equal(tally.code, 1);
  assert.match(tally.err, /refusing to tally 2026-04: federation\/assemblies\/2026-01\.md/);
});

test('check: T1 a penalty that takes a holder below zero is an error, and the tally leaves the outcome open', () => {
  // example-river holds 2 before 2026-02; a penalty of 3 takes it to -1.
  const dir = planted('federation/assemblies/2026-02.md', [['| −1 |', '| −3 |']]);
  const r = check(dir);
  assert.equal(r.code, 1);
  assert.match(r.err, /ERROR: federation\/assemblies\/2026-02\.md:26: the penalty takes `example-river` to -1 points\. DAF-000 §7 says a sanctioned holder loses its accumulated points; points below zero are not specified\n/);
  assert.match(r.err, /2026-03\.md: the outcome "failed" cannot be recomputed: `example-river` held -1 points before this assembly\./);
  // The ledger, the base and the weights all read the same signed holding.
  write(dir, 'federation/assemblies/2026-04.md', pendingReport());
  const t = computeTally({ record: loadRecord(dir), cycle: '2026-04', comments: [comment(1, 'example-delta-gh', IN, vote('for', 'example-delta'))] });
  const points = Object.fromEntries(t.prior.holders.map((h) => [h.id, h.points]));
  assert.deepEqual(points, { 'example-delta': 4, 'example-cedar': 1, 'example-river': -1 });
  assert.equal(t.prior.totals.points, 4);
  assert.equal(t.prior.totals.activePoints, 4);
  assert.equal(t.base, 4, 'the base is the signed sum, as in the ledger');
  assert.deepEqual(t.votes.map((v) => [v.holder, v.weight]), [['example-delta', 4]]);
  assert.equal(t.outcome, 'undetermined');
  assert.deepEqual(t.sentences, ['`example-river` held -1 points before this assembly. ' + BELOW_ZERO + '; the outcome cannot be computed.']);
  assert.equal(t.participation, null);
  // Down to exactly zero is specified: the holder lost its accumulated points.
  const zero = check(planted('federation/assemblies/2026-02.md', [['| −1 |', '| −2 |']]));
  assert.doesNotMatch(zero.err, /below zero/);
});

test('check: T3 a holder whose first assembly failed is never recorded until a passed one records it', () => {
  const dir = tmpCopy('basic');
  write(dir, 'federation/units/example-gamma.yml', GAMMA);
  // 2026-04 fails (nobody votes), with gamma's delivery and New records row.
  closeCycle(dir, '2026-04', pendingReport({ cycle: '2026-04', newRecord: 'example-gamma' }).replace(RIVER_ROW, GAMMA_ROW).replace('/pull/10 |\n\n## Resource', '/pull/15 |\n\n## Resource'), []);
  assert.match(read(dir, 'federation/assemblies/2026-04.md'), /\| \*\*Outcome\*\* \| \*\*failed\*\* \|/);
  assert.match(read(dir, 'federation/units/example-gamma.yml'), /joined: null/, 'a failed assembly sets no joined');
  let r = check(dir);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /WARNING: federation\/units\/example-gamma\.yml: no passed assembly has accepted this record \(a stub not yet accepted\)/);

  // draft decides the New records row from the passed assemblies, not from the file.
  const issues = path.join(dir, 'issues.json');
  fs.writeFileSync(issues, JSON.stringify([
    { number: 120, state: 'open', title: '[Cycle] Assembly 2026-05', body: '### Cycle\n\n2026-05\n\n### Window opens\n\n2026-05-04\n\n### Window closes\n\n2026-05-11\n' },
    { number: 121, state: 'open', title: '[Claim] Gamma again', user: { login: 'example-gamma-gh' }, body: '### Claimed as\n\nexample-gamma\n\n### Record\n\nI already have a record\n\n### What was delivered\n\nA second fictional delivery\n\n### Declared in\n\n#44\n\n### The result\n\nhttps://github.com/example-org/example-repo/pull/16\n\n### What is being claimed\n\nOne function — 1 point\n\n### If a module, the functions in it\n\n_No response_\n\n### Cycle\n\n2026-05' },
    { number: 122, state: 'open', title: '[Claim] River again', user: { login: 'example-river-gh' }, body: '### Claimed as\n\nexample-river\n\n### Record\n\nI already have a record\n\n### What was delivered\n\nA fictional delivery by a recorded holder\n\n### Declared in\n\n#45\n\n### The result\n\nhttps://github.com/example-org/example-repo/pull/17\n\n### What is being claimed\n\nOne function — 1 point\n\n### If a module, the functions in it\n\n_No response_\n\n### Cycle\n\n2026-05' }
  ]));
  const stub = read(dir, 'federation/units/example-gamma.yml');
  const d = run(['draft', '2026-05', '--root', dir, '--issues', issues]);
  assert.equal(d.code, 0, d.err);
  const md = read(dir, 'federation/assemblies/2026-05.md');
  assert.match(md, /\n## New records\n\n\| Holder \| Kind \| First delivery \|\n\| --- \| --- \| --- \|\n\| `example-gamma` \| participant \| https:\/\/github\.com\/example-org\/example-repo\/pull\/16 \|\n\n/);
  assert.match(md, /<!-- TODO\(person\): `example-gamma` has no accepted record\. federation\/units\/example-gamma\.yml exists, but no passed assembly has recorded it, so this assembly does;/);
  assert.doesNotMatch(md, /\| `example-river` \| (participant|unit) \|/, 'a recorded holder gets no New records row');
  assert.equal(read(dir, 'federation/units/example-gamma.yml'), stub, 'the existing file is not overwritten');
  assert.doesNotMatch(d.out, /wrote federation\/units\//);

  // A passed 2026-05 without the row: gamma earns a point that check refuses.
  fs.rmSync(path.join(dir, 'federation/assemblies/2026-05.md'));
  closeCycle(dir, '2026-05', pendingReport({ cycle: '2026-05' }).replace(RIVER_ROW, GAMMA_ROW), [comment(1, 'example-delta-gh', IN, vote('for', 'example-delta'))]);
  assert.match(read(dir, 'federation/assemblies/2026-05.md'), /\*\*passed\*\*/);
  r = check(dir);
  assert.equal(r.code, 1);
  assert.match(r.err, /ERROR: federation\/assemblies\/2026-05\.md:\d+: delivery holder `example-gamma` has no accepted record: no passed assembly up to this one lists it in New records/);
  assert.match(r.err, /WARNING: federation\/units\/example-gamma\.yml: no passed assembly has accepted this record/);
});

test('check: T3 penalties, modules and votes for a holder never recorded are errors too', () => {
  const dir = planted('federation/assemblies/2026-02.md', [
    ['| `example-river` | Committed to', '| `example-ghost` | Committed to'],
    ['| `example-delta` | The example module', '| `example-ghost` | The example module']
  ]);
  const r = check(dir);
  assert.match(r.err, /2026-02\.md:20: module holder `example-ghost` has no accepted record/);
  assert.match(r.err, /2026-02\.md:26: penalty holder `example-ghost` has no accepted record/);
  const votes = check(planted('federation/assemblies/2026-02.md', [['| `example-delta` | against | 1 |', '| `example-ghost` | against | 1 |']]));
  assert.match(votes.err, /2026-02\.md:\d+: vote holder `example-ghost` has no accepted record/);
  // cedar is recorded by 2026-02 itself: its delivery there is fine.
  assert.doesNotMatch(check(tmpCopy('basic')).err, /no accepted record/);
});

test('check: T5 every vote summary row is present and numeric, and participation and the quorum figure are recomputed', () => {
  const f = 'federation/assemblies/2026-02.md';
  const bad = check(planted(f, [
    ['| Active points | 3 |', '| Total points | three |'],
    ['| Votes cast | 3 |', '| Votes cast | 3 of 3 |'],
    ['| Participation | 100% (quorum 30%) |', '| Participation | 5% (quorum 99%) |']
  ]));
  assert.equal(bad.code, 1);
  assert.match(bad.err, /2026-02\.md:48: the vote table says "Total points", but parameters\.yml says quorum_base: active; the row is "Active points"/);
  assert.match(bad.err, /2026-02\.md:48: Active points "three" is not a number/);
  assert.match(bad.err, /2026-02\.md:49: Votes cast "3 of 3" is not a number/);
  assert.match(bad.err, /2026-02\.md:50: the quorum figure is 99%, but parameters\.yml says quorum_percent: 30/);
  assert.match(bad.err, /2026-02\.md:50: Participation is "5%", but 3 of 3 gives 100% \(truncated to one decimal\)/);

  const missing = check(planted(f, [['| Active points | 3 |\n', ''], ['| Votes cast | 3 |\n', ''], ['| Participation | 100% (quorum 30%) |\n', ''], ['| For / against / abstain | 2 / 1 / 0 |\n', '']]));
  for (const row of ['Active points', 'Votes cast', 'Participation', 'For / against / abstain']) {
    assert.match(missing.err, new RegExp('2026-02\\.md: the vote table has no "' + row.replace(/\//g, '\\/') + '" row'));
  }
  const noOutcome = check(planted(f, [['| **Outcome** | **passed** |\n', '']]));
  assert.match(noOutcome.err, /2026-02\.md:\d+: the vote table has no \*\*Outcome\*\* line/);

  const f3 = 'federation/assemblies/2026-03.md';
  assert.match(check(planted(f3, [['| 16.6% (quorum', '| 16.7% (quorum']])).err, /2026-03\.md:43: Participation is "16\.7%", but 1 of 6 gives 16\.6% \(truncated to one decimal\)/);
  assert.match(check(planted(f3, [['| 16.6% (quorum', '| 16% (quorum']])).err, /Participation is "16%", but 1 of 6 gives 16\.6%/);
  assert.match(check(planted(f3, [['| 16.6% (quorum 30%) |', '| 16.6% |']])).err, /2026-03\.md:43: Participation must read "<percent>% \(quorum 30%\)", found "16\.6%"/);
  assert.match(check(planted(f3, [['| Votes cast | 1 |', '| Votes cast | 2 |']])).err, /2026-03\.md: Votes cast is 2 but the Votes table sums to 1/);
  assert.match(check(planted(f3, [['| 1 / 0 / 0 |', '| 0 / 1 / 0 |']])).err, /2026-03\.md: For \/ against \/ abstain is 0 \/ 1 \/ 0 but the Votes table sums to 1 \/ 0 \/ 0/);
  // The founding report can say no percentage, and only "—".
  assert.match(check(planted('federation/assemblies/2026-01.md', [['| — (quorum 30%) |', '| 0% (quorum 30%) |']])).err, /2026-01\.md:49: Participation is "0%", but no participation can be computed for this report; write "—"/);
  // The unchanged fixture passes all of it.
  assert.equal(check(tmpCopy('basic')).code, 0);
});

test('check: T6 unit files agree with the assembly that accepted them; TODO(person) in a unit file is a warning', () => {
  const dir = planted('federation/units/example-cedar.yml', [
    ['  joined: 2026-02', '  joined: null'],
    ['  kind: participant', '  kind: unit'],
    ['  name: Example Cedar', '  name: Example Cedar  # TODO(person): the name']
  ]);
  const r = check(dir);
  assert.equal(r.code, 1);
  assert.match(r.err, /ERROR: federation\/units\/example-cedar\.yml: joined is null, but assembly 2026-02 accepted this record \(federation\/assemblies\/2026-02\.md:\d+\); joined must be 2026-02/);
  assert.match(r.err, /ERROR: federation\/units\/example-cedar\.yml: kind is unit, but federation\/assemblies\/2026-02\.md:\d+ accepted it as participant/);
  assert.match(r.err, /WARNING: federation\/units\/example-cedar\.yml: TODO\(person\) markers left on line 4/);
  const later = check(planted('federation/units/example-delta.yml', [['  joined: 2026-01', '  joined: 2026-02']]));
  assert.match(later.err, /example-delta\.yml: joined is 2026-02, but assembly 2026-01 accepted this record/);
});

test('check: 13 --base warns about modified unit records and changed parameters, not added units', () => {
  const dir = tmpCopy('basic');
  const git = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=example-test', '-c', 'user.email=example-test@example.invalid', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  const base = git('rev-parse', 'HEAD').trim();
  const u = 'federation/units/example-delta.yml';
  write(dir, u, read(dir, u).replace('    - https://github.com/Example-Delta-Two-GH\n', '    - https://github.com/Example-Delta-Two-GH\n    - https://github.com/example-mallory-gh\n'));
  write(dir, 'federation/units/example-gamma.yml', GAMMA);
  write(dir, 'federation/parameters.yml', read(dir, 'federation/parameters.yml').replace('# Starting values', '# The starting values'));
  git('add', '-A');
  git('commit', '-q', '-m', 'edit');
  const r = check(dir, '--base', base);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, new RegExp('WARNING: federation/units/example-delta\\.yml: M since ' + base + '\\. An existing unit record was changed; the tally reads unit records from the default branch, never from a pull request\\.'));
  assert.match(r.err, new RegExp('WARNING: federation/parameters\\.yml: M since ' + base + '\\. The parameters change only with the text of DAF-000 or DAF-001 \\(DAF-000 §5\\); the tally reads them from the default branch, never from a pull request\\.'));
  assert.doesNotMatch(r.err, /example-gamma\.yml: A since/, 'an added unit record is not a warning');
});
