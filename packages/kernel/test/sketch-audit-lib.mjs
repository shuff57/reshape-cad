// 2D audit (docs/PLAN-next.md section 25 step 2): closed-form oracles and a seeded generator of sketch-and-pull
// scripts as a student writes them. Nothing here reads a kernel number to decide what is right: every volume is
// area (shoelace, circular segment, rounded corner) times height.
import { rng, makeRunner, classify } from './wrong-solid-sweep-lib.mjs';

export { rng, makeRunner, classify };
export const R2 = (x) => Math.round(x * 100) / 100;

/** Shoelace area of a polygon (absolute). */
export function shoelace(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}
/** Area a fillet of radius r takes off a corner of interior angle alpha. */
export const filletCut = (alpha, r) => r * r * (1 / Math.tan(alpha / 2) - (Math.PI - alpha) / 2);
/** Rounded rectangle, all four corners radius r. */
export const roundedRect = (w, h, r) => w * h - (4 - Math.PI) * r * r;
/** Circular segment cut off by a chord that subtends angle theta of a circle of radius r. */
export const segmentArea = (r, theta) => (r * r / 2) * (theta - Math.sin(theta));
/** Obround (slot) of centre distance len and cap radius r. */
export const slotArea = (len, r) => 2 * r * len + Math.PI * r * r;

export function interiorAngle(prev, c, next) {
  const a = [prev[0] - c[0], prev[1] - c[1]], b = [next[0] - c[0], next[1] - c[1]];
  return Math.acos((a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b)));
}

