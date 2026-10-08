#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks += 1; };

check(html.includes('<html lang="en">'), 'The federation interface must declare English.');
check(!html.includes('federation, running on a repository'), 'The title must not imply that an assembly has run.');
check(html.includes('no assembly held yet'), 'The home metadata must describe the operational state.');
check(!fs.existsSync(path.join(root, 'README.PT.md')), 'The repository must not publish a second canonical README.');
check(html.includes('button:focus-visible,a:focus-visible,[role="button"]:focus-visible'), 'Interactive controls need a visible focus treatment.');
check(html.includes('<a href="#/" onClick="{{ goHome }}" aria-label="DAF home"'), 'The logo must be a semantic home link.');
check(html.includes('<button type="button" onClick="{{ toggleTheme }}" aria-label='), 'The theme control must be a named button.');
check(html.includes('<a href="{{ item.href }}" onClick="{{ item.onClick }}"'), 'Navigation items must expose real href values.');
check(!/<div(?![^>]*role="button")(?![^>]*tabindex="0")[^>]*onClick=/i.test(html), 'Generic click controls must expose keyboard semantics.');
check(html.includes("document.addEventListener('keydown', this.onActionKey)"), 'Keyboard activation must be installed.');
check(html.includes("document.removeEventListener('keydown', this.onActionKey)"), 'Keyboard activation must be cleaned up.');

for (const file of ['claim.yml', 'cycle.yml', 'resource-request.yml']) {
  const body = fs.readFileSync(path.join(root, '.github', 'ISSUE_TEMPLATE', file), 'utf8');
  check(/name:\s+\S/.test(body), `${file} needs a name.`);
  check(/body:\s*\n/.test(body), `${file} needs a body.`);
  check(/required:\s*true/.test(body), `${file} needs required input.`);
}

for (const file of [
  'federation/units/TEMPLATE.yml',
  'federation/requests/TEMPLATE.md',
  'federation/assemblies/TEMPLATE.md'
]) check(fs.existsSync(path.join(root, file)), `${file} must exist.`);

for (const file of ['README.md', 'federation/README.md', 'dafp/daf-000-federation-constitution.md', 'dafp/daf-001-phase-0-github-federation.md']) {
  const body = fs.readFileSync(path.join(root, file), 'utf8');
  check(/language, region or nationality/i.test(body), `${file} must preserve language- and nationality-based units.`);
}

// Voting is described as transitional once, where the vote is introduced.
const TRANSITIONAL = 'Voting is transitional: it holds only until contextual weighing by Dk Global, justified vetoes weighed by their grounds and councils formed for each question can be reproduced and tested, and each one that is replaces part of the vote.';
check(html.split(TRANSITIONAL).length === 2, 'The site must say once, where the vote is introduced, that voting is transitional.');
check(html.includes("DAF_CACHE = 'daf-record-v2'"), 'The record cache key must change with the snapshot shape.');
check(!/slice\(0, 24\)/.test(html), 'Assembly reports must not be capped at 24.');

// The Pages build publishes an explicit list of files, and never tools/ (its
// fixtures are fictional records) nor anything a pull request could run.
const siteWf = fs.readFileSync(path.join(root, '.github', 'workflows', 'federation-site.yml'), 'utf8');
const listOf = (name) => {
  const m = new RegExp('^\\s*' + name + '=\\(([^)]*)\\)', 'm').exec(siteWf);
  return m ? m[1].trim().split(/\s+/) : null;
};
const siteFiles = listOf('SITE_FILES');
const siteDirs = listOf('SITE_DIRS');
check(siteFiles && siteDirs, 'The site workflow must list the published files and folders explicitly.');
check(siteFiles.concat(siteDirs).every((x) => !/^(\.\/)?tools(\/|$)/.test(x) && x !== '.' && x !== '*'), 'The site must never publish tools/.');
check(!/\b(cp|rsync|mv|ln)\b[^\n]*\btools\b/.test(siteWf), 'No copy command in the site workflow may name tools/.');
check(siteFiles.includes('index.html') && siteFiles.includes('support.js'), 'The site must publish the page and its runtime.');
check(/^\s*path:\s*_site\s*$/m.test(siteWf), 'Only _site/ is uploaded to Pages.');
check(!/^\s*(pull_request|pull_request_target)\s*:/m.test(siteWf), 'The site workflow must never run on pull requests.');

