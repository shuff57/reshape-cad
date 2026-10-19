// SPIKE (phase 4), referee/demo only. Not an engine, not an EngineAdapter, no engine mode, nothing in packages/.
//
// Resolves a ModelDoc topological NAME (packages/script/src/topo-name.ts) to a 3D pick point WITHOUT brep-rs, from
// solidcraft's own topology (the read-only `topology` snapshot of the phase 4 bridge: faces with centroid / planar
// normal / area / persistent name / own pick-hit, edges with start / mid / end / length / persistent `A|B` name).
//
// A name is resolved on the OWN SHAPE of the feature it names (the body solidcraft holds right after that feature
// was built), exactly where brep-rs `resolve` resolves it; the returned point is then a pick on the target body.
//
// Causes implemented (a name of any other cause is REFUSED with a sentence, never approximated):
//   primitive  box: +x -x +y -y +z -z; cylinder: +z -z, side (both halves); prism: +z -z. Unrotated, un-rounded only.
//   carried    a PLANAR face carried through one operation (combine / hole / pocket / groove / shell / fillet / draft):
//              the parent's plane is looked up on the operation's own shape; exactly one face on that plane.
//   cap        top / bottom of a plain extrude: the planar end face at the sketch plane / sketch plane + height.
//   swept      the side of a plain extrude from a STRAIGHT sketch edge of an uncornered polygon sketch.
//   between    an EDGE shared by two faces of the same shape (each one of the above): geometry (both planes) AND
//              solidcraft's persistent edge name must agree; a closed loop split by a seam (a cylinder rim) is one edge.
// Refused: rounded, split, made, swept over an arc / rounded corner / revolve, rotated or rounded primitives, sphere, cone,
// torus, wedge faces, a curved `carried` face, a name whose faces live on two different shapes, any name matching zero
// or more than one candidate (the sentence names the name and the count), and any pick point solidcraft's own
// nearest-face rule would not send back to the intended face.
//
// Every resolution also records `evidence`: candidate counts, the persistent solidcraft names it landed on, and the
// result of the two independent cross-checks (doc-derived plane; solidcraft persistent name).

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const nrm = (a) => Math.hypot(a[0], a[1], a[2]);
const AXV = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };
const ANGLE_TOL = 1e-6;

export function nameText(n) {
  if (!n || typeof n !== 'object') return String(n);
  switch (n.cause) {
    case 'primitive': return `${n.feature}.${n.kind}[${n.part}]`;
    case 'swept': return `${n.feature}.${n.kind}[${n.from}.edge${n.edge}]`;
    case 'rounded': return `${n.feature}.${n.kind}[${n.from}.corner${n.corner}]`;
    case 'cap': return `${n.feature}.cap[${n.end}]`;
    case 'carried': return `${n.feature}.same[${nameText(n.of)}]`;
    case 'between': return `${n.feature}.edge[${nameText(n.of?.[0])} ^ ${nameText(n.of?.[1])}]`;
    default: return `${n.feature ?? '?'}.${n.cause ?? '?'}`;
  }
}

const fail = (sentence) => ({ ok: false, sentence });
const scaleOf = (shape) => {
  let s = 1;
  for (const f of shape.faces) for (const v of f.centroid) s = Math.max(s, Math.abs(v));
  for (const e of shape.edges) for (const p of [e.start, e.mid, e.end]) for (const v of p) s = Math.max(s, Math.abs(v));
  return s;
};
const planarOf = (f) => (f.plane_normal && nrm(f.plane_normal) > 0.5 ? { n: f.plane_normal, d: dot(f.plane_normal, f.centroid) } : null);
const parallel = (a, b) => dot(a, b) >= 1 - ANGLE_TOL; // same direction, both unit

