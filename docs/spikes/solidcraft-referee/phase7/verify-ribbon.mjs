#!/usr/bin/env node
// SPIKE (phase 7). Ribbon hide/restore, driven through the REAL page with real mouse and keyboard events (headless
// playwright-cli session `spike`, never `mom`). The egui canvas has no DOM, so "ribbon present" is read from pixels: the
// SOLID tab's accent underline (58,136,238) in the tab strip. Writes ribbon-results.json and screenshots/ribbon-*.png.
// Needs run.sh serving on :8801.   node docs/spikes/solidcraft-referee/phase7/verify-ribbon.mjs [--url=http://127.0.0.1:8801]
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=').slice(1).join('=');
const BASE = arg('url', 'http://127.0.0.1:8801');
const SHOTS = path.join(HERE, 'screenshots'); mkdirSync(SHOTS, { recursive: true });
const S = '-s=spike';
const pw = (...a) => execFileSync('playwright-cli', [S, ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
const evalRaw = (fn) => { const o = pw('eval', fn); const m = o.match(/### Result\n([\s\S]*?)\n### /); if (!m) throw new Error('no result ' + o.slice(0, 300)); return JSON.parse(m[1]); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = async (x, y) => { pw('mousemove', String(x), String(y)); pw('mousedown'); pw('mouseup'); await sleep(500); };
const TMP = process.env.TMPDIR || '/tmp';
function pixels(file) {
  const py = `import sys\nfrom PIL import Image\nim=Image.open(sys.argv[1]).convert('RGB')\nn=0\nfor y in range(50,62):\n  for x in range(110,170):\n    if im.getpixel((x,y))==(58,136,238): n+=1\nprint(n)`;
  return Number(execFileSync('python3', ['-I', '-c', py, file], { encoding: 'utf8' }).trim());
}
async function shot(name) { const f = path.join(SHOTS, name + '.png'); pw('screenshot', `--filename=${f}`); await sleep(200); return f; }
async function ribbonPresent(name) { const f = await shot(name); const n = pixels(f); return { present: n > 20, accentPixels: n, file: name + '.png' }; }
const stored = () => JSON.parse(evalRaw(`() => JSON.stringify(localStorage.getItem('solidcraft.ribbon'))`));
const bodies = () => evalRaw(`async () => JSON.stringify(JSON.parse(await window.solidcraft.inspect()).bodies)`);
const checks = [];
const retries = []; // every time a click/keystroke had no effect inside the wait window and was repeated once (reported in ribbon-results.json)
/** Do `act`, then wait (up to 3 s) until the app's stored ribbon setting equals `want`; if it never does, do `act` ONCE more and log the retry. */
async function actUntilStored(label, act, want) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await act();
    for (let i = 0; i < 12; i++) { let v; try { v = await stored(); } catch { v = undefined; } if (v === want) { await sleep(400); return attempt; } await sleep(250); }
    if (attempt === 0) { retries.push({ label, wanted: want, note: 'no effect within 3 s, repeated once' }); console.log('RETRY', label); }
  }
  return 2;
}
let build = async () => JSON.parse(evalRaw(`async () => JSON.stringify(await window.__host.runExample('3d-box-hole').then((r) => ({ pass: r.pass, volume: r.volume })))`));
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); console.log(ok ? 'ok  ' : 'FAIL', name, detail ?? ''); };
async function open(query, w = 1280, h = 720) {
  try { pw('goto', `${BASE}/?webgl&pane=on${query}`); } catch { try { pw('open', `${BASE}/?webgl&pane=on${query}`); } catch { /* beforeunload dialog pending */ } }
  for (let i = 0; i < 3; i++) { try { pw('dialog-accept'); } catch { /* none open */ } await sleep(600); }
  pw('resize', String(w), String(h));
  await sleep(5000);
  // a reload lands on the Start page (which has no ribbon by design): open a design the way a user would, by running one
  await build();
  await sleep(1500);
}
try { pw('open', `${BASE}/?webgl&pane=on`); } catch { /* already open */ }
pw('resize', '1280', '720');
evalRaw(`() => { localStorage.clear(); return JSON.stringify(1) }`);
await open('');
check('build 3d-box-hole in the pane', (await build()).pass === true);
await sleep(1200);

