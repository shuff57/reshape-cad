// ROUND 4 FRESH FUZZ (new seeds, never used by an earlier round; the guard was written before these cases existed).
//   FZ=single|group|pocket SEED=<n> N=<count> bun live/fc4-run.mjs --cases=./fc4-cases-fuzz.mjs --res=../fc4-results-fz-<kind>.json
// single : one random box, one random edge, random style, size 0.05..1.5 x the smaller leg (10 percent tiny sizes 0.001..0.02)
// group  : one random box, a random CONNECTED set of 2..12 edges, one style, one size 0.05..0.8 x the smaller leg of the set
// pocket : a plate with one rectangular / hexagonal / triangular / L pocket at a random place and depth, round(part.rim(sk), r) or bevel, r 0.1..1.3 x min(depth, half the narrowest width)
export const CASES = [];
const FZ = process.env.FZ ?? 'single'; const SEED = Number(process.env.SEED ?? 2027); const N = Number(process.env.N ?? 100);
let st = SEED >>> 0;
const rnd = () => { st = (st + 0x6D2B79F5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const U = (a, b) => a + (b - a) * rnd(); const I = (a, b) => Math.floor(U(a, b + 1)); const pickOne = (a) => a[Math.floor(rnd() * a.length)];
const r2 = (x) => Math.round(x * 100) / 100;
const NORM = { top: ['z', 1], bottom: ['z', -1], front: ['y', -1], back: ['y', 1], left: ['x', -1], right: ['x', 1] };
const FACES = Object.keys(NORM);
const EDGES = [];
for (let i = 0; i < FACES.length; i++) for (let j = i + 1; j < FACES.length; j++) if (NORM[FACES[i]][0] !== NORM[FACES[j]][0]) EDGES.push([FACES[i], FACES[j]]);
const axisIdx = { x: 0, y: 1, z: 2 };
const endsOf = (e) => { const [a, b] = e.map((f) => NORM[f]); const free = ['x', 'y', 'z'].find((k) => k !== a[0] && k !== b[0]); return [-1, 1].map((s) => { const v = [0, 0, 0]; v[axisIdx[a[0]]] = a[1]; v[axisIdx[b[0]]] = b[1]; v[axisIdx[free]] = s; return v.join(','); }); };
const legsOf = (e, dim) => e.map((f, i) => dim[NORM[e[1 - i]][0]]); // extent of face i perpendicular to the edge = the dimension along the OTHER face's normal
const name = (e) => `b.edge('${e[0]}','${e[1]}')`;

if (FZ === 'single') {
  for (let n = 0; n < N; n++) {
    const dim = { x: I(8, 48), y: I(8, 48), z: I(8, 48) };
    const e = pickOne(EDGES); const style = pickOne(['round', 'bevel']);
    const m = Math.min(...legsOf(e, dim));
    const size = rnd() < 0.1 ? r2(U(0.001, 0.02)) : r2(U(0.05, 1.5) * m);
    const s = size > 0 ? size : 0.01;
    CASES.push({ id: `fzs-${SEED}-${String(n).padStart(3, '0')}`, group: 'fz-single', note: `${dim.x}x${dim.y}x${dim.z} ${style} ${e.join('/')} ${s} (smaller leg ${m})`, script: `const b = cuboid(${dim.x},${dim.y},${dim.z})\n${style}(${name(e)}, ${s})` });
  }
} else if (FZ === 'group') {
  for (let n = 0; n < N; n++) {
    const dim = { x: I(10, 48), y: I(10, 48), z: I(10, 48) };
    const k = pickOne([2, 2, 3, 3, 4, 4, 5, 6, 8, 12]);
    const ends = EDGES.map(endsOf);
    const set = [I(0, EDGES.length - 1)];
    for (let g = 0; g < 200 && set.length < k; g++) {
      const c = I(0, EDGES.length - 1);
      if (set.includes(c)) continue;
      if (set.some((s) => ends[s].some((v) => ends[c].includes(v)))) set.push(c);
    }
    const es = set.map((i) => EDGES[i]);
    const style = pickOne(['round', 'bevel']);
    const m = Math.min(...es.flatMap((e) => legsOf(e, dim)));
    const size = r2(U(0.05, 0.8) * m) || 0.05;
    const asList = rnd() < 0.3;
    const body = asList ? `${style}([${es.map(name).join(', ')}], ${size})` : es.map((e) => `${style}(${name(e)}, ${size})`).join('\n');
    CASES.push({ id: `fzg-${SEED}-${String(n).padStart(3, '0')}`, group: 'fz-group', note: `${dim.x}x${dim.y}x${dim.z} ${style} ${es.length} edges ${size} (smaller leg ${m})`, script: `const b = cuboid(${dim.x},${dim.y},${dim.z})\n${body}` });
  }
} else if (FZ === 'pocket') {
  for (let n = 0; n < N; n++) {
    const w = I(40, 70); const d = I(30, 50); const h = I(8, 14);
    const kind = pickOne(['rect', 'rect', 'hex', 'tri', 'L']);
    const depth = rnd() < 0.15 ? h : r2(U(2, h - 1));
    let geo; let halfMin; let ext;
    if (kind === 'rect') { const a = I(8, 24); const b = I(6, 18); geo = (cx, cy) => `sk2.rect(${a},${b},{at:[${cx},${cy}]})`; halfMin = Math.min(a, b) / 2; ext = [a / 2, b / 2]; }
    else if (kind === 'hex') { const R = I(6, 12); const p = [[R, 0], [R / 2, R * 0.866], [-R / 2, R * 0.866], [-R, 0], [-R / 2, -R * 0.866], [R / 2, -R * 0.866]]; geo = (cx, cy) => `sk2.polygon(${JSON.stringify(p.map(([x, y]) => [r2(x + cx), r2(y + cy)]))})`; halfMin = R * 0.866; ext = [R, R * 0.866]; }
    else if (kind === 'tri') { const a = I(10, 20); const b = I(8, 16); const p = [[-a / 2, -b / 2], [a / 2, -b / 2], [0, b / 2]]; geo = (cx, cy) => `sk2.polygon(${JSON.stringify(p.map(([x, y]) => [r2(x + cx), r2(y + cy)]))})`; halfMin = Math.min(a, b) / 4; ext = [a / 2, b / 2]; }
    else { const p = [[0, 0], [16, 0], [16, 6], [6, 6], [6, 14], [0, 14]]; geo = (cx, cy) => `sk2.polygon(${JSON.stringify(p.map(([x, y]) => [r2(x + cx - 8), r2(y + cy - 7)]))})`; halfMin = 3; ext = [8, 7]; }
    const mx = w / 2 - ext[0] - 0.6; const my = d / 2 - ext[1] - 0.6;
    const cx = r2(U(-mx, mx)); const cy = r2(U(-my, my));
    const op = pickOne(['round', 'bevel']);
    const r = r2(U(0.1, 1.3) * Math.min(depth, halfMin)) || 0.1;
    CASES.push({ id: `fzp-${SEED}-${String(n).padStart(3, '0')}`, group: 'fz-pocket', note: `${w}x${d}x${h} ${kind} depth ${depth} at ${cx},${cy} ${op} ${r}`, script: `const plate = cuboid(${w},${d},${h})\nconst sk2 = sketch('top', ${h / 2})\n${geo(cx, cy)}\nconst part = pocket(sk2, plate, ${depth})\n${op}(part.rim(sk2), ${r})` });
  }
}
