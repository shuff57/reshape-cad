// engine/bridge/sweep-test.mjs
//
// String-shape unit tests for the profile-driven sweep emitters (groove,
// subtractive/additive loft, additive pipe, additive/subtractive helix).
// NO engine, NO external deps: asserts on the emitted Python strings only.
// Engine integration is the lead's job (transpile-integration.mjs and the
// kernel-container runs).
//
// Run from the repo root:
//   node --test engine/bridge/sweep-test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emit } from './fc-commands.mjs';

// Every sweep emitter is a wrapStatus body: opens with `import json` + the
// defensive head, ends with the status-write.
const WRAP_HEAD = 'import json\nimport FreeCAD as App\nimport Part\nimport Sketcher\ndoc = App.ActiveDocument\n';
const WRAP_TAIL = 'open("/tmp/reshape_out.json", "w").write(json.dumps(_res))\n';

test('every sweep emitter opens with the wrapStatus head and ends with the status write', () => {
  const pys = [
    emit.groove('Body', 'Sketch', 'Groove'),
    emit.groove('Body', 'Sketch', 'Groove', 180),
    emit.subtractiveLoft('Body', 'SketchA', 'SketchB', 'SubLoft'),
    emit.subtractiveLoft('Body', 'SketchA', 'SketchB', 'SubLoft', 2),
    emit.additiveLoft('Body', 'SketchA', 'SketchB', 'AddLoft'),
    emit.additivePipe('Body', 'Profile', 'Path', 'Pipe'),
    emit.additiveHelix('Body', 'Sketch', 'Spring', 30, 5),
    emit.subtractiveHelix('Body', 'Sketch', 'Thread', 30, 5),
  ];
  for (const py of pys) {
    assert.ok(py.startsWith(WRAP_HEAD), py.slice(0, 80));
    assert.ok(py.endsWith(WRAP_TAIL), py.slice(-80));
  }
});

test('groove: PartDesign::Groove on the body, Profile + V_Axis, Angle 360 default / settable', () => {
  const py = emit.groove('Body', 'Sketch', 'Groove');
  assert.ok(py.includes('doc.getObject("Body").newObject("PartDesign::Groove", "Groove")'), py);
  assert.ok(py.includes('gr.Profile = doc.getObject("Sketch")'), py);
  assert.ok(py.includes("gr.ReferenceAxis = (doc.getObject(\"Sketch\"), ['V_Axis'])"), py);
  assert.ok(py.includes('gr.Angle = 360'), py);
  const py180 = emit.groove('Body', 'Sketch', 'Groove', 180);
  assert.ok(py180.includes('gr.Angle = 180'), py180);
});

test('subtractiveLoft: Profile + Sections, Thickness only when gap > 0', () => {
  const plain = emit.subtractiveLoft('Body', 'SketchA', 'SketchB', 'SubLoft');
  assert.ok(plain.includes('doc.getObject("Body").newObject("PartDesign::SubtractiveLoft", "SubLoft")'), plain);
  assert.ok(plain.includes('ls.Profile = doc.getObject("SketchA")'), plain);
  assert.ok(plain.includes('ls.Sections = [doc.getObject("SketchB")]'), plain);
  assert.ok(!plain.includes('Thickness'), plain);
  const thick = emit.subtractiveLoft('Body', 'SketchA', 'SketchB', 'SubLoft', 2);
  assert.ok(thick.includes('ls.Thickness = 2'), thick);
});

test('additiveLoft: PartDesign::AdditiveLoft, Profile + Sections', () => {
  const py = emit.additiveLoft('Body', 'SketchA', 'SketchB', 'AddLoft');
  assert.ok(py.includes('doc.getObject("Body").newObject("PartDesign::AdditiveLoft", "AddLoft")'), py);
  assert.ok(py.includes('lo.Profile = doc.getObject("SketchA")'), py);
  assert.ok(py.includes('lo.Sections = [doc.getObject("SketchB")]'), py);
});

test('additivePipe: Profile by name, Spine rides the path sketch Edge1', () => {
  const py = emit.additivePipe('Body', 'Profile', 'Path', 'Pipe');
  assert.ok(py.includes('doc.getObject("Body").newObject("PartDesign::AdditivePipe", "Pipe")'), py);
  assert.ok(py.includes('ap.Profile = doc.getObject("Profile")'), py);
  assert.ok(py.includes("ap.Spine = (doc.getObject(\"Path\"), ['Edge1'])"), py);
});

