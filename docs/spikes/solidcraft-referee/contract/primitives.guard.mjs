// SPIKE, referee only (contract / primitives group, round 4). The ENFORCEMENT half of the primitives contract.
// Pure functions over a ModelDoc primitive feature: no kernel, no wasm. guardFeature(f) -> null | {code, sentence}.
// A feature the guard refuses never reaches the SolidCraft translator, so a student sees ONE plain sentence (in the words of the call they typed:
// box(width, depth, height), cylinder(across, tall), ring(across, tubeAcross) ...), never "box1", "solid.fillet" or "major > minor", and the sentence
// says WHY (the part would be built or measured wrongly), not just a number.
//
// STATUS OF THIS FILE: a prototype. packages/script is read-only here and nothing in the product calls it. Until it is wired in (the plan's phase 2
// guard layer) every input it refuses is a WRONG solid (or a kernel-text refusal) in the product. contract/primitives.json says so row by row.
//
// Every constant below is the edge of an envelope that primitives-r3/*.mjs and primitives-r4/*.mjs measured, with a decade (or more) of margin.
// It is a fit to measurements, not a proof: primitives-r4/fuzz-score.mjs runs it against random inputs from seeds that were NOT used to tune it.
//
//   import { guardFeature, guardDoc } from './primitives.guard.mjs';
export const LIM = {
  // ---- box corner (E1, E14)
  boxCornerGap: 1e-4,         // corner <= half the shortest side x (1 - gap): the truck rounded box is exact to a gap of 1e-5 (18 faces instead of 26 at 1e-6)
  boxCornerMinRel: 1e-4,      // corner >= this x the LONGEST side: bands are dropped below ~3e-6 x the shortest side (E14: 1.2 -> 3e-6, 12 -> 3e-5, 120 -> 1e-4, 1200 -> 1e-3 are 18 faces); 1e-4 x longest keeps >= 12x
  // ---- cylinder corner / bevel (E2, E14, E14b, E15)
  cylCornerMin: 1e-4,         // absolute: 3e-6 builds exactly at R 0.6 .. 60, 1e-6 is refused by truck in kernel text at every radius
  cylCornerMinRel: 1e-6,      // and relative to max(across, tall): a BEVEL drops faces (3 or 4 of 5) at 5.6e-9 .. 1.3e-8 x that size (E14b: R 600 at 1e-5, R 6000 at 1e-4, R 25000 at 1e-3), the floor is 75x above the largest wrong cell
  // The flat top left over after the rim round (R - corner) must be wide enough for the mesh: E15/E15b, R 0.5 .. 200 with H 5 .. 600: the bbox is 1e-2 to 2.6e-2 of the
  // diagonal wrong when the leftover is 0.0008 .. 0.001 x max(across, tall) or less, and exact from 0.0013 x (R 0.5: 0.005 wrong / 0.01 right; R 5: 0.05 / 0.1; R 50: 0.1 / 0.2; R 200: 0.5 / 1).
  // It is NOT a fraction of R alone (a 99%-of-R rule passes R 2 at 0.0201 and R 5 at 0.05, which are wrong) and not a constant (R 200 needs 1).
  cylLeftoverSizeFrac: 0.01,  // R - corner >= this x max(across, tall): a decade over the last wrong cell, 7x over the first right one
  cylHalfHeightGap: 1e-4,     // half the height - corner, relative (E2: 1e-4 exact; E15 H series: gaps down to 0.001 on heights 1, 5, 20 are exact)
  // ---- ring (E4, E19)
  ringThinMax: 50,            // across / tubeAcross <= 50 (2.7e-4 at 40 and 400 across)
  ringFatMin: 2.05,           // across / tubeAcross >= 2.05, inclusive (E19)
  // ---- sizes (E5, E8, E9, E12)
  curvedMax: 5e4,
  planarMax: 1e6,
  curvedMin: 1,
  ringTubeMin: 0.5,
  tallMin: 0.01,
  planarMin: 1e-2,           // round 4b: was 1e-3. truck refuses a planar profile in kernel text ('cannot attach a plane to a wire ...') for 32 of 233 recorded inputs at EXACTLY 0.001 and for 2 at 0.00114 / 0.002; none at or above 0.0021; a decade above the last refusal
  cylSlender: 30,
  coneSlender: 40,
  planarAspectMax: 1e4,       // E13: longest / shortest typed size of a planar part. Ends are lost (4 faces for 6) from ~1e6 for a box and from 1e5 for a turned box or a prism needle
  // ---- placement
  curvedFarRatio: 400,        // curved: largest |at| <= this x the SMALLEST typed size (E7, E20)
  // planar: the volume/centre of mass of truck are summed from products of vertex coordinates, so the rounding error grows as the product of the
  // largest |coordinate| on each axis and is compared with the volume. Q = prod_a(|at_a| + ext_a) / V. E12: exact (dVol <= 6e-10) up to Q 1e7, wrong from 1e8.
  planarQMax: 1e6,
  // a TURNED shape or a prism has a wider scatter (the rotation and the n-gon vertices are not exact): the first wrong cases sit at Q 1.4e5, 1.5e5, 5.5e5 (random inputs, seed 1: dVol 6e-8 .. 1.3e-7, COM 3e-4 .. 5e-4 x diagonal) although the E12 grid was exact to 1e7, so the limit is a decade under the lowest wrong cell
  planarQMaxTurned: 1e4,
  // ---- round 4, after fuzz seeds 1..3 (E22..E27). Every one is the edge of a measured cell with a decade (or the stated factor) of margin.
  coneFlatMin: 0.01,          // cone tall / across (E26a2, E27d: 4 faces for 2 at 0.0005 plain and at 0.001 turned, right from 0.002 -> 5x margin)
  coneTurnedSlender: 10,      // a TURNED cone: tall / across (E23, E26a: 3 faces for 2 from 16, right up to 15)
  coneTurnedMovedMinT: 1,     // a cone that is turned AND not at the origin: tall / across at least this (E26b, E27c: volume 10% .. 100x off up to 0.65, right from 0.7)
  cylRoundAspectMax: 100,     // cylinder with corner or bevel: across / tall (E24, E26c, E27b: a face is dropped from 450, right through 300; volume 2.6e-4 at 200)
  boxRoundAspectMax: 100,     // box with corner: longest / shortest (E26c, E27a: volume 3.5e-4 .. 7.7e-4 from 300, 2e-4 at 200, 1.2e-4 up to 100)
  sphereFarProduct: 1e8,      // a curved shape: largest |at| x largest typed size (E21, E25, E27e: first wrong 1e9 (sphere 1000 at 1e6), erratic above it; right everywhere at or below 4e8)
};

