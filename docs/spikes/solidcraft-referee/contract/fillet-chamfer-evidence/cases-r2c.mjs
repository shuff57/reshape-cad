// Whole-box roundStyle chamfer (ModelDoc only): the corner-convention error vs size, and the size at which SolidCraft stops building.
export const CASES = [];
for (const d of [1, 2, 5, 8, 11, 13]) CASES.push({ id: `ov2-d-box-chamfer-${d}`, row: 'oversizeWhole', doc: [{ id: 'b1', kind: 'box', size: [40, 30, 20], center: [0, 0, 0], round: d, roundStyle: 'chamfer' }] });
for (const d of [2, 5]) CASES.push({ id: `ov2-d-cube-chamfer-${d}`, row: 'oversizeWhole', doc: [{ id: 'b1', kind: 'box', size: [20, 20, 20], center: [0, 0, 0], round: d, roundStyle: 'chamfer' }] });
