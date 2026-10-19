// SPIKE, referee only. Node-side driver for the live contract path: reSHape Script text -> ModelDoc (the pane's own sandbox runner bundle, phase7/bundle-run.mjs)
// -> fc-page.mjs inside the shipping pane's page (forked translator + guard + grouping, pane wasm through the bridge) -> the numbers.
//   1. bun live/fc-host.mjs --port=8811 &          (from outside the repo or inside, it only reads)
//   2. playwright-cli -s=fcspike4 open "http://127.0.0.1:8811/?webgl&pane=on"        (session name fcspike4; never `mom`)
//   3. bun live/fc-live.mjs --script="..." [--mode=pane|contract] [--guard=0|1] [--group=0|1]
// As a library: import { openPage, runScriptLive, runDocLive, execCmds } from './fc-live.mjs'.
import { execFileSync } from 'node:child_process';
import { runViaBundle } from '../../../phase7/bundle-run.mjs';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : d; };
export const SESSION = process.env.FC_SESSION ?? 'fcspike4';
export const BASE = process.env.FC_BASE ?? 'http://127.0.0.1:8811';
const TIMEOUT = Number(process.env.FC_TIMEOUT_MS ?? 240000);
const pw = (...a) => execFileSync('playwright-cli', [`-s=${SESSION}`, ...a], { encoding: 'utf8', maxBuffer: 1 << 28, cwd: '/tmp', timeout: TIMEOUT, killSignal: 'SIGKILL' });
/** a hung wasm call can not be interrupted from inside the page: close the session, reopen, reload the module */
export async function recover() {
  try { execFileSync('playwright-cli', [`-s=${SESSION}`, 'close'], { encoding: 'utf8', cwd: '/tmp', timeout: 30000 }); } catch { /* already gone */ }
  await sleep(1500);
  try { execFileSync('playwright-cli', [`-s=${SESSION}`, 'open', `${BASE}/?webgl&pane=on`], { encoding: 'utf8', cwd: '/tmp', timeout: 60000 }); } catch { /* retry in openPage */ }
  return openPage();
}
/** run fn(); on a timeout/hang report { hang: true } after recovering the page */
export async function guarded(fn) {
  try { return fn(); } catch (e) {
    const hung = e.code === 'ETIMEDOUT' || /timed out|SIGKILL/.test(String(e.message)) || e.signal === 'SIGKILL';
    if (!hung) return { error: String(e.message).slice(0, 300) };
    await recover();
    return { hang: true, error: `no answer in ${TIMEOUT / 1000} s (page restarted)` };
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function ev(fn) {
  const o = pw('eval', fn);
  const m = o.match(/### Result\n([\s\S]*?)\n### /) ?? o.match(/### Result\n([\s\S]*)$/);
  if (!m) throw new Error('no result: ' + o.slice(0, 400));
  let v = JSON.parse(m[1]);
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { /* keep */ } }
  return v;
}
export async function openPage({ reload = true } = {}) {
  try { pw('goto', `${BASE}/?webgl&pane=on`); } catch { pw('open', `${BASE}/?webgl&pane=on`); }
  for (let i = 0; i < 40; i++) {
    try { const r = ev(`async () => JSON.stringify(!!(window.__host && window.__host.bridge && (await window.__host.bridge.inspect()).ok !== undefined))`); if (r === true) break; } catch { /* wait */ }
    await sleep(500);
  }
  return ev(`async () => { window.__fc = await import('/fc/fc-page.mjs?v=' + Date.now()); return JSON.stringify(await window.__fc.ping()); }`);
}
export function scriptToDoc(script) {
  const r = runViaBundle(script);
  return { errors: r.errors, doc: r.doc };
}
export function runDocLive(doc, opts = {}) {
  return ev(`async () => JSON.stringify(await window.__fc.run(${JSON.stringify(doc)}, ${JSON.stringify(opts)}))`);
}
export function runScriptLive(script, opts = {}) {
  const { errors, doc } = scriptToDoc(script);
  if (errors && errors.length) return { scriptError: errors.map((e) => e.message ?? String(e)), doc };
  const r = runDocLive(doc, opts);
  r.doc = doc;
  return r;
}
/** raw solidcraft command list through the pane's bridge (fresh session): { ok, measure, failed, topology? } */
export function execCmds(cmds, { topology = false } = {}) {
  return ev(`async () => JSON.stringify(await window.__host.bridge.execute(${JSON.stringify(cmds)}, { fresh: true, topology: ${topology} }))`);
}
export const summary = (r) => r.scriptError ? `SCRIPT ERROR ${r.scriptError[0]}` : `vol ${r.volume?.toFixed(4)} faces ${r.faces} ok=${r.ok} ${r.features.filter((f) => f.status === 'refused').map((f) => `${f.id}: ${f.sentence ?? f.refusal}`).join(' || ')}`;

if (process.argv[1]?.endsWith('fc-live.mjs') && process.argv.some((a) => a.startsWith('--script='))) {
  await openPage();
  const mode = arg('mode', 'contract');
  const opts = { mode }; if (arg('guard')) opts.guard = arg('guard') === '1'; if (arg('group')) opts.group = arg('group') === '1';
  const r = runScriptLive(arg('script').replace(/\\n/g, '\n'), opts);
  console.log(summary(r));
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 1));
}
