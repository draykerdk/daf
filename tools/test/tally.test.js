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
    comment(3, 'example-delta-gh', '2026-04-08T23:00:00Z', vote('for', 'example-delta'), '2026-04-09T01:00:00Z'),
    comment(4, 'example-ghost-gh', IN, vote('for', 'example-ghost')),
    comment(5, 'example-river-gh', '2026-04-09T00:00:00Z', vote('for', 'example-river')),
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
  const t = tally([comment(1, 'example-delta-gh', IN, vote('for', 'example-delta'), '2026-04-08T23:59:59Z')]);
  assert.equal(t.votes.length, 1);
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
  assert.match(md, /Computed from 1 comment on PR #42 at head abcdef1, window 2026-04-01–2026-04-08 \(UTC\), weights from the assemblies before 2026-04\./);
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
