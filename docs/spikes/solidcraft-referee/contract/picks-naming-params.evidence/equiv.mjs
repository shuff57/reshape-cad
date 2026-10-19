// native solidcraft-cli (used for topology only) vs wasm rig (used for every score): same command lists, compare volumes.
import * as L from './lib.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
let n = 0, bad = 0, worst = 0; const rows = [];
for (const f of ['resA','resB','resC1','resC2','resD','resE','resK','resL','resM']) {
  const d = JSON.parse(readFileSync(f + '.json', 'utf8'));
  for (const r of d) {
    if (!r.commands || !r.commands.length) continue;
    const w = L.runSC(r.commands);
    if (!w.ok) continue;
    const file = `tmp/eq-${n}.json`; writeFileSync(file, JSON.stringify({ commands: [...r.commands, { command: 'inspect.measure', params: {} }] }));
    let c; try { c = JSON.parse(execFileSync(L.CLI, ['run', file, '--results', '--quiet', '--allow-errors'], { encoding: 'utf8', maxBuffer: 1 << 28 })); } catch (e) { rows.push({ f, label: r.label, cliError: String(e.message).slice(0, 100) }); bad++; n++; continue; }
    const m = c[c.length - 1];
    const vw = w.measure.bodies.map(b => b.volume_mm3).sort((a, b) => a - b), vc = (m.bodies ?? []).map(b => b.volume_mm3).sort((a, b) => a - b);
    const dv = vw.length === vc.length ? Math.max(0, ...vw.map((v, i) => Math.abs(v - vc[i]) / Math.max(1, Math.abs(v)))) : Infinity;
    worst = Math.max(worst, dv); if (!(dv <= 1e-9)) { bad++; rows.push({ f, label: r.label, vw, vc, dv }); }
    n++;
  }
}
console.log(JSON.stringify({ compared: n, differing: bad, worstRelVolumeDiff: worst, rows: rows.slice(0, 10) }));
writeFileSync('resEquiv.json', JSON.stringify({ compared: n, differing: bad, worstRelVolumeDiff: worst, rows }, null, 1));
