// Unit tests for the reSHape Script -> FreeCAD Python transpiler (v1).
// Pure string assertions -- FreeCAD is not runnable here, so we assert on
// the emitted commands and Python's structure, resilient to insignificant
// whitespace.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transpile } from '../src/transpile.mjs';
import { emit } from '../../engine/src/fc-commands.mjs';

// Collapse runs of whitespace so assertions survive line-wrap differences
// that carry no meaning.
function squish(s) {
  return s.replace(/\s+/g, ' ').trim();
}

test('box(40,40,20); hole(6) emits the exact proven command sequence', () => {
  const { commands, python } = transpile('box(40, 40, 20); hole(6)');

  assert.deepEqual(commands, [
    { op: 'newBody', args: ['Body'] },
    { op: 'sketchRect', args: ['Body', 'Sketch', 40, 40] },
    { op: 'pad', args: ['Body', 'Sketch', 'Pad', 20] },
    { op: 'sketchCircle', args: ['Body', 'Sketch001', 3, 20, 20] },
    { op: 'holeThrough', args: ['Body', 'Sketch001', 'Hole'] },
  ]);

  assert.ok(python.includes('PartDesign::Pad'), python);
  assert.ok(python.includes('ThroughAll'), python);
  assert.ok(!python.includes('Part::Cut'), python);
  assert.ok(!python.includes('Part::Box'), python);
});

test('cylinder(10, 30) alone emits newBody + sketchCircle + pad, no Cut', () => {
  const { commands, python } = transpile('cylinder(10, 30)');

  assert.deepEqual(commands, [
    { op: 'newBody', args: ['Body'] },
    { op: 'sketchCircle', args: ['Body', 'Sketch', 10, 0, 0] },
    { op: 'pad', args: ['Body', 'Sketch', 'Pad', 30] },
  ]);

  assert.ok(python.includes('pad.Length = 30'), python);
  assert.ok(!python.includes('Part::Cut'), python);
});

test('whitespace, newlines, semicolons and comments all parse the same', () => {
  const multiline = transpile('box(10, 10, 10)\n// a comment\nhole(4)');
  const oneline = transpile('box(10, 10, 10); hole(4)');

  assert.deepEqual(multiline.commands, oneline.commands);
  assert.equal(multiline.python, oneline.python);
});

test('two holes chain on one body with Sketch001/Hole001 naming', () => {
  const { commands, python } = transpile('box(10, 10, 10); hole(2); hole(3)');

  assert.deepEqual(commands, [
    { op: 'newBody', args: ['Body'] },
    { op: 'sketchRect', args: ['Body', 'Sketch', 10, 10] },
    { op: 'pad', args: ['Body', 'Sketch', 'Pad', 10] },
    { op: 'sketchCircle', args: ['Body', 'Sketch001', 1, 5, 5] },
    { op: 'holeThrough', args: ['Body', 'Sketch001', 'Hole'] },
    { op: 'sketchCircle', args: ['Body', 'Sketch002', 1.5, 5, 5] },
    { op: 'holeThrough', args: ['Body', 'Sketch002', 'Hole001'] },
  ]);

  // both holeThrough ops act on the same Body
  const holes = commands.filter((c) => c.op === 'holeThrough');
  assert.equal(holes.length, 2);
  assert.ok(holes.every((h) => h.args[0] === 'Body'));
  assert.ok(python.includes('ThroughAll'), python);
});

test('hole before any solid is an error mentioning there is no solid to cut', () => {
  assert.throws(
    () => transpile('hole(6)'),
    (err) => err instanceof Error && /no (box or cylinder|solid)/i.test(err.message),
  );
});

test('unknown statement lists the supported words', () => {
  assert.throws(
    () => transpile('spin(45)'),
    (err) => err instanceof Error
      && /v1 supports/.test(err.message)
      && ['box', 'cuboid', 'cylinder', 'hole', 'holeThrough'].every((w) => err.message.includes(w)),
  );
});

test('official names work: cuboid and holeThrough lower identically to box and hole', () => {
  const official = transpile('cuboid(40, 40, 20); holeThrough(6)');
  const student = transpile('box(40, 40, 20); hole(6)');
  assert.deepEqual(official.commands, student.commands);
  assert.equal(official.python, student.python);
});

test('official and student words mix freely in one script', () => {
  const mixed = transpile('cuboid(10, 10, 10); hole(2)');
  const student = transpile('box(10, 10, 10); hole(2)');
  assert.deepEqual(mixed.commands, student.commands);
  assert.equal(mixed.python, student.python);
});

test('non-number argument throws "is not a number"', () => {
  assert.throws(
    () => transpile('box(10, ten, 10)'),
    (err) => err instanceof Error && /is not a number/.test(err.message),
  );
});

test('empty script returns empty commands and empty python', () => {
  const { commands, python } = transpile('');
  assert.deepEqual(commands, []);
  assert.equal(python, '');
});

