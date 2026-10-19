// LIVE regression gate for the blend-loft guard (round 4). It RUNS truck: nothing is replayed from a saved file.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 \
//     bun docs/spikes/solidcraft-referee/contract/blend-loft.guard-check.mjs [--quick] [--out=<summary.json>] [--work=<scratch dir>]
// Exit 0 only if EVERY case the guard lets through is right on live truck against live OCCT:
//   1. blend-loft.r4.mjs     deterministic ModelDoc battery (ALL), planar-sided fuzz (N7*), circle/polygon pairs (N9), 50 script texts (N8)
//   2. blend-loft.fuzz-live  wide random populations for every supported class, with the post-build circle<->circle volume check
//   3. blend-loft.options-live  alias bypass, argument order, same-sketch-twice, studio path
// "Wrong" = true relative volume error |T-O|/|O| above 1e-9 (straight-sided; face count must also match) or above 3e-4 (circle or arc involved),
// a kernel with no solid where the guard passed, or a violated expectation in step 3.
// It also reports, and does not hide, that NOTHING in packages/ or phase0/ calls the guard (wired: false).
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const arg = (k, d = '') => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const QUICK = process.argv.includes('--quick');
const WORK = arg('work', path.join(process.env.TMPDIR ?? '/tmp', 'blend-loft-gate')); mkdirSync(WORK, { recursive: true });
if (!process.env.SOLIDCRAFT_REFEREE_PKG) { console.error('set SOLIDCRAFT_REFEREE_PKG'); process.exit(2); }
const run = (script, args, outFile) => {
  const r = spawnSync('bun', [path.join(HERE, script), ...args], { env: process.env, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 3 * 3600 * 1000 });
  writeFileSync(`${outFile}.log`, (r.stdout ?? '') + (r.stderr ?? ''));
  return r;
};
// a face-count difference is explained only when truck merged the coplanar faces that redundant collinear corners split (OCCT keeps them): O - T <= number of such corners, volume exact
const faceOk = (c) => c.faces[0] === c.faces[1] || ((c.collinear ?? 0) > 0 && c.faces[0] > c.faces[1] && c.faces[0] - c.faces[1] <= c.collinear);
const bad = []; const summary = { gate: 'blend-loft guard, LIVE (runs truck + OCCT)', quick: QUICK };

// ---- 0. wiring: does anything outside contract/ call the guard? ----
const grep = spawnSync('grep', ['-rlE', 'blend-loft\\.guard', 'packages', 'docs/spikes/solidcraft-referee/phase0', 'docs/spikes/solidcraft-referee/phase1', 'docs/spikes/solidcraft-referee/phase2', 'docs/spikes/solidcraft-referee/phase3', '--include=*.ts', '--include=*.tsx', '--include=*.mjs', '--include=*.js', '--exclude-dir=node_modules', '--exclude-dir=dist'], { cwd: REPO, encoding: 'utf8' });
summary.wired = (grep.stdout ?? '').trim() !== '';
summary.wiredCallers = (grep.stdout ?? '').trim().split('\n').filter(Boolean);
console.log(`WIRING: guard imported by packages/ or phase0..3: ${summary.wired ? summary.wiredCallers.join(', ') : 'NO (the guard is not wired into the product; the raw translator still builds wrong solids silently)'}`);

// ---- 1. deterministic battery ----
{
  const out = path.join(WORK, 'r4-results.json');
  const r = run('blend-loft.r4.mjs', [`--out=${out}`], path.join(WORK, 'r4'));
  if (r.status !== 0) bad.push(`r4 harness exit ${r.status}`);
  else {
    const R4 = JSON.parse(readFileSync(out, 'utf8'));
    const st = { total: 0, pass: 0, passExact: 0, refused: 0 };
    for (const c of R4.ALL.filter((c) => c.kind === 'polygon' || c.kind === 'curved')) {
      st.total++; const warped = c.kind === 'polygon' && c.warp > 1e-9; const barC = (c.kind === 'curved' || warped) ? 3e-4 : 1e-9; // round 5: slightly warped (near-parallel) pairs use the curved bar and must keep equal face counts
      if (c.guard) { st.refused++; continue; }
      st.pass++; if (warped) st.passWarped = (st.passWarped ?? 0) + 1;
      const built = c.truck !== undefined && c.occt !== undefined;
      if (built && c.dTO <= barC && (c.kind === 'curved' || faceOk(c))) st.passExact++; else bad.push(`ALL pass-but-wrong: ${c.label} dT/O=${c.dTO} truck=${c.truck} occt=${c.occt} faces=${c.faces}`);
    }
    const n7 = [...(R4.N7 ?? []), ...(R4.N7h ?? []), ...(R4.N7p2 ?? [])];
    for (const x of n7) if (!x.guard && !(x.warp > 1e-9 ? (x.dTO <= 3e-4 && faceOk(x)) : (x.dTG <= 1e-9 && x.dOG <= 1e-9 && x.dTO <= 1e-9 && faceOk(x)))) bad.push(`N7 fuzz pass-but-wrong: ${x.label} dTG=${x.dTG} dOG=${x.dOG} dTO=${x.dTO} warp=${x.warp}`);
    for (const e of R4.N8 ?? []) for (const b of e.blends) if (!b.guard && !b.exact) bad.push(`N8 script pass-but-wrong: ${e.name} d=${b.d}`);
    for (const c of R4.N9 ?? []) if (!c.guard && !(c.d <= 3e-4)) bad.push(`N9 pair pass-but-wrong: ${c.label} d=${c.d}`);
    summary.battery = { ...st, n7Pairs: n7.length, n7Passed: n7.filter((x) => !x.guard).length, n8Scripts: (R4.N8 ?? []).length, n8Passed: (R4.N8 ?? []).reduce((s, e) => s + e.blends.filter((b) => !b.guard).length, 0) };
    console.log('BATTERY', JSON.stringify(summary.battery));
  }
}

