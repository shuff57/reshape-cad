// Round 2 cases for the fillet-chamfer group. Same conventions as cases.mjs; own ids; run with drive2.mjs --cases=./cases-r2.mjs
// Every closed form is independent of every kernel. `expect: 'refuse'` marks a case where a correct system must refuse in a
// sentence because the requested blend does not fit the faces it cuts into (a student must never get a solid for it).
const PI = Math.PI;
const BOXD = [40, 30, 12];
const V0 = BOXD[0] * BOXD[1] * BOXD[2];
const integ = (f, a, b, n = 200000) => { const h = (b - a) / n; let s = f(a) + f(b); for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2); return s * h / 3; };
const Af = (r) => (1 - PI / 4) * r * r;
const Ac = (d) => d * d / 2;
// width of a removal prism's cross-section at distance w from the shared face
const ext = (kind, s, w) => (w >= s ? 0 : kind === 'f' ? s - Math.sqrt(Math.max(0, s * s - (s - w) * (s - w))) : s - w);
const area = (kind, s) => (kind === 'f' ? Af(s) : Ac(s));
// literal mitre (box minus the union of the two removal prisms) of two blends on edges that share one face
const mitre = (v0, A, B) => v0 - area(A.k, A.s) * A.L - area(B.k, B.s) * B.L + integ((w) => ext(A.k, A.s, w) * ext(B.k, B.s, w), 0, Math.min(A.s, B.s));
const rbox = (L, W, H, r) => (L - 2 * r) * (W - 2 * r) * (H - 2 * r) + 2 * r * ((L - 2 * r) * (W - 2 * r) + (L - 2 * r) * (H - 2 * r) + (W - 2 * r) * (H - 2 * r)) + PI * r * r * ((L - 2 * r) + (W - 2 * r) + (H - 2 * r)) + 4 / 3 * PI * r ** 3;
const cylV = (R, H) => PI * R * R * H;
const rimFillet = (R, r) => 2 * PI * (r * r * (R - r / 2) - (PI * r * r / 4) * (R - r + 4 * r / (3 * PI)));
const rimChamfer = (R, d) => 2 * PI * (d * d / 2) * (R - d / 3);

export const CASES = [];
const add = (c) => CASES.push(c);
const B3 = 'const b = cuboid(40,30,20)\n';           // 40 x 30 x 20 centred on the origin
const PLATE = "const sk = sketch('top')\nsk.rect(40, 30, { at: [20, 15] })\nconst pad = extrude(sk, 10)\n"; // 40 x 30 x 10, x 0..40
const V3 = 40 * 30 * 20; const VP = 40 * 30 * 10;

