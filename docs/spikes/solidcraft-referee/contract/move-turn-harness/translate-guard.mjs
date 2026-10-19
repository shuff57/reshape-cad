// SPIKE PROTOTYPE, referee only: a patched COPY of ../../phase0/translate.mjs for the move-turn group. Not an engine, not in npm test.
// Differences from phase0/translate.mjs (each one is measured in the move-turn rows):
//   1. PICK GUARD. A pick-bearing feature (round/bevel edge, hollow open face, draft face) whose target chain contains a move or a
//      turn step is REFUSED, because brep-rs `resolve` returns the pre-move / pre-turn point (measured: silent wrong solids).
//   2. COPY. move({copy:true}) is mapped; the copy's body name is found by DIFFING the body list before/after, never guessed.
//      Repeat (pattern) copies are found the same way, so an earlier copy cannot be picked up as a pattern instance.
//   3. STUDENT SENTENCES. Refusals use the studio's own display names (Hollow 1, Move 1, Turn 1) and no solidcraft command or parameter names;
//      the raw engine text is kept in `raw` (not student-facing).
//   4. Fork refusals (move/turn of a part that join/mirror/repeat already used) say what to change.
//   5. (round 3) MULTI-LUMP RESULTS. A cut/hole/pocket/groove/intersect that leaves several separate pieces makes solidcraft name the
//      extra pieces "<body> (1)", "<body> (2)"; round 2 kept only the named body and silently dropped the rest (cut of a 60x20x10 box by a
//      10x40x20 tool: OCCT 10000, SC 5000). Now every new piece joins the feature's handle (diff against the live body list, with the
//      consumed tool names removed first so a reused name is still seen). A later feature that needs ONE body is refused with a plain sentence.
//   6. (round 3) CUT-THEN-MOVE FORK. OCCT move/rotate read built.get(target), the PRE-pocket / PRE-groove shape (occt-build.ts:1639,1491,1527);
//      the head-advance used for cuts is not applied to them. A move/turn whose target already has a newer cut on it is refused (was: the
//      translator moved the cut body, dVol 2.1e-2).
//   7. (round 3) MAGNITUDE. A built body with any bounding-box coordinate beyond 3000 mm from the origin is refused (measured: every
//      group PASSES at 3000, curved parts start to FAIL the COM bar at 5000-10000, planar from 1e4).
//   8. (round 3) TIME LIMIT. ctx.runSC may return {ok:false, failed:{error:'TIME_LIMIT'}} (the harness kills the wasm call); the feature is
//      refused with a plain sentence.
//   9. (round 4) RIGID-MOTION INVARIANT. Every Move and Turn step is checked against the shape it started from: volume, surface area and
//      centre of mass must come out the same (a move shifts the centre by the offset; a turn keeps its distance to the pivot). A primitive is
//      checked against its closed-form volume. Reason: solidcraft's 6th, 8th, 15th, 17th ... accumulated solid.move on a revolve-built cone
//      (and on a part that contains a cone face) returns a body whose volume / area / centre of mass are wrong while the bounding box is right
//      (cone 141.37 mm3 reads 104.5 or 6.1; see move-turn-harness/r4-*.mjs). MT_NOINVARIANT=1 switches the check off (negative control).
//  10. (round 4) CHAIN REPAIR. When the invariant fails, the same step is retried once with every pure translation of a body folded into the
//      previous pure translation of that body (exact; fewer accumulated steps). If that passes the invariant it is used, otherwise the step is refused.
//  11. (round 4) MAGNITUDE is split by what the part is made of: see MAX_COORD_PLANAR / MAX_COORD_CURVED.
// Original header follows.
//
// SPIKE, referee only (docs/spikes/solidcraft-referee/phase0). Not an engine, not an EngineAdapter, not in npm test.
//
// ModelDoc -> solidcraft command JSON, executed PER FEATURE on fresh sessions (prefix 1..k).
//
// Refusal contract (AGENTS.md): a feature that cannot be mapped, or that solidcraft refuses, is refused in a plain
// sentence alongside whatever DID build; a feature that depends on a refused or already-consumed feature is refused
// with a pointer to it. Nothing here falls back to another engine.
//
// ModelDoc semantics were read off packages/brep-adapter/src/occt-build.ts (the same file the parity gate trusts):
//   - a sketch lies in (u, v); an extrude sweeps along u x v (xy +Z, xz -Y, yz +X); a revolve lays the outline in
//     (u, n) and spins about n through the frame origin; a pocket/groove cuts against / around the same frame.
//   - primitives are built centred at the origin, rotated about the ORIGIN, then translated by `center`.
//   - a hole is a cylinder cut, centred on target-bbox-centre + center, `depth` long, along `axis`.
//   - a mirror reflects through the part's nearer bbox face on the plane's axis and fuses with the original.
//
// Picks: solidcraft picks faces/edges by a 3D point. For `between`/`swept`/`cap`/`carried` names the point comes from
// brep-rs `resolve` (ctx.resolve) -- so every named pick DEPENDS ON brep-rs. That is recorded, not hidden.

export const MAX_COORD = 3000; // curved parts (kept name for older harnesses)
export const MAX_COORD_CURVED = Number(process.env.MT_MAX_CURVED || 3000);
export const MAX_COORD_PLANAR = Number(process.env.MT_MAX_PLANAR || 3000);
export const TIME_NOTE = (Number(process.env.SC_BOX_MS) || 120000) / 1000;
const FEATURE_KINDS = ['box', 'cylinder', 'sphere', 'cone', 'torus', 'prism', 'wedge', 'sketch', 'datum', 'extrude', 'combine',
  'blend', 'revolve', 'groove', 'pocket', 'mirror', 'pattern', 'hole', 'shell', 'move', 'rotate', 'fillet', 'draft'];
export { FEATURE_KINDS };

