'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { selectSticky } = require('../lib/sticky');
const sticky = require('../sticky');

const M = sticky.MARKER;
const bot = (id, created, body) => ({ id, created_at: created, user: { login: 'github-actions[bot]', type: 'Bot' }, body });
const person = (id, created, body, login) => ({ id, created_at: created, user: { login: login || 'someone', type: 'User' }, body });

test('sticky: nothing of ours means post a new comment', () => {
  assert.deepEqual(selectSticky([], M), { patch: null, delete: [] });
  assert.deepEqual(selectSticky([[person(1, '2026-04-02T00:00:00Z', 'VOTE: for\nAS: x')]], M), { patch: null, delete: [] });
});

test('sticky: the oldest bot comment is updated and the others are removed, across pages', () => {
  const pages = [
    [person(5, '2026-04-01T00:00:00Z', 'hello'), bot(30, '2026-04-03T00:00:00Z', M + '\nsecond')],
    [bot(20, '2026-04-02T00:00:00Z', M + '\nfirst'), bot(40, '2026-04-04T00:00:00Z', M + '\nthird')]
  ];
  assert.deepEqual(selectSticky(pages, M), { patch: 20, delete: [30, 40] });
});

test('sticky: a flat list works, and ties on time fall back to the id', () => {
  const t = '2026-04-02T00:00:00Z';
  assert.deepEqual(selectSticky([bot(9, t, M), bot(7, t, M + '\nx')], M), { patch: 7, delete: [9] });
});

test('sticky: never touches a person, an impostor login, a non-Bot type or a body without the marker at the start', () => {
  const t = '2026-04-02T00:00:00Z';
  const list = [
    person(1, t, M + '\nwritten by a person'),
    person(2, t, M + '\nimpostor', 'github-actions'),
    { id: 3, created_at: t, user: { login: 'github-actions[bot]', type: 'User' }, body: M },
    bot(4, t, 'quoting ' + M),
    bot(5, t, null),
    bot('6', t, M),
    bot(-7, t, M)
  ];
  assert.deepEqual(selectSticky(list, M), { patch: null, delete: [] });
});

test('sticky: a different marker version is not ours', () => {
  assert.deepEqual(selectSticky([bot(1, '2026-04-02T00:00:00Z', '<!-- daf-tally:v2 -->')], M), { patch: null, delete: [] });
});

test('sticky: bad input is refused', () => {
  assert.throws(() => selectSticky({}, M), /JSON array/);
  assert.throws(() => selectSticky([], ''), /marker/);
});

test('sticky: the CLI prints the choice as JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daf-sticky-'));
  try {
    const file = path.join(dir, 'comments.json');
    fs.writeFileSync(file, JSON.stringify([[bot(11, '2026-04-02T00:00:00Z', M + '\nold')], [bot(12, '2026-04-03T00:00:00Z', M + '\nnew')]]));
    const out = [];
    const err = [];
    const code = sticky.main(['--comments', file], { out: (s) => out.push(s), err: (s) => err.push(s) });
    assert.equal(code, 0, err.join('\n'));
    assert.deepEqual(JSON.parse(out.join('')), { patch: 11, delete: [12] });
    assert.equal(sticky.main([], { out() {}, err() {} }), 1);
    assert.equal(sticky.main(['--comments', path.join(dir, 'missing.json')], { out() {}, err() {} }), 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