const SHAPE = { box: 'box', cylinder: 'cylinder', sphere: 'sphere', cone: 'cone', torus: 'ring', prism: 'prism', wedge: 'wedge' };
/** a number for a sentence: no exponent for sizes people type, 4 significant digits */
export function num(v) {
  if (!Number.isFinite(v)) return String(v);
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
  const a = Math.abs(v);
  if (a >= 1e-6 && a < 1e15) return String(+v.toPrecision(4));
  return v.toExponential(2).replace('e+', ' x 10^').replace('e-', ' x 10^-');
}
const down = (v, d = 3) => { if (!(v > 0)) return 0; const k = 10 ** Math.max(d, Math.ceil(-Math.log10(v)) + 2); return Math.floor(v * k) / k; };
const up = (v, d = 3) => { const k = 10 ** Math.max(d, Math.ceil(-Math.log10(v)) + 2); return Math.ceil(v * k) / k; };

/** [name, value] of every typed dimension, in the student's words */
function dims(f) {
  switch (f.kind) {
    case 'box': return [['width', f.size?.[0]], ['depth', f.size?.[1]], ['height', f.size?.[2]]];
    case 'cylinder': return [['across', 2 * f.radius], ['tall', f.height]];
    case 'sphere': return [['across', 2 * f.radius]];
    case 'cone': return [['across', 2 * f.radius], ['tall', f.height]];
    case 'torus': return [['across', 2 * (f.ringRadius + f.tubeRadius)], ['tubeAcross', 2 * f.tubeRadius]];
    case 'prism': return [['across', 2 * f.radius], ['tall', f.height]];
    case 'wedge': return [['width', f.width], ['depth', f.depth], ['tall', f.height]];
    default: return [];
  }
}
const isCurved = (f) => f.kind === 'cylinder' || f.kind === 'sphere' || f.kind === 'cone' || f.kind === 'torus' || (f.kind === 'box' && !!f.round);
const refuse = (code, sentence) => ({ code, sentence });
const callOf = (f) => {
  const nm = SHAPE[f.kind]; const D = dims(f).map(([, v]) => num(v));
  if (f.kind === 'prism') return `prism(${f.sides}, ${D.join(', ')})`;
  return `${nm}(${D.join(', ')})`;
};

