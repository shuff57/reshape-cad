// Write minimal reproducing command files for chosen WRONG cases (reads $FZ classified-* and cases-*).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const FZ = process.env.FZ || '/tmp/claude-1000/-home-shuff57-Documents-GitHub-reshape-cad/4f3bbcab-2729-4ac6-9404-5cdb8256b8df/scratchpad/fz';
const rj = (f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const dir = new URL('./repros/', import.meta.url).pathname; mkdirSync(dir, { recursive: true });
const pick = [[9, 'S1 vthru web=1.5 t=1'], [9, 'S1b two vthru gap=1.5 t=1'], [9, 'S2 blind top floor=1.5 t=1'], [9, 'S4 pocket top floor=1.5 t=1'], [9, 'S8 hhole g=1.5 bot t=1'], [9, 'S7 rim wall=2 t=1'], [1, 's1-00201'], [1, 's1-00038'], [1, 's1-00501'], [1, 's1-00031']];
for (const [seed, key] of pick) {
  const cases = rj(`${FZ}/cases-s${seed}.jsonl`); const c = cases.find((x) => x.desc === key || x.id === key); if (!c) { console.log('missing', key); continue; }
  const out = { id: c.id, seed, desc: c.desc, t: c.t, commands: [...c.cmds, c.shell], oracleFamily: c.family };
  for (const tag of ['p7', 'base']) { try { const r = rj(`${FZ}/classified-${tag}-s${seed}.jsonl`).find((x) => x.id === c.id); if (r) out[tag] = { cls: r.cls, expectedP: r.P, built: r.vol, rel: r.rel, sentence: r.sentence }; } catch {} }
  writeFileSync(`${dir}${c.id}.json`, JSON.stringify(out, null, 1)); console.log(c.id, c.desc, JSON.stringify(out.p7), JSON.stringify(out.base));
}