const AX = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const AXN = { x: 'X', y: 'Y', z: 'Z' };
const add = (a, b) => a.map((v, i) => v + b[i]);
const len = (a) => Math.hypot(...a);
const isZero3 = (v) => !v || (v[0] === 0 && v[1] === 0 && v[2] === 0);
const bname = (id) => `b_${id}`;

/** named-plane frame, identical to model-types.ts NAMED_PLANE_FRAMES / sketchFrameOf (copied, with a check in run-phase0). */
const NAMED = {
  xy: { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  xz: { u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] },
  yz: { u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] },
};
function frameOf(s, mt) {
  if (mt && mt.sketchFrameOf) return mt.sketchFrameOf(s);
  if (s.frame) {
    const { origin, u, v } = s.frame;
    return { origin, u, v, n: [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]] };
  }
  const a = NAMED[s.plane ?? 'xy'] ?? NAMED.xy;
  const o = s.offset ?? 0;
  return { origin: a.n.map((c) => c * o), ...a };
}

const refuse = (sentence) => ({ refusal: sentence });

/** Sketch outline -> sketch.* commands (inside an open sketch). Returns {cmds} or {refusal}. */
function profileCmds(sk, ctx) {
  if (sk.shape !== 'circle' && Array.isArray(sk.geoms) && sk.geoms.length > 0) {
    return refuse(`sketch ${sk.id} is drawn as rows and rules (a soup), which this translator does not map yet`);
  }
  const o = ctx.arc.outlineOf(sk);
  if (!o.ok) return refuse(`sketch ${sk.id} has no usable outline (${(o.notes ?? []).join('; ') || 'outlineOf refused it'})`);
  if (sk.shape === 'circle') {
    const [a, b] = o.points;
    const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    return { cmds: [{ command: 'sketch.circle.center', params: { center: c, diameter: Math.hypot(b[0] - a[0], b[1] - a[1]) } }] };
  }
  const pts = o.points;
  const bulges = o.bulges ?? {};
  if (!Object.values(bulges).some((g) => g)) {
    return { cmds: [{ command: 'sketch.line', params: { points: pts.map((p) => [p[0], p[1]]), closed: true } }] };
  }
  const cmds = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const g = bulges[i];
    if (!g) { cmds.push({ command: 'sketch.line', params: { points: [a, b] } }); continue; }
    // same arc construction as occt-build.ts sketchWire: a point on the arc halfway round
    const { center, radius, startAngle, endAngle } = ctx.arc.arcFromBulge(a, b, g);
    let sweep = endAngle - startAngle;
    if (g > 0 && sweep < 0) sweep += Math.PI * 2;
    if (g < 0 && sweep > 0) sweep -= Math.PI * 2;
    const mid = startAngle + sweep / 2;
    cmds.push({ command: 'sketch.arc.three_point', params: { start: a, end: b, through: [center[0] + radius * Math.cos(mid), center[1] + radius * Math.sin(mid)] } });
  }
  return { cmds };
}

function inSketch(sk, ctx, st, { revolve = false } = {}) {
  const fr = frameOf(sk, ctx.mt);
  const prof = profileCmds(sk, ctx);
  if (prof.refusal) return prof;
  const name = `sk_${sk.id}_${st.counter++}`;
  return {
    name,
    cmds: [
      { command: 'sketch.create', params: { name, plane: { origin: fr.origin, x_dir: fr.u, y_dir: revolve ? fr.n : fr.v } } },
      ...prof.cmds,
      { command: 'sketch.finish', params: {} },
    ],
  };
}

const rotCmds = (name, rotate) => {
  const out = [];
  if (isZero3(rotate)) return out;
  ['x', 'y', 'z'].forEach((a, i) => { if (rotate[i]) out.push({ command: 'solid.move', params: { bodies: [name], axis: AX[a], angle: rotate[i] } }); });
  return out;
};
const moveCmd = (name, t) => ({ command: 'solid.move', params: { bodies: [name], translate: t } });

/** Edge points for a primitive's whole-shape `round`: box = 12 edge midpoints, cylinder = the two rim circles. */
function roundPoints(f, base) {
  if (f.kind === 'box') {
    const [w, d, h] = f.size.map((v) => v / 2);
    const c = base;
    const p = [];
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) p.push([c[0], c[1] + sy * d, c[2] + sz * h]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push([c[0] + sx * w, c[1], c[2] + sz * h]);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) p.push([c[0] + sx * w, c[1] + sy * d, c[2]]);
    return p;
  }
  return [[base[0] + f.radius, base[1], base[2] + f.height / 2], [base[0] + f.radius, base[1], base[2] - f.height / 2]];
}

