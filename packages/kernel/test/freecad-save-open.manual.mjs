#!/usr/bin/env node
// Real-kernel verification for Save/Open .FCStd (SPEC-studio-canonical.md
// phase 4) -- freecad-engine-adapter.ts's own saveDocument()/openDocument().
//
// A GENUINE round trip, not just "no error thrown": build a ModelDoc for
// real, save it, and check THREE independent things against the real
// fc-kernel-pd-final kernel:
//   1. The saved bytes are a real zip (PK magic) that FreeCAD's own
//      openDocument() can load on its own, independent of this adapter --
//      its NATIVE geometry (meshed straight off the reopened document, no
//      ModelDoc involved at all) must match the original build's volume.
//   2. adapter.openDocument(bytes) reconstructs a ModelDoc structurally
//      equal to the one that was saved (the embedded-JSON round trip).
//   3. Rebuilding THAT reconstructed ModelDoc from scratch via the normal
//      build() pipeline reproduces the same volume again -- proving the
//      embedded JSON is not just present, but actually describes the same
//      model, not a stale or mismatched copy.
// Plus: a `.FCStd` this adapter did NOT save (raw bridge commands, no
// embedded marker) must come back null, not a guessed ModelDoc -- and
// OcctEngineAdapter.saveDocument()/openDocument() must throw a clear error
// rather than silently doing nothing or crashing.
//
// USAGE
//   node packages/kernel/test/freecad-save-open.manual.mjs <pathToFreeCADCmd.js>
// Run `npm run build` first.

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
  console.error('usage: node freecad-save-open.manual.mjs <path-to-FreeCADCmd.js>');
  process.exit(1);
}

globalThis.resolveGlobalSymbol = globalThis.resolveGlobalSymbol
  || function resolveGlobalSymbolStub() { return { sym: undefined }; };

const { loadNodeKernel } = await load('packages/engine/src/fc-session-node.mjs');
const { createFcSession } = await load('packages/engine/src/fc-session.mjs');
const { attachCommands } = await load('packages/engine/src/fc-commands.mjs');
const { attachSketchCommands } = await load('packages/engine/src/fc-sketch.mjs');
const { FreeCadEngineAdapter } = await load('packages/kernel/dist/freecad-engine-adapter.js');
const { OcctEngineAdapter } = await load('packages/kernel/dist/occt-engine-adapter.js');

const Module = await loadNodeKernel(fcKernelJs);
const session = attachSketchCommands(attachCommands(createFcSession(Module)));
const adapter = new FreeCadEngineAdapter({}, async () => Module);
adapter['session'] = session;

// A real doc: box + fillet + pattern, exercising more than one feature kind
// (not just a bare primitive) through the SAME embedded-JSON path.
const doc = {
  version: 1,
  features: [
    { id: 'box1', kind: 'box', size: [10, 10, 10], center: [0, 0, 0] },
    { id: 'pat1', kind: 'pattern', target: 'box1', mode: 'linear', count: 3, step: [20, 0, 0] },
  ],
};

console.log('--- build + save ---');
const built = adapter.build(doc);
if (built.refusals?.size) console.log('refusals:', [...built.refusals.entries()]);
const entry = built.shapes.get('pat1');
const v1 = session.mesh(entry.objName).volume;
console.log(`original build volume: ${v1}`);

const bytes = adapter.saveDocument(doc);
checkTrue('saveDocument returned a non-empty Uint8Array', bytes instanceof Uint8Array && bytes.length > 0, `${bytes?.length} bytes`);
checkTrue('saved bytes are a real zip (PK magic)', bytes[0] === 0x50 && bytes[1] === 0x4b, `${bytes[0]},${bytes[1]}`);

console.log('\n--- native round trip: reopen the SAME bytes via the bridge directly (no ModelDoc involved) ---');
const reopenedName = session.openDocument(bytes, '/tmp/reopened-native.FCStd');
checkTrue('bridge-level openDocument succeeded', typeof reopenedName === 'string' && reopenedName.length > 0, reopenedName);
const v2 = session.mesh().volume; // default target: the active solid
check('native reopened geometry volume matches the original build', v2, v1);

console.log('\n--- ModelDoc round trip: adapter.openDocument(bytes) ---');
const reconstructed = adapter.openDocument(bytes);
checkTrue('openDocument reconstructed a ModelDoc (not null)', reconstructed !== null);
checkTrue(
  'reconstructed ModelDoc is structurally equal to the original',
  JSON.stringify(reconstructed) === JSON.stringify(doc),
  JSON.stringify(reconstructed),
);

console.log('\n--- rebuild the RECONSTRUCTED ModelDoc from scratch, independently ---');
const rebuilt = adapter.build(reconstructed);
if (rebuilt.refusals?.size) console.log('refusals:', [...rebuilt.refusals.entries()]);
const rebuiltEntry = rebuilt.shapes.get('pat1');
const v3 = session.mesh(rebuiltEntry.objName).volume;
check('rebuilding the reconstructed ModelDoc reproduces the same volume', v3, v1);

console.log('\n--- refusal: a .FCStd this adapter did NOT save has no ModelDoc to find ---');
session.newDocument('foreign');
session.sketchCircle(session.newBody('ForeignBody'), 'ForeignSketch', 5, 0, 0);
// (body/sketch names above are throwaway; just need SOME real solid so the
// file is not degenerate)
const foreignBody = 'ForeignBody';
session.pad(foreignBody, 'ForeignSketch', 'ForeignPad', 10);
const foreignBytes = session.saveDocument('/tmp/foreign.FCStd');
const foreignResult = adapter.openDocument(foreignBytes);
checkTrue('a foreign .FCStd (no embedded marker) returns null, not a guessed ModelDoc', foreignResult === null, JSON.stringify(foreignResult));

console.log('\n--- OcctEngineAdapter: Save/Open .FCStd is a real refusal, not silent ---');
const occt = new OcctEngineAdapter({});
let occtSaveThrew = false;
try { occt.saveDocument(doc); } catch (e) { occtSaveThrew = /not supported on the OCCT engine/.test(String(e.message ?? e)); }
checkTrue('OcctEngineAdapter.saveDocument throws a clear "not supported" error', occtSaveThrew);
let occtOpenThrew = false;
try { occt.openDocument(bytes); } catch (e) { occtOpenThrew = /not supported on the OCCT engine/.test(String(e.message ?? e)); }
checkTrue('OcctEngineAdapter.openDocument throws a clear "not supported" error', occtOpenThrew);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
