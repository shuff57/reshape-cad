// The 'unified' planner set: base + every group's planners in ONE loop, in which every group's guards run on every feature they apply to.
//
// Why it exists. 'extrude-pocket', 'holes' and 'shell-draft' each bring planners AND a loop (extrude-pocket: the generic loop with its wording and
// after-the-build checks; holes: holesStep; shell-draft: shellDraftStep). Composing them in an array (translator.ts, NOTES.md fold 3) hands each feature to
// the loop of the set that owns its KIND, so a guard that lives in a loop only runs for the kinds its own set owns: G-VOID (nothing but a move or a turn may
// follow a closed hollow) and G-CHAMFER (a box with every edge bevelled) stop protecting the other sets' kinds, and a move or a turn of a closed hollow does
// not carry the 'closed hollow' mark. This set closes those gaps without changing any single set (they stay the references):
//
//   * every feature goes through exactly ONE of the existing steps, chosen by `routeOf` below (so no engine call of a single set is reordered, and nothing is
//     re-implemented that could drift from the set it came from);
//   * the cross-kind guards of the shell-draft loop (G-VOID for every kind but shell / move / rotate, the voided-move post-check and the mark it carries,
//     G-CHAMFER) decide the route first: a feature one of them applies to is run by the shell-draft step, whatever its kind;
//   * the holes budget (every engine run of a document that drills a hole runs under { budgetS }, a timed-out run is refused) is applied to every step of such
//     a document, not only to the holes' own;
//   * the shells count the holes guard G-SHELLS reads from the host's measure is present on every measure of such a document, whichever step built it.
//
// The style of a document (the wording of the kinds no group lists, whether the engine runs carry { budgetS }, the shape of the note) is decided by
// the groups the document uses (`domainOf`): one group present = that group's loop for everything it does not own, exactly as the single set; several =
// the first of extrude-pocket, holes, shell-draft; none = the extrude-pocket loop's (it words every refusal plainly; the base loop prints the engine's text). See NOTES.md ("Unified") for the table.
import type { Feature } from '@shuff57/reshape-script/model-types';
import type { Cmd, RunResult, TranslateCtx } from './types.js';
import { aggregate, genericStep } from './translate.js';
import type { Aggregate, LoopEnv, Profile, TranslateState } from './translate.js';
import { EXTRUDE_POCKET_PROFILE } from './extrude-pocket.js';
import { BUDGET_S, HOLES_PROFILE, aggregateOf, holesStep } from './holes.js';
import { SHELL_DRAFT_PROFILE, shellDraftStep, voidedDep } from './shell-draft.js';
import type { FView } from './shell-draft.js';

/** The kinds the extrude-pocket group owns. */
export const EP_KINDS = ['extrude', 'pocket', 'combine'];
/** Which loop runs the kinds no group lists. */
export type UnifiedStyle = 'extrude-pocket' | 'holes' | 'shell-draft';
export type Route = UnifiedStyle;
export interface UnifiedDomain {
  /** the document has an extrude, a pocket or a combine */
  ep: boolean;
  /** the document drills a hole */
  holes: boolean;
  /** the document has a shell or a draft, or a box with every edge bevelled (G-CHAMFER) */
  sd: boolean;
  style: UnifiedStyle;
}

const FV = (f: Feature): FView => f as unknown as FView;
/** a box with every edge bevelled: the one cross-kind guard of the shell-draft loop that looks at the feature itself, not at what it reads */
export const isChamferBox = (f: Feature): boolean => f.kind === 'box' && !!FV(f).round && FV(f).roundStyle === 'chamfer';

/** Which groups a document uses, and so which loop words the kinds no group lists. */
export function domainOf(doc: { features: Feature[] }): UnifiedDomain {
  let ep = false; let holes = false; let sd = false;
  for (const f of doc.features) {
    if (EP_KINDS.includes(f.kind)) ep = true;
    else if (f.kind === 'hole') holes = true;
    else if (f.kind === 'shell' || f.kind === 'draft' || isChamferBox(f)) sd = true;
  }
  // no group at all: the extrude-pocket loop too (it words every refusal plainly; the base loop prints the engine's own text)
  const style: UnifiedStyle = ep ? 'extrude-pocket' : holes ? 'holes' : sd ? 'shell-draft' : 'extrude-pocket';
  return { ep, holes, sd, style };
}

/**
 * Which step runs a feature. The shell-draft guards that apply to every kind come first; then the kind's owner; then the document's style.
 * Exported for the tests.
 */
export function routeOf(f: Feature, st: TranslateState): Route {
  if (f.kind === 'shell' || f.kind === 'draft') return 'shell-draft';
  if (isChamferBox(f) || voidedDep(FV(f), st)) return 'shell-draft'; // G-CHAMFER, G-VOID (and the voided move / turn, which also carries the mark on)
  if (f.kind === 'hole') return 'holes';
  if (EP_KINDS.includes(f.kind)) return 'extrude-pocket';
  return st.unified!.domain.style;
}

/** What a wrapped engine remembers: each run's commands and reply, to find the run that built the feature a step accepted. */
type Seen = Array<{ cmds: Cmd[]; res: RunResult }>;

/**
 * The engine as a step sees it. A document that drills a hole runs EVERY step under { budgetS } like the holes loop (a step with no budget of its own gets
 * BUDGET_S plus 1.5x the last replay), and the CPU the runs report is added to the holes' account. Every run is remembered in `seen`.
 */
