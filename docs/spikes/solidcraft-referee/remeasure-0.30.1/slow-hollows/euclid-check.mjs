import { euclid } from '/home/shuff57/.t3-desktop/worktrees/reshape-cad/t3-429b33d9-8105959c9b19ef51/docs/spikes/solidcraft-referee/fuzz/oracle.mjs';
const box = (W, D, H) => [[-W / 2, W / 2, -D / 2, D / 2, 0, H]];
const top = (W, D, H) => [{ axis: 'z', dir: 1, coord: H, rect: [-W / 2, W / 2, -D / 2, D / 2], minus: [] }];
const cone = (c, r, R, ang, H) => { const dep = (R - r) / Math.tan(ang / 2 * Math.PI / 180); return { type: 'cone', c, rb: r, zb: H - dep, rt: R, zt: H, r, range: [-1, H + 1] }; };
const cyl = (c, r, z0, z1) => ({ type: 'cyl', axis: 'z', c, r, range: [z0, z1] });
const M = { 'v-00872-wall2': { t: 2, W: 18, D: 18, H: 12, holes: [cone([0, 0], 1.5, 6, 90, 12)] }, 'v-01024-one': { t: 1.5, W: 22, D: 14, H: 6, holes: [cone([-4, -1], 1, 4, 90, 6)] }, 'v-01396-centre': { t: 1, W: 12, D: 10, H: 6, holes: [cyl([0, 0], 1, -1, 7), cyl([0, 0], 4, 4, 7)] }, 'v-cbore-plate': { t: 2, W: 40, D: 30, H: 10, holes: [cyl([0, 0], 2, -1, 11), cyl([0, 0], 4, 7, 11)] } };
for (const [id, m] of Object.entries(M)) { const e = euclid({ t: m.t, mode: 'rect', boxes: box(m.W, m.D, m.H), cuts: [], opens: top(m.W, m.D, m.H), holes: m.holes, rbosses: [] }, { h: 0.05 }); console.log(id, 'euclid P', e.P.toFixed(3)); }