// A. default: ribbon shown, no stored setting
let r = await ribbonPresent('ribbon-01-default-1280x720');
check('A default: ribbon shown, nothing stored', r.present && (await stored()) === null, JSON.stringify(r));
// B. click the title-bar toggle (the window glyph, right of Help)
await actUntilStored('B hide click', () => click(338, 17), 'off');
r = await ribbonPresent('ribbon-02-hidden-1280x720');
check('B click hides the ribbon and stores "off"', !r.present && (await stored()) === 'off', JSON.stringify(r));
// canvas geometry: ribbon space goes to the viewport; the pane keeps its width
const geo = () => JSON.parse(evalRaw(`() => { const c = document.getElementById('solidcraft_canvas').getBoundingClientRect(); const p = document.getElementById('scp').getBoundingClientRect(); return JSON.stringify({ canvasW: c.width, canvasH: c.height, paneL: p.left, paneW: p.width, innerW: innerWidth }) }`));
const g1 = geo();
check('B canvas + pane tile the window (no overlap, no gap)', Math.abs(g1.canvasW + g1.paneW - g1.innerW) <= 1, JSON.stringify(g1));
// C. persists across reload
await open('');
r = await ribbonPresent('ribbon-03-reload-hidden');
check('C setting persists across a reload (ribbon still hidden)', !r.present && (await stored()) === 'off', JSON.stringify(r));
// hidden: commands, palette, timeline, scripts still work
const before = JSON.parse(await bodies());
await click(250, 666);
pw('type', 'solid.cylinder {"radius": 4, "height": 30, "base": [60, 0, 0], "axis": "Z", "body_name": "ribbon_off_cyl"}');
pw('press', 'Enter'); await sleep(1500);
const after = JSON.parse(await bodies());
check("D palette command runs with the ribbon hidden (one new body)", after.length === before.length + 1, JSON.stringify({ before, after }));
const f = await shot('ribbon-04-hidden-palette-command');
const run = JSON.parse(evalRaw(`async () => JSON.stringify(await window.__host.runExample('3d-union').then((x) => ({ pass: x.pass, volume: x.volume })))`));
check('E a pane Run builds with the ribbon hidden', run.pass === true, JSON.stringify(run));
await sleep(1200);
const tl = await shot('ribbon-05-hidden-after-run');
// timeline strip: the bottom 40 px must show feature chips (non-background pixels)
const tlPx = Number(execFileSync('python3', ['-I', '-c', `import sys\nfrom PIL import Image\nim=Image.open(sys.argv[1]).convert('RGB')\nbg=im.getpixel((400,712))\nprint(sum(1 for x in range(10,300) for y in range(690,716) if im.getpixel((x,y))!=bg))`, tl], { encoding: 'utf8' }).trim());
check('F timeline strip still drawn with the ribbon hidden', tlPx > 200, 'non-background pixels in the timeline strip: ' + tlPx);
// G. restore: click the "Show ribbon" button
await actUntilStored('G show click', () => click(375, 17), 'on');
r = await ribbonPresent('ribbon-06-restored');
check('G one click on "Show ribbon" restores it and stores "on"', r.present && (await stored()) === 'on', JSON.stringify(r));
await open('');
r = await ribbonPresent('ribbon-07-reload-shown');
check('H restored setting persists across a reload', r.present, JSON.stringify(r));
// I. URL flag: hides for this load only, does not rewrite the stored setting
await open('&ribbon=off');
r = await ribbonPresent('ribbon-08-url-off');
check('I ?ribbon=off starts hidden', !r.present, JSON.stringify(r));
check('I ?ribbon=off does not overwrite the stored setting', (await stored()) === 'on', String(await stored()));
await open('');
r = await ribbonPresent('ribbon-09-after-url-off');
check('J a plain reload after ?ribbon=off shows the ribbon again', r.present, JSON.stringify(r));
// K. keyboard: Ctrl+. with the canvas focused
await click(500, 400);
await actUntilStored('K Ctrl+. off', async () => { pw('keydown', 'Control'); pw('press', 'Period'); pw('keyup', 'Control'); await sleep(300); }, 'off');
r = await ribbonPresent('ribbon-10-ctrl-period');
check('K Ctrl+. toggles the ribbon off', !r.present, JSON.stringify(r));
await actUntilStored('K Ctrl+. on', async () => { pw('keydown', 'Control'); pw('press', 'Period'); pw('keyup', 'Control'); await sleep(300); }, 'on');
r = await ribbonPresent('ribbon-11-ctrl-period-back');
check('K Ctrl+. toggles it back on', r.present, JSON.stringify(r));
// L. small windows: no layout break (canvas+pane tile, ribbon toggles, Show ribbon button inside the title bar)
for (const [w, h] of [[1280, 720], [800, 600]]) {
  await open('&ribbon=off', w, h);
  const gg = geo();
  const rr = await ribbonPresent(`ribbon-12-off-${w}x${h}`);
  check(`L ${w}x${h} hidden: tiles the window, ribbon absent`, !rr.present && Math.abs(gg.canvasW + gg.paneW - gg.innerW) <= 1 && gg.canvasW >= 300, JSON.stringify(gg));
  await open('', w, h);
  const rs = await ribbonPresent(`ribbon-13-on-${w}x${h}`);
  check(`L ${w}x${h} shown: ribbon present`, rs.present, JSON.stringify(rs));
}
writeFileSync(path.join(HERE, 'ribbon-results.json'), JSON.stringify({ url: BASE, generatedAt: new Date().toISOString(), retries, checks }, null, 1) + '\n');
console.log(`\nretries: ${retries.length}`);
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} checks passed`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
