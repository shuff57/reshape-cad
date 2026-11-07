// Worker for live-surface-sketch.mjs: loads the kernel wasm once and runs one command list per message.
// TEST-ONLY: the layer names no kernel; this is the rig's referee wrapper (every command's output, then a measure).
import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import path from 'node:path';

const sc = createRequire(import.meta.url)(path.join(workerData.pkg, 'solidcraft_referee_p2.js'));
parentPort.on('message', (cmds) => {
  const t = Date.now();
  let reply;
  try { reply = { ok: true, r: JSON.parse(sc.run(JSON.stringify({ commands: cmds }))) }; } catch (e) { reply = { ok: false, error: `WASM TRAP: ${e.message}` }; }
  reply.ms = Date.now() - t;
  parentPort.postMessage(reply);
});
