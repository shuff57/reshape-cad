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
//   * the booleans group's combine (join / cut / keep) goes to its step, which ALSO applies the extrude-pocket group's join checks to it (booleans.ts; the booleans group took the kind over from the
//     extrude-pocket group, whose combine was a by-product of its fork); the booleans group's time limit applies to the runs of a combine;
//
//   * the revolve-groove group's spin (revolve) and groove go to its step (the guards that decide a groove from its target's measure, the chain that refuses a later feature on a part whose groove was refused, its
//     time limit on the runs of a groove); a part another step built is read through the measure of kind E (pieces counted);
//
//   * the fillet-chamfer group's blend (every `fillet`: the guard on the topology, the grouped blend, the plain sentences) and the whole-shape round of a primitive its guard refuses (a zero, a negative or a tiny size: the plain
//     primitive stands and the note is a refusal) go to its step; a hollow whose open edge was rounded with a radius as large as the wall is judged by the shell-draft step (G-RIM), which owns the shell (NOTES.md, Fold 7);
//
//   * the patterns-mirror group's pattern, mirror and the cut guards on a pocket / hole (a tool almost on an earlier cut, a thin wall) go to its step (`routeOf`); its time limit
//     applies to every run of a document that has a pattern or a mirror and does not drill;
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
import { PM_PROFILE, PM_KINDS, cutGuard, pmStep } from './patterns-mirror.js';
import { BOOL_PROFILE, BOOL_KINDS, boolStep } from './booleans.js';
import { RG_PROFILE, RG_KINDS, rgStep } from './revolve-groove.js';
import { FC_PROFILE, FC_KINDS, FC_PRIMITIVES, fcStep } from './fillet-chamfer.js';
import { guardPrimitiveRound } from './fc-guard.js';
import type { RoundFeature } from './fc-guard.js';
import type { FView } from './shell-draft.js';

/** The kinds the extrude-pocket group owns here. (Its fork also planned `combine`; in this set the booleans group owns that kind, and the extrude-pocket group's join checks are kept as guards on it.) */
export const EP_KINDS = ['extrude', 'pocket'];
/**
 * The extrude-pocket group's refusals of a combine that are SAFETY checks (they bind unified, see booleans.ts): the join-contact sentence, a flush step a hair thick, a join that does not add up,
 * a slanted round pull run into another part. Everything else the extrude-pocket loop says about a combine (a dependency, "needs two or more parts", "nothing built", a subtract or intersect of several
 * pieces "is not built yet", the kernel's refusal of its command) is the planner's capability or the engine's reply, which the booleans group's executor decides differently. Exported for the tests.
 */
export const EP_COMBINE_SAFETY = [
  /^\S+: the parts of this join only touch along a line or at a point/,
  /^\S+: two faces of the joined parts are .* mm apart/,
  /^\S+ a slanted round pull that runs into the other part cannot be joined yet/,
];
/** The same, for the extrude-pocket group's inclusion-exclusion consistency check of a join: it binds only when ctx.unifiedEpJoinChecks is 'full'. */
export const EP_COMBINE_CONSISTENCY = [/^\S+: the joined part and the sum of its pieces do not add up/];
/** Which loop runs the kinds no group lists. */
export type UnifiedStyle = 'extrude-pocket' | 'holes' | 'shell-draft' | 'patterns-mirror' | 'booleans' | 'revolve-groove' | 'fillet-chamfer';
export type Route = UnifiedStyle;
export interface UnifiedDomain {
  /** the document has an extrude, a pocket or a combine */
  ep: boolean;
  /** the document drills a hole */
  holes: boolean;
  /** the document has a shell or a draft, or a box with every edge bevelled (G-CHAMFER) */
  sd: boolean;
  /** the document has a pattern or a mirror */
  pm: boolean;
  /** the document has a join, a cut or a keep */
  bool: boolean;
  /** the document has a fillet (a round or a bevel of an edge), or a primitive whose whole-shape round the fillet-chamfer guard refuses */
  rg: boolean;
  fc: boolean;
  style: UnifiedStyle;
}

