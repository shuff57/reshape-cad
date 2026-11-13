// Runs INSIDE the sandboxed iframe (sandbox="allow-scripts", no allow-same-origin => opaque origin).
// The only thing it can do is evaluate a script with the reSHape interpreter and postMessage a ModelDoc back.
// PHASE 5: the friendly sketch shim (../../friendly-sketch.mjs) is bundled here, next to the interpreter, and the script is
// prefixed with ONE line (no newline: script line numbers are unchanged) that shadows sketch() with the shim's wrapper.
import { runScript } from '../../../script/dist/reshape-script.js';
import { install, withPreamble } from '../lib/friendly-sketch.mjs';

install(globalThis);

window.addEventListener('message', (e) => {
  if (e.source !== window.parent) return;
  const d = e.data;
  if (!d || d.source !== 'reshape-run' || typeof d.code !== 'string' || typeof d.runId !== 'number') return;
  const r = runScript(withPreamble(d.code)); // never throws
  window.parent.postMessage({
    source: 'reshape-result', runId: d.runId,
    errors: r.errors.map((x) => ({ message: String(x.message), line: x.line })),
    doc: r.errors.length ? null : r.doc,
    // the interpreter's warnings (a round cut down to fit, a rule left fighting), verbatim, and its record of every rule call (the host's legacy rule guard
    // replays what was WRITTEN from it, docs/spikes/solidcraft-referee/GUARD-SD5-DOF1.md)
    warnings: (r.warnings ?? []).map(String),
    ruleLog: r.errors.length ? [] : (r.ruleLog ?? []),
    // the shapes that had no at: and were placed beside an earlier one (RunResult.placed), for the page's note on where a shape went
    placed: r.errors.length ? [] : (r.placed ?? []),
  }, '*');
});
window.parent.postMessage({ source: 'reshape-runner-ready' }, '*');