/** Plan one feature. Returns {refusal} | {variants:[cmds...], produces:[names], consumes:[ids]} | {noop:true}. */
export function planFeature(f, st, ctx) {
  const name = bname(f.id);
  const needBody = (id) => {
    const bs = st.bodies[headOf(id)];
    return bs && bs.length ? bs : null;
  };
  // occt-build advanceHead: a hole / pocket / groove leaves its target's id pointing at the NEWEST cut, so a second bore
  // on the same target stacks on the first instead of starting over.
  const headOf = (id) => { let h = id; const seen = new Set(); while (st.head[h] && !seen.has(h)) { seen.add(h); h = st.head[h]; } return h; };
  const N = (id) => (st.names && st.names[id]) || id;
  const dep = (id, role = 'target') => {
    id = headOf(id);
    if (st.refused[id]) return `${N(f.id)} is not built because ${N(id)}, which it uses, was refused.`;
    if (st.stale[id]) return `${N(f.id)} is not built: ${N(id)} was already used up by ${N(st.stale[id])}, and this build keeps only one copy of a part, so make the moved or turned copy before ${N(st.stale[id])}: move(part, [x, y, z], { copy: true }).`;
    return null;
  };
  // OCCT move/rotate read the shape stored under the target id, which a later pocket/groove (or a hole on a handle that is no longer
  // the doc target) does NOT replace; the translator's head-advance would move the cut body instead (round 2: dVol 2.1e-2).
  const cutGuard = (id) => {
    const h = headOf(id);
    if (h === id || process.env.MT_NOCUTGUARD === '1') return null; // MT_NOCUTGUARD=1: negative control (round-2 behaviour)
    return `${N(f.id)} is not built: it ${f.kind === 'rotate' ? 'turns' : 'moves'} ${N(id)}, but ${N(h)} had already cut into ${N(id)}, and this build cannot tell whether you mean the part before or after the cut -- ${f.kind === 'rotate' ? 'turn' : 'move'} ${N(id)} before the cut, or ${f.kind === 'rotate' ? 'turn' : 'move'} the result of ${N(h)} instead.`;
  };
  const taintOf = (id) => st.taint[headOf(id)] || null;
  // a feature that works on exactly ONE body, handed a handle that is now several separate pieces: plain sentence, no engine words
  const splitMsg = (id) => {
    const bs = st.bodies[headOf(id)];
    return bs && bs.length > 1 ? `${N(f.id)} is not built: ${N(id)} was split into ${bs.length} separate pieces by an earlier cut, and this build can only work on one piece at a time -- move or turn the part, or do this step, before the cut that splits it.` : null;
  };
  const pickGuard = (what, targetId) => {
    const t = taintOf(targetId);
    if (!t) return null;
    return `${N(f.id)} is not built: it picks ${what} by name on a shape that ${N(t)} ${st.kinds[t] === 'rotate' ? 'turned' : 'moved'}, and a name cannot be followed through a move or a turn yet -- ${f.kind === 'shell' ? 'hollow' : f.kind === 'draft' ? 'draft' : f.style === 'chamfer' ? 'bevel' : 'round'} the shape first, then move or turn it.`;
  };
  switch (f.kind) {
    case 'box': case 'cylinder': case 'sphere': case 'torus': case 'cone': case 'prism': case 'wedge': {
      const rot = !isZero3(f.rotate);
      const c = f.center ?? [0, 0, 0];
      const at = rot ? [0, 0, 0] : c; // rotation is about the ORIGIN, so a rotated primitive is built at the origin first
      let cmds = [];
      if (f.kind === 'box') {
        cmds.push({ command: 'solid.box', params: { length: f.size[0], width: f.size[1], height: f.size[2], center: at, body_name: name } });
      } else if (f.kind === 'cylinder') {
        cmds.push({ command: 'solid.cylinder', params: { radius: f.radius, height: f.height, base: [at[0], at[1], at[2] - f.height / 2], axis: 'Z', body_name: name } });
      } else if (f.kind === 'sphere') {
        cmds.push({ command: 'solid.sphere', params: { radius: f.radius, center: at, body_name: name } });
      } else if (f.kind === 'torus') {
        cmds.push({ command: 'solid.torus', params: { major: f.ringRadius, minor: f.tubeRadius, center: at, body_name: name } });
      } else if (f.kind === 'cone') {
        // no solid.cone: spin the right triangle (0,0)-(r,0)-(0,h) about the sketch y axis, as occt-build coneOf does
        const nm = `sk_${f.id}_${st.counter++}`;
        cmds.push(
          { command: 'sketch.create', params: { name: nm, plane: { origin: [at[0], at[1], at[2] - f.height / 2], x_dir: [1, 0, 0], y_dir: [0, 0, 1] } } },
          { command: 'sketch.line', params: { points: [[0, 0], [f.radius, 0], [0, f.height]], closed: true } },
          { command: 'sketch.finish', params: {} },
          { command: 'solid.revolve', params: { axis: 'y', sketch: nm, operation: 'new', body_name: name } },
        );
      } else {
        const poly = f.kind === 'prism'
          ? (() => { const n = Math.max(3, Math.min(12, Math.round(f.sides))); return Array.from({ length: n }, (_, i) => [f.radius * Math.cos(2 * Math.PI * i / n), f.radius * Math.sin(2 * Math.PI * i / n)]); })()
          : [[-f.width / 2, -f.depth / 2], [f.width / 2, -f.depth / 2], [-f.width / 2, f.depth / 2]];
        const nm = `sk_${f.id}_${st.counter++}`;
        cmds.push(
          { command: 'sketch.create', params: { name: nm, plane: { origin: [at[0], at[1], at[2] - f.height / 2], x_dir: [1, 0, 0], y_dir: [0, 1, 0] } } },
          { command: 'sketch.line', params: { points: poly, closed: true } },
          { command: 'sketch.finish', params: {} },
          { command: 'solid.extrude', params: { distance: f.height, sketch: nm, operation: 'new', body_name: name } },
        );
      }
      if (f.round) {
        if (f.kind !== 'box' && f.kind !== 'cylinder') return refuse(`${f.id} (${f.kind}): a whole-shape round is only mapped for box and cylinder`);
        const pts = roundPoints(f, at);
        cmds.push(f.roundStyle === 'chamfer'
          ? { command: 'solid.chamfer', params: { edges: pts, distance: f.round, body: name } }
          : { command: 'solid.fillet', params: { edges: pts, radius: f.round, body: name } });
      }
      if (rot) { cmds.push(...rotCmds(name, f.rotate)); if (!isZero3(c)) cmds.push(moveCmd(name, c)); }
      return { variants: [cmds], produces: [name], consumes: [] };
    }
    case 'datum':
      return { noop: true };
    case 'sketch':
      return { noop: true, stage: true };
    case 'extrude': {
      const d = dep(f.target, 'sketch');
      if (d) return refuse(d);
      for (const k of ['midplane', 'length2', 'reversed', 'taper', 'direction', 'alongNormal']) {
        if (f[k]) return refuse(`${f.id} (extrude): the ${k} option is not mapped in phase 0 (only a plain one-sided extrude along the sketch normal is)`);
      }
      const sk = st.sketches[f.target];
      if (!sk) return refuse(`${f.id} (extrude): ${f.target} is not a sketch`);
      const s = inSketch(sk, ctx, st);
      if (s.refusal) return refuse(`${f.id} (extrude): ${s.refusal}`);
      return { variants: [[...s.cmds, { command: 'solid.extrude', params: { distance: f.height, sketch: s.name, operation: 'new', body_name: name } }]], produces: [name], consumes: [] };
    }
    case 'revolve': case 'groove': {
      const d = dep(f.target, 'sketch') || (f.kind === 'groove' ? dep(f.into, 'solid') : null);
      if (d) return refuse(d);
      const sk = st.sketches[f.target];
      if (!sk) return refuse(`${f.id} (${f.kind}): ${f.target} is not a sketch`);
      const s = inSketch(sk, ctx, st, { revolve: true });
      if (s.refusal) return refuse(`${f.id} (${f.kind}): ${s.refusal}`);
      const params = { axis: 'y', sketch: s.name };
      if (f.angle !== 360) params.angle = -f.angle;
      if (f.kind === 'revolve') return { variants: [[...s.cmds, { command: 'solid.revolve', params: { ...params, operation: 'new', body_name: name } }]], produces: [name], consumes: [] };
      const bs = needBody(f.into);
      if (splitMsg(f.into)) return refuse(splitMsg(f.into));
      if (!bs || bs.length !== 1) return refuse(`${f.id} (groove): ${f.into} is not a single body`);
      return { variants: [[...s.cmds, { command: 'solid.revolve', params: { ...params, operation: 'cut', targets: bs } }]], produces: bs, consumes: [f.into] };
    }
    case 'pocket': {
      const d = dep(f.target, 'sketch') || dep(f.into, 'solid');
      if (d) return refuse(d);
      const sk = st.sketches[f.target];
      const bs = needBody(f.into);
      if (splitMsg(f.into)) return refuse(splitMsg(f.into));
      if (!sk || !bs || bs.length !== 1) return refuse(`${f.id} (pocket): needs a sketch and a single body`);
      const s = inSketch(sk, ctx, st);
      if (s.refusal) return refuse(`${f.id} (pocket): ${s.refusal}`);
      // pocket pushes OPPOSITE the sweep direction (occt-build: h = -depth * dir), i.e. direction negative on a u x v frame
      return { variants: [[...s.cmds, { command: 'solid.extrude', params: { distance: f.depth, direction: 'negative', sketch: s.name, operation: 'cut', targets: bs } }]], produces: bs, consumes: [f.into] };
    }
    case 'blend': {
      const ds = f.targets.map((t) => dep(t, 'sketch')).find(Boolean);
      if (ds) return refuse(ds);
      if (f.targets.length < 2) return refuse(`${f.id} (blend): needs two or more sketches`);
      const cmds = []; const names = [];
      for (const t of f.targets) {
        const sk = st.sketches[t];
        if (!sk) return refuse(`${f.id} (blend): ${t} is not a sketch`);
        const s = inSketch(sk, ctx, st);
        if (s.refusal) return refuse(`${f.id} (blend): ${s.refusal}`);
        cmds.push(...s.cmds); names.push(s.name);
      }
      cmds.push({ command: 'solid.loft', params: { sections: names.map((n) => ({ sketch: n })), operation: 'new', body_name: name } });
      return { variants: [cmds], produces: [name], consumes: [] };
    }
    case 'combine': {
      const ds = f.targets.map((t) => dep(t)).find(Boolean);
      if (ds) return refuse(ds);
      if (f.targets.length < 2) return refuse(`${f.id} (combine): needs two or more targets`);
      const all = f.targets.map((t) => needBody(t));
      const sp = f.targets.map((t) => splitMsg(t)).find(Boolean);
      if (sp) return refuse(sp);
      if (all.some((b) => !b || b.length !== 1)) return refuse(`${f.id} (combine): every target must be a single body`);
      const op = f.op === 'union' ? 'join' : f.op === 'subtract' ? 'cut' : 'intersect';
      const names = all.map((b) => b[0]);
      return {
        variants: [[{ command: 'solid.combine', params: { target: names[0], tools: names.slice(1), operation: op } }]],
        produces: [names[0]], consumes: f.targets, removes: names.slice(1),
      };
    }
    case 'move': {
      const d = dep(f.target);
      if (d) return refuse(d);
      const cg = cutGuard(f.target);
      if (cg) return refuse(cg);
      const bs = needBody(f.target);
      if (f.copy) return { variants: [[{ command: 'solid.move', params: { bodies: bs, translate: f.offset, copy: true } }]], producesDiff: true, consumes: [] };
      return { variants: [[{ command: 'solid.move', params: { bodies: bs, translate: f.offset } }]], produces: bs, consumes: [f.target] };
    }
    case 'rotate': {
      const d = dep(f.target);
      if (d) return refuse(d);
      const cg = cutGuard(f.target);
      if (cg) return refuse(cg);
      const bs = needBody(f.target);
      const m = st.measure[f.target];
      if (!m) return refuse(`${f.id} (rotate): no measured bounding box for ${f.target}`);
      const c = [0, 1, 2].map((i) => (m.bbox[i] + m.bbox[i + 3]) / 2);
      const cmds = [];
      if (!isZero3(c)) cmds.push({ command: 'solid.move', params: { bodies: bs, translate: c.map((v) => -v) } });
      ['x', 'y', 'z'].forEach((a, i) => { if (f.angles[i]) cmds.push({ command: 'solid.move', params: { bodies: bs, axis: AX[a], angle: f.angles[i] } }); });
      if (!isZero3(c)) cmds.push({ command: 'solid.move', params: { bodies: bs, translate: c } });
      return { variants: [cmds], produces: bs, consumes: [f.target] };
    }
    case 'mirror': {
      const d = dep(f.target);
      if (d) return refuse(d);
      const bs = needBody(f.target);
      const m = st.measure[f.target];
      if (splitMsg(f.target)) return refuse(splitMsg(f.target));
      if (!m) return refuse(`${f.id} (mirror): no measured bounding box for ${f.target}`);
      const axis = f.plane === 'yz' ? 0 : f.plane === 'xz' ? 1 : 2;
      const lo = m.bbox[axis]; const hi = m.bbox[axis + 3];
      const at = Math.abs(lo) <= Math.abs(hi) ? lo : hi; // occt-build: through the part's nearer face on this axis
      const origin = [0, 0, 0]; origin[axis] = at;
      const normal = [0, 0, 0]; normal[axis] = 1;
      return { variants: [[{ command: 'solid.mirror', params: { bodies: bs, plane: { origin, normal }, combine: true } }]], produces: bs, consumes: [f.target] };
    }
    case 'pattern': {
      const d = dep(f.target);
      if (d) return refuse(d);
      const bs = needBody(f.target);
      if (splitMsg(f.target)) return refuse(splitMsg(f.target));
      if (!bs || bs.length !== 1) return refuse(`${f.id} (pattern): needs a single target body`);
      if (f.count < 2) return refuse(`${f.id} (pattern): a count under 2 is the original alone; not mapped`);
      let pat;
      if (f.mode === 'circular') {
        if ((f.totalAngle ?? 360) !== 360) return refuse(`${f.id} (pattern): a circular pattern over less than 360 degrees is not mapped (solidcraft's angle semantics were not verified)`);
        pat = { command: 'solid.pattern.circular', params: { bodies: bs, axis: AXN[f.axis ?? 'z'], count: f.count } };
      } else {
        const s = f.step ?? [0, 0, 0];
        if (isZero3(s)) return refuse(`${f.id} (pattern): a zero step puts every copy on the original`);
        const L = len(s);
        pat = { command: 'solid.pattern.rectangular', params: { bodies: bs, dir1: s.map((v) => v / L), count1: f.count, spacing1: L } };
      }
      // OCCT fuses the instances. Run the pattern alone, FIND the instance names by diffing the body list, then try to join them
      // (if solidcraft cannot -- disjoint copies -- keep them as separate bodies).
      return { variants: [[pat]], patternOf: bs[0], consumes: [f.target] };
    }
    case 'hole': {
      const d = dep(f.target);
      if (d) return refuse(d);
      if (f.counterbore || f.countersink) return refuse(`${f.id} (hole): counterbore and countersink are not mapped in phase 0`);
      const bs = needBody(f.target);
      const m = st.measure[f.target];
      if (splitMsg(f.target)) return refuse(splitMsg(f.target));
      if (!bs || bs.length !== 1 || !m) return refuse(`${f.id} (hole): needs a single measured target body`);
      const bc = [0, 1, 2].map((i) => (m.bbox[i] + m.bbox[i + 3]) / 2);
      const cx = bc[0] + f.center[0]; const cy = bc[1] + f.center[1]; const cz = bc[2] + f.center[2];
      const centers = f.corners
        ? [[cx - f.corners.dx, cy - f.corners.dy, cz], [cx + f.corners.dx, cy - f.corners.dy, cz], [cx - f.corners.dx, cy + f.corners.dy, cz], [cx + f.corners.dx, cy + f.corners.dy, cz]]
        : [[cx, cy, cz]];
      const dir = AX[f.axis ?? 'z'];
      const cmds = centers.map((c) => ({
        command: 'solid.cylinder',
        params: { radius: f.diameter / 2, height: f.depth, base: c.map((v, i) => v - dir[i] * f.depth / 2), axis: AXN[f.axis ?? 'z'], operation: 'cut', targets: bs },
      }));
      return { variants: [cmds], produces: bs, consumes: [f.target] };
    }
    case 'shell': {
      const d = dep(f.target);
      if (d) return refuse(d);
      const bs = needBody(f.target);
      if (splitMsg(f.target)) return refuse(splitMsg(f.target));
      if (!bs || bs.length !== 1) return refuse(`${f.id} (shell): needs a single target body`);
      if (!f.open) return { variants: [[{ command: 'solid.shell', params: { thickness: f.thickness, body: bs[0] } }]], produces: bs, consumes: [f.target], plain: `${N(f.id)} is not built: hollowing a shape with no open face is not supported yet -- leave one face open, for example hollow(shape, { wall: ${f.thickness}, open: 'top' }).` };
      const pg = pickGuard('the face to open', f.target);
      if (pg) return refuse(pg);
      const r = ctx.resolve(f.open);
      if (!r || r.kind !== 'face') return refuse(`${f.id} (shell): the opened face could not be resolved to a point (brep-rs resolve gave ${r ? r.kind : 'nothing'})`);
      return { variants: [[{ command: 'solid.shell', params: { faces: [r.centroid], thickness: f.thickness, body: bs[0] } }]], produces: bs, consumes: [f.target], pickedFrom: 'brep-rs resolve' };
    }
    case 'fillet': {
      const d = dep(f.target);
      if (d) return refuse(d);
      const bs = needBody(f.target);
      if (splitMsg(f.target)) return refuse(splitMsg(f.target));
      if (!bs || bs.length !== 1) return refuse(`${f.id} (fillet): needs a single target body`);
      const pg = pickGuard('the edge', f.target);
      if (pg) return refuse(pg);
      const r = ctx.resolve(f.edge);
      if (!r || r.kind !== 'edge') return refuse(`${f.id} (fillet): the edge could not be resolved to a point (brep-rs resolve gave ${r ? r.kind : 'nothing'})`);
      const c = r.centroid;
      // A closed circle's centroid is its centre, which is not on the edge: also try one radius out along each world axis.
      const cands = [c];
      if (r.length > 0) { const rad = r.length / (2 * Math.PI); for (const a of ['x', 'y', 'z']) cands.push(add(c, AX[a].map((v) => v * rad))); }
      const mk = (p) => (f.style === 'chamfer'
        ? { command: 'solid.chamfer', params: { edges: [p], distance: f.size, body: bs[0] } }
        : { command: 'solid.fillet', params: { edges: [p], radius: f.size, body: bs[0] } });
      return { variants: cands.map((p) => [mk(p)]), produces: bs, consumes: [f.target], pickedFrom: 'brep-rs resolve' };
    }
    case 'draft': {
      const d = dep(f.target);
      if (d) return refuse(d);
      if (f.whole || !f.face) return refuse(`${f.id} (draft): a whole-body draft is not mapped (needs a face pick per face)`);
      const bs = needBody(f.target);
      if (splitMsg(f.target)) return refuse(splitMsg(f.target));
      if (!bs || bs.length !== 1) return refuse(`${f.id} (draft): needs a single target body`);
      const pg = pickGuard('the face', f.target);
      if (pg) return refuse(pg);
      const r = ctx.resolve(f.face);
      if (!r || r.kind !== 'face') return refuse(`${f.id} (draft): the face could not be resolved to a point`);
      const ax = AX[f.pull ?? 'z'];
      return {
        variants: [[{ command: 'solid.draft', params: { faces: [r.centroid], angle: f.angle, neutral: { origin: ax.map((v) => v * f.neutral), normal: ax }, pull: ax, body: bs[0] } }]],
        produces: bs, consumes: [f.target], pickedFrom: 'brep-rs resolve',
      };
    }
    default:
      return refuse(`${f.id}: feature kind '${f.kind}' is not in the ModelDoc vocabulary this translator knows`);
  }
}

