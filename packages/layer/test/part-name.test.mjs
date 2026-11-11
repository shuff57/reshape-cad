// What a sentence calls the part (pilot 2026-11 F9, owner decision 2026-11-11): the step that made it, not the last step that changed it.
import test from 'node:test';
import assert from 'node:assert/strict';
const { partNameOf, partName, setPartName } = await import(new URL('../dist/part-name.js', import.meta.url).href);

const byId = (fs) => Object.fromEntries(fs.map((f) => [f.id, f]));
test('walks back through holes, rounds, hollows, drafts, moves and turns to the step that made the part', () => {
  const d = byId([{ id: 'box1', kind: 'box' }, { id: 'round1', kind: 'fillet', target: 'box1' }, { id: 'hole1', kind: 'hole', target: 'round1' }, { id: 'draft1', kind: 'draft', target: 'hole1' },
    { id: 'move1', kind: 'move', target: 'draft1' }, { id: 'turn1', kind: 'rotate', target: 'move1' }, { id: 'shell1', kind: 'shell', target: 'turn1' }]);
  for (const id of ['box1', 'round1', 'hole1', 'draft1', 'move1', 'turn1', 'shell1']) assert.equal(partNameOf(id, d), 'box1', id);
});
test('a pocket or groove belongs to the part it cuts into; a join, a copy, a pattern and a pulled sketch are parts of their own', () => {
  const d = byId([{ id: 'sk1', kind: 'sketch' }, { id: 'pull1', kind: 'extrude', target: 'sk1' }, { id: 'sk2', kind: 'sketch' }, { id: 'cut1', kind: 'pocket', target: 'sk2', into: 'pull1' },
    { id: 'hole1', kind: 'hole', target: 'cut1' }, { id: 'cyl1', kind: 'cylinder' }, { id: 'op1', kind: 'combine', targets: ['hole1', 'cyl1'] }, { id: 'hole2', kind: 'hole', target: 'op1' },
    { id: 'copy1', kind: 'move', target: 'hole2', copy: true }, { id: 'hole3', kind: 'hole', target: 'copy1' }, { id: 'pat1', kind: 'pattern', target: 'hole2' }, { id: 'round1', kind: 'fillet', target: 'pat1' }]);
  assert.equal(partNameOf('hole1', d), 'pull1');
  assert.equal(partNameOf('hole2', d), 'op1');
  assert.equal(partNameOf('hole3', d), 'copy1');
  assert.equal(partNameOf('round1', d), 'pat1');
});
test('a history that cannot be followed keeps the id it was given', () => {
  assert.equal(partNameOf('hole1', byId([{ id: 'hole1', kind: 'hole', target: 'gone' }])), 'hole1');
  assert.equal(partNameOf(undefined, {}), undefined);
  const loop = byId([{ id: 'a', kind: 'hole', target: 'b' }, { id: 'b', kind: 'hole', target: 'a' }]);
  assert.equal(partNameOf('a', loop), 'a');
});
test('partName: what was recorded for the feature, else its target', () => {
  const f = { id: 'shell1', target: 'hole1' };
  assert.equal(partName(f), 'hole1');
  setPartName(f, 'box1'); assert.equal(partName(f), 'box1');
  setPartName(f, undefined); assert.equal(partName(f), 'box1');
});
