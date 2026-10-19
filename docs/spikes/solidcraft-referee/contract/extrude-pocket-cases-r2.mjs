// SPIKE, referee only (contract / extrude-pocket group), ROUND 2. Appends to CASES (extrude-pocket-cases.mjs) and re-labels the existing cases whose
// right answer is a refusal under the round-2 policy:
//   - a pocket that touches nothing is REFUSED (brep-rs: "pocket1 does not touch the part, so it cuts nothing")
//   - a pocket that would seal a void inside the part is REFUSED (brep-rs: "would leave a sealed cavity inside the part instead of opening onto a face")
// New cases: taper folds (the critic's families), a bow-tie outline, through-all with a direction / with midplane / with length2, multi-piece pulls and
// parts split in two, degenerate lengths and walls. Closed forms are written here with no kernel involved; where none is given the reference is live OCCT.
import { CASES, H } from './extrude-pocket-cases.mjs';

const { R, Cc, P, prism, box, sub, uni, tapered, polyTaper, PLATE, PLATEBOX, PI, add_ } = H;
const byId = (id) => CASES.find((c) => c.id === id);

// ---- re-labelled existing cases -------------------------------------------------------------------------------------------------------
export const TOUCH_NOTHING = ['kp-bottom-face', 'kp-in-air', 'kr-top-air', 'kd-up-slant', 'kd-parallel-up', 'kd-reversed', 'kt-below'];
export const SEALED_CAVITY = ['kr-mid', 'kr-front-mid', 'km-mid', 'km-front', 'kl-mid', 'kl-reversed', 'kl-front', 'kd-midplane'];
for (const id of [...TOUCH_NOTHING, ...SEALED_CAVITY]) {
  const c = byId(id);
  if (!c) throw new Error(`r2: no such case ${id}`);
  c.expect = 'refuse';
  c.analyticWas = c.analytic ? 'unchanged part / part with a void' : null;
  c.analytic = undefined; // the closed form described the built-anyway answer; the answer is now a refusal
  c.note = `${c.note ? `${c.note}; ` : ''}ROUND 2: ${TOUCH_NOTHING.includes(id) ? 'touches nothing' : 'would seal a void'}, refused as brep-rs does`;
}

const F_TFOLD = 'pull/pocket option {taper}: a taper that folds the outline over itself is refused';
const F_BOWTIE = 'pull/pocket where the single outline crosses or touches itself (bow-tie) is refused';
const F_THRU_DIR = 'pocket {through:true} together with {direction}';
const F_THRU_MID = 'pocket {through:true} together with {midplane} / {length2}';
const F_MULTI = 'a pull or a split part with several pieces feeds the next feature (pocket, join)';
const F_DEGEN = 'degenerate scales: tiny lengths, tiny outlines, hair-thin walls';
export const FEATURES2 = { F_TFOLD, F_BOWTIE, F_THRU_DIR, F_THRU_MID, F_MULTI, F_DEGEN };

