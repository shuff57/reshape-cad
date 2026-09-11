#!/usr/bin/env node
// Step 7's own self-checks, run for real where this box can (OCCT), and
// wired to run the FreeCAD half too the moment a kernel-capable environment
// is available. NOT matched by `npm test`'s "test/*.test.mjs" glob on
// purpose -- ".manual." keeps it out of the default suite, same reason
// engine/bridge/*-test.mjs are not node:test files: they need a real wasm
// kernel and are meant to be run by hand.
//
// WHAT RAN, MEASURED, IN THIS PORT'S OWN SANDBOXED ENVIRONMENT (no docker
// daemon; see this port's own report): the OCCT half. replicad-opencascadejs
// is a pinned devDependency (scripts/occt-modeldoc-gate.mjs already proved
// it boots under plain Node, no container) -- so every OCCT reference number
// this script prints is real, not assumed.
//
// WHAT DID NOT RUN: the FreeCAD half. Getting there took two real fixes,
// both worth recording because the next person will hit the same wall:
//   1. engine/build/g3-artifacts/FreeCADCmd.js (the Node/NODERAWFS build)
//      throws "ReferenceError: resolveGlobalSymbol is not defined" under
//      plain Node -- load-browser.mjs's own comment already names this
//      exact symptom and stubs it for the BROWSER loader; fc-session-node.mjs
//      does not. Stubbed below, the same way.
//   2. Past that, FreeCAD's own Python init fails: "OSError: failed to make
//      path absolute" / "PYTHONHOME is set to '/opt/toolchains/python-wasm'"
//      -- because g3-artifacts is a NODERAWFS build, its filesystem calls go
//      straight to the HOST filesystem, and that Linux path genuinely does
//      not exist on this Windows box (nor does any FreeCAD Python stdlib
//      tree in this repo -- only the browser's freecad-data.data MEMFS pack
//      exists here, and it is not what g3-artifacts reads). This is not a
//      one-line fix: it needs the actual kernel-build-final container's
//      filesystem layout, exactly what engine/bridge/*-test.mjs's own
//      headers already say ("Run inside the kernel-build-final container").
// So: this script SKIPS the FreeCAD half with a clear reason rather than
// faking a result, and is ready to complete the comparison the moment it
// runs somewhere that container's filesystem exists.
//
// USAGE
//   node packages/kernel/test/freecad-vs-occt.manual.mjs [pathToFreeCADCmd.js]
// Run `npm run build` first -- this reads packages/*/dist, matching the same
// discipline scripts/occt-modeldoc-gate.mjs documents for the OCCT side.

import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..');
const require = createRequire(import.meta.url);
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);

