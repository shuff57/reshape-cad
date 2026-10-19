// CANDIDATE GUARDS, evaluated on the recorded runs (no kernel is run here). A guard is a rule the product layer could apply BEFORE or AFTER the build.
//   G1 face-count (post-build): a blend of ONE straight edge between two planar faces must ADD exactly one face. A chamfer/fillet that is larger than the
//      face it cuts into removes a face, so faces_after = faces_before (or less).
//   G2 extent (pre-build, boxes only): refuse a chamfer/fillet whose size >= the smaller of the two face extents measured perpendicular to the edge.
//   G3 radius-ratio (pre-build): refuse a fillet that follows a fillet on an ADJACENT edge when 1 < r2/r1 < 2.
import { readFileSync } from 'node:fs';
const J = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
const AX = { top: 2, bottom: 2, front: 1, back: 1, left: 0, right: 0 };
const out = {};
// G1 + G2 on the 200 single-edge fuzz cases
{
  const rows = J('./fuzz-single.json').rows;
  const t = { built: 0, truckBuiltOracleRefused: 0, g1_flags_wrong: 0, g1_flags_match: 0, g2_flags_wrong: 0, g2_flags_match: 0, match: 0 };
  const missed = [];
  for (const r of rows) {
    if (!r.truck || r.truck.refused) continue;
    t.built++;
    const wrong = r.outcome === 'WRONG-UNREFUSED'; const match = r.outcome === 'match';
    const g1 = r.truck.faces !== 7; // box has 6 faces, one blended edge must give 7
    const [a, b] = r.edge; const along = 3 - AX[a] - AX[b];
    const small = Math.min(...[0, 1, 2].filter((k) => k !== along).map((k) => r.D[k]));
    const g2 = r.size >= small - 1e-9;
    if (wrong) { t.truckBuiltOracleRefused++; if (g1) t.g1_flags_wrong++; else missed.push(['G1', r.script]); if (g2) t.g2_flags_wrong++; else missed.push(['G2', r.script]); }
    if (match) { t.match++; if (g1) t.g1_flags_match++; if (g2) t.g2_flags_match++; }
  }
  out.singleEdgeFuzz = { n: rows.length, ...t, missed };
}
// G1 on the oversize pairs (box 40x30x20 / plate / cylinder): expected faces = base + 2
{
  const R = J('./res-r2.json'); const rec = [];
  for (const r of R) {
    if (!/^ov-(c|f)-pair/.test(r.id) || !r.fx?.truck?.faces) continue;
    const cyl = /cyl/.test(r.id); const base = cyl ? 3 : 6; const expect = base + 2;
    rec.push({ id: r.id, faces: r.fx.truck.faces, expect, wrong: r.expect === 'refuse', g1Flags: r.fx.truck.faces !== expect });
  }
  out.pairs = { n: rec.length, rec };
}
// G3 on the sequential fillet grid + pair fuzz
{
  const bins = {};
  const add = (k, tag) => { bins[k] ??= {}; bins[k][tag] = (bins[k][tag] ?? 0) + 1; };
  const bin = (x) => (x < 1 - 1e-9 ? 'b<a' : Math.abs(x - 1) < 1e-9 ? 'b=a' : x < 2 ? '1<b/a<2' : 'b/a>=2');
  for (const r of J('./res-seq.json')) {
    const a = +r.id.match(/-a(\d+)-/)[1]; const b = +r.id.match(/-b(\d+)$/)[1]; const t = r.fx.truck?.volume; const cf = r.closed; const o = r.fx.occt.volume;
    const tag = t === undefined ? 'refused' : t > 12000 ? 'ADDED-MATERIAL' : Math.abs(t - cf) / cf < 5e-5 ? 'literal' : Math.abs(t - o) / o < 5e-5 ? 'occt-chain' : 'NEITHER';
    add('grid ' + bin(b / a), tag);
  }
  for (const r of J('./fuzz-pair.json').rows) if (r.A.kind === 'f' && r.B.kind === 'f') add('fuzz ' + bin(r.B.sz / r.A.sz), r.truck.volume === undefined ? 'refused' : r.outcome);
  out.ratioBins = bins;
}
console.log(JSON.stringify(out, null, 1));
