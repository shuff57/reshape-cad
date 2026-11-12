// mkpre.mjs <G dir> <corpus> <out drop file>: per row, the steps the PAGE left out of its second translation (its own guards), read from the run's result
import fs from 'node:fs'; import path from 'node:path';
const [D, c, OUT] = process.argv.slice(2); const HOST = /^(G-STALE|SG-RULES-|HOST-PREFLIGHT-DEP|PILOT-NOT-YET)/; const drop = {};
for (const l of fs.readFileSync(path.join(D, `hr-${c}.jsonl`), 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); if (!r.feats) continue; const p = r.feats.filter((f) => HOST.test(f.guard ?? '')).map((f) => f.id); if (p.length) drop[r.id] = p; }
fs.writeFileSync(OUT, JSON.stringify(drop)); console.log(c, 'rows with a left-out step:', Object.keys(drop).length);