/** volume of a planar primitive (closed form) and the half-extent of its bounding box on each axis, before any turn */
function planarVolumeExtent(f) {
  if (f.kind === 'box') return { V: f.size[0] * f.size[1] * f.size[2], ext: f.size.map((v) => v / 2) };
  if (f.kind === 'wedge') return { V: f.width * f.depth * f.height / 2, ext: [f.width, f.depth, f.height] }; // whole size: where the wedge sits against `at` is not assumed
  const n = f.sides; return { V: 0.5 * n * f.radius ** 2 * Math.sin(2 * Math.PI / n) * f.height, ext: [f.radius, f.radius, f.height / 2] };
}
/** Q = prod_a(|at_a| + ext_a) / V, with every ext replaced by the half diagonal when the shape is turned */
export function farQ(f) {
  const { V, ext } = planarVolumeExtent(f);
  const c = f.center ?? [0, 0, 0];
  const turned = !!(f.rotate && f.rotate.some((v) => v));
  const R = Math.hypot(...ext);
  const e = turned ? [R, R, R] : ext;
  return { Q: c.reduce((p, v, i) => p * (Math.abs(v) + e[i]), 1) / V, V, e };
}
/** largest x such that prod_a(x + e_a) = QMAX * V (the same offset on all three axes), for the sentence */
function farBound(e, V, qmax) {
  const target = qmax * V; let lo = 0; let hi = 1.2e6;
  if (e.reduce((p, v) => p * v, 1) > target) return 0;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (e.reduce((p, v) => p * (m + v), 1) <= target) lo = m; else hi = m; }
  return lo;
}