function wrapped(ctx: TranslateCtx, st: TranslateState, seen: Seen, budget: boolean): TranslateCtx {
  const hs = st.holes!;
  return {
    ...ctx,
    runSC: async (cmds: Cmd[], opts?: { budgetS: number }) => {
      const o = opts ?? (budget ? { budgetS: BUDGET_S + 1.5 * hs.lastRunS } : undefined);
      const res = o === undefined ? await ctx.runSC(cmds) : await ctx.runSC(cmds, o);
      if (!opts && budget) hs.spentS += (res?.cpuMs ?? 0) / 1000;
      if (res?.ok) seen.push({ cmds, res });
      return res;
    },
  };
}

/**
 * Two kinds of measure live side by side in a document that uses two or more groups. The extrude-pocket group's (E) counts the pieces the engine splits off a
 * body ("b1 (2)") and the shells; the other loops' (P: names only; shells added here, which the holes guard G-SHELLS reads) do not count pieces. A guard reads
 * the kind it was written for, whichever step built the feature it reads: the extrude-pocket after-the-build checks compare shell counts (a cavity sealed
 * inside the part), which a measure without them silently passes. A step is given the maps of its own kind; what it accepts is converted for the other.
 */
interface ByKind { measure: Record<string, Aggregate>; bodies: Record<string, string[]> }
const stripPiece = (n: string): string => n.replace(/ \(\d+\)$/, '');

/** The measure of kind E of what a P-kind step built (pieces counted, shells summed), from the reply of the run that built it. */
const toE = (m: Aggregate, r: RunResult | undefined): Aggregate => (r?.measure ? aggregate(r, m.bodies, true) ?? m : m);
/** The measure of kind P (exact names, shells summed) of what an E-kind step built. */
const toP = (m: Aggregate, r: RunResult | undefined): Aggregate => (r?.measure ? aggregateOf(r, [...new Set(m.bodies.map(stripPiece))]) ?? m : m);

export async function unifiedStep(f: Feature, idx: number, env: LoopEnv): Promise<void> {
  const { st, accepted } = env;
  const route = routeOf(f, st);
  const dom = st.unified!.domain;
  const mixed = Number(dom.ep) + Number(dom.holes) + Number(dom.sd) >= 2;
  const wrap = mixed || (dom.holes && route !== 'holes');
  const seen: Seen = [];
  const env2: LoopEnv = wrap ? { ...env, ctx: wrapped(env.ctx, st, seen, dom.holes) } : env;
  // the measure of the kind this step reads
  const kind: 'E' | 'P' = route === 'extrude-pocket' ? 'E' : 'P';
  const maps = st.unified!.maps;
  if (mixed) { st.measure = maps[kind].measure; st.bodies = maps[kind].bodies; }
  const before = st.accLen[f.id];
  if (route === 'holes') await holesStep(f, idx, env2);
  else if (route === 'shell-draft') await shellDraftStep(f, idx, env2);
  else await genericStep(f, idx, env2, EXTRUDE_POCKET_PROFILE);
  if (!mixed) return;
  const m = st.measure[f.id];
  if (st.accLen[f.id] === before || !m) return; // refused or a no-op: nothing to carry over
  const r = seen.find((x) => x.cmds.length === accepted.length && x.cmds.every((c, i) => c === accepted[i]))?.res;
  const other: 'E' | 'P' = kind === 'E' ? 'P' : 'E';
  if (kind === 'P' && m.shells === undefined) m.shells = toE(m, r).shells; // the shell-draft aggregate has none; the holes guard G-SHELLS reads it
  const o = kind === 'E' ? toP(m, r) : toE(m, r);
  maps[other].measure[f.id] = o;
  maps[other].bodies[f.id] = o.bodies;
}

export const UNIFIED_PROFILE: Profile = {
  name: 'unified',
  // claiming every kind a group lists keeps planFeature honest about what this set plans (a hole, a shell and a draft are planned asynchronously by the step)
  planners: { ...EXTRUDE_POCKET_PROFILE.planners, ...HOLES_PROFILE.planners, ...SHELL_DRAFT_PROFILE.planners },
  verifies: true,
  initState(st, doc) {
    EXTRUDE_POCKET_PROFILE.initState(st);
    HOLES_PROFILE.initState(st);
    SHELL_DRAFT_PROFILE.initState(st);
    st.unified = { domain: domainOf(doc ?? { features: [] }), maps: { E: { measure: {}, bodies: {} }, P: { measure: {}, bodies: {} } } };
  },
  // wording of the synchronous planFeature only (the step chooses the wording of a run by the document's style): the extrude-pocket group's, the first entry
  depSentence: EXTRUDE_POCKET_PROFILE.depSentence,
  noOutline: EXTRUDE_POCKET_PROFILE.noOutline,
  plannerError: EXTRUDE_POCKET_PROFILE.plannerError,
  kernelRefusal: EXTRUDE_POCKET_PROFILE.kernelRefusal,
  onAccepted(st, res, m, plan) {
    EXTRUDE_POCKET_PROFILE.onAccepted!(st, res, m, plan);
    HOLES_PROFILE.onAccepted!(st, res, m, plan);
  },
  result: (st) => (st.unified!.domain.holes ? { spentS: st.holes!.spentS } : {}),
  step: unifiedStep,
};
