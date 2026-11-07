// An engine reply that says `ok` while a body in its measure is an error (GUARD-FILLET-CHAIN.md, fix 2). Seen on the SolidCore probe
// (SOLIDCORE-PROBE-0.40.0-rc.2.md): a sphere of radius 2 at (1e6, -1e6, 1e6) answers ok, and its body is { name, error: "...", material } with no volume and
// no bounding box. Every reader of a body result (aggregate and its copies, the scene, the after-the-build checks) reads `bbox.min`, so translateDoc threw a
// TypeError and the student got no sentence and no part.
//
// The seam: translateDoc wraps ctx.runSC once (withErroredBodies). A reply with an errored body becomes a FAILED reply (ok: false, `erroredBody` lists the
// bodies), so every reader in every set, the scratch runs of the after-the-build checks included, takes its existing failure path and never reads the body.
// Each set's step then words the feature's refusal with the owner's sentence (erroredBodySentence) and the guard code ERRORED_BODY_GUARD.
// No kernel is named: what an errored body is comes from the reply's shape only.
import type { BodyMeasure, RunResult, TranslateCtx } from './types.js';

/** The guard code on a feature refused because the engine's reply carried an errored body. */
export const ERRORED_BODY_GUARD = 'ERRORED-BODY';
/** The owner-approved sentence (2026-11-07), with the feature's id prefixed as the planners prefix it. */
export const erroredBodySentence = (f: { id: string; kind: string }): string => `${f.id} (${f.kind}): this shape could not be built, so it is shown without it; check its sizes and position.`;

const isV3 = (v: unknown): boolean => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number');
/** The names of the bodies of an ok reply that are errors: a body that carries `error`, or has no bounding box to read. */
export function erroredBodies(res: RunResult | null | undefined): string[] {
  if (!res || !res.ok || !res.measure || !Array.isArray(res.measure.bodies)) return [];
  return res.measure.bodies.filter((b: BodyMeasure & { error?: unknown }) => b == null || b.error != null || !b.bbox || !isV3(b.bbox.min) || !isV3(b.bbox.max)).map((b) => String(b?.name ?? '(unnamed)'));
}
/** The failed reply that stands for an ok reply with errored bodies (the measure is kept for the record). */
function asFailed(res: RunResult): RunResult {
  const bad = erroredBodies(res);
  if (!bad.length) return res;
  const why = (res.measure!.bodies.find((b) => b && (b as { error?: unknown }).error != null) as { error?: unknown } | undefined)?.error;
  return { ...res, ok: false, erroredBody: bad, failed: { command: 'inspect.measure', error: `the engine answered ok, but ${bad.join(', ')} ${bad.length === 1 ? 'is' : 'are'} an error${why != null ? ` (${String(why)})` : ''}` } };
}
const isThenable = (x: unknown): x is PromiseLike<RunResult> => !!x && typeof (x as { then?: unknown }).then === 'function';
/** ctx with its runSC wrapped so an errored body comes back as a failed reply. Synchronous stays synchronous; the arguments and `this` pass through unchanged. */
export function withErroredBodies<C extends TranslateCtx>(ctx: C): C {
  const run = ctx.runSC;
  if ((run as { erroredBodies?: true }).erroredBodies) return ctx;
  const wrapped = function (this: unknown, ...a: Parameters<TranslateCtx['runSC']>) {
    const r = run.apply(ctx, a);
    return isThenable(r) ? Promise.resolve(r).then(asFailed) : asFailed(r);
  } as TranslateCtx['runSC'] & { erroredBodies?: true };
  wrapped.erroredBodies = true;
  return { ...ctx, runSC: wrapped };
}
