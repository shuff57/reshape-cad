// PLAN-next register rows 3 and 5: sweep across the limits where the kernel switches from
// "builds" to "refuses", and assert that no step in between returns a different number.
// Oracles: the cone's own integral pi*min(r, R(z))^2 dz, and the elliptic-integral Simpson
// sum used by transverse-bore.test.mjs. Neither reads the kernel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');

function build(code, defl) {
  const r = runScript(code);
  assert.deepEqual(r.errors, [], code);
  const j = JSON.stringify(r.doc);
  const refusals = JSON.parse(brep.build_doc_json(j)).refusals;
  const id = r.doc.features.at(-1).id;
  const s = JSON.parse(brep.measure_doc(j)).shapes[id] ?? JSON.parse(brep.measure_doc(j)).shapes[r.doc.features[0].id];
  let meshVol = null;
  if (defl && Object.keys(refusals).length === 0) {
    const m = JSON.parse(brep.mesh_feature(j, id, defl));
    let v = 0;
    for (let t = 0; t < m.indices.length; t += 3) {
      const p = [0, 1, 2].map((k) => m.indices[t + k] * 3).map((i) => [m.positions[i], m.positions[i + 1], m.positions[i + 2]]);
      v += (p[0][0] * (p[1][1] * p[2][2] - p[1][2] * p[2][1]) - p[0][1] * (p[1][0] * p[2][2] - p[1][2] * p[2][0]) + p[0][2] * (p[1][0] * p[2][1] - p[1][1] * p[2][0])) / 6;
    }
    meshVol = v;
  }
  return { refusals, s, meshVol };
}
const rel = (a, b) => Math.abs(a - b) / Math.max(1, Math.abs(b));

// ---- row 3: transverse bore across a cylinder, r/R from 0.90 to 0.95, and past it ----
function removed(R, r) {
  const n = 200000, a = -Math.PI / 2, h = Math.PI / n;
  const g = (th) => { const y = r * Math.sin(th); return 2 * r * r * Math.cos(th) ** 2 * 2 * Math.sqrt(R * R - y * y); };
  let acc = g(a) + g(-a);
  for (let i = 1; i < n; i++) acc += g(a + h * i) * (i % 2 ? 4 : 2);
  return (acc * h) / 3;
}
test('transverse bore: exact volume and a sound mesh at every step of r/R in [0.90, 0.95]', () => {
  for (let k = 0; k <= 10; k++) {
    const ratio = 0.9 + 0.005 * k;
    const r = 10 * ratio;
    const out = build(`const c = cylinder(20, 30); hole(c, { across: ${2 * r}, along: 'x' })`, 0.01);
    assert.deepEqual(out.refusals, {}, `ratio ${ratio}`);
    const want = Math.PI * 100 * 30 - removed(10, r);
    assert.ok(rel(out.s.volume, want) < 1e-9, `ratio ${ratio}: ${out.s.volume} vs ${want}`);
    assert.ok(rel(out.meshVol, want) < 0.01, `ratio ${ratio}: mesh ${out.meshVol} vs ${want}`);
  }
});
test('transverse bore: past 0.95 it refuses and the part is shown whole', () => {
  for (const ratio of [0.951, 0.97, 0.99]) {
    const out = build(`const c = cylinder(20, 30); hole(c, { across: ${20 * ratio}, along: 'x' })`);
    assert.ok(out.refusals.hole1, `ratio ${ratio} must refuse`);
    assert.ok(rel(out.s.volume, Math.PI * 100 * 30) < 1e-9, 'whole cylinder shown');
  }
});

// ---- row 5: a cone bore stepped across the boundary where it meets the sloping wall ----
const R = 10, H = 20;
const coneTo = (z) => Math.PI * R * R * H / 3 * (1 - (1 - z / H) ** 3);
function left(r, a, b) {
  const zc = H * (1 - r / R);
  const cyl = (lo, hi) => (hi > lo ? Math.PI * r * r * (hi - lo) : 0);
  const cone = (lo, hi) => (hi > lo ? coneTo(hi) - coneTo(lo) : 0);
  return coneTo(H) - cyl(a, Math.min(b, zc)) - cone(Math.max(a, zc), b);
}
test('coaxial cone bore: depth stepped across the point where the bore wall meets the cone', () => {
  const r = 2, zc = H * (1 - r / R); // the bore wall meets the cone at z = 16, i.e. deep = 4
  for (const d of [3, 3.9, 3.999, 4, 4.001, 4.1, 5, 12]) {
    const out = build(`const c = cone(20, 20); hole(c, { across: ${2 * r}, deep: ${d} })`);
    if (Object.keys(out.refusals).length) continue; // a refusal is allowed, a different number is not
    assert.ok(rel(out.s.volume, left(r, H - d, H)) < 1e-9, `deep ${d}: ${out.s.volume} vs ${left(r, H - d, H)}`);
  }
  assert.ok(zc === 16);
});
test('off-axis cone bore: every offset and depth either refuses (cone shown whole) or equals the closed form', () => {
  const whole = coneTo(H);
  for (const e of [0.5, 2, 3, 3.9, 3.999, 4, 4.001, 5])
    for (const d of [2, 6, 12, 18]) {
      const out = build(`const c = cone(20, 20); hole(c, { across: 2, at: [${e}, 0], deep: ${d} })`);
      if (Object.keys(out.refusals).length) {
        assert.ok(rel(out.s.volume, whole) < 1e-9, `refused but not whole: e ${e} d ${d}`);
      } else {
        // built: the bore must lie wholly inside the cone, so the loss is exactly pi r^2 d
        assert.ok(rel(out.s.volume, whole - Math.PI * d) < 1e-9, `e ${e} d ${d}: ${out.s.volume}`);
      }
    }
});