// ---------------------------------------------------------------------------------------------------------------------
// OV: a chamfer / fillet LARGER than the face it cuts into. Legs of a chamfer run along both adjacent faces, perpendicular to the edge.
// 40x30x20 box: top/front legs 30 (top depth) and 20 (front height); front/left (vertical) legs 40 and 30; top/left legs 40 and 20.
for (const d of [19.99, 20, 20.01, 22, 25, 29.99, 30, 30.01, 35, 40, 100, 1000]) add({ id: `ov-c-box-top-front-${d}`, row: 'oversize', script: `${B3}bevel(b.edge('top','front'), ${d})`, limit: 20, size: d, closed: d <= 20 ? () => V3 - Ac(d) * 40 : undefined, expect: d > 20 ? 'refuse' : null });
for (const d of [29.99, 30, 30.01, 35, 40, 41, 45, 60]) add({ id: `ov-c-box-front-left-${d}`, row: 'oversize', script: `${B3}bevel(b.edge('front','left'), ${d})`, limit: 30, size: d, closed: d <= 30 ? () => V3 - Ac(d) * 20 : undefined, expect: d > 30 ? 'refuse' : null });
for (const d of [20.01, 25, 40, 45]) add({ id: `ov-c-box-top-left-${d}`, row: 'oversize', script: `${B3}bevel(b.edge('top','left'), ${d})`, limit: 20, size: d, expect: 'refuse' });
for (const d of [20.01, 25]) add({ id: `ov-c-box-bottom-back-${d}`, row: 'oversize', script: `${B3}bevel(b.edge('bottom','back'), ${d})`, limit: 20, size: d, expect: 'refuse' });
// 40x30x10 plate (the 10 tall front/back/left/right faces)
for (const d of [9.999, 10, 10.001, 12]) add({ id: `ov-c-plate-top-front-${d}`, row: 'oversize', script: `${PLATE}bevel(pad.edge('top','front'), ${d})`, limit: 10, size: d, closed: d <= 10 ? () => VP - Ac(d) * 40 : undefined, expect: d > 10 ? 'refuse' : null });
for (const e of ['back', 'left', 'right']) add({ id: `ov-c-plate-top-${e}-12`, row: 'oversize', script: `${PLATE}bevel(pad.edge('top','${e}'), 12)`, limit: 10, size: 12, expect: 'refuse' });
add({ id: 'ov-c-plate-bottom-front-12', row: 'oversize', script: `${PLATE}bevel(pad.edge('bottom','front'), 12)`, limit: 10, size: 12, expect: 'refuse' });
// same sizes as FILLETS (the contrast: fillets of this size are refused by the kernel)
for (const r of [19.99, 20, 20.01, 25]) add({ id: `ov-f-box-top-front-${r}`, row: 'oversizeFillet', script: `${B3}round(b.edge('top','front'), ${r})`, limit: 20, size: r, expect: r > 20 ? 'refuse' : null });
for (const r of [10.001, 12]) add({ id: `ov-f-plate-top-front-${r}`, row: 'oversizeFillet', script: `${PLATE}round(pad.edge('top','front'), ${r})`, limit: 10, size: r, expect: 'refuse' });
// PAIRS whose sizes sum past the face they share
for (const s of [14, 15, 15.01, 16, 20]) add({ id: `ov-c-pair-top-front-back-${s}`, row: 'oversizePair', script: `${B3}bevel(b.edge('top','front'), ${s})\nbevel(b.edge('top','back'), ${s})`, sum: 2 * s, limit: 30, expect: 2 * s > 30 ? 'refuse' : null, closed: 2 * s <= 30 ? () => V3 - 2 * Ac(s) * 40 : undefined });
for (const s of [14, 15, 16]) add({ id: `ov-f-pair-top-front-back-${s}`, row: 'oversizePair', script: `${B3}round(b.edge('top','front'), ${s})\nround(b.edge('top','back'), ${s})`, sum: 2 * s, limit: 30, expect: 2 * s > 30 ? 'refuse' : null, closed: 2 * s <= 30 ? () => V3 - 2 * Af(s) * 40 : undefined });
for (const [a, c] of [[20, 20], [19, 20], [20, 21]]) add({ id: `ov-c-pair-vert-${a}-${c}`, row: 'oversizePair', script: `${B3}bevel(b.edge('front','left'), ${a})\nbevel(b.edge('front','right'), ${c})`, sum: a + c, limit: 40, expect: a + c > 40 ? 'refuse' : null, closed: a + c <= 40 ? () => V3 - (Ac(a) + Ac(c)) * 20 : undefined });
for (const [a, c] of [[20, 20], [20, 21]]) add({ id: `ov-f-pair-vert-${a}-${c}`, row: 'oversizePair', script: `${B3}round(b.edge('front','left'), ${a})\nround(b.edge('front','right'), ${c})`, sum: a + c, limit: 40, expect: a + c > 40 ? 'refuse' : null });
for (const s of [4, 5, 5.01, 6]) add({ id: `ov-c-pair-plate-front-${s}`, row: 'oversizePair', script: `${PLATE}bevel(pad.edge('top','front'), ${s})\nbevel(pad.edge('bottom','front'), ${s})`, sum: 2 * s, limit: 10, expect: 2 * s > 10 ? 'refuse' : null, closed: 2 * s <= 10 ? () => VP - 2 * Ac(s) * 40 : undefined });
for (const s of [4, 5, 6]) add({ id: `ov-f-pair-plate-front-${s}`, row: 'oversizePair', script: `${PLATE}round(pad.edge('top','front'), ${s})\nround(pad.edge('bottom','front'), ${s})`, sum: 2 * s, limit: 10, expect: 2 * s > 10 ? 'refuse' : null, closed: 2 * s <= 10 ? () => VP - 2 * Af(s) * 40 : undefined });
// cylinder rims (cylinder(30,20) = diameter 30, height 20)
for (const s of [9, 10, 11]) {
  add({ id: `ov-c-pair-cyl-${s}`, row: 'oversizePair', script: `const c = cylinder(30,20)\nbevel(c.edge('top','side'), ${s})\nbevel(c.edge('bottom','side'), ${s})`, sum: 2 * s, limit: 20, expect: 2 * s > 20 ? 'refuse' : null, closed: 2 * s <= 20 ? () => cylV(15, 20) - 2 * rimChamfer(15, s) : undefined });
  add({ id: `ov-f-pair-cyl-${s}`, row: 'oversizePair', script: `const c = cylinder(30,20)\nround(c.edge('top','side'), ${s})\nround(c.edge('bottom','side'), ${s})`, sum: 2 * s, limit: 20, expect: 2 * s > 20 ? 'refuse' : null, closed: 2 * s <= 20 ? () => cylV(15, 20) - 2 * rimFillet(15, s) : undefined });
}
for (const s of [14.9, 15, 15.1, 21]) add({ id: `ov-c-cyl-single-${s}`, row: 'oversize', script: `const c = cylinder(30,20)\nbevel(c.edge('top','side'), ${s})`, limit: 15, size: s, expect: s > 15 || s > 20 ? 'refuse' : null, closed: s < 15 ? () => cylV(15, 20) - rimChamfer(15, s) : undefined });

