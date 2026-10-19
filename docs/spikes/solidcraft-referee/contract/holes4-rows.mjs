#!/usr/bin/env node
// Builds contract/holes.json (round 4) from the raw per-case results of holes4-drive.mjs. Every row's status is ASSERTED against the numbers it cites; a row
// whose data disagrees with its status makes this script exit 1 instead of writing a guess.
//   bun contract/holes4-rows.mjs <out.json> <results1.json> [<results2.json> ...]      (later files override earlier ones for the same case id)
import { readFileSync, writeFileSync } from 'node:fs';
import { plainScriptError, lintSentence } from './holes4-translate.mjs';
import { faceText, ev, okBuilt, refusedOk, CURVED, CPU_BUDGET_MS, BORDER_MS, e, n4, slowest, sentences } from './holes4-evidence.mjs';

const [, , OUTFILE, ...INPUTS] = process.argv;
const R = new Map();
const CPU = new Map();
// every run of a case in any input file: [translateCpuMs, finalCpuMs] (a run = one execution of the whole case); the status rule uses the SLOWEST of them (holes4-evidence.mjs)
for (const f of INPUTS) for (const r of JSON.parse(readFileSync(f, 'utf8'))) {
  R.set(r.id, r);
  if (typeof r.translateCpuMs === 'number' || typeof r.finalCpuMs === 'number') CPU.set(r.id, [...(CPU.get(r.id) ?? []), [r.translateCpuMs ?? 0, r.finalCpuMs ?? 0]]);
}
for (const [id, v] of CPU) { const r = R.get(id); r.cpuRuns = v; r.cpuAll = v.map((x) => Math.max(...x)); r.cpuBest = Math.min(...r.cpuAll); }
// ROUND 4: a script error is quoted VERBATIM (what packages/script emits). The one-sentence rewrite (plainScriptError) is only a proposal and is shown in the evidence.
for (const r of R.values()) if (r.verdict === 'script-error') { r.plainScriptErrors = (r.scriptErrors ?? []).map((m) => plainScriptError(m, r.script)); r.lint = []; }
// ROUND 3 results (holes3-results/final.json, unchanged) for "what round 3 told the student" in the evidence of the rows round 4 changed
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const R3 = new Map(JSON.parse(readFileSync(path.join(HERE, 'holes3-results/final.json'), 'utf8')).map((x) => [x.id, x]));
const r3 = (id) => {
  const x = R3.get(id); if (!x) return `${id}: no round-3 record`;
  if (x.verdict === 'truck-refused') return `${id}: refused (${x.truck.guard ?? 'engine'}) "${x.truck.refused}"`;
  if (x.verdict === 'truck-built') return `${id}: built V=${n4(x.truck.volume)} faces=${x.truck.faces} bbox=${JSON.stringify(x.truck.bbox.map((v) => +v.toFixed(4)))} CPU ${((x.translateCpuMs ?? 0) / 1000).toFixed(0)} s translation / ${((x.finalCpuMs ?? 0) / 1000).toFixed(0)} s final`;
  return `${id}: ${x.verdict}`;
};
const r3Note = (...ids) => `ROUND 3 RESULT (holes3-results/final.json): ${ids.map(r3).join('; ')}.`;
const g = (id) => { const r = R.get(id); if (!r) throw new Error(`no result for case ${id}`); return r; };
const rows = [];
let failures = 0;
// negative controls: the same cases with one guard switched off (holes4-controls.sh), read from $CTL/ctl-<name>/holes3-results.json
import { existsSync } from 'node:fs';
const CTL = process.env.CTL;
function ctl(name, ids) {
  if (!CTL) return '';
  const f = existsSync(`${CTL}/ctl-${name}.json`) ? `${CTL}/ctl-${name}.json` : `${CTL}/ctl-${name}/holes3-results.json`;
  if (!existsSync(f)) { console.error(`missing control ${f}`); failures++; return ''; }
  const rs = new Map(JSON.parse(readFileSync(f, 'utf8')).map((x) => [x.id, x]));
  const one = (id) => {
    const x = rs.get(id); if (!x) return `${id}: no control result`;
    if (x.verdict === 'timeout') return `${id}: NO RESULT within ${x.timeoutSeconds} s wall, process killed (hang)`;
    if (x.verdict === 'crash') return `${id}: crashed`;
    if (x.verdict === 'script-error') return `${id}: script error`;
    if (x.verdict === 'truck-refused') return `${id}: still refused, by ${x.truck.guard ?? 'the engine'}`;
    const c = x.cmp ?? {};
    const parts = [`built V=${n4(x.truck.volume)} (${x.truck.bodies} body reported${x.droppedBodies?.length ? `, ${(x.allBodies ?? []).length} in the engine` : ''}, ${x.truck.shells} shell${x.truck.shells === 1 ? '' : 's'}, ${x.truck.faces} faces)`];
    if (x.closed?.volume !== undefined) parts.push(`closed form V=${n4(x.closed.volume)} (dVol ${e(c.vsClosed?.dVol)}${c.vsClosed?.dRemoved !== undefined ? `, removed volume off by ${e(c.vsClosed.dRemoved)}` : ''})`);
    if (c.vsBrep) parts.push(`brep-rs V=${n4(x.brep.volume)}`); else if (x.brep?.refused) parts.push('brep-rs refuses');
    if (c.vsOcct && !(x.lastFeature?.counterbore || x.lastFeature?.countersink)) parts.push(`OCCT V=${n4(x.occt.volume)}`);
    return `${id}: ${parts.join('; ')}`;
  };
  return `NEGATIVE CONTROL (guard ${rs.values().next().value?.id ? name : name} switched off, silent result): ${ids.map(one).join(' || ')}.`;
}
/** records of a negative-control run (one or more guards switched off) as a Map with .off = the H4_OFF value; a row built from it cites the control, not the main run */
function ctlMap(name, off) {
  if (!CTL) throw new Error('CTL is unset');
  const f = existsSync(`${CTL}/ctl-${name}.json`) ? `${CTL}/ctl-${name}.json` : `${CTL}/ctl-${name}/holes4-results.json`;
  if (!existsSync(f)) throw new Error(`missing control ${f}`);
  const m = new Map(JSON.parse(readFileSync(f, 'utf8')).map((x) => [x.id, x]));
  m.off = off; return m;
}
const cmdFor = (ids) => `SOLIDCRAFT_REFEREE_PKG=$PKG bun docs/spikes/solidcraft-referee/contract/holes4-drive.mjs --out=$OUT --timeout=900 --only=${ids.join(',')}`;
const sentenceOf = (r) => (r.verdict === 'script-error' ? (r.scriptErrors ?? [r.scriptThrew])[0] : r.truck?.refused);
const NOTE_RULES = 'Rig: each case is a reSHape Script run through runScript -> ModelDoc -> holes3-translate.mjs (phase0 translator + guards) -> SolidCraft, and the same ModelDoc through live OCCT and live brep-rs (archive/brep-rs/pkg), plus a closed form and, where one exists, the saved FreeCAD ref. truck CPU seconds are process CPU time, not wall time (the box ran at load 20 to 50).';

