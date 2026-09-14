#!/usr/bin/env node
// Real-kernel verification for lifting the FreeCAD "cuts across two different
// bodies" pocket refusal (docs/specs/SPEC-pocket-crossbody.md). Same "two
// engines, one number" bar as freecad-blend.manual.mjs: build the SAME
// ModelDoc through OcctEngineAdapter's own buildDoc() and through
// FreeCadEngineAdapter.build(), and compare volume AND world bounding box --
// never volume alone.
//
// THE CHANGE this proves (SPEC-pocket-crossbody.md §4): the 'pocket' branch no
// longer throws when the profile sketch and its target solid live in
// different bodies (which is every realistic doc, since the 'sketch' branch
// always freshBody()s a raw sketch). It now RE-PLACES the profile as a
// second, unattached, world-positioned sketch inside the target's OWN body
// via placeSketch() -- the same pattern groove/hole/blend already use.
//
// Ten fixtures, §2's own table, run end-to-end through adapter.build() (the
// one step the spec's own inline probe could not take):
//   G1  xy one-sided slab thinner than depth       -- 12400.0000
//   G2  xz one-sided slab thinner than depth       -- 12400.0000
//   G3  yz one-sided slab thinner than depth       -- 12400.0000
//   G4  xz non-zero offset, body Placement != identity, overshoot the other
//       way (correct answer is the SMALLER cut)    -- 24600.0000
//   G5  xy off-centre circle profile               -- 28407.3009
//   R1  G1 body rotated rz=30, off-centre profile  -- 12400.0000
//   R2  G1 body rotated rx=25                      -- 12402.1879
//   N1  cut runs into air                          -- 12800.0000
//   N2  sketch plane above the solid               -- 12480.0000
//   N3  profile entirely outside the solid in u/v  -- 12800.0000
//
// G1-G3 are the mandatory minimum -- the only fixtures that can see the SIGN
// at all (a box straddling the sketch plane returns the same number either
// way). Do NOT add a depth:0 fixture -- it hangs the OCCT kernel outright
// (SPEC-pocket-crossbody.md §9).
//
// World bbox must come from doc.getObject(bodyName).Shape.BoundBox, never the
// feature object's own body-local .Shape (freecad-engine-adapter.ts:2046-2049).
//
// USAGE (PowerShell, MSYS_NO_PATHCONV=1 in Git Bash):
//   docker run --rm --privileged -v "<repo>:/repo" -v "<repo>:/mnt/host/c/Users/shuff57/Documents/GitHub/reshape-cad"
//     fc-kernel-pd-final node --experimental-wasm-exnref
//     /repo/packages/kernel/test/freecad-pocket-crossbody.manual.mjs
//     /work/build/bin/FreeCADCmd.js
// Run `npm run build` first (this script imports packages/kernel/dist/*).

import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..');
const require = createRequire(import.meta.url);
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);

let pass = 0;
let fail = 0;
function check(label, got, want, tol = 0.5) {
  const ok = typeof got === 'number' && Number.isFinite(got) && Math.abs(got - want) <= tol;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${typeof got === 'number' ? got.toFixed(4) : String(got)} (want ${want.toFixed(4)})`);
  ok ? pass++ : fail++;
}
function checkBbox(label, got, want, tol = 0.05) {
  const ok = Array.isArray(got) && Array.isArray(want)
    && got.every((corner, i) => corner.every((v, j) => Math.abs(v - want[i][j]) <= tol));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
  ok ? pass++ : fail++;
}
function checkTrue(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` (${detail})` : ''}`);
  ok ? pass++ : fail++;
}

