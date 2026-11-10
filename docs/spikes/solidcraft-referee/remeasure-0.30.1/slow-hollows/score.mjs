// score.mjs: the independent plane-offset oracle (fuzz/oracle.mjs, copied with a centre-of-mass accumulator added) for every hollow the host route BUILT.
// Models are in the fuzz frame (box z in [0, H]); the script's box is centred, so the oracle COM is shifted by -H/2 in z before comparing.
import { oracle } from './oracle-com.mjs'; import { readFileSync } from 'node:fs';
const box = (W, D, H) => [[-W / 2, W / 2, -D / 2, D / 2, 0, H]];
const top = (W, D, H) => [{ axis: 'z', dir: 1, coord: H, rect: [-W / 2, W / 2, -D / 2, D / 2], minus: [] }];
const cone = (c, r, R, ang, H) => { const dep = (R - r) / Math.tan(ang / 2 * Math.PI / 180); return { type: 'cone', c, rb: r, zb: H - dep, rt: R, zt: H, r, range: [-1, H + 1] }; };
const cyl = (c, r, z0, z1) => ({ type: 'cyl', axis: 'z', c, r, range: [z0, z1] });
const M = {
  'v-00872-wall2': { t: 2, W: 18, D: 18, H: 12, holes: [cone([0, 0], 1.5, 6, 90, 12)] },
  'v-01024-one': { t: 1.5, W: 22, D: 14, H: 6, holes: [cone([-4, -1], 1, 4, 90, 6)] },
  'v-01396-centre': { t: 1, W: 12, D: 10, H: 6, holes: [cyl([0, 0], 1, -1, 7), cyl([0, 0], 4, 4, 7)] },
  'v-csink-plate': { t: 2, W: 40, D: 30, H: 10, holes: [cone([0, 0], 2, 5, 90, 10)] },
  'v-cbore-plate': { t: 2, W: 40, D: 30, H: 10, holes: [cyl([0, 0], 2, -1, 11), cyl([0, 0], 4, 7, 11)] },
};
const files = process.argv.slice(2);
for (const f of files) for (const l of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
  const d = JSON.parse(l); const sh = d.feats.find((x) => x[1] === 'shell'); if (sh[2] !== 'built') continue;
  const m = M[d.id]; if (!m) { console.log(JSON.stringify({ file: f, id: d.id, noOracle: true })); continue; }
  const o = oracle({ t: m.t, mode: 'rect', boxes: box(m.W, m.D, m.H), cuts: [], opens: top(m.W, m.D, m.H), holes: m.holes, rbosses: [] }, { h: 0.05 });
  const oc = [o.com[0], o.com[1], o.com[2] - m.H / 2]; const diag = Math.hypot(m.W, m.D, m.H);
  const dVol = (d.scene.volume - o.P) / o.P; const dCom = Math.max(...d.scene.com.map((v, i) => Math.abs(v - oc[i]))) / diag;
  console.log(JSON.stringify({ file: f.split('/').pop(), id: d.id, host: d.scene.volume, P: +o.P.toFixed(3), dVol: +dVol.toExponential(2), hostCom: d.scene.com.map((v) => +v.toFixed(4)), oracleCom: oc.map((v) => +v.toFixed(4)), dComOfDiag: +dCom.toExponential(2), verdict: Math.abs(dVol) <= 1e-3 && dCom <= 1e-3 ? 'RIGHT (oracle bar 1e-3)' : 'CHECK' }));
}
