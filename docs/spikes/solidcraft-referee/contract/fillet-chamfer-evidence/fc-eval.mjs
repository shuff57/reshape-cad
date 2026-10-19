// Evaluates the contract guard (fc-guard.mjs) on REAL truck topology (fc-topo.json, fetched from the pane's bridge by fc-topo.mjs) for every recorded case
// that has a command list, against the recorded ground truth of that case. For every single-edge solid.fillet / solid.chamfer in the command list the
// guard sees the target body as it was just before that command. A case is REFUSED when any of its blends is refused.
//   bun fc-eval.mjs [--out=fc-eval-results.json]
// Ground-truth labels (from the recorded runs, never from the guard):
//   correct              truck built, and equals the independent reference (closed form if the case has one, else live OCCT) within the bar, faces equal
//   correct-oracle-refuses  truck built and equals the closed form while OCCT AND brep-rs refuse (size == extent: the consumed-face solid)
//   wrong                truck built and differs from the reference, or built where both oracles refuse and there is no matching closed form
//   truck-refused        the kernel refused (nothing to guard)
//   unknown              no reference
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { guardBlend, postCheck } from './fc-guard.mjs';
import { keyOf, isBlend } from './fc-topo.mjs';
const here = new URL('.', import.meta.url).pathname;
const J = (f) => JSON.parse(readFileSync(here + f, 'utf8'));
const topoAll = existsSync(here + 'fc-topo.json') ? J('fc-topo.json') : {};
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1);

