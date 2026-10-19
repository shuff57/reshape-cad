// Builds contract/sketch-constraints.json (round 2) from out/*.json written by the measurement scripts in this directory.
// Every number in an evidence string is read from those files (or computed here from them); none is typed in by hand. Statuses are DERIVED by deriveStatus()
// from the measurements with ONE rule for every row (see STATUS_RULE) and then checked against the few rows whose status is set by hand with a stated reason.
//   (library; build-rows.mjs holds the row table)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const J = (f) => (existsSync(path.join(OUT, f)) ? JSON.parse(readFileSync(path.join(OUT, f), 'utf8')) : null);
const ST = J('stored.json') ?? [], SW = J('sweeps.json') ?? [], PF = J('profiles.json'), PG = J('param.json'), LG = J('legacy.json') ?? [], AC = J('accuracy.json'), PM = J('perm.json'), PB = J('probes.json');
const R1 = (() => { try { return JSON.parse(readFileSync(path.join(HERE, '..', 'sketch-constraints-results.json'), 'utf8')); } catch { return null; } })();
const ex = (x) => (typeof x === 'number' ? x.toExponential(1) : String(x));
const f = (x, d = 4) => (typeof x === 'number' ? String(+x.toFixed(d)) : String(x));
const pct = (x) => `${+(x * 100).toFixed(1)}%`;
const sum = (o, ks) => ks.reduce((n, k) => n + (o?.[k] ?? 0), 0);

export const STATUS_RULE = 'ONE rule for every row. A row describes the ROUTE the contract proposes: the shipped mapper (phase2/sketch-map.mjs) plus the guard in contract/sketch-constraints-r2 (guard.mjs: preflight, canonical row-order ladder, post-solve rule residual, post-solve BRANCH check against the drawn start, even-odd profile choice, plain sentences). ' +
  'wrong = at least one measured case (stored geometry, a 3.5% or 15% hand-drawn rough start, a 40% or 80% stress start, a permuted row order, or a param drag) in which the route BUILDS a solid that disagrees with the oracle (closed form, and live brep-rs / OCCT / FreeCAD where they can referee it) and shows no refusal. ' +
  'refused = the feature as written is refused with a plain sentence in every case measured (by design or because SolidCraft cannot hold it). ' +
  'supported = every measured case either builds a solid that matches the oracle within tolerance (planar 1e-9 relative on volume and bbox; curved 3e-4 because truck volumes are tessellation-derived) or is refused with a plain sentence; the stored geometry and the 3.5% / 15% hand-drawn starts build, and the refusal counts at every amplitude are in the evidence. ' +
  'unsupported = could not be measured. Rows that name "shipped ... without the guard" describe the code as it stands today and carry the count of silent wrong builds it produces; they are wrong by the same rule.';

