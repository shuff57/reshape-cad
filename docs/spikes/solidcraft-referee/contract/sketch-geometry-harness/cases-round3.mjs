// Round 3 (critic round 2) probes: downstream effect of a multi-piece sketch, self-crossing bulges and rounds, the near-limit
// zero-length-edge band, micro slots, touching-only soups, frame tolerance, many-shape performance, warnings reaching a host.
import { readFileSync } from 'node:fs';
import { runScript, truckBuild, buildOCCT, buildBrep, timing, measureCase, arc, friendly, REPO } from './sg-core.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const P = Math.PI;
const H = 10;

// ---- downstream: a feature after a sketch that produced several pieces --------------------------------------------------
const TWO = "const sk = sketch('top'); sk.rect(10, 10, { at: [-10, 0] }); sk.rect(10, 10, { at: [10, 0] }); const p = extrude(sk, 10);";
const RING = "const sk = sketch('top'); sk.circle(40); sk.circle(30); sk.circle(10); const p = extrude(sk, 10);";
const ringVol = P * (1750 + 250); // pi*(20^2-15^2)*10 + pi*5^2*10
function downstream(id, what, script, expectTotal, expectNote) {
  return {
    id, feature: 'multi-piece downstream', what,
    custom: async () => {
      const r = runScript(script);
      if (r.errors.length) return { id, what, outcome: 'SCRIPT-REFUSED', scriptErrors: r.errors.map((e) => `line ${e.line}: ${e.message}`), summary: { scriptErrors: r.errors.map((e) => e.message) } };
      const last = r.doc.features[r.doc.features.length - 1].id;
      const t = await truckBuild(r.doc, last);
      const o = buildOCCT(r.doc, last), b = buildBrep(r.doc, last);
      const total = (t.lastBodies ?? []).reduce((a, x) => a + x.volume, 0);
      const built = (t.all ?? []).filter((x) => x.status !== 'noop').map((x) => `${x.id}:${x.status}${x.refusal ? ` (${x.refusal})` : ''}`);
      const summary = {
        what, expectTotal, expectNote, features: built, translatorRefused: t.refused ?? null,
        translatorReportedVolume: t.m?.volume ?? null, truckTotalAllBodies: t.lastBodies ? total : null,
        truckBodies: (t.lastBodies ?? []).map((x) => `${x.name}=${x.volume.toFixed(3)}`),
        occt: o.m ? o.m.volume : `refused: ${o.refused}`, brep: b.m ? b.m.volume : `refused: ${b.refused}`,
        truckTotalVsExpected: expectTotal != null && t.lastBodies ? Math.abs(total - expectTotal) / Math.max(expectTotal, 1) : null,
        brepVsExpected: expectTotal != null && b.m ? Math.abs(b.m.volume - expectTotal) / Math.max(expectTotal, 1) : null,
      };
      const verdict = t.refused ? 'TRUCK-REFUSED' : (expectTotal == null ? 'NO-EXPECT' : (summary.truckTotalVsExpected <= 3e-4 ? 'PASS' : 'WRONG-SILENT'));
      return { id, what, outcome: verdict, summary, truck: { volume: t.m?.volume, bodies: t.lastBodies?.length ?? 0 }, occt: summary.occt, brep: summary.brep };
    },
  };
}

