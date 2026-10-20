// Round 8 audit: opens, for EVERY row of contract/sketch-geometry.json, the cases the row read and checks that the evidence says what the row claims.
//   bun build-rows.mjs      (writes audit/row-cases.json: row index -> the case ids that row read; a side output, not part of the rows file)
//   bun audit-evidence.mjs  (reads ../sketch-geometry.json, audit/row-cases.json, results/, results-guarded/; exit 1 on any problem; writes audit/audit-evidence.json)
// Per row:
//   1. every CMD[<group>: ...] names a results-guarded/<group>.json and a results/<group>.json that exist (the raw-translator control row is the one allowed exception: it quotes only results/)
//   2. every case the row read exists (guarded run; ids that exist only in results/ are the negative controls and are allowed on a row that says so)
//   3. every case line the evidence prints ("<id>: truck <V> mm3", "<id>: BUILT <V>", "<id>: refused ...") matches the stored result: built volume to 8 digits, refused when stored as refused
//   4. supported: every case read is a pass in the guarded run, or is named in the evidence text (an explicit aside)
//   5. refused: every part of refusalSentence (label prefix "xxx: " removed) is, word for word, the guarded sentence of one of the cases the row read, and that case is refused
//   6. wrong: at least one case read is not a clean pass, or the evidence says WRONG
//   7. unsupported: the evidence says so in words (no case rule)
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
const HERE = new URL('.', import.meta.url).pathname;
const load = (d) => { const m = new Map(); const dir = HERE + d + '/'; for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) { let rows; try { rows = JSON.parse(readFileSync(dir + f, 'utf8')); } catch { continue; } if (!Array.isArray(rows)) continue; for (const r of rows) if (r && typeof r.id === 'string') m.set(r.id, { file: f.replace('.json', ''), ...r }); } return m; };
const GM = load('results-guarded'), BM = load('results');
const doc = JSON.parse(readFileSync(HERE + '../sketch-geometry.json', 'utf8'));
const rc = JSON.parse(readFileSync(HERE + 'audit/row-cases.json', 'utf8'));
const n6 = (v) => Number(v.toPrecision(8)).toString();
const isCustom = (r) => !!r.custom || (r.summary !== undefined && r.doc === undefined);
const sentOf = (r) => {
  if (!r) return null;
  if (r.outcome === 'SCRIPT-REFUSED') return (r.scriptErrorsPlain ?? r.scriptErrors)?.[0]?.replace(/^line \d+: /, '') ?? null;
  if (r.truck?.refused !== undefined) return r.truck.refused;
  if (isCustom(r) && r.summary) return (typeof r.summary.truck === 'string' ? r.summary.truck.replace(/^refused: /, '') : null) ?? (typeof r.summary.lastFeature === 'string' && r.summary.lastFeature.startsWith('refused: ') ? r.summary.lastFeature.slice(9) : null);
  return null;
};
const builtVol = (r) => r?.truck?.volume ?? (typeof r?.summary?.truck?.volume === 'number' ? r.summary.truck.volume : undefined);
// a custom (non-prism) measurement is clean unless it says it refused, failed or was wrong
const cleanPass = (r) => (r.outcome === 'PASS' || r.outcome === 'PASS-FACES-DIFFER' || (isCustom(r) && !/REFUSED|FAIL|WRONG|ERROR|MISMATCH/.test(r.outcome ?? 'ERROR'))) && sentOf(r) === null;
const problems = []; const report = [];
if (rc.length !== doc.rows.length) problems.push(`audit/row-cases.json has ${rc.length} rows, the rows file ${doc.rows.length}: rerun build-rows.mjs`);
doc.rows.forEach((row, i) => {
  const ev = row.evidence ?? ''; const p = (m) => problems.push(`row ${i} [${row.status}] (${row.feature.slice(0, 70)}): ${m}`);
  const ids = rc[i]?.ids ?? [];
  const cmds = [...new Set([...ev.matchAll(/CMD\[([\w-]+):/g)].map((m) => m[1]))];
  const rawControl = /\[raw translator/.test(row.feature);
  for (const c of cmds) { if (!existsSync(`${HERE}results/${c === 'control-noprofiles' ? 'ctl-noprofiles' : c}.json`)) p(`CMD ${c}: results/${c}.json does not exist`); if (!rawControl && c !== 'control-noprofiles' && !existsSync(`${HERE}results-guarded/${c}.json`)) p(`CMD ${c}: results-guarded/${c}.json does not exist`); }
  const kinds = {};
  for (const id of ids) {
    const g = GM.get(id), b = BM.get(id);
    if (!g && !(b && (rawControl || id.startsWith('ctl-')))) { p(`reads case ${id}, which is in no results-guarded file`); continue; }
    const r = g ?? b; const k = sentOf(r) !== null ? 'refused' : cleanPass(r) ? 'pass' : 'other'; kinds[k] = (kinds[k] ?? 0) + 1;
    if (id.startsWith('ctl-') && row.status === 'supported') { const v = builtVol(b); if (!/negative control/.test(ev) || v === undefined || !(ev.includes(n6(v)) || ev.includes(String(Number(v.toPrecision(8)))))) p(`negative control ${id}: the evidence does not quote its measured volume ${v === undefined ? '(none)' : n6(v)}`); continue; }
    if (row.status === 'supported' && k !== 'pass' && !ev.includes(id) && !(sentOf(r) && ev.includes(sentOf(r).slice(0, 60)))) p(`supported, but case ${id} is ${k} in the guarded run (${r.outcome}) and the evidence names neither it nor its sentence`);
  }
  // 3. case lines printed in the evidence
  const without = ev.indexOf('Without it: '); const guardedText = without >= 0 ? ev.slice(0, without) + ev.slice(ev.indexOf(' CMD[', without) >= 0 ? ev.indexOf(' CMD[', without) : ev.length) : ev;
  for (const m of guardedText.matchAll(/(?:^|[ ;.(])([A-Za-z][\w.-]*): (truck ([\d.e+-]+) mm3|refused with|script refused)/g)) {
    if (m[1] === 'guard' || m[1] === 'Guard') continue; /* the words 'Before the guard: refused with ...' */ const r = GM.get(m[1]); if (!r) { if (!BM.has(m[1])) p(`evidence line names ${m[1]}: in no results file`); continue; }
    if (m[3] !== undefined) { const v = builtVol(r); if (v === undefined) p(`${m[1]}: evidence says built ${m[3]}; guarded result is ${r.outcome}: ${(sentOf(r) ?? '').slice(0, 70)}`); else if (n6(v) !== m[3]) p(`${m[1]}: evidence volume ${m[3]} != stored ${n6(v)}`); }
    else if (sentOf(r) === null) p(`${m[1]}: evidence says refused; guarded result is ${r.outcome}`);
  }
  if (row.status === 'refused') {
    // the sentence is stored on the case (truck.refused, scriptErrorsPlain, or inside a custom measurement's summary / pieceNote): search the whole guarded record
    const blobs = ids.map((id) => JSON.stringify(GM.get(id) ?? BM.get(id) ?? {}));
    for (const part of new Set(row.refusalSentence.split(' | '))) { const bare = part.replace(/^[a-z .0-9-]+: (?=[A-Za-z.])/i, ''); const q = JSON.stringify(bare).slice(1, -1); if (!blobs.some((b) => b.includes(q))) p(`refusal sentence is in no case record the row read: "${part.slice(0, 90)}"`); }
  }
  if (rawControl || /raw translator/.test(ev.slice(0, 400))) for (const m of ev.matchAll(/([A-Za-z][\w.-]*): raw truck ([\d.e+-]+) mm3/g)) { const r = BM.get(m[1]); const v = builtVol(r); if (v === undefined) p(`${m[1]}: evidence quotes a raw build, results/ has none`); else if (n6(v) !== m[2]) p(`${m[1]}: raw volume ${m[2]} != results/ ${n6(v)}`); }
  if (row.status === 'wrong' && !rawControl && !/raw translator/.test(row.feature) && !kinds.other && !/WRONG|wrong/.test(ev) && !(kinds.pass < ids.length)) p('wrong row, but every case it read is a clean pass and the evidence does not say wrong');
  if (row.status === 'unsupported' && !/not supported|unsupported|cannot|no |not /i.test(ev)) p('unsupported row whose evidence never says so');
  report.push({ row: i, status: row.status, cases: ids.length, kinds, cmds });
});
writeFileSync(HERE + 'audit/audit-evidence.json', JSON.stringify({ rows: doc.rows.length, casesRead: new Set(rc.flatMap((r) => r.ids)).size, problems, report }, null, 1));
console.log(`rows ${doc.rows.length} opened, distinct cases read ${new Set(rc.flatMap((r) => r.ids)).size}, problems ${problems.length}, rows reading no case ${report.filter((r) => r.cases === 0).map((r) => r.row).join(',') || 'none'}`);
for (const x of problems) console.log(x);
process.exit(problems.length ? 1 : 0);
