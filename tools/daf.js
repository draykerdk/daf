#!/usr/bin/env node
'use strict';
/**
 * daf.js — instruments for the Phase 0 federation record (federation/).
 *
 * The tools compute arithmetic and check structure. They never judge merit,
 * never merge and never decide: every report is still written, argued and
 * merged by people (DAF-001 §4). Zero dependencies; Node 22 built-ins only.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { loadRecord, withReport, gitBlobSha, LOGIN_RE } = require('./lib/record');
const { crossCheck, numberWord } = require('./lib/params');
const { renderAssemblyVote, extractRefs, ID_RE, PLACEHOLDER_HOLDERS } = require('./lib/assembly');
const { foldLedger } = require('./lib/ledger');
const { computeTally, flattenPages, voteBase, requireDetermined, noWeight, belowZero, FOUNDING_CHECK, BELOW_ZERO } = require('./lib/tally');
const { deriveEvents, serialize } = require('./lib/events');
const { renderLedger, renderTally, voteSummaryLines, votesTableLines, code, pct } = require('./lib/render');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const REPO_BLOB = 'https://github.com/draykerdk/daf/blob/master/federation/';
const ISSUES_ENDPOINT = 'repos/draykerdk/daf/issues?state=all&per_page=100';
const SNAPSHOT_CAP = 30;
const README_QUOTE = 'a mistake in a past assembly is corrected by a later one that says what was wrong, not by editing the original';

const USAGE = `usage: node tools/daf.js <command> [options]

Instruments for the federation record in federation/. They compute arithmetic
and check structure; they never judge merit, merge or decide.

Commands:
  check [--base <git-sha>] [--allow-pending] [--allow-undetermined]
      Validate the record: units, parameters (against DAF-000 and DAF-001),
      assembly reports, requests, LEDGER.md and the event log. With --base,
      warn about assembly reports, unit records and parameters changed rather
      than added since <git-sha>, and about requests already decided by an
      assembly that were changed or deleted since then.
  ledger [--write] [--before <YYYY-MM>] [--allow-undetermined]
      Print LEDGER.md as folded from the assemblies, or write it.
  tally --cycle <YYYY-MM> --comments <file> [--reviews <file>]
        [--review-comments <file>] [--record <dir>] [--master-record <dir>]
        [--report <file>] [--pr <n>] [--head <sha>] [--json] [--now <ISO>]
        [--allow-undetermined]
      Count the votes for the report of <cycle>. Comment files are JSON from
      \`gh api --paginate --slurp\` (array of pages) or a flat array. With
      --report, units, parameters and earlier assemblies come from the record
      (--record or --root, the default branch) and only the report under vote
      comes from <file>, read in memory as federation/assemblies/<cycle>.md.
      Before the close of the window (now, or --now) the count is marked
      provisional.
  draft <YYYY-MM> [--issues <file>]
      Write federation/assemblies/<YYYY-MM>.md from the template, the open
      [Cycle] issue and the [Claim] issues of that cycle. Outcome: pending.
  close <YYYY-MM> --comments <file> [--reviews <file>]
        [--review-comments <file>] [--pr <n>] [--head <sha>]
        [--base-ref <ref>] [--now <ISO>] [--allow-undetermined]
      Count the votes as the tally workflow does: unit records, parameters and
      earlier assemblies come from <ref> (default origin/master, extracted with
      git archive), and only the report under vote from the working tree. Then
      write the tally into the working tree's report (vote table, Votes,
      Outcome), set joined on the records it accepts when passed, and
      regenerate LEDGER.md. Refuses before the window closes. Warns about
      unit records, parameters and assemblies the working tree changed versus
      <ref>. Never commits.
  snapshot --out <dir> [--issues <file>] [--commit <sha>] [--allow-undetermined]
      Write <dir>/federation.json, <dir>/events.json and <dir>/events.log.
  events --out <dir> [--allow-undetermined]
      Write <dir>/events.json and <dir>/events.log.

A closed report decided before any holder had weight (the founding case)
cannot be recomputed: DAF-000 and DAF-001 do not specify it. \`check\` reports
it as an error, and the commands that fold the record (ledger --write, tally,
close, snapshot, events) refuse it. --allow-undetermined turns that error into
a warning and lets them fold it; it is meant for the fictional test records.

Options for every command:
  --root <dir>   repository root (default: the parent of tools/)
  --help         print this text
`;

const VALUE_FLAGS = new Set(['root', 'base', 'base-ref', 'before', 'cycle', 'comments', 'reviews', 'review-comments', 'record', 'master-record', 'report', 'pr', 'head', 'issues', 'out', 'commit', 'now']);
const BOOL_FLAGS = new Set(['write', 'json', 'allow-pending', 'allow-undetermined', 'help']);

class UsageError extends Error {}

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') { opts.help = true; continue; }
    if (a.startsWith('--')) {
      let name = a.slice(2);
      let value;
      const eq = name.indexOf('=');
      if (eq >= 0) { value = name.slice(eq + 1); name = name.slice(0, eq); }
      if (BOOL_FLAGS.has(name)) { if (value !== undefined) throw new UsageError('--' + name + ' takes no value'); opts[name] = true; continue; }
      if (!VALUE_FLAGS.has(name)) throw new UsageError('unknown option --' + name);
      if (value === undefined) {
        value = argv[++i];
        if (value === undefined || value.startsWith('--')) throw new UsageError('--' + name + ' needs a value');
      }
      opts[name] = value;
      continue;
    }
    opts._.push(a);
  }
  return opts;
}

const CYCLE_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const needCycle = (c) => { if (!CYCLE_RE.test(String(c || ''))) throw new UsageError('a cycle is YYYY-MM'); return c; };

/** --now as milliseconds: an ISO 8601 date or UTC time; the current time when absent. */
function parseNow(value) {
  if (value === undefined) return Date.now();
  const t = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/.test(value) ? Date.parse(value) : NaN;
  if (isNaN(t)) throw new UsageError('--now must be an ISO 8601 time, as 2026-04-08T00:00:00Z');
  return t;
}