const ROWBAR = { holeFirst: 1e-4, holeFirstPos: 1e-4, holeFirstBlind: 1e-4, pocketFirst: 1e-4, pocketFirstPos: 1e-4 }; // r3 rows: the same kernel's fillet-first build of the same part is within 2.4e-6 of the closed form, so 1e-4 is not tessellation noise there
function labelFx(r) {
  const fx = r.fx; if (!fx) return { label: 'unknown', why: 'no fx' };
  const t = fx.truck;
  if (!t || t.refused !== undefined) return { label: 'truck-refused' };
  const oracleRefused = !!fx.invalid || Object.keys(fx.occtRefusals ?? {}).includes(fx.measureId);
  const closed = r.closed;
  if (t.dBbox > 3e-4) return { label: 'wrong', why: `bounding box ${t.dBbox.toExponential(1)} off OCCT` };
  const bar = ROWBAR[r.row] ?? (t.curved ? 3e-4 : 1e-9);
  const closedOk = closed !== undefined ? rel(t.volume, closed) <= (t.curved ? Math.min(bar, 3e-4) : 1e-8) : null;
  if (oracleRefused) {
    if (closedOk) return { label: 'correct-oracle-refuses', why: `closed form ${closed}` };
    if (closed !== undefined) return { label: 'wrong', why: `built where OCCT refuses; closed form ${closed} vs ${t.volume}` };
    const b = fx.brep; const bRef = !b || b.refused || Object.keys(fx.brepRefusals ?? {}).includes(fx.measureId);
    if (!bRef && rel(t.volume, b.volume) <= (t.curved ? 3e-4 : 1e-9)) return { label: 'correct-oracle-refuses', why: `agrees with brep-rs ${b.volume}` };
    if (r.expect === 'refuse') return { label: 'wrong', why: 'the case is oversize: a correct system refuses (OCCT and brep-rs do)' };
    if (bRef) return { label: 'built-no-reference', why: 'OCCT and brep-rs refuse and there is no closed form' };
    return { label: 'wrong', why: `OCCT refuses; brep-rs ${b.volume} vs ${t.volume}` };
  }
  const good = (fx.outcome === 'PASS' || (t.dVol <= bar && fx.occt && fx.occt.faces === t.faces && !ROWBAR[r.row])) && (!ROWBAR[r.row] || rel(t.volume, fx.occt.volume) <= bar);
  if (good && (closed === undefined || closedOk)) return { label: 'correct' };
  if (!good && closedOk && !ROWBAR[r.row]) return { label: 'differs-from-oracle', why: `matches the independent closed form ${closed} but not OCCT ${fx.occt?.volume}` };
  return { label: 'wrong', why: closed !== undefined ? `closed form ${closed} vs ${t.volume}${fx.occt ? `; OCCT ${fx.occt.volume}` : ''}` : `OCCT ${fx.occt?.volume} vs ${t.volume}` };
}
const DEFS = new Map();
for (const f of ['./cases-r3.mjs', './cases-r3f.mjs']) { const m = await import(f); for (const c of m.CASES) DEFS.set(c.id, c); }
const sources = [];
for (const f of ['res-r2.json', 'res-r2b.json', 'res-r2c.json', 'res-seq.json', 'res-fc.json', 'res-r3.json', 'res-r3f.json']) {
  if (!existsSync(here + f)) continue;
  const rows = J(f);
  sources.push({ name: f, items: rows.filter((r) => r.fx?.commands).map((r) => { const d = DEFS.get(r.id); if (d) { r.row = d.row; r.expect = d.expect ?? r.expect; r.closed = d.closed ? d.closed() : r.closed; r.size = d.size; } return { id: r.id, commands: r.fx.commands, ...labelFx(r), size: r.size, row: r.row, facesAfter: r.fx.truck?.bodies === 1 ? r.fx.truck.faces : undefined }; }) });
}
for (const [f, c, lab] of [['fuzz-single.json', 'fc-cmds-fuzz.json', (r) => (r.outcome === 'WRONG-UNREFUSED' ? { label: 'wrong' } : r.outcome === 'match' ? { label: 'correct' } : { label: 'truck-refused-or-other', why: r.outcome })],
  ['fuzz-pair.json', 'fc-cmds-fuzz.json', (r) => (r.outcome === 'tangent-chain(=OCCT)' || (r.dOcct !== undefined && r.dOcct < 5e-5 && !r.occt?.refused) ? { label: 'correct' } : r.outcome === 'literal-mitre' ? { label: 'differs-from-oracle', why: 'literal mitre' } : r.outcome === 'refused' ? { label: 'truck-refused' } : { label: 'wrong', why: r.outcome })]]) {
  if (!existsSync(here + c)) continue;
  const cm = new Map(J(c).map((x) => [x.id, x]));
  const rows = J(f).rows ?? J(f);
  sources.push({ name: f, items: rows.map((r) => ({ id: `${f.replace('.json', '')}#${r.i}`, script: r.script, commands: cm.get(`${f.replace('.json', '')}#${r.i}`)?.commands, ...lab(r), facesAfter: f === 'fuzz-single.json' ? r.truck?.faces : undefined })).filter((x) => x.commands) });
}
if (existsSync(here + 'fc-cmds-r1.json')) {
  const cm = new Map(J('fc-cmds-r1.json').map((x) => [x.id, x]));
  sources.push({ name: 'cases-results.json', items: J('cases-results.json').map((r) => ({ id: r.id, commands: cm.get(r.id)?.commands, label: r.outcome === 'PASS' ? 'correct' : r.outcome === 'REFUSED' ? 'truck-refused' : r.truck && !r.truck.refused ? 'round1-fail-unscored' : 'truck-refused', why: r.outcome })).filter((x) => x.commands) });
}
const out = { sources: {} }; const flat = [];
for (const s of sources) {
  const post = { checked: 0, flagged: [] }; let boundary; const staleMiss = []; const noEdge = []; const tally = {}; const misses = []; const falseRef = []; const nTopoMissing = [];
  for (const it of s.items) {
    const verdicts = [];
    it.commands.forEach((c, i) => {
      if (!isBlend(c)) return;
      if ((c.params.edges ?? []).length !== 1) { verdicts.push({ i, skipped: 'multi-edge command' }); return; }
      const k = keyOf(it.commands.slice(0, i)); const tp = topoAll[k];
      if (!tp || tp.error) { verdicts.push({ i, skipped: 'no topology' }); nTopoMissing.push(it.id); return; }
      const body = tp.bodies.find((b) => b.name === c.params.body);
      if (!body || body.error) { verdicts.push({ i, skipped: 'no body' }); return; }
      const size = c.command === 'solid.fillet' ? c.params.radius : c.params.distance;
      const g = guardBlend(body, c.params.edges[0], size, c.command === 'solid.fillet' ? 'fillet' : 'chamfer');
      verdicts.push({ i, style: c.command === 'solid.fillet' ? 'fillet' : 'chamfer', size, ok: g.ok, rule: g.rule, code: g.code, args: g.args && { face: g.args.face, extent: g.args.extent, other: g.args.other, equal: g.args.equal } });
    });
    const blends = it.commands.filter(isBlend);
    if (blends.length === 1 && isBlend(it.commands.at(-1)) && verdicts[0]?.ok === true && it.facesAfter !== undefined) {
      const i0 = it.commands.findIndex(isBlend); const tp = topoAll[keyOf(it.commands.slice(0, i0))];
      const fb = tp?.measure?.bodies?.find((b) => b.name === it.commands[i0].params.body)?.faces;
      if (fb !== undefined) { const pc = postCheck(fb, it.facesAfter, verdicts[0].rule ?? 'planar'); post.checked++; if (!pc.ok) { post.flagged.push({ id: it.id, label: it.label, ...pc.args }); } }
    }
    const considered = verdicts.filter((v) => v.ok !== undefined);
    const refused = considered.find((v) => v.ok === false);
    const verdict = considered.length === 0 ? 'no-blend' : refused ? 'refused' : 'passed';
    const key = `${it.label} / ${verdict}`;
    tally[key] = (tally[key] ?? 0) + 1;
    const rec = { id: it.id, row: it.row, size: it.size, label: it.label, why: it.why, verdict, code: refused?.code, detail: refused?.args };
    const stale = /^(mv|mo|tu)-/.test(it.id);
    if (it.label === 'wrong' && verdict === 'passed') (stale ? staleMiss : misses).push(rec);
    if (it.label === 'correct' && verdict === 'refused') (rec.code === 'no-edge' ? noEdge : falseRef).push(rec);
    if (it.label === 'correct-oracle-refuses' && verdict === 'refused') (boundary ??= []).push(rec);
    flat.push({ src: s.name, ...rec });
  }
  out.sources[s.name] = { n: s.items.length, tally, misses, falseRefusals: falseRef, boundaryRefused: (boundary ?? []).length, staleMiss, noEdgeStale: noEdge.map((x) => x.id), postCheck: post, noTopology: nTopoMissing.length };
}
writeFileSync(here + 'fc-eval-results.json', JSON.stringify({ ...out, flat }, null, 1));
for (const [n, s] of Object.entries(out.sources)) {
  console.log(n.padEnd(18), 'n', s.n, JSON.stringify(s.tally), 'MISSES', s.misses.length, 'FALSE REFUSALS', s.falseRefusals.length, 'no topology', s.noTopology);
  for (const m of s.misses) console.log('   MISS', m.id, m.why ?? '');
  if (s.staleMiss.length) console.log('   stale-pick (resolver class, rows 36-38):', s.staleMiss.map((x) => x.id).join(' '));
  if (s.noEdgeStale.length) console.log('   pick not on an edge (stale rig pick) refused:', s.noEdgeStale.join(' '));
  for (const m of s.falseRefusals) console.log('   FALSE-REFUSAL', m.id, m.code, JSON.stringify(m.detail));
}
