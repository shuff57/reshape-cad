// engine/bridge/p1c2-test.mjs
//
// Lead's gate for P1c-2 (Export STL): fc-session.mjs's exportStl().
// Written by the lead, not by the builder that wrote the emitter -- a builder
// that can edit its own gate eventually will.
//
// The builder could not run this code at all (msgbox #120: "I cannot run the
// kernel container, so exportStl was never executed -- the Python string, the
// rc!==0 path, and the FS read-back are unverified at runtime"). So everything
// below is a first execution, not a re-check.
//
// WHAT THIS GATE IS SHAPED AGAINST. Export STL has an unusually quiet set of
// failure modes -- most of them hand the user a file, so "a download happened"
// proves nothing:
//
//   1. THE WRONG SHAPE. A mesh of something else is still a valid STL. So
//      slice 1 reads the triangles back out and measures their bounding box,
//      rather than trusting a byte count.
//   2. An IGNORED deflection. If `${Number(deflection)}` were dropped or
//      pinned, every export would silently be one fixed quality. Byte length
//      never reveals it -- you have to ask for two tolerances and watch the
//      count move. slice 2.
//   3. A STALE file. readFile() returns the PREVIOUS run's bytes when this
//      export wrote nothing. The user downloads yesterday's model under
//      today's name and there is no symptom at all. slice 3.
//   4. A CRASHED handler. Module.FS.readFile throws an Emscripten ErrnoError,
//      which carries NO .message. studio.js's guard() does e.message.split(),
//      so an untranslated throw kills the handler and the user sees nothing --
//      no log line, no download, no error. slice 4 asserts .message is a real
//      string, because that is the property the caller actually touches.
//   5. getObject() returns None for an unknown name rather than raising, so
//      without the emitter's explicit guard the failure is a bare
//      AttributeError on NoneType. slice 5.
//
// Run inside the PartDesign-enabled kernel container:
//   docker run --rm --privileged -v <repo>/engine:/engine fc-kernel-pd-final \
//     node --experimental-wasm-exnref /engine/bridge/p1c2-test.mjs \
//     /work/build/bin/FreeCADCmd.js

import assert from 'node:assert/strict';
import { createFcSession } from '../../packages/engine/src/fc-session.mjs';
import { loadNodeKernel } from '../../packages/engine/src/fc-session-node.mjs';
import { attachCommands } from '../../packages/engine/src/fc-commands.mjs';
import { attachSketchCommands } from '../../packages/engine/src/fc-sketch.mjs';

const kernelJs = process.argv[2] || '/work/build/bin/FreeCADCmd.js';
const s = attachSketchCommands(attachCommands(createFcSession(await loadNodeKernel(kernelJs))));

/** Parse an STL -- binary or ASCII -- into a triangle count and its vertices.
 *
 *  MEASURED: this build writes ASCII. slice 1 prints `format=ascii`, and a
 *  20x10x5 box comes to 3052 bytes where the binary encoding of the same 12
 *  triangles would be 84 + 12*50 = 684. That is OCCT's StlAPI_Writer default
 *  (ASCIIMode true), not a FreeCAD choice, and nothing in the emitter pins it.
 *  So this reads EITHER format rather than asserting one the gate does not
 *  actually care about -- what it cares about is that the file contains the
 *  triangles of the shape we asked for. Do not "correct" the reader to
 *  binary-only, or to ASCII-only, on the strength of either name.
 *
 *  Binary layout: 80-byte header, uint32 triangle count, then 50 bytes per
 *  triangle (12 floats -- normal + 3 vertices -- plus a uint16 attribute).
 *  That fixed stride is itself a check: a file whose length is not
 *  84 + 50*n is not an STL, however plausible its first bytes look. */
function parseStl(bytes) {
  const head = new TextDecoder().decode(bytes.subarray(0, 5));
  if (head === 'solid') {
    const text = new TextDecoder().decode(bytes);
    const verts = [...text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)]
      .map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
    return { format: 'ascii', count: (text.match(/facet\s+normal/g) || []).length, verts };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  assert.equal(bytes.length, 84 + 50 * count,
    `binary STL length is 84 + 50*triangles (got ${bytes.length} for ${count} triangles) -- not an STL`);
  const verts = [];
  for (let t = 0; t < count; t++) {
    const base = 84 + 50 * t + 12; // skip the per-facet normal
    for (let v = 0; v < 3; v++) {
      const o = base + 12 * v;
      verts.push([view.getFloat32(o, true), view.getFloat32(o + 4, true), view.getFloat32(o + 8, true)]);
    }
  }
  return { format: 'binary', count, verts };
}

