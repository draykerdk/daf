#!/usr/bin/env node
'use strict';
/**
 * tally.js — count the votes on an assembly pull request.
 *
 * A vote is a single comment in the format DAF-001 §4 fixes:
 *
 *     VOTE: for | against | abstain
 *     AS: <unit-id or participant-id>
 *
 * Anything else in the comment is discussion. A holder's LAST valid comment of
 * this form is the one that counts. Weight comes from the assemblies held before
 * the cycle under vote (DAF-001 §4.5). Unit records, parameters and earlier
 * assemblies are read from the record in the working tree, which should be the
 * default branch (DAF-002 §5); with --report <file>, only the report under vote
 * is read from that file, as `node tools/daf.js tally --report` does.
 *
 * This is a thin wrapper: it fetches the comments with the GitHub CLI and hands
 * them to tools/lib/tally.js, the same arithmetic as `node tools/daf.js tally`,
 * with the same refusals: a record holding a closed report whose outcome cannot
 * be recomputed (the founding case) is not folded without --allow-undetermined,
 * as `close` and `ledger --write` do not fold it. An undetermined outcome for
 * the report under vote is printed, and `close` will not write it.
 * The tally is still written into the report and merged by a person.
 *
 * Usage:
 *   node tools/tally.js <pr-number> [--cycle <YYYY-MM>] [--root <dir>]
 *                       [--report <file>] [--allow-undetermined]
 *
 * Requires: the GitHub CLI (`gh`), authenticated. No dependencies.
 */

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadRecord, withReport } = require('./lib/record');
const { computeTally, requireDetermined } = require('./lib/tally');
const { renderTally } = require('./lib/render');

const USAGE = 'usage: node tools/tally.js <pr-number> [--cycle <YYYY-MM>] [--root <dir>] [--report <file>] [--allow-undetermined]';

function main(argv) {
  const args = argv.slice();
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    (args.length ? process.stdout : process.stderr).write(USAGE + '\n');
    return args.length ? 0 : 1;
  }
  const take = (flag) => {
    const i = args.indexOf(flag);
    if (i < 0) return undefined;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  };
  if (args.includes('--ledger-ref')) {
    take('--ledger-ref');
    process.stderr.write('note: --ledger-ref is ignored. Weights now come from the assemblies before the cycle under vote (DAF-001 §4.5), folded from the record in the working tree.\n');
  }
  const allowUndetermined = args.includes('--allow-undetermined');
  if (allowUndetermined) args.splice(args.indexOf('--allow-undetermined'), 1);
  const cycleArg = take('--cycle');
  const reportArg = take('--report');
  const root = path.resolve(take('--root') || path.resolve(__dirname, '..'));
  const pr = args[0];
  if (cycleArg !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(cycleArg)) {
    process.stderr.write(USAGE + '\n');
    return 1;
  }
  if (!pr || !/^\d+$/.test(pr) || args.length > 1) {
    process.stderr.write(USAGE + '\n');
    return 1;
  }

  const gh = (list) => execFileSync('gh', list, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const ghJson = (list) => JSON.parse(gh(list));
  const repo = 'repos/{owner}/{repo}/';

  try {
    const comments = ghJson(['api', '--paginate', '--slurp', repo + 'issues/' + pr + '/comments']);
    let reviews = [];
    let reviewComments = [];
    let head = null;
    let cycle = cycleArg;
    try {
      reviews = ghJson(['api', '--paginate', '--slurp', repo + 'pulls/' + pr + '/reviews']);
      reviewComments = ghJson(['api', '--paginate', '--slurp', repo + 'pulls/' + pr + '/comments']);
      head = gh(['api', repo + 'pulls/' + pr, '--jq', '.head.sha']).trim() || null;
      if (!cycle) {
        const files = ghJson(['api', '--paginate', '--slurp', repo + 'pulls/' + pr + '/files']).flat();
        const reports = [...new Set(files.map((f) => /^federation\/assemblies\/(\d{4}-\d{2})\.md$/.exec(f.filename)).filter(Boolean).map((m) => m[1]))];
        if (reports.length === 1) cycle = reports[0];
        else throw new Error('the pull request changes ' + reports.length + ' assembly reports; give the cycle with --cycle YYYY-MM');
      }
    } catch (e) {
      if (!cycle) throw e;
      process.stderr.write('note: ' + String(e.message || e).split('\n')[0] + '\n');
    }
    let local = null;
    try { local = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { /* not a git checkout */ }
    if (head && local && local === head && !reportArg) process.stderr.write('note: the working tree is the pull request head; unit records, parameters and earlier assemblies are read from it. DAF-002 §5 reads them from the default branch: run this from a checkout of it, with --report <the report file>.\n');
    else if (head && local && local !== head) process.stderr.write('note: the working tree is at ' + local.slice(0, 7) + ', the pull request head is ' + head.slice(0, 7) + '; weights and speakers are read from the working tree.\n');

    let record = loadRecord(root);
    if (!record.parameters) throw new Error('federation/parameters.yml is missing or invalid');
    for (const w of requireDetermined(record, record.parameters, allowUndetermined, 'tally ' + cycle, cycle)) process.stderr.write('WARNING: ' + w + '\n');
    if (reportArg) record = withReport(record, path.resolve(reportArg), cycle);
    const report = record.assemblies.find((a) => a.cycle === cycle);
    if (report) for (const p of report.problems) process.stderr.write('WARNING: ' + p + '\n');
    const t = computeTally({ record, cycle, comments, reviews, reviewComments, pr, head });
    if (t.outcome === 'undetermined') process.stderr.write('NOTE: the outcome is undetermined; `close` will not write it.\n');
    process.stdout.write(renderTally(t));
    return 0;
  } catch (e) {
    process.stderr.write('error: ' + String(e.message || e).trim() + '\n');
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { main, USAGE };