// ---- bulge docs (no script call writes a bulge) -------------------------------------------------------------------------
const bulgeDoc = (id, what, pts, e, bow) => ({
  id, feature: 'bulges', what,
  custom: async () => {
    const g = arc.bulgeFromBow(pts, e, bow);
    const doc = { version: 1, features: [{ id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: pts, bulges: { [e]: g } }, { id: 'pull1', kind: 'extrude', target: 'sk1', height: H }] };
    const o = buildOCCT(doc, 'pull1'), b = buildBrep(doc, 'pull1'), t = await truckBuild(doc, 'pull1');
    // independent self-crossing test: sample the arc and test it against every other edge with exact segment intersection
    const a = arc.arcFromBulge(pts[e], pts[(e + 1) % pts.length], g);
    const N = 400; const sw = ((a.endAngle - a.startAngle) + 4 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
    const polyArc = [];
    // arcFromBulge returns start/end angles; the sweep sign follows the bulge sign (ccw for g>0)
    let s0 = a.startAngle, s1 = a.endAngle; let d = s1 - s0;
    if (g > 0) { while (d <= 0) d += 2 * Math.PI; } else { while (d >= 0) d -= 2 * Math.PI; }
    for (let k = 0; k <= N; k++) polyArc.push([a.center[0] + a.radius * Math.cos(s0 + (d * k) / N), a.center[1] + a.radius * Math.sin(s0 + (d * k) / N)]);
    const segInter = (p, q, r, s) => { const o3 = (u, v, w) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]); return o3(p, q, r) * o3(p, q, s) < 0 && o3(r, s, p) * o3(r, s, q) < 0; };
    let crossings = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i === e) continue;
      const A = pts[i], B = pts[(i + 1) % pts.length];
      for (let k = 0; k < N; k++) if (segInter(polyArc[k], polyArc[k + 1], A, B)) { crossings++; break; }
    }
    const tv = t.m?.volume;
    return { id, what, outcome: t.refused ? 'TRUCK-REFUSED' : 'BUILT', summary: { bow, bulge: g, arcCrossesOtherEdges: crossings, truck: t.refused ? `refused: ${t.refused}` : { volume: tv, bodies: t.m?.bodies?.length, lastBodies: (t.lastBodies ?? []).map((x) => `${x.name}=${x.volume.toFixed(3)}`) }, occt: o.m ? o.m.volume : `refused: ${o.refused}`, brep: b.m ? b.m.volume : `refused: ${b.refused}` }, truck: t.m ? { volume: tv } : { refused: t.refused }, occt: o.m ? { volume: o.m.volume } : { refused: o.refused }, brep: b.m ? { volume: b.m.volume } : { refused: b.refused } };
  },
});

// ---- host path: which fields of a RunResult reach the student ------------------------------------------------------------
const hostWarnings = (id, script) => ({
  id, feature: 'warnings reach the host?',
  custom: async () => {
    const r = runScript(script);
    const REAL = REPO;
    const files = ['docs/spikes/solidcraft-referee/phase7/pane/src/runner-entry.mjs', 'docs/spikes/solidcraft-referee/phase7/pane/pane.js', 'docs/spikes/solidcraft-referee/phase5/host/app.js', 'docs/spikes/solidcraft-referee/phase5/host/src/runner-entry.mjs', 'docs/spikes/solidcraft-referee/phase6/pane/src/runner-entry.mjs', 'docs/spikes/solidcraft-referee/phase6/pane/pane.js'];
    const grep = {};
    for (const f of files) { try { const s = readFileSync(path.join(REAL, f), 'utf8'); grep[f] = (s.match(/warnings/g) ?? []).length; } catch { grep[f] = 'missing'; } }
    const entry = readFileSync(path.join(REAL, files[0]), 'utf8');
    const posted = (entry.match(/postMessage\(\{[\s\S]*?\}, '\*'\)/g) ?? []).find((x) => x.includes('reshape-result')) ?? '';
    return { id, outcome: 'INFO', summary: { scriptErrors: r.errors.map((e) => e.message), runResultWarnings: r.warnings ?? null, occurrencesOfWarningsInHostFiles: grep, resultMessageForwardedToTheHost: posted.replace(/\s+/g, ' ') } };
  },
});

