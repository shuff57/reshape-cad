// PM-4 on the HOST ROUTE (docs/spikes/solidcraft-referee/AUDIT-HOST-GUARDS.md; GUARD-SG13-PNP7-PM4.md): pane.js run() calls the patterns-mirror group's
// preflightScript on the editor text, before anything is translated. No kernel.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const H = await imp('packages/solidcraft-host/pane/src/host-entry.mjs');

// ---- PM-4 -----------------------------------------------------------------------------------------------------------------------------------------------------
test('PM-4: the host exports the group\'s preflightScript, and pane.js run() refuses on it before the doc is checked or translated', async () => {
  const L = await imp('packages/layer/dist/index.js');
  assert.equal(H.preflightScript, L.preflightScript);
  const plate = "const b = box(60, 60, 10); const sk = sketch('top', 10); sk.circle(6, { at: [20, 0] }); const c = pocket(sk, b, 4);";
  assert.equal(H.preflightScript(`${plate} repeatAround(c, { count: 4, angle: 720 });`)?.sentence, L.PREFLIGHT_SENTENCE);
  assert.equal(H.preflightScript(`${plate} repeatAround(c, { count: 4, angle: -360 });`)?.sentence, L.PREFLIGHT_SENTENCE);
  assert.equal(H.preflightScript(`${plate} const a = 90; repeatAround(c, { count: 4, angle: a });`)?.sentence, L.PREFLIGHT_SENTENCE_VAR);
  assert.equal(H.preflightScript(`${plate} repeatAround(c, { count: 4, angle: 360 });`), null);
  assert.equal(H.preflightScript(`${plate} repeatAround(c, { count: 4 });`), null);
  const pane = readFileSync(path.join(root, 'packages/solidcraft-host/pane/pane.js'), 'utf8');
  const run = pane.slice(pane.indexOf('async function run('), pane.indexOf("$('run').onclick"));
  const at = (s) => { const i = run.indexOf(s); assert.ok(i >= 0, s); return i; };
  assert.ok(at('preflightScript(srcText)') > at('if (r.errors.length)'), 'after the script error report');
  assert.ok(at('preflightScript(srcText)') < at('validDoc(r.doc)'), 'before the doc is checked');
  assert.ok(at('preflightScript(srcText)') < at('await translateDoc('), 'before anything is translated');
  assert.ok(run.includes('if (pf) return failState(summary, \'refused\', `REFUSED BEFORE BUILD: ${pf.sentence}`'), 'refused in the group\'s sentence, nothing built');
});
