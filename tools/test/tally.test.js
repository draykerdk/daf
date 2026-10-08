'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeTally, FOUNDING } = require('../lib/tally');
const { renderTally, code } = require('../lib/render');
const { loadRecord } = require('../lib/record');
const { tmpCopy, write, comment, vote, pendingReport } = require('./helpers');

// The basic fixture before 2026-04: example-delta 4, example-cedar 1,
// example-river 1, all active; base 6, quorum 30% = 1.8 points.
function underVote(opts) {
  const dir = tmpCopy('basic');
  write(dir, 'federation/assemblies/2026-04.md', pendingReport(opts));
  return loadRecord(dir);
}
const IN = '2026-04-03T12:00:00Z';
const tally = (comments, extra) => computeTally(Object.assign({ record: underVote(), cycle: '2026-04', comments, pr: 42, head: 'abcdef1234567890' }, extra));
const reasons = (t) => t.notCounted.map((n) => n.holder + ': ' + n.reason);

test('tally: quorum fails below 30% of active points', () => {
  const t = tally([comment(1, 'example-river-gh', IN, vote('for', 'example-river'))]);
  assert.equal(t.base, 6);
  assert.equal(t.cast, 1);
  assert.equal(t.quorumMet, false);
  assert.equal(t.outcome, 'failed');
  assert.match(t.sentences.join(), /Failed for lack of participation/);
});

test('tally: majority is more than half of the votes cast', () => {
  const against = tally([
    comment(1, 'example-delta-gh', IN, vote('against', 'example-delta')),
    comment(2, 'example-river-gh', IN, vote('for', 'example-river'))
  ]);
  assert.equal(against.quorumMet, true);
  assert.equal(against.majority, false);
  assert.equal(against.outcome, 'failed');
  const tie = tally([
    comment(1, 'example-river-gh', IN, vote('for', 'example-river')),
    comment(2, 'example-cedar-gh', IN, vote('against', 'example-cedar'))
  ]);
  assert.equal(tie.majority, false, '1 of 2 is not more than half');
  const pass = tally([
    comment(1, 'example-river-gh', IN, vote('for', 'example-river')),
    comment(2, 'example-cedar-gh', IN, vote('for', 'example-cedar'))
  ]);
  assert.equal(pass.outcome, 'passed');
});

test('tally: abstentions count toward participation', () => {
  const t = tally([
    comment(1, 'example-river-gh', IN, vote('for', 'example-river')),
    comment(2, 'example-cedar-gh', IN, vote('abstain', 'example-cedar'))
  ]);
  assert.equal(t.cast, 2);
  assert.equal(t.abstain, 1);
  assert.equal(t.quorumMet, true, 'without the abstention 1/6 is below the floor');
  assert.equal(t.outcome, 'failed', 'and 1 for out of 2 cast is not a majority');
});

test('tally: the last valid vote of a holder counts', () => {
  const t = tally([
    comment(1, 'example-delta-gh', '2026-04-02T10:00:00Z', vote('against', 'example-delta')),
    comment(2, 'example-delta-gh', '2026-04-04T10:00:00Z', vote('for', 'example-delta')),
    comment(3, 'example-delta-gh', '2026-04-09T10:00:00Z', vote('against', 'example-delta'))
  ]);
  assert.deepEqual(t.votes.map((v) => [v.holder, v.vote, v.weight]), [['example-delta', 'for', 4]]);
  assert.deepEqual(reasons(t).sort(), ['example-delta: posted after the window closed', 'example-delta: superseded by a later vote for the same holder']);
});

test('tally: speaks_for compares logins case-insensitively', () => {
  const t = tally([
    comment(1, 'Example-River-GH', IN, vote('for', 'example-river')),
    comment(2, 'example-delta-two-gh', IN, 'VOTE: For\nAS: Example-Delta')
  ]);
  assert.deepEqual(t.votes.map((v) => v.holder).sort(), ['example-delta', 'example-river']);
  assert.equal(t.notCounted.length, 0);
});