const FV = (f: Feature): FView => f as unknown as FView;
/** a primitive whose whole-shape round the fillet-chamfer group's guard refuses (a negative, a zero or a tiny size; a bevelled box is the shell-draft group's G-CHAMFER and is routed there first) */
export const isRefusedRound = (f: Feature): boolean => FC_PRIMITIVES.includes(f.kind) && (f as unknown as RoundFeature).round !== undefined && !guardPrimitiveRound(f as unknown as RoundFeature).ok;
/** a box with every edge bevelled: the one cross-kind guard of the shell-draft loop that looks at the feature itself, not at what it reads */
export const isChamferBox = (f: Feature): boolean => f.kind === 'box' && !!FV(f).round && FV(f).roundStyle === 'chamfer';

/** Which groups a document uses, and so which loop words the kinds no group lists. */
export function domainOf(doc: { features: Feature[] }): UnifiedDomain {
  let ep = false; let holes = false; let sd = false; let pm = false; let bool = false; let rg = false; let fc = false;
  for (const f of doc.features) {
    if (EP_KINDS.includes(f.kind)) ep = true;
    else if (f.kind === 'hole') holes = true;
    else if (f.kind === 'shell' || f.kind === 'draft' || isChamferBox(f)) sd = true;
    else if (PM_KINDS.includes(f.kind)) pm = true;
    else if (BOOL_KINDS.includes(f.kind)) bool = true;
    else if (RG_KINDS.includes(f.kind)) rg = true;
    else if (FC_KINDS.includes(f.kind) || isRefusedRound(f)) fc = true;
  }
  // no group at all: the extrude-pocket loop too (it words every refusal plainly; the base loop prints the engine's own text)
  const style: UnifiedStyle = ep ? 'extrude-pocket' : holes ? 'holes' : sd ? 'shell-draft' : pm ? 'patterns-mirror' : bool ? 'booleans' : rg ? 'revolve-groove' : fc ? 'fillet-chamfer' : 'extrude-pocket';
  return { ep, holes, sd, pm, bool, rg, fc, style };
}

/**
 * Which step runs a feature. The shell-draft guards that apply to every kind come first; then the kind's owner; then the document's style.
 * Exported for the tests.
 */
export function routeOf(f: Feature, st: TranslateState, ctx?: Pick<TranslateCtx, 'arc' | 'mt'>): Route {
  if (f.kind === 'shell' || f.kind === 'draft') return 'shell-draft';
  if (isChamferBox(f) || voidedDep(FV(f), st)) return 'shell-draft'; // G-CHAMFER, G-VOID (and the voided move / turn, which also carries the mark on)
  if (FC_KINDS.includes(f.kind)) return 'fillet-chamfer';
  if (isRefusedRound(f)) return 'fillet-chamfer'; // the whole-shape round guard of the fillet-chamfer group: a primitive nobody owns, so it binds
  if (PM_KINDS.includes(f.kind)) return 'patterns-mirror';
  // the patterns-mirror group's cut guards (a tool almost on an earlier cut, a wall thinner than 1% of the diagonal) look at a pocket and a hole: the group's step refuses them
  if (ctx && (f.kind === 'pocket' || f.kind === 'hole')) {
    let hit = false;
    try { hit = !!cutGuard(f, st, ctx); } catch { hit = false; } // a malformed pocket / hole is the owner's to refuse, in its own words
    if (hit) return 'patterns-mirror';
  }
  if (f.kind === 'hole') return 'holes';
  if (EP_KINDS.includes(f.kind)) return 'extrude-pocket';
  if (BOOL_KINDS.includes(f.kind)) return 'booleans';
  if (RG_KINDS.includes(f.kind)) return 'revolve-groove';
  return st.unified!.domain.style;
}

/** What a wrapped engine remembers: each run's commands and reply, to find the run that built the feature a step accepted. */
type Seen = Array<{ cmds: Cmd[]; res: RunResult }>;

/**
 * The engine as a step sees it. A document that drills a hole runs EVERY step under { budgetS } like the holes loop (a step with no budget of its own gets
 * BUDGET_S plus 1.5x the last replay), and the CPU the runs report is added to the holes' account. Every run is remembered in `seen`.
 */
