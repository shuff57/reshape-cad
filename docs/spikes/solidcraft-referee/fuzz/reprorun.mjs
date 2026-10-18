// Run every repros/*.json on a CLI (one at a time, systemd-run caps) and compare with the recorded expected P.  usage: node reprorun.mjs <cli> <tag>
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const dir = new URL('./repros/', import.meta.url).pathname; const [bin, tag] = process.argv.slice(2); const rows = [];
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && !x.includes('.result')).sort()) {
  const j = JSON.parse(readFileSync(dir + f, 'utf8')); const tmp = `/tmp/claude-1000/-home-shuff57-Documents-GitHub-reshape-cad/4f3bbcab-2729-4ac6-9404-5cdb8256b8df/scratchpad/fz/scripts/repro-${j.id}.json`; writeFileSync(tmp, JSON.stringify(j.commands));
  const p = spawnSync('systemd-run', ['--user', '--collect', '--wait', '-P', '-q', '-p', 'MemoryMax=8G', '-p', 'MemorySwapMax=0', 'timeout', '60', bin, 'run', tmp], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const P = j.p7?.expectedP ?? j.base?.expectedP; let row = { id: j.id, desc: j.desc, expectedP: P };
  try { const o = JSON.parse(p.stdout); row.built = o.total.volume_mm3; row.rel = Math.abs(row.built - P) / P; row.cls = row.rel <= 1e-3 ? 'MATCH' : 'WRONG'; } catch { row.cls = p.status === 124 ? 'TIMEOUT' : 'REFUSED'; row.sentence = (p.stderr || '').split('\n').filter((l) => /error/.test(l)).pop()?.replace(/^error:\s*/, '').slice(0, 200); }
  rows.push(row); console.log(row.id, row.cls, row.desc.slice(0, 40), row.rel?.toExponential(1) ?? '', row.sentence ?? '');
}
writeFileSync(new URL(`./repros-result-${tag}.json`, import.meta.url), JSON.stringify(rows, null, 1));