// ---- taper folds ---------------------------------------------------------------------------------------------------------------------
const tf = (id, draw, h, deg, note, expect = 'refuse', plane = 'top') => add_({ id, feature: F_TFOLD, expect, note, script: `const sk = sketch('${plane}'); ${draw} const part = pull(sk, ${h}, { taper: ${deg} });` });
const RECT20 = 'sk.rect(20, 12, { at: [10, 6] });';
for (const deg of [-35, -45, -55, -60, -65, -70, -75, -80, -85, -89]) tf(`tf-rect-${-deg}`, RECT20, 10, deg, `20 x 12, h 10: the 12 mm side closes at ${(6 / Math.tan(-deg * PI / 180)).toFixed(2)} mm of height`);
tf('tf-rect40-70', 'sk.rect(40, 25, { at: [20, 12.5] });', 10, -70, '40 x 25, h 10 at -70');
tf('tf-triangle-50', 'sk.polygon([[0,0],[30,0],[10,20]]);', 12, -50, 'triangle, inradius 7.1');
const USLOT = 'sk.polygon([[0,0],[30,0],[30,20],[17,20],[17,8],[13,8],[13,20],[0,20]]);';
tf('tf-uslot-20', USLOT, 10, 20, 'U with a 4 mm slot: the slot walls meet at 2 mm of travel; +20 travels 3.64');
tf('tf-uslot-11.4', USLOT, 10, 11.4, '+11.4 travels 2.016 mm: the slot has just closed');
tf('tf-cshape-30', 'sk.polygon([[0,0],[30,0],[30,6],[10,6],[10,14],[30,14],[30,20],[0,20]]);', 10, 30, 'C with an 8 mm opening: closes at 4 mm of travel, +30 travels 5.77');
tf('tf-notch-30', 'sk.polygon([[0,0],[30,0],[30,20],[17,20],[15,12],[13,20],[0,20]]);', 10, 30, 'V notch');
tf('tf-roundrect-60', 'sk.polygon([[0,0],[40,0],[40,25],[0,25]]); sk.round(2, 5);', 10, -60, 'rounded corner outline shrinks 17.3 mm per side, the 25 mm side closes at 12.5');
tf('tf-circle-60', 'sk.circle(20, { at: [0, 0] });', 10, -60, 'circle d20: radius 10 closes at 10 of travel, -60 travels 17.3');
tf('tf-L-inward', 'sk.polygon([[0,0],[30,0],[30,10],[10,10],[10,25],[0,25]]);', 12, -30, 'L with 10 mm arms: closes at 5 mm of travel, -30 travels 6.93');
add_({ id: 'tf-pocket-slot-25', feature: F_TFOLD, expect: 'refuse', note: 'pocket whose slot-shaped tool would close up: +25 over 8 mm travels 3.73, the slot closes at 2',
  script: `${PLATE} const sk = sketch('top', 10); sk.polygon([[5,5],[35,5],[35,25],[22,25],[22,13],[18,13],[18,25],[5,25]]); const cut = pocket(sk, plate, 8, { taper: 25 });` });
add_({ id: 'tf-pocket-neg-45', feature: F_TFOLD, expect: 'refuse', note: 'pocket 8 x 6, 8 deep, -45: closes at 3 deep',
  script: `${PLATE} const sk = sketch('top', 10); sk.rect(8, 6, { at: [20, 15] }); const cut = pocket(sk, plate, 8, { taper: -45 });` });
// controls: tapers that stay clean right up to the edge of folding must still BUILD and match
tf('tfc-rect-30', RECT20, 10, -30, 'control: -30 leaves a 0.46 mm sliver, still a solid', 'build');
tf('tfc-uslot-11', USLOT, 10, 11, 'control: +11 travels 1.944 mm, a 0.11 mm slit is left', 'build');
tf('tfc-uslot-10', USLOT, 10, 10, 'control: +10', 'build');
tf('tfc-triangle-30', 'sk.polygon([[0,0],[30,0],[10,20]]);', 12, -30, 'control: -30 travels 6.93, inradius 7.14', 'build');
tf('tfc-cshape-20', 'sk.polygon([[0,0],[30,0],[30,6],[10,6],[10,14],[30,14],[30,20],[0,20]]);', 10, 20, 'control: +20 travels 3.64, the 8 mm opening is left 0.72 wide', 'build');
tf('tfc-circle-40', 'sk.circle(20, { at: [0, 0] });', 10, -40, 'control: circle d20, -40 travels 8.39', 'build');
tf('tfc-roundrect-25', 'sk.polygon([[0,0],[40,0],[40,25],[0,25]]); sk.round(2, 5);', 10, -25, 'control: rounded corner r5, -25 travels 4.66 < 5, the arc survives', 'build');
tf('tf-roundrect-45', 'sk.polygon([[0,0],[40,0],[40,25],[0,25]]); sk.round(2, 5);', 10, -45, 'the r5 corner arc vanishes at 5 mm of travel, -45 travels 10: a wall disappears', 'refuse');
tf('tfc-L-outward', 'sk.polygon([[0,0],[30,0],[30,10],[10,10],[10,25],[0,25]]);', 12, 30, 'control: L growing outward', 'build');
add_({ id: 'tfc-pocket-uslot-10', feature: F_TFOLD, note: 'control: slot pocket +10 over 8 mm travels 1.41 < 2',
  script: `${PLATE} const sk = sketch('top', 10); sk.polygon([[5,5],[35,5],[35,25],[22,25],[22,13],[18,13],[18,25],[5,25]]); const cut = pocket(sk, plate, 8, { taper: 10 });` });

