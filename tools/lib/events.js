'use strict';
/**
 * events — the canonical event log, version 1 (`daf-event/1`).
 *
 * The assemblies are the record; this is a deterministic, hash-chained reading
 * of them that another implementation can reproduce byte for byte. Preimage of
 * one event (ASCII, lines joined with \n, final \n):
 *
 *   daf-event/1
 *   seq=<n>
 *   kind=<kind>
 *   cycle=<YYYY-MM>
 *   holder=<id or empty>
 *   points=<0 | -?[1-9][0-9]*>
 *   value=<token or empty>
 *   ref=<repo-relative path>
 *   blob=<40 hex git blob sha1 of the report; empty for unit.recorded and request.decided>
 *   evidence=<count>
 *   evidence=<url>            (count lines)
 *   prev=<64 hex; genesis is 64 zeros>
 *
 * hash = sha256(preimage), lowercase hex. Head = hash of the last event.
 *
 * blob is the git blob sha1 of the assembly report for the kinds read from a
 * report (function.delivered, module.completed, penalty, vote.cast,
 * steward.intervention, assembly.closed): reports are append-only in practice.
 * It is EMPTY for unit.recorded and request.decided, whose ref files (unit
 * records, requests) can change legitimately after acceptance — `joined`, a
 * later `speaks_for` — and must not rewrite every later hash.
 */

const crypto = require('node:crypto');
const { ISSUE_URL } = require('./assembly');
const { finish } = require('./ledger');

const VERSION = 1;
const HEADER = 'daf-event/1';
const ZERO = '0'.repeat(64);
const KINDS = ['unit.recorded', 'function.delivered', 'module.completed', 'penalty', 'request.decided', 'vote.cast', 'steward.intervention', 'assembly.closed'];

