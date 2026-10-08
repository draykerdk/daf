'use strict';
/**
 * assembly — parse an assembly report (federation/assemblies/YYYY-MM.md) in the
 * layout of federation/assemblies/TEMPLATE.md, and rewrite its vote tables in
 * place. Structure only: nothing here judges whether a delivery is real.
 */

const ISSUE_URL = 'https://github.com/draykerdk/daf/issues/';
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PLACEHOLDER_HOLDERS = new Set(['unit-id', 'example-unit']);

const SECTION_NAMES = {
  'where the federation is': 'where',
  'deliveries': 'deliveries',
  'module completions': 'modules',
  'penalties': 'penalties',
  'new records': 'newRecords',
  'resource decisions': 'resources',
  'the vote': 'vote',
  'votes': 'votes',
  'steward intervention': 'steward',
  'what the federation would change about itself': 'change'
};

const HEADERS = {
  deliveries: ['holder', 'function', 'declared in', 'delivered', 'points'],
  modules: ['holder', 'module', 'functions in it', 'bonus'],
  penalties: ['holder', 'commitment', 'what happened', 'points removed'],
  newRecords: ['holder', 'kind', 'first delivery'],
  resources: ['request', 'asked', 'decision', 'why'],
  votes: ['holder', 'vote', 'weight']
};

const splitLines = (text) => text.split('\n').map((l) => l.replace(/\r$/, ''));

/**
 * Assign every line to a section. Level-2 headings open sections; the bold
 * labels **Module completions** and **Votes** (or a heading of that name, at any
 * level from 2 to 6) open sub-sections.
 */
function scanSections(lines) {
  const sections = [];
  let current = { key: 'head', name: '', start: 0, lines: [] };
  sections.push(current);
  lines.forEach((line, i) => {
    let name = null;
    let m = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (m && !/^###/.test(line)) name = m[1];
    if (!name) {
      m = /^#{3,6}\s+(module completions|votes)\s*$/i.exec(line) || /^\*\*(module completions|votes)\*\*\s*$/i.exec(line.trim());
      if (m) name = m[1];
    }
    if (name !== null) {
      const key = SECTION_NAMES[name.toLowerCase()] || 'other:' + name;
      current = { key, name, start: i, heading: i, lines: [] };
      sections.push(current);
      return;
    }
    current.lines.push({ i, text: line });
  });
  return sections;
}

/** Split a markdown table row into trimmed cells, honouring escaped pipes. */
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

const isSeparator = (cells) => cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));

/** The table blocks inside a section: runs of consecutive lines starting with '|'. */
function tableBlocks(section) {
  const blocks = [];
  let cur = null;
  for (const l of section.lines) {
    if (l.text.trim().startsWith('|')) {
      if (!cur) { cur = { start: l.i, end: l.i + 1, rows: [] }; blocks.push(cur); }
      cur.end = l.i + 1;
      cur.rows.push(l);
    } else cur = null;
  }
  return blocks;
}

