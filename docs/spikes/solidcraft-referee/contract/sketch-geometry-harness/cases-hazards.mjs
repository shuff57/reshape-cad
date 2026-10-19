// Round 5: inputs that are a hazard for the harness itself or for the host.
//  - pull(sk, 0): the OCCT oracle (repo occt-build via replicad) does not return on a zero-height pull, so these cases run with noOcct: the truck + guard side only.
//    Any future runner that calls buildOCCT on a zero pull must put it behind a child process with a time limit.
import { runScript, toScript, buildOCCT, buildBrep } from './sg-core.mjs';
const J = JSON.stringify;
export const cases = [
  { id: 'hz-pull-0-rect', feature: 'pull distance', what: "pull(sk, 0) on a rectangle (OCCT oracle hangs; not run)", script: `const sk = sketch('top'); sk.rect(10,10); pull(sk, 0)`, noOcct: true },
  { id: 'hz-pull-0-circle', feature: 'pull distance', what: "pull(sk, 0) on a circle (OCCT oracle hangs; not run)", script: `const sk = sketch('top'); sk.circle(10); pull(sk, 0)`, noOcct: true },
  { id: 'hz-pull-nan', feature: 'pull distance', what: "pull(sk, NaN)", script: `const sk = sketch('top'); sk.rect(10,10); pull(sk, NaN)`, noOcct: true },
  { id: 'hz-pull-neg-control', feature: 'pull distance', what: "pull(sk, -5): negative control, builds downward", script: `const sk = sketch('top'); sk.rect(10,10); pull(sk, -5)`, exact: { volume: 500 } },
  {
    // a doc with an edge bulge (SketchFeature.bulges) saved with toScript() and reloaded: the arc is silently dropped, so the reloaded part is a different solid
    id: 'hz-bulge-roundtrip-volume', feature: 'edge bulges', what: 'doc with bulges {0: 0.5} -> toScript -> runScript: volume before and after (OCCT and brep-rs)', custom: async () => {
      const doc = { version: 1, features: [{ id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [20, 0], [20, 20], [0, 20]], bulges: { 0: 0.5 } }, { id: 'pull1', kind: 'extrude', target: 'sk1', height: 10 }] };
      const text = toScript(doc);
      const back = runScript(text);
      const sk = back.doc?.features?.find((f) => f.kind === 'sketch');
      const before = { occt: buildOCCT(doc, 'pull1').m?.volume, brep: buildBrep(doc, 'pull1').m?.volume };
      const after = { occt: back.doc ? buildOCCT(back.doc, 'pull1').m?.volume : null, brep: back.doc ? buildBrep(back.doc, 'pull1').m?.volume : null };
      const lost = !(sk?.bulges && Object.keys(sk.bulges).length);
      return { id: 'hz-bulge-roundtrip-volume', feature: 'edge bulges', custom: true, outcome: lost ? 'WRONG-SILENT' : 'BULGE-KEPT', summary: { text, bulgesAfter: sk?.bulges ?? null, errors: back.errors.map((e) => e.message), warnings: back.warnings ?? [], before, after, volumeChange: after.occt && before.occt ? (after.occt - before.occt) / before.occt : null } };
    },
  },
];
