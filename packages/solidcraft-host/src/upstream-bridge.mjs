import { clampBudgetS, timedOutReply } from './probe-client.mjs';
// The spike's translator/pane expect a patched bridge: execute(commands, {fresh}) -> {ok, failed, measure, sketches, ...}.
// This gives them that shape on top of UPSTREAM's own window.solidcraft (written against v0.21.0, pinned v0.30.1 since 2026-11-09), with no patch.
// Pure over the `sc` object it is given (window.solidcraft, or a fake in tests).
//
// What upstream does NOT give, and what this therefore does not claim:
//  - centroid_hit (which face a pick AT the centroid lands on) and edge names beyond upstream's own `A|B` form: not reported by upstream, never invented.
//    topologyOf() below builds the layer's topology reply from model.faces / model.edges; a face pick point (inner_point + inner_hit) is passed on only
//    when verifiedInnerPoint() can back upstream's claim, otherwise the face carries none and the layer refuses the pick in a sentence.
//    Upstream describes a face's surface only when it is a plane or a cylinder. A countersink's conical wall is the one other surface this file accepts: its
//    cone is worked out from upstream's own edges of that face (coneOfFace), so a part with a countersink keeps its pick points. Any other undescribed
//    face (a sphere, a torus, a cone that is not a countersink's) still leaves the whole body without pick points.
//  - stash/restore of the student's own design: not built. A fresh run replaces the active design (file.new).
//  - per-sketch solver residuals: upstream reports dof/status/failing only.


// ---- interior point of a profile -------------------------------------------------------------------------------------------------
// The translator's even-odd fill needs a point strictly inside each profile. Upstream gives only the centroid, which lies in the hole of a
// ring. So: sample the boundary (outer curves + hole curves), grid the bounding box, keep the points inside by the even-odd rule over all the
// segments, and take the one farthest from every segment. Upstream stores arcs counter-clockwise from .start to .end.
const TAU = Math.PI * 2;
function curvePolyline(c, n = 96) {
  if (c.type === 'line') return [c.start_at, c.end_at];
  if (c.type === 'circle') return Array.from({ length: n + 1 }, (_, k) => [c.center_at[0] + c.radius * Math.cos((TAU * k) / n), c.center_at[1] + c.radius * Math.sin((TAU * k) / n)]);
  if (c.type === 'arc') {
    const [cx, cy] = c.center_at;
    const a0 = Math.atan2(c.start_at[1] - cy, c.start_at[0] - cx);
    const a1 = Math.atan2(c.end_at[1] - cy, c.end_at[0] - cx);
    const sw = (((a1 - a0) % TAU) + TAU) % TAU || TAU;
    return Array.from({ length: n + 1 }, (_, k) => [cx + c.radius * Math.cos(a0 + (sw * k) / n), cy + c.radius * Math.sin(a0 + (sw * k) / n)]);
  }
  return [];
}
const segDist = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1]; const L = dx * dx + dy * dy; const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0; return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
export function interiorPoint(profile, curves) {
  const byId = new Map(curves.map((c) => [c.id, c]));
  const ids = [...(profile.curves ?? []), ...((profile.holes ?? []).flat())];
  const segs = [];
  for (const id of ids) { const c = byId.get(id); if (!c) continue; const pl = curvePolyline(c); for (let i = 0; i + 1 < pl.length; i++) segs.push([pl[i], pl[i + 1]]); }
  if (!segs.length) return profile.centroid_sketch ?? null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [a, b] of segs) for (const q of [a, b]) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
  const inside = (pt) => { let c = false; for (const [p, q] of segs) if ((p[1] > pt[1]) !== (q[1] > pt[1]) && pt[0] < ((q[0] - p[0]) * (pt[1] - p[1])) / (q[1] - p[1]) + p[0]) c = !c; return c; };
  const N = 33; let best = null, bestD = -1;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const pt = [x0 + ((i + 0.5) / N) * (x1 - x0), y0 + ((j + 0.5) / N) * (y1 - y0)];
    if (!inside(pt)) continue;
    let d = Infinity; for (const [a, b] of segs) { d = Math.min(d, segDist(pt, a, b)); if (d < bestD) break; }
    if (d > bestD) { bestD = d; best = pt; }
  }
  return best ?? profile.centroid_sketch ?? null;
}


