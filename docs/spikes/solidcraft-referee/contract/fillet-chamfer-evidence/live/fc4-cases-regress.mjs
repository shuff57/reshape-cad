// ROUND 4 regression set: every case the earlier rounds ran through the shipping pane (browser-results*.json, 376 distinct ids, 346 without a script error). The pane number is the
// RECORDED one (fc-live-check.mjs shows the live pane reproduces the record), so each case costs one contract run (+ one unguarded grouped run when the contract refused something)
// and the oracles. Use with --fast.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const EVD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seen = new Map();
for (const f of readdirSync(EVD).filter((x) => /^browser-results.*\.json$/.test(x)).sort()) for (const r of JSON.parse(readFileSync(path.join(EVD, f), 'utf8'))) seen.set(r.id, r);
export const CASES = [];
for (const r of seen.values()) {
  if (r.error || !r.script || r.volume == null) continue;
  const rec = { volume: r.volume, faces: r.faces, features: r.features ?? [], bodies: [] };
  const c = { id: `rg-${r.id}`, group: 'regress', paneRecorded: rec };
  if (r.script.startsWith('[')) c.doc = JSON.parse(r.script); else c.script = r.script;
  CASES.push(c);
}
