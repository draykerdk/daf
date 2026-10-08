'use strict';
// Regression tests for the audit of 2026-10-08 (DAF-C1, C3, C4, C5, C6). Each
// one replays the reproduction that showed the defect, on fictional records.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { FIX, tmpCopy, run, read, write, comment, vote, pendingReport, commitAll, git } = require('./helpers');
const { loadRecord, gitBlobSha, withReport } = require('../lib/record');
const { deriveEvents, serialize } = require('../lib/events');
const { computeTally, PROVISIONAL } = require('../lib/tally');
const { renderTally } = require('../lib/render');

const GOLDEN_HEAD = '65c6a3a9446a70174761d475f3ef0f7ec0ce94077c20c2b5758217959e73cbd7';
const IN = '2026-04-02T10:00:00Z';
const OUTSIDER_UNIT = (text) => text.replace('    - https://github.com/Example-Delta-Two-GH', '    - https://github.com/Example-Delta-Two-GH\n    - https://github.com/outsider-gh');

// ---------------------------------------------------------------------------
// DAF-C1: close counts against the default branch, not the pull request.
// ---------------------------------------------------------------------------

/**
 * The basic fixture as the default branch (committed), with a pull request in
 * the working tree: a pending 2026-04 report, and example-delta's record
 * edited to add an outsider to speaks_for. Votes: the outsider for, as
 * example-delta (weight 4); example-river and example-cedar against.
 */
function outsiderPr() {
  const dir = tmpCopy('basic');
  const base = commitAll(dir);
  write(dir, 'federation/assemblies/2026-04.md', pendingReport());
  const unit = 'federation/units/example-delta.yml';
  write(dir, unit, OUTSIDER_UNIT(read(dir, unit)));
  const comments = path.join(dir, 'c.json');
  fs.writeFileSync(comments, JSON.stringify([
    comment(1, 'outsider-gh', '2026-04-02T10:00:00Z', vote('for', 'example-delta')),
    comment(2, 'example-river-gh', '2026-04-02T11:00:00Z', vote('against', 'example-river')),
    comment(3, 'example-cedar-gh', '2026-04-02T12:00:00Z', vote('against', 'example-cedar'))
  ]));
  return { dir, base, comments };
}

test('audit C1: an outsider added to speaks_for in the pull request is not counted by close', () => {
  const { dir, base, comments } = outsiderPr();
  const r = run(['close', '2026-04', '--root', dir, '--comments', comments, '--base-ref', base, '--allow-undetermined']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /WARNING: federation\/units\/example-delta\.yml: modified in the working tree versus [0-9a-f]{40}\. close reads unit records, parameters and earlier assemblies from [0-9a-f]{40}, so this change is not part of the count\./);
  assert.doesNotMatch(r.err, /2026-04\.md: added/, 'the report under vote is not listed');
  const after = read(dir, 'federation/assemblies/2026-04.md');
  // Before the fix: "Votes cast 6, 4 / 2 / 0, **passed**" with `example-delta` | for | 4.
  assert.match(after, /\| Votes cast \| 2 \|\n\| Participation \| 33\.3% \(quorum 30%\) \|\n\| For \/ against \/ abstain \| 0 \/ 2 \/ 0 \|\n\| \*\*Outcome\*\* \| \*\*failed\*\* \|/);
  assert.doesNotMatch(after, /\| `example-delta` \| for \|/);
  // The working tree's edit is left as it is; close only reports it.
  assert.match(read(dir, 'federation/units/example-delta.yml'), /outsider-gh/);
  // The same count as the tally workflow: the default branch plus the report file.
  const master = tmpCopy('basic');
  write(master, 'report.md', pendingReport());
  const t = run(['tally', '--root', master, '--cycle', '2026-04', '--report', path.join(master, 'report.md'), '--comments', comments, '--allow-undetermined', '--json']);
  assert.equal(t.code, 0, t.err);
  const j = JSON.parse(t.out);
  assert.deepEqual([j.for, j.against, j.abstain, j.outcome], [0, 2, 0, 'failed']);
  assert.match(after, /\| For \/ against \/ abstain \| 0 \/ 2 \/ 0 \|/);
  assert.ok(j.notCounted.some((n) => n.login === 'outsider-gh' && /not listed in speaks_for of `example-delta`/.test(n.reason)));
  // check after the close agrees with what was written.
  const check = run(['check', '--root', dir, '--allow-undetermined']);
  assert.equal(check.code, 0, check.err);
});

