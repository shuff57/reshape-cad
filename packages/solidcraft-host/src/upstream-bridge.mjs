// The spike's translator/pane expect a patched bridge: execute(commands, {fresh}) -> {ok, failed, measure, sketches, ...}.
// This gives them that shape on top of UPSTREAM's own window.solidcraft (v0.21.0), with no patch.
// Pure over the `sc` object it is given (window.solidcraft, or a fake in tests).
//
// What upstream does NOT give, and what this therefore does not claim:
//  - centroid_hit (which face a pick AT the centroid lands on) and edge names beyond upstream's own `A|B` form: not reported by upstream, never invented.
//    topologyOf() below builds the layer's topology reply from model.faces / model.edges; a face pick point (inner_point + inner_hit) is passed on only
//    when verifiedInnerPoint() can back upstream's claim, otherwise the face carries none and the layer refuses the pick in a sentence.
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
/**
 * Upstream says a face's `point` "picks it". That is taken as given for "the point is on the face", and everything that CAN be checked from the data is:
 * the point lies on the face's own plane / cylinder (to tol); it lies inside the box of the face's boundary edges (edges named `<face>|<other>`);
 * and no OTHER face's surface comes within `clear` of it, so the nearest-face rule cannot send it elsewhere. Any other face whose surface is not described, or
 * that is coplanar with the point, makes the answer null (no pick point is passed on). Returns the point or null.
 */
export function verifiedInnerPoint(face, faces, edges, scale) {
  const p = face.point;
  if (!isV3(p) || !face.name) return null;
  const tol = 1e-6 * Math.max(1, scale); const clear = 1e-3;
  const own = surfaceDistance(face, p);
  if (own === null || own > tol) return null;
  for (const g of faces) {
    if (g === face) continue;
    const d = surfaceDistance(g, p);
    if (d === null || d <= clear) return null;
  }
  const mine = edges.filter((e) => faceNamesOfEdge(e.name).includes(face.name) && isV3(e.start) && isV3(e.mid) && isV3(e.end));
  if (!mine.length) return null;
  for (let k = 0; k < 3; k++) {
    const vals = mine.flatMap((e) => [e.start[k], e.mid[k], e.end[k]]);
    if (p[k] < Math.min(...vals) - tol || p[k] > Math.max(...vals) + tol) return null;
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
  const faces = rawFaces.map((f) => {
    const out = { index: f.index, name: f.name ?? '', centroid: f.centroid, plane_normal: f.plane_normal ?? null, area: f.area };
    if (f.cylinder) out.cylinder = f.cylinder;
    const ip = verifiedInnerPoint(f, rawFaces, rawEdges, scale);
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

export function createUpstreamBridge(sc) {
  /** run `commands` from an empty design, then read faces and edges of every body: the layer's topologyOf() reply. */
  async function topologyOf(commands) {
    try { await sc.execute('file.new', {}); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    let batch;
    try {
      batch = await sc.request('engine.batch', { commands: commands.map((c) => ({ command: c.command, params: c.params ?? {} })), rollback: false });
    } catch (e) { return { ok: false, failed: { error: String((e && e.message) || e) } }; }
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
    const res = Array.isArray(batch.results) && batch.results.length === commands.length ? batch.results.map((r) => ({ feature: Number.isInteger(r?.feature) ? r.feature : null })) : undefined;
    return { ok: true, topology: { bodies }, measure: { bodies: insp.bodies ?? [] }, ...(res ? { results: res } : {}) };
  }
  return {
    topologyOf,
    /** run `commands`; fresh starts from an empty design. rollback is off so a failure leaves the state to inspect; the next fresh run resets it. */
    async execute(commands, { fresh = false, topology = false } = {}) {
      if (topology) return topologyOf(commands);
      if (fresh) await sc.execute('file.new', {});
      let batch;
      try {
        batch = await sc.request('engine.batch', { commands: commands.map((c) => ({ command: c.command, params: c.params ?? {} })), rollback: false });
      } catch (e) {
        return { ok: false, failed: { command: null, error: String((e && e.message) || e) } };
      }
      const snap = await snapshot(sc);
      if (batch.failed) {
        const f = batch.failed;
        const at = snap.active_sketch ? snap.sketches.find((s) => s.name === snap.active_sketch || s.id === snap.active_sketch) : null;
        return { ok: false, failed: { index: f.index, command: f.command, error: f.error, params: commands[f.index]?.params ?? {} }, ...snap, sketch_at_failure: at ?? null };
      }
      return { ok: true, completed: batch.completed, ...snap };
    },
    async inspect() { return { ok: true, ...(await snapshot(sc)) }; },
    async restorePrevious() { return { ok: false, error: 'restoring your previous design is not built on this build' }; },
  };
}
