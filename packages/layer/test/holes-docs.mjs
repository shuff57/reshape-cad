// Generated ModelDocs for the holes differential test. Plain data, seeded. Categories (seed % 15) cover: through and blind bores, counterbore /
// countersink, holes() patterns (corners, any axis), holes near edges, wider than the part, tangent to the part or to each other, sealed cavities,
// several bodies, holes after shell / fillet / combine / pocket / move / mirror / pattern, curved hosts and cross-bores, long hole sequences, malformed input.
import { box, cyl, sphere, cone, torus, prism, wedge, rect, circ, extrude, pocket, revolve, combine, mirror, pattern, hole, shell, move, rotate, fillet, prim, between } from './docs.mjs';
import { mulberry32 } from './ep-docs.mjs';

export const N_CATEGORIES = 15;

export function holeDoc(seed) {
  const r = mulberry32(seed * 7919 + 13);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const num = (lo, hi) => Math.round((lo + r() * (hi - lo)) * 4) / 4;
  const cat = seed % N_CATEGORIES;
  const feats = [];
  let nh = 0;
  const hid = () => `h${++nh}`;
  const dims = () => [pick([20, 24, 30, 40, 16, 12]), pick([20, 24, 30, 40, 16, 12]), pick([8, 10, 12, 20, 6])];
  const AX = { x: 0, y: 1, z: 2 };
  /** a hole: along `axis`, T = host thickness along it, `mode`: 'through' | 'blind' | 'sealed' */
  const mk = (target, host, o = {}) => {
    const axis = o.axis ?? 'z';
    const T = host[AX[axis]];
    const mode = o.mode ?? pick(['through', 'through', 'blind', 'blind']);
    const diameter = o.diameter ?? pick([2, 4, 6, 8, 3, 5, 1, 0.5]);
    let depth; let along = 0;
    if (mode === 'through') depth = T + pick([0, 0, 2, 5]);
    else if (mode === 'blind') { depth = Math.max(0.25, num(T * 0.2, T * 0.9)); along = (T - depth) / 2; }
    else { depth = Math.max(0.25, num(T * 0.2, T * 0.6)); along = (T - depth) / 2 - pick([1, 2, 0.5]); } // sealed: starts inside the part
    const c = [0, 0, 0];
    const perp = [0, 1, 2].filter((k) => k !== AX[axis]);
    c[perp[0]] = o.u ?? num(-host[perp[0]] / 4, host[perp[0]] / 4);
    c[perp[1]] = o.v ?? num(-host[perp[1]] / 4, host[perp[1]] / 4);
    c[AX[axis]] = o.along ?? along;
    const f = { id: o.id ?? hid(), kind: 'hole', target, diameter, depth: o.depth ?? depth, center: o.center ?? c, axis };
    if (o.corners) f.corners = o.corners;
    if (o.counterbore) f.counterbore = o.counterbore;
    if (o.countersink) f.countersink = o.countersink;
    return f;
  };
  const host = dims();
  const hostBox = (id = 'b1', center = [0, 0, 0], extra = {}) => box(id, host, center, extra);

  switch (cat) {
    case 0: { // through bores on a box, centred and offset, possibly moved or rotated
      feats.push(hostBox('b1', pick([[0, 0, 0], [5, -3, 2]]), r() < 0.2 ? { rotate: [0, 0, 30] } : {}));
      feats.push(mk('b1', host, { mode: 'through' }));
      if (r() < 0.4) feats.push(mk('h1', host, { mode: 'through', diameter: pick([2, 3, 5]) }));
      break;
    }
    case 1: { // blind bores
      feats.push(hostBox());
      const axis = pick(['z', 'z', 'x', 'y']);
      feats.push(mk('b1', host, { mode: 'blind', axis }));
      if (r() < 0.5) feats.push(mk('h1', host, { mode: 'blind', axis }));
      break;
    }
    case 2: { // counterbores: through or blind, sometimes too narrow / too deep / zero depth
      feats.push(hostBox());
      const d = pick([4, 6, 3]);
      const cb = { diameter: pick([d + 4, d + 8, d - 1, d, 0.1, d + 0.004]), depth: pick([2, 1, 100, 0, -1, 0.001, 3]) };
      feats.push(mk('b1', host, { mode: pick(['through', 'blind']), diameter: d, counterbore: cb, u: pick([0, 3, -3]), v: pick([0, 2]) }));
      if (r() < 0.4) feats.push(mk('h1', host, { mode: 'through', diameter: 3, counterbore: { diameter: 7, depth: 2 }, u: pick([-8, 8, 0]), v: 0 }));
      break;
    }
    case 3: { // countersinks
      feats.push(hostBox());
      const d = pick([4, 6, 3, 0.6]);
      const cs = { diameter: pick([d + 4, d + 8, 30, d, d + 0.05]), angleDeg: pick([90, 120, 82, 175, 178, 60]) };
      feats.push(mk('b1', host, { mode: pick(['through', 'blind']), diameter: d, countersink: cs, u: pick([0, 3, -3, 8]), v: pick([0, 2]) }));
      if (r() < 0.4) feats.push(mk('h1', host, { mode: 'through', diameter: 3, countersink: { diameter: 7, angleDeg: 90 }, u: pick([-8, 8, 0, 2]), v: 0 }));
      break;
    }
    case 4: { // holes(): four bores at the corners; along x / y is refused (corners axis)
      feats.push(hostBox());
      const axis = pick(['z', 'z', 'z', 'x', 'y']);
      const dx = pick([5, 8, 2]); const dy = pick([4, 6, 2]);
      feats.push(mk('b1', host, { axis, mode: pick(['through', 'blind']), diameter: pick([2, 3, 4]), corners: { dx, dy }, u: 0, v: 0 }));
      if (r() < 0.3) feats.push(mk('h1', host, { axis: 'z', mode: 'through', diameter: pick([2, 4]), corners: { dx: pick([5, 8]), dy: pick([4, 6]) }, u: 0, v: 0, countersink: { diameter: 5, angleDeg: 90 } }));
      break;
    }
    case 5: { // near the edges: inside by a hair, across the edge, outside the part
      feats.push(hostBox());
      const d = pick([2, 4, 6]);
      const lim = host[0] / 2 - d / 2;
      const u = pick([lim - 0.25, lim + 1, lim + 10, -lim, lim - 1e-7, lim + 1e-7, lim]);
      feats.push(mk('b1', host, { mode: pick(['through', 'blind']), diameter: d, u, v: pick([0, 3]) }));
      break;
    }
    case 6: { // wider than the part (and as wide as a cylinder)
      const hostC = [host[0], host[1], host[2]];
      if (r() < 0.5) {
        feats.push(hostBox());
        feats.push(mk('b1', hostC, { mode: 'through', diameter: pick([Math.min(host[0], host[1]), Math.max(host[0], host[1]) + 2, Math.min(host[0], host[1]) - 2, Math.hypot(host[0], host[1])]), u: 0, v: 0 }));
      } else {
        const R = pick([6, 8, 5]);
        feats.push(cyl('c1', R, host[2], [0, 0, 0]));
        feats.push(mk('c1', [2 * R, 2 * R, host[2]], { mode: pick(['through', 'blind']), diameter: pick([2 * R, 2 * R + 2, 2 * R - 2, R]), u: 0, v: 0 }));
      }
      break;
    }
    case 7: { // tangent to the side, to a sibling, to an earlier hole
      feats.push(hostBox());
      const d = pick([4, 6, 8]);
      const t = pick(['side', 'sibling', 'earlier', 'recess']);
      if (t === 'side') feats.push(mk('b1', host, { mode: 'through', diameter: d, u: (host[0] - d) / 2, v: 0 }));
      else if (t === 'sibling') feats.push(mk('b1', host, { mode: 'through', diameter: d, corners: { dx: d / 2, dy: pick([6, 3]) }, u: 0, v: 0 }));
      else if (t === 'earlier') { feats.push(mk('b1', host, { mode: 'through', diameter: d, u: -5, v: 0 })); feats.push(mk('h1', host, { mode: 'through', diameter: d, u: -5 + d, v: 0 })); }
      else feats.push(mk('b1', host, { mode: 'through', diameter: 3, counterbore: { diameter: d, depth: 2 }, u: (host[0] - d) / 2, v: 0 }));
      break;
    }
    case 8: { // sealed cavity / blind that starts inside
      feats.push(hostBox());
      feats.push(mk('b1', host, { mode: 'sealed', axis: pick(['z', 'z', 'x']), diameter: pick([2, 4, 5]) }));
      if (r() < 0.3) feats.push(mk('h1', host, { mode: 'blind', diameter: 3, u: pick([5, -5]), v: 0 }));
      break;
    }
    case 9: { // several bodies
      const k = pick(['two', 'pattern', 'union', 'move', 'copy']);
      feats.push(hostBox('b1'));
      if (k === 'two') { feats.push(box('b2', [10, 10, 10], [40, 0, 0])); feats.push(mk('b1', host, { mode: 'through' })); feats.push(mk('b2', [10, 10, 10], { mode: 'through', diameter: 3, u: 0, v: 0 })); }
      else if (k === 'pattern') { feats.push(pattern('p1', 'b1', { count: pick([2, 3]), step: pick([[50, 0, 0], [host[0], 0, 0], [5, 0, 0]]) })); feats.push(mk('p1', host, { mode: 'through' })); }
      else if (k === 'union') { feats.push(box('b2', [10, 10, 10], pick([[host[0] / 2 + 5, 0, 0], [60, 0, 0], [2, 2, 2]]))); feats.push(combine('c1', 'union', ['b1', 'b2'])); feats.push(mk('c1', host, { mode: 'through' })); }
      else if (k === 'move') { feats.push(move('m1', 'b1', [pick([5, 0]), 0, 0])); feats.push(mk('b1', host, { mode: 'through' })); feats.push(mk('m1', host, { mode: 'through' })); }
      else { feats.push(move('m1', 'b1', [60, 0, 0], true)); feats.push(mk('b1', host, { mode: 'through' })); }
      break;
    }
    case 10: { // after shell / fillet / combine / pocket / extrude / mirror / rotate
      const k = pick(['shell', 'fillet', 'combine', 'pocket', 'extrude', 'mirror', 'rotate', 'closed-shell']);
      if (k === 'shell') { feats.push(hostBox('b1')); feats.push(shell('s1', 'b1', prim('b1', '+z'), 1)); feats.push(mk('s1', host, { mode: 'through', u: 0, v: 0 })); feats.push(mk('b1', host, { mode: 'blind' })); }
      else if (k === 'closed-shell') { feats.push(hostBox('b1')); feats.push(shell('s1', 'b1', null, 1)); feats.push(mk('s1', host, { mode: 'through' })); }
      else if (k === 'fillet') { feats.push(hostBox('b1')); feats.push(fillet('f1', 'b1', between('b1', prim('b1', '+z'), prim('b1', '+x')), 1)); feats.push(mk('f1', host, { mode: pick(['through', 'blind']) })); }
      else if (k === 'combine') { feats.push(hostBox('b1')); feats.push(box('b2', [10, 10, 30], [pick([0, 15, 40]), 0, 0])); feats.push(combine('c1', pick(['union', 'subtract', 'intersect']), ['b1', 'b2'])); feats.push(mk('c1', host, { mode: pick(['through', 'blind', 'sealed']) })); }
      else if (k === 'pocket') { feats.push(hostBox('b1')); feats.push(rect('sk1', 8, 8)); feats.push(pocket('p1', 'sk1', 'b1', 3)); feats.push(mk('p1', host, { mode: pick(['through', 'blind']) })); feats.push(mk('b1', host, { mode: 'blind', diameter: 2, u: 4, v: 4 })); }
      else if (k === 'extrude') { feats.push({ ...rect('sk1', host[0], host[1]) }); feats.push(extrude('e1', 'sk1', host[2])); feats.push(mk('e1', [host[0], host[1], host[2]], { mode: pick(['through', 'blind']), u: 0 })); }
      else if (k === 'mirror') { feats.push(box('b1', [10, 10, 10], [5, 3, 0])); feats.push(mirror('x1', 'b1', 'yz')); feats.push(mk('x1', [20, 10, 10], { mode: 'through', u: 0, v: 0 })); feats.push(mk('b1', [10, 10, 10], { mode: 'through' })); }
      else { feats.push(hostBox('b1')); feats.push(rotate('r1', 'b1', [0, 0, 30])); feats.push(mk('r1', host, { mode: 'through' })); }
      break;
    }
    case 11: { // curved hosts and cross bores
      const k = pick(['cyl-z', 'cyl-x', 'cyl-rot', 'sphere', 'cone', 'torus', 'prism', 'wedge', 'revolve', 'round-pad', 'cyl-recess']);
      if (k === 'cyl-z') { feats.push(cyl('c1', 8, host[2])); feats.push(mk('c1', [16, 16, host[2]], { mode: pick(['through', 'blind', 'sealed']), diameter: pick([2, 4]) })); }
      else if (k === 'cyl-x') { feats.push(cyl('c1', 8, host[2])); feats.push(mk('c1', [16, 16, host[2]], { axis: pick(['x', 'y']), mode: 'through', diameter: 3 })); }
      else if (k === 'cyl-rot') { feats.push(cyl('c1', 6, 20, [0, 0, 0], { rotate: pick([[90, 0, 0], [0, 90, 0], [0, 0, 45]]) })); feats.push(mk('c1', [12, 12, 20], { axis: pick(['x', 'y', 'z']), mode: 'through', diameter: 2, u: 0, v: 0 })); }
      else if (k === 'sphere') { feats.push(sphere('s1', 8)); feats.push(mk('s1', [16, 16, 16], { mode: pick(['through', 'blind']), diameter: 3, u: pick([0, 3]), v: 0 })); }
      else if (k === 'cone') { feats.push(cone('k1', 7, 12, [0, 0, 0], r() < 0.3 ? { rotate: [0, 90, 0] } : {})); feats.push(mk('k1', [14, 14, 12], { mode: 'through', diameter: 2, u: 0, v: 0 })); }
      else if (k === 'torus') { feats.push(torus('t1', 10, 2)); feats.push(mk('t1', [24, 24, 4], { mode: 'through', diameter: 1, u: 10, v: 0 })); }
      else if (k === 'prism') { feats.push(prism('p1', pick([6, 5, 4]), 8, 10)); feats.push(mk('p1', [16, 16, 10], { mode: pick(['through', 'blind']), diameter: 3, u: 0, v: 0 })); }
      else if (k === 'wedge') { feats.push(wedge('w1', 12, 10, 8)); feats.push(mk('w1', [12, 10, 8], { mode: 'through', diameter: 2 })); }
      else if (k === 'revolve') { feats.push(rect('sk1', 8, 20)); feats.push(revolve('r1', 'sk1', 360)); feats.push(mk('r1', [16, 16, 20], { axis: pick(['x', 'z']), mode: 'through', diameter: 2 })); }
      else if (k === 'round-pad') { feats.push({ ...rect('sk1', 20, 20), bulges: { 1: 0.5 } }); feats.push(extrude('e1', 'sk1', 10)); feats.push(mk('e1', [20, 20, 10], { mode: pick(['through', 'blind']), diameter: 3, u: 0, v: 0 })); }
      else { feats.push(cyl('c1', 8, 12)); feats.push(mk('c1', [16, 16, 12], { mode: 'through', diameter: 3, counterbore: { diameter: 6, depth: 2 }, u: 0, v: 0 })); }
      break;
    }
    case 12: { // sequences of holes on one host: same axis, other axes, nested recesses, overlapping countersinks
      feats.push(hostBox());
      const n = 2 + Math.floor(r() * 3);
      let prev = 'b1';
      for (let i = 0; i < n; i++) {
        const axis = pick(['z', 'z', 'z', 'x', 'y']);
        const recess = r() < 0.35 ? pick([{ counterbore: { diameter: 8, depth: 2 } }, { countersink: { diameter: 8, angleDeg: 90 } }]) : {};
        const f = mk(prev, host, { axis, mode: pick(['through', 'blind']), diameter: pick([2, 3, 4]), u: pick([-6, -3, 0, 3, 6]), v: pick([-3, 0, 3]), ...recess });
        feats.push(f); prev = f.id;
      }
      break;
    }
    case 13: { // malformed or odd input
      const k = pick(['missing-target', 'sketch-target', 'zero', 'negative', 'nan', 'huge', 'zero-depth', 'no-center', 'unknown-kind', 'bad-axis', 'stale']);
      feats.push(hostBox('b1'));
      if (k === 'missing-target') feats.push(mk('nope', host, { mode: 'through' }));
      else if (k === 'sketch-target') { feats.push(rect('sk1', 5, 5)); feats.push(mk('sk1', host, { mode: 'through' })); }
      else if (k === 'zero') feats.push(mk('b1', host, { mode: 'through', diameter: 0 }));
      else if (k === 'negative') feats.push(mk('b1', host, { mode: 'through', diameter: -3 }));
      else if (k === 'nan') feats.push(mk('b1', host, { mode: 'through', diameter: NaN }));
      else if (k === 'huge') feats.push(mk('b1', host, { mode: 'through', diameter: 1e6 }));
      else if (k === 'zero-depth') feats.push(mk('b1', host, { mode: 'through', depth: 0 }));
      else if (k === 'no-center') { const f = mk('b1', host, { mode: 'through' }); delete f.center; feats.push(f); }
      else if (k === 'unknown-kind') { feats.push({ id: 'z1', kind: 'sweep', target: 'b1' }); feats.push(mk('z1', host, { mode: 'through' })); }
      else if (k === 'bad-axis') feats.push(mk('b1', host, { mode: 'through', axis: 'w' }));
      else { feats.push(box('b2', [4, 4, 4], [30, 0, 0])); feats.push(combine('c1', 'union', ['b1', 'b2'])); feats.push(mk('b1', host, { mode: 'through' })); feats.push(mk('c1', host, { mode: 'through' })); }
      break;
    }
    default: { // 14: pulled sketches, planes, circle pads
      const k = pick(['rect-pad', 'circle-pad', 'xz-pad', 'moved-pad']);
      if (k === 'rect-pad') { feats.push(rect('sk1', host[0], host[1])); feats.push(extrude('e1', 'sk1', host[2])); feats.push(mk('e1', host, { mode: pick(['through', 'blind', 'sealed']), u: 0 })); }
      else if (k === 'circle-pad') { feats.push(circ('sk1', 8)); feats.push(extrude('e1', 'sk1', host[2])); feats.push(mk('e1', [16, 16, host[2]], { mode: pick(['through', 'blind']), diameter: pick([2, 4, 16]), u: 0, v: 0 })); }
      else if (k === 'xz-pad') { feats.push({ ...rect('sk1', host[0], host[1]), plane: 'xz' }); feats.push(extrude('e1', 'sk1', host[2])); feats.push(mk('e1', [host[0], host[2], host[1]], { axis: 'y', mode: 'through' })); }
      else { feats.push(rect('sk1', host[0], host[1])); feats.push(extrude('e1', 'sk1', host[2])); feats.push(move('m1', 'e1', [pick([3, 0]), 0, pick([0, 5])])); feats.push(mk('m1', host, { mode: 'through' })); feats.push(mk('e1', host, { mode: 'through' })); }
    }
  }
  return { version: 1, features: feats };
}
