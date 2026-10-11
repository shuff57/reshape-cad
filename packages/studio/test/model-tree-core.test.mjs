// model-tree-core.ts: the pure model tree. Imports from ../dist; build first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildModelTree, visibleRows, ancestorKeys, tipId, withoutSuppressed, skippedBy,
  treeLabels, isShown, DEFAULT_EXPANDED, highlightedShapeIds, featureProperties, humanizeIds,
} from '../dist/model/model-tree-core.js';

const sketch = (id) => ({ id, kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [10, 0], [10, 10], [0, 10]] });
const doc = {
  version: 1,
  features: [
    sketch('sk1'),
    { id: 'pull1', kind: 'extrude', target: 'sk1', height: 5 },
    { id: 'bevel1', kind: 'fillet', target: 'pull1', style: 'chamfer', size: 1,
      edge: { cause: 'between', feature: 'pull1', kind: 'edge', of: [
        { cause: 'primitive', feature: 'pull1', kind: 'face', part: '+z' },
        { cause: 'primitive', feature: 'pull1', kind: 'face', part: '+x' },
      ] } },
  ],
};

const find = (n, key) => {
  if (n.key === key) return n;
  for (const c of n.children) { const r = find(c, key); if (r) return r; }
  return null;
};

test('labels are the plain command names, numbered from 001', () => {
  const d = { version: 1, features: [sketch('a'), sketch('b'), { id: 'p', kind: 'extrude', target: 'a', height: 1 }] };
  assert.deepEqual(treeLabels(d), { a: 'Sketch', b: 'Sketch001', p: 'Pad' });
  assert.equal(treeLabels(doc).bevel1, 'Chamfer');
});

test('document > body > origin + features, the profile sketch nested under its pad', () => {
  const t = buildModelTree(doc);
  assert.equal(t.kind, 'document');
  const body = t.children[0];
  assert.equal(body.kind, 'body');
  assert.deepEqual(body.children.map((c) => c.label), ['Origin', 'Pad', 'Chamfer']);
  assert.equal(body.children[0].children.length, 7);
  assert.deepEqual(find(t, 'f:pull1').children.map((c) => c.label), ['Sketch']);
});

test('the tip is the last solid feature inside the rollback boundary', () => {
  assert.equal(tipId(doc, null), 'bevel1');
  assert.equal(tipId(doc, 2), 'pull1');
  assert.equal(tipId(doc, 1), null);
  const t = buildModelTree(doc, { rollbackIndex: 2 });
  assert.equal(find(t, 'f:pull1').tip, true);
  assert.equal(find(t, 'f:bevel1').afterTip, true);
  assert.equal(find(t, 'f:bevel1').tip, undefined);
});

test('a refusal marks the row invalid, but not a row that is not built anyway', () => {
  const refusals = new Map([['bevel1', 'not a shape brep-rs can round yet']]);
  assert.equal(find(buildModelTree(doc, { refusals }), 'f:bevel1').invalid, 'not a shape brep-rs can round yet');
  assert.equal(find(buildModelTree(doc, { refusals, rollbackIndex: 2 }), 'f:bevel1').invalid, undefined);
});

test('suppressing a feature skips what is built from it, and hands the kernel a smaller doc', () => {
  const sup = new Set(['pull1']);
  assert.deepEqual([...skippedBy(doc, sup).keys()], ['bevel1']);
  const d2 = withoutSuppressed(doc, sup);
  assert.deepEqual(d2.features.map((f) => f.id), ['sk1']);
  assert.equal(withoutSuppressed(doc, new Set()), doc);
  const t = buildModelTree(doc, { suppressed: sup });
  assert.equal(find(t, 'f:pull1').suppressed, true);
  assert.match(find(t, 'f:bevel1').skipped, /Pad/);
  assert.equal(tipId(doc, null, new Set(['bevel1'])), 'pull1');
});

