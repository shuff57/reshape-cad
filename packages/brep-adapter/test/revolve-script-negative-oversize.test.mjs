// A revolve written in the SCRIPT with a negative angle or a turn past 360 builds (the script layer used to refuse both in a
// sentence). Oracles, none of them a kernel number: Pappus (angle/360 of the full ring, 2 pi x 15 x 300 x |a|/360), FreeCAD
// 26.3rc1 references from docs/replica/freecad/gauntlet/variants/refs (volume, bbox, faces, centre of mass; a missing record
// skips), and OpenCascade's STEP reader. 0, NaN and an absurd magnitude must still refuse in a sentence with no shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stepRoundTrip, okRead, brep } from './step-readback-lib.mjs';

const { runScript } = await import('@shuff57/reshape-script/reshape-script');
const { toScript } = await import('@shuff57/reshape-script/reshape-script-gen');
const HERE = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const REFS = path.resolve(HERE, '../../..', 'docs/replica/freecad/gauntlet/variants/refs');
const PI = Math.PI;
const RING = (plane, a) => `const sk = sketch('${plane}'); sk.rect(10, 30, { at: [15, 15] }); revolve(sk, ${a});`;
const FULL = PI * (20 ** 2 - 10 ** 2) * 30;

function measure(doc) {
  const j = JSON.stringify(doc);
  const out = JSON.parse(brep.build_doc_json(j));
  assert.deepEqual(out.refusals ?? {}, {}, JSON.stringify(out.refusals));
  const id = doc.features.at(-1).id;
  const m = JSON.parse(brep.measure_doc(j)).shapes[id];
  const mesh = JSON.parse(brep.mesh_feature(j, id, 0.01));
  let vol = 0; const c = [0, 0, 0];
  const P = mesh.positions, I = mesh.indices;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, d = I[t + 2] * 3;
    const w = P[a] * (P[b + 1] * P[d + 2] - P[b + 2] * P[d + 1]) - P[a + 1] * (P[b] * P[d + 2] - P[b + 2] * P[d]) + P[a + 2] * (P[b] * P[d + 1] - P[b + 1] * P[d]);
    vol += w / 6;
    for (let k = 0; k < 3; k++) c[k] += w / 24 * (P[a + k] + P[b + k] + P[d + k]);
  }
  return { m, com: c.map((x) => x / vol) };
}

const CASES = [
  { id: 'revolution__top-neg-90', plane: 'top', a: -90, frac: 0.25 },
  { id: 'revolution__top-neg-180', plane: 'top', a: -180, frac: 0.5 },
  { id: 'revolution__front-neg-90', plane: 'front', a: -90, frac: 0.25 },
  { id: 'revolution__top-400', plane: 'top', a: 400, frac: 1 },
];

for (const { id, plane, a, frac } of CASES) {
  const refFile = path.join(REFS, `ref-${id}.json`);
  test(`script revolve(sk, ${a}) on ${plane} builds: Pappus, FreeCAD, STEP`, () => {
    const r = runScript(RING(plane, a));
    assert.deepEqual(r.errors, []);
    assert.equal(r.doc.features.at(-1).angle, a, 'the angle reaches the document as written');
    const { m, com } = measure(r.doc);
    assert.ok(Math.abs(m.volume - FULL * frac) <= 1e-6 * FULL, `volume ${m.volume} vs Pappus ${FULL * frac}`);
    if (existsSync(refFile)) {
      const ref = JSON.parse(readFileSync(refFile, 'utf8'));
      assert.ok(Math.abs(m.volume - ref.volume) <= 1e-6 * ref.volume, `volume ${m.volume} vs FreeCAD ${ref.volume}`);
      const w = m.bbox.flat();
      for (let i = 0; i < 6; i++) assert.ok(Math.abs(w[i] - ref.bbox[i]) <= 1e-6, `bbox ${JSON.stringify(m.bbox)} vs FreeCAD ${JSON.stringify(ref.bbox)}`);
      assert.equal(m.faces, ref.faces, 'face count');
      for (let i = 0; i < 3; i++) assert.ok(Math.abs(com[i] - ref.com[i]) <= 0.02, `centre of mass ${com} vs FreeCAD ${ref.com}`);
    }
    const s = stepRoundTrip(r.doc);
    assert.equal(s.refused, undefined, `STEP refused: ${s.refused}`);
    assert.ok(okRead(s), JSON.stringify({ got: s.got, want: s.want, dv: s.dv, db: s.db }));
  });

  test(`script revolve(sk, ${a}) on ${plane}: toScript / runScript round trip is stable`, () => {
    const r = runScript(RING(plane, a));
    const src = toScript(r.doc);
    assert.match(src, new RegExp(`revolve\\(\\w+, ${a}\\)`));
    const again = runScript(src);
    assert.deepEqual(again.errors, []);
    assert.equal(again.doc.features.at(-1).angle, a);
    assert.equal(toScript(again.doc), src);
  });
}