// WHOLE-BOX roundStyle chamfer (ModelDoc only): d against the half-height of 10
for (const d of [4, 9.99, 10, 10.001, 12, 14, 15, 16]) add({ id: `ov-d-box-chamfer-${d}`, row: 'oversizeWhole', doc: [{ id: 'b1', kind: 'box', size: [40, 30, 20], center: [0, 0, 0], round: d, roundStyle: 'chamfer' }], size: d, limit: 10, expect: d >= 10 ? 'refuse' : null });
for (const d of [3, 11, 12, 13]) add({ id: `ov-d-cyl-chamfer-${d}`, row: 'oversizeWhole', doc: [{ id: 'c1', kind: 'cylinder', radius: 12, height: 30, center: [0, 0, 0], round: d, roundStyle: 'chamfer' }], size: d, limit: 12, closed: d < 12 ? () => cylV(12, 30) - 2 * rimChamfer(12, d) : undefined, expect: d >= 12 ? 'refuse' : null });
for (const d of [4, 9.99, 12]) add({ id: `ov-d-box-fillet-${d}`, row: 'oversizeWhole', doc: [{ id: 'b1', kind: 'box', size: [40, 30, 20], center: [0, 0, 0], round: d, roundStyle: 'fillet' }], size: d, limit: 10, closed: d < 10 ? () => rbox(40, 30, 20, d) : undefined, expect: d >= 10 ? 'refuse' : null });

