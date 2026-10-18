// Minimise WRONG cases to a reproducing command list.  usage: node min.mjs --bin <cli> --ids id1,id2 [--seed 1] [--out repros]
// Plate cases: greedily drop features while the case stays WRONG (oracle recomputed, CLI re-run, one process at a time).
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { assemblePlate } from './gen.mjs';
import { oracle } from './oracle.mjs';
const FZ = process.env.FZ || '/tmp/claude-1000/-home-shuff57-Documents-GitHub-reshape-cad/4f3bbcab-2729-4ac6-9404-5cdb8256b8df/scratchpad/fz';
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const bin = arg('bin'), seed = +arg('seed', 1), ids = (arg('ids', '')).split(',').filter(Boolean), outDir = new URL('./' + arg('out', 'repros') + '/', import.meta.url).pathname;
const TOL = 1e-3; mkdirSync(outDir, { recursive: true });
const cases = new Map(readFileSync(`${FZ}/cases-s${seed}.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((c) => [c.id, c]));
const run = (cmds) => {
  const f = `${FZ}/scripts/min-tmp.json`; writeFileSync(f, JSON.stringify(cmds));
  const p = spawnSync('systemd-run', ['--user', '--collect', '--wait', '-P', '-q', '-p', 'MemoryMax=8G', '-p', 'MemorySwapMax=0', 'timeout', '60', bin, 'run', f], { encoding: 'utf8', maxBuffer: 1 << 26 });
  try { const j = JSON.parse(p.stdout); return { ok: true, vol: j.total.volume_mm3, bodies: j.body_count }; } catch { return { ok: false, err: (p.stderr || '').trim().split('\n').pop() }; }
};
const wrong = (cmds, shell, model) => {
  const o = oracle(model); const b = run(cmds); if (!b.ok || Math.abs(b.vol - o.S) / o.S > 1e-3) return null;
  const s = run([...cmds, shell]); if (!s.ok) return null; const rel = Math.abs(s.vol - o.P) / o.P;
  return rel > TOL ? { P: o.P, S: o.S, built: s.vol, rel } : null;
};
for (const id of ids) {
  const c = cases.get(id); if (!c) { console.log('no case', id); continue; }
  let best = { cmds: c.cmds, shell: c.shell, model: c.model }; let info = wrong(c.cmds, c.shell, c.model);
  if (!info) { console.log(id, 'not reproducible as WRONG'); continue; }
  if (c.family === 'plate') {
    let parts = c.parts.slice(); let changed = true;
    while (changed && parts.length) { changed = false; for (let k = 0; k < parts.length; k++) {
      const np = parts.filter((_, j) => j !== k); const a = assemblePlate(c.base, np); if (!a) continue;
      const w = wrong(a.cmds, a.shell, a.model); if (w) { parts = np; best = a; info = w; changed = true; break; }
    } }
  }
  const file = `${outDir}${id}.json`;
  writeFileSync(file, JSON.stringify({ id, desc: c.desc, t: c.t, expectedP: info.P, unshelledS: info.S, built: info.built, rel: info.rel, commands: [...best.cmds, best.shell] }, null, 1));
  console.log(id, 'minimal', best.cmds.length + 1, 'cmds', 'P', info.P.toFixed(3), 'built', info.built.toFixed(3), 'rel', info.rel.toExponential(2));
}
