#!/usr/bin/env node
'use strict';
/**
 * check-workflows.js — no event data or dispatch input inside a script.
 *
 * An expression such as `${{ github.event.issue.title }}` inside `run:` is
 * pasted into the script before the shell sees it, so whoever writes the title
 * writes the script. Every value from the event or from a dispatch input goes
 * through `env:` instead and is validated by the script that reads it.
 *
 * This scans every `run:` value in .github/workflows/*.yml and *.yaml (block
 * scalars, and plain or quoted scalars with their indented continuation lines),
 * and the `script:` input of every step that uses actions/github-script, whose
 * value is JavaScript pasted the same way. It fails on any `${{ ... }}`
 * expression that reads `github.event`, `github.head_ref` (the branch name of a
 * pull request, chosen by its author), the whole `github` context (as in
 * `toJSON(github)`), or `inputs`. Expressions stay allowed where GitHub does not
 * paste them into a script: `if:`, `concurrency`, `env:` and the other `with:`
 * inputs. Zero dependencies.
 *
 * Usage:
 *   node tools/check-workflows.js [--root <dir>] [file ...]
 */

const fs = require('node:fs');
const path = require('node:path');

const EXPR = /\$\{\{([\s\S]*?)\}\}/g;
const TAINTED = new RegExp([
  // github.event, github['event'], and anything under them
  /\bgithub\s*\.\s*event\b/.source,
  /\bgithub\s*\[\s*['"]event['"]\s*\]/.source,
  // github.head_ref, github['head_ref']
  /\bgithub\s*\.\s*head_ref\b/.source,
  /\bgithub\s*\[\s*['"]head_ref['"]\s*\]/.source,
  // the whole github context, as in toJSON(github): `github` with no property after it
  /(?:^|[^.\w-])github(?![\w-])(?!\s*[.[])/.source,
  // inputs, and anything under it
  /(?:^|[^.\w])inputs\b/.source
].join('|'));
const RUN_KEY = /^(\s*)(-\s+)?run\s*:(.*)$/;
const SCRIPT_KEY = /^(\s*)(-\s+)?script\s*:(.*)$/;
const indentOf = (l) => l.length - l.trimStart().length;

/**
 * The values of one key, each as { line, parts: [{ line, text }] } (1-based).
 * A block scalar (| or >) is its indented body. A plain or quoted scalar is the
 * text after the key plus every following line indented past the key, which
 * YAML reads as continuation lines of the same value.
 */
function valueBlocks(lines, keyRe, keep) {
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const m = keyRe.exec(lines[i]);
    if (!m) continue;
    if (keep && !keep(lines, i)) continue;
    // The key's own column: after "- " when the key opens a list item.
    const keyCol = m[1].length + (m[2] ? m[2].length : 0);
    const rest = m[3].replace(/\s+#.*$/, '').trim();
    const isBlock = /^[|>][+-]?\d*$/.test(rest);
    const parts = isBlock ? [] : [{ line: i + 1, text: m[3] }];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === '') { parts.push({ line: j + 1, text: '' }); continue; }
      if (indentOf(l) <= keyCol) break;
      parts.push({ line: j + 1, text: l });
    }
    blocks.push({ line: i + 1, parts });
    i = j - 1;
  }
  return blocks;
}

const splitLines = (text) => String(text).replace(/\r\n/g, '\n').split('\n');

/** The `run:` values of a workflow. */
function runBlocks(text) {
  return valueBlocks(splitLines(text), RUN_KEY);
}

/**
 * Whether the `script:` key on line i is an input of a step that uses
 * actions/github-script: its parent is a `with:` key, and a sibling of that
 * `with:` in the same step is `uses: actions/github-script@...`.
 */
function isGithubScriptInput(lines, i) {
  const keyIndent = indentOf(lines[i]);
  let w = i - 1;
  while (w >= 0 && (lines[w].trim() === '' || indentOf(lines[w]) >= keyIndent)) w--;
  const wm = w >= 0 ? /^(\s*)(-\s+)?with\s*:\s*(#.*)?$/.exec(lines[w]) : null;
  if (!wm) return false;
  const col = wm[1].length + (wm[2] ? wm[2].length : 0);
  // The step: from its list item (the "- " line whose key sits at col) to the
  // next line indented less than its keys.
  let start = w;
  if (!wm[2]) {
    while (start > 0) {
      start--;
      const l = lines[start];
      if (l.trim() === '') continue;
      const lm = /^(\s*)(-\s+)?/.exec(l);
      const c = lm[1].length + (lm[2] ? lm[2].length : 0);
      if (lm[2] && c === col) break;
      if (c < col) return false;
    }
  }
  for (let k = start; k < lines.length; k++) {
    const l = lines[k];
    // Past the item line, a line indented less than the step's keys ends the
    // step (the next "- " item sits two columns left of them).
    if (k > start && l.trim() !== '' && indentOf(l) < col) break;
    const um = /^(\s*)(-\s+)?uses\s*:\s*['"]?([^'"\s#]+)/.exec(l);
    if (um && um[1].length + (um[2] ? um[2].length : 0) === col && /^actions\/github-script@/i.test(um[3])) return true;
  }
  return false;
}

/** The `script:` inputs of actions/github-script steps. */
function scriptBlocks(text) {
  return valueBlocks(splitLines(text), SCRIPT_KEY, isGithubScriptInput);
}

/** Every tainted expression inside a `run:` value or a github-script `script:`: [{ line, expr, key }]. */
function findViolations(text) {
  const out = [];
  const scan = (blocks, key) => {
    for (const b of blocks) {
      for (const p of b.parts) {
        EXPR.lastIndex = 0;
        let m;
        while ((m = EXPR.exec(p.text))) {
          if (TAINTED.test(m[1])) out.push({ line: p.line, expr: m[0].trim(), key });
        }
      }
    }
  };
  scan(runBlocks(text), 'run');
  scan(scriptBlocks(text), 'script');
  return out.sort((a, b) => a.line - b.line);
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
      io.err('ERROR: ' + rel + ':' + v.line + ': ' + v.expr + ' inside ' + v.key + ':; pass it through env: and validate it in the script');
    }
  }
  io.out('check-workflows: ' + list.length + ' workflow' + (list.length === 1 ? '' : 's') + ', ' + bad + ' problem' + (bad === 1 ? '' : 's') + '.');
  return bad ? 1 : 0;
}

module.exports = { main, findViolations, runBlocks, scriptBlocks };

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2), {
    out: (s) => process.stdout.write(s + '\n'),
    err: (s) => process.stderr.write(s + '\n')
  });
}
