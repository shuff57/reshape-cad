#!/usr/bin/env node
// SPIKE (phase 7). Browser probe of the sketch-solver fix's documented limit: a line tangent to a LOCKED circle whose contact is
// pinned (A) only by a Distance, or (B) only through a Symmetric. Measures, from the solved points solidcraft stores, how far the
// contact (the line end) is from the TRUE tangent point (the foot of the circle centre on the line), 8 starts per probe.
// Session `p7probe` (throwaway, closed at the end; never `mom`).  node probe-sketch-limit.mjs [--url=http://127.0.0.1:8801] [--out=probe-sketch-limit-results.json]
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=').slice(1).join('=');
const BASE = arg('url', 'http://127.0.0.1:8801'); const OUT = arg('out', new URL('./probe-sketch-limit-results.json', import.meta.url).pathname);
const pw = (...a) => execFileSync('playwright-cli', ['-s=p7probe', ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
const ev = (fn) => { const o = pw('eval', fn); const m = o.match(/### Result\n([\s\S]*?)\n### /); if (!m) throw new Error('no result ' + o.slice(0, 300)); let v = JSON.parse(m[1]); if (typeof v === 'string') v = JSON.parse(v); return v; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try { pw('open', `${BASE}/?webgl&pane=on`); } catch { pw('goto', `${BASE}/?webgl&pane=on`); }
pw('resize', '1280', '720'); await sleep(6000);
ev(`() => { if (!window.__cap) { window.__cap = []; const e = window.solidcraft.execute.bind(window.solidcraft); window.solidcraft.execute = async (s) => { const r = await e(s); try { window.__cap.push(JSON.parse(r)); } catch {} return r; }; } return JSON.stringify(1); }`);
let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
const j = (v, amp) => +(v + rnd() * 2 * amp).toFixed(4);
const R = 5;
// geoms: 1 circle (centre locked, radius 5), 2 line L (a = contact), 3 point P / extra, 4 axis line
const ARCG = (amp, exact) => `{ k: 'arc', id: 1, c: [0, 0], r: ${exact ? R : j(R, amp / 2)}, a: [4.6985, 1.7101], b: [-4.6985, 1.7101], sense: 'ccw' }`;
const probeA = (amp, exact = false, arc = false) => `const sk = sketch('top')
sk.geom([
  ${arc ? ARCG(amp, exact) : `{ k: 'circle', id: 1, c: [0, 0], r: ${exact ? R : j(R, amp / 2)} }`},
  { k: 'line', id: 2, a: [${exact ? 0 : j(0, amp)}, ${exact ? 5 : j(5, amp)}], b: [${exact ? 12 : j(12, amp)}, ${exact ? 5 : j(5.5, amp)}] }
])
sk.rules([
  { k: 'lock', a: 1, aEnd: 'c' },
  { k: 'radius', a: 1, value: ${R} },
  { k: 'tangent', a: 2, b: 1 },
  { k: 'distance', a: 2, aEnd: 'a', b: 1, bEnd: 'c', value: ${R} }
])
const part = extrude(sk, 10)`;
const probeB = (amp, exact = false) => { const th = 0.9 + amp * 2 * (rnd() + 0.5); const ax = +(-R * Math.cos(th)).toFixed(6), ay = +(R * Math.sin(th)).toFixed(6); return `const sk = sketch('top')
sk.geom([
  { k: 'circle', id: 1, c: [0, 0], r: ${R} },
  { k: 'line', id: 2, a: [${ax}, ${ay}], b: [${exact ? +(ax + 8 * ay / R).toFixed(6) : j(ax + 8, amp * 4)}, ${exact ? +(ay + 8 * Math.cos(th)).toFixed(6) : j(ay + 6, amp * 4)}] },
  { k: 'point', id: 3, p: [${-ax}, ${ay}] },
  { k: 'line', id: 4, a: [0, -9], b: [0, 9] }
])
sk.rules([
  { k: 'lock', a: 1, aEnd: 'c' },
  { k: 'radius', a: 1, value: ${R} },
  { k: 'lock', a: 4, aEnd: 'a' },
  { k: 'lock', a: 4, aEnd: 'b' },
  { k: 'pointOnObject', a: 3, b: 1 },
  { k: 'symmetric', a: 2, aEnd: 'a', b: 3, c: 4 },
  { k: 'tangent', a: 2, b: 1 }
])
const part = extrude(sk, 10)`; };
// F: circle 2 (radius 3) tangent to the locked circle 1 (radius 5), their centres pinned 8 apart by a Distance (circle-to-circle)
const probeF = (amp, exact = false) => `const sk = sketch('top')
sk.geom([
  { k: 'circle', id: 1, c: [0, 0], r: 5 },
  { k: 'circle', id: 2, c: [${exact ? 8 : j(8.4, amp)}, ${exact ? 0 : j(0.3, amp)}], r: ${exact ? 3 : j(3, amp / 2)} }
])
sk.rules([
  { k: 'lock', a: 1, aEnd: 'c' },
  { k: 'radius', a: 1, value: 5 },
  { k: 'radius', a: 2, value: 3 },
  { k: 'tangent', a: 2, b: 1 },
  { k: 'distance', a: 2, aEnd: 'c', b: 1, bEnd: 'c', value: 8 }
])
const part = extrude(sk, 10)`;
const probeC = () => `const sk = sketch('top')
sk.geom([
  { k: 'circle', id: 1, c: [0, 0], r: ${R} },
  { k: 'line', id: 2, a: [-3, 4], b: [9, 9] },
  { k: 'point', id: 3, p: [3, 4] },
  { k: 'line', id: 4, a: [0, -9], b: [0, 9] }
])
sk.rules([
  { k: 'lock', a: 1, aEnd: 'c' },
  { k: 'radius', a: 1, value: ${R} },
  { k: 'lock', a: 4, aEnd: 'a' },
  { k: 'lock', a: 4, aEnd: 'b' },
  { k: 'lock', a: 3, aEnd: 'a' },
  { k: 'symmetric', a: 2, aEnd: 'a', b: 3, c: 4 },
  { k: 'tangent', a: 2, b: 1 }
])
const part = extrude(sk, 10)`;
async function run(code) {
  ev(`() => { window.__cap.length = 0; return JSON.stringify(1); }`);
  return ev(`async () => { window.__host.setScript(${JSON.stringify(code)}); const r = await window.__host.runUnconfirmed();
    const caps = window.__cap.filter((c) => c && c.sketches && c.sketches.length); const last = caps[caps.length - 1];
    const sn = last && last.sketches[0];
    return JSON.stringify({ err: r && r.error, pass: r && r.pass, ok: last && last.ok, refusal: JSON.stringify(last && (last.failed || last.error || last.sentence || last.refused) || null), keys: last && Object.keys(last), failedKeys: last && last.failed && Object.keys(last.failed), allcaps: window.__cap.map((c) => Object.keys(c).join(',')), sketch: sn && { report: sn.report, points: sn.sketch && sn.sketch.points, curves: sn.sketch && sn.sketch.curves }, text: document.getElementById('sketches').innerText.slice(0, 300) + ' || ' + document.getElementById('features').innerText.slice(0, 500), msg: document.body.innerText.match(/neither entity[^.]*\\./i) }); }`);
}
const analyse = (res) => {
  const sentence = (res.text.match(/solidcraft refused it -- ([^\n]*)/) ?? [])[1] ?? null;
  if (!res.sketch) return { refused: true, ok: res.ok, sentence, text: res.text };
  const P = Object.fromEntries(res.sketch.points.map((p) => [p.id, p.pos])); const C = res.sketch.curves.find((c) => c.type === 'circle' || c.type === 'arc');
  const cen = P[C.c === 1 || C.c === undefined ? 'g1.center' : 'g1.center'] ?? [0, 0]; const a = P['g2.start'], b = P['g2.end'];
  const d = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(...d); const t = ((cen[0] - a[0]) * d[0] + (cen[1] - a[1]) * d[1]) / L; // signed distance a -> foot
  const perp = Math.abs(d[0] * (cen[1] - a[1]) - d[1] * (cen[0] - a[0])) / L;
  const m = res.text.match(/worst residual ([0-9.e+-]+)/);
  return { sentence, status: res.sketch.report.status, dof: res.sketch.report.dof, redundant: res.sketch.report.redundant, failing: res.sketch.report.failing, solverMaxResidual: res.sketch.report.max_residual,
    paneWorstResidual: m ? +m[1] : null, contactErrMm: Math.abs(t), perpMinusR: perp - C.r, R: C.r };
};
const results = { generatedAt: new Date().toISOString(), url: BASE, probes: {} };
const AMPS = [0, 0.05, 0.1, 0.25, 0.5, 0.05, 0.1, 0.25]; // 8 starts: amp 0 = nominal start, 7 jittered starts
const only = arg("only", ""); const probeD = (amp, exact = false) => probeA(amp, exact, true);
const analyseF = (res) => { const sentence = (res.text.match(/solidcraft refused it -- ([^\n]*)/) ?? [])[1] ?? (res.text.match(/neither entity[^|]*|already determined[^|]*/) ?? [])[0] ?? null;
  if (!res.sketch) return { refused: true, ok: res.ok, sentence, text: res.text.slice(0, 300) };
  const P = Object.fromEntries(res.sketch.points.map((p) => [p.id, p.pos])); const c1 = P['g1.center'], c2 = P['g2.center'];
  return { sentence, status: res.sketch.report.status, dof: res.sketch.report.dof, redundant: res.sketch.report.redundant, failing: res.sketch.report.failing, centreDist: c1 && c2 ? Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) : null }; };
for (const [name, mk] of [["A distance-pinned contact", probeA], ["B Symmetric-tied contact", probeB], ["D distance-pinned contact, ARC", probeD]].filter(([n]) => !only || n.startsWith(only))) {
  seed = 12345; results.probes[name] = [];
  for (const amp of AMPS) { const code = mk(amp); const r = analyse(await run(code)); results.probes[name].push({ amp, ...r }); console.log(name, amp, JSON.stringify(r)); }
}
for (const [n, mk] of [['A0 exact-tangent start', probeA], ['B0 exact-tangent start', probeB], ['D0 exact-tangent start, ARC', probeD]]) { if (only && !n.startsWith(only)) continue; const r = analyse(await run(mk(0, true))); results.probes[n] = r; console.log(n, JSON.stringify(r)); }
if (!only || 'F'.startsWith(only)) { results.probes['F circle-to-circle distance pin'] = []; seed = 12345; for (const amp of [0, 0.05, 0.1, 0.25, 0.5]) { const r = analyseF(await run(probeF(amp))); results.probes['F circle-to-circle distance pin'].push({ amp, ...r }); console.log('F', amp, JSON.stringify(r)); }
  const r = analyseF(await run(probeF(0, true))); results.probes['F0 exact-tangent start'] = r; console.log('F0', JSON.stringify(r)); }
const c = analyse(await run(probeC())); results.probes['C Symmetric pin, partner fully locked'] = c; console.log('C', JSON.stringify(c));
writeFileSync(OUT, JSON.stringify(results, null, 1));
pw('close');
