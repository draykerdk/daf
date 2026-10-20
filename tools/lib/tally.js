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
 *
 * The window is window_days x 24 h: it opens at <opens>T00:00:00Z and closes at
 * <closes>T00:00:00Z. A vote posted or edited at or after that instant is after
 * the close.
 *
 * The base of the quorum (quorum_base: active) is the active points before the
 * cycle plus the points of every dormant holder whose vote is counted: DAF-000
 * §3.4 says a dormant holder becomes active again by voting. Every counted
 * weight is therefore inside the base, and participation never exceeds 100%.
 *
 * The founding assembly (DAF-001 §4) is the one before which no assembly has
 * passed. In it, each participant with a delivery in the report counts once:
 * the voters are the holders of a Deliveries row whose kind is participant,
 * each weighs 1, and the base is their number. Their records arrive with the
 * report, so the accounts that may speak for them come from the records the
 * pull request adds (foundingUnits) when the default branch has none.
 */

const { foldLedger } = require('./ledger');

const VOTE_RE = /^\s*VOTE:\s*(for|against|abstain)\s*$/im;
const AS_RE = /^\s*AS:\s*`?([a-z0-9-]+)`?\s*$/im;

const FOUNDING = 'No assembly has passed before this one, so it is the founding assembly: each participant with a delivery in this report counts once (DAF-001 §4).';
const FOUNDING_EMPTY = 'No participant has a delivery in this founding assembly, so no participation can be computed; the outcome cannot be computed.';
/** The sentence for founding voters whose record this count could not read. */
const foundingUnread = (ids) => 'The record of ' + ids.map((id) => '`' + id + '`').join(', ') + ' is not in this count. In the founding assembly the accounts that may vote for a new participant come from the record the pull request adds (--founding-units); the outcome cannot be computed.';
/** The line a tally prints while the window is still open. */
const PROVISIONAL = 'The window is still open: this count is provisional.';
const NO_BASE = 'No points counted toward the quorum base before this assembly. DAF-000 and DAF-001 do not specify how participation is computed against a base of zero; the outcome cannot be computed.';
const BELOW_ZERO = 'DAF-000 §7 says a sanctioned holder loses its accumulated points; points below zero are not specified';

/**
 * True when no assembly before `cycle` has passed: the founding assembly of
 * DAF-001 §4. A founding assembly that fails is followed by another.
 */
const isFounding = (record, cycle) => !record.assemblies.some((a) => a.cycle < cycle && a.vote && a.vote.outcome === 'passed');

/**
 * The participants who vote in a founding assembly: each holder of a
 * Deliveries row of `report` whose kind is participant, as its New records row
 * says or, failing that, as `unitOf(id)` says. A Set of ids.
 */
function foundingVoters(report, unitOf) {
  const kinds = new Map((report.newRecords || []).map((r) => [r.holder, r.kind]));
  const out = new Set();
  for (const d of report.deliveries || []) {
    const u = kinds.has(d.holder) ? null : unitOf(d.holder);
    const kind = kinds.has(d.holder) ? kinds.get(d.holder) : (u ? u.kind : null);
    if (kind === 'participant') out.add(d.holder);
  }
  return out;
}

/** Holders of the fold below zero points. */
const belowZero = (prior) => prior.holders.filter((h) => h.points < 0);

/**
 * The quorum base for a vote: the total points (quorum_base: total), or the
 * active points plus the points of each dormant holder among `voters` (ids of
 * the holders whose vote is counted).
 */
