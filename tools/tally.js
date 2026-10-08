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
 * the cycle under vote (DAF-001 §4.5), folded from the record in the working
 * tree, which should be the pull request's head.
 *
 * This is a thin wrapper: it fetches the comments with the GitHub CLI and hands
 * them to tools/lib/tally.js, the same arithmetic as `node tools/daf.js tally`.
 * The tally is still written into the report and merged by a person.
 *
 * Usage:
 *   node tools/tally.js <pr-number> [--cycle <YYYY-MM>] [--root <dir>]
 *
 * Requires: the GitHub CLI (`gh`), authenticated. No dependencies.
 */

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadRecord } = require('./lib/record');
const { computeTally } = require('./lib/tally');
const { renderTally } = require('./lib/render');

const USAGE = 'usage: node tools/tally.js <pr-number> [--cycle <YYYY-MM>] [--root <dir>]';

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
  const cycleArg = take('--cycle');
  const root = path.resolve(take('--root') || path.resolve(__dirname, '..'));
  const pr = args[0];
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
    if (head && local && local !== head) process.stderr.write('note: the working tree is at ' + local.slice(0, 7) + ', the pull request head is ' + head.slice(0, 7) + '; weights and speakers are read from the working tree.\n');

    const record = loadRecord(root);
    const t = computeTally({ record, cycle, comments, reviews, reviewComments, pr, head });
    process.stdout.write(renderTally(t));
    return 0;
  } catch (e) {
    process.stderr.write('error: ' + String(e.message || e).trim() + '\n');
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { main, USAGE };
