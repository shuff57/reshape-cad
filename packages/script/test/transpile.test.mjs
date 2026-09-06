// Unit tests for the reSHape Script -> FreeCAD Python transpiler (v0).
// Pure string assertions -- FreeCAD is not runnable here, so we assert on
// the emitted Python's structure, resilient to insignificant whitespace.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transpile } from '../src/transpile.mjs';

// Collapse runs of whitespace so assertions survive line-wrap differences
// that carry no meaning.
function squish(s) {
  return s.replace(/\s+/g, ' ').trim();
}

test('box(40,40,20); hole(6) emits the exact proven idiom', () => {
  const py = transpile('box(40, 40, 20); hole(6)');
  const flat = squish(py);

  assert.match(flat, /import FreeCAD as App/);
  assert.match(flat, /import Part/);
  assert.match(flat, /doc = App.newDocument\("reSHape"\)/);
  assert.match(flat, /Box = doc\.addObject\("Part::Box", "Box"\)/);
  assert.match(flat, /Box\.Length = 40/);
  assert.match(flat, /Box\.Width = 40/);
  assert.match(flat, /Box\.Height = 20/);

  assert.match(flat, /Cylinder = doc\.addObject\("Part::Cylinder", "Cylinder"\)/);
  assert.match(flat, /Cylinder\.Radius = 3\.0/);
  assert.match(flat, /Cylinder\.Placement = App\.Placement\(App\.Vector\(20\.0, 20\.0, 0\), App\.Rotation\(\)\)/);

  assert.match(flat, /Cut = doc\.addObject\("Part::Cut", "Cut"\)/);
  assert.match(flat, /Cut\.Base = Box/);
  assert.match(flat, /Cut\.Tool = Cylinder/);

  assert.match(py, /doc\.recompute\(\)\s*$/);
});

test('cylinder(10, 30) alone emits one Part::Cylinder, no Cut', () => {
  const py = transpile('cylinder(10, 30)');
  const flat = squish(py);

  assert.match(flat, /Cylinder = doc\.addObject\("Part::Cylinder", "Cylinder"\)/);
  assert.match(flat, /Cylinder\.Radius = 10/);
  assert.match(flat, /Cylinder\.Height = 30/);
  assert.doesNotMatch(flat, /Part::Cut/);
  assert.match(py, /doc\.recompute\(\)\s*$/);
});

test('whitespace, newlines, semicolons and comments all parse the same', () => {
  const multiline = transpile('box(10, 10, 10)\n// a comment\nhole(4)');
  const oneline = transpile('box(10, 10, 10); hole(4)');
  const messy = transpile('  box( 10 ,10,   10 ) ;;\n\n  // another\n\nhole( 4 );;');

  assert.equal(squish(multiline), squish(oneline));
  assert.equal(squish(messy), squish(oneline));
});

test('two holes chain Cut -> Cut001 with the second Cut based on the first', () => {
  const py = transpile('box(10, 10, 10); hole(2); hole(3)');
  const flat = squish(py);

  assert.match(flat, /Cut = doc\.addObject\("Part::Cut", "Cut"\)/);
  assert.match(flat, /Cut\.Base = Box/);
  assert.match(flat, /Cut001 = doc\.addObject\("Part::Cut", "Cut001"\)/);
  assert.match(flat, /Cut001\.Base = Cut/);
});

test('hole before any solid is an error mentioning there is no solid to cut', () => {
  assert.throws(
    () => transpile('hole(6)'),
    (err) => err instanceof Error && /no (box or cylinder|solid)/i.test(err.message),
  );
});

test('empty script still emits a valid document skeleton', () => {
  const py = transpile('');
  assert.match(squish(py), /doc = App\.newDocument\("reSHape"\) doc\.recompute\(\)/);
});

test('hole without x,y on a non-box current solid defaults to 0,0', () => {
  const py = transpile('cylinder(10, 30); hole(4)');
  assert.match(squish(py), /App\.Vector\(0\.0, 0\.0, 0\)/);
});