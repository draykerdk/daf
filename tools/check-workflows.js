#!/usr/bin/env node
'use strict';
/**
 * check-workflows.js — no event data or dispatch input inside a shell script.
 *
 * An expression such as `${{ github.event.issue.title }}` inside `run:` is
 * pasted into the script before the shell sees it, so whoever writes the title
 * writes the script. Every value from the event or from a dispatch input goes
 * through `env:` instead and is validated by the script that reads it.
 *
 * This scans every `run:` value in .github/workflows/*.yml and *.yaml and fails
 * on any `${{ ... }}` expression that reads `github.event` or `inputs`.
 * Expressions stay allowed where GitHub does not paste them into a shell:
 * `if:`, `concurrency`, `env:` and `with:`. Zero dependencies.
 *
 * Usage:
 *   node tools/check-workflows.js [--root <dir>] [file ...]
 */

const fs = require('node:fs');
const path = require('node:path');

const EXPR = /\$\{\{([\s\S]*?)\}\}/g;
const TAINTED = /\bgithub\s*\.\s*event\b|\bgithub\s*\[\s*['"]event['"]\s*\]|(^|[^.\w])inputs\b/;
const RUN_KEY = /^(\s*)(-\s+)?run\s*:(.*)$/;

/** The `run:` values of a workflow, each as { line, text } (line is 1-based). */
function runBlocks(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const m = RUN_KEY.exec(lines[i]);
    if (!m) continue;
    // The key's own column: after "- " when the key opens a list item.
    const keyCol = m[1].length + (m[2] ? m[2].length : 0);
    const rest = m[3].replace(/\s+#.*$/, '').trim();
    if (/^[|>][+-]?\d*$/.test(rest)) {
      const body = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const l = lines[j];
        if (l.trim() === '') { body.push({ line: j + 1, text: '' }); continue; }
        const indent = l.length - l.trimStart().length;
        if (indent <= keyCol) break;
        body.push({ line: j + 1, text: l });
      }
      blocks.push({ line: i + 1, parts: body });
      i = j - 1;
    } else {
      blocks.push({ line: i + 1, parts: [{ line: i + 1, text: m[3] }] });
    }
  }
  return blocks;
}

/** Every tainted expression inside a `run:` value: [{ line, expr }]. */
function findViolations(text) {
  const out = [];
  for (const b of runBlocks(text)) {
    for (const p of b.parts) {
      EXPR.lastIndex = 0;
      let m;
      while ((m = EXPR.exec(p.text))) {
        if (TAINTED.test(m[1])) out.push({ line: p.line, expr: m[0].trim() });
      }
    }
  }
  return out;
}

function workflowFiles(root) {
  const dir = path.join(root, '.github', 'workflows');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => /\.ya?ml$/.test(n)).sort().map((n) => path.join(dir, n));
}

function main(argv, io) {
  let root = path.resolve(__dirname, '..');
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root' && argv[i + 1] !== undefined) root = path.resolve(argv[++i]);
    else if (argv[i].startsWith('--')) { io.err('usage: node tools/check-workflows.js [--root <dir>] [file ...]'); return 1; }
    else files.push(path.resolve(argv[i]));
  }
  const list = files.length ? files : workflowFiles(root);
  let bad = 0;
  for (const f of list) {
    const rel = path.relative(root, f) || f;
    for (const v of findViolations(fs.readFileSync(f, 'utf8'))) {
      bad++;
      io.err('ERROR: ' + rel + ':' + v.line + ': ' + v.expr + ' inside run:; pass it through env: and validate it in the script');
    }
  }
  io.out('check-workflows: ' + list.length + ' workflow' + (list.length === 1 ? '' : 's') + ', ' + bad + ' problem' + (bad === 1 ? '' : 's') + '.');
  return bad ? 1 : 0;
}

module.exports = { main, findViolations, runBlocks };

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2), {
    out: (s) => process.stdout.write(s + '\n'),
    err: (s) => process.stderr.write(s + '\n')
  });
}
