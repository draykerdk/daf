'use strict';
/**
 * record — read and validate federation/: unit records, parameters, assembly
 * reports and resource requests. Problems are collected, never thrown, so one
 * broken file does not hide the others.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const yaml = require('./yaml-lite');
const { loadParameters } = require('./params');
const { parseAssembly, ID_RE } = require('./assembly');

const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const UNIT_KEYS = ['id', 'name', 'kind', 'founding_function', 'speaks_for', 'work', 'joined'];
const REQUEST_HEADINGS = ['## 1. What was tried first', '## 2. What this serves', '## 3. What it funds',
  '## 4. The amount, and partial funding', '## 5. How it will be evidenced'];

const skipName = (name) => /^TEMPLATE\./i.test(name) || /^README/i.test(name);

/**
 * CRLF to LF, byte for byte, as git's clean filter does for a text file
 * (.gitattributes: federation/** text eol=lf). A lone CR stays.
 */
function toLf(buf) {
  let n = 0;
  for (let i = 0; i + 1 < buf.length; i++) if (buf[i] === 0x0d && buf[i + 1] === 0x0a) n++;
  if (!n) return buf;
  const out = Buffer.allocUnsafe(buf.length - n);
  let j = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a) continue;
    out[j++] = buf[i];
  }
  return out;
}

/**
 * git blob sha1 of a text file's bytes: sha1("blob <len>\0" + bytes), after
 * CRLF is turned into LF. The object git stores for a text file has LF line
 * endings whatever the checkout has, so a checkout with core.autocrlf=true
 * (the Git for Windows default) gives the same blob, and the same event head,
 * as one with LF.
 */
function gitBlobSha(buf) {
  const b = toLf(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
  const h = crypto.createHash('sha1');
  h.update('blob ' + b.length + '\0');
  h.update(b);
  return h.digest('hex');
}

function listDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && !d.name.startsWith('.') && !skipName(d.name))
    .map((d) => d.name)
    .sort();
}

/** Validate a parsed unit document. Returns { unit, problems }. */
function validateUnit(doc, rel, expectedId) {
  const problems = [];
  const p = (m) => problems.push(rel + ': ' + m);
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) { p('expected a map with schema_version and unit'); return { unit: null, problems }; }
  for (const k of Object.keys(doc)) if (k !== 'schema_version' && k !== 'unit') p('unknown top-level key "' + k + '"');
  if (doc.schema_version !== 1) p('schema_version must be 1');
  const u = doc.unit;
  if (!u || typeof u !== 'object' || Array.isArray(u)) { p('unit must be a map'); return { unit: null, problems }; }
  for (const k of Object.keys(u)) if (!UNIT_KEYS.includes(k)) p('unknown key "unit.' + k + '"');
  for (const k of UNIT_KEYS) if (!(k in u)) p('missing key "unit.' + k + '"');

  if ('id' in u) {
    if (typeof u.id !== 'string' || !ID_RE.test(u.id)) p('unit.id must be lowercase letters, digits and hyphens');
    else if (expectedId !== undefined && u.id !== expectedId) p('unit.id "' + u.id + '" must equal the filename "' + expectedId + '"');
  }
  if ('name' in u && (typeof u.name !== 'string' || !u.name.trim())) p('unit.name must be a non-empty string');
  if ('kind' in u && u.kind !== 'participant' && u.kind !== 'unit') p('unit.kind must be participant or unit');
  if ('founding_function' in u && (typeof u.founding_function !== 'string' || !u.founding_function.trim())) p('unit.founding_function must be a non-empty string');
  const logins = [];
  if ('speaks_for' in u) {
    if (!Array.isArray(u.speaks_for) || !u.speaks_for.length) p('unit.speaks_for must be a non-empty list');
    else {
      for (const s of u.speaks_for) {
        const m = typeof s === 'string' ? /^https:\/\/github\.com\/([^/\s]+)\/?$/.exec(s) : null;
        if (!m || !LOGIN_RE.test(m[1])) p('unit.speaks_for entry ' + JSON.stringify(s) + ' must be https://github.com/<login>');
        else logins.push(m[1].toLowerCase());
      }
      if (new Set(logins).size !== logins.length) p('unit.speaks_for lists the same account twice');
      if (u.kind === 'participant' && u.speaks_for.length !== 1) p('a participant lists exactly one account in speaks_for');
    }
  }
  if ('work' in u) {
    if (!Array.isArray(u.work) || !u.work.length) p('unit.work must be a non-empty list');
    else for (const w of u.work) if (typeof w !== 'string' || !/^https:\/\/\S+$/.test(w)) p('unit.work entry ' + JSON.stringify(w) + ' must be an https URL');
  }
  if ('joined' in u && u.joined !== null && !(typeof u.joined === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(u.joined))) p('unit.joined must be null or YYYY-MM');
  if (problems.length) return { unit: null, problems };
  return {
    unit: {
      id: u.id, name: u.name, kind: u.kind, founding_function: u.founding_function,
      speaks_for: u.speaks_for.slice(), logins, work: u.work.slice(), joined: u.joined
    },
    problems
  };
}

