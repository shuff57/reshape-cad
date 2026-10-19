// SPIKE, referee only. The holes contract translator, ROUND 4 (holes3-translate.mjs plus the round-4 guards listed at the end of this header): phase0/translate.mjs (unchanged, imported) with the hole planner replaced by
// a guarded one, so that a SolidCraft (truck) result is shown to a student only when it is provably what was asked, and otherwise ONE
// plain sentence is shown beside whatever did build.
//
// Why a wrapper and not an edit: phase0/translate.mjs is read-only for this group. Every feature except hole goes through phase0's
// planFeature() untouched (a closed hollow() gets the shell-draft sentence); hole is planned here.
//
// What each guard is for (every one is measured, with the unguarded truck number beside it, in holes3-*.json):
//   G-BODIES   a bore wider than the part, or a bore that leaves corner pieces, makes SEVERAL bodies; phase0 aggregates only the one it named, so
//              the layer reported a piece of the part with ok:true. Pre: the target must be one body. Post: the body count must not grow.
//   G-SHELLS   a bore exactly as wide as the part (tangent), and a blind bore that does not open onto a face (sealed cavity), both come back as ONE
//              body holding two shells (kernel.shells). Post: the shell count must not grow.
//   G-NOOP     a bore that touches no material (at: off the part, the bbox centre of an L in the notch, a stepped part's low step, a second identical
//              hole, a ring's empty centre) returns the unchanged solid with ok:true. Post: a hole must remove volume AND add a face.
//   G-TOP      a blind bore starts at the bounding-box top (the script layer treats the extent as exact). On a part that is not flat and level under
//              the bore (stepped join, tilted slab, a ring, a pocket floor, a lying cylinder, off-centre on a sphere) the tool starts in air and
//              the hole comes out shallower than asked, or not at all. Probe: a thin disc cut at the tool top on the part as it was BEFORE the first
//              hole in the chain must remove its own volume (material just below, none above).
//   G-CORNERS  holes() along x or y: the translator (like occt-build.ts and brep-rs) puts the corner offsets on world x and y, but HoleFeature.corners
//              documents "the two axes the drill does not point along". Two of the four bores land on top of each other and the layer removes half
//              the volume. Refused; the oracles disagree with the documentation, so there is no oracle to build it against.
//   G-RECESS   counterbore / countersink are mapped to solidcraft's native solid.hole (type counterbore|countersink). Native is exact on a flat level
//              top and wrong in four measured ways, each guarded: the countersink cone tool is a fixed 0.9*r-tipped cone that ignores the hole depth
//              (blind hole shallower than dcx = (R-0.9r)/tan(half) + margin: refused), a recess is measured from the face under the position (pocket
//              floor: G-TOP refuses), a counterbore deeper than the part silently becomes a wider bore (refused), and it needs the recess wider than the bore.
//              Where the host is a plain box and the recess ring lies inside it, the removed volume is also compared with the closed form (post-check).
//   G-ENGINE   any engine failure text is replaced by one sentence (the raw text is kept in `raw`).
// ROUND 4 (the critic's list, each guard measured in holes4-*.json):
//   G-BUDGET   EXECUTION BUDGET. ctx.runSC(cmds, {budgetS}) runs truck under a CPU-time limit (holes4-sc.mjs: a child process killed by SIGXCPU) and returns
//              {timedOut:true} when it runs out. One engine run may use BUDGET_S (45) CPU seconds plus 1.5x what replaying the already accepted commands cost, and
//              the whole translation DOC_BUDGET_S (180). A timed-out hole is refused with a sentence; nothing hangs. Everything below this line that is a PRE-check
//              exists so the student is told at once instead of after 45 s.
//   G-REVOLVE  a hole in a spun (revolve) shape, along ANY axis. Through-z and blind-z were already refused (script error / G-TOP) but along x the interpreter supplies
//              a depth and truck never finished (s-revolve-target).
//   G-CURVED   a bore whose axis is not the axis of the cylinder / cone / round pad it drills (a cross-bore, a bore into a cylinder lying on its side, across a cone):
//              curved-on-curved, 40 to 100+ s CPU or an engine failure.
//   G-CSOVERLAP countersink cones whose mouths overlap each other (one holes() call or sequential hole()s): the cone-cone cut never finishes.
//   G-CSEDGE   a countersink whose mouth reaches past a side of the part: the cone cuts through the side wall and the result's bounding box comes back outside the part.
//   G-TINY     across below MIN_ACROSS: the engine fails ("cannot attach a plane to a wire") or the sketch contact gap (1e-4) swallows the wall.
//   G-WIDE     across at least as wide as a cylinder host: nothing would be left.
//   G-RECESS-VOL (rewritten) the closed form is now an integral of the new tool minus the earlier tools (holes4-volume.mjs), so overlapping recesses of earlier holes no
//              longer make a correct part look wrong.
//   G-TOP       the thin-disc probe is replaced by a face-count probe when the disc is too small for the volume to resolve (holes narrower than about 0.1 mm).
//   G-BODIES    a target that is already several shells / pieces gets the 'multi' sentence (it used to say it "would leave 3 pieces where there is 1 now").
import { planFeature as basePlan } from '../phase0/translate.mjs';
import { SENTENCE as SHELL_SENTENCE } from './shell-draft-translate.mjs';
import { removedVolume, holeProfile } from './holes4-volume.mjs';
import { BUDGET_S, DOC_BUDGET_S } from './holes4-sc.mjs';

export const AXI = { x: 0, y: 1, z: 2 };
const AX = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const AXN = { x: 'X', y: 'Y', z: 'Z' };
const PI = Math.PI;
const fmt = (n) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(4)));
const refuse = (sentence, guard) => ({ refusal: sentence, guard });

/** margin (mm) added to the countersink cone tool's depth before a blind hole is accepted: set from holes3-cs-band.json */
export const CS_MARGIN = 0.05;
export const COVER_TOL = { planar: 1e-9, curved: 5e-4 }; // relative to the part volume: below this a cut counts as "nothing happened"
export const RECESS_TOL = 1e-3; // relative to the removed volume

