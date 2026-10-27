// Dedicated Worker: one probe per worker. Receives { module, commands }, replays the commands on a scratch session of the pinned engine,
// answers { phase:'done', reply, cpuMs, loadMs } or { phase:'error', error }. The parent terminates the worker when the budget runs out; a
// synchronous wasm call cannot be interrupted any other way.
import { instantiateKernel } from './probe-kernel.mjs';
self.onmessage = (ev) => {
  const { module, commands } = ev.data;
  try {
    const t0 = performance.now();
    const k = instantiateKernel(module);
    const t1 = performance.now();
    const reply = k.run(commands);
    const t2 = performance.now();
    self.postMessage({ phase: 'done', reply, cpuMs: Math.round(t2 - t1), loadMs: Math.round(t1 - t0) });
  } catch (e) {
    self.postMessage({ phase: 'error', error: String((e && e.message) || e) });
  }
};
