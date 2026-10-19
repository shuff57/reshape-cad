// module worker: compile the wasm once, then run requests. Reports init time and per-call time measured INSIDE the worker.
import init, { run } from '/pkg/solidcraft_referee.js';
let ready = null;
self.onmessage = async (e) => {
  const { id, request } = e.data;
  if (!ready) { const t0 = performance.now(); ready = init({ module_or_path: '/pkg/solidcraft_referee_bg.wasm' }).then(() => performance.now() - t0); }
  const initMs = await ready;
  const t0 = performance.now();
  let reply; let err = null;
  try { reply = run(request); } catch (x) { err = String(x); }
  self.postMessage({ id, initMs, ms: performance.now() - t0, bytes: reply ? reply.length : 0, ok: reply ? JSON.parse(reply).ok : false, err });
};
