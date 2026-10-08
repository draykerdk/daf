// `npm test` in icp/: the whole portability check.
//
//   1. vectors.json is regenerated from tools/lib/events.js and must equal the
//      committed file (the reference has not drifted from the vectors);
//   2. interp.mjs runs the pure Motoko modules against the vectors, in a child
//      process with a larger stack;
//   3. every source compiles with no warning outside ALLOWED_WARNINGS, the
//      actor compiles to an `ic` wasm, and its Candid interface and stable
//      signature equal the committed federation.did and federation.most.
//
// `node test/run.mjs --update` rewrites vectors.json, federation.did and
// federation.most instead of comparing them; review the diff before keeping it.

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildVectors, VECTORS } from './export-vectors.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ICP = path.resolve(HERE, '..');
const UPDATE = process.argv.includes('--update');
const SOURCES = ['Sha256.mo', 'Event.mo', 'Ledger.mo', 'main.mo'];

/**
 * Warnings accepted on purpose. Anything else fails the check.
 *  - M0270: the specification asks for `system func postupgrade` to refold
 *    the transient standing and re-set the certified data after an upgrade
 *    (the actor body does the same at install); this compiler marks the hook as
 *    deprecated in favour of migration functions. Revisit under the deploying
 *    toolchain.
 *  - M0194: `appender` is part of the specified state, reserved for a later,
 *    narrower appender; nothing reads it in this bootstrap.
 */
const ALLOWED_WARNINGS = [
  { file: 'src/main.mo', code: 'M0270', message: /`postupgrade` is deprecated/ },
  { file: 'src/main.mo', code: 'M0194', message: /unused identifier: `appender`/ }
];

let passed = 0;
let failed = 0;
const ok = (cond, name, detail) => {
  if (cond) { passed++; console.log('ok - ' + name); } else { failed++; console.log('not ok - ' + name + (detail ? '\n    ' + detail : '')); }
};
const timed = (label, fn) => { const t = Date.now(); const r = fn(); console.log('# ' + label + ': ' + (Date.now() - t) + ' ms'); return r; };

/** Compare a generated text with its committed file, or write it with --update. */
function golden(file, text, what) {
  const rel = path.relative(ICP, file);
  if (UPDATE) { writeFileSync(file, text); console.log('# wrote ' + rel); return; }
  const have = existsSync(file) ? readFileSync(file, 'utf8') : null;
  ok(have === text, what + ' equals the committed ' + rel, have === null ? rel + ' is missing (run node test/run.mjs --update)' : 'regenerate with node test/run.mjs --update and review the diff');
}

const t0 = Date.now();

// 1. Vectors from the reference.
golden(VECTORS, timed('export vectors', buildVectors), 'vectors.json regenerated from tools/lib/events.js');

// 2. Interpreter tests.
const child = timed('interpreter tests', () => spawnSync(process.execPath, ['--stack-size=30000', path.join(HERE, 'interp.mjs')], { cwd: ICP, stdio: 'inherit' }));
ok(child.status === 0, 'interpreter tests (test/interp.mjs)', 'exit ' + child.status + (child.signal ? ' signal ' + child.signal : ''));

// 3. Compile checks.
const mo = require('motoko');
mo.loadPackage(require('motoko/packages/latest/core.json'));
for (const f of SOURCES) mo.write('src/' + f, readFileSync(path.join(ICP, 'src', f), 'utf8'));

const seen = new Map();
timed('type check', () => {
  for (const f of SOURCES) for (const d of mo.check('src/' + f)) seen.set(d.source + ':' + d.range.start.line + ':' + d.code, d);
});
const diags = [...seen.values()];
const errors = diags.filter((d) => d.severity === 1);
const warnings = diags.filter((d) => d.severity !== 1);
const allowed = (d) => ALLOWED_WARNINGS.some((a) => d.source === a.file && d.code === a.code && a.message.test(d.message));
const show = (d) => d.source + ':' + (d.range.start.line + 1) + ' ' + d.code + ' ' + d.message.split('\n')[0];
ok(errors.length === 0, 'type check: no errors', errors.map(show).join('\n    '));
ok(warnings.every(allowed), 'type check: no warnings outside the allowlist', warnings.filter((d) => !allowed(d)).map(show).join('\n    '));
for (const d of warnings.filter(allowed)) console.log('# allowed warning: ' + show(d));
for (const a of ALLOWED_WARNINGS) ok(warnings.some((d) => d.source === a.file && d.code === a.code && a.message.test(d.message)), 'allowlisted warning ' + a.code + ' still occurs (else remove it from the list)');

let out = null;
try {
  out = timed('compile main.mo to ic wasm', () => mo.wasm('src/main.mo', 'ic'));
} catch (e) {
  ok(false, 'main.mo compiles to an ic wasm', String(e && e.message || e).split('\n')[0]);
}
if (out) {
  const bytes = out.wasm.length;
  ok(bytes > 0, 'main.mo compiles to an ic wasm (' + bytes + ' bytes; not executed here)');
  golden(path.join(ICP, 'federation.did'), out.candid, 'Candid interface of main.mo');
  golden(path.join(ICP, 'federation.most'), out.stable, 'stable signature of main.mo');
  // Only the event list and its bookkeeping are stable; the standing is
  // refolded from the log, so no library container layout is persisted.
  const stableVars = [...out.stable.matchAll(/stable var (\w+)/g)].map((m) => m[1]).sort();
  ok(JSON.stringify(stableVars) === JSON.stringify(['appender', 'count', 'currentHead', 'log']), 'stable data is only log, count, currentHead and appender', stableVars.join(', '));
  ok(!/Map__|Tree__|#red|#black/.test(out.stable), 'stable signature carries no core Map internals');
}

// The interpreter cannot run CertifiedData.set, so this only checks the
// source: the actor body (two-space indent, outside any function) refolds and
// certifies at install, and postupgrade does both again.
{
  const main = readFileSync(path.join(ICP, 'src', 'main.mo'), 'utf8');
  ok(/\n  refold\(\);\n  certify\(\);\n/.test(main), 'main.mo certifies the head (64 zeros for the empty log) and refolds the standing at install');
  ok(/system func postupgrade\(\) \{\n    refold\(\);\n    certify\(\);/.test(main), 'main.mo refolds and certifies in postupgrade');
}

console.log('# run: ' + passed + ' passed, ' + failed + ' failed, ' + (Date.now() - t0) + ' ms in total');
process.exit(failed ? 1 : 0);
