// SPIKE (phase 4), referee/demo only. The phase 4 gallery = the phase 3 gallery (imported, unedited) with
//   * the three examples phase 3 REFUSED for want of a brep-rs name lookup turned into examples that now BUILD,
//   * new examples for every cause this phase resolves in the browser (primitive, carried, swept, between),
//   * new refusal examples for names this phase does not resolve (with the plain sentence checked).
// Every script here was run in the real page and scored against live OCCT (VERIFY.md).
import { readFileSync } from 'node:fs';
import { EXAMPLES as P3 } from '../phase3/examples.mjs';
import { REGRESSIONS } from './regression-fixtures.mjs';

const keep = P3.filter((e) => !['refuse-shell-open', 'refuse-edge-pick', 'refuse-counterbore-round'].includes(e.id));
const gal = (id) => keep.findIndex((e) => e.id === id);

const NAMED = [
  // ---- named picks that now build -------------------------------------------------------------------------------------
  { id: 'named-fillet-edge', group: '3d', title: 'Fillet on a named edge (top / front)',
    script: `// round the edge where the top face meets the front face of a 40 x 40 x 20 block, radius 3\nconst b = cuboid(40, 40, 20)\nround(b.edge('top', 'front'), 3)`,
    expect: 'PASS. One body, curved, volume = OCCT\'s (31922.7). The edge is found by solidcraft\'s own topology: the one edge on both the +z and -y planes, whose persistent name is F1:+z|F1:-y. Phase 3 refused this.', curved: true },
  { id: 'named-bevel-edge', group: '3d', title: 'Chamfer on a named edge (top / right)',
    script: `// bevel the top-right edge of a 40 x 40 x 20 block by 3\nconst b = cuboid(40, 40, 20)\nchamfer(b.edge('top', 'right'), 3)`,
    expect: 'PASS. Volume 32000 - 0.5*3*3*40 = 31820 (planar, exact).', closed: 32000 - 0.5 * 3 * 3 * 40 },
  { id: 'named-shell-open-top', group: '3d', title: 'Shell with an open face (top)',
    script: `// hollow a 40 x 40 x 20 block, 2 mm walls, open at the top\nconst b = cuboid(40, 40, 20)\nshell(b, { wall: 2, open: 'top' })`,
    expect: 'PASS. Volume = OCCT\'s (8672 = 32000 - 36*36*18). The open face is the one planar face with outward normal +z; the pick point is its centroid (its own nearest-face lookup returns the same face). Phase 3 refused this.', closed: 32000 - 36 * 36 * 18 },
  { id: 'named-draft-face', group: '3d', title: 'Draft one face (right) by 8 degrees',
    script: `// tilt the right face of a 40 x 40 x 20 block by 8 degrees, pulled along z, neutral plane at the bottom (z = -10)\nconst b = cuboid(40, 40, 20)\ndraft(b.face('right'), 8, { neutral: -10 })`,
    expect: 'PASS, curved bar. Volume = OCCT\'s draft of the +x face (neutral plane z = -10, the bottom).', curved: true },
  { id: 'named-cylinder-rim', group: '3d', title: 'Round the top rim of a cylinder (edge between top and side)',
    script: `// the rim of a 12 mm radius, 30 mm tall cylinder; solidcraft splits the wall into 2 halves and the rim into 2 half circles\nconst c = cylinder(12, 30)\nround(c.edge('top', 'side'), 3)`,
    expect: 'PASS, curved. The name resolves to ONE closed loop of 2 engine half-edges (F1:side#1|F1:top + F1:side#2|F1:top); picking one point rounds the whole rim. Volume = OCCT\'s.', curved: true },
  { id: 'named-edge-after-cut', group: '3d', title: 'Round an edge of a block that has had a hole cut through it',
    script: `// a 40 x 40 x 20 block with a 8 mm hole through the middle, then the top-right edge rounded 2\nconst b = cuboid(40, 40, 20)\nconst c = cylinder(4, 40, { at: [0, 0, 0] })\nconst d = subtract(b, c)\nround(d.edge('top', 'right'), 2)`,
    expect: 'PASS. The name is primitive(op1, +z / +x) on the cut result, resolved on op1\'s own shape (7 faces; the top face has a hole but its edge to +x is whole).', curved: true },
  { id: 'named-hole-then-round', group: '3d', title: 'Name an edge of the box, round it on the holed body',
    script: `// the box edge is named against box1, the round is applied to the body after hole1 drilled it\nconst b = cuboid(40, 30, 10)\nhole(b, { across: 6 })\nround(b.edge('top', 'right'), 2)`,
    expect: 'PASS. The name belongs to box1 (resolved on box1\'s own shape), the pick is then checked to be whole on the holed target before it is used.', curved: true },
  { id: 'named-hole-then-shell', group: '3d', title: 'Shell open at the top of a plate that has a hole (annular face)',
    script: `// a 40 x 30 x 10 plate with a 10 mm hole through it, then hollowed 1 mm, open at the top (the top face is an annulus)\nconst b = cuboid(40, 30, 10)\nhole(b, { across: 10 })\nshell(b, { wall: 1, open: 'top' })`,
    expect: 'PASS. Volume = OCCT\'s and brep-rs\'s 2656.478. The top face\'s centroid is IN the hole, so the pick is an interior point of the face, chosen on the target body and verified with solidcraft\'s own pick test (phase 4 first version over-refused or mis-picked here).', curved: true },
  { id: 'named-pocket-wall-round', group: '3d', title: 'Round the rim of a pocket wall (carried + swept + between)',
    script: `// a 60 x 40 x 12 plate, a 20 x 10 pocket 4 deep, and the rim edge along pocket wall 1 rounded 1\nconst plate = cuboid(60, 40, 12)\nconst sk2 = sketch('top', 6)\nsk2.rect(20, 10, { at: [0, 0] })\nconst part = pocket(sk2, plate, 4)\nround(part.edge('top', part.wall(sk2, 1)), 1)`,
    expect: 'PASS. The edge is between carried(plate top) and swept(pocket tool, edge 0); the wall is read off the tool\'s own shape and lifted onto the pocketed plate with its normal flipped, and solidcraft\'s persistent names agree.', curved: true },
  { id: 'named-counterbore-round', group: '3d', title: 'Counterbore (refused) and a named-edge round (built)',
    script: `const base = cuboid(40, 30, 10)\nconst post = extrude(sketch('top', 5).rect(10, 10), 20)\nhole(base, { across: 6, at: [12, 0], counterbore: { across: 10, deep: 3 } })\nconst other = cuboid(10, 10, 10, { at: [30, 0, 0] })\nround(other.edge('top', 'right'), 1)`,
    expect: 'Mixed: base, post and other build, the NAMED round now builds too (phase 3 refused it); only the counterbored hole is refused, with its sentence. Built volume = base 12000 + post 2000 + rounded box.', partial: true, curved: true, expectRefused: [{ id: 'hole1', contains: 'counterbore' }], expectBuilt: ['box1', 'pull1', 'round1'] },
  // ---- names this phase refuses, with the sentence ---------------------------------------------------------------------
  { id: 'refuse-name-two-faces', group: 'refusal', title: 'Ambiguous name: the top face is split in two',
    script: `// a channel 5 deep cut right across a block splits its top face into two coplanar pieces; "the top face" is then 2 faces\nconst b = cuboid(60, 40, 20)\nconst slot = cuboid(10, 50, 10, { at: [0, 0, 10] })\nconst d = subtract(b, slot)\nshell(d, { wall: 2, open: 'top' })`,
    expect: 'EXPECTED REFUSAL: the shell is refused with a sentence that names the name and says it matches 2 faces. The channelled block (60*40*20 - 10*40*5 = 46000) stays. Measured on brep-rs for the same block: this shell is refused there too (for its own reason, a blind cut), round(top/left) resolves by picking ONE of the two pieces (centroid -30,0,10) and round(top/right) resolves to null. This demo refuses every spelling with the count instead of choosing a piece.', refusal: true, partial: true, expectRefused: [{ id: 'shell1', contains: 'matches 2 faces' }], expectBuilt: ['op1'] },
  { id: 'refuse-name-swept-arc', group: 'refusal', title: 'Unsupported name: a swept wall of a circular pocket',
    script: `// the wall of a round pocket is swept from an ARC; this demo resolves swept names over straight sketch edges only\nconst plate = cuboid(60, 40, 12)\nconst sk = sketch('top', 6)\nsk.circle(8, { at: [0, 0] })\nconst part = pocket(sk, plate, 4)\nround(part.edge('top', part.wall(sk, 1)), 1)`,
    expect: 'EXPECTED REFUSAL: the round is refused with the sentence that a swept name over a circle sketch is not resolved in the browser demo. The plate and pocket stay.', refusal: true, partial: true, curved: true, expectRefused: [{ id: 'round1', contains: 'swept name over it is not resolved' }], expectBuilt: ['pocket1'] },
];

