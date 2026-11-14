// tally.mjs <run dir> [corpus...]: the verdicts of a sweep, and every row that is not a plain RIGHT (or REFUSED): known, or NEW.
//   known: listed in known.json with the same verdict and the same page-route volume (1e-6), or a curved wall by the rule below.
//   NEW:   anything else. Look at it before anything is said about it (README.md, "Reading the verdicts"). Exit code 1 when there is one.
// The curved-wall rule (the engine's cylinder and cone are not exactly round, and less so after a cut; PILOT-2.md): flagged WRONG, the part has a
// curved face, OCCT and brep-rs both built it and agree with each other on the volume (1e-6), the page route is within the volume tolerance of them
// (3e-4), and no coordinate of its box is more than BOX_MM from theirs. BOX_MM is twice the largest seen on the 14 such rows (1.3e-3 mm).
import fs from 'node:fs';
const BOX_MM = 2.6e-3, VOL_TOL = 3e-4;
const [DIR, ...ARGS] = process.argv.slice(2);
const CS = ARGS.length ? ARGS : fs.readdirSync(DIR).filter((f) => /^hr-.*\.jsonl$/.test(f)).map((f) => f.slice(3, -6));
const KNOWN = JSON.parse(fs.readFileSync(new URL('./known.json', import.meta.url), 'utf8')).rows;
const e = (x) => (x == null ? '-' : (+x).toExponential(1)); const tot = {}; const known = {}; const fresh = [];
export function curvedWall(f) {
  if (f.verdict !== 'WRONG' || !f.m?.curved || !f.occt || f.occt.refused || !f.brep || f.brep.refused) return null;
  if (Math.abs(f.occt.volume - f.brep.volume) > 1e-6 * Math.abs(f.occt.volume)) return null;
  if (!(Math.abs(f.m.volume - f.occt.volume) <= VOL_TOL * Math.abs(f.occt.volume))) return null;
  const mm = Math.max(...f.m.bbox.map((v, i) => Math.abs(v - f.occt.bbox[i])));
  return mm <= BOX_MM ? mm : null;
}
for (const c of CS) {
  const v = {};
  for (const l of fs.readFileSync(`${DIR}/hr-${c}.jsonl`, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(l); const f = r.final ?? {}; const k = r.hang ? 'HANG' : r.crashed ? 'CRASH' : f.verdict ?? '?';
    v[k] = (v[k] ?? 0) + 1; tot[k] = (tot[k] ?? 0) + 1;
    if (k === 'RIGHT' || k === 'REFUSED') continue;
    const mm = k === 'WRONG' ? curvedWall(f) : null;
    if (mm !== null) { known['a curved wall (by rule)'] = (known['a curved wall (by rule)'] ?? 0) + 1; continue; }
    const kn = KNOWN[`${c}:${r.id}`];
    if (kn && kn.verdict === k && (kn.volume == null || (f.m && Math.abs(f.m.volume - kn.volume) <= 1e-6 * Math.max(1, Math.abs(kn.volume))))) { known[kn.class] = (known[kn.class] ?? 0) + 1; continue; }
    const side = (o, s, ok) => (o?.refused ? 'refused' : o ? `${o.volume} dV ${e(s?.f?.dVol)} dBox ${e(s?.f?.dBbox)}${ok ? ' agrees' : ''}` : '-');
    fresh.push(`  NEW ${k.padEnd(20)} ${c}:${String(r.id).padEnd(30)} measure ${r.measureId} | page route ${f.m?.volume} | OCCT ${side(f.occt, f.sO, f.okO)} | brep-rs ${side(f.brep, f.sB, f.okB)}${f.analytic != null ? ` | closed form ${f.analytic}${f.an ? ' agrees' : ''}` : ''}${kn ? ` | listed as "${kn.class}" with verdict ${kn.verdict}, volume ${kn.volume}` : ''}`);
  }
  console.log(`${c}: ${JSON.stringify(v)}`);
}
console.log(`total: ${JSON.stringify(tot)}`);
console.log(`known: ${JSON.stringify(known)}`);
for (const o of fresh) console.log(o);
console.log(`NEW: ${fresh.length}`);
process.exitCode = fresh.length ? 1 : 0;
