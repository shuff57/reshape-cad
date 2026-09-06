// engine/bridge/session-test.mjs
//
// Proves the command-bridge core against the PartDesign node kernel: load,
// open a document, build a parametric Body -> Sketch(40x40) -> Pad(20) (raw
// Python for now; typed commands land in fc-commands.mjs next), then read the
// feature tree and the tessellated mesh back through the sentinel channel.
//
// Run inside the kernel-build-final container (resources present):
//   node --experimental-wasm-exnref engine/bridge/session-test.mjs \
//        /work/build/bin/FreeCADCmd.js

import assert from 'node:assert/strict';
import { createFcSession, loadNodeKernel } from './fc-session.mjs';

const kernelJs = process.argv[2] || '/work/build/bin/FreeCADCmd.js';

const Module = await loadNodeKernel(kernelJs);
const s = createFcSession(Module);
s.newDocument('studio');

const r = s.exec(
  `import FreeCAD as App, Part, Sketcher\n` +
  `doc = App.ActiveDocument\n` +
  `body = doc.addObject("PartDesign::Body", "Body")\n` +
  `sk = body.newObject("Sketcher::SketchObject", "Sketch")\n` +
  `sk.addGeometry(Part.LineSegment(App.Vector(0,0,0),   App.Vector(40,0,0)),  False)\n` +
  `sk.addGeometry(Part.LineSegment(App.Vector(40,0,0),  App.Vector(40,40,0)), False)\n` +
  `sk.addGeometry(Part.LineSegment(App.Vector(40,40,0), App.Vector(0,40,0)),  False)\n` +
  `sk.addGeometry(Part.LineSegment(App.Vector(0,40,0),  App.Vector(0,0,0)),   False)\n` +
  `pad = body.newObject("PartDesign::Pad", "Pad")\n` +
  `pad.Profile = sk\n` +
  `pad.Length = 20\n` +
  `doc.recompute()\n`
);
assert.equal(r.rc, 0, `pad build rc (out:\n${r.out})`);

const tree = s.tree();
const names = tree.objects.map((o) => o.name);
console.log('TREE:', JSON.stringify(names));
assert.ok(
  names.includes('Body') && names.includes('Sketch') && names.includes('Pad'),
  'tree must contain Body, Sketch, Pad'
);

const m = s.mesh();
console.log(
  `MESH: verts=${m.positions.length / 3} tris=${m.indices.length / 3} vol=${m.volume} obj=${m.object}`
);
assert.ok(m.positions.length > 0, 'mesh must have vertices');
assert.ok(m.indices.length > 0, 'mesh must have triangles');
assert.ok(Math.abs(m.volume - 32000) < 1, `volume ~32000, got ${m.volume}`);

// Parametric edit: change the Pad length, recompute, mesh volume must track.
const r2 = s.exec(
  `import FreeCAD as App\n` +
  `doc = App.ActiveDocument\n` +
  `doc.getObject("Pad").Length = 30\n` +
  `doc.recompute()\n`
);
assert.equal(r2.rc, 0, 'reparam rc');
const m2 = s.mesh();
console.log(`MESH2 (Length=30): vol=${m2.volume}`);
assert.ok(Math.abs(m2.volume - 48000) < 1, `edited volume ~48000, got ${m2.volume}`);

console.log('SESSION_TEST:PASS');
process.exit(0);
