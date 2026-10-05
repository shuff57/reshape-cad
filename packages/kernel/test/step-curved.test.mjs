// W3: STEP for the curved faces that used to refuse (toroidal, whole and partial spherical, cones).
// The oracle is OpenCascade's own STEP reader: the file must read back valid, as one solid per body,
// at brep-rs's exact volume (1e-6 relative) and bounding box, and with the same number of faces.
// A shape the writer cannot express exactly must still REFUSE, in a sentence; it must never write a wrong solid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepRoundTrip, okRead, brep } from './step-readback-lib.mjs';
import { genScript } from './wrong-solid-sweep-lib.mjs';
import { genS4 } from './wrong-solid-sweep-s4.mjs';

const PI = Math.PI;

function roundTrips(name, code, { faces, volume, solids = 1 } = {}) {
  test(`STEP reads back in OpenCascade: ${name}`, () => {
    const r = stepRoundTrip(code);
    assert.equal(r.scriptError, undefined, r.scriptError);
    assert.equal(r.buildRefused, undefined, JSON.stringify(r.buildRefused));
    assert.equal(r.refused, undefined, `STEP refused: ${r.refused}`);
    assert.ok(okRead(r), `${JSON.stringify({ got: r.got, want: r.want, dv: r.dv, db: r.db, bad: r.bad })}`);
    assert.equal(r.got.solids, solids, 'solids');
    if (faces !== undefined) assert.equal(r.got.faces, faces, 'face count');
    if (volume !== undefined) assert.ok(Math.abs(r.got.volume - volume) <= 1e-6 * volume, `${r.got.volume} vs closed form ${volume}`);
  });
}

// ---- tori ---------------------------------------------------------------------------------------
roundTrips('a torus (ring)', 'const t = ring(36, 8)', { faces: 1, volume: 2 * PI * PI * 14 * 4 * 4 });
roundTrips('a torus moved and turned', 'const t = ring(36, 8)\nturn(t, [30, 50, 0])\nmove(t, [10, -20, 5])', { faces: 1, volume: 2 * PI * PI * 14 * 16 });
roundTrips('a cylinder with a rounded top rim (quarter torus)', 'let v = cylinder(40, 20)\nround(v.edge("top", "side"), 3)', { faces: 4 });
// the bounding box is part of the oracle: a quarter torus used to report the box of the whole donut (z from -14 for a part 10 deep)
roundTrips('a cylinder with a big round (the quarter torus reaches past the part if its box is the whole donut)', 'let v = cylinder(40, 20)\nround(v.edge("top", "side"), 12)');
roundTrips('a short cylinder with a round nearly as big as its height', 'let v = cylinder(51.74, 22.47)\nround(v.edge("top", "side"), 18.5)\nmove(v, [3, -4, 5])');
roundTrips('a cylinder with both rims rounded','let v = cylinder(40, 20)\nround(v.edge("top", "side"), 3)\nround(v.edge("bottom", "side"), 3)', { faces: 5, volume: 25132.7412 - 2 * 234.5769 });
roundTrips('a cylinder with both rims rounded, bored 8 (turned part)', 'let v = cylinder(40, 20)\nround(v.edge("top", "side"), 3)\nround(v.edge("bottom", "side"), 3)\nhole(v, { across: 8 })', { volume: 23658.2777 });
roundTrips('a round top then a bevelled bottom (torus beside cone)', 'let v = cylinder(40, 20)\nround(v.edge("top", "side"), 3)\nbevel(v.edge("bottom", "side"), 3)', { volume: 24360.9519 });
roundTrips('a thick rim round on a narrow pin (ring smaller than tube)', 'let v = cylinder(20, 20)\nround(v.edge("top", "side"), 6)');
roundTrips('a rounded cylinder hollowed open at the bottom', 'let v = cylinder(40, 20)\nround(v.edge("top", "side"), 3)\nhollow(v, { wall: 2, open: "bottom" })');
roundTrips('a rounded cylinder hollowed shut (an inner void of tori)', 'let v = cylinder(40, 20)\nround(v.edge("top", "side"), 3)\nround(v.edge("bottom", "side"), 3)\nhollow(v, { wall: 2 })');

// ---- spheres ------------------------------------------------------------------------------------
roundTrips('a whole sphere', 'const s = sphere(30)', { faces: 1, volume: (4 / 3) * PI * 15 ** 3 });
roundTrips('a whole sphere, moved', 'const s = sphere(30)\nmove(s, [10, -20, 5])', { faces: 1, volume: (4 / 3) * PI * 15 ** 3 });
roundTrips('a sphere bored through its poles', 'const s = sphere(40)\nhole(s, { across: 6 })', { faces: 2 });
roundTrips('a sphere with a blind bore (a pole inside the face)', 'const s = sphere(40)\nhole(s, { across: 6, deep: 10 })', { faces: 3 });
roundTrips('a ball with its cap cut off by a plate', 'const a = sphere(24, { at: [0, 0, 0] })\nconst b = box(60, 60, 20, { at: [0, 0, 18] })\nsubtract(a, b)', { faces: 2 });
roundTrips('a ball sliced to a cap', 'const a = sphere(24, { at: [0, 0, 0] })\nconst b = box(60, 60, 20, { at: [0, 0, 18] })\nintersect(a, b)', { faces: 2 });
roundTrips('the part of a ball inside a slab (a zone, both poles cut off)', 'const a = box(40, 40, 20)\nconst b = sphere(24, { at: [0, 0, 0] })\nintersect(a, b)', { faces: 3 });
roundTrips('a fully rounded box (eight corner spheres, twelve edge cylinders)', 'let v = box(40, 30, 20)\nround(v, 4)', { faces: 26, volume: (32 * 22 * 12) + 2 * 4 * (22 * 12 + 32 * 12 + 32 * 22) + PI * 16 * (32 + 22 + 12) + (4 / 3) * PI * 64 });
roundTrips('a fully rounded box, mirrored (left-handed frames)', 'let v = box(40, 30, 20)\nround(v, 4)\nmove(v, [30, 0, 0])\nmirror(v, "left-right")', { solids: 2 });
roundTrips('a rounded box with a different radius', 'let v = box(50, 20, 30)\nround(v, 7)');