/**
 * expect: 'supported' | 'refused' | 'unsupported' | 'wrong'
 *  supported   every id built one body and matches the oracles (okBuilt)
 *  refused     every id ends in a plain one-sentence refusal (script error or guard), lint-clean
 *  unsupported correct-or-unknown but not shippable: slow, or no oracle, or no sentence (check supplies the proof)
 *  wrong       builds and disagrees with an oracle (check supplies the proof)
 */
function row(feature, expect, ids, { check, note, sentenceFrom, from } = {}) {
  const problems = [];
  const gg = (id) => { const r = (from ?? R).get(id); if (!r) throw new Error(`no result for case ${id}`); return r; };
  for (const id of ids) {
    const r = gg(id);
    let p;
    if (check) p = check(r, id);
    else if (expect === 'supported') p = okBuilt(r);
    else if (expect === 'refused') p = refusedOk(r);
    if (p) problems.push(`${id}: ${p}`);
  }
  if (problems.length) { console.error(`ROW "${feature}" expected ${expect} but: ${problems.join(' | ')}`); failures++; }
  const first = gg(sentenceFrom ?? ids[0]);
  const out = { feature, status: expect };
  if (expect === 'refused') out.refusalSentence = sentenceOf(first);
  out.evidence = `${expect === 'wrong' ? 'WRONG SOLID. ' : ''}${note ? `${note} ` : ''}Command: ${from ? `H4_OFF=${from.off} ` : ''}${cmdFor(ids)}. ${ids.map((id) => ev(gg(id))).join(' || ')}`;
  rows.push(out);
}
const FACE_MERGE = 'harness key truck-merges-edge-connected-same-surface-faces, measured on the live OCCT shape: OCCT keeps the coplanar faces that a join, mirror or repeat leaves on either side of the seam as separate faces, and truck has exactly one face per edge-connected coplanar group (each id\'s `faces OCCT/truck (plane a/b ...)` census gives the measured group count, and the harness checks truck equals it).';
const cl = (id) => { const v = [...g(id).cpuAll].sort((a, b) => a - b); const med = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2; return `${g(id).cpuAll.map((x) => (x / 1000).toFixed(1)).join(', ')} s per run (best ${(g(id).cpuBest / 1000).toFixed(1)} s, median ${(med / 1000).toFixed(1)} s, slowest ${(slowest(g(id)) / 1000).toFixed(1)} s)`; };
const built = (r) => (r.verdict === 'truck-built' ? null : `not built (${r.verdict})`);
const refusedBy = (guard) => (r) => (r.verdict === 'truck-refused' && r.truck.guard === guard ? refusedOk(r) : `expected refusal by ${guard}, got ${r.verdict} ${r.truck?.guard ?? ''}`);
const hasGuard = (r, guard) => r.verdict === 'truck-refused' && r.truck.guard === guard;

// ================================================================ core
const CORE_IDS = ['core-centred-through', 'core-at-xy', 'core-5-digit-precision', 'g:hole-simple__offcentre-through', 'g:hole-simple__big-and-thick', 'g:hole-simple__tiny-deep',
  'g:hole-simple__breaks-out-of-the-side', 'g:hole-simple__hexagon-prism', 'through-thick-60', 'moved-box', 'g:hole-simple__in-cylinder'];
row('hole(shape,{across}): through bore on a box, pad, prism, cylinder or moved box, centred and offset (HoleFeature diameter, depth, center, axis z)', 'supported', CORE_IDS, { note: `PLATE = 40 x 30 x 10 pad from a sketch rectangle, BOX = cuboid(40,40,20). Worst final-volume delta vs OCCT over these ids: ${e(Math.max(...CORE_IDS.map((i) => g(i).cmp.vsOcct.dVol)))}; worst removed-volume delta vs the closed form on the planar hosts: ${e(Math.max(...CORE_IDS.filter((i) => !/cylinder/.test(i)).map((i) => g(i).cmp.vsClosed.dRemoved)))} (a constant: truck's tessellated bore); the FreeCAD refs agree to ${e(Math.max(...CORE_IDS.filter((i) => g(i).cmp.vsFc).map((i) => g(i).cmp.vsFc.dVol)))}. ${NOTE_RULES}` });
row('across: diameter, widest bore that still fits (29.9 across on a 30 deep plate, 38 across on a 40 x 40 box, 29 across on a 30 cylinder)', 'supported', ['core-widest-that-fits', 'wide-box38-control', 'wide-cyl29-control']);
row("across wider than the part's narrowest side (31, 30.5, 35, 60 across on a 30 deep plate; 41 across on a 40 x 40 box): the bore would split the part into several pieces", 'refused',
  ['wider-than-plate-35', 'wider-than-plate-31', 'wider-than-plate-30p5', 'wider-than-everything-60', 'wide-box41'],
  { check: (r) => (hasGuard(r, 'G-BODIES') || (r.id === 'wider-than-everything-60' && hasGuard(r, 'G-ENGINE')) ? refusedOk(r) : `expected G-BODIES, got ${r.verdict} ${r.truck?.guard ?? ''}`),
    note: 'ROUND 3 GUARD G-BODIES (post-check: the body count must not grow). Before the guard the layer reported ONE piece of the part (half, or a quarter) with ok:true, because phase0 aggregates only the body it named; OCCT and brep-rs both refuse "would not fit". The unguarded numbers are in each id below.' });
row('across equal to the narrowest side of the part (30 across on the 30 deep plate, 40 across on the 40 x 40 x 20 box): tangent to the sides', 'refused', ['wider-than-plate-30-exact', 'wide-box40-tangent'],
  { check: (r) => (hasGuard(r, 'G-TANGENT') ? refusedOk(r) : `expected G-TANGENT, got ${r.verdict} ${r.truck?.guard ?? ''}`),
    note: `ROUND 3 GUARDS G-TANGENT (pre-check, fires first) and G-SHELLS (post-check: kernel.shells must not grow, the backstop). Before the guards truck returned ONE body holding 2 (plate) or 4 (box) shells, pieces touching only along lines, volume equal to OCCT within 4e-4 so no volume gate sees it; OCCT cuts it into 2 / 4 solids and brep-rs refuses. ${ctl('tangent', ['wider-than-plate-30-exact', 'wide-box40-tangent'])}` });
row('across as wide as or wider than a cylinder host (cylinder 30 x 20 with 30 or 40 across)', 'refused', ['wide-cyl30', 'wide-cyl40'], { check: (r) => refusedOk(r), note: 'The bore swallows the part. Before round 3 the student saw a raw engine dump ("no body named b_cyl1 came back"); now the engine failure or the body guard is replaced by one sentence.' });

