// E28 (round 5): wedge orientation and prism vertex phase, measured on SolidCraft and compared (e28-closed-form.mjs) with a KERNEL-FREE closed form.
// Stated definition (reshape-script.ts wedge(), model-types.ts PrismFeature): wedge = right triangle (0,0),(w,0),(0,d) extruded along +z by h, then the BOUNDING BOX is centred
// on the origin; prism = regular n-gon, circumradius R, first vertex at angle 0 (on +x), centred on the origin, extruded along z, centred in z.
const W = (id, width, depth, height, center = [0, 0, 0], rotate) => ({ id, doc: { version: 1, features: [{ id: 'wedge1', kind: 'wedge', width, depth, height, center, ...(rotate ? { rotate } : {}) }] }, occt: true, row: 'wedge.orient' });
const P = (id, sides, radius, height, center = [0, 0, 0], rotate) => ({ id, doc: { version: 1, features: [{ id: 'prism1', kind: 'prism', sides, radius, height, center, ...(rotate ? { rotate } : {}) }] }, occt: true, row: 'prism.phase' });
const out = [];
for (const [w, d, h] of [[40, 30, 12], [10, 20, 30], [7, 3, 5], [30, 30, 20], [3, 11, 2]]) out.push(W(`e28-wedge-${w}x${d}x${h}`, w, d, h));
out.push(W('e28-wedge-at', 40, 30, 12, [5, -3, 7]));
out.push(W('e28-wedge-rz90', 40, 30, 12, [0, 0, 0], [0, 0, 90]));
out.push(W('e28-wedge-rz180', 40, 30, 12, [0, 0, 0], [0, 0, 180]));
out.push(W('e28-wedge-rx90', 40, 30, 12, [0, 0, 0], [90, 0, 0]));
out.push(W('e28-wedge-ry90', 40, 30, 12, [0, 0, 0], [0, 90, 0]));
out.push(W('e28-wedge-rz90-at', 40, 30, 12, [5, -3, 7], [0, 0, 90]));
for (let n = 3; n <= 12; n++) out.push(P(`e28-prism-${n}`, n, 15, 12));
out.push(P('e28-prism-5-at', 5, 15, 12, [5, -3, 7]));
out.push(P('e28-prism-7-rz90', 7, 15, 12, [0, 0, 0], [0, 0, 90]));
out.push(P('e28-prism-3-rx90', 3, 15, 12, [0, 0, 0], [90, 0, 0]));
export default out;
