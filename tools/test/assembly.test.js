'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseAssembly, renderAssemblyVote, extractRefs } = require('../lib/assembly');
const { ROOT, FIX, pendingReport } = require('./helpers');

const basic = (c) => fs.readFileSync(path.join(FIX, 'basic/federation/assemblies', c + '.md'), 'utf8');

test('assembly: the TEMPLATE parses to placeholders only', () => {
  const a = parseAssembly(fs.readFileSync(path.join(ROOT, 'federation/assemblies/TEMPLATE.md'), 'utf8'), { file: 'TEMPLATE.md' });
  assert.equal(a.deliveries.length + a.modules.length + a.penalties.length + a.newRecords.length + a.resources.length + a.votes.length, 0);
  assert.deepEqual(a.placeholders.map((p) => p.section), ['title', 'window', 'cycle issue', 'Deliveries', 'Module completions', 'Penalties', 'New records', 'Resource decisions', 'Votes']);
  assert.equal(a.vote.outcome, 'pending', '"passed / failed" is the template text, read as pending');
  assert.equal(a.vote.placeholder, true);
  assert.deepEqual(a.steward, { none: true });
});

test('assembly: a passed report with **Module completions**, #n refs and markdown links', () => {
  const a = parseAssembly(basic('2026-01'), { file: '2026-01.md' });
  assert.deepEqual(a.problems, []);
  assert.equal(a.cycle, '2026-01');
  assert.deepEqual(a.window, { opens: '2026-01-05', closes: '2026-01-12' });
  assert.equal(a.cycleIssue, 101);
  assert.equal(a.deliveries.length, 3);
  assert.equal(a.deliveries[0].declared, 'https://github.com/draykerdk/daf/issues/11');
  assert.equal(a.deliveries[1].declared, 'https://github.com/example-org/example-repo/issues/12');
  assert.equal(a.deliveries[1].delivered, 'https://github.com/example-org/example-repo/pull/2', 'backticks are stripped');
  assert.deepEqual(a.newRecords.map((r) => [r.holder, r.kind]), [['example-river', 'participant'], ['example-delta', 'unit']]);
  assert.deepEqual(a.votes, [{ holder: 'example-river', vote: 'for', weight: 0, line: 57 }, { holder: 'example-delta', vote: 'for', weight: 0, line: 58 }]);
  assert.equal(a.vote.outcome, 'passed');
  assert.deepEqual(a.steward, { none: true }, 'the guidance blockquote is not intervention text');
});

test('assembly: the site layout (· window, ### Module completions), U+2212 penalties, resources, steward text', () => {
  const a = parseAssembly(basic('2026-02'), { file: '2026-02.md' });
  assert.deepEqual(a.problems, []);
  assert.deepEqual(a.window, { opens: '2026-02-02', closes: '2026-02-09' });
  assert.equal(a.cycleIssue, 102);
  assert.deepEqual(a.modules.map((m) => [m.holder, m.functions, m.bonus]), [['example-delta', ['https://github.com/draykerdk/daf/issues/21', 'https://github.com/draykerdk/daf/issues/22'], 2]]);
  assert.equal(a.penalties[0].points, -1);
  assert.deepEqual(a.penalties[0].commitmentRefs, ['https://github.com/example-org/example-repo/issues/24']);
  assert.deepEqual(a.resources.map((r) => [r.request, r.decision]), [['requests/1-example-tooling.md', 'approved']]);
  assert.deepEqual(a.steward, { text: 'Closed a fictional spam claim on the cycle issue: https://github.com/example-org/example-repo/issues/29', links: ['https://github.com/example-org/example-repo/issues/29'] });
  assert.deepEqual([a.vote.active, a.vote.cast, a.vote.for, a.vote.against, a.vote.abstain], [3, 3, 2, 1, 0]);
});

test('assembly: problems for malformed rows', () => {
  let md = basic('2026-02')
    .replace('| −1 |', '| 1 |')
    .replace('| #21, #22 |', '| #21, the other one |')
    .replace('| **Outcome** | **passed** |', '| **Outcome** | **adopted** |')
    .replace('| `example-cedar` | participant |', '| `example-cedar` | person |')
    .replace('https://github.com/example-org/example-repo/pull/7', 'http://example.org/pull/7');
  const a = parseAssembly(md, { file: 'x.md' });
  const p = a.problems.join('\n');
  assert.match(p, /points removed must be negative, found 1/);
  assert.match(p, /Functions in it: "the" is not an https URL/);
  assert.match(p, /outcome must be passed, failed or pending, found "adopted"/);
  assert.match(p, /kind must be participant or unit, found "person"/);
  assert.match(p, /Delivered: "http:\/\/example.org\/pull\/7" is not an https URL/);
  md = basic('2026-03').replace('| --- | --- | --- | --- | --- |\n', '| --- | --- | --- | --- | --- |\n| `unit-id` | What was finished | #issue | link to the merged result | 1 |\n');
  assert.deepEqual(parseAssembly(md, { file: 'y.md' }).placeholders.map((x) => x.section), ['Deliveries']);
});

test('assembly: extractRefs', () => {
  assert.deepEqual(extractRefs('`#7`, [x](https://a.example/b) <https://c.example/d>', true), { urls: ['https://github.com/draykerdk/daf/issues/7', 'https://a.example/b', 'https://c.example/d'], bad: [] });
  assert.deepEqual(extractRefs('see #3 and ftp://x', false), { urls: ['https://github.com/draykerdk/daf/issues/3'], bad: ['ftp://x'] });
  assert.deepEqual(extractRefs('see #3', true).bad, ['see']);
});

test('assembly: renderAssemblyVote rewrites only the two vote tables', () => {
  const before = pendingReport();
  const summary = ['| | |', '| --- | --- |', '| Active points | 6 |', '| Votes cast | 4 |', '| Participation | 66.6% (quorum 30%) |', '| For / against / abstain | 4 / 0 / 0 |', '| **Outcome** | **passed** |'];
  const votes = ['| Holder | Vote | Weight |', '| --- | --- | --- |', '| `example-delta` | for | 4 |'];
  const after = renderAssemblyVote(before, summary, votes);
  const a = parseAssembly(after, { file: 'z.md' });
  assert.equal(a.vote.outcome, 'passed');
  assert.deepEqual(a.votes.map((v) => [v.holder, v.weight]), [['example-delta', 4]]);
  // Everything outside the tables is byte for byte the same.
  const strip = (s) => s.split('\n').filter((l) => !l.startsWith('|') || /Holder \| Function|example-river/.test(l)).join('\n');
  assert.equal(strip(after), strip(before));
  // CRLF files keep CRLF.
  const crlf = renderAssemblyVote(before.replace(/\n/g, '\r\n'), summary, votes);
  assert.ok(!/[^\r]\n/.test(crlf));
});