function voteBase(prior, params, voters) {
  if (params.quorum_base === 'total') return prior.totals.points;
  const byId = new Map(prior.holders.map((h) => [h.id, h]));
  let base = prior.totals.activePoints;
  for (const id of new Set(voters)) {
    const h = byId.get(id);
    if (h && !h.active && h.points > 0) base += h.points;
  }
  return base;
}

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
 * masterRecord, pr, head, now }) -> result object (see renderTally).
 *
 * With masterRecord, speaks_for is read from its unit records only. In the
 * founding assembly, a voter with no record there is read from foundingUnits
 * (a Map id -> unit, default the record's own units): the records the pull
 * request adds. `now` (milliseconds, default the current time) marks the
 * result provisional while it is before the close of the window.
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
  const founding = isFounding(record, cycle);
  const negative = founding ? [] : belowZero(prior);
  const window = report.window;
  const opens = window ? Date.parse(window.opens + 'T00:00:00Z') : null;
  const closes = window ? Date.parse(window.closes + 'T00:00:00Z') : null;
  const now = input.now == null ? Date.now() : input.now;
  if (typeof now !== 'number' || isNaN(now)) throw new Error('now must be a time in milliseconds');

  // Who may speak for a holder: from the default branch's unit records when
  // they are given, so a pull request cannot add an account to speaks_for. The
  // one exception is a founding participant with no record there: its record
  // is the one the pull request adds (DAF-001 §4, DAF-002 §5).
  const established = (id) => (input.masterRecord ? input.masterRecord.units.get(id) : record.units.get(id)) || null;
  const foundingUnits = input.foundingUnits || record.units;
  const unitOf = (id) => established(id) || (founding ? foundingUnits.get(id) || null : null);
  const speakers = (id) => { const u = unitOf(id); return u ? u.logins : null; };
  const eligible = founding ? foundingVoters(report, unitOf) : null;
  const unread = founding ? [...eligible].filter((id) => !unitOf(id)).sort() : [];
  // Whether the pull request carries a record for a holder: its report lists
  // the holder under New records, or, read beside the default branch's record,
  // its own record has the unit file.
  const inPullRequest = (id) => (report.newRecords || []).some((r) => r.holder === id)
    || (!!input.masterRecord && record.units.has(id));

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
    if (founding) {
      if (!eligible.has(v.holder)) return reject('`' + v.holder + '` is not a participant with a delivery in this founding assembly; only those vote in it, once each (DAF-001 §4)');
    } else if (!h || h.points <= 0) return reject('`' + v.holder + '` has no weight in the ledger before ' + cycle);
    const logins = speakers(v.holder);
    if (!logins) {
      // A record that is only in the pull request (the report's New records, or
      // a unit file beside it) does not speak yet: the founding case and every
      // first delivery. The reason says so; what is counted does not change.
      return reject(inPullRequest(v.holder)
        ? 'the record of `' + v.holder + '` is not on master yet; a holder exists from the assembly that accepts its record'
        : 'no unit record for `' + v.holder + '`');
    }
    if (!who || !logins.includes(who.toLowerCase())) return reject('the author is not listed in speaks_for of `' + v.holder + '`');
    const created = ts(c.created_at);
    const updated = ts(c.updated_at);
    if (created === null) return reject('the comment has no valid created_at');
    if (created < opens) return reject('posted before the window opened');
    if (created >= closes) return reject('posted after the window closed');
    if (updated !== null && c.updated_at !== c.created_at && updated >= closes) return reject('edited after the window closed');
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

  // Weights are the holders' points as folded, the same values as the ledger
  // and the base. Below zero is not specified and leaves the outcome open.
  const counted = [...lastBy.values()];
  const base = founding ? eligible.size : voteBase(prior, params, counted.map((e) => e.holder));
  const votes = counted.map((e) => {
    const h = weights.get(e.holder);
    const weight = founding ? 1 : (h ? h.points : 0);
    return { holder: e.holder, vote: e.vote, weight, share: base > 0 ? weight / base : null, login: e.login, id: e.id, created_at: e.created_at };
  });
  votes.sort((a, b) => b.weight - a.weight || (a.holder < b.holder ? -1 : a.holder > b.holder ? 1 : 0));

  const sum = (k) => votes.filter((v) => v.vote === k).reduce((s, v) => s + v.weight, 0);
  const t = {
    cycle, pr: input.pr || null, head: input.head || null, window,
    founding, eligible: founding ? [...eligible].sort() : null,
    baseKind, base, quorumPercent: params.quorum_percent,
    for: sum('for'), against: sum('against'), abstain: sum('abstain'), cast: 0,
    participation: null, quorumMet: null, majority: null, outcome: null,
    sentences: [], concentration: [], votes, notCounted,
    commentsCount: comments.length + reviews.length + reviewComments.length,
    provisional: closes !== null && !isNaN(closes) && now < closes,
    prior
  };
  t.cast = t.for + t.against + t.abstain;

  if (founding) t.sentences.push(FOUNDING);
  if (founding && !eligible.size) {
    t.outcome = 'undetermined';
    t.sentences.push(FOUNDING_EMPTY);
  } else if (unread.length) {
    t.outcome = 'undetermined';
    t.sentences.push(foundingUnread(unread));
  } else if (negative.length) {
    t.outcome = 'undetermined';
    t.sentences.push(negative.map((h) => '`' + h.id + '` held ' + h.points + ' points').join(', ') + ' before this assembly. ' + BELOW_ZERO + '; the outcome cannot be computed.');
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
    // Alone reaches the quorum: the holder's weight against the floor of the
    // base. Alone reaches the majority: more than half of the votes cast.
    // In the founding assembly every weight is 1, and the lines still say it.
    for (const v of votes) {
      const q = v.weight > 0 && v.weight * 100 >= params.quorum_percent * base;
      const m = v.weight > 0 && v.weight * 2 > t.cast;
      if (q && m) t.concentration.push('`' + v.holder + '`: one holder alone reaches the quorum and the majority (DAF-000 §5.4).');
      else if (q) t.concentration.push('`' + v.holder + '`: one holder alone reaches the quorum (DAF-000 §5.4).');
      else if (m) t.concentration.push('`' + v.holder + '`: one holder alone reaches the majority (DAF-000 §5.4).');
    }
  }
  return t;
}

module.exports = { computeTally, flattenPages, readVote, voteBase, belowZero, isFounding, foundingVoters, foundingUnread, FOUNDING, FOUNDING_EMPTY, NO_BASE, PROVISIONAL, BELOW_ZERO, VOTE_RE, AS_RE };
