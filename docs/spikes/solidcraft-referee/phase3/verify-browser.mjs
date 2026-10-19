#!/usr/bin/env node
// SPIKE (phase 3). Drives the REAL page headless through every gallery example with playwright-cli (session `spike`),
// saves browser-results.json and one screenshot per example (screenshots/). Needs run.sh already serving on :8795.
//   node docs/spikes/solidcraft-referee/phase3/verify-browser.mjs [--url=http://127.0.0.1:8795/] [--only=id,id]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=').slice(1).join('=');
const URL_ = arg('url', 'http://127.0.0.1:8795/');
const only = arg('only', '').split(',').filter(Boolean);
const S = '-s=spike';
const pw = (...a) => execFileSync('playwright-cli', [S, ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
const evalJson = (fn) => {
  const out = pw('eval', fn);
  const m = out.match(/### Result\n([\s\S]*?)\n### /);
  if (!m) throw new Error('no result: ' + out.slice(0, 400));
  const v = JSON.parse(m[1]);
  return typeof v === 'string' ? JSON.parse(v) : v;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(path.join(HERE, 'screenshots'), { recursive: true });
const examples = JSON.parse(readFileSync(path.join(HERE, 'host', 'examples.json'), 'utf8'));
try { pw('open', URL_); } catch { pw('goto', URL_); }
pw('resize', '1500', '1500');
await sleep(4000);
const results = [];
for (const ex of examples) {
  if (only.length && !only.includes(ex.id)) continue;
  let r;
  try { r = evalJson(`async () => JSON.stringify(await window.__host.runExample(${JSON.stringify(ex.id)}))`); }
  catch (e) { r = { id: ex.id, error: String(e.message).slice(0, 300) }; }
  await sleep(2500); // let the egui viewport repaint (software GL)
  pw('screenshot', `--filename=${path.join(HERE, 'screenshots', ex.id + '.png')}`);
  results.push({ ...r, group: ex.group, title: ex.title, refSource: ex.ref?.source, refVolume: ex.ref?.volume });
  console.log(ex.id.padEnd(26), r.error ? 'ERROR ' + r.error : (r.verdict ?? '').slice(0, 160), r.sketches?.length ? ' | dof ' + r.sketches.map((s) => s.dof).join(',') : '');
}
// restore self-test: a failing list after a good build must leave the document unchanged
evalJson(`async () => JSON.stringify(await window.__host.runExample('3d-box-hole'))`);
const restore = evalJson(`async () => JSON.stringify(await window.__host.restoreTest())`);
await sleep(1500);
pw('screenshot', `--filename=${path.join(HERE, 'screenshots', 'restore-self-test.png')}`);
console.log('restore', JSON.stringify(restore));
writeFileSync(path.join(HERE, 'browser-results.json'), JSON.stringify({ url: URL_, generatedAt: new Date().toISOString(), results, restore }, null, 1) + '\n');
