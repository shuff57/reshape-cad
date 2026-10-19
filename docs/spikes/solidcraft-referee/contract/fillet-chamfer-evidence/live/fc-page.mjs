// SPIKE, referee only. Runs INSIDE the shipping pane's page (served by fc-host.mjs under /fc/). One call = one case, on the pane's own solidcraft wasm through window.__host.bridge.
//   mode 'pane'    : the forked translator with every FC switch off = phase7 translate-p4 behaviour (the shipping pane; fc-live-check.mjs proves it equals window.__host.run on recorded cases)
//   mode 'contract': guard + group on  (the contract: fc-guard.mjs on the real truck topology, grouped same-size blends, fc-sentences.mjs for the one-sentence refusals)
//   opts.guard / opts.group switch the two halves separately.
import * as host from '/pane/bundle/host-lib.js';
import { translateDoc } from './lib/translate-fc.mjs';
import * as guardLib from './fc-guard.mjs';
import { plainSentence, guardSentence } from './fc-sentences.mjs';

const bridge = () => window.__host.bridge;
const slim = (m) => (m ? { volume: m.volume, faces: m.faces, kernelFaces: m.kernelFaces, bbox: m.bbox, com: m.com, faceTypes: m.faceTypes, curved: m.curved, bodies: m.bodies } : null);

export async function run(docIn, opts = {}) {
  const t0 = performance.now();
  const doc = host.solveDoc(docIn);
  const runSC = (cmds) => bridge().execute(cmds, { fresh: true });
  const topologyOf = (cmds) => bridge().execute(cmds, { fresh: true, topology: true });
  const mode = opts.mode ?? 'contract';
  const guard = opts.guard ?? mode === 'contract';
  const group = opts.group ?? mode === 'contract';
  const ctx = { arc: host.arc, mt: host.mt, runSC, resolveAt: () => null, soups: {}, topologyOf, fc: guard || group ? { guard, group, lib: guardLib } : undefined };
  const tr = await translateDoc(doc, ctx);
  let fin = null;
  try { fin = await runSC(tr.commands); } catch (e) { fin = { ok: false, error: e.message }; }
  const feats = tr.features.map((f) => {
    const st = /^bevel|^chamfer/.test(f.id) ? 'bevel' : 'round';
    let sentence = null;
    if (f.status === 'refused' && (guard || group)) { // the plain sentences are the CONTRACT's; the pane today shows the raw text (refusal)
      const sctx = { ...(opts.sentenceCtx ?? {}) };
      // which earlier steps changed the edge this step names (fc-sentences.mjs edgeTouched)
      const m = (f.refusal ?? '').match(/an operation after (\S+) changed or removed it/);
      const at = doc.features.findIndex((x) => x.id === f.id);
      if (m && at >= 0) {
        const from = doc.features.findIndex((x) => x.id === m[1]);
        sctx.causes = doc.features.slice(from + 1, at).filter((x) => !['sketch', 'extrude', 'datum'].includes(x.kind)).map((x) => ({ id: x.id, kind: x.kind, style: x.style, size: x.size }));
        sctx.self = { style: doc.features[at].style, size: doc.features[at].size };
      }
      sentence = f.guard ? guardSentence(f.guard, f.id, st) : plainSentence(f.refusal ?? '', sctx).sentence;
    }
    if (f.partialGuard) { return { id: f.id, kind: f.kind, status: 'refused', refusal: `${f.id} (${f.kind}): GUARD ${f.partialGuard.code}`, sentence: guardSentence(f.partialGuard, f.id, /^bevel|^chamfer/.test(f.id) ? 'bevel' : 'round'), guard: f.partialGuard, partial: true, commands: f.commands, measure: slim(f.measure) }; }
    return { id: f.id, kind: f.kind, status: f.status, refusal: f.refusal ?? null, sentence, guard: f.guard ?? null, group: f.group ?? null, commands: f.commands, measure: slim(f.measure), measureRefused: slim(f.measureRefused) };
  });
  const bodies = (fin?.measure?.bodies ?? []).map((b) => ({ name: b.name, volume: b.volume_mm3, faces: b.faces, bbox: [...b.bbox.min, ...b.bbox.max], com: b.center_of_mass, faceTypes: b.face_types }));
  return { ok: !!fin?.ok, error: fin?.ok ? null : (fin?.failed?.error ?? fin?.error ?? null), features: feats, commands: tr.commands, bodies, volume: bodies.reduce((s, b) => s + b.volume, 0), faces: bodies.reduce((s, b) => s + b.faces, 0), ms: Math.round(performance.now() - t0), mode, guard, group };
}

export async function ping() { return { ok: true, fc: true }; }