// ---------------------------------------------------------------------------------------------------------------------
// GRID: round then bevel / bevel then round on adjacent top edges of a 40x30x12 box, every r and d in {1,2,3}
const BX = 'const b = cuboid(40,30,12)\n';
for (const r of [1, 2, 3]) for (const d of [1, 2, 3]) {
  add({ id: `gr-rb-r${r}-d${d}`, row: 'grid', r, d, order: 'round-then-bevel', script: `${BX}round(b.edge('top','front'), ${r})\nbevel(b.edge('top','right'), ${d})`, closed: () => mitre(V0, { k: 'f', s: r, L: 40 }, { k: 'c', s: d, L: 30 }) });
  add({ id: `gr-br-d${d}-r${r}`, row: 'grid', r, d, order: 'bevel-then-round', script: `${BX}bevel(b.edge('top','front'), ${d})\nround(b.edge('top','right'), ${r})`, closed: () => mitre(V0, { k: 'c', s: d, L: 40 }, { k: 'f', s: r, L: 30 }) });
}
// SEQUENCES of adjacent fillets (the literal mitre vs the tangent-chain convention of OCCT / FreeCAD)
const P = PLATE;
add({ id: 'sq-f-top-front-r3-top-right-r3', row: 'sequence', script: `${P}round(pad.edge('top','front'), 3)\nround(pad.edge('top','right'), 3)`, closed: () => mitre(VP, { k: 'f', s: 3, L: 40 }, { k: 'f', s: 3, L: 30 }) });
add({ id: 'sq-f-top-front-r1-top-right-r1', row: 'sequence', script: `${P}round(pad.edge('top','front'), 1)\nround(pad.edge('top','right'), 1)`, closed: () => mitre(VP, { k: 'f', s: 1, L: 40 }, { k: 'f', s: 1, L: 30 }) });
add({ id: 'sq-f-top-front-r05-top-right-r05', row: 'sequence', script: `${P}round(pad.edge('top','front'), 0.5)\nround(pad.edge('top','right'), 0.5)`, closed: () => mitre(VP, { k: 'f', s: 0.5, L: 40 }, { k: 'f', s: 0.5, L: 30 }) });
add({ id: 'sq-f-top-front-r3-front-right-r3', row: 'sequence', script: `${P}round(pad.edge('top','front'), 3)\nround(pad.edge('front','right'), 3)`, closed: () => mitre(VP, { k: 'f', s: 3, L: 40 }, { k: 'f', s: 3, L: 10 }) });
add({ id: 'sq-f-top-front-r3-front-right-r5', row: 'sequence', script: `${P}round(pad.edge('top','front'), 3)\nround(pad.edge('front','right'), 5)`, closed: () => mitre(VP, { k: 'f', s: 3, L: 40 }, { k: 'f', s: 5, L: 10 }) });
add({ id: 'sq-f-top-front-r5-front-right-r3', row: 'sequence', script: `${P}round(pad.edge('top','front'), 5)\nround(pad.edge('front','right'), 3)`, closed: () => mitre(VP, { k: 'f', s: 5, L: 40 }, { k: 'f', s: 3, L: 10 }) });
add({ id: 'sq-f-top-front-r6-top-right-r6', row: 'sequence', script: `${P}round(pad.edge('top','front'), 6)\nround(pad.edge('top','right'), 6)`, closed: () => mitre(VP, { k: 'f', s: 6, L: 40 }, { k: 'f', s: 6, L: 30 }) });
add({ id: 'sq-f-top-front-r3-top-left-r3', row: 'sequence', script: `${P}round(pad.edge('top','front'), 3)\nround(pad.edge('top','left'), 3)`, closed: () => mitre(VP, { k: 'f', s: 3, L: 40 }, { k: 'f', s: 3, L: 30 }) });
add({ id: 'sq-f-box-top-front-r4-top-right-r2', row: 'sequence', script: `${B3}round(b.edge('top','front'), 4)\nround(b.edge('top','right'), 2)`, closed: () => mitre(V3, { k: 'f', s: 4, L: 40 }, { k: 'f', s: 2, L: 30 }) });
add({ id: 'sq-f-three-at-corner-r2', row: 'sequence', script: `${BX}round(b.edge('top','front'), 2)\nround(b.edge('top','right'), 2)\nround(b.edge('front','right'), 2)` });

