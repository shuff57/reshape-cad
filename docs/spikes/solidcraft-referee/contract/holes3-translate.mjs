// SPIKE, referee only. The holes contract translator, round 3: phase0/translate.mjs (unchanged, imported) with the hole planner replaced by
// a guarded one, so that a SolidCraft (truck) result is shown to a student only when it is provably what was asked, and otherwise ONE
// plain sentence is shown beside whatever did build.
//
// Why a wrapper and not an edit: phase0/translate.mjs is read-only for this group. Every feature except hole goes through phase0's
// planFeature() untouched (a closed hollow() gets the shell-draft sentence); hole is planned here.
//
// What each guard is for (every one is measured, with the unguarded truck number beside it, in holes3-*.json):
//   G-BODIES   a bore wider than the part, or a bore that leaves corner pieces, makes SEVERAL bodies; phase0 aggregates only the one it named, so
//              the layer reported a piece of the part with ok:true. Pre: the target must be one body. Post: the body count must not grow.
//   G-SHELLS   a bore exactly as wide as the part (tangent), and a blind bore that does not open onto a face (sealed cavity), both come back as ONE
//              body holding two shells (kernel.shells). Post: the shell count must not grow.
//   G-NOOP     a bore that touches no material (at: off the part, the bbox centre of an L in the notch, a stepped part's low step, a second identical
//              hole, a ring's empty centre) returns the unchanged solid with ok:true. Post: a hole must remove volume AND add a face.
//   G-TOP      a blind bore starts at the bounding-box top (the script layer treats the extent as exact). On a part that is not flat and level under
//              the bore (stepped join, tilted slab, a ring, a pocket floor, a lying cylinder, off-centre on a sphere) the tool starts in air and
//              the hole comes out shallower than asked, or not at all. Probe: a thin disc cut at the tool top on the part as it was BEFORE the first
//              hole in the chain must remove its own volume (material just below, none above).
//   G-CORNERS  holes() along x or y: the translator (like occt-build.ts and brep-rs) puts the corner offsets on world x and y, but HoleFeature.corners
//              documents "the two axes the drill does not point along". Two of the four bores land on top of each other and the layer removes half
//              the volume. Refused; the oracles disagree with the documentation, so there is no oracle to build it against.
//   G-RECESS   counterbore / countersink are mapped to solidcraft's native solid.hole (type counterbore|countersink). Native is exact on a flat level
//              top and wrong in four measured ways, each guarded: the countersink cone tool is a fixed 0.9*r-tipped cone that ignores the hole depth
//              (blind hole shallower than dcx = (R-0.9r)/tan(half) + margin: refused), a recess is measured from the face under the position (pocket
//              floor: G-TOP refuses), a counterbore deeper than the part silently becomes a wider bore (refused), and it needs the recess wider than the bore.
//              Where the host is a plain box and the recess ring lies inside it, the removed volume is also compared with the closed form (post-check).
//   G-ENGINE   any engine failure text is replaced by one sentence (the raw text is kept in `raw`).
import { planFeature as basePlan } from '../phase0/translate.mjs';
import { SENTENCE as SHELL_SENTENCE } from './shell-draft-translate.mjs';

export const AXI = { x: 0, y: 1, z: 2 };
const AX = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const AXN = { x: 'X', y: 'Y', z: 'Z' };
const PI = Math.PI;
const fmt = (n) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(4)));
const refuse = (sentence, guard) => ({ refusal: sentence, guard });

/** margin (mm) added to the countersink cone tool's depth before a blind hole is accepted: set from holes3-cs-band.json */
export const CS_MARGIN = 0.05;
export const COVER_TOL = { planar: 1e-9, curved: 5e-4 }; // relative to the part volume: below this a cut counts as "nothing happened"
export const RECESS_TOL = 1e-3; // relative to the removed volume

