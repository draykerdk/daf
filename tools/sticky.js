#!/usr/bin/env node
'use strict';
/**
 * sticky.js — which tally comment the "Federation tally" workflow updates.
 *
 * Reads the comments of a pull request (JSON from `gh api --paginate --slurp`)
 * and prints {"patch": <id or null>, "delete": [<ids>]}: the oldest comment
 * of the Actions bot that starts with the marker is updated, any others are
 * removed, and null means a new comment is posted. The choice itself is
 * tools/lib/sticky.js, which is tested.
 *
 * Usage:
 *   node tools/sticky.js --comments <file> [--marker <text>]
 */

const fs = require('node:fs');
const { selectSticky } = require('./lib/sticky');

const MARKER = '<!-- daf-tally:v1 -->';
const USAGE = 'usage: node tools/sticky.js --comments <file> [--marker <text>]';

function main(argv, io) {
  let file = null;
  let marker = MARKER;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--comments' && argv[i + 1] !== undefined) file = argv[++i];
    else if (a === '--marker' && argv[i + 1] !== undefined) marker = argv[++i];
    else { io.err(USAGE); return 1; }
  }
  if (!file) { io.err(USAGE); return 1; }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    io.out(JSON.stringify(selectSticky(data, marker)));
    return 0;
  } catch (e) {
    io.err('error: ' + e.message);
    return 1;
  }
}

module.exports = { main, MARKER };

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2), {
    out: (s) => process.stdout.write(s + '\n'),
    err: (s) => process.stderr.write(s + '\n')
  });
}
