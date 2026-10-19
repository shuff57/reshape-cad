// Refusal probes and the critic's specific repros, guarded vs unguarded, plus the plain-sentence audit over every sentence this group can produce.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun probes.mjs [--out=out/probes.json]
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import * as lib from './lib.mjs';
import { CASES, H, roughen, plainRules, L, C, A, loopJoins, len, rectG, rectShape, atOrigin, dX, dY, dist, tj, slotArea } from './cases.mjs';
import { classify } from './score.mjs';
import { ladderSketch, guardedSketch } from './guard.mjs';
const OUTF = (process.argv.find((a) => a.startsWith('--out=')) ?? '--out=out/probes.json').slice(6);
const out = { probes: [], repros: [], slotRefusals: [] };
const sentences = new Set();
const note = (s) => { if (s) sentences.add(s); };
// ---- A. the probe cases (rows with no honest counterpart / bad input) through the guarded route
for (const cs of CASES.filter((c) => c.probe || /^(rect-reference-distanceX-zero|rect-conflicting|rect-redundant|tangent-line-circle-side-opposite|circle-circle-mode-request|triangle-angle-wrong)/.test(c.id))) {
  const g = ladderSketch({ geoms: cs.geoms, rules: plainRules(cs.rules) });
  const u = lib.scSketch(cs.geoms, plainRules(cs.rules));
  const uTxt = u.mapperRefused ? 'mapper: ' + u.mapperRefused.join(' | ') : u.firstRefusal ? 'solidcraft: ' + u.firstRefusal.error : u.body ? 'BUILT ' + u.body.volume.toFixed(3) : 'no body';
  out.probes.push({ id: cs.id, expect: cs.expect, guardedOk: g.ok, stage: g.stage, sentence: g.sentence ?? null, unguarded: uTxt });
  note(g.sentence);
  console.log(`${cs.id.padEnd(52)} ${g.ok ? 'BUILT' : 'REFUSED[' + g.stage + ']'} ${g.sentence ?? ''}\n    (unguarded: ${uTxt.slice(0, 200)})`);
}
// ---- A2. one wrong-kind probe per rule kind, so every kind has a measured plain sentence
{
  const base = () => ({ geoms: [...rectG(0, 0, 30, 20), C(5, [10, 10], 3), { k: 'point', id: 6, p: [5, 5] }], rules: [...rectShape(), atOrigin(1), len(1, 30), len(2, 20)] });
  const KIND = {
    'horizontal on a circle': { k: 'horizontal', a: 5 }, 'vertical on a circle': { k: 'vertical', a: 5 }, 'parallel line to circle': { k: 'parallel', a: 1, b: 5 }, 'perpendicular line to circle': { k: 'perpendicular', a: 1, b: 5 },
    'symmetric about a circle': { k: 'symmetric', a: 1, aEnd: 'a', b: 3, bEnd: 'a', c: 5 }, 'radius on a line': { k: 'radius', a: 1, value: 5 }, 'diameter on a line': { k: 'diameter', a: 1, value: 5 },
    'distanceY names a missing geometry': { k: 'distanceY', a: 1, aEnd: 'a', b: 99, bEnd: 'a', value: 3 }, 'tangent endpoint on a circle end': { k: 'tangent', a: 1, aEnd: 'b', b: 5, bEnd: 'a' },
    'pointOnObject on a missing curve': { k: 'pointOnObject', a: 1, aEnd: 'a', b: 42 }, 'unknown rule kind': { k: 'collinear', a: 1, b: 2 }, 'distance with no value': { k: 'distance', a: 1, aEnd: 'a', b: 3, bEnd: 'a' },
  };
  for (const [name, row] of Object.entries(KIND)) {
    const b = base(); const g = ladderSketch({ geoms: b.geoms, rules: [...b.rules, row] });
    out.probes.push({ id: `kind-probe: ${name}`, expect: 'refuse', guardedOk: g.ok, stage: g.stage, sentence: g.sentence ?? null });
    note(g.sentence);
    console.log(`kind-probe ${name.padEnd(40)} ${g.ok ? 'BUILT' : 'REFUSED[' + g.stage + ']'} ${g.sentence ?? ''}`);
  }
}
// ---- A3. legacy edge / corner numbers are 1-based: out-of-range numbers are refused by the script layer before any geometry
for (const [name, call] of [['across(9) on a 4-corner polygon', 'sk.across(9)'], ['across(0)', 'sk.across(0)'], ['pin(7) on a 4-corner polygon', 'sk.pin(7)'], ['distX(0, 2, 5)', 'sk.distX(0, 2, 5)']]) {
  const run = lib.runScript(`const sk = sketch('top')\nsk.polygon([[0, 0], [30, 0], [30, 20], [0, 20]])\n${call}\nconst part = extrude(sk, ${H})`);
  const s = run.errors?.map((e) => e.message).join(' | ') ?? null;
  out.probes.push({ id: `legacy-number-probe: ${name}`, expect: 'refuse', guardedOk: !s, stage: 'script', sentence: s });
  note(s); console.log(`legacy-number-probe ${name.padEnd(36)} ${s ? 'REFUSED[script] ' + s : 'BUILT'}`);
}
// ---- B. the repros named by the critic
function repro(name, f) { const r = f(); out.repros.push({ name, ...r }); console.log('REPRO', name, JSON.stringify(r).slice(0, 700)); note(r.guardedSentence); }
// B1 arc ends off the circle + lock on c
repro('arc rows off the circle + lock on c', () => {
  const cs = CASES.find((c) => c.id === 'slot-arc-rows-inconsistent-with-lock-c');
  const u = lib.scSketch(cs.geoms, plainRules(cs.rules)); const g = ladderSketch({ geoms: cs.geoms, rules: plainRules(cs.rules) });
  const want = slotArea(40, 10) * H;
  const lockViol = null; // round 5: SolidCraft's solved centre is not readable on the supplied pkg
  return { unguardedVolume: u.body?.volume, wantVolume: want, unguardedLockViolationMm: lockViol, guardedBuilt: g.ok, guardedSentence: g.sentence };
});
// B2 origin reference without an end in a dimension (brep-rs refuses it)
repro('origin (-1) without an end in distanceX', () => {
  const geoms = rectG(0.3, 0.2, 28.4, 17.1);
  const rules = [...rectShape(), { k: 'distanceX', a: -1, b: 1, bEnd: 'a', value: 5 }, { k: 'distanceY', a: -1, aEnd: 'a', b: 1, bEnd: 'a', value: 3 }, len(1, 30), len(2, 20)];
  const u = lib.scSketch(geoms, rules); const b = lib.brepSolve(geoms, rules); const g = ladderSketch({ geoms, rules });
  return { unguardedScBuilt: !!u.body, unguardedScBbox: u.body?.bbox, brepRsOpenError: b.open ?? b.lastError ?? null, brepRsSolved: b.solved ?? null, guardedBuilt: g.ok, guardedSentence: g.sentence };
});
// B3 over-constrained consistent / inconsistent soup docs
repro('conflicting equal + tangent (over-constrained circles)', () => {
  const geoms = [C(1, [0, 0], 8), C(2, [13, 0], 5)];
  const rules = [{ k: 'lock', a: 1, aEnd: 'c' }, { k: 'radius', a: 1, value: 8 }, { k: 'radius', a: 2, value: 5 }, { k: 'pointOnObject', a: 2, aEnd: 'c', b: -2 }, { k: 'tangent', a: 1, b: 2 }, { k: 'distanceX', a: 1, aEnd: 'c', b: 2, bEnd: 'c', value: 14 }];
  const u = lib.scSketch(geoms, rules); const g = ladderSketch({ geoms, rules });
  return { unguarded: u.mapperRefused ?? u.firstRefusal?.error ?? (u.body ? 'BUILT ' + u.body.volume : 'no body'), guardedBuilt: g.ok, guardedSentence: g.sentence };
});
// B4 spurious refusals of a valid slot from a rough start, both slots, four row orders, three amplitudes, 24 starts each
{
  const ORD = { 'as written': (r) => r, reversed: (r) => [...r].reverse(), 'dimensions first': (r) => [...r.filter((x) => ['distance', 'distanceX', 'distanceY', 'radius', 'diameter', 'angle'].includes(x.k)), ...r.filter((x) => !['distance', 'distanceX', 'distanceY', 'radius', 'diameter', 'angle'].includes(x.k))], 'tangents first': (r) => [...r.filter((x) => x.k === 'tangent'), ...r.filter((x) => x.k !== 'tangent')] };
  for (const id of ['slot-hand-rows-R10-L40', 'slot-dims-from-points']) for (const [oname, of] of Object.entries(ORD)) for (const frac of [0.02, 0.04, 0.06]) {
    const cs = CASES.find((c) => c.id === id);
    const t = { unguarded: {}, guarded: {}, unguardedErrors: {} }; const add = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
    for (let k = 0; k < 24; k++) {
      const st = roughen(cs.geoms, cs.rules, `${id}-refusal#${k}#${frac}`, frac), rules = of(plainRules(cs.rules));
      const u = lib.scSketch(st, rules);
      if (u.mapperRefused || u.firstRefusal || u.extrudeError || !u.body) { add(t.unguarded, 'REFUSED'); add(t.unguardedErrors, (u.firstRefusal?.error ?? u.extrudeError ?? u.mapperRefused?.join(' ') ?? '').replace(/[-0-9.]+(e-?[0-9]+)?/g, '#').replace(/k# \([A-Za-z]+\)(, )?/g, '').slice(0, 130)); }
      else { const c = classify(cs, u.body, st).cls; add(t.unguarded, c === 'TOL-MISS' ? 'MATCH' : c); }
      const g = ladderSketch({ geoms: st, rules });
      if (!g.ok) { add(t.guarded, 'REFUSED'); note(g.sentence); } else { const c = classify(cs, g.body, st).cls; add(t.guarded, c === 'MATCH' || c === 'TOL-MISS' ? 'MATCH' : 'WRONG'); }
    }
    out.slotRefusals.push({ id, order: oname, frac, ...t });
    console.log(`slot ${id} ${oname.padEnd(17)} ${frac}: unguarded ${JSON.stringify(t.unguarded)} guarded ${JSON.stringify(t.guarded)} unguarded SolidCraft error texts ${JSON.stringify(t.unguardedErrors)}`);
  }
}
// ---- C. the audit of every sentence moved to audit.mjs (reads $SENTENCE_LOG, counts sentences, checks internals)
writeFileSync(OUTF, JSON.stringify(out, null, 1));