test('a turn the other way is the mirror of the same turn: same volume, the opposite side of the plane', () => {
  const pos = measure(runScript(RING('top', 90)).doc), neg = measure(runScript(RING('top', -90)).doc);
  assert.ok(Math.abs(pos.m.volume - neg.m.volume) <= 1e-9 * pos.m.volume);
  assert.ok(Math.abs(pos.m.bbox[0][1] - -neg.m.bbox[1][1]) <= 1e-6, `y range ${JSON.stringify(pos.m.bbox)} vs ${JSON.stringify(neg.m.bbox)}`);
});

test('a turn past 360 is the full ring, equal to 360 in volume and bounding box', () => {
  const full = measure(runScript(RING('top', 360)).doc);
  for (const a of [361, 400, 720, -400, -360]) {
    const x = measure(runScript(RING('top', a)).doc);
    assert.ok(Math.abs(x.m.volume - full.m.volume) <= 1e-9 * full.m.volume, `${a}: ${x.m.volume} vs ${full.m.volume}`);
    assert.deepEqual(x.m.bbox.flat().map((v) => Math.round(v * 1e6)), full.m.bbox.flat().map((v) => Math.round(v * 1e6)), `${a} bbox`);
  }
});

test('0, NaN and an absurd magnitude still refuse in a sentence and build nothing', () => {
  for (const a of [0, 721, -1000, 1e6, 'NaN']) {
    const r = runScript(RING('top', a));
    assert.equal(r.errors.length, 1, `revolve ${a}`);
    assert.match(String(r.errors[0].message ?? r.errors[0]), /spin\(\): the angle is how far the sketch turns|has to be a number/);
    assert.ok(!r.doc || !r.doc.features.some((f) => f.kind === 'revolve'), `${a} left a revolve feature`);
  }
});

// The reversed sweep used to mesh OPEN between -180 and -360 exclusive (6 unmatched edges at -181, -199, -359, ...): the inner
// wall's seam sat at u = 0 while its arc began at pi - angle, a stray column on no neighbour's rim. The exact volume and the STEP
// read-back were right throughout, which is why only a mesh check sees it.
function openEdges(doc, tol) {
  const j = JSON.stringify(doc);
  const id = doc.features.at(-1).id;
  const mesh = JSON.parse(brep.mesh_feature(j, id, tol));
  const P = mesh.positions, I = mesh.indices;
  const key = (i) => [0, 1, 2].map((k) => Math.round(P[i * 3 + k] / 1e-6)).join(',');
  const dir = new Map();
  for (let t = 0; t < I.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = key(I[t + k]), b = key(I[t + (k + 1) % 3]);
      if (a !== b) dir.set(`${a}>${b}`, (dir.get(`${a}>${b}`) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const [k, v] of dir) {
    const [a, b] = k.split('>');
    if ((dir.get(`${b}>${a}`) ?? 0) !== v) open++;
  }
  return open;
}

const OUTLINES = {
  rect: 'sk.rect(10, 30, { at: [15, 15] });',
  L: 'sk.polygon([[10,0],[30,0],[30,10],[20,10],[20,30],[10,30]]);',
  frustum: 'sk.polygon([[10,0],[30,0],[20,30],[10,30]]);',
  rounded: 'sk.polygon([[10,0],[20,0],[20,30],[10,30]]); sk.round(3, 3);',
};

test('a negative turn between -180 and -360 meshes closed at every chord, on both planes and for straight, slanted and rounded outlines', () => {
  const bad = [];
  for (const [name, body] of Object.entries(OUTLINES)) {
    for (const plane of ['top', 'front']) {
      for (const a of [-181, -185, -199, -220, -250, -283, -325, -359, -359.5, -180.5, -90, -180, -270]) {
        const r = runScript(`const sk = sketch('${plane}'); ${body} revolve(sk, ${a});`);
        assert.deepEqual(r.errors, [], `${name} ${plane} ${a}`);
        for (const tol of [0.005, 0.05, 0.5]) {
          const n = openEdges(r.doc, tol);
          if (n !== 0) bad.push(`${name} ${plane} ${a} tol ${tol}: ${n} open`);
        }
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('a negative turn is the exact fraction of the ring (Pappus) and reads back through STEP at the angles that cracked', () => {
  for (const a of [-181, -250, -359]) {
    const r = runScript(RING('top', a));
    const { m } = measure(r.doc);
    const want = FULL * Math.abs(a) / 360;
    assert.ok(Math.abs(m.volume - want) <= 1e-9 * FULL, `${a}: ${m.volume} vs Pappus ${want}`);
    const s = stepRoundTrip(r.doc);
    assert.equal(s.refused, undefined, `STEP refused: ${s.refused}`);
    assert.ok(okRead(s), JSON.stringify({ a, got: s.got, want: s.want, dv: s.dv, db: s.db }));
  }
});
