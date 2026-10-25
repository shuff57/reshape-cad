// The spike's translator/pane expect a patched bridge: execute(commands, {fresh}) -> {ok, failed, measure, sketches, ...}.
// This gives them that shape on top of UPSTREAM's own window.solidcraft (v0.21.0), with no patch.
// Pure over the `sc` object it is given (window.solidcraft, or a fake in tests).
//
// What upstream does NOT give, and what this therefore does not claim:
//  - topology (named picks): unsupported, answers ok:false so the translator refuses the pick in a sentence.
//  - stash/restore of the student's own design: not built. A fresh run replaces the active design (file.new).
//  - per-sketch solver residuals: upstream reports dof/status/failing only.

/** snapshot of the current design in the shape the pane reads. */
export async function snapshot(sc) {
  const insp = await sc.inspect({ measure: true });
  const sketches = [];
  for (const s of insp.sketches ?? []) {
    let si = null;
    try { si = await sc.execute('sketch.inspect', { sketch: s.name }); } catch { /* a sketch that cannot be inspected is reported without detail */ }
    sketches.push({
      name: s.name, dof: s.dof, status: s.status, curves: s.curves,
      profile_list: si ? si.profiles : [], failing: si ? si.failing : undefined, fully_constrained: si ? si.fully_constrained : undefined,
      points: si ? si.points : undefined, constraints: si ? si.constraints : undefined,
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
