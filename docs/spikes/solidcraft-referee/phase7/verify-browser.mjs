#!/usr/bin/env node
// SPIKE (phase 7). Drives the REAL pane (headless playwright-cli session `spike`, never `mom`):
//   1 every gallery example vs the live brep-rs / OCCT reference (reference-results.json from verify-reference.mjs)
//   2 error paths + stale panels   3 Run vs manual work (confirm / cancel / restore)   4 security regressions
// Needs run.sh serving on :8801 and reference-results.json.  node .../phase7/verify-browser.mjs [--only=id,id] [--skip-examples]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=').slice(1).join('=');
const BASE = arg('url', 'http://127.0.0.1:8801');
const only = arg('only', '').split(',').filter(Boolean);
const SHOTS = path.join(HERE, 'screenshots'); mkdirSync(SHOTS, { recursive: true });
const pw = (...a) => execFileSync('playwright-cli', ['-s=spike', ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
const ev = (fn) => { const o = pw('eval', fn); const m = o.match(/### Result\n([\s\S]*?)\n### /); if (!m) throw new Error('no result ' + o.slice(0, 300)); let v = JSON.parse(m[1]); if (typeof v === 'string') { try { v = JSON.parse(v); } catch { /* plain string */ } } return v; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (n) => pw('screenshot', `--filename=${path.join(SHOTS, n + '.png')}`);
const ref = Object.fromEntries(JSON.parse(readFileSync(path.join(HERE, 'reference-results.json'), 'utf8')).results.map((r) => [r.id, r]));
const examples = JSON.parse(readFileSync(arg('examples', path.join(HERE, 'pane', 'examples.json')), 'utf8'));
const OUTNAME = arg('out', '');
try { pw('dialog-accept'); } catch { /* no dialog open */ }
try { pw('goto', `${BASE}/?webgl&pane=on`); } catch { pw('open', `${BASE}/?webgl&pane=on`); }
pw('resize', '1280', '720'); await sleep(5000);
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1);
const out = { generatedAt: new Date().toISOString(), url: BASE, examples: [], errorPaths: [], manualWork: [], security: [] };

// ---- 1 examples vs reference -------------------------------------------------------------------------------------
const SHOT_IDS = new Set(['3d-box-hole', '3d-polar-pattern', '2d-slot-tangent', 'fr-bracket-rounded', 'named-fillet-edge', 'named-shell-open-top', 'refuse-shell-closed', 'stub-centre','stub-corner', 'diag-conflict', 'misuse-tangent-two-lines']);
if (!process.argv.includes('--skip-examples')) for (const ex of examples) {
  if (only.length && !only.includes(ex.id)) continue;
  let r;
  try { r = ev(`async () => JSON.stringify(await window.__host.runExample(${JSON.stringify(ex.id)}))`); } catch (e) { r = { error: String(e.message).slice(0, 200) }; }
  await sleep(600);
  if (SHOT_IDS.has(ex.id)) { shot('pane-' + ex.id); await sleep(200); }
  const rf = ref[ex.id];
  const row = { id: ex.id, group: ex.group, title: ex.title, verdict: r.verdict ?? r.error ?? null, paneSaysPass: r.pass ?? null, errorLine: r.errorLine ?? null };
  const tol = ex.curved ? 3e-4 : 1e-9;
  if (ex.group === 'misuse') {
    row.class = r.pass === true && r.expectedError ? 'MATCH (expected script error, line ' + r.errorLine + ')' : 'MISS';
  } else if (r.error || r.noNewBuild) {
    row.class = 'ERROR: ' + (r.error ?? '').slice(0, 100);
  } else {
    const total = r.volume ?? 0, bb = r.bbox;
    const diag = bb ? Math.hypot(bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]) : 1;
    row.scVolume = total; row.scFaces = (r.bodies ?? []).reduce((s, b) => s + b.faces, 0); row.scBbox = bb; row.scRefusals = r.refusals ?? [];
    row.brepVolume = rf?.brep?.volume ?? null; row.occtVolume = rf?.occt?.volume ?? null; row.closed = rf?.closed ?? null;
    row.brepFaces = rf?.brep?.faces ?? null; row.brepRefused = rf?.brep?.refused ?? null; row.occtRefused = rf?.occt?.refused ?? null;
    if (row.brepVolume != null) row.dBrep = rel(total, row.brepVolume);
    if (row.occtVolume != null) row.dOcct = rel(total, row.occtVolume);
    if (row.closed != null) row.dClosed = rel(total, row.closed);
    const refBox = rf?.occt?.bbox ?? rf?.brep?.bbox;
    if (bb && refBox) row.dBbox = Math.max(...refBox.map((w, i) => Math.abs(bb[i] - w) / Math.max(Math.abs(w), 1)));
    if (rf?.occt?.com && r.bodies?.length === 1 && r.bodies[0].com) { row.dCom = Math.hypot(...r.bodies[0].com.map((c, i) => c - rf.occt.com[i])) / diag; row.comBar = 1e-6; }
    row.bar = tol; row.verdictPane = r.verdict;
    row.sketches = r.sketches ?? null; row.dof = r.sketches?.[0]?.dof ?? null; row.dofHand = ex.dof ?? null; row.dofMatch = r.dofMatch ?? null; row.paneDetail = r.detail ?? null;
    const refused = (r.features ?? []).filter((f) => f.status === 'refused').map((f) => f.id);
    row.scRefusedIds = refused;
    const brepRef = Object.keys(rf?.brepRefusals ?? {}), occtRef = Object.keys(rf?.occtRefusals ?? {});
    row.brepRefusedIds = brepRef; row.occtRefusedIds = occtRef;
    if (ex.divergence && ex.group !== 'diverge') row.class = r.pass === true && /VERIFIED/.test(r.verdict) ? 'VERIFIED against the plane-offset reference P only' : 'BAD: stub example not verified';
    else if (ex.group === 'diverge') row.class = r.pass === false && /DIVERGES|UNVERIFIED/.test(r.verdict) ? 'DIVERGES shown red (not a pass), as designed' : 'BAD: diverging example not red';
    else if (refused.length) {
      const brepBuilds = row.brepVolume != null;
      row.class = r.pass === true ? (brepBuilds ? 'EXPECTED REFUSAL: solidcraft stricter than brep-rs (brep-rs builds it)' : 'EXPECTED REFUSAL: brep-rs refuses too') : 'UNEXPECTED REFUSAL';
    } else {
      const refs = [row.dBrep, row.dOcct].filter((x) => x != null);
      const okRef = refs.length ? refs.every((d) => d <= tol) : (row.dClosed != null && row.dClosed <= tol);
      const disagree = row.dBrep != null && row.dOcct != null && rel(row.brepVolume, row.occtVolume) > tol;
      row.class = disagree ? 'REFERENCES DISAGREE (defect in a reference)' : okRef ? 'AGREES with ' + (refs.length ? 'brep-rs' + (row.dOcct != null ? ' and OCCT' : '') : 'closed form') : (row.dClosed != null && row.dClosed <= tol ? 'AGREES with closed form only (brep-rs/OCCT refuse or differ)' : 'DISAGREES');
    }
  }
  out.examples.push(row);
  console.log(ex.id.padEnd(28), (row.class ?? '').slice(0, 70).padEnd(70), row.dBrep != null ? 'dBrep ' + row.dBrep.toExponential(1) : '', row.dOcct != null ? 'dOcct ' + row.dOcct.toExponential(1) : '');
}

// ---- 2 error paths and stale panels ------------------------------------------------------------------------------
const panels = () => ev(`() => JSON.stringify({ verdict: document.getElementById('verdict').className, vtext: document.getElementById('verdict').textContent.slice(0, 160), features: document.getElementById("features").textContent.slice(0, 400), result: document.getElementById('result').textContent.slice(0, 100), status: document.getElementById('status').textContent })`);
const runCode = (code, wait = 1) => ev(`async () => { window.__host.setScript(${JSON.stringify(code)}); const r = await window.__host.runUnconfirmed(); return JSON.stringify({ r: { error: r && r.error, pass: r && r.pass, noNewBuild: r && r.noNewBuild, cancelled: r && r.cancelled, errorLine: r && r.errorLine } }); }`);
const bodiesNow = () => ev(`async () => JSON.stringify(JSON.parse(await window.solidcraft.inspect()).measure.bodies.map((b) => b.name + ':' + b.volume_mm3.toFixed(3)))`);
if (!process.argv.includes("--examples-only") && (!only.length || process.argv.includes("--skip-examples"))) {
  ev(`async () => JSON.stringify(await window.__host.runExample('3d-box-hole').then((r) => r.pass))`);
  const baseline = await bodiesNow();
  const cases = [
    ['syntax error', 'const b = cuboid(40, 30\nhole(b, { across: 6 })', /SCRIPT ERROR/],
    ['runtime error on line 3', 'const a = 1\nconst b = cuboid(40, 30, 10)\nundefinedThing(b)', /SCRIPT ERROR \(line 3/],
    ['runaway loop (10 s kill)', 'while (true) {}', /ERROR|longer than 10 s/],
    ['huge pattern count', "const b = cuboid(10, 10, 10)\nlinearPattern(b, { count: 100000, step: 20 })", /REFUSED BEFORE BUILD/],
    ['huge dimension', 'const b = cuboid(1e12, 10, 10)', /REFUSED BEFORE BUILD/],
  ];
  for (const [name, code, want] of cases) {
    let r; const t0 = Date.now();
    try { r = runCode(code).r; } catch (e) { r = { error: String(e.message).slice(0, 120) }; }
    const p = panels(); const after = await bodiesNow();
    const row = { name, headline: p.vtext, verdictClass: p.verdict, features: p.features, result: p.result, status: p.status, seconds: (Date.now() - t0) / 1000, designUnchanged: JSON.stringify(after) === JSON.stringify(baseline), red: p.verdict === 'fail', noStalePanels: /No new build|Running/.test(p.features) && /No new build/.test(p.result), matchedExpected: want.test(p.vtext) };
    out.errorPaths.push(row); console.log('ERRPATH', name.padEnd(28), JSON.stringify({ red: row.red, stale: !row.noStalePanels, unchanged: row.designUnchanged, s: row.seconds }));
    if (name === 'syntax error' || name.startsWith('runtime')) shot('pane-error-' + name.replace(/\W+/g, '-'));
  }
  // tampered ModelDoc post: forged results/docs must not build anything
  const forged = [
    ['doc with unknown kind', { version: 1, features: [{ id: 'x', kind: 'rm_rf' }] }],
    ['count 1e9', { version: 1, features: [{ id: 'p', kind: 'pattern', count: 1e9 }] }],
    ['value 1e30', { version: 1, features: [{ id: 'b', kind: 'box', length: 1e30, width: 1, height: 1 }] }],
    ['not a doc', { version: 2 }],
    ['300k chars', '__BIG__'],
  ];
  for (const [name, doc] of forged) {
    const msg = ev(doc === '__BIG__' ? `() => JSON.stringify(window.__host.validDoc({ version: 1, features: [{ id: 'n', kind: 'box', note: 'x'.repeat(300000) }] }))` : `() => JSON.stringify(window.__host.validDoc(${JSON.stringify(doc)}))`);
    out.errorPaths.push({ name: 'tampered doc: ' + name, refusedWith: msg, refused: typeof msg === 'string' && msg.length > 0 });
    console.log('TAMPER', name.padEnd(24), msg ? 'refused: ' + String(msg).slice(0, 80) : 'ACCEPTED');
  }
  // a forged runner reply from the top window (source != the sandbox iframe) is ignored
  const spoof = ev(`async () => { const before = document.getElementById('verdict').textContent; window.postMessage({ source: 'reshape-result', runId: 1, errors: [], doc: { version: 1, features: [] } }, '*'); await new Promise((r) => setTimeout(r, 400)); return JSON.stringify({ same: before === document.getElementById('verdict').textContent }); }`);
  out.errorPaths.push({ name: 'forged reshape-result posted by the page itself is ignored (source check)', ok: spoof.same === true });
  console.log('TAMPER spoof result ignored:', spoof.same);

  // ---- 3 Run vs manual work -------------------------------------------------------------------------------------
  const M = out.manualWork;
  ev(`async () => JSON.stringify(await window.__host.runExample('3d-box-hole').then((r) => r.pass))`);
  const scriptOwned = await bodiesNow();
  // hand work through the app's own command line
  pw('mousemove', '250', '666'); pw('mousedown'); pw('mouseup'); await sleep(400);
  pw('type', 'solid.cylinder {"radius": 4, "height": 30, "base": [60, 0, 0], "axis": "Z"}'); pw('press', 'Enter'); await sleep(1500);
  const manual = await bodiesNow();
  M.push({ step: 'hand-made cylinder added', bodies: manual, changed: JSON.stringify(manual) !== JSON.stringify(scriptOwned) });
  const pending = ev(`async () => { window.__host.setScript('const b = cuboid(10, 10, 10)'); const p = window.__host.runUnconfirmed(); await new Promise((r) => setTimeout(r, 2500)); const box = document.getElementById('confirm'); const shown = !box.hidden; const txt = box.textContent.slice(0, 200); return JSON.stringify({ shown, txt }); }`);
  M.push({ step: 'Run with hand work asks first', ...pending, designBeforeAnswer: await bodiesNow() });
  shot('pane-confirm-banner');
  ev(`async () => { document.getElementById('cfn').click(); await new Promise((r) => setTimeout(r, 600)); return JSON.stringify(1); }`);
  const afterCancel = await bodiesNow();
  M.push({ step: 'Cancel leaves the hand-made design untouched', unchanged: JSON.stringify(afterCancel) === JSON.stringify(manual) });
  ev(`async () => { window.__host.setScript('const b = cuboid(10, 10, 10)'); window.__host.runUnconfirmed(); await new Promise((r) => setTimeout(r, 2500)); document.getElementById('cfy').click(); await new Promise((r) => setTimeout(r, 4000)); return JSON.stringify(1); }`);
  const replaced = await bodiesNow();
  const undoEnabled = ev(`() => JSON.stringify(!document.getElementById('undo').disabled)`);
  M.push({ step: 'Replace and run builds the script result and enables Restore my design', bodies: replaced, restoreEnabled: undoEnabled });
  ev(`async () => { document.getElementById('undo').click(); await new Promise((r) => setTimeout(r, 1500)); return JSON.stringify(1); }`);
  const restored = await bodiesNow();
  M.push({ step: 'Restore my design brings the hand-made design back exactly', bodies: restored, same: JSON.stringify(restored) === JSON.stringify(manual) });
  // second run right after (design is now manual again): ask again; checkpoint semantics hold
  for (const m of M) console.log('MANUAL', m.step, JSON.stringify(m).slice(0, 160));
  shot('pane-after-restore');
}
writeFileSync(path.join(HERE, OUTNAME ? OUTNAME : only.length ? 'browser-results.partial.json' : process.argv.includes('--skip-examples') ? 'browser-results-errors.json' : 'browser-results.json'), JSON.stringify(out, null, 1) + '\n');
console.log('wrote browser-results.json');