const PI = Math.PI;
// ---------------------------------------------------------------- oracles
/** pi x^2 dy round a closed counter-clockwise outline = the volume of its revolution. Segments: {line:[a,b]} or {arc:[c,r,a0,sweep]}. */
export function pappus(segs) {
  let v = 0;
  const GL = [[-0.9061798459386640, 0.2369268850561891], [-0.5384693101056831, 0.4786286704993665], [0, 0.5688888888888889],
    [0.5384693101056831, 0.4786286704993665], [0.9061798459386640, 0.2369268850561891]];
  for (const s of segs) {
    if (s.line) {
      const [[x0, y0], [x1, y1]] = s.line;
      v += PI * (x0 * x0 + x0 * x1 + x1 * x1) / 3 * (y1 - y0);
    } else {
      const [[cx], r, a0, sw] = [s.arc[0], s.arc[1], s.arc[2], s.arc[3]];
      const cy = s.arc[0][1]; void cy;
      const N = 200;
      for (let i = 0; i < N; i++) {
        const lo = a0 + sw * i / N, hi = a0 + sw * (i + 1) / N, m = (lo + hi) / 2, h = (hi - lo) / 2;
        for (const [x, w] of GL) {
          const t = m + h * x;
          const px = cx + r * Math.cos(t);
          v += PI * px * px * (r * Math.cos(t)) * w * h;
        }
      }
    }
  }
  return Math.abs(v);
}
/** The outline of a convex polygon with some corners rounded (radius by corner index, 0-based), counter-clockwise. */
export function roundedPolygon(pts, rounds = {}) {
  let area2 = 0;
  for (let i = 0; i < pts.length; i++) area2 += pts[i][0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * pts[i][1];
  const P = area2 < 0 ? [...pts].reverse() : pts;
  const rr = area2 < 0 ? Object.fromEntries(Object.entries(rounds).map(([k, v]) => [pts.length - 1 - k, v])) : rounds;
  const n = P.length;
  const corner = (k) => {
    const c = P[k], p = P[(k + n - 1) % n], q = P[(k + 1) % n], r = rr[k];
    if (!r) return { in: c, out: c };
    const u = [p[0] - c[0], p[1] - c[1]], w = [q[0] - c[0], q[1] - c[1]];
    const lu = Math.hypot(...u), lw = Math.hypot(...w);
    const al = Math.acos((u[0] * w[0] + u[1] * w[1]) / (lu * lw));
    const t = r / Math.tan(al / 2);
    const pin = [c[0] + u[0] / lu * t, c[1] + u[1] / lu * t], pout = [c[0] + w[0] / lw * t, c[1] + w[1] / lw * t];
    const b = [u[0] / lu + w[0] / lw, u[1] / lu + w[1] / lw], lb = Math.hypot(...b);
    const d = r / Math.sin(al / 2);
    const centre = [c[0] + b[0] / lb * d, c[1] + b[1] / lb * d];
    const a0 = Math.atan2(pin[1] - centre[1], pin[0] - centre[0]);
    let sw = Math.atan2(pout[1] - centre[1], pout[0] - centre[0]) - a0;
    while (sw < 0) sw += 2 * PI;
    return { in: pin, out: pout, arc: [centre, r, a0, sw] };
  };
  const segs = [];
  for (let k = 0; k < n; k++) {
    const a = corner(k), b = corner((k + 1) % n);
    if (a.arc) segs.push({ arc: a.arc });
    segs.push({ line: [a.out, b.in] });
  }
  return segs;
}
/** The piece a round (kind 'R') or a chamfer ('C') of size s takes off a right-angle corner, as [area, centroid offset along each leg]. */
export function cornerPiece(kind, s) {
  return kind === 'R' ? [(1 - PI / 4) * s * s, s * (10 - 3 * PI) / (3 * (4 - PI))] : [s * s / 2, s / 3];
}
/** Revolution volume of a w x h rectangle centred at u = cx, less each treated corner (corners numbered 1..4 as the script numbers them). */
export function rectSpin(cx, w, h, treat = {}) {
  const sx = { 1: +1, 2: -1, 3: -1, 4: +1 }; // which way the inside lies from each corner, along u
  const x0 = { 1: cx - w / 2, 2: cx + w / 2, 3: cx + w / 2, 4: cx - w / 2 };
  let v = 2 * PI * cx * w * h;
  for (const [k, [kind, s]] of Object.entries(treat)) {
    const [A, d] = cornerPiece(kind, s);
    v -= 2 * PI * (x0[k] + sx[k] * d) * A;
  }
  return v;
}
export const segmentAreaOf = (r, th) => r * r / 2 * (th - Math.sin(th));
/** A circular segment spun about an axis a distance c from the circle's centre: chord at the right of the centre for theta < pi. */
export function segmentSpin(c, r, th) {
  const d = 4 * r * Math.sin(th / 2) ** 3 / (3 * (th - Math.sin(th)));
  return 2 * PI * (c + d) * segmentAreaOf(r, th);
}


const mix = (seed, i) => (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 1, 0xc2b2ae35)) >>> 0;

/**
 * One sketch-and-pull script, as students write it, with its exact volume.
 * families: rect (rounds and chamfers within budget), poly (convex polygon, optional fillet),
 *           circle, slot, arc (soup half-disc or circular segment)
 */
