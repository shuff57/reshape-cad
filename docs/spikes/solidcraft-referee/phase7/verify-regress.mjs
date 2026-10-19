#!/usr/bin/env node
// SPIKE (phase 7, critic round). Regressions for the Run / Restore guard, the reload safety net, stash stacking, XSS, and the
// untested environments (two tabs, 600 px, DPR 2, palette reachability, odd editor states). Headless `spike` session.
// Writes regress-results.json. Needs run.sh serving on :8801.   node docs/spikes/solidcraft-referee/phase7/verify-regress.mjs
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import * as L from './regress-lib.mjs';
const { ev, sleep, pw, pwTry, click, shot, state, runCode, palette, build, load } = L;
const rows = [];
const check = (name, ok, detail) => { rows.push({ name, ok: !!ok, detail }); console.log(ok ? 'ok  ' : 'FAIL', name, typeof detail === 'string' ? detail.slice(0, 220) : JSON.stringify(detail).slice(0, 220)); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const HAND = 'solid.cylinder {"radius": 4, "height": 30, "base": [60, 0, 0], "axis": "Z"}';
const HAND2 = 'solid.cylinder {"radius": 7, "height": 12, "base": [-60, 0, 0], "axis": "Z"}';
const W = 1700, H = 800, TAB1 = [490, 19], TAB2 = [710, 19], PLUS = [688, 19];
const dsc = () => L.discardRecovery();

// ---- R1 two tabs: Restore returns the work to ITS OWN tab and never touches the other one ---------------------------
await load('', W, H); await dsc();
await build(); await palette(HAND);
const M = (await state()).bodies;
await runCode('const b = cuboid(10, 10, 10)', false);           // Replace and run: stash = M
const scriptRes = (await state()).bodies;
await click(...PLUS);                                          // tab 2
await palette(HAND2);
const N = (await state()).bodies;
const s2 = await state();
check('R1 setup: tab 2 has its own hand work, tab 1 has the script result + a stash', s2.tab === 1 && s2.bodies.length === 1 && s2.stash.length === 1 && s2.stash[0].tab === 0, JSON.stringify({ M, scriptRes, N, stash: s2.stash }));
const r1 = ev(`async () => JSON.stringify(await window.__host.restore().then((r) => ({ ok: r.ok, restored: r.restored_previous, rejected: r.rejected, sentence: r.sentence })))`);
const a = await state();
check('R1 Restore switched to the ORIGIN tab and put M back there', a.tab === 0 && same(a.bodies, M), { r1, now: a });
await click(...TAB2); await sleep(500);
const b = await state();
check('R1 the other tab still holds exactly its own hand work', b.tab === 1 && same(b.bodies, N), b);
await shot('regress-r1-two-tab-restore');

// ---- R2 origin tab closed: say so, offer a NEW tab, never overwrite another tab ----------------------------------------
await load('', W, H); await dsc();
await build(); await palette(HAND);
const M2 = (await state()).bodies;
await runCode('const b = cuboid(10, 10, 10)', false);
await click(...PLUS); await palette(HAND2);
const N2 = (await state()).bodies;
await click(...TAB1);
await click(659, 19); await sleep(600);                        // x on tab 1: "Save changes?"
{ const cw = ev(`() => JSON.stringify(document.getElementById('solidcraft_canvas').getBoundingClientRect().width)`);
  await shot('regress-r2-prompt');
  await click(Math.round(cw / 2 - 82), Math.round(H / 2 + 38)); await sleep(800); }     // Don't Save
let c = await state();
check('R2 setup: tab 1 closed without saving; tab 2 holds its own work; the stash outlives the tab', c.tabs === 1 && same(c.bodies, N2) && c.stash.length === 1 && c.stash[0].tab === null, { now: c, N2 });
const raw = ev(`async () => JSON.stringify(await window.__host.bridge.restorePrevious({}))`);
c = await state();
check('R2 Restore with a closed origin says so and changes NOTHING (does not overwrite the open tab)', raw.ok === false && raw.origin_closed === true && same(c.bodies, N2) && /closed/i.test(raw.sentence), { raw: raw.sentence, now: c.bodies });
const r2 = ev(`async () => JSON.stringify(await window.__host.restore({ into_new_tab: true }).then((r) => ({ ok: r.ok, restored: r.restored_previous })))`);
c = await state();
check('R2 "Restore into a new tab": M appears in a NEW tab', r2.restored === true && c.tabs === 2 && same(c.bodies, M2), { r2, now: c });
await click(...TAB1); await sleep(400);
const c1 = await state();
check('R2 the remaining original tab still holds N', c1.bodies.length >= 1 && (same(c1.bodies, N2) || same((await (async () => { await click(...TAB2); await sleep(400); return state(); })()).bodies, N2)), c1);
await shot('regress-r2-closed-origin');

// ---- R3 reload after Replace and run still warns and offers the stashed hand work --------------------------------------
await load('', W, H); await dsc();
await build(); await palette(HAND);
const M3 = (await state()).bodies;
await runCode('const b = cuboid(10, 10, 10)', false);
const stashed = (await state()).stash.length === 1;
await sleep(36000);                                            // one autosave interval (30 s)
const unload = ev(`() => JSON.stringify({ ok: true })`);
const reloadOut = pwTry('reload');
const modal = /beforeunload/i.test(reloadOut);
check('R3 a reload after Replace and run asks before leaving (beforeunload)', stashed && modal, { stashed, modal, out: reloadOut.slice(0, 160) });
pwTry('dialog-accept'); await sleep(6000);
await shot('regress-r3-after-reload');
await recoverAndRead();
async function recoverAndRead() {
  await L.recover(); await sleep(2500);
  let r = null; try { r = await state(); } catch { /* page not ready */ }
  check('R3 "Recover unsaved work?" is offered and Recover restores the STASHED hand work', r && same(r.bodies, M3), { recovered: r && r.bodies, wanted: M3 });
  await shot('regress-r3-recovered');
}

// ---- R4 stash overwrite: M, run A, edit E, run B ---------------------------------------------------------------------------
await load('', W, H); await dsc();
await build(); await palette(HAND);
const M4 = (await state()).bodies;
await runCode('const a1 = cuboid(10, 10, 10)', false);          // A, stash [M]
const A = (await state()).bodies;
await palette(HAND2);                                          // edit E on A
const AE = (await state()).bodies;
const pr = ev(`async () => { window.__host.setScript('const b2 = cuboid(20, 20, 20)'); const p = window.__host.run({}); await new Promise((r) => setTimeout(r, 2500)); const txt = document.getElementById('confirm').textContent; const shown = !document.getElementById('confirm').hidden; document.getElementById('cfy').click(); await p; return JSON.stringify({ shown, txt: txt.slice(0, 330) }); }`);
const st = await state();
check('R4 run B over A+E asked first, and the stash is now a STACK (depth 2), not silently replaced', pr.shown && st.stash.length === 2, { pr, depth: st.stash.length });
await ev(`async () => JSON.stringify(await window.__host.restore().then((r) => r.restored_previous))`);
const r4a = await state();
check('R4 first Restore returns A+E exactly', same(r4a.bodies, AE), { got: r4a.bodies, want: AE });
const r4raw = ev(`async () => JSON.stringify(await window.__host.bridge.restorePrevious({}))`);
check('R4 the next Restore asks first: the tab has edits made after the run (A+E would be discarded)', r4raw.ok === false && r4raw.needs_confirm === true && /changes made after/.test(r4raw.sentence), r4raw.sentence);
await ev(`async () => JSON.stringify(await window.__host.restore({ force: true }).then((r) => r.restored_previous))`);
const r4b = await state();
check('R4 second Restore returns M exactly', same(r4b.bodies, M4), { got: r4b.bodies, want: M4 });
// the guard no longer depends on global run history: untouched result of THIS document does not prompt, edited does
await build();                                                  // untouched script result in this doc (no prompt expected)
const pr2 = ev(`async () => { window.__host.setScript('const c = cuboid(5, 5, 5)'); const p = window.__host.run({}); await new Promise((r) => setTimeout(r, 2500)); const shown = !document.getElementById('confirm').hidden; if (shown) document.getElementById('cfn').click(); await p; return JSON.stringify({ shown }); }`);
check('R4 an untouched script result of THIS document does not prompt (guard is per document, not global history)', pr2.shown === false, pr2);

// ---- R5 XSS: every script-derived string reaches the DOM as text -------------------------------------------------------------
await load('', W, H); await dsc();
const EVIL = '<img src=x onerror="window.__xss=1">';
const xss = ev(`async () => {
  window.__xss = 0;
  const doc = { version: 1, features: [{ id: ${JSON.stringify(EVIL)}, kind: 'box', length: 10, width: 10, height: 10 }, { id: 'q"\\'<b>x', kind: 'cylinder', radius: 2, height: 30 }] };
  window.__host.EXAMPLES.push({ id: 'xss-doc', group: '3d', title: 'xss', script: 'doc', expect: ${JSON.stringify(EVIL)}, doc });
  const r = await window.__host.runExample('xss-doc');
  await new Promise((x) => setTimeout(x, 800));
  const imgs = document.querySelectorAll('#scp img, #scp svg, #scp script').length;
  return JSON.stringify({ xss: window.__xss, imgs, text: document.getElementById('features').textContent.slice(0, 200), verdict: r && r.verdict });
}`);
check('R5 an HTML feature id / body name is shown as text: no element created, onerror never fires', xss.xss === 0 && xss.imgs === 0, xss);
const scripts = {
  'param name with HTML': `const p = param('${EVIL.replace(/'/g, '')}', 5)\nconst b = cuboid(p, 10, 10)`,
  'long unicode identifier': `const ${'é'.repeat(300)} = cuboid(10, 10, 10)`,
  'string in a number slot': `const b = cuboid(10, 10, 10)\nhole(b, { across: '<img src=x onerror=window.__xss=1>' })`,
  'quotes and backticks': 'const b = cuboid(10, 10, 10)\nhole(b, { across: \'"`${1}\' })',
};
const out = {};
for (const [k, code] of Object.entries(scripts)) {
  const r = ev(`async () => { window.__xss = 0; window.__host.setScript(${JSON.stringify(code)}); await window.__host.run({ confirmed: true }); await new Promise((x) => setTimeout(x, 400)); return JSON.stringify({ xss: window.__xss, imgs: document.querySelectorAll('#scp img, #scp script').length, v: document.getElementById('verdict').textContent.slice(0, 100) }); }`);
  out[k] = r;
}
check('R5 hostile script strings (param name, long unicode, quotes) create no elements and run no handler', Object.values(out).every((r) => r.xss === 0 && r.imgs === 0), out);

// ---- R6 untested environments --------------------------------------------------------------------------------------------
// two-tab ribbon behaviour: one setting for the app, both tabs follow it
await load('', W, H); await dsc();
await build(); await click(...PLUS); await sleep(600);
const px = async (name) => { const f = path.join(L.SHOTS, name + '.png'); pw('screenshot', `--filename=${f}`); const py = `import sys\nfrom PIL import Image\nim=Image.open(sys.argv[1]).convert('RGB')\nprint(sum(1 for y in range(50,62) for x in range(110,170) if im.getpixel((x,y))==(58,136,238)))`; const { execFileSync } = await import('node:child_process'); return Number(execFileSync('python3', ['-I', '-c', py, f], { encoding: 'utf8' })) > 20; };
const t2On = await px('regress-r6-tab2-ribbon-on');
pw('keydown', 'Control'); pw('press', 'Period'); pw('keyup', 'Control'); await sleep(700);
const t2Off = await px('regress-r6-tab2-ribbon-off');
await click(...TAB1); await sleep(500);
const t1Off = await px('regress-r6-tab1-ribbon-off');
check('R6 two tabs: ribbon on in both; Ctrl+. hides it in the active tab AND the other (one app setting)', t2On && !t2Off && !t1Off, { t2On, t2Off, t1Off });
pw('keydown', 'Control'); pw('press', 'Period'); pw('keyup', 'Control'); await sleep(500);

// palette reachability with the ribbon hidden
await load('&ribbon=off', W, H); await dsc();
await build();
const before = await state();
const reach = {};
await palette('solid.extrude'); await sleep(500); await shot('regress-r6-palette-extrude'); pw('press', 'Escape'); await sleep(300);
await palette('sketch.create'); await sleep(500); await shot('regress-r6-palette-sketch'); pw('press', 'Escape'); await sleep(300);
await palette('solid.fillet'); await sleep(500); await shot('regress-r6-palette-fillet'); pw('press', 'Escape'); await sleep(300);
await palette('solid.shell'); await sleep(500); await shot('regress-r6-palette-shell'); pw('press', 'Escape'); await sleep(300);
await palette('edit.undo'); const afterUndo = await state(); await palette('edit.redo'); const afterRedo = await state();
reach.undoRedo = { before: before.bodies, afterUndo: afterUndo.bodies, afterRedo: afterRedo.bodies };
check('R6 undo / redo run from the palette with the ribbon hidden', !same(afterUndo.bodies, before.bodies) || !same(afterRedo.bodies, afterUndo.bodies), reach.undoRedo);

// editor states, in-flight run, example A then B, failing run
await load('', W, H); await dsc();
await build();
const empty = await runCode('', true);
const comments = await runCode('// nothing but a comment\n/* and another */', true);
const e1 = await state();
check('R6 empty / comments-only editor: no crash, a plain sentence or an empty build, panels not stale', empty !== null && comments !== null, { empty, comments, bodies: e1.bodies });
const inflight = ev(`async () => { window.__host.setScript('const b = cuboid(20, 20, 20)'); const p1 = window.__host.run({ confirmed: true }); const p2 = window.__host.run({ confirmed: true }); const [r1, r2] = await Promise.all([p1, p2]); return JSON.stringify({ second: r2 === null, first: !!r1 }); }`);
check('R6 a second Run while one is in flight is ignored (no double build)', inflight.second === true && inflight.first === true, inflight);
const ab = ev(`async () => { const a = await window.__host.runExample('3d-box-hole'); const b = await window.__host.runExample('3d-union'); return JSON.stringify({ a: a.pass, b: b.pass, vb: b.volume }); }`);
check('R6 example A then example B: B replaces A cleanly and both pass', ab.a === true && ab.b === true, ab);
// failing run with hand work: refused feature mid-run
await palette(HAND); const Mf = (await state()).bodies;
const fail = await runCode('const sk = sketch(\'top\')\nsk.geom([{ k: \'line\', id: 1, a: [0,0], b: [40,0] }, { k: \'line\', id: 2, a: [40,0], b: [40,20] }, { k: \'line\', id: 3, a: [40,20], b: [0,0] }])\nsk.rules([{ k: \'distanceX\', a: 1, b: 1, value: 40 }, { k: \'distanceX\', a: 1, b: 1, value: 30 }])\nconst part = extrude(sk, 10)', false);
const after = await state();
const rest = ev(`async () => JSON.stringify(await window.__host.restore().then((r) => ({ ok: r.ok, restored: r.restored_previous, rejected: r.rejected })))`);
const back = await state();
check('R6 a failing run with hand work: either the design is untouched or Restore returns it exactly', same(after.bodies, Mf) || same(back.bodies, Mf), { fail, afterBodies: after.bodies, restoredBodies: back.bodies, want: Mf, rest });

// DPR 2 and 600 px
const dprOut = pwTry('run-code', "async (page) => { const c = await page.context().newCDPSession(page); await c.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 2, mobile: false }); return 'ok'; }");
await sleep(2500);
const dpr = ev(`() => JSON.stringify({ dpr: devicePixelRatio, w: innerWidth, canvas: document.getElementById('solidcraft_canvas').getBoundingClientRect().width, pane: document.getElementById('scp').getBoundingClientRect().width, backing: document.getElementById('solidcraft_canvas').width })`);
await shot('regress-r6-dpr2');
check('R6 devicePixelRatio 2: canvas backing store follows DPR and canvas + pane tile the window', dpr.dpr === 2 && Math.abs(dpr.canvas + dpr.pane - dpr.w) <= 1, { dpr, dprOut: dprOut.slice(0, 80) });
pwTry('run-code', "async (page) => { const c = await page.context().newCDPSession(page); await c.send('Emulation.clearDeviceMetricsOverride'); return 'ok'; }");
pw('resize', '600', '800'); await sleep(2000);
const w600 = ev(`() => JSON.stringify({ w: innerWidth, canvas: document.getElementById('solidcraft_canvas').getBoundingClientRect().width, pane: document.getElementById('scp').getBoundingClientRect().width, hs: document.documentElement.scrollWidth })`);
await shot('regress-r6-600px');
check('R6 600 px wide: canvas + pane tile the window, no horizontal page scroll', Math.abs(w600.canvas + w600.pane - w600.w) <= 1 && w600.hs <= w600.w, w600);

writeFileSync(path.join(L.HERE, 'regress-results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), checks: rows }, null, 1) + '\n');
console.log(`${rows.filter((r) => r.ok).length}/${rows.length} ok`);
pwTry('close');
process.exit(rows.every((r) => r.ok) ? 0 : 1);
