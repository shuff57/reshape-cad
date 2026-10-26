// The ORIGINAL booleans translator and the way the group's runner (docs/spikes/solidcraft-referee/contract/run-booleans.mjs) wires it: shared by the differential test and the real-kernel replay.
// Nothing here is the port; it only loads and wires the original files, which are not touched.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const imp = (p) => import(pathToFileURL(p).href);
/** { tr, G, SL, RG }: the generated translator, the guard, the slowness predictor and the revolve-groove guard (for profileInfo), from the contract directory. */
export async function loadOriginal(contract) {
  return {
    tr: await imp(path.join(contract, 'bool-translate-r3.mjs')),
    G: await imp(path.join(contract, 'booleans.guard.mjs')),
    SL: await imp(path.join(contract, 'booleans.slow.mjs')),
    RG: await imp(path.join(contract, 'revolve-groove.guard.mjs')),
  };
}
/**
 * The context the original is called with, as run-booleans.mjs builds its `gctx` (guarded mode). `lib` is { arc, mt }: the sketch outline module and model-types. useMt false leaves ctx.mt out of
 * the context (the runner always passes it; the closures below use the module either way).
 */
export function origCtx(orig, lib, doc, runSC, useMt = true) {
  const { arc, mt } = lib;
  const featById = Object.fromEntries(doc.features.map((f) => [f.id, f]));
  const G = orig.G; const SL = orig.SL; const RG = orig.RG;
  const ringOf = (feat) => { if (feat?.kind !== 'revolve') return null; const sk = featById[feat.target]; if (!sk) return null; const p = RG.profileInfo(sk, arc); if (!p.ok) return null; const tol = RG.AXIS_TOL * Math.max(1, p.scale); return (p.umin > tol || p.umax < -tol) ? { angle: feat.angle } : null; };
  const sketchInfo = (skId) => {
    const sk = featById[skId]; if (!sk || sk.kind !== 'sketch') return null;
    try {
      const fr = mt.sketchFrameOf(sk); const o = arc.outlineOf(sk);
      if (sk.shape === 'circle') return { n: fr.n, edgeNormals: [], arcs: true };
      const pts = o.points ?? sk.points; const bul = o.bulges ?? sk.bulges ?? {};
      const edgeNormals = []; let arcs = false;
      for (let i = 0; i < pts.length; i++) {
        const j = (i + 1) % pts.length; const dx = pts[j][0] - pts[i][0]; const dy = pts[j][1] - pts[i][1]; const L = Math.hypot(dx, dy); if (L < 1e-12) continue;
        if (Math.abs(bul[i] ?? 0) > 1e-12) { arcs = true; continue; }
        const nx = dy / L; const ny = -dx / L;
        edgeNormals.push([0, 1, 2].map((k) => fr.u[k] * nx + fr.v[k] * ny));
      }
      return { n: fr.n, edgeNormals, arcs, axis: fr.v };
    } catch { return null; }
  };
  const affects = {}; for (const g of doc.features) if (['hole', 'pocket', 'groove', 'shell', 'fillet', 'draft'].includes(g.kind)) { const t = g.kind === 'pocket' || g.kind === 'groove' ? g.into : g.target; if (t) (affects[t] ??= []).push(g.id); }
  return {
    arc, ...(useMt ? { mt } : {}), runSC, resolveAt: () => null,
    guard: (f, ops) => G.guardCombine(f, ops.map((o) => ({ id: o.id, d: G.describe(o.measure, o.feat, { ring: ringOf(o.feat), pieces: o.pieces, info: SL.orient(o.id, featById, sketchInfo, affects) }) }))),
    reusedTools: (f) => G.reusedTools(f, doc.features), plain: (t, f) => G.plainSentence(t, f), plainPieces: (t) => G.plainPieces(t), after: (f, m, before, boxes) => G.afterCombine(f, m, before, boxes), featById,
  };
}
