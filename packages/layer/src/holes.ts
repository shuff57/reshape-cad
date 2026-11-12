// TypeScript port of the holes group's translator: docs/spikes/solidcraft-referee/contract/holes4-translate.mjs (ROUND 4, the final round) with
// holes4-volume.mjs (see holes-volume.ts). Behaviour-preserving: same guards, same thresholds, same sentences, same command lists.
//
// THE ORIGINAL IS NOT A COPY OF THE PHASE 4 TRANSLATOR. Its header says so: it is phase0/translate.mjs (unchanged, imported) with the hole planner
// replaced by a guarded one. The layer's base is the phase 4 translator (translate.ts). The 'holes' set is therefore
//     base (phase 4) planners for every kind except hole  +  the group's guarded hole planner  +  the group's own loop semantics,
// and it is equal to the original only where phase0 and phase 4 plan every non-hole feature identically. NOTES.md lists, kind by kind, where they do not.
// The group's loop semantics (the translateDocGuarded forEach body) are what the 'holes' Profile carries as its own step: an engine run under a CPU
// budget, the post-checks of a plan, the note fields (guard, raw, probe, unguarded), and the one-sentence wording for an engine failure of ANY kind.
//
// No kernel is named: everything that touches an engine comes in through the context object (ctx.runSC with an optional { budgetS }).
// Non-null assertions (!) stand for fields the feature's kind guarantees on a well-formed doc; the original reads them unguarded, so a malformed doc
// throws the same TypeError, which the step turns into the 'translator-error' refusal (the raw message goes to `raw`).
import type { Feature } from '@shuff57/reshape-script/model-types';
import type { Cmd, RunResult, V3 } from './types.js';
import { BASE_PROFILE, planFeature, resolveNamesFor, membersOf } from './translate.js';
import type { Aggregate, FeatureResult, LoopEnv, Plan, PlanCtx, Profile, TranslateState } from './translate.js';
import { removedVolume, holeProfile } from './holes-volume.js';
import { SKETCH_VOLUME_GUARD, sketchVolumeRefusal } from './sketch-volume.js';
import { POCKET_CUT_GUARD, pocketCutRefusal, rememberRun } from './pocket-cut.js';
import { hollowRefusal } from './hollow-check.js';
import { motionRefusal, motionRepair } from './move-turn.js';
import { beforeOf, blendOf, blendRefusal } from './fillet-chain.js';
import { ERRORED_BODY_GUARD, erroredBodySentence } from './errored-body.js';
import type { VolTool } from './holes-volume.js';

/** the fields of a hole feature the guards read (loose on purpose: a malformed doc fails the same way) */
export interface HoleView {
  id: string;
  kind: string;
  target: string;
  diameter: number;
  depth: number;
  center: V3;
  axis?: string;
  corners?: { dx: number; dy: number } | null;
  counterbore?: { diameter: number; depth: number } | null;
  countersink?: { diameter: number; angleDeg: number } | null;
}
/** the fields of any earlier feature the guards read while walking back from a hole to the part it drills */
export interface RootView extends Partial<HoleView> {
  id: string;
  kind: string;
  target?: string;
  radius?: number;
  rotate?: V3;
  taper?: number;
  direction?: unknown;
  midplane?: boolean;
  alongNormal?: boolean;
  shape?: string;
  bulges?: Record<string, number>;
  rounds?: Record<string, number>;
  plane?: string;
  frame?: { origin: V3; u: V3; v: V3 };
  open?: unknown;
}

export const AXI: Record<string, number> = { x: 0, y: 1, z: 2 };
const AX: Record<string, V3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const AXN: Record<string, string> = { x: 'X', y: 'Y', z: 'Z' };
const PI = Math.PI;
/** a RootView known to be a hole (its kind was just checked) */
const H = (x: RootView): HoleView => x as unknown as HoleView;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(4)));

/** One engine run may use this many CPU seconds (G-BUDGET); the original reads H4_BUDGET_S / H4_DOC_BUDGET_S from the environment, a measuring switch that is not ported. */
export const BUDGET_S = 45;
/** The whole translation of one document may use this many (every replay and every guard probe). */
export const DOC_BUDGET_S = 180;
/** The G-BUDGET sentence for a step that is not a hole (the holes loop's, and since the 0.30.1 pin the hollow's in the shell-draft step). Text unchanged; it only has a name now. */
export const budgetSentenceOther = (id: string, kind: string): string => `${id} (${kind}): building this took longer than ${BUDGET_S} seconds of computing, so it was stopped and ${id} is shown without it.`;

/** A refusal with the guard that made it; the group's planners add raw / probe. */
export interface GuardRefusal { refusal: string; guard?: string; raw?: string; probe?: unknown }
const refuse = (sentence: string, guard?: string): GuardRefusal => ({ refusal: sentence, guard });

/** margin (mm) added to the countersink cone tool's depth before a blind hole is accepted: set from holes3-cs-band.json */
export const CS_MARGIN = 0.05;
export const COVER_TOL = { planar: 1e-9, curved: 5e-4 }; // relative to the part volume: below this a cut counts as "nothing happened"
export const RECESS_TOL = 1e-3; // relative to the removed volume

