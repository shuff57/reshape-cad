// Tight web sweep for a single through hole, with an independent 2-D integral as the closed form.
//   node tight.mjs gen      -> $FZ/cases-s8.jsonl     node tight.mjs report -> compares CLI results (tag p7/base) with closed form and oracle
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { assemblePlate, cutCyl } from './gen.mjs';
import { oracle } from './oracle.mjs';
const FZ = process.env.FZ || '/tmp/claude-1000/-home-shuff57-Documents-GitHub-reshape-cad/4f3bbcab-2729-4ac6-9404-5cdb8256b8df/scratchpad/fz';
const PI = Math.PI;
function closed(W, D, H, t, hole) { // single vertical through hole, top open: exact 2-D integrals
  const [cx, cy, r] = hole; const R = r + t; const W2 = W / 2, D2 = D / 2; const n = 20000;
  const area = (xa, xb, ya, yb, rad) => { let A = 0; const dx = (xb - xa) / n; for (let i = 0; i < n; i++) { const x = xa + (i + 0.5) * dx; const d = rad * rad - (x - cx) ** 2; if (d > 0) { const s = Math.sqrt(d); A += Math.max(0, Math.min(yb, cy + s) - Math.max(ya, cy - s)) * dx; } } return A; };
  const S = (W * D - area(-W2, W2, -D2, D2, r)) * H; const C = ((W - 2 * t) * (D - 2 * t) - area(-W2 + t, W2 - t, -D2 + t, D2 - t, R)) * (H - t);
  return S - C;
}
const plates = [[40, 30], [11.9, 11.8]];
if (process.argv[2] === 'gen') {
  const out = []; let n = 0;
  for (const [W, D] of plates) for (const t of [1, 0.5]) for (const e of [-0.1, 0, 0.02, 0.05, 0.1, 0.2, 0.5, 1]) {
    const web = 2 * t + e, r = 2; const H = 10; const xc = -W / 2 + web + r, yc = 0;
    const part = { kind: 'vthru', cmds: cutCyl('f1', 'z', [xc, yc], r, [-1, H + 1]), holes: [{ type: 'cyl', axis: 'z', c: [xc, yc], r, range: [-1, H + 1] }], avoid: [{ face: 'top', circ: [xc, yc, r + 0.3] }] };
    const base = { W, D, H, t, open: 'top' }; const a = assemblePlate(base, [part]);
    out.push({ id: `tw-${String(n++).padStart(3, '0')}`, family: 'plate', t, cmds: a.cmds, shell: a.shell, model: a.model, base, parts: [part], desc: `tight web ${W}x${D} t=${t} web=2t${e >= 0 ? '+' : ''}${e}`, meta: { W, D, H, open: 'top', feats: [{ kind: 'vthru', r, xc, yc }], gaps: { gl: web, gr: 99, between: [], gy1: 99, gy2: 99 } }, tight: { W, D, H, hole: [xc, yc, r] } });
  }
  writeFileSync(`${FZ}/cases-s8.jsonl`, out.map((c) => JSON.stringify(c)).join('\n') + '\n'); console.log(out.length);
} else {
  const cases = readFileSync(`${FZ}/cases-s8.jsonl`, 'utf8').trim().split('\n').map(JSON.parse);
  const res = {}; for (const tag of ['p7', 'base', 'p8']) { const f = `${FZ}/cli-${tag}-s8.jsonl`; if (existsSync(f)) res[tag] = new Map(readFileSync(f, 'utf8').trim().split('\n').map(JSON.parse).map((r) => [r.id, r])); }
  const rows = [];
  for (const c of cases) {
    const cf = closed(c.tight.W, c.tight.D, c.tight.H, c.t, c.tight.hole); const o = oracle(c.model).P;
    const row = { desc: c.desc, closedForm2D: cf, oracle: o, oracleVsClosed: (o - cf) / cf };
    for (const tag of Object.keys(res)) { const r = res[tag].get(c.id)?.shell; row[tag] = r ? (r.status === 'ok' ? { vol: r.vol, relVsClosed: (r.vol - cf) / cf } : { status: r.status, error: (r.error || '').slice(0, 90) }) : null; }
    rows.push(row); console.log(row.desc.padEnd(42), cf.toFixed(3), 'oracle', o.toFixed(3), ...Object.keys(res).map((t) => `${t}:` + (row[t] ? (row[t].vol !== undefined ? row[t].vol.toFixed(3) + ` (${row[t].relVsClosed.toExponential(1)})` : row[t].status + ' ' + row[t].error) : '-')));
  }
  writeFileSync(new URL('./tight-web.json', import.meta.url), JSON.stringify(rows, null, 1));
}
