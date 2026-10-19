'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { ROOT, FIX, tmpCopy, run, read, write, comment, vote, pendingReport, commitAll } = require('./helpers');
const { USAGE } = require('../daf');

const ISSUES = path.join(FIX, 'issues-2026-04.json');
const IN = '2026-04-03T12:00:00Z';

test('cli: check passes on the real, empty record', () => {
  const r = run(['check', '--root', ROOT]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /The record is empty: no unit is recorded and no assembly has been held\./);
  assert.match(r.out, /0 errors, 0 warnings\./);
});

test('cli: ledger prints the real LEDGER.md unchanged', () => {
  const r = run(['ledger', '--root', ROOT]);
  assert.equal(r.code, 0);
  assert.equal(r.out + '\n', read(ROOT, 'federation/LEDGER.md'));
});

test('cli: check passes on the basic fixture, whose founding assembly is recomputed by participant', () => {
  const dir = tmpCopy('basic');
  const r = run(['check', '--root', dir]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.err, '', 'no error and no warning');
  assert.match(r.out, /3 unit records, 3 assembly reports, 1 request; 19 events, head 7d0c81f251d8\. 0 errors, 0 warnings\./);
});

test('cli: check fails on planted errors', () => {
  const plant = (rel, from, to) => {
    const dir = tmpCopy('basic');
    const text = read(dir, rel);
    assert.ok(text.includes(from), 'fixture contains ' + from);
    write(dir, rel, text.replace(from, to));
    return run(['check', '--root', dir]);
  };
  const placeholder = plant('federation/assemblies/2026-03.md', '| --- | --- | --- | --- | --- |\n', '| --- | --- | --- | --- | --- |\n| `unit-id` | What was finished | #issue | link to the merged result | 1 |\n');
  assert.equal(placeholder.code, 1);
  assert.match(placeholder.err, /2026-03\.md:\d+: template placeholder row left in "Deliveries"/);

  const bonus = plant('federation/assemblies/2026-02.md', '| #21, #22 | 2 |', '| #21, #22 | 3 |');
  assert.equal(bonus.code, 1);
  assert.match(bonus.err, /module bonus must be 2 functions x 1 = 2, found 3/);

  const points = plant('federation/assemblies/2026-02.md', '/pull/7 | 1 |', '/pull/7 | 2 |');
  assert.match(points.err, /a delivery is worth 1 \(points_per_function\), found 2/);

  const drift = plant('federation/LEDGER.md', '| `example-delta` | unit | 4 |', '| `example-delta` | unit | 5 |');
  assert.equal(drift.code, 1);
  assert.match(drift.err, /federation\/LEDGER\.md: differs from the fold of the assemblies at line 9/);

  const weight = plant('federation/assemblies/2026-02.md', '| `example-river` | for | 2 |', '| `example-river` | for | 3 |');
  assert.match(weight.err, /weight of `example-river` must be 2/);

  const outcome = plant('federation/assemblies/2026-03.md', '| **Outcome** | **failed** |', '| **Outcome** | **passed** |');
  assert.match(outcome.err, /the outcome is passed but the votes give failed \(DAF-000 §5\.3\)/);

  const unknown = plant('federation/assemblies/2026-02.md', '| `example-cedar` | Reviewed', '| `example-ghost` | Reviewed');
  assert.match(unknown.err, /2026-02\.md:\d+: delivery holder `example-ghost` has no accepted record: no passed assembly up to this one lists it in New records/);

  const params = plant('federation/parameters.yml', 'quorum_percent: 30', 'quorum_percent: 40');
  assert.equal(params.code, 1);
  assert.match(params.err, /daf-000-federation-constitution\.md: expected the phrase "participation of at least 40%"/);

  const unitId = (() => {
    const dir = tmpCopy('basic');
    write(dir, 'federation/units/example-unit.yml', read(ROOT, 'federation/units/TEMPLATE.yml'));
    return run(['check', '--root', dir]);
  })();
  assert.match(unitId.err, /example-unit\.yml: the unit id is still the template placeholder "example-unit"/);
});

test('cli: a pending report fails on master and passes with --allow-pending', () => {
  const dir = tmpCopy('basic');
  write(dir, 'federation/assemblies/2026-04.md', pendingReport());
  const master = run(['check', '--root', dir]);
  assert.equal(master.code, 1);
  assert.match(master.err, /2026-04\.md: the outcome is pending; a report on master must say passed or failed/);
  const pr = run(['check', '--root', dir, '--allow-pending']);
  assert.equal(pr.code, 0, pr.err);
  assert.match(pr.out, /4 assembly reports \(1 pending\)/);
});