/** Normalize a value before hashing: backticks out, U+2212 to '-', #n to an issue URL. */
function norm(v) {
  let s = String(v == null ? '' : v).replace(/`/g, '').replace(/−/g, '-');
  if (/^#\d+$/.test(s)) s = ISSUE_URL + String(parseInt(s.slice(1), 10));
  return s;
}

const PRINTABLE = /^[\x21-\x7e]*$/;

function preimageOf(e) {
  const lines = [HEADER, 'seq=' + e.seq, 'kind=' + e.kind, 'cycle=' + e.cycle, 'holder=' + e.holder,
    'points=' + e.points, 'value=' + e.value, 'ref=' + e.ref, 'blob=' + e.blob, 'evidence=' + e.evidence.length];
  for (const u of e.evidence) lines.push('evidence=' + u);
  lines.push('prev=' + e.prev);
  return lines.join('\n') + '\n';
}

const sha256 = (s) => crypto.createHash('sha256').update(Buffer.from(s, 'ascii')).digest('hex');

/** Check one event's field shapes; returns a message or null. */
function shapeError(e) {
  if (!Number.isInteger(e.seq) || e.seq < 1) return 'seq must be a positive integer';
  if (!KINDS.includes(e.kind)) return 'unknown kind "' + e.kind + '"';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(e.cycle)) return 'cycle must be YYYY-MM';
  if (!Number.isInteger(e.points)) return 'points must be an integer';
  if (!/^[0-9a-f]{40}$|^$/.test(e.blob)) return 'blob must be 40 lowercase hex or empty';
  if (!/^[0-9a-f]{64}$/.test(e.prev)) return 'prev must be 64 lowercase hex';
  for (const [k, v] of [['holder', e.holder], ['value', e.value], ['ref', e.ref], ['blob', e.blob], ['cycle', e.cycle], ['kind', e.kind]]) {
    if (!PRINTABLE.test(v)) return k + ' "' + v + '" is not printable ASCII without spaces';
  }
  if (!e.ref) return 'ref must not be empty';
  for (const u of e.evidence) if (!u || !PRINTABLE.test(u)) return 'evidence "' + u + '" is not printable ASCII without spaces';
  return null;
}

/**
 * deriveEvents(record) -> { version, events, head, count }. Throws, naming the
 * file and row, when a value cannot be hashed.
 */
function deriveEvents(record) {
  const events = [];
  let prev = ZERO;
  const requestsByPath = new Map((record.requests || []).map((r) => [r.path, r]));

  const emit = (where, fields) => {
    const e = {
      seq: events.length + 1,
      kind: fields.kind,
      cycle: fields.cycle,
      holder: norm(fields.holder),
      points: fields.points == null ? 0 : fields.points,
      value: norm(fields.value),
      ref: norm(fields.ref),
      blob: fields.blob || '',
      evidence: (fields.evidence || []).map(norm),
      prev
    };
    if (typeof e.points === 'string') e.points = parseInt(norm(e.points), 10);
    const err = shapeError(e);
    if (err) throw new Error(where + ': cannot derive event ' + e.kind + ': ' + err);
    e.preimage = preimageOf(e);
    e.hash = sha256(e.preimage);
    prev = e.hash;
    events.push(e);
  };

  for (const a of record.assemblies) {
    const outcome = a.vote && a.vote.outcome;
    if (outcome === 'pending') continue;
    if (outcome !== 'passed' && outcome !== 'failed') throw new Error(a.file + ': cannot derive events: the outcome is not passed, failed or pending');
    const ref = a.file;
    const blob = a.blob;
    const cycle = a.cycle;
    const row = (r) => a.file + ' row ' + r.line;
    if (outcome === 'passed') {
      for (const r of a.newRecords) {
        emit(row(r), { kind: 'unit.recorded', cycle, holder: r.holder, points: 0, value: r.kind, ref: 'federation/units/' + r.holder + '.yml', blob: '', evidence: [r.first] });
      }
      for (const r of a.deliveries) emit(row(r), { kind: 'function.delivered', cycle, holder: r.holder, points: r.points, value: '', ref, blob, evidence: [r.declared, r.delivered] });
      for (const r of a.modules) emit(row(r), { kind: 'module.completed', cycle, holder: r.holder, points: r.bonus, value: '', ref, blob, evidence: r.functions });
      for (const r of a.penalties) emit(row(r), { kind: 'penalty', cycle, holder: r.holder, points: r.points, value: '', ref, blob, evidence: r.commitmentRefs });
      for (const r of a.resources) {
        const req = requestsByPath.get(r.request);
        emit(row(r), { kind: 'request.decided', cycle, holder: req && req.from ? req.from : '', points: 0, value: r.decision, ref: 'federation/' + r.request, blob: '', evidence: [] });
      }
    }
    for (const r of a.votes) emit(row(r), { kind: 'vote.cast', cycle, holder: r.holder, points: r.weight, value: r.vote, ref, blob, evidence: [] });
    if (a.steward && !a.steward.none) emit(a.file + ' section Steward intervention', { kind: 'steward.intervention', cycle, holder: '', points: 0, value: '', ref, blob, evidence: a.steward.links });
    emit(a.file, { kind: 'assembly.closed', cycle, holder: '', points: 0, value: outcome, ref, blob, evidence: a.cycleIssue ? [ISSUE_URL + a.cycleIssue] : [] });
  }
  return { version: VERSION, events, head: events.length ? events[events.length - 1].hash : ZERO, count: events.length };
}

/** verifyChain(events) -> { ok, head, problems }. Recomputes every preimage and hash. */
function verifyChain(events) {
  const problems = [];
  let prev = ZERO;
  events.forEach((e, i) => {
    const err = shapeError(e);
    if (err) problems.push('event ' + (i + 1) + ': ' + err);
    if (e.seq !== i + 1) problems.push('event ' + (i + 1) + ': seq is ' + e.seq);
    if (e.prev !== prev) problems.push('event ' + (i + 1) + ': prev does not match the previous hash');
    const pre = preimageOf(e);
    if (e.preimage !== undefined && e.preimage !== pre) problems.push('event ' + (i + 1) + ': preimage does not match the fields');
    const h = sha256(pre);
    if (e.hash !== h) problems.push('event ' + (i + 1) + ': hash does not match the preimage');
    prev = e.hash;
  });
  return { ok: problems.length === 0, head: events.length ? events[events.length - 1].hash : ZERO, problems };
}

/** foldEvents(events, params) -> the same shape as foldLedger. */
function foldEvents(events, params) {
  const holders = new Map();
  const perAssembly = [];
  let act = new Set();
  let last = null;
  const holder = (id) => {
    if (!holders.has(id)) holders.set(id, { id, kind: null, points: 0, joined: null });
    return holders.get(id);
  };
  for (const e of events) {
    switch (e.kind) {
      case 'unit.recorded': { const h = holder(e.holder); h.joined = e.cycle; h.kind = e.value; break; }
      case 'function.delivered': holder(e.holder).points += e.points; act.add(e.holder); break;
      case 'module.completed': holder(e.holder).points += e.points; break;
      case 'penalty': holder(e.holder).points += e.points; break;
      case 'vote.cast': act.add(e.holder); break;
      case 'assembly.closed': perAssembly.push(act); act = new Set(); last = e.cycle; break;
      default: break;
    }
  }
  return finish(holders, perAssembly, params, last);
}

/** events.json body (no preimages) and events.log text. */
function serialize(derived) {
  const json = {
    version: derived.version, head: derived.head, count: derived.count,
    events: derived.events.map((e) => ({ seq: e.seq, kind: e.kind, cycle: e.cycle, holder: e.holder, points: e.points, value: e.value, ref: e.ref, blob: e.blob, evidence: e.evidence, prev: e.prev, hash: e.hash }))
  };
  const log = derived.events.map((e) => e.preimage + 'hash=' + e.hash + '\n').join('');
  return { json: JSON.stringify(json, null, 2) + '\n', log };
}

module.exports = { deriveEvents, verifyChain, foldEvents, serialize, preimageOf, norm, VERSION, HEADER, ZERO, KINDS };
