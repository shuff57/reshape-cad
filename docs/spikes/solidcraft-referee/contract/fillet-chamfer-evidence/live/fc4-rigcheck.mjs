// SPIKE, referee only. Same kernel? The pair fuzz and the sequential-limit runs use the RIG wasm (node, sc-referee-pkg = solidcraft fe3717f), the live cases use the PANE wasm (fe3717f + the phase 7 bridge / sketch-solver /
// shell patches). This runs 24 raw command lists (single and sequential blends, fillets and chamfers, planar and curved) through both and compares volume and face count.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> FC_SESSION=<name> bun live/fc4-rigcheck.mjs
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSC } from './fc-oracle.mjs';
import { openPage, execCmds } from './fc-live.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const box = (w, d, h) => ({ command: 'solid.box', params: { length: w, width: d, height: h, center: [0, 0, 0], body_name: 'b' } });
const f = (pt, r) => ({ command: 'solid.fillet', params: { edges: [pt], radius: r, body: 'b' } });
const c = (pt, r) => ({ command: 'solid.chamfer', params: { edges: [pt], distance: r, body: 'b' } });
const lists = [];
const dims = [[40, 30, 10], [37, 23, 32], [48, 14, 20], [22, 22, 22]];
for (const [w, d, h] of dims) {
  const tf = [0, -d / 2, h / 2]; const tr = [w / 2, 0, h / 2]; const vr = [w / 2, -d / 2, 0];
  lists.push({ id: `${w}x${d}x${h} fillet1`, cmds: [box(w, d, h), f(tf, 2)] });
  lists.push({ id: `${w}x${d}x${h} chamfer1`, cmds: [box(w, d, h), c(tf, 2)] });
  lists.push({ id: `${w}x${d}x${h} fillet 2 then 2 touching`, cmds: [box(w, d, h), f(tf, 2), f(tr, 2)] });
  lists.push({ id: `${w}x${d}x${h} chamfer 3 then 5 touching`, cmds: [box(w, d, h), c(tf, 3), c(tr, 5)] });
  lists.push({ id: `${w}x${d}x${h} fillet 3 then 5 touching`, cmds: [box(w, d, h), f(tf, 3), f(tr, 5)] });
  lists.push({ id: `${w}x${d}x${h} one call two edges`, cmds: [box(w, d, h), { command: 'solid.fillet', params: { edges: [tf, tr], radius: 2, body: 'b' } }] });
}
await openPage();
const out = []; let worst = 0; let bad = 0;
for (const L of lists) {
  const a = runSC(L.cmds); const b = execCmds(L.cmds);
  const va = a.ok ? a.measure.bodies[0].volume_mm3 : null; const vb = b.ok ? b.measure.bodies[0].volume_mm3 : null;
  const fa = a.ok ? a.measure.bodies[0].faces : null; const fb = b.ok ? b.measure.bodies[0].faces : null;
  const same = (va == null && vb == null) || (va != null && vb != null && Math.abs(va - vb) <= 1e-9 * Math.max(1, va) && fa === fb);
  if (va != null && vb != null) worst = Math.max(worst, Math.abs(va - vb) / Math.max(1, va));
  if (!same) bad++;
  out.push({ id: L.id, rig: { volume: va, faces: fa, refused: a.ok ? null : a.failed?.error }, pane: { volume: vb, faces: fb, refused: b.ok ? null : b.failed?.error }, same });
  console.log(L.id.padEnd(40), 'rig', va?.toFixed?.(6) ?? 'REFUSED', fa ?? '', '| pane', vb?.toFixed?.(6) ?? 'REFUSED', fb ?? '', same ? '' : '  <-- DIFFERENT');
}
writeFileSync(path.resolve(HERE, '../fc4-results-rigcheck.json'), JSON.stringify({ n: out.length, different: bad, worstRelativeVolumeDifference: worst, rows: out }, null, 1));
console.log(`compared ${out.length}: different ${bad}, worst relative volume difference ${worst}`);