// ---- many shapes: time -----------------------------------------------------------------------------------------------------
const plateHoles = (n) => {
  const side = Math.ceil(Math.sqrt(n)); const pitch = 20;
  const holes = []; for (let i = 0; i < n; i++) holes.push([(i % side - (side - 1) / 2) * pitch, (Math.floor(i / side) - (side - 1) / 2) * pitch]);
  return `const sk = sketch('top'); sk.rect(${side * pitch + 20}, ${side * pitch + 20}); ${holes.map((h) => `sk.circle(4, { at: [${h[0]}, ${h[1]}] })`).join('; ')}; const p = extrude(sk, 5);`;
};
const perf = (n, withPocket) => ({
  id: `perf-${n}-holes${withPocket ? '-then-pocket' : ''}`, feature: 'many shapes: time',
  custom: async () => {
    const script = plateHoles(n) + (withPocket ? ` const s2 = sketch('top', 5); s2.circle(3, { at: [0, ${((Math.ceil(Math.sqrt(n)) - 1) / 2) * 20 + 10}] }); pocket(s2, p, 1);` : '');
    const r = runScript(script);
    if (r.errors.length) return { id: `perf-${n}`, outcome: 'SCRIPT-REFUSED', scriptErrors: r.errors.map((e) => e.message) };
    const last = r.doc.features[r.doc.features.length - 1].id;
    timing.ms = 0; timing.calls = 0; timing.commands = 0;
    const t0 = performance.now();
    const t = await truckBuild(r.doc, last);
    const wall = performance.now() - t0;
    const side = Math.ceil(Math.sqrt(n));
    const expect = ((side * 20 + 20) ** 2 - n * P * 4) * 5;
    return { id: `perf-${n}-holes${withPocket ? '-then-pocket' : ''}`, outcome: t.refused ? 'TRUCK-REFUSED' : 'TIMED', summary: { holes: n, features: r.doc.features.filter((f) => f.kind !== 'sketch').map((f) => f.kind), wallMsTranslateAndBuild: Math.round(wall), msInsideSolidcraftWasm: Math.round(timing.ms), commandListsSent: timing.calls, commandsSentTotal: timing.commands, msPerHoleWasm: Math.round(timing.ms / n), refused: t.refused ?? null, volume: t.m?.volume ?? null, expectedPlateVolume: withPocket ? null : expect, bodies: t.lastBodies?.length ?? null } };
  },
});

const gapCase = (g) => ({ id: `geom-no-rules-gap-${g}`, feature: '.geom', what: `rect rows, no rules, a ${g} gap between line 3 and line 4`, script: `const sk = sketch('top'); sk.geom([{k:'line',id:1,a:[0,0],b:[20,0]},{k:'line',id:2,a:[20,0],b:[20,10]},{k:'line',id:3,a:[20,10],b:[0,10]},{k:'line',id:4,a:[0,${10 - g}],b:[0,0]}]); extrude(sk, 10)`, exact: { volume: 2000 - g * 10 / 2 * 10 } });
const rr = (r) => r * r * (1 - Math.PI / 4);
const poly10x30 = '[[0,0],[10,0],[10,30],[0,30]]';
const sq40 = '[[0,0],[40,0],[40,30],[0,30]]';

