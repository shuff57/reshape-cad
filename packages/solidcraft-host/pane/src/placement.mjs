// Where a shape without `at:` went, and a join that joins nothing: what the page tells the student (owner-approved text, 2026-11-12).
//
// A shape the script gave no `at:` is placed beside the rightmost shape already there: a plain shape, or a part pulled or spun from a sketch (packages/script
// model-types.ts newShape; the first shape goes to the origin, and so does one whose only neighbours are swept parts that cannot be measured). A student who expects the origin then gets "pocket1 does not touch the part ..." with no clue. The interpreter records which shapes it placed
// this way (RunResult.placed: [{ id, beside }]); the doc only has the centre. This module turns that record into
//   shapeNote      the line on the shape's own step
//   placementHint  a clause added to the three sentences of a step that MISSED such a part (a pocket, keep(), a groove)
// and, for the join of two shapes that do not touch (built: one part in separate pieces),
//   joinApartNote  the line on the join's step
//   pieceCount     the number of pieces the part card shows (lumps, not bodies)
// No DOM and no kernel here: pane.js renders what these return. The layer's sentences are not changed; the hint is added by the page.

const num = (v) => String(+(+v).toFixed(4));
const at = (c) => `[${c.map(num).join(', ')}]`;
/**
 * RunResult.placed as a Map: id -> the shape it was placed beside (a string), or, for a shape that stayed at the origin because the pulled or spun part already
 * there cannot be measured, { origin: <that part> }. An absent or malformed record is an empty map: no note, no hint.
 */
export const placedMap = (placed) => new Map((Array.isArray(placed) ? placed : []).filter((p) => p && typeof p.id === 'string' && (typeof p.beside === 'string' || (p.beside === null && typeof p.unmeasured === 'string')))
  .map((p) => [p.id, typeof p.beside === 'string' ? p.beside : { origin: p.unmeasured }]));

/** The note on a shape's step: null unless the script gave it no at: and it was placed beside another. */
export function shapeNote(f, placed) {
  const beside = placed.get(f?.id);
  if (!beside || !Array.isArray(f.center)) return null;
  if (typeof beside !== 'string') return `no at: given, so it is at the origin ${at(f.center)}; it may overlap ${beside.origin}`;
  return `no at: given, so it was placed beside ${beside}; its centre is at ${at(f.center)}`;
}

/** The shape a step's part started as: back through the steps that only change a part (the layer's part-name.ts walk). */
const CHANGES = new Set(['hole', 'fillet', 'shell', 'draft', 'move', 'rotate']);
export function startOf(id, byId) {
  let cur = id; const seen = new Set();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const f = byId.get(cur); if (!f) return id;
    const next = CHANGES.has(f.kind) && !(f.kind === 'move' && f.copy) ? f.target : f.kind === 'pocket' || f.kind === 'groove' ? f.into : undefined;
    if (typeof next !== 'string') return cur;
    cur = next;
  }
  return id;
}

// the three sentences of a step that missed its part (packages/layer: extrude-pocket.ts, booleans-guard.ts, revolve-groove-guard.ts); test/placement.test.mjs pins them to the layer
export const MISSED = {
  pocket: /does not touch the part, so it cuts nothing/,
  combine: /^The two shapes do not overlap, so keeping their overlap leaves nothing\.?$/,
  groove: /the ring does not cut the part \(it misses it, or turns away from it\), so there is nothing to remove\.?$/,
};
/**
 * The refusal of a pocket, keep() or groove that missed its part, with the hint added when a part it works on had no at: and was placed beside another.
 * `r` = the step's translated result ({ id, status, refusal }); returns the new sentence, or null when nothing is to be added.
 */
export function placementHint(r, doc, placed) {
  if (!r || r.status !== 'refused' || typeof r.refusal !== 'string' || !placed.size) return null;
  const byId = new Map(doc.features.map((f) => [f.id, f]));
  const f = byId.get(r.id); if (!f) return null;
  const re = MISSED[f.kind]; if (!re || !re.test(r.refusal)) return null;
  if (f.kind === 'combine' && f.op !== 'intersect') return null;
  const parts = (f.kind === 'combine' ? (f.targets ?? []) : [f.into]).filter((x) => typeof x === 'string').map((x) => startOf(x, byId));
  // the part that was placed by default; of two, the one made later (it is the one that moved away from the other)
  const hit = parts.filter((p) => typeof placed.get(p) === 'string' && Array.isArray(byId.get(p)?.center)).sort((a, b) => doc.features.findIndex((x) => x.id === b) - doc.features.findIndex((x) => x.id === a))[0];
  if (!hit) return null;
  return `${r.refusal.replace(/\.\s*$/, '')} (${hit} has no at:, so it was placed beside ${placed.get(hit)} with its centre at ${at(byId.get(hit).center)}).`;
}

const apart = (a, b) => [0, 1, 2].some((i) => a[i] - b[i + 3] > 1e-6 || b[i] - a[i + 3] > 1e-6);
/**
 * The note on a BUILT join of two shapes that do not touch. `results` = the translated features (with their measure); `finBodies` = the bodies of the final
 * scene (each with kernel.shells). Said only when it is certain: exactly two operands, their boxes apart, the join's face count the sum of theirs, and the number
 * of pieces known (the join's own measure, else the final scene when no later step changed that body, else 2 for two plain shapes).
 */
export function joinApartNote(r, doc, results, finBodies) {
  const byId = new Map(doc.features.map((f) => [f.id, f])); const res = new Map(results.map((x) => [x.id, x]));
  const f = byId.get(r?.id);
  if (!f || f.kind !== 'combine' || f.op !== 'union' || r.status !== 'built' || !Array.isArray(f.targets) || f.targets.length !== 2 || !r.measure) return null;
  const [a, b] = f.targets.map((t) => res.get(t)?.measure);
  if (!a?.bbox || !b?.bbox || !apart(a.bbox, b.bbox) || r.measure.faces !== a.faces + b.faces) return null;
  const later = doc.features.slice(doc.features.findIndex((x) => x.id === f.id) + 1).some((x) => res.get(x.id)?.status === 'built' && (res.get(x.id).measure?.bodies ?? []).some((n) => (r.measure.bodies ?? []).includes(n)));
  const fin = !later && (r.measure.bodies ?? []).length === 1 ? (finBodies ?? []).find((x) => x.name === r.measure.bodies[0])?.kernel?.shells : undefined;
  const plain = f.targets.every((t) => Array.isArray(byId.get(t)?.center));
  const n = Number.isInteger(r.measure.shells) ? r.measure.shells : Number.isInteger(fin) ? fin : plain ? 2 : null;
  if (!(n > 1)) return null;
  const [na, nb] = f.targets.map((t) => startOf(t, byId));
  return `${na} and ${nb} do not touch, so this join is ${n} separate pieces; give one an at: position so they overlap`;
}

/** The pieces of the final scene: the lumps of every body (a join of shapes that do not touch is one body in several pieces), not the body count. */
export const pieceCount = (bodies) => (bodies ?? []).reduce((n, b) => n + (Number.isInteger(b?.kernel?.shells) && b.kernel.shells > 0 ? b.kernel.shells : 1), 0);
