// The OCCT referee (src/occt-build.ts) on the options of a pull and a pocket. Until 2026-11-13 it read none of them and built the plain one-sided prism
// instead, so on such a step the oracle answered with another solid. Each option is pinned here against a volume and a box worked out by hand; what
// the referee still does not build must be refused, never built as something else.
// Loads the real kernel (replicad-opencascadejs, a root devDependency for the referee apparatus); skipped where it is not installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const OCCT_DIR = path.join(root, 'node_modules', 'replicad-opencascadejs', 'dist');
const have = existsSync(path.join(OCCT_DIR, 'replicad_single.js')) && existsSync(path.join(root, 'packages/brep-adapter/dist/occt-build.js'));
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);

let oc, buildDoc, arc, solveDoc;
if (have) {
  const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
  oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
  ({ buildDoc } = await imp('packages/brep-adapter/dist/occt-build.js'));
  arc = await imp('packages/sketch/dist/sketch-arc.js');
  ({ solveDoc } = await imp('packages/script/dist/model-codegen.js'));
}
const PI = Math.PI; const k = (deg) => Math.tan(deg * PI / 180);
/** build `features` on the referee and measure feature `id`: { volume, box, com } or { refused } */
function measure(features, id) {
  const built = buildDoc(oc, solveDoc({ version: 1, features }), arc);
  const rf = built.refusals instanceof Map ? built.refusals.get(id) : built.refusals?.[id];
  if (rf) return { refused: String(rf) };
  const shape = built.shapes.get(id); assert.ok(shape, `${id} was not built and not refused`);
  const g = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(shape, g, 1e-7, false, false);
  const bx = new oc.Bnd_Box(); oc.BRepBndLib.AddOptimal(shape, bx, false, false);
  const lo = bx.CornerMin(), hi = bx.CornerMax(); const c = g.CentreOfMass();
  return { volume: g.Mass(), box: [lo.X(), lo.Y(), lo.Z(), hi.X(), hi.Y(), hi.Z()], com: [c.X(), c.Y(), c.Z()] };
}
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${what}: ${a} vs ${b}`);
const boxIs = (got, want, what) => want.forEach((w, i) => near(got[i], w, 1e-6, `${what} box[${i}]`));
const rect = (w, h, extra = {}) => ({ id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [w, 0], [w, h], [0, h]], ...extra });
const pull = (o) => [rect(24, 20), { id: 'e2', kind: 'extrude', target: 'sk1', height: 10, ...o }];
/** a 24 x 20 pad of `h` whose walls lean out by `deg` as it lengthens: the outline grows by z tan(a) with mitred corners */
const widening = (deg, h) => 480 * h + 88 * k(deg) * h * h / 2 + 4 * k(deg) ** 2 * h ** 3 / 3;
const opts = { skip: !have && 'replicad-opencascadejs or the built dist is not there' };

test('a plain pull is what it was: 24 x 20 x 10 above the sketch plane', opts, () => {
  const m = measure(pull({}), 'e2'); near(m.volume, 4800, 1e-9, 'volume'); boxIs(m.box, [0, 0, 0, 24, 20, 10], 'plain');
});
test('reversed: the same pad on the other side of the sketch plane', opts, () => {
  const m = measure(pull({ reversed: true }), 'e2'); near(m.volume, 4800, 1e-9, 'volume'); boxIs(m.box, [0, 0, -10, 24, 20, 0], 'reversed');
});
test('midplane: half the height either side; it wins over a second length', opts, () => {
  for (const o of [{ midplane: true }, { midplane: true, length2: 4 }]) { const m = measure(pull(o), 'e2'); near(m.volume, 4800, 1e-9, 'volume'); boxIs(m.box, [0, 0, -5, 24, 20, 5], 'midplane'); }
});
test('length2: a second length the opposite way, and with reversed the two swap sides', opts, () => {
  let m = measure(pull({ length2: 4 }), 'e2'); near(m.volume, 6720, 1e-9, 'volume'); boxIs(m.box, [0, 0, -4, 24, 20, 10], 'length2');
  m = measure(pull({ length2: 4, reversed: true }), 'e2'); near(m.volume, 6720, 1e-9, 'volume'); boxIs(m.box, [0, 0, -10, 24, 20, 4], 'length2 reversed');
});
test('taper: a positive angle widens the pad as it lengthens, a negative one narrows it, and reversed tapers the other way down', opts, () => {
  let m = measure(pull({ taper: 5 }), 'e2'); const g = 10 * k(5);
  near(m.volume, widening(5, 10), 1e-7, 'taper +5'); boxIs(m.box, [-g, -g, 0, 24 + g, 20 + g, 10], 'taper +5');
  m = measure(pull({ taper: -5 }), 'e2'); near(m.volume, widening(-5, 10), 1e-7, 'taper -5'); boxIs(m.box, [0, 0, 0, 24, 20, 10], 'taper -5');
  m = measure(pull({ taper: 3, reversed: true }), 'e2'); const g3 = 10 * k(3);
  near(m.volume, widening(3, 10), 1e-7, 'taper +3 reversed'); boxIs(m.box, [-g3, -g3, -10, 24 + g3, 20 + g3, 0], 'taper +3 reversed');
});
test('taper on an outline with a rounded corner: the round wall becomes a cone (r + z tan a)', opts, () => {
  const r = 3, h = 20, t = k(5); const A = 480 - (1 - PI / 4) * r * r, P = 88 - (2 - PI / 2) * r, c = 3 + PI / 4;
  const m = measure([rect(24, 20, { rounds: { 0: r } }), { id: 'e2', kind: 'extrude', target: 'sk1', height: h, taper: 5 }], 'e2');
  near(m.volume, A * h + P * t * h * h / 2 + c * t * t * h ** 3 / 3, 1e-7, 'volume');
});
test('what the referee does not build is refused, not built as a plain pull', opts, () => {
  for (const o of [{ taper: 5, midplane: true }, { taper: 5, length2: 3 }, { direction: [0, 1, 1] }]) {
    const m = measure(pull(o), 'e2'); assert.match(m.refused ?? '', /not built by this reference path/, JSON.stringify(o));
  }
});

// pockets into a 40 x 30 x 20 box about the origin (z from -10 to 10), from a 6 x 4 rectangle on the xy plane at z = 0
const box = { id: 'b1', kind: 'box', size: [40, 30, 20], center: [0, 0, 0] };
const pocket = (o) => [box, { id: 'sk2', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [6, 0], [6, 4], [0, 4]] }, { id: 'pk3', kind: 'pocket', target: 'sk2', into: 'b1', depth: 3, ...o }];
test('a plain pocket cuts down from the sketch plane; reversed cuts the same amount upwards', opts, () => {
  const down = measure(pocket({}), 'pk3'), up = measure(pocket({ reversed: true }), 'pk3');
  near(down.volume, 24000 - 72, 1e-9, 'down'); near(up.volume, 24000 - 72, 1e-9, 'up');
  assert.ok(down.com[2] > 1e-3 && up.com[2] < -1e-3, `the missing material is below for one and above for the other: ${down.com[2]}, ${up.com[2]}`);
  near(down.com[2], -up.com[2], 1e-9, 'mirror images');
});
test('through: to the far side of the solid whatever depth says, in the direction the pocket cuts', opts, () => {
  const down = measure(pocket({ through: true }), 'pk3'), up = measure(pocket({ through: true, reversed: true }), 'pk3');
  near(down.volume, 24000 - 240, 1e-9, 'through'); near(up.volume, 24000 - 240, 1e-9, 'through reversed');
  assert.ok(down.com[2] > 0 && up.com[2] < 0);
  near(measure(pocket({ through: true, depth: 0.5 }), 'pk3').volume, 24000 - 240, 1e-9, 'depth does not matter');
});
test('midplane and length2 on a pocket', opts, () => {
  const mid = measure(pocket({ midplane: true }), 'pk3'); near(mid.volume, 24000 - 72, 1e-9, 'midplane'); near(mid.com[2], 0, 1e-9, 'symmetric');
  near(measure(pocket({ length2: 2 }), 'pk3').volume, 24000 - 120, 1e-9, 'length2');
});
test('taper on a pocket: wider as it deepens', opts, () => {
  const h = 3, t = k(5); near(measure(pocket({ taper: 5 }), 'pk3').volume, 24000 - (24 * h + 20 * t * h * h / 2 + 4 * t * t * h ** 3 / 3), 1e-7, 'taper +5');
});
test('a pocket the referee does not build is refused and the solid is left as it was', opts, () => {
  for (const o of [{ through: true, midplane: true }, { through: true, taper: 3 }, { taper: 3, length2: 1 }, { direction: [0, 1, 1] }]) {
    const m = measure(pocket(o), 'pk3'); assert.match(m.refused ?? '', /not built by this reference path/, JSON.stringify(o));
  }
});

// ---- the recess at the mouth of a hole. Until 2026-11-13 the referee read neither and drilled the plain bore. ----
const blk = { id: 'b1', kind: 'box', size: [40, 30, 20], center: [5, -3, 12] }; // z from 2 to 22: the mouth is not at a round number by accident
const hole = (o) => [blk, { id: 'h2', kind: 'hole', target: 'b1', diameter: 6, depth: 60, center: [0, 0, 0], axis: 'z', ...o }];
const V = 40 * 30 * 20;
test('a plain through hole is what it was', opts, () => {
  near(measure(hole({}), 'h2').volume, V - PI * 9 * 20, 1e-7, 'bore');
});
test('a counterbore: the wide recess from the +axis face inwards, on each axis', opts, () => {
  const cb = { counterbore: { diameter: 12, depth: 4 } };
  const z = measure(hole(cb), 'h2'); near(z.volume, V - PI * 9 * 20 - PI * (36 - 9) * 4, 1e-7, 'z');
  assert.ok(z.com[2] < 12, `the recess is at the top, so the centre of mass moves down: ${z.com[2]}`);
  const y = measure(hole({ ...cb, axis: 'y' }), 'h2'); near(y.volume, V - PI * 9 * 30 - PI * 27 * 4, 1e-7, 'y');
  assert.ok(y.com[1] < -3, `along y the recess is at the +y face: ${y.com[1]}`);
  const x = measure(hole({ ...cb, axis: 'x' }), 'h2'); near(x.volume, V - PI * 9 * 40 - PI * 27 * 4, 1e-7, 'x');
  assert.ok(x.com[0] < 5, `along x the recess is at the +x face: ${x.com[0]}`);
});
test('a counterbore on a blind hole starts where the bore starts', opts, () => {
  // a blind hole 8 deep from the top: its centre is 6 above the middle of the 20 thick block, as the script layer places it
  const m = measure(hole({ depth: 8, center: [0, 0, 6], counterbore: { diameter: 12, depth: 3 } }), 'h2');
  near(m.volume, V - PI * 9 * 8 - PI * 27 * 3, 1e-7, 'blind');
});
test('a countersink: a cone from the mouth down to the bore, by its included angle', opts, () => {
  // mouth 12, bore 6, 90 degrees: the cone is 3 deep; a frustum of radii 6 and 3 less the bore through it
  const cone = (h) => PI * h * (36 + 18 + 9) / 3 - PI * 9 * h;
  near(measure(hole({ countersink: { diameter: 12, angleDeg: 90 } }), 'h2').volume, V - PI * 9 * 20 - cone(3), 1e-7, '90 degrees');
  const h60 = 3 / Math.tan(PI / 6); near(measure(hole({ countersink: { diameter: 12, angleDeg: 60 } }), 'h2').volume, V - PI * 9 * 20 - cone(h60), 1e-7, '60 degrees');
  near(measure(hole({ depth: 8, center: [0, 0, 6], countersink: { diameter: 12, angleDeg: 90 } }), 'h2').volume, V - PI * 9 * 8 - cone(3), 1e-7, 'blind');
});
test('four holes with a recess each', opts, () => {
  near(measure(hole({ corners: { dx: 10, dy: 8 }, counterbore: { diameter: 10, depth: 2 } }), 'h2').volume, V - 4 * (PI * 9 * 20 + PI * (25 - 9) * 2), 1e-7, 'corners');
});
test('a recess the referee cannot make sense of is refused, not drilled plain', opts, () => {
  for (const o of [{ counterbore: { diameter: 12, depth: 4 }, countersink: { diameter: 12, angleDeg: 90 } }, { counterbore: { diameter: 5, depth: 4 } }, { counterbore: { diameter: 12, depth: 70 } },
    { countersink: { diameter: 12, angle: 90 } }, { countersink: { diameter: 12, angleDeg: 180 } }, { countersink: { diameter: 4, angleDeg: 90 } }, { depth: 2, center: [0, 0, 9], countersink: { diameter: 12, angleDeg: 90 } }]) {
    const m = measure(hole(o), 'h2'); assert.match(m.refused ?? '', /not built by this reference path/, JSON.stringify(o));
  }
});

// ---- a draft. Until 2026-11-13 a whole-body draft tilted one face at a time from the faces of the ORIGINAL solid, so the neighbours of the first
// face, new faces by then, were skipped without a word: two walls of a box out of four. And the neutral plane ignored `neutral` unless the pull was z.
const slab = { id: 'b1', kind: 'box', size: [40, 20, 10], center: [0, 0, 0] };
const draft = (o, target = 'b1') => ({ id: 'd3', kind: 'draft', target, angle: 15, pull: 'z', neutral: 0, ...o });
const t15 = k(15);
test('a whole-body draft tilts all four walls of a box, not two', opts, () => {
  const m = measure([slab, draft({ whole: true })], 'd3');
  near(m.volume, 8000 + 4 * t15 * t15 * 250 / 3, 1e-7, 'volume'); // (40 - 2kz)(20 - 2kz) over z from -5 to 5
  const g = 5 * t15; boxIs(m.box, [-20 - g, -10 - g, -5, 20 + g, 10 + g, 5], 'whole');
});
test('the same after a move and after a turn, and about a neutral plane that is not the middle', opts, () => {
  const moved = measure([slab, { id: 'm2', kind: 'move', target: 'b1', offset: [-4, 0, 0], copy: false }, draft({ whole: true }, 'm2')], 'd3');
  near(moved.volume, 8000 + 4 * t15 * t15 * 250 / 3, 1e-7, 'moved'); near(moved.box[0], -24 - 5 * t15, 1e-6, 'moved box');
  near(measure([slab, { id: 'r2', kind: 'rotate', target: 'b1', angles: [0, 0, 30] }, draft({ whole: true }, 'r2')], 'd3').volume, 8000 + 4 * t15 * t15 * 250 / 3, 1e-7, 'turned');
  // z from -2 to 8 about z = 0: the walls narrow above the neutral plane and widen below it
  const off = measure([{ ...slab, center: [0, 0, 3] }, draft({ whole: true })], 'd3');
  near(off.volume, 8000 - 2 * t15 * 60 * 30 + 4 * t15 * t15 * 520 / 3, 1e-7, 'off-centre');
});
test('a whole-body draft of a cylinder: a cone frustum either side of the neutral plane', opts, () => {
  const t = k(8); near(measure([{ id: 'c1', kind: 'cylinder', radius: 10, height: 20, center: [0, 0, 0] }, draft({ whole: true, angle: 8 }, 'c1')], 'd3').volume, PI * (2000 + t * t * 2000 / 3), 1e-7, 'cylinder');
});
test('one named face, and the neutral plane is at `neutral` along the pull whichever axis the pull is', opts, () => {
  const face = (part) => ({ cause: 'primitive', feature: 'b1', kind: 'face', part });
  const y = measure([slab, draft({ face: face('-y') })], 'd3'); near(y.volume, 8000, 1e-9, 'about the middle the volume stays'); near(y.box[1], -10 - 5 * t15, 1e-6, 'the -y wall leans');
  // pull y, neutral y = 4: the +x wall is at x = 20 - k (y - 4) for y from -10 to 10
  near(measure([slab, draft({ face: face('+x'), pull: 'y', neutral: 4 })], 'd3').volume, 8000 + 10 * t15 * 80, 1e-7, 'pull y, neutral 4');
});
test('a whole-body draft the kernel cannot do on every side face is refused, never done on some', opts, () => {
  const m = measure([slab, { id: 'sk', kind: 'sketch', plane: 'xy', offset: 5, points: [[-3, -3], [3, -3], [3, 3], [-3, 3]] }, { id: 'pk', kind: 'pocket', target: 'sk', into: 'b1', depth: 4 }, draft({ whole: true }, 'pk')], 'd3');
  assert.match(m.refused ?? '', /Tilting every side/);
});
