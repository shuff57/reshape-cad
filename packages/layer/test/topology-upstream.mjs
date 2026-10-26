// TEST-ONLY adapter: SolidCraft's own `model.faces` / `model.edges` engine commands -> the topologyOf() reply the layer's resolver reads.
// NOT part of src/: the layer names no kernel. Needs a wasm package whose `run` returns every command's output
// (docs/spikes/solidcraft-referee/phase2/wrapper2, unmodified source, built as contract/RIG.md builds the referee: see NOTES.md "Moved picks").
// The rig's stock wrapper (wrapper/) throws every command's output away and returns only the final measure, so it CANNOT report topology.
//
//   SOLIDCRAFT_TOPOLOGY_PKG=<dir with solidcraft_referee_p2.js>   (default $HOME/.cache/solidcraft-0.21.0-rig/sc-referee-pkg-topology)
//
// What upstream gives per face: index, name (persistent, "F1:+z"), area, centroid, plane_normal (null when curved), point ("a point on the face
// that picks it"), cylinder? ; per edge: index, name ("A|B", "~n" when repeated), start, mid, end, length.
// What upstream does NOT give, and the adapter therefore does not invent:
//   - `centroid_hit` (which face a pick AT the centroid lands on): absent. The resolver then relies on the interior point only.
//   - `inner_point` / `inner_hit` by those names: upstream's `point` is the pick point; it is passed as inner_point, and inner_hit is set to
//     {index, dist: 0} ON UPSTREAM'S OWN CLAIM that `point` picks that face. That claim is not re-measured here; the real-kernel test is what
//     checks the outcome (the opened face is the intended one, by closed form).
import { createRequire } from 'node:module';
import path from 'node:path';

export function loadUpstream(pkg = process.env.SOLIDCRAFT_TOPOLOGY_PKG ?? path.join(process.env.HOME, '.cache/solidcraft-0.21.0-rig/sc-referee-pkg-topology')) {
  const sc = createRequire(import.meta.url)(path.join(pkg, 'solidcraft_referee_p2.js'));
  const raw = (cmds) => JSON.parse(sc.run(JSON.stringify({ commands: cmds })));
  let calls = 0;
  const failedOf = (r) => { const bad = r.results.find((x) => !x.ok); return bad ? { index: bad.i, command: bad.command, error: bad.error } : null; };
  /** the original referee wrapper's reply: { ok, measure } or { ok: false, failed } */
  const runSC = async (cmds) => {
    calls++;
    let r;
    try { r = raw(cmds); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; }
    const failed = failedOf(r);
    if (failed) return { ok: false, failed };
    if (!r.measure.ok) return { ok: false, error: r.measure.error };
    return { ok: true, measure: r.measure.out };
  };
  const topologyOf = async (cmds) => {
    calls++;
    let r;
    try { r = raw(cmds); } catch (e) { return { ok: false, error: `WASM TRAP: ${e.message}` }; }
    const failed = failedOf(r);
    if (failed) return { ok: false, failed };
    const names = r.measure.ok ? r.measure.out.bodies.map((b) => b.name) : [];
    const ask = names.flatMap((n) => [{ command: 'model.faces', params: { body: n } }, { command: 'model.edges', params: { body: n } }]);
    let t;
    try { t = raw([...cmds, ...ask]); } catch (e) { return { ok: false, error: `WASM TRAP: ${e.message}` }; }
    const tail = t.results.slice(cmds.length);
    const bodies = names.map((name, k) => {
      const f = tail[2 * k]; const e = tail[2 * k + 1];
      if (!f?.ok || !e?.ok) return { name, error: f?.error ?? e?.error ?? 'no reply', faces: [], edges: [] };
      return {
        name,
        faces: f.out.faces.map((x) => ({
          index: x.index, name: x.name ?? '', centroid: x.centroid, plane_normal: x.plane_normal ?? null, area: x.area,
          ...(x.point ? { inner_point: x.point, inner_hit: { index: x.index, dist: 0 } } : {}),
        })),
        edges: e.out.edges.map((x) => ({ index: x.index, name: x.name ?? '', start: x.start, mid: x.mid, end: x.end, length: x.length })),
      };
    });
    return { ok: true, topology: { bodies }, results: t.results.slice(0, cmds.length).map((x) => (x.ok ? { feature: x.out?.feature ?? null } : null)) };
  };
  return { runSC, topologyOf, calls: () => calls };
}