test('audit C1: computeTally takes speaks_for from masterRecord when it is given', () => {
  const pr = tmpCopy('basic');
  write(pr, 'federation/assemblies/2026-04.md', pendingReport());
  write(pr, 'federation/units/example-delta.yml', OUTSIDER_UNIT(read(pr, 'federation/units/example-delta.yml')));
  const record = loadRecord(pr);
  const masterRecord = loadRecord(path.join(FIX, 'basic'));
  const comments = [comment(1, 'outsider-gh', IN, vote('for', 'example-delta'))];
  assert.equal(computeTally({ record, cycle: '2026-04', comments }).for, 4, 'without a master record the record speaks');
  const t = computeTally({ record, cycle: '2026-04', comments, masterRecord });
  assert.equal(t.for, 0);
  assert.match(t.notCounted[0].reason, /not listed in speaks_for of `example-delta`/);
});

test('audit C1: close writes joined on the working tree records it accepts, and LEDGER.md from the working tree', () => {
  const dir = tmpCopy('basic');
  const base = commitAll(dir);
  // The pull request adds a record (example-gamma) and a report that accepts it.
  write(dir, 'federation/units/example-gamma.yml', read(dir, 'federation/units/example-river.yml').replace(/example-river/g, 'example-gamma').replace(/joined: \S+/, 'joined: null').replace('kind: unit', 'kind: participant'));
  write(dir, 'federation/assemblies/2026-04.md', pendingReport({ newRecord: 'example-gamma' }));
  const comments = path.join(dir, 'c.json');
  fs.writeFileSync(comments, JSON.stringify([comment(1, 'example-delta-gh', IN, vote('for', 'example-delta'))]));
  const r = run(['close', '2026-04', '--root', dir, '--comments', comments, '--base-ref', base, '--allow-undetermined']);
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(r.err, /example-gamma\.yml/, 'an added unit record is not a warning');
  assert.match(r.out, /set joined: 2026-04 in federation\/units\/example-gamma\.yml/);
  assert.match(read(dir, 'federation/units/example-gamma.yml'), /joined: 2026-04/);
  assert.match(read(dir, 'federation/LEDGER.md'), /\| `example-gamma` \| participant \| 0 \| no \| 2026-04 \|/);
  assert.equal(run(['check', '--root', dir, '--allow-undetermined']).code, 0);
});

test('audit C1: close warns about parameters and other assemblies changed versus the base', () => {
  const dir = tmpCopy('basic');
  const base = commitAll(dir);
  write(dir, 'federation/assemblies/2026-04.md', pendingReport());
  write(dir, 'federation/parameters.yml', read(dir, 'federation/parameters.yml').replace('quorum_percent: 30 ', 'quorum_percent: 31 '));
  write(dir, 'federation/assemblies/2026-02.md', read(dir, 'federation/assemblies/2026-02.md').replace('Fictional second assembly.', 'Fictional second assembly, edited.'));
  const comments = path.join(dir, 'c.json');
  fs.writeFileSync(comments, JSON.stringify([comment(1, 'example-delta-gh', IN, vote('for', 'example-delta'))]));
  // The edited parameters break the cross-check of check, not close: close
  // counts with the parameters of the base and says so.
  const r = run(['close', '2026-04', '--root', dir, '--comments', comments, '--base-ref', base, '--allow-undetermined']);
  assert.match(r.err, /WARNING: federation\/parameters\.yml: modified in the working tree versus /);
  assert.match(r.err, /WARNING: federation\/assemblies\/2026-02\.md: modified in the working tree versus /);
  assert.equal(r.code, 0, r.err);
  assert.match(read(dir, 'federation/assemblies/2026-04.md'), /\| Participation \| 66\.6% \(quorum 30%\) \|/, 'the quorum figure comes from the base');
});