function wrapped(ctx: TranslateCtx, st: TranslateState, seen: Seen, budget: boolean, pmBudget: boolean): TranslateCtx {
  const hs = st.holes!;
  return {
    ...ctx,
    runSC: async (cmds: Cmd[], opts?: { budgetS: number }) => {
      const o = opts ?? (budget ? { budgetS: BUDGET_S + 1.5 * hs.lastRunS } : pmBudget ? { budgetS: ((ctx.pmBudgetMs ?? 600000) + 2 * st.pm!.accMs + 1000) / 1000 } : undefined);
      const res = o === undefined ? await ctx.runSC(cmds) : await ctx.runSC(cmds, o);
      if (!opts && budget) hs.spentS += (res?.cpuMs ?? 0) / 1000;
      if (res?.ok) seen.push({ cmds, res });
      return res;
    },
  };
}

/**
 * Two kinds of measure live side by side in a document that uses two or more groups. The extrude-pocket group's (E) counts the pieces the engine splits off a
 * body ("b1 (2)") and the shells; the other loops' (P: exact names; shells added here, which the holes guard G-SHELLS reads) do not find pieces themselves, so the pieces an E-kind step left are handed to them by name (toP). A guard reads
 * the kind it was written for, whichever step built the feature it reads: the extrude-pocket after-the-build checks compare shell counts (a cavity sealed
 * inside the part), which a measure without them silently passes. A step is given the maps of its own kind; what it accepts is converted for the other.
 */
interface ByKind { measure: Record<string, Aggregate>; bodies: Record<string, string[]> }

/** The measure of kind E of what a P-kind step built (pieces counted, shells summed), from the reply of the run that built it. */
const toE = (m: Aggregate, r: RunResult | undefined): Aggregate => (r?.measure ? aggregate(r, m.bodies, true) ?? m : m);
/**
 * The measure of kind P (exact names, shells summed) of what an E-kind step built: EVERY piece the E-kind measure counted, each by its exact name. A P-kind step
 * names its bodies exactly, so the pieces must be on its list: with the " (n)" names stripped, a cut, keep or mirror of a part that is two pieces took only the
 * first piece (audit BOOL-9, PM-5: built 10500, 7500 and 18000 where the part is 9000, 3000 and 24000), and a step that refuses a target of several pieces never
 * saw them. See docs/spikes/solidcraft-referee/GUARD-MULTIPIECE.md.
 */
const toP = (m: Aggregate, r: RunResult | undefined): Aggregate => (r?.measure ? aggregateOf(r, [...new Set(m.bodies)]) ?? m : m);

