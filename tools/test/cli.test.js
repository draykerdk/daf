'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { ROOT, FIX, tmpCopy, run, read, write, comment, vote, pendingReport } = require('./helpers');
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

test('cli: check passes on the basic fixture and states what it cannot recompute', () => {
  const r = run(['check', '--root', tmpCopy('basic')]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /NOTE: federation\/assemblies\/2026-01\.md: the outcome "passed" cannot be recomputed/);
  assert.match(r.out, /3 unit records, 3 assembly reports, 1 request; 20 events, head 4e0553ad0fb2\. 0 errors, 0 warnings\./);
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
  assert.match(unknown.err, /delivery holder `example-ghost` has no unit record/);

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
  assert.match(md, /^<!-- not drafted: #113 "The result" is not one https URL or #n reference -->\n/);
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

test('cli: close writes the tally, joined and LEDGER, and nothing else', () => {
  const dir = tmpCopy('basic');
  assert.equal(run(['draft', '2026-04', '--root', dir, '--issues', ISSUES]).code, 0);
  const report = 'federation/assemblies/2026-04.md';
  const before = read(dir, report);
  const unitBefore = read(dir, 'federation/units/example-willow.yml');
  const comments = path.join(dir, 'comments.json');
  fs.writeFileSync(comments, JSON.stringify([[
    comment(1, 'example-delta-gh', IN, vote('for', 'example-delta')),
    comment(2, 'example-river-gh', IN, vote('against', 'example-river'))
  ], [comment(3, 'example-willow-gh', IN, vote('for', 'example-willow'))]]));
  const r = run(['close', '2026-04', '--root', dir, '--comments', comments]);
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
  const twice = run(['close', '2026-04', '--root', dir, '--comments', comments]);
  assert.equal(twice.code, 1);
  assert.match(twice.err, /already closed/);
});

test('cli: close refuses an undetermined (founding) outcome', () => {
  const dir = tmpCopy(null);
  write(dir, 'federation/parameters.yml', read(FIX, 'basic/federation/parameters.yml'));
  write(dir, 'federation/LEDGER.md', read(ROOT, 'federation/LEDGER.md'));
  write(dir, 'federation/units/example-river.yml', read(FIX, 'basic/federation/units/example-river.yml'));
  write(dir, 'federation/assemblies/2026-04.md', pendingReport({ newRecord: 'example-river' }));
  const before = read(dir, 'federation/assemblies/2026-04.md');
  const comments = path.join(dir, 'c.json');
  fs.writeFileSync(comments, JSON.stringify([comment(1, 'example-river-gh', IN, vote('for', 'example-river'))]));
  const r = run(['close', '2026-04', '--root', dir, '--comments', comments]);
  assert.equal(r.code, 1);
  assert.match(r.err, /refusing to close 2026-04: the outcome is undetermined\. No holder had weight before this assembly/);
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
  assert.equal(s.events.head, '4e0553ad0fb2621a95df6c8423d65f077a0977613cb0326c00888324074199f9');
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