/**
 * The point to hand solidcraft for a FACE pick: its centroid when solidcraft's own nearest-face rule sends that point back
 * to this face; otherwise (a face with a hole has its centroid in the hole) the centroid of its largest display triangle,
 * a point that is on the face by construction, again only if solidcraft's rule sends it back. Else no point: refuse.
 */
export function pickPoint(f, tol) {
  const ok = (h) => h && h.index === f.index && h.dist <= tol;
  if (ok(f.centroid_hit)) return { ok: true, point: f.centroid, source: 'centroid' };
  if (f.inner_point && ok(f.inner_hit)) return { ok: true, point: f.inner_point, source: 'interior point (largest display triangle); the centroid is off the face' };
  const h = f.centroid_hit;
  return { ok: false, why: h ? `solidcraft's nearest-face rule sends a pick at its centroid to face ${h.index} (${h.dist.toExponential(2)} mm away), not to face ${f.index}, and no interior point on it survives the same test` : 'the topology snapshot has no pick-hit for it' };
}

/**
 * env = {
 *   features: [ModelDoc features before the picking feature],
 *   shapeOf(featureId) -> Promise<{ok:true, bodyName, featureNumber|null, faces, edges} | {ok:false, sentence}>,
 *   sketchFrame(sketchFeature) -> {origin,u,v,n},
 *   outline(sketchFeature) -> {ok, points, bulges, notes}
 * }
 */
export async function resolveName(name, env, want) {
  const r = name?.cause === 'between' ? await resolveEdge(name, env) : await resolveFaceName(name, env);
  if (!r.ok) return r;
  if (want && r.kind !== want) return fail(`${nameText(name)} names ${r.kind === 'edge' ? 'an edge' : r.kind === 'faceset' ? `a set of ${r.faces.length} faces` : 'a face'}, but this feature needs ${want === 'edge' ? 'an edge' : 'a face'}`);
  if (r.kind === 'face') {
    // A provisional point on the NAME'S OWN shape (evidence only). The pick that is actually used is made on the TARGET
    // body by the translator (confirmOnTarget): count, pick-hit and interior point are all re-done there.
    const tol = 1e-6 * Math.max(1, scaleOf(r.shape)) * 10;
    const p = pickPoint(r.faces[0], Math.max(tol, 1e-4));
    r.point = p.ok ? p.point : null;
    r.evidence.pickPoint = p.ok ? `own shape: ${p.source}` : `own shape: none (${p.why})`;
  }
  return r;
}

// ---------------------------------------------------------------------------------------------------- faces
async function resolveFaceName(name, env) {
  const t = nameText(name);
  if (!name || name.kind !== 'face') return fail(`${t} is not a face name`);
  const f = env.features.find((x) => x.id === name.feature);
  if (!f) return fail(`${t}: there is no feature ${name.feature} before this one`);
  switch (name.cause) {
    case 'primitive': return primitiveFace(name, f, env, t);
    case 'cap': return capFace(name, f, env, t);
    case 'swept': return sweptFace(name, f, env, t);
    case 'carried': return carriedFace(name, f, env, t);
    case 'rounded': return fail(`${t}: a name made by a ROUNDED sketch corner is not resolved in the browser demo (only primitive, cap, swept-by-a-straight-edge, carried-plane and between names are)`);
    case 'split': case 'made':
      return fail(`${t}: a '${name.cause}' name (a piece of a face, or a face an operation made) is not resolved in the browser demo; it needs a discriminator point and solidcraft has no history record to read it from`);
    default: return fail(`${t}: the name cause '${name.cause}' is not one this demo knows`);
  }
}

function finishFace(t, shape, cands, extra) {
  const tol = 1e-6 * Math.max(1, scaleOf(shape));
  if (cands.length === 0) return fail(`${t} matches no face on ${shape.bodyName} (${extra.rule}); not guessing`);
  if (cands.length > 1) return fail(`${t} matches ${cands.length} faces on ${shape.bodyName} (${cands.map((c) => c.name).join(', ')}; ${extra.rule}); a name must pick exactly one, so nothing is picked`);
  const face = cands[0];
  return {
    ok: true, kind: 'face', area: face.area, shape,
    faces: [face], plane: planarOf(face),
    evidence: { name: t, candidates: 1, engineFace: face.name, rule: extra.rule, checks: extra.checks ?? [] },
  };
}

