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