// ---- an outline that crosses or touches itself ------------------------------------------------------------------------------------------
add_({ id: 'bt-pull', feature: F_BOWTIE, expect: 'refuse', script: "const sk = sketch('top'); sk.polygon([[0,0],[20,0],[0,10],[20,10]]); const part = pull(sk, 5);", note: 'bow-tie: two triangles' });
add_({ id: 'bt-pocket', feature: F_BOWTIE, expect: 'refuse', script: `${PLATE} const sk = sketch('top', 10); sk.polygon([[10,10],[30,10],[10,20],[30,20]]); const cut = pocket(sk, plate, 4);`, note: 'bow-tie pocket' });
add_({ id: 'bt-pull-taper', feature: F_BOWTIE, expect: 'refuse', script: "const sk = sketch('top'); sk.polygon([[0,0],[20,0],[0,10],[20,10]]); const part = pull(sk, 5, { taper: 5 });" });
add_({ id: 'bt-pull-pentagram', feature: F_BOWTIE, expect: 'refuse', script: "const sk = sketch('top'); sk.polygon([[0,10],[6,-8],[-10,3],[10,3],[-6,-8]]); const part = pull(sk, 5);", note: 'five-pointed star drawn in one stroke: the edges cross five times' });
add_({ id: 'bt-vertex-touch', feature: F_BOWTIE, expect: 'refuse', script: "const sk = sketch('top'); sk.polygon([[0,0],[20,0],[10,10],[20,20],[0,20],[10,10]]); const part = pull(sk, 5);", note: 'two corners meet at one point (a figure 8 pinched at (10,10))' });
add_({ id: 'bt-control-star', feature: F_BOWTIE, script: "const sk = sketch('top'); sk.polygon([[0,10],[2.5,3],[10,3],[4,-1.5],[6,-9],[0,-4.5],[-6,-9],[-4,-1.5],[-10,3],[-2.5,3]]); const part = pull(sk, 5);", note: 'control: a ten-pointed star outline that does not cross itself' });

// ---- through-all together with direction / midplane / length2 -----------------------------------------------------------------------------
const TH = (id, off, draw, dir, o = '', expect = 'build', note) => add_({ id, feature: F_THRU_DIR, expect, note, script: `${PLATE} const sk = sketch('top', ${off}); ${draw} const cut = pocket(sk, plate, 5, { direction: [${dir.join(', ')}], through: true${o} });` });
const SQ = 'sk.rect(8, 6, { at: [14, 15] });';
TH('td-slant', 10, SQ, [1, 0, -1], '', 'build', 'from the top face, slanting +X and down, through all');
TH('td-slant-y', 10, SQ, [0, -1, -2]);
TH('td-slant-alongfalse', 10, SQ, [1, 0, -1], ', alongNormal: false');
TH('td-slant-mid-sketch', 5, SQ, [1, 0, -1], '', 'build', 'sketch half way down the plate: only the part below it is cut');
TH('td-slant-above', 15, SQ, [1, 0, -1], '', 'build', 'sketch 5 above the plate: the whole thickness is cut');
TH('td-slant-circle', 10, 'sk.circle(6, { at: [14, 15] });', [1, 0, -1]);
TH('td-slant-up', 10, SQ, [1, 0, 1], '', 'refuse', 'points up and away from the plate: cuts nothing');
TH('td-slant-reversed', 10, SQ, [1, 0, -1], ', reversed: true', 'refuse', 'reversed from the top face goes up: cuts nothing');
TH('td-slant-below', 0, SQ, [1, 0, -1], '', 'refuse', 'sketch on the bottom face cutting down: nothing');
TH('td-slant-mid', 10, SQ, [1, 0, -1], ', midplane: true', 'build', 'both ways along the slant');
add_({ id: 'td-critic', feature: F_THRU_DIR, note: 'the critic\'s own: pocket(s, b, 5, {direction:[1,0,-1], through:true}) on a 50 x 40 x 10... re-made on the 40 x 30 plate',
  script: `${PLATE} const sk = sketch('top', 10); sk.rect(10, 10, { at: [20, 15] }); const cut = pocket(sk, plate, 5, { direction: [1, 0, -1], through: true });` });

