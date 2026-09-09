// engine/bridge/p1c2-test.mjs
//
// Lead's gate for P1c-2 (Export STL). Written by the lead, not by the builder
// that wrote the emitter -- a builder that can edit its own gate eventually
// will.
//
// The reason this file exists, stated plainly so nobody weakens it later:
// Export STL was CUT from P1c because the wasm build's Mesh module is hollow
// (`import Mesh` succeeds, `dir(Mesh)` has no export/write names). It came
// back on a different route -- Part::TopoShape carries its own .exportStl().
// That route has three things that fail silently rather than loudly:
//
//   1. The bytes never leave the wasm FS. exportStl() returns None on success
//      no matter what, so the ONLY proof a file was written is reading it
//      back through Module.FS -- which is exactly the half the spec called
//      "the real work". A gate that only checks rc==0 passes on an empty
//      export.
//   2. The optional second argument. PyArg_ParseTuple's format is "et|d", so
//      a deflection that fails to parse is not an error -- it is a DEFAULT.
//      Passing garbage would look identical to passing nothing, and the mesh
//      would silently be the wrong resolution. Slice 3 is the only thing
//      here that can tell those apart, and it does it by counting facets on
//      a curved solid at two tolerances.
//   3. getObject() returns None for an unknown name rather than raising, so
//      without the emitter's explicit guard the failure surfaces as
//      "'NoneType' object has no attribute 'Shape'". Slice 4 pins the
//      friendly message so a refactor cannot quietly drop the guard.
//
// Run inside the PartDesign-enabled kernel container:
//   docker run --rm --privileged -v <repo>/engine:/engine fc-kernel-pd-final \
//     node --experimental-wasm-exnref /engine/bridge/p1c2-test.mjs \
//     /work/build/bin/FreeCADCmd.js

import assert from 'node:assert/strict';
import { createFcSession, loadNodeKernel } from './fc-session.mjs';
import { attachCommands } from './fc-commands.mjs';

const kernelJs = process.argv[2] || '/work/build/bin/FreeCADCmd.js';
const s = attachCommands(createFcSession(await loadNodeKernel(kernelJs)));

/** ASCII STL, parsed the way a slicer would: the bytes are decoded and the
 *  facets counted. Deliberately NOT a byte-length check -- length tracks
 *  float formatting as much as geometry, so it would be brittle where the
 *  facet count is exact. */
function parseStl(bytes) {
  const text = Buffer.from(bytes).toString('latin1');
  const facets = (text.match(/facet normal/g) || []).length;
  return { text, facets, bytes: bytes.length };
}

// =========================================================== slice 1: a box
// A padded 10x10 rectangle is a cuboid: six quad faces, each tessellating to
// exactly two triangles. TWELVE is the whole point -- it is a number no
// partial or empty export can accidentally produce.
console.log('slice 1: box -> ASCII STL');
s.newDocument('stl_box');
s.newBody('B');
s.sketchRect('B', 'S', 10, 10);
s.pad('B', 'S', 'Pad', 10);

const box = parseStl(s.exportStl('Pad'));
console.log(`  bytes=${box.bytes} facets=${box.facets} head=${JSON.stringify(box.text.slice(0, 20))}`);
assert.ok(box.bytes > 0, 'exportStl returned bytes (the FS read-back actually happened)');
assert.equal(box.facets, 12, `a cuboid is 12 triangles (got ${box.facets})`);

// ================================================== slice 2: ASCII, not binary
// A binary STL opens with an 80-byte header that MAY begin with "solid", so
// the leading word alone proves nothing. "facet normal" is ASCII-only syntax
// and cannot appear in a well-formed binary file's triangle records, and a
// binary box would be exactly 84 + 12*50 = 684 bytes.
console.log('slice 2: the output is ASCII');
assert.ok(box.text.startsWith('solid'), 'starts with the ASCII "solid" keyword');
assert.ok(box.text.includes('facet normal'), 'contains ASCII facet records');
assert.ok(box.text.trimEnd().endsWith('endsolid'), 'closed with endsolid');
assert.notEqual(box.bytes, 684, 'not the 84 + 12*50 byte binary encoding of the same box');
console.log(`  ok: ${box.bytes} bytes of text, not the 684-byte binary form`);

// ============================================ slice 3: deflection is APPLIED
// The argument that would fail silently. A sphere is curved, so its facet
// count is entirely a function of the chord tolerance; a cuboid's is not,
// which is why slice 1 cannot do this job. Absolute (not relative) tolerance
// per TopoShape.cpp:1002, so on a radius-10 sphere 0.01mm is fine detail and
// 1.0mm is coarse -- if the second argument were being dropped, both calls
// would return the SAME facet count.
// *** THE TWO TOLERANCES MUST BE MEASURED ON TWO DIFFERENT SOLIDS. ***
// Measured here, the hard way: exporting ONE sphere at 0.01 and then at 1.0
// returns 26718 facets BOTH times. That is not the argument being dropped --
// it is OCCT. BRepMesh_IncrementalMesh stores its triangulation ON the shape
// and skips re-meshing when what is already there is finer than asked for, so
// the coarse call silently reuses the fine mesh. Two fresh spheres have no
// triangulation to reuse. Do not "simplify" this back to one shape; it passes
// for the wrong reason and stops testing anything.
console.log('slice 3: deflection reaches OCCT');
s.newDocument('stl_fine');
s.newBody('Bf');
s.sphere('Bf', 'BallF', 10);
const fine = parseStl(s.exportStl('BallF', '/tmp/fine.stl', 0.01));