// ---- topology: upstream model.faces / model.edges -> the layer's topologyOf() reply -----------------------------------------------------------------
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const isV3 = (v) => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
/** Distance from point p to the UNBOUNDED surface of a face (its plane, or its cylinder), a lower bound of the distance to the face itself. null: surface not described (sphere, cone, torus, a bare curved face). */
export function surfaceDistance(face, p) {
  if (isV3(face.plane_normal) && isV3(face.centroid)) {
    const n = face.plane_normal; const L = Math.hypot(...n);
    return L > 0 ? Math.abs(dot3(n, sub3(p, face.centroid))) / L : null;
  }
  const c = face.cylinder;
  if (c && isV3(c.axis) && isV3(c.origin) && typeof c.radius === 'number') {
    const L = Math.hypot(...c.axis); if (!(L > 0)) return null;
    const a = c.axis.map((x) => x / L); const v = sub3(p, c.origin); const t = dot3(v, a);
    const perp = [v[0] - t * a[0], v[1] - t * a[1], v[2] - t * a[2]];
    return Math.abs(Math.hypot(...perp) - c.radius);
  }
  return null;
}
const faceNamesOfEdge = (name) => String(name ?? '').split('|').map((x) => x.replace(/~\d+$/, ''));
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
/** The circle through three points: { c, n (unit normal), r }, or null when they are on one line. */
function circle3(p, q, s) {
  const a = sub3(q, p), b = sub3(s, p); const n = cross3(a, b); const n2 = dot3(n, n);
  if (!(n2 > 1e-18 * Math.max(1, dot3(a, a) * dot3(b, b)))) return null;
  // centre = p + ((|a|^2 b - |b|^2 a) x n) / (2 |n|^2)
  const w = [0, 1, 2].map((k) => dot3(a, a) * b[k] - dot3(b, b) * a[k]); const u = cross3(w, n);
  const c = [0, 1, 2].map((k) => p[k] + u[k] / (2 * n2)); const nl = Math.sqrt(n2);
  return { c, n: n.map((x) => x / nl), r: len3(sub3(p, c)) };
}
/**
 * The cone of a countersink's wall, from upstream's own edges of that face: { origin, axis (unit), r0 (radius at the origin), t1, r1 (radius t1 along the axis) }, or null.
 * Upstream describes only planes and cylinders, so this is the one surface worked out here, and only when all of this holds:
 *  - the face is named as the side of a countersink (`...:csink:side:<n>`, upstream's name for the cone of solid.hole type countersink);
 *  - the END POINTS of its edges (the face's vertices; an edge's `mid` and `length` are those of the display polyline, measured: a short arc comes back as one
 *    straight piece, so they are not used to find a circle) fall into two groups: at least three on one circle, and the rest in a parallel plane, all the
 *    same distance from that circle's axis, a distance apart along it; exactly one such split exists;
 *  - every edge joins two vertices of one group (an arc of that circle) or one of each, and each of those is straight (mid on the chord, length = chord) and
 *    lies in a plane through the axis (a generator); there is at least one; the far group has at least two vertices.
 * A surface of revolution between two coaxial circles whose meridian is a straight segment is a cone, so its unbounded surface is known exactly.
 */
