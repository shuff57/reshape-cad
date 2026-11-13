// tally.mjs <run dir> [corpus...]: the verdicts of a sweep, and every row that is not a plain RIGHT (or REFUSED) with the numbers that decide it.
// How to read a row that is not RIGHT is in README.md: most are one of a few known kinds, and a volume worked out by hand settles the rest.
import fs from 'node:fs';
const [DIR, ...ARGS] = process.argv.slice(2);
const CS = ARGS.length ? ARGS : fs.readdirSync(DIR).filter((f) => /^hr-.*\.jsonl$/.test(f)).map((f) => f.slice(3, -6));
const e = (x) => (x == null ? '-' : (+x).toExponential(1)); const tot = {};
for (const c of CS) {
  const v = {}; const odd = [];
  for (const l of fs.readFileSync(`${DIR}/hr-${c}.jsonl`, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(l); const f = r.final ?? {}; const k = r.hang ? 'HANG' : r.crashed ? 'CRASH' : f.verdict ?? '?';
    v[k] = (v[k] ?? 0) + 1; tot[k] = (tot[k] ?? 0) + 1;
    if (k === 'RIGHT' || k === 'REFUSED') continue;
    const side = (o, s, ok) => (o?.refused ? 'refused' : o ? `${o.volume} dV ${e(s?.f?.dVol)} dBox ${e(s?.f?.dBbox)}${ok ? ' agrees' : ''}` : '-');
    odd.push(`  ${k.padEnd(20)} ${String(r.id).padEnd(34)} measure ${r.measureId} | page route ${f.m?.volume} | OCCT ${side(f.occt, f.sO, f.okO)} | brep-rs ${side(f.brep, f.sB, f.okB)}${f.analytic != null ? ` | closed form ${f.analytic}${f.an ? ' agrees' : ''}` : ''}`);
  }
  console.log(`${c}: ${JSON.stringify(v)}`); for (const o of odd) console.log(o);
}
console.log(`total: ${JSON.stringify(tot)}`);