// ---- plain sentences ---------------------------------------------------------------------------------------------------------------------------
// ONE sentence each: what was asked, why it cannot be built, that the feature is shown without it, and (after a dash) what to try.
export const SENTENCE = {
  dep: (f: HoleView, head: string) => `${f.id} (hole): it comes after ${head}, which could not be built, so ${f.id} is shown without it -- fix ${head} first.`,
  stale: (f: HoleView, head: string, by: string) => `${f.id} (hole): ${head} was already changed by ${by} after the hole was set up, so ${f.id} is shown without it -- drill the part before changing it.`,
  noBody: (f: HoleView) => `${f.id} (hole): the part it drills could not be found as a single piece, so ${f.id} is shown without it -- drill one shape at a time.`,
  multi: (f: HoleView, n: number) => `${f.id} (hole): the part it drills is ${n} separate pieces and a hole cannot tell which one to drill, so ${f.id} is shown without it -- drill each piece before copying it, or join the pieces first.`,
  cornersAxis: (f: HoleView) => `${f.id} (holes): four holes drilled along ${f.axis} are not supported yet, so ${f.id} is shown without it -- use holes() along z, or drill each hole with hole(shape, { along: '${f.axis}', at: [...] }).`,
  top: (f: HoleView) => `${f.id} (hole): a hole that stops short of the other side starts on the top of the part, but the part is not flat and level under this spot, so ${f.id} is shown without it -- move the hole onto a flat top, or let it go all the way through.`,
  topRecess: (f: HoleView, what: string) => `${f.id} (hole): a ${what} is cut from the top of the part, but the part is not flat and level under this spot, so ${f.id} is shown without it -- move the hole onto a flat top.`,
  noop: (f: HoleView) => `${f.id} (hole): it does not touch the part, so it would cut nothing and ${f.id} is shown without it -- move the hole onto the part (check at:) or make it wider.`,
  split: (f: HoleView, n0: number, n1: number) => `${f.id} (hole): it would leave ${n1} separate pieces where there ${n0 === 1 ? 'is 1 now' : `are ${n0} now`}, so ${f.id} is shown without it -- make the hole narrower than the part, or drill each separate piece before copying it.`,
  tangent: (f: HoleView, what: string, other: string = 'edge') => `${f.id} (hole): its ${what} would touch ${other === 'edge' ? 'the edge of the part' : other === 'sibling' ? (what === 'recess' ? 'the recess of another hole in this holes() call' : 'another hole in this holes() call') : 'another hole'} along a line, which leaves a zero-thickness wall, so ${f.id} is shown without it -- move it a little or change its size.`,
  torus: (f: HoleView) => `${f.id} (hole): drilling a ring (torus) is not supported yet, so ${f.id} is shown without it -- drill a box, cylinder or other flat-faced shape.`,
  shells: (f: HoleView) => `${f.id} (hole): it would leave a sealed hollow inside the part, or pieces that touch only along a line, so ${f.id} is shown without it -- move it, make it narrower than the part, or let it go all the way through.`,
  cross: (f: HoleView, h: { id: string }) => `${f.id} (hole): it crosses ${h.id}, a hole drilled in another direction, and crossing holes are not supported yet, so ${f.id} is shown without it -- drill the holes so they do not meet, or drill along one direction only.`,
  // G-OTHERS (owner-approved text, 2026-11-12): the cut would also change another part
  others: (f: HoleView, part: string) => `${f.id} (hole): cutting it would also cut ${part}, which is in the way of this hole, so ${f.id} is shown without it -- drill this hole before you make ${part}.`,
  engine: (f: HoleView) => `${f.id} (hole): this hole could not be cut cleanly into this part, so ${f.id} is shown without it -- try a smaller hole, a different place, or drill the plain shape before it is shaped.`,
  csBand: (f: HoleView, need: number, have: number) => `${f.id} (hole): the countersink cone needs a hole at least ${fmt(need)} deep but this hole is ${fmt(have)} deep, so ${f.id} is shown without it -- drill deeper than ${fmt(need)} or make the countersink narrower.`,
  cbDeep: (f: HoleView, cb: number, limit: number, what: string) => `${f.id} (hole): the counterbore is ${fmt(cb)} deep but the ${what} is only ${fmt(limit)}, so ${f.id} is shown without it -- make the counterbore shallower than the ${what}.`,
  recessNarrow: (f: HoleView, what: string) => `${f.id} (hole): the ${what} has to be wider than the hole, so ${f.id} is shown without it -- make it wider than ${fmt(f.diameter)}.`,
  recessSide: (f: HoleView, what: string) => `${f.id} (hole): ${f.id} cannot be drilled with a ${what} along ${f.axis} here, so ${f.id} is shown without it -- put the hole on a flat top.`,
  recessCavity: (f: HoleView, what: string) => `${f.id} (hole): a ${what} has to start on a face of the part, and this hole starts inside it, so ${f.id} is shown without it -- give the hole a depth that ends at a face or leave the depth out.`,
  recessNest: (f: HoleView, what: string, other: string) => `${f.id} (hole): a ${what} has to start on a face of the part, but this hole starts inside ${other}, so ${f.id} is shown without it -- move it onto the flat top of the part.`,
  csFlat: (f: HoleView) => `${f.id} (hole): a countersink angle wider than ${CS_MAX_ANGLE} degrees makes a cone too flat to cut reliably, so ${f.id} is shown without it -- use ${CS_MAX_ANGLE} degrees or less (90 and 120 are usual).`,
  recessSmall: (f: HoleView, what: string, why: string, fix: string) => `${f.id} (hole): a ${what} ${why} cannot be cut reliably, so ${f.id} is shown without it -- ${fix}.`,
  recessCheck: (f: HoleView, what: string) => `${f.id} (hole): the ${what} did not come out the size that was asked, so ${f.id} is shown without it -- try a slightly different depth or width.`,
  // ---- round 4
  budget: (f: HoleView) => `${f.id} (hole): cutting this hole took longer than ${BUDGET_S} seconds of computing, so it was stopped and ${f.id} is shown without it -- try a flat-sided part, a smaller hole, or drill the plain shape before it is turned or rounded.`,
  docBudget: (f: HoleView) => `${f.id} (hole): this model has already used its ${DOC_BUDGET_S} seconds of computing, so ${f.id} is shown without it -- use fewer holes or simpler shapes.`,
  revolve: (f: HoleView) => `${f.id} (hole): drilling a spun shape is not supported yet, so ${f.id} is shown without it -- for a hole down the middle, leave a gap in the sketch that is spun; for other holes, build the part from cylinders instead.`,
  curved: (f: HoleView, what: string) => `${f.id} (hole): a hole drilled across ${what} would cut through its curved wall at an angle, which is not supported yet, so ${f.id} is shown without it -- drill along the axis of ${what}, or use a flat-sided shape.`,
  csOverlap: (f: HoleView, other: string) => `${f.id} (hole): its countersink cone would overlap ${other}, which is not supported yet, so ${f.id} is shown without it -- space the countersinks at least as far apart as their mouth is wide, or use counterbores.`,
  csEdge: (f: HoleView) => `${f.id} (hole): the countersink mouth reaches past the side of the part, which is not supported yet, so ${f.id} is shown without it -- move the hole away from the side or make the countersink narrower than the part.`,
  tiny: (f: HoleView) => `${f.id} (hole): a hole narrower than ${MIN_ACROSS} mm cannot be cut reliably, so ${f.id} is shown without it -- make it at least ${MIN_ACROSS} across.`,
  wide: (f: HoleView, what: string) => `${f.id} (hole): the hole is as wide as ${what} it drills, so nothing would be left and ${f.id} is shown without it -- make the hole narrower than ${what}.`,
  engineCurved: (f: HoleView) => `${f.id} (hole): this hole meets a curved surface where the cut cannot be done exactly, so ${f.id} is shown without it -- drill along the axis of the curved shape or use a flat-sided shape.`,
  engineWide: (f: HoleView) => `${f.id} (hole): the hole is wider than the part, so nothing of it would be left and ${f.id} is shown without it -- make the hole narrower than the part.`,
};
/** every guard that can be switched off (H4_OFF / opts.off) */
export const ALL_GUARDS = ['G-BODIES', 'G-SHELLS', 'G-NOOP', 'G-TOP', 'G-CORNERS', 'G-CROSS', 'G-TORUS', 'G-TANGENT', 'G-RECESS', 'G-CSBAND', 'G-RECESS-VOL', 'G-BUDGET', 'G-REVOLVE', 'G-CURVED', 'G-WIDE', 'G-CSOVERLAP', 'G-CSEDGE', 'G-TINY', 'G-CSFLAT', 'G-NEST', 'G-RECESSMIN', 'G-OTHERS'];
/** the narrowest hole that cuts reliably (holes4-tiny sweep: 0.001 builds, 1e-4 fails with "cannot attach a plane to a wire") */
export const MIN_ACROSS = 0.001;
/** the flattest countersink cone that cuts with the right faces (holes4 sweep: 170 builds 8 faces, 175 and 178 and 179 build 9) */
export const CS_MAX_ANGLE = 170;
/** smallest recesses that cut right (holes4-recess-sweep.json: every value below was measured to build with the right faces, every smaller one measured wrong or refused by the engine) */
export const CB_MIN = { across: 0.2, depth: 0.005, ring: 0.005 }; // counterbore: diameter, depth, (recess - bore) / 2
export const CS_MIN = { bore: 0.7, ring: 0.04 }; // countersink: bore diameter, (mouth - bore) / 2
/** one plain reason for an engine failure text, or null */
export function engineSentence(f: HoleView, raw: unknown): string | null {
  const r = String(raw ?? '');
  if (/exact fallback|planar faces only|shallow angle/.test(r)) return SENTENCE.engineCurved(f);
  if (/no body named/.test(r)) return SENTENCE.engineWide(f);
  return null;
}