test('collapsed branches hide their rows; ancestorKeys names the branch to open', () => {
  const t = buildModelTree(doc);
  const closed = visibleRows(t, new Set(DEFAULT_EXPANDED)).map((r) => r.node.label);
  assert.deepEqual(closed, ['Unnamed', 'Body', 'Origin', 'Pad', 'Chamfer']);
  const open = visibleRows(t, new Set([...DEFAULT_EXPANDED, 'f:pull1'])).map((r) => r.node.label);
  assert.ok(open.includes('Sketch'));
  assert.deepEqual(ancestorKeys(t, 'sk1'), ['f:pull1', 'body', 'document']);
});

test('eye defaults: consumed solids and sketches hidden, overrides win', () => {
  const top = new Set(['bevel1']);
  assert.equal(isShown(doc, 'bevel1', new Map(), top), true);
  assert.equal(isShown(doc, 'pull1', new Map(), top), false);
  assert.equal(isShown(doc, 'sk1', new Map(), top), false);
  assert.equal(isShown(doc, 'pull1', new Map([['pull1', true]]), top), true);
  assert.equal(isShown(doc, 'bevel1', new Map([['bevel1', false]]), top), false);
});

test('selecting a consumed step lights the drawn solid built from it', () => {
  // only bevel1 is drawn: selecting the Pad or the Chamfer tints it.
  assert.deepEqual([...highlightedShapeIds(doc, ['pull1'], ['bevel1'])], ['bevel1']);
  assert.deepEqual([...highlightedShapeIds(doc, ['bevel1'], ['bevel1'])], ['bevel1']);
  assert.deepEqual([...highlightedShapeIds(doc, ['sk1'], ['bevel1'])], ['bevel1']);
  assert.equal(highlightedShapeIds(doc, [], ['bevel1']).size, 0);
  // a drawn Pad that nothing later consumed is itself, not the chamfer.
  assert.deepEqual([...highlightedShapeIds(doc, ['pull1'], ['pull1'])], ['pull1']);
});

test('property pane: grouped named properties, labels not ids or kinds', () => {
  const pad = featureProperties(doc, 'pull1');
  assert.deepEqual(pad.map((g) => g.name), ['Base', 'Pad']);
  const rows = Object.fromEntries(pad[1].rows);
  assert.equal(rows.Length, '5 mm');
  assert.equal(rows['Side Type'], 'One side');
  assert.equal(rows.Profile, 'Sketch');
  const ch = featureProperties(doc, 'bevel1');
  assert.deepEqual(ch.map((g) => g.name), ['Base', 'Chamfer']);
  assert.deepEqual(Object.fromEntries(ch[0].rows).Base, 'Pad');
  assert.equal(Object.fromEntries(ch[1].rows).Size, '1 mm');
  for (const g of [...pad, ...ch]) for (const [k, v] of g.rows) {
    assert.ok(!/^(pull1|sk1|bevel1|extrude|fillet|target)$/.test(k) && !/^(pull1|sk1|bevel1)$/.test(v));
  }
});

test('humanizeIds swaps document ids for tree names, quoted or bare, and leaves words alone', () => {
  const labels = treeLabels(doc);
  assert.equal(humanizeIds("bevel1 could not be built", labels), 'Chamfer could not be built');
  assert.equal(humanizeIds("the edge of 'pull1' is too short", labels), 'the edge of Pad is too short');
  assert.equal(humanizeIds('a sketch of pull10 stays', labels), 'a sketch of pull10 stays');
});

test('the Data tab carries a Suppressed row that follows the suppressed set', () => {
  const rows = (s) => featureProperties(doc, 'pull1', treeLabels(doc), s)[0].rows;
  assert.deepEqual(rows(new Set()).find((r) => r[0] === 'Suppressed'), ['Suppressed', 'false']);
  assert.deepEqual(rows(new Set(['pull1'])).find((r) => r[0] === 'Suppressed'), ['Suppressed', 'true']);
});
