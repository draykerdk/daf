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
vm.runInContext(match[1] + '\n;globalThis.__daf = { Component, ROUTE_META, NAV };', context, { filename: 'index.html#logic' });
const { Component, ROUTE_META, NAV } = context.__daf;
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

  console.log(`${checks} DAF contract checks passed`);
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
