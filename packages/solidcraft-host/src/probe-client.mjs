// Main-thread side of the time budget. probe(commands, budgetS) replays `commands` in a fresh Worker and answers
//   { status:'done',     reply, cpuMs, loadMs }   the engine finished inside the budget (reply is the referee's own answer)
//   { status:'timedOut', cpuMs }                  the budget ran out; the Worker was terminated, nothing else was touched
//   { status:'error',    error }                  the Worker could not run it (wasm trap, kernel not loadable)
// Everything environment-specific is injected (Worker constructor, module loader, clock, timers) so the logic is unit-tested without a browser.

/** The layer's own rule is { budgetS: 45 + 1.5 x last run }; the host clamps what it is given to something a Worker can honour. */
export const MIN_BUDGET_S = 1;
export const MAX_BUDGET_S = 3600;
export function clampBudgetS(b) {
  const n = Number(b);
  if (!Number.isFinite(n)) return n > 0 ? MAX_BUDGET_S : null; // +Infinity (negative-control runs) -> the ceiling; NaN/undefined -> no budget
  return Math.min(MAX_BUDGET_S, Math.max(MIN_BUDGET_S, n));
}

/** the reply a timed-out run gives the layer: the shape holes/patterns-mirror/booleans/revolve-groove read */
export function timedOutReply(budgetS, cpuMs) {
  return { ok: false, timedOut: true, cpuMs, failed: { command: '(budget)', error: `TIME BUDGET: exceeded ${Math.round(budgetS * 1000)} ms` } };
}

export function createProber({ makeWorker, getModule, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
  return {
    async probe(commands, budgetS) {
      let module;
      try { module = await getModule(); } catch (e) { return { status: 'error', error: `the time-limit kernel could not be loaded: ${String((e && e.message) || e)}` }; }
      return new Promise((resolve) => {
        let worker;
        const t0 = now();
        let timer = null; let settled = false;
        const finish = (r) => { if (settled) return; settled = true; if (timer !== null) clearTimer(timer); try { worker && worker.terminate(); } catch { /* already gone */ } resolve(r); };
        try { worker = makeWorker(); } catch (e) { return finish({ status: 'error', error: String((e && e.message) || e) }); }
        worker.onmessage = (ev) => {
          const m = ev.data;
          if (m.phase === 'done') finish({ status: 'done', reply: m.reply, cpuMs: m.cpuMs, loadMs: m.loadMs });
          else finish({ status: 'error', error: m.error });
        };
        worker.onerror = (ev) => finish({ status: 'error', error: String((ev && ev.message) || 'worker error') });
        timer = setTimer(() => finish({ status: 'timedOut', cpuMs: now() - t0 }), budgetS * 1000);
        worker.postMessage({ module, commands });
      });
    },
  };
}
