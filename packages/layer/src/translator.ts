// Selects the planner set. 'base' is exactly the phase 4 base translator (translate.ts); 'extrude-pocket' is base + the extrude-pocket
// group's planners, wording and checks (extrude-pocket.ts); 'holes' is base + the holes group's guarded hole planner and loop (holes.ts).
// 'shell-draft' is base + the shell-draft group's guarded hollow and draft planners and loop (shell-draft.ts).
// The default is 'base'. Later folds add their own names here.
//
// Sets compose: planners: ['extrude-pocket', 'holes']. Later entries override earlier ones per feature KIND (the owner of a kind is the last
// set that lists a planner for it; kinds no set lists belong to the FIRST entry). Everything that decides one feature's own result is taken from
// the owner of its kind; bookkeeping (state set-up, what an accepted feature updates) runs for every member. See composeProfiles in translate.ts
// and NOTES.md for the rule and its consequences.
import type { Feature } from '@shuff57/reshape-script/model-types';
import type { TopoName } from '@shuff57/reshape-script/topo-name';
import type { Resolved } from './resolve-names.js';
import type { PlanCtx, Plan, Profile, TranslateResult, TranslateState } from './translate.js';
import { BASE_PROFILE, FEATURE_KINDS, composeProfiles, planFeature, resolveAfter, translateDoc } from './translate.js';
import { EXTRUDE_POCKET_PROFILE } from './extrude-pocket.js';
import { HOLES_PROFILE } from './holes.js';
import { SHELL_DRAFT_PROFILE } from './shell-draft.js';
import type { TranslateCtx } from './types.js';

export type PlannerSet = 'base' | 'extrude-pocket' | 'holes' | 'shell-draft';
export interface TranslatorOptions { planners?: PlannerSet | PlannerSet[] }
export interface Translator {
  planners: PlannerSet | PlannerSet[];
  FEATURE_KINDS: string[];
  translateDoc(doc: { features: Feature[] }, ctx: TranslateCtx): Promise<TranslateResult>;
  planFeature(f: Feature, st: TranslateState, ctx: PlanCtx): Plan;
  resolveAfter(tr: TranslateResult, doc: { features: Feature[] }, name: TopoName, ctx: TranslateCtx, want?: 'edge' | 'face' | null, targetId?: string | null, beforeId?: string | null): Promise<Resolved>;
}

export const PROFILES: Record<PlannerSet, Profile> = { base: BASE_PROFILE, 'extrude-pocket': EXTRUDE_POCKET_PROFILE, holes: HOLES_PROFILE, 'shell-draft': SHELL_DRAFT_PROFILE };

export function createTranslator(options: TranslatorOptions = {}): Translator {
  const planners = options.planners ?? 'base';
  const names = Array.isArray(planners) ? planners : [planners];
  if (!names.length) throw new Error('planners: an empty list of planner sets');
  const members = names.map((n) => {
    const p = Object.prototype.hasOwnProperty.call(PROFILES, n) ? PROFILES[n] : undefined;
    if (!p) throw new Error(`unknown planner set '${String(n)}'`);
    return p;
  });
  if (new Set(names).size !== names.length) throw new Error(`planners: a planner set is listed twice (${names.join(', ')})`);
  const profile = composeProfiles(members);
  return {
    planners,
    FEATURE_KINDS,
    translateDoc: (doc, ctx) => translateDoc(doc, ctx, profile),
    planFeature: (f, st, ctx) => planFeature(f, st, ctx, profile),
    resolveAfter,
  };
}
