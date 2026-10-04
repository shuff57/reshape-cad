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
  let code, area, bbox;
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
      if (t < 0.35) { lines.push(`s.round(${k}, ${v})`); cut += (1 - Math.PI / 4) * v * v; kinds.push('R'); }
      else if (t < 0.6) { lines.push(`s.chamfer(${k}, ${v})`); cut += v * v / 2; kinds.push('C'); }
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
      lines.push(`s.round(${k}, ${rad})`);
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
  } else throw new Error(`unknown family ${family}`);
  return { code, tags, oracle: { exactVolume: area * h }, area, height: h, bbox };
}
