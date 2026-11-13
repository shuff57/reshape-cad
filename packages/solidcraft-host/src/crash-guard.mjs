// SolidCraft's engine can stop for good in the middle of a command (a Rust panic compiled to a wasm trap: "RuntimeError: unreachable"). Upstream's own
// request() then never answers, and neither does anything asked of it afterwards: the page waits for ever. Found 2026-11-13 by running the corpora in the real
// page (pilot-2026-11b/PILOT-2.md, "A step that stops SolidCraft"): `fc combined seed 215`, a cut that panics in truck-geotrait curve.rs:78. The Node sweeps never saw it
// as a hang, because there a trap is an exception the caller catches, and the step is refused in a sentence.
//
// This makes the page do the same, on our side of the seam (upstream is not patched):
//   - the trap surfaces as an uncaught error on SolidCraft's window; every call that is waiting is rejected with an Error (engineStopped: true), which
//     upstream-bridge.mjs already turns into { ok: false, failed: { error } }, and the layer into the step's own "cannot be built" sentence;
//   - SolidCraft is loaded again (its frame is reloaded), and calls made meanwhile wait for it. Every engine run of the page starts from an empty design
//     (file.new), so nothing of the stopped engine is needed afterwards;
//   - only a wasm RuntimeError counts. Any other error on that window is left alone.
// No DOM by name here: the caller passes the frame's window, how to reload it and how to tell it is ready (pane.js).

/** an `error` or `unhandledrejection` event of SolidCraft's window that means the engine has stopped */
export function isEngineStop(ev) {
  const e = ev && (ev.error ?? ev.reason); const name = e && (e.name || (e.constructor && e.constructor.name));
  const msg = String((ev && ev.message) || (e && e.message) || '');
  return name === 'RuntimeError' || /\bRuntimeError\b/.test(msg);
}

/**
 * getWindow(): SolidCraft's window (or null while there is none); reload(): start loading it again; isReady(): Promise<boolean>, true once the new one answers.
 * Returns { inspect, execute, request } (upstream's API, each call guarded), `stops` (how many times the engine stopped) and `settled()` (no restart running).
 */
export function createCrashGuard({ getWindow, reload, isReady, pollMs = 100, readyTimeoutMs = 120000, onStop = null }) {
  const waiting = new Set(); // the reject functions of the calls in flight
  let restarting = null; // a Promise while SolidCraft is being loaded again
  const MARK = '__reshapeCrashWatch';
  const g = { stops: 0 };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function stopped(why) {
    g.stops++;
    const err = new Error(`SolidCraft's engine stopped while it was working (${why})`); err.engineStopped = true;
    for (const rej of [...waiting]) rej(err);
    waiting.clear();
    if (onStop) { try { onStop(err); } catch { /* a listener's fault is not the engine's */ } }
    if (restarting) return;
    restarting = (async () => {
      try {
        await reload();
        const t0 = Date.now();
        // the new window: not the one that stopped (its mark is gone with its document), there, and answering
        for (;;) {
          const w = getWindow();
          let ok = false;
          try { ok = !!w && !w[MARK] && !!w.solidcraft && (await isReady()) === true; } catch { ok = false; }
          if (ok) break;
          if (Date.now() - t0 > readyTimeoutMs) throw new Error('SolidCraft did not start again');
          await sleep(pollMs);
        }
      } finally { restarting = null; }
    })();
    restarting.catch(() => {}); // a call that waits for it gets the error; nobody else has to
  }

  /** listen on the window that is there now; a reloaded frame has a new window without the mark, so it is watched again */
  function watch() {
    const w = getWindow();
    if (!w || w[MARK] || !w.solidcraft) return w; // not before SolidCraft is in it: a frame's first, empty window is not the one to watch
    try {
      const on = (ev) => { if (isEngineStop(ev)) { const e = ev.error ?? ev.reason; stopped(String((e && e.message) || ev.message || 'RuntimeError')); } };
      w.addEventListener('error', on); w.addEventListener('unhandledrejection', on);
      w[MARK] = true;
    } catch { /* a window that cannot be watched is used unwatched, as before */ }
    return w;
  }

  const call = (name) => async (...args) => {
    if (restarting) await restarting;
    const w = watch();
    if (!w || !w.solidcraft) throw new Error('SolidCraft is not ready');
    return new Promise((resolve, reject) => {
      waiting.add(reject);
      let p;
      try { p = Promise.resolve(w.solidcraft[name](...args)); } catch (e) { waiting.delete(reject); reject(e); return; }
      p.then((v) => { waiting.delete(reject); resolve(v); }, (e) => { waiting.delete(reject); reject(e); });
    });
  };
  g.inspect = call('inspect'); g.execute = call('execute'); g.request = call('request');
  g.watch = watch;
  g.settled = async () => { while (restarting) { try { await restarting; } catch { /* reported to the caller that waited */ } } };
  return g;
}