// ---- plain sentences ---------------------------------------------------------------------------------------------------------------------
// ONE sentence each: what was asked, why it cannot be built, that the feature is shown without it, and (after a dash) what to try.
export const SENTENCE = {
  dep: (f, head) => `${f.id} (hole): the part it drills (${head}) could not be built, so ${f.id} is shown without it -- fix ${head} first.`,
  stale: (f, head, by) => `${f.id} (hole): ${head} was already changed by ${by} after the hole was set up, so ${f.id} is shown without it -- drill the part before changing it.`,
  noBody: (f) => `${f.id} (hole): the part it drills could not be found as a single piece, so ${f.id} is shown without it -- drill one shape at a time.`,
  multi: (f, n) => `${f.id} (hole): the part it drills is ${n} separate pieces and a hole cannot tell which one to drill, so ${f.id} is shown without it -- drill each piece before copying it, or join the pieces first.`,
  cornersAxis: (f) => `${f.id} (holes): four holes drilled along ${f.axis} are not supported yet, so ${f.id} is shown without it -- use holes() along z, or drill each hole with hole(shape, { along: '${f.axis}', at: [...] }).`,
  top: (f) => `${f.id} (hole): a hole that stops short of the other side starts on the top of the part, but the part is not flat and level under this spot, so ${f.id} is shown without it -- move the hole onto a flat top, or let it go all the way through.`,
  topRecess: (f, what) => `${f.id} (hole): a ${what} is cut from the top of the part, but the part is not flat and level under this spot, so ${f.id} is shown without it -- move the hole onto a flat top.`,
  noop: (f) => `${f.id} (hole): it does not touch the part, so it would cut nothing and ${f.id} is shown without it -- move the hole onto the part (check at:) or make it wider.`,
  split: (f, n0, n1) => `${f.id} (hole): it would leave ${n1} separate pieces where there ${n0 === 1 ? 'is 1 now' : `are ${n0} now`}, so ${f.id} is shown without it -- make the hole narrower than the part, or drill each separate piece before copying it.`,
  tangent: (f, what) => `${f.id} (hole): its ${what} would touch ${what === 'recess' ? 'the edge of the part' : 'the edge of the part or another hole'} along a line, which leaves a zero-thickness wall, so ${f.id} is shown without it -- move it a little or change its size.`,
  torus: (f) => `${f.id} (hole): drilling a ring (torus) is not supported yet, so ${f.id} is shown without it -- drill a box, cylinder or other flat-faced shape.`,
  shells: (f) => `${f.id} (hole): it would leave a sealed hollow inside the part, or pieces that touch only along a line, so ${f.id} is shown without it -- move it, make it narrower than the part, or let it go all the way through.`,
  cross: (f, h) => `${f.id} (hole): it crosses ${h.id}, a hole drilled in another direction, and crossing holes are not supported yet, so ${f.id} is shown without it -- drill the holes so they do not meet, or drill along one direction only.`,
  engine: (f) => `${f.id} (hole): this hole could not be cut cleanly into this part, so ${f.id} is shown without it -- try a smaller hole, a different place, or drill the plain shape before it is shaped.`,
  csBand: (f, need, have) => `${f.id} (hole): the countersink cone needs a hole at least ${fmt(need)} deep but this hole is ${fmt(have)} deep, so ${f.id} is shown without it -- drill deeper than ${fmt(need)} or make the countersink narrower.`,
  cbDeep: (f, cb, limit, what) => `${f.id} (hole): the counterbore is ${fmt(cb)} deep but the ${what} is only ${fmt(limit)}, so ${f.id} is shown without it -- make the counterbore shallower than the ${what}.`,
  recessNarrow: (f, what) => `${f.id} (hole): the ${what} has to be wider than the hole, so ${f.id} is shown without it -- make it wider than ${fmt(f.diameter)}.`,
  recessSide: (f, what) => `${f.id} (hole): ${f.id} cannot be drilled with a ${what} along ${f.axis} here, so ${f.id} is shown without it -- put the hole on a flat top.`,
  recessCavity: (f, what) => `${f.id} (hole): a ${what} has to start on a face of the part, and this hole starts inside it, so ${f.id} is shown without it -- give the hole a depth that ends at a face or leave the depth out.`,
  recessCheck: (f, what) => `${f.id} (hole): the ${what} did not come out the size that was asked, so ${f.id} is shown without it -- try a slightly different depth or width.`,
};