export function coneOfFace(face, edges, scale) {
  if (!/:csink:side:\d+$/.test(String(face?.name ?? ''))) return null;
  const mine = edges.filter((e) => faceNamesOfEdge(e.name).includes(face.name));
  if (mine.length < 3 || !mine.every((e) => isV3(e.start) && isV3(e.mid) && isV3(e.end) && typeof e.length === 'number')) return null;
  const tol = 1e-6 * Math.max(1, scale); const near = 10 * tol;
  const verts = []; for (const e of mine) for (const p of [e.start, e.end]) if (!verts.some((q) => len3(sub3(q, p)) <= near)) verts.push(p);
  if (verts.length < 4 || verts.length > 16) return null;
  const axial = (p, K) => dot3(sub3(p, K.c), K.n);
  const radial = (p, K) => { const v = sub3(p, K.c); const t = dot3(v, K.n); return len3([0, 1, 2].map((k) => v[k] - t * K.n[k])); };
  // a candidate split is kept only if every edge fits it: an edge within one group is an arc of that circle; an edge from one group to the other must be a
  // straight generator in a plane through the axis, and there must be one
  const fits = (K, onK) => {
    let generators = 0;
    for (const e of mine) {
      const a = onK.some((q) => len3(sub3(q, e.start)) <= near), b = onK.some((q) => len3(sub3(q, e.end)) <= near);
      if (a === b) continue;
      const ch = sub3(e.end, e.start); const L = len3(ch);
      if (len3(cross3(sub3(e.mid, e.start), ch)) / L > tol || Math.abs(L - e.length) > near) return false; // not straight
      const dir = (p) => { const v = sub3(p, K.c); const t = dot3(v, K.n); const w = [0, 1, 2].map((k) => v[k] - t * K.n[k]); const l = len3(w); return l > near ? w.map((x) => x / l) : null; };
      const d0 = dir(e.start), d1 = dir(e.end);
      if (!d0 || !d1 || len3(sub3(d0, d1)) > 1e-6) return false; // not in one plane through the axis
      generators++;
    }
    return generators > 0;
  };
  let found = null;
  for (let i = 0; i < verts.length; i++) for (let j = i + 1; j < verts.length; j++) for (let l = j + 1; l < verts.length; l++) {
    const K = circle3(verts[i], verts[j], verts[l]); if (!K || !(K.r > near)) continue;
    const onK = verts.filter((p) => Math.abs(axial(p, K)) <= near && Math.abs(radial(p, K) - K.r) <= near);
    const rest = verts.filter((p) => !onK.includes(p)); if (rest.length < 2) continue; // the far circle needs two vertices to be checked at all
    const t1 = axial(rest[0], K), r1 = radial(rest[0], K);
    if (Math.abs(t1) <= near || !(r1 > near) || !rest.every((p) => Math.abs(axial(p, K) - t1) <= near && Math.abs(radial(p, K) - r1) <= near)) continue;
    if (!fits(K, onK)) continue;
    const cone = { origin: K.c, axis: K.n, r0: K.r, t1, r1 };
    // the same cone found again from another three vertices is the same answer; a different one makes it ambiguous
    if (found && !(len3(sub3(found.origin, cone.origin)) <= near && Math.abs(found.r0 - cone.r0) <= near && Math.abs(Math.abs(found.t1) - Math.abs(cone.t1)) <= near && Math.abs(found.r1 - cone.r1) <= near)) return null;
    found = found ?? cone;
  }
  return found;
}
/** Distance from p to the unbounded cone (both nappes): in the half-plane through the axis and p the cone is the line through (0, r0) and (t1, r1) and its mirror image. */
export function coneDistance(cone, p) {
  const v = sub3(p, cone.origin); const t = dot3(v, cone.axis);
  const rho = len3([0, 1, 2].map((k) => v[k] - t * cone.axis[k]));
  const L = Math.hypot(cone.t1, cone.r1 - cone.r0);
  const d = (r) => Math.abs(t * (cone.r1 - cone.r0) - (r - cone.r0) * cone.t1) / L;
  return Math.min(d(rho), d(-rho));
}
/**
 * The box of one boundary edge, as [lo, hi]: its start, mid and end, and, when the edge is an arc, how far the arc reaches between them. Upstream gives three
 * points per edge; a half circle reaches up to a radius further than they do (measured on 0.30.1: a cylinder's cap is two half circles whose seam is not on an
 * axis, and upstream's own pick point of the cap lies outside the box of those six points, so every pick on a cylinder was refused in the page).
 *  - three points not on a line: the circle through them; the arc is the part from start to end that passes mid, and the box takes in each point of the
 *    circle that is furthest along an axis and lies on that arc;
 *  - start and end the same point and mid another (a whole circle as one edge): the circle with start-mid as diameter in the plane across `axis` (the
 *    face's plane normal or cylinder axis), when that is known and at right angles to the diameter.
 * A circle is only used when its radius is under 1000 chords: a flatter arc reaches no further than its three points to any size that matters, and the angles
 * of a huge circle are not worth trusting. An edge that is some other curve keeps the box of its three points, as before.
 */
