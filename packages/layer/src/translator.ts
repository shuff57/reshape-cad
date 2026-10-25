// Selects the planner set. 'base' is exactly the phase 4 base translator (translate.ts); 'extrude-pocket' is base + the extrude-pocket
// group's planners, wording and checks (extrude-pocket.ts). The default is 'base'. Later folds add their own names here.
import type { Feature } from '@shuff57/reshape-script/model-types';
import type { TopoName } from '@shuff57/reshape-script/topo-name';
import type { Resolved } from './resolve-names.js';
import type { PlanCtx, Plan, Profile, TranslateResult, TranslateState } from './translate.js';
import { BASE_PROFILE, FEATURE_KINDS, planFeature, resolveAfter, translateDoc } from './translate.js';
import { EXTRUDE_POCKET_PROFILE } from './extrude-pocket.js';
import type { TranslateCtx } from './types.js';

export type PlannerSet = 'base' | 'extrude-pocket';
export interface TranslatorOptions { planners?: PlannerSet }
export interface Translator {
  planners: PlannerSet;
  FEATURE_KINDS: string[];
  translateDoc(doc: { features: Feature[] }, ctx: TranslateCtx): Promise<TranslateResult>;
  planFeature(f: Feature, st: TranslateState, ctx: PlanCtx): Plan;
  resolveAfter(tr: TranslateResult, doc: { features: Feature[] }, name: TopoName, ctx: TranslateCtx, want?: 'edge' | 'face' | null, targetId?: string | null, beforeId?: string | null): Promise<Resolved>;
}

export const PROFILES: Record<PlannerSet, Profile> = { base: BASE_PROFILE, 'extrude-pocket': EXTRUDE_POCKET_PROFILE };

export function createTranslator(options: TranslatorOptions = {}): Translator {
  const planners = options.planners ?? 'base';
  const profile = PROFILES[planners];
  if (!profile) throw new Error(`unknown planner set '${String(planners)}'`);
  return {
    planners,
    FEATURE_KINDS,
    translateDoc: (doc, ctx) => translateDoc(doc, ctx, profile),
    planFeature: (f, st, ctx) => planFeature(f, st, ctx, profile),
    resolveAfter,
  };
}
