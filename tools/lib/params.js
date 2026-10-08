'use strict';
/**
 * params — the starting values of the transitional federation, read from
 * federation/parameters.yml, and cross-checked against the text of DAF-000 and
 * DAF-001, where the same numbers are written in prose.
 */

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('./yaml-lite');

const PARAMS_FILE = 'federation/parameters.yml';
const DAF_000 = 'dafp/daf-000-federation-constitution.md';
const DAF_001 = 'dafp/daf-001-phase-0-github-federation.md';

const KEYS = ['points_per_function', 'module_bonus_per_function', 'quorum_percent', 'quorum_base',
  'majority', 'window_days', 'dormant_after_assemblies'];

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const numberWord = (n) => (Number.isInteger(n) && n >= 1 && n <= 12 ? WORDS[n] : null);

/** Validate a parsed parameters document. Returns { params, problems }. */
function validateParameters(doc, file) {
  const problems = [];
  const p = (m) => problems.push(file + ': ' + m);
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) { p('expected a map with schema_version and parameters'); return { params: null, problems }; }
  const top = Object.keys(doc);
  for (const k of top) if (k !== 'schema_version' && k !== 'parameters') p('unknown top-level key "' + k + '"');
  if (doc.schema_version !== 1) p('schema_version must be 1');
  const src = doc.parameters;
  if (!src || typeof src !== 'object' || Array.isArray(src)) { p('parameters must be a map'); return { params: null, problems }; }
  for (const k of Object.keys(src)) if (!KEYS.includes(k)) p('unknown parameter "' + k + '"');
  for (const k of KEYS) if (!(k in src)) p('missing parameter "' + k + '"');
  const int = (k, min, max) => {
    if (!(k in src)) return;
    const v = src[k];
    if (!Number.isInteger(v) || v < min || (max != null && v > max)) p(k + ' must be an integer' + (max != null ? ' from ' + min + ' to ' + max : ' of at least ' + min) + ', found ' + JSON.stringify(v));
  };
  int('points_per_function', 1);
  int('module_bonus_per_function', 0);
  int('quorum_percent', 0, 100);
  int('window_days', 1);
  int('dormant_after_assemblies', 1);
  if ('quorum_base' in src && src.quorum_base !== 'active' && src.quorum_base !== 'total') p('quorum_base must be "active" or "total", found ' + JSON.stringify(src.quorum_base));
  if ('majority' in src && src.majority !== 'simple') p('majority must be "simple", found ' + JSON.stringify(src.majority));
  if (problems.length) return { params: null, problems };
  const params = {};
  for (const k of KEYS) params[k] = src[k];
  return { params, problems };
}

/** Load federation/parameters.yml under root. Returns { params, problems }. */
function loadParameters(root) {
  const file = path.join(root, PARAMS_FILE);
  if (!fs.existsSync(file)) return { params: null, problems: [PARAMS_FILE + ': not found'] };
  let doc;
  try { doc = yaml.parse(fs.readFileSync(file, 'utf8'), PARAMS_FILE); } catch (e) { return { params: null, problems: [e.message] }; }
  return validateParameters(doc, PARAMS_FILE);
}

const plural = (n, one, many) => (n === 1 ? one : many);

/**
 * The phrases DAF-000 and DAF-001 must contain for the given parameters.
 * Each entry: { file, phrase | pattern, describe, found() }.
 */
function expectedPhrases(params) {
  const out = [];
  const q = params.quorum_percent;
  out.push({ file: DAF_000, param: 'quorum_percent', value: q, phrase: 'participation of at least ' + q + '%', probe: /participation of at least (\d+)%/ });
  const n = params.points_per_function;
  out.push({ file: DAF_000, param: 'points_per_function', value: n, phrase: 'One delivered function: **' + n + ' ' + plural(n, 'point**', 'points**'), probe: /One delivered function: \*\*(\d+) points?\*\*/ });
  const b = params.module_bonus_per_function;
  out.push({ file: DAF_000, param: 'module_bonus_per_function', value: b, phrase: '**' + b + ' additional ' + plural(b, 'point', 'points') + ' for each function in it**', probe: /\*\*(\d+) additional points? for each function in it\*\*/ });
  const w = numberWord(params.window_days);
  out.push({ file: DAF_001, param: 'window_days', value: params.window_days, phrase: w ? 'fixed window of **' + w + ' ' + plural(params.window_days, 'day', 'days') + '**' : null, probe: /fixed window of \*\*([a-z]+) days?\*\*/ });
  const d = numberWord(params.dormant_after_assemblies);
  out.push({ file: DAF_000, param: 'dormant_after_assemblies', value: params.dormant_after_assemblies, phrase: d ? (params.dormant_after_assemblies === 1 ? 'any of the last ' + d + ' assembly' : 'any of the last ' + d + ' assemblies') : null, probe: /any of the last ([a-z]+) assembl(?:y|ies)/ });
  return out;
}

/**
 * Cross-check the parameters against the documents under root.
 * Returns a list of problems (empty when they agree).
 */
function crossCheck(root, params) {
  const problems = [];
  const texts = {};
  for (const f of [DAF_000, DAF_001]) {
    const file = path.join(root, f);
    if (!fs.existsSync(file)) { problems.push(f + ': not found; the parameters cannot be cross-checked'); continue; }
    texts[f] = fs.readFileSync(file, 'utf8');
  }
  if (problems.length) return problems;
  for (const e of expectedPhrases(params)) {
    const text = texts[e.file];
    if (e.phrase === null) {
      problems.push(PARAMS_FILE + ': ' + e.param + ' = ' + e.value + ' cannot be written as a number word (one to twelve), so it cannot be matched against ' + e.file);
      continue;
    }
    if (text.includes(e.phrase)) continue;
    const m = e.probe.exec(text);
    problems.push(e.file + ': expected the phrase "' + e.phrase + '" (' + e.param + ' = ' + e.value + ' in ' + PARAMS_FILE + '), found ' + (m ? '"' + m[0] + '"' : 'no matching phrase'));
  }
  // DAF-000 §5.3 names the quorum denominator right after the participation floor.
  const base = /participation of at least \d+%\**\s+of active points/.test(texts[DAF_000]);
  if (params.quorum_base === 'active' && !base) {
    problems.push(DAF_000 + ': expected "of active points" after the participation floor (quorum_base = active in ' + PARAMS_FILE + '), found ' + (/of active points/.test(texts[DAF_000]) ? 'it elsewhere but not in §5.3' : 'no such phrase'));
  }
  if (params.quorum_base === 'total' && base) {
    problems.push(DAF_000 + ': the participation floor is stated "of active points", but ' + PARAMS_FILE + ' says quorum_base = total');
  }
  return problems;
}

module.exports = { loadParameters, validateParameters, crossCheck, expectedPhrases, numberWord, KEYS, PARAMS_FILE, DAF_000, DAF_001 };