export function edgeBox(e, axis, tol) {
  const pts = [e.start, e.mid, e.end];
  const lo = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k]))), hi = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])));
  const grow = (K, onArc) => {
    for (let k = 0; k < 3; k++) {
      const ek = [0, 1, 2].map((i) => (i === k ? 1 : 0)); const t = dot3(ek, K.n);
      const w = [0, 1, 2].map((i) => ek[i] - t * K.n[i]); const l = len3(w);
      if (!(l > 1e-12)) continue; // the circle lies across this axis: no reach along it
      for (const sgn of [1, -1]) { const q = [0, 1, 2].map((i) => K.c[i] + sgn * K.r * w[i] / l); if (onArc(q)) { lo[k] = Math.min(lo[k], q[k]); hi[k] = Math.max(hi[k], q[k]); } }
    }
  };
  const chord = len3(sub3(e.end, e.start)); const reach = len3(sub3(e.mid, e.start));
  if (chord <= tol && reach > tol) {
    const L = isV3(axis) ? len3(axis) : 0; if (!(L > 0)) return [lo, hi];
    const n = axis.map((x) => x / L); const d = sub3(e.mid, e.start);
    if (Math.abs(dot3(d, n)) > tol) return [lo, hi]; // the diameter is not in the plane across the axis
    grow({ c: [0, 1, 2].map((i) => (e.start[i] + e.mid[i]) / 2), n, r: reach / 2 }, () => true);
    return [lo, hi];
  }
  const K = circle3(e.start, e.mid, e.end);
  if (!K || !(K.r <= 1000 * Math.max(chord, reach))) return [lo, hi];
  // angles round the circle from start. circle3's normal is (mid - start) x (end - start), so turning about it from start reaches mid before end, always:
  // the arc is the angles from 0 to the angle of end
  const u = sub3(e.start, K.c).map((x) => x / K.r); const v = cross3(K.n, u);
  const ang = (q) => { const d = sub3(q, K.c); const a = Math.atan2(dot3(d, v), dot3(d, u)); return a < 0 ? a + 2 * Math.PI : a; };
  const aEnd = ang(e.end);
  grow(K, (q) => ang(q) <= aEnd);
  return [lo, hi];
}
/**
 * Upstream says a face's `point` "picks it". That is taken as given for "the point is on the face", and everything that CAN be checked from the data is:
 * the point lies on the face's own plane / cylinder (to tol); it lies inside the box of the face's boundary edges (edges named `<face>|<other>`; edgeBox);
 * and no OTHER face's surface comes within `clear` of it, so the nearest-face rule cannot send it elsewhere. Any other face whose surface is not described, or
 * that is coplanar with the point, makes the answer null (no pick point is passed on). Returns the point or null.
 * `cones` (optional): Map of a face to its cone (coneOfFace), the description of a countersink's wall as ANOTHER face; a cone face itself gets no pick point.
 */
export function verifiedInnerPoint(face, faces, edges, scale, cones) {
  const p = face.point;
  if (!isV3(p) || !face.name) return null;
  const tol = 1e-6 * Math.max(1, scale); const clear = 1e-3;
  const own = surfaceDistance(face, p);
  if (own === null || own > tol) return null;
  for (const g of faces) {
    if (g === face) continue;
    let d = surfaceDistance(g, p);
    if (d === null && cones && cones.get(g)) d = coneDistance(cones.get(g), p);
    if (d === null || d <= clear) return null;
  }
  const mine = edges.filter((e) => faceNamesOfEdge(e.name).includes(face.name) && isV3(e.start) && isV3(e.mid) && isV3(e.end));
  if (!mine.length) return null;
  const axis = isV3(face.plane_normal) ? face.plane_normal : face.cylinder && isV3(face.cylinder.axis) ? face.cylinder.axis : null;
  const boxes = mine.map((e) => edgeBox(e, axis, tol));
  for (let k = 0; k < 3; k++) {
    if (p[k] < Math.min(...boxes.map((b) => b[0][k])) - tol || p[k] > Math.max(...boxes.map((b) => b[1][k])) + tol) return null;
  }
  return p;
}
/** One body's { faces, edges } as upstream reports them -> the layer's TopoBody. Nothing is added that upstream did not say, except inner_hit where verifiedInnerPoint backs it. */
export function adaptBody(name, facesReply, edgesReply) {
  const rawFaces = facesReply?.faces; const rawEdges = edgesReply?.edges;
  if (!Array.isArray(rawFaces) || !Array.isArray(rawEdges)) return { name, error: 'solidcraft returned no faces or edges for this body', faces: [], edges: [] };
  const all = rawEdges.flatMap((e) => [e.start, e.end]).filter(isV3);
  const scale = all.length ? Math.max(...[0, 1, 2].map((k) => Math.max(...all.map((v) => v[k])) - Math.min(...all.map((v) => v[k])))) : 1;
  const edges = rawEdges.map((e) => ({ index: e.index, name: e.name ?? '', start: e.start, mid: e.mid, end: e.end, length: e.length }));
  const cones = new Map(); for (const f of rawFaces) { if (!isV3(f.plane_normal) && !f.cylinder) { const k = coneOfFace(f, rawEdges, scale); if (k) cones.set(f, k); } }
  const faces = rawFaces.map((f) => {
    const out = { index: f.index, name: f.name ?? '', centroid: f.centroid, plane_normal: f.plane_normal ?? null, area: f.area };
    if (f.cylinder) out.cylinder = f.cylinder;
    const ip = verifiedInnerPoint(f, rawFaces, rawEdges, scale, cones);
    if (ip) { out.inner_point = ip; out.inner_hit = { index: f.index, dist: 0 }; }
    return out;
  });
  return { name, faces, edges };
}