function readJson(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { throw new Error('cannot read ' + file + ': ' + e.message); }
  try { return JSON.parse(text); } catch (e) { throw new Error(file + ': not valid JSON: ' + e.message); }
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function needParams(rec) {
  if (!rec.parameters) throw new Error('federation/parameters.yml is missing or invalid: ' + rec.problems.filter((p) => /parameters/.test(p)).join('; '));
  return rec.parameters;
}

function firstDiffLine(a, b) {
  const x = a.split('\n');
  const y = b.split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return i + 1;
  return 0;
}

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

/**
 * Run every structural and arithmetic check. Pure apart from reading files (and
 * git with base). Options: base, allowPending, allowUndetermined, crossCheck.
 */
function runCheck(root, opts) {
  opts = opts || {};
  const errors = [];
  const warnings = [];
  const notes = [];
  const rec = loadRecord(root);
  errors.push(...rec.problems);
  warnings.push(...rec.warnings);
  const params = rec.parameters;
  if (params && opts.crossCheck !== false) errors.push(...crossCheck(rec.root, params));

  for (const u of rec.units.values()) if (PLACEHOLDER_HOLDERS.has(u.id)) errors.push(u.file + ': the unit id is still the template placeholder "' + u.id + '"');
  for (const r of rec.requests) if (r.from && PLACEHOLDER_HOLDERS.has(r.from)) errors.push(r.file + ': **From:** is still the template placeholder "' + r.from + '"');

  // Holders recorded by a passed assembly: first cycle, and the last row (the
  // one the ledger's joined and kind come from).
  const recordedIn = new Map();
  const lastRecord = new Map();
  let pending = 0;
  for (const a of rec.assemblies) {
    errors.push(...a.problems);
    warnings.push(...a.warnings);
    for (const p of a.placeholders) {
      if (['title', 'window', 'cycle issue'].includes(p.section)) continue; // already a problem
      errors.push(a.file + ':' + p.line + ': template placeholder row left in "' + p.section + '"');
    }
    if (a.todo.length) warnings.push(a.file + ': TODO(person) markers left on line' + (a.todo.length > 1 ? 's ' : ' ') + a.todo.join(', '));
    const outcome = a.vote.outcome;
    if (outcome === 'pending') {
      pending++;
      if (!opts.allowPending) errors.push(a.file + ': the outcome is pending; a report on master must say passed or failed (use --allow-pending on a pull request)');
    }
    if (!params) continue;
    for (const d of a.deliveries) if (d.points !== null && d.points !== params.points_per_function) errors.push(a.file + ':' + d.line + ': a delivery is worth ' + params.points_per_function + ' (points_per_function), found ' + d.points);
    for (const m of a.modules) {
      const want = m.functions.length * params.module_bonus_per_function;
      if (m.bonus !== null && m.bonus !== want) errors.push(a.file + ':' + m.line + ': module bonus must be ' + m.functions.length + ' functions x ' + params.module_bonus_per_function + ' = ' + want + ', found ' + m.bonus);
    }
    if (outcome === 'passed') {
      // A decided request stays where the assembly found it: the event log
      // names it by path, and the report is the only other trace of it.
      for (const r of a.resources) {
        if (!/^requests\/\d+-[a-z0-9]+(-[a-z0-9]+)*\.md$/.test(r.request)) continue; // already a problem
        if (!fs.existsSync(path.join(rec.root, 'federation', r.request))) errors.push(a.file + ':' + r.line + ': Resource decisions names federation/' + r.request + ', which does not exist; a decided request is kept, not deleted or renamed');
      }
      for (const r of a.newRecords) {
        if (!rec.units.has(r.holder)) errors.push(a.file + ':' + r.line + ': new record `' + r.holder + '` has no file federation/units/' + r.holder + '.yml');
        if (recordedIn.has(r.holder)) warnings.push(a.file + ':' + r.line + ': `' + r.holder + '` was already recorded in assembly ' + recordedIn.get(r.holder));
        else recordedIn.set(r.holder, a.cycle);
        lastRecord.set(r.holder, { cycle: a.cycle, kind: r.kind, where: a.file + ':' + r.line });
      }
      // Nothing is awarded, removed or counted for a holder that no passed
      // assembly, this one or an earlier one, has recorded.
      for (const [label, rows] of [['delivery', a.deliveries], ['module', a.modules], ['penalty', a.penalties], ['vote', a.votes]]) {
        for (const r of rows) {
          if (!recordedIn.has(r.holder)) errors.push(a.file + ':' + r.line + ': ' + label + ' holder `' + r.holder + '` has no accepted record: no passed assembly up to this one lists it in New records');
        }
      }
      if (a.penalties.length) {
        const through = foldLedger(Object.assign({}, rec, { assemblies: rec.assemblies.filter((x) => x.cycle <= a.cycle) }), { params });
        const byId = new Map(through.holders.map((h) => [h.id, h]));
        const said = new Set();
        for (const p of a.penalties) {
          const h = byId.get(p.holder);
          if (!h || h.points >= 0 || said.has(p.holder)) continue;
          said.add(p.holder);
          errors.push(a.file + ':' + p.line + ': the penalty takes `' + p.holder + '` to ' + h.points + ' points. ' + BELOW_ZERO);
        }
      }
    }
    if (outcome === 'passed' || outcome === 'failed') checkVote(rec, a, params, { errors, warnings, allowUndetermined: !!opts.allowUndetermined });
  }

  // Unit files against the assemblies that accepted them.
  for (const [id, r] of lastRecord) {
    const u = rec.units.get(id);
    if (!u) continue;
    if (u.joined !== r.cycle) errors.push(u.file + ': joined is ' + (u.joined === null ? 'null' : u.joined) + ', but assembly ' + r.cycle + ' accepted this record (' + r.where + '); joined must be ' + r.cycle);
    if (u.kind !== r.kind) errors.push(u.file + ': kind is ' + u.kind + ', but ' + r.where + ' accepted it as ' + r.kind);
  }
  for (const u of rec.units.values()) {
    if (!recordedIn.has(u.id)) warnings.push(u.file + ': no passed assembly has accepted this record (a stub not yet accepted)');
    const todo = [];
    u.raw.toString('utf8').split('\n').forEach((l, i) => { if (/TODO\(person\)/.test(l)) todo.push(i + 1); });
    if (todo.length) warnings.push(u.file + ': TODO(person) markers left on line' + (todo.length > 1 ? 's ' : ' ') + todo.join(', '));
  }

  let fold = null;
  if (params) {
    try {
      fold = foldLedger(rec, { params });
      const want = renderLedger(fold, params);
      const file = path.join(rec.root, 'federation', 'LEDGER.md');
      const have = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      // CRLF and LF are the same file: a checkout with core.autocrlf=true has CRLF.
      if (have === null) errors.push('federation/LEDGER.md: not found');
      else if (have.replace(/\r\n/g, '\n') !== want) errors.push('federation/LEDGER.md: differs from the fold of the assemblies at line ' + firstDiffLine(have, want) + '; regenerate it with `node tools/daf.js ledger --write`');
    } catch (e) { errors.push('ledger: ' + e.message); }
  }

  let derived = null;
  try { derived = deriveEvents(rec); } catch (e) { errors.push('events: ' + e.message); }

  if (opts.base) {
    let out = '';
    try {
      out = execFileSync('git', ['-C', rec.root, 'diff', '--name-status', opts.base, 'HEAD', '--', 'federation/assemblies/', 'federation/units/', 'federation/parameters.yml', 'federation/requests/'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { errors.push('--base ' + opts.base + ': git diff failed: ' + String(e.stderr || e.message).trim()); }
    // Requests named in Resource decisions of a closed report: already decided.
    const decided = new Map();
    for (const a of rec.assemblies) {
      const o = a.vote && a.vote.outcome;
      if (o !== 'passed' && o !== 'failed') continue;
      for (const r of a.resources) if (!decided.has('federation/' + r.request)) decided.set('federation/' + r.request, a.file);
    }
    for (const line of out.split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      const status = parts[0];
      const files = parts.slice(1).filter((f) => !/\/(TEMPLATE\.|README)/i.test(f));
      if (!files.length) continue;
      if (files.every((f) => f.startsWith('federation/assemblies/'))) {
        if (status === 'A') continue;
        warnings.push(files.join(' -> ') + ': ' + status + ' since ' + opts.base + '. federation/README.md: "' + README_QUOTE + '".');
      } else if (files.every((f) => f.startsWith('federation/requests/'))) {
        const by = files.map((f) => decided.get(f)).find(Boolean);
        if (!by) continue;
        warnings.push(files.join(' -> ') + ': ' + status + ' since ' + opts.base + '. This request was already decided in ' + by + '; a decided request is kept as the assembly decided it, and a change is asked for in a new request.');
      } else if (files.some((f) => f === 'federation/parameters.yml')) {
        warnings.push(files.join(' -> ') + ': ' + status + ' since ' + opts.base + '. The parameters change only with the text of DAF-000 or DAF-001 (DAF-000 §5); the tally reads them from the default branch, never from a pull request.');
      } else {
        if (status === 'A') continue;
        warnings.push(files.join(' -> ') + ': ' + status + ' since ' + opts.base + '. An existing unit record was changed; the tally reads unit records from the default branch, never from a pull request.');
      }
    }
  }

  return { record: rec, errors, warnings, notes, fold, derived, pending };
}

/** The Participation row of a closed report: its percentage and its quorum figure, recomputed. */
function checkParticipation(a, v, params, cast, base, determinable, err) {
  const row = v.rows.participation;
  if (!row) { err(a.file + ': the vote table has no "Participation" row'); return; }
  const at = a.file + ':' + row.line + ': ';
  const m = /^(.*?)\s*\(quorum\s+(\d+)%\)$/.exec(row.value);
  if (!m) { err(at + 'Participation must read "<percent>% (quorum ' + params.quorum_percent + '%)", found "' + row.value + '"'); return; }
  if (+m[2] !== params.quorum_percent) err(at + 'the quorum figure is ' + m[2] + '%, but parameters.yml says quorum_percent: ' + params.quorum_percent);
  const p = m[1];
  if (!determinable) {
    if (p !== '—' && p !== '-') err(at + 'Participation is "' + p + '", but no participation can be computed for this report; write "—"');
    return;
  }
  // Exactly as `close` writes it: truncated to one decimal, never rounded up
  // past the floor (16.6% for 1 of 6, not 16.7%), and no decimal when it is 0.
  const want = pct(cast, base);
  if (p !== want) err(at + 'Participation is "' + p + '", but ' + cast + ' of ' + base + ' gives ' + want + ' (truncated to one decimal)');
}

/** The vote tables of a closed report against the arithmetic of DAF-000 §5.3. */
function checkVote(rec, a, params, out) {
  const errors = out.errors;
  const err = (m) => errors.push(m);
  const v = a.vote;
  if (v.placeholder) { err(a.file + ': the vote table still holds placeholder values (n)'); return; }
  const prior = foldLedger(rec, { before: a.cycle, params });
  const byId = new Map(prior.holders.map((h) => [h.id, h]));
  const founding = noWeight(prior);
  const negative = belowZero(prior);
  let sumFor = 0, sumAgainst = 0, sumAbstain = 0;
  const seen = new Set();
  const counted = [];
  for (const r of a.votes) {
    if (seen.has(r.holder)) err(a.file + ':' + r.line + ': `' + r.holder + '` appears twice in Votes');
    seen.add(r.holder);
    const h = byId.get(r.holder);
    const want = h ? h.points : 0;
    if (!founding && want <= 0) err(a.file + ':' + r.line + ': `' + r.holder + '` has no weight in the ledger before ' + a.cycle);
    else if (r.weight !== null && r.weight !== want) err(a.file + ':' + r.line + ': weight of `' + r.holder + '` must be ' + want + ' (its points after the assemblies before ' + a.cycle + '), found ' + r.weight);
    if (want > 0) counted.push(r.holder);
    if (r.vote === 'for') sumFor += r.weight || 0;
    else if (r.vote === 'against') sumAgainst += r.weight || 0;
    else if (r.vote === 'abstain') sumAbstain += r.weight || 0;
  }
  const cast = sumFor + sumAgainst + sumAbstain;
  const base = voteBase(prior, params, counted);

  // The summary rows: each present and a number.
  const label = params.quorum_base === 'total' ? 'Total points' : 'Active points';
  const rows = v.rows || {};
  if (!rows.base) err(a.file + ': the vote table has no "' + label + '" row');
  else {
    if (rows.base.label !== label.toLowerCase()) err(a.file + ':' + rows.base.line + ': the vote table says "' + rows.base.label.replace(/^./, (c) => c.toUpperCase()) + '", but parameters.yml says quorum_base: ' + params.quorum_base + '; the row is "' + label + '"');
    if (v.active === null) err(a.file + ':' + rows.base.line + ': ' + label + ' "' + rows.base.value + '" is not a number');
    else if (v.active !== base) err(a.file + ': ' + label + ' is ' + v.active + ' but the ledger before ' + a.cycle + ' gives ' + base);
  }
  if (!rows.cast) err(a.file + ': the vote table has no "Votes cast" row');
  else if (v.cast === null) err(a.file + ':' + rows.cast.line + ': Votes cast "' + rows.cast.value + '" is not a number');
  else if (v.cast !== cast) err(a.file + ': Votes cast is ' + v.cast + ' but the Votes table sums to ' + cast);
  if (!rows.split) err(a.file + ': the vote table has no "For / against / abstain" row');
  else if (v.for !== null && (v.for !== sumFor || v.against !== sumAgainst || v.abstain !== sumAbstain)) err(a.file + ': For / against / abstain is ' + v.for + ' / ' + v.against + ' / ' + v.abstain + ' but the Votes table sums to ' + sumFor + ' / ' + sumAgainst + ' / ' + sumAbstain);

  const determinable = !founding && !negative.length && base > 0;
  checkParticipation(a, v, params, cast, base, determinable, err);

  if (founding) {
    (out.allowUndetermined ? out.warnings : errors).push(a.file + ': the outcome "' + v.outcome + '" cannot be recomputed: ' + FOUNDING_CHECK);
    return;
  }
  if (negative.length) {
    err(a.file + ': the outcome "' + v.outcome + '" cannot be recomputed: ' + negative.map((h) => '`' + h.id + '` held ' + h.points + ' points').join(', ') + ' before this assembly. ' + BELOW_ZERO + '.');
    return;
  }
  if (base <= 0) {
    err(a.file + ': the outcome "' + v.outcome + '" cannot be recomputed: no points counted toward the quorum base before this assembly, and DAF-000 and DAF-001 do not specify this case (DAF-000 §8).');
    return;
  }
  const passed = cast * 100 >= params.quorum_percent * base && sumFor * 2 > cast;
  const want = passed ? 'passed' : 'failed';
  if (v.outcome !== want) err(a.file + ': the outcome is ' + v.outcome + ' but the votes give ' + want + ' (DAF-000 §5.3)');
}

function cmdCheck(opts, io) {
  const r = runCheck(opts.root, { base: opts.base, allowPending: opts['allow-pending'], allowUndetermined: opts['allow-undetermined'] });
  for (const n of r.notes) io.out('NOTE: ' + n);
  for (const w of r.warnings) io.err('WARNING: ' + w);
  for (const e of r.errors) io.err('ERROR: ' + e);
  const rec = r.record;
  const held = rec.assemblies.length;
  const summary = 'check: ' + rec.units.size + ' unit record' + (rec.units.size === 1 ? '' : 's') + ', ' + held + ' assembly report' + (held === 1 ? '' : 's') +
    (r.pending ? ' (' + r.pending + ' pending)' : '') + ', ' + rec.requests.length + ' request' + (rec.requests.length === 1 ? '' : 's') +
    (r.derived ? '; ' + r.derived.count + ' events, head ' + r.derived.head.slice(0, 12) : '') +
    '. ' + r.errors.length + ' error' + (r.errors.length === 1 ? '' : 's') + ', ' + r.warnings.length + ' warning' + (r.warnings.length === 1 ? '' : 's') + '.';
  if (!rec.units.size && !held && !rec.requests.length) io.out('The record is empty: no unit is recorded and no assembly has been held.');
  io.out(summary);
  return r.errors.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// ledger
// ---------------------------------------------------------------------------

function cmdLedger(opts, io) {
  const rec = loadRecord(opts.root);
  const params = needParams(rec);
  if (opts.before) needCycle(opts.before);
  const broken = rec.assemblies.filter((a) => a.problems.length);
  for (const a of broken) for (const p of a.problems) io.err('WARNING: ' + p);
  const text = renderLedger(foldLedger(rec, { params, before: opts.before || null }), params);
  if (opts.write) {
    if (broken.length) throw new Error('not writing LEDGER.md while assembly reports have problems; run `node tools/daf.js check`');
    for (const w of requireDetermined(rec, params, opts['allow-undetermined'], 'write LEDGER.md')) io.err('WARNING: ' + w);
    fs.writeFileSync(path.join(rec.root, 'federation', 'LEDGER.md'), text);
    io.out('wrote federation/LEDGER.md');
  } else {
    // Printing changes nothing; it says what it folded that cannot be recomputed.
    for (const w of requireDetermined(rec, params, true, 'fold', opts.before || null)) io.err('WARNING: ' + w);
    io.write(text);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// tally and close
// ---------------------------------------------------------------------------

function tallyInputs(opts, cycle, rec) {
  if (!opts.comments) throw new UsageError('--comments <file> is required');
  const input = {
    record: rec,
    cycle,
    now: parseNow(opts.now),
    comments: readJson(opts.comments),
    reviews: opts.reviews ? readJson(opts.reviews) : [],
    reviewComments: opts['review-comments'] ? readJson(opts['review-comments']) : [],
    pr: opts.pr || null,
    head: opts.head || null
  };
  if (opts['master-record']) input.masterRecord = loadRecord(opts['master-record']);
  return input;
}

/**
 * The record a tally reads. With --report, the record (--record or --root) is
 * the default branch and only the report under vote comes from the file.
 */
function tallyRecord(opts, cycle, io) {
  if (opts.report && opts['master-record']) throw new UsageError('--report reads unit records from the record itself; --master-record does not apply');
  let rec = loadRecord(opts.record || opts.root);
  const params = needParams(rec);
  for (const w of requireDetermined(rec, params, opts['allow-undetermined'], 'tally ' + cycle, cycle)) io.err('WARNING: ' + w);
  if (opts.report) rec = withReport(rec, path.resolve(opts.report), cycle);
  const a = rec.assemblies.find((x) => x.cycle === cycle);
  if (a) for (const p of a.problems) io.err('WARNING: ' + p);
  return rec;
}

function cmdTally(opts, io) {
  const cycle = needCycle(opts.cycle);
  parseNow(opts.now); // a usage error before anything is read
  const rec = tallyRecord(opts, cycle, io);
  const t = computeTally(tallyInputs(opts, cycle, rec));
  if (t.outcome === 'undetermined') io.err('NOTE: the outcome is undetermined; `close` will not write it.');
  if (opts.json) {
    const out = Object.assign({}, t, { prior: { asOf: t.prior.asOf, totals: t.prior.totals, holders: t.prior.holders } });
    io.write(JSON.stringify(out, null, 2) + '\n');
  } else io.write(renderTally(t));
  return 0;
}

function setJoined(text, cycle) {
  const re = /^(\s*joined:[ ]*)(null|~)?([ ]*(#.*)?)$/m;
  const m = re.exec(text);
  if (!m) return null;
  return text.slice(0, m.index) + m[1] + cycle + m[3] + text.slice(m.index + m[0].length);
}

const BASE_REF = 'origin/master';
const gitRun = (root, args, encoding) => execFileSync('git', ['-C', root].concat(args), { encoding: encoding || 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * Extract federation/ and dafp/ of the commit `ref` into a new temporary
 * directory (git archive <ref> federation dafp | tar -x) and return it. The
 * caller removes it. Throws, telling the operator to fetch, when the ref is
 * missing.
 */
const checkRef = (ref) => { if (!ref || ref.startsWith('-') || /\s/.test(ref)) throw new UsageError('--base-ref must be a git ref, as origin/master'); return ref; };

function extractBase(root, ref) {
  checkRef(ref);
  try { gitRun(root, ['rev-parse', '--verify', '--quiet', ref + '^{commit}']); } catch (e) {
    throw new Error('the base ref ' + ref + ' is not in this checkout. close reads unit records, parameters and earlier assemblies from the default branch: run `git fetch origin` (or pass --base-ref <ref>) and close again. Nothing was written.');
  }
  const present = (p) => { try { gitRun(root, ['cat-file', '-e', ref + ':' + p]); return true; } catch (e) { return false; } };
  if (!present('federation')) throw new Error(ref + ' has no federation/ directory; nothing to count against');
  const paths = ['federation'].concat(present('dafp') ? ['dafp'] : []);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daf-base-'));
  try {
    const tar = gitRun(root, ['archive', '--format=tar', ref, '--'].concat(paths), 'buffer');
    execFileSync('tar', ['-x', '-f', '-', '-C', dir], { input: tar, stdio: ['pipe', 'ignore', 'pipe'] });
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error('cannot extract ' + paths.join(' and ') + ' from ' + ref + ': ' + String(e.stderr || e.message).trim());
  }
  return dir;
}

/**
 * The working tree's changes versus `ref` that close does not count: unit
 * records modified or deleted (added ones are the new records), parameters.yml,
 * and assembly reports other than the added report under vote.
 */
function baseChanges(root, ref, cycle) {
  const scope = ['federation/units/', 'federation/parameters.yml', 'federation/assemblies/'];
  const rows = gitRun(root, ['diff', '--no-renames', '--name-status', ref, '--'].concat(scope)).split('\n').filter(Boolean).map((l) => l.split('\t'));
  for (const f of gitRun(root, ['ls-files', '--others', '--exclude-standard', '--'].concat(scope)).split('\n').filter(Boolean)) rows.push(['A', f]);
  const report = 'federation/assemblies/' + cycle + '.md';
  const out = [];
  for (const [status, file] of rows) {
    if (!file || /\/(TEMPLATE\.|README)/i.test(file)) continue;
    if (file.startsWith('federation/units/') && status === 'A') continue;
    if (file === report && status === 'A') continue;
    out.push(file + ': ' + (status === 'A' ? 'added' : status === 'D' ? 'deleted' : 'modified') + ' in the working tree versus ' + ref + '. close reads unit records, parameters and earlier assemblies from ' + ref + ', so this change is not part of the count.');
  }
  return out;
}

function cmdClose(opts, io) {
  const cycle = needCycle(opts._[1]);
  if (opts.report) throw new UsageError('close writes the report in the working tree; --report does not apply');
  if (opts.record || opts['master-record']) throw new UsageError('close reads the record from --base-ref <ref> (default ' + BASE_REF + '); --record and --master-record do not apply');
  const now = parseNow(opts.now);
  const ref = checkRef(opts['base-ref'] === undefined ? BASE_REF : opts['base-ref']);
  // The working tree: the report under vote, the unit files close writes, and
  // the LEDGER.md it regenerates.
  const rec = loadRecord(opts.root);
  const params = needParams(rec);
  // close regenerates LEDGER.md, which folds every closed report.
  const said = new Set();
  const warn = (w) => { if (!said.has(w)) { said.add(w); io.err('WARNING: ' + w); } };
  for (const w of requireDetermined(rec, params, opts['allow-undetermined'], 'close ' + cycle)) warn(w);
  const a = rec.assemblies.find((x) => x.cycle === cycle);
  if (!a) throw new Error('no report federation/assemblies/' + cycle + '.md');
  if (a.problems.length) throw new Error('the report has problems; fix them first:\n  ' + a.problems.join('\n  '));
  if (a.vote.outcome !== 'pending') throw new Error(a.file + ' is already closed (outcome ' + a.vote.outcome + '); a closed report is corrected by a later assembly, not rewritten');
  if (!a.window) throw new Error(a.file + ' has no Window line; close needs the window to know that the vote is over');
  const closesAt = a.window.closes + 'T00:00:00Z';
  if (now < Date.parse(closesAt)) throw new Error('refusing to close ' + cycle + ': the window closes at ' + closesAt + '; close after it. Nothing was written.');

  // The count: the default branch's record, with only the report under vote
  // taken from the working tree (as `tally --report` and the tally workflow).
  let t;
  const baseDir = extractBase(rec.root, ref);
  try {
    for (const w of baseChanges(rec.root, ref, cycle)) warn(w);
    const master = loadRecord(baseDir);
    if (!master.parameters) throw new Error(ref + ': federation/parameters.yml is missing or invalid: ' + master.problems.filter((p) => /parameters/.test(p)).join('; '));
    for (const w of requireDetermined(master, master.parameters, opts['allow-undetermined'], 'close ' + cycle, cycle)) warn(w);
    const counted = withReport(master, path.join(rec.root, a.file), cycle);
    const under = counted.assemblies.find((x) => x.cycle === cycle);
    if (under.problems.length) throw new Error('the report has problems against the parameters of ' + ref + ':\n  ' + under.problems.join('\n  '));
    t = computeTally(Object.assign(tallyInputs(opts, cycle, counted), { masterRecord: master, now }));
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
  if (t.outcome === 'undetermined') {
    throw new Error('refusing to close ' + cycle + ': the outcome is undetermined. ' + t.sentences.join(' ') + ' The report is left unchanged; a person writes the vote table.');
  }

  const changes = [];
  const reportPath = path.join(rec.root, a.file);
  const before = a.raw.toString('utf8');
  const after = renderAssemblyVote(before, voteSummaryLines(t), votesTableLines(t, false));
  const unitEdits = [];
  if (t.outcome === 'passed') {
    for (const r of a.newRecords) {
      const u = rec.units.get(r.holder);
      if (!u) throw new Error('new record `' + r.holder + '` has no file federation/units/' + r.holder + '.yml');
      if (u.joined === cycle) continue;
      if (u.joined !== null) throw new Error(u.file + ' already says joined: ' + u.joined);
      const text = setJoined(u.raw.toString('utf8'), cycle);
      if (text === null) throw new Error(u.file + ': no "joined:" line to set');
      unitEdits.push({ file: u.file, text });
    }
  }
  fs.writeFileSync(reportPath, after);
  changes.push('rewrote ' + a.file + ': the vote table, Votes and Outcome (' + t.outcome + '), counted against ' + ref);
  for (const e of unitEdits) {
    fs.writeFileSync(path.join(rec.root, e.file), e.text);
    changes.push('set joined: ' + cycle + ' in ' + e.file);
  }
  const rec2 = loadRecord(rec.root);
  fs.writeFileSync(path.join(rec.root, 'federation', 'LEDGER.md'), renderLedger(foldLedger(rec2, { params }), params));
  changes.push('regenerated federation/LEDGER.md');
  for (const c of changes) io.out(c);
  io.out('Outcome: ' + t.outcome + '. Nothing was committed; review the diff and commit it in the pull request.');
  return 0;
}

// ---------------------------------------------------------------------------
// draft
// ---------------------------------------------------------------------------

/** Issue-form fields: "### Label" headings followed by their value. */
function formFields(body) {
  const fields = new Map();
  const lines = String(body || '').split('\n').map((l) => l.replace(/\r$/, ''));
  let cur = null;
  let buf = [];
  const flush = () => {
    if (cur !== null) {
      const v = buf.join('\n').trim();
      fields.set(cur, v === '_No response_' ? '' : v);
    }
  };
  for (const l of lines) {
    const m = /^###\s+(.+?)\s*$/.exec(l);
    if (m) { flush(); cur = m[1]; buf = []; continue; }
    if (cur !== null) buf.push(l);
  }
  flush();
  return fields;
}

function cycleWindow(body) {
  const f = formFields(body);
  const opens = (f.get('Window opens') || '').trim();
  const closes = (f.get('Window closes') || '').trim();
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (date.test(opens) && date.test(closes)) return { opens, closes };
  const m = /\*\*Window:\*\*\s*opens\s+(\d{4}-\d{2}-\d{2})\s*[,·]\s*closes\s+(\d{4}-\d{2}-\d{2})/.exec(String(body || ''));
  return m ? { opens: m[1], closes: m[2] } : null;
}

function fetchIssues() {
  return JSON.parse(gh(['api', '--paginate', '--slurp', ISSUES_ENDPOINT]));
}

/** The kind a claim's optional "Record" dropdown declares, or null when it does not. */
function recordKind(value) {
  const v = String(value || '').trim();
  if (/^First delivery, as a participant\b/i.test(v)) return 'participant';
  if (/^First delivery, as a unit\b/i.test(v)) return 'unit';
  return null;
}

function stubUnit(id, login, work, cycle, claimNum, declaredKind) {
  return [
    '# Drafted by `node tools/daf.js draft ' + cycle + '` from claim #' + claimNum + ', because no record',
    '# existed for this holder. A person completes it in the same pull request:',
    '# every TODO(person) marks something the claim did not say.',
    '',
    'schema_version: 1',
    'unit:',
    '  id: ' + id,
    '',
    '  name: ' + id + '  # TODO(person): the name of the unit or participant',
    '',
    declaredKind
      ? '  # As declared in the claim: participant = one person, unit = a group of any kind.'
      : '  # TODO(person): participant = one person, unit = a group of any kind.',
    '  kind: ' + (declaredKind || 'participant'),
    '',
    '  founding_function: >-',
    '    TODO(person): the one thing this unit exists to do.',
    '',
    '  speaks_for:',
    '    - https://github.com/' + login,
    '',
    '  work:',
    '    - ' + work,
    '',
    '  # Written by the assembly that accepts this record.',
    '  joined: null',
    ''
  ].join('\n');
}

function cmdDraft(opts, io) {
  const cycle = needCycle(opts._[1]);
  const root = path.resolve(opts.root);
  const rec = loadRecord(root);
  const params = needParams(rec);
  const target = path.join(root, 'federation', 'assemblies', cycle + '.md');
  if (fs.existsSync(target)) throw new Error('federation/assemblies/' + cycle + '.md already exists; draft never overwrites a report');
  const templatePath = path.join(root, 'federation', 'assemblies', 'TEMPLATE.md');
  if (!fs.existsSync(templatePath)) throw new Error('federation/assemblies/TEMPLATE.md not found');
  const template = fs.readFileSync(templatePath, 'utf8');

  const issues = flattenPages(opts.issues ? readJson(opts.issues) : fetchIssues());
  const isPr = (i) => !!i.pull_request;
  const notDrafted = [];
  const todo = [];

  // The cycle issue: by the form's "Cycle" field, or, failing that, by a title
  // that names the cycle (an issue whose field names another cycle is not it).
  const openCycles = issues.filter((i) => !isPr(i) && i.state === 'open' && /^\s*\[Cycle\]/i.test(i.title || ''));
  const fieldOf = (i) => (formFields(i.body).get('Cycle') || '').trim();
  const byField = openCycles.filter((i) => fieldOf(i) === cycle);
  const byTitle = openCycles.filter((i) => String(i.title).includes(cycle) && (!fieldOf(i) || fieldOf(i) === cycle));
  const cycles = (byField.length ? byField : byTitle).sort((x, y) => x.number - y.number);
  const cyc = cycles[0] || null;
  if (cycles.length > 1) io.err('WARNING: more than one open [Cycle] issue mentions ' + cycle + '; using #' + cyc.number);
  const win = cyc ? cycleWindow(cyc.body) : null;
  if (!cyc) io.err('WARNING: no open [Cycle] issue mentions ' + cycle + '; the Window line keeps its placeholders');
  else if (!win) io.err('WARNING: the cycle issue #' + cyc.number + ' has no readable window; the Window line keeps its placeholders');

  const deliveries = [];
  const modules = [];
  const newRecords = [];
  const stubs = [];
  const recorded = new Set();
  const sources = [];
  // A holder needs a New records row until a PASSED assembly has recorded it.
  // A unit file alone does not count: a failed assembly's stub is merged too.
  const accepted = new Set();
  for (const a of rec.assemblies) if (a.vote.outcome === 'passed') for (const r of a.newRecords) accepted.add(r.holder);
  const claims = issues.filter((i) => !isPr(i) && /^\s*\[Claim\]/i.test(i.title || '')).sort((x, y) => x.number - y.number);
  for (const c of claims) {
    const f = formFields(c.body);
    const skip = (reason) => notDrafted.push('#' + c.number + ' ' + reason);
    const claimCycle = (f.get('Cycle') || '').trim();
    if (claimCycle !== cycle) {
      // A claim for another cycle belongs to that cycle. A Cycle field that is
      // not exactly YYYY-MM names no cycle, so it is listed instead of lost; a
      // claim closed as not planned was withdrawn and stays out.
      if (!CYCLE_RE.test(claimCycle) && !(c.state === 'closed' && c.state_reason === 'not_planned')) {
        const said = claimCycle ? '"' + claimCycle.replace(/[^A-Za-z0-9 ._()-]/g, '').slice(0, 40) + '"' : 'empty';
        skip('has a "Cycle" field that is not exactly YYYY-MM (' + said + '); with the cycle written as YYYY-MM it is drafted in that cycle');
      }
      continue;
    }
    // A claim closed as not planned was withdrawn or turned down in its thread.
    if (c.state === 'closed' && c.state_reason === 'not_planned') { skip('was closed as not planned'); continue; }
    const holder = (f.get('Claimed as') || '').replace(/`/g, '').trim();
    if (!holder) { skip('has no "Claimed as" id'); continue; }
    if (!ID_RE.test(holder)) { skip('claims as "' + holder.replace(/[^A-Za-z0-9 ._-]/g, '').slice(0, 40) + '", which is not a valid id'); continue; }
    if (PLACEHOLDER_HOLDERS.has(holder)) { skip('claims as the template placeholder id'); continue; }
    const what = (f.get('What was delivered') || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
    if (!what) { skip('does not say what was delivered'); continue; }
    const declared = extractRefs(f.get('Declared in') || '', true);
    if (declared.bad.length || declared.urls.length !== 1) { skip('"Declared in" is not one https URL or #n reference'); continue; }
    const result = extractRefs(f.get('The result') || '', true);
    if (result.bad.length || result.urls.length !== 1) { skip('"The result" is not one https URL or #n reference'); continue; }
    const kind = (f.get('What is being claimed') || '').trim();
    let isModule;
    if (/^One function/i.test(kind)) isModule = false;
    else if (/^A completed module/i.test(kind)) isModule = true;
    else { skip('"What is being claimed" is neither a function nor a module'); continue; }
    let fns = null;
    if (isModule) {
      fns = extractRefs(f.get('If a module, the functions in it') || '', true);
      if (fns.bad.length || !fns.urls.length) { skip('a module claim must list its functions as https URLs or #n references'); continue; }
    }
    const author = c.user && c.user.login;
    const needsRecord = !accepted.has(holder) && !recorded.has(holder);
    const stubPath = path.join(root, 'federation', 'units', holder + '.yml');
    const hasFile = fs.existsSync(stubPath);
    if (needsRecord && !hasFile && !(typeof author === 'string' && LOGIN_RE.test(author))) { skip('has no valid author account for a new record'); continue; }

    if (isModule) modules.push('| `' + holder + '` | ' + code(what, 120) + ' | ' + fns.urls.join(', ') + ' | ' + fns.urls.length * params.module_bonus_per_function + ' |');
    else deliveries.push('| `' + holder + '` | ' + code(what, 120) + ' | ' + declared.urls[0] + ' | ' + result.urls[0] + ' | ' + params.points_per_function + ' |');
    sources.push('#' + c.number + ' ' + (isModule ? 'Module completions row ' + modules.length : 'Deliveries row ' + deliveries.length) + ' (`' + holder + '`)');
    if (c.state === 'closed') {
      todo.push('TODO(person): claim #' + c.number + ' is closed' + (typeof c.state_reason === 'string' && /^[a-z_]+$/.test(c.state_reason) ? ' (' + c.state_reason + ')' : '') + '; check in its thread that the claim still stands before keeping its row.');
    }
    // Claim authorship is not checked against speaks_for (an owner's decision);
    // a person looks when the author does not speak for an existing holder.
    const existing = rec.units.get(holder);
    if (existing && !(typeof author === 'string' && existing.logins.includes(author.toLowerCase()))) {
      const who = typeof author === 'string' && LOGIN_RE.test(author) ? '`' + author + '`' : 'an account that could not be read';
      todo.push('TODO(person): claim #' + c.number + ' was filed by ' + who + ', which is not in speaks_for of `' + holder + '`; check in its thread that `' + holder + '` stands behind it.');
    }
    if (needsRecord) {
      recorded.add(holder);
      // The claim's optional "Record" field says participant or unit; without it,
      // the stub says participant and a person confirms it.
      const declaredKind = recordKind(f.get('Record'));
      const rel = 'federation/units/' + holder + '.yml';
      if (hasFile) {
        // A record file exists (a stub from a failed assembly, say), but no
        // passed assembly has accepted it: this assembly records it.
        const u = rec.units.get(holder);
        const kind = (u && u.kind) || declaredKind || 'participant';
        newRecords.push('| `' + holder + '` | ' + kind + ' | ' + result.urls[0] + ' |');
        todo.push('TODO(person): `' + holder + '` has no accepted record. ' + rel + ' exists, but no passed assembly has recorded it, so this assembly does; check that file, and its kind (' + kind + '), here and there.');
      } else {
        newRecords.push('| `' + holder + '` | ' + (declaredKind || 'participant') + ' | ' + result.urls[0] + ' |');
        if (declaredKind) todo.push('TODO(person): `' + holder + '` has no unit record. A stub was drafted at ' + rel + ' as a ' + declaredKind + ', as the claim declares; complete its name and founding function.');
        else todo.push('TODO(person): `' + holder + '` has no unit record. A stub was drafted at ' + rel + ' as a participant; say unit instead, here and there, if it is one.');
        stubs.push({ file: stubPath, rel, text: stubUnit(holder, author, result.urls[0], cycle, c.number, declaredKind) });
      }
    }
  }

  const md = buildDraft(template, { cycle, cyc, win, deliveries, modules, newRecords, notDrafted, todo, sources });
  fs.writeFileSync(target, md);
  io.out('wrote federation/assemblies/' + cycle + '.md (outcome pending; ' + deliveries.length + ' deliveries, ' + modules.length + ' modules, ' + newRecords.length + ' new records)');
  for (const s of stubs) { fs.writeFileSync(s.file, s.text); io.out('wrote ' + s.rel + ' (stub; TODO(person) marks what to complete)'); }
  for (const n of notDrafted) io.out('not drafted: ' + n);
  return 0;
}

/** Fill the template. Placeholder rows go; drafted rows take their place. */
function buildDraft(template, d) {
  const lines = template.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  if (d.sources && d.sources.length) out.push('<!-- Rows drafted from claims: ' + d.sources.join('; ').replace(/--+/g, '-').replace(/>/g, '') + '. -->');
  for (const n of d.notDrafted) out.push('<!-- not drafted: ' + n.replace(/--+/g, '-').replace(/>/g, '') + ' -->');
  for (const t of d.todo) out.push('<!-- ' + t.replace(/--+/g, '-').replace(/>/g, '') + ' -->');
  if (out.length) out.push('');
  let section = '';
  let skipQuote = false;
  for (let i = 0; i < lines.length; i++) {
    let l = lines[i];
    if (/^#\s+Assembly\s+YYYY-MM\s*$/.test(l)) { out.push('# Assembly ' + d.cycle); continue; }
    if (/\*\*Window:\*\*/.test(l)) {
      if (d.win) l = l.replace('YYYY-MM-DD', d.win.opens).replace('YYYY-MM-DD', d.win.closes);
      if (d.cyc) l = l.replace(/#N\b/, '#' + d.cyc.number);
      out.push(l);
      continue;
    }
    if (/^>\s*Copy to `YYYY-MM\.md`/.test(l)) { skipQuote = true; continue; }
    if (skipQuote) {
      if (/^>/.test(l)) continue;
      skipQuote = false;
      if (l.trim() === '' && out[out.length - 1] === '') continue;
    }
    const h = /^##\s+(.+?)\s*$/.exec(l);
    if (h) section = h[1].toLowerCase();
    if (/^\*\*Module completions\*\*\s*$/.test(l.trim())) section = 'module completions';
    if (/^\*\*Votes\*\*\s*$/.test(l.trim())) section = 'votes';
    if (/^\|/.test(l)) {
      const first = l.split('|')[1] ? l.split('|')[1].replace(/`/g, '').trim() : '';
      if (first === 'unit-id' || first === 'requests/n-name.md') {
        if (section === 'deliveries') out.push(...d.deliveries);
        else if (section === 'module completions') out.push(...d.modules);
        else if (section === 'new records') out.push(...d.newRecords);
        continue;
      }
      if (/^\|\s*\*\*Outcome\*\*\s*\|/.test(l)) { out.push('| **Outcome** | **pending** |'); continue; }
      out.push(l);
      continue;
    }
    if ((section === 'where the federation is' || section === 'what the federation would change about itself') && l.trim() && !h && (i === 0 || lines[i - 1].trim() === '')) {
      out.push('TODO(person): ' + l);
      continue;
    }
    if (/^\*\*Reported from last cycle's approvals:\*\*/.test(l)) { out.push('TODO(person): ' + l); continue; }
    out.push(l);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// snapshot and events
// ---------------------------------------------------------------------------

function listing(root, dir) {
  const full = path.join(root, 'federation', dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full, { withFileTypes: true })
    .filter((e) => e.isFile() && !/^TEMPLATE\./i.test(e.name) && !/^README/i.test(e.name))
    .map((e) => e.name).sort()
    .map((name) => ({ name, url: REPO_BLOB + dir + '/' + name }));
}

function writeEvents(dir, derived) {
  fs.mkdirSync(dir, { recursive: true });
  const s = serialize(derived);
  fs.writeFileSync(path.join(dir, 'events.json'), s.json);
  fs.writeFileSync(path.join(dir, 'events.log'), s.log);
}

function cmdEvents(opts, io) {
  if (!opts.out) throw new UsageError('--out <dir> is required');
  const rec = loadRecord(opts.root);
  const params = needParams(rec);
  for (const w of requireDetermined(rec, params, opts['allow-undetermined'], 'export the events')) io.err('WARNING: ' + w);
  const derived = deriveEvents(rec);
  writeEvents(path.resolve(opts.out), derived);
  io.out('wrote ' + derived.count + ' events to ' + path.join(opts.out, 'events.json') + ' and events.log; head ' + derived.head);
  return 0;
}

function cmdSnapshot(opts, io) {
  if (!opts.out) throw new UsageError('--out <dir> is required');
  const rec = loadRecord(opts.root);
  const params = needParams(rec);
  for (const w of requireDetermined(rec, params, opts['allow-undetermined'], 'build the snapshot')) io.err('WARNING: ' + w);
  const derived = deriveEvents(rec);
  let issues = [];
  if (opts.issues) {
    // Every open [Cycle], [Claim], [Request] and [Veto] issue is kept: the site
    // reads the open cycle and its claims from here. The cap of 30 applies to
    // the rest, newest first, so pull requests never push those out.
    const isPr = (i) => Object.prototype.hasOwnProperty.call(i, 'pull_request');
    const open = flattenPages(readJson(opts.issues)).filter((i) => i && i.state === 'open');
    const kept = (i) => !isPr(i) && /^\s*\[(Cycle|Claim|Request|Veto)\]/i.test(String(i.title || ''));
    const byNumber = (x, y) => y.number - x.number;
    const rest = open.filter((i) => !kept(i)).sort(byNumber).slice(0, SNAPSHOT_CAP);
    issues = open.filter(kept).concat(rest).sort(byNumber)
      .map((i) => ({ num: i.number, title: i.title, url: i.html_url, pr: isPr(i) }));
  }
  const fold = foldLedger(rec, { params });
  const snap = {
    generated: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    units: listing(rec.root, 'units'),
    assemblies: listing(rec.root, 'assemblies'),
    requests: listing(rec.root, 'requests'),
    issues,
    source_commit: opts.commit || null,
    parameters: params,
    ledger: fold,
    events: { version: derived.version, head: derived.head, count: derived.count }
  };
  const dir = path.resolve(opts.out);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'federation.json'), JSON.stringify(snap, null, 2) + '\n');
  writeEvents(dir, derived);
  io.out('wrote ' + path.join(opts.out, 'federation.json') + ', events.json and events.log (' + derived.count + ' events, head ' + derived.head.slice(0, 12) + ')');
  return 0;
}

// ---------------------------------------------------------------------------

const COMMANDS = { check: cmdCheck, ledger: cmdLedger, tally: cmdTally, draft: cmdDraft, close: cmdClose, snapshot: cmdSnapshot, events: cmdEvents };

function main(argv, io) {
  io = io || {
    out: (s) => process.stdout.write(s + '\n'),
    err: (s) => process.stderr.write(s + '\n'),
    write: (s) => process.stdout.write(s)
  };
  let opts;
  try { opts = parseArgs(argv); } catch (e) { io.err(e.message); io.err(USAGE); return 1; }
  const cmd = opts._[0];
  if (opts.help || cmd === 'help') { io.write(USAGE); return 0; }
  if (!cmd || !COMMANDS[cmd]) { io.err(cmd ? 'unknown command "' + cmd + '"' : 'no command given'); io.err(USAGE); return 1; }
  opts.root = path.resolve(opts.root || DEFAULT_ROOT);
  try {
    return COMMANDS[cmd](opts, io);
  } catch (e) {
    io.err((e instanceof UsageError ? 'usage error: ' : 'error: ') + e.message);
    if (e instanceof UsageError) io.err(USAGE);
    return 1;
  }
}

module.exports = { main, runCheck, parseArgs, formFields, cycleWindow, buildDraft, setJoined, recordKind, USAGE, gitBlobSha, numberWord };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