test('audit C1: close refuses when the base ref is missing, and writes nothing', () => {
  const dir = tmpCopy('basic');
  commitAll(dir); // a repository with no origin
  write(dir, 'federation/assemblies/2026-04.md', pendingReport());
  const before = read(dir, 'federation/assemblies/2026-04.md');
  const ledger = read(dir, 'federation/LEDGER.md');
  const comments = path.join(dir, 'c.json');
  fs.writeFileSync(comments, JSON.stringify([comment(1, 'example-delta-gh', IN, vote('for', 'example-delta'))]));
  const r = run(['close', '2026-04', '--root', dir, '--comments', comments, '--allow-undetermined']);
  assert.equal(r.code, 1);
  assert.match(r.err, /error: the base ref origin\/master is not in this checkout\. .*run `git fetch origin`/);
  assert.equal(read(dir, 'federation/assemblies/2026-04.md'), before);
  assert.equal(read(dir, 'federation/LEDGER.md'), ledger);
  // An origin/master ref is the default.
  git(dir, 'update-ref', 'refs/remotes/origin/master', 'HEAD');
  assert.equal(run(['close', '2026-04', '--root', dir, '--comments', comments, '--allow-undetermined']).code, 0);
  // --record, --master-record and an option-like ref are refused.
  for (const extra of [['--record', dir], ['--master-record', dir], ['--base-ref=-x']]) {
    assert.match(run(['close', '2026-05', '--root', dir, '--comments', comments].concat(extra)).err, /usage error/, extra.join(' '));
  }
});

// ---------------------------------------------------------------------------
// DAF-C5: no close before the window closes; the tally says it is provisional.
// ---------------------------------------------------------------------------

test('audit C5: close refuses while the window is open; tally marks the count provisional', () => {
  const dir = tmpCopy('basic');
  const base = commitAll(dir);
  write(dir, 'federation/assemblies/2026-10.md', pendingReport({ cycle: '2026-10' }).replace('opens 2026-04-01, closes 2026-04-08', 'opens 2026-10-05, closes 2026-10-12'));
  const before = read(dir, 'federation/assemblies/2026-10.md');
  const ledger = read(dir, 'federation/LEDGER.md');
  const comments = path.join(dir, 'c.json');
  fs.writeFileSync(comments, JSON.stringify([comment(1, 'example-delta-gh', '2026-10-06T10:00:00Z', vote('for', 'example-delta'))]));
  const close = (now) => run(['close', '2026-10', '--root', dir, '--comments', comments, '--base-ref', base, '--allow-undetermined', '--now', now]);
  for (const now of ['2026-10-08T13:40:00Z', '2026-10-11T23:59:59Z', '2026-10-11']) {
    const r = close(now);
    assert.equal(r.code, 1, now);
    assert.match(r.err, /error: refusing to close 2026-10: the window closes at 2026-10-12T00:00:00Z; close after it\. Nothing was written\./, now);
    assert.equal(read(dir, 'federation/assemblies/2026-10.md'), before, now);
    assert.equal(read(dir, 'federation/LEDGER.md'), ledger, now);
  }
  const tally = (now) => run(['tally', '--root', dir, '--cycle', '2026-10', '--comments', comments, '--allow-undetermined', '--now', now]);
  const open = tally('2026-10-08T13:40:00Z');
  assert.equal(open.code, 0, open.err);
  assert.match(open.out, /\| \*\*Outcome\*\* \| \*\*passed\*\* \|\n\nThe window is still open: this count is provisional\.\n/);
  const closedTally = tally('2026-10-12T00:00:00Z');
  assert.doesNotMatch(closedTally.out, /provisional/);
  assert.match(run(['tally', '--root', dir, '--cycle', '2026-10', '--comments', comments, '--now', 'tomorrow']).err, /usage error: --now must be an ISO 8601 time/);
  // At the closing instant, close writes the outcome.
  const r = close('2026-10-12T00:00:00Z');
  assert.equal(r.code, 0, r.err);
  assert.match(read(dir, 'federation/assemblies/2026-10.md'), /\| \*\*Outcome\*\* \| \*\*passed\*\* \|/);
});

test('audit C5: computeTally is provisional only before the close instant', () => {
  const dir = tmpCopy('basic');
  write(dir, 'federation/assemblies/2026-04.md', pendingReport());
  const record = loadRecord(dir);
  const at = (iso) => computeTally({ record, cycle: '2026-04', comments: [], now: Date.parse(iso) });
  assert.equal(at('2026-04-07T23:59:59Z').provisional, true);
  assert.equal(at('2026-04-08T00:00:00Z').provisional, false);
  assert.ok(renderTally(at('2026-04-03T00:00:00Z')).includes('\n' + PROVISIONAL + '\n'));
  assert.ok(!renderTally(at('2026-04-09T00:00:00Z')).includes(PROVISIONAL));
});