async function shapeFor(env, featureId, t) {
  const s = await env.shapeOf(featureId);
  if (!s.ok) return fail(`${t}: ${s.sentence}`);
  return s;
}

const rotated = (f) => Array.isArray(f.rotate) && f.rotate.some((v) => v);

async function primitiveFace(name, f, env, t) {
  const part = name.part;
  const isPrim = ['box', 'cylinder', 'prism'].includes(f.kind);
  if (isPrim && rotated(f)) return fail(`${t}: ${f.id} is rotated; this demo resolves primitive faces only on unrotated primitives (the part names the face by direction, and a rotated body turns solidcraft's own face labels too)`);
  if (isPrim && f.round) return fail(`${t}: ${f.id} carries a whole-shape round, which changes its faces and edges; not resolved`);
  if (part === 'side' && f.kind !== 'cylinder') return fail(`${t}: only a cylinder primitive has a 'side' face in this demo`);
  if (part !== 'side' && !AXV[part]) return fail(`${t}: '${part}' is not a face part this demo knows`);
  if ((f.kind === 'cylinder' || f.kind === 'prism') && part !== 'side' && part !== '+z' && part !== '-z') return fail(`${t}: a ${f.kind} has no ${part} face`);
  if (['sphere', 'cone', 'torus', 'wedge'].includes(f.kind)) return fail(`${t}: faces of a ${f.kind} are not resolved in the browser demo`);
  const shape = await shapeFor(env, f.id, t);
  if (!shape.ok) return shape;
  const tol = 1e-6 * Math.max(1, scaleOf(shape));
  const c = f.center ?? [0, 0, 0];
  if (part === 'side') {
    const curved = shape.faces.filter((x) => !x.plane_normal);
    if (curved.length === 0) return fail(`${t} matches no curved face on ${shape.bodyName}; not guessing`);
    // a cylinder's wall is one face in the doc; solidcraft splits it at the seam into 2. A standalone face pick of it is
    // ambiguous (which half?), an edge between a cap and the wall is not (see resolveEdge, which takes the whole set).
    return { ok: true, kind: 'faceset', faces: curved, shape, evidence: { name: t, candidates: curved.length, engineFaces: curved.map((x) => x.name), rule: 'every non-planar face of the cylinder primitive' } };
  }
  const dir = AXV[part];
  // rule 1 (geometry only, brep-rs's own idea): planar, outward normal == dir, centroid extreme along dir
  const planar = shape.faces.filter((x) => x.plane_normal && parallel(x.plane_normal, dir));
  const best = planar.length ? Math.max(...planar.map((x) => dot(x.centroid, dir))) : null;
  const cands = planar.filter((x) => best !== null && Math.abs(dot(x.centroid, dir) - best) <= tol * 10);
  const checks = [];
  if (cands.length === 1 && isPrim) {
    // rule 2 (the doc alone): the plane the primitive's own parameters put there
    const axis = dir.findIndex((v) => v !== 0);
    const half = f.kind === 'box' ? f.size[axis] / 2 : f.height / 2;
    const docOffset = (c[axis] + Math.sign(dir[axis]) * half) * Math.sign(dir[axis]);
    const got = dot(cands[0].centroid, dir);
    const okDoc = Math.abs(got - docOffset) <= 1e-6 * Math.max(1, Math.abs(docOffset));
    checks.push({ check: 'doc plane', expected: docOffset, got, agree: okDoc });
    if (!okDoc) return fail(`${t}: solidcraft's face ${cands[0].name} is at ${got} along ${part} but ${f.id}'s own parameters put that face at ${docOffset}; the two disagree, so nothing is picked`);
    // rule 3: solidcraft's persistent name for it
    const want = shape.featureNumber != null ? persistentPrimitive(f.kind, shape.featureNumber, part) : null;
    if (want) {
      const ok = cands[0].name === want || cands[0].name.startsWith(want + '#');
      checks.push({ check: 'engine persistent name', expected: want, got: cands[0].name, agree: ok });
      if (!ok) return fail(`${t}: solidcraft names that face ${cands[0].name}, not ${want} as a ${f.kind}'s ${part} should be; the two disagree, so nothing is picked`);
    } else checks.push({ check: 'engine persistent name', agree: null, note: 'feature number or kind not mapped; skipped' });
  } else if (cands.length === 1) {
    checks.push({ check: 'doc plane', agree: null, note: `${f.id} is a ${f.kind}: no doc-derived plane for a built shape; the rule is geometry on solidcraft's own shape only` });
  }
  return finishFace(t, shape, cands, { rule: `planar face with outward normal ${part} at the extreme along it on ${f.id}'s own shape`, checks });
}

