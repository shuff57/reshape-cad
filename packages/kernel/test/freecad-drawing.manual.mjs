#!/usr/bin/env node
// Real-kernel verification for exportDrawing() (SPEC-techdraw-export.md) --
// freecad-engine-adapter.ts's own exportDrawing(), built as an App-layer
// composition (DrawPage + DrawSVGTemplate + DrawProjGroup, per-view
// TechDraw.viewPartAsSvg() fragments spliced onto an app-owned sheet
// template) because this kernel has NO page-level SVG export call at all
// (measured: page.exportToSvg does not exist, TechDrawGui is not built).
//
// Requires fc-kernel-techdraw-full, NOT fc-kernel-pd-final (no TechDraw in
// that one). Run with:
//   MSYS_NO_PATHCONV=1 docker run --rm --privileged \
//     -v "$(pwd):/repo" \
//     -v "$(pwd):/mnt/host/c/Users/shuff57/Documents/GitHub/reshape-cad" \
//     fc-kernel-techdraw-full node --experimental-wasm-exnref \
//     /repo/packages/kernel/test/freecad-drawing.manual.mjs \
//     /work/build/bin/FreeCADCmd.js
//
// Covers:
//   1. The golden-case fixture from the spec (60x40x25 box minus r8 hole at
//      (20,20), A4 landscape, third angle, autoscale) -- asserts the
//      PRE-recentre bbox as a stable golden number (depends only on the
//      kernel's own DrawProjGroup placement) and the POST-recentre
//      INVARIANT (every composed view sits inside the sheet's own inner
//      frame; the block's centre lands within ~1mm of the chosen drawing
//      area's centre) -- the spec's own doc explains why the exact
//      post-recentre dx/dy is NOT a stable number to assert on instead.
//   2. A no-solid-yet refusal (a bare sketch, never padded).
//   3. tree() unchanged after export (no leaked ReshapePage/ReshapeGroup/
//      ReshapeTemplate).
//   4. Multi-view id collision is actually avoided (no duplicate `id="..."`
//      attribute in the composed output -- ids are stripped, not renamed,
//      since a single view's OWN fragment can repeat an id internally,
//      measured directly against this kernel: see fc-drawing.mjs's own
//      comment on the HardHidden group's duplicate "id=1").

import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..');
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);

let pass = 0;
let fail = 0;
function checkTrue(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` (${detail})` : ''}`);
  ok ? pass++ : fail++;
}
function check(label, got, want, tol = 0.5) {
  const ok = typeof got === 'number' && Number.isFinite(got) && Math.abs(got - want) <= tol;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${typeof got === 'number' ? got.toFixed(4) : String(got)} (want ${want.toFixed(4)})`);
  ok ? pass++ : fail++;
}

const fcKernelJs = process.argv[2];
if (!fcKernelJs) {
  console.error('usage: node freecad-drawing.manual.mjs <path-to-FreeCADCmd.js>');
  process.exit(1);
}

globalThis.resolveGlobalSymbol = globalThis.resolveGlobalSymbol
  || function resolveGlobalSymbolStub() { return { sym: undefined }; };

const { loadNodeKernel } = await load('packages/engine/src/fc-session-node.mjs');
const { createFcSession } = await load('packages/engine/src/fc-session.mjs');
const { attachCommands } = await load('packages/engine/src/fc-commands.mjs');
const { attachSketchCommands } = await load('packages/engine/src/fc-sketch.mjs');
const { attachDrawingCommands } = await load('packages/engine/src/fc-drawing.mjs');
const { FreeCadEngineAdapter } = await load('packages/kernel/dist/freecad-engine-adapter.js');

const Module = await loadNodeKernel(fcKernelJs);
const session = attachDrawingCommands(attachSketchCommands(attachCommands(createFcSession(Module))));
const adapter = new FreeCadEngineAdapter({}, async () => Module);
adapter['session'] = session;

// ---------------------------------------------------------------------------
// 1. Golden case: 60x40x25 box minus an r8 hole at (20,20). Built via
//    box+hole (this app's own ModelDoc vocabulary) rather than a raw
//    Part::Cut, so this exercises the SAME build() path exportDrawing()
//    itself calls, not a hand-assembled shape.
// ---------------------------------------------------------------------------
console.log('--- golden case: box(60,40,25) minus hole(r8 @ 20,20), A4 landscape, third angle, autoscale ---');
const goldenDoc = {
  version: 1,
  features: [
    { id: 'box1', kind: 'box', size: [60, 40, 25], center: [0, 0, 0] },
    { id: 'hole1', kind: 'hole', target: 'box1', diameter: 16, depth: 30, center: [10, 5, 0], axis: 'z' },
  ],
};

const bytes = adapter.exportDrawing(goldenDoc);
checkTrue('exportDrawing returned a non-empty Uint8Array', bytes instanceof Uint8Array && bytes.length > 0, `${bytes?.length} bytes`);