// ================================================================ tangent contact (round 3 guard G-TANGENT)
const tangentGuard = (r) => (hasGuard(r, 'G-TANGENT') ? refusedOk(r) : `expected G-TANGENT, got ${r.verdict} ${r.truck?.guard ?? ''}`);
row("bore tangent to the part's side or to another bore along a line (10 across with its centre 5 from the x=40 face; holes() at +-17 with 6 across on a 40 wide plate; holes() 6 across 6 apart)", 'refused',
  ['bore-tangent-to-edge', 'holes-tangent-to-wall', 'holes-tangent-to-each-other'], { check: tangentGuard,
    note: 'ROUND 3 GUARD G-TANGENT (pre-check: bore wall within 1e-6 of a bbox side, of a sibling bore, or of an earlier bore on the same axis). Truck builds one body with one shell and the right volume (dVol 2e-5 vs OCCT and closed form), but the face count differs from OCCT (bore-tangent-to-edge 8 OCCT / 7 truck; holes-tangent-to-wall 16 / 10; holes-tangent-to-each-other 12 / 10) and brep-rs refuses the wall case: a zero-thickness wall, where no oracle agrees on the topology. The 0.2 mm near-tangent controls are in the holes() row.' });

// ================================================================ across / size / argument errors
row('across: 0, negative, non-numeric or NaN', 'refused', ['across-zero', 'across-negative', 'across-string', 'across-nan'], { note: 'Script-layer sentences (packages/script, read-only), shown as they are: each is one sentence naming the value.' });
row('across/size omitted (hole(shape) and hole(shape,{}))', 'refused', ['no-across-no-size', 'no-options']);
row('unknown option name; missing shape argument', 'refused', ['unknown-option', 'hole-no-shape']);
for (const [n, d] of [['M3', 3.4], ['M4', 4.5], ['M5', 5.5], ['M6', 6.6], ['M8', 9], ['M10', 11], ['M12', 13.5]]) row(`size: '${n}' (clearance ${d} mm)`, 'supported', [`size-${n}`], { note: `PLATE hole at [3,-2] with across ${d}; closed form removed volume cylinder(${d}, 10).` });
row("size name is case-insensitive and trimmed ('m6', '  M6 ')", 'supported', ['size-lowercase-m6', 'size-padded-M6']);
row("size: unknown name text ('M7', 'M2')", 'refused', ['size-M7', 'size-M2'], { note: 'ROUND 4: the sentence is the interpreter\'s own text, quoted verbatim (round 3 quoted a regex rewrite that does not exist in the product). It is two sentences and reads "does not know the size the text "M7"", because describe() of a string is "the text ...".' });
row('size: a number instead of a name (6)', 'refused', ['size-number']);
row('across and size together', 'refused', ['across-and-size']);

// ================================================================ through / blind
row('deep omitted: through hole on a cylinder and a cone (depth = thickness along axis + 2)', 'supported', ['through-cylinder-axis', 'through-cone'], { note: 'Cone through hole costs about 11 s of truck CPU (curved on curved).' });
row('deep omitted: through hole on a sphere', 'supported', ['through-sphere'], {
  note: `Correct (OCCT and brep-rs 1.9e-5) but slow: truck CPU for the final command list was ${cl('through-sphere')} in separate runs at load 14 to 50, so it passes the ${CPU_BUDGET_MS / 1000} s CPU policy. The policy number is a choice (a script run over ${CPU_BUDGET_MS / 1000} s single-thread CPU is not interactive); CPU time, not wall time, is what is compared, and every run is listed.` });
row('deep omitted: through hole in a ring (torus), through the tube or down its empty centre', 'refused', ['through-ring-misses', 'through-ring-offset-hits', 'through-ring-misses-4'], {
  check: (r) => (hasGuard(r, 'G-TORUS') ? refusedOk(r) : `expected G-TORUS, got ${r.verdict} ${r.truck?.guard ?? ''}`),
  note: 'ROUND 3 GUARD G-TORUS (pre-check, root primitive is a torus). Unguarded: the bore through the tube (through-ring-offset-hits) gave no result in 300 s wall with a core pegged (a hang); the bore down the empty centre is a silent no-op (ring 30 / 6, across 4: the unchanged ring, 1 face, ok:true; across 2: after 24 s a raw engine failure).' });
row('deep omitted: refused when the thickness cannot be found (intersect, polar pattern of a wedge, shape after turn step, turned hexagonal prism)', 'refused',
  ['through-unknown-intersect', 'through-unknown-polar-wedge', 'through-unknown-after-turn-step', 'holes-unknown-intersect', 'rot-prism-turned'], {
    note: 'ROUND 4: interpreter text quoted verbatim: two sentences ("... so it cannot drill all the way through. Give it a depth: ..."), and it names the KIND of the student\'s shape ("this combine", "this extrude"), which for a turned plate or an intersect() result is not the word the student used. A page may adopt the one-sentence rewrite shown in each id as a proposal.' });
row('deep given: blind from the drilled face (axial offset set from the exact thickness): box, pad, hexagonal prism, moved box, L-shaped pad, cylinder', 'supported',
  ['g:hole-simple__blind-4', 'blind-deep-8-of-20', 'blind-offset-at', 'blind-on-pulled-sketch', 'blind-in-hex-prism', 'blind-tiny-0p5', 'blind-just-short-19p9', 'moved-box-blind', 'pad-L-blind', 'pad-circle-sketch', 'blind-in-cylinder'], {
    note: 'ROUND 3 GUARD G-TOP: a blind bore starts at the bounding-box top, so the translator checks there is a flat level top under the tool: planar parts by a thin probe disc whose removed volume must equal its own volume (exact to 1e-12), curved parts by a flat-topped-family rule plus a +2 faces probe (truck\'s curved volumes are tessellation-derived, a probe disc is lost in about 3 mm3 of noise). The probe, its numbers and the extra CPU are in each case\'s `probe` log.' });
row('deep given: blind into a sphere', 'refused', ['blind-in-sphere'], { check: refusedBy('G-TOP'), note: 'Round 2 called this supported (sphere pole, 26 s wall). The G-TOP probe at the pole fails inside the engine (a disc cut at a tangent point), so the guard cannot show the top is flat and the hole is refused; the sentence says the part is not flat and level under the spot, which is true of a sphere.' });
row('deep >= thickness (deep equals or exceeds the part) is a through hole', 'supported', ['blind-equals-thickness', 'blind-beyond-thickness', 'blind-deep-ge-bound-on-pocket', 'blind-unknown-intersect-deep-30']);
row('deep given on a result that only has an upper bound on its thickness (pocket result, subtract result): refused', 'refused', ['blind-on-pocket-result', 'blind-on-subtract-result'], { note: 'ROUND 4: interpreter text quoted verbatim (two sentences).' });
row('deep given where the thickness is unknown (intersect result, turned wedge): the tool is centred and would leave a sealed cavity', 'refused', ['blind-unknown-intersect-4', 'blind-wedge-turned'], {
  check: refusedBy('G-TOP'), note: 'Unguarded truck builds the part with an internal void (a sealed cavity), exactly as OCCT does; brep-rs refuses. Guard G-TOP (probe at the tool top finds material above it) fires first; the post-check G-SHELLS is the backstop (negative control run in holes4-controls).' });
row('deep: 0, negative, non-numeric or NaN', 'refused', ['deep-zero', 'deep-negative', 'deep-string', 'deep-nan']);