// ---- plain sentences ---------------------------------------------------------------------------------------------------------------------
// ONE sentence each: what was asked, why it cannot be built, that the feature is shown without it, and (after a dash) what to try.
export const SENTENCE = {
  dep: (f, head) => `${f.id} (hole): the part it drills (${head}) could not be built, so ${f.id} is shown without it -- fix ${head} first.`,
  stale: (f, head, by) => `${f.id} (hole): ${head} was already changed by ${by} after the hole was set up, so ${f.id} is shown without it -- drill the part before changing it.`,
  noBody: (f) => `${f.id} (hole): the part it drills could not be found as a single piece, so ${f.id} is shown without it -- drill one shape at a time.`,
  multi: (f, n) => `${f.id} (hole): the part it drills is ${n} separate pieces and a hole cannot tell which one to drill, so ${f.id} is shown without it -- drill each piece before copying it, or join the pieces first.`,
  cornersAxis: (f) => `${f.id} (holes): four holes drilled along ${f.axis} are not supported yet, so ${f.id} is shown without it -- use holes() along z, or drill each hole with hole(shape, { along: '${f.axis}', at: [...] }).`,
  top: (f) => `${f.id} (hole): a hole that stops short of the other side starts on the top of the part, but the part is not flat and level under this spot, so ${f.id} is shown without it -- move the hole onto a flat top, or let it go all the way through.`,
  topRecess: (f, what) => `${f.id} (hole): a ${what} is cut from the top of the part, but the part is not flat and level under this spot, so ${f.id} is shown without it -- move the hole onto a flat top.`,
  noop: (f) => `${f.id} (hole): it does not touch the part, so it would cut nothing and ${f.id} is shown without it -- move the hole onto the part (check at:) or make it wider.`,
  split: (f, n0, n1) => `${f.id} (hole): it would leave ${n1} separate pieces where there ${n0 === 1 ? 'is 1 now' : `are ${n0} now`}, so ${f.id} is shown without it -- make the hole narrower than the part, or drill each separate piece before copying it.`,
  tangent: (f, what, other = 'edge') => `${f.id} (hole): its ${what} would touch ${other === 'edge' ? 'the edge of the part' : other === 'sibling' ? (what === 'recess' ? 'the recess of another hole in this holes() call' : 'another hole in this holes() call') : 'another hole'} along a line, which leaves a zero-thickness wall, so ${f.id} is shown without it -- move it a little or change its size.`,
  torus: (f) => `${f.id} (hole): drilling a ring (torus) is not supported yet, so ${f.id} is shown without it -- drill a box, cylinder or other flat-faced shape.`,
  shells: (f) => `${f.id} (hole): it would leave a sealed hollow inside the part, or pieces that touch only along a line, so ${f.id} is shown without it -- move it, make it narrower than the part, or let it go all the way through.`,
  cross: (f, h) => `${f.id} (hole): it crosses ${h.id}, a hole drilled in another direction, and crossing holes are not supported yet, so ${f.id} is shown without it -- drill the holes so they do not meet, or drill along one direction only.`,
  engine: (f) => `${f.id} (hole): this hole could not be cut cleanly into this part, so ${f.id} is shown without it -- try a smaller hole, a different place, or drill the plain shape before it is shaped.`,
  csBand: (f, need, have) => `${f.id} (hole): the countersink cone needs a hole at least ${fmt(need)} deep but this hole is ${fmt(have)} deep, so ${f.id} is shown without it -- drill deeper than ${fmt(need)} or make the countersink narrower.`,
  cbDeep: (f, cb, limit, what) => `${f.id} (hole): the counterbore is ${fmt(cb)} deep but the ${what} is only ${fmt(limit)}, so ${f.id} is shown without it -- make the counterbore shallower than the ${what}.`,
  recessNarrow: (f, what) => `${f.id} (hole): the ${what} has to be wider than the hole, so ${f.id} is shown without it -- make it wider than ${fmt(f.diameter)}.`,
  recessSide: (f, what) => `${f.id} (hole): ${f.id} cannot be drilled with a ${what} along ${f.axis} here, so ${f.id} is shown without it -- put the hole on a flat top.`,
  recessCavity: (f, what) => `${f.id} (hole): a ${what} has to start on a face of the part, and this hole starts inside it, so ${f.id} is shown without it -- give the hole a depth that ends at a face or leave the depth out.`,
  recessNest: (f, what, other) => `${f.id} (hole): a ${what} has to start on a face of the part, but this hole starts inside ${other}, so ${f.id} is shown without it -- move it onto the flat top of the part.`,
  csFlat: (f) => `${f.id} (hole): a countersink angle wider than ${CS_MAX_ANGLE} degrees makes a cone too flat to cut reliably, so ${f.id} is shown without it -- use ${CS_MAX_ANGLE} degrees or less (90 and 120 are usual).`,
  recessSmall: (f, what, why, fix) => `${f.id} (hole): a ${what} ${why} cannot be cut reliably, so ${f.id} is shown without it -- ${fix}.`,
  recessCheck: (f, what) => `${f.id} (hole): the ${what} did not come out the size that was asked, so ${f.id} is shown without it -- try a slightly different depth or width.`,
  // ---- round 4
  budget: (f) => `${f.id} (hole): cutting this hole took longer than ${BUDGET_S} seconds of computing, so it was stopped and ${f.id} is shown without it -- try a flat-sided part, a smaller hole, or drill the plain shape before it is turned or rounded.`,
  docBudget: (f) => `${f.id} (hole): this model has already used its ${DOC_BUDGET_S} seconds of computing, so ${f.id} is shown without it -- use fewer holes or simpler shapes.`,
  revolve: (f) => `${f.id} (hole): drilling a spun shape is not supported yet, so ${f.id} is shown without it -- leave a gap for the hole in the sketch that is spun instead.`,
  curved: (f, what) => `${f.id} (hole): a hole drilled across ${what} would cut through its curved wall at an angle, which is not supported yet, so ${f.id} is shown without it -- drill along the axis of ${what}, or use a flat-sided shape.`,
  csOverlap: (f, other) => `${f.id} (hole): its countersink cone would overlap ${other}, which is not supported yet, so ${f.id} is shown without it -- space the countersinks at least as far apart as their mouth is wide, or use counterbores.`,
  csEdge: (f) => `${f.id} (hole): the countersink mouth reaches past the side of the part, which is not supported yet, so ${f.id} is shown without it -- move the hole away from the side or make the countersink narrower than the part.`,
  tiny: (f) => `${f.id} (hole): a hole narrower than ${MIN_ACROSS} mm cannot be cut reliably, so ${f.id} is shown without it -- make it at least ${MIN_ACROSS} across.`,
  wide: (f, what) => `${f.id} (hole): the hole is as wide as ${what} it drills, so nothing would be left and ${f.id} is shown without it -- make the hole narrower than ${what}.`,
  engineCurved: (f) => `${f.id} (hole): this hole meets a curved surface where the cut cannot be done exactly, so ${f.id} is shown without it -- drill along the axis of the curved shape or use a flat-sided shape.`,
  engineWide: (f) => `${f.id} (hole): the hole is wider than the part, so nothing of it would be left and ${f.id} is shown without it -- make the hole narrower than the part.`,
};
/** every guard that can be switched off (H4_OFF / opts.off) */
export const ALL_GUARDS = ['G-BODIES', 'G-SHELLS', 'G-NOOP', 'G-TOP', 'G-CORNERS', 'G-CROSS', 'G-TORUS', 'G-TANGENT', 'G-RECESS', 'G-CSBAND', 'G-RECESS-VOL', 'G-BUDGET', 'G-REVOLVE', 'G-CURVED', 'G-WIDE', 'G-CSOVERLAP', 'G-CSEDGE', 'G-TINY', 'G-CSFLAT', 'G-NEST', 'G-RECESSMIN'];
/** the narrowest hole that cuts reliably (holes4-tiny sweep: 0.001 builds, 1e-4 fails with "cannot attach a plane to a wire") */
export const MIN_ACROSS = 0.001;
/** the flattest countersink cone that cuts with the right faces (holes4 sweep: 170 builds 8 faces, 175 and 178 and 179 build 9) */
export const CS_MAX_ANGLE = 170;
/** smallest recesses that cut right (holes4-recess-sweep.json: every value below was measured to build with the right faces, every smaller one measured wrong or refused by the engine) */
export const CB_MIN = { across: 0.2, depth: 0.005, ring: 0.005 }; // counterbore: diameter, depth, (recess - bore) / 2
export const CS_MIN = { bore: 0.7, ring: 0.04 }; // countersink: bore diameter, (mouth - bore) / 2
/** one plain reason for an engine failure text, or null */
export function engineSentence(f, raw) {
  const r = String(raw ?? '');
  if (/exact fallback|planar faces only|shallow angle/.test(r)) return SENTENCE.engineCurved(f);
  if (/no body named/.test(r)) return SENTENCE.engineWide(f);
  return null;
}