// ---------------------------------------------------------------------------------------------------------------------
// HAND-BUILT EDGE LISTS: round([a.edge(..), b.edge(..)], r) / bevel([...], d)
add({ id: 'ls-round-2adj', row: 'edgeList', script: `${BX}round([b.edge('top','front'), b.edge('top','right')], 2)` });
add({ id: 'ls-round-3corner', row: 'edgeList', script: `${BX}round([b.edge('top','front'), b.edge('top','right'), b.edge('front','right')], 2)` });
add({ id: 'ls-round-top4', row: 'edgeList', script: `${BX}round([b.edge('top','front'), b.edge('top','right'), b.edge('top','back'), b.edge('top','left')], 2)` });
add({ id: 'ls-round-vert4', row: 'edgeList', script: `${BX}round([b.edge('front','left'), b.edge('front','right'), b.edge('back','left'), b.edge('back','right')], 2)` });
add({ id: 'ls-round-parallel2', row: 'edgeList', script: `${BX}round([b.edge('top','front'), b.edge('bottom','back')], 2)` });
add({ id: 'ls-bevel-2adj', row: 'edgeList', script: `${BX}bevel([b.edge('top','front'), b.edge('top','right')], 2)` });
add({ id: 'ls-bevel-3corner', row: 'edgeList', script: `${BX}bevel([b.edge('top','front'), b.edge('top','right'), b.edge('front','right')], 2)` });
add({ id: 'ls-bevel-top4', row: 'edgeList', script: `${BX}bevel([b.edge('top','front'), b.edge('top','right'), b.edge('top','back'), b.edge('top','left')], 2)` });
add({ id: 'ls-bevel-parallel2', row: 'edgeList', script: `${BX}bevel([b.edge('top','front'), b.edge('bottom','back')], 2)` });
add({ id: 'ls-round-empty', row: 'edgeList', script: `${BX}round([], 2)` });
add({ id: 'ls-round-nonedge-member', row: 'edgeList', script: `${BX}round([b.edge('top','front'), b], 2)` });
// four top edges ONE BY ONE (the 'ring4' case): refused at the third call, see batch.mjs for the one-call version
add({ id: 'ring4-one-by-one-r3', row: 'edgeList', script: `${P}round(pad.edge('top','front'), 3)\nround(pad.edge('top','right'), 3)\nround(pad.edge('top','back'), 3)\nround(pad.edge('top','left'), 3)` });