const TM = (id, off, o, expect = 'build', note, plane = 'top', draw = 'sk.rect(8, 6, { at: [20, 15] });') => add_({ id, feature: F_THRU_MID, expect, note, script: `${PLATE} const sk = sketch('${plane}', ${off}); ${draw} const cut = pocket(sk, plate, 5, { ${o} });` });
const TMV = () => ({ volume: 12000 - 48 * 10 });
for (const off of [10, 5, 15, -3, 0, 12]) {
  const id = `tm-mid-${off}`;
  TM(id, off, 'through: true, midplane: true', 'build', `through + midplane, sketch at z=${off}: the whole thickness is cut either way`);
  byId(id).analytic = () => ({ ...TMV(), bbox: [0, 0, 0, 40, 30, 10] });
}
TM('tm-mid-circle', 5, 'through: true, midplane: true', 'build', 'round bore, mid-body sketch', 'top', 'sk.circle(10, { at: [20, 15] });');
byId('tm-mid-circle').curved = true;
byId('tm-mid-circle').analytic = () => ({ volume: 12000 - PI * 25 * 10 });
TM('tm-mid-reversed', 5, 'through: true, midplane: true, reversed: true', 'build', 'reversed changes nothing for a symmetric through cut');
byId('tm-mid-reversed').analytic = () => TMV();
TM('tm-mid-front', 0, 'through: true, midplane: true', 'build', 'front sketch through the plate (y 0..30): the sketch plane is the plate face', 'front', 'sk.rect(8, 6, { at: [20, 5] });');
byId('tm-mid-front').analytic = () => ({ volume: 12000 - 48 * 30 });
TM('tm-len2', 10, 'through: true, length2: 3', 'refuse', 'through + length2 has no meaning; brep-rs drops length2 silently');
TM('tm-len2-mid-sketch', 5, 'through: true, length2: 3', 'refuse', 'sketch mid-body: a literal reading would also cut 3 mm above the sketch; brep-rs ignores that');

// ---- multi-piece pulls and split parts -------------------------------------------------------------------------------------------------------
const TWO = "const s1 = sketch('top'); s1.rect(20, 20, { at: [-20, 0] }); s1.rect(20, 20, { at: [20, 0] }); const two = pull(s1, 15);";
const BIGB = (x0, y0, z0, x1, y1, z1) => box(x0, y0, z0, x1, y1, z1);
add_({ id: 'mp-pull-two', feature: F_MULTI, script: `${TWO}`, analytic: () => ({ volume: 12000, bbox: [-30, -10, 0, 30, 10, 15], com: [0, 0, 7.5] }), note: 'the feature\'s own measure must be 12000, not one piece\'s 6000' });
add_({ id: 'mp-pocket-right', feature: F_MULTI, script: `${TWO} const s2 = sketch('top', 15); s2.rect(6, 6, { at: [20, 0] }); const cut = pocket(s2, two, 5);`,
  analytic: () => ({ volume: 12000 - 180, bbox: [-30, -10, 0, 30, 10, 15] }), note: 'a pocket on the second piece must be applied' });
add_({ id: 'mp-pocket-left', feature: F_MULTI, script: `${TWO} const s2 = sketch('top', 15); s2.rect(6, 6, { at: [-20, 0] }); const cut = pocket(s2, two, 5);`,
  analytic: () => ({ volume: 12000 - 180, bbox: [-30, -10, 0, 30, 10, 15] }) });
add_({ id: 'mp-pocket-both', feature: F_MULTI, script: `${TWO} const s2 = sketch('top', 15); s2.rect(6, 6, { at: [-20, 0] }); s2.rect(6, 6, { at: [20, 0] }); const cut = pocket(s2, two, 5);`,
  analytic: () => ({ volume: 12000 - 360, bbox: [-30, -10, 0, 30, 10, 15] }) });