test('tally: filters, each with its reason', () => {
  const t = tally([
    comment(1, 'example-cedar-gh', IN, vote('for', 'example-river')),
    comment(2, 'example-cedar-gh', '2026-03-31T23:59:59Z', vote('for', 'example-cedar')),
    comment(3, 'example-delta-gh', '2026-04-07T23:00:00Z', vote('for', 'example-delta'), '2026-04-08T00:00:00Z'),
    comment(4, 'example-ghost-gh', IN, vote('for', 'example-ghost')),
    comment(5, 'example-river-gh', '2026-04-08T00:00:00Z', vote('for', 'example-river')),
    comment(6, 'example-river-gh', IN, 'I would vote for this, but this is discussion.')
  ], {
    reviews: [[{ id: 7, user: { login: 'example-delta-gh' }, submitted_at: IN, body: vote('for', 'example-delta') }]],
    reviewComments: [{ id: 8, user: { login: 'example-cedar-gh' }, created_at: IN, updated_at: IN, body: vote('against', 'example-cedar') }]
  });
  assert.deepEqual(t.votes, []);
  assert.deepEqual(reasons(t).sort(), [
    'example-cedar: posted as a line comment on the diff; votes are issue comments on the pull request',
    'example-cedar: posted before the window opened',
    'example-delta: edited after the window closed',
    'example-delta: posted as a review body; votes are issue comments on the pull request',
    'example-ghost: `example-ghost` has no weight in the ledger before 2026-04',
    'example-river: posted after the window closed',
    'example-river: the author is not listed in speaks_for of `example-river`'
  ]);
  assert.equal(t.commentsCount, 8);
});

test('tally: an edit inside the window is fine', () => {
  const t = tally([comment(1, 'example-delta-gh', IN, vote('for', 'example-delta'), '2026-04-07T23:59:59Z')]);
  assert.equal(t.votes.length, 1);
});

test('tally: the window is window_days x 24 h, from <opens>T00:00:00Z to <closes>T00:00:00Z (T7)', () => {
  // The report says opens 2026-04-01, closes 2026-04-08: seven full days.
  const t = tally([
    comment(1, 'example-delta-gh', '2026-04-01T00:00:00Z', vote('for', 'example-delta')),
    comment(2, 'example-river-gh', '2026-04-07T23:59:59Z', vote('against', 'example-river')),
    comment(3, 'example-cedar-gh', '2026-04-08T00:00:00Z', vote('for', 'example-cedar')),
    comment(4, 'example-cedar-gh', '2026-04-08T12:00:00Z', vote('against', 'example-cedar'))
  ]);
  assert.deepEqual(t.votes.map((v) => v.holder).sort(), ['example-delta', 'example-river'], 'the first and last second of the window count');
  assert.deepEqual(reasons(t), ['example-cedar: posted after the window closed', 'example-cedar: posted after the window closed'], 'a vote at the closing instant is after the close');
  const { parseAssembly } = require('../lib/assembly');
  const params = { window_days: 7 };
  const seven = parseAssembly(pendingReport(), { file: 'r.md', params });
  assert.deepEqual(seven.warnings.filter((w) => /window/.test(w)), []);
  const eight = parseAssembly(pendingReport().replace('closes 2026-04-08', 'closes 2026-04-09'), { file: 'r.md', params });
  assert.match(eight.warnings.join('\n'), /r\.md:3: the window dates are 8 days apart; parameters\.yml says window_days: 7/);
  const six = parseAssembly(pendingReport().replace('closes 2026-04-08', 'closes 2026-04-07'), { file: 'r.md', params });
  assert.match(six.warnings.join('\n'), /the window dates are 6 days apart/);
});

test('tally: slurped pagination (an array of pages) and a flat array give the same result', () => {
  const c = [comment(1, 'example-delta-gh', IN, vote('for', 'example-delta')), comment(2, 'example-river-gh', IN, vote('against', 'example-river'))];
  const flat = tally(c);
  const pages = tally([[c[0]], [c[1]]]);
  assert.deepEqual(pages.votes, flat.votes);
  assert.equal(pages.outcome, 'passed');
});