const match = html.match(/<script type="text\/x-dc" data-dc-script>([\s\S]*?)<\/script>/);
check(match, 'Component logic script must exist.');

const store = new Map();
const localStorage = {
  getItem: (key) => store.has(key) ? store.get(key) : null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear()
};
const media = { matches: false, addEventListener() {}, removeEventListener() {} };
const windowStub = {
  innerWidth: 1280,
  pageYOffset: 0,
  location: { hash: '', href: '' },
  matchMedia: () => media,
  addEventListener() {},
  removeEventListener() {},
  scrollTo() {}
};
const documentStub = {
  title: '',
  documentElement: { setAttribute() {} },
  head: { querySelector: () => null },
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null
};
class DCLogic {
  setState(update, callback) {
    const next = typeof update === 'function' ? update(this.state) : update;
    this.state = { ...this.state, ...next };
    if (callback) callback();
  }
}
const context = vm.createContext({
  console, Date, JSON, Math, Promise, encodeURIComponent,
  DCLogic, window: windowStub, document: documentStub, localStorage,
  navigator: { clipboard: null }, fetch: async () => { throw new Error('offline'); }
});
vm.runInContext(match[1] + '\n;globalThis.__daf = { Component, ROUTE_META, NAV, safeHref, forumHref };', context, { filename: 'index.html#logic' });
const { Component, ROUTE_META, NAV, safeHref, forumHref } = context.__daf;
check(ROUTE_META.home.d.includes('no assembly held yet'), 'Route metadata must preserve the pre-assembly state.');
check(NAV.length === 7, 'All federation navigation destinations must remain available.');

const makeComponent = () => {
  const component = new Component();
  component.loadDeep = async () => {};
  component.loadCycle = async () => {};
  return component;
};

const idle = makeComponent();
const idleView = idle.renderVals();
check(idleView.dafStats.every((stat) => stat.v === '—'), 'Idle rendering must use safe placeholders.');
check(idleView.nav.every((item) => typeof item.href === 'string'), 'Every navigation item must render an href.');
check(idleView.aCycleUrl.startsWith('https://github.com/draykerdk/daf/issues/new?template=cycle.yml') && !idleView.aCycleUrl.includes('body='),
  'Opening a cycle must go through the cycle issue form.');
check(idleView.states[2].k === 'NOT YET USED' && idleView.footState.includes('with no assembly held yet'), 'Before the record is read, the empty state must stand.');

// Links built from data stay inside the organisation, the generated data and the forum.
check(safeHref('https://github.com/draykerdk/daf/issues/3') === 'https://github.com/draykerdk/daf/issues/3', 'Repository links must render.');
check(safeHref('./data/events.json') === './data/events.json', 'Generated data links must render.');
check(['javascript:alert(1)', 'https://example.test/x', 'https://github.com/other/x', './data/../x', 'https://github.com/draykerdk/x"y', null, 3]
  .every((u) => safeHref(u) === ''), 'Any other link from data must be dropped.');
check(forumHref(12) === 'https://forum.drayker.org/t/daf/12/' && safeHref(forumHref(12)) === forumHref(12), 'Forum links are built from the number and allowed.');
check(forumHref('12') === '' && forumHref(-1) === '' && forumHref(1.5) === '', 'Forum links need a positive integer.');

// Module completions are read from the bold label the report template uses.
const parsed = idle.parseAssembly([
  '# Assembly 2026-09', '', '## Deliveries', '',
  '| Holder | Function | Declared in | Delivered | Points |', '| --- | --- | --- | --- | --- |',
  '| `river` | One | #1 | https://github.com/draykerdk/daf/pull/2 | 1 |', '',
  '**Module completions**', '',
  '| Holder | Module | Functions in it | Bonus |', '| --- | --- | --- | --- |',
  '| `river` | The record | #1, #3 | 2 |', '',
  '## Penalties', '', '| Holder | Commitment | What happened | Points removed |', '| --- | --- | --- | --- |', ''
].join('\n'), { name: '2026-09.md', url: '' });
check(parsed.deliveries.length === 1 && parsed.modules.length === 1 && parsed.modules[0].bonus === 2 && parsed.net.river === 3,
  'Module completions under the bold label must be counted.');