/** @returns {null | {code:string, sentence:string}} */
export function guardFeature(f) {
  const kind = f.kind;
  if (!SHAPE[kind]) return null;
  const nm = SHAPE[kind];
  const D = dims(f);
  const curved = isCurved(f);
  const cx = f.center ?? [0, 0, 0];
  const turned = !!(f.rotate && f.rotate.some((v) => v));

  // ---- numbers that are not numbers (a stored document or a slider can hold them; the interpreter only checked the typed ones)
  for (const [name, v] of D) {
    if (!(typeof v === 'number' && Number.isFinite(v) && v > 0)) return refuse('not-a-size', `${nm}(): ${name} has to be a number above 0, and it is ${num(v)}.`);
  }
  if (cx.some((v) => !Number.isFinite(v))) return refuse('not-a-position', `${nm}(): every at coordinate has to be a number.`);
  if (f.round !== undefined && f.round !== 0 && !(Number.isFinite(f.round) && f.round > 0)) return refuse('not-a-corner', `${callOf(f)}: the corner has to be a number above 0, and it is ${num(f.round)}.`);

  // ---- prism sides: whole number, 3 to 12 (the translator would otherwise round or clamp it and build a different part than the document says)
  if (kind === 'prism' && !(Number.isInteger(f.sides) && f.sides >= 3 && f.sides <= 12)) {
    return refuse('prism-sides', `prism(): sides has to be a whole number from 3 to 12, and it is ${num(f.sides)} -- any other value would be rounded to a different shape.`);
  }

  // ---- ring: the interpreter stores ringRadius = (across - tubeAcross) / 2, which is <= 0 when the tube is not thinner than half of across
  if (kind === 'torus') {
    const across = 2 * (f.ringRadius + f.tubeRadius); const tube = 2 * f.tubeRadius;
    if (!(f.ringRadius > 0) || across < tube * LIM.ringFatMin * (1 - 1e-9)) {
      const maxTube = down(across / LIM.ringFatMin, 3);
      return refuse('ring-tube-too-thick', `ring(${num(across)}, ${num(tube)}): the tube is too thick for a ring ${num(across)} across, so the hole in the middle would close and the part would be built wrongly -- tubeAcross has to be ${num(maxTube)} or less.`);
    }
    if (across > tube * LIM.ringThinMax * (1 + 1e-9)) {
      return refuse('ring-tube-too-thin', `ring(${num(across)}, ${num(tube)}): the tube is too thin for a ring ${num(across)} across, so its volume would be measured wrongly -- tubeAcross has to be at least ${num(up(across / LIM.ringThinMax, 3))}, one fiftieth of across.`);
    }
  }

  // ---- floors, caps (one pair per class)
  for (const [name, v] of D) {
    let floor = curved ? LIM.curvedMin : LIM.planarMin;
    if (kind === 'torus' && name === 'tubeAcross') floor = LIM.ringTubeMin;
    else if ((kind === 'cylinder' || kind === 'cone') && name === 'tall') floor = LIM.tallMin;
    if (v < floor) return refuse(curved ? 'too-small-curved' : 'too-small', `${nm}(): ${name} ${num(v)} is too small -- ${curved ? 'a curved or rounded shape this small is built with the wrong size and shape' : 'a part this small is built with the wrong size or missing faces'}, so make it at least ${num(floor)}.`);
  }
  const cap = curved ? LIM.curvedMax : LIM.planarMax;
  for (const [name, v] of D) {
    if (v > cap) return refuse(curved ? 'too-big-curved' : 'too-big', `${nm}(): ${name} ${num(v)} is too big -- ${curved ? 'a curved or rounded shape this big is built with the wrong volume and position' : 'a part this big is built with the wrong volume and position'}, so keep it at ${num(cap)} or less.`);
  }
  const vals = D.map(([, v]) => v); const smin = Math.min(...vals); const smax = Math.max(...vals);

  // ---- rounding
  if (kind === 'box' && f.round) {
    if (f.roundStyle === 'chamfer') {
      return refuse('box-chamfer', 'box(): a chamfer on every edge of a box is not available because it would be built with its corners cut wrongly -- use corner for a rounded box, or leave the edges square.');
    }
    const [w, d, h] = f.size; const m = Math.min(w, d, h); const lim = m / 2 * (1 - LIM.boxCornerGap);
    if (f.round > lim) {
      return refuse('box-corner-too-big', `box(${num(w)}, ${num(d)}, ${num(h)}, { corner: ${num(f.round)} }): the corner is too big -- the rounding would not fit and the box would be built the wrong size, so it has to be ${num(down(lim))} or less, a little under half of the shortest side (${num(m)}).`);
    }
    const floor = LIM.boxCornerMinRel * Math.max(w, d, h);
    if (f.round < floor) {
      return refuse('box-corner-too-small', `box(${num(w)}, ${num(d)}, ${num(h)}, { corner: ${num(f.round)} }): the corner is too small -- some of the rounded edges would be left out of the part, so it has to be at least ${num(up(floor))}, one ten-thousandth of the longest side (${num(Math.max(w, d, h))}).`);
    }
  }
  if (kind === 'cylinder' && f.round) {
    const R = f.radius; const across = 2 * R; const hLim = f.height / 2 * (1 - LIM.cylHalfHeightGap);
    const what = f.roundStyle === 'chamfer' ? 'bevel' : 'corner';
    const rLim = R - LIM.cylLeftoverSizeFrac * Math.max(across, f.height);
    const cFloor = Math.max(LIM.cylCornerMin, LIM.cylCornerMinRel * Math.max(across, f.height));
    if (f.round < cFloor) return refuse('cyl-corner-too-small', `cylinder(${num(across)}, ${num(f.height)}, { corner: ${num(f.round)} }): the ${what} is too small -- it would be left out of the part, so it has to be at least ${num(up(cFloor))}.`);
    if (f.round > rLim) return refuse('cyl-corner-vs-radius', `cylinder(${num(across)}, ${num(f.height)}, { corner: ${num(f.round)} }): the ${what} is too big for the width -- the flat top that is left would be too narrow to be built correctly, so it has to be ${num(down(Math.max(rLim, 0)))} or less (the radius is ${num(R)}, and the flat top must stay at least one hundredth of ${num(Math.max(across, f.height))}).`);
    if (f.round > hLim) return refuse('cyl-corner-vs-height', `cylinder(${num(across)}, ${num(f.height)}, { corner: ${num(f.round)} }): the ${what} is too big for the height -- the two rims would run into each other and the part would be built wrongly, so it has to be ${num(down(hLim))} or less, a little under half of tall (${num(f.height)}).`);
  }

  // ---- slenderness (curved) and aspect (planar)
  if (kind === 'cylinder' && f.height / (2 * f.radius) > LIM.cylSlender) return refuse('cyl-too-slender', `cylinder(${num(2 * f.radius)}, ${num(f.height)}): too long for its width -- a slender cylinder is measured wrongly, so tall has to be at most ${LIM.cylSlender} times across.`);
  if (kind === 'cone' && f.height / (2 * f.radius) > LIM.coneSlender) return refuse('cone-too-slender', `cone(${num(2 * f.radius)}, ${num(f.height)}): too long for its width -- a slender cone is measured wrongly, so tall has to be at most ${LIM.coneSlender} times across.`);
  // ---- cone shapes the mesh gets wrong (E22/E23/E26/E27): too flat, too long when turned, and flat + turned + moved
  if (kind === 'cone') {
    const across = 2 * f.radius; const t = f.height / across; const moved = cx.some((v) => v !== 0);
    if (t < LIM.coneFlatMin) return refuse('cone-too-flat', `cone(${num(across)}, ${num(f.height)}): too flat for its width -- a cone this flat is built with the wrong number of faces, so tall has to be at least ${num(up(LIM.coneFlatMin * across))}, one hundredth of across.`);
    if (turned && t > LIM.coneTurnedSlender) return refuse('cone-turned-slender', `cone(${num(across)}, ${num(f.height)}): too long to be turned -- a turned cone this long is built with a seam through its side, so tall has to be at most ${LIM.coneTurnedSlender} times across, or leave the cone unturned.`);
    if (turned && moved && t < LIM.coneTurnedMovedMinT) return refuse('cone-turned-moved-flat', `cone(${num(across)}, ${num(f.height)}): a cone that is turned and not at the origin has to be at least as tall as it is across -- a flatter one is built with the wrong volume and position, so make tall ${num(up(across))} or more, or leave it unturned or at the origin.`);
  }
  // ---- rounded plates and discs at a large aspect (E24/E26c/E27a/E27b)
  if (kind === 'box' && f.round && smax / smin > LIM.boxRoundAspectMax) {
    return refuse('box-round-too-thin', `${callOf(f)}: too long and thin for a rounded box -- its volume would be measured wrongly, so the longest side has to be at most ${LIM.boxRoundAspectMax} times the shortest.`);
  }
  if (kind === 'cylinder' && f.round && (2 * f.radius) / f.height > LIM.cylRoundAspectMax) {
    return refuse('cyl-round-too-flat', `cylinder(${num(2 * f.radius)}, ${num(f.height)}, { corner: ${num(f.round)} }): too flat for a rounded rim -- a rim on a disc this wide is built with a face missing, so across has to be at most ${LIM.cylRoundAspectMax} times tall.`);
  }
  if (!curved && smax / smin > LIM.planarAspectMax) {
    return refuse('too-thin-planar', `${callOf(f)}: too long and thin -- its ends would be lost and the part built with missing faces, so the longest size has to be at most ${LIM.planarAspectMax} times the shortest.`);
  }

  // ---- placement: absolute (all), relative to the smallest size (curved), and the cancellation rule (planar)
  const far = Math.max(...cx.map(Math.abs));
  if (far > LIM.planarMax) return refuse('too-far', `${nm}(): the at position ${num(far)} is too far from the origin -- the part would be built in the wrong place, so keep every at coordinate within ${num(LIM.planarMax)}.`);
  if (curved) {
    if (far * smax > LIM.sphereFarProduct) {
      return refuse('too-far-big-curved', `${nm}(): a shape ${num(smax)} across at a position ${num(far)} from the origin is too far out for its size -- its volume and centre would be worked out wrongly, so keep the position times the biggest size at ${num(LIM.sphereFarProduct)} or less (at most ${num(down(LIM.sphereFarProduct / smax, 3))} here).`);
    }
    if (far > LIM.curvedFarRatio * smin) {
      return refuse('too-far-curved', `${nm}(): the at position ${num(far)} is too far from the origin for a shape whose smallest size is ${num(smin)} -- its volume and centre would be worked out wrongly, so keep every at coordinate within ${num(LIM.curvedFarRatio * smin)} (${LIM.curvedFarRatio} times that size), or move the shape nearer.`);
    }
  } else {
    const { Q, V, e } = farQ(f);
    const qmax = (turned || kind === 'prism') ? LIM.planarQMaxTurned : LIM.planarQMax;
    if (Q > qmax) {
      const x = farBound(e, V, qmax);
      return refuse('too-far-planar', `${callOf(f)}: the at position ${num(far)} is too far from the origin for a part this small -- its volume and centre would be worked out wrongly, so keep every at coordinate within ${num(down(x, 3))}${(turned || kind === 'prism') ? ' (a turned part or a prism needs more room)' : ''}, or make the part bigger.`);
    }
  }
  return null;
}

