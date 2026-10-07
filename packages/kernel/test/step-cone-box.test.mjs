// A cone kept by a box (SPEC-brep-cone-booleans.md S1a) writes to STEP and reads back in OpenCascade as the same solid, or refuses in a sentence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { stepRoundTrip, okRead } from './step-readback-lib.mjs';

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const r2 = (x) => Math.round(x * 100) / 100;

export function cases(seed, n, opLine = 'v = keep(v, p)') {
  const rand = rng(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const R = r2(5 + rand() * 9), H = r2(6 + rand() * 18);
    const size = [r2((0.3 + rand() * 2) * R), r2((0.3 + rand() * 2) * R), r2((0.2 + rand() * 1.3) * H)];
    const at = [r2((rand() - 0.5) * 1.4 * R), r2((rand() - 0.5) * 1.4 * R), r2(rand() * 1.1 * H)];
    const turn = rand() < 0.3 ? r2(rand() * 90) : 0;
    out.push(`let v = cone(${r2(2 * R)}, ${H}, { at: [0, 0, 0] })\nlet p = box(${size.join(', ')}, { at: [${at.join(', ')}] })${turn ? `\nturn(p, [0, 0, ${turn}])` : ''}\n${opLine}`);
  }
  return out;
}

const SWEEPS = [['keep', 'v = keep(v, p)'], ['join', 'v = join(v, p)'], ['cut the box from the cone', 'v = cut(v, p)'], ['cut the cone from the box', 'v = cut(p, v)']];
for (const [opName, opLine] of SWEEPS)
test(`a cone and a box (${opName}): STEP reads back as the same solid, or refuses in a sentence`, () => {
  const codes = cases(Number(process.env.STEPCB_SEED ?? 5), Number(process.env.STEPCB_N ?? 60), opLine);
  let tried = 0, read = 0, refused = 0;
  const wrong = [], why = {};
  for (const code of codes) {
    const r = stepRoundTrip(code);
    if (r.scriptError || r.buildRefused) continue;
    tried++;
    if (r.refused) {
      if (!/^brep-rs cannot write /.test(r.refused)) wrong.push(`odd STEP refusal: ${r.refused}`);
      refused++;
      why[r.refused] = (why[r.refused] ?? 0) + 1;
      continue;
    }
    if (okRead(r)) read++;
    else wrong.push(`${JSON.stringify({ got: r.got?.volume, want: r.want?.volume, dv: r.dv, dvMesh: r.dvMesh, db: r.db, dbMesh: r.dbMesh, valid: r.got?.valid, solids: r.got?.solids, bad: r.bad })} :: ${code.replace(/\n/g, ' ; ')}`);
  }
  if (process.env.STEPCB_OUT) writeFileSync(process.env.STEPCB_OUT, JSON.stringify(wrong));
  console.log(`cone x box (${opName}) STEP read-back:`, JSON.stringify({ tried, read, refused, wrong: wrong.length, why }));
  assert.deepEqual(wrong, [], wrong.slice(0, 3).join('\n'));
  assert.ok(tried >= 30, `only ${tried} tried`);
  assert.ok(read >= 0.6 * tried, `only ${read} of ${tried} wrote and read back`);
});

// The awkward ones, each of which a random box rarely makes: a frustum with a flat cut sideways, the apex on the boundary (a box face
// through the axis), two strips of the wall (a slab through the axis), the apex inside the box, a box exactly as wide as the base, a box
// turned about the axis, and the part moved and turned afterwards.
const HAND = [
  ['a frustum cut sideways', 'box(40, 8, 10, { at: [0, 9, 8] })'],
  ['the apex on the boundary (a quarter)', 'box(8, 8, 40, { at: [4, 4, 10] })'],
  ['a half through the axis', 'box(20, 40, 40, { at: [10, 0, 10] })'],
  ['a thin slab through the axis: two strips', 'box(2, 40, 12, { at: [0, 0, 4] })'],
  ['a thin slab, apex end kept', 'box(2, 40, 30, { at: [0, 0, 10] })'],
  ['the apex inside the box, base cut', 'box(8, 8, 30, { at: [1, 0, 12] })'],
  ['a box exactly as wide as the base', 'box(20, 20, 8, { at: [0, 0, 4] })'],
  ['a box off to one side, base and top cut', 'box(10, 40, 12, { at: [9, 0, 6] })'],
  ['a box turned about the axis', 'box(8, 30, 30, { at: [3, 0, 10] })\nturn(p, [0, 0, 33])'],
];
const HAND_OPS = [['keep', 'v = keep(v, p)'], ['join', 'v = join(v, p)'], ['cut the box from the cone', 'v = cut(v, p)'], ['cut the cone from the box', 'v = cut(p, v)']];
const EXTRA = [
  ['a cone standing in a plate', 'box(60, 60, 8, { at: [0, 0, 1] })'],
  ['a cone on a plate, turned box', 'box(30, 30, 6, { at: [3, 2, 7] })\nturn(p, [0, 0, 25])'],
  ['a box through the cone\'s side near the tip', 'box(4, 22, 5, { at: [-3.6, -6, 14] })'],
];
for (const [opName, opLine] of HAND_OPS)
for (const [name, boxLine] of [...HAND, ...(opName === 'keep' ? [] : EXTRA)]) {
  for (const [tag, after] of [['', ''], [' (moved and turned)', '\nmove(v, [5, -7, 3])\nturn(v, [20, 35, 50])']]) {
    test(`a cone and a box (${opName}), STEP read back: ${name}${tag}`, () => {
      const code = `let v = cone(20, 20, { at: [0, 0, 10] })\nlet p = ${boxLine}\n${opLine}${after}`;
      const r = stepRoundTrip(code);
      assert.ok(!r.scriptError, JSON.stringify(r.scriptError));
      if (r.buildRefused) return; // not a result the kernel builds (two lumps, a contact): nothing to write
      if (r.refused) {
        assert.match(r.refused, /^brep-rs cannot write /);
        console.log('REFUSED:', opName, '|', name, tag, '|', r.refused);
        return;
      }
      assert.ok(okRead(r), `${JSON.stringify({ got: r.got?.volume, want: r.want?.volume, dv: r.dv, dvMesh: r.dvMesh, db: r.db, dbMesh: r.dbMesh, valid: r.got?.valid, solids: r.got?.solids, bad: r.bad })}`);
    });
  }
}
