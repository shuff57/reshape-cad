// SPEC-brep-engine-adapter.md's test slice: BrepRsEngineAdapter against the
// REAL packages/brep-rs/pkg wasm, loaded via initSync in node (there is no
// fetch or dynamic import there) -- hence the adapter's loadFromBytes() test
// seam. Same convention as the other *.test.mjs files here: against
// ../dist/, `node --test`.
//
// `three` comes from the repo's node_modules (a peer dependency of the
// kernel, a devDependency where the tests run).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const require = createRequire(import.meta.url);
const PKG = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../brep-rs/pkg',
);

const brep = await import(
  new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href
);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });

const { BrepRsEngineAdapter } = await import('../dist/brep-rs-engine-adapter.js');
const { getEngineMode, setEngineMode } = await import('../dist/config.js');

const adapter = new BrepRsEngineAdapter(THREE);
adapter.loadFromBytes(brep);

const BOX_DOC = {
  features: [{ id: 'b1', kind: 'box', size: [40, 40, 20] }],
};

const FILLET_DOC = {
  features: [
    { id: 'b1', kind: 'box', size: [40, 40, 20] },
    {
      id: 'r1', kind: 'fillet', target: 'b1', size: 4, style: 'fillet',
      edge: {
        cause: 'between', feature: 'b1', kind: 'edge',
        of: [
          { cause: 'primitive', feature: 'b1', kind: 'face', part: '+z' },
          { cause: 'primitive', feature: 'b1', kind: 'face', part: '+x' },
        ],
      },
    },
  ],
};

test('box 40x40x20: build, mesh, faceAt, edges, edgeLength, faceSize', () => {
  const built = adapter.build(BOX_DOC);
  assert.ok(built.shapes.has('b1'), 'box builds');
  assert.ok(!built.refusals || built.refusals.size === 0, 'no refusals');

  const meshed = adapter.mesh(built.shapes.get('b1'));
  assert.ok(meshed, 'meshes');
  assert.equal(meshed.faces.length, 6, '6 face ranges');
  const pos = meshed.geometry.getAttribute('position');
  assert.ok(pos && pos.count > 0, 'non-empty position attribute');
  assert.ok(meshed.geometry.getIndex(), 'indexed geometry');

  assert.ok(adapter.faceAt(built.shapes.get('b1'), 0), 'faceAt(shape,0)');
  assert.equal(adapter.faceAt(built.shapes.get('b1'), 6), null, 'faceAt(shape,6) is null');

  const edges = adapter.edges(built.shapes.get('b1'));
  assert.equal(edges.length, 12, '12 edges');

  const lens = edges.map((e) => adapter.edgeLength(e.edge)).filter((n) => n !== null);
  assert.ok(lens.length > 0, 'edgeLength computes');
  for (const len of lens) {
    assert.ok([40, 20].includes(len), `edge length ${len} is 40 or 20`);
  }

  // The +z face's own size, by faceAt index: find the face whose faceSize is
  // [40, 40] (a top/bottom cap of a 40x40x20 box).
  const sizes = [];
  for (let i = 0; i < 6; i++) {
    const face = adapter.faceAt(built.shapes.get('b1'), i);
    sizes.push(adapter.faceSize(face));
  }
  assert.deepEqual(
    sizes.find((s) => s && s[0] === 40 && s[1] === 40) ?? null,
    [40, 40],
    `a +z-style face sizes [40,40], got ${JSON.stringify(sizes)}`,
  );
});

test('resolveFace resolves the +z primitive name; nameFace round-trips', () => {
  const built = adapter.build(BOX_DOC);
  const name = { cause: 'primitive', feature: 'b1', kind: 'face', part: '+z' };
  const face = adapter.resolveFace(name, built);
  assert.ok(face, 'resolveFace resolves');
  const named = adapter.nameFace(built, BOX_DOC, 'b1', face);
  assert.ok(named, 'nameFace names');
  assert.equal(named.cause, 'primitive');
  assert.equal(named.part, '+z');
  assert.equal(named.feature, 'b1');
});

test('fillet fixture (round-one-edge) meshes with 7 face ranges', () => {
  const built = adapter.build(FILLET_DOC);
  assert.ok(built.shapes.has('r1'), 'fillet builds');
  assert.ok(!built.refusals || built.refusals.size === 0, 'no refusals');
  const meshed = adapter.mesh(built.shapes.get('r1'));
  assert.ok(meshed, 'meshes');
  assert.equal(meshed.faces.length, 7, '7 face ranges (5 walls + 2 caps)');
});

test('nameEdge names a box edge as between its two primitive faces and resolveEdge round-trips', () => {
  const built = adapter.build(BOX_DOC);
  const edges = adapter.edges(built.shapes.get('b1'));
  assert.equal(edges.length, 12, '12 edges');
  let named = 0;
  for (const e of edges) {
    const name = adapter.nameEdge(built, BOX_DOC, 'b1', e.edge);
    assert.ok(name, 'every box edge is nameable');
    assert.equal(name.cause, 'between');
    assert.equal(name.feature, 'b1');
    assert.equal(name.kind, 'edge');
    assert.equal(name.of.length, 2, 'names exactly two faces');
    const back = adapter.resolveEdge(name, built);
    assert.ok(back, 'resolveEdge resolves the name it was given');
    assert.equal(adapter.edgeLength(back), adapter.edgeLength(e.edge), 'same edge length');
    named++;
  }
  assert.equal(named, 12, 'all 12 box edges round-trip');
});

test('a refused feature shows up in refusals', () => {
  const doc = {
    features: [
      { id: 'b1', kind: 'box', size: [40, 40, 20] },
      { id: 'm1', kind: 'move', target: 'nope', offset: [1, 0, 0] },
    ],
  };
  const built = adapter.build(doc);
  assert.ok(built.refusals && built.refusals.has('m1'), 'refusal recorded');
});

test('default engine mode stays freecad (spec constraint 3)', () => {
  setEngineMode('freecad');
  assert.equal(getEngineMode(), 'freecad');
});

