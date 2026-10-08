'use strict';
// Shared helpers for the test suites. Fixtures are fictional federations.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { main } = require('../daf');

const ROOT = path.resolve(__dirname, '..', '..');
const FIX = path.join(__dirname, 'fixtures');

const made = [];
process.on('exit', () => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

/** Copy a fixture into a fresh temporary directory, with the real templates. */
function tmpCopy(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daf-test-'));
  made.push(dir);
  if (name) fs.cpSync(path.join(FIX, name), dir, { recursive: true });
  for (const sub of ['units', 'assemblies', 'requests']) {
    fs.mkdirSync(path.join(dir, 'federation', sub), { recursive: true });
    for (const f of fs.readdirSync(path.join(ROOT, 'federation', sub)).filter((n) => /^TEMPLATE\./.test(n))) {
      fs.copyFileSync(path.join(ROOT, 'federation', sub, f), path.join(dir, 'federation', sub, f));
    }
  }
  return dir;
}

/** Run the CLI in-process and capture its output. */
function run(argv) {
  const out = [];
  const err = [];
  const code = main(argv, {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    write: (s) => out.push(s.replace(/\n$/, ''))
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };

/** An issue comment as the GitHub API returns it (fields the tally reads). */
function comment(id, login, created, body, updated) {
  return { id, user: { login, id: 1000 + id, type: 'User' }, created_at: created, updated_at: updated || created, body };
}
const vote = (choice, as) => 'Discussion first.\n\nVOTE: ' + choice + '\nAS: `' + as + '`\n';

/** A pending report for cycle 2026-04 of the basic fixture. */
function pendingReport(opts) {
  opts = opts || {};
  const window = opts.noWindow ? '' : '**Window:** opens 2026-04-01, closes 2026-04-08 (seven days). **Cycle issue:** #110\n';
  const cycle = opts.cycle || '2026-04';
  return `# Assembly ${cycle}

${window}
## Where the federation is

Fictional pending assembly.

## Deliveries

| Holder | Function | Declared in | Delivered | Points |
| --- | --- | --- | --- | --- |
| \`example-river\` | A fictional delivery under vote | #41 | https://github.com/example-org/example-repo/pull/10 | 1 |

**Module completions**

| Holder | Module | Functions in it | Bonus |
| --- | --- | --- | --- |

## Penalties

| Holder | Commitment | What happened | Points removed |
| --- | --- | --- | --- |

## New records

| Holder | Kind | First delivery |
| --- | --- | --- |
${opts.newRecord ? '| `' + opts.newRecord + '` | participant | https://github.com/example-org/example-repo/pull/10 |\n' : ''}
## Resource decisions

| Request | Asked | Decision | Why |
| --- | --- | --- | --- |

## The vote

Weight from the ledger as it stood at the previous assembly.

| | |
| --- | --- |
| Active points | n |
| Votes cast | n |
| Participation | n% (quorum 30%) |
| For / against / abstain | n / n / n |
| **Outcome** | **passed / failed** |

A proposal that fails for lack of participation is recorded as exactly that.

**Votes**

| Holder | Vote | Weight |
| --- | --- | --- |

## Steward intervention

None.

## What the federation would change about itself

Fictional.
`;
}

module.exports = { ROOT, FIX, tmpCopy, run, read, write, comment, vote, pendingReport };
