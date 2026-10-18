// Runs INSIDE the sandboxed iframe (sandbox="allow-scripts", no allow-same-origin => opaque origin).
// The only thing it can do is evaluate a script with the reSHape interpreter and postMessage a ModelDoc back.
import { runScript } from '../../../../../../packages/script/dist/reshape-script.js';

window.addEventListener('message', (e) => {
  if (e.source !== window.parent) return;
  const d = e.data;
  if (!d || d.source !== 'reshape-run' || typeof d.code !== 'string' || typeof d.runId !== 'number') return;
  const r = runScript(d.code); // never throws
  window.parent.postMessage({
    source: 'reshape-result', runId: d.runId,
    errors: r.errors.map((x) => ({ message: String(x.message), line: x.line })),
    doc: r.errors.length ? null : r.doc,
  }, '*');
});
window.parent.postMessage({ source: 'reshape-runner-ready' }, '*');
