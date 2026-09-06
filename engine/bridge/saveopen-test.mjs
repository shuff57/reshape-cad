// engine/bridge/saveopen-test.mjs
//
// Lead's gate for step ② (.FCStd save/open). Build a parametric body, save it
// to a real .FCStd, then reopen it FROM ITS BYTES in the same kernel and check
// the geometry survives. The saved file is also written to a mounted host path
// (/host-out/roundtrip.FCStd) so the desktop FreeCAD 1.1.3 oracle can confirm
// it is a valid, self-contained document.
//
//   node --experimental-wasm-exnref engine/bridge/saveopen-test.mjs \
//        /work/build/bin/FreeCADCmd.js

import assert from 'node:assert/strict';
import { createFcSession, loadNodeKernel } from './fc-session.mjs';
import { attachCommands } from './fc-commands.mjs';

const kernelJs = process.argv[2] || '/work/build/bin/FreeCADCmd.js';
const HOST_OUT = '/host-out/roundtrip.FCStd'; // mounted -> host scratchpad

const s = attachCommands(createFcSession(await loadNodeKernel(kernelJs)));
s.newDocument('studio');
s.newBody('Body');
s.sketchRect('Body', 'Sketch', 40, 40);
s.pad('Body', 'Sketch', 'Pad', 20);
const v1 = s.mesh().volume;
console.log(`BUILT: vol=${v1}`);
assert.ok(Math.abs(v1 - 32000) < 1, `built vol ~32000, got ${v1}`);

// Save to a host-visible path (for the oracle) — saveDocument returns the bytes.
const bytes = s.saveDocument(HOST_OUT);
console.log(`SAVED: ${bytes.length} bytes -> ${HOST_OUT}`);
assert.ok(bytes.length > 1000, `.FCStd should be a non-trivial zip, got ${bytes.length}`);
// .FCStd is a zip; first two bytes are 'PK'.
assert.equal(bytes[0], 0x50, 'FCStd byte0 P');
assert.equal(bytes[1], 0x4b, 'FCStd byte1 K');

// Replace the active document, then reopen FROM THE BYTES and re-check volume.
s.newDocument('scratch');
const empty = s.mesh();
assert.ok(!empty.positions || empty.positions.length === 0, 'scratch doc should be empty');
const openedName = s.openDocument(bytes);
console.log(`REOPENED: doc=${openedName}`);
const v2 = s.mesh().volume;
console.log(`REOPEN: vol=${v2}`);
assert.ok(Math.abs(v2 - 32000) < 1, `reopened vol ~32000, got ${v2}`);
const names = s.tree().objects.map((o) => o.name);
assert.ok(['Body', 'Sketch', 'Pad'].every((n) => names.includes(n)), 'reopened tree has Body/Sketch/Pad');

console.log('SAVEOPEN:PASS');
process.exit(0);