// ================================================================ along / at
row("along: 'x' | 'y' | 'z' drill axis (default z), through and blind, at default and explicit", 'supported', ['along-x-default-at', 'along-y-default-at', 'along-z-explicit', 'along-x-blind', 'along-y-blind', 'g:hole-simple__along-x', 'g:hole-simple__along-y']);
row("along: any other value ('w', 'Z')", 'refused', ['along-bad-axis', 'along-upper-case']);
row('at:[a,b] in-plane position for z, y and x drills (z: x,y; y: x,z; x: y,z)', 'supported', ['core-at-xy', 'along-x-blind', 'along-y-blind', 'pad-side-plane', 'pad-front-plane-offset', 'at-half-off-edge'], { note: 'at-half-off-edge puts the centre exactly on the x=40 edge (half the bore in the plate); the closed form is not asserted, OCCT and brep-rs agree to 2.2e-6.' });
row('at with a wrong number of values ([1], [1,2,3])', 'refused', ['at-wrong-length', 'at-three-values']);
row('at: non-finite value (NaN, Infinity)', 'refused', ['at-nan', 'at-infinity'], { note: 'ROUND 4: interpreter text quoted verbatim: it describes the pair as "a list of 2", which hides that one value is NaN or Infinity; the proposed one-sentence rewrite says so.' });
row('at: position off the part, the bore touches no material', 'refused', ['at-off-the-part'], { check: refusedBy('G-NOOP'), note: 'ROUND 3 GUARD G-NOOP (post-check: a hole must remove volume and add a face). Unguarded: the layer returned the unchanged plate, V=12000 before and after, ok:true.' });
row('hole whose centre lies in empty space of the host (L-shaped pad, bbox centre in the notch)', 'refused', ['pad-L-hole-in-notch'], { check: refusedBy('G-NOOP') });

// ================================================================ counterbore
const RECESS_NOTE = 'ROUND 3: counterbore/countersink are MAPPED to solidcraft\'s native solid.hole (type counterbore|countersink) with guards G-TOP, G-RECESS (width, depth, cone band), G-TANGENT and a closed-form post-check G-RECESS-VOL (box host, ring inside the footprint: removed volume within 1e-3 of the closed form). OCCT ignores recesses (occt-build.ts), so brep-rs, the saved FreeCAD refs and closed forms are the oracles; faces are compared with brep-rs/FreeCAD where they build it.';
row('counterbore:{across,deep}: recess diameter and depth - through, blind, along x and y, with size, on a box, pad, hexagonal prism and cylinder', 'supported', [
  'g:hole-counterbore__through-offset', 'g:hole-counterbore__deep-recess', 'g:hole-counterbore__blind', 'g:hole-counterbore__wide-thin', 'g:hole-counterbore__in-cylinder', 'cb-through-simple', 'cb-size-M6', 'cb-along-x', 'cb-along-y-blind', 'cb-blind-10-of-20',
  'cb-hex-prism-through', 'cb-in-cylinder-blind', 'cb-deep-equals-thickness'], { note: RECESS_NOTE });
row('counterbore whose ring breaks out of the part side, or is wider than the plate (ring cut clean across the top)', 'supported', ['cb-ring-breaks-out-side', 'cb-ring-near-tangent-side', 'cb-wider-than-plate'], { note: 'Closed forms are numeric integrals of the tool over the plate (n = 1400 grid); brep-rs refuses cb-wider-than-plate.' });
row('counterbore geometric degeneracy: narrower than or equal to the bore, deeper than the blind hole, equal to it, deeper than the part (21, 30 in a 20 thick box), deeper than the 10 plate', 'refused',
  ['cb-narrower-than-bore', 'cb-equal-to-bore', 'cb-deeper-than-blind-hole', 'cb-blind-deep-equals-hole', 'cb-blind-deep-beyond-hole', 'cb-deeper-than-plate', 'cb-deep-beyond-thickness-21', 'cb-deep-beyond-thickness-30'], {
    check: refusedBy('G-RECESS'), note: 'ROUND 3 GUARD G-RECESS. Unguarded native solid.hole: a counterbore deeper than the part silently becomes a plain 12 across bore (removed 2261.57 against the closed form 2261.95 with 21 deep, no sentence) where brep-rs refuses; a counterbore equal to the part (20 in 20, the control cb-deep-equals-thickness) is built by all.' });
row('counterbore with a missing or zero parameter', 'refused', ['cb-missing-across', 'cb-missing-deep', 'cb-zero-deep']);
row('counterbore or countersink where the part is not flat and level under the bore: over a pocket floor, on the low step of a join, on a tilted slab, over the open cavity of a hollow, twice on the same spot', 'refused',
  ['cb-pocket-floor-9x7', 'cb-pocket-floor-9x3', 'cb-step-join-low', 'cb-tilted-slab', 'cb-open-hollow', 'cb-revolve-wall', 'cs-pocket-floor-8x90', 'cs-step-join-low'], {
    check: (r) => (hasGuard(r, 'G-TOP') ? refusedOk(r) : `expected G-TOP, got ${r.verdict} ${r.truck?.guard ?? ''}`),
    note: 'ROUND 3 GUARD G-TOP. Native solid.hole measures the recess from the face under `position`, brep-rs and the layer measure it from the part\'s top: over a 4 deep pocket native cuts 381.64 where brep-rs and the closed form give 228.55 (counterbore 9 x 7) and 228.52 where they give 75.40 (9 x 3), with no sentence. The same sentence covers all of these.' });
row('counterbore on the high step of a join (top of the part is the bbox top) and beside a pocket (axis on the full-height top, recess ring reaching over the pocket)', 'supported', ['cb-step-join-high', 'cb-straddles-pocket-wall'], { note: RECESS_NOTE });
row('the same counterbored hole drilled twice', 'refused', ['cb-twice'], { check: refusedBy('G-NOOP') });

// ================================================================ countersink
row('countersink:{across,angle}: mouth diameter and INCLUDED cone angle < 180 - 60, 90, 120 and 179 degrees, through, blind, along y, in a cylinder, with size', 'supported', [
  'g:hole-countersink__angle-90-offset', 'g:hole-countersink__angle-120', 'g:hole-countersink__angle-60', 'g:hole-countersink__thick-block', 'g:hole-countersink__blind', 'g:hole-countersink__in-cylinder', 'cs-90-simple', 'cs-120', 'cs-size-M5-along-y-mouth8', 'cs-in-cylinder-blind'], { note: RECESS_NOTE });
row('countersink with a nearly flat cone (included angle 179: cone 0.03 deep)', 'unsupported', ['cs-angle-179'], {
  check: (r) => (r.verdict === 'truck-built' && r.cmp.vsBrep.dVol <= CURVED && r.truck.faces !== r.brep.faces ? null : 'expected built, volume right, faces differ'),
  note: `FACE COUNT NOT EXPLAINED: the volume matches brep-rs and the closed form (4.0e-6) but truck has ${g('cs-angle-179').truck.faces} faces and brep-rs ${g('cs-angle-179').brep.faces}; the extra face of a 0.03 mm deep cone is not accounted for by any measured mechanism, so it is not claimed.` });