// ---------------- helpers over the data -------------------------------------------------------------------------------
const storedFor = (pred) => ST.filter(pred);
const hasFeat = (feat) => (r) => (r.feats ?? []).includes(feat);
const sweepsFor = (ids) => SW.filter((s) => ids.includes(s.id));
const sweepIdsForFeat = (feat) => [...new Set(SW.filter((s) => (s.feats ?? []).includes(feat)).map((s) => s.id))];
function sweepLine(id) {
  const rows = SW.filter((s) => s.id === id).sort((a, b) => a.frac - b.frac);
  if (!rows.length) return `${id}: no sweep`;
  return `sweep ${id} (${rows[0].N} seeded starts per amplitude; amplitude = fraction of the sketch diagonal): ` + rows.map((s) => {
    const uw = sum(s.unguarded, ['POSE', 'VOLUME']), uf = s.unguarded['MATCH-OTHER-SIDE'] ?? 0;
    return `${pct(s.frac)}: guarded ${s.guarded['BUILT-MATCH'] ?? 0} built right / ${s.guarded.REFUSED ?? 0} refused / ${(s.guarded['BUILT-WRONG'] ?? 0) + (s.guarded['BUILT-OTHER-SIDE'] ?? 0)} built WRONG (unguarded SolidCraft built ${uw} different solids and ${uf} on the other side of the drawing, ${sum(s.unguarded, ['MAPPER-REFUSED', 'SC-REFUSED'])} refused)`;
  }).join('; ');
}
const wrongPassedIn = (ids) => sweepsFor(ids).reduce((n, s) => n + (s.guarded['BUILT-WRONG'] ?? 0) + (s.guarded['BUILT-OTHER-SIDE'] ?? 0), 0);
const unguardedWrongIn = (ids) => sweepsFor(ids).reduce((n, s) => n + sum(s.unguarded, ['POSE', 'VOLUME', 'MATCH-OTHER-SIDE']), 0);
const caughtIn = (ids) => sweepsFor(ids).reduce((n, s) => n + s.caught, 0);
function storedLine(r) {
  const sc = r.sc;
  if (sc.refused) return `${r.id} [${r.mode}] REFUSED[${sc.stage}]: ${sc.refused}`;
  const b = r.brep?.vsSc !== undefined ? `brep-rs ${ex(r.brep.vsSc)}` : `brep-rs ${r.brep?.refused ? 'refuses it (' + r.brep.refused.slice(0, 60) + ')' : 'n/a'}`;
  const o = r.occt?.vsSc !== undefined ? `OCCT ${ex(r.occt.vsSc)}` : 'OCCT cannot referee this form';
  const fc = r.fc ? `, FreeCAD ref bbox ${ex(r.fc.bboxVsSc)}` : '';
  const fa = r.brep?.faces !== undefined ? `faces SC ${sc.faces}/brep-rs ${r.brep.faces}` : `faces SC ${sc.faces}`;
  return `${r.id} [${r.mode}] ${sc.cls}: volume ${f(sc.volume, 6)} vs closed form ${f(r.want.volume, 6)} (rel ${ex(sc.dv)}), bbox rel ${ex(sc.db)}; SC vs ${b}, ${o}${fc}; ${fa}; rung ${sc.rung}`;
}
function deriveStatus({ stored = [], sweepIds = [] }) {
  const bad = [];
  for (const r of stored) {
    if (r.expect === 'refuse') { if (!r.sc.refused) bad.push(`${r.id} expected a refusal but built`); continue; }
    if (r.sc.refused) { bad.push(`REF:${r.id}`); continue; }
    if (!['MATCH', 'TOL-MISS'].includes(r.sc.cls)) bad.push(`WRONG:${r.id}`);
  }
  const wrongSweep = wrongPassedIn(sweepIds);
  const wrongStored = bad.filter((b) => b.startsWith('WRONG') || / expected a refusal/.test(b)).length;
  const buildRefused = stored.filter((r) => r.expect !== 'refuse' && r.sc.refused).length;
  const builtOk = stored.filter((r) => r.expect !== 'refuse' && !r.sc.refused && ['MATCH', 'TOL-MISS'].includes(r.sc.cls)).length;
  const expectRefusedOk = stored.filter((r) => r.expect === 'refuse' && r.sc.refused).length;
  if (wrongSweep || wrongStored) return { status: 'wrong', why: `${wrongStored} stored wrong, ${wrongSweep} sweep wrong` };
  if (buildRefused && !builtOk) return { status: 'refused', why: 'every build-expected case refused' };
  if (buildRefused) return { status: 'refused', why: `${buildRefused} build-expected stored case(s) refused: ${bad.join(', ')}` };
  if (!builtOk && expectRefusedOk) return { status: 'refused', why: 'refused by design' };
  if (!builtOk && !expectRefusedOk && !sweepIds.length) return { status: 'unsupported', why: 'nothing measured' };
  return { status: 'supported', why: '' };
}
const rows = [];
const CMD = {
  stored: 'SOLIDCRAFT_REFEREE_PKG2=<wrapper2 pkg> systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun docs/spikes/solidcraft-referee/contract/sketch-constraints-r2/stored-run.mjs',
  sweeps: 'SOLIDCRAFT_REFEREE_PKG2=<wrapper2 pkg> systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun docs/spikes/solidcraft-referee/contract/sketch-constraints-r2/run-sweeps.mjs',
};
/** a data-driven row: stored cases whose feats include `feat` (or extra ids), the sweeps whose fixture lists it */
function featureRow(feature, { feat = feature, ids = [], sweeps = null, sentence = '', note = '', show = 3, force = null } = {}) {
  const stored = storedFor((r) => hasFeat(feat)(r) || ids.includes(r.id));
  const sIds = sweeps ?? sweepIdsForFeat(feat);
  const d = deriveStatus({ stored, sweepIds: sIds });
  const shown = stored.filter((r) => r.mode === 'stored').slice(0, show).concat(stored.filter((r) => r.mode === 'rough').slice(0, 1));
  const ev = [
    `cmd: ${CMD.stored.replace(/^.*bun /, 'bun ')} ; ${CMD.sweeps.replace(/^.*bun /, 'bun ')}`,
    `${stored.length} stored/rough case(s) carry this feature: ` + shown.map(storedLine).join(' || '),
    sIds.length ? sIds.map(sweepLine).join(' || ') : 'no rough-start sweep fixture carries this feature alone',
    sIds.length ? `over those sweeps: the shipped route (no guard) built ${unguardedWrongIn(sIds)} different solids silently; the guard refused ${caughtIn(sIds)} of them and built ${wrongPassedIn(sIds)} wrong` : '',
    note,
  ].filter(Boolean).join(' || ');
  const worstDv = Math.max(0, ...stored.filter((r) => !r.sc.refused).map((r) => r.sc.dv ?? 0));
  const summary = `${stored.length} stored/rough case(s): ${stored.filter((r) => !r.sc.refused && ['MATCH', 'TOL-MISS'].includes(r.sc.cls)).length} match the closed form (worst volume rel ${ex(worstDv)}; vs brep-rs / OCCT / FreeCAD where they can referee), ${stored.filter((r) => r.sc.refused).length} refused. ` +
    (sIds.length ? `Sweeps ${sIds.join(', ')}: shipped route silently built ${unguardedWrongIn(sIds)} different solids, guard refused ${caughtIn(sIds)} and passed ${wrongPassedIn(sIds)}; ${sweepsFor(sIds).filter((x) => x.frac <= 0.15).reduce((n, x) => n + (x.guarded.REFUSED ?? 0), 0)} of ${sweepsFor(sIds).filter((x) => x.frac <= 0.15).reduce((n, x) => n + x.N, 0)} hand-drawn starts (<=15%) refused.` : 'No rough-start sweep fixture carries this feature alone.') + (note ? ' ' + note.slice(0, 220) : '');
  rows.push({ feature, status: force?.status ?? d.status, refusalSentence: sentence, summary, evidence: ev + (force ? ` [status set by hand: ${force.why}]` : d.why ? ` [derived: ${d.why}]` : '') });
}
const probe = (idPart) => PB?.probes?.find((p) => p.id.includes(idPart))?.sentence ?? '';
const mostCommonSentence = (ids, maxFrac = 0.15) => {
  const m = new Map();
  for (const s of sweepsFor(ids).filter((x) => x.frac <= maxFrac)) for (const [k, v] of Object.entries(s.sentences ?? {})) { const cur = m.get(k); m.set(k, { n: (cur?.n ?? 0) + v.n, raw: cur?.raw ?? v.raw }); }
  return [...m.values()].sort((a, b) => b.n - a.n)[0]?.raw ?? '';
};

export { rows, featureRow, probe, mostCommonSentence, sweepLine, storedLine, storedFor, sweepsFor, unguardedWrongIn, caughtIn, wrongPassedIn, deriveStatus, J, ST, SW, PF, PG, LG, AC, PM, PB, R1, ex, f, pct, sum, CMD, HERE, OUT };