test('python is exactly the concatenation of the emitted command snippets', () => {
  for (const src of ['box(40, 40, 20); hole(6)', 'cylinder(10, 30)', 'torus(40, 8)']) {
    const { commands, python } = transpile(src);
    const expected = commands.map((c) => emit[c.op](...c.args)).join('\n');
    assert.equal(python, expected);
  }
});

test('sphere(8) emits newBody + PartDesign sphere feature', () => {
  const { commands, python } = transpile('sphere(8)');
  assert.deepEqual(commands, [
    { op: 'newBody', args: ['Body'] },
    { op: 'sphere', args: ['Body', 'Sphere', 8] },
  ]);
  assert.ok(python.includes('PartDesign::Sphere'), python);
});

test('cone(4, 30) emits newBody + cone feature with top radius 0', () => {
  const { commands, python } = transpile('cone(4, 30)');
  assert.deepEqual(commands, [
    { op: 'newBody', args: ['Body'] },
    { op: 'cone', args: ['Body', 'Cone', 4, 0, 30] },
  ]);
  assert.ok(python.includes('PartDesign::Cone'), python);
});

test('torus(40, 8) emits ring radius 16, tube radius 4 (diameters in, radii out)', () => {
  const { commands } = transpile('torus(40, 8)');
  assert.deepEqual(commands, [
    { op: 'newBody', args: ['Body'] },
    { op: 'torus', args: ['Body', 'Torus', 16, 4] },
  ]);
});

test('ring is a student alias of torus with identical lowering', () => {
  const alias = transpile('ring(40, 8)');
  const official = transpile('torus(40, 8)');
  assert.deepEqual(alias.commands, official.commands);
  assert.equal(alias.python, official.python);
});

test('prism(10, 20) emits newBody + hexagonal prism feature', () => {
  const { commands, python } = transpile('prism(10, 20)');
  assert.deepEqual(commands, [
    { op: 'newBody', args: ['Body'] },
    { op: 'prism', args: ['Body', 'Prism', 10, 20] },
  ]);
  assert.ok(python.includes('PartDesign::Prism'), python);
});

test('wedge(30, 40) emits newBody + wedge feature', () => {
  const { commands, python } = transpile('wedge(30, 40)');
  assert.deepEqual(commands, [
    { op: 'newBody', args: ['Body'] },
    { op: 'wedge', args: ['Body', 'Wedge', 30, 40] },
  ]);
  assert.ok(python.includes('PartDesign::Wedge'), python);
});

test('extrude(w, h, d) is a rect sketch + pad — the statement form of cuboid', () => {
  const { commands, python } = transpile('extrude(20, 10, 8)');
  assert.deepEqual(commands, [
    { op: 'newBody', args: ['Body'] },
    { op: 'sketchRect', args: ['Body', 'Sketch', 20, 10] },
    { op: 'pad', args: ['Body', 'Sketch', 'Pad', 8] },
  ]);
  assert.ok(python.includes('PartDesign::Pad'), python);
});

test('pocket(w, h, d) cuts a rect profile from the current solid', () => {
  const { commands } = transpile('cuboid(40, 40, 20); pocket(10, 8, 5)');
  const ops = commands.map((c) => c.op);
  assert.deepEqual(ops, ['newBody', 'sketchRect', 'pad', 'sketchRect', 'pocket']);
  const pocketCmd = commands[4];
  assert.deepEqual(pocketCmd.args.slice(0, 3), ['Body', 'Sketch001', 'Pocket']);
  assert.equal(pocketCmd.args[3], 5);
});

test('pocket before any solid is an error', () => {
  assert.throws(
    () => transpile('pocket(10, 8, 5)'),
    (err) => err instanceof Error && /pocket needs a solid/i.test(err.message),
  );
});

test('groove(w, h, angle) spins a rect profile around V_Axis on the current solid', () => {
  const { commands } = transpile('cylinder(10, 30); groove(4, 6, 180)');
  const ops = commands.map((c) => c.op);
  assert.deepEqual(ops, ['newBody', 'sketchCircle', 'pad', 'sketchRect', 'groove']);
  const grooveCmd = commands[4];
  assert.deepEqual(grooveCmd.args.slice(0, 3), ['Body', 'Sketch001', 'Groove']);
  assert.equal(grooveCmd.args[3], 180);
});

test('groove with one arg is a square profile at the full ring', () => {
  const { commands } = transpile('cylinder(10, 30); groove(4)');
  const grooveCmd = commands.find((c) => c.op === 'groove');
  assert.equal(grooveCmd.args[3], 360);
  const sketchCmd = commands.filter((c) => c.op === 'sketchRect')[0];
  assert.deepEqual(sketchCmd.args.slice(2), [4, 4]);
});

test('groove before any solid is an error', () => {
  assert.throws(
    () => transpile('groove(4)'),
    (err) => err instanceof Error && /groove needs a solid/i.test(err.message),
  );
});