row('countersink whose cone leaves through the bottom of the plate (cone 3 deep, tool 3.3 deep, plate 2 to 5 thick; mouth wider than the plate)', 'supported', [
  'cs-thin-plate-T2', 'cs-thin-plate-T3', 'cs-thin-plate-T3.2', 'cs-thin-plate-T3.3', 'cs-thin-plate-T3.4', 'cs-thin-plate-T5', 'g:hole-countersink__cone-deeper-than-plate-roomy', 'g:hole-countersink__cone-deeper-than-plate-angle-60', 'cs-wide-mouth-wider-than-plate'], { note: RECESS_NOTE });
row('countersink whose cone breaks out of a side face (mouth 12 across centred 4 from the x=0 edge of the plate)', 'unsupported', ['cs-ring-breaks-out-side'], {
  check: (r) => (r.verdict === 'truck-built' && r.cmp.vsClosed.dVol <= CURVED && r.cmp.vsOcct.dBbox > CURVED ? null : `expected volume right but bbox off ${r.cmp?.vsOcct?.dBbox}`),
  note: 'BBOX OUT OF TOLERANCE: the volume matches the closed form (4.0e-5) but truck\'s bounding box comes back 0.0165 mm outside the plate (x min -0.0165 on a plate that starts at 0; a tessellated conic edge where the cone meets the side face), 1.6e-2 against the 3e-4 curved bar. The layer centres every later hole on this bounding box, so a hole drilled afterwards would be 0.008 mm off. Not claimed.' });
const csBand = ['cs-blind-d6-D12-a90-b1', 'cs-blind-d6-D12-a90-b2', 'cs-blind-d6-D12-a90-b2.5', 'cs-blind-d6-D12-a90-b3', 'cs-blind-d6-D12-a90-b3.1', 'cs-blind-d6-D12-a90-b3.2', 'cs-blind-d6-D12-a90-b3.3', 'cs-blind-d6-D12-a90-b3.34',
  'cs-blind-d6-D12-a120-b1.5', 'cs-blind-d6-D12-a120-b1.8', 'cs-blind-d6-D12-a120-b1.9', 'cs-blind-d6-D12-a120-b1.95', 'cs-blind-d10-D20-a90-b5', 'cs-blind-d10-D20-a90-b5.4', 'cs-blind-d10-D20-a90-b5.5', 'cs-blind-d3-D6-a60-b2.7', 'cs-blind-d3-D6-a60-b2.9', 'holes-cs-blind-band'];
row('countersink cone deeper than, equal to, or within the cone TOOL depth (R - 0.9 r)/tan(half) + 0.05 of a blind hole (12/90 over a 6 bore: blind 1 to 3.34; 12/120: blind 1.5 to 1.95; 20/90 over 10: blind 5 to 5.5; 6/60 over 3: blind 2.7, 2.9; holes() 8/90 over 4, blind 2.1)', 'refused', csBand, {
  check: refusedBy('G-CSBAND'), sentenceFrom: 'cs-blind-d6-D12-a90-b3.2',
  note: 'ROUND 3 GUARD G-CSBAND, replacing round 2\'s "refuse when the cone depth exceeds the blind depth", which the critic measured to be too weak. Cause read from solidcraft crates/doc/src/eval.rs: native solid.hole cuts a FIXED cone tool that runs on down to radius 0.9 r (depth dcx = (R - 0.9 r)/tan(half)) whatever the hole depth, so for any blind depth below dcx the tool overshoots below the bore floor. holes3-cs-band.mjs swept 96 blind depths on 6 geometries (holes3-cs-band.json): the 30 depths more than 0.0015 below dcx are wrong by 1.1e-2 to 5.7e-1 of the removed volume (8 or 11 faces instead of 9); within 0.001 below dcx and at dcx the volume is right to 1.6e-4 but the face count is 11 instead of 9, and on one geometry the engine refuses ("coincident faces"); all 54 depths above dcx + 1e-6 are right (6.4e-5 to 1.2e-4, tessellation) with 9 faces and none refused. The guard refuses below dcx + 0.05 mm, so it holds with margin; blind 3.1 and 3.2 on the 12/90 (the critic\'s cases) are refused. Negative control with the guard off: holes4-controls.' });
row('countersink on a blind hole just deeper than the cone tool depth (12/90: blind 3.36, 3.5, 4, 6, 10; 12/120: 1.96, 2, 3; 20/90: 5.56, 6, 9; 6/60: 2.95, 3.5)', 'supported', [
  'cs-blind-d6-D12-a90-b3.36', 'cs-blind-d6-D12-a90-b3.5', 'cs-blind-d6-D12-a90-b4', 'cs-blind-d6-D12-a90-b6', 'cs-blind-d6-D12-a90-b10', 'cs-blind-d6-D12-a120-b1.96', 'cs-blind-d6-D12-a120-b2', 'cs-blind-d6-D12-a120-b3',
  'cs-blind-d10-D20-a90-b5.56', 'cs-blind-d10-D20-a90-b6', 'cs-blind-d10-D20-a90-b9', 'cs-blind-d3-D6-a60-b2.95', 'cs-blind-d3-D6-a60-b3.5'], { note: `${RECESS_NOTE} Removed volume agrees with the closed form to 6e-5 to 9e-5 on every one.` });
row('countersink tangent rim (30 across mouth on a 30 deep plate; 10 across mouth on a 10 high plate along y)', 'refused', ['g:hole-countersink__cone-deeper-than-plate', 'cs-size-M5-along-y'], { check: tangentGuard, note: 'The FreeCAD ref builds it; truck matches its volume (2.0e-5) but the face count (7) differs from FreeCAD\'s (8) with no explanation, and brep-rs refuses the tangent rim. ROUND 3 GUARD G-TANGENT.' });
row('counterbore ring tangent to the part side or as wide as the plate (rim tangent to the x=0 edge; 30 across on the 30 deep plate)', 'refused', ['cb-ring-tangent-side', 'cb-wide-as-plate', 'cb-as-wide-as-plate'], { check: tangentGuard, note: 'Truck builds both and matches the closed form (1.3e-4 / 1.1e-5); brep-rs refuses the second as a tangent contact. Same guard, same reason.' });
row('countersink degeneracy (narrower than the bore, equal to the bore)', 'refused', ['cs-narrower-than-bore', 'cs-equal-to-bore'], { check: refusedBy('G-RECESS') });
row('countersink included angle >= 180, <= 0, negative, or missing across/angle', 'refused', ['cs-angle-180', 'cs-angle-200', 'cs-angle-0', 'cs-angle-negative', 'cs-missing-angle', 'cs-missing-across']);
row('counterbore and countersink together', 'refused', ['cb-and-cs']);

