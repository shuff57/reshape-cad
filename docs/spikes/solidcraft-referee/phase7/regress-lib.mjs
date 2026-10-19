// shared helpers for the phase 7 regression scripts (headless playwright-cli session `spike`, never `mom`)
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BASE = 'http://127.0.0.1:8801';
export const SHOTS = path.join(HERE, 'screenshots');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const pw = (...a) => execFileSync('playwright-cli', ['-s=spike', ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
export const pwTry = (...a) => { try { return pw(...a); } catch (e) { return String(e.stdout ?? e.message); } };
export const ev = (fn) => { const o = pw('eval', fn); const m = o.match(/### Result\n([\s\S]*?)\n### /); if (!m) throw new Error('no result ' + o.slice(0, 300)); let v = JSON.parse(m[1]); if (typeof v === 'string') { try { v = JSON.parse(v); } catch { /* plain */ } } return v; };
export const shot = async (n) => { pw('screenshot', `--filename=${path.join(SHOTS, n + '.png')}`); await sleep(150); };
export const click = async (x, y) => { pw('mousemove', String(x), String(y)); pw('mousedown'); pw('mouseup'); await sleep(500); };
export async function load(query = '', w = 1280, h = 720) {
  pwTry('dialog-accept');
  const o = pwTry('goto', `${BASE}/?webgl&pane=on${query}`);
  if (/not open/i.test(o)) pw('open', `${BASE}/?webgl&pane=on${query}`);
  for (let i = 0; i < 3; i++) { pwTry('dialog-accept'); await sleep(600); }
  pw('resize', String(w), String(h));
  await sleep(4500);
  await clearAutosave();
  pwTry('reload'); for (let k = 0; k < 3; k++) { pwTry('dialog-accept'); await sleep(700); } await sleep(4500);
  // a leftover design from the previous scenario (dialog races) would make the first Run look like manual work: start clean
  for (let i = 0; i < 2; i++) {
    let n = 0; try { n = (await state()).bodies.length; } catch { /* not ready */ }
    if (n === 0) break;
    pwTry('reload'); for (let k = 0; k < 3; k++) { pwTry('dialog-accept'); await sleep(700); } await sleep(4500);
  }
}
export const state = () => ev(`async () => { const r = JSON.parse(await window.solidcraft.inspect()); return JSON.stringify({ bodies: r.measure.bodies.map((b) => b.name + ':' + b.volume_mm3.toFixed(3)), tab: r.active_tab, tabs: r.tabs, stash: r.stash.map((s) => ({ doc: s.doc_id, tab: s.tab, name: s.tab_name, active: s.active })), untouched: r.produced_untouched, dirty: r.dirty, activeDoc: r.active_doc }) }`);
export const runCode = (code, confirm = false) => ev(`async () => { window.__host.setScript(${JSON.stringify(code)}); const p = window.__host.run({ confirmed: ${confirm} }); ${confirm ? '' : "await new Promise((r) => setTimeout(r, 2500)); const b = document.getElementById('cfy'); if (b && !document.getElementById('confirm').hidden) b.click();"} const r = await p; return JSON.stringify({ error: r && r.error, pass: r && r.pass, cancelled: r && r.cancelled, volume: r && r.volume, refusals: r && r.refusals }); }`);
export async function palette(text) { const h = ev(`() => JSON.stringify(innerHeight)`); await click(250, h - 54); pw('type', text); pw('press', 'Enter'); await sleep(1500); }
export async function build(id = '3d-box-hole') { return ev(`async () => JSON.stringify(await window.__host.runExample(${JSON.stringify(id)}).then((r) => ({ pass: r.pass, volume: r.volume })))`); }

/** "Recover unsaved work?" (solidcraft's own autosave prompt) appears after a reload that follows hand work. */
export async function clearAutosave() {
  // removes solidcraft's own autosave slot (OPFS recovery.*) so no stale "Recover unsaved work?" prompt appears
  ev(`async () => { const d = await navigator.storage.getDirectory(); const names = []; for await (const [n] of d.entries()) names.push(n); for (const n of names) if (n.startsWith('recovery.')) await d.removeEntry(n); return JSON.stringify(names); }`);
}
export async function discardRecoveryClick() { const [w, h] = ev(`() => JSON.stringify([document.getElementById('solidcraft_canvas').getBoundingClientRect().width, innerHeight])`); await click(Math.round(w / 2 - 71), Math.round(h / 2 + 34)); }
export async function recover() { const [w, h] = ev(`() => JSON.stringify([document.getElementById('solidcraft_canvas').getBoundingClientRect().width, innerHeight])`); await click(Math.round(w / 2 - 150), Math.round(h / 2 + 34)); }

export async function discardRecovery() { /* the autosave is cleared in load(); nothing to click */ }