add_({ id: 'mp-pocket-through-right', feature: F_MULTI, script: `${TWO} const s2 = sketch('top', 15); s2.rect(6, 6, { at: [20, 0] }); const cut = pocket(s2, two, 5, { through: true });`,
  analytic: () => ({ volume: 12000 - 36 * 15 }) });
add_({ id: 'mp-join-inside-right', feature: F_MULTI, script: `${TWO} const s3 = sketch('top', 0); s3.rect(10, 10, { at: [20, 0] }); const j = join(two, pull(s3, 8));`,
  analytic: () => ({ volume: 12000, bbox: [-30, -10, 0, 30, 10, 15] }), note: 'a block wholly inside the right piece: nothing is added' });
add_({ id: 'mp-join-on-top-right', feature: F_MULTI, script: `${TWO} const s3 = sketch('top', 15); s3.rect(10, 10, { at: [20, 0] }); const j = join(two, pull(s3, 5));`,
  analytic: () => ({ volume: 12000 + 500, bbox: [-30, -10, 0, 30, 10, 20] }) });
add_({ id: 'mp-join-overlap-right', feature: F_MULTI, script: `${TWO} const s3 = sketch('top', 10); s3.rect(10, 10, { at: [25, 0] }); const j = join(two, pull(s3, 10));`,
  analytic: () => ({ volume: 12000 + 500, bbox: [-30, -10, 0, 30, 10, 20] }), note: 'a block half inside the right piece: only the 5 mm of it that stands out (z 15..20 of x 20..30) and nothing double counted' });
add_({ id: 'mp-join-bridge', feature: F_MULTI, script: `${TWO} const s3 = sketch('top', 5); s3.rect(40, 6, { at: [0, 0] }); const j = join(two, pull(s3, 4));`,
  analytic: () => uni(box(-30, -10, 0, -10, 10, 15), uni(box(10, -10, 0, 30, 10, 15), box(-10, -3, 5, 10, 3, 9))), note: 'a bar that bridges the two pieces: they become one solid' });
const SLOTPLATE = `${PLATE} const s2 = sketch('top', 10); s2.rect(6, 40, { at: [20, 15] }); const cut1 = pocket(s2, plate, 10, { through: true });`;
add_({ id: 'mp-split-slot', feature: F_MULTI, script: SLOTPLATE, analytic: () => ({ volume: 12000 - 6 * 30 * 10, bbox: [0, 0, 0, 40, 30, 10] }), note: 'a slot across the whole plate cuts it into two pieces' });
add_({ id: 'mp-split-then-pocket-left', feature: F_MULTI, script: `${SLOTPLATE} const s3 = sketch('top', 10); s3.rect(4, 4, { at: [5, 15] }); const cut2 = pocket(s3, plate, 3);`,
  analytic: () => ({ volume: 12000 - 1800 - 48 }) });
add_({ id: 'mp-split-then-pocket-right', feature: F_MULTI, script: `${SLOTPLATE} const s3 = sketch('top', 10); s3.rect(4, 4, { at: [35, 15] }); const cut2 = pocket(s3, plate, 3);`,
  analytic: () => ({ volume: 12000 - 1800 - 48 }) });
add_({ id: 'mp-split-then-join', feature: F_MULTI, script: `${SLOTPLATE} const s3 = sketch('top', 10); s3.rect(10, 10, { at: [35, 15] }); const j = join(plate, pull(s3, 5));`,
  analytic: () => ({ volume: 12000 - 6 * 30 * 10 + 500, bbox: [0, 0, 0, 40, 30, 15] }) });
add_({ id: 'mp-ring-island', feature: F_MULTI, curved: true, script: `${PLATE} const s2 = sketch('top', 10); s2.circle(20, { at: [20, 15] }); s2.circle(8, { at: [20, 15] }); const cut = pocket(s2, plate, 10, { through: true });`,
  analytic: () => ({ volume: 12000 - PI * (100 - 16) * 10 }), note: 'a ring-shaped through cut frees a round island: two pieces, the island stays in place (FreeCAD gives two solids)' });