// ================================================================ holes()
row('holes(shape,{apart:[dx,dy],...same options}): four-corner holes along z (HoleFeature.corners dx,dy = apart/2): plate, size, at, blind, cylinder', 'supported', [
  'holes-corners-simple', 'holes-corners-at', 'holes-corners-size-M4', 'holes-corners-blind', 'holes-corners-blind-5', 'holes-corners-in-cylinder', 'holes-near-tangent-control'], {
  note: 'ROUND 3 FACE-COUNT NOTE: every holes() row is compared with OCCT per surface type (see `faces OCCT/truck` in each id). Where the counts differ the harness key names the mechanism measured on the live OCCT shape: truck-merges-edge-connected-same-surface-faces (OCCT keeps the bore walls of overlapping bores as separate faces, truck one face per connected same-surface patch).' });
row('holes(): bores that overlap pairwise, break out of the sides, coincide (apart 0 or one axis 0), or a negative apart (read as its absolute value)', 'supported', ['holes-overlapping-columns', 'holes-break-out-side', 'holes-zero-spacing', 'apart-zero-one-axis', 'apart-negative'], {
  note: `Face counts (OCCT / truck): holes-overlapping-columns 12/10 and holes-break-out-side 16/14 are the merge key above, measured on the live OCCT shape (per-type census: ${faceText(g('holes-overlapping-columns')).replace(/^faces OCCT\/truck \S+ /, '')} and ${faceText(g('holes-break-out-side')).replace(/^faces OCCT\/truck \S+ /, '')}: OCCT keeps the walls of two overlapping or broken-out bores as separate faces, truck merges edge-connected patches); volume agrees to ${e(g('holes-overlapping-columns').cmp.vsOcct.dVol)} and ${e(g('holes-break-out-side').cmp.vsOcct.dVol)}.` });
row('holes(): every bore misses the part (apart larger than the plate)', 'refused', ['holes-all-outside', 'holes-two-outside'], { check: refusedBy('G-NOOP'), note: 'Unguarded: the unchanged plate with ok:true; brep-rs refuses "does not touch the part".' });
row("holes(): along 'x' or 'y' (also blind, with at, with recesses)", 'refused', ['holes-along-x', 'holes-along-y', 'holes-along-x-at', 'holes-along-x-blind', 'holes-cb-along-x'], { check: refusedBy('G-CORNERS'),
  note: 'ROUND 3 GUARD G-CORNERS. HoleFeature.corners documents four bores at +-apart/2 on the two axes the drill does NOT point along; the translator, occt-build.ts and brep-rs put the offsets on world x and y, so along x two bores coincide and the layer removed HALF the volume (holes-along-x unguarded 11748.71 against the closed form 11497.35). OCCT and truck agree with each other, brep-rs refuses, so no oracle supports building it; refused until a decision on the intended axes.' });
row('holes() with counterbore or countersink: four recesses, overlapping or not, through and blind', 'supported', ['holes-counterbore', 'holes-countersink', 'holes-cb-blind', 'holes-cs-blind', 'holes-cb-overlap', 'holes-cb-near-tangent'], { note: RECESS_NOTE });
row('holes() whose recess circles touch each other (12 across recess, 12 apart)', 'refused', ['holes-cb-touching'], { check: tangentGuard });
row('holes() without apart or without across', 'refused', ['holes-no-apart', 'holes-no-across']);
row('holes(): apart with the wrong length, text, or NaN', 'refused', ['apart-one', 'apart-three', 'apart-string', 'apart-nan'], { note: 'ROUND 4: interpreter text quoted verbatim (the NaN one says "a list of 2").' });

// ================================================================ hosts
row('hole on a pocket result: clear of the pocket, through the pocket floor, half in the pocket wall, two holes in sequence, through-with-bound deep', 'supported', ['pocket-hole-clear', 'pocket-hole-through-floor', 'pocket-hole-half-in-wall', 'pocket-through-hole-at-pocket-centre-deep-bound', 'pocket-then-two-holes']);
row('bore tangent to the wall of a pocket or of a notch (an interior face: G-TANGENT only looks at the part sides, sibling bores and earlier bores)', 'supported', ['tangent-pocket-wall-through', 'tangent-pocket-wall-blind', 'tangent-notch-wall'], {
  note: 'Where the oracles AGREE the tangent bore is built: the pocket-wall cases match OCCT, brep-rs and the closed form to 1.8e-6 (brep-rs builds them), the notch-wall case matches OCCT and the closed form (6.2e-6; brep-rs refuses). Face counts OCCT/truck 13/12, 13/12 and 10/9 are the merge key (see the per-type census in each id). This is the contrast with the part-side tangent rows above, where brep-rs refuses and OCCT\'s face count is 16 against truck\'s 10. Known gap: tangent contact with interior faces is not guarded in general.' });
row('hole on a pad: L-shaped pad with the bore in the leg (through and blind), circle pad, side and offset front planes', 'supported', ['pad-L-hole-in-leg', 'pad-L-blind', 'pad-circle-sketch', 'pad-side-plane', 'pad-front-plane-offset']);
row('hole on a rotated shape: box turned about z 30 (through and blind), box on its edge (x 90), moved box', 'supported', ['rot-box-z30', 'rot-box-z30-blind', 'rot-box-x90-hole-z', 'moved-box']);
row('hole through a box tilted 45 degrees about y or 30 degrees about x', 'supported', ['rot-box-y45-hole-z', 'tilt-x30-through'], {
  note: `Correct (OCCT dVol 4.2e-6 and 4.1e-6; brep-rs refuses both) but slow, because the slab is cut at an angle: truck CPU ${cl('rot-box-y45-hole-z')} for the 45-degree slab and ${cl('tilt-x30-through')} for the 30-degree one, inside the ${CPU_BUDGET_MS / 1000} s best-of-runs policy only just (the 45-degree slab\'s median is over it): a borderline row.` });
row('blind hole on a tilted shape (45 degrees about y, 30 about x, 20 about y)', 'refused', ['rot-box-y45-blind', 'tilt-x30-blind-8', 'tilt-y20-blind-3'], { check: refusedBy('G-TOP'),
  note: 'ROUND 3 GUARD G-TOP. Unguarded: the bore starts at the bbox top (in air at the bore), so the layer returned the unchanged slab (y45: V=12000 before and after) or a shallow dent (x30, deep 8: removed 54.9 against a 226 expected), with no sentence.' });
row('hole on a cylinder lying along y (turned 90 about x), bore along z', 'unsupported', ['rot-cylinder-x90-hole-z'], {
  check: (r) => (r.verdict === 'truck-built' && r.cpuBest > CPU_BUDGET_MS && r.cmp.vsOcct.dVol <= CURVED ? null : `expected correct-but-slow ${r.verdict} ${r.cpuBest}`), note: `CORRECT BUT TOO SLOW (truck CPU ${cl('rot-cylinder-x90-hole-z')}); matches OCCT and brep-rs (2.4e-5).` });
