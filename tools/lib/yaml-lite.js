'use strict';
/**
 * yaml-lite — a strict YAML subset, enough for federation/units/*.yml and
 * federation/parameters.yml. Anything outside the subset is rejected with
 * `file:line: message` rather than guessed at.
 *
 * Supported: comments (full-line, and trailing after whitespace outside quotes),
 * block maps nested by 2-space indentation, block sequences of scalars, plain,
 * single- and double-quoted scalars (\" \\ \n escapes), null/~, integers,
 * true/false, folded (> >-) and literal (| |-) block scalars, the empty list [].
 *
 * Rejected: tabs, flow collections, anchors/aliases, tags, multiple documents,
 * duplicate keys, sequences of maps, nested sequences, multi-line plain or
 * quoted scalars.
 */

class YamlError extends Error {
  constructor(file, line, message) {
    super(file + ':' + line + ': ' + message);
    this.file = file;
    this.line = line;
  }
}

const KEY_RE = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)[ ]*:(?:[ ]+(.*)|)$/;

function parse(text, file) {
  file = file || '<input>';
  const fail = (line, message) => { throw new YamlError(file, line, message); };
  if (typeof text !== 'string') text = String(text);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const raw = text.split('\n').map((l) => l.replace(/\r$/, ''));
  raw.forEach((l, i) => { if (l.includes('\t')) fail(i + 1, 'tab characters are not allowed'); });

  // Lines, with their indentation; comment stripping happens per context
  // because '#' inside a block scalar is content.
  const lines = raw.map((l, i) => {
    const indent = l.length - l.replace(/^ +/, '').length;
    return { n: i + 1, raw: l, indent, body: l.slice(indent) };
  });

  let docStarted = false;
  const isBlankOrComment = (ln) => ln.body === '' || ln.body.startsWith('#');

  // Document markers: a single leading '---' is tolerated, nothing else.
  for (const ln of lines) {
    if (isBlankOrComment(ln)) continue;
    if (/^(---|\.\.\.)(\s|$)/.test(ln.raw)) {
      if (!docStarted && ln.raw.startsWith('---') && ln.raw.slice(3).trim() === '') { ln.skip = true; docStarted = true; continue; }
      fail(ln.n, 'multiple documents and document markers are not supported');
    }
    docStarted = true;
  }

  let pos = 0;
  const significant = (from) => {
    for (let i = from; i < lines.length; i++) {
      if (lines[i].skip || isBlankOrComment(lines[i])) continue;
      return i;
    }
    return -1;
  };

  // Strip a trailing comment from a plain/quoted value: '#' preceded by
  // whitespace and outside quotes.
  const stripComment = (s) => {
    let q = null;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q === '"') {
        if (c === '\\') { i++; continue; }
        if (c === '"') q = null;
      } else if (q === "'") {
        if (c === "'") { if (s[i + 1] === "'") { i++; continue; } q = null; }
      } else if ((c === '"' || c === "'") && (i === 0 || /\s/.test(s[i - 1]))) {
        q = c;
      } else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) {
        return s.slice(0, i).replace(/\s+$/, '');
      }
    }
    return s.replace(/\s+$/, '');
  };

  const scalar = (value, n) => {
    const s = stripComment(value);
    if (s === '') return null;
    if (s === '[]') return [];
    const c = s[0];
    if (c === '[' || c === '{') fail(n, 'flow collections are not supported');
    if (c === '&' || c === '*') fail(n, 'anchors and aliases are not supported');
    if (c === '!') fail(n, 'tags are not supported');
    if (c === '%' || c === '@' || c === '`') fail(n, 'reserved indicator "' + c + '" at the start of a scalar');
    if (c === '"') {
      let out = '';
      let i = 1;
      for (; i < s.length; i++) {
        const ch = s[i];
        if (ch === '\\') {
          const e = s[i + 1];
          if (e === '"') out += '"';
          else if (e === '\\') out += '\\';
          else if (e === 'n') out += '\n';
          else fail(n, 'unsupported escape \\' + (e === undefined ? '' : e));
          i++;
        } else if (ch === '"') break;
        else out += ch;
      }
      if (i >= s.length) fail(n, 'unterminated double-quoted scalar (multi-line quoted scalars are not supported)');
      if (s.slice(i + 1).trim() !== '') fail(n, 'unexpected text after a quoted scalar');
      return out;
    }
    if (c === "'") {
      let out = '';
      let i = 1;
      for (; i < s.length; i++) {
        const ch = s[i];
        if (ch === "'") {
          if (s[i + 1] === "'") { out += "'"; i++; continue; }
          break;
        }
        out += ch;
      }
      if (i >= s.length) fail(n, 'unterminated single-quoted scalar (multi-line quoted scalars are not supported)');
      if (s.slice(i + 1).trim() !== '') fail(n, 'unexpected text after a quoted scalar');
      return out;
    }
    if (c === '|' || c === '>') fail(n, 'block scalars are only supported as map values');
    if (/^-( |$)/.test(s)) fail(n, 'a sequence entry is not allowed here');
    if (/:( |$)/.test(s)) fail(n, 'a map is not allowed inside a plain scalar (quote the value)');
    if (/^(null|Null|NULL|~)$/.test(s)) return null;
    if (/^(true|True|TRUE)$/.test(s)) return true;
    if (/^(false|False|FALSE)$/.test(s)) return false;
    if (/^[-+]?[0-9]+$/.test(s)) {
      const v = Number(s);
      if (!Number.isSafeInteger(v)) fail(n, 'integer out of range');
      return v;
    }
    return s;
  };

  const blockScalar = (header, parentIndent, n) => {
    const m = /^([|>])([-+]?)$/.exec(stripComment(header));
    if (!m) fail(n, 'unsupported block scalar header "' + header + '"');
    if (m[2] === '+') fail(n, 'keep chomping (+) is not supported');
    const folded = m[1] === '>';
    const strip = m[2] === '-';
    const content = [];
    let contentIndent = -1;
    let i = pos;
    for (; i < lines.length; i++) {
      const ln = lines[i];
      if (ln.raw.trim() === '') { content.push(null); continue; }
      if (ln.indent <= parentIndent) break;
      if (contentIndent < 0) contentIndent = ln.indent;
      if (ln.indent < contentIndent) fail(ln.n, 'block scalar line is less indented than its first line');
      if (folded && ln.indent > contentIndent) fail(ln.n, 'more-indented lines in a folded scalar are not supported');
      content.push(ln.raw.slice(contentIndent));
    }
    // Trailing blank lines belong to chomping, not to the next node.
    let end = content.length;
    while (end > 0 && content[end - 1] === null) end--;
    pos = i - (content.length - end);
    const body = content.slice(0, end).map((l) => (l === null ? '' : l));
    let out;
    if (folded) {
      out = '';
      let started = false;
      let pending = 0;
      for (const l of body) {
        if (l === '') { pending++; continue; }
        if (!started) { out = '\n'.repeat(pending) + l; started = true; }
        else if (pending > 0) out += '\n'.repeat(pending) + l;
        else out += ' ' + l;
        pending = 0;
      }
    } else {
      out = body.join('\n');
    }
    if (!strip && body.length) out += '\n';
    return out;
  };

  const parseSeq = (indent) => {
    const out = [];
    for (;;) {
      const i = significant(pos);
      if (i < 0) break;
      const ln = lines[i];
      if (ln.indent < indent) break;
      if (ln.indent > indent) fail(ln.n, 'unexpected indentation');
      if (!/^-( |$)/.test(ln.body)) break;
      pos = i + 1;
      const rest = ln.body.slice(1).replace(/^ +/, '');
      const v = stripComment(rest);
      if (v === '') fail(ln.n, 'empty or nested sequence entries are not supported');
      if (/^-( |$)/.test(v)) fail(ln.n, 'nested sequences are not supported');
      if (KEY_RE.test(v) && !/^["']/.test(v)) fail(ln.n, 'sequences of maps are not supported');
      if (/^[|>]/.test(v)) fail(ln.n, 'block scalars inside sequences are not supported');
      out.push(scalar(rest, ln.n));
      const next = significant(pos);
      if (next >= 0 && lines[next].indent > indent) fail(lines[next].n, 'unexpected indentation (multi-line plain scalars are not supported)');
    }
    return out;
  };

  const parseMap = (indent) => {
    const out = {};
    for (;;) {
      const i = significant(pos);
      if (i < 0) break;
      const ln = lines[i];
      if (ln.indent < indent) break;
      if (ln.indent > indent) fail(ln.n, 'unexpected indentation');
      if (/^-( |$)/.test(ln.body)) fail(ln.n, 'a sequence entry is not allowed here');
      if (/^["']/.test(ln.body)) fail(ln.n, 'quoted keys are not supported');
      if (/^[{[]/.test(ln.body)) fail(ln.n, 'flow collections are not supported');
      if (/^[&*!]/.test(ln.body)) fail(ln.n, 'anchors, aliases and tags are not supported');
      if (/^\?( |$)/.test(ln.body)) fail(ln.n, 'complex keys are not supported');
      const m = KEY_RE.exec(ln.body);
      if (!m) fail(ln.n, 'expected "key: value"');
      const key = m[1];
      if (Object.prototype.hasOwnProperty.call(out, key)) fail(ln.n, 'duplicate key "' + key + '"');
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') fail(ln.n, 'reserved key "' + key + '"');
      pos = i + 1;
      const value = m[2] === undefined ? '' : m[2];
      const v = stripComment(value);
      if (/^[|>]/.test(v)) {
        out[key] = blockScalar(v, indent, ln.n);
        continue;
      }
      if (v !== '') {
        out[key] = scalar(value, ln.n);
        const next = significant(pos);
        if (next >= 0 && lines[next].indent > indent) fail(lines[next].n, 'unexpected indentation (multi-line plain scalars are not supported)');
        continue;
      }
      // Nested block, or null.
      const next = significant(pos);
      if (next < 0) { out[key] = null; continue; }
      const nl = lines[next];
      if (nl.indent === indent && /^-( |$)/.test(nl.body)) { out[key] = parseSeq(indent); continue; }
      if (nl.indent <= indent) { out[key] = null; continue; }
      if (nl.indent !== indent + 2) fail(nl.n, 'nested blocks must be indented by exactly 2 spaces');
      if (/^-( |$)/.test(nl.body)) out[key] = parseSeq(nl.indent);
      else out[key] = parseMap(nl.indent);
    }
    return out;
  };

  const first = significant(0);
  if (first < 0) return null;
  if (lines[first].indent !== 0) fail(lines[first].n, 'the document must start at column 0');
  pos = first;
  let result;
  if (/^-( |$)/.test(lines[first].body)) result = parseSeq(0);
  else if (KEY_RE.test(stripComment(lines[first].body)) || /^["'{[&*!?]/.test(lines[first].body)) result = parseMap(0);
  else {
    pos = first + 1;
    result = scalar(lines[first].body, lines[first].n);
  }
  const rest = significant(pos);
  if (rest >= 0) fail(lines[rest].n, 'unexpected content');
  return result;
}

module.exports = { parse, YamlError };