/** one sentence, no engine jargon, no emoji */
export function lintSentence(s) {
  const problems = [];
  const t = String(s);
  const parts = t.replace(/\b\d+\.\d+/g, 'N').replace(/\be\.g\./g, 'eg').split(/[.!?]["')\]]?\s+(?=[A-Za-z{])/).filter((x) => x.trim());
  if (parts.length > 1) problems.push(`${parts.length} sentences`);
  if (!/[.)'"]$/.test(t.trim())) problems.push('no full stop');
  if (/solidcraft|truck|brep|b_[a-z]|boolean|kernel|wasm|translator|phase 0|invalid parameters|\bok:|undefined/i.test(t)) problems.push('engine jargon');
  if (/[\u{1F300}-\u{1FAFF}]/u.test(t)) problems.push('emoji');
  return problems;
}

/**
 * Script-layer errors (runScript, packages/script, read-only) rewritten as one plain sentence. The raw text stays in the evidence.
 * Rewrites only where the raw text is wrong, ungrammatical, misleading or two sentences; every other script sentence passes through.
 */
export function plainScriptError(raw, script = '') {
  let m;
  const q = (s) => s.replace(/"/g, '"');
  // the option-name error is two sentences ("X has no option called "k". It takes a, b, c.")
  if ((m = raw.match(/^(\w+)\(?\)? has no option called "([^"]*)"\. It takes (.*)\.$/))) {
    return `${m[1]}() has no option called "${m[2]}" -- it takes ${m[3].replace(/, ([^,]*)$/, ' and $1')}.`;
  }
  // "hole's "along" has to be 'x', 'y' or 'z'. You gave it the text "w"." is two sentences
  if ((m = raw.match(/^(\w+)'s "along" has to be 'x', 'y' or 'z'\. You gave it (?:the text )?(.*)\.$/))) {
    return `${m[1]}()'s "along" has to be 'x', 'y' or 'z' -- you gave it ${m[2]}.`;
  }
  // describe() of a string is 'the text "M7"': "does not know the size the text "M7"" is ungrammatical
  if ((m = raw.match(/^(hole|holes)\(\) does not know the size (?:the text )?"(.*)"\. Sizes are (.*) \(clearance holes\), or give \{ across: <number> \}\.$/))) {
    return `${m[1]}() does not know the size "${m[2]}" -- the sizes are ${m[3]} (clearance holes), or give { across: <number> }.`;
  }
  if ((m = raw.match(/^(hole|holes)\(\) does not know the size (\S+)\. Sizes are (.*) \(clearance holes\), or give \{ across: <number> \}\.$/))) {
    return `${m[1]}() needs a size name in quotes such as 'M6', not the number ${m[2]} -- the sizes are ${m[3]}, or give { across: <number> }.`;
  }
  // a non-finite number in at / apart / across is described as 'a list of 2' by the script layer: say what is wrong
  if ((m = raw.match(/^(hole|holes) needs (at|apart) as \[u, v\], got a list of 2\.$/)) || (m = raw.match(/^(hole|holes)'s (at|apart) needs two numbers, like \[across, up\]\. You gave it a list of 2\.$/))) {
    return `${m[1]}() needs ${m[2]} to be two real numbers such as ${m[2] === 'at' ? '[10, -5]' : '[20, 10]'}, and one of them is not a number (NaN or Infinity).`;
  }
  if ((m = raw.match(/^(hole|holes)'s (at|apart) needs two numbers, like \[across, up\]\. You gave it (a list of \d+|.*)\.$/))) {
    return `${m[1]}() needs ${m[2]} to be exactly two numbers such as ${m[2] === 'at' ? '[10, -5]' : '[20, 10]'}, and you gave ${m[3]}.`;
  }
  if ((m = raw.match(/^(hole|holes)\(\) cannot find how thick this (\w+) is along (\w) yet, so it cannot drill all the way through\. Give it a depth: (.*)\.$/))) {
    return `${m[1]}() cannot tell how thick ${KIND_PHRASE(m[2])} is along ${m[3]}, so it cannot drill all the way through -- give it a depth such as ${m[4]}.`;
  }
  if ((m = raw.match(/^(hole|holes)\(\) cannot find where the top of this (\w+) is along (\w) exactly, so a hole that stops short of the other side cannot start at the top\. Make it go all the way through \(leave out deep:, or give a deep: at least ([\d.]+)\), or drill the shape before it is cut\.$/))) {
    return `${m[1]}() cannot tell exactly where the top of ${KIND_PHRASE(m[2])} is along ${m[3]}, so a hole that stops short of the other side cannot start there -- leave out deep:, give a deep: of at least ${m[4]}, or drill the shape before it is cut.`;
  }
  return raw;
}
function KIND_PHRASE(kind) {
  return ({ combine: 'this joined, cut or overlapped shape', pocket: 'this pocketed shape', revolve: 'this spun shape', prism: 'this prism', wedge: 'this wedge', pattern: 'this pattern of copies', mirror: 'this mirrored shape', extrude: 'this pulled shape', torus: 'this ring', cone: 'this cone' }[kind]) ?? `this ${kind}`;
}

// ---- helpers ---------------------------------------------------------------------------------------------------------------------------
export function aggregateOf(res, names) {
  const bs = res.measure.bodies.filter((b) => names.includes(b.name));
  if (!bs.length) return null;
  const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
  for (const b of bs) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], b.bbox.min[i]); hi[i] = Math.max(hi[i], b.bbox.max[i]); }
  const vol = bs.reduce((s, b) => s + b.volume_mm3, 0);
  return {
    volume: vol,
    faces: bs.reduce((s, b) => s + b.faces, 0),
    kernelFaces: bs.reduce((s, b) => s + b.kernel.faces, 0),
    shells: bs.reduce((s, b) => s + (b.kernel.shells ?? 1), 0),
    curved: bs.some((b) => Object.keys(b.face_types ?? {}).some((k) => k !== 'plane')),
    bbox: [...lo, ...hi],
    faceTypes: bs.reduce((a, b) => { for (const [k, v] of Object.entries(b.face_types ?? {})) a[k] = (a[k] ?? 0) + v; return a; }, {}),
    com: [0, 1, 2].map((i) => bs.reduce((a, b) => a + b.volume_mm3 * b.center_of_mass[i], 0) / vol),
    bodies: bs.map((b) => b.name),
  };
}

const cylV = (d, L) => PI * (d / 2) ** 2 * L;
export const cbRem = (d, R, cbd, bl) => cylV(d, bl) + cylV(R, cbd) - cylV(d, cbd);
export function csRem(d, D, a, bl) {
  const R = D / 2; const r = d / 2; const tn = Math.tan((a * PI) / 360); const dc = (R - r) / tn;
  if (dc <= bl) return PI * r * r * bl + (PI * dc / 3) * (R * R + R * r + r * r) - PI * r * r * dc;
  const rb = R - bl * tn;
  return (PI * bl / 3) * (R * R + R * rb + rb * rb);
}
/** depth of the cone tool solidcraft cuts for a countersink: it runs on down to radius 0.9*r whatever the hole depth (eval.rs HoleKind::Countersink) */
export const csToolDepth = (d, D, a) => (D / 2 - 0.9 * (d / 2)) / Math.tan((a * PI) / 360);
export const csConeDepth = (d, D, a) => (D / 2 - d / 2) / Math.tan((a * PI) / 360);

// ---- the translator --------------------------------------------------------------------------------------------------------------------
/**
 * ctx: { arc, mt, runSC(cmds)->parsed, resolveAt(prefix, name) }, opts: { guards: Set of guard names to switch OFF (negative controls), cpu: fn }
 * Returns { features: [{id, kind, status, refusal?, guard?, raw?, measure?, unguarded?, probe?}], commands }.
 */
export function translateDocGuarded(doc, ctx, opts = {}) {
  const off = new Set(opts.off ?? []);
  const st = { head: {}, bodies: {}, stale: {}, refused: {}, sketches: {}, measure: {}, counter: 0, chain: {}, allCount: 0, allShells: 0, spentS: 0, lastRunS: 0 };
  const byId = Object.fromEntries(doc.features.map((f) => [f.id, f]));
  // ---- G-BUDGET: every engine run goes through runB. One run may use BUDGET_S plus 1.5x what replaying the accepted commands cost; the whole translation DOC_BUDGET_S.
  const runB = (cmds, { replay = true } = {}) => {
    const budgetS = off.has('G-BUDGET') ? 1e9 : BUDGET_S + (replay ? 1.5 * st.lastRunS : 0);
    let res;
    try { res = ctx.runSC(cmds, { budgetS }); } catch (e) { res = { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; }
    st.spentS += (res?.cpuMs ?? 0) / 1000;
    if (res?.ok && res.cpuMs && replay) st.lastRunS = res.cpuMs / 1000;
    return res;
  };
  const accepted = []; const out = [];
  const headOf = (id) => { let h = id; const seen = new Set(); while (st.head[h] && !seen.has(h)) { seen.add(h); h = st.head[h]; } return h; };

  doc.features.forEach((f, idx) => {
    const prefix = doc.features.slice(0, idx);
    const fctx = { ...ctx, resolve: (name) => ctx.resolveAt(prefix, name), runSC: (c, o) => { const r = ctx.runSC(c, o); st.spentS += (r?.cpuMs ?? 0) / 1000; return r; } };
    const note = (o) => out.push({ id: f.id, kind: f.kind, ...o });
    if (f.kind === 'sketch') st.sketches[f.id] = f;
    let plan;
    try {
      plan = f.kind === 'hole' && !off.has('G-BUDGET') && st.spentS > DOC_BUDGET_S ? refuse(SENTENCE.docBudget(f), 'G-BUDGET')
        : f.kind === 'hole' ? planHole(f, st, { ...fctx, accepted, headOf, byId, off, runB })
        : f.kind === 'shell' && !f.open ? refuse(SHELL_SENTENCE.closed(f), 'G-CLOSED')
          : basePlan(f, st, fctx);
    } catch (e) { plan = refuse(`${f.id} (${f.kind}): this step could not be built, so ${f.id} is shown without it.`, 'translator-error'); plan.raw = String(e.message); }
    if (plan.refusal) { st.refused[f.id] = plan.refusal; return note({ status: 'refused', refusal: plan.refusal, guard: plan.guard, raw: plan.raw, probe: plan.probe, commands: [] }); }
    if (plan.noop) return note({ status: 'noop', commands: [] });
    let lastErr = null;
    for (const variant of plan.variants) {
      let res;
      res = runB([...accepted, ...variant]);
      if (res.timedOut && off.has('G-BUDGET')) { // negative control: no budget, the run was killed at the control limit (H4_CTL_S) so the control could end
        st.refused[f.id] = `CONTROL: no result within ${res.failed?.error} (a hang)`;
        return note({ status: 'refused', refusal: st.refused[f.id], guard: 'CONTROL-KILL', raw: res.failed?.error, cpuMs: res.cpuMs, commands: variant });
      }
      if (res.timedOut) {
        const sentence = f.kind === 'hole' ? SENTENCE.budget(f) : `${f.id} (${f.kind}): building this took longer than ${BUDGET_S} seconds of computing, so it was stopped and ${f.id} is shown without it.`;
        st.refused[f.id] = sentence;
        return note({ status: 'refused', refusal: sentence, guard: 'G-BUDGET', raw: `${res.failed?.error}`, cpuMs: res.cpuMs, commands: variant });
      }
      if (!res.ok) { lastErr = res.failed ? `${res.failed.command}: ${res.failed.error}` : String(res.error ?? 'unknown'); continue; }
      const m = aggregateOf(res, plan.produces);
      if (!m) { lastErr = `solidcraft ran the commands but no body named ${plan.produces.join(', ')} came back`; continue; }
      const allBodies = res.measure.bodies.map((b) => ({ name: b.name, volume: b.volume_mm3, shells: b.kernel.shells ?? 1 }));
      if (plan.post) {
        const before = st.measure[headOf(f.target)] ?? st.measure[f.target];
        const bad = plan.post(m, before, { allBodies, allCountBefore: st.allCount, accepted, variant, off });
        if (bad) {
          st.refused[f.id] = bad.refusal;
          return note({ status: 'refused', refusal: bad.refusal, guard: bad.guard, unguarded: { volume: m.volume, faces: m.faces, bbox: m.bbox, shells: m.shells, bodies: allBodies.length, allVolume: allBodies.reduce((a, b) => a + b.volume, 0) }, commands: variant });
        }
      }
      if (f.kind === 'hole') {
        const h = headOf(f.target);
        const prev = st.chain[h];
        st.chain[f.id] = prev ?? { baseIdx: plan.baseIdx, baseMeasure: st.measure[h] ?? st.measure[f.target] };
      }
      accepted.push(...variant);
      st.allCount = res.measure.bodies.length;
      st.bodies[f.id] = m.bodies; st.measure[f.id] = m;
      for (const c of plan.consumes) {
        if (c === f.id) continue;
        if (f.kind === 'hole' || f.kind === 'pocket' || f.kind === 'groove') { if (c === (f.kind === 'hole' ? f.target : f.into)) st.head[c] = f.id; } else st.stale[c] = f.id;
      }
      return note({ status: 'built', commands: variant, measure: m, pickedFrom: plan.pickedFrom, probe: plan.probe, variantsTried: plan.variants.indexOf(variant) + 1 });
    }
    const sentence = f.kind === 'hole' ? (engineSentence(f, lastErr) ?? SENTENCE.engine(f)) : `${f.id} (${f.kind}): this step could not be built cleanly, so ${f.id} is shown without it.`;
    st.refused[f.id] = sentence;
    note({ status: 'refused', refusal: sentence, raw: lastErr, guard: 'G-ENGINE', commands: plan.variants[0] });
  });
  return { features: out, commands: accepted, spentS: st.spentS };
}

const byIdOf = (G, id) => G.byId[id];
function planHole(f, st, G) {
  const { accepted, headOf, off, runB } = G;
  const runSC = (cmds) => runB(cmds, { replay: false });
  const head = headOf(f.target);
  if (st.refused[head]) return refuse(SENTENCE.dep(f, head), 'dependency');
  if (st.stale[head]) return refuse(SENTENCE.stale(f, head, st.stale[head]), 'dependency');
  const bs = st.bodies[head];
  const m = st.measure[head] ?? st.measure[f.target];
  if (!bs || !bs.length || !m) return refuse(SENTENCE.noBody(f), 'G-BODIES');
  if (!off.has('G-BODIES') && (bs.length !== 1 || st.allCount > 1)) return refuse(SENTENCE.multi(f, Math.max(bs.length, st.allCount)), 'G-BODIES');
  // ---- ROUND 4 pre-checks (each exists so the student is told at once instead of after BUDGET_S seconds; the budget is the backstop)
  if (!off.has('G-BODIES') && (m.shells ?? 1) > 1) return refuse(SENTENCE.multi(f, m.shells), 'G-BODIES'); // one body that is already several pieces (repeat() of copies that do not touch)
  if (!off.has('G-TINY') && !(f.diameter >= MIN_ACROSS - 1e-12)) return refuse(SENTENCE.tiny(f), 'G-TINY');
  const rootF = rootOf(f.target, G);
  if (!off.has('G-REVOLVE') && rootF?.kind === 'revolve') return refuse(SENTENCE.revolve(f), 'G-REVOLVE');
  const axis = f.axis ?? 'z'; const ai = AXI[axis]; const dir = AX[axis];
  if (rootF && !off.has('G-CURVED')) {
    const cv = curvedAxis(rootF, G);
    if (cv && Math.abs(Math.abs(cv.axis[ai]) - 1) > 1e-9) return refuse(SENTENCE.curved(f, cv.what), 'G-CURVED');
  }
  if (rootF?.kind === 'cylinder' && !off.has('G-WIDE')) {
    const cv = curvedAxis(rootF, G);
    if (cv && Math.abs(Math.abs(cv.axis[ai]) - 1) <= 1e-9) {
      const bc1 = [0, 1, 2].map((i) => (m.bbox[i] + m.bbox[i + 3]) / 2); const perp1 = [0, 1, 2].filter((k) => k !== ai);
      const c1 = [0, 1, 2].map((i) => bc1[i] + f.center[i]);
      const offs = f.corners ? [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => [sx * f.corners.dx, sy * f.corners.dy]) : [[0, 0]];
      for (const [ox, oy] of offs) {
        const pc = [c1[0] + ox, c1[1] + oy, c1[2]];
        if (Math.hypot(...perp1.map((k) => pc[k] - bc1[k])) + rootF.radius <= f.diameter / 2 + 1e-9) return refuse(SENTENCE.wide(f, 'the cylinder'), 'G-WIDE');
      }
    }
  }
  if (f.corners && axis !== 'z' && !off.has('G-CORNERS')) return refuse(SENTENCE.cornersAxis({ ...f, axis }), 'G-CORNERS');
  // ---- G-TORUS: a bore through a ring's tube is a curved-on-curved cut that does not finish (through-ring-offset-hits: no result in 300 s wall, 1 core busy)
  if (!off.has('G-TORUS')) {
    let root = G.byId[f.target]; const seenR = new Set();
    while (root && root.kind === 'hole' && !seenR.has(root.id)) { seenR.add(root.id); root = G.byId[root.target]; }
    if (root?.kind === 'torus') return refuse(SENTENCE.torus(f), 'G-TORUS');
  }
  // ---- G-TANGENT: a bore (or a recess ring) whose wall touches the part's side, or another bore, along a line leaves a zero-thickness wall: OCCT builds
  // 16 faces where truck builds 10 (holes-tangent-to-wall), brep-rs refuses ("a tangent contact brep-rs cannot cut yet"), and a one-sided check cannot tell which is right.
  if (!off.has('G-TANGENT')) {
    const bcT = [0, 1, 2].map((i) => (m.bbox[i] + m.bbox[i + 3]) / 2);
    const cT = [bcT[0] + f.center[0], bcT[1] + f.center[1], bcT[2] + f.center[2]];
    const cs4 = f.corners ? [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => [cT[0] + sx * f.corners.dx, cT[1] + sy * f.corners.dy, cT[2]]) : [cT];
    const aiT = AXI[axis]; const TOLT = 1e-6;
    const radii = [[f.diameter / 2, 'hole']]; if (f.counterbore) radii.push([f.counterbore.diameter / 2, 'recess']); if (f.countersink) radii.push([f.countersink.diameter / 2, 'recess']);
    for (const [R, what] of radii) {
      for (const c of cs4) for (const i of [0, 1, 2].filter((k) => k !== aiT)) {
        if (Math.abs(c[i] - R - m.bbox[i]) < TOLT || Math.abs(c[i] + R - m.bbox[i + 3]) < TOLT) return refuse(SENTENCE.tangent(f, what), 'G-TANGENT');
      }
      for (let a = 0; a < cs4.length; a++) for (let b = a + 1; b < cs4.length; b++) {
        const d = Math.hypot(...[0, 1, 2].filter((k) => k !== aiT).map((k) => cs4[a][k] - cs4[b][k]));
        if (d > TOLT && Math.abs(d - 2 * R) < TOLT) return refuse(SENTENCE.tangent(f, what, 'sibling'), 'G-TANGENT');
      }
    }
    // earlier bores along the same axis
    for (let cur = G.byId[f.target], seenT = new Set(); cur && cur.kind === 'hole' && !seenT.has(cur.id); cur = G.byId[cur.target]) {
      seenT.add(cur.id);
      if ((cur.axis ?? 'z') !== axis) continue;
      const cc = [bcT[0] + cur.center[0], bcT[1] + cur.center[1], bcT[2] + cur.center[2]];
      const others = cur.corners ? [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => [cc[0] + sx * cur.corners.dx, cc[1] + sy * cur.corners.dy, cc[2]]) : [cc];
      for (const o of others) for (const c of cs4) {
        const d = Math.hypot(...[0, 1, 2].filter((k) => k !== aiT).map((k) => o[k] - c[k]));
        const r1 = cur.diameter / 2; const r2 = f.diameter / 2;
        if (d > TOLT && (Math.abs(d - (r1 + r2)) < TOLT || Math.abs(d - Math.abs(r1 - r2)) < TOLT)) return refuse(SENTENCE.tangent(f, 'hole', 'earlier'), 'G-TANGENT');
      }
    }
  }

  // ---- G-CROSS: a bore that meets an earlier bore drilled along another axis is a curved-on-curved cut that does not finish (measured: a z bore
  // crossed by an x through bore 98 s; a blind z bore then an x bore past 200 s). Tools are finite cylinders; the test is the common-perpendicular one.
  if (!off.has('G-CROSS')) {
    const bc0 = [0, 1, 2].map((i) => (m.bbox[i] + m.bbox[i + 3]) / 2);
    const toolsOf = (h) => { const a = h.axis ?? 'z'; const c = [bc0[0] + h.center[0], bc0[1] + h.center[1], bc0[2] + h.center[2]];
      const cs = h.corners ? [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => [c[0] + sx * h.corners.dx, c[1] + sy * h.corners.dy, c[2]]) : [c];
      return cs.map((cc) => ({ a: AXI[a], c: cc, L: h.depth / 2, r: Math.max(h.diameter, h.counterbore?.diameter ?? 0, h.countersink?.diameter ?? 0) / 2 })); }; // a recess is wider than the bore: it can meet a bore the bore itself would miss
    const mine = toolsOf({ ...f, axis });
    for (let cur = byIdOf(G, f.target), seen = new Set(); cur && cur.kind === 'hole' && !seen.has(cur.id); cur = byIdOf(G, cur.target)) {
      seen.add(cur.id);
      if ((cur.axis ?? 'z') === axis) continue;
      for (const A of toolsOf(cur)) for (const B of mine) {
        const k = [0, 1, 2].find((i) => i !== A.a && i !== B.a);
        if (Math.abs(A.c[k] - B.c[k]) < A.r + B.r && Math.abs(B.c[A.a] - A.c[A.a]) <= A.L + B.r && Math.abs(A.c[B.a] - B.c[B.a]) <= B.L + A.r) return refuse(SENTENCE.cross(f, cur), 'G-CROSS');
      }
    }
  }
  const bc = [0, 1, 2].map((i) => (m.bbox[i] + m.bbox[i + 3]) / 2);
  const c0 = [bc[0] + f.center[0], bc[1] + f.center[1], bc[2] + f.center[2]];
  const centres = f.corners
    ? [[c0[0] - f.corners.dx, c0[1] - f.corners.dy, c0[2]], [c0[0] + f.corners.dx, c0[1] - f.corners.dy, c0[2]], [c0[0] - f.corners.dx, c0[1] + f.corners.dy, c0[2]], [c0[0] + f.corners.dx, c0[1] + f.corners.dy, c0[2]]]
    : [c0];
  const r = f.diameter / 2;
  const lo = m.bbox[ai]; const hi = m.bbox[ai + 3]; const T = hi - lo;
  const toolTop = c0[ai] + f.depth / 2; const toolBot = c0[ai] - f.depth / 2;
  const through = toolBot <= lo + 1e-9 && toolTop >= hi - 1e-9;
  const recess = f.counterbore ? 'counterbore' : f.countersink ? 'countersink' : null;
  const baseIdx = st.chain[head]?.baseIdx ?? accepted.length;
  const baseMeasure = st.chain[head]?.baseMeasure ?? m;
  const probeInfo = {};

  // ---- G-CSOVERLAP: native solid.hole cuts a countersink as a cone tool. Measured (holes4-raw-overlap.txt, 40 s budget): two countersinks whose mouths overlap 35 s CPU
  // and four never finish, a countersink over an earlier plain bore or counterbore (and a bore or counterbore over an earlier countersink) 37 to 40+ s, against 2.6 s for two
  // overlapping counterbores and 11 s for two countersinks that do not touch. So: whenever either tool has a countersink and the two footprints (mouth / recess / bore, whichever
  // is widest) overlap or touch, the hole is refused at once.
  if (!off.has('G-CSOVERLAP')) {
    const perpA = [0, 1, 2].filter((k) => k !== ai);
    const dist = (a, b) => Math.hypot(...perpA.map((k) => a[k] - b[k]));
    const footprint = (h) => Math.max(h.diameter, h.counterbore?.diameter ?? 0, h.countersink?.diameter ?? 0) / 2;
    const bcO = [0, 1, 2].map((i) => (m.bbox[i] + m.bbox[i + 3]) / 2);
    const centresOf = (h) => { const cc = [0, 1, 2].map((i) => bcO[i] + h.center[i]); return h.corners ? [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => [cc[0] + sx * h.corners.dx, cc[1] + sy * h.corners.dy, cc[2]]) : [cc]; };
    const mineC = centresOf(f); const rn = footprint(f);
    if (f.countersink) {
      for (let a = 0; a < mineC.length; a++) for (let b = a + 1; b < mineC.length; b++) if (dist(mineC[a], mineC[b]) < 2 * rn + 1e-6) return refuse(SENTENCE.csOverlap(f, 'the countersink of another hole in this holes() call'), 'G-CSOVERLAP');
    }
    for (let cur = G.byId[f.target], seenO = new Set(); cur && cur.kind === 'hole' && !seenO.has(cur.id); cur = G.byId[cur.target]) {
      seenO.add(cur.id);
      if ((cur.axis ?? 'z') !== axis) continue;
      if (!f.countersink && !cur.countersink) continue;
      const ro = footprint(cur);
      for (const o of centresOf(cur)) for (const c of mineC) if (dist(o, c) < rn + ro + 1e-6) return refuse(SENTENCE.csOverlap(f, `${cur.countersink ? 'the countersink' : 'the hole'} of ${cur.id}`), 'G-CSOVERLAP');
    }
  }
  // ---- G-CSEDGE: a countersink mouth that reaches past a side of the part (or past the wall of a cylinder host) cuts the cone through the side wall; the volume is right but the
  // result's bounding box comes back OUTSIDE the part (x max 40.0008 and 40.0004 on a 40 plate, x min -0.0165), and the layer centres later holes on that box.
  if (f.countersink && !off.has('G-CSEDGE')) {
    const R = f.countersink.diameter / 2; const cvE = rootF ? curvedAxis(rootF, G) : null;
    for (const c of centres) {
      for (const i of [0, 1, 2].filter((k) => k !== ai)) if (c[i] - R < m.bbox[i] + 1e-6 || c[i] + R > m.bbox[i + 3] - 1e-6) return refuse(SENTENCE.csEdge(f), 'G-CSEDGE');
      if (rootF?.kind === 'cylinder' && cvE && Math.abs(Math.abs(cvE.axis[ai]) - 1) <= 1e-9) {
        const pk = [0, 1, 2].filter((k) => k !== ai);
        if (Math.hypot(...pk.map((k) => c[k] - bc[k])) + R > rootF.radius - 1e-6) return refuse(SENTENCE.csEdge(f), 'G-CSEDGE');
      }
    }
  }

  // ---- G-TOP: a blind bore, or any recess, starts at a face: check there is a flat, level top under it
  //  planar part: cut a thin disc at the tool top on the part as it was before the first hole in the chain; the volume it removes is exact (1e-12), so it
  //               must be the disc itself (material just below, none above).
  //  curved part: truck's volume is tessellation-derived (a 0.09 mm3 disc is lost in 3 mm3 of noise on a cylinder), so the volume probe cannot be used.
  //               The chain must be a flat-topped family (cylinder or pulled sketch drilled along its own axis, a sphere's pole) and the disc must add
  //               exactly two faces per centre (wall + floor: material below, opening onto air above).
  if (!off.has('G-TOP') && (!through || recess)) {
    const top = recess ? hi : toolTop;
    const eps = Math.min(Math.max(r / 4, MIN_ACROSS / 2), r, 1); const delta = 0.05; // never below the engine's smallest reliable radius (a 1.25e-4 probe died with 'cannot attach a plane to a wire')
    const want = PI * eps * eps * delta;
    const probeCmds = centres.map((c) => ({ command: 'solid.cylinder', params: { radius: eps, height: delta + 1, base: c.map((v, i) => (i === ai ? top - delta : v)), axis: AXN[axis], operation: 'cut', targets: bs } }));
    let removed = null; let failed = null; let dFaces = null; let ok = false; let why = null; let res_timedOut = false;
    const curvedBase = baseMeasure.curved;
    let flat = { ok: true };
    // a disc this small is lost in the noise of the host's volume (a 0.001 across hole: 2.5e-9 mm3 on a 12000 mm3 plate, round 3 refused it as "not flat"): count faces instead
    const faceProbe = !curvedBase && want * centres.length < 1e-6 * baseMeasure.volume;
    if (curvedBase) flat = flatTopCurved(f, axis, G, centres, bc);
    try {
      const res = runSC([...accepted.slice(0, baseIdx), ...probeCmds]);
      if (res.timedOut) res_timedOut = true;
      if (!res.ok) failed = `${res.failed?.command}: ${res.failed?.error}`;
      else {
        const a = aggregateOf(res, bs);
        removed = baseMeasure.volume - a.volume; dFaces = a.faces - baseMeasure.faces;
        if (curvedBase) ok = flat.ok && dFaces === 2 * centres.length && a.shells === baseMeasure.shells;
        else if (faceProbe) { ok = dFaces === 2 * centres.length && a.shells === baseMeasure.shells; why = dFaces === 3 * centres.length ? 'buried' : 'air'; }
        else { const ratio = removed / (want * centres.length); ok = ratio >= 0.8 && ratio <= 1.2; why = ratio > 1.2 ? 'buried' : 'air'; }
      }
    } catch (e) { failed = String(e.message); }
    Object.assign(probeInfo, { top, eps, delta, curvedBase, faceProbe, wantEach: want, removed, ratio: removed === null ? null : removed / (want * centres.length), dFaces, flat: curvedBase ? flat : undefined, failed });
    if (!ok) {
      if (res_timedOut) return { ...refuse(SENTENCE.budget(f), 'G-BUDGET'), probe: probeInfo };
      const buried = (removed !== null && !curvedBase && !faceProbe && removed / (want * centres.length) > 1.2) || ((curvedBase || faceProbe) && dFaces === 3 * centres.length);
      const s = recess ? (buried ? SENTENCE.recessCavity(f, recess) : SENTENCE.topRecess(f, recess)) : SENTENCE.top(f);
      return { ...refuse(s, 'G-TOP'), probe: probeInfo };
    }
  }

  // ---- recess mapping -------------------------------------------------------------------------------------------------------------------
  if (recess) {
    // ---- G-CSFLAT: a cone flatter than CS_MAX_ANGLE comes back with a split cone face (9 faces where the oracle has 8; 175, 178, 179 degrees measured)
    if (f.countersink && !off.has('G-CSFLAT') && f.countersink.angleDeg > CS_MAX_ANGLE + 1e-9) return { ...refuse(SENTENCE.csFlat(f), 'G-CSFLAT'), probe: probeInfo };
    // ---- G-RECESSMIN: native solid.hole gets small recesses wrong: a counterbore across 0.04 on a 0.02 bore made the part GROW by 0.82 mm3, one 0.001 deep came back without its recess (7 faces
    // where 9 are right), a ring 0.0025 wide lost its floor; countersinks on bores under 0.7 or with a ring under 0.04 are refused by the engine or lose the cone. Thresholds are the smallest
    // values the sweep measured right.
    if (!off.has('G-RECESSMIN')) {
      const cbx = f.counterbore; const csx = f.countersink;
      if (cbx) {
        if (cbx.diameter < CB_MIN.across) return { ...refuse(SENTENCE.recessSmall(f, 'counterbore', `narrower than ${CB_MIN.across} mm`, `make it at least ${CB_MIN.across} across`), 'G-RECESSMIN'), probe: probeInfo };
        if (cbx.depth < CB_MIN.depth) return { ...refuse(SENTENCE.recessSmall(f, 'counterbore', `shallower than ${CB_MIN.depth} mm`, `make it at least ${CB_MIN.depth} deep`), 'G-RECESSMIN'), probe: probeInfo };
        if ((cbx.diameter - f.diameter) / 2 < CB_MIN.ring - 1e-12 && cbx.diameter > f.diameter) return { ...refuse(SENTENCE.recessSmall(f, 'counterbore', `less than ${CB_MIN.ring} mm wider than the hole on each side`, `make it at least ${+(f.diameter + 2 * CB_MIN.ring).toFixed(4)} across`), 'G-RECESSMIN'), probe: probeInfo };
      } else if (csx) {
        if (f.diameter < CS_MIN.bore) return { ...refuse(SENTENCE.recessSmall(f, 'countersink', `on a hole narrower than ${CS_MIN.bore} mm`, `make the hole at least ${CS_MIN.bore} across`), 'G-RECESSMIN'), probe: probeInfo };
        if ((csx.diameter - f.diameter) / 2 < CS_MIN.ring - 1e-12 && csx.diameter > f.diameter) return { ...refuse(SENTENCE.recessSmall(f, 'countersink', `less than ${CS_MIN.ring} mm wider than the hole on each side`, `make it at least ${+(f.diameter + 2 * CS_MIN.ring).toFixed(4)} across`), 'G-RECESSMIN'), probe: probeInfo };
      }
    }
    // ---- G-NEST: native solid.hole measures a recess from the face UNDER `position`. When the position lies inside an earlier hole's opening that face is the earlier hole's floor, not the
    // top of the part: a counterbore 8 across and 3 deep inside an earlier 12 across, 6 deep bore came back 113 mm3 off (truck 31032.47, exact 31145.49, 11 faces against 9), and G-TOP
    // cannot see it because it probes the part as it was before the first hole. Pre-check: the axis of a recess hole must not lie inside an earlier hole on the same axis that reaches the top.
    if (!off.has('G-NEST')) {
      const perpN = [0, 1, 2].filter((k) => k !== ai);
      for (let cur = G.byId[f.target], seenN = new Set(); cur && cur.kind === 'hole' && !seenN.has(cur.id); cur = G.byId[cur.target]) {
        seenN.add(cur.id);
        if ((cur.axis ?? 'z') !== axis) continue;
        const cc = [0, 1, 2].map((i) => bc[i] + cur.center[i]);
        if (cc[ai] + cur.depth / 2 < hi - 1e-9) continue; // that tool does not reach the top
        const rTop = Math.max(cur.diameter, cur.counterbore?.diameter ?? 0, cur.countersink?.diameter ?? 0) / 2;
        const os = cur.corners ? [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => [cc[0] + sx * cur.corners.dx, cc[1] + sy * cur.corners.dy, cc[2]]) : [cc];
        for (const o of os) for (const c of centres) if (Math.hypot(...perpN.map((k) => c[k] - o[k])) < rTop - 1e-9) return { ...refuse(SENTENCE.recessNest(f, recess, `the hole of ${cur.id}`), 'G-NEST'), probe: probeInfo };
      }
    }
    if (!through && Math.abs(toolTop - hi) > 1e-9) return { ...refuse(SENTENCE.recessCavity(f, recess), 'G-RECESS'), probe: probeInfo };
    const cb = f.counterbore; const cs = f.countersink;
    const D = (cb ?? cs).diameter;
    if (!off.has('G-RECESS') && !(D > f.diameter + 1e-12)) return { ...refuse(SENTENCE.recessNarrow(f, cb ? 'counterbore' : 'countersink'), 'G-RECESS'), probe: probeInfo };
    const holeDepth = through ? T : f.depth;
    if (!off.has('G-RECESS') && cb && !(through ? cb.depth <= T + 1e-9 : cb.depth < holeDepth - 1e-9)) {
      return { ...refuse(SENTENCE.cbDeep(f, cb.depth, holeDepth, through ? 'part' : 'hole'), 'G-RECESS'), probe: probeInfo };
    }
    if (!off.has('G-RECESS') && cb && cb.depth <= 0) return { ...refuse(SENTENCE.cbDeep(f, cb.depth, holeDepth, 'hole'), 'G-RECESS'), probe: probeInfo };
    let need = null;
    if (cs && !through) {
      need = csToolDepth(f.diameter, cs.diameter, cs.angleDeg) + CS_MARGIN;
      if (!off.has('G-CSBAND') && holeDepth < need) return { ...refuse(SENTENCE.csBand(f, need, holeDepth), 'G-CSBAND'), probe: { ...probeInfo, need } };
    }
    const cmds = centres.map((c) => {
      const params = { position: c.map((v, i) => (i === ai ? hi : v)), diameter: f.diameter, body: bs[0] };
      if (!through) params.depth = holeDepth;
      if (cb) Object.assign(params, { type: 'counterbore', cb_diameter: cb.diameter, cb_depth: cb.depth });
      else Object.assign(params, { type: 'countersink', cs_diameter: cs.diameter, cs_angle: `${cs.angleDeg} deg` });
      return { command: 'solid.hole', params };
    });
    // closed-form post-check (ROUND 4: integrated, see holes4-volume.mjs): the removed volume of THIS hole is  area((new tools clipped to the box) minus (earlier tools))  integrated
    // along the axis, for a plain box host. Round 3 compared with the formula for one ring on an intact box, which is false when an earlier hole's recess overlaps this one's, and
    // refused a correct part with a false reason (two counterbores 10 apart, recess 12 across: truck 11172.50, brep-rs 11172.50, the lens integral 11172.5).
    const isBox = baseMeasure.faces === 6 && !baseMeasure.curved && Math.abs(baseMeasure.volume - (baseMeasure.bbox[3] - baseMeasure.bbox[0]) * (baseMeasure.bbox[4] - baseMeasure.bbox[1]) * (baseMeasure.bbox[5] - baseMeasure.bbox[2])) <= 1e-9 * baseMeasure.volume;
    let expected = null;
    if (isBox) {
      const [p0, p1] = [0, 1, 2].filter((k) => k !== ai);
      const bb = baseMeasure.bbox;
      const bcB = [0, 1, 2].map((i) => (bb[i] + bb[i + 3]) / 2);
      const toolsOf = (h, cs) => cs.map((c) => ({ cx: c[p0], cy: c[p1], prof: holeProfile(h, bb[ai + 3], bb[ai], c[ai]) }));
      const centresOfH = (h) => { const cc = [0, 1, 2].map((i) => bcB[i] + h.center[i]); return h.corners ? [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => [cc[0] + sx * h.corners.dx, cc[1] + sy * h.corners.dy, cc[2]]) : [cc]; };
      const olds = [];
      for (let cur = G.byId[f.target], seenV = new Set(); cur && cur.kind === 'hole' && !seenV.has(cur.id); cur = G.byId[cur.target]) {
        seenV.add(cur.id);
        if ((cur.axis ?? 'z') === axis) olds.push(...toolsOf(cur, centresOfH(cur)));
      }
      expected = removedVolume(toolsOf(f, centres), olds, [bb[p0], bb[p0 + 3], bb[p1], bb[p1 + 3], bb[ai], bb[ai + 3]]);
    }
    return {
      variants: [cmds], produces: bs, consumes: [f.target], baseIdx, probe: { ...probeInfo, need, expected },
      post: (after, before, env) => commonPost(f, after, before, env, { expected, recess }),
    };
  }

  // ---- plain bore ----------------------------------------------------------------------------------------------------------------------
  const cmds = centres.map((c) => ({
    command: 'solid.cylinder',
    params: { radius: r, height: f.depth, base: c.map((v, i) => v - dir[i] * f.depth / 2), axis: AXN[axis], operation: 'cut', targets: bs },
  }));
  return { variants: [cmds], produces: bs, consumes: [f.target], baseIdx, probe: probeInfo, post: (after, before, env) => commonPost(f, after, before, env, {}) };
}


/** curved parts only: is the part under the hole a flat-topped family, drilled along its own axis? Walks f.target back through earlier holes to the root primitive. */
function flatTopCurved(f, axis, G, centres, bc) {
  let cur = G.byId[f.target]; const seen = new Set();
  while (cur && cur.kind === 'hole' && !seen.has(cur.id)) { seen.add(cur.id); cur = G.byId[cur.target]; }
  if (!cur) return { ok: false, why: 'no root found' };
  const ai = AXI[axis];
  const rotate = (v, rot) => { // the translator's order: x, then y, then z, about the origin
    let [x, y, z] = v; const [rx, ry, rz] = (rot ?? [0, 0, 0]).map((d) => (d * PI) / 180);
    [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
    [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
    [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
    return [x, y, z];
  };
  if (cur.kind === 'cylinder') {
    const d = rotate([0, 0, 1], cur.rotate);
    return { ok: Math.abs(Math.abs(d[ai]) - 1) < 1e-9, root: 'cylinder', why: 'cylinder axis ' + d.map((v) => +v.toFixed(3)) };
  }
  if (cur.kind === 'extrude') {
    if (cur.taper || cur.direction || cur.midplane || cur.alongNormal) return { ok: false, root: 'extrude', why: 'tapered or slanted pull' };
    const sk = G.byId[cur.target]; if (!sk) return { ok: false, root: 'extrude', why: 'no sketch' };
    const n = sk.frame ? (() => { const u = sk.frame.u; const v = sk.frame.v; return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; })() : { xy: [0, 0, 1], xz: [0, -1, 0], yz: [1, 0, 0] }[sk.plane ?? 'xy'];
    return { ok: Math.abs(Math.abs(n[ai]) - 1) < 1e-9, root: 'extrude', why: 'pull normal ' + n };
  }
  if (cur.kind === 'sphere') {
    const perp = [0, 1, 2].filter((i) => i !== ai);
    return { ok: centres.length === 1 && perp.every((i) => Math.abs(centres[0][i] - bc[i]) < 1e-9), root: 'sphere', why: 'sphere pole only' };
  }
  return { ok: false, root: cur.kind, why: `a ${cur.kind} has no flat top` };
}

/** G-BODIES (post), G-SHELLS, G-NOOP, recess closed form */
function commonPost(f, after, before, env, { expected, recess }) {
  const off = env.off;
  if (!off.has('G-BODIES') && env.allBodies.length > env.allCountBefore) return { guard: 'G-BODIES', refusal: SENTENCE.split(f, env.allCountBefore, env.allBodies.length) };
  if (!before) return null;
  if (!off.has('G-SHELLS') && after.shells > before.shells) return { guard: 'G-SHELLS', refusal: SENTENCE.shells(f) };
  const curved = after.curved || before.curved;
  const dV = before.volume - after.volume;
  const tol = (curved ? COVER_TOL.curved : COVER_TOL.planar) * before.volume;
  if (!off.has('G-NOOP') && Math.abs(dV) <= tol && !(after.faces > before.faces)) return { guard: 'G-NOOP', refusal: SENTENCE.noop(f) };
  if (!off.has('G-NOOP') && !(after.faces > before.faces) && dV <= tol) return { guard: 'G-NOOP', refusal: SENTENCE.noop(f) };
  if (expected != null && expected > 1e-9 && !off.has('G-RECESS-VOL') && Math.abs(dV - expected) > RECESS_TOL * expected) return { guard: 'G-RECESS-VOL', refusal: SENTENCE.recessCheck(f, recess) };
  return null;
}


// ---- ROUND 4 helpers -----------------------------------------------------------------------------------------------------------------------
/** the first feature that is not a hole, walking back from `id` through hole targets */
function rootOf(id, G) {
  let cur = G.byId[id]; const seen = new Set();
  while (cur && cur.kind === 'hole' && !seen.has(cur.id)) { seen.add(cur.id); cur = G.byId[cur.target]; }
  return cur ?? null;
}
const rot3 = (v, rot) => { // the translator's order: x, then y, then z, about the origin
  let [x, y, z] = v; const [rx, ry, rz] = (rot ?? [0, 0, 0]).map((d) => (d * PI) / 180);
  [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
  [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
  [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
  return [x, y, z];
};
/** a root whose side wall is curved: { what, axis (unit vector of its axis; [0,0,0] when it has none that a bore could follow), radius? } or null */
export function curvedAxis(root, G) {
  if (root.kind === 'cylinder') return { what: 'the cylinder', axis: rot3([0, 0, 1], root.rotate), radius: root.radius };
  if (root.kind === 'cone') return { what: 'the cone', axis: rot3([0, 0, 1], root.rotate) };
  if (root.kind === 'extrude') {
    const sk = G.byId[root.target];
    const curved = sk && (sk.shape === 'circle' || Object.keys(sk.bulges ?? {}).length > 0 || Object.keys(sk.rounds ?? {}).length > 0);
    if (!curved) return null;
    if (root.taper || root.direction || root.alongNormal) return { what: 'the round pad', axis: [0, 0, 0] };
    const n = sk.frame ? (() => { const u = sk.frame.u; const v = sk.frame.v; return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; })() : { xy: [0, 0, 1], xz: [0, -1, 0], yz: [1, 0, 0] }[sk.plane ?? 'xy'];
    return { what: 'the round pad', axis: root.rotate ? rot3(n, root.rotate) : n };
  }
  return null;
}