/** snapshot of the current design in the shape the pane reads. */
export async function snapshot(sc) {
  const insp = await sc.inspect({ measure: true });
  const sketches = [];
  for (const s of insp.sketches ?? []) {
    let si = null;
    try { si = await sc.execute('sketch.inspect', { sketch: s.name }); } catch { /* a sketch that cannot be inspected is reported without detail */ }
    sketches.push({
      name: s.name, dof: s.dof, status: s.status, curves: s.curves,
      profile_list: si ? si.profiles.map((p) => ({ ...p, interior: interiorPoint(p, si.curves ?? []) })) : [], failing: si ? si.failing : undefined, fully_constrained: si ? si.fully_constrained : undefined,
      points: si ? si.points : undefined, constraints: si ? si.constraints : undefined,
      // the shape the pane's sketch reader expects: points {id,pos}, curves {id,r,...}; upstream names points <curve>.start/.end/.center as the mapper does
      sketch: si ? { points: (si.points ?? []).map((q) => ({ id: q.id, pos: q.at })), curves: (si.curves ?? []).map((c) => ({ ...c, r: c.radius })) } : undefined,
    });
  }
  return { measure: { bodies: insp.bodies ?? [] }, sketches, dirty: insp.dirty === true, active_sketch: insp.active_sketch ?? null };
}

/**
 * The time budget (Phase 3, "kernel in a worker"). Truck runs synchronously inside SolidCraft's page, so nothing can stop a slow boolean there.
 * With a `prober` (probe-client.mjs) and a `budgetS`, the commands are first replayed on a scratch session in a Worker that is terminated when the
 * budget runs out; only a run that finished in time is applied in SolidCraft. Returns null when no budget applies.
 *   timed out        -> { stop: { ok:false, timedOut:true, cpuMs, failed:{command:'(budget)', error} } }, SolidCraft not touched
 *   probe could not run it (wasm trap, kernel not loadable) -> { stop: { ok:false, probeError:true, failed:{command:'(probe)', error} } }, SolidCraft not touched
 *   finished in time -> { cpuMs } (the worker's engine time), to be added to the reply of the real run
 */
export async function budgetGate(prober, commands, budgetS, capS) {
  let b = clampBudgetS(budgetS);
  if (b !== null && Number.isFinite(capS)) b = Math.min(b, capS); // a cap only ever shortens (tests, a classroom setting)
  if (!prober || b === null) return null;
  const r = await prober.probe(commands.map((c) => ({ command: c.command, params: c.params ?? {} })), b);
  if (r.status === 'timedOut') return { stop: timedOutReply(b, r.cpuMs) };
  if (r.status === 'error') return { stop: { ok: false, probeError: true, failed: { command: '(probe)', error: r.error } } };
  return { cpuMs: r.cpuMs, loadMs: r.loadMs, probeReply: r.reply };
}

/**
 * `held` (second pilot, Q7, "run only the new steps"): the caller's statement that SolidCraft holds, from an empty design and run to the end, exactly the
 * first `held` commands of the list. Only the rest is then run, on top of what is there. 0 (the default) starts from an empty design, as always. The bridge
 * cannot check the statement; the caller keeps the record (reply-memory.mjs) and a wrong statement gives a wrong design, so nothing but that record passes it.
 */
const heldOf = (held, n) => (Number.isInteger(held) && held > 0 && held <= n ? held : 0);
const featuresOf = (batch, n) => (Array.isArray(batch.results) && batch.results.length === n ? batch.results.map((r) => ({ feature: Number.isInteger(r?.feature) ? r.feature : null })) : undefined);