const stripTicks = (s) => String(s || '').replace(/`/g, '').trim();
const normMinus = (s) => String(s).replace(/−/g, '-');

/**
 * An integer cell: digits with an optional sign (U+2212 accepted), or null. A
 * value outside the safe integer range is null too: it cannot be summed or
 * written back exactly.
 */
function parseIntCell(cell) {
  const s = normMinus(stripTicks(cell)).replace(/\*\*/g, '').trim();
  if (!/^[+-]?\d+$/.test(s)) return null;
  const n = parseInt(s, 10);
  return Number.isSafeInteger(n) ? n : null;
}

/** Why an integer cell was rejected, for the problem message. */
function intCellError(cell) {
  const s = normMinus(stripTicks(cell)).replace(/\*\*/g, '').trim();
  return /^[+-]?\d+$/.test(s) ? 'is outside the safe integer range' : 'is not an integer';
}

/** Strip trailing '.' and unbalanced ')' from a bare URL. */
function trimUrl(u) {
  for (;;) {
    if (u.endsWith('.')) { u = u.slice(0, -1); continue; }
    if (u.endsWith(')') && (u.match(/\(/g) || []).length < (u.match(/\)/g) || []).length) { u = u.slice(0, -1); continue; }
    return u;
  }
}

/**
 * Replace markdown links [label](target) by placeholder tokens. The target may
 * hold balanced parentheses and no whitespace. Returns { text, links }.
 */
function replaceLinks(s) {
  const links = [];
  let out = '';
  let i = 0;
  const re = /\[([^\]]*)\]\(/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const start = m.index + m[0].length;
    let depth = 0;
    let end = -1;
    for (let j = start; j < s.length; j++) {
      const c = s[j];
      if (/\s/.test(c)) break;
      if (c === '(') depth++;
      else if (c === ')') { if (depth === 0) { end = j; break; } depth--; }
    }
    if (end < 0) continue;
    out += s.slice(i, m.index) + ' \u0000' + links.length + ' ';
    links.push({ all: s.slice(m.index, end + 1), url: s.slice(start, end) });
    i = end + 1;
    re.lastIndex = end + 1;
  }
  return { text: out + s.slice(i), links };
}

/**
 * Extract evidence references from a cell. `#12` becomes an issue URL in
 * draykerdk/daf, markdown links give their URL, bare URLs are kept. Only https
 * URLs are kept; anything else is returned in `bad`. In a strict cell every
 * token must be a reference; in prose, words are ignored.
 */
function extractRefs(cell, strict) {
  const urls = [];
  const bad = [];
  // Markdown links become placeholder tokens so references keep their order.
  const { text: s, links } = replaceLinks(stripTicks(cell));
  for (let tok of s.split(/[\s,;]+/)) {
    if (!tok) continue;
    const ph = /^\u0000(\d+)$/.exec(tok);
    if (ph) {
      const l = links[+ph[1]];
      if (/^https:\/\/\S+$/.test(l.url)) urls.push(l.url);
      else bad.push(l.url || l.all);
      continue;
    }
    const auto = /^<(.+)>$/.exec(tok);
    if (auto) tok = auto[1];
    if (/^#\d+$/.test(tok)) { urls.push(ISSUE_URL + String(parseInt(tok.slice(1), 10))); continue; }
    if (/^https:\/\/\S+$/.test(tok)) { urls.push(trimUrl(tok)); continue; }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(tok)) { bad.push(tok); continue; }
    if (strict) bad.push(tok);
  }
  return { urls, bad };
}

const isValidDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/**
 * Parse an assembly report. Never throws on content; everything wrong is in
 * `problems` (errors for `check`) or `warnings`.
 */
function parseAssembly(text, opts) {
  opts = opts || {};
  const file = opts.file || '<assembly>';
  const lines = splitLines(text);
  const problems = [];
  const warnings = [];
  const placeholders = [];
  const at = (i) => file + ':' + (i + 1);
  const problem = (i, m) => problems.push(at(i) + ': ' + m);

  const out = {
    cycle: null, file, window: null, cycleIssue: null,
    deliveries: [], modules: [], penalties: [], newRecords: [], resources: [],
    vote: { active: null, cast: null, participation: null, for: null, against: null, abstain: null, outcome: null, outcomeRaw: null, baseLabel: null, rows: {} },
    votes: [], steward: null, prose: { where: '', change: '' },
    placeholders, problems, warnings, todo: []
  };

  // Title.
  const titleIdx = lines.findIndex((l) => /^#\s+/.test(l));
  if (titleIdx < 0) problems.push(file + ': no "# Assembly YYYY-MM" title');
  else {
    const m = /^#\s+Assembly\s+(\S+)\s*$/.exec(lines[titleIdx]);
    if (!m) problem(titleIdx, 'the title must be "# Assembly YYYY-MM"');
    else if (m[1] === 'YYYY-MM') { placeholders.push({ section: 'title', line: titleIdx + 1 }); problem(titleIdx, 'the title still holds the placeholder YYYY-MM'); }
    else if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m[1])) problem(titleIdx, 'the title cycle "' + m[1] + '" is not YYYY-MM');
    else out.cycle = m[1];
  }

  // Window and cycle issue.
  const winIdx = lines.findIndex((l) => /\*\*Window:\*\*/.test(l));
  if (winIdx >= 0) {
    const l = lines[winIdx];
    const m = /\*\*Window:\*\*\s*opens\s+([0-9Y]{4}-[0-9M]{2}-[0-9D]{2})\s*[,·]\s*closes\s+([0-9Y]{4}-[0-9M]{2}-[0-9D]{2})(?![0-9])/.exec(l);
    if (!m) problem(winIdx, 'the Window line must read "opens YYYY-MM-DD, closes YYYY-MM-DD"');
    else if (m[1] === 'YYYY-MM-DD' || m[2] === 'YYYY-MM-DD') { placeholders.push({ section: 'window', line: winIdx + 1 }); problem(winIdx, 'the Window line still holds the placeholder dates'); }
    else if (!isValidDate(m[1]) || !isValidDate(m[2])) problem(winIdx, 'the Window dates are not valid YYYY-MM-DD dates');
    else if (m[2] < m[1]) problem(winIdx, 'the window closes before it opens');
    else out.window = { opens: m[1], closes: m[2] };
    const ci = /\*\*Cycle issue:\*\*\s*#(\S+)/.exec(l);
    if (ci) {
      if (/^\d+$/.test(ci[1])) out.cycleIssue = parseInt(ci[1], 10);
      else if (ci[1] === 'N') { placeholders.push({ section: 'cycle issue', line: winIdx + 1 }); problem(winIdx, 'the cycle issue still holds the placeholder #N'); }
      else problem(winIdx, 'the cycle issue must be #<number>');
    }
    if (out.window && opts.params && opts.params.window_days) {
      const days = Math.round((Date.parse(out.window.closes) - Date.parse(out.window.opens)) / 864e5);
      if (days !== opts.params.window_days) warnings.push(at(winIdx) + ': the window dates are ' + days + ' days apart; parameters.yml says window_days: ' + opts.params.window_days);
    }
  }

  // Template instruction block.
  const copyIdx = lines.findIndex((l) => /^>\s*Copy to `YYYY-MM\.md`/.test(l));
  if (copyIdx >= 0) warnings.push(at(copyIdx) + ': the template instruction block ("Copy to `YYYY-MM.md` ... Delete this block.") is still present');
  lines.forEach((l, i) => { if (/TODO\(person\)/.test(l)) out.todo.push(i + 1); });

  // Sections.
  const sections = scanSections(lines);
  const byKey = {};
  for (const s of sections) {
    if (s.key === 'head' || s.key.startsWith('other:')) continue;
    if (byKey[s.key]) problem(s.start, 'section "' + s.name + '" appears more than once');
    else byKey[s.key] = s;
  }
  for (const k of ['deliveries', 'modules', 'penalties', 'newRecords', 'resources', 'vote', 'votes', 'steward']) {
    if (!byKey[k]) problems.push(file + ': missing section "' + Object.keys(SECTION_NAMES).find((n) => SECTION_NAMES[n] === k) + '"');
  }

  const tableRows = (key, allowExtra) => {
    const s = byKey[key];
    if (!s) return [];
    const blocks = tableBlocks(s);
    if (!blocks.length) { problem(s.start, 'section "' + s.name + '" has no table'); return []; }
    if (blocks.length > 1) problem(blocks[1].start, 'section "' + s.name + '" has more than one table');
    const b = blocks[0];
    const header = splitRow(b.rows[0].text).map((c) => c.toLowerCase());
    const want = HEADERS[key];
    const okHeader = header.length >= want.length && want.every((h, j) => header[j] === h) &&
      (header.length === want.length || (allowExtra && header.length === want.length + allowExtra.length && allowExtra.every((h, j) => header[want.length + j] === h)));
    if (!okHeader) { problem(b.rows[0].i, 'section "' + s.name + '" table header must be | ' + want.join(' | ') + ' |'); return []; }
    if (b.rows.length < 2 || !isSeparator(splitRow(b.rows[1].text))) { problem(b.rows[0].i, 'section "' + s.name + '" table has no separator row'); return []; }
    const rows = [];
    for (const r of b.rows.slice(2)) {
      const cells = splitRow(r.text);
      if (cells.length !== header.length) { problem(r.i, 'expected ' + header.length + ' cells, found ' + cells.length); continue; }
      const first = stripTicks(cells[0]);
      if (PLACEHOLDER_HOLDERS.has(first) || (key === 'resources' && /^(federation\/)?requests\/n-name\.md$/.test(first))) {
        placeholders.push({ section: s.name, line: r.i + 1 });
        continue;
      }
      rows.push({ cells, line: r.i + 1, i: r.i });
    }
    return rows;
  };

  const holderOf = (cell, i) => {
    const h = stripTicks(cell);
    if (!ID_RE.test(h)) problem(i, 'holder "' + h + '" is not a valid id');
    return h;
  };
  const oneRef = (cell, i, what) => {
    const r = extractRefs(cell, true);
    for (const b of r.bad) problem(i, what + ': "' + b + '" is not an https URL or #n reference');
    if (r.urls.length !== 1) { if (!r.bad.length) problem(i, what + ' must hold exactly one reference, found ' + r.urls.length); return r.urls[0] || null; }
    return r.urls[0];
  };

  for (const r of tableRows('deliveries')) {
    const [h, fn, decl, deliv, pts] = r.cells;
    const points = parseIntCell(pts);
    if (points === null) problem(r.i, 'points "' + pts + '" ' + intCellError(pts));
    out.deliveries.push({ holder: holderOf(h, r.i), function: fn, declared: oneRef(decl, r.i, 'Declared in'), delivered: oneRef(deliv, r.i, 'Delivered'), points, line: r.line });
  }
  for (const r of tableRows('modules')) {
    const [h, mod, fns, bonus] = r.cells;
    const refs = extractRefs(fns, true);
    for (const b of refs.bad) problem(r.i, 'Functions in it: "' + b + '" is not an https URL or #n reference');
    if (!refs.urls.length) problem(r.i, 'a module must list the functions in it');
    const b = parseIntCell(bonus);
    if (b === null) problem(r.i, 'bonus "' + bonus + '" ' + intCellError(bonus));
    out.modules.push({ holder: holderOf(h, r.i), module: mod, functions: refs.urls, bonus: b, line: r.line });
  }
  for (const r of tableRows('penalties')) {
    const [h, commitment, what, pts] = r.cells;
    const points = parseIntCell(pts);
    if (points === null) problem(r.i, 'points removed "' + pts + '" ' + intCellError(pts));
    else if (points >= 0) problem(r.i, 'points removed must be negative, found ' + points);
    const refs = extractRefs(commitment, false);
    for (const b of refs.bad) problem(r.i, 'Commitment: "' + b + '" is not an https URL or #n reference');
    if (!refs.urls.length) problem(r.i, 'a penalty must link the commitment it answers to');
    out.penalties.push({ holder: holderOf(h, r.i), commitment, commitmentRefs: refs.urls, what, points, line: r.line });
  }
  for (const r of tableRows('newRecords')) {
    const [h, kind, first] = r.cells;
    const k = stripTicks(kind).toLowerCase();
    if (k !== 'participant' && k !== 'unit') problem(r.i, 'kind must be participant or unit, found "' + kind + '"');
    out.newRecords.push({ holder: holderOf(h, r.i), kind: k, first: oneRef(first, r.i, 'First delivery'), line: r.line });
  }
  for (const r of tableRows('resources')) {
    const [req, asked, decision, why] = r.cells;
    let p = stripTicks(req);
    const link = /^\[([^\]]*)\]\(([^)]*)\)$/.exec(p);
    if (link) p = stripTicks(link[1]);
    p = p.replace(/^federation\//, '');
    if (!/^requests\/\d+-[a-z0-9]+(-[a-z0-9]+)*\.md$/.test(p)) problem(r.i, 'request "' + req + '" must be a path requests/<n>-<name>.md');
    const d = stripTicks(decision).toLowerCase();
    if (!['approved', 'returned', 'rejected'].includes(d)) problem(r.i, 'decision must be approved, returned or rejected, found "' + decision + '"');
    out.resources.push({ request: p, asked, decision: d, why, line: r.line });
  }

  // The vote summary.
  if (byKey.vote) {
    const blocks = tableBlocks(byKey.vote);
    if (!blocks.length) problem(byKey.vote.start, 'section "The vote" has no table');
    else {
      for (const r of blocks[0].rows) {
        const c = splitRow(r.text);
        if (c.length < 2) continue;
        const label = c[0].replace(/\*\*/g, '').trim().toLowerCase();
        const val = c[1].replace(/\*\*/g, '').trim();
        const nat = (x) => { if (!/^\d+$/.test(x)) return null; const k = parseInt(x, 10); return Number.isSafeInteger(k) ? k : null; };
        const n = nat(val);
        const isN = /^n$/i.test(val);
        // Every summary row is kept with its raw value and line, so `check` can
        // say which row is missing or not a number.
        const keep = (key) => {
          if (out.vote.rows[key]) problem(r.i, 'the vote table has a second "' + c[0].replace(/\*\*/g, '').trim() + '" row');
          out.vote.rows[key] = { label, value: val, line: r.i + 1 };
        };
        if (label === 'active points' || label === 'total points') { keep('base'); out.vote.active = n; out.vote.baseLabel = label; if (isN) out.vote.placeholder = true; }
        else if (label === 'votes cast') { keep('cast'); out.vote.cast = n; if (isN) out.vote.placeholder = true; }
        else if (label === 'participation') { keep('participation'); out.vote.participation = val; if (/^n%/.test(val)) out.vote.placeholder = true; }
        else if (label === 'for / against / abstain') {
          keep('split');
          const m = /^(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)$/.exec(val);
          if (m && [m[1], m[2], m[3]].every((x) => nat(x) !== null)) { out.vote.for = nat(m[1]); out.vote.against = nat(m[2]); out.vote.abstain = nat(m[3]); }
          else if (/^n\s*\/\s*n\s*\/\s*n$/i.test(val)) out.vote.placeholder = true;
          else problem(r.i, 'For / against / abstain must read "a / b / c"');
        } else if (label === 'outcome') {
          keep('outcome');
          out.vote.outcomeRaw = val;
          out.vote.outcomeLine = r.i + 1;
          const v = val.toLowerCase();
          if (v === 'passed' || v === 'failed' || v === 'pending') out.vote.outcome = v;
          else if (v === 'passed / failed') out.vote.outcome = 'pending';
          else problem(r.i, 'outcome must be passed, failed or pending, found "' + val + '"');
        }
      }
      if (out.vote.outcomeRaw === null) problem(blocks[0].start, 'the vote table has no **Outcome** line');
    }
  }
  for (const r of tableRows('votes', ['share'])) {
    const [h, v, w] = r.cells;
    const vote = stripTicks(v).toLowerCase();
    if (!['for', 'against', 'abstain'].includes(vote)) problem(r.i, 'vote must be for, against or abstain, found "' + v + '"');
    const weight = parseIntCell(w);
    if (weight === null || weight < 0) problem(r.i, 'weight "' + w + '" is not a non-negative safe integer');
    out.votes.push({ holder: holderOf(h, r.i), vote, weight, line: r.line });
  }

  // Steward intervention: the template's guidance blockquote is not the text.
  if (byKey.steward) {
    const body = byKey.steward.lines.filter((l) => !/^\s*>/.test(l.text)).map((l) => l.text).join('\n').trim();
    if (body === 'None.' || body === 'None') out.steward = { none: true };
    else if (body === '') problem(byKey.steward.start, 'the steward intervention section is empty; write "None." when there was none');
    else {
      const refs = extractRefs(body, false);
      for (const b of refs.bad) problem(byKey.steward.start, 'Steward intervention: "' + b + '" is not an https URL or #n reference');
      out.steward = { text: body, links: refs.urls };
    }
  }

  const prose = (key) => (byKey[key] ? byKey[key].lines.map((l) => l.text).join('\n').trim() : '');
  out.prose.where = prose('where');
  out.prose.change = prose('change');
  if (!byKey.where) warnings.push(file + ': no "Where the federation is" section');
  if (!byKey.change) warnings.push(file + ': no "What the federation would change about itself" section');

  return out;
}

