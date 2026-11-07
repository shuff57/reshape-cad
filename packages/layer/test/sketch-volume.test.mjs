// The check of a pull's built volume and pieces against its sketch (src/sketch-volume.ts), a port of the contract's reconcileExtrude.
// No kernel: a tiny fake engine that reports, for each pulled body, the volume and the number of pieces the test chooses. Every planner set is run.
//
// The case that made it (docs/spikes/solidcraft-referee/GUARD-SKETCH-VOLUME.md): rect(40, 30), chamfer(1, 0.0001), pulled 10. The pinned kernel builds
// 11999.99499995 mm3 with the right commands; the closed form, OCCT and brep-rs give 11999.99999995.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lib } from './unified-harness.mjs';
import { rect, circ, extrude } from './docs.mjs';

const sv = await import(new URL('../dist/sketch-volume.js', import.meta.url).href);
const { runScript } = lib.script;
const { solveDoc } = lib.codegen;
const ALL_SETS = ['base', 'extrude-pocket', 'holes', 'shell-draft', 'patterns-mirror', 'booleans', 'revolve-groove', 'fillet-chamfer', 'unified'];
const TR = Object.fromEntries(ALL_SETS.map((p) => [p, lib.tr.createTranslator({ planners: p })]));

const BUG = "const sk = sketch('top'); sk.rect(40, 30); sk.chamfer(1, 0.0001); extrude(sk, 10)";
const docOf = (src) => { const r = runScript(src); assert.deepStrictEqual(r.errors, []); return solveDoc(r.doc); };
const EXACT = (1200 - 0.0001 ** 2 / 2) * 10; // 11999.99999995
const WRONG = 11999.99499995; // what the pinned kernel builds (HALT.md, three routes, 0.21.0 and 0.30.1)
const SENTENCE_WRONG = (sk) => `Pulling sketch ${sk} 10 mm should make about 12000 mm3 in one piece (its area 1200 mm2 times the length), but the 3D build came out 0.005 mm3 smaller, so it was not built; a thin wall or a very small gap between shapes is the usual cause, so make the walls thicker or draw the shapes on separate sketches.`;
const SENTENCE_PIECES = (sk) => `Pulling sketch ${sk} 10 mm should make about 12000 mm3 in one piece (its area 1200 mm2 times the length), but the 3D build came out at 12000 mm3 in 2 separate pieces, so it was not built; a thin wall or a very small gap between shapes is the usual cause, so make the walls thicker or draw the shapes on separate sketches.`;

/** A fake engine: every solid.extrude makes the body it names, with `volume` split over `pieces` bodies ("name", "name (2)", ...). Everything else is accepted. */
function fake({ volume, pieces = 1 }) {
  return async (cmds) => {
    const bodies = [];
    for (const c of cmds) {
      if (c.command !== 'solid.extrude' || !c.params.body_name) continue;
      for (let k = 0; k < pieces; k++) {
        const name = k ? `${c.params.body_name} (${k + 1})` : c.params.body_name;
        bodies.push({ name, bbox: { min: [-20, -15, 0], max: [20, 15, 10] }, volume_mm3: volume / pieces, area_mm2: 3800, faces: 7, kernel: { faces: 7, shells: 1 }, face_types: { plane: 7 }, center_of_mass: [0, 0, 5] });
      }
    }
    return { ok: true, measure: { bodies } };
  };
}
const run = async (set, doc, engine, extra = {}) => {
  const { _state, ...r } = await TR[set].translateDoc(structuredClone(doc), { arc: lib.arc, mt: lib.mt, runSC: engine, soups: {}, resolveAt: () => null, ...extra });
  return r;
};
const pullOf = (r) => r.features.find((f) => f.kind === 'extrude');

test('the bug case: every set refuses the pull with the approved sentence when the build is 0.005 mm3 short, and builds it when it is exact', async () => {
  const doc = docOf(BUG);
  const sk = doc.features.find((f) => f.kind === 'sketch').id;
  for (const set of ALL_SETS) {
    const bad = pullOf(await run(set, doc, fake({ volume: WRONG })));
    assert.equal(bad.status, 'refused', `${set}: ${JSON.stringify(bad).slice(0, 300)}`);
    assert.equal(bad.refusal, SENTENCE_WRONG(sk), set);
    assert.equal(bad.guard, sv.SKETCH_VOLUME_GUARD, set);
    const ok = pullOf(await run(set, doc, fake({ volume: EXACT })));
    assert.equal(ok.status, 'built', `${set}: ${JSON.stringify(ok).slice(0, 300)}`);
  }
});