/** Parse a request file: structure only. */
function parseRequest(text, rel) {
  const problems = [];
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  const from = /\*\*From:\*\*\s*`([^`]*)`/.exec(text);
  let fromId = null;
  if (!from) problems.push(rel + ': the header line must have **From:** `id`');
  else if (!ID_RE.test(from[1])) problems.push(rel + ': **From:** `' + from[1] + '` is not a valid id');
  else fromId = from[1];
  for (const h of REQUEST_HEADINGS) {
    const i = lines.findIndex((l) => l.trim() === h);
    if (i < 0) { problems.push(rel + ': missing heading "' + h + '"'); continue; }
    let j = i + 1;
    const body = [];
    for (; j < lines.length && !/^##\s/.test(lines[j]); j++) body.push(lines[j]);
    if (!body.join('\n').trim()) problems.push(rel + ': "' + h + '" has no text');
  }
  return { from: fromId, problems };
}

/**
 * loadRecord(root) -> { root, units: Map id -> unit, parameters, assemblies (by
 * cycle), requests, problems, warnings }.
 */
function loadRecord(root, opts) {
  opts = opts || {};
  root = path.resolve(root);
  const fed = path.join(root, 'federation');
  const problems = [];
  const warnings = [];
  const record = { root, units: new Map(), parameters: null, assemblies: [], requests: [], problems, warnings };
  if (!fs.existsSync(fed)) { problems.push('federation/: not found under ' + root); return record; }

  const pr = loadParameters(root);
  record.parameters = pr.params;
  problems.push(...pr.problems);

  // Units.
  for (const name of listDir(path.join(fed, 'units'))) {
    const rel = 'federation/units/' + name;
    if (!/\.yml$/.test(name)) { problems.push(rel + ': unexpected file; unit records are <id>.yml'); continue; }
    const raw = fs.readFileSync(path.join(fed, 'units', name));
    let doc;
    try { doc = yaml.parse(raw.toString('utf8'), rel); } catch (e) { problems.push(e.message); continue; }
    const v = validateUnit(doc, rel, name.replace(/\.yml$/, ''));
    problems.push(...v.problems);
    if (v.unit) {
      v.unit.file = rel;
      v.unit.raw = raw;
      v.unit.blob = gitBlobSha(raw);
      record.units.set(v.unit.id, v.unit);
    }
  }

  // Assemblies.
  const seen = new Map();
  for (const name of listDir(path.join(fed, 'assemblies'))) {
    const rel = 'federation/assemblies/' + name;
    const m = /^(\d{4}-(0[1-9]|1[0-2]))\.md$/.exec(name);
    if (!m) { problems.push(rel + ': unexpected file; assembly reports are YYYY-MM.md'); continue; }
    const raw = fs.readFileSync(path.join(fed, 'assemblies', name));
    const a = parseAssembly(raw.toString('utf8'), { file: rel, params: record.parameters });
    if (a.cycle && a.cycle !== m[1]) a.problems.push(rel + ': the title says assembly ' + a.cycle + ' but the file is ' + name);
    a.cycle = m[1];
    a.raw = raw;
    a.blob = gitBlobSha(raw);
    if (seen.has(a.cycle)) problems.push(rel + ': a second report for cycle ' + a.cycle + ' (also ' + seen.get(a.cycle) + ')');
    seen.set(a.cycle, rel);
    record.assemblies.push(a);
  }
  record.assemblies.sort((x, y) => (x.cycle < y.cycle ? -1 : x.cycle > y.cycle ? 1 : 0));

  // Requests.
  for (const name of listDir(path.join(fed, 'requests'))) {
    const rel = 'federation/requests/' + name;
    const m = /^(\d+)-[a-z0-9]+(-[a-z0-9]+)*\.md$/.exec(name);
    if (!m) { problems.push(rel + ': unexpected file; requests are <n>-<name>.md'); continue; }
    const raw = fs.readFileSync(path.join(fed, 'requests', name));
    const r = parseRequest(raw.toString('utf8'), rel);
    problems.push(...r.problems);
    record.requests.push({ file: rel, path: 'requests/' + name, n: parseInt(m[1], 10), from: r.from, raw, blob: gitBlobSha(raw) });
  }
  return record;
}

/**
 * withReport(record, file, cycle) -> a copy of the record in which the report
 * read from `file` stands as federation/assemblies/<cycle>.md, replacing or
 * adding it. In memory only: nothing on disk changes. Units, parameters,
 * requests and the other assemblies stay those of `record`.
 */
function withReport(record, file, cycle) {
  let raw;
  try { raw = fs.readFileSync(file); } catch (e) { throw new Error('cannot read the report ' + file + ': ' + e.message); }
  const rel = 'federation/assemblies/' + cycle + '.md';
  const a = parseAssembly(raw.toString('utf8'), { file: rel, params: record.parameters });
  if (a.cycle && a.cycle !== cycle) a.problems.push(rel + ': the title says assembly ' + a.cycle + ' but the report is read as ' + cycle);
  a.cycle = cycle;
  a.raw = raw;
  a.blob = gitBlobSha(raw);
  const assemblies = record.assemblies.filter((x) => x.cycle !== cycle).concat([a]);
  assemblies.sort((x, y) => (x.cycle < y.cycle ? -1 : x.cycle > y.cycle ? 1 : 0));
  return Object.assign({}, record, { assemblies });
}

module.exports = { loadRecord, withReport, validateUnit, parseRequest, gitBlobSha, toLf, LOGIN_RE, REQUEST_HEADINGS, skipName };
