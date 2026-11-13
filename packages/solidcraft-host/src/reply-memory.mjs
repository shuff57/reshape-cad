// One run of the script: the engine's replies are remembered (second pilot, Q7: a join that takes 4 s of engine time was computed four times).
//
// Every engine run starts from an empty design, so the reply to a command list depends on that list alone. Within ONE run of the script the page asks for the
// same list several times: a guard's second translation and the blocked-step test build translate the script again, the layer reads the same topology more
// than once, and the last thing a run does is replay the accepted commands. A list that was already run is answered from memory.
//   - What is remembered is the reply as it came, cpuMs included, so the layer's time accounting, and with it every result, is what it is without the memory.
//   - A run that was stopped by the time budget (or that the worker could not run) is not remembered, and a remembered reply is not used under a budget
//     smaller than the time it took.
//   - `page` is what SolidCraft itself holds: the list it last ran from an empty design to the end, and the reply it gave. A reply from memory does not touch
//     SolidCraft, so `page` only moves when SolidCraft really ran something, and it is null after anything else (a failed run, a run that did not start empty).
//   - execute(cmds, { replay: true }) is never answered from memory: it is the run that puts SolidCraft on a list, for the view. (Found by reading SolidCraft
//     after each run, timing/held.mjs: with the final replay answered from memory, SolidCraft was left on the last variant a guard had tried, and the view
//     showed a solid the report did not describe, in 2 of 55 scripts.)
//   - heldReply(): the final replay may be skipped when SolidCraft holds exactly the accepted commands AND a fresh reading of it shows the bodies of that
//     reply. What the student sees is then what the report says, by measurement and not by bookkeeping. Any doubt returns null, and the caller builds.
// The memory lives for one run and is thrown away; nothing is kept between runs. No DOM here: pane.js makes one per run (`?memo=off` makes none).

export const keyOf = (cmds) => JSON.stringify(cmds);

/** the bodies of two replies are the same bodies: names, face counts and volumes, exactly (the same engine ran the same list, so not even the last digit moves) */
export const sameBodies = (a, b) => {
  const x = a?.measure?.bodies, y = b?.measure?.bodies;
  return Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((p, i) => p.name === y[i].name && p.volume_mm3 === y[i].volume_mm3 && p.faces === y[i].faces);
};

/** `bridge` = { execute(cmds, opts), topologyOf(cmds), inspect() } (upstream-bridge.mjs). Its methods are looked up at each call. */
export function createReplyMemory(bridge) {
  const exec = new Map(); const topo = new Map();
  const m = {
    page: null, // { list, reply } | null
    hits: 0, runs: 0,
    async execute(cmds, opts = {}) {
      const list = keyOf(cmds); const k = list + (opts.budgetS ? '|b' : '|n');
      const hit = exec.get(k);
      if (hit && !opts.replay && !(opts.budgetS && typeof hit.cpuMs === 'number' && hit.cpuMs > opts.budgetS * 1000)) { m.hits++; return structuredClone(hit); }
      const { replay: _replay, ...pass } = opts;
      const r = await bridge.execute(cmds, pass); m.runs++;
      if (r && (r.timedOut || r.probeError)) return r; // stopped before SolidCraft was touched: nothing to remember, and the page is as it was
      if (r) exec.set(k, structuredClone(r));
      m.page = r && r.ok && opts.fresh ? { list, reply: structuredClone(r) } : null;
      return r;
    },
    async topologyOf(cmds) {
      const list = keyOf(cmds); const hit = topo.get(list);
      if (hit) { m.hits++; return structuredClone(hit); }
      const r = await bridge.topologyOf(cmds); m.runs++;
      m.page = r && r.ok ? { list, reply: null } : null; // it ran in SolidCraft from an empty design; its reply is not an execute reply
      if (r && r.ok) topo.set(list, structuredClone(r));
      return r;
    },
    /** The reply to `cmds` when SolidCraft holds exactly that list and a fresh reading of it agrees; null otherwise (the caller then runs the list). */
    async heldReply(cmds) {
      const list = keyOf(cmds);
      if (!m.page || m.page.list !== list) return null;
      const held = m.page.reply ?? exec.get(list + '|b') ?? exec.get(list + '|n') ?? null;
      if (!held || !held.ok) return null;
      let now = null;
      try { now = await bridge.inspect(); } catch { return null; }
      return sameBodies(held, now) ? structuredClone(held) : null;
    },
  };
  return m;
}