// ---- degenerate scales ---------------------------------------------------------------------------------------------------------------------
for (const h of [1e-9, 1e-8, 1e-7, 1e-6, 1e-5, 1e-4, 1e-3, 1e-2]) {
  add_({ id: `dg-h-${h}`, feature: F_DEGEN, expect: h < 1e-3 ? 'refuse' : 'build', script: `const sk = sketch('top'); sk.rect(10, 10, { at: [5, 5] }); const part = pull(sk, ${h});`, analytic: () => ({ volume: 100 * h }) });
}
for (const s of [1e-6, 1e-5, 1e-4, 1e-3, 1e-2]) {
  add_({ id: `dg-s-${s}`, feature: F_DEGEN, expect: s < 1e-3 ? 'refuse' : 'build', script: `const sk = sketch('top'); sk.rect(${s}, ${s}, { at: [0, 0] }); const part = pull(sk, 1);`, analytic: () => ({ volume: s * s }) });
}
for (const d of [1e-4, 1e-3, 3e-3, 1e-2, 1e-1, 0.5, 1]) {
  add_({ id: `dg-c-${d}`, feature: F_DEGEN, curved: true, expect: d < 0.5 ? 'refuse' : 'build', script: `const sk = sketch('top'); sk.circle(${d}, { at: [0, 0] }); const part = pull(sk, ${2 * d});`, analytic: () => ({ volume: PI * d * d / 4 * 2 * d }), note: `circle d ${d}, pulled ${2 * d}: truck's volume is ${d < 0.5 ? 'more than 3e-4 off' : 'inside the curved bar'} (error depends on the diameter alone below 1 mm)` });
}
for (const e of [1e-8, 1e-6, 1e-5, 1e-4, 1e-3, 1e-2]) {
  add_({ id: `dg-pk-${e}`, feature: F_DEGEN, expect: e < 1e-3 ? 'refuse' : 'build', script: `${PLATE} const sk = sketch('top', 10); sk.rect(8, 6, { at: [20, 15] }); const cut = pocket(sk, plate, ${e});`, analytic: () => ({ volume: 12000 - 48 * e }) });
}
for (const w of [1e-6, 1e-5, 5e-4, 1e-3, 1e-2, 1e-1, 0.3, 1]) {
  add_({ id: `dg-wall-${w}`, feature: F_DEGEN, expect: w <= 0.12 ? 'refuse' : 'build', script: `${PLATE} const sk = sketch('top', 10); sk.rect(${20 - w}, 20, { at: [${w + (20 - w) / 2}, 15] }); const cut = pocket(sk, plate, 5);`, analytic: () => ({ volume: 12000 - (20 - w) * 20 * 5 }), note: `pocket 20 - w wide leaving a wall w = ${w} mm thick between it and the plate edge` });
  add_({ id: `dg-wall-thru-${w}`, feature: F_DEGEN, expect: w <= 0.12 ? 'refuse' : 'build', script: `${PLATE} const sk = sketch('top', 10); sk.rect(${20 - w}, 20, { at: [${w + (20 - w) / 2}, 15] }); const cut = pocket(sk, plate, 10, { through: true });`, analytic: () => ({ volume: 12000 - (20 - w) * 20 * 10 }), note: `through cut leaving a wall ${w} mm thick` });
}

// ---- a hole in the sketch + direction (the soup guard is the only protection) ----------------------------------------------------------------
add_({ id: 'pd-soup-hole', feature: F_THRU_DIR, expect: 'refuse', script: "const sk = sketch('top'); sk.rect(40, 30); sk.circle(10); const part = pull(sk, 10, { direction: [1, 0, 1] });", note: 'truck\'s loft silently drops the hole (10000 vs 9497): only the soup guard stops it' });

