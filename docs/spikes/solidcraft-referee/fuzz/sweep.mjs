// Targeted one-feature sweeps around the thresholds t, 2t, 2t+-eps, written in the same case format as gen.mjs (seed 9).
//   node sweep.mjs   -> $FZ/cases-s9.jsonl ; then run.mjs oracle|cli --seed 9 ; report.mjs --seed 9
import { writeFileSync } from 'node:fs';
import { assemblePlate, cutCyl, cutBox, addBox, cylCmd, boxCmd, comb } from './gen.mjs';
const FZ = process.env.FZ || '/tmp/claude-1000/-home-shuff57-Documents-GitHub-reshape-cad/4f3bbcab-2729-4ac6-9404-5cdb8256b8df/scratchpad/fz';
const q = (x) => Math.round(x * 20) / 20;
const W = 40, D = 30, H = 10, W2 = W / 2, D2 = D / 2; const out = []; let n = 0;
const BIG = 99;
const add = (name, t, part, feat, gaps = {}, open = 'top') => {
  const base = { W, D, H, t, open }; const asm = assemblePlate(base, [part]); if (!asm) { console.error('pick failed', name); return; }
  out.push({ id: `sw-${String(n++).padStart(4, '0')}`, family: 'plate', t, seed: 9, cmds: asm.cmds, shell: asm.shell, model: asm.model, base, parts: [part], desc: name,
    meta: { W, D, H, open, feats: [feat], gaps: { gl: BIG, gr: BIG, between: [], gy1: BIG, gy2: BIG, ...gaps } } });
};
const ts = [0.5, 1, 2.5];
const rel = (t) => [0.5 * t, 0.75 * t, t - 0.05, t, t + 0.05, 1.5 * t, 2 * t - 0.1, 2 * t, 2 * t + 0.05, 2 * t + 0.1, 2 * t + 0.25, 2.5 * t, 3 * t].map(q).filter((v) => v > 0.1);
const avoidBoth = (xc, yc, r) => [{ face: 'top', circ: [xc, yc, r + 0.3] }, { face: 'bot', circ: [xc, yc, r + 0.3] }];
const rng = (H, d, face) => (face === 'top' ? [q(H - d), H + 1] : [-1, q(d)]);
for (const t of ts) {
  // S1: through hole near the -x wall: web (hole wall to plate edge) sweep
  for (const web of rel(t)) { const r = 2, xc = q(-W2 + web + r), yc = 0;
    add(`S1 vthru web=${web} t=${t}`, t, { kind: 'vthru', cmds: cutCyl('f1', 'z', [xc, yc], r, [-1, H + 1]), holes: [{ type: 'cyl', axis: 'z', c: [xc, yc], r, range: [-1, H + 1] }], avoid: avoidBoth(xc, yc, r) }, { kind: 'vthru', r, xc, yc }, { gl: web }); }
  // S1b: through hole in a narrow plate region: two holes with mutual gap
  for (const g of rel(t)) { const r = 2; const x1 = -g / 2 - r, x2 = g / 2 + r;
    const mkp = (xc, n) => ({ cmds: cutCyl(n, 'z', [xc, 0], r, [-1, H + 1]), holes: [{ type: 'cyl', axis: 'z', c: [xc, 0], r, range: [-1, H + 1] }], avoid: avoidBoth(xc, 0, r) });
    const a = mkp(q(x1), 'f1'), b = mkp(q(x2), 'f2'); const part = { kind: 'vthru', cmds: [...a.cmds, ...b.cmds], holes: [...a.holes, ...b.holes], avoid: [...a.avoid, ...b.avoid] };
    add(`S1b two vthru gap=${g} t=${t}`, t, part, { kind: 'vthru', r, xc: 0, yc: 0 }, { between: [g] }); }
  for (const face of ['top', 'bot']) for (const f of rel(t)) { const d = q(H - f); if (d < 0.3) continue;
    // S2/S3 blind hole: floor f of material left under (top) / above (bot) the hole
    const r = 2, xc = 0, yc = 0;
    add(`S2 blind ${face} floor=${f} t=${t}`, t, { kind: 'blind', cmds: cutCyl('f1', 'z', [xc, yc], r, rng(H, d, face)), holes: [{ type: 'cyl', axis: 'z', c: [xc, yc], r, range: rng(H, d, face) }], avoid: avoidBoth(xc, yc, r) }, { kind: 'blind', r, d, face, floor: f, xc, yc });
    // S4 pocket (rect) with floor f
    const pw = 8, pd = 6; const bx = face === 'top' ? [-pw / 2, pw / 2, -pd / 2, pd / 2, q(H - d), H + 1] : [-pw / 2, pw / 2, -pd / 2, pd / 2, -1, d]; const bm = face === 'top' ? [bx[0], bx[1], bx[2], bx[3], q(H - d), H] : [bx[0], bx[1], bx[2], bx[3], 0, d];
    add(`S4 pocket ${face} floor=${f} t=${t}`, t, { kind: 'pocket', cmds: cutBox('f1', bx), cuts: [bm], [face === 'top' ? 'minusTop' : 'minusBot']: [[bx[0], bx[1], bx[2], bx[3]]], avoid: [] }, { kind: 'pocket', pw, pd, d, face, floor: f }); }
  // S5 countersinks: dep and straight length
  for (const face of ['top', 'bot']) for (const dep of [t, 2 * t, 3 * t, 4 * t].map(q)) for (const st of [0.5 * t, t, 1.5 * t, 2 * t, 2 * t + 0.1, 3 * t].map(q)) {
    const Hh = q(dep + st); if (Hh < 3 * t) continue; // the plate height is fixed (10): choose dep+straight == H only
    if (Math.abs(Hh - H) > 1e-9) continue;
    const r = 2, Rb = q(r + dep), xc = 0, yc = 0;
    add(`S5 csink ${face} dep=${dep} straight=${st} t=${t}`, t, { kind: 'csink', cmds: [{ command: 'solid.hole', params: { position: [xc, yc, face === 'top' ? H : 0], diameter: 2 * r, type: 'countersink', cs_diameter: 2 * Rb } }],
      holes: [face === 'top' ? { type: 'cone', c: [xc, yc], rb: r, zb: q(H - dep), rt: Rb, zt: H, r, range: [-1, H + 1] } : { type: 'cone', c: [xc, yc], rb: Rb, zb: 0, rt: r, zt: dep, r, range: [-1, H + 1] }], avoid: avoidBoth(xc, yc, Rb) }, { kind: 'csink', r, R: Rb, dep, face, straight: st }); }
  for (const dep of [1, 2, 3, 4, 5, 6, 7, 8].map(q)) for (const face of ['top', 'bot']) { // countersinks at fixed t: dep sweep (straight = H - dep)
    const r = 2, Rb = q(r + dep), xc = 0, yc = 0; if (dep > H - 0.5) continue;
    add(`S5b csink ${face} dep=${dep} t=${t}`, t, { kind: 'csink', cmds: [{ command: 'solid.hole', params: { position: [xc, yc, face === 'top' ? H : 0], diameter: 2 * r, type: 'countersink', cs_diameter: 2 * Rb } }],
      holes: [face === 'top' ? { type: 'cone', c: [xc, yc], rb: r, zb: q(H - dep), rt: Rb, zt: H, r, range: [-1, H + 1] } : { type: 'cone', c: [xc, yc], rb: Rb, zb: 0, rt: r, zt: dep, r, range: [-1, H + 1] }], avoid: avoidBoth(xc, yc, Rb) }, { kind: 'csink', r, R: Rb, dep, face, straight: q(H - dep) }); }
  // S6 counterbore: ring (material under the step) sweep
  for (const face of ['top', 'bot']) for (const ring of rel(t)) { const d = q(H - ring); if (d < 0.3) continue; const r = 2, Rb = 4, xc = 0, yc = 0;
    add(`S6 cbore ${face} ring=${ring} t=${t}`, t, { kind: 'cbore', cmds: [...cutCyl('f1a', 'z', [xc, yc], r, [-1, H + 1]), ...cutCyl('f1b', 'z', [xc, yc], Rb, rng(H, d, face))], holes: [{ type: 'cyl', axis: 'z', c: [xc, yc], r, range: [-1, H + 1] }, { type: 'cyl', axis: 'z', c: [xc, yc], r: Rb, range: rng(H, d, face) }], avoid: avoidBoth(xc, yc, Rb) }, { kind: 'cbore', r, R: Rb, d, face, ring }); }
  // S7 rim on the open face, wall w sweep (outer 12x10 flush-free)
  for (const w of rel(t)) { const bw = 12, bd = 10, bh = 5; if (w > 4.5) continue; const o = [-bw / 2 + 5, bw / 2 + 5, -bd / 2, bd / 2, H, H + bh]; const tool = [o[0] + w, o[1] - w, o[2] + w, o[3] - w, H - 1, H + bh + 1]; const inn = [o[0] + w, o[1] - w, o[2] + w, o[3] - w, H, H + bh];
    add(`S7 rim wall=${w} t=${t}`, t, { kind: 'rim', cmds: [boxCmd('f1', o), boxCmd('f1t', tool), comb('f1', 'f1t', 'cut'), comb('b1', 'f1', 'join')], boxes: [o], cuts: [inn], minusTop: [[o[0], o[1], o[2], o[3]]], avoid: [] }, { kind: 'rim', bw, bd, bh, wall: w, face: 'top' }); }
  // S8 horizontal hole (axis y) at gap g from the open face / from the closed face
  for (const fromTop of [1, 0]) for (const g of rel(t)) { const r = 1.5; if (H < 2 * r + g + 0.2) continue; const zc = fromTop ? q(H - g - r) : q(g + r); const xc = 0;
    add(`S8 hhole g=${g} ${fromTop ? 'top' : 'bot'} t=${t}`, t, { kind: 'hhole', cmds: cutCyl('f1', 'y', [xc, zc], r, [-D2 - 1, D2 + 1]), holes: [{ type: 'cyl', axis: 'y', c: [xc, zc], r, range: [-D2 - 1, D2 + 1] }], avoid: [] }, { kind: 'hhole', r, g, fromTop: !!fromTop, zc }); }
}
writeFileSync(`${FZ}/cases-s9.jsonl`, out.map((c) => JSON.stringify(c)).join('\n') + '\n');
console.log('sweep cases', out.length);