/**
 * featureId -> verdict (null when fine) for every primitive in a ModelDoc. A primitive that the script turned or moved is not stored with
 * rotate / center any more: turn(prism(..)) and turn(wedge(..)) become a separate { kind: 'rotate', target } feature and move(x, [..]) a
 * { kind: 'move', target, offset } feature, so those are folded back in before the placement rules run. A turn() on a sphere is a rotate step
 * that changes nothing (rotated about its own centre): the sphere is checked as it stands.
 */
export function guardDoc(doc) {
  const eff = new Map();
  for (const f of doc.features) {
    if (SHAPE[f.kind]) eff.set(f.id, { ...f, center: [...(f.center ?? [0, 0, 0])] });
    else if (f.kind === 'rotate' && eff.has(f.target)) { const e = eff.get(f.target); e.rotate = (f.angles ?? [0, 0, 0]).map((v, i) => (e.rotate?.[i] ?? 0) + v); if (!e.rotate.some((v) => v)) e.rotate = [0, 0, 0]; }
    else if (f.kind === 'move' && eff.has(f.target) && !f.copy) { const e = eff.get(f.target); e.center = e.center.map((v, i) => v + (f.offset?.[i] ?? 0)); }
  }
  const out = new Map();
  for (const [id, e] of eff) out.set(id, guardFeature(e));
  return out;
}

