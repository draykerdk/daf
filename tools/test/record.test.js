'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRecord, validateUnit, parseRequest } = require('../lib/record');
const { validateParameters, crossCheck } = require('../lib/params');
const { FIX, ROOT, tmpCopy, write, read } = require('./helpers');
const path = require('node:path');

const unit = (over) => ({
  schema_version: 1,
  unit: Object.assign({
    id: 'example-river', name: 'Example River', kind: 'participant',
    founding_function: 'A fictional participant.', speaks_for: ['https://github.com/example-river-gh'],
    work: ['https://github.com/example-org/example-repo'], joined: null
  }, over)
});
const errs = (doc, id) => validateUnit(doc, 'u.yml', id === undefined ? 'example-river' : id).problems.join('\n');

test('record: a valid unit passes and logins are stored lowercase', () => {
  const v = validateUnit(unit({ speaks_for: ['https://github.com/Example-River-GH'] }), 'u.yml', 'example-river');
  assert.deepEqual(v.problems, []);
  assert.deepEqual(v.unit.logins, ['example-river-gh']);
});

test('record: unit validation errors', () => {
  assert.match(errs(unit({ id: 'Example_River' })), /lowercase letters/);
  assert.match(errs(unit({}), 'example-delta'), /must equal the filename "example-delta"/);
  assert.match(errs(unit({ kind: 'dao' })), /kind must be participant or unit/);
  assert.match(errs(unit({ founding_function: '' })), /founding_function must be a non-empty string/);
  assert.match(errs(unit({ speaks_for: [] })), /speaks_for must be a non-empty list/);
  assert.match(errs(unit({ speaks_for: ['https://gitlab.com/x'] })), /must be https:\/\/github.com\/<login>/);
  assert.match(errs(unit({ speaks_for: ['https://github.com/-bad'] })), /must be https:\/\/github.com\/<login>/);
  assert.match(errs(unit({ speaks_for: ['https://github.com/a-gh', 'https://github.com/b-gh'] })), /participant lists exactly one/);
  assert.match(errs(unit({ work: [] })), /work must be a non-empty list/);
  assert.match(errs(unit({ work: ['http://example.org'] })), /must be an https URL/);
  assert.match(errs(unit({ joined: '2026-13' })), /joined must be null or YYYY-MM/);
  assert.match(errs(unit({ treasury: 1 })), /unknown key "unit.treasury"/);
  const missing = unit({});
  delete missing.unit.work;
  assert.match(errs(missing), /missing key "unit.work"/);
  assert.match(errs({ schema_version: 2, unit: unit({}).unit }), /schema_version must be 1/);
  assert.match(errs({ schema_version: 1, unit: unit({}).unit, extra: 1 }), /unknown top-level key "extra"/);
});

test('record: a unit group may list several speakers', () => {
  const v = validateUnit(unit({ id: 'example-delta', kind: 'unit', speaks_for: ['https://github.com/a-gh', 'https://github.com/B-gh'] }), 'u.yml', 'example-delta');
  assert.deepEqual(v.problems, []);
  assert.deepEqual(v.unit.logins, ['a-gh', 'b-gh']);
});

test('record: loads the basic fixture, skipping TEMPLATE files', () => {
  const dir = tmpCopy('basic');
  const rec = loadRecord(dir);
  assert.deepEqual(rec.problems, []);
  assert.deepEqual([...rec.units.keys()].sort(), ['example-cedar', 'example-delta', 'example-river']);
  assert.deepEqual(rec.assemblies.map((a) => a.cycle), ['2026-01', '2026-02', '2026-03']);
  assert.equal(rec.requests.length, 1);
  assert.equal(rec.requests[0].from, 'example-delta');
  assert.equal(rec.units.get('example-river').founding_function, 'A fictional participant used only by the tests, with a folded description.');
});

test('record: the real empty record loads without problems', () => {
  const rec = loadRecord(ROOT);
  assert.deepEqual(rec.problems, []);
  assert.equal(rec.units.size, 0);
  assert.equal(rec.assemblies.length, 0);
  assert.equal(rec.requests.length, 0);
  assert.ok(rec.parameters);
});

test('record: bad files are reported, not thrown', () => {
  const dir = tmpCopy('basic');
  write(dir, 'federation/units/example-broken.yml', 'schema_version: 1\nunit: {id: x}\n');
  write(dir, 'federation/units/notes.txt', 'x');
  write(dir, 'federation/assemblies/2026-4.md', '# Assembly 2026-04\n');
  write(dir, 'federation/requests/2-incomplete.md', '# Request 2\n\n**From:** `example-river`\n\n## 1. What was tried first\n\n\n## 2. What this serves\n\nx\n');
  const rec = loadRecord(dir);
  const p = rec.problems.join('\n');
  assert.match(p, /example-broken\.yml:2: flow collections/);
  assert.match(p, /notes\.txt: unexpected file/);
  assert.match(p, /2026-4\.md: unexpected file/);
  assert.match(p, /2-incomplete\.md: "## 1\. What was tried first" has no text/);
  assert.match(p, /2-incomplete\.md: missing heading "## 5\. How it will be evidenced"/);
});

test('record: request structure', () => {
  const ok = read(FIX + '/basic', 'federation/requests/1-example-tooling.md');
  assert.deepEqual(parseRequest(ok, 'r.md').problems, []);
  assert.match(parseRequest(ok.replace('**From:** `example-delta`', '**From:** example-delta'), 'r.md').problems.join(), /\*\*From:\*\* `id`/);
});

test('params: validation and cross-check against the documents', () => {
  const good = { schema_version: 1, parameters: { points_per_function: 1, module_bonus_per_function: 1, quorum_percent: 30, quorum_base: 'active', majority: 'simple', window_days: 7, dormant_after_assemblies: 3 } };
  const v = validateParameters(good, 'p.yml');
  assert.deepEqual(v.problems, []);
  assert.deepEqual(crossCheck(ROOT, v.params), []);
  assert.deepEqual(crossCheck(path.join(FIX, 'basic'), v.params), []);
  const off = Object.assign({}, v.params, { quorum_percent: 40, window_days: 5, dormant_after_assemblies: 13 });
  const p = crossCheck(ROOT, off).join('\n');
  assert.match(p, /daf-000-federation-constitution\.md: expected the phrase "participation of at least 40%" \(quorum_percent = 40 .*found "participation of at least 30%"/);
  assert.match(p, /daf-001-phase-0-github-federation\.md: expected the phrase "fixed window of \*\*five days\*\*" .*found "fixed window of \*\*seven days\*\*"/);
  assert.match(p, /dormant_after_assemblies = 13 cannot be written as a number word/);
  assert.match(crossCheck(ROOT, Object.assign({}, v.params, { quorum_base: 'total' })).join(), /says quorum_base = total/);
  assert.match(validateParameters({ schema_version: 1, parameters: Object.assign({}, good.parameters, { majority: 'two-thirds' }) }, 'p.yml').problems.join(), /majority must be "simple"/);
  assert.match(validateParameters({ schema_version: 1, parameters: { points_per_function: 1 } }, 'p.yml').problems.join(), /missing parameter "quorum_percent"/);
});
