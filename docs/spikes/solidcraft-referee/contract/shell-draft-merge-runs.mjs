// Merge a partial runner output (--only/--group run) into shell-draft-runs.json, replacing rows with the same id.
//   bun shell-draft-merge-runs.mjs <path to shell-draft-runs.partial.json>
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const main = JSON.parse(readFileSync(path.join(HERE, 'shell-draft-runs.json'), 'utf8'));
const part = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const idx = new Map(main.rows.map((r, i) => [r.id, i]));
let replaced = 0, added = 0;
for (const r of part.rows) { if (idx.has(r.id)) { main.rows[idx.get(r.id)] = r; replaced++; } else { main.rows.push(r); added++; } }
writeFileSync(path.join(HERE, 'shell-draft-runs.json'), JSON.stringify(main, null, 1));
console.log(`replaced ${replaced}, added ${added}`);