// the old refused-by-policy case, now a build: through + midplane cuts the whole part both ways
{
  const c = byId('kt-through-midplane');
  if (c) { c.expect = undefined; c.note = `${c.note ? `${c.note}; ` : ''}ROUND 2: through + midplane is the whole part cut both ways (brep-rs, OCCT, closed form agree)`; }
}
// slanted ROUND tools: they build while they end inside the part and are slower (12-21 s against 4-12 s) / TRAP / do not finish when they cross a face (see translate-ep.mjs); the guard refuses the crossing ones
add_({ id: 'sc-slant-circle-inside', feature: F_THRU_DIR, curved: true, note: 'slanted d6 bore that ends inside the plate: builds', script: `${PLATE} const sk = sketch('top', 10); sk.circle(6, { at: [14, 15] }); const cut = pocket(sk, plate, 5, { direction: [1, 0, -1] });` });
add_({ id: 'sc-slant-circle-exits-bottom', feature: F_THRU_DIR, expect: 'refuse', curved: true, note: 'the same bore 11 deep through a 10 mm plate: raw truck TRAPS the wasm (depth 10.01 and 15 build but are slower (12-21 s against 4-12 s), 11 traps the wasm; a join of one did not finish in 25 s under load)', script: `${PLATE} const sk = sketch('top', 10); sk.circle(6, { at: [14, 15] }); const cut = pocket(sk, plate, 11, { direction: [1, 0, -1] });` });
add_({ id: 'sc-slant-circle-exits-side', feature: F_THRU_DIR, expect: 'refuse', curved: true, note: 'the slant carries the bore out of the side of the plate', script: `${PLATE} const sk = sketch('top', 10); sk.circle(6, { at: [34, 15] }); const cut = pocket(sk, plate, 8, { direction: [1, 0, -1] });` });
add_({ id: 'sc-slant-circle-join-hang', feature: F_THRU_DIR, expect: 'refuse', curved: true, note: 'join(plate, slanted circle pull that runs into the plate): raw truck did not finish in 25 s (14 s for a similar one, machine load 26): freezes or crashes', script: `${PLATE} const s2 = sketch('top', 10); s2.circle(6, { at: [14, 15] }); const pad = join(plate, pull(s2, 12, { direction: [1, 0, -1] }));` });
add_({ id: 'sc-slant-circle-join-away', feature: F_THRU_DIR, curved: true, note: 'join(plate, slanted circle pull that leaves the plate upward): builds', script: `${PLATE} const s2 = sketch('top', 10); s2.circle(6, { at: [14, 15] }); const pad = join(plate, pull(s2, 5, { direction: [1, 0, 1] }));` });
add_({ id: 'sc-slant-poly-through', feature: F_THRU_DIR, note: 'a slanted POLYGON tool through the whole plate builds (planar faces): td-slant is the same', script: `${PLATE} const sk = sketch('top', 10); sk.rect(8, 6, { at: [14, 15] }); const cut = pocket(sk, plate, 15, { direction: [1, 0, -1] });` });
// near-flush slivers: a tool face a hair short of a part face (below what truck keeps apart)
for (const g of [1e-5, 5e-5, 1e-4, 2e-4]) {
  add_({ id: `nf-wall-${g}`, feature: F_DEGEN, expect: 'refuse', note: `blind pocket stopping ${g} mm short of the plate edge`, script: `${PLATE} const sk = sketch('top', 10); sk.rect(${20 - g}, 20, { at: [${g + (20 - g) / 2}, 15] }); const cut = pocket(sk, plate, 5);`, analytic: g <= 1e-4 ? undefined : () => ({ volume: 12000 - (20 - g) * 100 }) });
}
add_({ id: 'nf-join-step-1e-5', feature: F_DEGEN, expect: 'refuse', note: 'a boss whose side sticks out of the plate edge by 1e-5 mm', script: `${PLATE} const s2 = sketch('top', 10); s2.rect(10, 10, { at: [${35 + 1e-5}, 15] }); const pad = join(plate, pull(s2, -10));` });
add_({ id: 'nf-join-step-0.01', feature: F_DEGEN, expect: 'refuse', note: 'the same with 0.01 mm: truck drops the step', script: `${PLATE} const s2 = sketch('top', 10); s2.rect(10, 10, { at: [${35 + 0.01}, 15] }); const pad = join(plate, pull(s2, -10));` });
add_({ id: 'nf-join-step-0.5', feature: F_DEGEN, note: 'a 0.5 mm step builds', script: `${PLATE} const s2 = sketch('top', 10); s2.rect(10, 10, { at: [${35 + 0.5}, 15] }); const pad = join(plate, pull(s2, -10));`, analytic: () => ({ volume: 12000 + 0.5 * 100 }) });

