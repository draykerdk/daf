#!/usr/bin/env node
/**
 * tally.js — count the votes on an assembly pull request.
 *
 * A vote is a single comment in the format DAF-001 §4 fixes:
 *
 *     VOTE: for | against | abstain
 *     AS: <unit-id or participant-id>
 *
 * Anything else in the comment is discussion. A holder's LAST comment of this form
 * is the one that counts, so a vote can be changed by voting again before the window
 * closes. Weight comes from the ledger as it stood at the PREVIOUS assembly, so the
 * awards under vote cannot change the votes that approve them — which is why this
 * script reads the ledger from a git ref, not from the working tree.
 *
 * The tally is still merged by a person, and the pull request is still argued by
 * people. This only removes the arithmetic.
 *
 * Usage:
 *   node tools/tally.js <pr-number> [--ledger-ref <git-ref>]
 *
 * Requires: the GitHub CLI (`gh`), authenticated, and `git`. No dependencies.
 */

const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const pr = args[0];
if (!pr || /^-/.test(pr)) {
  console.error('usage: node tools/tally.js <pr-number> [--ledger-ref <git-ref>]');
  process.exit(1);
}
const refIdx = args.indexOf('--ledger-ref');
const ledgerRef = refIdx >= 0 ? args[refIdx + 1] : 'HEAD';

const sh = (cmd, list) => execFileSync(cmd, list, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

// ---- the ledger: holder -> { points, active } -------------------------------
// LEDGER.md is a convenience file summed from the assemblies. If it ever disagrees
// with them, the assemblies are right — check before trusting a surprising tally.
function readLedger(ref) {
  let md;
  try {
    md = sh('git', ['show', ref + ':federation/LEDGER.md']);
  } catch (e) {
    console.error('could not read federation/LEDGER.md at ' + ref);
    process.exit(1);
  }
  const holders = new Map();
  md.split('\n').forEach((line) => {
    const cells = line.split('|').map((c) => c.trim());
    // | Holder | Kind | Points | Active | Joined |
    if (cells.length < 7) return;
    const id = cells[1].replace(/`/g, '');
    const pts = parseInt(cells[3], 10);
    if (!id || id === '—' || /^holder$/i.test(id) || /^-+$/.test(id) || isNaN(pts)) return;
    holders.set(id, { points: pts, active: /^(yes|active|true)$/i.test(cells[4]) });
  });
  return holders;
}

// ---- the comments -----------------------------------------------------------
function readVotes(number) {
  const raw = sh('gh', ['api', '--paginate', 'repos/{owner}/{repo}/issues/' + number + '/comments',
    '--jq', '.[] | {user: .user.login, at: .created_at, body: .body}']);
  const last = new Map(); // holder -> { choice, user, at }
  raw.split('\n').filter(Boolean).forEach((line) => {
    let c;
    try { c = JSON.parse(line); } catch (e) { return; }
    const vote = /^\s*VOTE:\s*(for|against|abstain)\s*$/im.exec(c.body || '');
    const as = /^\s*AS:\s*`?([a-z0-9-]+)`?\s*$/im.exec(c.body || '');
    if (!vote || !as) return;
    last.set(as[1], { choice: vote[1].toLowerCase(), user: c.user, at: c.at });
  });
  return last;
}

const ledger = readLedger(ledgerRef);
const votes = readVotes(pr);

let activePoints = 0;
ledger.forEach((h) => { if (h.active) activePoints += h.points; });

const rows = [];
let cast = 0, yes = 0, no = 0, abstain = 0;
const unknown = [];

votes.forEach((v, id) => {
  const h = ledger.get(id);
  if (!h) { unknown.push(id + ' (' + v.user + ')'); return; }
  const w = h.points;
  rows.push({ id: id, choice: v.choice, weight: w, user: v.user });
  cast += w;
  if (v.choice === 'for') yes += w;
  else if (v.choice === 'against') no += w;
  else abstain += w;
});

rows.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));

const participation = activePoints > 0 ? (cast / activePoints) * 100 : 0;
const quorum = participation >= 30;
const majority = cast > 0 && yes * 2 > cast;
const passed = quorum && majority;

const pct = participation.toFixed(0) + '%';

console.log('## The vote');
console.log('');
console.log('Weight from the ledger at `' + ledgerRef + '`.');
console.log('');
console.log('| | |');
console.log('| --- | --- |');
console.log('| Active points | ' + activePoints + ' |');
console.log('| Votes cast | ' + cast + ' |');
console.log('| Participation | ' + pct + ' (quorum 30%) |');
console.log('| For / against / abstain | ' + yes + ' / ' + no + ' / ' + abstain + ' |');
console.log('| **Outcome** | **' + (passed ? 'passed' : 'failed') + '** |');
console.log('');
if (!quorum) {
  console.log('Failed for lack of participation: below the 30% floor nothing passes, whatever the split.');
  console.log('');
}
console.log('**Votes**');
console.log('');
console.log('| Holder | Vote | Weight |');
console.log('| --- | --- | --- |');
rows.forEach((r) => console.log('| `' + r.id + '` | ' + r.choice + ' | ' + r.weight + ' |'));

if (unknown.length) {
  console.log('');
  console.log('> Not counted — no record in the ledger at this ref: ' + unknown.join(', ') + '.');
  console.log('> A holder exists in the federation from the assembly that accepts its record.');
}