row('hole on a cone turned to lie along x (bore across the axis)', 'refused', ['rot-cone-turned-through'], { check: refusedBy('G-ENGINE'), note: 'ROUND 3 SENTENCE FIX: round 2 showed the student a raw truck dump ("the exact fallback ... takes planar faces only"); now G-ENGINE shows one sentence and keeps the raw text in the log. OCCT builds it (V=3110.33), brep-rs gives a sentence.' });
row('hole on a cross-bore through a cylinder (bore along x through a z cylinder) and a through bore in a box with all edges rounded r2 reaching the rims (37 across)', 'unsupported', ['cross-bore-through-cylinder', 'round-box-hole-37'], {
  check: (r) => (r.verdict === 'truck-built' && r.cpuBest > CPU_BUDGET_MS && r.cmp.vsOcct.dVol <= CURVED ? null : `expected slow-but-built, got ${r.verdict} ${r.cpuBest}`), note: `CORRECT BUT TOO SLOW (cross-bore through the cylinder: truck CPU ${cl('cross-bore-through-cylinder')}; 37 across in the rounded box: ${cl('round-box-hole-37')}); both match OCCT (2.6e-5, 3.8e-5).` });
row('hole on a round()ed box (all edges r2): 6 across through', 'supported', ['round-box-hole-through']);
row('hole on a subtract (cut) result: through, and bore centred on the cut wall', 'supported', ['cut-hole-through', 'cut-hole-into-cut-edge']);
row('hole on a join (union) result: blind, flat-topped (abutting boxes of equal height), blind on the high step of a stepped join, and through on its low step', 'supported', ['union-hole-blind', 'step-join-blind-high', 'step-join-through-low'], {
  note: `step-join-* is the stepped join the critic found: box 40x30x10 plus box 20x30x20 at x=30. Blind on the HIGH step (its top is the bbox top) and through on the low step are right. Face counts (OCCT/truck): ${['union-hole-blind', 'step-join-blind-high', 'step-join-through-low'].map((i) => `${i} ${g(i).cmp.vsOcct.faces}`).join(', ')}; the mismatch is planes only (the per-type census in each id): ${FACE_MERGE}` });
row('hole on a join result, blind, on the LOW step of a stepped part (the layer treats the extent as exact and starts the bore at the high step\'s top, in air)', 'refused', ['step-join-blind-low', 'step-join-blind-low-deep12', 'step-join-blind-on-seam'], { check: refusedBy('G-TOP'),
  note: 'ROUND 3 GUARD G-TOP. Unguarded (phase-0 translator): step-join-blind-low returns the UNCHANGED solid V=24000, ok:true (OCCT and truck both; brep-rs refuses "does not touch the part"); deep 12 on the low step cuts only 2 mm of a 12 mm hole (V=23974.87) with no sentence.' });
row('hole on a repeat() result: copies that touch (one fused block)', 'supported', ['pat-touching-hole'], { note: `Faces OCCT/truck ${g('pat-touching-hole').cmp.vsOcct.faces}: ${FACE_MERGE}` });
row('hole on a repeat() result whose copies do not touch (3 boxes 20 x 20 x 10, step 30)', 'refused', ['pat-disjoint-hole', 'pat-disjoint-hole-first-copy'], { check: refusedBy('G-BODIES'),
  note: 'ROUND 3 GUARD G-BODIES. Unguarded: the bore is cut into one copy but the layer reported only the body it named (V=4000, the UNDRILLED first copy, 6 faces, or 3874.36 for the first copy) where OCCT, brep-rs and the closed form give 11874.336; the engine held all 3 copies.' });
row('hole on a hollow() result (box 40 x 30 x 20, wall 2, open top): through the floor, and along x through both side walls', 'supported', ['hollow-open-top-hole', 'hollow-open-top-side-wall']);
row('blind hole from the top of a hollow() with the top open (over the cavity)', 'refused', ['hollow-open-top-blind'], { check: refusedBy('G-TOP') });
row('hole through a closed hollow() (no open side)', 'refused', ['closed-hollow-hole'], { check: (r) => (r.verdict === 'truck-refused' && r.truckFeatures.some((f) => f.kind === 'shell' && f.status === 'refused') ? refusedOk(r) : 'expected the hollow to be refused'),
  note: 'The hollow() itself is refused with its own sentence (the shell-draft group\'s: "a hollow with no open side is not supported yet ... add open:\'top\'"), and the hole that depends on it says so in one sentence. Round 2 showed the raw "solid.shell: invalid parameters ... faces must be a list".' });
row('hole on a revolve (spin) result: through (deep omitted)', 'refused', ['revolve-hole-wall'], { note: 'ROUND 4: interpreter text quoted verbatim (two sentences); applies along z, y and x alike (spin-tube-along-z-through).' });
row('hole on a revolve (spin) result: blind', 'refused', ['revolve-hole-wall-blind'], { check: refusedBy('G-TOP'), note: 'Round 2 called this supported. The tube\'s annular top is flat, but a revolve has no flat-topped-family proof (a sloped profile would pass the same probe), so G-TOP refuses it.' });
row('hole on a mirror() result when the hole targets the mirror (const m = mirror(a, ...); hole(m, ...)): through and blind across the seam', 'supported', ['mirror-hole-seam-var', 'mirror-hole-seam-var-blind'], { note: `Faces OCCT/truck ${g('mirror-hole-seam-var').cmp.vsOcct.faces} and ${g('mirror-hole-seam-var-blind').cmp.vsOcct.faces}: ${FACE_MERGE}` });
row('hole on the ORIGINAL name after a mirror (mirror(a, ...); hole(a, ...))', 'refused', ['mirror-hole-seam'], { check: (r) => (r.verdict === 'truck-refused' ? refusedOk(r) : `not refused ${r.verdict}`), note: 'The sentence names the dependency: box1 was already changed by mir1.' });

// ================================================================ successive / crossing / redundant
row('successive holes: second/third bore on the earlier hole result (stacked blind bores, overlapping bore, narrower bore continuing below an earlier blind bore, holes() then hole(), two holes in sequence)', 'supported', [
  'g:hole-simple__two-holes-sequential', 'bores-blind-stacked', 'bore-overlapping-second', 'bore-into-previous-bore-floor', 'holes-then-hole'], {
  note: 'Face counts: bore-overlapping-second OCCT 9 / truck 8 (cylinder 3 / 2: the two overlapping bore walls are one edge-connected patch in truck, key truck-merges-edge-connected-same-surface-faces; volume 5.6e-6). The other four match face for face.' });
row('second bore centred on the wall of an earlier blind bore (hole across 10 deep 10, then hole across 4 at [5,0], through or blind 15)', 'supported', ['bore-on-wall-of-blind', 'bore-on-wall-of-blind-blind', 'faces-notch-r0.5', 'faces-notch-r2-far'], {
  note: 'FACE COUNT EXPLAINED (the critic found OCCT 9 / truck 10 / brep-rs 11, faceVerdict false): per-surface census on the live OCCT shape (holes3-faces.mjs): 7 planes + cylinder r5 (u 0.403 to 5.880, a 314-degree OPEN patch, one face) + cylinder r2 (u 0 to 2 pi, a closed ring, one face). Truck keeps the closed ring as one face and splits the open >180-degree patch in two: planes 7/7, cylinders 2/3. The rule is harness key truck-splits-open-cylinder-patch-over-180deg (holes-base.mjs faceVerdict2, partial patches only; round 2\'s rule also counted the closed ring and so failed). Confirmed on a variant: a 0.5 across second bore (faces-notch-r0.5, the r5 wall left a 350-degree patch) gives the same 9/10, while the clear bore (faces-notch-r2-far) gives 9/9. Volume agrees to 3.3e-6 with 1 body and 1 shell; brep-rs\'s 11 splits both walls.' });
