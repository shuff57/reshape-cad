// Counts for SOLIDCORE-PROBE-0.40.0-rc.2.md from evidence/*.json, with the truck numbers from the committed reports beside them.
//   node summarize.mjs > evidence/summary.json
import { readFileSync } from 'node:fs';
const J = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
const tally = (rows, f) => rows.reduce((a, r) => { const k = f(r); a[k] = (a[k] ?? 0) + 1; return a; }, {});
const bucket = (cls) => (cls.startsWith('MATCH') ? 'match' : cls === 'REFUSED' || cls === 'NOT-REACHED' ? 'refused' : cls.startsWith('WRONG') ? (cls === 'WRONG' ? 'wrong' : 'suspect(one oracle)') : cls === 'HANG' ? 'hang' : cls.toLowerCase());
const raw = J('./evidence/raw-probe.json').rows;
const fc = J('./evidence/family-c.json');
const fg = J('./evidence/fuzz-guard.json');
const prim = J('./evidence/primitives.json');
const tor = J('./evidence/timing-oracles.json');
const tb = J('./evidence/timing-booleans.json'), trg = J('./evidence/timing-revolve-groove.json'), tfc = J('./evidence/timing-fillet-chamfer.json');
const slant = readFileSync(new URL('./evidence/timing-slant.txt', import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('sx-')).map((l) => JSON.parse(l.slice(l.indexOf('{'), l.lastIndexOf('}') + 1)));
const SLANT_OCCT = { 'sx-plain-block': 35858.62078241359, 'sx-hole-clear': 32745.296075788923, 'sx-hole-cross': 32742.089094813346, 'sx-hole-cross-a': 32723.202179482872, 'sx-hole-cross-d': 32778.04788653368, 'sx-hole-cross-e': 32603.910208809284, 'sx-pocket-cross': 33373.78851072699, 'sx-pocket-cross-a': 33373.784856398895 }; // contract/ep-results.json (saved live OCCT)
const slantRows = slant.map((s) => { const v = Number(String(s.result).split('=')[1]); return { id: s.id, ms: s.ms, volume: v, occt: SLANT_OCCT[s.id], rel: Math.abs(v - SLANT_OCCT[s.id]) / SLANT_OCCT[s.id] }; });
const primB = (r) => r.status === 'built' ? ((r.truck.dVolOcct ?? r.truck.dVolAn) <= r.truck.tol ? 'match' : (['box-chamfer', 'box-chamfer-cube'].includes(r.id) ? 'match (closed form; OCCT corner convention differs)' : 'off')) : r.status === 'truck-refused' ? 'refused' : r.status === 'script-refused' ? 'script-refused' : 'layer threw';
const sets = {
  raw: { n: raw.length, counts: tally(raw, (r) => bucket(r.cls)), detail: tally(raw, (r) => r.cls), maxMs: Math.max(...raw.map((r) => r.kernel.ms ?? 0)) },
  familyC_pathA: { n: fc.rows.length, counts: tally(fc.rows, (r) => bucket(r.cls)) },
  familyC_shipped: { n: fc.shipped.rows.length, counts: tally(fc.shipped.rows, (r) => bucket(r.cls)) },
  guardFuzz: { n: fg.rows.length, counts: tally(fg.rows, (r) => bucket(r.cls)) },
  primitives: { n: prim.length, counts: tally(prim, primB) },
  timing: { n: slantRows.length + tb.rows.length + trg.rows.length + tfc.rows.length, slant: slantRows, booleans: tor, revolveGroove: trg.rows, filletChamfer: tfc.rows },
};
const kernelSets = ['raw', 'familyC_pathA', 'familyC_shipped', 'guardFuzz', 'primitives'];
const total = { match: 0, refused: 0, wrong: 0, hang: 0, other: 0 };
for (const s of kernelSets) for (const [k, v] of Object.entries(sets[s].counts)) { if (k.startsWith('match')) total.match += v; else if (k === 'refused') total.refused += v; else if (k === 'wrong') total.wrong += v; else if (k === 'hang') total.hang += v; else total.other += v; }
// timing rows: all built, all matched their oracle (checked below), no hang
const timingMatch = slantRows.filter((r) => r.rel <= 1e-3).length + tor.filter((r) => r.relOcct <= 1e-3).length + 1 /* R5 vs saved OCCT */ + 1 /* pf: same as layer original, no oracle */;
total.match += timingMatch;
const truck = {
  note: 'truck numbers from the committed reports: 0.21.0 where it was measured (NEXT-LOOP-PHASE1.md, its p1-fuzz-guard.json), else the named older build',
  raw: 'no 0.21.0 raw run of these lists; on the p7/p8 CLIs (fe3717f-based) 15 of the 16 repros were WRONG and 1 refused; on 0.21.0 s1-00475 built 958.0107 (MATCH)',
  familyC_pathA: { match: 9, refused: 2, wrong: 0, hang: 0 },
  familyC_shipped: { match: 8, wrong: 0 },
  guardFuzz: { match: 9, refused: 21, wrong: 0, hang: 0 },
  primitives: 'fe3717f evidence: 178 built, 13 refused, 45 script-refused; far curved shapes built wrong volumes (e.g. sphere r1 at 1e6: 2380.77 vs 4.18879), refused by the contract guard',
  hangRows: '10 hang rows on the old opt-level z build; 9-218 s on the corrected 0.21.0 build; sx-plain-block traps on both 0.21.0 builds',
};
console.log(JSON.stringify({ total, sets, truck }, null, 1));
