// The extrude-pocket group's cut-consistency check (extrude-pocket.ts `cutConsistency`, its sentence as shipped), given to the planner sets that have no
// after-the-build check of a pocket: base, holes, shell-draft, patterns-mirror, booleans, revolve-groove, fillet-chamfer.
//
// Why (docs/spikes/solidcraft-referee/GUARD-SKETCH-VOLUME.md, "The pocket"): rect(40, 30) with chamfer(1, d) cut 5 mm into box(60, 50, 20) builds 53999.99750 mm3 at
// d = 1e-4 and 53999.99875 at d = 5e-5 on the pinned kernel (4.6e-8 and 2.3e-8 off the closed form, the planar bar is 1e-9), with the right commands and no refusal, in
// those seven sets. 'extrude-pocket' and 'unified' refuse it already (this same check, and the outline guard). Owner's choice (option a): the same check, the same
// sentence, at the cost of one extra engine run per pocket.
//
// What the check does, exactly as in the extrude-pocket group: the tool the pocket cuts with is built as a separate body (the pocket's own commands, with the cut made a
// new body) and intersected with the part in one scratch run; the volume the part lost must equal that intersection. The set's own sentence pipeline is not used: the
// refusal is the group's sentence, verbatim. Only that check is reused (not the group's "does not touch", "sealed cavity", "stops short of a face" or curved-accuracy
// checks). No kernel is named; the scratch run goes through the run function the step uses (ctx.runSC, with the step's own time limit where it has one).
//
// Off with ctx.skipSketchVolume, the switch of the other post-build sketch check (sketch-volume.ts): the fake engines of the differential tests report bounding-box
// volumes and the originals they are compared with have neither check. Never set in production.
import type { Feature } from '@shuff57/reshape-script/model-types';
import type { Cmd, RunResult, TranslateCtx } from './types.js';
import { aggregate } from './translate.js';
import type { SceneEntry } from './translate.js';
import { cutConsistency } from './extrude-pocket.js';

/** The guard code on a refused note. */
export const POCKET_CUT_GUARD = 'POCKET-CUT';

/**
 * The reply of the run that built the commands accepted so far, by the accepted list itself (one list per translation). Every step records it right after it accepts a
 * feature, so the check knows the scene before a pocket without running the engine again. A list whose length no longer matches its record is measured afresh.
 */
const lastRun = new WeakMap<Cmd[], { len: number; res: RunResult }>();
export function rememberRun(accepted: Cmd[], res: RunResult | undefined): void {
  if (res?.ok && res.measure) lastRun.set(accepted, { len: accepted.length, res });
}

type Run = (cmds: Cmd[]) => RunResult | Promise<RunResult>;

/**
 * The check as a step calls it, after a pocket's engine run succeeded and the set's own checks passed, before the pocket is accepted. `res` is that run's reply,
 * `variant` the pocket's commands, `produces` the part it cuts. null = accepted; a string = the extrude-pocket group's refusal sentence. A scratch run that fails or
 * throws, or a pocket whose cut is not one solid.extrude, is inconclusive and accepted, as in the group.
 */
export async function pocketCutRefusal(f: Feature, ctx: Pick<TranslateCtx, 'skipSketchVolume'>, res: RunResult, accepted: Cmd[], variant: Cmd[], produces: string[], run: Run): Promise<string | null> {
  if (f.kind !== 'pocket' || ctx.skipSketchVolume || !res.measure) return null;
  const k = variant.map((c) => c.command === 'solid.extrude' && c.params?.operation === 'cut').lastIndexOf(true);
  if (k < 0) return null;
  try {
    const rec = lastRun.get(accepted);
    const prev: RunResult = rec && rec.len === accepted.length ? rec.res : accepted.length ? await run(accepted) : { ok: true, measure: { bodies: [] } };
    if (!prev.ok || !prev.measure) return null;
    const before = aggregate(prev, produces, true);
    const m = aggregate(res, produces, true);
    if (!before || !m) return null;
    const scene: SceneEntry[] = prev.measure.bodies.map((b) => ({ name: b.name, vol: b.volume_mm3, bbox: [...b.bbox.min, ...b.bbox.max], shells: b.kernel?.shells ?? 1 }));
    const { targets: _t, ...cut } = variant[k].params as Record<string, unknown>;
    const build = (body: Record<string, unknown>) => ({ cmds: variant.map((c, i) => (i === k ? { ...c, params: { ...cut, ...body } } : c)) });
    const env = { accepted: accepted.slice(), variant, runSC: (cmds: Cmd[]) => run(cmds), checks: [] as unknown[], scene };
    return (await cutConsistency(f, m, before, env, { pieces: produces, build })).refusal;
  } catch { return null; } // a scratch run that throws: inconclusive, as a failed one is
}