function extent(verts) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) {
    for (let i = 0; i < 3; i++) {
      if (v[i] < lo[i]) lo[i] = v[i];
      if (v[i] > hi[i]) hi[i] = v[i];
    }
  }
  return [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
}

/** A padded rectangle, i.e. a box with six planar faces. */
function makeBox(doc, w, d, h) {
  s.newDocument(doc);
  s.newBody('B');
  s.sketchNew('B', 'S');
  s.sketchAddRectangle('S', 0, 0, w, d);
  s.pad('B', 'S', 'Pad', h);
}

/** A padded circle, i.e. a cylinder -- a curved solid, whose triangle count
 *  can move with deflection where a box's never will. */
function makeCylinder(doc, r, h) {
  s.newDocument(doc);
  s.newBody('B');
  s.sketchNew('B', 'S');
  s.sketchAddCircle('S', 0, 0, r);
  s.pad('B', 'S', 'Pad', h);
}

// --- slice 1: a solid exports an STL that IS the solid ----------------------
// A box is the right first case for one reason: its triangle count is not
// approximately anything. Six quads split into exactly 12 triangles, at every
// deflection, forever. So "12" is a real assertion rather than a tolerance,
// and the bounding box then proves those 12 triangles belong to OUR box and
// not to some other object left in the document.
console.log('slice 1: a padded rectangle exports a 12-triangle STL of the right size');
{
  makeBox('stl_box', 20, 10, 5);
  const bytes = s.exportStl('Pad', '/tmp/p1c2_box.stl', 0.01);
  const stl = parseStl(bytes);
  const [dx, dy, dz] = extent(stl.verts);
  console.log(`  format=${stl.format} bytes=${bytes.length} triangles=${stl.count}`);
  console.log(`  extent=${dx.toFixed(4)} x ${dy.toFixed(4)} x ${dz.toFixed(4)}  want 20 x 10 x 5`);
  assert.ok(bytes.length > 0, 'export produced bytes');
  assert.equal(stl.count, 12, `a box is exactly 12 triangles (got ${stl.count}) -- is this even our shape?`);
  assert.ok(Math.abs(dx - 20) < 1e-3, `X extent is 20 (got ${dx})`);
  assert.ok(Math.abs(dy - 10) < 1e-3, `Y extent is 10 (got ${dy})`);
  assert.ok(Math.abs(dz - 5) < 1e-3, `Z extent is 5 (got ${dz})`);
}

// --- slice 2: the deflection argument is actually used ----------------------
// The one failure the browser cannot show you. A pinned or dropped deflection
// exports a perfectly good STL every time -- just always at one quality. The
// only way to see it is to ask for two and watch the count move. Planar faces
// never refine, so this needs the cylinder.
//
// *** THE TWO TOLERANCES MUST BE MEASURED ON TWO FRESHLY BUILT SOLIDS. ***
// Not a style preference -- measured, three times, and the reason is worth the
// paragraph because the naive version passes often enough to look fine.
//
// BRepMesh_IncrementalMesh can REUSE a triangulation already attached to the
// shape instead of re-meshing it, so a second export at a COARSER deflection
// may hand back the finer mesh it already has. Observed on a PartDesign
// sphere: 26718 triangles at BOTH 0.01 and 1.0 on one shape, versus 26718 and
// 8002 on two fresh spheres. Then observed to be NON-DETERMINISTIC on this
// very cylinder: the same one-shape sequence gave 912 then 500 on one run and
// 912 then 912 on the next, with nothing changed in between.
//
// So a same-shape comparison is a coin flip that fails as a FALSE ALARM --
// it reports "the deflection never reached the kernel" when the argument is
// perfectly fine. Two fresh solids have no triangulation to reuse and the
// comparison becomes deterministic. Do not "simplify" this back to one shape.
console.log('slice 2: deflection changes the mesh (proves Number(deflection) reaches the kernel)');
{
  makeCylinder('stl_cyl_fine', 10, 5);
  const fine = parseStl(s.exportStl('Pad', '/tmp/p1c2_fine.stl', 0.01));
  makeCylinder('stl_cyl_coarse', 10, 5);
  const coarse = parseStl(s.exportStl('Pad', '/tmp/p1c2_coarse.stl', 1.0));
  console.log(`  deflection 0.01 -> ${fine.count} triangles`);
  console.log(`  deflection 1.00 -> ${coarse.count} triangles`);
  assert.ok(fine.count > 0 && coarse.count > 0, 'both exports produced triangles');
  assert.ok(coarse.count < fine.count,
    `a coarser deflection means fewer triangles (fine=${fine.count}, coarse=${coarse.count}) -- ` +
    'on two FRESH solids there is no triangulation to reuse, so equal counts here really do mean ' +
    'the deflection argument never reached the kernel');
}

