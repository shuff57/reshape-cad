// SPEC-sketcher2.md §6 — the emitter half of the soup round trip (Task 1.5,
// RED). The soup schema itself is the spec's §2 contract, verbatim: geometry
// rows (point/line/circle/arc) and constraint rows (16 kinds), sketch-local
// dense 1-based ids. The emitter does not know `geoms`/`rules` exist yet, so
// every test here is RED by silent loss: toScript() emits a plain polygon
// sketch line and drops the soup entirely (§1.1 — persistence is script text,
// anything the emitter cannot emit is lost on reload).
//
// D6 (the plan's fixpoint decision): "byte-comparable round-trip" means
// emit(parse(emit(x))) === emit(x) — a typed script is always reformatted, so
// comparing against hand-typed text is impossible; the fixpoint is the
// comparable thing.
//
// D8 (the plan's slot decision): only constraint VALUE fields get param slots,
// named `rule${i}-value` (0-based rules index, append-stable). Coordinates
// never get slots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../dist/reshape-script.js';
import { toScript } from '../dist/reshape-script-gen.js';

/** A soup sketch exactly as §2.3/§2.5 spell the rows: a line, a circle, an
 *  arc, and the rules that dimension them. `geoms`/`rules` are the field
 *  names Task 2.5 will add to SketchFeature; the emitter must read them. */
function soupDoc() {
  return {
    version: 1,
    features: [
      {
        id: 'sk1',
        kind: 'sketch',
        plane: 'top',
        offset: 0,
        geoms: [
          { k: 'line', id: 1, a: [0, 0], b: [40, 0] },
          { k: 'circle', id: 2, c: [20, 30], r: 5 },
          {
            k: 'arc', id: 3, c: [10, 10], r: 8,
            a: [18, 10], b: [10, 18], sense: 'ccw',
          },
        ],
        rules: [
          { k: 'horizontal', a: 1 },
          { k: 'radius', a: 2, value: 5 },
          { k: 'tangent', a: 2, aEnd: 'c', b: 3, bEnd: 'a' },
        ],
      },
    ],
  };
}

test('1: toScript emits geom([...]) and rules([...]) rows for a soup sketch', () => {
  const text = toScript(soupDoc());
  // The two words, in the §6.1 shape — array-of-objects, real JS.
  assert.match(text, /\.geom\(\[/, `no geom() row block in:\n${text}`);
  assert.match(text, /\.rules\(\[/, `no rules() row block in:\n${text}`);
  // Row content survives: the line's coordinates, the circle's radius, the
  // arc's sense, and the rules' kinds, spelled the §2 way.
  assert.match(text, /k:\s*'line'/, `line row lost in:\n${text}`);
  assert.match(text, /k:\s*'circle'/, `circle row lost in:\n${text}`);
  assert.match(text, /k:\s*'arc'/, `arc row lost in:\n${text}`);
  assert.match(text, /sense:\s*'ccw'/, `arc sense lost in:\n${text}`);
  assert.match(text, /k:\s*'radius'/, `radius rule lost in:\n${text}`);
  assert.match(text, /k:\s*'horizontal'/, `horizontal rule lost in:\n${text}`);
  assert.match(text, /k:\s*'tangent'/, `tangent rule lost in:\n${text}`);
});

test('2: §6.3 — geom() coordinates are emitted at 1e-9 precision, NOT lit()\'s 1e-6', () => {
  // A coordinate that 1e-6 rounding would corrupt: 1/3 mm at 1e-6 loses the
  // digits past the 6th decimal; at 1e-9 it survives. The basin selector
  // (§6.3) needs those digits — they are what makes reload deterministic.
  const doc = soupDoc();
  doc.features[0].geoms[0].b = [40 + 1 / 3, 0];
  const text = toScript(doc);
  assert.match(text, /40\.333333333/, `geom() coordinate was rounded to 1e-6 (lit()'s precision), got:\n${text}`);
});

test('3: D6 fixpoint — emit(parse(emit(x))) === emit(x), byte-comparable', () => {
  const first = toScript(soupDoc());
  // parse = runScript: the emitted text must run clean AND rebuild the soup
  // rows it was emitted from (the §1.1 load-bearing wall — if parse drops the
  // soup, the second emit cannot carry it either).
  const parsed = runScript(first);
  assert.deepEqual(parsed.errors, [], `emitted soup script should run clean, got: ${JSON.stringify(parsed.errors)}`);
  const rebuilt = parsed.doc.features.find((f) => f.kind === 'sketch');
  assert.ok(rebuilt?.geoms?.length, `parse lost the soup rows; rebuilt sketch:\n${JSON.stringify(rebuilt)}`);
  const second = toScript(parsed.doc, parsed.namedParams);
  assert.equal(second, first, `fixpoint broken:\n--- first ---\n${first}\n--- second ---\n${second}`);
});

test('4: D8 — a radius rule bound to param() emits the param name at its rule${i}-value slot', () => {
  // Build-mode doc: the radius rule's value is a plain 5. namedParams (what
  // runScript() hands back, and what toScript()'s second argument takes)
  // records that the slot `sk1_rule1-value` (0-based rules index 1) was named
  // `holeR` by a param('holeR', 5) call. The emitter must substitute the NAME
  // at that slot — the whole reason §6.2 rejected the opaque blob.
  const doc = soupDoc();
  const namedParams = [
    { name: 'holeR', caption: 'holeR', value: 5, min: 0, max: 100, step: 1, slots: ['sk1_rule1-value'] },
  ];
  const text = toScript(doc, namedParams);
  // The declaration first, then the radius rule carrying the name, not the 5.
  assert.match(text, /const holeR = param\('holeR', 5/, `param() declaration missing from:\n${text}`);
  assert.match(text, /k:\s*'radius'[^]*?value:\s*holeR/, `radius rule must emit param('holeR')'s name at its value slot, got:\n${text}`);
  assert.doesNotMatch(text, /k:\s*'radius'[^]*?value:\s*5\b/, `radius rule still emits the literal 5 instead of the bound name:\n${text}`);
});