test('cli: check --base warns when a past assembly was edited', () => {
  const dir = tmpCopy('basic');
  const git = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=example-test', '-c', 'user.email=example-test@example.invalid', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  const base = git('rev-parse', 'HEAD').trim();
  const f = 'federation/assemblies/2026-02.md';
  write(dir, f, read(dir, f).replace('Fictional second assembly.', 'Fictional second assembly, edited.'));
  write(dir, 'federation/assemblies/2026-04.md', pendingReport());
  git('add', '-A');
  git('commit', '-q', '-m', 'edit');
  const r = run(['check', '--root', dir, '--base', base, '--allow-pending']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /WARNING: federation\/assemblies\/2026-02\.md: M since [0-9a-f]+\. federation\/README\.md: "a mistake in a past assembly is corrected by a later one that says what was wrong, not by editing the original"\./);
  assert.doesNotMatch(r.err, /2026-04\.md: A/);
});

test('cli: draft builds the report from the cycle and claim issues', () => {
  const dir = tmpCopy('basic');
  const r = run(['draft', '2026-04', '--root', dir, '--issues', ISSUES]);
  assert.equal(r.code, 0, r.err);
  const md = read(dir, 'federation/assemblies/2026-04.md');
  assert.match(md, /^<!-- Rows drafted from claims: #111 Deliveries row 1 \(`example-willow`\); #112 Deliveries row 2 \(`example-river`\); #115 Module completions row 1 \(`example-delta`\); #118 Deliveries row 3 \(`example-aspen`\)\. -->\n/);
  assert.match(md, /\n<!-- not drafted: #113 "The result" is not one https URL or #n reference -->\n/);
  // #112 is closed (not as not planned): drafted, with a marker for a person.
  assert.match(md, /\n<!-- TODO\(person\): claim #112 is closed; check in its thread that the claim still stands before keeping its row\. -->\n/);
  assert.match(md, /<!-- TODO\(person\): `example-willow` has no unit record\./);
  assert.match(md, /\n# Assembly 2026-04\n/);
  assert.match(md, /\*\*Window:\*\* opens 2026-04-01, closes 2026-04-08 \(seven days\)\. \*\*Cycle issue:\*\* #110/);
  assert.doesNotMatch(md, /Copy to `YYYY-MM\.md`/);
  assert.match(md, /\| `example-willow` \| `Ran the fictional assembly end to end, against work that already happened\.` \| https:\/\/github\.com\/example-org\/example-repo\/issues\/2 \| https:\/\/github\.com\/example-org\/example-repo\/commit\/89abcdef0123456789abcdef0123456789abcdef \| 1 \|/);
  assert.match(md, /\| `example-river` \| `Reviewed the fictional proposal b>@​everyone\/b> \/ with a pipe` \| https:\/\/github\.com\/draykerdk\/daf\/issues\/31 \|/);
  assert.match(md, /\| `example-delta` \| `The fictional module as a whole` \| https:\/\/github\.com\/draykerdk\/daf\/issues\/41, https:\/\/github\.com\/draykerdk\/daf\/issues\/42 \| 2 \|/);
  assert.match(md, /\| `example-willow` \| participant \| https:\/\/github\.com\/example-org\/example-repo\/commit\/89abcdef/);
  assert.doesNotMatch(md, /example-cedar/, 'the claim for another cycle and the malformed claim are not rows');
  assert.match(md, /\| \*\*Outcome\*\* \| \*\*pending\*\* \|/);
  assert.match(md, /TODO\(person\): What happened this cycle/);
  assert.match(md, /TODO\(person\): What the rules got wrong this cycle/);
  assert.match(md, /## Steward intervention\n\nNone\./);
  assert.doesNotMatch(md, /unit-id|passed \/ failed/);
  const stub = read(dir, 'federation/units/example-willow.yml');
  assert.match(stub, /speaks_for:\n {4}- https:\/\/github\.com\/example-willow-gh\n/);
  assert.match(stub, /joined: null/);
  // No "Record" answer (_No response_): the stub says participant, marked for a person to confirm.
  assert.match(stub, /# TODO\(person\): participant = one person, unit = a group of any kind\.\n  kind: participant\n/);
  // "First delivery, as a unit (a group)": the kind comes from the claim.
  assert.match(md, /\| `example-aspen` \| unit \| https:\/\/github\.com\/example-org\/example-repo\/pull\/14 \|/);
  assert.match(md, /<!-- TODO\(person\): `example-aspen` has no unit record\. A stub was drafted at federation\/units\/example-aspen\.yml as a unit, as the claim declares; complete its name and founding function\. -->/);
  const aspen = read(dir, 'federation/units/example-aspen.yml');
  assert.match(aspen, /# As declared in the claim: participant = one person, unit = a group of any kind\.\n  kind: unit\n/);
  assert.doesNotMatch(aspen, /TODO\(person\): participant = one person/);
  assert.match(aspen, /speaks_for:\n {4}- https:\/\/github\.com\/example-aspen-gh\n/);
  // "I already have a record" for a holder that has one: no new record.
  assert.doesNotMatch(md, /\| `example-river` \| (participant|unit) \|/);
  const check = run(['check', '--root', dir, '--allow-pending']);
  assert.equal(check.code, 0, check.err);
  assert.match(check.err, /TODO\(person\) markers left/);
  const again = run(['draft', '2026-04', '--root', dir, '--issues', ISSUES]);
  assert.equal(again.code, 1);
  assert.match(again.err, /already exists/);
});

test('cli: draft lists a claim whose Cycle field is not exactly YYYY-MM instead of dropping it', () => {
  const dir = tmpCopy('basic');
  const flat = JSON.parse(read(FIX, 'issues-2026-04.json')).flat();
  const base = flat.find((i) => i.number === 111);
  const withCycle = (number, value, extra) => Object.assign({}, base, { number, title: '[Claim] A fictional claim ' + number,
    html_url: 'https://github.com/draykerdk/daf/issues/' + number,
    body: base.body.replace(/### Cycle\n\n2026-04$/, '### Cycle\n\n' + value) }, extra);
  assert.ok(withCycle(119, 'x').body.endsWith('### Cycle\n\nx'), 'the fixture claim ends with its Cycle field');
  const issues = path.join(dir, 'issues.json');
  fs.writeFileSync(issues, JSON.stringify(flat.concat([
    withCycle(119, '2026-04 (April)'),
    withCycle(120, '_No response_'),
    withCycle(121, 'April 2026', { state: 'closed', state_reason: 'not_planned' })
  ])));
  const r = run(['draft', '2026-04', '--root', dir, '--issues', issues]);
  assert.equal(r.code, 0, r.err);
  const md = read(dir, 'federation/assemblies/2026-04.md');
  assert.match(md, /\n<!-- not drafted: #119 has a "Cycle" field that is not exactly YYYY-MM \("2026-04 \(April\)"\); with the cycle written as YYYY-MM it is drafted in that cycle -->\n/);
  assert.match(md, /\n<!-- not drafted: #120 has a "Cycle" field that is not exactly YYYY-MM \(empty\);/);
  assert.match(r.out, /not drafted: #119 has a "Cycle" field that is not exactly YYYY-MM/);
  assert.doesNotMatch(md, /#121|#114/, 'a withdrawn claim and a claim for another cycle are not listed');
  assert.match(md, /^<!-- Rows drafted from claims: #111 Deliveries row 1 \(`example-willow`\); #112 Deliveries row 2 \(`example-river`\); #115 Module completions row 1 \(`example-delta`\); #118 Deliveries row 3 \(`example-aspen`\)\. -->\n/,
    'the well-formed claims are drafted as before');
});

test('cli: close writes the tally, joined and LEDGER, and nothing else', () => {
  const dir = tmpCopy('basic');
  const base = commitAll(dir);
  assert.equal(run(['draft', '2026-04', '--root', dir, '--issues', ISSUES]).code, 0);
  const report = 'federation/assemblies/2026-04.md';
  const before = read(dir, report);
  const unitBefore = read(dir, 'federation/units/example-willow.yml');
  const comments = path.join(dir, 'comments.json');
  fs.writeFileSync(comments, JSON.stringify([[
    comment(1, 'example-delta-gh', IN, vote('for', 'example-delta')),
    comment(2, 'example-river-gh', IN, vote('against', 'example-river'))
  ], [comment(3, 'example-willow-gh', IN, vote('for', 'example-willow'))]]));
  const r = run(['close', '2026-04', '--root', dir, '--comments', comments, '--base-ref', base]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /rewrote federation\/assemblies\/2026-04\.md/);
  assert.match(r.out, /set joined: 2026-04 in federation\/units\/example-willow\.yml/);
  const after = read(dir, report);
  assert.match(after, /\| Active points \| 6 \|\n\| Votes cast \| 5 \|\n\| Participation \| 83\.3% \(quorum 30%\) \|\n\| For \/ against \/ abstain \| 4 \/ 1 \/ 0 \|\n\| \*\*Outcome\*\* \| \*\*passed\*\* \|/);
  assert.match(after, /\| Holder \| Vote \| Weight \|\n\| --- \| --- \| --- \|\n\| `example-delta` \| for \| 4 \|\n\| `example-river` \| against \| 1 \|\n/);
  const outside = (s) => s.split('\n').filter((l) => !/^\| (Active points|Votes cast|Participation|For \/|\*\*Outcome|`example-(delta|river)` \| (for|against))/.test(l)).join('\n');
  assert.equal(outside(after), outside(before));
  assert.equal(read(dir, 'federation/units/example-willow.yml'), unitBefore.replace('joined: null', 'joined: 2026-04'));
  assert.match(read(dir, 'federation/LEDGER.md'), /\*\*As of:\*\* assembly 2026-04\./);
  const check = run(['check', '--root', dir]);
  assert.equal(check.code, 0, check.err);
  const twice = run(['close', '2026-04', '--root', dir, '--comments', comments, '--base-ref', base]);
  assert.equal(twice.code, 1);
  assert.match(twice.err, /already closed/);
});

/** A founding pull request on an empty default branch: the report and the records it adds. */
function foundingCheckout(holders) {
  const dir = tmpCopy(null);
  write(dir, 'federation/parameters.yml', read(FIX, 'basic/federation/parameters.yml'));
  write(dir, 'federation/LEDGER.md', read(ROOT, 'federation/LEDGER.md'));
  for (const f of ['daf-000-federation-constitution.md', 'daf-001-phase-0-github-federation.md']) write(dir, 'dafp/' + f, read(FIX, 'basic/dafp/' + f));
  const base = commitAll(dir);
  const river = read(FIX, 'basic/federation/units/example-river.yml');
  const unitFile = (id, kind) => river.replace(/example-river/g, id).replace('kind: participant', 'kind: ' + kind).replace(/joined: \S+/, 'joined: null');
  const RIVER_ROW = '| `example-river` | A fictional delivery under vote | #41 | https://github.com/example-org/example-repo/pull/10 | 1 |';
  const rows = holders.map(([id], i) => '| `' + id + '` | A fictional founding delivery | #' + (60 + i) + ' | https://github.com/example-org/example-repo/pull/' + (60 + i) + ' | 1 |');
  const records = holders.map(([id, kind], i) => '| `' + id + '` | ' + kind + ' | https://github.com/example-org/example-repo/pull/' + (60 + i) + ' |');
  for (const [id, kind] of holders) write(dir, 'federation/units/' + id + '.yml', unitFile(id, kind));
  write(dir, 'federation/assemblies/2026-04.md', pendingReport().replace(RIVER_ROW, rows.join('\n'))
    .replace('| Holder | Kind | First delivery |\n| --- | --- | --- |\n', '| Holder | Kind | First delivery |\n| --- | --- | --- |\n' + records.join('\n') + '\n'));
  return { dir, base };
}

test('cli: close decides the founding assembly with one vote for each participant with a delivery', () => {
  const { dir, base } = foundingCheckout([['example-river', 'participant'], ['example-gamma', 'participant'], ['example-delta', 'unit']]);
  const before = read(dir, 'federation/assemblies/2026-04.md');
  const comments = path.join(dir, 'c.json');
  fs.writeFileSync(comments, JSON.stringify([
    comment(1, 'example-river-gh', IN, vote('for', 'example-river')),
    comment(2, 'example-delta-gh', IN, vote('against', 'example-delta'))
  ]));
  const r = run(['close', '2026-04', '--root', dir, '--comments', comments, '--base-ref', base]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Outcome: passed\./);
  const after = read(dir, 'federation/assemblies/2026-04.md');
  assert.match(after, /\n## The vote\n\nFounding assembly: each participant with a delivery in this report counts once\.\n\n\| \| \|\n\| --- \| --- \|\n\| Participants with a delivery \| 2 \|\n\| Votes cast \| 1 \|\n\| Participation \| 50% \(quorum 30%\) \|\n\| For \/ against \/ abstain \| 1 \/ 0 \/ 0 \|\n\| \*\*Outcome\*\* \| \*\*passed\*\* \|\n/);
  assert.match(after, /\| Holder \| Vote \| Weight \|\n\| --- \| --- \| --- \|\n\| `example-river` \| for \| 1 \|\n\n/, 'the unit example-delta does not vote in the founding assembly');
  assert.doesNotMatch(after, /Weight from the ledger/);
  const outside = (x) => x.split('\n').filter((l) => !/^(\| (Active points|Participants with a delivery|Votes cast|Participation|For \/|\*\*Outcome|`example-river` \| for)|Weight from the ledger|Founding assembly: )/.test(l)).join('\n');
  assert.equal(outside(after), outside(before));
  for (const id of ['example-river', 'example-gamma', 'example-delta']) assert.match(read(dir, 'federation/units/' + id + '.yml'), /joined: 2026-04/, id);
  assert.match(read(dir, 'federation/LEDGER.md'), /\| `example-delta` \| unit \| 1 \| yes \| 2026-04 \|\n\| `example-gamma` \| participant \| 1 \| yes \| 2026-04 \|\n\| `example-river` \| participant \| 1 \| yes \| 2026-04 \|/);
  const check = run(['check', '--root', dir]);
  assert.equal(check.code, 0, check.err);
  assert.equal(check.err, '');
  // The next assembly is weighed by points again.
  assert.match(check.out, /0 errors, 0 warnings\./);
});

test('cli: close refuses a founding assembly with no participant delivery', () => {
  const { dir, base } = foundingCheckout([['example-delta', 'unit']]);
  const before = read(dir, 'federation/assemblies/2026-04.md');
  const comments = path.join(dir, 'c.json');
  fs.writeFileSync(comments, JSON.stringify([comment(1, 'example-delta-gh', IN, vote('for', 'example-delta'))]));
  const r = run(['close', '2026-04', '--root', dir, '--comments', comments, '--base-ref', base]);
  assert.equal(r.code, 1);
  assert.match(r.err, /refusing to close 2026-04: the outcome is undetermined\. No assembly has passed before this one, so it is the founding assembly: each participant with a delivery in this report counts once \(DAF-001 §4\)\. No participant has a delivery in this founding assembly/);
  assert.equal(read(dir, 'federation/assemblies/2026-04.md'), before);
  const t = run(['tally', '--root', dir, '--cycle', '2026-04', '--comments', comments, '--json']);
  assert.equal(t.code, 0, t.err);
  assert.equal(JSON.parse(t.out).outcome, 'undetermined');
});

test('cli: tally prints the vote block from a slurped comments file', () => {
  const dir = tmpCopy('basic');
  write(dir, 'federation/assemblies/2026-04.md', pendingReport());
  const comments = path.join(dir, 'c.json');
  fs.writeFileSync(comments, JSON.stringify([[comment(1, 'example-delta-gh', IN, vote('for', 'example-delta'))], []]));
  const r = run(['tally', '--root', dir, '--cycle', '2026-04', '--comments', comments, '--pr', '42', '--head', '0123456789abcdef']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^## The vote\n/);
  assert.match(r.out, /\| \*\*Outcome\*\* \| \*\*passed\*\* \|/);
  assert.match(r.out, /on PR #42 at head 0123456/);
  const missing = run(['tally', '--root', dir, '--cycle', '2026-04']);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /--comments <file> is required/);
});

test('cli: snapshot keeps the site keys and adds the new ones', () => {
  const dir = tmpCopy('basic');
  const out = path.join(dir, 'data');
  const r = run(['snapshot', '--root', dir, '--out', out, '--issues', ISSUES, '--commit', 'abc1234']);
  assert.equal(r.code, 0, r.err);
  const s = JSON.parse(fs.readFileSync(path.join(out, 'federation.json'), 'utf8'));
  assert.deepEqual(Object.keys(s), ['generated', 'units', 'assemblies', 'requests', 'issues', 'source_commit', 'parameters', 'ledger', 'events']);
  assert.match(s.generated, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.deepEqual(s.units.map((u) => u.name), ['example-cedar.yml', 'example-delta.yml', 'example-river.yml']);
  assert.equal(s.requests[0].url, 'https://github.com/draykerdk/daf/blob/master/federation/requests/1-example-tooling.md');
  assert.equal(s.assemblies[0].url, 'https://github.com/draykerdk/daf/blob/master/federation/assemblies/2026-01.md');
  assert.deepEqual(s.issues.map((i) => [i.num, i.pr]), [[118, false], [117, false], [116, true], [115, false], [114, false], [113, false], [111, false], [110, false]]);
  assert.deepEqual(Object.keys(s.issues[0]), ['num', 'title', 'url', 'pr']);
  assert.equal(s.source_commit, 'abc1234');
  assert.equal(s.events.head, '7d0c81f251d8cd8ec9687b17781dc89a5c685d01e964d809ef7a187a91019af7');
  assert.equal(s.ledger.totals.points, 6);
  assert.ok(fs.existsSync(path.join(out, 'events.json')) && fs.existsSync(path.join(out, 'events.log')));
  const empty = run(['snapshot', '--root', ROOT, '--out', path.join(dir, 'real')]);
  assert.equal(empty.code, 0, empty.err);
  const e = JSON.parse(fs.readFileSync(path.join(dir, 'real', 'federation.json'), 'utf8'));
  assert.deepEqual([e.units, e.assemblies, e.requests, e.issues, e.source_commit, e.events.count], [[], [], [], [], null, 0]);
});

test('cli: recordKind reads the claim form dropdown', () => {
  const { recordKind } = require('../daf');
  assert.equal(recordKind('First delivery, as a participant (one person)'), 'participant');
  assert.equal(recordKind('First delivery, as a unit (a group)'), 'unit');
  assert.equal(recordKind('I already have a record'), null);
  assert.equal(recordKind(''), null);
  assert.equal(recordKind(undefined), null);
});

test('cli: usage, unknown commands and the tally.js wrapper', () => {
  const help = run(['--help']);
  assert.equal(help.code, 0);
  assert.equal(help.out + '\n', USAGE);
  assert.equal(run(['frobnicate']).code, 1);
  assert.equal(run(['check', '--bogus']).code, 1);
  const wrapper = spawnSync(process.execPath, [path.join(ROOT, 'tools/tally.js'), '--help'], { encoding: 'utf8' });
  assert.equal(wrapper.status, 0);
  assert.match(wrapper.stdout, /^usage: node tools\/tally\.js <pr-number>/);
  const bare = spawnSync(process.execPath, [path.join(ROOT, 'tools/tally.js')], { encoding: 'utf8' });
  assert.equal(bare.status, 1);
  assert.match(bare.stderr, /^usage: node tools\/tally\.js/);
});

test('cli: T10 draft finds the cycle issue by its Cycle field, with the title as fallback', () => {
  const body = (cycle, opens, closes) => '### Cycle\n\n' + cycle + '\n\n### Window opens\n\n' + opens + '\n\n### Window closes\n\n' + closes + '\n';
  const draft = (issues) => {
    const dir = tmpCopy('basic');
    const file = path.join(dir, 'issues.json');
    fs.writeFileSync(file, JSON.stringify(issues));
    const r = run(['draft', '2026-04', '--root', dir, '--issues', file]);
    assert.equal(r.code, 0, r.err);
    return { r, md: read(dir, 'federation/assemblies/2026-04.md') };
  };
  // The form's default title, with the cycle only in the field.
  const byField = draft([
    { number: 129, state: 'open', title: '[Cycle] Assembly 2026-04 (moved)', body: body('2026-05', '2026-05-04', '2026-05-11') },
    { number: 130, state: 'open', title: '[Cycle] Assembly ', body: body('2026-04', '2026-04-06', '2026-04-13') }
  ]);
  assert.match(byField.md, /\*\*Window:\*\* opens 2026-04-06, closes 2026-04-13 \(seven days\)\. \*\*Cycle issue:\*\* #130/);
  assert.doesNotMatch(byField.r.err, /WARNING/);
  // No field (an issue written by hand): the title still finds it.
  const byTitle = draft([{ number: 131, state: 'open', title: '[Cycle] Assembly 2026-04', body: '**Window:** opens 2026-04-06, closes 2026-04-13' }]);
  assert.match(byTitle.md, /opens 2026-04-06, closes 2026-04-13 \(seven days\)\. \*\*Cycle issue:\*\* #131/);
  // A closed cycle issue, or one whose field names another cycle, is not it.
  const none = draft([
    { number: 132, state: 'closed', title: '[Cycle] Assembly ', body: body('2026-04', '2026-04-06', '2026-04-13') },
    { number: 133, state: 'open', title: '[Cycle] Assembly 2026-04', body: body('2026-05', '2026-05-04', '2026-05-11') }
  ]);
  assert.match(none.r.err, /WARNING: no open \[Cycle\] issue mentions 2026-04/);
  assert.match(none.md, /opens YYYY-MM-DD, closes YYYY-MM-DD/);
});

test('cli: site-4 the snapshot keeps every open [Cycle], [Claim], [Request] and [Veto] issue past the cap', () => {
  const dir = tmpCopy('basic');
  const issue = (number, title, pr) => Object.assign({ number, state: 'open', title, html_url: 'https://github.com/draykerdk/daf/' + (pr ? 'pull/' : 'issues/') + number }, pr ? { pull_request: {} } : {});
  const page1 = [issue(5, '[Cycle] Assembly 2026-04'), issue(6, '[Claim] An old claim'), issue(7, '[Request] An old request'), issue(8, '[Veto] An old veto'), issue(9, '[Claim] a pull request, not an issue', true), Object.assign(issue(4, '[Claim] A closed claim'), { state: 'closed' })];
  const page2 = [];
  for (let n = 200; n < 240; n++) page2.push(issue(n, 'A fictional thread ' + n));
  for (let n = 300; n < 305; n++) page2.push(issue(n, 'A fictional pull request ' + n, true));
  const file = path.join(dir, 'issues.json');
  fs.writeFileSync(file, JSON.stringify([page1, page2]));
  const out = path.join(dir, 'data');
  const r = run(['snapshot', '--root', dir, '--out', out, '--issues', file]);
  assert.equal(r.code, 0, r.err);
  const nums = JSON.parse(fs.readFileSync(path.join(out, 'federation.json'), 'utf8')).issues.map((i) => i.num);
  const rest = [304, 303, 302, 301, 300];
  for (let n = 239; rest.length < 30; n--) rest.push(n);
  assert.deepEqual(nums, rest.concat([8, 7, 6, 5]), 'the 30 newest of the rest, then the four kept issues, newest first');
  assert.ok(!nums.includes(9) && !nums.includes(4), 'a pull request titled [Claim] is capped like the rest; a closed issue is dropped');
});

test('cli: 13 tally --report reads the record from the root and only the report from the file', () => {
  const dir = tmpCopy('basic');
  // The default branch holds a 2026-04 report without a window; the pull
  // request head's report has one. Only the file passed with --report counts.
  write(dir, 'federation/assemblies/2026-04.md', pendingReport({ noWindow: true }));
  const onDisk = read(dir, 'federation/assemblies/2026-04.md');
  const head = path.join(dir, 'head');
  write(head, 'report.md', pendingReport());
  const comments = path.join(dir, 'c.json');
  fs.writeFileSync(comments, JSON.stringify([[comment(1, 'example-delta-gh', IN, vote('for', 'example-delta'))]]));
  const local = run(['tally', '--root', dir, '--cycle', '2026-04', '--comments', comments]);
  assert.match(local.out, /not counted: no window in the report/);
  const r = run(['tally', '--root', dir, '--cycle', '2026-04', '--report', path.join(head, 'report.md'), '--comments', comments, '--json']);
  assert.equal(r.code, 0, r.err);
  const t = JSON.parse(r.out);
  assert.deepEqual([t.outcome, t.base, t.cast], ['passed', 6, 4]);
  assert.equal(read(dir, 'federation/assemblies/2026-04.md'), onDisk, 'in memory only');
  // --record still works as before, and --report reads the record it names.
  const other = tmpCopy('basic');
  write(other, 'federation/assemblies/2026-04.md', pendingReport());
  assert.equal(JSON.parse(run(['tally', '--record', other, '--cycle', '2026-04', '--comments', comments, '--json']).out).outcome, 'passed');
  assert.equal(JSON.parse(run(['tally', '--record', dir, '--report', path.join(head, 'report.md'), '--cycle', '2026-04', '--comments', comments, '--json']).out).outcome, 'passed');
  // A report whose title names another cycle is a problem, printed as a warning.
  write(head, 'other.md', pendingReport({ cycle: '2026-05' }));
  const wrong = run(['tally', '--root', dir, '--cycle', '2026-04', '--report', path.join(head, 'other.md'), '--comments', comments]);
  assert.match(wrong.err, /WARNING: federation\/assemblies\/2026-04\.md: the title says assembly 2026-05 but the report is read as 2026-04/);
  const missing = run(['tally', '--root', dir, '--cycle', '2026-04', '--report', path.join(head, 'nope.md'), '--comments', comments]);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /cannot read the report/);
  assert.equal(run(['tally', '--root', dir, '--cycle', '2026-04', '--report', path.join(head, 'report.md'), '--master-record', dir, '--comments', comments]).code, 1);
  assert.match(run(['close', '2026-04', '--root', dir, '--report', path.join(head, 'report.md'), '--comments', comments]).err, /--report does not apply/);
});

/** A checkout with the instruments in tools/ and the given federation/, as the workflow sees it. */
function checkout(federationFrom) {
  const dir = tmpCopy(null);
  fs.cpSync(federationFrom, path.join(dir, 'federation'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tools'));
  fs.copyFileSync(path.join(ROOT, 'tools/daf.js'), path.join(dir, 'tools/daf.js'));
  fs.cpSync(path.join(ROOT, 'tools/lib'), path.join(dir, 'tools/lib'), { recursive: true });
  return dir;
}

/** The Count step of .github/workflows/federation-tally.yml, verbatim but for the paths. */
function countStep(cwd, temp, extra, report) {
  return spawnSync(process.execPath, ['tools/daf.js', 'tally', '--cycle', '2026-04', '--report', path.join(temp, report || 'report.md'),
    '--comments', path.join(temp, 'comments.json'),
    '--reviews', path.join(temp, 'reviews.json'),
    '--review-comments', path.join(temp, 'review-comments.json'),
    '--pr', '42', '--head', '0123456789abcdef0123456789abcdef01234567'].concat(extra || []), { cwd, encoding: 'utf8' });
}

test('cli: 13 the tally workflow invocation reads the default branch record and the report file', () => {
  const temp = tmpCopy(null);
  write(temp, 'reviews.json', JSON.stringify([[]]));
  write(temp, 'review-comments.json', JSON.stringify([[{ id: 9, user: { login: 'example-delta-gh' }, created_at: IN, updated_at: IN, body: vote('against', 'example-delta') }]]));
  write(temp, 'comments.json', JSON.stringify([[
    comment(1, 'example-delta-gh', IN, vote('for', 'example-delta')),
    comment(2, 'example-mallory-gh', IN, vote('against', 'example-delta')),
    comment(3, 'example-gamma-gh', IN, vote('for', 'example-gamma'))
  ], [comment(4, 'example-river-gh', IN, vote('for', 'example-river'))]]));
  write(temp, 'report.md', pendingReport({ newRecord: 'example-gamma' }));

  // The real default branch today: an empty record. The first report under
  // vote is the founding assembly (DAF-001 §4), and its participants' records
  // come with it: the workflow writes the unit files the pull request adds to
  // a directory and passes it as --founding-units.
  const RIVER_ROW = '| `example-river` | A fictional delivery under vote | #41 | https://github.com/example-org/example-repo/pull/10 | 1 |';
  const GAMMA_ROW = '| `example-gamma` | A fictional founding delivery | #43 | https://github.com/example-org/example-repo/pull/15 | 1 |';
  write(temp, 'founding.md', pendingReport({ newRecord: 'example-gamma' }).replace(RIVER_ROW, RIVER_ROW + '\n' + GAMMA_ROW)
    .replace('| `example-gamma` | participant |', '| `example-river` | participant | https://github.com/example-org/example-repo/pull/10 |\n| `example-gamma` | participant |'));
  const river = read(FIX, 'basic/federation/units/example-river.yml').replace(/joined: \S+/, 'joined: null');
  write(temp, 'units/example-river.yml', river);
  write(temp, 'units/example-gamma.yml', river.replace(/example-river/g, 'example-gamma'));
  const empty = checkout(path.join(ROOT, 'federation'));
  const blind = countStep(empty, temp, [], 'founding.md');
  assert.equal(blind.status, 0, blind.stderr);
  assert.match(blind.stdout, /^## The vote\n\nFounding assembly: each participant with a delivery in this report counts once\.\n/);
  assert.match(blind.stdout, /\| \*\*Outcome\*\* \| \*\*undetermined\*\* \|/);
  assert.match(blind.stdout, /The record of `example-gamma`, `example-river` is not in this count\. In the founding assembly the accounts that may vote for a new participant come from the record the pull request adds \(--founding-units\)/);
  assert.match(blind.stderr, /NOTE: the outcome is undetermined; `close` will not write it\./);
  const first = countStep(empty, temp, ['--founding-units', path.join(temp, 'units')], 'founding.md');
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /\| Participants with a delivery \| 2 \|\n\| Votes cast \| 2 \|\n\| Participation \| 100% \(quorum 30%\) \|\n\| For \/ against \/ abstain \| 2 \/ 0 \/ 0 \|\n\| \*\*Outcome\*\* \| \*\*passed\*\* \|/);
  assert.match(first.stdout, /\| `example-gamma` \| for \| 1 \| 50% \|\n\| `example-river` \| for \| 1 \| 50% \|/);
  assert.match(first.stdout, /`example-delta` by `example-delta-gh`, `for`: `example-delta` is not a participant with a delivery in this founding assembly; only those vote in it, once each \(DAF-001 §4\)/);
  assert.match(first.stdout, /Computed from 5 comments on PR #42 at head 0123456, window from 2026-04-01 00:00 to 2026-04-08 00:00 UTC \(a vote at or after the close is not counted\), one vote for each participant with a delivery in the report of 2026-04\./);
  assert.doesNotMatch(first.stderr, /undetermined/);
  assert.ok(!fs.existsSync(path.join(empty, 'federation/assemblies/2026-04.md')), 'the report is read in memory only');
  assert.ok(!fs.existsSync(path.join(empty, 'federation/units/example-gamma.yml')), 'the added records are read in memory only');

  // A default branch with history: weights and speakers come from it, and the
  // added records are not read, since this is not the founding assembly.
  const basic = checkout(path.join(FIX, 'basic/federation'));
  const r = countStep(basic, temp, ['--founding-units', path.join(temp, 'units')]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\| Active points \| 6 \|\n\| Votes cast \| 5 \|\n\| Participation \| 83\.3% \(quorum 30%\) \|\n\| For \/ against \/ abstain \| 5 \/ 0 \/ 0 \|\n\| \*\*Outcome\*\* \| \*\*passed\*\* \|/);
  assert.match(r.stdout, /`example-delta` by `example-mallory-gh`, `against`: the author is not listed in speaks_for of `example-delta`/);
  assert.match(r.stdout, /`example-gamma` by `example-gamma-gh`, `for`: `example-gamma` has no weight in the ledger before 2026-04/);
  assert.match(r.stdout, /`example-delta` by `example-delta-gh`, `against`: posted as a line comment on the diff/);
});

test('cli: F2 the tally.js wrapper takes --report and --founding-units', () => {
  const help = spawnSync(process.execPath, [path.join(ROOT, 'tools/tally.js'), '--help'], { encoding: 'utf8' });
  assert.match(help.stdout, /\[--report <file>\] \[--founding-units <dir>\]/);
  const badCycle = spawnSync(process.execPath, [path.join(ROOT, 'tools/tally.js'), '42', '--cycle', '2026-13'], { encoding: 'utf8' });
  assert.equal(badCycle.status, 1);
  assert.match(badCycle.stderr, /^usage: node tools\/tally\.js/);
});