test('a build in the wrong number of pieces keeps the contract\'s clause ("came out at ... in N separate pieces")', async () => {
  const doc = docOf(BUG);
  const sk = doc.features.find((f) => f.kind === 'sketch').id;
  for (const set of ALL_SETS) {
    const r = pullOf(await run(set, doc, fake({ volume: EXACT, pieces: 2 })));
    assert.equal(r.status, 'refused', set);
    assert.equal(r.refusal, SENTENCE_PIECES(sk), set);
  }
});

test('a larger build says "larger"; ctx.skipSketchVolume switches the check off', async () => {
  const doc = docOf(BUG);
  const r = pullOf(await run('unified', doc, fake({ volume: EXACT + 0.01 })));
  assert.match(r.refusal, /came out 0\.01 mm3 larger, so it was not built;/);
  assert.equal(pullOf(await run('unified', doc, fake({ volume: WRONG }), { skipSketchVolume: true })).status, 'built');
});

test('the areas: exact by Green\'s theorem for outlines, circles and soups', () => {
  const doc = docOf(BUG);
  const sk = doc.features.find((f) => f.kind === 'sketch');
  const a = sv.sketchArea(sk, lib.arc);
  assert.ok(Math.abs(a.area - (1200 - 5e-9)) < 1e-10, String(a.area));
  assert.deepStrictEqual([a.regions, a.curved], [1, false]);
  const c = sv.sketchArea(circ('c1', 5), lib.arc);
  assert.ok(Math.abs(c.area - Math.PI * 25) < 1e-12 && c.curved);
  // a rounded corner: 40 x 30 with corner 1 rounded r = 2 loses (1 - pi/4) r^2
  const rd = docOf("const sk = sketch('top'); sk.rect(40, 30); sk.round(1, 2); extrude(sk, 10)");
  const ra = sv.sketchArea(rd.features.find((f) => f.kind === 'sketch'), lib.arc);
  assert.ok(Math.abs(ra.area - (1200 - 4 * (1 - Math.PI / 4))) < 1e-9, String(ra.area));
  assert.ok(ra.curved);
  // soups: a ring (one region, even-odd), two rects apart (two regions), a rect inside the ring's hole (two regions)
  const C = (id, cx, cy, r) => ({ k: 'circle', id, c: [cx, cy], r });
  const R = (id0, x0, y0, x1, y1) => { const p = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; return p.map((q, i) => ({ k: 'line', id: id0 + i, a: q, b: p[(i + 1) % 4] })); };
  const ring = sv.soupArea([C(1, 0, 0, 10), C(2, 0, 0, 4)]);
  assert.ok(Math.abs(ring.area - Math.PI * (100 - 16)) < 1e-9); assert.equal(ring.regions, 1); assert.ok(ring.curved);
  const two = sv.soupArea([...R(1, 0, 0, 10, 10), ...R(5, 20, 0, 30, 5)]);
  assert.deepStrictEqual([two.area, two.regions, two.curved], [150, 2, false]);
  const island = sv.soupArea([C(1, 0, 0, 10), C(2, 0, 0, 6), ...R(3, -2, -2, 2, 2)]);
  assert.ok(Math.abs(island.area - (Math.PI * 64 + 16)) < 1e-9); assert.equal(island.regions, 2);
  // an arc row joined to lines (a D shape): half disc r 10 + nothing else
  const D = sv.soupArea([{ k: 'arc', id: 1, c: [0, 0], r: 10, a: [10, 0], b: [-10, 0], sense: 'ccw' }, { k: 'line', id: 2, a: [-10, 0], b: [10, 0] }]);
  assert.ok(Math.abs(D.area - Math.PI * 50) < 1e-9, String(D.area));
  assert.equal(sv.soupArea([{ k: 'line', id: 1, a: [0, 0], b: [10, 0] }]), null, 'an open chain: no claim');
});