// ---------------------------------------------------------------------------
// DAF-C3: a decided request's file does not enter the event log.
// ---------------------------------------------------------------------------

test('audit C3: editing or deleting a decided request leaves the head unchanged; deleting it fails check', () => {
  const REQ = 'federation/requests/1-example-tooling.md';
  const head = (dir) => deriveEvents(loadRecord(dir)).head;
  const check = (dir, ...extra) => run(['check', '--root', dir, '--allow-undetermined', ...extra]);

  // The requester changed after the decision (the audit's ev-rq case).
  const edited = tmpCopy('basic');
  const base = commitAll(edited);
  write(edited, REQ, read(edited, REQ).replace('**From:** `example-delta`', '**From:** `example-cedar`'));
  assert.equal(head(edited), GOLDEN_HEAD);
  let r = check(edited);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /head 65c6a3a9446a\. 0 errors/);
  git(edited, 'commit', '-q', '-am', 'edit a decided request');
  r = check(edited, '--base', base);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /WARNING: federation\/requests\/1-example-tooling\.md: M since [0-9a-f]{40}\. This request was already decided in federation\/assemblies\/2026-02\.md;/);

  // The decided request deleted.
  const deleted = tmpCopy('basic');
  const base2 = commitAll(deleted);
  fs.rmSync(path.join(deleted, REQ));
  assert.equal(head(deleted), GOLDEN_HEAD);
  r = check(deleted);
  assert.equal(r.code, 1);
  assert.match(r.err, /ERROR: federation\/assemblies\/2026-02\.md:38: Resource decisions names federation\/requests\/1-example-tooling\.md, which does not exist; a decided request is kept, not deleted or renamed/);
  git(deleted, 'commit', '-q', '-am', 'delete a decided request');
  assert.match(check(deleted, '--base', base2).err, /WARNING: federation\/requests\/1-example-tooling\.md: D since /);

  // A new request, and an edit to an undecided one, are ordinary: no warning.
  const fresh = tmpCopy('basic');
  const base3 = commitAll(fresh);
  write(fresh, 'federation/requests/2-example-more.md', read(fresh, REQ).replace('# Request 1.', '# Request 2.'));
  git(fresh, 'add', '-A');
  git(fresh, 'commit', '-q', '-m', 'add');
  write(fresh, 'federation/requests/2-example-more.md', read(fresh, 'federation/requests/2-example-more.md') + '\nMore.\n');
  git(fresh, 'commit', '-q', '-am', 'edit');
  r = check(fresh, '--base', base3);
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(r.err, /requests\//);
});

// ---------------------------------------------------------------------------
// DAF-C4: line endings do not change the blob, the head or check.
// ---------------------------------------------------------------------------

/** Every file of a tree, with LF turned into CRLF, as core.autocrlf=true checks it out. */
function toCrlf(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    const f = path.join(e.parentPath || e.path, e.name);
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/\r?\n/g, '\r\n'));
  }
}

test('audit C4: the fixture checked out with CRLF gives the same head, events and a clean check', () => {
  const lf = tmpCopy('basic');
  const crlf = tmpCopy('basic');
  toCrlf(path.join(crlf, 'federation'));
  toCrlf(path.join(crlf, 'dafp'));
  assert.match(read(crlf, 'federation/assemblies/2026-01.md'), /\r\n/);
  assert.match(read(crlf, 'federation/LEDGER.md'), /\r\n/);
  // The audit's ev-lf and ev-crlf exports: before the fix they differed.
  assert.equal(serialize(deriveEvents(loadRecord(crlf))).json, serialize(deriveEvents(loadRecord(lf))).json);
  assert.equal(deriveEvents(loadRecord(crlf)).head, GOLDEN_HEAD);
  const r = run(['check', '--root', crlf, '--allow-undetermined']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /20 events, head 65c6a3a9446a\. 0 errors, 1 warning\./);
});

