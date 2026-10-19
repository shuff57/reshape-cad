// SPIKE, referee only (round 4). Records the exact SolidCraft command JSON the translator sends for a primitive, plus the node-side reply and wall time,
// so the browser page (bench.html) replays the SAME call in a real browser, on the main thread and in a Web Worker.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun capture-cmds.mjs <out.json>
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const lib = await import(pathToFileURL(path.resolve(import.meta.dir, '..', '..', 'primitives-lib.mjs')).href);
const { createRequire } = await import('node:module');
const sc = createRequire(import.meta.url)(path.join(process.env.SOLIDCRAFT_REFEREE_PKG, 'solidcraft_referee.js'));
const { translateDoc } = await import(pathToFileURL(path.join(lib.REPO, 'docs/spikes/solidcraft-referee/phase0/translate.mjs')).href);
const cases = {
  box: 'box(40, 30, 12);',
  cylinder: 'cylinder(24, 30);',
  sphere: 'sphere(20);',
  cone: 'cone(20, 30);',
  prism: 'prism(7, 30, 12);',
  wedge: 'wedge(40, 30, 12);',
  'box-corner': 'box(40, 30, 12, { corner: 3 });',
  'cylinder-corner': 'cylinder(24, 30, { corner: 3 });',
  ring: 'ring(40, 10);',
  'ring-thin': 'ring(40, 0.8);',
  'sphere-big': 'sphere(50000);',
};
const out = {};
for (const [name, src] of Object.entries(cases)) {
  const r = lib.runScript(src); if (r.errors.length) throw new Error(src);
  const solved = lib.solveDoc(r.doc);
  const sent = []; let nodeMs = 0;
  const runSC = (cmds) => { const j = JSON.stringify({ commands: cmds }); const t0 = performance.now(); const reply = sc.run(j); nodeMs += performance.now() - t0; sent.push({ request: j, replyBytes: reply.length, ok: JSON.parse(reply).ok }); return JSON.parse(reply); };
  translateDoc(solved, { arc: lib.arc, mt: lib.mt, runSC, resolveAt: () => null });
  out[name] = { script: src, calls: sent, nodeMs: Math.round(nodeMs) };
  console.log(name.padEnd(16), 'calls', sent.length, 'node ms', Math.round(nodeMs), 'request bytes', sent.map((s) => s.request.length).join(','));
}
writeFileSync(path.resolve(process.argv[2]), JSON.stringify(out));
