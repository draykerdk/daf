'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ROOT } = require('./helpers');
const { findViolations, findUnpinned, runBlocks, main } = require('../check-workflows');

const quiet = () => { const out = []; const err = []; return { io: { out: (s) => out.push(s), err: (s) => err.push(s) }, out, err }; };

test('check-workflows: the repository workflows pass', () => {
  const q = quiet();
  assert.equal(main(['--root', ROOT], q.io), 0, q.err.join('\n'));
  assert.match(q.out.join('\n'), /0 problems\./);
});

test('check-workflows: event data and inputs inside run: are refused', () => {
  const wf = [
    'jobs:',
    '  a:',
    '    steps:',
    '      - run: echo "${{ github.event.issue.title }}"',
    '      - name: block',
    '        run: |',
    '          set -euo pipefail',
    '          echo ${{inputs.pr}}',
    '',
    '          echo "${{ format(\'{0}\', github.event.pull_request.title) }}"',
    '      - run: >-',
    '          echo ${{ github.event[\'comment\'].body }} ${{ github[\'event\'].x }}',
    ''
  ].join('\n');
  const v = findViolations(wf);
  assert.deepEqual(v.map((x) => x.line), [4, 8, 10, 12, 12]);
});

test('check-workflows: env, with, if and concurrency may hold expressions, and safe contexts pass', () => {
  const wf = [
    'concurrency:',
    '  group: daf-tally-${{ inputs.pr }}',
    'jobs:',
    '  a:',
    '    if: github.event.sender.type != \'Bot\'',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '        with:',
    '          ref: ${{ github.event.repository.default_branch }}',
    '      - env:',
    '          PR: ${{ inputs.pr }}',
    '          TITLE: ${{ github.event.issue.title }}',
    '        run: |',
    '          echo "$PR" "${{ github.event_name }}" "${{ github.sha }}" "${{ steps.x.outputs.inputs }}"',
    '      - name: after',
    '        with:',
    '          run: ${{ github.event.issue.title }}',
    ''
  ].join('\n');
  // The last `run:` is a with: input of an action, not a shell script; it is still
  // scanned, conservatively, so it is reported.
  assert.deepEqual(findViolations(wf).map((x) => x.line), [17]);
  const blocks = runBlocks(wf);
  assert.equal(blocks[0].parts.length, 1);
  assert.equal(blocks[0].parts[0].line, 14);
});

test('check-workflows: a block ends where the indentation returns to the key', () => {
  const wf = [
    '      - run: |',
    '          echo one',
    '      - name: next',
    '        env:',
    '          X: ${{ github.event.issue.title }}',
    '        run: echo "$X"'
  ].join('\n');
  assert.deepEqual(findViolations(wf), []);
  assert.deepEqual(runBlocks(wf).map((b) => b.parts.map((p) => p.line)), [[2], [6]]);
});

test('check-workflows: github.head_ref and the whole github context are refused', () => {
  const wf = [
    'jobs:',
    '  a:',
    '    steps:',
    '      - run: git checkout "${{ github.head_ref }}"',
    '      - run: echo ${{ github[\'head_ref\'] }}',
    '      - run: echo \'${{ toJSON(github) }}\'',
    '      - run: echo \'${{ toJSON(github.event) }}\' "${{ toJson( github ) }}"',
    '      - run: echo "${{ github.sha }} ${{ github.ref }} ${{ steps.github.outputs.x }} ${{ github.event_name }}"',
    ''
  ].join('\n');
  assert.deepEqual(findViolations(wf).map((x) => x.line), [4, 5, 6, 7, 7]);
});

test('check-workflows: continuation lines of a plain or quoted run: value are part of it', () => {
  const wf = [
    'jobs:',
    '  a:',
    '    steps:',
    '      - name: plain',
    '        run: echo one',
    '          ${{ github.event.issue.title }}',
    '      - run: "echo two',
    '',
    '          ${{ inputs.pr }}"',
    '      - run:',
    '          echo ${{ github.head_ref }}',
    '      - name: next',
    '        env:',
    '          X: ${{ github.event.issue.title }}',
    '        run: echo "$X"',
    ''
  ].join('\n');
  assert.deepEqual(findViolations(wf).map((x) => x.line), [6, 9, 11]);
  assert.deepEqual(runBlocks(wf).map((b) => b.parts.map((p) => p.line)), [[5, 6], [7, 8, 9], [10, 11], [15, 16]]);
});