function persistentPrimitive(kind, n, part) {
  if (kind === 'box') return `F${n}:${part}`;
  if (kind === 'cylinder') return part === '+z' ? `F${n}:top` : part === '-z' ? `F${n}:bottom` : null;
  return null;
}

function extrudeOf(env, f, t) {
  if (f.kind !== 'extrude') return { err: fail(`${t}: ${f.id} is a ${f.kind}, not a plain extrude; sweep names of other features are not resolved in the browser demo`) };
  for (const k of ['midplane', 'length2', 'reversed', 'taper', 'direction', 'alongNormal']) {
    if (f[k]) return { err: fail(`${t}: ${f.id} uses the ${k} option, which the translator does not map; not resolved`) };
  }
  const sk = env.features.find((x) => x.id === f.target && x.kind === 'sketch');
  if (!sk) return { err: fail(`${t}: ${f.id}'s sketch ${f.target} is not in the document before this feature`) };
  const f0 = env.sketchFrame(sk);
  // the sweep runs along u x v (xy +Z, xz -Y, yz +X): NOT the `n` of a named-plane table, whose xz entry has the opposite sign
  const [u, v] = [f0.u, f0.v];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  return { sk, fr: { ...f0, n } };
}

async function capFace(name, f, env, t) {
  const { fr, err } = extrudeOf(env, f, t);
  if (err) return err;
  if (name.end !== 'top' && name.end !== 'bottom') return fail(`${t}: cap end '${name.end}' is not top or bottom`);
  const shape = await shapeFor(env, f.id, t);
  if (!shape.ok) return shape;
  const tol = 1e-6 * Math.max(1, scaleOf(shape));
  const outward = name.end === 'top' ? fr.n : fr.n.map((v) => -v);
  const d = dot(fr.origin, fr.n) + (name.end === 'top' ? f.height : 0);
  const want = d * (name.end === 'top' ? 1 : -1);
  const cands = shape.faces.filter((x) => x.plane_normal && parallel(x.plane_normal, outward) && Math.abs(dot(x.centroid, outward) - want) <= tol * 10);
  return finishFace(t, shape, cands, { rule: `planar face, outward normal along the sketch normal ${name.end === 'top' ? '' : 'reversed '}at the sketch plane${name.end === 'top' ? ' + height' : ''}`, checks: [{ check: 'doc plane', expected: want, agree: cands.length === 1 }] });
}