test('audit C4: gitBlobSha hashes CRLF as git stores a text file', () => {
  const lf = Buffer.from('a\nb\n');
  const want = execFileSync('git', ['hash-object', '--stdin'], { input: lf, encoding: 'utf8' }).trim();
  assert.equal(gitBlobSha(lf), want);
  assert.equal(gitBlobSha(Buffer.from('a\r\nb\r\n')), want);
  assert.notEqual(gitBlobSha(Buffer.from('a\rb\n')), want, 'a lone CR is kept');
  assert.equal(gitBlobSha(Buffer.alloc(0)), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  // withReport, which the tally workflow uses, hashes the same way.
  const dir = tmpCopy('basic');
  const file = path.join(dir, 'report.md');
  fs.writeFileSync(file, pendingReport().replace(/\n/g, '\r\n'));
  const a = withReport(loadRecord(dir), file, '2026-04').assemblies.find((x) => x.cycle === '2026-04');
  assert.equal(a.blob, gitBlobSha(Buffer.from(pendingReport())));
});

test('audit C4: .gitattributes keeps the record, the fixtures and the vectors LF', () => {
  const attrs = read(path.resolve(__dirname, '..', '..'), '.gitattributes');
  for (const line of ['federation/** text eol=lf', 'tools/test/fixtures/** text eol=lf', 'icp/test/vectors.json text eol=lf']) {
    assert.ok(attrs.split('\n').includes(line), line);
  }
});

// ---------------------------------------------------------------------------
// DAF-C6: draft skips withdrawn claims and marks what a person must check.
// ---------------------------------------------------------------------------

const claim = (n, login, state, stateReason, holder) => ({
  number: n, state, state_reason: stateReason, title: '[Claim] x', user: { login },
  body: ['### Claimed as', '', holder, '', '### Record', '', '_No response_', '', '### What was delivered', '', 'Something', '',
    '### Declared in', '', '#41', '', '### The result', '', 'https://github.com/example-org/example-repo/pull/9', '',
    '### What is being claimed', '', 'One function', '', '### If a module, the functions in it', '', '_No response_', '', '### Cycle', '', '2026-04'].join('\n')
});

test('audit C6: draft skips a claim closed as not planned and marks a claim filed outside speaks_for', () => {
  const dir = tmpCopy('basic');
  const issues = path.join(dir, 'i.json');
  fs.writeFileSync(issues, JSON.stringify([
    { number: 130, state: 'open', title: '[Cycle] Assembly ', body: '### Cycle\n\n2026-04\n\n### Window opens\n\n2026-04-06\n\n### Window closes\n\n2026-04-13\n' },
    claim(140, 'stranger-gh', 'open', null, 'example-delta'),
    claim(141, 'example-river-gh', 'closed', 'not_planned', 'example-river'),
    claim(142, 'example-cedar-gh', 'closed', 'completed', 'example-cedar'),
    claim(143, 'Example-Delta-Two-GH', 'open', null, 'example-delta')
  ]));
  const r = run(['draft', '2026-04', '--root', dir, '--issues', issues]);
  assert.equal(r.code, 0, r.err);
  // Before the fix: "2 deliveries", both drafted as ordinary rows with no marker.
  assert.match(r.out, /3 deliveries/);
  assert.match(r.out, /not drafted: #141 was closed as not planned/);
  const md = read(dir, 'federation/assemblies/2026-04.md');
  assert.match(md, /^<!-- Rows drafted from claims: #140 Deliveries row 1 \(`example-delta`\); #142 Deliveries row 2 \(`example-cedar`\); #143 Deliveries row 3 \(`example-delta`\)\. -->\n/);
  assert.match(md, /\n<!-- not drafted: #141 was closed as not planned -->\n/);
  assert.doesNotMatch(md, /\| `example-river` \|/);
  assert.match(md, /\n<!-- TODO\(person\): claim #140 was filed by `stranger-gh`, which is not in speaks_for of `example-delta`; check in its thread that `example-delta` stands behind it\. -->\n/);
  assert.doesNotMatch(md, /claim #143 was filed by/, 'speaks_for is compared without case');
  assert.match(md, /\n<!-- TODO\(person\): claim #142 is closed \(completed\); check in its thread that the claim still stands before keeping its row\. -->\n/);
  assert.doesNotMatch(md, /claim #140 is closed/);
  const check = run(['check', '--root', dir, '--allow-pending', '--allow-undetermined']);
  assert.equal(check.code, 0, check.err);
  assert.match(check.err, /2026-04\.md: TODO\(person\) markers left/);
});