/** Aggregate the named bodies of a successful run into one measure (sum volume/faces, union bbox). */
function aggregate(res, names) {
  const bs = res.measure.bodies.filter((b) => names.includes(b.name));
  if (!bs.length) return null;
  const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
  for (const b of bs) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], b.bbox.min[i]); hi[i] = Math.max(hi[i], b.bbox.max[i]); }
  return {
    volume: bs.reduce((s, b) => s + b.volume_mm3, 0),
    area: bs.reduce((s, b) => s + b.area_mm2, 0),
    faces: bs.reduce((s, b) => s + b.faces, 0),
    kernelFaces: bs.reduce((s, b) => s + b.kernel.faces, 0),
    curved: bs.some((b) => Object.keys(b.face_types ?? {}).some((k) => k !== 'plane')),
    bbox: [...lo, ...hi],
    faceTypes: bs.reduce((a, b) => { for (const [k, v] of Object.entries(b.face_types ?? {})) a[k] = (a[k] ?? 0) + v; return a; }, {}),
    com: [0, 1, 2].map((i) => bs.reduce((a, b) => a + b.volume_mm3 * b.center_of_mass[i], 0) / bs.reduce((a, b) => a + b.volume_mm3, 0)),
    bodies: bs.map((b) => b.name),
  };
}