async function sweptFace(name, f, env, t) {
  const { sk, fr, err } = extrudeOf(env, f, t);
  if (err) return err;
  if (name.from !== sk.id) return fail(`${t}: the name was written against sketch ${name.from} but ${f.id} sweeps ${sk.id}; not resolved`);
  if (sk.shape === 'circle' || (Array.isArray(sk.geoms) && sk.geoms.length)) return fail(`${t}: ${sk.id} is a circle or a rows-and-rules sketch; a swept name over it is not resolved in the browser demo`);
  const o = env.outline(sk);
  if (!o.ok) return fail(`${t}: ${sk.id} has no usable outline`);
  const pts = o.points;
  const designN = Array.isArray(sk.points) ? sk.points.length : null;
  if (designN === null || pts.length !== designN) return fail(`${t}: ${sk.id} has rounded or chamfered corners (its outline has ${pts.length} segments for ${designN ?? '?'} design edges), so the sketch edge index does not map to one straight wall; not resolved`);
  const i = name.edge;
  if (!Number.isInteger(i) || i < 0 || i >= pts.length) return fail(`${t}: ${sk.id} has no edge ${String(i)}`);
  if ((o.bulges ?? {})[i]) return fail(`${t}: sketch edge ${i} of ${sk.id} is an arc; a swept name over an arc is not resolved in the browser demo (only straight edges are)`);
  const a2 = pts[i]; const b2 = pts[(i + 1) % pts.length];
  const w = (p) => [0, 1, 2].map((k) => fr.origin[k] + fr.u[k] * p[0] + fr.v[k] * p[1]);
  const A = w(a2); const B = w(b2);
  const dir = sub(B, A); const L = nrm(dir);
  if (L < 1e-9) return fail(`${t}: sketch edge ${i} has zero length`);
  const e = dir.map((v) => v / L);
  const cr = [fr.n[1] * e[2] - fr.n[2] * e[1], fr.n[2] * e[0] - fr.n[0] * e[2], fr.n[0] * e[1] - fr.n[1] * e[0]];
  const cn = nrm(cr);
  const nOut = cr.map((v) => v / cn);
  const shape = await shapeFor(env, f.id, t);
  if (!shape.ok) return shape;
  const tol = 1e-6 * Math.max(1, scaleOf(shape));
  const mid = [0, 1, 2].map((k) => (A[k] + B[k]) / 2 + (fr.n[k] * f.height) / 2);
  // a wall of a straight edge is a planar rectangle: normal perpendicular to the edge and to the sketch normal (either
  // sign), centroid at the lifted edge midpoint, area edge length x height
  const cands = shape.faces.filter((x) => x.plane_normal && Math.abs(Math.abs(dot(x.plane_normal, nOut)) - 1) <= ANGLE_TOL
    && nrm(sub(x.centroid, mid)) <= tol * 10 && Math.abs(x.area - L * Math.abs(f.height)) <= 1e-6 * Math.max(1, L * Math.abs(f.height)));
  return finishFace(t, shape, cands, { rule: `planar wall through sketch edge ${i} lifted by the height (centroid and area match)`, checks: [{ check: 'doc wall centroid', expected: mid, agree: cands.length === 1 }] });
}

async function carriedFace(name, f, env, t) {
  if (['move', 'rotate', 'mirror', 'pattern'].includes(f.kind)) return fail(`${t}: ${f.id} is a ${f.kind}, which moves or copies faces; a carried name through it is not resolved`);
  if (!name.of || name.of.kind !== 'face') return fail(`${t}: a carried name must wrap a face name`);
  const parent = await resolveFaceName(name.of, env);
  if (!parent.ok) return fail(`${t}: its parent ${parent.sentence}`);
  return liftTo(parent, f.id, env, t);
}

/**
 * Move a resolved PLANAR face from the shape it was named on to the own shape of feature `T` that consumed it:
 * the same plane (the normal flips when the face was a subtracted tool's), exactly one face there, no larger than the
 * original, and solidcraft's persistent name must be the same. Anything else is a refusal, not a nearest guess.
 */
