// A dimension typed in the sketch canvas must reach the doc's own rows.
//
// Regression (8.1.10): Dim tool, click an edge, type 60, Enter changed the
// BUILT solid (60 wide) while a `model` requirement expecting
// {kind:'sketch', width:40} stayed green, because SketchCanvas2D.writeDoc
// stored the rows as drawn plus the new rule and left the solve to the kernel
// at build time. model-types.ts says `geoms` are the SOLVED state; solveRows()
// is what writeDoc now runs, and checkModel reads the soup bbox.
// Real wasm via initSync, same convention as kernel/test/sketch-session.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../brep-rs/pkg');
const brep = await import(new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });

const { SketchSession2D } = await import('@shuff57/reshape-kernel/sketch-session');
const { solveRows } = await import('../dist/model/sketch-canvas-core.js');
const { checkModel } = await import('@shuff57/reshape-script/model-check');

const session = new SketchSession2D();
session.loadFromBytes(brep);

// A 40 x 25 rectangle as the canvas stores it, welded and axis-aligned.
const RECT = [
  { k: 'line', id: 1, a: [0, 0], b: [40, 0] },
  { k: 'line', id: 2, a: [40, 0], b: [40, 25] },
  { k: 'line', id: 3, a: [40, 25], b: [0, 25] },
  { k: 'line', id: 4, a: [0, 25], b: [0, 0] },
];
const WELD = [
  { k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' },
  { k: 'coincident', a: 2, aEnd: 'b', b: 3, bEnd: 'a' },
  { k: 'coincident', a: 3, aEnd: 'b', b: 4, bEnd: 'a' },
  { k: 'coincident', a: 4, aEnd: 'b', b: 1, bEnd: 'a' },
  { k: 'horizontal', a: 1 },
  { k: 'vertical', a: 2 },
  { k: 'horizontal', a: 3 },
  { k: 'vertical', a: 4 },
];
const DIM60 = { k: 'distance', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 60 };

const docOf = (geoms, rules) => ({
  version: 1,
  features: [{ id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, geoms, geom: geoms, rules }],
});
const req = { expect: [{ kind: 'sketch', width: 40, depth: 25 }] };

test('a typed distance 60 over a 40-wide rect is stored solved: checkModel sees 60 wide', () => {
  const rules = [...WELD, DIM60];
  const stored = solveRows(session, RECT, rules);
  const res = checkModel(req, docOf(stored, rules));
  assert.equal(res.passed, false, 'expect width 40 must go red once the rect is 60 wide');
  const w = stored.flatMap((g) => [g.a[0], g.b[0]]);
  assert.ok(Math.abs(Math.max(...w) - Math.min(...w) - 60) < 1e-6, 'rows carry the solved 60');
  assert.equal(checkModel({ expect: [{ kind: 'sketch', width: 60, depth: 25 }] }, docOf(stored, rules)).passed, true);
});

test('unsolved rows alone would have stayed green (the bug)', () => {
  const rules = [...WELD, DIM60];
  assert.equal(checkModel(req, docOf(RECT, rules)).passed, true);
});

test('a rule that is already satisfied returns the rows untouched (no float drift)', () => {
  const stored = solveRows(session, RECT, WELD);
  assert.deepEqual(stored, RECT);
});

test('a refused solve keeps the rows as drawn', () => {
  const bad = [...WELD, { k: 'horizontal', a: 99 }]; // names a row that does not exist
  assert.deepEqual(solveRows(session, RECT, bad), RECT);
});
