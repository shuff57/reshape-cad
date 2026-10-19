// Feature: sketch planes / frames / datum. Rect 30 x 20 at [5,3] (asymmetric, so an axis swap or a mirror shows in bbox + COM).
// Expected bboxes are hand-derived from the documented frames (top u=x v=y n=+z; front u=x v=z, sweep -y, offset toward +y;
// side u=y v=z n=+x), NOT read from the interpreter.
import { translateDoc } from './sg-core.mjs';
const V = 30 * 20 * 10; // volume
const R = "sk.rect(30, 20, { at: [5, 3] })"; // x2d in [-10,20], y2d in [-7,13]
const s = Math.SQRT1_2;
const plane = (id, feature, sketchCall, bbox, what, extra = {}) => ({
  id, feature, what, script: `const sk = ${sketchCall}; ${R}; extrude(sk, 10)`, exact: { volume: V, bbox }, ...extra,
});
export const cases = [
  plane('plane-top-0', 'sketch(plane)', "sketch('top')", [-10, -7, 0, 20, 13, 10], 'top, no offset'),
  plane('plane-top-12.5', 'sketch(plane)', "sketch('top', 12.5)", [-10, -7, 12.5, 20, 13, 22.5], 'top, offset +12.5'),
  plane('plane-top--4', 'sketch(plane)', "sketch('top', -4)", [-10, -7, -4, 20, 13, 6], 'top, negative offset'),
  plane('plane-front-0', 'sketch(plane)', "sketch('front')", [-10, -10, -7, 20, 0, 13], 'front: u=x v=z, sweeps toward -y'),
  plane('plane-front-7', 'sketch(plane)', "sketch('front', 7)", [-10, -3, -7, 20, 7, 13], 'front offset 7: origin y=+7, still sweeps -y'),
  plane('plane-side-0', 'sketch(plane)', "sketch('side')", [0, -10, -7, 10, 20, 13], 'side: u=y v=z, sweeps +x'),
  plane('plane-side--4', 'sketch(plane)', "sketch('side', -4)", [-4, -10, -7, 6, 20, 13], 'side negative offset'),
  // datum plane() then sketch(plane)
  plane('datum-plane-top-5', 'plane(datum)', "sketch(plane('top', 5))", [-10, -7, 5, 20, 13, 15], 'plane(top,5) datum, sketch on it'),
  plane('datum-plane-front-3', 'plane(datum)', "sketch(plane('front', 3))", [-10, -7, -7, 20, 3, 13], 'plane(front,3) datum'),
  plane('datum-plane-side-2', 'plane(datum)', "sketch(plane('side', 2))", [2, -10, -7, 12, 20, 13], 'plane(side,2) datum'),
  plane('datum-plane-default-offset', 'plane(datum)', "sketch(plane('top'))", [-10, -7, 0, 20, 13, 10], "plane('top') = plane('top',0)"),
  plane('datum-frame', 'plane(datum)', "sketch(plane({ origin: [1, 2, 3], u: [0, 1, 0], v: [0, 0, 1] }))", [1, -8, -4, 11, 22, 16], 'plane({origin,u,v}) custom datum frame'),
  // custom frames
  plane('frame-yz', 'sketch({origin,u,v})', "sketch({ origin: [1, 2, 3], u: [0, 1, 0], v: [0, 0, 1] })", [1, -8, -4, 11, 22, 16], 'u=y v=z, n=+x, origin (1,2,3)'),
  plane('frame-swapped', 'sketch({origin,u,v})', "sketch({ origin: [1, 2, 3], u: [0, 0, 1], v: [0, 1, 0] })", [-9, -5, -7, 1, 15, 23], 'u/v swapped vs frame-yz: normal flips to -x, outline mirrored'),
  plane('frame-xy-origin', 'sketch({origin,u,v})', "sketch({ origin: [3, 4, 5], u: [1, 0, 0], v: [0, 1, 0] })", [-7, -3, 5, 23, 17, 15], 'axis frame, shifted origin'),
  plane('frame-tilt45', 'sketch({origin,u,v})', `sketch({ origin: [0, 0, 0], u: [1, 0, 0], v: [0, ${s}, ${s}] })`, [-10, -17 * s, -7 * s, 20, 13 * s, 23 * s], 'v tilted 45 deg about x, n=(0,-s,s)'),
  plane('frame-neg-u', 'sketch({origin,u,v})', "sketch({ origin: [0, 0, 0], u: [-1, 0, 0], v: [0, 1, 0] })", [-20, -7, -10, 10, 13, 0], 'u=-x v=y: n=-z (mirrored in x, sweeps down)'),
  // refusals (script layer)
  { id: 'frame-nonunit-u', feature: 'sketch({origin,u,v})', what: 'u of length 2 must be refused', script: "const sk = sketch({ origin: [0,0,0], u: [2,0,0], v: [0,1,0] }); sk.rect(10,10); extrude(sk, 5)" },
  { id: 'frame-nonorth2', feature: 'sketch({origin,u,v})', what: 'u,v not orthogonal (45 deg) must be refused', script: "const sk = sketch({ origin: [0,0,0], u: [1,0,0], v: [0.70710678,0.70710678,0] }); sk.rect(10,10); extrude(sk, 5)" },
  { id: 'frame-parallel', feature: 'sketch({origin,u,v})', what: 'u parallel v must be refused', script: "const sk = sketch({ origin: [0,0,0], u: [1,0,0], v: [1,0,0] }); sk.rect(10,10); extrude(sk, 5)" },
  { id: 'frame-offset-with-frame', feature: 'sketch({origin,u,v})', what: 'offset given with a frame must be refused', script: "const sk = sketch({ origin: [0,0,0], u: [1,0,0], v: [0,1,0] }, 5); sk.rect(10,10); extrude(sk, 5)" },
  { id: 'plane-bad-word', feature: 'sketch(plane)', what: 'unknown plane word', script: "const sk = sketch('bottom'); sk.rect(10,10); extrude(sk, 5)" },
  { id: 'plane-offset-on-datum', feature: 'plane(datum)', what: 'sketch(plane, offset) must be refused', script: "const sk = sketch(plane('top'), 5); sk.rect(10,10); extrude(sk, 5)" },
  { id: 'plane-frame-offset', feature: 'plane(datum)', what: 'plane({frame}, offset) must be refused', script: "const p = plane({ origin: [0,0,0], u: [1,0,0], v: [0,1,0] }, 5); const sk = sketch(p); sk.rect(10,10); extrude(sk, 5)" },
  // a datum on its own: no solid, no command
  {
    id: 'datum-only', feature: 'plane(datum)', what: 'plane() with no sketch: bookkeeping only, translator no-op', custom: async () => {
      const { runScript, arc, mt, runSC, solveDoc } = await import('./sg-core.mjs');
      const run = runScript("const p = plane('top', 5); const q = plane('front', 2)");
      const tr = await translateDoc(solveDoc(run.doc), { arc, mt, soups: {}, runSC });
      return { id: 'datum-only', custom: true, outcome: tr.features.every((f) => f.status === 'noop') ? 'PASS-NOOP' : 'CHECK', doc: run.doc.features, summary: tr.features.map((f) => `${f.id}:${f.kind}:${f.status}`), errors: run.errors };
    },
  },
];