async function liftTo(r, T, env, t) {
  if (r.shape.featureId === T) return r;
  if (r.kind === 'faceset') return fail(`${t}: its face is a set of ${r.faces.length} faces (a cylinder wall split at the seam); lifting a set through ${T} is not resolved`);
  if (!r.plane) return fail(`${t}: the face ${r.faces[0].name} is curved; a CURVED face carried through ${T} is not resolved in the browser demo (it would have to be matched by surface, and only planes are)`);
  const Tf = env.features.find((x) => x.id === T);
  if (!Tf) return fail(`${t}: there is no feature ${T} before this one`);
  if (['move', 'rotate', 'mirror', 'pattern'].includes(Tf.kind)) return fail(`${t}: ${T} is a ${Tf.kind}, which moves or copies faces; a name through it is not resolved`);
  const consumed = [...(Tf.targets ?? []), Tf.target, Tf.into].filter(Boolean);
  if (!consumed.includes(r.shape.featureId)) return fail(`${t}: ${T} does not take ${r.shape.featureId} as an input (it takes ${consumed.join(', ') || 'nothing'}), so the face cannot have been carried through it`);
  const flip = Tf.kind === 'combine' && Tf.op === 'subtract' && Tf.targets.indexOf(r.shape.featureId) >= 1;
  const shape = await shapeFor(env, T, t);
  if (!shape.ok) return shape;
  const tol = 1e-6 * Math.max(1, scaleOf(shape));
  const n = flip ? r.plane.n.map((v) => -v) : r.plane.n;
  const d = flip ? -r.plane.d : r.plane.d;
  const cands = shape.faces.filter((x) => x.plane_normal && parallel(x.plane_normal, n) && Math.abs(dot(x.centroid, n) - d) <= tol * 10);
  const checks = [...(r.evidence.checks ?? []), { check: 'lift', from: r.shape.featureId, to: T, flipped: flip, plane: { n, d } }];
  if (cands.length === 1) {
    const ratio = cands[0].area / r.faces[0].area;
    checks.push({ check: 'area vs original', ratio });
    if (ratio > 1 + 1e-6) return fail(`${t}: the face on that plane of ${T} is LARGER than the original (${cands[0].area} vs ${r.faces[0].area}); it was merged with another face, so it is not the carried one; nothing is picked`);
    const nm = cands[0].name; const was = r.faces[0].name;
    const same = nm === was || nm.startsWith(was + '#') || was.startsWith(nm + '#');
    checks.push({ check: 'engine persistent name kept', expected: was, got: nm, agree: same });
    if (!same) return fail(`${t}: the face on that plane of ${T} is named ${nm} by solidcraft, not ${was}; the geometry and the persistent names disagree, so nothing is picked`);
  }
  const out = finishFace(t, shape, cands, { rule: `the planar face on ${r.faces[0].name}'s plane${flip ? ' (flipped: it was a subtracted tool)' : ''} on ${T}'s own shape`, checks });
  if (out.ok) out.evidence.liftedFrom = r.evidence;
  return out;
}

// ---------------------------------------------------------------------------------------------------- edges
const parseEdgeName = (n) => {
  if (typeof n !== 'string') return null;
  const parts = n.replace(/~\d+$/, '').split('|');
  return parts.length === 2 ? parts : null;
};
const near = (p, q, tol) => nrm(sub(p, q)) <= tol;

