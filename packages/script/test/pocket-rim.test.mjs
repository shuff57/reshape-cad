// Naming the rim of a pocket: part.rim(sk) / part.edge('top', part.wall(sk, n)), then round() them.
// The names are checked by the GEOMETRY they point at (sketch side at the plate's top), not by feature id,
// and survive an edit of the plate thickness. The kernel is not run here (scripts/ gates and the kernel suite own that).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';
import { toScript } from '../dist/reshape-script-gen.js';

const script = (t, p, d, r) => `
const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] });
const plate = extrude(sk1, ${t});
const sk2 = sketch('top', ${t}); sk2.rect(${p}, ${p}, { at: [20, 15] });
const part = pocket(sk2, plate, ${d});
round(part.rim(sk2), ${r});`;

/** Where a fillet's edge name points: the pocket sketch's side `edge` lifted to the sketch's plane offset (a world segment). */
function segmentOf(doc, name) {
  const wall = name.of.find((n) => n.cause === 'swept');
  const sk = doc.features.find((f) => f.id === wall.from);
  const a = sk.points[wall.edge], b = sk.points[(wall.edge + 1) % sk.points.length];
  return { a: [...a, sk.offset], b: [...b, sk.offset] };
}
const topOf = (doc) => doc.features.find((f) => f.kind === 'extrude').height;

test('rim names the four opening edges, one round each, at the plate top', () => {
  const r = runScript(script(10, 10, 4, 1));
  assert.deepEqual(r.errors, []);
  const fil = r.doc.features.filter((f) => f.kind === 'fillet');
  assert.equal(fil.length, 4);
  const segs = fil.map((f) => segmentOf(r.doc, f.edge));
  for (const s of segs) assert.equal(s.a[2], topOf(r.doc));
  // the four sides of the 10 x 10 opening centred at (20, 15), each used once
  const keys = new Set(segs.map((s) => [s.a, s.b].map((p) => p.join(',')).sort().join('|')));
  assert.equal(keys.size, 4);
  const xs = segs.flatMap((s) => [s.a[0], s.b[0]]), ys = segs.flatMap((s) => [s.a[1], s.b[1]]);
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [15, 25, 10, 20]);
  for (const f of fil) assert.equal(f.size, 1);
});

test('the names survive an edit of the plate thickness and resolve to the same geometric edges', () => {
  const a = runScript(script(10, 10, 4, 1)), b = runScript(script(14, 10, 4, 1));
  assert.deepEqual(b.errors, []);
  const names = (r) => r.doc.features.filter((f) => f.kind === 'fillet').map((f) => JSON.stringify(f.edge));
  assert.deepEqual(names(a), names(b));
  const fa = a.doc.features.filter((f) => f.kind === 'fillet'), fb = b.doc.features.filter((f) => f.kind === 'fillet');
  fa.forEach((f, i) => {
    const sa = segmentOf(a.doc, f.edge), sb = segmentOf(b.doc, fb[i].edge);
    assert.deepEqual([sa.a[0], sa.a[1], sa.b[0], sa.b[1]], [sb.a[0], sb.a[1], sb.b[0], sb.b[1]]);
    assert.equal(sa.a[2], 10); assert.equal(sb.a[2], 14); // still the plate top in each
  });
});

test('a different pocket size and radius names its own four edges', () => {
  const r = runScript(script(10, 6, 3, 0.5));
  assert.deepEqual(r.errors, []);
  const fil = r.doc.features.filter((f) => f.kind === 'fillet');
  assert.equal(fil.length, 4);
  const xs = fil.flatMap((f) => { const s = segmentOf(r.doc, f.edge); return [s.a[0], s.b[0]]; });
  assert.deepEqual([Math.min(...xs), Math.max(...xs)], [17, 23]);
  for (const f of fil) assert.equal(f.size, 0.5);
});

test('wall() and edge() name one edge, bevel takes the list too, and the script round-trips', () => {
  const src = `
const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] });
const plate = extrude(sk1, 10);
const sk2 = sketch('top', 10); sk2.rect(10, 10, { at: [20, 15] });
const part = pocket(sk2, plate, 4);
round(part.edge('top', part.wall(sk2, 2)), 1);
bevel(part.rim(sk2).slice(2), 0.5);`;
  const r = runScript(src);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.doc.features.filter((f) => f.kind === 'fillet').map((f) => f.style), ['fillet', 'chamfer', 'chamfer']);
  // The pocket is written out as the pull and subtract the kernel can name walls of, and that text reads back to the same
  // document (the cut's feature id is the only thing a re-run renames).
  const text = toScript(r.doc);
  const back = runScript(text);
  assert.deepEqual(back.errors, []);
  assert.equal(toScript(back.doc), text.replaceAll('pocket1', 'op1'));
  assert.deepEqual(back.doc.features.map((f) => f.kind), r.doc.features.map((f) => f.kind));
});

