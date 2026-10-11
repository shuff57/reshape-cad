// A mirror or pattern built from a handle that has been cut or padded since keeps those later features: the copies are chained
// onto the END of the line of features built on the target, never branched off the old handle (a dead branch).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';

const HEAD = `const s1 = sketch('top'); s1.polygon([[0,0],[60,0],[60,20],[0,20]]);
const plate = extrude(s1, 10);
`;
const ids = (r, kind) => r.doc.features.filter((f) => f.kind === kind);
// every feature that is not consumed by another feature (a sketch feeds a cut, so sketches do not count)
function leaves(r) {
  const used = new Set();
  for (const f of r.doc.features) for (const k of ['target', 'into']) if (typeof f[k] === 'string') used.add(f[k]);
  for (const f of r.doc.features) for (const t of f.targets ?? []) used.add(t);
  return r.doc.features.filter((f) => f.kind !== 'sketch' && !used.has(f.id));
}

test('mirror of a pocket with a later pocket leaves exactly one final shape and keeps the later pocket', () => {
  const r = runScript(HEAD + `const a = sketch('top', 10); a.circle(6, { at: [10, 10] });
const p = pocket(a, plate, 10);
const b = sketch('top', 10); b.circle(4, { at: [30, 6] });
const q = pocket(b, p, 10);
mirror(p, 'left-right', { at: 30 });`);
  assert.deepEqual(r.errors, []);
  assert.equal(ids(r, 'pocket').length, 3);
  assert.equal(leaves(r).length, 1);
  const last = r.doc.features.at(-1);
  assert.equal(last.kind, 'pocket');
  assert.equal(last.into, ids(r, 'pocket')[1].id); // the copy sits after the later pocket
});

test('whole-shape mirror and a whole-shape pattern also build on the end of the line', () => {
  for (const tail of [`mirror(p, 'left-right');`, `repeat(plate2, { count: 2, step: [5, 0, 0] });`]) {
    const r = runScript(HEAD + `const a = sketch('top', 10); a.circle(6, { at: [10, 10] });
const p = pocket(a, plate, 10);
const b = sketch('top', 10); b.circle(4, { at: [30, 6] });
const q = pocket(b, p, 10);
const plate2 = q;
` + tail);
    assert.deepEqual(r.errors, []);
    assert.equal(leaves(r).length, 1);
  }
  const r = runScript(HEAD + `const a = sketch('top', 10); a.circle(6, { at: [10, 10] });
const p = pocket(a, plate, 10);
const b = sketch('top', 10); b.circle(4, { at: [30, 6] });
pocket(b, p, 10);
mirror(p, 'left-right');`);
  assert.deepEqual(r.errors, []);
  assert.equal(leaves(r).length, 1);
  const m = ids(r, 'mirror')[0];
  assert.equal(m.target, ids(r, 'pocket')[1].id); // mirrors the part with the later pocket, not the stale one
});

test('a hole pattern keeps a later pocket, and a pad pattern keeps a later pad', () => {
  const r = runScript(HEAD + `const h = hole(plate, { across: 6, at: [-20, 0] });
const b = sketch('top', 10); b.circle(4, { at: [50, 15] });
pocket(b, h, 10);
repeat(h, { count: 3, step: [15, 0, 0] });`);
  assert.deepEqual(r.errors, []);
  assert.equal(leaves(r).length, 1);
  assert.equal(ids(r, 'pocket').length, 1);
  assert.equal(ids(r, 'hole').length, 3);
  const r2 = runScript(HEAD + `const a = sketch('top', 10); a.polygon([[4,7],[10,7],[10,13],[4,13]]);
const pd = join(plate, pull(a, 5));
const c = sketch('top', 10); c.polygon([[50,3],[55,3],[55,8],[50,8]]);
join(pd, pull(c, 2));
repeat(pd, { count: 3, step: [15, 0, 0] });`);
  assert.deepEqual(r2.errors, []);
  assert.equal(leaves(r2).length, 1);
  assert.equal(ids(r2, 'combine').length, 4);
});

test('a hole pattern with a later pad (which could move the middle of the part) is refused in a sentence', () => {
  const r = runScript(HEAD + `const h = hole(plate, { across: 6, at: [-20, 0] });
const a = sketch('top', 10); a.polygon([[50,3],[55,3],[55,8],[50,8]]);
join(h, pull(a, 2));
repeat(h, { count: 3, step: [10, 0, 0] });`);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /later combine/);
});
