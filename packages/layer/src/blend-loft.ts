// The blend-loft group's step in the 'unified' set (the page's). Before this fold the page refused every loft (host-entry.mjs NOT_YET, "Phase 2 rest:
// blend-loft"), because the group's guard (blend-loft.guard.mjs, accepted) was not wired into packages/. Here it is:
//   * PRE-FLIGHT: blend-loft-guard.ts guardBlend on the solved doc, before the engine runs. A loft outside the supported set is refused in the guard's sentence,
//     with the guard code BL-<code> (BL-sides, BL-needle, ...). The page passes no `neutral` / `argOrder` (see blend-loft-guard.ts): the guard's conservative rule holds.
//   * BUILD: the base planner (translate.ts case 'blend': solid.loft of the two sketches) through the generic step, worded as the extrude-pocket group words
//     a kind no group lists (the document's default style).
//   * AFTER: genericStep runs postCheckBlend (circle <-> circle against the frustum, a straight-sided pair against the prismatoid) when ctx.blendLoftCheck is set,
//     which only this step sets, so no other set (and no differential test of another group) sees the check. ctx.skipSketchVolume (the fake engines) turns it off.
import type { Feature } from '@shuff57/reshape-script/model-types';
import { genericStep } from './translate.js';
import type { LoopEnv, Profile } from './translate.js';
import { guardBlend } from './blend-loft-guard.js';

export * as blendLoftGuard from './blend-loft-guard.js';

/** The kinds this group owns. */
export const BL_KINDS = ['blend'];
/** The guard code of an after-the-build refusal. */
export const BL_VOLUME_GUARD = 'BL-volume';

export async function blendLoftStep(f: Feature, idx: number, env: LoopEnv, profile: Profile): Promise<void> {
  const { doc, ctx, st, out } = env;
  let v: ReturnType<typeof guardBlend> = null;
  try { v = guardBlend(doc, f, { outlineOf: ctx.arc.outlineOf }); } catch { v = null; } // a malformed blend is the planner's to refuse, in its own words
  if (v) {
    st.refused[f.id] = v.sentence;
    out.push({ id: f.id, kind: f.kind, status: 'refused', refusal: v.sentence, guard: `BL-${v.code}`, commands: [] });
    return;
  }
  await genericStep(f, idx, { ...env, ctx: { ...ctx, blendLoftCheck: true } }, profile);
}
