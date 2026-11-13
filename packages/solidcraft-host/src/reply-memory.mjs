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
//
// Run only the new steps (`continueRuns`, off unless asked for). The layer builds a script one step at a time, and every engine run starts from an empty
// design, so step k replays steps 1..k-1: SolidCraft's work grows with the square of the script. When SolidCraft holds, from an empty design and run to the
// end, exactly the first commands of the list that is asked for, only the rest is run on top (upstream-bridge.mjs `held`). `page.cmds` is that record, one
// string per command; it is only ever set from a run that came back ok, and dropped after anything else. The time budget still judges the whole list.
// `shadow` (tests): a second bridge on another SolidCraft; every real run is repeated there from an empty design and the two replies are compared
// (compareReplies), which is how "a continued run gives what a run from empty gives" is measured and not assumed.

export const keyOf = (cmds) => JSON.stringify(cmds);

/** the bodies of two replies are the same bodies: names, face counts and volumes, exactly (the same engine ran the same list, so not even the last digit moves) */
export const sameBodies = (a, b) => {
  const x = a?.measure?.bodies, y = b?.measure?.bodies;
  return Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((p, i) => p.name === y[i].name && p.volume_mm3 === y[i].volume_mm3 && p.faces === y[i].faces);
};

/** `bridge` = { execute(cmds, opts), topologyOf(cmds), inspect() } (upstream-bridge.mjs). Its methods are looked up at each call. */
const TIMING = new Set(['cpuMs', 'probeLoadMs', 'probeVolume']); // the worker's figures: not SolidCraft's reply
/**
 * Two replies to the same list, field by field. Returns { same, diffs: [path, a, b][] (the first 12), maxRel: the largest relative difference of two numbers }.
 * `same` is exact: every string, flag and number equal, to the last digit.
 */
export function compareReplies(a, b) {
  const diffs = []; let maxRel = 0; let count = 0;
  const walk = (x, y, p) => {
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y && !(Number.isNaN(x) && Number.isNaN(y))) { count++; maxRel = Math.max(maxRel, Math.abs(x - y) / Math.max(1e-300, Math.abs(x), Math.abs(y))); if (diffs.length < 12) diffs.push([p, x, y]); }
      return;
    }
    if (x === null || y === null || typeof x !== 'object' || typeof y !== 'object') { if (x !== y) { count++; maxRel = Infinity; if (diffs.length < 12) diffs.push([p, x ?? null, y ?? null]); } return; }
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) { if (!p && TIMING.has(k)) continue; walk(x[k], y[k], `${p}/${k}`); }
  };
  walk(a, b, '');
  return { same: count === 0, count, diffs, maxRel };
}

/**
 * `bridge` = { execute(cmds, opts), topologyOf(cmds, opts), inspect() } (upstream-bridge.mjs). Its methods are looked up at each call.
 * `continueRuns`: run only the commands after the ones SolidCraft holds. `shadow`: a second bridge for the from-empty reference; `log`: an array that gets one
 * row per real run: { kind, n (commands), held (commands not run), ms, budget (it ran under a time budget), same, count, maxRel, diffs } (the last four only
 * with a shadow). A run stopped by the budget is not a row: SolidCraft did not run it.
 */
export function createReplyMemory(bridge, { continueRuns = false, shadow = null, log = null } = {}) {
  const exec = new Map(); const topo = new Map();
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  /** how many leading commands of `cmds` SolidCraft holds, when what it holds is the start of `cmds` (0: start from empty) */
  const heldOf = (cmds) => {
    const p = m.page;
    if (!continueRuns || !p || !p.cmds || p.cmds.length > cmds.length) return 0;
    for (let i = 0; i < p.cmds.length; i++) if (p.cmds[i] !== JSON.stringify(cmds[i])) return 0;
    return p.cmds.length;
  };
  const note = async (kind, cmds, held, ms, r, ref, budget = false) => {
    if (!log) return;
    const row = { kind, n: cmds.length, held, ms: Math.round(ms), ok: !!(r && r.ok), last: cmds.at(-1)?.command ?? null, budget };
    if (shadow) { const c = compareReplies(r, await ref()); Object.assign(row, { same: c.same, count: c.count, maxRel: c.maxRel, diffs: c.diffs }); }
    log.push(row);
  };
  const m = {
    page: null, // { list, cmds: string[], reply, results: [{feature}] | null } | null
    hits: 0, runs: 0, continued: 0,
    async execute(cmds, opts = {}) {
      const list = keyOf(cmds); const k = list + (opts.budgetS ? '|b' : '|n');
      const hit = exec.get(k);
      if (hit && !opts.replay && !(opts.budgetS && typeof hit.cpuMs === 'number' && hit.cpuMs > opts.budgetS * 1000)) { m.hits++; return structuredClone(hit); }
      const { replay: _replay, ...pass } = opts;
      const held = opts.fresh ? heldOf(cmds) : 0; const heldResults = held ? m.page.results : null;
      const t0 = now();
      const r = await bridge.execute(cmds, continueRuns && opts.fresh ? { ...pass, features: true, ...(held ? { held } : {}) } : pass); m.runs++;
      if (r && (r.timedOut || r.probeError)) return r; // stopped before SolidCraft was touched: nothing to remember, and the page is as it was
      if (held) m.continued++;
      // `ran` (the feature numbers of the commands this call ran) is the bridge's note to the memory, not part of the reply: a continued run has fewer of them
      const { ran, ...reply } = r ?? {};
      const results = r && r.ok && Array.isArray(ran) && ran.length === cmds.length - held && (!held || Array.isArray(heldResults)) ? [...(held ? heldResults : []), ...ran] : null;
      if (r) exec.set(k, structuredClone(reply));
      m.page = r && r.ok && opts.fresh ? { list, cmds: cmds.map((c) => JSON.stringify(c)), reply: structuredClone(reply), results } : null;
      if (opts.fresh) await note('execute', cmds, held, now() - t0, reply, async () => { const { ran: _x, ...ref } = (await shadow.execute(cmds, { fresh: true })) ?? {}; return ref; }, !!opts.budgetS);
      return r ? reply : r;
    },
    async topologyOf(cmds) {
      const list = keyOf(cmds); const hit = topo.get(list);
      if (hit) { m.hits++; return structuredClone(hit); }
      // continued only when the feature numbers of the held commands are known: the reply carries one per command
      const held = heldOf(cmds); const heldResults = held && Array.isArray(m.page.results) ? m.page.results : null;
      const t0 = now();
      const r = await (heldResults ? bridge.topologyOf(cmds, { held, heldResults }) : bridge.topologyOf(cmds)); m.runs++;
      if (heldResults) m.continued++;
      // it ran in SolidCraft, from an empty design or on top of the held commands; its reply is not an execute reply
      m.page = r && r.ok ? { list, cmds: cmds.map((c) => JSON.stringify(c)), reply: null, results: Array.isArray(r.results) && r.results.length === cmds.length ? structuredClone(r.results) : null } : null;
      if (r && r.ok) topo.set(list, structuredClone(r));
      await note('topologyOf', cmds, heldResults ? held : 0, now() - t0, r, () => shadow.topologyOf(cmds));
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