test('tally: single-holder concentration is stated', () => {
  const t = tally([comment(1, 'example-delta-gh', IN, vote('for', 'example-delta'))]);
  assert.equal(t.outcome, 'passed');
  assert.deepEqual(t.concentration, ['`example-delta`: one holder alone reaches the quorum and the majority (DAF-000 §5.4).']);
  const md = renderTally(t);
  assert.match(md, /\| `example-delta` \| for \| 4 \| 66\.6% \|/);
  assert.match(md, /Computed from 1 comment on PR #42 at head abcdef1, window from 2026-04-01 00:00 to 2026-04-08 00:00 UTC \(a vote at or after the close is not counted\), weights from the assemblies before 2026-04\./);
  assert.match(md, /This computes the arithmetic only\. The vote table in the report is written and merged by a person\./);
});

test('tally: no window in the report counts nothing', () => {
  const t = computeTally({ record: underVote({ noWindow: true }), cycle: '2026-04', comments: [comment(1, 'example-delta-gh', IN, vote('for', 'example-delta'))] });
  assert.deepEqual(reasons(t), ['example-delta: not counted: no window in the report']);
});

test('tally: the founding assembly is undetermined, never failed', () => {
  const dir = tmpCopy(null);
  for (const f of ['parameters.yml']) write(dir, 'federation/' + f, require('node:fs').readFileSync(require('node:path').join(__dirname, 'fixtures/basic/federation', f), 'utf8'));
  write(dir, 'federation/units/example-river.yml', require('node:fs').readFileSync(require('node:path').join(__dirname, 'fixtures/basic/federation/units/example-river.yml'), 'utf8'));
  write(dir, 'federation/assemblies/2026-04.md', pendingReport({ newRecord: 'example-river' }));
  const t = computeTally({ record: loadRecord(dir), cycle: '2026-04', comments: [comment(1, 'example-river-gh', IN, vote('for', 'example-river'))] });
  assert.equal(t.outcome, 'undetermined');
  assert.deepEqual(t.sentences, [FOUNDING]);
  assert.deepEqual(t.votes.map((v) => [v.holder, v.vote, v.weight]), [['example-river', 'for', 0]], 'the votes found are still listed');
  const md = renderTally(t);
  assert.match(md, /\*\*undetermined\*\*/);
  assert.doesNotMatch(md, /\*\*failed\*\*/);
  assert.ok(md.includes(FOUNDING));
});

test('tally: quorum_base total counts dormant points in the base', () => {
  const record = underVote();
  const params = Object.assign({}, record.parameters, { quorum_base: 'total' });
  const t = computeTally({ record, cycle: '2026-04', params, comments: [comment(1, 'example-delta-gh', IN, vote('for', 'example-delta'))] });
  assert.equal(t.baseKind, 'total');
  assert.equal(t.base, 6);
  assert.match(renderTally(t), /\| Total points \| 6 \|/);
});

test('render: user strings are inline code, defused and capped', () => {
  assert.equal(code('a\r\nb<script>@x'), '`abscript>@​x`');
  assert.equal(code('x'.repeat(100)).length, 82);
  assert.equal(code('a`b|c'), "`a'b/c`");
});

test('tally: T2 a dormant holder whose vote is counted joins the base; participation never exceeds 100%', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { run, read, commitAll } = require('./helpers');
  const dir = tmpCopy('basic');
  const RIVER_ROW = '| `example-river` | A fictional delivery under vote | #41 | https://github.com/example-org/example-repo/pull/10 | 1 |\n';
  const close = (cycle, comments) => {
    const base = commitAll(dir); // the default branch: every earlier report merged
    write(dir, 'federation/assemblies/' + cycle + '.md', pendingReport({ cycle }).replace(RIVER_ROW, ''));
    const file = path.join(dir, 'c-' + cycle + '.json');
    fs.writeFileSync(file, JSON.stringify(comments));
    const r = run(['close', cycle, '--root', dir, '--comments', file, '--base-ref', base, '--allow-undetermined']);
    assert.equal(r.code, 0, r.err);
    return read(dir, 'federation/assemblies/' + cycle + '.md');
  };
  // Only example-cedar votes in 2026-04, 05 and 06: delta (4) and river (1)
  // are dormant before 2026-07, and the active points are cedar's 1.
  const cedarFor = [comment(1, 'example-cedar-gh', IN, vote('for', 'example-cedar'))];
  assert.match(close('2026-04', cedarFor), /\*\*failed\*\*/);
  assert.match(close('2026-05', cedarFor), /\*\*failed\*\*/);
  assert.match(close('2026-06', cedarFor), /\| Active points \| 1 \|[\s\S]*\*\*passed\*\*/);
  const base7 = commitAll(dir);
  write(dir, 'federation/assemblies/2026-07.md', pendingReport({ cycle: '2026-07' }).replace(RIVER_ROW, ''));
  const record = loadRecord(dir);
  const t7 = (comments) => computeTally({ record, cycle: '2026-07', comments });
  const prior = t7([]).prior;
  assert.deepEqual(prior.holders.map((h) => [h.id, h.points, h.active]), [['example-delta', 4, false], ['example-cedar', 1, true], ['example-river', 1, false]]);
  assert.equal(prior.totals.activePoints, 1);

  const delta = comment(2, 'example-delta-gh', IN, vote('for', 'example-delta'));
  const cedarAgainst = comment(3, 'example-cedar-gh', IN, vote('against', 'example-cedar'));
  const t = t7([delta, cedarAgainst]);
  assert.equal(t.base, 5, 'active 1 + dormant delta 4, who voted');
  assert.equal(t.cast, 5);
  assert.equal(t.participation, 1);
  assert.equal(t.outcome, 'passed');
  assert.deepEqual(t.concentration, ['`example-delta`: one holder alone reaches the quorum and the majority (DAF-000 §5.4).'], 'cedar (1 of 5 cast) does not reach the majority alone');
  // Majority alone is measured against the votes cast, quorum alone against the base.
  const two = t7([delta, cedarAgainst, comment(4, 'example-river-gh', IN, vote('against', 'example-river'))]);
  assert.deepEqual([two.base, two.cast, two.outcome], [6, 6, 'passed']);
  assert.deepEqual(two.concentration, ['`example-delta`: one holder alone reaches the quorum and the majority (DAF-000 §5.4).']);

  // Every combination of voters and choices stays at or below 100%.
  const voters = [['example-delta', 'example-delta-gh'], ['example-cedar', 'example-cedar-gh'], ['example-river', 'example-river-gh']];
  for (let mask = 0; mask < 27; mask++) {
    const cs = [];
    let m = mask;
    voters.forEach(([id, login], i) => { const c = m % 3; m = Math.floor(m / 3); if (c) cs.push(comment(10 + i, login, IN, vote(c === 1 ? 'for' : 'against', id))); });
    const r = t7(cs);
    assert.ok(r.cast <= r.base, 'mask ' + mask + ': cast ' + r.cast + ' of base ' + r.base);
    if (r.participation !== null) assert.ok(r.participation <= 1);
  }
  // quorum_base total is unchanged: every holder's points, voting or not.
  const total = computeTally({ record, cycle: '2026-07', params: Object.assign({}, record.parameters, { quorum_base: 'total' }), comments: [delta] });
  assert.equal(total.base, 6);

  // close writes the same base, and check recomputes it from the Votes table.
  const file = path.join(dir, 'c-2026-07.json');
  fs.writeFileSync(file, JSON.stringify([delta, cedarAgainst]));
  assert.equal(run(['close', '2026-07', '--root', dir, '--comments', file, '--base-ref', base7, '--allow-undetermined']).code, 0);
  assert.match(read(dir, 'federation/assemblies/2026-07.md'), /\| Active points \| 5 \|\n\| Votes cast \| 5 \|\n\| Participation \| 100% \(quorum 30%\) \|/);
  const check = run(['check', '--root', dir, '--allow-undetermined']);
  assert.equal(check.code, 0, check.err);
});
