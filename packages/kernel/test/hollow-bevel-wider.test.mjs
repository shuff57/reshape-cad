// A closed hollow box, then a bevel wider than the wall. The wedge the bevel removes reaches the sealed
// cavity: the part loses (wedge - the part of the wedge that was already cavity), and the cavity is opened
// to the outside. The old build cut only the outer shell and put the cavity shell back untouched, so the
// cavity poked through the bevel face and the volume lost the whole wedge, 9.8 to 55 mm^3 too little
// (found by the census family of the wrong-solid sweep; OpenCascade does the same, so it was never a referee).
// The closed form is checked against a 3-million point membership test of the definition, solid = shell
// minus the half-space wedge, in docs/PLAN-next.md section 38; it agrees with it to 0.1 mm^3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const REPO = path.resolve(HERE, '../../..');
const PKG = path.join(REPO, 'packages', 'brep-rs', 'pkg');
const brep = await import(pathToFileURL(path.join(PKG, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');

const AXIS = { top: 2, bottom: 2, front: 1, back: 1, left: 0, right: 0 };

/** Closed form: shell(box) minus the wedge, counting only the part of the wedge that was material. */
function closedForm(L, wall, open, first, second, c) {
  let cav = 1;
  for (let k = 0; k < 3; k++) cav *= L[k] - wall * (2 - (open && AXIS[open] === k ? 1 : 0));
  const vh = L[0] * L[1] * L[2] - cav;
  const a = 3 - AXIS[first] - AXIS[second];
  const wA = open === first ? 0 : wall, wB = open === second ? 0 : wall;
  const Lc = L[a] - wall * (2 - (open && AXIS[open] === a ? 1 : 0));
  const leg = Math.max(0, c - wA - wB);
  return vh - ((c * c) / 2 * L[a] - (leg * leg) / 2 * Lc);
}

function openEdges(json, id, defl) {
  const m = JSON.parse(brep.mesh_feature(json, id, defl));
  assert.ok(!m.error, m.error);
  const key = (i) => [0, 1, 2].map((k) => Math.round(m.positions[i * 3 + k] * 1e6)).join(',');
  const uses = new Map();
  for (let t = 0; t < m.indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = key(m.indices[t + e]), b = key(m.indices[t + ((e + 1) % 3)]);
      if (a === b) continue;
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      uses.set(k, (uses.get(k) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const n of uses.values()) if (n !== 2) open++;
  return open;
}

// [dims, wall, open, edge faces, size]; the closed ones with size > 2 wall are the wrong-solid cases.
const CASES = [
  [[32.74, 23.46, 29.37], 1, null, ['top', 'back'], 2.8],
  [[35.49, 48.39, 40.8], 2.54, null, ['top', 'right'], 6.68],
  [[53, 36.87, 43.64], 2.28, null, ['top', 'front'], 5.28],
  [[28.29, 34.42, 24.36], 1.19, null, ['bottom', 'back'], 3.18],
  [[36.66, 44.46, 46.8], 2, null, ['top', 'left'], 5.52],
  [[34.29, 35.49, 29.14], 1.68, null, ['bottom', 'left'], 4.19],
  // wider than one wall, narrower than two: the wedge stops short of the cavity
  [[47.15, 58.55, 16.64], 1.18, null, ['top', 'left'], 1.75],
  // open hollows (one shell): the cavity is already open, the closed form holds
  [[26.7, 47.31, 46.73], 1.31, 'top', ['bottom', 'right'], 4.32],
  [[57.23, 20.15, 45.47], 0.99, 'top', ['bottom', 'right'], 2.81],
];

for (const [L, wall, open, [first, second], c] of CASES) {
  const name = `box ${L.join('x')} hollow wall ${wall}${open ? ' open ' + open : ' closed'}, bevel ${first}/${second} ${c}`;
  test(name, () => {
    const code = `let v = box(${L.join(', ')}, { at: [0, 0, 0] })\nhollow(v, { wall: ${wall}${open ? `, open: '${open}'` : ''} })\nbevel(v.edge('${first}', '${second}'), ${c})`;
    const r = runScript(code);
    assert.deepEqual(r.errors, [], code);
    const id = r.doc.features.at(-1).id;
    const json = JSON.stringify({ version: 1, features: r.doc.features });
    const refusals = JSON.parse(brep.build_doc_json(json)).refusals ?? {};
    const want = closedForm(L, wall, open, first, second, c);
    if (refusals[id]) {
      // exact or refused, in a sentence: never a wrong solid
      assert.match(refusals[id], /\S+ \S+ \S+/);
      return;
    }
    const got = JSON.parse(brep.measure_doc(json)).shapes[id].volume;
    assert.ok(Math.abs(got - want) < 1e-6 * want, `${name}: ${got} vs closed form ${want}`);
    for (const d of [0.05, 0.5]) assert.equal(openEdges(json, id, d), 0, `mesh open at chord ${d}`);
  });
}