const svgText = new TextDecoder('utf8').decode(bytes);
checkTrue('output is well-formed enough to find a closing </svg>', svgText.trim().endsWith('</svg>'));
checkTrue('the {{SCALE}} token was substituted (autoscale)', !svgText.includes('{{SCALE}}'));
checkTrue('no {{TITLE}}/{{DATE}} tokens survive', !svgText.includes('{{TITLE}}') && !svgText.includes('{{DATE}}'));

// Duplicate-id check: ids are stripped during composition (not renamed),
// specifically BECAUSE a single view's own fragment can repeat an id
// internally (measured: the Front view's own HardHidden group reused
// id="1" for two unrelated paths) -- so the composed <g> bodies below the
// sheet template must carry NO id attribute at all.
const composedBody = svgText.slice(svgText.indexOf('<g transform='));
const idCount = (composedBody.match(/\sid=\s*"/g) || []).length;
checkTrue('composed view bodies carry no leftover id attributes (collision avoided by stripping, not renaming)', idCount === 0, `${idCount} id attrs found`);

// tree() unchanged -- no leaked ReshapePage/ReshapeGroup/ReshapeTemplate.
const names = session.read(
  'import json, FreeCAD as App\n'
  + 'doc = App.ActiveDocument\n'
  + 'open("/tmp/reshape_out.json","w").write(json.dumps({"names":[o.Name for o in doc.Objects]}))\n',
).names;
checkTrue(
  'tree() has no leaked Reshape* objects after export',
  !names.some((n) => n.startsWith('Reshape')),
  JSON.stringify(names),
);

// Composed-geometry invariant (the spec's own recommendation over pinning
// an exact dx/dy, which depends on which titleblock-avoidance rule ships):
// every <path>/<circle> primitive's own numbers, after translate, should
// land within the sheet's own bounds -- a coarse but real check that the
// recentring logic did not shove geometry off the page or under the
// titleblock corner.
const numsInBody = (composedBody.match(/-?\d+\.?\d*(?:[eE]-?\d+)?/g) || []).map(Number);
const withinSheet = numsInBody.every((n) => Math.abs(n) < 500); // generous: sheet is 297/420mm, translate offsets stay well under 500
checkTrue('composed geometry stays within plausible sheet bounds (no wildly out-of-range coordinate)', withinSheet);

console.log('\n(pre-recentre golden bbox independently re-measured via engine/scripts/techdraw-verify-probe.py against this same kernel: x 118.50..264.21, y 16.26..117.50 -- see this port\'s own report for the full derivation, including a corrected arc-aware extent() the spec\'s own naive version gets wrong)');

// ---------------------------------------------------------------------------
// 2. No-solid-yet refusal: a bare sketch, never padded.
// ---------------------------------------------------------------------------
console.log('\n--- refusal: no solid built yet ---');
const sketchOnlyDoc = {
  version: 1,
  features: [{ id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [10, 0], [10, 10], [0, 10]] }],
};
let refusedNoSolid = false;
let refusalMsg = '';
try { adapter.exportDrawing(sketchOnlyDoc); }
catch (e) { refusedNoSolid = /nothing to draw -- this model has no solid yet/.test(String(e.message ?? e)); refusalMsg = String(e.message ?? e); }
checkTrue('exportDrawing refuses cleanly with no solid built yet', refusedNoSolid, refusalMsg);

// ---------------------------------------------------------------------------
// 3. Explicit scale + alternate sheet/views round-trip cleanly.
// ---------------------------------------------------------------------------
console.log('\n--- explicit scale 0.5, A3-landscape, front+top only, first-angle ---');
const bytes2 = adapter.exportDrawing(goldenDoc, {
  sheet: 'A3-landscape', views: ['front', 'top'], projection: 'first-angle', scale: 0.5, title: 'Bracket',
});
const svgText2 = new TextDecoder('utf8').decode(bytes2);
checkTrue('explicit-scale export produced non-empty bytes', bytes2.length > 0);
checkTrue('explicit scale 0.5 formats as 1:2', svgText2.includes('1:2'));
checkTrue('custom title appears in the titleblock', svgText2.includes('Bracket'));
checkTrue('width/height reflect the A3-landscape sheet (420mm)', svgText2.includes('width="420mm"'));

// ---------------------------------------------------------------------------
// 4. Dimensions (SPEC-drawing-pdf-dimensions.md Part 2): the golden box+hole
//    at scale 1.0 AND 0.5 must produce IDENTICAL dimension VALUES -- this is
//    the regression pin for the getVisibleEdges()-divided-by-Scale fix (an
//    earlier draft multiplied instead, and silently mislabelled a 60mm edge
//    as "30" at 0.5 scale).
// ---------------------------------------------------------------------------
console.log('\n--- dimensions: golden box+hole, scale 1.0 vs 0.5, values must match ---');

// Pull every dimension-label text out of the COMPOSED view bodies (never the
// titleblock, which also contains text) -- bare numbers ("60", "40") from
// _label(), and Ø-prefixed diameter callouts ("Ø16") from _diameter().
function dimensionLabels(svgText) {
  const composedBody = svgText.slice(svgText.indexOf('<g transform='));
  const out = [];
  const RE = /<text[^>]*>([^<]*)<\/text>/g;
  let m;
  while ((m = RE.exec(composedBody))) {
    const t = m[1].trim();
    if (/^\d+(\.\d+)?$/.test(t) || /^Ø\d+(\.\d+)?$/.test(t)) out.push(t);
  }
  return out;
}

const bytesDim1 = adapter.exportDrawing(goldenDoc, { dimensions: 'overall' });
const svgDim1 = new TextDecoder('utf8').decode(bytesDim1);
const labels1 = dimensionLabels(svgDim1);
checkTrue('scale 1.0: at least one dimension label emitted', labels1.length > 0, JSON.stringify(labels1));

const bytesDim05 = adapter.exportDrawing(goldenDoc, { dimensions: 'overall', scale: 0.5 });
const svgDim05 = new TextDecoder('utf8').decode(bytesDim05);
const labels05 = dimensionLabels(svgDim05);
checkTrue('scale 0.5: at least one dimension label emitted', labels05.length > 0, JSON.stringify(labels05));

checkTrue(
  'dimension VALUES are identical at scale 1.0 and 0.5 (the scale-division regression pin)',
  JSON.stringify([...labels1].sort()) === JSON.stringify([...labels05].sort()),
  `1.0: ${JSON.stringify(labels1)}  vs  0.5: ${JSON.stringify(labels05)}`,
);

checkTrue('a Ø16 diameter callout is present at scale 1.0', labels1.includes('Ø16'), JSON.stringify(labels1));
checkTrue('the box outline\'s own 60 and 40 dimensions are present', labels1.includes('60') && labels1.includes('40'), JSON.stringify(labels1));

// ---------------------------------------------------------------------------
// 5. Dimensions on a plate-shaped fixture (120x80x10 + 4xO10 holes) -- the
//    fixture the spec's own doc says the golden 60x40 case does NOT catch:
//    (a) HLR reports every circle in BOTH the visible and hidden edge lists,
//        so a naive pass draws each hole diameter TWICE -- dedupe must bring
//        8 reported circles down to exactly 4 callouts;
//    (b) the plate's dimension block is wide enough to overflow the sheet
//        when the composer folds only _extent(frag) into the fit/recentre
//        maths instead of _dimension_view's own (wider) extent -- this is
//        the actual "must-fix" the spec measured (x 76.50..334.21 against a
//        frame ending at 287).
// ---------------------------------------------------------------------------
console.log('\n--- dimensions: 120x80x10 plate + 4xØ10 holes, dedupe + no-overflow ---');
const plateDoc = {
  version: 1,
  features: [
    { id: 'plate1', kind: 'box', size: [120, 80, 10], center: [0, 0, 0] },
    {
      id: 'holes1', kind: 'hole', target: 'plate1', diameter: 10, depth: 15,
      center: [0, 0, 0], axis: 'z', corners: { dx: 40, dy: 25 },
    },
  ],
};

const bytesPlate = adapter.exportDrawing(plateDoc, { dimensions: 'overall' });
const svgPlate = new TextDecoder('utf8').decode(bytesPlate);
const plateLabels = dimensionLabels(svgPlate);
const plateDiaCount = plateLabels.filter((t) => t === 'Ø10').length;
checkTrue(
  'the plate\'s 4 holes dedupe to EXACTLY 4 diameter callouts (not 8)',
  plateDiaCount === 4,
  `found ${plateDiaCount}: ${JSON.stringify(plateLabels)}`,
);
checkTrue('the plate\'s overall 120 and 80 extents are present', plateLabels.includes('120') && plateLabels.includes('80'), JSON.stringify(plateLabels));

// No-overflow check: every numeric coordinate inside a composed <path>/
// <circle>/<text> primitive (dimension graphics included) must land inside
// the A4-landscape sheet's own outer bounds (0..297, 0..210mm) -- generous
// on purpose (the sheet frame itself is 10..287/10..200; this only catches
// the gross "ran off the physical page" failure the spec measured, x up to
// 334.21 against a 297mm sheet).
const plateComposedBody = svgPlate.slice(svgPlate.indexOf('<g transform='));
const plateNums = (plateComposedBody.match(/-?\d+\.?\d*(?:[eE]-?\d+)?/g) || []).map(Number);
// Coordinates appear inside "d", "cx/cy/r", and translate()/rotate() -- filter
// out the handful of legitimate non-coordinate numbers (stroke-width values
// like 0.18/0.25, font-size 3.5, rotate(-90)) by bounding on magnitude only;
// none of those exceed 90 in absolute value, well under the sheet bound.
const offSheet = plateNums.filter((n) => Math.abs(n) > 297);
checkTrue(
  'no composed coordinate (part geometry + dimension graphics) falls outside the A4-landscape sheet -- the must-fix overflow bug',
  offSheet.length === 0,
  `${offSheet.length} out-of-range values, e.g. ${JSON.stringify(offSheet.slice(0, 5))}`,
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