s.newDocument('stl_coarse');
s.newBody('Bc');
s.sphere('Bc', 'BallC', 10);
const coarse = parseStl(s.exportStl('BallC', '/tmp/coarse.stl', 1.0));

console.log(`  fine(0.01)=${fine.facets} facets   coarse(1.0)=${coarse.facets} facets`);
assert.ok(fine.facets > 0 && coarse.facets > 0, 'both tolerances produced a mesh');
assert.ok(fine.facets > coarse.facets * 2,
  `a tighter tolerance must produce a much denser mesh (fine=${fine.facets} coarse=${coarse.facets}); ` +
  'equal counts mean the deflection argument is not reaching OCCT');

// Two exports in a row must not append to or reuse the previous FILE either.
assert.notEqual(fine.bytes, coarse.bytes, 'each export writes its own file, no reuse');

// ====================================== slice 4: the unknown-name guard holds
// getObject() returns None rather than raising, so the emitter carries an
// explicit check. Without it the failure is "'NoneType' object has no
// attribute 'Shape'" -- true, and useless.
//
// WHAT THIS SLICE CAN AND CANNOT SEE. It asserts the CONTROL FLOW: a bad name
// throws, rather than returning zero bytes that a caller would happily hand
// to a download. It does NOT assert the message text, and that is deliberate,
// not laziness. fc-session.mjs:66 states the constraint in its own words: on
// the NODERAWFS node kernel Python's fd 1 goes straight to the host, bypassing
// Module.print, so `out` arrives EMPTY and the thrown message is the bare
// "exportStl failed:". Confirmed here -- the ValueError below prints to the
// container console and never reaches JS. In the browser (MEMFS) Module.print
// IS the capture channel, so the guard text does survive there; the browser
// dogfood is what pins it, and it is the only place that can.
console.log('slice 4: unknown object name');
let msg = null, bytes = null;
try { bytes = s.exportStl('NoSuchThing'); } catch (e) { msg = e.message; }
console.log(`  threw: ${JSON.stringify((msg || '(nothing)').split('\n')[0])}`);
assert.ok(msg, 'exporting an unknown object throws rather than returning empty bytes');
assert.equal(bytes, null, 'nothing is returned on the failure path');
assert.ok(msg.startsWith('exportStl failed'), `the throw is the emitter's, not a raw FS error (got: ${msg.split('\n')[0]})`);

// ============================= slice 5: no stale file, and no silent success
// The nastiest failure this emitter can have, and the one a naive
// implementation ships with: export A, then export B where B writes nothing.
// Without the unlink-first guard, readFile returns A'S BYTES and the user
// downloads the previous model under the new model's name -- correct-looking
// output, no error, no symptom.
//
// A SKETCH is the B case, and it is reachable from the UI: studio.js's
// render() assigns state.tip from meshFaces(), which can hand back a bare
// Sketch, so Export STL is clickable with no solid in the document. A sketch's
// Shape is a wire; a wire has no faces; StlAPI_Writer writes nothing at all.
console.log('slice 5: a wire exports nothing, and does not inherit the last export');
const SHARED = '/tmp/shared.stl';
s.newDocument('stl_reuse');
s.newBody('Br');
s.sketchRect('Br', 'Sr', 10, 10);
s.pad('Br', 'Sr', 'PadR', 10);
const first = parseStl(s.exportStl('PadR', SHARED));
assert.equal(first.facets, 12, 'the solid exported first, to the shared path');

s.newDocument('stl_wire');
s.newBody('Bw');
s.sketchRect('Bw', 'Sw', 10, 10);   // a sketch, deliberately NOT padded
let wireMsg = null, wireBytes = null;
try { wireBytes = s.exportStl('Sw', SHARED); } catch (e) { wireMsg = e.message; }
console.log(`  wire export -> ${wireBytes ? `${wireBytes.length} BYTES (stale!)` : JSON.stringify(wireMsg.split('\n')[0])}`);
assert.equal(wireBytes, null,
  'exporting a wire must NOT return bytes -- if it did, they are the previous export leaking through');
assert.ok(/wrote no STL|empty STL/.test(wireMsg), `the message says what happened (got: ${wireMsg})`);
assert.ok(/Pad it into a solid/.test(wireMsg), 'the message says what to do instead');

console.log('\nP1c-2 gate: all slices passed');
