// The GUARDED SolidCraft path of the sketch-geometry rig: translate-p4 (unmodified) + contract/sketch-geometry.guard.mjs around it.
//   before:  guardDoc() on the solved doc, repairOutline() inside the arc module handed to the translator
//   around:  the host's profile selection (even-odd points), as in sg-core's truckBuild
//   after:   every feature the guard refuses becomes `refused` with the guard's sentence; every feature that depends on a refused one is
//            refused with a pointer; the translator's own aggregate() (which counts only the body NAMED b_<id>) is replaced by a count over
//            every piece of the lineage (b_<id>, b_<id> (2), ...), and a feature that needs ONE piece to work on is refused when its target
//            is several; every engine sentence that is left is rewritten by explainEngineError(). Output shape = sg-core truckBuildRaw().
import * as C from './sg-core.mjs';
import * as G from '../sketch-geometry.guard.mjs';

const { arc, solveDoc, translateDoc, runSC, solidPoints, solvedGeoms } = C;

const SKIP_REFS = new Set(['id', 'kind', 'name']);
export function refsOf(f) {
  const out = [];
  for (const [k, v] of Object.entries(f)) {
    if (SKIP_REFS.has(k)) continue;
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach((x) => { if (typeof x === 'string') out.push(x); });
    else if (v && typeof v === 'object') for (const x of Object.values(v)) if (typeof x === 'string') out.push(x);
  }
  return out;
}
const WORKERS = new Set(['pocket', 'hole', 'groove', 'pattern', 'mirror', 'shell', 'fillet', 'draft', 'move', 'rotate', 'combine']);
const baseOf = (name) => name.replace(/ \(\d+\)$/, '');
const lineage = (bodies, base) => bodies.filter((b) => b.name === base || (b.name.startsWith(base + ' (') && /^ \(\d+\)$/.test(b.name.slice(base.length))));
export function aggregateLineage(bs) {
  const lo = [0, 1, 2].map((i) => Math.min(...bs.map((b) => b.bbox.min[i]))); const hi = [0, 1, 2].map((i) => Math.max(...bs.map((b) => b.bbox.max[i])));
  const vol = bs.reduce((a, b) => a + b.volume_mm3, 0);
  return {
    volume: vol, faces: bs.reduce((a, b) => a + b.faces, 0), kernelFaces: bs.reduce((a, b) => a + b.kernel.faces, 0), bbox: [...lo, ...hi],
    faceTypes: bs.reduce((a, b) => { for (const [k, v] of Object.entries(b.face_types ?? {})) a[k] = (a[k] ?? 0) + v; return a; }, {}),
    com: [0, 1, 2].map((i) => bs.reduce((a, b) => a + b.volume_mm3 * b.center_of_mass[i], 0) / vol), bodies: bs.map((b) => b.name),
  };
}

/** Rewrite whatever the translator said into a plain sentence. */
export function plainRefusal(text, f, doc, sketchIds) { return G.oneSentence(plainRefusal0(text, f, doc, sketchIds)); }
function plainRefusal0(text, f, doc, sketchIds) {
  const sk = refsOf(f).find((r) => sketchIds.has(r)) ?? (f.kind === 'sketch' ? f.id : null);
  let m = /solidcraft refused it -- (.*)$/s.exec(text);
  if (m) return G.explainEngineError(m[1], { sketchId: sk });
  m = /sketch (\S+) cannot be handed to solidcraft's solver: (.*)$/s.exec(text);
  if (m) return G.explainRuleRefusal(m[1], m[2]);
  m = /sketch (\S+) has no usable outline/.exec(text);
  if (m) return G.explainEngineError('outlineOf refused it', { sketchId: m[1] });
  if (G.lintSentence(text)) return G.explainEngineError(text, { sketchId: sk });
  return text;
}