// ---- cones --------------------------------------------------------------------------------------
roundTrips('a bare cone', 'const k = cone(20, 20)', { faces: 2, volume: (PI * 10 * 10 * 20) / 3 });
roundTrips('a bare cone, moved and turned', 'const k = cone(33, 17)\nturn(k, [100, 20, 0])\nmove(k, [-5, 9, 31])', { faces: 2 });
roundTrips('a bare cone, mirrored', 'const k = cone(33, 17)\nmove(k, [30, 0, 0])\nmirror(k, "left-right")', { faces: 4, solids: 2 });
roundTrips('a cone on a cylinder', 'const a = cylinder(20, 20)\nconst b = cone(20, 14, { at: [0, 0, 17] })\nunion(a, b)', { faces: 3 });

test('every cone size and shape writes a clean apex (no rounding radius)', () => {
  for (const [a, h] of [[1, 80], [80, 1], [7, 7], [33.3, 17.1], [0.5, 0.25], [19.99, 3.7]]) {
    const r = stepRoundTrip(`const k = cone(${a}, ${h})`);
    assert.ok(okRead(r), `cone(${a}, ${h}): ${JSON.stringify({ got: r.got, want: r.want, refused: r.refused })}`);
    for (const m of r.step.matchAll(/CIRCLE\('',#\d+,([^)]+)\)/g)) {
      const x = Number(m[1]);
      assert.ok(x === 0 || x > 1e-6, `apex radius ${x} must be exactly 0, not rounding noise`);
    }
  }
});

// ---- what still refuses does so in a sentence ---------------------------------------------------
test('a torus face the kernel trimmed beyond its two rims would refuse, not be written whole', () => {
  // a quarter-torus rim with a pocket cut through it: if the build refuses, fine; if it builds, STEP must either refuse or read back right
  const r = stepRoundTrip('let v = cylinder(40, 20)\nround(v.edge("top", "side"), 3)\nconst p = box(10, 10, 10, { at: [20, 0, 10] })\nsubtract(v, p)');
  if (r.buildRefused) return;
  if (r.refused) { assert.match(r.refused, /^brep-rs cannot write /); return; }
  assert.ok(okRead(r), `wrote a wrong solid: ${JSON.stringify({ got: r.got, want: r.want })}`);
});

test('a ring whose tube is wider than its hole crosses its own axis: STEP says so in a sentence', () => {
  const r = stepRoundTrip('let v = ring(24.59, 14.72)');
  assert.equal(r.buildRefused, undefined);
  assert.match(r.refused ?? '', /^brep-rs cannot write a toroidal face whose tube reaches its own axis to STEP yet$/);
});

test('export_step is still exposed', () => assert.equal(typeof brep.export_step, 'function'));

// ---- a seeded slice of the wrong-solid sweep ----------------------------------------------------
// Every generated script that builds is written as STEP and read back. What matters is that no file reads back as another
// solid (volume 1e-6, bbox 1e-5, valid); a refusal is fine if it is a sentence. The full run (random, perm, census, s4 x seeds 1 and 2,
// 1000 scripts each) is `step-sweep-all.sh`; this keeps a fixed 150-script slice per family in the suite.
test('seeded sweep slice: no built result with a torus, sphere or cone face reads back as another solid', () => {
  let curved = 0, ok = 0;
  const wrong = [];
  for (const [family, gen] of [['random', (i) => genScript('random', i, 1)], ['census', (i) => genScript('census', i, 1)], ['perm', (i) => genScript('perm', i, 2)], ['s4', (i) => genS4(i, 1)]]) {
    for (let i = 0; i < 150; i++) {
      const r = stepRoundTrip(gen(i).code);
      if (r.scriptError || r.buildRefused) continue;
      if (r.refused) { assert.match(r.refused, /^brep-rs cannot (write|yet write)/, r.refused); continue; }
      if (/TOROIDAL_SURFACE|SPHERICAL_SURFACE|CONICAL_SURFACE/.test(r.step)) curved++;
      // volume, bbox and validity are the oracle; the count of SOLIDs OCCT reports for a multi-body result is not (see PLAN-next W3)
      if (r.got && !r.bad && r.dv <= 1e-6 && r.db <= 1e-5 && r.got.valid === true) ok++;
      else wrong.push(`${family}#${i}: ${JSON.stringify({ got: r.got?.volume, want: r.want.volume, bad: r.bad })}`);
    }
  }
  assert.deepEqual(wrong, []);
  assert.ok(curved >= 40, `only ${curved} curved results in the slice`);
  assert.ok(ok >= curved);
});
