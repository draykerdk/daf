'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('../lib/yaml-lite');
const { ROOT } = require('./helpers');

test('yaml-lite: parses the unit TEMPLATE', () => {
  const doc = parse(fs.readFileSync(path.join(ROOT, 'federation/units/TEMPLATE.yml'), 'utf8'), 'TEMPLATE.yml');
  assert.deepEqual(doc, {
    schema_version: 1,
    unit: {
      id: 'example-unit',
      name: 'Example Unit',
      kind: 'unit',
      founding_function: 'Describe the one thing this unit exists to do.',
      speaks_for: ['https://github.com/example'],
      work: ['https://github.com/example/repository'],
      joined: null
    }
  });
});

test('yaml-lite: parses parameters.yml with trailing comments', () => {
  const doc = parse(fs.readFileSync(path.join(ROOT, 'federation/parameters.yml'), 'utf8'), 'parameters.yml');
  assert.equal(doc.schema_version, 1);
  assert.deepEqual(doc.parameters, {
    points_per_function: 1, module_bonus_per_function: 1, quorum_percent: 30, quorum_base: 'active',
    majority: 'simple', window_days: 7, dormant_after_assemblies: 3
  });
});

test('yaml-lite: folded and literal block scalars', () => {
  const doc = parse([
    'a: >-',
    '  one',
    '  two',
    '',
    '  three',
    'b: >',
    '  four',
    '  five',
    'c: |',
    '  line one',
    '    indented # not a comment',
    'd: |-',
    '  kept',
    '',
    'e: end'
  ].join('\n'));
  assert.equal(doc.a, 'one two\nthree');
  assert.equal(doc.b, 'four five\n');
  assert.equal(doc.c, 'line one\n  indented # not a comment\n');
  assert.equal(doc.d, 'kept');
  assert.equal(doc.e, 'end');
});

test('yaml-lite: scalars, quotes, comments and the empty list', () => {
  const doc = parse([
    '# full-line comment',
    'plain: some words # trailing comment',
    'hash: a#b',
    'dq: "quoted # not a comment \\"x\\" \\\\ \\n"',
    "sq: 'it''s # here'",
    'n1: null',
    'n2: ~',
    'n3:',
    'yes: true',
    'no: false',
    'int: -42',
    'month: 2026-09',
    'empty: []',
    'seq:',
    '  - a',
    '  - "b: c"',
    'same-indent-seq:',
    '- x',
    'nested:',
    '  inner:',
    '    deep: 1'
  ].join('\n'));
  assert.equal(doc.plain, 'some words');
  assert.equal(doc.hash, 'a#b');
  assert.equal(doc.dq, 'quoted # not a comment "x" \\ \n');
  assert.equal(doc.sq, "it's # here");
  assert.equal(doc.n1, null);
  assert.equal(doc.n2, null);
  assert.equal(doc.n3, null);
  assert.equal(doc.yes, true);
  assert.equal(doc.no, false);
  assert.equal(doc.int, -42);
  assert.equal(doc.month, '2026-09');
  assert.deepEqual(doc.empty, []);
  assert.deepEqual(doc.seq, ['a', 'b: c']);
  assert.deepEqual(doc['same-indent-seq'], ['x']);
  assert.deepEqual(doc.nested, { inner: { deep: 1 } });
});

test('yaml-lite: rejects what is outside the subset, with file and line', () => {
  const bad = [
    ['a: {b: 1}', /x\.yml:1: flow collections/],
    ['a: [1, 2]', /x\.yml:1: flow collections/],
    ['a:\n\t- b', /x\.yml:2: tab/],
    ['a: 1\na: 2', /x\.yml:2: duplicate key "a"/],
    ['a: &anchor 1', /x\.yml:1: anchors/],
    ['a: *alias', /x\.yml:1: anchors/],
    ['a: 1\n---\nb: 2', /x\.yml:2: multiple documents/],
    ['a:\n  - b: 1', /x\.yml:2: sequences of maps/],
    ['a:\n  - - b', /x\.yml:2: nested sequences/],
    ['a: b: c', /x\.yml:1: a map is not allowed/],
    ['a: "open', /x\.yml:1: unterminated/],
    ['a:\n   b: 1', /x\.yml:2: nested blocks must be indented by exactly 2 spaces/],
    ['a: one\n  two', /x\.yml:2: unexpected indentation/],
    ['a: !tag x', /x\.yml:1: tags/],
    ['a: |+\n  x', /x\.yml:1: keep chomping/],
    ['a: "\\t"', /x\.yml:1: unsupported escape/]
  ];
  for (const [text, re] of bad) assert.throws(() => parse(text, 'x.yml'), re, text);
});