/** one sentence, no engine jargon, no emoji */
export function lintSentence(s: unknown): string[] {
  const problems: string[] = [];
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
export function plainScriptError(raw: string, _script = ''): string {
  let m: RegExpMatchArray | null;
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
function KIND_PHRASE(kind: string): string {
  return ({ combine: 'this joined, cut or overlapped shape', pocket: 'this pocketed shape', revolve: 'this spun shape', prism: 'this prism', wedge: 'this wedge', pattern: 'this pattern of copies', mirror: 'this mirrored shape', extrude: 'this pulled shape', torus: 'this ring', cone: 'this cone' }[kind]) ?? `this ${kind}`;
}

// ---- helpers ---------------------------------------------------------------------------------------------------------------------------
export function aggregateOf(res: RunResult, names: string[]): Aggregate | null {
  const bs = res.measure!.bodies.filter((b) => names.includes(b.name));
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
    faceTypes: bs.reduce((a: Record<string, number>, b) => { for (const [k, v] of Object.entries(b.face_types ?? {})) a[k] = (a[k] ?? 0) + v; return a; }, {}),
    com: [0, 1, 2].map((i) => bs.reduce((a, b) => a + b.volume_mm3 * b.center_of_mass[i], 0) / vol),
    bodies: bs.map((b) => b.name),
  };
}

const cylV = (d: number, L: number) => PI * (d / 2) ** 2 * L;
export const cbRem = (d: number, R: number, cbd: number, bl: number) => cylV(d, bl) + cylV(R, cbd) - cylV(d, cbd);
export function csRem(d: number, D: number, a: number, bl: number): number {
  const R = D / 2; const r = d / 2; const tn = Math.tan((a * PI) / 360); const dc = (R - r) / tn;
  if (dc <= bl) return PI * r * r * bl + (PI * dc / 3) * (R * R + R * r + r * r) - PI * r * r * dc;
  const rb = R - bl * tn;
  return (PI * bl / 3) * (R * R + R * rb + rb * rb);
}
/** depth of the cone tool solidcraft cuts for a countersink: it runs on down to radius 0.9*r whatever the hole depth (eval.rs HoleKind::Countersink) */
export const csToolDepth = (d: number, D: number, a: number) => (D / 2 - 0.9 * (d / 2)) / Math.tan((a * PI) / 360);
export const csConeDepth = (d: number, D: number, a: number) => (D / 2 - d / 2) / Math.tan((a * PI) / 360);


// ---- the translator's per-feature step ------------------------------------------------------------------------------------------------------
/** What a plan looks like to the step: the base planners' plans and the hole planner's, read loosely as the original reads them (plan.refusal, plan.noop, plan.variants ...). */
interface StepPlan {
  refusal?: string;
  guard?: string;
  raw?: string;
  probe?: unknown;
  noop?: boolean;
  variants?: Cmd[][];
  produces?: string[];
  consumes?: string[];
  baseIdx?: number;
  post?: PostFn;
  pickedFrom?: string;
}
export interface BodyRow { name: string; volume: number; shells: number; faces?: number }
/** allBefore: every body the engine held before this hole (absent = not known: the other parts are not compared); partOf: the step that made a body, for the sentence */
export interface PostEnv { allBodies: BodyRow[]; allCountBefore: number; allBefore?: BodyRow[]; partOf?: (body: string) => string | undefined; accepted: Cmd[]; variant: Cmd[]; off: Set<string> }
/** every body of an engine reply: name, volume, shells, faces */
export const rowsOf = (res: RunResult): BodyRow[] => res.measure!.bodies.map((b) => ({ name: b.name, volume: b.volume_mm3, shells: b.kernel.shells ?? 1, faces: b.faces }));
export type PostFn = (after: Aggregate, before: Aggregate | undefined, env: PostEnv) => GuardRefusal | null;
/** What planHole needs besides the feature and the state. */
export interface HoleG {
  accepted: Cmd[];
  headOf(id: string): string;
  byId: Record<string, RootView>;
  off: Set<string>;
  runB(cmds: Cmd[], o?: { replay?: boolean }): Promise<RunResult>;
}

/** The sentence a closed hollow() gets. Deliberate deviation from holes4-translate.mjs, whose sentence prints the word "undefined" where a reason belongs (the holes set plans no closed hollow, so it has no reason to give); owner-approved. holes.differential.test.mjs lists it as a named exception. */
const SHELL_CLOSED = (f: { id: string }) => `${f.id} (hollow): a hollow with no open side is not built here, so ${f.id} is shown without it -- add open:'top' (or 'bottom', 'front', 'back', 'left', 'right') to leave one side open.`;

/**
 * One feature of translateDocGuarded's forEach, ported (docs/spikes/solidcraft-referee/contract/holes4-translate.mjs). The differences from the original, and only these:
 * it is async (the engine reply may be a promise); a feature that needs a name resolved (shell's open face, fillet's edge, draft's face) gets it from the engine's own
 * topology exactly as the phase 4 base does (the original asks brep-rs through ctx.resolveAt, which does not exist here); and `st.accLen` is recorded for every accepted
 * feature (the original does not keep it), so a later name can be read from the shape an earlier feature left.
 */
export async function holesStep(f: Feature, idx: number, env: LoopEnv): Promise<void> {
  const { doc, ctx, st, accepted, out } = env;
  const hs = st.holes!;
  const off = new Set(ctx.guardsOff ?? []);
  const byId: Record<string, RootView> = Object.fromEntries(doc.features.map((x) => [x.id, x as unknown as RootView]));
  const fv = f as unknown as RootView;
  // ---- G-BUDGET: every engine run goes through runB. One run may use BUDGET_S plus 1.5x what replaying the accepted commands cost; the whole translation DOC_BUDGET_S.
  const runB = async (cmds: Cmd[], { replay = true }: { replay?: boolean } = {}): Promise<RunResult> => {
    const budgetS = off.has('G-BUDGET') ? 1e9 : BUDGET_S + (replay ? 1.5 * hs.lastRunS : 0);
    let res: RunResult;
    try { res = await ctx.runSC(cmds, { budgetS }); } catch (e) { res = { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${(e as Error).message}` } }; }
    hs.spentS += (res?.cpuMs ?? 0) / 1000;
    if (res?.ok && res.cpuMs && replay) hs.lastRunS = res.cpuMs / 1000;
    return res;
  };
  const headOf = (id: string): string => { let h = id; const seen = new Set<string>(); while (st.head[h] && !seen.has(h)) { seen.add(h); h = st.head[h]; } return h; };
  const prefix = doc.features.slice(0, idx);
  const resolved = await resolveNamesFor(f, prefix, env);
  const fctx: PlanCtx = { ...ctx, resolve: (name) => resolved.get(name) ?? null };
  const note = (o: Omit<FeatureResult, 'id' | 'kind'>) => { out.push({ id: f.id, kind: f.kind, ...o }); };
  if (f.kind === 'sketch') st.sketches[f.id] = f;
  let plan: StepPlan;
  try {
    plan = f.kind === 'hole' && !off.has('G-BUDGET') && hs.spentS > DOC_BUDGET_S ? refuse(SENTENCE.docBudget(f as unknown as HoleView), 'G-BUDGET')
      : f.kind === 'hole' ? await planHole(f as unknown as HoleView, st, { accepted, headOf, byId, off, runB }) as unknown as StepPlan
        : f.kind === 'shell' && !f.open ? refuse(SHELL_CLOSED(f), 'G-CLOSED')
          : planFeature(f, st, fctx, BASE_PROFILE) as unknown as StepPlan;
  } catch (e) { const r: StepPlan = refuse(`${f.id} (${f.kind}): this step could not be built, so ${f.id} is shown without it.`, 'translator-error'); r.raw = String((e as Error).message); plan = r; }
  // PROTOTYPE (ctx.probeBlocked, off by default): a hole blocked by a refused step is test-built on the part as it stands; its own refusal, if any, is what the student is told
  if (plan.refusal && plan.guard === 'dependency' && f.kind === 'hole' && ctx.probeBlocked) {
    const own = await probeBlockedHole(f as unknown as HoleView, st, { accepted, headOf, byId, off, runB }, hs.allCount);
    if (own) { st.refused[f.id] = own.refusal; note({ status: 'refused', refusal: own.refusal, guard: own.guard, raw: `blocked (${plan.refusal}); own refusal found by a test build on ${own.base}`, commands: [] }); return; }
  }
  if (plan.refusal) { st.refused[f.id] = plan.refusal; note({ status: 'refused', refusal: plan.refusal, guard: plan.guard, raw: plan.raw, probe: plan.probe, commands: [] }); return; }
  if (plan.noop) { note({ status: 'noop', commands: [] }); return; }
  let lastErr: string | null = null;
  let errored = false; // an engine reply with an errored body (errored-body.ts)
  for (const variant0 of plan.variants!) {
    let variant = variant0;
    let repaired: { pads: number; reason: string } | undefined;
    let res = await runB([...accepted, ...variant]);
    if (res.timedOut && off.has('G-BUDGET')) { // negative control: no budget, the run was killed at the control limit (H4_CTL_S) so the control could end
      st.refused[f.id] = `CONTROL: no result within ${res.failed?.error} (a hang)`;
      note({ status: 'refused', refusal: st.refused[f.id], guard: 'CONTROL-KILL', raw: res.failed?.error, cpuMs: res.cpuMs, commands: variant });
      return;
    }
    if (res.timedOut) {
      const sentence = f.kind === 'hole' ? SENTENCE.budget(f as unknown as HoleView) : budgetSentenceOther(f.id, f.kind);
      st.refused[f.id] = sentence;
      note({ status: 'refused', refusal: sentence, guard: 'G-BUDGET', raw: `${res.failed?.error}`, cpuMs: res.cpuMs, commands: variant });
      return;
    }
    if (!res.ok) { if (res.erroredBody) errored = true; lastErr = res.failed ? `${res.failed.command}: ${res.failed.error}` : String(res.error ?? 'unknown'); continue; }
    let m = aggregateOf(res, plan.produces!);
    if (!m) { lastErr = `solidcraft ran the commands but no body named ${plan.produces!.join(', ')} came back`; continue; }
    let allBodies: BodyRow[] = rowsOf(res);
    // every set: the built pull against its sketch (sketch-volume.ts)
    const sv = f.kind === 'extrude' ? sketchVolumeRefusal(f, st.sketches[f.target], ctx, res, plan.produces!) : null;
    if (sv) { st.refused[f.id] = sv; note({ status: 'refused', refusal: sv, guard: SKETCH_VOLUME_GUARD, commands: variant }); return; }
    // every set: a move or turn against the part it started from, a primitive against its closed-form volume (move-turn.ts)
    const mv = motionRefusal(f, st, ctx, res, plan.produces!, accepted);
    // the move-turn group's chain repair: the same feature with one or two no-op moves appended, re-checked by the same invariant (move-turn.ts motionRepair)
    const fx = mv ? await motionRepair(f, st, ctx, mv, plan.produces!, accepted, variant, runB) : null;
    const m2 = fx ? aggregateOf(fx.res, plan.produces!) : null;
    if (mv && fx && m2) { variant = fx.variant; res = fx.res; m = m2; repaired = { pads: fx.pads, reason: mv.sentence }; allBodies = rowsOf(res); }
    else if (mv) { st.refused[f.id] = mv.sentence; note({ status: 'refused', refusal: mv.sentence, guard: mv.guard, commands: variant }); return; }
    // a blend of one straight edge between two planar faces adds exactly one face (fillet-chain.ts)
    const bl = blendRefusal(f, blendOf(plan), beforeOf(st, fv.target), m, ctx);
    if (bl) { st.refused[f.id] = bl.sentence; note({ status: 'refused', refusal: bl.sentence, guard: bl.guard, unguarded: { volume: m.volume, faces: m.faces, bbox: m.bbox }, commands: variant }); return; }
    if (plan.post) {
      const before = st.measure[headOf((f as unknown as HoleView).target)] ?? st.measure[(f as unknown as HoleView).target];
      const bad = plan.post(m, before, { allBodies, allCountBefore: hs.allCount, allBefore: hs.allRows, partOf: makerOf(st, byId), accepted, variant, off });
      if (bad) {
        st.refused[f.id] = bad.refusal;
        note({ status: 'refused', refusal: bad.refusal, guard: bad.guard, unguarded: { volume: m.volume, faces: m.faces, bbox: m.bbox, shells: m.shells, bodies: allBodies.length, allVolume: allBodies.reduce((a, b) => a + b.volume, 0) }, commands: variant });
        return;
      }
    }
    if (f.kind === 'hole') {
      const h = headOf((f as unknown as HoleView).target);
      const prev = hs.chain[h];
      hs.chain[f.id] = prev ?? { baseIdx: plan.baseIdx!, baseMeasure: st.measure[h] ?? st.measure[(f as unknown as HoleView).target] };
    }
    // the sets with no after-the-build check of a pocket: the cut against the tool that made it (pocket-cut.ts, the extrude-pocket group's check and sentence)
    const pc = f.kind === 'pocket' ? await pocketCutRefusal(f, ctx, res, accepted, variant, plan.produces!, (c) => runB(c, { replay: false })) : null;
    if (pc) { st.refused[f.id] = pc; note({ status: 'refused', refusal: pc, guard: POCKET_CUT_GUARD, commands: variant }); return; }
    // every set: the hollow of a part with rounded or bevelled edges against its closed form (hollow-check.ts)
    const hc = f.kind === 'shell' ? hollowRefusal(f, doc.features, st, ctx, res, plan.produces!, accepted) : null;
    if (hc) { st.refused[f.id] = hc.sentence; note({ status: 'refused', refusal: hc.sentence, guard: hc.guard, commands: variant }); return; }
    accepted.push(...variant);
    rememberRun(accepted, res);
    for (const mp of membersOf(env.profile)) mp.onAccepted?.(st, res, m, null, { f, ctx });
    st.accLen[f.id] = accepted.length;
    st.bodies[f.id] = m.bodies; st.measure[f.id] = m;
    for (const c of plan.consumes!) {
      if (c === f.id) continue;
      if (f.kind === 'hole' || f.kind === 'pocket' || f.kind === 'groove') { if (c === (f.kind === 'hole' ? (f as unknown as HoleView).target : (fv as unknown as { into: string }).into)) st.head[c] = f.id; } else st.stale[c] = f.id;
    }
    note({ status: 'built', commands: variant, measure: m, pickedFrom: plan.pickedFrom, probe: plan.probe, variantsTried: plan.variants!.indexOf(variant0) + 1, ...(repaired ? { repaired } : {}) });
    return;
  }
  if (errored) { const s = erroredBodySentence(f); st.refused[f.id] = s; note({ status: 'refused', refusal: s, raw: lastErr, guard: ERRORED_BODY_GUARD, commands: plan.variants![0] }); return; }
  const sentence = f.kind === 'hole' ? (engineSentence(f as unknown as HoleView, lastErr) ?? SENTENCE.engine(f as unknown as HoleView)) : `${f.id} (${f.kind}): this step could not be built cleanly, so ${f.id} is shown without it.`;
  st.refused[f.id] = sentence;
  note({ status: 'refused', refusal: sentence, raw: lastErr, guard: 'G-ENGINE', commands: plan.variants![0] });
}

/**
 * PROTOTYPE (pilot 2026-11 F5/F8). `f` is blocked: the step before it was refused. Find the last step of the same part that WAS built, plan `f` on it with
 * the usual guards, and (if they pass) cut it on the engine and run the usual after-the-build check. Nothing is kept. Returns the hole's own refusal, or null
 * when the hole would build (or the part before the refused steps cannot be found), in which case the blocked sentence stands.
 */
async function probeBlockedHole(f: HoleView, st: TranslateState, G: HoleG, allCountBefore: number): Promise<{ refusal: string; guard: string; base: string } | null> {
  let base: string | undefined = G.headOf(f.target); const seen = new Set<string>();
  while (base && st.refused[base] && !seen.has(base)) {
    seen.add(base); const x: RootView | undefined = G.byId[base];
    base = x && ['hole', 'fillet', 'shell', 'draft'].includes(x.kind) && x.target ? G.headOf(x.target) : undefined;
  }
  if (!base || st.refused[base] || st.stale[base] || !st.bodies[base] || !st.measure[base]) return null;
  const f2: HoleView = { ...f, target: base };
  let plan: HolePlan | GuardRefusal;
  try { plan = await planHole(f2, st, G); } catch { return null; }
  if ('refusal' in plan && plan.refusal) return plan.guard === 'dependency' ? null : { refusal: plan.refusal, guard: plan.guard ?? 'guard', base };
  const hp = plan as HolePlan; let lastErr: string | null = null; let errored = false;
  for (const variant of hp.variants) {
    const res = await G.runB([...G.accepted, ...variant], { replay: false });
    if (res.timedOut) return { refusal: SENTENCE.budget(f), guard: 'G-BUDGET', base };
    if (!res.ok) { if (res.erroredBody) errored = true; lastErr = res.failed ? `${res.failed.command}: ${res.failed.error}` : String(res.error ?? 'unknown'); continue; }
    const m = aggregateOf(res, hp.produces);
    if (!m) { lastErr = 'no body came back'; continue; }
    const allBodies: BodyRow[] = rowsOf(res);
    const bad = hp.post ? hp.post(m, st.measure[base], { allBodies, allCountBefore, allBefore: st.holes!.allRows, partOf: makerOf(st, G.byId), accepted: G.accepted, variant, off: G.off }) : null;
    return bad ? { refusal: bad.refusal, guard: bad.guard ?? 'guard', base } : null; // null: it would build
  }
  if (errored) return { refusal: erroredBodySentence(f), guard: ERRORED_BODY_GUARD, base };
  return { refusal: engineSentence(f, lastErr) ?? SENTENCE.engine(f), guard: 'G-ENGINE', base };
}

// ---- G-BODIES narrowed: other parts ---------------------------------------------------------------------------------------------------------
const NOT_A_REF = new Set(['id', 'kind', 'name']);
/** The features `id` is built from that have no input themselves (its primitives and sketches). A feature's inputs are read from its own fields: every string in it that is another feature's id. */
export function rootsOf(id: string, byId: Record<string, unknown>): Set<string> {
  const roots = new Set<string>(); const seen = new Set<string>();
  const walk = (cur: string): void => {
    if (seen.has(cur)) return; seen.add(cur);
    const f = byId[cur] as Record<string, unknown> | undefined; if (!f) return;
    const refs = new Set<string>();
    const scan = (v: unknown): void => { if (typeof v === 'string') { if (v !== cur && byId[v] !== undefined) refs.add(v); } else if (Array.isArray(v)) v.forEach(scan); else if (v && typeof v === 'object') Object.values(v).forEach(scan); };
    for (const [k, v] of Object.entries(f)) if (!NOT_A_REF.has(k)) scan(v);
    if (!refs.size) roots.add(cur); else refs.forEach(walk);
  };
  walk(id);
  return roots;
}
/**
 * May a hole be cut although the engine holds other bodies? Only when every other body is a DIFFERENT PART: some accepted feature lists it, and none of the
 * features that list it shares a root (a primitive, a sketch) with the part being drilled. A copy, a pattern or a mirror of this part shares its root. A body no
 * accepted feature lists (a piece the engine split off, a copy it named itself) has no known maker. Both stay refused, as every such hole was before.
 */
export function otherPartsOnly(target: string, bs: string[], st: TranslateState, byId: Record<string, unknown>): boolean {
  const rows = st.holes!.allRows;
  if (!rows || rows.length !== st.holes!.allCount) return false;
  const mine = rootsOf(target, byId);
  if (!mine.size) return false;
  for (const r of rows) {
    if (bs.includes(r.name)) continue;
    const makers = Object.keys(st.bodies).filter((id) => st.bodies[id]?.includes(r.name));
    if (!makers.length) return false;
    for (const mk of makers) for (const x of rootsOf(mk, byId)) if (mine.has(x)) return false;
  }
  return true;
}
/** G-OTHERS: the first body other than the drilled part's that changed (gone, or another volume, shell or face count), or null. `mine` = the names the hole produced; `before` / `after` = every body the engine held. */
export function othersChanged(mine: string[], before: BodyRow[], after: BodyRow[]): string | null {
  for (const b0 of before) {
    if (mine.includes(b0.name)) continue;
    const b1 = after.find((x) => x.name === b0.name);
    if (!b1 || b1.shells !== b0.shells || (b0.faces !== undefined && b1.faces !== undefined && b1.faces !== b0.faces) || Math.abs(b1.volume - b0.volume) > 1e-9 * Math.max(1, Math.abs(b0.volume))) return b0.name;
  }
  return null;
}
/** The step that made a body: the first step of the script that lists it (box2, pull1, op1), for the G-OTHERS sentence. */
export const makerOf = (st: TranslateState, byId: Record<string, unknown>) => (body: string): string | undefined => Object.keys(byId).find((id) => st.bodies[id]?.includes(body));

// ---- helpers ---------------------------------------------------------------------------------------------------------------------------
const byIdOf = (G: HoleG, id: string): RootView | undefined => G.byId[id];
/** what planHole returns when the hole may be cut: the commands, the part it consumes, and the post-check run on the result */
export interface HolePlan { variants: Cmd[][]; produces: string[]; consumes: string[]; baseIdx: number; probe: unknown; post: PostFn }
export async function planHole(f: HoleView, st: TranslateState, G: HoleG): Promise<HolePlan | GuardRefusal> {
  const { accepted, headOf, off, runB } = G;
  const runSC = (cmds: Cmd[]) => runB(cmds, { replay: false });
  const head = headOf(f.target);
  if (st.refused[head]) return refuse(SENTENCE.dep(f, head), 'dependency');
  if (st.stale[head]) return refuse(SENTENCE.stale(f, head, st.stale[head]), 'dependency');
  const bs = st.bodies[head];
  const m = st.measure[head] ?? st.measure[f.target];
  if (!bs || !bs.length || !m) return refuse(SENTENCE.noBody(f), 'G-BODIES');
  // The part itself in several pieces (copies of it) is refused. Other bodies in the engine used to refuse every hole too; now (owner decision 2026-11-12) they do
  // not when each of them is a DIFFERENT PART (otherPartsOnly): the cut names its body, and the after-the-cut check G-OTHERS (commonPost) requires every other
  // part to come back exactly as it was.
  if (!off.has('G-BODIES') && (bs.length !== 1 || (st.holes!.allCount > 1 && !otherPartsOnly(f.target, bs, st, G.byId)))) return refuse(SENTENCE.multi(f, Math.max(bs.length, st.holes!.allCount)), 'G-BODIES');
  // ---- ROUND 4 pre-checks (each exists so the student is told at once instead of after BUDGET_S seconds; the budget is the backstop)
  if (!off.has('G-BODIES') && (m.shells ?? 1) > 1) return refuse(SENTENCE.multi(f, m.shells!), 'G-BODIES'); // one body that is already several pieces (repeat() of copies that do not touch)
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
      const offs = f.corners ? [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => [sx * f.corners!.dx, sy * f.corners!.dy]) : [[0, 0]];
      for (const [ox, oy] of offs) {
        const pc = [c1[0] + ox, c1[1] + oy, c1[2]];
        if (Math.hypot(...perp1.map((k) => pc[k] - bc1[k])) + rootF.radius! <= f.diameter / 2 + 1e-9) return refuse(SENTENCE.wide(f, 'the cylinder'), 'G-WIDE');
      }
    }
  }
  if (f.corners && axis !== 'z' && !off.has('G-CORNERS')) return refuse(SENTENCE.cornersAxis({ ...f, axis }), 'G-CORNERS');
  // ---- G-TORUS: a bore through a ring's tube is a curved-on-curved cut that does not finish (through-ring-offset-hits: no result in 300 s wall, 1 core busy)
  if (!off.has('G-TORUS')) {
    let root: RootView | undefined = G.byId[f.target]; const seenR = new Set<string>();
    while (root && root.kind === 'hole' && !seenR.has(root.id)) { seenR.add(root.id); root = G.byId[root.target!]; }
    if (root?.kind === 'torus') return refuse(SENTENCE.torus(f), 'G-TORUS');
  }
  // ---- G-TANGENT: a bore (or a recess ring) whose wall touches the part's side, or another bore, along a line leaves a zero-thickness wall: OCCT builds
  // 16 faces where truck builds 10 (holes-tangent-to-wall), brep-rs refuses ("a tangent contact brep-rs cannot cut yet"), and a one-sided check cannot tell which is right.
  if (!off.has('G-TANGENT')) {
    const bcT = [0, 1, 2].map((i) => (m.bbox[i] + m.bbox[i + 3]) / 2);
    const cT = [bcT[0] + f.center[0], bcT[1] + f.center[1], bcT[2] + f.center[2]];
    const cs4: V3[] = f.corners ? [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => [cT[0] + sx * f.corners!.dx, cT[1] + sy * f.corners!.dy, cT[2]]) : [cT];
    const aiT = AXI[axis]; const TOLT = 1e-6;
    const radii: Array<[number, string]> = [[f.diameter / 2, 'hole']]; if (f.counterbore) radii.push([f.counterbore.diameter / 2, 'recess']); if (f.countersink) radii.push([f.countersink.diameter / 2, 'recess']);
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
    for (let cur: RootView | undefined = G.byId[f.target], seenT = new Set<string>(); cur && cur.kind === 'hole' && !seenT.has(cur.id); cur = G.byId[cur.target!]) {
      seenT.add(cur.id);
      if ((cur.axis ?? 'z') !== axis) continue;
      const cc = [bcT[0] + cur.center![0], bcT[1] + cur.center![1], bcT[2] + cur.center![2]];
      const others: V3[] = cur.corners ? [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => [cc[0] + sx * cur!.corners!.dx, cc[1] + sy * cur!.corners!.dy, cc[2]]) : [cc];
      for (const o of others) for (const c of cs4) {
        const d = Math.hypot(...[0, 1, 2].filter((k) => k !== aiT).map((k) => o[k] - c[k]));
        const r1 = cur.diameter! / 2; const r2 = f.diameter / 2;
        if (d > TOLT && (Math.abs(d - (r1 + r2)) < TOLT || Math.abs(d - Math.abs(r1 - r2)) < TOLT)) return refuse(SENTENCE.tangent(f, 'hole', 'earlier'), 'G-TANGENT');
      }
    }
  }

  // ---- G-CROSS: a bore that meets an earlier bore drilled along another axis is a curved-on-curved cut that does not finish (measured: a z bore
  // crossed by an x through bore 98 s; a blind z bore then an x bore past 200 s). Tools are finite cylinders; the test is the common-perpendicular one.
  if (!off.has('G-CROSS')) {
    const bc0 = [0, 1, 2].map((i) => (m.bbox[i] + m.bbox[i + 3]) / 2);
    const toolsOf = (h: HoleView) => { const a = h.axis ?? 'z'; const c: V3 = [bc0[0] + h.center[0], bc0[1] + h.center[1], bc0[2] + h.center[2]];
      const cs: V3[] = h.corners ? [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => [c[0] + sx * h.corners!.dx, c[1] + sy * h.corners!.dy, c[2]]) : [c];
      return cs.map((cc) => ({ a: AXI[a], c: cc, L: h.depth / 2, r: Math.max(h.diameter, h.counterbore?.diameter ?? 0, h.countersink?.diameter ?? 0) / 2 })); }; // a recess is wider than the bore: it can meet a bore the bore itself would miss
    const mine = toolsOf({ ...f, axis });
    for (let cur = byIdOf(G, f.target), seen = new Set<string>(); cur && cur.kind === 'hole' && !seen.has(cur.id); cur = byIdOf(G, cur.target!)) {
      seen.add(cur.id);
      if ((cur.axis ?? 'z') === axis) continue;
      for (const A of toolsOf(H(cur))) for (const B of mine) {
        const k = [0, 1, 2].find((i) => i !== A.a && i !== B.a)!;
        if (Math.abs(A.c[k] - B.c[k]) < A.r + B.r && Math.abs(B.c[A.a] - A.c[A.a]) <= A.L + B.r && Math.abs(A.c[B.a] - B.c[B.a]) <= B.L + A.r && !crossInAir(A, B, f, G, m)) return refuse(SENTENCE.cross(f, cur), 'G-CROSS');
      }
    }
  }
  const bc = [0, 1, 2].map((i) => (m.bbox[i] + m.bbox[i + 3]) / 2);
  const c0 = [bc[0] + f.center[0], bc[1] + f.center[1], bc[2] + f.center[2]];
  const centres: V3[] = f.corners
    ? [[c0[0] - f.corners.dx, c0[1] - f.corners.dy, c0[2]], [c0[0] + f.corners.dx, c0[1] - f.corners.dy, c0[2]], [c0[0] - f.corners.dx, c0[1] + f.corners.dy, c0[2]], [c0[0] + f.corners.dx, c0[1] + f.corners.dy, c0[2]]]
    : [c0];
  const r = f.diameter / 2;
  const lo = m.bbox[ai]; const hi = m.bbox[ai + 3]; const T = hi - lo;
  const toolTop = c0[ai] + f.depth / 2; const toolBot = c0[ai] - f.depth / 2;
  const through = toolBot <= lo + 1e-9 && toolTop >= hi - 1e-9;
  const recess = f.counterbore ? 'counterbore' : f.countersink ? 'countersink' : null;
  const baseIdx = st.holes!.chain[head]?.baseIdx ?? accepted.length;
  const baseMeasure = st.holes!.chain[head]?.baseMeasure ?? m;
  const probeInfo: Record<string, unknown> = {};

  // ---- G-CSOVERLAP: native solid.hole cuts a countersink as a cone tool. Measured (holes4-raw-overlap.txt, 40 s budget): two countersinks whose mouths overlap 35 s CPU
  // and four never finish, a countersink over an earlier plain bore or counterbore (and a bore or counterbore over an earlier countersink) 37 to 40+ s, against 2.6 s for two
  // overlapping counterbores and 11 s for two countersinks that do not touch. So: whenever either tool has a countersink and the two footprints (mouth / recess / bore, whichever
  // is widest) overlap or touch, the hole is refused at once.
  if (!off.has('G-CSOVERLAP')) {
    const perpA = [0, 1, 2].filter((k) => k !== ai);
    const dist = (a: V3, b: V3) => Math.hypot(...perpA.map((k) => a[k] - b[k]));
    const footprint = (h: HoleView) => Math.max(h.diameter, h.counterbore?.diameter ?? 0, h.countersink?.diameter ?? 0) / 2;
    const bcO = [0, 1, 2].map((i) => (m.bbox[i] + m.bbox[i + 3]) / 2);
    const centresOf = (h: HoleView): V3[] => { const cc = [0, 1, 2].map((i) => bcO[i] + h.center[i]); return h.corners ? [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => [cc[0] + sx * h.corners!.dx, cc[1] + sy * h.corners!.dy, cc[2]]) : [cc]; };
    const mineC = centresOf(f); const rn = footprint(f);
    if (f.countersink) {
      for (let a = 0; a < mineC.length; a++) for (let b = a + 1; b < mineC.length; b++) if (dist(mineC[a], mineC[b]) < 2 * rn + 1e-6) return refuse(SENTENCE.csOverlap(f, 'the countersink of another hole in this holes() call'), 'G-CSOVERLAP');
    }
    for (let cur: RootView | undefined = G.byId[f.target], seenO = new Set<string>(); cur && cur.kind === 'hole' && !seenO.has(cur.id); cur = G.byId[cur.target!]) {
      seenO.add(cur.id);
      if ((cur.axis ?? 'z') !== axis) continue;
      if (!f.countersink && !cur.countersink) continue;
      const ro = footprint(H(cur));
      for (const o of centresOf(H(cur))) for (const c of mineC) if (dist(o, c) < rn + ro + 1e-6) return refuse(SENTENCE.csOverlap(f, `${cur.countersink ? 'the countersink' : 'the hole'} of ${cur.id}`), 'G-CSOVERLAP');
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
        if (Math.hypot(...pk.map((k) => c[k] - bc[k])) + R > rootF.radius! - 1e-6) return refuse(SENTENCE.csEdge(f), 'G-CSEDGE');
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
    let removed: number | null = null; let failed: string | null = null; let dFaces: number | null = null; let ok = false; let why: string | null = null; let res_timedOut = false;
    const curvedBase = baseMeasure.curved;
    let flat: FlatTop = { ok: true };
    // a disc this small is lost in the noise of the host's volume (a 0.001 across hole: 2.5e-9 mm3 on a 12000 mm3 plate, round 3 refused it as "not flat"): count faces instead
    const faceProbe = !curvedBase && want * centres.length < 1e-6 * baseMeasure.volume;
    if (curvedBase) flat = flatTopCurved(f, axis, G, centres, bc);
    try {
      const res = await runSC([...accepted.slice(0, baseIdx), ...probeCmds]);
      if (res.timedOut) res_timedOut = true;
      if (!res.ok) failed = `${res.failed?.command}: ${res.failed?.error}`;
      else {
        const a = aggregateOf(res, bs)!; // null throws here, as in the original (caught below)
        removed = baseMeasure.volume - a.volume; dFaces = a.faces - baseMeasure.faces;
        if (curvedBase) ok = flat.ok && dFaces === 2 * centres.length && a.shells === baseMeasure.shells;
        else if (faceProbe) { ok = dFaces === 2 * centres.length && a.shells === baseMeasure.shells; why = dFaces === 3 * centres.length ? 'buried' : 'air'; }
        else { const ratio = removed / (want * centres.length); ok = ratio >= 0.8 && ratio <= 1.2; why = ratio > 1.2 ? 'buried' : 'air'; }
      }
    } catch (e) { failed = String((e as Error).message); }
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
      for (let cur: RootView | undefined = G.byId[f.target], seenN = new Set<string>(); cur && cur.kind === 'hole' && !seenN.has(cur.id); cur = G.byId[cur.target!]) {
        seenN.add(cur.id);
        if ((cur.axis ?? 'z') !== axis) continue;
        const ch = H(cur);
        const cc = [0, 1, 2].map((i) => bc[i] + ch.center[i]);
        if (cc[ai] + ch.depth / 2 < hi - 1e-9) continue; // that tool does not reach the top
        const rTop = Math.max(ch.diameter, ch.counterbore?.diameter ?? 0, ch.countersink?.diameter ?? 0) / 2;
        const os: V3[] = ch.corners ? [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => [cc[0] + sx * ch.corners!.dx, cc[1] + sy * ch.corners!.dy, cc[2]]) : [cc];
        for (const o of os) for (const c of centres) if (Math.hypot(...perpN.map((k) => c[k] - o[k])) < rTop - 1e-9) return { ...refuse(SENTENCE.recessNest(f, recess, `the hole of ${cur.id}`), 'G-NEST'), probe: probeInfo };
      }
    }
    if (!through && Math.abs(toolTop - hi) > 1e-9) return { ...refuse(SENTENCE.recessCavity(f, recess), 'G-RECESS'), probe: probeInfo };
    const cb = f.counterbore; const cs = f.countersink;
    const D = (cb ?? cs)!.diameter;
    if (!off.has('G-RECESS') && !(D > f.diameter + 1e-12)) return { ...refuse(SENTENCE.recessNarrow(f, cb ? 'counterbore' : 'countersink'), 'G-RECESS'), probe: probeInfo };
    const holeDepth = through ? T : f.depth;
    if (!off.has('G-RECESS') && cb && !(through ? cb.depth <= T + 1e-9 : cb.depth < holeDepth - 1e-9)) {
      return { ...refuse(SENTENCE.cbDeep(f, cb.depth, holeDepth, through ? 'part' : 'hole'), 'G-RECESS'), probe: probeInfo };
    }
    if (!off.has('G-RECESS') && cb && cb.depth <= 0) return { ...refuse(SENTENCE.cbDeep(f, cb.depth, holeDepth, 'hole'), 'G-RECESS'), probe: probeInfo };
    let need: number | null = null;
    if (cs && !through) {
      need = csToolDepth(f.diameter, cs.diameter, cs.angleDeg) + CS_MARGIN;
      if (!off.has('G-CSBAND') && holeDepth < need) return { ...refuse(SENTENCE.csBand(f, need, holeDepth), 'G-CSBAND'), probe: { ...probeInfo, need } };
    }
    const cmds = centres.map((c) => {
      const params: Record<string, unknown> = { position: c.map((v, i) => (i === ai ? hi : v)), diameter: f.diameter, body: bs[0] };
      if (!through) params.depth = holeDepth;
      if (cb) Object.assign(params, { type: 'counterbore', cb_diameter: cb.diameter, cb_depth: cb.depth });
      else Object.assign(params, { type: 'countersink', cs_diameter: cs!.diameter, cs_angle: `${cs!.angleDeg} deg` });
      return { command: 'solid.hole', params };
    });
    // closed-form post-check (ROUND 4: integrated, see holes4-volume.mjs): the removed volume of THIS hole is  area((new tools clipped to the box) minus (earlier tools))  integrated
    // along the axis, for a plain box host. Round 3 compared with the formula for one ring on an intact box, which is false when an earlier hole's recess overlaps this one's, and
    // refused a correct part with a false reason (two counterbores 10 apart, recess 12 across: truck 11172.50, brep-rs 11172.50, the lens integral 11172.5).
    const isBox = baseMeasure.faces === 6 && !baseMeasure.curved && Math.abs(baseMeasure.volume - (baseMeasure.bbox[3] - baseMeasure.bbox[0]) * (baseMeasure.bbox[4] - baseMeasure.bbox[1]) * (baseMeasure.bbox[5] - baseMeasure.bbox[2])) <= 1e-9 * baseMeasure.volume;
    let expected: number | null = null;
    if (isBox) {
      const [p0, p1] = [0, 1, 2].filter((k) => k !== ai);
      const bb = baseMeasure.bbox;
      const bcB = [0, 1, 2].map((i) => (bb[i] + bb[i + 3]) / 2);
      const toolsOf = (h: HoleView, cs: V3[]): VolTool[] => cs.map((c) => ({ cx: c[p0], cy: c[p1], prof: holeProfile(h, bb[ai + 3], bb[ai], c[ai]) }));
      const centresOfH = (h: HoleView): V3[] => { const cc = [0, 1, 2].map((i) => bcB[i] + h.center[i]); return h.corners ? [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => [cc[0] + sx * h.corners!.dx, cc[1] + sy * h.corners!.dy, cc[2]]) : [cc]; };
      const olds: VolTool[] = [];
      for (let cur: RootView | undefined = G.byId[f.target], seenV = new Set<string>(); cur && cur.kind === 'hole' && !seenV.has(cur.id); cur = G.byId[cur.target!]) {
        seenV.add(cur.id);
        if ((cur.axis ?? 'z') === axis) olds.push(...toolsOf(H(cur), centresOfH(H(cur))));
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
/** result of flatTopCurved */
export interface FlatTop { ok: boolean; root?: string; why?: string }
export function flatTopCurved(f: HoleView, axis: string, G: HoleG, centres: V3[], bc: V3): FlatTop {
  let cur: RootView | undefined = G.byId[f.target]; const seen = new Set<string>();
  while (cur && cur.kind === 'hole' && !seen.has(cur.id)) { seen.add(cur.id); cur = G.byId[cur.target!]; }
  if (!cur) return { ok: false, why: 'no root found' };
  const ai = AXI[axis];
  const rotate = (v: V3, rot: V3 | undefined): V3 => { // the translator's order: x, then y, then z, about the origin
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
    const sk = G.byId[cur.target!]; if (!sk) return { ok: false, root: 'extrude', why: 'no sketch' };
    const n: V3 = sk.frame ? (() => { const u = sk.frame!.u; const v = sk.frame!.v; return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; })() : PLANE_NORMAL[sk.plane ?? 'xy'];
    return { ok: Math.abs(Math.abs(n[ai]) - 1) < 1e-9, root: 'extrude', why: 'pull normal ' + n };
  }
  if (cur.kind === 'sphere') {
    const perp = [0, 1, 2].filter((i) => i !== ai);
    return { ok: centres.length === 1 && perp.every((i) => Math.abs(centres[0][i] - bc[i]) < 1e-9), root: 'sphere', why: 'sphere pole only' };
  }
  return { ok: false, root: cur.kind, why: `a ${cur.kind} has no flat top` };
}

/** G-BODIES (post), G-SHELLS, G-NOOP, recess closed form */
function commonPost(f: HoleView, after: Aggregate, before: Aggregate | undefined, env: PostEnv, { expected, recess }: { expected?: number | null; recess?: string | null }): GuardRefusal | null {
  const off = env.off;
  if (!off.has('G-BODIES') && env.allBodies.length > env.allCountBefore) return { guard: 'G-BODIES', refusal: SENTENCE.split(f, env.allCountBefore, env.allBodies.length) };
  // G-OTHERS: a hole is cut into ONE part. Every other body the engine held must come back as it was: there, the same volume (1e-9), the same shells and faces.
  const other = !off.has('G-OTHERS') && env.allBefore ? othersChanged(after.bodies, env.allBefore, env.allBodies) : null;
  if (other !== null) { const part = env.partOf?.(other); return { guard: 'G-OTHERS', refusal: part ? SENTENCE.others(f, part) : SENTENCE.engine(f) }; }
  if (!before) return null;
  if (!off.has('G-SHELLS') && after.shells! > before.shells!) return { guard: 'G-SHELLS', refusal: SENTENCE.shells(f) };
  const curved = after.curved || before.curved;
  const dV = before.volume - after.volume;
  const tol = (curved ? COVER_TOL.curved : COVER_TOL.planar) * before.volume;
  if (!off.has('G-NOOP') && Math.abs(dV) <= tol && !(after.faces > before.faces)) return { guard: 'G-NOOP', refusal: SENTENCE.noop(f) };
  if (!off.has('G-NOOP') && !(after.faces > before.faces) && dV <= tol) return { guard: 'G-NOOP', refusal: SENTENCE.noop(f) };
  if (expected != null && expected > 1e-9 && !off.has('G-RECESS-VOL') && Math.abs(dV - expected) > RECESS_TOL * expected) return { guard: 'G-RECESS-VOL', refusal: SENTENCE.recessCheck(f, recess as string) };
  return null;
}


// ---- ROUND 4 helpers -----------------------------------------------------------------------------------------------------------------------
/** the first feature that is not a hole, walking back from `id` through hole targets */
export function rootOf(id: string, G: { byId: Record<string, RootView> }): RootView | null {
  let cur: RootView | undefined = G.byId[id]; const seen = new Set<string>();
  while (cur && cur.kind === 'hole' && !seen.has(cur.id)) { seen.add(cur.id); cur = G.byId[cur.target!]; }
  return cur ?? null;
}
// ---- G-CROSS, narrowed for an extruded outline (pilot 2026-11 F1, docs/spikes/solidcraft-referee/pilot-2026-11/PILOT.md) -------------------------------
// The crossing test compares the two DRILLS, which are as long as the part's bounding box. On an L, U or T bracket a hole through each leg has drills that meet
// only in the empty corner: the holes never meet in the part, and with the guard out of the way all 45 seeded cases built within 4.8e-6 in 1.5 s at most
// (cx61). So: when the part is a plain polygon pulled straight along z and both drills run across the pull, the place where the drills can meet is a
// rectangle in the outline's plane (each drill's width across the other's line). If that rectangle, grown by CROSS_AIR_MARGIN, has no point in common with
// the outline, the crossing is in air and is let through. Everything else (a box, where the rectangle is always inside; a circle, a rounded or dimensioned
// outline, a tilted or tapered pull, a moved part, an outline that does not match the measured part) stays refused as before.
const CROSS_AIR_MARGIN = 0.01;
/** does the axis-aligned rectangle [x0, x1] x [y0, y1] share a point with the polygon (its inside or its boundary)? */
export function rectMeetsPolygon(x0: number, x1: number, y0: number, y1: number, pts: number[][]): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) { // an edge that passes through the rectangle (Liang-Barsky)
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n]; const dx = bx - ax, dy = by - ay; let t0 = 0, t1 = 1, hit = true;
    for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]] as Array<[number, number]>) {
      if (p === 0) { if (q < 0) { hit = false; break; } continue; }
      const t = q / p; if (p < 0) { if (t > t1) { hit = false; break; } if (t > t0) t0 = t; } else { if (t < t0) { hit = false; break; } if (t < t1) t1 = t; }
    }
    if (hit) return true;
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2; let inside = false; // no edge touches it: it is wholly inside or wholly outside; ask its centre
  for (let i = 0, j = n - 1; i < n; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > cy) !== (yj > cy) && cx < ((xj - xi) * (cy - yi)) / (yj - yi) + xi) inside = !inside; }
  return inside;
}
/** true when drills A and B (toolsOf entries: a = axis index, c = centre, r = radius), which cross, can only meet outside the material of the part `f` drills */
export function crossInAir(A: { a: number; c: V3; r: number }, B: { a: number; c: V3; r: number }, f: HoleView, G: { byId: Record<string, RootView> }, m: { bbox: number[] }): boolean {
  if (A.a === 2 || B.a === 2) return false; // one drill runs along the pull: not this case
  const root = rootOf(f.target, G);
  if (!root || root.kind !== 'extrude' || root.taper || root.direction || root.midplane || root.alongNormal || (root.rotate && root.rotate.some((v) => v !== 0))) return false;
  const sk = G.byId[root.target!] as (RootView & { geoms?: unknown[]; geom?: unknown[]; rules?: unknown[]; constraints?: unknown[]; points?: number[][] }) | undefined;
  if (!sk || sk.kind !== 'sketch' || (sk.plane ?? 'xy') !== 'xy' || sk.frame || sk.shape === 'circle') return false;
  if ((sk.geoms && sk.geoms.length) || (sk.geom && sk.geom.length) || (sk.rules && sk.rules.length) || (sk.constraints && sk.constraints.length)) return false;
  if (Object.keys(sk.bulges ?? {}).length || Object.keys(sk.rounds ?? {}).length) return false;
  const pts = sk.points; if (!Array.isArray(pts) || pts.length < 3 || !pts.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => Number.isFinite(v)))) return false;
  // the outline must be where the measured part is: same extent in x and y (a part that was built some other way, or moved, fails this)
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); const tol = 1e-6 * Math.max(1, m.bbox[3] - m.bbox[0], m.bbox[4] - m.bbox[1]);
  if (Math.abs(Math.min(...xs) - m.bbox[0]) > tol || Math.abs(Math.max(...xs) - m.bbox[3]) > tol || Math.abs(Math.min(...ys) - m.bbox[1]) > tol || Math.abs(Math.max(...ys) - m.bbox[4]) > tol) return false;
  // where the drills can meet, in x and y: along A's axis it is B's width about B's line, along B's axis A's width about A's line
  const lo = [0, 0, 0], hi = [0, 0, 0];
  lo[A.a] = B.c[A.a] - B.r - CROSS_AIR_MARGIN; hi[A.a] = B.c[A.a] + B.r + CROSS_AIR_MARGIN;
  lo[B.a] = A.c[B.a] - A.r - CROSS_AIR_MARGIN; hi[B.a] = A.c[B.a] + A.r + CROSS_AIR_MARGIN;
  return !rectMeetsPolygon(lo[0], hi[0], lo[1], hi[1], pts);
}
const PLANE_NORMAL: Record<string, V3> = { xy: [0, 0, 1], xz: [0, -1, 0], yz: [1, 0, 0] };
const rot3 = (v: V3, rot: V3 | undefined): V3 => { // the translator's order: x, then y, then z, about the origin
  let [x, y, z] = v; const [rx, ry, rz] = (rot ?? [0, 0, 0]).map((d) => (d * PI) / 180);
  [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
  [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
  [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
  return [x, y, z];
};
/** a root whose side wall is curved: { what, axis (unit vector of its axis; [0,0,0] when it has none that a bore could follow), radius? } or null */
export interface CurvedAxis { what: string; axis: V3; radius?: number }
export function curvedAxis(root: RootView, G: { byId: Record<string, RootView> }): CurvedAxis | null {
  if (root.kind === 'cylinder') return { what: 'the cylinder', axis: rot3([0, 0, 1], root.rotate), radius: root.radius };
  if (root.kind === 'cone') return { what: 'the cone', axis: rot3([0, 0, 1], root.rotate) };
  if (root.kind === 'extrude') {
    const sk = G.byId[root.target!];
    const curved = sk && (sk.shape === 'circle' || Object.keys(sk.bulges ?? {}).length > 0 || Object.keys(sk.rounds ?? {}).length > 0);
    if (!curved) return null;
    if (root.taper || root.direction || root.alongNormal) return { what: 'the round pad', axis: [0, 0, 0] };
    const n: V3 = sk.frame ? (() => { const u = sk.frame!.u; const v = sk.frame!.v; return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; })() : PLANE_NORMAL[sk.plane ?? 'xy'];
    return { what: 'the round pad', axis: root.rotate ? rot3(n, root.rotate) : n };
  }
  return null;
}

// ---- the planner set -----------------------------------------------------------------------------------------------------------------------
/** What `planFeature` does with a hole under the holes set: the hole planner is asynchronous (the guards cut probe pieces on the engine), so it runs inside translateDoc's step, never here. */
const holePlannerNotSync = (): Plan => {
  throw new Error("the 'holes' planner set plans a hole asynchronously (its guards cut probe pieces on the engine); use translateDoc, or planHole directly");
};

export const HOLES_PROFILE: Profile = {
  name: 'holes',
  // claiming the 'hole' kind is what makes this profile its owner in a composition; the real planning is planHole, called by the step
  planners: { hole: holePlannerNotSync },
  verifies: false,
  initState(st) { st.holes = { chain: {}, allCount: 0, allRows: [], spentS: 0, lastRunS: 0 }; },
  // wording of the generic loop: the step does not use these, they are the base's so the profile is complete
  depSentence: BASE_PROFILE.depSentence,
  noOutline: BASE_PROFILE.noOutline,
  plannerError: BASE_PROFILE.plannerError,
  kernelRefusal: BASE_PROFILE.kernelRefusal,
  // st.allCount of the original: how many bodies the engine held after the last accepted feature
  onAccepted(st, res) { st.holes!.allCount = res.measure!.bodies.length; st.holes!.allRows = rowsOf(res); },
  result: (st) => ({ spentS: st.holes!.spentS }),
  step: holesStep,
};
