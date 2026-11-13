// vs-node.mjs <page dir of <corpus>.jsonl (inc.mjs)> <node dir of hr-<corpus>.jsonl (the host-route sweep)> <out.json>: per step built / not built and sentence; per script the final scene volume where the Node row has one
import fs from 'node:fs';
const L = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const PAGE = process.argv[2], NODE = process.argv[3];
const tot = { rows: 0, compared: 0, nodeHang: 0, pageNoAnswer: 0, stepStatus: 0, sentence: 0, volume: 0, same: 0 }; const out = [];
for (const c of ['holes', 'sd', 'mt', 'combined', 'rgcombined', 'fccombined']) {
  if (!fs.existsSync(`${PAGE}/${c}.jsonl`) || !fs.existsSync(`${NODE}/hr-${c}.jsonl`)) continue;
  const node = new Map(L(`${NODE}/hr-${c}.jsonl`).map((r) => [r.i, r]));
  for (const p of L(`${PAGE}/${c}.jsonl`)) {
    tot.rows++; const i = Number(p.id.slice(c.length + 1).split(' ')[0]); const n = node.get(i);
    if (!n || n.hang || n.crashed) { tot.nodeHang++; out.push({ id: p.id, what: 'node has no result', node: n ? (n.hang ? 'hang' : 'crash') : 'missing' }); continue; }
    if (p.harnessError) { tot.pageNoAnswer++; out.push({ id: p.id, what: 'page gave no answer' }); continue; }
    tot.compared++;
    const ps = new Map(p.steps.map((s) => [s.id, s])); let bad = null;
    for (const f of n.feats ?? []) {
      const s = ps.get(f.id);
      // the page's whole-run refusals (a script error, PM-PREFLIGHT) list no steps
      if (!s) { if (p.steps.length) bad ??= { what: 'step missing in page', step: f.id }; continue; }
      const built = (x) => x === 'built' || x === 'noop';
      if (built(s.status) !== built(f.status)) { bad = { what: 'built / not built', step: f.id, page: s.status, node: f.status, pageSays: s.refusal, nodeSays: f.refusal, guard: f.guard }; break; }
      if (!built(s.status) && (s.refusal ?? '') !== (f.refusal ?? '')) bad ??= { what: 'sentence', step: f.id, page: s.refusal, node: f.refusal };
    }
    if (!p.steps.length && (n.feats ?? []).some((f) => f.status === 'built')) bad = { what: 'page built nothing', page: p.status };
    if (bad && bad.what !== 'sentence') { tot.stepStatus++; out.push({ id: p.id, ...bad }); continue; }
    if (bad) { tot.sentence++; out.push({ id: p.id, ...bad }); continue; }
    // the last built step's volume in Node is that step's body; the page's bodies are the final scene. Compare the scene: Node's final.scene when there is one
    const pv = p.bodies.reduce((a, b) => a + b.volume, 0); const nv = n.scene?.ok ? n.scene.volume : null; if (nv !== null) tot.volumeCompared = (tot.volumeCompared ?? 0) + 1; if (n.final?.verdict) { tot.verdicts ??= {}; tot.verdicts[n.final.verdict] = (tot.verdicts[n.final.verdict] ?? 0) + 1; }
    if (nv !== null && Math.abs(pv - nv) > 1e-9 * Math.max(1, Math.abs(nv))) { tot.volume++; out.push({ id: p.id, what: 'volume', page: pv, node: nv, rel: Math.abs(pv - nv) / Math.max(1, Math.abs(nv)) }); continue; }
    tot.same++;
  }
}
console.log(JSON.stringify(tot)); fs.writeFileSync(process.argv[4], JSON.stringify(out, null, 1));
const by = {}; for (const o of out) by[o.what] = (by[o.what] ?? 0) + 1; console.log(by);
for (const o of out.filter((o) => o.what !== 'sentence').slice(0, 12)) console.log(JSON.stringify(o).slice(0, 420));
