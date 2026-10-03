// The slot builder moved from studio's slotRows into packages/sketch
// (buildSlotRows). The studio tool's output must be byte-identical before and
// after: GOLDEN was captured from the pre-move slotRows (studio dist built
// before the move) as JSON text, and slotRows must still reproduce it exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slotRows } from '../dist/model/sketch-canvas-core.js';
import { buildSlotRows } from '@shuff57/reshape-sketch/sketch-slot';

const CASES = [
  [{ x: -20, y: 0 }, { x: 20, y: 0 }, { x: -15, y: 0 }, 1],
  [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 10, y: 0 }, 1],
  [{ x: 3, y: -2 }, { x: 13, y: 17 }, { x: 3, y: 3 }, 5],
  [{ x: 0, y: 0 }, { x: 0, y: 30 }, { x: 7, y: 0 }, 9],
  [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 9, y: 5 }, 1], // coincident centres -> null
  [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, 1], // zero radius -> null
];
const GOLDEN = "[{\"geoms\":[{\"k\":\"arc\",\"id\":1,\"c\":[-20,0],\"r\":5,\"a\":[-20,-5],\"b\":[-20,5],\"sense\":\"cw\"},{\"k\":\"arc\",\"id\":2,\"c\":[20,0],\"r\":5,\"a\":[20,5],\"b\":[20,-5],\"sense\":\"cw\"},{\"k\":\"line\",\"id\":3,\"a\":[-20,5],\"b\":[20,5]},{\"k\":\"line\",\"id\":4,\"a\":[20,-5],\"b\":[-20,-5]}],\"rules\":[{\"k\":\"coincident\",\"a\":3,\"aEnd\":\"a\",\"b\":1,\"bEnd\":\"b\"},{\"k\":\"tangent\",\"a\":3,\"aEnd\":\"a\",\"b\":1,\"bEnd\":\"b\"},{\"k\":\"coincident\",\"a\":3,\"aEnd\":\"b\",\"b\":2,\"bEnd\":\"a\"},{\"k\":\"tangent\",\"a\":3,\"aEnd\":\"b\",\"b\":2,\"bEnd\":\"a\"},{\"k\":\"coincident\",\"a\":4,\"aEnd\":\"a\",\"b\":2,\"bEnd\":\"b\"},{\"k\":\"tangent\",\"a\":4,\"aEnd\":\"a\",\"b\":2,\"bEnd\":\"b\"},{\"k\":\"coincident\",\"a\":4,\"aEnd\":\"b\",\"b\":1,\"bEnd\":\"a\"},{\"k\":\"tangent\",\"a\":4,\"aEnd\":\"b\",\"b\":1,\"bEnd\":\"a\"}],\"ids\":{\"arc1\":1,\"arc2\":2,\"top\":3,\"bottom\":4}},{\"geoms\":[{\"k\":\"arc\",\"id\":1,\"c\":[0,0],\"r\":10,\"a\":[0,-10],\"b\":[0,10],\"sense\":\"cw\"},{\"k\":\"arc\",\"id\":2,\"c\":[40,0],\"r\":10,\"a\":[40,10],\"b\":[40,-10],\"sense\":\"cw\"},{\"k\":\"line\",\"id\":3,\"a\":[0,10],\"b\":[40,10]},{\"k\":\"line\",\"id\":4,\"a\":[40,-10],\"b\":[0,-10]}],\"rules\":[{\"k\":\"coincident\",\"a\":3,\"aEnd\":\"a\",\"b\":1,\"bEnd\":\"b\"},{\"k\":\"tangent\",\"a\":3,\"aEnd\":\"a\",\"b\":1,\"bEnd\":\"b\"},{\"k\":\"coincident\",\"a\":3,\"aEnd\":\"b\",\"b\":2,\"bEnd\":\"a\"},{\"k\":\"tangent\",\"a\":3,\"aEnd\":\"b\",\"b\":2,\"bEnd\":\"a\"},{\"k\":\"coincident\",\"a\":4,\"aEnd\":\"a\",\"b\":2,\"bEnd\":\"b\"},{\"k\":\"tangent\",\"a\":4,\"aEnd\":\"a\",\"b\":2,\"bEnd\":\"b\"},{\"k\":\"coincident\",\"a\":4,\"aEnd\":\"b\",\"b\":1,\"bEnd\":\"a\"},{\"k\":\"tangent\",\"a\":4,\"aEnd\":\"b\",\"b\":1,\"bEnd\":\"a\"}],\"ids\":{\"arc1\":1,\"arc2\":2,\"top\":3,\"bottom\":4}},{\"geoms\":[{\"k\":\"arc\",\"id\":5,\"c\":[3,-2],\"r\":5,\"a\":[7.424591111909912,-4.328732164163112],\"b\":[-1.424591111909912,0.3287321641631116],\"sense\":\"cw\"},{\"k\":\"arc\",\"id\":6,\"c\":[13,17],\"r\":5,\"a\":[8.575408888090088,19.32873216416311],\"b\":[17.424591111909912,14.671267835836888],\"sense\":\"cw\"},{\"k\":\"line\",\"id\":7,\"a\":[-1.424591111909912,0.3287321641631116],\"b\":[8.575408888090088,19.32873216416311]},{\"k\":\"line\",\"id\":8,\"a\":[17.424591111909912,14.671267835836888],\"b\":[7.424591111909912,-4.328732164163112]}],\"rules\":[{\"k\":\"coincident\",\"a\":7,\"aEnd\":\"a\",\"b\":5,\"bEnd\":\"b\"},{\"k\":\"tangent\",\"a\":7,\"aEnd\":\"a\",\"b\":5,\"bEnd\":\"b\"},{\"k\":\"coincident\",\"a\":7,\"aEnd\":\"b\",\"b\":6,\"bEnd\":\"a\"},{\"k\":\"tangent\",\"a\":7,\"aEnd\":\"b\",\"b\":6,\"bEnd\":\"a\"},{\"k\":\"coincident\",\"a\":8,\"aEnd\":\"a\",\"b\":6,\"bEnd\":\"b\"},{\"k\":\"tangent\",\"a\":8,\"aEnd\":\"a\",\"b\":6,\"bEnd\":\"b\"},{\"k\":\"coincident\",\"a\":8,\"aEnd\":\"b\",\"b\":5,\"bEnd\":\"a\"},{\"k\":\"tangent\",\"a\":8,\"aEnd\":\"b\",\"b\":5,\"bEnd\":\"a\"}],\"ids\":{\"arc1\":5,\"arc2\":6,\"top\":7,\"bottom\":8}},{\"geoms\":[{\"k\":\"arc\",\"id\":9,\"c\":[0,0],\"r\":7,\"a\":[7,0],\"b\":[-7,0],\"sense\":\"cw\"},{\"k\":\"arc\",\"id\":10,\"c\":[0,30],\"r\":7,\"a\":[-7,30],\"b\":[7,30],\"sense\":\"cw\"},{\"k\":\"line\",\"id\":11,\"a\":[-7,0],\"b\":[-7,30]},{\"k\":\"line\",\"id\":12,\"a\":[7,30],\"b\":[7,0]}],\"rules\":[{\"k\":\"coincident\",\"a\":11,\"aEnd\":\"a\",\"b\":9,\"bEnd\":\"b\"},{\"k\":\"tangent\",\"a\":11,\"aEnd\":\"a\",\"b\":9,\"bEnd\":\"b\"},{\"k\":\"coincident\",\"a\":11,\"aEnd\":\"b\",\"b\":10,\"bEnd\":\"a\"},{\"k\":\"tangent\",\"a\":11,\"aEnd\":\"b\",\"b\":10,\"bEnd\":\"a\"},{\"k\":\"coincident\",\"a\":12,\"aEnd\":\"a\",\"b\":10,\"bEnd\":\"b\"},{\"k\":\"tangent\",\"a\":12,\"aEnd\":\"a\",\"b\":10,\"bEnd\":\"b\"},{\"k\":\"coincident\",\"a\":12,\"aEnd\":\"b\",\"b\":9,\"bEnd\":\"a\"},{\"k\":\"tangent\",\"a\":12,\"aEnd\":\"b\",\"b\":9,\"bEnd\":\"a\"}],\"ids\":{\"arc1\":9,\"arc2\":10,\"top\":11,\"bottom\":12}},null,null]";

test('studio slotRows output is byte-identical to the pre-move capture', () => {
  assert.equal(JSON.stringify(CASES.map((c) => slotRows(...c))), GOLDEN);
});

test('studio slotRows and the shared buildSlotRows agree', () => {
  for (const [a, b, rp, base] of CASES) {
    const r = Math.hypot(rp.x - a.x, rp.y - a.y);
    const shared = buildSlotRows([a.x, a.y], [b.x, b.y], r, base);
    assert.equal(JSON.stringify(slotRows(a, b, rp, base)), JSON.stringify(shared));
  }
});