{ const c = byId('td-slant-circle'); if (c) { c.expect = 'refuse'; c.note = `${c.note ? `${c.note}; ` : ''}ROUND 2: a slanted round cut through the whole part leaves the part's box: refused (raw truck traps the wasm)`; } }

// cases whose right answer was always a refusal (the round-1 file left them at the default "should build", so they scored as "declined but should build")
for (const id of ['pp-zero-height', 'pt-fold', 'pt-just-folded', 'kk-fold', 'pt-ring', 'pt-midplane', 'pt-length2', 'pd-with-taper', 'sp-soup-taper', 'spk-soup-taper', 'kk-midplane', 'pd-in-plane', 'kd-in-plane',
  'sp-crossing-rects', 'sp-crossing-circles', 'sp-tangent-inside', 'sp-tangent-outside', 'sp-shared-edge']) {
  const c = byId(id);
  if (!c) throw new Error(`r2: no such case ${id}`);
  c.expect = 'refuse';
}

// ---- more builds for the pocket options whose old cases mostly left a void (those moved to the sealed-cavity row) ----------------------------------
const { pocket: pk } = H;
const PO2 = (n) => `pocket options: ${n}`;
pk({ id: 'kl-side', feature: PO2('length2'), plane: 'side', off: 40, draw: 'sk.rect(12, 6, { at: [14, 5] });', prof: R(8, 2, 20, 8), depth: 6, o: { length2: 2 }, nr: [-6, 2], note: 'x=40 face, the cut runs -X 6 deep; the 2 mm second length is out of the mouth' });
pk({ id: 'kl-circle-top', feature: PO2('length2'), draw: 'sk.circle(8, { at: [12, 20] });', prof: Cc(12, 20, 8), depth: 5, o: { length2: 2 }, nr: [-5, 2], curved: true });
pk({ id: 'kl-bottom-reversed', feature: PO2('length2'), off: 0, draw: 'sk.rect(8, 6, { at: [20, 15] });', prof: R(16, 12, 24, 18), depth: 3, o: { length2: 2, reversed: true }, nr: [-2, 3], note: 'z=0 face, reversed (cuts up) with 2 mm out of the mouth' });
pk({ id: 'km-side', feature: PO2('midplane'), plane: 'side', off: 40, draw: 'sk.rect(12, 6, { at: [14, 5] });', prof: R(8, 2, 20, 8), depth: 8, o: { midplane: true }, nr: [-4, 4], note: 'x=40 face: 4 mm in the part, 4 mm in the air' });
pk({ id: 'km-top-circle', feature: PO2('midplane'), draw: 'sk.circle(10, { at: [20, 15] });', prof: Cc(20, 15, 10), depth: 12, o: { midplane: true }, nr: [-6, 6], curved: true });
pk({ id: 'km-bottom', feature: PO2('midplane'), off: 0, draw: 'sk.rect(8, 6, { at: [20, 15] });', prof: R(16, 12, 24, 18), depth: 6, o: { midplane: true }, nr: [-3, 3], note: 'z=0 face: the upper 3 mm are in the plate' });
pk({ id: 'kr-front-back', feature: PO2('reversed:true'), plane: 'front', off: 30, draw: 'sk.rect(8, 6, { at: [20, 5] });', prof: R(16, 2, 24, 8), depth: 5, o: { reversed: true }, nr: [0, 5], note: 'front sketch on the y=30 back face, reversed: cuts toward -Y into the plate' });
pk({ id: 'kr-side', feature: PO2('reversed:true'), plane: 'side', off: 0, draw: 'sk.rect(6, 6, { at: [15, 5] });', prof: R(12, 2, 18, 8), depth: 5, o: { reversed: true }, nr: [0, 5], note: 'side sketch on the x=0 face, reversed: cuts +X into the plate' });
