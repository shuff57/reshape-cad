// Spec for contract/primitives-sweep.mjs: every case of the committed primitives evidence (contract/primitives-evidence/{main,edge,far}.json,
// the contract `primitives` group's live cases), re-measured on another kernel. Each row keeps its truck record as `truck0` for the side-by-side.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const EV = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'contract', 'primitives-evidence');
const out = [];
for (const f of ['main.json', 'edge.json', 'far.json']) for (const r of JSON.parse(readFileSync(path.join(EV, f), 'utf8'))) {
  if (!r?.id || (r.script === undefined && !r.doc)) continue;
  out.push({ id: r.id, ...(r.script !== undefined ? { script: r.script } : { doc: r.doc }), measure: r.measure, note: `${f}` });
}
export default out;