test('wrong uses say what to do', () => {
  const bad = (tail) => runScript(`
const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] });
const plate = extrude(sk1, 10);
const sk2 = sketch('top', 10); sk2.rect(10, 10, { at: [20, 15] });
const part = pocket(sk2, plate, 4);
${tail}`).errors.map((e) => e.message).join(' ');
  assert.match(bad('part.wall(sk2, 5)'), /side number from 1 to 4/);
  assert.match(bad('part.wall(sk1, 1)'), /no pocket/);
  assert.match(bad("part.edge('top', part.wall(sk2, 1).owner && 'top')"), /DIFFERENT|face word/);
  assert.match(bad('round([], 1)'), /list of edges/);
});

// ---- the kernel resolves the names (the script side alone proving nameability is not enough) ----
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../brep-rs/pkg');
const haveWasm = existsSync(path.join(PKG, 'brep_rs_bg.wasm'));
const brep = haveWasm ? await import('file://' + path.join(PKG, 'brep_rs.js')) : null;
if (brep) brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });

/** Build in brep-rs: the shown volume, and what it refused. */
function build(doc) {
  const j = JSON.stringify(doc);
  const refusals = JSON.parse(brep.build_doc_json(j)).refusals || {};
  const last = doc.features.at(-1).id;
  return { refusals, volume: JSON.parse(brep.measure_doc(j)).shapes[last].volume };
}

for (const [t, p, d, r] of [[10, 10, 4, 1], [14, 10, 4, 1], [10, 6, 3, 0.5]]) {
  test(`kernel: rim of a ${p}x${p} pocket, plate ${t}, r ${r}: every name resolves, the rim is refused whole in a plain sentence, the shown solid is the pocketed plate`, { skip: !haveWasm }, () => {
    const res = runScript(script(t, p, d, r));
    assert.deepEqual(res.errors, []);
    const { refusals, volume } = build(res.doc);
    // no name is left unresolved: a refusal may only be the kernel's sentence about the rounding itself
    for (const why of Object.values(refusals)) {
      assert.doesNotMatch(why, /could not be found/);
      assert.match(why, /^brep-rs cannot round these neighbouring edges together yet: /);
      assert.match(why, /is shown without it\.$/);
    }
    // all or nothing: the four edges meet at corners the kernel does not blend, so a rim is never shown rounded on only
    // some of its edges (FreeCAD's rounded rim is 11591.03244517401, 15 faces, for the first case)
    const fil = res.doc.features.filter((f) => f.kind === 'fillet');
    assert.equal(Object.keys(refusals).length, fil.length, 'every round of the rim is refused, none half applied');
    const applied = fil.filter((f) => !(f.id in refusals));
    const sk = res.doc.features.find((f) => f.id === 'sk2');
    const len = (f) => { const w = f.edge.of.find((n) => n.cause === 'swept'); const a = sk.points[w.edge], b = sk.points[(w.edge + 1) % sk.points.length]; return Math.hypot(b[0] - a[0], b[1] - a[1]); };
    const pocketed = 40 * 30 * t - p * p * d;
    const want = pocketed - applied.reduce((s, f) => s + (1 - Math.PI / 4) * f.size * f.size * len(f), 0);
    assert.ok(Math.abs(volume - want) <= 1e-6 * want, `shown ${volume} want ${want}`);
  });
}

test('kernel: one rim edge is rounded exactly, by wall name and by the same name after the plate gets thicker', { skip: !haveWasm }, () => {
  for (const t of [10, 14]) {
    const res = runScript(`
const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] });
const plate = extrude(sk1, ${t});
const sk2 = sketch('top', ${t}); sk2.rect(10, 10, { at: [20, 15] });
const part = pocket(sk2, plate, 4);
round(part.edge('top', part.wall(sk2, 1)), 1);`);
    assert.deepEqual(res.errors, []);
    const { refusals, volume } = build(res.doc);
    assert.deepEqual(refusals, {});
    const want = 40 * 30 * t - 400 - (1 - Math.PI / 4) * 10;
    assert.ok(Math.abs(volume - want) <= 1e-6 * want, `t=${t}: ${volume} vs ${want}`);
  }
});
