// Catalogue of every sentence the blend-loft guard can produce, taken from the LIVE guard (round 5), with its word count.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/blend-loft.sentences.mjs [--out=<file.json>]   (needs the pkg only because live-lib loads it; no kernel is run)
// A sentence is one sentence (one terminal full stop; semicolons allowed), names no kernel and no internal id, says first/second in the order the student typed.
import { writeFileSync } from 'node:fs';
import { sk, circ, bl, rectPts, regPts, roundedRectDoc, G, GR, arc, runScript, solveDoc } from './blend-loft.live-lib.mjs';
const out = (process.argv.find((a) => a.startsWith('--out=')) ?? '').slice(6);
const D = (f) => ({ version: 1, features: f });
const guardDoc = (doc) => { const m = G.guardDoc(solveDoc(doc), { outlineOf: arc.outlineOf }); return [...m.values()][0] ?? null; };
const guardScript = (src) => { const g = GR.guardedRun(src, { runScript, solveDoc, arc }); return [...g.verdicts.values()][0] ?? null; };
const rot = (P, t) => P.map(([x, y]) => [x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)]);
const pre = (a, b) => `const a = sketch('top'); ${a} const b = sketch('top'); ${b} `;
const cases = {
  sides: () => guardDoc(D([sk('a', 'xy', 0, rectPts(0, 0, 40, 40)), sk('b', 'xy', 30, rot(rectPts(0, 0, 20, 20), 20 * Math.PI / 180)), bl('a', 'b')])),
  'sides (small twist, 0.5 degrees)': () => guardDoc(D([sk('a', 'xy', 0, rectPts(0, 0, 40, 40)), sk('b', 'xy', 30, rot(rectPts(0, 0, 40, 40), 0.5 * Math.PI / 180)), bl('a', 'b')])),
  tie: () => guardDoc(D([sk('a', 'xy', 0, regPts(3, 20, 0)), sk('b', 'xy', 20, regPts(3, 10, Math.PI / 3)), bl('a', 'b')])),
  count: () => guardDoc(D([sk('a', 'xy', 0, [[0, 0], [40, 0], [40, 10], [10, 10], [10, 30], [0, 30]]), sk('b', 'xy', 20, rectPts(0, 0, 20, 15)), bl('a', 'b')])),
  start: () => guardDoc(D([sk('a', 'xy', 0, [[-13.375461382149439, 19.031380565016303], [-19.4123131494996, -1.968264348606761], [-12.262469210766941, -18.49060386403635], [-12.240228110471419, -20.237013779300984], [22.581217243318427, -1.5761345185260782]]), sk('b', 'xy', 60, [[-1.7837249620707993, -33.015241248401495], [-1.7650928309840248, -34.47826861845497], [17.618927900000845, -24.090334781300285], [-5.256231094244868, -10.980108752846718], [-7.676262324423972, -19.398370203044067]]), bl('a', 'b')])), // N7 pair of blend-loft.r4-results.json
  'circle-poly': () => guardDoc(D([sk('a', 'xy', 0, regPts(3, 20, 0)), circ('b', 0, 0, 20, 'xy', 25), bl('a', 'b')])),
  arcs: () => guardDoc(D([roundedRectDoc('a', 'xy', 0, 40, 20, 5), circ('b', 0, 0, 10, 'xy', 30), bl('a', 'b')])),
  'tilt (circles)': () => guardDoc(D([circ('a', 0, 0, 10, 'xy', 0), circ('b', 80, 0, 10, 'xy', 10), bl('a', 'b')])),
  'coarse (circle radius under 0.5)': () => guardDoc(D([circ('a', 0, 0, 0.05, 'xy', 0), circ('b', 0, 0, 0.05, 'xy', 300), bl('a', 'b')])),
  'coarse (circles, loft too long)': () => guardDoc(D([circ('a', 0, 0, 1, 'xy', 0), circ('b', 0, 0, 1, 'xy', 100), bl('a', 'b')])),
  'coarse (polygon <-> circle)': () => guardDoc(D([sk('a', 'xy', 0, regPts(6, 20, 0)), circ('b', 0, 0, 0.8, 'xy', 25), bl('a', 'b')])),
  'size-mix': () => guardDoc(D([sk('a', 'xy', 0, rectPts(0, 0, 40, 20)), circ('b', 0, 0, 50, 'xy', 60), bl('a', 'b')])),
  thin: () => guardDoc(D([sk('a', 'xy', 0, rectPts(0, 0, 40, 20)), circ('b', 0, 0, 10, 'xy', 8), bl('a', 'b')])),
  gap0: () => guardScript(pre('a.rect(40, 40);', 'b.rect(10, 10);') + 'loft(a, b, 0);'),
  same: () => guardScript(pre('a.rect(40, 40);', 'b.rect(10, 10);') + 'loft(a, a, 30);'),
  planes: () => guardScript("const a = sketch('top'); a.rect(40, 40); const b = sketch('front'); b.rect(10, 10); loft(a, b, 30);"),
  frame: () => guardScript("const a = sketch({ origin: [0,0,0], u: [1,0,0], v: [0,1,0] }); a.rect(40, 40); const b = sketch({ origin: [0,0,5], u: [1,0,0], v: [0,1,0] }); b.rect(10, 10); loft(a, b, 30);"),
  datum: () => guardScript("const a = sketch(plane('top', 0)); a.rect(40, 40); const b = sketch(plane('top', 30)); b.rect(20, 20); loft(a, b, 10);"),
  shared: () => guardScript(pre('a.rect(40, 40);', 'b.rect(20, 20);') + 'const p = pull(b, 10); const l = loft(a, b, 30); join(p, l);'),
  undrawn: () => guardScript("const a = sketch('top'); a.rect(40, 40); const b = sketch('top'); loft(a, b, 30);"),
  flat: () => guardScript(pre('a.rect(20, 20);', 'b.polygon([[0,0],[10,0],[20,0]]);') + 'loft(a, b, 20);'),
  crossing: () => guardScript(pre('a.rect(20, 20);', 'b.polygon([[-5,-5],[5,5],[5,-5],[-5,5]]);') + 'loft(a, b, 20);'),
  soup: () => guardScript(pre('a.rect(40, 40);', 'b.slot([0,0],[20,0],5);') + 'loft(a, b, 20);'),
  'targets (3)': () => guardDoc(D([sk('a', 'xy', 0, rectPts(0, 0, 40, 40)), sk('b', 'xy', 20, rectPts(0, 0, 20, 20)), sk('c', 'xy', 40, rectPts(0, 0, 10, 10)), bl('a', 'b', 'c')])),
  'targets (1)': () => guardDoc(D([sk('a', 'xy', 0, rectPts(0, 0, 40, 40)), bl('a')])),
};
const cat = {}; let over = 0;
for (const [k, f] of Object.entries(cases)) {
  let v; try { v = f(); } catch (e) { v = { code: 'THREW', sentence: e.message }; }
  const s = v?.sentence ?? null; const words = s ? s.split(/\s+/).length : 0; const stops = s ? (s.match(/[.!?](\s|$)/g) ?? []).length : 0;
  cat[k] = { code: v?.code ?? 'PASS', words, sentencesCount: stops, sentence: s };
  if (words > 45 || stops !== 1) over++;
  console.log(`${k.padEnd(36)} [${(v?.code ?? 'PASS').padEnd(10)}] ${String(words).padStart(2)} words, ${stops} sentence(s): ${s}`);
}
const maxWords = Math.max(...Object.values(cat).map((c) => c.words));
console.log(`max words ${maxWords}; sentences over 45 words or not exactly one: ${over}`);
if (out) writeFileSync(out, JSON.stringify({ maxWords, over, cat }, null, 1));