export async function unifiedStep(f: Feature, idx: number, env: LoopEnv): Promise<void> {
  const { st, accepted } = env;
  const route = routeOf(f, st, env.ctx);
  const dom = st.unified!.domain;
  const mixed = Number(dom.ep) + Number(dom.holes) + Number(dom.sd) + Number(dom.pm) + Number(dom.bool) + Number(dom.rg) + Number(dom.fc) >= 2;
  const wrap = mixed || (dom.holes && route !== 'holes');
  const seen: Seen = [];
  const env2: LoopEnv = wrap ? { ...env, ctx: wrapped(env.ctx, st, seen, dom.holes, dom.pm) } : env;
  // the measure of the kind this step reads
  // (a spin / groove reads the measure of kind E: pieces counted, as its own aggregate counts them)
  const kind: 'E' | 'P' = route === 'extrude-pocket' || route === 'revolve-groove' ? 'E' : 'P';
  const maps = st.unified!.maps;
  if (mixed) { st.measure = maps[kind].measure; st.bodies = maps[kind].bodies; }
  const before = st.accLen[f.id];
  const nOut = env.out.length;
  if (route === 'holes') await holesStep(f, idx, env2);
  else if (route === 'shell-draft') await shellDraftStep(f, idx, env2);
  else if (route === 'patterns-mirror') await pmStep(f, idx, env2);
  else if (route === 'booleans') await boolStep(f, idx, env2);
  else if (route === 'revolve-groove') await rgStep(f, idx, env2);
  else if (route === 'fillet-chamfer') await fcStep(f, idx, env2);
  else await genericStep(f, idx, env2, EXTRUDE_POCKET_PROFILE);
  if (route === 'fillet-chamfer') {
    // the fillet-chamfer step keeps the RAW text of a refusal in st.refused (as its original does); in unified a feature of another group that depends on a refused blend is worded from the plain sentence
    for (const n of env.out.slice(nOut)) if (n.status === 'refused' && n.refusal !== undefined && st.refused[n.id] !== undefined) st.refused[n.id] = n.refusal;
    if (mixed) {
      // a run of blends is one call that builds several features: every feature this step built (or left standing with a refusal) is carried over to the other kind of measure
      const other: 'E' | 'P' = 'E';
      for (const n of env.out.slice(nOut)) {
        const mm = st.measure[n.id];
        if (st.accLen[n.id] === undefined || !mm || maps[other].measure[n.id]) continue;
        const rr = seen.find((x) => x.cmds.length === st.accLen[n.id] && x.cmds.every((c, i) => c === accepted[i]))?.res;
        if (mm.shells === undefined) mm.shells = toE(mm, rr).shells;
        const o = toE(mm, rr);
        maps[other].measure[n.id] = o;
        maps[other].bodies[n.id] = o.bodies;
      }
    }
    return;
  }
  if (!mixed) return;
  const m = st.measure[f.id];
  if (st.accLen[f.id] === before || !m) return; // refused or a no-op: nothing to carry over
  const r = seen.find((x) => x.cmds.length === accepted.length && x.cmds.every((c, i) => c === accepted[i]))?.res;
  const other: 'E' | 'P' = kind === 'E' ? 'P' : 'E';
  if ((kind === 'P' || route === 'revolve-groove') && m.shells === undefined) m.shells = toE(m, r).shells; // the shell-draft and revolve-groove aggregates have none; the holes guard G-SHELLS and the extrude-pocket sealed-cavity check read it
  const o = kind === 'E' ? toP(m, r) : toE(m, r);
  maps[other].measure[f.id] = o;
  maps[other].bodies[f.id] = o.bodies;
}

export const UNIFIED_PROFILE: Profile = {
  name: 'unified',
  // claiming every kind a group lists keeps planFeature honest about what this set plans (a hole, a shell and a draft are planned asynchronously by the step)
  planners: { ...EXTRUDE_POCKET_PROFILE.planners, ...HOLES_PROFILE.planners, ...SHELL_DRAFT_PROFILE.planners, ...PM_PROFILE.planners, ...BOOL_PROFILE.planners, ...RG_PROFILE.planners, ...FC_PROFILE.planners },
  verifies: true,
  initState(st, doc) {
    EXTRUDE_POCKET_PROFILE.initState(st);
    HOLES_PROFILE.initState(st);
    SHELL_DRAFT_PROFILE.initState(st);
    PM_PROFILE.initState(st);
    BOOL_PROFILE.initState(st, doc);
    RG_PROFILE.initState(st);
    FC_PROFILE.initState(st);
    st.unified = { domain: domainOf(doc ?? { features: [] }), maps: { E: { measure: {}, bodies: {} }, P: { measure: {}, bodies: {} } } };
  },
  // wording of the synchronous planFeature only (the step chooses the wording of a run by the document's style): the extrude-pocket group's, the first entry
  depSentence: EXTRUDE_POCKET_PROFILE.depSentence,
  noOutline: EXTRUDE_POCKET_PROFILE.noOutline,
  plannerError: EXTRUDE_POCKET_PROFILE.plannerError,
  kernelRefusal: EXTRUDE_POCKET_PROFILE.kernelRefusal,
  onAccepted(st, res, m, plan, acc) {
    EXTRUDE_POCKET_PROFILE.onAccepted!(st, res, m, plan);
    HOLES_PROFILE.onAccepted!(st, res, m, plan);
    PM_PROFILE.onAccepted!(st, res, m, plan, acc);
    BOOL_PROFILE.onAccepted!(st, res, m, plan, acc);
    RG_PROFILE.onAccepted!(st, res, m, plan);
    SHELL_DRAFT_PROFILE.onAccepted!(st, res, m, plan);
  },
  result: (st) => (st.unified!.domain.holes ? { spentS: st.holes!.spentS } : {}),
  step: unifiedStep,
};