export const cases = [
  // ---------- multi-piece: downstream ----------
  downstream('ds-pocket-piece1', 'two 10x10x10 rects apart, pocket 4x4x5 into piece 1', TWO + " const s2 = sketch('top', 10); s2.rect(4, 4, { at: [-10, 0] }); pocket(s2, p, 5);", 2000 - 80),
  downstream('ds-pocket-piece2', 'two 10x10x10 rects apart, pocket 4x4x5 into piece 2', TWO + " const s2 = sketch('top', 10); s2.rect(4, 4, { at: [10, 0] }); pocket(s2, p, 5);", 2000 - 80),
  downstream('ds-pocket-island', 'ring (D40/D30) + island D10, pocket D4 x5 into the island', RING + " const s2 = sketch('top', 10); s2.circle(4); pocket(s2, p, 5);", ringVol - P * 4 * 5),
  downstream('ds-hole-piece1', 'two rects apart, hole D4 through (deep 20) at the centre of piece 1 (at is from the bbox centre of the whole part: [-10,0])', TWO + " hole(p, { across: 4, deep: 20, at: [-10, 0] });", 2000 - P * 4 * 10),
  downstream('ds-hole-piece2', 'two rects apart, hole D4 through (deep 20) at the centre of piece 2', TWO + " hole(p, { across: 4, deep: 20, at: [10, 0] });", 2000 - P * 4 * 10),
  downstream('ds-hole-between', 'two rects apart, hole D4 at [0,0] = between the pieces: cuts nothing in the oracle', TWO + " hole(p, { across: 4, deep: 20, at: [0, 0] });", 2000),
  downstream('ds-hole-island', 'ring + island, hole D4 through the island centre', RING + " hole(p, { across: 4, deep: 20 });", ringVol - P * 4 * 10),
  downstream('ds-groove-island', 'ring + island, 360 groove ring x4..5 z3..7 on the island', RING + " const g = sketch('front'); g.rect(1, 4, { at: [4.5, 5] }); groove(g, p, 360);", ringVol - P * (25 - 16) * 4),
  downstream('ds-groove-two-rects', 'two rects apart, 360 groove ring r9.5..10.5 z3..7 about Z: crosses both pieces', TWO + " const g = sketch('front'); g.rect(1, 4, { at: [10, 5] }); groove(g, p, 360);", null),
  downstream('ds-repeat-two-rects', 'two rects apart, repeat({count:2, step:[0,30,0]})', TWO + " repeat(p, { count: 2, step: [0, 30, 0] });", 4000),
  downstream('ds-repeat-ring', 'ring + island, repeat({count:2, step:[0,0,20]})', RING + " repeat(p, { count: 2, step: [0, 0, 20] });", 2 * ringVol),
  downstream('ds-mirror-two-rects', 'two rects apart at x=10 and x=30, mirror left-right', "const sk = sketch('top'); sk.rect(10, 10, { at: [10, 0] }); sk.rect(10, 10, { at: [30, 0] }); const p = extrude(sk, 10); mirror(p, 'left-right');", 4000),
  downstream('ds-hollow-open-top', 'two rects apart, hollow wall 1 open top', TWO + " hollow(p, { wall: 1, open: 'top' });", null),
  downstream('ds-hollow-closed', 'two rects apart, hollow wall 1 (closed)', TWO + " hollow(p, { wall: 1 });", null),
  downstream('ds-round-edge', 'two rects apart, round the top/right edge r1', TWO + " round(p.edge('top', 'right'), 1);", null),
  downstream('ds-draft-face', 'two rects apart, draft the right face', TWO + " draft(p.face('right'), 5, { neutral: 0 });", null),
  downstream('ds-control-single-pocket', 'CONTROL: ONE rect 10x10x10, pocket 4x4x5 (single body path)', "const sk = sketch('top'); sk.rect(10, 10); const p = extrude(sk, 10); const s2 = sketch('top', 10); s2.rect(4, 4); pocket(s2, p, 5);", 1000 - 80),
  downstream('ds-control-single-hole', 'CONTROL: ONE rect 10x10x10, hole D4 deep 20 at centre', "const sk = sketch('top'); sk.rect(10, 10); const p = extrude(sk, 10); hole(p, { across: 4, deep: 20 });", 1000 - P * 4 * 10),

  // ---------- .circle sign ----------
  { id: 'circle-neg-3', feature: '.circle', what: 'circle(-3) as the only shape', script: "const sk = sketch('top'); sk.circle(-3); extrude(sk, 10)", exact: { volume: P * 2.25 * 10 }, curved: true },
  { id: 'circle-neg-4', feature: '.circle', what: 'circle(-4) as the only shape', script: "const sk = sketch('top'); sk.circle(-4); extrude(sk, 10)", exact: { volume: P * 4 * 10 }, curved: true },
  { id: 'circle-zero-first', feature: '.circle', what: 'circle(0) as the only shape', script: "const sk = sketch('top'); sk.circle(0); extrude(sk, 10)" },
  { id: 'circle-neg-second', feature: '.circle', what: 'circle(-4) as the SECOND shape on the sketch', script: "const sk = sketch('top'); sk.rect(40, 30); sk.circle(-4); extrude(sk, 10)" },
  { id: 'circle-zero-second', feature: '.circle', what: 'circle(0) as the SECOND shape on the sketch', script: "const sk = sketch('top'); sk.rect(40, 30); sk.circle(0); extrude(sk, 10)" },

  // ---------- rows closed only by touching coordinates ----------
  { id: 'geom-square-norules', feature: '.geom', what: 'four .geom lines forming a square, NO rules (touching coordinates only)', script: "const sk = sketch('top'); sk.geom([{k:'line',id:1,a:[0,0],b:[20,0]},{k:'line',id:2,a:[20,0],b:[20,15]},{k:'line',id:3,a:[20,15],b:[0,15]},{k:'line',id:4,a:[0,15],b:[0,0]}]); extrude(sk, 10)", exact: { volume: 3000 } },
  { id: 'geom-square-withrules', feature: '.geom', what: 'the same square WITH the four coincident rules', script: "const sk = sketch('top'); sk.geom([{k:'line',id:1,a:[0,0],b:[20,0]},{k:'line',id:2,a:[20,0],b:[20,15]},{k:'line',id:3,a:[20,15],b:[0,15]},{k:'line',id:4,a:[0,15],b:[0,0]}]); sk.rules([{k:'coincident',a:1,aEnd:'b',b:2,bEnd:'a'},{k:'coincident',a:2,aEnd:'b',b:3,bEnd:'a'},{k:'coincident',a:3,aEnd:'b',b:4,bEnd:'a'},{k:'coincident',a:4,aEnd:'b',b:1,bEnd:'a'}]); extrude(sk, 10)", exact: { volume: 3000 } },
  ...[1e-9, 1e-7, 1e-6, 1e-5, 1e-4, 1e-3, 1e-2].map(gapCase),
  { id: 'fr-lines-coords-square', feature: 'sk.line', what: 'friendly: four sk.line calls by coordinates, no handle reuse', preamble: true, script: "const sk = sketch('top')\nsk.line([0,0],[20,0])\nsk.line([20,0],[20,15])\nsk.line([20,15],[0,15])\nsk.line([0,15],[0,0])\nconst part = extrude(sk, 10)", exact: { volume: 3000 } },
  { id: 'fr-lines-handles-square', feature: 'sk.line', what: 'friendly: the same square joined by handle reuse', preamble: true, script: "const sk = sketch('top')\nconst a = sk.line([0,0],[20,0])\nconst b = sk.line(a.b,[20,15])\nconst c = sk.line(b.b,[0,15])\nconst d = sk.line(c.b,a.a)\nconst part = extrude(sk, 10)", exact: { volume: 3000 } },
  { id: 'fr-remove-rectangle', feature: 'sk.remove', what: 'friendly: sk.remove() of an sk.rectangle(...) composite', preamble: true, script: "const sk = sketch('top')\nconst r = sk.rectangle([0,0],[20,10])\nsk.line([30,30],[40,40])\nsk.remove(r)\nconst part = extrude(sk, 10)" },
  { id: 'fr-remove-point', feature: 'sk.remove', what: 'friendly: sk.remove() of a stray point', preamble: true, script: "const sk = sketch('top')\nconst a = sk.line([0,0],[20,0])\nconst b = sk.line(a.b,[0,15])\nconst c = sk.line(b.b,a.a)\nconst p = sk.point([30,30])\nsk.remove(p)\nconst part = extrude(sk, 10)", exact: { volume: 1500 } },

  // ---------- bulges that cross the outline ----------
  bulgeDoc('bulge-cross-tri-neg4', 'triangle (0,0)(20,0)(0,15), edge 1 bowed inward by 4', [[0, 0], [20, 0], [0, 15]], 0, -4),
  bulgeDoc('bulge-cross-rect-neg5', 'rect 10x2, long edge bowed inward by 5 (a half circle through the opposite edge)', [[0, 0], [10, 0], [10, 2], [0, 2]], 0, -5),
  bulgeDoc('bulge-ok-tri-neg1', 'CONTROL: the same triangle bowed inward by only 1 (does not cross)', [[0, 0], [20, 0], [0, 15]], 0, -1),
  bulgeDoc('bulge-ok-rect-neg0.5', 'CONTROL: rect 10x2, bowed inward by 0.5 (does not cross)', [[0, 0], [10, 0], [10, 2], [0, 2]], 0, -0.5),
  bulgeDoc('bulge-cross-rect-pos5', 'rect 10x2, long edge bowed OUTWARD by 5 (no crossing: control for sign)', [[0, 0], [10, 0], [10, 2], [0, 2]], 0, 5),

  // ---------- a round whose arc reaches another edge ----------
  { id: 'round-crosses-spike', feature: '.round', what: 'corner 1 r5 (the limit) on a polygon with a notch tip at (1.5,0.5), inside the removed corner area', script: "const sk = sketch('top'); sk.polygon([[0,0],[10,0],[10,1],[1.5,0.5],[10,2],[10,10],[0,10]]); sk.round(1, 5); extrude(sk, 10)", curved: true },
  { id: 'round-ok-spike', feature: '.round', what: 'CONTROL: same polygon with r1 (arc stays clear of the tip)', script: "const sk = sketch('top'); sk.polygon([[0,0],[10,0],[10,1],[1.5,0.5],[10,2],[10,10],[0,10]]); sk.round(1, 1); extrude(sk, 10)", curved: true },
  { id: 'chamfer-crosses-spike', feature: '.chamfer', what: 'corner 1 chamfer d6 on the same polygon (chamfer line passes the notch tip)', script: "const sk = sketch('top'); sk.polygon([[0,0],[10,0],[10,1],[1.5,0.5],[10,2],[10,10],[0,10]]); sk.chamfer(1, 6); extrude(sk, 10)" },

  // ---------- near-limit band ----------
  ...[4.9, 4.99, 4.999, 4.9999, 4.99999, 4.999999].map((r) => ({ id: `round-pair-r${r}`, feature: '.round', what: `two adjacent corners of a 10-wide plate, r=${r} (flat ${(10 - 2 * r).toExponential(1)} left)`, script: `const sk = sketch('top'); sk.polygon(${poly10x30}); sk.round(1, ${r}); sk.round(2, ${r}); extrude(sk, 10)`, exact: { volume: (300 - 2 * rr(r)) * H }, curved: true })),
  ...[0.1, 0.01, 1e-3, 1e-4, 1e-5, 1e-6].map((r) => ({ id: `round-single-r${r}`, feature: '.round', what: `one corner of a 40x30 plate, r=${r}`, script: `const sk = sketch('top'); sk.polygon(${sq40}); sk.round(1, ${r}); extrude(sk, 10)`, exact: { volume: (1200 - rr(r)) * H }, curved: true })),
  ...[29, 29.9, 29.99, 29.9999, 29.999999].map((d) => ({ id: `chamfer-near-ceiling-d${d}`, feature: '.chamfer', what: `corner 1 of a 40x30 plate, chamfer ${d} (ceiling 30, ${(30 - d).toExponential(1)} of the 30 edge left)`, script: `const sk = sketch('top'); sk.polygon(${sq40}); sk.chamfer(1, ${d}); extrude(sk, 10)`, exact: { volume: (1200 - d * d / 2) * H } })),
  ...[1e-3, 1e-5, 1e-6].map((d) => ({ id: `chamfer-single-d${d}`, feature: '.chamfer', what: `corner 1 of a 40x30 plate, chamfer ${d}`, script: `const sk = sketch('top'); sk.polygon(${sq40}); sk.chamfer(1, ${d}); extrude(sk, 10)`, exact: { volume: (1200 - d * d / 2) * H } })),

  // ---------- micro scale ----------
  ...[0.5, 0.1, 0.01, 0.005, 0.002, 0.001].map((r) => ({ id: `slot-micro-r${r}`, feature: '.slot', what: `slot from (0,0) to (10,0), r=${r}, pulled 10`, script: `const sk = sketch('top'); sk.slot([0,0],[10,0],${r}); extrude(sk, 10)`, exact: { volume: (2 * r * 10 + P * r * r) * H }, curved: true })),
  ...[0.001, 0.0005].map((d) => ({ id: `circle-across-${d}`, feature: '.circle', what: `circle across ${d} (h 10)`, script: `const sk = sketch('top'); sk.circle(${d}); extrude(sk, 10)`, exact: { volume: P * d * d / 4 * 10 }, curved: true })),

  // ---------- frame tolerance ----------
  ...[1e-7, 5e-7, 9e-7].map((eps) => ({ id: `frame-shear-${eps}`, feature: 'sketch({origin,u,v})', what: `rect 30x20 on a frame with v = [${eps},1,0] (dot(u,v) = ${eps}, inside the language tolerance 1e-6)`, script: `const sk = sketch({ origin: [0, 0, 0], u: [1, 0, 0], v: [${eps}, 1, 0] }); sk.rect(30, 20); extrude(sk, 10)`, exact: { volume: 6000, bbox: [-15 - 10 * eps, -10, 0, 15 + 10 * eps, 10, 10] } })),
  { id: 'frame-u-length-9e-7', feature: 'sketch({origin,u,v})', what: 'rect 30x20 on a frame with |u| = 1 + 9e-7 (inside the tolerance)', script: "const sk = sketch({ origin: [0, 0, 0], u: [1.0000009, 0, 0], v: [0, 1, 0] }); sk.rect(30, 20); extrude(sk, 10)", exact: { volume: 6000 * 1.0000009, bbox: [-15.0000135, -10, 0, 15.0000135, 10, 10] } },

  // ---------- warnings and the host ----------
  hostWarnings('host-warn-round-over', "const sk = sketch('top'); sk.polygon([[0,0],[10,0],[10,20],[0,20]]); sk.round(1, 25); extrude(sk, 10)"),
  hostWarnings('host-warn-chamfer-over', "const sk = sketch('top'); sk.polygon([[0,0],[10,0],[10,20],[0,20]]); sk.chamfer(1, 50); extrude(sk, 10)"),
  hostWarnings('host-warn-round-zero', "const sk = sketch('top'); sk.polygon([[0,0],[10,0],[10,20],[0,20]]); sk.round(1, 0); extrude(sk, 10)"),
  hostWarnings('host-warn-round-neg', "const sk = sketch('top'); sk.polygon([[0,0],[10,0],[10,20],[0,20]]); sk.round(1, -2); extrude(sk, 10)"),
  hostWarnings('host-warn-round-circle', "const sk = sketch('top'); sk.circle(10); sk.round(1, 2); extrude(sk, 10)"),
  { id: 'round-over-10x20', feature: '.round', what: 'round(1,25) on a 10x20 plate: clamps to r5', script: "const sk = sketch('top'); sk.polygon([[0,0],[10,0],[10,20],[0,20]]); sk.round(1, 25); extrude(sk, 10)", exact: { volume: (200 - rr(5)) * H }, curved: true },
  { id: 'chamfer-over-10x20', feature: '.chamfer', what: 'chamfer(1,50) on a 10x20 plate: clamps to d10', script: "const sk = sketch('top'); sk.polygon([[0,0],[10,0],[10,20],[0,20]]); sk.chamfer(1, 50); extrude(sk, 10)", exact: { volume: (200 - 50) * H } },

  // ---------- many shapes: time ----------
  perf(1, false), perf(5, false), perf(10, false), perf(25, false), perf(25, true),
];