test('check-workflows: the script: input of actions/github-script is scanned', () => {
  const wf = [
    'jobs:',
    '  a:',
    '    steps:',
    '      - name: script',
    '        uses: actions/github-script@v7 # pinned by tag here only for the test',
    '        with:',
    '          script: |',
    '            const t = "${{ github.event.issue.title }}";',
    '            core.info(`${{ inputs.pr }}`);',
    '      - uses: actions/github-script@v7',
    '        with:',
    '          script: console.log("${{ github.head_ref }}")',
    '      - with:',
    '          script: console.log(${{ toJSON(github) }})',
    '        uses: "actions/github-script@v7"',
    '      - name: another action',
    '        uses: example/other-action@v1',
    '        with:',
    '          script: echo ${{ github.event.issue.title }}',
    '      - uses: actions/github-script@v7',
    '        env:',
    '          TITLE: ${{ github.event.issue.title }}',
    '        with:',
    '          script: core.info(process.env.TITLE + "${{ github.sha }}")',
    ''
  ].join('\n');
  const v = findViolations(wf);
  assert.deepEqual(v.map((x) => x.line), [8, 9, 12, 14]);
  assert.ok(v.every((x) => x.key === 'script'));
});

test('check-workflows: a violation fails the CLI with a located message', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daf-wf-'));
  try {
    fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.github', 'workflows', 'bad.yml'), 'jobs:\n  a:\n    steps:\n      - run: echo ${{ inputs.pr }}\n');
    const q = quiet();
    assert.equal(main(['--root', dir], q.io), 1);
    assert.match(q.err.join('\n'), /bad\.yml:4: \$\{\{ inputs\.pr \}\} inside run:/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('check-workflows: C7 uses: must name a 40-hex commit, except local and draykerdk refs', () => {
  const SHA = '11d5960a326750d5838078e36cf38b85af677262';
  const wf = [
    'jobs:',
    '  call:',
    '    uses: draykerdk/.github/.github/workflows/validate-component.yml@master',
    '  a:',
    '    steps:',
    '      - uses: actions/checkout@' + SHA + ' # v4.4.0',
    '      - uses: actions/setup-node@v4',
    '      - name: quoted tag',
    '        uses: "actions/upload-pages-artifact@v4.0.0"',
    '      - uses: ./.github/actions/local',
    '      - uses: example/other-action@main',
    '      - uses: example/short-sha@11d5960',
    '      - uses: example/upper-sha@' + SHA.toUpperCase(),
    '      - uses: docker://alpine:3.20',
    '      - uses: example/no-ref',
    '      - uses: \'actions/cache@' + SHA + '\'',
    ''
  ].join('\n');
  assert.deepEqual(findUnpinned(wf).map((x) => [x.line, x.ref]), [
    [7, 'actions/setup-node@v4'],
    [9, 'actions/upload-pages-artifact@v4.0.0'],
    [11, 'example/other-action@main'],
    [12, 'example/short-sha@11d5960'],
    [13, 'example/upper-sha@' + SHA.toUpperCase()],
    [14, 'docker://alpine:3.20'],
    [15, 'example/no-ref']
  ]);
});

test('check-workflows: C7 an unpinned action fails the CLI, and icp-check.yml is pinned', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daf-wf-'));
  try {
    fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.github', 'workflows', 'tag.yml'), 'jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n');
    const q = quiet();
    assert.equal(main(['--root', dir], q.io), 1);
    assert.match(q.err.join('\n'), /tag\.yml:4: uses: actions\/checkout@v4 is not pinned to a commit/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const icp = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'icp-check.yml'), 'utf8');
  assert.match(icp, /uses: actions\/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4\.4\.0\n/);
  assert.match(icp, /uses: actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4\.4\.0\n/);
  assert.deepEqual(findUnpinned(icp), []);
});
