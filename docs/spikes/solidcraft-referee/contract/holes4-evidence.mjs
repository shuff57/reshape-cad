// Shared evidence/assertion helpers for holes4-rows.mjs (round 4): compact, number-bearing evidence strings from a holes4-results.json record, and the status checks.
//
// ROUND 4 changes against holes3-evidence.mjs:
//   * ONE time policy for the whole group: the page enforces a 45 s CPU budget per engine run (G-BUDGET, holes4-sc.mjs). A case is `supported` only if EVERY recorded run
//     of the whole translation (guard probes and replays included, `translateCpuMs`) and of the final command list (`finalCpuMs`) finished inside 45 s CPU, i.e. the
//     watchdog never fired on it. The old split (30 s in the rows, 45 s in RIG.md, a 43.5 s sphere called supported) is gone. Rows whose slowest run is over 80% of the
//     budget say so in the evidence (BORDERLINE).
//   * recess rows are compared with the recess-aware OCCT oracle (holes4-oracle.mjs, `occt2`), not with a numeric grid.
//   * script errors are quoted VERBATIM (what packages/script emits); the one-sentence rewrite is shown separately as a proposal.
export const CURVED = 3e-4; // truck volume/bbox of curved solids are tessellation-derived (~1e-4)
export const CPU_BUDGET_MS = 45000;
export const BORDER_MS = 0.8 * CPU_BUDGET_MS;
export const e = (v) => (typeof v === 'number' ? (v === 0 ? '0' : v.toExponential(1)) : '-');
export const n4 = (v) => (typeof v === 'number' ? v.toFixed(4) : '-');
const PLATE = "const s1 = sketch('top'); s1.polygon([[0,0],[40,0],[40,30],[0,30]]); const plate = extrude(s1, 10);";
const BOX = 'const b = cuboid(40, 40, 20); ';
export const short = (s) => s.replace(PLATE, 'PLATE;').replace(BOX, 'BOX;').replace(/\s+/g, ' ').trim();
export const isRecess = (r) => !!(r.lastFeature?.counterbore || r.lastFeature?.countersink) || !!r.occt2;
/** number of sentences in a text (the interpreter's two-sentence messages count as 2) */
export const sentences = (t) => String(t).replace(/\b\d+\.\d+/g, 'N').replace(/\be\.g\./g, 'eg').split(/[.!?]["')\]]?\s+(?=[A-Za-z{])/).filter((x) => x.trim()).length;

/** per-surface-type face census: "plane 7/7 cylinder 2/3 [cylinder: truck-splits-open-cylinder-patch-over-180deg]" against the oracle that cuts the recess too */
export function faceText(r) {
  const o = r.occt2 && !r.occt2.refused ? r.occt2 : r.occt; const t = r.truck;
  if (!o || o.refused || !t || t.faceTypes === undefined) return '';
  const keys = new Set([...Object.keys(o.types ?? {}), ...Object.keys(t.faceTypes ?? {})]);
  const per = [...keys].map((k) => `${k} ${o.types?.[k] ?? 0}/${t.faceTypes?.[k] ?? 0}`).join(' ');
  const fv = (r.occt2 && !r.occt2.refused ? r.cmp?.vsOcct2 : r.cmp?.vsOcct)?.faceVerdict;
  const expl = fv ? Object.entries(fv.keys).filter(([, v]) => v !== 'equal').map(([k, v]) => `${k}: ${v}`).join('; ') : '';
  return `faces ${r.occt2 ? 'OCCT-with-recess' : 'OCCT'}/truck ${o.faces}/${t.faces} (${per})${expl ? ` EXPLAINED [${expl}]` : ''}${fv && !fv.ok ? ' UNEXPLAINED' : ''}`;
}

/** the slowest recorded run of a case, in ms: whole translation or final command list, over every run in cpuRuns */
export const slowest = (r) => Math.max(0, ...(r.cpuRuns ?? []).flat(), r.finalCpuMs ?? 0, r.translateCpuMs ?? 0);

export function ev(r) {
  const s = short(r.script);
  if (r.verdict === 'timeout') return `${r.id}: [${s}] -> no result within ${r.timeoutSeconds} s wall (process killed)`;
  if (r.verdict === 'crash') return `${r.id}: [${s}] -> the process crashed`;
  if (r.verdict === 'script-error') {
    const raw = (r.scriptErrors ?? [r.scriptThrew])[0];
    const prop = r.plainScriptErrors && r.plainScriptErrors[0] !== raw ? ` (a one-sentence rewrite a page MAY adopt, plainScriptError: "${r.plainScriptErrors[0]}")` : '';
    return `${r.id}: [${s}] -> interpreter error, shown verbatim, ${sentences(raw)} sentence${sentences(raw) === 1 ? '' : 's'}: "${raw}"${prop}`;
  }
  const rec = isRecess(r);
  const o2 = r.occt2 && !r.occt2.refused ? r.occt2 : null;
  const oc = r.occt?.refused ? `OCCT refused "${r.occt.refused}"` : `OCCT${rec ? ' (repo referee: ignores the recess, plain bore)' : ''} V=${n4(r.occt?.volume)}${r.occt?.solids !== undefined ? ` (${r.occt.solids} solid${r.occt.solids === 1 ? '' : 's'}, ${r.occt.faces} faces)` : ''}`;
  const oc2 = o2 ? `; OCCT-with-recess (holes4-oracle.mjs, exact) V=${n4(o2.volume)} (${o2.solids} solid${o2.solids === 1 ? '' : 's'}, ${o2.faces} faces)` : (r.occt2?.refused ? `; recess oracle failed: ${r.occt2.refused}` : '');
  const br = r.brep?.refused ? `brep-rs refused "${r.brep.refused}"` : `brep-rs V=${n4(r.brep?.volume)} (${r.brep?.faces} faces)`;
  const fc = r.fc ? `; FreeCAD V=${n4(r.fc.volume)} faces=${r.fc.faces}` : '';
  const cl = r.closed?.volume !== undefined ? `; closed form V=${n4(r.closed.volume)}` : '';
  const runs = (r.cpuRuns?.length ?? 0) > 1 ? ` (${r.cpuRuns.length} runs, slowest of translation/final per run: ${r.cpuRuns.map((v) => (Math.max(...v) / 1000).toFixed(1)).join(', ')} s)` : '';
  const sl = slowest(r);
  const cpu = typeof r.translateCpuMs === 'number' ? ` [truck CPU: ${(r.translateCpuMs / 1000).toFixed(1)} s for the whole translation incl. guard probes${typeof r.finalCpuMs === 'number' ? `, ${(r.finalCpuMs / 1000).toFixed(1)} s for the final command list` : ''}${runs}; slowest ${(sl / 1000).toFixed(1)} s of the ${CPU_BUDGET_MS / 1000} s budget${sl > BORDER_MS ? ' BORDERLINE' : ''}]` : '';
  if (r.verdict === 'truck-refused') {
    const u = r.truck.unguarded; const g = r.truck.guard ? ` [guard ${r.truck.guard}]` : '';
    const ug = u ? ` UNGUARDED truck result for this hole: V=${n4(u.volume)} ${u.bodies} body(ies) holding total V=${n4(u.allVolume)}, ${u.shells} shell(s), ${u.faces} faces` : '';
    const ugt = r.unguardedTruck;
    const ug2 = ugt ? ` UNGUARDED phase-0 translator: ${ugt.timeout ? `NO RESULT within ${ugt.timeoutCpuSeconds ?? '?'} s of CPU (killed; a hang)` : ugt.refused ? `refused "${ugt.refused}"` : `ok:true V=${n4(ugt.volume)} (${ugt.faces} faces, bbox ${JSON.stringify(ugt.bbox?.map((v) => +v.toFixed(4)))}, layer reports ${ugt.reportedBodies} body, engine holds ${ugt.allBodies} body(ies) of total V=${n4(ugt.allVolume)}, shells ${JSON.stringify(ugt.shells)}, ${((ugt.cpuMs ?? 0) / 1000).toFixed(1)} s CPU)`}.` : '';
    const raw = r.truck.raw ? ` raw engine text kept for the log: "${String(r.truck.raw).slice(0, 160)}"` : '';
    return `${r.id}: [${s}] -> student sees "${r.truck.refused}"${g}${ug}${ug2}${raw}; ${oc}${oc2}; ${br}${fc}${cl}${cpu}`;
  }
  const c = r.cmp ?? {}; const o = o2 ? c.vsOcct2 : c.vsOcct;
  const nums = o ? `dVol(${o2 ? 'OCCT-with-recess' : 'OCCT'})=${e(o.dVol)} dBbox=${e(o.dBbox)} dCOM=${e(o.dCom)} ${faceText(r)}` : '';
  const extra = [c.vsBrep ? `dVol(brep)=${e(c.vsBrep.dVol)}${c.vsBrep.faces ? ` faces brep/truck ${c.vsBrep.faces}` : ''}` : '', c.vsClosed ? `dVol(closed)=${e(c.vsClosed.dVol)}${c.vsClosed.dRemoved !== undefined ? ` dRemoved(closed)=${e(c.vsClosed.dRemoved)}` : ''}` : '', c.vsFc ? `dVol(FC)=${e(c.vsFc.dVol)} dBbox(FC)=${e(c.vsFc.dBbox)} faces FC/truck ${c.vsFc.faces}` : ''].filter(Boolean).join(' ');
  const dropped = r.droppedBodies?.length ? `; DROPPED bodies ${r.droppedBodies.map((b) => b.name).join(',')}` : '';
  return `${r.id}: [${s}] -> truck V=${n4(r.truck.volume)} (${r.truck.bodies} body, ${r.truck.shells} shell${dropped}); ${oc}${oc2}; ${br}${fc}${cl}; ${nums} ${extra}${cpu}`.trim();
}

/** why a built case is NOT a clean 'supported' (null when it is) */
export function okBuilt(r, { allowTimeMs = CPU_BUDGET_MS } = {}) {
  if (r.verdict !== 'truck-built') return `not built (${r.verdict})`;
  if (r.truck.bodies !== 1 || (r.droppedBodies?.length ?? 0) || (r.allBodies?.length ?? 1) !== 1) return 'more than one body';
  if (r.truck.shells !== undefined && r.truck.shells !== 1 && !r.expectShells) return `shells ${r.truck.shells}`;
  const rec = isRecess(r);
  const c = r.cmp ?? {}; const o = rec ? c.vsOcct2 : c.vsOcct;
  if (rec && !o) return 'recess case without a recess-aware OCCT result';
  if (o && !(o.dVol <= CURVED && o.dBbox <= CURVED && o.dCom <= 3e-5)) return `disagrees with OCCT${rec ? '-with-recess' : ''} dVol=${o.dVol} dBbox=${o.dBbox} dCom=${o.dCom}`;
  if (o && !o.faceVerdict.ok) return `unexplained face-type mismatch vs OCCT${rec ? '-with-recess' : ''}`;
  if (rec && o && o.solids !== 1) return `OCCT-with-recess holds ${o.solids} solids`;
  if (!c.vsBrep && !c.vsClosed && !c.vsFc && !o) return 'no oracle that cuts this built it';
  if (c.vsBrep && !(c.vsBrep.dVol <= CURVED)) return `disagrees with brep-rs ${c.vsBrep.dVol}`;
  if (rec && r.fc?.faces !== undefined && c.vsFc && r.fc.faces !== r.truck.faces && !(o && o.faceVerdict.ok)) return `face count ${r.truck.faces} differs from FreeCAD ${r.fc.faces}`;
  if (c.vsClosed && !(c.vsClosed.dVol <= CURVED)) return `disagrees with closed form ${c.vsClosed.dVol}`;
  if (c.vsClosed?.dRemoved !== undefined && !(c.vsClosed.dRemoved <= 2e-3 || (c.vsClosed.dRemoved * c.vsClosed.removedClosed <= CURVED * (r.truckPrevVolume ?? 0)))) return `removed volume disagrees with closed form ${c.vsClosed.dRemoved}`;
  if (c.vsFc && !(c.vsFc.dVol <= CURVED && c.vsFc.dBbox <= CURVED)) return `disagrees with FreeCAD ${c.vsFc.dVol}`;
  const sl = slowest(r);
  if (sl > allowTimeMs) return `slowest recorded run ${(sl / 1000).toFixed(0)} s CPU is over the ${allowTimeMs / 1000} s budget`;
  return null;
}
export const refusedOk = (r, { script = false } = {}) => {
  if (r.verdict === 'script-error') return null; // verbatim interpreter text: sentence count is reported, not asserted
  if (r.verdict !== 'truck-refused') return `expected a refusal, got ${r.verdict}`;
  const l = (r.lint ?? []).flatMap((x) => x.problems);
  return l.length ? `sentence lint: ${JSON.stringify(r.lint)}` : null;
};
