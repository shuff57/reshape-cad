// Shared evidence/assertion helpers for holes3-rows.mjs: compact, number-bearing evidence strings from a holes3-results.json record, and the status checks.
export const CURVED = 3e-4; // truck volume/bbox of curved solids are tessellation-derived (~1e-4)
export const CPU_BUDGET_MS = 30000; // policy: a bore that needs more than 30 s of single-thread CPU in truck is not an interactive feature (CPU time, so load does not matter)
export const e = (v) => (typeof v === 'number' ? (v === 0 ? '0' : v.toExponential(1)) : '-');
export const n4 = (v) => (typeof v === 'number' ? v.toFixed(4) : '-');
const PLATE = "const s1 = sketch('top'); s1.polygon([[0,0],[40,0],[40,30],[0,30]]); const plate = extrude(s1, 10);";
const BOX = 'const b = cuboid(40, 40, 20); ';
export const short = (s) => s.replace(PLATE, 'PLATE;').replace(BOX, 'BOX;').replace(/\s+/g, ' ').trim();
export const isRecess = (r) => !!(r.lastFeature?.counterbore || r.lastFeature?.countersink);

/** per-surface-type face census: "plane 7/7 cylinder 2/3 [cylinder: truck-splits-open-cylinder-patch-over-180deg]" */
export function faceText(r) {
  const o = r.occt; const t = r.truck;
  if (!o || o.refused || !t || t.faceTypes === undefined) return '';
  const keys = new Set([...Object.keys(o.types ?? {}), ...Object.keys(t.faceTypes ?? {})]);
  const per = [...keys].map((k) => `${k} ${o.types?.[k] ?? 0}/${t.faceTypes?.[k] ?? 0}`).join(' ');
  const fv = r.cmp?.vsOcct?.faceVerdict;
  const expl = fv ? Object.entries(fv.keys).filter(([, v]) => v !== 'equal').map(([k, v]) => `${k}: ${v}`).join('; ') : '';
  return `faces OCCT/truck ${o.faces}/${t.faces} (${per})${expl ? ` EXPLAINED [${expl}]` : ''}${fv && !fv.ok ? ' UNEXPLAINED' : ''}`;
}

export function ev(r) {
  const s = short(r.script);
  if (r.verdict === 'timeout') return `${r.id}: [${s}] -> no result within ${r.timeoutSeconds} s wall (process killed)`;
  if (r.verdict === 'crash') return `${r.id}: [${s}] -> the process crashed`;
  if (r.verdict === 'script-error') return `${r.id}: [${s}] -> script error "${(r.scriptErrors ?? [r.scriptThrew])[0]}"${r.plainScriptErrors && r.plainScriptErrors[0] !== r.scriptErrors[0] ? ` => shown to the student as "${r.plainScriptErrors[0]}"` : ''}`;
  const rec = isRecess(r);
  const oc = r.occt?.refused ? `OCCT refused "${r.occt.refused}"` : `OCCT${rec ? ' (ignores the recess: plain bore)' : ''} V=${n4(r.occt?.volume)}${r.occt?.solids !== undefined ? ` (${r.occt.solids} solid${r.occt.solids === 1 ? '' : 's'}, ${r.occt.faces} faces)` : ''}`;
  const br = r.brep?.refused ? `brep-rs refused "${r.brep.refused}"` : `brep-rs V=${n4(r.brep?.volume)} (${r.brep?.faces} faces)`;
  const fc = r.fc ? `; FreeCAD V=${n4(r.fc.volume)} faces=${r.fc.faces}` : '';
  const cl = r.closed?.volume !== undefined ? `; closed form V=${n4(r.closed.volume)}` : '';
  const runs = r.cpuAll && r.cpuAll.length > 1 ? ` (${r.cpuAll.length} runs: ${r.cpuAll.map((v) => (v / 1000).toFixed(1)).join(', ')} s; best ${(r.cpuBest / 1000).toFixed(1)} s)` : '';
  const cpu = typeof r.finalCpuMs === 'number' ? ` [truck CPU ${(r.finalCpuMs / 1000).toFixed(1)} s for the final command list${runs}, ${(r.translateCpuMs / 1000).toFixed(1)} s for the whole translation incl. guard probes]` : (typeof r.translateCpuMs === 'number' ? ` [truck CPU ${(r.translateCpuMs / 1000).toFixed(1)} s for the translation]` : '');
  if (r.verdict === 'truck-refused') {
    const u = r.truck.unguarded; const g = r.truck.guard ? ` [guard ${r.truck.guard}]` : '';
    const ug = u ? ` UNGUARDED truck result for this hole: V=${n4(u.volume)} ${u.bodies} body(ies) holding total V=${n4(u.allVolume)}, ${u.shells} shell(s), ${u.faces} faces` : '';
    const ug2 = r.unguardedTruck ? ` UNGUARDED phase-0 translator: ${r.unguardedTruck.refused ? `refused "${r.unguardedTruck.refused}"` : `ok:true V=${n4(r.unguardedTruck.volume)} (${r.unguardedTruck.faces} faces, layer reports ${r.unguardedTruck.reportedBodies} body, engine holds ${r.unguardedTruck.allBodies} body(ies) of total V=${n4(r.unguardedTruck.allVolume)}, shells ${JSON.stringify(r.unguardedTruck.shells)})`}.` : '';
    const raw = r.truck.raw ? ` raw engine text kept for the log: "${String(r.truck.raw).slice(0, 160)}"` : '';
    return `${r.id}: [${s}] -> student sees "${r.truck.refused}"${g}${ug}${ug2}${raw}; ${oc}; ${br}${fc}${cl}${cpu}`;
  }
  const c = r.cmp ?? {}; const o = c.vsOcct;
  const nums = o && !rec ? `dVol(OCCT)=${e(o.dVol)} dBbox=${e(o.dBbox)} dCOM=${e(o.dCom)} ${faceText(r)}` : (rec ? faceText(r) : '');
  const extra = [c.vsBrep ? `dVol(brep)=${e(c.vsBrep.dVol)}${c.vsBrep.faces ? ` faces brep/truck ${c.vsBrep.faces}` : ''}` : '', c.vsClosed ? `dVol(closed)=${e(c.vsClosed.dVol)}${c.vsClosed.dRemoved !== undefined ? ` dRemoved(closed)=${e(c.vsClosed.dRemoved)}` : ''}` : '', c.vsFc ? `dVol(FC)=${e(c.vsFc.dVol)} dBbox(FC)=${e(c.vsFc.dBbox)} faces FC/truck ${c.vsFc.faces}` : ''].filter(Boolean).join(' ');
  const dropped = r.droppedBodies?.length ? `; DROPPED bodies ${r.droppedBodies.map((b) => b.name).join(',')}` : '';
  return `${r.id}: [${s}] -> truck V=${n4(r.truck.volume)} (${r.truck.bodies} body, ${r.truck.shells} shell${dropped}); ${oc}; ${br}${fc}${cl}; ${nums} ${extra}${cpu}`.trim();
}