/** first refusal of a whole document, or null */
export function guardFirst(doc) {
  for (const v of guardDoc(doc).values()) if (v) return v;
  return null;
}

/** Sentence lint: one sentence, starts with the call the student typed, no internal id or kernel word. Returns the list of problems. */
export function sentenceProblems(s) {
  const bad = [];
  if (!/^(box|cylinder|sphere|cone|ring|prism|wedge)\(/.test(s)) bad.push('does-not-start-with-the-call');
  if (/\b(box|cyl|ball|cone|ring|prism|wedge)\d+\b/.test(s)) bad.push('internal-id');
  if (/solid\.|solidcraft|truck|brep|occt|kernel|invalid input|major|minor|torus|fillet|body|feature|mesh|tessell|wasm|face id|\bF\d+:/i.test(s)) bad.push('kernel-word');
  if (!/[.]$/.test(s) || /[.] [A-Z]/.test(s)) bad.push('not-one-sentence');
  if (s.length > 330) bad.push('too-long');
  return bad;
}

/**
 * The sentence for a build that ran past its time budget (a requirement on the page: Web Worker + budget; nothing in the product does this today, so it is
 * not produced by guardFeature). Generic on purpose: it does not say which parameter to change, because a long build has no single cause (a ring, a rounded
 * cylinder and a huge sphere are all slow for different reasons). primitives-r4/browser/bench.html carries the same template and primitives.sentence-check.mjs
 * asserts that the two are identical.
 */
export function budgetSentence(call, seconds) {
  return `${call}: building this took more than ${seconds} seconds, so it was stopped and is not shown -- try a smaller or simpler shape.`;
}
