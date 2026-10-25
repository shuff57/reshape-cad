// The spike's translator/pane expect a patched bridge: execute(commands, {fresh}) -> {ok, failed, measure, sketches, ...}.
// This gives them that shape on top of UPSTREAM's own window.solidcraft (v0.21.0), with no patch.
// Pure over the `sc` object it is given (window.solidcraft, or a fake in tests).
//
// What upstream does NOT give, and what this therefore does not claim:
//  - topology (named picks): unsupported, answers ok:false so the translator refuses the pick in a sentence.
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
  return {
    /** run `commands`; fresh starts from an empty design. rollback is off so a failure leaves the state to inspect; the next fresh run resets it. */
    async execute(commands, { fresh = false, topology = false } = {}) {
      if (topology) return { ok: false, error: 'this build cannot report topology, so named edges and faces cannot be picked' };
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