/** one sentence, no engine jargon, no emoji */
export function lintSentence(s) {
  const problems = [];
  const t = String(s);
  const parts = t.replace(/\b\d+\.\d+/g, 'N').replace(/\be\.g\./g, 'eg').split(/[.!?]["')\]]?\s+(?=[A-Za-z{])/).filter((x) => x.trim());
  if (parts.length > 1) problems.push(`${parts.length} sentences`);
  if (!/[.)'"]$/.test(t.trim())) problems.push('no full stop');
  if (/solidcraft|truck|brep|b_[a-z]|boolean|kernel|wasm|translator|phase 0|invalid parameters|\bok:|undefined/i.test(t)) problems.push('engine jargon');
  if (/[\u{1F300}-\u{1FAFF}]/u.test(t)) problems.push('emoji');
  return problems;
}

/**
 * Script-layer errors (runScript, packages/script, read-only) rewritten as one plain sentence. The raw text stays in the evidence.
 * Rewrites only where the raw text is wrong, ungrammatical, misleading or two sentences; every other script sentence passes through.
 */
export function plainScriptError(raw, script = '') {
  let m;
  const q = (s) => s.replace(/"/g, '"');
  // the option-name error is two sentences ("X has no option called "k". It takes a, b, c.")
  if ((m = raw.match(/^(\w+)\(?\)? has no option called "([^"]*)"\. It takes (.*)\.$/))) {
    return `${m[1]}() has no option called "${m[2]}" -- it takes ${m[3].replace(/, ([^,]*)$/, ' and $1')}.`;
  }
  // "hole's "along" has to be 'x', 'y' or 'z'. You gave it the text "w"." is two sentences
  if ((m = raw.match(/^(\w+)'s "along" has to be 'x', 'y' or 'z'\. You gave it (?:the text )?(.*)\.$/))) {
    return `${m[1]}()'s "along" has to be 'x', 'y' or 'z' -- you gave it ${m[2]}.`;
  }
  // describe() of a string is 'the text "M7"': "does not know the size the text "M7"" is ungrammatical
  if ((m = raw.match(/^(hole|holes)\(\) does not know the size (?:the text )?"(.*)"\. Sizes are (.*) \(clearance holes\), or give \{ across: <number> \}\.$/))) {
    return `${m[1]}() does not know the size "${m[2]}" -- the sizes are ${m[3]} (clearance holes), or give { across: <number> }.`;
  }
  if ((m = raw.match(/^(hole|holes)\(\) does not know the size (\S+)\. Sizes are (.*) \(clearance holes\), or give \{ across: <number> \}\.$/))) {
    return `${m[1]}() needs a size name in quotes such as 'M6', not the number ${m[2]} -- the sizes are ${m[3]}, or give { across: <number> }.`;
  }
  // a non-finite number in at / apart / across is described as 'a list of 2' by the script layer: say what is wrong
  if ((m = raw.match(/^(hole|holes) needs (at|apart) as \[u, v\], got a list of 2\.$/)) || (m = raw.match(/^(hole|holes)'s (at|apart) needs two numbers, like \[across, up\]\. You gave it a list of 2\.$/))) {
    return `${m[1]}() needs ${m[2]} to be two real numbers such as ${m[2] === 'at' ? '[10, -5]' : '[20, 10]'}, and one of them is not a number (NaN or Infinity).`;
  }
  if ((m = raw.match(/^(hole|holes)'s (at|apart) needs two numbers, like \[across, up\]\. You gave it (a list of \d+|.*)\.$/))) {
    return `${m[1]}() needs ${m[2]} to be exactly two numbers such as ${m[2] === 'at' ? '[10, -5]' : '[20, 10]'}, and you gave ${m[3]}.`;
  }
  if ((m = raw.match(/^(hole|holes)\(\) cannot find how thick this (\w+) is along (\w) yet, so it cannot drill all the way through\. Give it a depth: (.*)\.$/))) {
    return `${m[1]}() cannot tell how thick ${KIND_PHRASE(m[2])} is along ${m[3]}, so it cannot drill all the way through -- give it a depth such as ${m[4]}.`;
  }
  if ((m = raw.match(/^(hole|holes)\(\) cannot find where the top of this (\w+) is along (\w) exactly, so a hole that stops short of the other side cannot start at the top\. Make it go all the way through \(leave out deep:, or give a deep: at least ([\d.]+)\), or drill the shape before it is cut\.$/))) {
    return `${m[1]}() cannot tell exactly where the top of ${KIND_PHRASE(m[2])} is along ${m[3]}, so a hole that stops short of the other side cannot start there -- leave out deep:, give a deep: of at least ${m[4]}, or drill the shape before it is cut.`;
  }
  return raw;
}
function KIND_PHRASE(kind) {
  return ({ combine: 'this joined, cut or overlapped shape', pocket: 'this pocketed shape', revolve: 'this spun shape', prism: 'this prism', wedge: 'this wedge', pattern: 'this pattern of copies', mirror: 'this mirrored shape', extrude: 'this pulled shape', torus: 'this ring', cone: 'this cone' }[kind]) ?? `this ${kind}`;
}

// ---- helpers ---------------------------------------------------------------------------------------------------------------------------
export function aggregateOf(res, names) {
  const bs = res.measure.bodies.filter((b) => names.includes(b.name));
  if (!bs.length) return null;
  const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
  for (const b of bs) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], b.bbox.min[i]); hi[i] = Math.max(hi[i], b.bbox.max[i]); }
  const vol = bs.reduce((s, b) => s + b.volume_mm3, 0);
  return {
    volume: vol,
    faces: bs.reduce((s, b) => s + b.faces, 0),
    kernelFaces: bs.reduce((s, b) => s + b.kernel.faces, 0),
    shells: bs.reduce((s, b) => s + (b.kernel.shells ?? 1), 0),
    curved: bs.some((b) => Object.keys(b.face_types ?? {}).some((k) => k !== 'plane')),
    bbox: [...lo, ...hi],
    faceTypes: bs.reduce((a, b) => { for (const [k, v] of Object.entries(b.face_types ?? {})) a[k] = (a[k] ?? 0) + v; return a; }, {}),
    com: [0, 1, 2].map((i) => bs.reduce((a, b) => a + b.volume_mm3 * b.center_of_mass[i], 0) / vol),
    bodies: bs.map((b) => b.name),
  };
}

const cylV = (d, L) => PI * (d / 2) ** 2 * L;
export const cbRem = (d, R, cbd, bl) => cylV(d, bl) + cylV(R, cbd) - cylV(d, cbd);
export function csRem(d, D, a, bl) {
  const R = D / 2; const r = d / 2; const tn = Math.tan((a * PI) / 360); const dc = (R - r) / tn;
  if (dc <= bl) return PI * r * r * bl + (PI * dc / 3) * (R * R + R * r + r * r) - PI * r * r * dc;
  const rb = R - bl * tn;
  return (PI * bl / 3) * (R * R + R * rb + rb * rb);
}
/** depth of the cone tool solidcraft cuts for a countersink: it runs on down to radius 0.9*r whatever the hole depth (eval.rs HoleKind::Countersink) */
export const csToolDepth = (d, D, a) => (D / 2 - 0.9 * (d / 2)) / Math.tan((a * PI) / 360);
export const csConeDepth = (d, D, a) => (D / 2 - d / 2) / Math.tan((a * PI) / 360);

// ---- the translator --------------------------------------------------------------------------------------------------------------------
/**
 * ctx: { arc, mt, runSC(cmds)->parsed, resolveAt(prefix, name) }, opts: { guards: Set of guard names to switch OFF (negative controls), cpu: fn }
 * Returns { features: [{id, kind, status, refusal?, guard?, raw?, measure?, unguarded?, probe?}], commands }.
 */
export function translateDocGuarded(doc, ctx, opts = {}) {
  const off = new Set(opts.off ?? []);
  const st = { head: {}, bodies: {}, stale: {}, refused: {}, sketches: {}, measure: {}, counter: 0, chain: {}, allCount: 0, allShells: 0 };
  const byId = Object.fromEntries(doc.features.map((f) => [f.id, f]));
  const accepted = []; const out = [];
  const headOf = (id) => { let h = id; const seen = new Set(); while (st.head[h] && !seen.has(h)) { seen.add(h); h = st.head[h]; } return h; };

  doc.features.forEach((f, idx) => {
    const prefix = doc.features.slice(0, idx);
    const fctx = { ...ctx, resolve: (name) => ctx.resolveAt(prefix, name) };
    const note = (o) => out.push({ id: f.id, kind: f.kind, ...o });
    if (f.kind === 'sketch') st.sketches[f.id] = f;
    let plan;
    try {
      plan = f.kind === 'hole' ? planHole(f, st, { ...fctx, accepted, headOf, byId, off })
        : f.kind === 'shell' && !f.open ? refuse(SHELL_SENTENCE.closed(f), 'G-CLOSED')
          : basePlan(f, st, fctx);
    } catch (e) { plan = refuse(`${f.id} (${f.kind}): this step could not be built, so ${f.id} is shown without it.`, 'translator-error'); plan.raw = String(e.message); }
    if (plan.refusal) { st.refused[f.id] = plan.refusal; return note({ status: 'refused', refusal: plan.refusal, guard: plan.guard, raw: plan.raw, probe: plan.probe, commands: [] }); }
    if (plan.noop) return note({ status: 'noop', commands: [] });
    let lastErr = null;
    for (const variant of plan.variants) {
      let res;
      try { res = ctx.runSC([...accepted, ...variant]); } catch (e) { res = { ok: false, failed: { error: `WASM TRAP: ${e.message}` } }; }
      if (!res.ok) { lastErr = res.failed ? `${res.failed.command}: ${res.failed.error}` : String(res.error ?? 'unknown'); continue; }
      const m = aggregateOf(res, plan.produces);
      if (!m) { lastErr = `solidcraft ran the commands but no body named ${plan.produces.join(', ')} came back`; continue; }
      const allBodies = res.measure.bodies.map((b) => ({ name: b.name, volume: b.volume_mm3, shells: b.kernel.shells ?? 1 }));
      if (plan.post) {
        const before = st.measure[headOf(f.target)] ?? st.measure[f.target];
        const bad = plan.post(m, before, { allBodies, allCountBefore: st.allCount, accepted, variant, off });
        if (bad) {
          st.refused[f.id] = bad.refusal;
          return note({ status: 'refused', refusal: bad.refusal, guard: bad.guard, unguarded: { volume: m.volume, faces: m.faces, bbox: m.bbox, shells: m.shells, bodies: allBodies.length, allVolume: allBodies.reduce((a, b) => a + b.volume, 0) }, commands: variant });
        }
      }
      if (f.kind === 'hole') {
        const h = headOf(f.target);
        const prev = st.chain[h];
        st.chain[f.id] = prev ?? { baseIdx: plan.baseIdx, baseMeasure: st.measure[h] ?? st.measure[f.target] };
      }
      accepted.push(...variant);
      st.allCount = res.measure.bodies.length;
      st.bodies[f.id] = m.bodies; st.measure[f.id] = m;
      for (const c of plan.consumes) {
        if (c === f.id) continue;
        if (f.kind === 'hole' || f.kind === 'pocket' || f.kind === 'groove') { if (c === (f.kind === 'hole' ? f.target : f.into)) st.head[c] = f.id; } else st.stale[c] = f.id;
      }
      return note({ status: 'built', commands: variant, measure: m, pickedFrom: plan.pickedFrom, probe: plan.probe, variantsTried: plan.variants.indexOf(variant) + 1 });
    }
    const sentence = f.kind === 'hole' ? SENTENCE.engine(f) : `${f.id} (${f.kind}): this step could not be built cleanly, so ${f.id} is shown without it.`;
    st.refused[f.id] = sentence;
    note({ status: 'refused', refusal: sentence, raw: lastErr, guard: 'G-ENGINE', commands: plan.variants[0] });
  });
  return { features: out, commands: accepted };
}

const byIdOf = (G, id) => G.byId[id];
function planHole(f, st, G) {
  const { accepted, headOf, runSC, off } = G;
  const head = headOf(f.target);
  if (st.refused[head]) return refuse(SENTENCE.dep(f, head), 'dependency');
  if (st.stale[head]) return refuse(SENTENCE.stale(f, head, st.stale[head]), 'dependency');
  const bs = st.bodies[head];
  const m = st.measure[head] ?? st.measure[f.target];
  if (!bs || !bs.length || !m) return refuse(SENTENCE.noBody(f), 'G-BODIES');
  if (!off.has('G-BODIES') && (bs.length !== 1 || st.allCount > 1)) return refuse(SENTENCE.multi(f, Math.max(bs.length, st.allCount)), 'G-BODIES');
  const axis = f.axis ?? 'z'; const ai = AXI[axis]; const dir = AX[axis];
  if (f.corners && axis !== 'z' && !off.has('G-CORNERS')) return refuse(SENTENCE.cornersAxis({ ...f, axis }), 'G-CORNERS');
  // ---- G-TORUS: a bore through a ring's tube is a curved-on-curved cut that does not finish (through-ring-offset-hits: no result in 300 s wall, 1 core busy)
  if (!off.has('G-TORUS')) {
    let root = G.byId[f.target]; const seenR = new Set();
    while (root && root.kind === 'hole' && !seenR.has(root.id)) { seenR.add(root.id); root = G.byId[root.target]; }
    if (root?.kind === 'torus') return refuse(SENTENCE.torus(f), 'G-TORUS');
  }
  // ---- G-TANGENT: a bore (or a recess ring) whose wall touches the part's side, or another bore, along a line leaves a zero-thickness wall: OCCT builds
  // 16 faces where truck builds 10 (holes-tangent-to-wall), brep-rs refuses ("a tangent contact brep-rs cannot cut yet"), and a one-sided check cannot tell which is right.
  if (!off.has('G-TANGENT')) {
    const bcT = [0, 1, 2].map((i) => (m.bbox[i] + m.bbox[i + 3]) / 2);
    const cT = [bcT[0] + f.center[0], bcT[1] + f.center[1], bcT[2] + f.center[2]];
    const cs4 = f.corners ? [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => [cT[0] + sx * f.corners.dx, cT[1] + sy * f.corners.dy, cT[2]]) : [cT];
    const aiT = AXI[axis]; const TOLT = 1e-6;
    const radii = [[f.diameter / 2, 'hole']]; if (f.counterbore) radii.push([f.counterbore.diameter / 2, 'recess']); if (f.countersink) radii.push([f.countersink.diameter / 2, 'recess']);
    for (const [R, what] of radii) {
      for (const c of cs4) for (const i of [0, 1, 2].filter((k) => k !== aiT)) {
        if (Math.abs(c[i] - R - m.bbox[i]) < TOLT || Math.abs(c[i] + R - m.bbox[i + 3]) < TOLT) return refuse(SENTENCE.tangent(f, what), 'G-TANGENT');
      }
      for (let a = 0; a < cs4.length; a++) for (let b = a + 1; b < cs4.length; b++) {
        const d = Math.hypot(...[0, 1, 2].filter((k) => k !== aiT).map((k) => cs4[a][k] - cs4[b][k]));
        if (d > TOLT && Math.abs(d - 2 * R) < TOLT) return refuse(SENTENCE.tangent(f, what), 'G-TANGENT');
      }
    }
    // earlier bores along the same axis
    for (let cur = G.byId[f.target], seenT = new Set(); cur && cur.kind === 'hole' && !seenT.has(cur.id); cur = G.byId[cur.target]) {
      seenT.add(cur.id);
      if ((cur.axis ?? 'z') !== axis) continue;
      const cc = [bcT[0] + cur.center[0], bcT[1] + cur.center[1], bcT[2] + cur.center[2]];
      const others = cur.corners ? [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => [cc[0] + sx * cur.corners.dx, cc[1] + sy * cur.corners.dy, cc[2]]) : [cc];
      for (const o of others) for (const c of cs4) {
        const d = Math.hypot(...[0, 1, 2].filter((k) => k !== aiT).map((k) => o[k] - c[k]));
        const r1 = cur.diameter / 2; const r2 = f.diameter / 2;
        if (d > TOLT && (Math.abs(d - (r1 + r2)) < TOLT || Math.abs(d - Math.abs(r1 - r2)) < TOLT)) return refuse(SENTENCE.tangent(f, 'hole'), 'G-TANGENT');
      }
    }
  }

  // ---- G-CROSS: a bore that meets an earlier bore drilled along another axis is a curved-on-curved cut that does not finish (measured: a z bore
  // crossed by an x through bore 98 s; a blind z bore then an x bore past 200 s). Tools are finite cylinders; the test is the common-perpendicular one.
  if (!off.has('G-CROSS')) {
    const bc0 = [0, 1, 2].map((i) => (m.bbox[i] + m.bbox[i + 3]) / 2);
    const toolsOf = (h) => { const a = h.axis ?? 'z'; const c = [bc0[0] + h.center[0], bc0[1] + h.center[1], bc0[2] + h.center[2]];
      const cs = h.corners ? [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => [c[0] + sx * h.corners.dx, c[1] + sy * h.corners.dy, c[2]]) : [c];
      return cs.map((cc) => ({ a: AXI[a], c: cc, L: h.depth / 2, r: h.diameter / 2 })); };
    const mine = toolsOf({ ...f, axis });
    for (let cur = byIdOf(G, f.target), seen = new Set(); cur && cur.kind === 'hole' && !seen.has(cur.id); cur = byIdOf(G, cur.target)) {
      seen.add(cur.id);
      if ((cur.axis ?? 'z') === axis) continue;
      for (const A of toolsOf(cur)) for (const B of mine) {
        const k = [0, 1, 2].find((i) => i !== A.a && i !== B.a);
        if (Math.abs(A.c[k] - B.c[k]) < A.r + B.r && Math.abs(B.c[A.a] - A.c[A.a]) <= A.L + B.r && Math.abs(A.c[B.a] - B.c[B.a]) <= B.L + A.r) return refuse(SENTENCE.cross(f, cur), 'G-CROSS');
      }
    }
  }
  const bc = [0, 1, 2].map((i) => (m.bbox[i] + m.bbox[i + 3]) / 2);
  const c0 = [bc[0] + f.center[0], bc[1] + f.center[1], bc[2] + f.center[2]];
  const centres = f.corners
    ? [[c0[0] - f.corners.dx, c0[1] - f.corners.dy, c0[2]], [c0[0] + f.corners.dx, c0[1] - f.corners.dy, c0[2]], [c0[0] - f.corners.dx, c0[1] + f.corners.dy, c0[2]], [c0[0] + f.corners.dx, c0[1] + f.corners.dy, c0[2]]]
    : [c0];
  const r = f.diameter / 2;
  const lo = m.bbox[ai]; const hi = m.bbox[ai + 3]; const T = hi - lo;
  const toolTop = c0[ai] + f.depth / 2; const toolBot = c0[ai] - f.depth / 2;
  const through = toolBot <= lo + 1e-9 && toolTop >= hi - 1e-9;
  const recess = f.counterbore ? 'counterbore' : f.countersink ? 'countersink' : null;
  const baseIdx = st.chain[head]?.baseIdx ?? accepted.length;
  const baseMeasure = st.chain[head]?.baseMeasure ?? m;
  const probeInfo = {};

  // ---- G-TOP: a blind bore, or any recess, starts at a face: check there is a flat, level top under it
  //  planar part: cut a thin disc at the tool top on the part as it was before the first hole in the chain; the volume it removes is exact (1e-12), so it
  //               must be the disc itself (material just below, none above).
  //  curved part: truck's volume is tessellation-derived (a 0.09 mm3 disc is lost in 3 mm3 of noise on a cylinder), so the volume probe cannot be used.
  //               The chain must be a flat-topped family (cylinder or pulled sketch drilled along its own axis, a sphere's pole) and the disc must add
  //               exactly two faces per centre (wall + floor: material below, opening onto air above).
  if (!off.has('G-TOP') && (!through || recess)) {
    const top = recess ? hi : toolTop;
    const eps = Math.min(r / 4, 1); const delta = 0.05;
    const want = PI * eps * eps * delta;
    const probeCmds = centres.map((c) => ({ command: 'solid.cylinder', params: { radius: eps, height: delta + 1, base: c.map((v, i) => (i === ai ? top - delta : v)), axis: AXN[axis], operation: 'cut', targets: bs } }));
    let removed = null; let failed = null; let dFaces = null; let ok = false; let why = null;
    const curvedBase = baseMeasure.curved;
    let flat = { ok: true };
    if (curvedBase) flat = flatTopCurved(f, axis, G, centres, bc);
    try {
      const res = runSC([...accepted.slice(0, baseIdx), ...probeCmds]);
      if (!res.ok) failed = `${res.failed?.command}: ${res.failed?.error}`;
      else {
        const a = aggregateOf(res, bs);
        removed = baseMeasure.volume - a.volume; dFaces = a.faces - baseMeasure.faces;
        if (curvedBase) ok = flat.ok && dFaces === 2 * centres.length && a.shells === baseMeasure.shells;
        else { const ratio = removed / (want * centres.length); ok = ratio >= 0.8 && ratio <= 1.2; why = ratio > 1.2 ? 'buried' : 'air'; }
      }
    } catch (e) { failed = String(e.message); }
    Object.assign(probeInfo, { top, eps, delta, curvedBase, wantEach: want, removed, ratio: removed === null ? null : removed / (want * centres.length), dFaces, flat: curvedBase ? flat : undefined, failed });
    if (!ok) {
      const buried = (removed !== null && !curvedBase && removed / (want * centres.length) > 1.2) || (curvedBase && dFaces === 3 * centres.length);
      const s = recess ? (buried ? SENTENCE.recessCavity(f, recess) : SENTENCE.topRecess(f, recess)) : SENTENCE.top(f);
      return { ...refuse(s, 'G-TOP'), probe: probeInfo };
    }
  }

  // ---- recess mapping -------------------------------------------------------------------------------------------------------------------
  if (recess) {
    if (!through && Math.abs(toolTop - hi) > 1e-9) return { ...refuse(SENTENCE.recessCavity(f, recess), 'G-RECESS'), probe: probeInfo };
    const cb = f.counterbore; const cs = f.countersink;
    const D = (cb ?? cs).diameter;
    if (!off.has('G-RECESS') && !(D > f.diameter + 1e-12)) return { ...refuse(SENTENCE.recessNarrow(f, cb ? 'counterbore' : 'countersink'), 'G-RECESS'), probe: probeInfo };
    const holeDepth = through ? T : f.depth;
    if (!off.has('G-RECESS') && cb && !(through ? cb.depth <= T + 1e-9 : cb.depth < holeDepth - 1e-9)) {
      return { ...refuse(SENTENCE.cbDeep(f, cb.depth, holeDepth, through ? 'part' : 'hole'), 'G-RECESS'), probe: probeInfo };
    }
    if (!off.has('G-RECESS') && cb && cb.depth <= 0) return { ...refuse(SENTENCE.cbDeep(f, cb.depth, holeDepth, 'hole'), 'G-RECESS'), probe: probeInfo };
    let need = null;
    if (cs && !through) {
      need = csToolDepth(f.diameter, cs.diameter, cs.angleDeg) + CS_MARGIN;
      if (!off.has('G-CSBAND') && holeDepth < need) return { ...refuse(SENTENCE.csBand(f, need, holeDepth), 'G-CSBAND'), probe: { ...probeInfo, need } };
    }
    const cmds = centres.map((c) => {
      const params = { position: c.map((v, i) => (i === ai ? hi : v)), diameter: f.diameter, body: bs[0] };
      if (!through) params.depth = holeDepth;
      if (cb) Object.assign(params, { type: 'counterbore', cb_diameter: cb.diameter, cb_depth: cb.depth });
      else Object.assign(params, { type: 'countersink', cs_diameter: cs.diameter, cs_angle: `${cs.angleDeg} deg` });
      return { command: 'solid.hole', params };
    });
    // closed-form post-check: a plain box host (6 planar faces, bbox volume == volume) with the whole recess inside its footprint
    const isBox = baseMeasure.faces === 6 && !baseMeasure.curved && Math.abs(baseMeasure.volume - (baseMeasure.bbox[3] - baseMeasure.bbox[0]) * (baseMeasure.bbox[4] - baseMeasure.bbox[1]) * (baseMeasure.bbox[5] - baseMeasure.bbox[2])) <= 1e-9 * baseMeasure.volume;
    const inside = centres.every((c) => [0, 1, 2].filter((i) => i !== ai).every((i) => c[i] - D / 2 >= baseMeasure.bbox[i] + 1e-9 && c[i] + D / 2 <= baseMeasure.bbox[i + 3] - 1e-9));
    const gap = centres.length > 1 ? Math.min(...centres.flatMap((a, i) => centres.slice(i + 1).map((b) => Math.hypot(...[0, 1, 2].filter((k) => k !== ai).map((k) => a[k] - b[k]))))) : Infinity;
    const expected = isBox && inside && gap >= D + 1e-9 ? centres.length * (cb ? cbRem(f.diameter, cb.diameter, cb.depth, holeDepth) : csRem(f.diameter, cs.diameter, cs.angleDeg, holeDepth)) : null;
    return {
      variants: [cmds], produces: bs, consumes: [f.target], baseIdx, probe: { ...probeInfo, need, expected },
      post: (after, before, env) => commonPost(f, after, before, env, { expected, recess }),
    };
  }

  // ---- plain bore ----------------------------------------------------------------------------------------------------------------------
  const cmds = centres.map((c) => ({
    command: 'solid.cylinder',
    params: { radius: r, height: f.depth, base: c.map((v, i) => v - dir[i] * f.depth / 2), axis: AXN[axis], operation: 'cut', targets: bs },
  }));
  return { variants: [cmds], produces: bs, consumes: [f.target], baseIdx, probe: probeInfo, post: (after, before, env) => commonPost(f, after, before, env, {}) };
}


/** curved parts only: is the part under the hole a flat-topped family, drilled along its own axis? Walks f.target back through earlier holes to the root primitive. */
function flatTopCurved(f, axis, G, centres, bc) {
  let cur = G.byId[f.target]; const seen = new Set();
  while (cur && cur.kind === 'hole' && !seen.has(cur.id)) { seen.add(cur.id); cur = G.byId[cur.target]; }
  if (!cur) return { ok: false, why: 'no root found' };
  const ai = AXI[axis];
  const rotate = (v, rot) => { // the translator's order: x, then y, then z, about the origin
    let [x, y, z] = v; const [rx, ry, rz] = (rot ?? [0, 0, 0]).map((d) => (d * PI) / 180);
    [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
    [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
    [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
    return [x, y, z];
  };
  if (cur.kind === 'cylinder') {
    const d = rotate([0, 0, 1], cur.rotate);
    return { ok: Math.abs(Math.abs(d[ai]) - 1) < 1e-9, root: 'cylinder', why: 'cylinder axis ' + d.map((v) => +v.toFixed(3)) };
  }
  if (cur.kind === 'extrude') {
    if (cur.taper || cur.direction || cur.midplane || cur.alongNormal) return { ok: false, root: 'extrude', why: 'tapered or slanted pull' };
    const sk = G.byId[cur.target]; if (!sk) return { ok: false, root: 'extrude', why: 'no sketch' };
    const n = sk.frame ? (() => { const u = sk.frame.u; const v = sk.frame.v; return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; })() : { xy: [0, 0, 1], xz: [0, -1, 0], yz: [1, 0, 0] }[sk.plane ?? 'xy'];
    return { ok: Math.abs(Math.abs(n[ai]) - 1) < 1e-9, root: 'extrude', why: 'pull normal ' + n };
  }
  if (cur.kind === 'sphere') {
    const perp = [0, 1, 2].filter((i) => i !== ai);
    return { ok: centres.length === 1 && perp.every((i) => Math.abs(centres[0][i] - bc[i]) < 1e-9), root: 'sphere', why: 'sphere pole only' };
  }
  return { ok: false, root: cur.kind, why: `a ${cur.kind} has no flat top` };
}

/** G-BODIES (post), G-SHELLS, G-NOOP, recess closed form */
function commonPost(f, after, before, env, { expected, recess }) {
  const off = env.off;
  if (!off.has('G-BODIES') && env.allBodies.length > env.allCountBefore) return { guard: 'G-BODIES', refusal: SENTENCE.split(f, env.allCountBefore, env.allBodies.length) };
  if (!before) return null;
  if (!off.has('G-SHELLS') && after.shells > before.shells) return { guard: 'G-SHELLS', refusal: SENTENCE.shells(f) };
  const curved = after.curved || before.curved;
  const dV = before.volume - after.volume;
  const tol = (curved ? COVER_TOL.curved : COVER_TOL.planar) * before.volume;
  if (!off.has('G-NOOP') && Math.abs(dV) <= tol && !(after.faces > before.faces)) return { guard: 'G-NOOP', refusal: SENTENCE.noop(f) };
  if (!off.has('G-NOOP') && !(after.faces > before.faces) && dV <= tol) return { guard: 'G-NOOP', refusal: SENTENCE.noop(f) };
  if (expected != null && !off.has('G-RECESS-VOL') && Math.abs(dV - expected) > RECESS_TOL * expected) return { guard: 'G-RECESS-VOL', refusal: SENTENCE.recessCheck(f, recess) };
  return null;
}
