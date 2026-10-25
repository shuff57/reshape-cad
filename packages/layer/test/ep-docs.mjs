// Generated ModelDocs for the extrude-pocket differential test: outlines the group's guards care about (bow-tie, self-touching, folding tapers,
// tiny sizes, arcs, rounds, holed profiles, soups of several loops, circles) pulled and cut with random options. Plain data, seeded.
import { box, cyl, rect, circ, extrude, pocket, combine, line, arcG, circG, soup, move, hole } from './docs.mjs';

export function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const closeRules = (ids) => ids.map((a, i) => ({ k: 'coincident', a, aEnd: 'b', b: ids[(i + 1) % ids.length], bEnd: 'a' }));
/** a closed polygon of line rows with ids from `base`+1; returns {geoms, ids} */
function polyRows(base, pts) {
  const geoms = pts.map((p, i) => line(base + i + 1, p, pts[(i + 1) % pts.length]));
  return { geoms, ids: geoms.map((g) => g.id) };
}

export function epDoc(seed) {
  const r = mulberry32(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const num = (lo, hi) => Math.round((lo + r() * (hi - lo)) * 8) / 8;
  const tiny = () => pick([1e-5, 5e-4, 1e-3, 3e-3, 0.02, 0.2]);
  const feats = [];
  const scale = r() < 0.2 ? tiny() * 20 : r() < 0.15 ? 25 : 1;
  const W = num(8, 40) * scale; const H = num(8, 40) * scale;

  const sketchOf = (id) => {
    const u = r();
    const plane = r() < 0.7 ? 'xy' : pick(['xz', 'yz']);
    const base = { plane, offset: r() < 0.7 ? 0 : num(-6, 6) };
    let sk;
    if (u < 0.10) sk = { ...rect(id, W, H) };
    else if (u < 0.17) sk = { ...rect(id, W, H), points: [[0, 0], [W, H], [W, 0], [0, H]] }; // bow-tie
    else if (u < 0.22) sk = { ...rect(id, W, H), points: [[0, 0], [W, 0], [W, H], [W / 2, 0], [0, H]] }; // vertex on an edge: touches itself
    else if (u < 0.27) sk = { ...rect(id, W, H), points: [[0, 0], [W, 0], [W, H], [W * 0.5, H], [W * 0.5, 0.0004 * scale], [W * 0.5 - 1e-5, H], [0, H]] }; // near-touching sliver
    else if (u < 0.33) { const t = tiny(); sk = { ...rect(id, t, t * pick([1, 3, 40])) }; }
    else if (u < 0.37) sk = { ...rect(id, W, 0) }; // flat
    else if (u < 0.42) sk = { ...rect(id, W, H), points: [[0, 0], [0, 0], [W, 0], [W, H], [0, H], [0, 0]] }; // repeated points
    else if (u < 0.50) sk = { ...rect(id, W, H), bulges: { [Math.floor(r() * 4)]: num(-1.5, 1.5), [Math.floor(r() * 4)]: num(-0.6, 0.6) } };
    else if (u < 0.56) sk = { ...rect(id, W, H), rounds: { [Math.floor(r() * 4)]: num(0.1, Math.min(W, H) * 0.6), [Math.floor(r() * 4)]: num(0.01, 2) } };
    else if (u < 0.60) sk = { ...rect(id, W, H), chamfers: { [Math.floor(r() * 4)]: num(0.1, 4) } };
    else if (u < 0.68) { const rr = r() < 0.3 ? tiny() : num(0.5, 12) * scale; sk = circ(id, rr, num(-2, 2), num(-2, 2)); }
    else if (u < 0.72) { const n = 3 + Math.floor(r() * 5); const R = num(3, 20) * scale; sk = { ...rect(id), points: Array.from({ length: n }, (_, i) => [R * Math.cos((2 * Math.PI * i) / n) * (0.6 + 0.4 * r()), R * Math.sin((2 * Math.PI * i) / n) * (0.6 + 0.4 * r())]) }; }
    else if (u < 0.76) { const L = rect(id, W, H); sk = { ...L, points: [[0, 0], [W, 0], [W, H * 0.3], [W * 0.3, H * 0.3], [W * 0.3, H * 0.7], [W, H * 0.7], [W, H], [0, H]] }; } // C shape (folds under taper)
    else if (u < 0.86) {
      // soup: outer rectangle with holes (circle, square), possibly more islands
      const rows = polyRows(0, [[0, 0], [W, 0], [W, H], [0, H]]);
      const geoms = [...rows.geoms]; const rules = r() < 0.7 ? closeRules(rows.ids) : [];
      let nid = 4;
      const nh = 1 + Math.floor(r() * 3);
      for (let i = 0; i < nh; i++) {
        const cx = W * ((i + 1) / (nh + 1)); const cy = H / 2; const rr = Math.min(W, H) * (0.05 + 0.1 * r());
        if (r() < 0.6) geoms.push(circG(++nid, [cx, cy], rr));
        else { const q = polyRows(nid, [[cx - rr, cy - rr], [cx + rr, cy - rr], [cx + rr, cy + rr], [cx - rr, cy + rr]]); nid += 4; geoms.push(...q.geoms); if (r() < 0.7) rules.push(...closeRules(q.ids)); }
      }
      sk = soup(id, geoms, rules);
    } else if (u < 0.90) {
      // soup: several loops side by side (some touching or crossing)
      const geoms = []; let nid = 0; const rules = [];
      const n = 2 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const x0 = i * (W + (r() < 0.2 ? -W * 0.5 : r() < 0.2 ? 0 : 3));
        const q = polyRows(nid, [[x0, 0], [x0 + W, 0], [x0 + W, H], [x0, H]]); nid += 4; geoms.push(...q.geoms); rules.push(...closeRules(q.ids));
      }
      sk = soup(id, geoms, rules);
    } else if (u < 0.93) {
      // soup: a slot made of lines and arcs, or a loop that does not close
      const open = r() < 0.4;
      const geoms = [line(1, [0, 0], [20, 0]), arcG(2, [20, 5], 5, [20, 0], [20, 10], 'ccw'), line(3, [20, 10], [0, 10]), arcG(4, [0, 5], 5, [0, 10], open ? [0, 1] : [0, 0], 'ccw')];
      sk = soup(id, geoms, closeRules([1, 2, 3, 4]));
    } else if (u < 0.96) {
      // soup: many circles (can exceed the shape cap of 24)
      const n = pick([2, 5, 12, 24, 25, 30]);
      const geoms = [...polyRows(0, [[0, 0], [100, 0], [100, 100], [0, 100]]).geoms];
      for (let i = 0; i < n; i++) geoms.push(circG(5 + i, [8 + (i % 6) * 15, 8 + Math.floor(i / 6) * 15], 3));
      sk = soup(id, geoms, closeRules([1, 2, 3, 4]));
    } else {
      // soup: self-crossing outline / nested depth 2 / unsupported row kind
      const kind = pick(['bow', 'nest', 'spline']);
      if (kind === 'bow') { const q = polyRows(0, [[0, 0], [W, H], [W, 0], [0, H]]); sk = soup(id, q.geoms, closeRules(q.ids)); }
      else if (kind === 'nest') {
        const a = polyRows(0, [[0, 0], [40, 0], [40, 40], [0, 40]]); const b = polyRows(4, [[5, 5], [35, 5], [35, 35], [5, 35]]); const c = polyRows(8, [[12, 12], [28, 12], [28, 28], [12, 28]]);
        sk = soup(id, [...a.geoms, ...b.geoms, ...c.geoms], [...closeRules(a.ids), ...closeRules(b.ids), ...closeRules(c.ids)]);
      } else sk = soup(id, [line(1, [0, 0], [5, 0]), { k: 'spline', id: 2 }], []);
    }
    return { ...sk, ...base };
  };
  const options = (isPocket) => {
    const o = {};
    if (r() < 0.25) o.midplane = true;
    if (r() < 0.2) o.length2 = pick([5e-4, 0.5, 2, 8]);
    if (r() < 0.2) o.reversed = true;
    if (r() < 0.3) o.taper = pick([-95, -85, -60, -20, -5, 1, 3, 10, 20, 30, 55, 89, 89.95, 120]);
    if (r() < 0.2) o.direction = pick([[1, 0, 1], [0, 0, 1], [0, 0, -2], [1, 0, 0], [0, 1, 1], [1, 1, 3], [0.2, 0, 1], [0, 0, 0.0000001]]);
    if (o.direction && r() < 0.5) o.alongNormal = pick([true, false]);
    if (isPocket && r() < 0.25) o.through = true;
    return o;
  };

  // a base part
  const baseKind = pick(['box', 'box', 'cylinder', 'pull', 'pull', 'sketchless']);
  const sx = num(20, 80) * scale; const sy = num(20, 80) * scale; const sz = num(6, 30) * scale;
  let target = 'b1';
  if (baseKind === 'box') feats.push(box('b1', [sx, sy, sz], [0, 0, 0]));
  else if (baseKind === 'cylinder') feats.push(cyl('b1', sx / 3, sz, [0, 0, 0]));
  else if (baseKind === 'pull') {
    feats.push({ ...rect('skb', sx, sy), points: [[-sx / 2, -sy / 2], [sx / 2, -sy / 2], [sx / 2, sy / 2], [-sx / 2, sy / 2]] }, extrude('e0', 'skb', sz));
    target = 'e0';
  } else { feats.push(box('b1', [sx, sy, sz], [0, 0, 0])); }
  const solid = target;

  const steps = 1 + Math.floor(r() * 3);
  let head = solid; let nExtrudes = 0;
  const extruded = [];
  for (let i = 0; i < steps; i++) {
    const t = r();
    const skId = `sk${i + 1}`;
    feats.push(sketchOf(skId));
    if (t < 0.4) { const id = `e${++nExtrudes}`; feats.push(extrude(id, skId, (r() < 0.1 ? -1 : 1) * pick([tiny(), 1, 2.5, 6, 15, 40]) * (r() < 0.5 ? 1 : scale), options(false))); extruded.push(id); }
    else if (t < 0.85) { const id = `p${i + 1}`; feats.push(pocket(id, skId, head, (r() < 0.05 ? -1 : 1) * pick([tiny(), 1, 3, 7, 25]) * (r() < 0.5 ? 1 : scale), options(true))); if (r() < 0.2) head = id; }
    else { const id = `e${++nExtrudes}`; feats.push(extrude(id, skId, num(2, 12), options(false))); extruded.push(id); }
  }
  if (extruded.length && r() < 0.55) {
    const other = pick(extruded);
    const op = pick(['union', 'union', 'union', 'subtract', 'intersect']);
    if (r() < 0.4) feats.push(move('mv', other, [num(-30, 30), num(-30, 30), num(-5, 5)]));
    feats.push(combine('cmb', op, [solid, other, ...(r() < 0.15 && extruded.length > 1 ? [extruded.find((e) => e !== other) ?? other] : [])]));
  }
  if (r() < 0.12) feats.push(combine('cmb2', 'union', ['e1', 'e2']));
  if (r() < 0.1) feats.push(hole('hh', solid, {}));
  if (r() < 0.08) feats.push(extrude('eBad', 'nosuch', 3));
  if (r() < 0.06) feats.push(pocket('pBad', 'sk1', 'nosuch', 3, options(true)));
  return { version: 1, features: feats };
}
