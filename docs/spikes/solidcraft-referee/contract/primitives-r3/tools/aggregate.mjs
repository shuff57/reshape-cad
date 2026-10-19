// Aggregates the round 3 sweeps into the numbers the rows quote. Run: bun contract/primitives-r3/tools/aggregate.mjs [--json]
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RES = path.join(HERE, '..', 'results');
export const res = (n) => JSON.parse(readFileSync(path.join(RES, n + '.json'), 'utf8'));
const mx = (a) => (a.length ? Math.max(...a) : undefined);
const mn = (a) => (a.length ? Math.min(...a) : undefined);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const ex = (v, d = 1) => (v === undefined ? 'n/a' : v.toExponential(d));
export const A = {};

// ---- E1 box corner
{
  const r = res('e1'); const by = (f) => r.filter(f);
  const gap = (x) => +/-g([\d.e-]+)$/.exec(x.id)[1];
  const ax = (x) => /-([XYZ])-g/.exec(x.id)[1];
  const inside = by((x) => gap(x) >= 1e-5);
  A.e1 = {
    n: r.length, insideN: inside.length, insideGood: inside.filter((x) => x.good).length,
    insideDVolMax: mx(inside.filter((x) => x.truck).map((x) => x.truck.dVolOcct)),
    insideBboxMax: mx(inside.filter((x) => x.truck).map((x) => x.truck.dBboxOcct)), insideComMax: mx(inside.filter((x) => x.truck).map((x) => x.truck.dComOcct)),
    insideFaces: [...new Set(inside.map((x) => `${x.truck.faces}/${x.truck.facesOcct}`))].join(','),
    g1e6: by((x) => gap(x) === 1e-6).map((x) => `${x.truck.faces}/${x.truck.facesOcct}`).join(' '),
    g1e8: by((x) => gap(x) === 1e-8).map((x) => `${ax(x)}:${x.truck.faces}f vol${ex(x.truck.dVolOcct)}`).join(' '),
    g0: by((x) => gap(x) === 0).map((x) => `${ax(x)}:${x.status === 'built' ? x.truck.faces + 'f dAn ' + ex(x.truck.dVolAn) : 'refused'}`).join(' '),
    gneg: by((x) => gap(x) < 0).map((x) => `${ax(x)}${gap(x)}:${x.status === 'built' ? x.truck.faces + 'f' : 'R'}`).join(' '),
    msMed: med(by((x) => x.status === 'built').map((x) => x.ms)), msMax: mx(by((x) => x.status === 'built').map((x) => x.ms)),
    loadMin: mn(r.map((x) => x.load)), loadMax: mx(r.map((x) => x.load)),
  };
}
// ---- E2 cylinder corner / bevel
{
  const r = res('e2-cyl-corner');
  const k = (x) => +/-k([\d.]+)$/.exec(x.id)[1];
  const fam = (x) => /e2-(\w+)-([RH])-/.exec(x.id).slice(1, 3).join('');
  const sum = (f) => {
    const rows = r.filter((x) => fam(x) === f).sort((a, b) => k(a) - k(b));
    return rows.map((x) => `${k(x)}:${x.status !== 'built' ? 'R' : x.good ? 'g' : 'B(' + x.truck.faces + 'f,' + (x.why.includes('bbox') ? 'bbox ' + ex(x.truck.dBboxOcct) : '') + (x.why.includes('vol') ? ' vol ' + ex(x.truck.dVolOcct) : '') + ')'}`).join(' ');
  };
  A.e2 = { n: r.length, filletR: sum('filletR'), chamferR: sum('chamferR'), filletH: sum('filletH'), chamferH: sum('chamferH'),
    goodMaxDVol: mx(r.filter((x) => x.good).map((x) => x.truck.dVolOcct)), goodMaxBbox: mx(r.filter((x) => x.good).map((x) => x.truck.dBboxOcct)),
    msFilletMed: med(r.filter((x) => /fillet/.test(x.id) && x.status === 'built').map((x) => x.ms)), msFilletMax: mx(r.filter((x) => /fillet/.test(x.id) && x.status === 'built').map((x) => x.ms)),
    msChamferMed: med(r.filter((x) => /chamfer/.test(x.id) && x.status === 'built').map((x) => x.ms)), msChamferMax: mx(r.filter((x) => /chamfer/.test(x.id) && x.status === 'built').map((x) => x.ms)),
    refusedTexts: [...new Set(r.filter((x) => x.status === 'truck-refused').map((x) => String(x.refusal).replace(/^.*solidcraft refused it -- /, '')))] };
}
// ---- E4 ring
{
  const r = res('e4-ring'); const kk = (x) => +/-k([\d.]+)$/.exec(x.id)[1]; const AA = (x) => +/-A(\d+)-/.exec(x.id)[1];
  const env = r.filter((x) => kk(x) >= 2.05 && kk(x) <= 50 && AA(x) / kk(x) >= 0.5);
  const out = r.filter((x) => !env.includes(x));
  A.e4 = { n: r.length, envN: env.length, envGood: env.filter((x) => x.good).length, envDVolMax: mx(env.map((x) => x.truck.dVolOcct)), envBboxMax: mx(env.map((x) => x.truck.dBboxOcct)), envComMax: mx(env.map((x) => x.truck.dComOcct)),
    msMin: mn(r.map((x) => x.ms)), msMed: med(r.map((x) => x.ms)), msMax: mx(r.map((x) => x.ms)), envMsMed: med(env.map((x) => x.ms)), envMsMax: mx(env.map((x) => x.ms)),
    cpuMed: med(r.map((x) => x.cpuMs)), loadMin: mn(r.map((x) => x.load)), loadMax: mx(r.map((x) => x.load)),
    outBad: out.filter((x) => !x.good).length, outN: out.length,
    byK: Object.fromEntries([2.05, 2.2, 2.5, 3, 4, 6, 10, 20, 30, 40, 50, 60, 80, 100].map((k) => [k, r.filter((x) => kk(x) === k).map((x) => `A${AA(x)}:${ex(x.truck.dVolOcct)}${x.good ? '' : '!'}`).join(' ')])),
    nearHornMs: r.filter((x) => kk(x) === 2.05).map((x) => `A${AA(x)}:${Math.round(x.ms)}`).join(' '), };
}
// ---- E5 cylinder / cone grid
{
  const r = res('e5-cyl-cone-grid');
  const g = (kind, f) => r.filter((x) => x.id.startsWith('e5-' + kind) && f(+/-a([\d.]+)-/.exec(x.id)[1], +/asp([\d.]+)$/.exec(x.id)[1]));
  const ok = (rows) => rows.every((x) => x.good);
  A.e5 = { n: r.length,
    cylIn: g('cyl', (a, s) => a >= 1 && s <= 30), cylInN: g('cyl', (a, s) => a >= 1 && s <= 30).length,
    cylInGood: ok(g('cyl', (a, s) => a >= 1 && s <= 30)), cylInMax: mx(g('cyl', (a, s) => a >= 1 && s <= 30).map((x) => x.truck.dVolOcct ?? x.truck.dVolAn)),
    cyl40Max: mx(g('cyl', (a, s) => a >= 0.5 && s === 40).map((x) => x.truck.dVolOcct ?? x.truck.dVolAn)), cyl50Min: mn(g('cyl', (a, s) => a >= 0.5 && s === 50).map((x) => x.truck.dVolOcct ?? x.truck.dVolAn)),
    coneInN: g('cone', (a, s) => a >= 1 && s <= 40).length, coneInGood: ok(g('cone', (a, s) => a >= 1 && s <= 40)), coneInMax: mx(g('cone', (a, s) => a >= 1 && s <= 40).map((x) => x.truck.dVolOcct ?? x.truck.dVolAn)),
    cone50Max: mx(g('cone', (a, s) => a >= 0.5 && s === 50).map((x) => x.truck.dVolOcct ?? x.truck.dVolAn)), cone60Min: mn(g('cone', (a, s) => a >= 0.5 && s === 60).map((x) => x.truck.dVolOcct ?? x.truck.dVolAn)),
    small025Min: mn(r.filter((x) => /-a0\.25-/.test(x.id) || /-a0\.1-/.test(x.id)).map((x) => x.truck.dVolOcct ?? x.truck.dVolAn)),
    half: mx(r.filter((x) => /-a0\.5-asp(0\.02|0\.1|1|5|10|20|30)$/.test(x.id)).map((x) => x.truck.dVolOcct ?? x.truck.dVolAn)),
    thinDiscMax: mx(r.filter((x) => /asp0\.02$/.test(x.id) && !/-a0\.1-|-a0\.25-/.test(x.id)).map((x) => x.truck.dVolOcct ?? x.truck.dVolAn)) };
}
// ---- E5b sphere
{
  const r = res('e5b-sphere'); const d = (x) => +/sph-([\d.]+)$/.exec(x.id)[1];
  A.e5b = { rows: r.map((x) => `${d(x)}:${x.good ? 'g' : 'B'}${ex(x.truck.dVolOcct)}${x.truck.volume === 0 ? '(vol 0)' : ''}`).join(' '), msMed: med(r.map((x) => x.ms)), msMin: mn(r.map((x) => x.ms)), msMax: mx(r.map((x) => x.ms)) };
}
// ---- E6 / E6b planar far; scored with bars vol 1e-9, com & bbox 1e-6 x diag, faces equal
{
  const dimsOf = (f) => (f.kind === 'box' ? f.size : f.kind === 'wedge' ? [f.width, f.depth, f.height] : [2 * f.radius, f.height]);
  const rows = [];
  for (const n of ['e6-planar-far', 'e6b-planar-slender']) for (const x of res(n)) {
    if (x.status !== 'built') continue;
    const feat = x.doc.features.find((y) => ['box', 'prism', 'wedge'].includes(y.kind));
    const turned = x.doc.features.some((y) => y.kind === 'rotate') || (feat.rotate && feat.rotate.some((v) => v));
    const cls = feat.kind === 'prism' ? 'prism' : turned ? 'turned' : 'exact';
    const c = feat.center; const dm = dimsOf(feat);
    rows.push({ id: x.id, cls, qmin: Math.max(...c.map(Math.abs)) / Math.min(...dm), good: x.good, dv: x.truck.dVolOcct, dc: x.truck.dComOcct });
  }
  const nonExact = rows.filter((r) => r.cls !== 'exact'); const exact = rows.filter((r) => r.cls === 'exact');
  const within = (lim) => nonExact.filter((r) => r.qmin <= lim);
  const firstBad = nonExact.filter((r) => !r.good).sort((a, b) => a.qmin - b.qmin)[0];
  A.e6 = { n: rows.length, exactN: exact.length, exactAllGood: exact.every((r) => r.good), exactMaxDv: mx(exact.map((r) => r.dv)), exactMaxQ: mx(exact.map((r) => r.qmin)),
    nonExactN: nonExact.length, within100: within(100).length, within100Good: within(100).every((r) => r.good), within100MaxDv: mx(within(100).map((r) => r.dv)), within100MaxDc: mx(within(100).map((r) => r.dc)),
    within150: within(150).length, within150Good: within(150).every((r) => r.good), firstBad: firstBad && `${firstBad.id} ratio ${firstBad.qmin.toFixed(0)} dVol ${ex(firstBad.dv)}`,
    bad200: nonExact.filter((r) => r.qmin >= 200 && !r.good).length, n200: nonExact.filter((r) => r.qmin >= 200).length,
    worst: nonExact.sort((a, b) => b.dv - a.dv)[0] };
}
// ---- E7 / E7b curved far
{
  const rows = [];
  for (const n of ['e7-curved-far', 'e7b-curved-far-slow']) for (const x of res(n)) {
    const m = /-(\w+)-s([\d.]+)-e([\de+.]+)/.exec(x.id); if (!m || x.status !== 'built') continue;
    const feat = x.doc.features.at(-1); const dm = feat.kind === 'box' ? feat.size : feat.kind === 'torus' ? [2 * (feat.ringRadius + feat.tubeRadius), 2 * feat.tubeRadius] : feat.kind === 'sphere' ? [2 * feat.radius] : [2 * feat.radius, feat.height];
    rows.push({ id: x.id, q: Math.max(...feat.center.map(Math.abs)) / Math.min(...dm), good: x.good, dv: x.truck.dVolOcct, dc: x.truck.dComOcct });
  }
  const within = (l) => rows.filter((r) => r.q <= l);
  const bad = rows.filter((r) => !r.good).sort((a, b) => a.q - b.q);
  A.e7 = { n: rows.length, within400: within(400).length, within400Good: within(400).every((r) => r.good), within400MaxDv: mx(within(400).map((r) => r.dv)), within400MaxDc: mx(within(400).map((r) => r.dc)),
    within500: within(500).length, within500Good: within(500).every((r) => r.good), firstBad: bad[0] && `${bad[0].id} ratio ${bad[0].q.toFixed(0)} dCOM ${ex(bad[0].dc)} dVol ${ex(bad[0].dv)}`, worst: bad.at(-1) && `${bad.at(-1).id} ratio ${bad.at(-1).q.toFixed(0)} dVol ${ex(bad.at(-1).dv)} dCOM ${ex(bad.at(-1).dc)}` };
}
// ---- E8 big / E9 small planar / E10
{
  const r = res('e8-big'); A.e8 = r.map((x) => `${x.id.replace('e8-', '')}:${x.good ? 'g' : 'B'} dVol ${ex(x.truck.dVolOcct ?? x.truck.dVolAn)} f${x.truck.faces}/${x.truck.facesOcct ?? '-'} ${Math.round(x.ms)}ms`).join(' | ');
  const s = res('e9-planar-tiny');
  A.e9 = { built: s.filter((x) => x.status === 'built').length, refused: s.filter((x) => x.status !== 'built').length, allBuiltGood: s.filter((x) => x.status === 'built').every((x) => x.good),
    refusedTexts: [...new Set(s.filter((x) => x.status !== 'built').map((x) => String(x.refusal).replace(/^.*solidcraft refused it -- /, '')))],
    smallestBuiltBox: s.filter((x) => x.status === 'built' && /^e9-box-/.test(x.id)).map((x) => x.id).at(-1), refusedBox: s.filter((x) => x.status !== 'built' && /^e9-box-/.test(x.id)).map((x) => x.id).join(',') };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(A, null, 1));