/** why a built case is NOT a clean 'supported' (null when it is) */
export function okBuilt(r, { allowTimeMs = CPU_BUDGET_MS } = {}) {
  if (r.verdict !== 'truck-built') return `not built (${r.verdict})`;
  if (r.truck.bodies !== 1 || (r.droppedBodies?.length ?? 0) || (r.allBodies?.length ?? 1) !== 1) return 'more than one body';
  if (r.truck.shells !== undefined && r.truck.shells !== 1 && !r.expectShells) return `shells ${r.truck.shells}`;
  const rec = isRecess(r);
  const c = r.cmp ?? {}; const o = c.vsOcct;
  if (!rec && o && !(o.dVol <= CURVED && o.dBbox <= CURVED && o.dCom <= 3e-5)) return `disagrees with OCCT dVol=${o.dVol} dBbox=${o.dBbox} dCom=${o.dCom}`;
  if (!rec && o && !o.faceVerdict.ok) return 'unexplained face-type mismatch vs OCCT';
  if (rec && o && o.dBbox > CURVED) return `bbox disagrees with OCCT ${o.dBbox}`;
  if (!c.vsBrep && !c.vsClosed && !c.vsFc && (rec || !o)) return 'no oracle that cuts this built it';
  if (c.vsBrep && !(c.vsBrep.dVol <= CURVED)) return `disagrees with brep-rs ${c.vsBrep.dVol}`;
  if (rec && r.brep?.faces !== undefined && c.vsBrep && r.brep.faces !== r.truck.faces) return `face count ${r.truck.faces} differs from brep-rs ${r.brep.faces}`;
  if (rec && r.fc?.faces !== undefined && c.vsFc && r.fc.faces !== r.truck.faces) return `face count ${r.truck.faces} differs from FreeCAD ${r.fc.faces}`;
  if (c.vsClosed && !(c.vsClosed.dVol <= CURVED)) return `disagrees with closed form ${c.vsClosed.dVol}`;
  // removed volume = previous volume - volume, a difference of two truck volumes: on a curved host each carries ~1e-4 of tessellation noise of the WHOLE host, so there the
  // bar is 3e-4 of the host volume (absolute), on a planar host 2e-3 of the removed volume
  if (c.vsClosed?.dRemoved !== undefined && !(c.vsClosed.dRemoved <= 2e-3 || (c.vsClosed.dRemoved * c.vsClosed.removedClosed <= CURVED * (r.truckPrevVolume ?? 0)))) return `removed volume disagrees with closed form ${c.vsClosed.dRemoved}`;
  if (c.vsFc && !(c.vsFc.dVol <= CURVED && c.vsFc.dBbox <= CURVED)) return `disagrees with FreeCAD ${c.vsFc.dVol}`;
  const best = r.cpuBest ?? r.finalCpuMs;
  if (typeof best === 'number' && best > allowTimeMs) return `truck CPU best-of-runs ${(best / 1000).toFixed(0)} s is over the ${allowTimeMs / 1000} s budget`;
  return null;
}
export const refusedOk = (r) => {
  if (r.verdict === 'script-error') return (r.lint ?? []).flat().length ? `sentence lint: ${JSON.stringify(r.lint)}` : null;
  if (r.verdict !== 'truck-refused') return `expected a refusal, got ${r.verdict}`;
  const l = (r.lint ?? []).flatMap((x) => x.problems);
  return l.length ? `sentence lint: ${JSON.stringify(r.lint)}` : null;
};
