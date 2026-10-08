'use strict';
/**
 * render — LEDGER.md and the tally markdown. Every user-controlled string goes
 * through `code()`: inline code, no line breaks, no '<', '@' defused, capped.
 */

/** Inline code for a user-controlled string. Never a link. */
function code(s, max) {
  max = max || 80;
  let t = String(s == null ? '' : s).replace(/[\r\n]/g, '').replace(/</g, '').replace(/`/g, "'").replace(/\|/g, '/');
  t = t.replace(/@/g, '@​');
  if (t.length > max) t = t.slice(0, max);
  return '`' + t + '`';
}

const LEDGER_HEAD = [
  '# Ledger',
  '',
  'Current standing, summed from the assemblies in [`assemblies/`](./assemblies). Those are the source of truth. If this file disagrees with them, this file is wrong.',
  ''
];

const LEDGER_READING = [
  '## Reading this',
  '',
  '**Points** are delivered functions and completed modules, never bought and never transferred. They do not decay ([DAF-000 §3.3](../dafp/daf-000-federation-constitution.md#33-decay-and-dilution)). A share falls only because other people deliver.',
  '',
  '**Active** means the holder voted or delivered in one of the last three assemblies. Dormant holders keep every point and leave the quorum denominator, so an abandoned unit cannot freeze the federation ([DAF-000 §3.4](../dafp/daf-000-federation-constitution.md#34-points-and-voting-weight)). Voting or delivering makes a holder active again, with no readmission procedure.',
  '',
  '**Weight in a vote** comes from this ledger as it stood at the *previous* assembly, so the awards under vote cannot change the votes that approve them.',
  ''
];

/** LEDGER.md for a fold. Byte-identical to the original file when nothing was held. */
function renderLedger(fold, params) {
  const out = LEDGER_HEAD.slice();
  const held = fold.totals.assemblies;
  out.push(held ? '**As of:** assembly ' + fold.asOf + '.' : '**As of:** no assembly held.');
  out.push('');
  out.push('| Holder | Kind | Points | Active | Joined |');
  out.push('| --- | --- | --- | --- | --- |');
  if (!fold.holders.length) out.push('| — | — | — | — | — |');
  for (const h of fold.holders) {
    out.push('| `' + h.id + '` | ' + (h.kind || '—') + ' | ' + h.points + ' | ' + (h.active ? 'yes' : 'no') + ' | ' + (h.joined || '—') + ' |');
  }
  out.push('');
  out.push('| | |');
  out.push('| --- | --- |');
  out.push('| Units and participants | ' + fold.totals.holders + ' |');
  out.push('| Points issued | ' + fold.totals.points + ' |');
  const total = params && params.quorum_base === 'total';
  out.push('| Active points' + (total ? '' : ' (quorum denominator)') + ' | ' + fold.totals.activePoints + ' |');
  out.push('| Assemblies held | ' + held + ' |');
  out.push('');
  out.push(...LEDGER_READING);
  out.push('## State');
  out.push('');
  if (!held) {
    out.push('No unit is recorded and no points have been issued. The first assembly that accepts a record and a delivery writes the first row.');
  } else {
    out.push(held + ' ' + (held === 1 ? 'assembly' : 'assemblies') + ' held. The assemblies in [`assemblies/`](./assemblies) are the record; this file is generated from them by `node tools/daf.js ledger --write`.');
  }
  return out.join('\n') + '\n';
}

/** Participation as a percentage, truncated (never rounded up past the floor). */
function pct(num, den) {
  if (!den) return null;
  const tenths = Math.floor((num * 1000) / den);
  return (tenths % 10 === 0 ? String(tenths / 10) : (tenths / 10).toFixed(1)) + '%';
}

/** The "## The vote" summary table lines for a tally result. */
function voteSummaryLines(t) {
  const label = t.baseKind === 'total' ? 'Total points' : 'Active points';
  const p = t.outcome === 'undetermined' || t.participation === null ? '—' : pct(t.cast, t.base);
  return [
    '| | |',
    '| --- | --- |',
    '| ' + label + ' | ' + t.base + ' |',
    '| Votes cast | ' + t.cast + ' |',
    '| Participation | ' + p + ' (quorum ' + t.quorumPercent + '%) |',
    '| For / against / abstain | ' + t.for + ' / ' + t.against + ' / ' + t.abstain + ' |',
    '| **Outcome** | **' + t.outcome + '** |'
  ];
}

/** The "**Votes**" table lines (Holder | Vote | Weight [| Share]). */
function votesTableLines(t, withShare) {
  const out = withShare
    ? ['| Holder | Vote | Weight | Share |', '| --- | --- | --- | --- |']
    : ['| Holder | Vote | Weight |', '| --- | --- | --- |'];
  for (const v of t.votes) {
    const row = '| `' + v.holder + '` | ' + v.vote + ' | ' + v.weight + ' |';
    out.push(withShare ? row + ' ' + (t.base > 0 && t.outcome !== 'undetermined' ? pct(v.weight, t.base) : '—') + ' |' : row);
  }
  return out;
}

/** The markdown block printed by `daf.js tally` and `tools/tally.js`. */
function renderTally(t) {
  const out = ['## The vote', '', 'Weight from the ledger as it stood at the previous assembly.', ''];
  out.push(...voteSummaryLines(t));
  out.push('');
  for (const s of t.sentences) { out.push(s); out.push(''); }
  out.push('**Votes**');
  out.push('');
  out.push(...votesTableLines(t, true));
  out.push('');
  for (const s of t.concentration) { out.push(s); out.push(''); }
  if (t.notCounted.length) {
    out.push('**Not counted**');
    out.push('');
    for (const n of t.notCounted) {
      out.push('- ' + code(n.holder || '(no holder)') + ' by ' + code(n.login || '(unknown account)') + ', ' + code(n.vote || '?') + ': ' + n.reason);
    }
    out.push('');
  }
  let prov = 'Computed from ' + t.commentsCount + ' ' + (t.commentsCount === 1 ? 'comment' : 'comments');
  if (t.pr) prov += ' on PR #' + String(t.pr).replace(/[^0-9]/g, '');
  if (t.head) prov += ' at head ' + String(t.head).replace(/[^0-9a-f]/gi, '').slice(0, 7);
  prov += t.window ? ', window from ' + t.window.opens + ' 00:00 to ' + t.window.closes + ' 00:00 UTC (a vote at or after the close is not counted)' : ', no window in the report';
  prov += ', weights from the assemblies before ' + t.cycle + '.';
  out.push(prov);
  out.push('');
  out.push('This computes the arithmetic only. The vote table in the report is written and merged by a person.');
  return out.join('\n') + '\n';
}

module.exports = { code, renderLedger, renderTally, voteSummaryLines, votesTableLines, pct };