export async function guardedTruckBuild(doc0, id, opts = {}) {
  let doc;
  try { doc = solveDoc(doc0); } catch (e) { return { refused: `The sketch rules could not be solved (${String(e.message).slice(0, 80)}).` }; }
  // round 6: a frame that print rounding left a hair off unit length / square is straightened (with a notice) before anything else looks at it
  const frameNotices = [];
  doc = { ...doc, features: doc.features.map((f) => { if (f.kind !== 'sketch' || !f.frame) return f; const rf = G.repairFrame(f); if (!rf) return f; frameNotices.push({ sketch: f.id, ...G.frameNotice(f) }); return { ...f, frame: rf.frame }; }) };
  const sketches = new Map(doc.features.filter((f) => f.kind === 'sketch').map((f) => [f.id, f]));
  const sketchIds = new Set(sketches.keys());
  // ---- before: the guard on every sketch
  const solvedCache = new Map();
  const solved = (sk) => { if (!solvedCache.has(sk.id)) solvedCache.set(sk.id, solvedGeoms({ geoms: sk.geoms, rules: sk.rules })); return solvedCache.get(sk.id); };
  const verdicts = G.guardDoc(doc, { arc, solvedGeoms: solved, authored: opts.authoredSketches ? new Set(opts.authoredSketches) : undefined });
  for (const f0 of doc0.features) { if (f0.kind !== 'sketch') continue; const tv = G.guardTypedCorners(f0); if (tv) verdicts.set(f0.id, tv); } // typed corners, before the rule solve
  const notices = [...frameNotices];
  for (const sk of sketches.values()) for (const n of G.noticesOf(sk, arc)) notices.push({ sketch: sk.id, ...n });
  const pullVerdicts = new Map();
  for (const f of doc.features) {
    if (f.kind !== 'extrude' || typeof f.height !== 'number') continue;
    const sk = sketches.get(f.target ?? f.sketch);
    if (!sk || verdicts.get(sk.id)) continue;
    const v = G.guardPull(G.sketchInfo(sk, { arc, solvedGeoms: solved }), f.height, f.length2);
    if (v) pullVerdicts.set(f.id, v);
  }
  if (opts.scriptVerdict) { const sk = [...sketches.values()][(opts.scriptVerdict.sid ?? 1) - 1]; if (sk) verdicts.set(sk.id, opts.scriptVerdict); }
  if (opts.valueVerdicts) for (const [sid, v] of opts.valueVerdicts) if (sketches.has(sid)) verdicts.set(sid, v);
  // ---- the translator, with the repaired outline
  const gArc = { ...arc, outlineOf: (sk) => G.repairOutline(arc.outlineOf(sk), sk) };
  const soups = {};
  let lastOk = null;
  const ctx = { arc: gArc, mt: C.mt, soups, runSC: async (cmds) => {
    for (const c of cmds) {
      if (process.env.SG_NO_PROFILES || c.command !== 'solid.extrude' || c.params.profiles !== undefined || !soups[c.params.sketch]) continue;
      const rows = solved({ id: soups[c.params.sketch].sketchId, geoms: soups[c.params.sketch].geoms, rules: soups[c.params.sketch].rules });
      // SG_PICKER=old: the round-5 stand-in (sg-core solidPoints), kept as a negative control for the reconciliation check; default: the guard's one-point-per-region picker
      const pts = process.env.SG_PICKER === 'old' ? solidPoints(rows) : G.regionPoints(rows);
      if (pts.length) c.params.profiles = pts.map((p) => ({ point: p }));
    }
    const r = await runSC(cmds); if (r.ok) lastOk = r; return r;
  } };
  let tr;
  try { tr = await translateDoc(doc, ctx); } catch (e) { return { refused: G.explainEngineError(`translator threw: ${e.message}`, {}) }; }
  const { st, accepted } = tr._state;
  const headOf = (x) => { let h = x; const seen = new Set(); while (st.head[h] && !seen.has(h)) { seen.add(h); h = st.head[h]; } return h; };

  // ---- after: statuses
  const out = []; const refused = new Map(); const lastPieces = {}; const pieceMaker = {}; let pieceNote = null;
  const prefixBodies = async (f) => { const len = st.accLen[f.id]; const r = await runSC(accepted.slice(0, len)); return r.ok ? (r.measure?.bodies ?? []) : null; };
  // the body a feature works on: the first thing it names (not a sketch) that has built bodies; a pocket names its sketch AND the part it cuts
  const workerBase = (f) => { for (const r of refsOf(f)) { if (sketchIds.has(r)) continue; const tb = st.bodies[headOf(r)]?.[0]; if (tb) return baseOf(tb); } return null; };
  const workerPieces = (f) => { const b = workerBase(f); return b ? (lastPieces[b] ?? 1) : 1; };
  for (const f of doc.features) {
    const t = tr.features.find((x) => x.id === f.id) ?? { id: f.id, kind: f.kind, status: 'noop' };
    const rec = { id: f.id, kind: f.kind, status: t.status, commands: t.commands, refusal: t.refusal, measure: t.measure, guard: null };
    const refs = refsOf(f);
    const bad = refs.find((r) => verdicts.get(r));
    const dead = refs.find((r) => refused.has(r));
    if (pullVerdicts.has(f.id) && !dead) { const v = pullVerdicts.get(f.id); rec.status = 'refused'; rec.refusal = v.sentence; rec.guard = v.code; rec.measure = undefined; refused.set(f.id, rec.refusal); }
    else if (f.kind === 'sketch' && verdicts.get(f.id)) { rec.status = 'refused'; rec.refusal = verdicts.get(f.id).sentence; rec.guard = verdicts.get(f.id).code; refused.set(f.id, rec.refusal); }
    else if (bad) { const v = verdicts.get(bad); rec.status = 'refused'; rec.refusal = v.sentence; rec.guard = v.code; rec.measure = undefined; refused.set(f.id, rec.refusal); }
    else if (dead) { rec.status = 'refused'; rec.refusal = `${f.id} was not built because ${dead} was refused: ${refused.get(dead)}`; rec.guard = 'depends-on-refused'; rec.measure = undefined; refused.set(f.id, rec.refusal); }
    else if (WORKERS.has(f.kind) && workerPieces(f) > 1) {
      const tb = workerBase(f); const maker = doc.features.find((x) => (x.kind === 'extrude' || x.kind === 'revolve') && `b_${x.id}` === tb);
      rec.status = 'refused'; rec.guard = 'several-pieces'; rec.measure = undefined;
      const mk = pieceMaker[tb] ? doc.features.find((x) => x.id === pieceMaker[tb]) : null;
      rec.refusal = G.piecesSentence({ featureId: f.id, kind: f.kind, sketchId: maker?.target ?? maker?.sketch ?? null, makerId: mk?.id, makerKind: mk?.kind, pieces: workerPieces(f) });
      refused.set(f.id, rec.refusal);
    }
    else if (t.status === 'refused') { rec.refusal = plainRefusal(t.refusal, f, doc, sketchIds); refused.set(f.id, rec.refusal); }
    else if (t.status === 'built' && st.bodies[f.id]?.length) {
      const base = baseOf(st.bodies[f.id][0]);
      const bodies = await prefixBodies(f);
      if (!bodies) { rec.status = 'refused'; rec.refusal = G.explainEngineError('replay failed', {}); refused.set(f.id, rec.refusal); }
      else {
        const mine = lineage(bodies, base);
        {
          rec.measure = mine.length ? aggregateLineage(mine) : t.measure;
          rec.pieces = mine.length;
          if (mine.length > 1 && (lastPieces[base] ?? 1) <= 1) pieceMaker[base] = f.id;
          lastPieces[base] = mine.length;
          // round 6: the built body against the sketch, whatever picked the profiles (area x pull length, number of solid regions)
          if (f.kind === 'extrude' && mine.length) {
            const sk = sketches.get(f.target ?? f.sketch);
            const rv = sk ? G.reconcileExtrude(G.sketchInfo(sk, { arc, solvedGeoms: solved }), f, { volume: rec.measure.volume, pieces: mine.length }) : null;
            if (rv) { rec.status = 'refused'; rec.refusal = rv.sentence; rec.guard = rv.code; rec.measure = undefined; refused.set(f.id, rec.refusal); out.push(rec); continue; }
          }
          if (mine.length > 1) pieceNote = `${f.id} is made of ${mine.length} separate pieces; features after it that need one piece to work on (pocket, hole, groove, repeat, mirror, hollow, round, draft, move) are refused.`;
        }
      }
    }
    out.push(rec);
  }
  const f = out.find((x) => x.id === id);
  const all = out.map((x) => ({ id: x.id, status: x.status, refusal: x.refusal, guard: x.guard }));
  const lastBodies = (lastOk?.measure?.bodies ?? []).map((b) => ({ name: b.name, volume: b.volume_mm3, faces: b.faces, bbox: [...b.bbox.min, ...b.bbox.max] }));
  const base = { soups, lastBodies, all, notices, pieceNote, verdicts: [...verdicts].filter(([, v]) => v).map(([k, v]) => ({ sketch: k, ...v })) };
  if (!f) return { refused: `no feature ${id}`, ...base };
  if (f.status !== 'built') return { refused: f.refusal ?? `${id} not built`, guard: f.guard, commands: tr.commands, ...base };
  const m = { ...f.measure, pieces: f.pieces ?? 1 };
  return { m, commands: f.commands, ...base };
}