// ---------------------------------------------------------------------------
// OCCT reference
// ---------------------------------------------------------------------------
function packagedKernel() {
  try { return path.dirname(require.resolve('replicad-opencascadejs/dist/replicad_single.js')); }
  catch { return path.join(path.dirname(require.resolve('replicad-opencascadejs/package.json')), 'dist'); }
}
const kernelDir = process.env.RESHAPE_KERNEL_DIR || packagedKernel();
const glue = await import(pathToFileURL(path.join(kernelDir, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(kernelDir, f) });

const { buildDoc, measureShape } = await load('packages/kernel/dist/occt-build.js');
const arc = await load('packages/sketch/dist/sketch-arc.js');

function occtOf(doc, id) {
  return measureShape(oc, buildDoc(oc, doc, arc).shapes.get(id));
}

// ---------------------------------------------------------------------------
// FreeCAD half
// ---------------------------------------------------------------------------
const fcKernelJs = process.argv[2];
if (!fcKernelJs) {
  console.error('usage: node freecad-pocket-crossbody.manual.mjs <path-to-FreeCADCmd.js>');
  process.exit(1);
}

globalThis.resolveGlobalSymbol = globalThis.resolveGlobalSymbol
  || function resolveGlobalSymbolStub() { return { sym: undefined }; };

const { loadNodeKernel } = await load('packages/engine/src/fc-session-node.mjs');
const { createFcSession } = await load('packages/engine/src/fc-session.mjs');
const { attachCommands } = await load('packages/engine/src/fc-commands.mjs');
const { attachSketchCommands } = await load('packages/engine/src/fc-sketch.mjs');
const { FreeCadEngineAdapter } = await load('packages/kernel/dist/freecad-engine-adapter.js');

const Module = await loadNodeKernel(fcKernelJs);
const session = attachSketchCommands(attachCommands(createFcSession(Module)));
const adapter = new FreeCadEngineAdapter({}, async () => Module);
adapter['session'] = session;

function meshOf(entry) {
  return session.mesh(entry.objName);
}
function worldBbox(bodyName) {
  const { bbox } = session.read(
    `import json, FreeCAD as App\n` +
    `doc = App.ActiveDocument\n` +
    `bb = doc.getObject(${JSON.stringify(bodyName)}).Shape.BoundBox\n` +
    `open('/tmp/reshape_out.json','w').write(json.dumps({'bbox':[[bb.XMin,bb.YMin,bb.ZMin],[bb.XMax,bb.YMax,bb.ZMax]]}))\n`
  );
  return bbox;
}

// ---------------------------------------------------------------------------
// Fixture builders -- SPEC-pocket-crossbody.md §2's own table, literally.
// ---------------------------------------------------------------------------
const box = (id, size, center, rotate) => {
  const f = { id, kind: 'box', size, center };
  if (rotate) f.rotate = rotate;
  return f;
};
const rectSketch = (id, plane, offset, p1, p2) => ({
  id, kind: 'sketch', plane, offset,
  points: [[p1[0], p1[1]], [p2[0], p1[1]], [p2[0], p2[1]], [p1[0], p2[1]]],
});
const circleSketch = (id, plane, offset, centre, r = 5) => ({
  id, kind: 'sketch', plane, offset,
  points: [[centre[0] - r, centre[1]], [centre[0] + r, centre[1]]],
  shape: 'circle',
});
const pocket = (id, target, into, depth) => ({ id, kind: 'pocket', target, into, depth });

function runFixture(label, doc, wantVolume, wantBbox, tol = 0.5) {
  console.log(`\n--- ${label} ---`);
  const pk = doc.features.find((f) => f.kind === 'pocket');
  const occt = occtOf(doc, pk.id);
  check(`${label}: OCCT volume`, occt.volume, wantVolume, tol);
  checkBbox(`${label}: OCCT bbox`, occt.bbox, wantBbox);

  const fc = adapter.build(doc);
  checkTrue(`${label}: FreeCAD built (no refusal)`, !fc.refusals?.get(pk.id), JSON.stringify(fc.refusals?.get(pk.id) ?? null));
  const entry = fc.shapes.get(pk.id);
  checkTrue(`${label}: entry exists`, !!entry);
  if (!entry) return;
  const m = meshOf(entry);
  check(`${label}: FreeCAD volume vs OCCT`, m.volume, occt.volume, tol);
  check(`${label}: FreeCAD volume (expected ${wantVolume})`, m.volume, wantVolume, tol);
  checkBbox(`${label}: FreeCAD world bbox`, worldBbox(entry.bodyName), wantBbox);
}

// G1: xy, box [40,40,8]@[0,0,4], sketch xy@6, 10x8 rect, depth 5.
runFixture(
  'G1: xy one-sided slab thinner than depth',
  {
    version: 1,
    features: [
      box('g1box', [40, 40, 8], [0, 0, 4]),
      rectSketch('g1sk', 'xy', 6, [-5, -4], [5, 4]),
      pocket('g1pk', 'g1sk', 'g1box', 5),
    ],
  },
  12400.0000, [[-20, -20, 0], [20, 20, 8]],
);

// G2: xz, box [40,8,40]@[0,4,0], sketch xz@2, 10x8 rect, depth 5.
runFixture(
  'G2: xz one-sided slab thinner than depth',
  {
    version: 1,
    features: [
      box('g2box', [40, 8, 40], [0, 4, 0]),
      rectSketch('g2sk', 'xz', 2, [-5, -4], [5, 4]),
      pocket('g2pk', 'g2sk', 'g2box', 5),
    ],
  },
  12400.0000, [[-20, 0, -20], [20, 8, 20]],
);

// G3: yz, box [8,40,40]@[4,0,0], sketch yz@6, 10x8 rect, depth 5.
runFixture(
  'G3: yz one-sided slab thinner than depth',
  {
    version: 1,
    features: [
      box('g3box', [8, 40, 40], [4, 0, 0]),
      rectSketch('g3sk', 'yz', 6, [-5, -4], [5, 4]),
      pocket('g3pk', 'g3sk', 'g3box', 5),
    ],
  },
  12400.0000, [[0, -20, -20], [8, 20, 20]],
);

// G4: xz, box [60,14,30]@[15,7,2.5] (body Placement T(15,7,-12.5), NOT
// identity), sketch xz@10, 30x5 rect, depth 6. Correct answer is the SMALLER
// cut (24600 vs a wrong-direction 24300).
runFixture(
  'G4: xz non-zero offset, non-identity body Placement, overshoot the other way',
  {
    version: 1,
    features: [
      box('g4box', [60, 14, 30], [15, 7, 2.5]),
      rectSketch('g4sk', 'xz', 10, [0, 0], [30, 5]),
      pocket('g4pk', 'g4sk', 'g4box', 6),
    ],
  },
  24600.0000, [[-15, 0, -12.5], [45, 14, 17.5]],
);

// G5: xy, box [60,60,8]@[0,0,4], sketch xy@6, Ø10 circle @[12,-6], depth 5.
runFixture(
  'G5: xy off-centre circle profile',
  {
    version: 1,
    features: [
      box('g5box', [60, 60, 8], [0, 0, 4]),
      circleSketch('g5sk', 'xy', 6, [12, -6], 5),
      pocket('g5pk', 'g5sk', 'g5box', 5),
    ],
  },
  28407.3009, [[-30, -30, 0], [30, 30, 8]], 0.1,
);

// R1: G1's body rotated rz=30, profile off-centre [2,3]..[12,11].
runFixture(
  'R1: G1 body rotated rz=30, off-centre profile',
  {
    version: 1,
    features: [
      box('r1box', [40, 40, 8], [0, 0, 4], [0, 0, 30]),
      rectSketch('r1sk', 'xy', 6, [2, 3], [12, 11]),
      pocket('r1pk', 'r1sk', 'r1box', 5),
    ],
  },
  12400.0000, [[-27.321, -27.321, 0], [27.321, 27.321, 8]],
);

// R2: G1's body rotated rx=25.
runFixture(
  'R2: G1 body rotated rx=25',
  {
    version: 1,
    features: [
      box('r2box', [40, 40, 8], [0, 0, 4], [25, 0, 0]),
      rectSketch('r2sk', 'xy', 6, [-5, -4], [5, 4]),
      pocket('r2pk', 'r2sk', 'r2box', 5),
    ],
  },
  12402.1879, [[-20, -19.817, -8.078], [20, 19.817, 16.078]],
);

// N1: cut runs into air -- sketch xy@0 under a z 0..8 slab.
runFixture(
  'N1: cut runs into air',
  {
    version: 1,
    features: [
      box('n1box', [40, 40, 8], [0, 0, 4]),
      rectSketch('n1sk', 'xy', 0, [-5, -4], [5, 4]),
      pocket('n1pk', 'n1sk', 'n1box', 5),
    ],
  },
  12800.0000, [[-20, -20, 0], [20, 20, 8]],
);

// N2: sketch plane above the solid -- xy@12, depth 8, slab z 0..8.
runFixture(
  'N2: sketch plane above the solid',
  {
    version: 1,
    features: [
      box('n2box', [40, 40, 8], [0, 0, 4]),
      rectSketch('n2sk', 'xy', 12, [-5, -4], [5, 4]),
      pocket('n2pk', 'n2sk', 'n2box', 8),
    ],
  },
  12480.0000, [[-20, -20, 0], [20, 20, 8]],
);

// N3: profile entirely outside the solid in u/v -- [100,100]..[110,108].
runFixture(
  'N3: profile entirely outside the solid in u/v',
  {
    version: 1,
    features: [
      box('n3box', [40, 40, 8], [0, 0, 4]),
      rectSketch('n3sk', 'xy', 6, [100, 100], [110, 108]),
      pocket('n3pk', 'n3sk', 'n3box', 5),
    ],
  },
  12800.0000, [[-20, -20, 0], [20, 20, 8]],
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