row('second bore WIDER than the first, centred on its wall (hole across 10 deep 10, then hole across 18 at [5,0])', 'unsupported', ['faces-notch-r9'], {
  check: (r) => (r.verdict === 'truck-built' && r.cmp.vsOcct.faceVerdict.ok === false && r.cmp.vsOcct.dVol <= CURVED ? null : 'expected built with unexplained faces'),
  note: 'FACES NOT EXPLAINED: volume agrees (OCCT 2.6e-5, brep-rs 2.6e-5) with 1 body and 1 shell, but OCCT has 9 faces and truck 12 (cylinders 2 vs 5) and the patch-splitting rule above does not account for it, so by the ground rule it is not claimed.' });
row('redundant hole: the same through hole twice, the same blind bore twice, a narrower shallower bore inside an earlier one', 'refused', ['hole-twice-identical', 'hole-twice-blind', 'hole-inside-earlier-bore'], { check: refusedBy('G-NOOP'),
  note: 'Unguarded: the second hole returns the solid unchanged with ok:true (OCCT and truck); brep-rs refuses "does not touch the part".' });
row('crossing bores in a prismatic host (z bore then an x bore that meets it: through/through, blind/through, blind/blind)', 'refused', ['cross-z-through-then-x-through', 'cross-z-blind-then-x-through', 'cross-both-blind'], { check: refusedBy('G-CROSS'),
  note: 'ROUND 3 GUARD G-CROSS (pre-check: finite-cylinder common-perpendicular test between the new bore and every earlier bore on another axis). With the guard off (controls below) the through/through crossing never finishes (no result in 200 s wall, process killed); the blind-then-through and blind/blind crossings do finish, correctly against OCCT (5.5e-6 and 2.1e-6) but at 22.5 s and 34 s of truck CPU (73 s for the whole translation of the second). The critic saw the blind-then-through one run past 200 s wall at load; so the guard is deliberately conservative: it also refuses the crossings that happen to finish, because the cost swings from 22 s to never. A control with bores that do not meet is supported (below).' });
row('perpendicular bores that do not meet (z bore at y=12, x bore at y=-12)', 'supported', ['cross-apart-no-touch']);


// ================================================================ attach the negative controls to the rows whose guard they switch off
function attach(prefix, text) {
  if (!text) return;
  const row = rows.find((x) => x.feature.startsWith(prefix));
  if (!row) { console.error(`attach: no row starts with "${prefix}"`); failures++; return; }
  row.evidence += ` ${text}`;
}
attach("across wider than the part's narrowest side", ctl('bodies', ['wider-than-plate-31', 'wide-box41']));
attach("bore tangent to the part's side", ctl('tangent', ['bore-tangent-to-edge', 'holes-tangent-to-wall', 'holes-tangent-to-each-other']));
attach('counterbore ring tangent', ctl('tangent', ['cb-ring-tangent-side', 'cb-wide-as-plate']));
attach('deep given where the thickness is unknown', ctl('top', ['blind-unknown-intersect-4', 'blind-wedge-turned']));
attach('at: position off the part', ctl('noop', ['at-off-the-part']));
attach('hole whose centre lies in empty space', ctl('noop', ['pad-L-hole-in-notch']));
attach('counterbore geometric degeneracy', ctl('recess', ['cb-deep-beyond-thickness-21', 'cb-deep-beyond-thickness-30', 'cb-blind-deep-equals-hole', 'cb-narrower-than-bore']));
attach('counterbore or countersink where the part is not flat', ctl('top', ['cb-pocket-floor-9x7', 'cb-pocket-floor-9x3', 'cs-pocket-floor-8x90', 'cb-step-join-low', 'cs-step-join-low', 'cb-open-hollow', 'cb-tilted-slab']));
attach('countersink cone deeper than', `${ctl('band', ['cs-blind-d6-D12-a90-b3', 'cs-blind-d6-D12-a90-b3.1', 'cs-blind-d6-D12-a90-b3.2', 'cs-blind-d6-D12-a120-b1.8', 'cs-blind-d10-D20-a90-b5.4', 'holes-cs-blind-band'])} ${ctl('bandvol', ['cs-blind-d6-D12-a90-b3', 'cs-blind-d6-D12-a90-b3.1', 'cs-blind-d6-D12-a90-b3.2', 'cs-blind-d6-D12-a90-b3.34', 'cs-blind-d6-D12-a120-b1.8', 'cs-blind-d10-D20-a90-b5.4', 'holes-cs-blind-band'])} (With only the band guard off, the closed-form post-check G-RECESS-VOL still refuses every one of the bad depths, so the two guards back each other up; with both off the part is built with a final volume off by only 7.4e-5 to 2.1e-4 of the part, under the 3e-4 curved bar, which is why a volume gate cannot see it.)`);
attach('blind hole on a tilted shape', ctl('top', ['rot-box-y45-blind', 'tilt-x30-blind-8', 'tilt-y20-blind-3']));
attach('hole on a join result, blind, on the LOW step', ctl('top', ['step-join-blind-low', 'step-join-blind-low-deep12']));
attach('blind hole from the top of a hollow', ctl('top', ['hollow-open-top-blind']));
attach('hole on a repeat() result whose copies do not touch', ctl('bodies', ['pat-disjoint-hole']));
attach("holes(): along 'x' or 'y'", ctl('corners', ['holes-along-x', 'holes-along-y', 'holes-along-x-blind']));
attach('redundant hole', ctl('noop', ['hole-twice-identical']));
attach('crossing bores', ctl('cross', ['cross-z-through-then-x-through', 'cross-z-blind-then-x-through', 'cross-both-blind']));
attach('deep omitted: through hole in a ring', ctl('torus', ['through-ring-offset-hits', 'through-ring-misses']));
attach('holes(): every bore misses', ctl('noop', ['holes-all-outside']));

// ================================================================ finish
const unused = [...R.keys()].filter((id) => !rows.some((r) => r.evidence.includes(`${id}: [`)));
if (unused.length) console.error(`cases not cited by any row (${unused.length}): ${unused.join(', ')}`);
// every refusal sentence is one plain sentence
for (const r of rows) if (r.status === 'refused') { const p = (await import('./holes4-translate.mjs')).lintSentence(r.refusalSentence); if (p.length) { console.error(`SENTENCE LINT "${r.feature.slice(0, 60)}": ${p.join(', ')} :: ${r.refusalSentence}`); failures++; } }
if (failures) { console.error(`${failures} row(s) failed their assertions: NOT writing ${OUTFILE}`); process.exit(1); }
writeFileSync(OUTFILE, JSON.stringify({ group: 'holes', rows }, null, 1));
console.log(`wrote ${OUTFILE}: ${rows.length} rows (${['supported', 'refused', 'unsupported', 'wrong'].map((s) => `${s} ${rows.filter((r) => r.status === s).length}`).join(', ')})`);