export const magnitudeSentence = (name, far, lim, curved) => `${name} is not built: it puts the part ${Math.round(far)} mm from the origin, and this build ${curved ? 'cannot place a curved part accurately' : 'cannot place a part accurately'} beyond ${lim} mm (${lim / 1000} m) -- keep the part within ${lim} mm of the origin.`;
// ---- round 4: rigid-motion invariant, chain repair, closed-form primitive volume --------------------------------------------------
const INV_TOL = { vol: [1e-8, Number(process.env.MT_INV_CURVED || 3e-4)], com: [1e-7, Number(process.env.MT_INV_COM_CURVED || 3e-4)] }; // [planar, curved], relative (com: of the bounding-box diagonal)
const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(1) : v.toPrecision(2));
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
const diagOf = (bb) => Math.max(Math.hypot(bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]), 1);
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** null, or a plain sentence: a Move / Turn that changed the volume, area or centre of mass of the part it started from. */
export function invariantProblem(f, st, m, res) {
  if (process.env.MT_NOINVARIANT === '1') return null; // negative control: round-3 behaviour
  if (f.kind !== 'move' && f.kind !== 'rotate') return null;
  const ref = st.measure[f.target];
  if (!ref) return null;
  const nm = st.names[f.id] ?? f.id; const tn = st.names[f.target] ?? f.target;
  const curved = !!(m.curved || ref.curved); const k = curved ? 1 : 0;
  const move = f.kind === 'move';
  const bad = (what, got, want, unit) => `${nm} is not built: ${move ? 'moving' : 'turning'} ${tn} would change its ${what} (${got}${unit} instead of ${want}${unit}), which a ${move ? 'move' : 'turn'} must never do, so it is shown without it -- try fewer separate ${move ? 'moves' : 'turns'}, or build the part where you want it.`;
  const checks = [[m, ref, 'result']];
  if (move && f.copy) { const orig = aggregate(res, st.bodies[f.target] ?? []); if (orig) checks.push([orig, ref, 'original']); }
  for (const [x, r, which] of checks) {
    if (rel(x.volume, r.volume) > INV_TOL.vol[k]) return bad('volume', fmt(x.volume), fmt(r.volume), ' mm3');
    if (rel(x.area, r.area) > INV_TOL.vol[k]) return bad('surface area', fmt(x.area), fmt(r.area), ' mm2');
    // surfaces: a rigid motion keeps every planar / conical / spherical / toroidal face and never creates a surface of unknown kind (cylinders may re-split at the seam)
    for (const t of new Set([...Object.keys(r.faceTypes ?? {}), ...Object.keys(x.faceTypes ?? {})])) {
      if (t === 'cylinder') continue;
      const a = r.faceTypes?.[t] ?? 0; const b = x.faceTypes?.[t] ?? 0;
      if (a !== b) return `${nm} is not built: ${move ? 'moving' : 'turning'} ${tn} would change its faces (${b} ${t === 'other' ? 'of unknown kind' : t} ${b === 1 ? 'face' : 'faces'} instead of ${a}), which a ${move ? 'move' : 'turn'} must never do, so it is shown without it -- try fewer separate ${move ? 'moves' : 'turns'}, or build the part where you want it.`;
    }
    const dg = diagOf(r.bbox);
    let want;
    if (which === 'original') want = r.com;
    else if (move) want = r.com.map((v, i) => v + f.offset[i]);
    else { const c = [0, 1, 2].map((i) => (r.bbox[i] + r.bbox[i + 3]) / 2); want = null; const dr = dist3(r.com, c); const dx = dist3(x.com, c); if (Math.abs(dr - dx) / dg > INV_TOL.com[k]) return bad('centre of mass', `${fmt(dx)} from the pivot`, `${fmt(dr)} from the pivot`, ' mm'); }
    if (want && dist3(x.com, want) / dg > INV_TOL.com[k]) return bad('centre of mass', `[${x.com.map(fmt)}]`, `[${want.map(fmt)}]`, '');
  }
  return null;
}
/** closed-form volume of a primitive (null when it is rounded: no closed form here) */
export function primitiveVolume(f) {
  if (f.round) return null;
  const P = Math.PI;
  switch (f.kind) {
    case 'box': return f.size[0] * f.size[1] * f.size[2];
    case 'cylinder': return P * f.radius ** 2 * f.height;
    case 'cone': return P * f.radius ** 2 * f.height / 3;
    case 'sphere': return 4 / 3 * P * f.radius ** 3;
    case 'torus': return 2 * P * P * f.ringRadius * f.tubeRadius ** 2;
    case 'prism': { const n = Math.max(3, Math.min(12, Math.round(f.sides))); return 0.5 * n * f.radius ** 2 * Math.sin(2 * P / n) * f.height; }
    case 'wedge': return 0.5 * f.width * f.depth * f.height;
    default: return null;
  }
}
export function primitiveProblem(f, st, m) {
  if (process.env.MT_NOINVARIANT === '1') return null;
  const want = primitiveVolume(f);
  if (!want) return null;
  const curved = ['cylinder', 'cone', 'sphere', 'torus'].includes(f.kind);
  if (rel(m.volume, want) <= INV_TOL.vol[curved ? 1 : 0]) return null;
  return `${st.names[f.id] ?? f.id} is not built: the engine built it with the wrong size (volume ${fmt(m.volume)} mm3 instead of ${fmt(want)} mm3), so it is shown without it -- try it with fewer turns and moves, or build it at the origin and move it once.`;
}
const isPureTranslate = (c) => c.command === 'solid.move' && c.params && Array.isArray(c.params.translate) && c.params.axis === undefined && c.params.angle === undefined && !c.params.copy && Array.isArray(c.params.bodies) && c.params.bodies.length === 1;
const mentions = (c, name) => JSON.stringify(c.params ?? {}).includes(JSON.stringify(name));
/** Fold every pure translation of a body into the previous pure translation of the same body when no command in between names that body. Exact. */
export function simplifyChain(list) {
  const out = []; const last = {};
  for (const c of list) {
    if (isPureTranslate(c)) {
      const n = c.params.bodies[0];
      if (last[n] !== undefined) { const t = out[last[n]]; out[last[n]] = { ...t, params: { ...t.params, translate: t.params.translate.map((v, i) => v + c.params.translate[i]) } }; continue; }
      out.push(c); last[n] = out.length - 1; continue;
    }
    for (const n of Object.keys(last)) if (mentions(c, n)) delete last[n];
    out.push(c);
  }
  return out;
}

