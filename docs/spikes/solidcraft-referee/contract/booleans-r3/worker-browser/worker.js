import init, { run } from './solidcraft_referee.js';
const ready = init();
self.onmessage = async (e) => {
  await ready;
  const t0 = performance.now();
  try { const r = JSON.parse(run(JSON.stringify({ commands: e.data.cmds }))); self.postMessage({ id: e.data.id, ok: true, kernelOk: r.ok, ms: performance.now() - t0, volumes: r.ok ? r.measure.bodies.map((b) => b.volume_mm3) : null }); }
  catch (err) { self.postMessage({ id: e.data.id, ok: false, trap: String(err.message).slice(0, 120), ms: performance.now() - t0 }); }
};
ready.then(() => self.postMessage({ ready: true }));