// ---------------------------------------------------------------------------------------------------------------------
// PICK-RETRY: a size refusal that the pick-retry loop answers with a DIFFERENT edge. Thin plate 40 x 6.3662 x 10.
const THIN = "const sk = sketch('top')\nsk.rect(40, 6.3662, { at: [20, 3.1831] })\nconst pad = extrude(sk, 10)\n";
add({ id: 'pr-thin-bevel6-then-round5-top-front', row: 'pickRetry', script: `${THIN}bevel(pad.edge('bottom','front'), 6)\nround(pad.edge('top','front'), 5)` });
add({ id: 'pr-thin-bevel6-then-round55-top-front', row: 'pickRetry', script: `${THIN}bevel(pad.edge('bottom','front'), 6)\nround(pad.edge('top','front'), 5.5)` });
add({ id: 'pr-thin-bevel6-then-bevel5-top-front', row: 'pickRetry', script: `${THIN}bevel(pad.edge('bottom','front'), 6)\nbevel(pad.edge('top','front'), 5)` });
add({ id: 'pr-thin-round7-top-front', row: 'pickRetry', script: `${THIN}round(pad.edge('top','front'), 7)` });
add({ id: 'pr-thin-single-round2-top-front', row: 'pickRetry', script: `${THIN}round(pad.edge('top','front'), 2)`, closed: () => 40 * 6.3662 * 10 - Af(2) * 40 });
// ---------------------------------------------------------------------------------------------------------------------
// BOOLEAN edge names
add({ id: 'bo-subtract-edge', row: 'boolean', script: "const a = box(40,30,20)\nconst c = cylinder(10, 30, {at:[0,0,0]})\nconst u = cut(a, c)\nround(u.edge('top','front'), 2)", closed: () => V3 - PI * 25 * 20 - Af(2) * 40 });
add({ id: 'bo-subtract-edge-bevel', row: 'boolean', script: "const a = box(40,30,20)\nconst c = cylinder(10, 30, {at:[0,0,0]})\nconst u = cut(a, c)\nbevel(u.edge('top','front'), 2)", closed: () => V3 - PI * 25 * 20 - Ac(2) * 40 });
add({ id: 'bo-union-unambiguous-round', row: 'boolean', script: "const a = box(40,30,10)\nconst b = box(20,30,10,{at:[10,0,5]})\nconst u = join(a, b)\nround(u.edge('top','front'), 2)" });
add({ id: 'bo-union-unambiguous-bevel', row: 'boolean', script: "const a = box(40,30,10)\nconst b = box(20,30,10,{at:[10,0,5]})\nconst u = join(a, b)\nbevel(u.edge('top','front'), 2)" });
add({ id: 'bo-union-ambiguous-3edge', row: 'boolean', script: `const b = cuboid(40,40,20)\nconst k = cuboid(10,10,10,{at:[0,0,15]})\nconst d = join(b, k)\nround(d.edge('top','front'), 2)` });
add({ id: 'bo-union-edge-of-operand', row: 'boolean', script: "const a = box(40,30,10)\nconst b = box(20,30,10,{at:[10,0,5]})\nconst u = join(a, b)\nround(a.edge('bottom','front'), 2)" });
add({ id: 'bo-union-edge-top-right-of-stub', row: 'boolean', script: "const a = box(40,30,10)\nconst b = box(10,10,10,{at:[0,0,10]})\nconst u = join(a, b)\nround(u.edge('top','right'), 2)" });
// ---------------------------------------------------------------------------------------------------------------------
// CONSUMED edges: the same edge named twice
add({ id: 'cs-round1-then-round3', row: 'consumed', script: `${P}round(pad.edge('top','front'), 1)\nround(pad.edge('top','front'), 3)`, closed: () => VP - Af(3) * 40 });
add({ id: 'cs-round3-then-round1', row: 'consumed', script: `${P}round(pad.edge('top','front'), 3)\nround(pad.edge('top','front'), 1)`, closed: () => VP - Af(3) * 40 });
add({ id: 'cs-round1-alone', row: 'consumed', script: `${P}round(pad.edge('top','front'), 1)`, closed: () => VP - Af(1) * 40 });
add({ id: 'cs-round3-alone', row: 'consumed', script: `${P}round(pad.edge('top','front'), 3)`, closed: () => VP - Af(3) * 40 });
add({ id: 'cs-bevel1-then-bevel3', row: 'consumed', script: `${P}bevel(pad.edge('top','front'), 1)\nbevel(pad.edge('top','front'), 3)`, closed: () => VP - Ac(3) * 40 });
add({ id: 'cs-bevel3-then-bevel1', row: 'consumed', script: `${P}bevel(pad.edge('top','front'), 3)\nbevel(pad.edge('top','front'), 1)`, closed: () => VP - Ac(3) * 40 });
add({ id: 'cs-bevel1-alone', row: 'consumed', script: `${P}bevel(pad.edge('top','front'), 1)`, closed: () => VP - Ac(1) * 40 });
add({ id: 'cs-bevel3-alone', row: 'consumed', script: `${P}bevel(pad.edge('top','front'), 3)`, closed: () => VP - Ac(3) * 40 });
add({ id: 'cs-bevel3-then-round1', row: 'consumed', script: `${P}bevel(pad.edge('top','front'), 3)\nround(pad.edge('top','front'), 1)`, closed: () => VP - Ac(3) * 40 });
add({ id: 'cs-round3-then-bevel1', row: 'consumed', script: `${P}round(pad.edge('top','front'), 3)\nbevel(pad.edge('top','front'), 1)`, closed: () => VP - Af(3) * 40 });
// MOVE hazard (30 x 20 x 20 box, as in the critic's repro; the 20-long front/back edges are the wrong-edge decoys)
const MV = (v, op, a, b, s) => `const b = box(30,20,20)\nmove(b,[${v}])\n${op}(b.edge('${a}','${b}'), ${s})`;
add({ id: 'mv-x-15-round', row: 'moveHazard', script: MV('15,0,0', 'round', 'top', 'front', 2), closed: () => 12000 - Af(2) * 30 });
add({ id: 'mv-x-15-bevel', row: 'moveHazard', script: MV('15,0,0', 'bevel', 'top', 'front', 2), closed: () => 12000 - Ac(2) * 30 });
add({ id: 'mv-xm15-round', row: 'moveHazard', script: MV('-15,0,0', 'round', 'top', 'front', 2), closed: () => 12000 - Af(2) * 30 });
add({ id: 'mv-y10-bevel', row: 'moveHazard', script: MV('0,10,0', 'bevel', 'top', 'front', 2), closed: () => 12000 - Ac(2) * 30 });
add({ id: 'mv-111-bevel', row: 'moveHazard', script: MV('1,1,1', 'bevel', 'top', 'front', 2), closed: () => 12000 - Ac(2) * 30 });
add({ id: 'mv-z2-bevel', row: 'moveHazard', script: MV('0,0,2', 'bevel', 'top', 'front', 2), closed: () => 12000 - Ac(2) * 30 });
add({ id: 'mv-y2-bevel', row: 'moveHazard', script: MV('0,2,0', 'bevel', 'top', 'front', 2), closed: () => 12000 - Ac(2) * 30 });
add({ id: 'mv-cyl-333-round', row: 'moveHazard', script: "const c = cylinder(30, 20)\nmove(c,[3,3,3])\nround(c.edge('top','side'), 2)", closed: () => cylV(15, 20) - rimFillet(15, 2) });
add({ id: 'mv-turn-z90-bevel', row: 'moveHazard', script: "const b = box(30,20,20)\nturn(b,[0,0,90])\nbevel(b.edge('top','front'), 2)" });
add({ id: 'mv-turn-xyz-bevel', row: 'moveHazard', script: "const b = box(30,20,20)\nturn(b,[30,40,50])\nbevel(b.edge('top','front'), 2)" });
// ---------------------------------------------------------------------------------------------------------------------
// SIZE ZERO / NEGATIVE: what the student sees
add({ id: 'sz-edge-round-0', row: 'sizes', script: `${BX}round(b.edge('top','front'), 0)` });
add({ id: 'sz-edge-round-neg', row: 'sizes', script: `${BX}round(b.edge('top','front'), -2)` });
add({ id: 'sz-edge-bevel-0', row: 'sizes', script: `${BX}bevel(b.edge('top','front'), 0)` });
add({ id: 'sz-edge-bevel-neg', row: 'sizes', script: `${BX}bevel(b.edge('top','front'), -1)` });
add({ id: 'sz-whole-round-0', row: 'sizes', script: `${BX}round(b, 0)`, closed: () => V0 });
add({ id: 'sz-whole-round-neg', row: 'sizes', script: `${BX}round(b, -2)` });
add({ id: 'sz-edge-round-nan', row: 'sizes', script: `${BX}round(b.edge('top','front'), 'big')` });
// ---------------------------------------------------------------------------------------------------------------------
// PERFORMANCE: cases that took a long time in an earlier probe (ms recorded in fx.ms)
add({ id: 'pf-cyl-offc-whole-r3', row: 'perf', script: "const c = cylinder(24,30,{at:[5,3,2]})\nround(c, 3)", closed: () => cylV(12, 30) - 2 * rimFillet(12, 3) });
add({ id: 'pf-cyl-whole-r3', row: 'perf', script: "const c = cylinder(24,30)\nround(c, 3)", closed: () => cylV(12, 30) - 2 * rimFillet(12, 3) });
add({ id: 'pf-corner-then-join', row: 'perf', script: "const a = box(40,30,20,{corner:3})\nconst b = box(20,20,30,{corner:2, at:[10,0,0]})\njoin(a,b)" });
