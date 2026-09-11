// engine/bridge/hist-test.mjs
//
// Gate for editable history: read a feature's parameter, edit it safely
// (tip edits succeed; oversized fillet is capped; an upstream edit that breaks a
// downstream feature is reverted), and delete tip-first (a feature with
// dependents refuses).
//
//   docker run --rm --privileged -v <repo>/engine:/engine fc-kernel-pd-final \
//     node --experimental-wasm-exnref /engine/bridge/hist-test.mjs \
//     /work/build/bin/FreeCADCmd.js

import assert from 'node:assert/strict';
import { createFcSession } from '../../packages/engine/src/fc-session.mjs';
import { loadNodeKernel } from '../../packages/engine/src/fc-session-node.mjs';
import { attachCommands } from '../../packages/engine/src/fc-commands.mjs';

const kernelJs = process.argv[2] || '/work/build/bin/FreeCADCmd.js';
const s = attachCommands(createFcSession(await loadNodeKernel(kernelJs)));

s.newDocument('h');
s.newBody('Body');
s.sketchRect('Body', 'Sketch', 40, 30);
s.pad('Body', 'Sketch', 'Pad', 20);
s.fillet('Body', 'Pad', ['Edge1'], 5);

// read parameters
const padInfo = s.featureInfo('Pad');
const filInfo = s.featureInfo('Fillet');
console.log(`info: Pad=${padInfo.param}:${padInfo.value}  Fillet=${filInfo.param}:${filInfo.value}`);
assert.equal(padInfo.param, 'Length'); assert.equal(padInfo.value, 20);
assert.equal(filInfo.param, 'Radius'); assert.equal(filInfo.value, 5);

// TIP edit (safe): fillet radius 5 -> 8, volume drops (more rounding)
const volR5 = s.mesh().volume;
s.editFeature('Fillet', 8);
assert.equal(s.featureInfo('Fillet').value, 8, 'fillet radius edited to 8');
assert.ok(s.mesh().volume < volR5, 'bigger fillet removed more material');

// oversized fillet edit is capped (no crash)
let threwBig = false;
try { s.editFeature('Fillet', 999); } catch { threwBig = true; }
assert.ok(threwBig, 'oversized fillet edit rejected');
assert.equal(s.featureInfo('Fillet').value, 8, 'fillet unchanged after rejected edit');

// UPSTREAM edit that breaks the fillet is REVERTED, not left broken
let threwUp = false;
try { s.editFeature('Pad', 30); } catch { threwUp = true; }
console.log(`upstream Pad edit threw=${threwUp}, Pad.Length now=${s.featureInfo('Pad').value}`);
assert.ok(threwUp, 'an upstream edit that breaks a downstream feature is rejected');
assert.equal(s.featureInfo('Pad').value, 20, 'Pad.Length reverted to 20');
assert.ok(s.mesh().volume > 0, 'model still valid after the reverted edit');

// delete refuses a feature with dependents (Pad has the Fillet)
let threwDep = false;
try { s.deleteFeature('Pad'); } catch { threwDep = true; }
assert.ok(threwDep, 'deleting Pad refuses while Fillet depends on it');

// delete the tip (Fillet) is fine -> box back to a plain 24000
s.deleteFeature('Fillet');
// Body.Tip must move to Pad, not dangle at the deleted Fillet (a dangling tip
// makes the Body's mirrored shape point at freed geometry -> tessellation
// crash in the browser). Check both the tip AND the per-face mesh render path.
const tip = s.read(
  `import json, FreeCAD as App\n` +
  `doc = App.ActiveDocument\n` +
  `b = [o for o in doc.Objects if o.TypeId == 'PartDesign::Body'][0]\n` +
  `open('/tmp/reshape_out.json','w').write(json.dumps({'tip': (b.Tip.Name if b.Tip else None)}))\n`
);
console.log(`after delete Fillet: tip=${tip.tip} vol=${s.mesh().volume}`);
assert.equal(tip.tip, 'Pad', 'Body.Tip moved to Pad after deleting the Fillet (not dangling)');
assert.equal(s.meshFaces().faces.length, 6, 'per-face mesh (browser render path) is a plain box after delete');
assert.ok(Math.abs(s.mesh().volume - 24000) < 1, 'deleting the tip fillet restores the plain box');

console.log('HIST:PASS');
process.exit(0);