async function resolveEdge(name, env) {
  const t = nameText(name);
  if (name.kind !== 'edge' || !Array.isArray(name.of) || name.of.length !== 2) return fail(`${t} is not a well-formed between name`);
  const f = env.features.find((x) => x.id === name.feature);
  if (!f) return fail(`${t}: there is no feature ${name.feature} before this one`);
  let A = await resolveFaceNameOrSet(name.of[0], env);
  if (!A.ok) return fail(`${t} cannot be resolved: ${A.sentence}`);
  let B = await resolveFaceNameOrSet(name.of[1], env);
  if (!B.ok) return fail(`${t} cannot be resolved: ${B.sentence}`);
  // the edge lives on ITS feature's own shape; a face named on an earlier shape (a pocket tool's wall, a plate's top
  // before the pocket) is first carried onto that shape
  A = await liftTo(A, name.feature, env, t);
  if (!A.ok) return A;
  B = await liftTo(B, name.feature, env, t);
  if (!B.ok) return B;
  if (A.shape.bodyName !== B.shape.bodyName || A.shape.featureId !== B.shape.featureId) return fail(`${t}: its two faces live on different shapes (${A.shape.featureId} and ${B.shape.featureId}); an edge between faces of two different features is not resolved`);
  const shape = A.shape;
  const tol = 1e-6 * Math.max(1, scaleOf(shape));
  const aNames = new Set(A.faces.map((x) => x.name)); const bNames = new Set(B.faces.map((x) => x.name));
  const planeA = A.faces.length === 1 ? planarOf(A.faces[0]) : null;
  const planeB = B.faces.length === 1 ? planarOf(B.faces[0]) : null;
  const onPlane = (e, pl) => [e.start, e.mid, e.end].every((p) => Math.abs(dot(pl.n, p) - pl.d) <= tol * 10);
  const byName = shape.edges.filter((e) => {
    const pr = parseEdgeName(e.name);
    return pr && ((aNames.has(pr[0]) && bNames.has(pr[1])) || (aNames.has(pr[1]) && bNames.has(pr[0])));
  });
  let cands; let geoAll = null;
  if (planeA && planeB) {
    geoAll = shape.edges.filter((e) => onPlane(e, planeA) && onPlane(e, planeB));
    const sameSet = geoAll.length === byName.length && geoAll.every((e) => byName.some((x) => x.index === e.index));
    if (!sameSet) return fail(`${t}: geometry finds ${geoAll.length} edge(s) on both planes but solidcraft's persistent edge names find ${byName.length}; the two disagree, so nothing is picked`);
    cands = geoAll;
  } else {
    const pl = planeA ?? planeB;
    cands = pl ? byName.filter((e) => onPlane(e, pl)) : byName;
    if (byName.length !== cands.length) return fail(`${t}: ${byName.length - cands.length} of the edges solidcraft names for it do not lie on the planar face's plane; the two disagree, so nothing is picked`);
  }
  if (cands.length === 0) return fail(`${t} matches no edge on ${shape.bodyName} (the two faces do not meet there any more, or never did); not guessing`);
  // a closed loop that solidcraft splits at a seam (a cylinder rim = 2 half circles) is ONE edge in the doc
  if (cands.length > 1) {
    const ends = cands.flatMap((e) => [e.start, e.end]);
    const closed = ends.every((p, i) => ends.filter((q, j) => j !== i && near(p, q, tol * 10)).length === 1);
    if (!closed) return fail(`${t} matches ${cands.length} separate edges on ${shape.bodyName} (${cands.map((e) => e.name).join(', ')}) that do not form one closed loop; a name must pick exactly one edge, so nothing is picked`);
  }
  const e0 = cands[0];
  return {
    ok: true, kind: 'edge', point: e0.mid, length: cands.reduce((s, e) => s + e.length, 0), shape, edges: cands,
    evidence: {
      name: t, candidates: cands.length, loop: cands.length > 1, engineEdges: cands.map((e) => e.name), pointOn: e0.name,
      facesA: [...aNames], facesB: [...bNames],
      checks: [planeA && planeB ? { check: 'geometry vs persistent names', agree: true, geometric: geoAll.length, named: byName.length } : { check: 'persistent names + plane of the planar face', agree: true, named: byName.length }],
    },
  };
}

/** A face name inside `between` may resolve to a whole SET of engine faces (a cylinder's two wall halves). */
async function resolveFaceNameOrSet(name, env) {
  const r = await resolveFaceName(name, env);
  if (!r.ok) return r;
  return { ...r, faces: r.faces };
}
