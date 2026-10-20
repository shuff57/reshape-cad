// Round 6 (critic): sk-circle-arc-tangent__slot-r6-L30-floating (a slot left free: dof 2) builds 3634.8 against the closed form 4731.0 (23 % wrong) on the critic's 3.5 % rough start
// on the UNGUARDED route. Replays that exact start (the r4 remeasure roughen(), seeded by the fixture id) and 40 more seeded starts at 3.5 % and 15 %, unguarded and through the guard.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun floating-slot.mjs [--out=out/floating-slot.json]
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as lib from './lib.mjs';
import { H, roughen, plainRules, mulberry, seedOf, slotArea } from './cases.mjs';
import { ladderSketch } from './guard.mjs';
const OUTF = (process.argv.find((a) => a.startsWith('--out=')) ?? '--out=out/floating-slot.json').slice(6);
const { gauntletFixtures } = await import(pathToFileURL(path.join(lib.SPIKE, 'phase2/fixtures-p2.mjs')).href);
const fx = gauntletFixtures().find((g) => g.id === 'sk-circle-arc-tangent__slot-r6-L30-floating');
const rules = plainRules(fx.rules), want = slotArea(30, 6) * H, SIZE = [42, 12];
const clone = (o) => JSON.parse(JSON.stringify(o));
function geomBox(gs) { const pts = []; for (const g of gs) { if (g.k === 'point') pts.push(g.p); else if (g.k === 'line') pts.push(g.a, g.b); else if (g.k === 'circle') pts.push([g.c[0] - g.r, g.c[1] - g.r], [g.c[0] + g.r, g.c[1] + g.r]); else if (g.k === 'arc') pts.push(g.a, g.b, [g.c[0] - g.r, g.c[1] - g.r], [g.c[0] + g.r, g.c[1] + g.r]); } return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]; }
function criticRoughen(frac) { // the r4 remeasure-fixtures.mjs roughen(), verbatim apart from the helpers
  const rnd = mulberry(seedOf(fx.id)); const bb = geomBox(fx.geoms);
  const amp = frac * Math.max(Math.hypot(bb[2] - bb[0], bb[3] - bb[1]), 1);
  const locked = new Set(fx.rules.filter((r) => r.k === 'lock').map((r) => `${r.a}:${r.aEnd ?? ''}`));
  const j = () => (rnd() * 2 - 1) * amp; const mv = (p) => [p[0] + j(), p[1] + j()];
  return fx.geoms.map((g) => { const o = clone(g); const lk = (e) => locked.has(`${g.id}:${e}`);
    if (g.k === 'point') { if (!lk('a')) o.p = mv(g.p); }
    if (g.k === 'line') { if (!lk('a')) o.a = mv(g.a); if (!lk('b')) o.b = mv(g.b); }
    if (g.k === 'circle') { if (!lk('c')) o.c = mv(g.c); o.r = g.r * (1 + 0.1 * (rnd() * 2 - 1)); }
    if (g.k === 'arc') { if (!lk('c')) o.c = mv(g.c); if (!lk('a')) o.a = mv(g.a); if (!lk('b')) o.b = mv(g.b); o.r = g.r * (1 + 0.1 * (rnd() * 2 - 1)); }
    return o; });
}
const judge = (body) => { if (!body) return 'refused'; const b = body.bbox; const ok = lib.rel(body.volume, want) <= 3e-4 && Math.abs(Math.abs(b[3] - b[0]) - SIZE[0]) <= 2e-3 && Math.abs(Math.abs(b[4] - b[1]) - SIZE[1]) <= 2e-3; return ok ? 'RIGHT' : 'WRONG'; };
const add = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
const out = { id: fx.id, closedVolume: want, runs: [] };
const runOne = (label, start) => {
  const u = lib.scSketch(start, rules);
  const ub = u.mapperRefused || u.firstRefusal || u.extrudeError || !u.body ? null : u.body;
  const g = ladderSketch({ geoms: start, rules });
  return { label, unguarded: judge(ub), unguardedVolume: ub?.volume ?? null, guarded: g.ok ? judge(g.body) : 'REFUSED', guardedStage: g.ok ? null : g.stage, guardedSentence: g.ok ? null : g.sentence, guardedVolume: g.ok ? g.body.volume : null };
};
for (const frac of [0.035, 0.15]) {
  out.runs.push({ frac, ...runOne(`critic start ${frac}`, criticRoughen(frac)) });
  const tally = { unguarded: {}, guarded: {}, sentences: {} };
  for (let k = 0; k < 40; k++) {
    const r = runOne(`seed ${k}`, roughen(fx.geoms, fx.rules, `${fx.id}#floating#${k}#${frac}`, frac));
    add(tally.unguarded, r.unguarded); add(tally.guarded, r.guarded); if (r.guardedSentence) tally.sentences[r.guardedSentence] = (tally.sentences[r.guardedSentence] ?? 0) + 1;
    if (r.guarded === 'WRONG') (tally.wrongPassed ??= []).push(r);
  }
  out.runs.push({ frac, seeded40: tally });
  console.log(frac, 'critic start:', JSON.stringify(out.runs.at(-2)), '\n   40 seeds unguarded', JSON.stringify(tally.unguarded), 'guarded', JSON.stringify(tally.guarded));
}
writeFileSync(OUTF, JSON.stringify(out, null, 1));
