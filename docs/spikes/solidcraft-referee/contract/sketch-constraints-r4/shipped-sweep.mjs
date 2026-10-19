// Fresh measurement of the SHIPPED (unguarded) sketch route on the r3 case table, with the rig that exists after the reboot
// (phase0 wrapper via pkg2shim). Scored against closed form only (volume + bbox); reSHape Script front end checked for rule pass-through.
import { writeFileSync } from 'node:fs';
process.env.SOLIDCRAFT_REFEREE_PKG2 = process.env.SOLIDCRAFT_REFEREE_PKG2 ?? import.meta.dir + '/pkg2shim';
const lib = await import('/home/shuff57/Documents/GitHub/reshape-cad/docs/spikes/solidcraft-referee/contract/sketch-constraints-r3/lib.mjs');
const { CASES, roughen, plainRules, soupScript, H } = await import('/home/shuff57/Documents/GitHub/reshape-cad/docs/spikes/solidcraft-referee/contract/sketch-constraints-r3/cases.mjs');
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const NR = +(process.argv.find((a) => a.startsWith('--n=')) ?? '--n=8').slice(4);
const rel = lib.rel;
function score(cs, r) {
  if (r.mapperRefused) return { cls: 'REFUSED', stage: 'mapper', sentence: r.mapperRefused[0] };
  if (r.firstRefusal) return { cls: 'REFUSED', stage: 'solidcraft', sentence: r.firstRefusal.error };
  if (!r.body) return { cls: 'REFUSED', stage: 'no-solid', sentence: r.extrudeError ?? 'no body' };
  const curved = !!cs.curved; const tol = curved ? 3e-4 : 1e-9;
  const dv = rel(r.body.volume, cs.area * H * (cs.bodies && cs.bodies > 1 ? 1 : 1));
  const bb = cs.bbox ? [cs.bbox[0], cs.bbox[1], cs.bbox[2], cs.bbox[3]] : null;
  const db = bb ? Math.max(...[r.body.bbox[0], r.body.bbox[1], r.body.bbox[3], r.body.bbox[4]].map((v, i) => rel(v, bb[i]))) : null;
  const volOk = dv <= tol;
  const cls = !volOk ? 'BUILT-WRONG-VOLUME' : db != null && db > Math.max(tol, 1e-6) ? 'BUILT-OTHER-POSE' : 'BUILT-RIGHT';
  return { cls, dv, db, bodies: r.body.bodies, faces: r.body.faces, volume: r.body.volume };
}
const one = (process.argv.find((a) => a.startsWith('--one=')) ?? '').slice(6);
if (one) {
  const [id, m, k] = one.split('|'); const cs = CASES.find((c) => c.id === id); const rules = plainRules(cs.rules);
  const start = m === 'stored' ? lib.clone(cs.geoms) : roughen(cs.geoms, cs.rules, cs.id + '#r4#' + k, m === 'rough3.5' ? 0.035 : 0.15);
  let r; try { r = lib.scSketch(start, rules, { plane: 'xy', height: H }); } catch (e) { r = { mapperRefused: ['THROWN ' + String(e.message).slice(0, 120)] }; }
  console.log('ONE ' + JSON.stringify({ id, m, k: +k, ...score(cs, r) }));
  process.exit(0);
}
const out = [];
for (const cs of CASES) {
  if (!cs.geoms || cs.legacy) continue;
  if (only.length && !only.some((o) => cs.id === o)) continue;
  const rules = plainRules(cs.rules);
  const rec = { id: cs.id, feats: cs.feats, expect: cs.expect, starts: {} };
  // reSHape Script front end: rule rows reach the doc unchanged?
  try {
    const run = lib.runScript(soupScript(cs.geoms, cs.rules));
    const sk = run.doc?.features?.find((f) => f.kind === 'sketch');
    const got = JSON.stringify((sk?.rules ?? []));
    rec.script = { errors: (run.errors ?? []).map((e) => e.message), rulesPassThrough: sk ? got === JSON.stringify(rules) : null, nRules: sk?.rules?.length };
    if (!rec.script.rulesPassThrough && sk) { const A = sk.rules, B = rules; rec.script.firstDiff = A.findIndex((x, i) => JSON.stringify(x) !== JSON.stringify(B[i])); rec.script.gotRow = A[rec.script.firstDiff]; rec.script.wantRow = B[rec.script.firstDiff]; }
  } catch (e) { rec.script = { thrown: String(e.message).slice(0, 160) }; }
  const modes = [['stored', 1, 0]];
  if (cs.modes.includes('rough')) { modes.push(['rough3.5', NR, 0.035], ['rough15', NR, 0.15]); }
  for (const [m, n, frac] of modes) {
    const tally = {}; const samples = [];
    for (let k = 0; k < n; k++) {
      const start = m === 'stored' ? lib.clone(cs.geoms) : roughen(cs.geoms, cs.rules, cs.id + '#r4#' + k, frac);
      let r; try { r = lib.scSketch(start, rules, { plane: 'xy', height: H }); } catch (e) { r = { mapperRefused: ['THROWN ' + String(e.message).slice(0, 120)] }; }
      const s = score(cs, r); tally[s.cls] = (tally[s.cls] ?? 0) + 1;
      if (samples.length < 2 || (s.cls !== 'BUILT-RIGHT' && samples.filter((x) => x.cls === s.cls).length < 1)) samples.push(s);
    }
    rec.starts[m] = { n, tally, samples };
  }
  out.push(rec);
  const st = (m) => rec.starts[m] ? JSON.stringify(rec.starts[m].tally) : '-';
  console.log(cs.id.padEnd(52), 'expect', cs.expect.padEnd(6), 'stored', st('stored'), 'r3.5', st('rough3.5'), 'r15', st('rough15'), rec.script?.rulesPassThrough === false ? ' SCRIPT-REWROTE-RULES' : '', rec.script?.errors?.length ? ' SCRIPT-ERR ' + rec.script.errors[0].slice(0, 80) : '');
}
writeFileSync(process.argv.find((a) => a.startsWith('--json=')) ? process.argv.find((a) => a.startsWith('--json=')).slice(7) : import.meta.dir + '/out/shipped-sweep.json', JSON.stringify(out, null, 1));