export function createUpstreamBridge(sc, { prober = null, capS } = {}) {
  /**
   * run `commands` from an empty design, then read faces and edges of every body: the layer's topologyOf() reply.
   * With `held` and `heldResults` (the feature numbers of the commands SolidCraft already holds) only the commands after the first `held` are run.
   */
  async function topologyOf(commands, { held = 0, heldResults } = {}) {
    const n = Array.isArray(heldResults) && heldResults.length === heldOf(held, commands.length) ? heldResults.length : 0;
    if (!n) { try { await sc.execute('file.new', {}); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } }
    const rest = commands.slice(n);
    let batch = { results: [] };
    if (rest.length) {
      try {
        batch = await sc.request('engine.batch', { commands: rest.map((c) => ({ command: c.command, params: c.params ?? {} })), rollback: false });
      } catch (e) { return { ok: false, failed: { error: String((e && e.message) || e) } }; }
    }
    if (batch.failed) return { ok: false, failed: { error: batch.failed.error } };
    let insp;
    try { insp = await sc.inspect({ measure: true }); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    const bodies = [];
    for (const b of insp.bodies ?? []) {
      let f = null, e = null;
      try { f = await sc.execute('model.faces', { body: b.name }); e = await sc.execute('model.edges', { body: b.name }); } catch { /* reported on the body below */ }
      bodies.push(adaptBody(b.name, f, e));
    }
    // results[k].feature is upstream's own feature number of command k (the persistent-name check reads it); only passed when there is one answer per command
    const own = featuresOf(batch, rest.length);
    const res = own ? [...(n ? heldResults : []), ...own] : undefined;
    return { ok: true, topology: { bodies }, measure: { bodies: insp.bodies ?? [] }, ...(res ? { results: res } : {}) };
  }
  return {
    topologyOf,
    /**
     * run `commands`; fresh starts from an empty design. rollback is off so a failure leaves the state to inspect; the next fresh run resets it.
     * fresh with `held`: SolidCraft already holds the first `held` commands, so only the rest is run (the time budget still judges the whole list, and a
     * failure is reported at its place in the whole list). With `features`, `ran` in the reply is the feature numbers of the commands this call ran, when
     * upstream gave them (the caller's record of what SolidCraft holds needs them; without the word the reply is what it always was).
     */
    async execute(commands, { fresh = false, topology = false, budgetS, held = 0, heldResults, features = false } = {}) {
      if (topology) return topologyOf(commands, { held, heldResults });
      const gate = await budgetGate(prober, commands, budgetS, capS);
      if (gate && gate.stop) return gate.stop;
      const n = fresh ? heldOf(held, commands.length) : 0;
      const rest = commands.slice(n);
      // probeVolume: what the scratch run measured, kept so a check can compare it with the real run (the two are different compilations of the same engine)
      const stamp = (r) => (gate ? { ...r, cpuMs: gate.cpuMs, probeLoadMs: gate.loadMs, probeVolume: (gate.probeReply?.measure?.bodies ?? []).reduce((a, b) => a + (b.volume_mm3 ?? 0), 0) } : r);
      if (fresh && !n) await sc.execute('file.new', {});
      let batch = { completed: 0, results: [] };
      if (rest.length) {
        try {
          batch = await sc.request('engine.batch', { commands: rest.map((c) => ({ command: c.command, params: c.params ?? {} })), rollback: false });
        } catch (e) {
          return stamp({ ok: false, failed: { command: null, error: String((e && e.message) || e) } });
        }
      }
      const snap = await snapshot(sc);
      if (batch.failed) {
        const f = batch.failed; const index = Number.isInteger(f.index) ? f.index + n : f.index;
        const at = snap.active_sketch ? snap.sketches.find((s) => s.name === snap.active_sketch || s.id === snap.active_sketch) : null;
        return stamp({ ok: false, failed: { index, command: f.command, error: f.error, params: commands[index]?.params ?? {} }, ...snap, sketch_at_failure: at ?? null });
      }
      const ran = features ? featuresOf(batch, rest.length) : undefined;
      return stamp({ ok: true, completed: Number.isInteger(batch.completed) ? batch.completed + n : batch.completed, ...(ran ? { ran } : {}), ...snap });
    },
    async inspect() { return { ok: true, ...(await snapshot(sc)) }; },
    async restorePrevious() { return { ok: false, error: 'restoring your previous design is not built on this build' }; },
  };
}