/**
 * Translate and execute a ModelDoc feature by feature (guarded prototype, see header).
 * ctx: { arc, mt, runSC(cmds)->parsed result, resolveAt(prefixFeatures, nameJson)->{kind,centroid,length|area}|null }
 */
export function translateDoc(doc, ctx) {
  const names = ctx.mt && ctx.mt.nameMap ? ctx.mt.nameMap(doc) : {};
  const st = { head: {}, bodies: {}, stale: {}, refused: {}, sketches: {}, measure: {}, counter: 0, names, taint: {}, kinds: {}, allBodies: [] };
  doc.features.forEach((f) => { st.kinds[f.id] = f.kind; });
  const accepted = [];
  const out = [];
  const bodyNames = (res) => res.measure.bodies.map((b) => b.name);
  doc.features.forEach((f, idx) => {
    const prefix = doc.features.slice(0, idx);
    const fctx = { ...ctx, resolve: (name) => ctx.resolveAt(prefix, name) };
    const note = (o) => out.push({ id: f.id, kind: f.kind, ...o });
    if (f.kind === 'sketch') st.sketches[f.id] = f;
    let plan;
    try { plan = planFeature(f, st, fctx); } catch (e) { plan = refuse(`${f.id} (${f.kind}): translator error: ${e.message}`); }
    if (plan.refusal) { st.refused[f.id] = plan.refusal; return note({ status: 'refused', refusal: plan.refusal, commands: [] }); }
    if (plan.noop) return note({ status: 'noop', commands: [] });
    let invMsg = null;
    const finish = (variant, res, produces, tried, list) => {
      // (round 3) pieces a cut/intersect split off: new body names that are not live bodies of earlier features and not this feature's own
      if (!plan.producesDiff && !plan.patternOf && plan.produces && process.env.MT_NOEXTRA !== '1') { // MT_NOEXTRA=1: negative control, round-2 behaviour
        const live = new Set(st.allBodies.filter((n) => !(plan.removes ?? []).includes(n)));
        const extras = bodyNames(res).filter((n) => !live.has(n) && !produces.includes(n));
        if (extras.length) produces = [...produces, ...extras];
      }
      const m = aggregate(res, produces);
      if (!m) return null;
      // (round 4) rigid-motion invariant for Move / Turn, closed-form volume for primitives
      invMsg = invariantProblem(f, st, m, res) ?? primitiveProblem(f, st, m);
      if (invMsg) return null;
      // (round 3/4) magnitude limit: nothing farther than the limit from the origin is accepted (curved parts and planar parts have their own limit)
      const far = Math.max(...m.bbox.map(Math.abs));
      const lim = m.curved ? MAX_COORD_CURVED : MAX_COORD_PLANAR;
      if (far > lim + 0.5) { plan.plain = magnitudeSentence(st.names[f.id] ?? f.id, far, lim, m.curved); tooFar = true; return null; }
      accepted.splice(0, accepted.length, ...(list ?? [...accepted, ...variant]));
      st.allBodies = bodyNames(res);
      st.bodies[f.id] = m.bodies;
      st.measure[f.id] = m;
      for (const c of plan.consumes) {
        if (c === f.id) continue;
        if (f.kind === 'hole' || f.kind === 'pocket' || f.kind === 'groove') { if (c === (f.kind === 'hole' ? f.target : f.into)) st.head[c] = f.id; } else st.stale[c] = f.id;
      }
      // taint: a move/turn step, or anything built from a tainted target, cannot be picked by name (brep-rs resolve is not history-aware)
      const srcs = [f.target, f.into, ...(f.targets ?? [])].filter(Boolean);
      const hid = (id) => { let h = id; const seen = new Set(); while (st.head[h] && !seen.has(h)) { seen.add(h); h = st.head[h]; } return h; };
      const inherited = srcs.map((t) => st.taint[hid(t)] ?? st.taint[t]).find(Boolean);
      if (f.kind === 'move' || f.kind === 'rotate') st.taint[f.id] = f.id; else if (inherited) st.taint[f.id] = inherited;
      // a hole/pocket/groove leaves its target's id pointing at the newest cut: carry the taint to that id too
      return note({ status: 'built', commands: variant, measure: m, pickedFrom: plan.pickedFrom, variantsTried: tried, pick: (variant.find((c) => c.params.edges || c.params.faces)?.params) ?? null, names: m.bodies });
    };
    let tooFar = false;
    const refuseRun = (lastErr, cmds) => {
      const sentence = (timedOut(lastErr) ? `${st.names[f.id] ?? f.id} is not built: it took longer than ${TIME_NOTE} seconds to compute, so it is shown without it -- try a simpler shape.` : null) ?? plan.plain ?? `${st.names[f.id] ?? f.id} could not be built by this engine, so it is shown without it.`;
      st.refused[f.id] = sentence;
      note({ status: 'refused', refusal: sentence, raw: `${f.id} (${f.kind}): solidcraft refused it -- ${lastErr}`, commands: cmds });
    };
    const run = (cmds) => { try { return ctx.runSC([...accepted, ...cmds]); } catch (e) { return { ok: false, failed: { error: `WASM TRAP: ${e.message}` } }; } };
    const timedOut = (e) => /TIME_LIMIT/.test(String(e));
    const errOf = (res) => (res.failed ? `${res.failed.command}: ${res.failed.error}` : String(res.error ?? 'unknown'));
    if (plan.patternOf) {
      // find the instance names by diff, then try to fuse them
      const before = new Set(st.allBodies);
      const r1 = run(plan.variants[0]);
      if (!r1.ok) return refuseRun(errOf(r1), plan.variants[0]);
      const inst = bodyNames(r1.measure ? r1 : { measure: r1.measure }).filter((n) => !before.has(n));
      const copies = [plan.patternOf, ...inst];
      const joinCmd = { command: 'solid.combine', params: { target: copies[0], tools: copies.slice(1), operation: 'join' } };
      const r2 = run([...plan.variants[0], joinCmd]);
      if (r2.ok && aggregate(r2, copies)) { if (finish([...plan.variants[0], joinCmd], r2, copies, 1)) return; }
      if (finish(plan.variants[0], r1, copies, 2)) return;
      return refuseRun(`no instance bodies came back (${copies.join(', ')})`, plan.variants[0]);
    }
    let lastErr = null;
    for (const variant of plan.variants) {
      const res = run(variant);
      if (!res.ok) { lastErr = errOf(res); continue; }
      const produces = plan.producesDiff ? bodyNames(res).filter((n) => !st.allBodies.includes(n)) : plan.produces;
      invMsg = null;
      if (finish(variant, res, produces, plan.variants.indexOf(variant) + 1)) return;
      if (invMsg && process.env.MT_NOREPAIR !== '1') {
        // (round 4) repair, each candidate re-checked by the same invariant: (a) the body's translations folded together (exact);
        // (b) the same with a no-op translation appended (solidcraft's fault depends on how many moves a body has been through, measured:
        // a revolve-built cone is wrong at 6, 8, 15, 17, 24, 26 ... moves and right at every other count)
        const first = invMsg;
        const base = [...accepted, ...variant];
        const names = plan.producesDiff ? bodyNames(res).filter((n) => !st.allBodies.includes(n)) : (plan.produces ?? []); // a copy's body name is only known after the run
        const folded = simplifyChain(base);
        const padList = (list, n) => [...list, ...Array.from({ length: n }, () => names.map((nm) => ({ command: 'solid.move', params: { bodies: [nm], translate: [0, 0, 0] } }))).flat()];
        const cands = [];
        if (folded.length < base.length) cands.push(['folded', folded]);
        if (names.length) for (const n of [1, 2]) { cands.push([`padded${n}`, padList(base, n)]); if (folded.length < base.length) cands.push([`folded+padded${n}`, padList(folded, n)]); }
        for (const [kind, list2] of cands) {
          let res2; try { res2 = ctx.runSC(list2); } catch (e) { res2 = { ok: false, failed: { error: `WASM TRAP: ${e.message}` } }; }
          if (!res2.ok) continue;
          const produces2 = plan.producesDiff ? bodyNames(res2).filter((n) => !st.allBodies.includes(n)) : plan.produces;
          invMsg = null;
          if (finish(variant, res2, produces2, plan.variants.indexOf(variant) + 1, list2)) { out[out.length - 1].repaired = { kind, reason: first, commandsBefore: base.length, commandsAfter: list2.length }; return; }
        }
        invMsg = first;
      }
      if (invMsg) { plan.plain = invMsg; lastErr = `invariant: ${invMsg}`; break; }
      lastErr = `solidcraft ran the commands but no new body came back`;
    }
    refuseRun(lastErr, plan.variants[0]);
  });
  return { features: out, commands: accepted };
}
