'use strict';
/**
 * tally — the vote arithmetic of DAF-001 §4 and DAF-000 §5.3. Pure: the inputs
 * are a parsed record and parsed comment JSON; nothing is fetched here.
 *
 * A vote is a comment with the lines
 *
 *     VOTE: for | against | abstain
 *     AS: <unit-id or participant-id>
 *
 * A holder's LAST valid vote by created_at counts. Weight comes from the fold of
 * the assemblies before the cycle under vote.
 */

const { foldLedger } = require('./ledger');

const VOTE_RE = /^\s*VOTE:\s*(for|against|abstain)\s*$/im;
const AS_RE = /^\s*AS:\s*`?([a-z0-9-]+)`?\s*$/im;

const FOUNDING = 'No holder had weight before this assembly. DAF-000 and DAF-001 do not specify how the founding assembly is decided; the outcome cannot be computed.';
const NO_BASE = 'No points counted toward the quorum base before this assembly. DAF-000 and DAF-001 do not specify how participation is computed against a base of zero; the outcome cannot be computed.';

/** Flatten `gh api --paginate --slurp` output (array of pages) or a flat array. */
function flattenPages(data) {
  if (!Array.isArray(data)) throw new Error('expected a JSON array of comments, or an array of pages');
  const out = [];
  for (const x of data) {
    if (Array.isArray(x)) out.push(...x);
    else out.push(x);
  }
  return out;
}

/** Read a vote from a comment body, or null. */
function readVote(body) {
  const v = VOTE_RE.exec(body || '');
  const a = AS_RE.exec(body || '');
  if (!v || !a) return null;
  return { vote: v[1].toLowerCase(), holder: a[1].toLowerCase() };
}

const ts = (s) => { const t = Date.parse(s); return isNaN(t) ? null : t; };

/**
 * computeTally({ record, cycle, comments, reviews, reviewComments, params,
 * masterRecord, pr, head }) -> result object (see renderTally).
 */
