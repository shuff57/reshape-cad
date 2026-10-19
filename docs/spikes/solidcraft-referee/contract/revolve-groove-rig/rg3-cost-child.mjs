// One script through the guarded translator + solidcraft, truck only (no OCCT, no brep-rs), printing ONE json line: status, CPU ms, wall ms, the guard's cost features.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun rg3-cost-child.mjs --src='<script>' [--tr=g0] [--out=<file>]
import { writeFileSync } from 'node:fs';
import { init } from './rg3-lib.mjs';
const arg = (k, d = '') => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const L = await init({});
const src = arg('src');
const t0 = Date.now();
const r = await L.run(src, { trName: arg('tr', 'g0'), featuresOnly: !!arg('featuresOnly') });
const g = r.features?.filter((f) => f.kind === 'groove' || f.kind === 'revolve') ?? [];
const last = r.truck;
const out = {
  scriptErrors: r.scriptErrors ?? null,
  status: last?.status ?? null, refusal: last?.refusal ?? null,
  volume: last?.measure?.volume ?? null, faces: last?.measure?.faces ?? null, faceTypes: last?.measure?.faceTypes ?? null, bodies: last?.measure?.bodies?.length ?? null, bbox: last?.measure?.bbox ?? null,
  ms: r.ms ?? null, cpuMs: r.cpuMs ?? null, load: r.load ?? null, wallTotalMs: Date.now() - t0,
  cost: g.map((f) => f.guard?.cost ?? null).at(-1) ?? null, nudge: last?.guard?.nudgeDeg ?? null,
  chain: g.map((f) => `${f.id}:${f.status}`).join(','),
};
const line = JSON.stringify(out);
if (arg('out')) writeFileSync(arg('out'), line); else console.log(line);