// ---- 2. wide live populations ----
{
  const seeds = QUICK ? [11] : [11, 12, 13];
  const n = QUICK ? 25 : 80;
  summary.fuzz = [];
  for (const seed of seeds) {
    const out = path.join(WORK, `fuzz-${seed}.json`);
    const r = run('blend-loft.fuzz-live.mjs', [`--seed=${seed}`, `--n=${n}`, '--refused=0', `--out=${out}`], path.join(WORK, `fuzz-${seed}`));
    let J; try { J = JSON.parse(readFileSync(out, 'utf8')); } catch { bad.push(`fuzz seed ${seed} produced no result (exit ${r.status})`); continue; }
    summary.fuzz.push({ seed, n, summary: J.summary, violations: J.violations });
    if (J.violations) for (const row of J.rows) if (row.guard === null && row.d !== null && ((row.bar !== undefined ? row.d > row.bar : (row.curved ? row.d > 3e-4 : row.d > 1e-9)) || (!row.curved && row.occtFaces !== row.truckFaces)) && !row.post) bad.push(`fuzz ${seed} [${row.mode}] ${row.tag}: d=${row.d}`);
    if (J.violations && !bad.some((b) => b.startsWith(`fuzz ${seed}`))) bad.push(`fuzz ${seed}: ${J.violations} violations`);
    console.log(`FUZZ seed ${seed}: ${Object.entries(J.summary).map(([m, s]) => `${m} pass ${s.guardPassed} wrong ${s.passBut}`).join(', ')}`);
  }
}

// ---- 3. option probes with expectations ----
{
  const out = path.join(WORK, 'options.json');
  const r = run('blend-loft.options-live.mjs', [`--out=${out}`], path.join(WORK, 'options'));
  if (r.status !== 0) bad.push(`options-live exit ${r.status}`);
  else {
    const O = JSON.parse(readFileSync(out, 'utf8'));
    const g = (name, list) => list.find((x) => x.name === name);
    const expect = (cond, msg) => { if (!cond) bad.push('option expectation failed: ' + msg); };
    for (const nm of ['alias: const f = loft; pull(b,5); f(a,b,30)', 'alias: const f = blend; pull(b,5); f(a,b,30)', 'alias in an object: {k: loft}.k(a,b,30)', 'alias via array: [loft][0](a,b,30)']) expect(g(nm, O.O4)?.blends[0]?.guard === 'shared', `${nm} must be refused as shared`);
    expect(g('negative gap, b (second argument) crosses itself', O.O4)?.blends[0]?.sentence?.startsWith('The second sketch crosses itself'), 'negative gap blames the second argument');
    expect(g('negative gap, a (first argument) crosses itself', O.O4)?.blends[0]?.sentence?.startsWith('The first sketch crosses itself'), 'negative gap blames the first argument');
    expect(g('loft(a, a, 30) same sketch twice', O.O3)?.blends[0]?.guard === 'same', 'loft(a,a,30) refused as the same sketch twice (not as a zero gap)');
    for (const p of O.O5) if (!p.uiMessage) summary.studioPathUnguarded = true; // the button path allows pairs the guard would refuse
    summary.options = { alias: 'refused', argumentOrder: 'by what the student wrote', studioPathAllowsPairsGuardRefuses: !!summary.studioPathUnguarded };
    console.log('OPTIONS', JSON.stringify(summary.options));
  }
}

summary.violations = bad.length;
if (arg('out')) writeFileSync(arg('out'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ violations: bad.length, wired: summary.wired }, null, 1));
for (const b of bad) console.log('VIOLATION ' + b);
process.exit(bad.length ? 1 : 0);
