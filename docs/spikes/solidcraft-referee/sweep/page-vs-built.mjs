// page-vs-built.mjs <page dir (page-run.mjs)> <built dir (the cut-down pass)> [corpus...]: is the solid the oracles judged the solid the page shows?
// For each case the page's final volume for the WHOLE document against the judged scene of the document cut down to its built steps (1e-9). A difference
// means the page built or left out a step that the Node route did not (the time budget near its limit does that), or the two builds of the engine differ.
import fs from 'node:fs';
const [PAGE, BUILT, ...ARGS] = process.argv.slice(2);
const L = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const CS = ARGS.length ? ARGS : fs.readdirSync(BUILT).filter((f) => /^hr-.*\.jsonl$/.test(f)).map((f) => f.slice(3, -6));
let n = 0, cmp = 0, missing = 0; const diffs = [];
for (const c of CS) {
  const page = new Map(L(`${PAGE}/${c}.jsonl`).map((r) => [r.id.replace(/^[^#]+#\d+ /, ''), r]));
  for (const r of L(`${BUILT}/hr-${c}.jsonl`)) { n++; const p = page.get(r.id); if (!p || p.harnessError || !r.scene?.ok) { missing++; continue; }
    const pv = p.bodies.reduce((a, b) => a + b.volume, 0); cmp++;
    if (Math.abs(pv - r.scene.volume) > 1e-9 * Math.max(1, Math.abs(r.scene.volume))) diffs.push(`  ${c}:${r.id}: page ${pv}, judged ${r.scene.volume} (rel ${((pv - r.scene.volume) / Math.max(1, r.scene.volume)).toExponential(2)}); page: ${p.status}`); }
}
console.log(`judged ${n}, compared with the page ${cmp}, not comparable ${missing}, differ ${diffs.length}`); for (const d of diffs) console.log(d);