export function genSketch(family, index, seed = 1) {
  const r = rng(mix(seed, index * 8 + family.length));
  const u = (lo, hi) => R2(lo + (hi - lo) * r());
  const h = u(2, 40);
  const tags = { family, index, seed };
  let code, area, bbox, volume;
  if (family === 'rect') {
    const w = u(20, 80), d = u(20, 80);
    const lines = [`const s = sketch('top')`, `s.rect(${w}, ${d})`];
    // Each corner independently: nothing, round, or chamfer. Radii are drawn so that neighbouring trims fit
    // their shared edge: every trim <= half the shorter side.
    const cap = Math.min(w, d) / 2;
    let cut = 0;
    const kinds = [];
    for (let k = 0; k < 4; k++) {
      const t = r();
      const v = R2(Math.max(0.5, r() * cap));
      if (t < 0.35) { lines.push(`s.round(${k + 1}, ${v})`); cut += (1 - Math.PI / 4) * v * v; kinds.push('R'); }
      else if (t < 0.6) { lines.push(`s.chamfer(${k + 1}, ${v})`); cut += v * v / 2; kinds.push('C'); }
      else kinds.push('-');
    }
    lines.push(`pull(s, ${h})`);
    code = lines.join('\n'); area = w * d - cut; bbox = [[-w / 2, -d / 2, 0], [w / 2, d / 2, h]];
    tags.kinds = kinds.join('');
  } else if (family === 'poly') {
    // convex polygon: sorted angles on a jittered circle
    const n = 3 + Math.floor(r() * 6);
    const R = u(15, 40);
    const angs = Array.from({ length: n }, (_, i) => (i + 0.15 + 0.7 * r()) * 2 * Math.PI / n);
    const sq = 0.6 + 0.4 * r(); // one squash for every point: points on an ellipse in angle order are convex
    const pts = angs.map((a) => [R2(R * Math.cos(a)), R2(R * Math.sin(a) * sq)]);
    area = shoelace(pts);
    const lines = [`const s = sketch('top')`, `s.polygon(${JSON.stringify(pts)})`];
    if (r() < 0.5) {
      // one fillet, kept well inside its corner's budget
      const k = Math.floor(r() * n);
      const prev = pts[(k + n - 1) % n], c = pts[k], next = pts[(k + 1) % n];
      const al = interiorAngle(prev, c, next);
      const maxR = Math.min(Math.hypot(prev[0] - c[0], prev[1] - c[1]), Math.hypot(next[0] - c[0], next[1] - c[1])) / 2 * Math.tan(al / 2);
      const rad = R2(Math.max(0.3, maxR * (0.2 + 0.6 * r())));
      lines.push(`s.round(${k + 1}, ${rad})`);
      area -= filletCut(al, rad);
      tags.round = true;
    }
    lines.push(`pull(s, ${h})`);
    code = lines.join('\n');
    bbox = null;
  } else if (family === 'circle') {
    const dia = u(4, 70);
    code = `const s = sketch('top')\ns.circle(${dia})\npull(s, ${h})`;
    area = Math.PI * dia * dia / 4; bbox = [[-dia / 2, -dia / 2, 0], [dia / 2, dia / 2, h]];
  } else if (family === 'slot') {
    const len = u(10, 60), rad = u(2, 15), ang = r() * Math.PI;
    const a = [0, 0], b = [R2(len * Math.cos(ang)), R2(len * Math.sin(ang))];
    const L = Math.hypot(b[0], b[1]);
    code = `const s = sketch('top').slot(${JSON.stringify(a)}, ${JSON.stringify(b)}, ${rad})\npull(s, ${h})`;
    area = slotArea(L, rad); bbox = null;
  } else if (family === 'arc') {
    // a circular segment: arc of sweep theta on a circle of radius R, closed by its chord
    const R = u(5, 40), theta = 0.3 + r() * 2.7;
    const a = [R, 0], b = [R * Math.cos(theta), R * Math.sin(theta)];
    const geoms = [
      { k: 'arc', id: 1, c: [0, 0], r: R, a, b, sense: 'ccw' },
      { k: 'line', id: 2, a: b, b: a },
    ];
    const rules = [
      { k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' },
      { k: 'coincident', a: 2, aEnd: 'b', b: 1, bEnd: 'a' },
    ];
    code = `const s = sketch('top'); s.geom(${JSON.stringify(geoms)}); s.rules(${JSON.stringify(rules)}); pull(s, ${h})`;
    area = segmentArea(R, theta); bbox = null;
  } else if (family === 'revolve') {
    // A profile spun a full turn about the sketch plane's normal (u is the radius). Volume is Pappus, worked out
    // from textbook centroids (rectangle with treated corners) or by integrating the outline (polygon with a fillet).
    if (r() < 0.5) {
      const w = u(10, 40), hh = u(4, 30), cx = u(w / 2 + 3, 70);
      const lines = [`const s = sketch('front', 0)`, `s.rect(${w}, ${hh}, { at: [${cx}, 0] })`];
      const cap = Math.min(w, hh) / 2, treat = {}, kinds = [];
      for (let k = 1; k <= 4; k++) {
        const t = r(), v = R2(Math.max(0.3, r() * cap));
        if (t < 0.35) { lines.push(`s.round(${k}, ${v})`); treat[k] = ['R', v]; kinds.push('R'); }
        else if (t < 0.6) { lines.push(`s.chamfer(${k}, ${v})`); treat[k] = ['C', v]; kinds.push('C'); }
        else kinds.push('-');
      }
      lines.push('revolve(s, 360)');
      code = lines.join('\n'); tags.kinds = kinds.join('');
      volume = rectSpin(cx, w, hh, treat);
    } else {
      const n = 3 + Math.floor(r() * 5), R = u(6, 22), cx = u(R + 4, 70);
      const angs = Array.from({ length: n }, (_, i) => (i + 0.15 + 0.7 * r()) * 2 * Math.PI / n);
      const sq = 0.6 + 0.4 * r();
      const pts = angs.map((a) => [R2(cx + R * Math.cos(a)), R2(R * Math.sin(a) * sq)]);
      const lines = [`const s = sketch('front', 0)`, `s.polygon(${JSON.stringify(pts)})`];
      const rounds = {};
      if (r() < 0.6) {
        const k = Math.floor(r() * n);
        const prev = pts[(k + n - 1) % n], c = pts[k], next = pts[(k + 1) % n];
        const al = interiorAngle(prev, c, next);
        const maxR = Math.min(Math.hypot(prev[0] - c[0], prev[1] - c[1]), Math.hypot(next[0] - c[0], next[1] - c[1])) / 2 * Math.tan(al / 2);
        const rad = R2(Math.max(0.3, maxR * (0.2 + 0.6 * r())));
        lines.push(`s.round(${k + 1}, ${rad})`); rounds[k] = rad; tags.round = true;
      }
      lines.push('revolve(s, 360)');
      code = lines.join('\n');
      volume = pappus(roundedPolygon(pts, rounds));
    }
    area = 0; bbox = null;
  } else if (family === 'revarc') {
    // a circular segment (soup arc + chord) spun about an axis clear of it
    const rad = u(4, 20), c = u(rad + 3, 60), th = 0.3 + r() * (2 * Math.PI - 0.9);
    const a = [c + rad * Math.cos(th / 2), -rad * Math.sin(th / 2)], b = [c + rad * Math.cos(th / 2), rad * Math.sin(th / 2)];
    const geoms = [{ k: 'arc', id: 1, c: [c, 0], r: rad, a, b, sense: 'ccw' }, { k: 'line', id: 2, a: b, b: a }];
    const rules = [{ k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' }, { k: 'coincident', a: 2, aEnd: 'b', b: 1, bEnd: 'a' }];
    code = `const s = sketch('front', 0); s.geom(${JSON.stringify(geoms)}); s.rules(${JSON.stringify(rules)}); revolve(s, 360)`;
    area = 0; bbox = null;
    volume = segmentSpin(c, rad, th);
  } else if (family === 'pullarc') {
    // a rectangle with one semicircular end (an arc and three lines), pulled
    const w = u(10, 60), rad = u(3, 20);
    const geoms = [
      { k: 'line', id: 1, a: [0, -rad], b: [w, -rad] }, { k: 'arc', id: 2, c: [w, 0], r: rad, a: [w, -rad], b: [w, rad], sense: 'ccw' },
      { k: 'line', id: 3, a: [w, rad], b: [0, rad] }, { k: 'line', id: 4, a: [0, rad], b: [0, -rad] },
    ];
    const rules = [1, 2, 3, 4].map((i) => ({ k: 'coincident', a: i, aEnd: 'b', b: (i % 4) + 1, bEnd: 'a' }));
    code = `const s = sketch('top'); s.geom(${JSON.stringify(geoms)}); s.rules(${JSON.stringify(rules)}); pull(s, ${h})`;
    area = 2 * rad * w + Math.PI * rad * rad / 2; bbox = null;
  } else throw new Error(`unknown family ${family}`);
  return { code, tags, oracle: { exactVolume: typeof volume === 'number' ? volume : area * h }, area, height: h, bbox };
}