/**
 * Rewrite only the "## The vote" summary table and the "**Votes**" table of a
 * report, preserving every other byte. `summary` and `votes` are arrays of
 * complete table lines (header and separator included).
 */
function renderAssemblyVote(text, summary, votes) {
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const lines = splitLines(text);
  const sections = scanSections(lines);
  const vote = sections.find((s) => s.key === 'vote');
  const vs = sections.find((s) => s.key === 'votes');
  if (!vote) throw new Error('the report has no "## The vote" section');
  if (!vs) throw new Error('the report has no "**Votes**" label');
  const vb = tableBlocks(vote)[0];
  if (!vb) throw new Error('the "## The vote" section has no table');
  const edits = [];
  edits.push({ start: vb.start, end: vb.end, lines: summary });
  const tb = tableBlocks(vs)[0];
  if (tb) edits.push({ start: tb.start, end: tb.end, lines: votes });
  else edits.push({ start: vs.heading + 1, end: vs.heading + 1, lines: [''].concat(votes) });
  edits.sort((a, b) => b.start - a.start);
  // Keep the file's own line breaks, including a final one or its absence.
  const parts = text.split('\n');
  for (const e of edits) parts.splice(e.start, e.end - e.start, ...e.lines.map((l) => l + (eol === '\r\n' ? '\r' : '')));
  return parts.join('\n');
}

module.exports = { parseAssembly, renderAssemblyVote, extractRefs, scanSections, splitRow, tableBlocks, parseIntCell, intCellError, ISSUE_URL, ID_RE, PLACEHOLDER_HOLDERS, HEADERS };