test('helixes: correct TypeIds, Height/Turns set, Angle 360, ReferenceAxis N_Axis (sketch normal — the helix rides ALONG the axis like Pad, perpendicular to the profile; V_Axis is in-plane and self-intersects at any pitch, msgbox #74)', () => {
  const add = emit.additiveHelix('Body', 'Sketch', 'Spring', 30, 5);
  assert.ok(add.includes('doc.getObject("Body").newObject("PartDesign::AdditiveHelix", "Spring")'), add);
  assert.ok(add.includes("ah.ReferenceAxis = (doc.getObject(\"Sketch\"), ['N_Axis'])"), add);
  assert.ok(add.includes('ah.Height = 30'), add);
  assert.ok(add.includes('ah.Turns = 5'), add);
  assert.ok(add.includes('ah.Angle = 360'), add);
  const sub = emit.subtractiveHelix('Body', 'Sketch', 'Thread', 30, 5);
  assert.ok(sub.includes('doc.getObject("Body").newObject("PartDesign::SubtractiveHelix", "Thread")'), sub);
  assert.ok(sub.includes("sh.ReferenceAxis = (doc.getObject(\"Sketch\"), ['N_Axis'])"), sub);
  assert.ok(sub.includes('sh.Height = 30'), sub);
  assert.ok(sub.includes('sh.Turns = 5'), sub);
  assert.ok(sub.includes('sh.Angle = 360'), sub);
});

test('every sweep emitter carries the clean-failure branch and its message', () => {
  const cases = [
    [emit.groove('Body', 'S', 'G'), 'gr', 'groove failed — the profile must be a closed loop that does not cross the vertical axis'],
    [emit.subtractiveLoft('Body', 'S', 'T', 'L'), 'ls', 'subtractive loft failed — the two profiles must be closed loops of the same shape'],
    [emit.additiveLoft('Body', 'S', 'T', 'L'), 'lo', 'additive loft failed — the two profiles must be closed loops of the same shape'],
    [emit.additivePipe('Body', 'S', 'P', 'X'), 'ap', 'pipe failed — the path must be an open line the profile can follow, on a DIFFERENT plane from the profile. Pick a face, then New Sketch, to draw it.'],
    [emit.subtractivePipe('Body', 'S', 'P', 'X'), 'sp', 'subtractive pipe failed — the path must be an open line on a DIFFERENT plane from the profile, and there must be material to cut. Pick a face, then New Sketch, to draw the path.'],
    [emit.additiveHelix('Body', 'S', 'H', 30, 5), 'ah', 'helix failed — the profile must be a closed loop'],
    [emit.subtractiveHelix('Body', 'S', 'H', 30, 5), 'sh', 'subtractive helix failed — the profile must be a closed loop'],
  ];
  for (const [py, v, msg] of cases) {
    assert.ok(py.includes(`if ('Invalid' in ${v}.State) or ${v}.Shape.isNull():`), py);
    assert.ok(py.includes(`doc.removeObject(${v}.Name)`), py);
    assert.ok(py.includes(`raise ValueError('${msg}')`), py);
  }
});

// The two guards added after the P1c-3 kernel gate found sweeps that SUCCEED
// and do nothing, and a helix that grinds instead of refusing. Both are string
// tests here and behaviour tests in engine/bridge/p1c3-test.mjs; this side is
// what fails fast if someone deletes a guard while refactoring.
test('the two-sketch sweeps carry the volume-change guard', () => {
  const cases = [
    [emit.additiveLoft('Body', 'S', 'T', 'L'), 'lo', 'loft added nothing'],
    [emit.subtractiveLoft('Body', 'S', 'T', 'L'), 'ls', 'subtractive loft removed nothing'],
    [emit.additivePipe('Body', 'S', 'P', 'X'), 'ap', 'pipe added nothing'],
    [emit.subtractivePipe('Body', 'S', 'P', 'X'), 'sp', 'subtractive pipe removed nothing'],
  ];
  for (const [py, v, msg] of cases) {
    assert.ok(py.includes('_v0 = _body.Shape.Volume'), py);
    assert.ok(py.includes('_v1 = _body.Shape.Volume'), py);
    assert.ok(py.includes('if abs(_v1 - _v0) < 1e-6:'), py);
    assert.ok(py.includes(`doc.removeObject(${v}.Name)`), py);
    assert.ok(py.includes(msg), py);
    assert.ok(py.includes('same plane'), py);
  }
});

test('both helixes refuse a pitch smaller than the profile BEFORE building', () => {
  for (const py of [emit.additiveHelix('Body', 'S', 'H', 30, 5), emit.subtractiveHelix('Body', 'S', 'H', 30, 5)]) {
    assert.ok(py.includes('_dia = max(_hp.XLength, _hp.YLength)'), py);
    assert.ok(py.includes('_pitch = (30) / (5)'), py);
    assert.ok(py.includes('if _pitch < _dia:'), py);
    assert.ok(py.includes('the turns would overlap and the sweep can hang'), py);
    // the guard must run BEFORE newObject, or the grind has already started
    assert.ok(py.indexOf('_pitch') < py.indexOf('newObject'), 'pitch guard must precede newObject');
  }
});

test('non-finite numbers throw instead of interpolating', () => {
  assert.throws(() => emit.additiveHelix('Body', 'S', 'H', NaN, 3));
  assert.throws(() => emit.subtractiveHelix('Body', 'S', 'H', 30, 'x'));
  assert.throws(() => emit.groove('Body', 'S', 'G', Infinity));
});