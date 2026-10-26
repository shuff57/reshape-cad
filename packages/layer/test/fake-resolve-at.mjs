// The fake pick source of shell-draft.differential.test.mjs, copied verbatim (that test file runs its tests on import, so it cannot be imported): what brep-rs
// `resolve` gives, crudely: a point on the named face in the PRIMITIVE's own frame (rotate about the origin, then its center; no later move).
// Needs `arc` and `mt` (the compiled sketch / script packages) for the extrude case.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const imp = (p) => import(pathToFileURL(p).href);
const arc = await imp(path.join(root, 'packages/sketch/dist/sketch-arc.js'));
const mt = await imp(path.join(root, 'packages/script/dist/model-types.js'));
// ---- the fake pick source: what brep-rs `resolve` gives, crudely (the primitive's OWN frame: rotate about the origin, then its center; no later move) --------------------
const DIRV = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };
export function rotPt(p, r) {
  let [x, y, z] = p;
  const R = (a) => [Math.cos(a * Math.PI / 180), Math.sin(a * Math.PI / 180)];
  if (r?.[0]) { const [c, s] = R(r[0]); [y, z] = [c * y - s * z, s * y + c * z]; }
  if (r?.[1]) { const [c, s] = R(r[1]); [x, z] = [c * x + s * z, -s * x + c * z]; }
  if (r?.[2]) { const [c, s] = R(r[2]); [x, y] = [c * x - s * y, s * x + c * y]; }
  return [x, y, z];
}
export function fakeResolveAt(prefix, name) {
  const f = prefix.find((x) => x.id === name.feature);
  if (!f) return null;
  const c = f.center ?? [0, 0, 0];
  const dir = DIRV[name.part];
  const world = (p) => { const q = rotPt(p, f.rotate); return [q[0] + c[0], q[1] + c[1], q[2] + c[2]]; };
  const best = (centres) => { // the face whose centre is furthest along the word, first on a tie (the resolver's scoring)
    if (!dir) return null;
    let bi = 0; let bs = -Infinity;
    centres.forEach((p, i) => { const s = p[0] * dir[0] + p[1] * dir[1] + p[2] * dir[2]; if (s > bs + 1e-9) { bs = s; bi = i; } });
    return { kind: 'face', centroid: world(centres[bi]) };
  };
  if (name.kind === 'edge' && name.cause === 'between') { // an edge between two primitive faces of a box: the middle of the edge, and its length
    if (f.kind !== 'box') return null;
    const [a, b] = name.of.map((n) => DIRV[n.part]);
    if (!a || !b || a.every((v, i) => v === b[i])) return null;
    const h = f.size.map((v) => v / 2);
    const mid = [0, 1, 2].map((i) => (a[i] + b[i]) * h[i]);
    const free = [0, 1, 2].find((i) => a[i] === 0 && b[i] === 0);
    return free === undefined ? null : { kind: 'edge', centroid: world(mid), length: f.size[free] };
  }
  switch (f.kind) {
    case 'box': { if (!dir) return null; const h = f.size.map((v) => v / 2); return { kind: 'face', centroid: world(dir.map((d, i) => d * h[i])) }; }
    case 'cylinder': return name.part === '+z' || name.part === '-z' ? { kind: 'face', centroid: world([0, 0, dir[2] * f.height / 2]) } : null;
    case 'cone': return name.part === '-z' ? { kind: 'face', centroid: world([0, 0, -f.height / 2]) } : null;
    case 'prism': case 'wedge': {
      const poly = f.kind === 'prism'
        ? (() => { const n = Math.max(3, Math.min(12, Math.round(f.sides))); return Array.from({ length: n }, (_, i) => [f.radius * Math.cos(2 * Math.PI * i / n), f.radius * Math.sin(2 * Math.PI * i / n)]); })()
        : [[-f.width / 2, -f.depth / 2], [f.width / 2, -f.depth / 2], [-f.width / 2, f.depth / 2]];
      const centres = poly.map((a, i) => { const b = poly[(i + 1) % poly.length]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0]; });
      const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length; const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
      centres.push([cx, cy, f.height / 2], [cx, cy, -f.height / 2]);
      return best(centres);
    }
    case 'extrude': {
      const sk = prefix.find((x) => x.id === f.target);
      if (!sk || sk.shape === 'circle') return dir && Math.abs(dir[2]) === 1 ? { kind: 'face', centroid: world([0, 0, dir[2] > 0 ? f.height : 0]) } : null;
      const o = arc.outlineOf(sk); if (!o.ok) return null;
      const fr = mt.sketchFrameOf(sk);
      const sw = [fr.u[1] * fr.v[2] - fr.u[2] * fr.v[1], fr.u[2] * fr.v[0] - fr.u[0] * fr.v[2], fr.u[0] * fr.v[1] - fr.u[1] * fr.v[0]];
      const to3 = (p, h) => [0, 1, 2].map((i) => fr.origin[i] + fr.u[i] * p[0] + fr.v[i] * p[1] + sw[i] * h);
      const P = o.points;
      const centres = P.map((a, i) => { const b = P[(i + 1) % P.length]; return to3([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], f.height / 2); });
      const cc = [P.reduce((s, p) => s + p[0], 0) / P.length, P.reduce((s, p) => s + p[1], 0) / P.length];
      centres.push(to3(cc, f.height), to3(cc, 0));
      if (!dir) return null;
      let bi = 0; let bs = -Infinity;
      centres.forEach((p, i) => { const s = p[0] * dir[0] + p[1] * dir[1] + p[2] * dir[2]; if (s > bs + 1e-9) { bs = s; bi = i; } });
      return { kind: 'face', centroid: centres[bi] }; // already in the world: an extrude is not built in a local frame
    }
    default: return null;
  }
}