// ---- the b2-stub shell family: built by solidcraft, DIVERGES from the independent reference (VERIFY.md section 5b) ----------
// The reSHape script language cannot name "b1's +z face" on a union (open: 'top' on the union opens b2's top instead), so these
// carry a ModelDoc (`doc`); the page runs it as is while the editor text is unedited. The reference numbers come from
// verify-stub-reference.mjs (stub-reference-results.json): box composition on live OCCT, cross-checked by a voxel estimator.
// Nothing here is a pass: the page shows the verdict computed from `divergence` (red when it does not match, never green
// unless the built volume equals a reference).
const STUBREF = JSON.parse(readFileSync(new URL('./stub-reference-results.json', import.meta.url), 'utf8')).results;
const STUBS = Object.keys(STUBREF).map((id) => {
  const fx = REGRESSIONS.find((r) => r.id === id);
  const r0 = STUBREF[id];
  const r = { occt_P: +r0.occt_P.toFixed(3), occt_L: +r0.occt_L.toFixed(3) };
  const doc = { version: 1, features: fx.features };
  return { id: 'diverge-' + id, group: 'diverge', title: `Shell open at b1's top, stub ${id.replace('stub-', '')} unioned on it`,
    script: `// ModelDoc (no script form: the script language cannot name b1's +z face on the union).\n// b1 = box 40x30x10 centred at the origin, b2 = ${JSON.stringify(fx.features[1].size)} at ${JSON.stringify(fx.features[1].center)}, union, shell 1 mm, open = b1.+z\n${JSON.stringify(doc)}`,
    expect: `KNOWN DIVERGENCE, shown red on purpose. solidcraft builds this shell, but the independent reference is ${r.occt_P} (plane offset: every face 1 mm in, the open plane not offset) or ${r.occt_L} (distance erosion: the stub stays attached). OCCT's own shell no-ops here and brep-rs does not measure it, so neither is a reference.`,
    doc, divergence: { status: 'diverges', refs: [{ label: 'plane-offset box composition (OCCT)', volume: r.occt_P }, { label: 'distance erosion (OCCT boxes, voxel-checked)', volume: r.occt_L }] },
    ref: { source: 'independent box composition (OCCT booleans of primitives; voxel cross-check)', volume: r.occt_P, finalFeature: 's1' } };
});

export const EXAMPLES = [...keep.slice(0, gal('refuse-shell-closed')), ...NAMED.filter((e) => e.group !== 'refusal'), ...keep.slice(gal('refuse-shell-closed')), ...NAMED.filter((e) => e.group === 'refusal'), ...STUBS];