test('the length and the skips are the contract\'s, with the planners\' reading of length2', () => {
  const f = (o) => ({ id: 'e1', kind: 'extrude', target: 's1', height: 10, ...o });
  assert.equal(sv.pullLength(f({})), 10);
  assert.equal(sv.pullLength(f({ height: -10 })), 10);
  assert.equal(sv.pullLength(f({ length2: 4 })), 14);
  assert.equal(sv.pullLength(f({ length2: -4 })), 10, 'the planner ignores a length2 that is not positive');
  assert.equal(sv.pullLength(f({ midplane: true, length2: 4 })), 10);
  assert.equal(sv.pullLength(f({ taper: 5 })), null);
  assert.equal(sv.pullLength(f({ direction: [0, 1, 1], alongNormal: false })), null);
  assert.equal(sv.pullLength(f({ direction: [0, 1, 1] })), 10, 'a slanted pull measured along the normal is a sheared prism of the same volume');
  assert.equal(sv.pullLength(f({ height: 'h' })), null);
});

test('the tolerances: the referees\' bars, 1e-9 of the volume for a straight-edged sketch, 3e-4 for a curved one', () => {
  assert.deepStrictEqual({ ...sv.RECONCILE_TOL }, { planar: 1e-9, curved: 3e-4 });
  const planar = { area: 100, regions: 1, curved: false }; const curved = { area: 100, regions: 1, curved: true };
  const f = { id: 'e1', kind: 'extrude', target: 's1', height: 10 };
  assert.equal(sv.reconcilePull(f, planar, { volume: 1000 * (1 - 0.9e-9), pieces: 1 }), null);
  assert.match(sv.reconcilePull(f, planar, { volume: 1000 * (1 - 1.1e-9), pieces: 1 }), /^Pulling sketch s1 10 mm should make about 1000 mm3 in one piece \(its area 100 mm2 times the length\), but the 3D build came out 0\.0000011 mm3 smaller/);
  assert.equal(sv.reconcilePull(f, curved, { volume: 1000 * (1 - 2.9e-4), pieces: 1 }), null);
  assert.ok(sv.reconcilePull(f, curved, { volume: 1000 * (1 - 3.1e-4), pieces: 1 }));
  assert.equal(sv.reconcilePull(f, null, { volume: 1, pieces: 1 }), null, 'no area: no claim');
});

test('far from the origin the area keeps its digits (integrated about a point of the sketch)', () => {
  const sk = { id: 's1', kind: 'sketch', plane: 'xy', offset: 0, points: [[1e6, 1e6], [1e6 + 30, 1e6], [1e6 + 30, 1e6 + 24], [1e6, 1e6 + 24]] };
  assert.equal(sv.sketchArea(sk, lib.arc).area, 720);
  const R = (x0, y0, x1, y1) => { const p = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; return p.map((q, i) => ({ k: 'line', id: i + 1, a: q, b: p[(i + 1) % 4] })); };
  assert.equal(sv.soupArea(R(1e6, 1e6, 1e6 + 30, 1e6 + 24)).area, 720);
});

test('a soup whose rules do not hold on its drawn rows makes no claim (the engine solves them); one whose rules hold is checked', () => {
  const p = [[4.2, 2.1], [32.4, 2.1], [32.4, 19.1], [4.2, 19.1]];
  const geoms = p.map((q, i) => ({ k: 'line', id: i + 1, a: q, b: p[(i + 1) % 4] }));
  const coin = [1, 2, 3, 4].map((a) => ({ k: 'coincident', a, aEnd: 'b', b: (a % 4) + 1, bEnd: 'a' }));
  const sk = (rules) => ({ id: 's1', kind: 'sketch', plane: 'xy', offset: 0, geoms, rules });
  assert.ok(Math.abs(sv.sketchArea(sk(coin), lib.arc).area - 479.4) < 1e-9, 'coincident rules hold: checked');
  assert.equal(sv.sketchArea(sk([...coin, { k: 'distanceX', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 30 }]), lib.arc), null, 'a dimension that resizes it: no claim');
  assert.ok(sv.sketchArea(sk([...coin, { k: 'distanceX', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 30, driving: false }]), lib.arc), 'a reference dimension does not move rows');
  assert.equal(sv.sketchArea(sk([...coin, { k: 'nonsense', a: 1 }]), lib.arc), null, 'a rule the checker cannot evaluate: no claim');
});

test('a plain rect and a circle pulled through the fake with their exact volumes build in every set', async () => {
  const docs = [{ version: 1, features: [rect('s1', 20, 12), extrude('e1', 's1', 10)] }, { version: 1, features: [circ('s1', 5), extrude('e1', 's1', 7)] }];
  const vols = [2400, Math.PI * 25 * 7];
  for (const [i, doc] of docs.entries()) for (const set of ALL_SETS) assert.equal(pullOf(await run(set, doc, fake({ volume: vols[i] }))).status, 'built', `${set} doc ${i}`);
});