let pass = 0;
let fail = 0;
let skip = 0;
function check(label, got, want, tol = 1e-3) {
  const ok = typeof got === 'number' && Number.isFinite(got) && Math.abs(got - want) <= tol;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${typeof got === 'number' ? got.toFixed(4) : String(got)} (want ${want.toFixed(4)})`);
  ok ? pass++ : fail++;
}
function skipped(label, why) {
  console.log(`SKIP  ${label}: ${why}`);
  skip++;
}

// ---------------------------------------------------------------------------
// OCCT half -- real, run here.
// ---------------------------------------------------------------------------
function packagedKernel() {
  try {
    return path.dirname(require.resolve('replicad-opencascadejs/dist/replicad_single.js'));
  } catch {
    try {
      return path.join(path.dirname(require.resolve('replicad-opencascadejs/package.json')), 'dist');
    } catch {
      return null;
    }
  }
}
const kernelDir = process.env.RESHAPE_KERNEL_DIR || packagedKernel();
if (!kernelDir || !existsSync(path.join(kernelDir, 'replicad_single.wasm'))) {
  console.error('FAIL: no OCCT kernel found (expected replicad-opencascadejs devDependency).');
  process.exit(1);
}
const glue = await import(pathToFileURL(path.join(kernelDir, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(kernelDir, f) });

const { buildDoc, measureShape } = await load('packages/kernel/dist/occt-build.js');
const arc = await load('packages/sketch/dist/sketch-arc.js');
const { solveSketch } = await load('packages/sketch/dist/sketch-solve.js');

console.log('\n--- 7a: box + fillet, OCCT reference volume ---');
const boxFilletDoc = {
  version: 1,
  features: [
    { id: 'box1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0] },
    {
      id: 'r1', kind: 'fillet', target: 'box1', size: 5, style: 'fillet',
      edge: {
        cause: 'between', feature: 'box1', kind: 'edge',
        of: [
          { cause: 'primitive', feature: 'box1', kind: 'face', part: '+x' },
          { cause: 'primitive', feature: 'box1', kind: 'face', part: '+z' },
        ],
      },
    },
  ],
};
const occtBoxFillet = buildDoc(oc, boxFilletDoc, arc);
const occtFilletVolume = measureShape(oc, occtBoxFillet.shapes.get('r1')).volume;
console.log(`OCCT box+fillet volume: ${occtFilletVolume}`);
console.log('(The self-check bar: FreeCadEngineAdapter.build() on the SAME doc, meshed, must');
console.log(' report a volume within a stated tolerance of this number. Rerun this script');
console.log(' from inside the kernel-build-final container with FreeCAD wired in to close it.)');

console.log('\n--- 7b(i): unconstrained rectangle sketch + extrude, OCCT reference volume ---');
const rectDoc = {
  version: 1,
  features: [
    { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [40, 0], [40, 25], [0, 25]] },
    { id: 'pull1', kind: 'extrude', target: 'sk1', height: 12 },
  ],
};
const occtRect = buildDoc(oc, rectDoc, arc);
const occtRectVolume = measureShape(oc, occtRect.shapes.get('pull1')).volume;
check('rectangle extrude volume', occtRectVolume, 40 * 25 * 12, 1e-2);

console.log('\n--- 7b(iii): rounded-rectangle sketch + extrude, OCCT reference volume ---');
const roundedDoc = {
  version: 1,
  features: [
    {
      id: 'sk2', kind: 'sketch', plane: 'xy', offset: 0,
      points: [[0, 0], [40, 0], [40, 25], [0, 25]], rounds: { 2: 5 },
    },
    { id: 'pull2', kind: 'extrude', target: 'sk2', height: 12 },
  ],
};
const occtRounded = buildDoc(oc, roundedDoc, arc);
const occtRoundedVolume = measureShape(oc, occtRounded.shapes.get('pull2')).volume;
// Rectangle area minus the corner cut off by a quarter-circle fillet of
// radius 5: area lost = r^2 - (pi r^2 / 4) = r^2 (1 - pi/4).
const expectedRoundedArea = 40 * 25 - 5 * 5 * (1 - Math.PI / 4);
check('rounded-rectangle extrude volume', occtRoundedVolume, expectedRoundedArea * 12, 0.5);

console.log('\n--- 7b(ii): non-90-degree angle constraint, JS solver reference corners ---');
// A 4-corner sketch with one 63.4-degree angle constraint between edge 0 and
// edge 2 -- the exact "non-trivial angle" case the spec's own self-check (ii)
// and this port's report both name as needing a measured cross-check against
// FreeCAD's Angle constraint sign convention.
const anglePts = [[0, 0], [30, 0], [30, 20], [0, 20]];
const angleConstraints = [
  { kind: 'horizontal', edge: 0 },
  { kind: 'lock', corner: 0 },
  { kind: 'length', edge: 0, value: 30 },
  { kind: 'angle', edge: 0, other: 1, degrees: 63.4 },
];
const jsSolved = solveSketch(anglePts, angleConstraints, [0]);
console.log(`JS solver corners: ${JSON.stringify(jsSolved.points.map((p) => p.map((v) => +v.toFixed(4))))}`);
console.log(`JS solver overConstrained: ${jsSolved.overConstrained}, residual: ${jsSolved.residual.toFixed(6)}`);
console.log('(The self-check bar: translate this SAME sketch through FreeCadEngineAdapter,');
console.log(' read back sketchState().geometry, and confirm the solved corner coordinates');
console.log(' match the JS solver\'s own points above within a stated tolerance -- proving');
console.log(' or correcting the angle sign-convention assumption sketch-translate.ts documents.');
console.log(' UNRUN in this environment for the same reason as 7a/7c above.');

// ---------------------------------------------------------------------------
// FreeCAD half -- attempted; expected to SKIP outside the build container.
// ---------------------------------------------------------------------------
console.log('\n--- FreeCAD half ---');
const fcKernelJs = process.argv[2]
  || (existsSync(path.join(REPO, 'engine/build/g3-artifacts/FreeCADCmd.js'))
    ? path.join(REPO, 'engine/build/g3-artifacts/FreeCADCmd.js') : null);

if (!fcKernelJs) {
  skipped('FreeCAD half', 'no FreeCADCmd.js path given and engine/build/g3-artifacts/FreeCADCmd.js not found');
} else {
  try {
    // load-browser.mjs's own fix, applied here for the Node loader too --
    // see this file's header, point 1.
    globalThis.resolveGlobalSymbol = globalThis.resolveGlobalSymbol
      || function resolveGlobalSymbolStub() { return { sym: undefined }; };

    const { loadNodeKernel } = await load('packages/engine/src/fc-session-node.mjs');
    const { createFcSession } = await load('packages/engine/src/fc-session.mjs');
    const { attachCommands } = await load('packages/engine/src/fc-commands.mjs');
    const { attachSketchCommands } = await load('packages/engine/src/fc-sketch.mjs');
    const { FreeCadEngineAdapter } = await load('packages/kernel/dist/freecad-engine-adapter.js');

    const Module = await loadNodeKernel(fcKernelJs);
    const session = attachSketchCommands(attachCommands(createFcSession(Module)));

    // FreeCadEngineAdapter normally loads its own session via load(); here
    // the already-open Node session is injected directly (constructor
    // injection exists for exactly this -- see the adapter's own header).
    const adapter = new FreeCadEngineAdapter({}, async () => Module);
    adapter['session'] = session;

    const fcBoxFillet = adapter.build(boxFilletDoc);
    if (fcBoxFillet.refusals?.size) {
      console.log('FreeCAD box+fillet refusals:', [...fcBoxFillet.refusals.entries()]);
    }
    const fcFilletVolume = session.mesh(fcBoxFillet.shapes.get('r1').objName).volume;
    check('FreeCAD box+fillet volume vs OCCT', fcFilletVolume, occtFilletVolume, 0.5);

    const fcRect = adapter.build(rectDoc);
    const fcRectVolume = session.mesh(fcRect.shapes.get('pull1').objName).volume;
    check('FreeCAD rectangle extrude volume vs OCCT', fcRectVolume, occtRectVolume, 0.5);

    const fcRounded = adapter.build(roundedDoc);
    const fcRoundedVolume = session.mesh(fcRounded.shapes.get('pull2').objName).volume;
    check('FreeCAD rounded-rectangle extrude volume vs OCCT', fcRoundedVolume, occtRoundedVolume, 0.5);

    // sketch-translate.ts's own §4.5.3 design assumes `points` is ALREADY
    // the solved output (its DoF-closure pins reuse those coordinates
    // directly, on purpose -- "packages/sketch already solved this, don't
    // ask FreeCAD to re-derive it"). anglePts is the pre-solve/as-drawn
    // rectangle; jsSolved.points (computed above) is what the angle
    // constraint actually resolves corner 2 to. Passing anglePts here first
    // produced "DoF-closure pins conflicted" against the real GCS solver --
    // not a translateSketch() bug, a test-fixture one: it fed the wrong
    // corner coordinates, the same ones the angle constraint had already
    // moved away from.
    const fcAngleDoc = { version: 1, features: [{ id: 'skA', kind: 'sketch', plane: 'xy', offset: 0, points: jsSolved.points, constraints: angleConstraints }] };
    const fcAngle = adapter.build(fcAngleDoc);
    const fcState = session.sketchState(fcAngle.shapes.get('skA').objName);
    console.log('FreeCAD angle-sketch solved geometry:', JSON.stringify(fcState.geometry));
    console.log('Compare each corner\'s (x,y) above against the JS solver\'s points printed');
    console.log('above by hand (or extend this script to do it) -- same sign convention if');
    console.log('they match; needs sketch-translate.ts\'s angle row corrected if they do not.');
  } catch (e) {
    skipped('FreeCAD half', `kernel did not come up in this environment: ${e.message.split('\n')[0]}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
process.exit(fail > 0 ? 1 : 0);
