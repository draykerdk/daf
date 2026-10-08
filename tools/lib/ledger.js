'use strict';
/**
 * ledger — fold the assemblies into the standing of each holder.
 *
 * Only a `passed` assembly applies deliveries, module bonuses, penalties and new
 * records. A `failed` assembly applies nothing to points but still counts as
 * held: its voters are active. A `pending` assembly (a report still under vote)
 * is not folded at all.
 */

const FOLDED = new Set(['passed', 'failed']);

/** Holders sorted by points desc, then id. */
const byStanding = (a, b) => b.points - a.points || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Activity: a holder is active if, in any of the last `window` folded
 * assemblies, it voted, or delivered in a passed one. `perAssembly` is a list of
 * Sets of active ids, one per folded assembly, in order.
 */
function activeSet(perAssembly, window) {
  const out = new Set();
  for (const s of perAssembly.slice(Math.max(0, perAssembly.length - window))) for (const id of s) out.add(id);
  return out;
}

function finish(holders, perAssembly, params, lastCycle) {
  const active = activeSet(perAssembly, params.dormant_after_assemblies);
  const list = [...holders.values()].map((h) => ({ id: h.id, kind: h.kind, points: h.points, active: active.has(h.id), joined: h.joined }));
  list.sort(byStanding);
  const totals = {
    holders: list.length,
    points: list.reduce((s, h) => s + h.points, 0),
    activePoints: list.filter((h) => h.active).reduce((s, h) => s + h.points, 0),
    assemblies: perAssembly.length
  };
  return { asOf: lastCycle, holders: list, totals };
}

/**
 * foldLedger(record, { before, params }) -> { asOf, holders, totals }.
 * `before` (YYYY-MM) stops the fold before that cycle.
 */
function foldLedger(record, opts) {
  opts = opts || {};
  const params = opts.params || record.parameters;
  if (!params) throw new Error('foldLedger needs parameters');
  const before = opts.before || null;
  const holders = new Map();
  const perAssembly = [];
  let last = null;
  const holder = (id) => {
    if (!holders.has(id)) {
      const u = record.units && record.units.get(id);
      holders.set(id, { id, kind: u ? u.kind : null, points: 0, joined: null });
    }
    return holders.get(id);
  };
  for (const a of record.assemblies) {
    if (before && a.cycle >= before) break;
    const outcome = a.vote && a.vote.outcome;
    if (!FOLDED.has(outcome)) continue;
    last = a.cycle;
    const act = new Set();
    for (const v of a.votes) act.add(v.holder);
    if (outcome === 'passed') {
      for (const r of a.newRecords) { const h = holder(r.holder); h.joined = a.cycle; h.kind = r.kind; }
      for (const d of a.deliveries) { holder(d.holder).points += d.points || 0; act.add(d.holder); }
      for (const m of a.modules) holder(m.holder).points += m.bonus || 0;
      for (const p of a.penalties) holder(p.holder).points += p.points || 0;
    }
    perAssembly.push(act);
  }
  return finish(holders, perAssembly, params, last);
}

module.exports = { foldLedger, finish, activeSet, byStanding, FOLDED };