// --- slice 3: a failed export never hands back the previous file ------------
// The emitter unlinks the target BEFORE exporting, and this is what that line
// is for. Export a box to a path, then aim a doomed export at the SAME path:
// the throw must happen AND the file must be gone. If the unlink were removed
// this slice still throws (the sketch still fails) but the file survives --
// which is precisely the state in which a later readFile hands the user a
// stale model with no symptom.
console.log('slice 3: a failed export clears the target rather than leaving a stale file');
{
  const shared = '/tmp/p1c2_shared.stl';
  makeBox('stl_stale', 8, 8, 8);
  const first = parseStl(s.exportStl('Pad', shared, 0.01));
  assert.equal(first.count, 12, 'the good export landed first');
  console.log(`  wrote ${first.count} triangles to ${shared}`);

  // A bare sketch has no faces to mesh, so this export writes nothing.
  s.newDocument('stl_stale2');
  s.newBody('B2');
  s.sketchNew('B2', 'S2');
  s.sketchAddRectangle('S2', 0, 0, 4, 4);
  assert.throws(() => s.exportStl('S2', shared, 0.01), /wrote no STL|exportStl failed/,
    'exporting a bare sketch to the shared path fails');

  let survived = true;
  try { s.Module.FS.readFile(shared); } catch { survived = false; }
  console.log(`  after the failed export, ${shared} still present: ${survived}`);
  assert.equal(survived, false,
    'the failed export left the previous STL in place -- the next reader hands the user a stale model');
}

// --- slice 4: the sketch refusal is a real Error, not an ErrnoError ---------
// studio.js's guard() calls e.message.split(). An Emscripten ErrnoError has no
// .message, so an untranslated throw crashes the handler and the student sees
// NOTHING -- no download, no error line. Asserting the text is not enough:
// assert the property the caller actually touches, and touch it the same way.
console.log('slice 4: exporting a sketch refuses with a message a caller can read');
{
  s.newDocument('stl_sketch');
  s.newBody('B');
  s.sketchNew('B', 'S');
  s.sketchAddRectangle('S', 0, 0, 6, 6);
  let err = null;
  try { s.exportStl('S', '/tmp/p1c2_sketch.stl', 0.01); } catch (e) { err = e; }
  console.log(`  threw: ${err && err.constructor && err.constructor.name}`);
  console.log(`  message: ${err && err.message}`);
  assert.ok(err instanceof Error, 'a sketch export throws a real Error');
  assert.equal(typeof err.message, 'string', 'the Error carries a .message -- guard() reads it');
  assert.ok(err.message.length > 0, 'the .message is not empty');
  assert.doesNotThrow(() => err.message.split('\n'), 'guard() can split the message without dying');
  assert.match(err.message, /Pad it into a solid first/,
    'the refusal tells the student what to do, in the house voice');
}

// --- slice 5: a name that is not in the document says so --------------------
// The None-check guard. Without it App.ActiveDocument.getObject() returns None
// and `None.Shape` raises a bare AttributeError, which tells the student
// nothing about what they did wrong.
//
// The MESSAGE is matched loosely on purpose. fc-session.mjs:66 states the
// constraint: on the NODERAWFS node kernel Python's fd 1 goes straight to the
// host, bypassing Module.print, so `out` arrives empty here and the thrown
// text is the bare "exportStl failed:". The ValueError is real -- it prints to
// the container console below -- it just cannot reach JS in THIS kernel. In
// the browser (MEMFS) Module.print is the capture channel and the text does
// survive; the browser dogfood is the only place that can pin it.
console.log('slice 5: an unknown object name is refused by name');
{
  makeBox('stl_missing', 5, 5, 5);
  let err = null;
  try { s.exportStl('NotAThing', '/tmp/p1c2_missing.stl', 0.01); } catch (e) { err = e; }
  console.log(`  message: ${err && String(err.message).split('\n')[0]}`);
  assert.ok(err instanceof Error, 'an unknown name throws');
  assert.match(err.message, /no such object: NotAThing|exportStl failed/,
    'the refusal names the object that was not found');
}

console.log('\nP1c-2 gate: all slices passed');