const snapshot = {
  generated: '2026-08-13T00:00:00Z',
  units: [{ name: 'river.yml', url: 'https://example.test/river' }],
  assemblies: [{ name: '2026-08.md', url: 'https://example.test/assembly' }],
  requests: [],
  issues: [{ num: 2, title: 'First assembly', url: 'https://example.test/2', pr: false }]
};

async function loadWith(fetchImpl) {
  store.clear();
  context.fetch = fetchImpl;
  const component = makeComponent();
  await component.loadDAF(true);
  return component;
}

(async () => {
  const live = await loadWith(async (url) => ({
    ok: String(url) === './data/federation.json',
    status: 404,
    json: async () => snapshot
  }));
  check(live.state.dafState === 'ready', 'A valid snapshot must reach ready state.');
  check(live.state.dafData.src === 'snapshot', 'A valid snapshot must be preferred.');
  check(live.renderVals().dafStats[0].v === '1', 'Snapshot unit count must render.');

  const empty = await loadWith(async (url) => ({
    ok: String(url) === './data/federation.json',
    status: 404,
    json: async () => ({ generated: snapshot.generated, units: [], assemblies: [], requests: [], issues: [] })
  }));
  check(empty.state.dafState === 'ready', 'An empty snapshot must reach ready state.');
  check(empty.renderVals().dafStats.every((stat) => stat.v === '0'), 'An empty snapshot must render zero counts.');

  const malformed = await loadWith(async (url) => {
    if (String(url) === './data/federation.json') return { ok: true, json: async () => ({ units: 'invalid' }) };
    throw new Error('offline');
  });
  check(malformed.state.dafState === 'ready', 'A malformed snapshot must fall back safely.');
  check(malformed.state.dafData.src === 'api', 'A malformed snapshot must not be trusted.');

  const offline = await loadWith(async () => { throw new Error('offline'); });
  check(offline.state.dafState === 'ready', 'Network failure must render a safe empty record.');
  check(offline.state.dafData.units.length === 0, 'Offline fallback must expose empty arrays.');
  check(offline.renderVals().dafStats.every((stat) => stat.v === '0'), 'Offline fallback must render without throwing.');

  // The empty snapshot keeps every empty-state sentence.
  const emptyView = empty.renderVals();
  check(emptyView.states[2].k === 'NOT YET USED', 'An empty record must say it is not yet used.');
  check(emptyView.footState.includes('with no assembly held yet'), 'An empty record keeps the footer state.');
  check(empty.metaDesc('home').includes('no assembly held yet'), 'An empty record keeps the home description.');
  check(emptyView.dafSrcLine.includes('THE GENERATED SNAPSHOT') && emptyView.dafSrcLine.includes('GENERATED 2026-08-13 00:00 UTC'),
    'The source line names the generated snapshot and its own time.');
  check(!emptyView.eventsOn && !emptyView.ledgerGenerated, 'Absent optional keys render nothing.');

  // A record with one assembly held, as tools/daf.js snapshot writes it.
  const head = 'ab'.repeat(32);
  const used = await loadWith(async (url) => ({
    ok: String(url) === './data/federation.json',
    status: 404,
    json: async () => ({
      generated: '2026-09-10T08:30:00Z',
      units: [{ name: 'river.yml', url: 'https://github.com/draykerdk/daf/blob/master/federation/units/river.yml' }],
      assemblies: [{ name: '2026-09.md', url: 'https://github.com/draykerdk/daf/blob/master/federation/assemblies/2026-09.md' }],
      requests: [],
      issues: [
        { num: 21, title: '[Claim] Wrote the guide', url: 'https://github.com/draykerdk/daf/issues/21', pr: false },
        { num: 20, title: '[Cycle] Assembly 2026-10', url: 'https://github.com/draykerdk/daf/issues/20', pr: false },
        { num: 19, title: '[Claim] Not from here', url: 'javascript:alert(1)', pr: false },
        { num: 18, title: '[Claim] A pull request', url: 'https://github.com/draykerdk/daf/pull/18', pr: true }
      ],
      source_commit: 'c'.repeat(40),
      parameters: { quorum_percent: 30 },
      ledger: { asOf: '2026-09', holders: [{ id: 'river', kind: 'unit', points: 3, active: true, joined: '2026-09' }],
        totals: { holders: 1, points: 3, activePoints: 3, assemblies: 1 } },
      events: { version: 1, head, count: 4 }
    })
  }));
  const usedView = used.renderVals();
  check(used.state.dafState === 'ready' && used.state.dafData.ledger && used.state.dafData.events, 'The optional snapshot keys must be read.');
  check(usedView.states[2].k === 'IN USE' && usedView.states[2].d.includes('1 assembly held'), 'A record with an assembly must say it is in use.');
  check(usedView.states.every((x) => !/NOT YET USED|no assembly held/i.test(x.k + ' ' + x.d)), 'A record with an assembly must drop the empty-state sentence.');
  check(!usedView.footState.includes('no assembly held') && usedView.footState.includes('Record in use'), 'The footer must follow the record.');
  check(!used.metaDesc('home').includes('no assembly held') && used.metaDesc('home').includes('Record in use'), 'The home description must follow the record.');
  check(usedView.dafSrcLine.includes('GENERATED 2026-09-10 08:30 UTC'), 'The snapshot time must be shown.');
  check(usedView.ledgerGenerated && usedView.ledgerRows.length === 1 && usedView.ledgerRows[0].points === '3'
    && usedView.ledgerTotal === '3' && usedView.ledgerActive === '3', 'The generated ledger must fill the ledger tab.');
  check(usedView.ledgerSrc.startsWith('generated from the assemblies by tools/daf.js'), 'The generated ledger must say where it comes from.');
  check(usedView.eventsOn && usedView.eventsLine === 'Event log: 4 events · head ' + head.slice(0, 12) && usedView.eventsHref === './data/events.json',
    'The event log line must show the count and the head.');
  check(usedView.dafThreads.every((t) => t.url.startsWith('https://github.com/draykerdk/') && t.forum === 'https://forum.drayker.org/t/daf/' + t.num + '/'),
    'Every listed issue links to GitHub and to its forum page.');
  used.setState({ cycleState: 'ready', cycle: { num: 20, title: '[Cycle] Assembly 2026-10', url: 'https://github.com/draykerdk/daf/issues/20',
    opens: '2026-10-01', closes: '2026-10-08', claims: [] } });
  const cycView = used.renderVals();
  check(cycView.cycleOpen && cycView.cycForum === 'https://forum.drayker.org/t/daf/20/', 'The open cycle links to its forum page.');
  check(cycView.cycHasClaimIssues && cycView.cycClaimIssues.length === 2 && !cycView.cycNoClaims, 'Open claim issues are listed with the cycle.');
  check(cycView.cycClaimIssues[1].url === 'https://github.com/draykerdk/daf/issues/19' && cycView.cycClaimIssues[0].forum === 'https://forum.drayker.org/t/daf/21/',
    'A claim issue link from data that leaves the repository is replaced by one built from its number.');

  // Optional keys of the wrong shape are dropped, and the record still loads.
  const odd = await loadWith(async (url) => ({
    ok: String(url) === './data/federation.json',
    json: async () => ({ units: [], assemblies: [], requests: [], issues: [], generated: 'yesterday', ledger: 'x', events: { count: '3', head },
      source_commit: '<b>' })
  }));
  check(odd.state.dafState === 'ready' && odd.state.dafData.ledger === null && odd.state.dafData.events === null
    && odd.state.dafData.generated === null && odd.state.dafData.source_commit === null, 'Malformed optional keys must be ignored.');
  check(odd.renderVals().states[2].k === 'NOT YET USED', 'Malformed optional keys must not change the empty state.');
  check(offline.state.dafData.ledger === null && offline.renderVals().states[2].k === 'NOT YET USED', 'Offline, the empty state stands.');

  // site-1: the audit sums only reports that passed, and reads a ### heading.
  const passedReport = idle.parseAssembly([
    '# Assembly 2026-02', '', '## Deliveries', '',
    '| Holder | Function | Declared in | Delivered | Points |', '| --- | --- | --- | --- | --- |',
    '| `delta` | Last function | #22 | https://github.com/draykerdk/daf/pull/7 | 1 |',
    '| `cedar` | A review | #23 | https://github.com/draykerdk/daf/pull/8 | 1 |', '',
    '### Module completions', '',
    '| Holder | Module | Functions in it | Bonus |', '| --- | --- | --- | --- |',
    '| `delta` | The module | #21, #22 | 2 |', '',
    '## Penalties', '', '| Holder | Commitment | What happened | Points removed |', '| --- | --- | --- | --- |',
    '| `river` | A task | Established in the thread | −1 |', '',
    '## The vote', '', '| | |', '| --- | --- |', '| **Outcome** | **passed** |', ''
  ].join('\n'), { name: '2026-02.md', url: '' });
  check(passedReport.modules.length === 1 && passedReport.modules[0].bonus === 2 && passedReport.net.delta === 3
    && passedReport.penalties.length === 1 && passedReport.net.river === -1, 'Module completions under a ### heading must be counted.');
  const failedReport = idle.parseAssembly([
    '# Assembly 2026-03', '', '## Deliveries', '',
    '| Holder | Function | Declared in | Delivered | Points |', '| --- | --- | --- | --- | --- |',
    '| `cedar` | In a failed assembly | #31 | https://github.com/draykerdk/daf/pull/9 | 1 |', '',
    '**Module completions**', '', '| Holder | Module | Functions in it | Bonus |', '| --- | --- | --- | --- |', '',
    '## The vote', '', '| | |', '| --- | --- |', '| **Outcome** | **failed** |', ''
  ].join('\n'), { name: '2026-03.md', url: '' });
  check(failedReport.outcome === 'failed' && failedReport.net.cedar === 1, 'A failed report still parses.');
  const auditor = makeComponent();
  auditor.setState({ deepState: 'ready', deep: { units: [], assemblies: [passedReport, failedReport],
    ledger: [{ id: 'delta', kind: 'unit', points: 3, active: true, joined: '2026-02' },
      { id: 'cedar', kind: 'participant', points: 1, active: true, joined: '2026-02' },
      { id: 'river', kind: 'unit', points: -1, active: true, joined: '2026-01' }] } });
  const audit = auditor.auditRecord();
  check(audit.clean && audit.counted === 1 && audit.assemblies === 2, 'Only passed reports are summed; a failed one adds nothing.');
  check(audit.notCounted.length === 1 && audit.notCounted[0].month === '2026-03' && audit.notCounted[0].outcome === 'failed',
    'A failed report is listed as not counted.');
  auditor.setState({ recTab: 'audit' });
  const auditView = auditor.renderVals();
  check(auditView.auditCount === '1' && auditView.auditHasSkipped && auditView.auditSkipped === '2026-03 (failed)'
    && auditView.auditVerdict === 'THE LEDGER MATCHES THE ASSEMBLIES', 'The audit tab shows what it summed and what it left out.');

  // site-2: the pull-request panel links to the pull request on GitHub, never to the forum.
  const tallied = makeComponent();
  tallied.setState({ tallyState: 'ready', tally: { rows: [], unknown: [], yes: 0, no: 0, abs: 0, cast: 0, active: 0, pr: '14', found: 0, comments: 0 } });
  const tallyView = tallied.renderVals();
  check(tallyView.tallyPrUrl === 'https://github.com/draykerdk/daf/pull/14' && safeHref(tallyView.tallyPrUrl) === tallyView.tallyPrUrl,
    'The pull-request link points to github.com/draykerdk/daf/pull/.');
  check(!('tallyPrForum' in tallyView) && !('tallyHasForum' in tallyView) && !html.includes('tallyPrForum') && !html.includes('tallyHasForum'),
    'The pull-request panel has no forum link.');
  check(Object.values(tallyView).every((v) => typeof v !== 'string' || !/forum\.drayker\.org\/t\/daf\/14\//.test(v)),
    'No value points to a forum page for the pull request.');

  // site-3: "no assembly has been held" only while that is true.
  check(html.includes('INVENTED · NOT A REAL ASSEMBLY') && !html.includes('NO ASSEMBLY HAS BEEN HELD'), 'The example badge says it is not a real assembly.');
  check(html.split('<!-- Update in the pull request that records the first assembly. -->').length === 5,
    'Each static description carries the note to update it with the first assembly.');
  empty.setState({ deepState: 'ready', deep: { units: [], assemblies: [], ledger: [] } });
  const emptyLedger = empty.renderVals();
  check(emptyLedger.ledgerEmpty && emptyLedger.ledgerEmptyLine.includes('because no assembly has been held'),
    'With no assembly held, the empty ledger says so.');
  const heldNone = await loadWith(async (url) => ({
    ok: String(url) === './data/federation.json',
    json: async () => ({ units: [], assemblies: [{ name: '2026-09.md', url: 'https://github.com/draykerdk/daf/blob/master/federation/assemblies/2026-09.md' }],
      requests: [], issues: [], ledger: { asOf: '2026-09', holders: [], totals: { holders: 0, points: 0, activePoints: 0, assemblies: 1 } } })
  }));
  heldNone.setState({ deepState: 'ready', deep: { units: [], assemblies: [], ledger: [] } });
  const heldNoneView = heldNone.renderVals();
  check(heldNoneView.ledgerEmpty && heldNoneView.ledgerEmptyLine.includes('Assemblies were held, and none of them awarded points.')
    && !heldNoneView.ledgerEmptyLine.includes('no assembly has been held'), 'Once an assembly is held, the empty ledger stops saying none was.');

  // site-5: unit-record links render as links only for https:// addresses.
  const unitsView = makeComponent();
  unitsView.setState({ recTab: 'units', deepState: 'ready', deep: { units: [{ id: 'river', name: 'river', kind: 'unit', fn: 'x', joined: '2026-09', url: '',
    who: ['https://github.com/river', 'javascript:alert(1)'], work: ['http://example.test/repo', 'https://example.test/repo'] }], assemblies: [], ledger: [] } });
  const unitRow = unitsView.renderVals().unitRows[0];
  check(unitRow.who[0].isLink && unitRow.who[0].href === 'https://github.com/river' && !unitRow.who[1].isLink && unitRow.who[1].isText
    && unitRow.who[1].href === '' && unitRow.who[1].text === 'javascript:alert(1)', 'A speaks_for entry links only when it starts with https://.');
  check(!unitRow.work[0].isLink && unitRow.work[0].text === 'http://example.test/repo' && unitRow.work[1].isLink,
    'A work entry links only when it starts with https://.');

  // site-6: a null entry in the snapshot lists is dropped once, before caching.
  const holes = await loadWith(async (url) => ({
    ok: String(url) === './data/federation.json',
    json: async () => ({ units: [null], assemblies: [], requests: [7], issues: [null, { num: 4, title: 'A question', url: 'https://github.com/draykerdk/daf/issues/4', pr: false }] })
  }));
  check(holes.state.dafState === 'ready' && holes.state.dafData.issues.length === 1 && holes.state.dafData.units.length === 0
    && holes.state.dafData.requests.length === 0, 'Entries that are not objects are dropped when the record is loaded.');
  check(JSON.parse(store.get('daf-record-v2')).d.issues.length === 1, 'The cached record holds no null entry.');
  const holesView = holes.renderVals();
  check(holesView.dafHasThreads && holesView.dafThreads.length === 1, 'A null issue entry does not break the thread list.');

  // Cycle issues: the current month first, then a title with no month (the form's default).
  const month = new Date().toISOString().slice(0, 7);
  const cycleWith = async (issues) => {
    context.fetch = async () => ({ ok: false, status: 404, json: async () => null });
    const c = new Component();
    c.loadDeep = async () => {};
    c.setState({ dafState: 'ready', dafData: { units: [], assemblies: [], requests: [], issues } });
    await c.loadCycle();
    return c.state.cycle;
  };
  const cyc1 = await cycleWith([
    { num: 31, title: '[Cycle] Assembly 2020-01', url: 'https://github.com/draykerdk/daf/issues/31', pr: false },
    null,
    { num: 30, title: '[Cycle] Assembly ', url: 'https://github.com/draykerdk/daf/issues/30', pr: false },
    { num: 25, title: '[Cycle] Assembly ' + month, url: 'https://github.com/draykerdk/daf/issues/25', pr: false }
  ]);
  check(cyc1 && cyc1.num === 25, 'A [Cycle] issue naming the current month is preferred.');
  const cyc2 = await cycleWith([
    { num: 31, title: '[Cycle] Assembly 2020-01', url: 'https://github.com/draykerdk/daf/issues/31', pr: false },
    { num: 30, title: '[Cycle] Assembly ', url: 'https://github.com/draykerdk/daf/issues/30', pr: false }
  ]);
  check(cyc2 && cyc2.num === 30, 'A [Cycle] issue left with the form’s default title is found.');

  console.log(`${checks} DAF contract checks passed`);
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