function computeTally(input) {
  const record = input.record;
  const params = input.params || record.parameters;
  if (!params) throw new Error('the record has no valid parameters');
  const cycle = input.cycle;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(cycle || ''))) throw new Error('cycle must be YYYY-MM');
  const report = record.assemblies.find((a) => a.cycle === cycle);
  if (!report) throw new Error('no report for cycle ' + cycle + ' in federation/assemblies/');

  const prior = foldLedger(record, { before: cycle, params });
  const weights = new Map(prior.holders.map((h) => [h.id, h]));
  const baseKind = params.quorum_base === 'total' ? 'total' : 'active';
  const base = baseKind === 'total' ? prior.totals.points : prior.totals.activePoints;
  const founding = !prior.holders.some((h) => h.points > 0);
  const window = report.window;
  const opens = window ? Date.parse(window.opens + 'T00:00:00Z') : null;
  const closes = window ? Date.parse(window.closes + 'T23:59:59Z') : null;

  const speakers = (id) => {
    const u = record.units.get(id) || (input.masterRecord && input.masterRecord.units.get(id));
    return u ? u.logins : null;
  };

  const comments = flattenPages(input.comments || []);
  const reviews = flattenPages(input.reviews || []);
  const reviewComments = flattenPages(input.reviewComments || []);

  const notCounted = [];
  const candidates = [];
  const login = (c) => (c && c.user && typeof c.user.login === 'string' ? c.user.login : null);

  const listed = (c, reason) => {
    const v = readVote(c.body);
    if (v) notCounted.push({ holder: v.holder, vote: v.vote, login: login(c), id: c.id == null ? null : c.id, created_at: c.created_at || c.submitted_at || null, reason });
  };
  reviews.forEach((c) => listed(c, 'posted as a review body; votes are issue comments on the pull request'));
  reviewComments.forEach((c) => listed(c, 'posted as a line comment on the diff; votes are issue comments on the pull request'));

  comments.forEach((c, index) => {
    const v = readVote(c.body);
    if (!v) return;
    const who = login(c);
    const entry = { holder: v.holder, vote: v.vote, login: who, id: c.id == null ? null : c.id, created_at: c.created_at || null, index };
    const reject = (reason) => notCounted.push(Object.assign({}, entry, { reason }));
    if (!window) return reject('not counted: no window in the report');
    const h = weights.get(v.holder);
    if (!founding && (!h || h.points <= 0)) return reject('`' + v.holder + '` has no weight in the ledger before ' + cycle);
    const logins = speakers(v.holder);
    if (!logins) return reject('no unit record for `' + v.holder + '`');
    if (!who || !logins.includes(who.toLowerCase())) return reject('the author is not listed in speaks_for of `' + v.holder + '`');
    const created = ts(c.created_at);
    const updated = ts(c.updated_at);
    if (created === null) return reject('the comment has no valid created_at');
    if (created < opens) return reject('posted before the window opened');
    if (created > closes) return reject('posted after the window closed');
    if (updated !== null && c.updated_at !== c.created_at && updated > closes) return reject('edited after the window closed');
    entry.createdTs = created;
    candidates.push(entry);
  });

  // The last valid vote per holder counts; earlier ones are listed as superseded.
  const lastBy = new Map();
  for (const e of candidates) {
    const cur = lastBy.get(e.holder);
    if (!cur || e.createdTs > cur.createdTs || (e.createdTs === cur.createdTs && e.index > cur.index)) lastBy.set(e.holder, e);
  }
  for (const e of candidates) {
    if (lastBy.get(e.holder) !== e) notCounted.push({ holder: e.holder, vote: e.vote, login: e.login, id: e.id, created_at: e.created_at, reason: 'superseded by a later vote for the same holder' });
  }

  const votes = [...lastBy.values()].map((e) => {
    const h = weights.get(e.holder);
    const weight = h ? Math.max(0, h.points) : 0;
    return { holder: e.holder, vote: e.vote, weight, share: base ? weight / base : null, login: e.login, id: e.id, created_at: e.created_at };
  });
  votes.sort((a, b) => b.weight - a.weight || (a.holder < b.holder ? -1 : a.holder > b.holder ? 1 : 0));

  const sum = (k) => votes.filter((v) => v.vote === k).reduce((s, v) => s + v.weight, 0);
  const t = {
    cycle, pr: input.pr || null, head: input.head || null, window,
    baseKind, base, quorumPercent: params.quorum_percent,
    for: sum('for'), against: sum('against'), abstain: sum('abstain'), cast: 0,
    participation: null, quorumMet: null, majority: null, outcome: null,
    sentences: [], concentration: [], votes, notCounted,
    commentsCount: comments.length + reviews.length + reviewComments.length,
    prior
  };
  t.cast = t.for + t.against + t.abstain;

  if (founding) {
    t.outcome = 'undetermined';
    t.sentences.push(FOUNDING);
  } else if (base <= 0) {
    t.outcome = 'undetermined';
    t.sentences.push(NO_BASE);
  } else {
    t.participation = t.cast / base;
    t.quorumMet = t.cast * 100 >= params.quorum_percent * base;
    t.majority = t.for * 2 > t.cast;
    t.outcome = t.quorumMet && t.majority ? 'passed' : 'failed';
    if (!t.quorumMet) t.sentences.push('Failed for lack of participation: below the ' + params.quorum_percent + '% floor nothing passes, whatever the split.');
    else if (!t.majority) t.sentences.push('Failed: the votes for are not more than half of the votes cast.');
    for (const v of votes) {
      const q = v.weight > 0 && v.weight * 100 >= params.quorum_percent * base;
      const m = v.weight * 2 > base;
      if (q && m) t.concentration.push('`' + v.holder + '`: one holder alone reaches the quorum and the majority (DAF-000 §5.4).');
      else if (q) t.concentration.push('`' + v.holder + '`: one holder alone reaches the quorum (DAF-000 §5.4).');
      else if (m) t.concentration.push('`' + v.holder + '`: one holder alone reaches the majority (DAF-000 §5.4).');
    }
  }
  return t;
}

module.exports = { computeTally, flattenPages, readVote, FOUNDING, NO_BASE, VOTE_RE, AS_RE };
