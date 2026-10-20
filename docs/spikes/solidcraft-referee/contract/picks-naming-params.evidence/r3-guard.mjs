// Round 3. The picks-naming-params guard + plain-sentence layer, wrapped AROUND the page translator (phase7/pane/lib/translate-p4.mjs,
// unchanged). Nothing here is in the SolidCraft page today (phase7/pane/src/host-entry.mjs exports translateDoc straight from
// translate-p4.mjs); this file is the specification of what the page must add, and r3a/r3b/r3c measure it.
//
//   guardedTranslate(doc, {guards, plain})  ->  the page's translateDoc result, with
//     * guards: a post-check on the engine result of every solid.draft / solid.shell / solid.chamfer command (the three pick consumers
//       that take a size or an angle). A failing check makes the engine call look refused, so the translator refuses the feature and its
//       dependents exactly as it does for any engine refusal. Rules (all are measured in r3a/r3b, zero false refusals there):
//         G-DRAFT   a draft must keep the face count of its target (the tilted face crossing the opposite face drops a face).
//         G-HOLLOW  a hollow must lose volume and gain faces (a wall at or past the collapse point returns the unhollowed block).
//         G-BEVEL   a bevel must gain exactly one face (a bevel larger than the face beside the edge clips the solid; the count stays).
//         G-DRAFTWALL a draft of a wall of a HOLLOWED part whose tilt over the part's height (distance from the neutral plane to the farther end, times tan(angle)) reaches the wall thickness. Directional: only the side that leans in counts.
//         G-RIM     a ROUND on an edge of a hollow's open face with radius >= the wall leaves a knife edge or cuts through it (the shell-draft guard of the same name covers
//                   only the opposite order, round THEN hollow; hollow THEN round is unguarded there: measured in r3i).
//         G-RIMFIRST (round 5) a ROUND of an edge of the open face with radius >= the wall, made BEFORE the hollow (round THEN hollow; G-RIM covers hollow THEN round). r < wall is right
//                   (r5b-roundhollow.mjs: 4/4 equal to brep-rs and the closed form); r = wall leaves a zero-width knife-edge rim; r > wall builds MORE material than the un-rounded hollow.
//         G-STALE   (round 5, document level) a round/bevel/hollow/draft whose target is a part that a pocket() or groove() already cut, where the script did not keep the cut's result. The page
//                   re-targets such a pick onto the cut part without a word; the ModelDoc (and both oracles) put the cut on a branch the pick does not see. Refused with a sentence.
//         G-CONVEX  (round 5) a hollow of a part with a reflex (inside) edge: a join / cut / pocket / groove / mirror / blind hole / L-outline. SolidCraft offsets by planes, OCCT rounds the cavity at the
//                   edge, the page builds the plane-offset solid silently (rows "hollow ... on a shape with a reflex edge" and "blind hole then hollow"). The rule and the sentences are the shell-draft group's
//                   (shell-draft-translate.mjs convexity(), measured there on ~1100 cases); a join / mirror whose result is a plain box is let through, as there. Document level, like G-STALE.
//         G-OUTLINE a sketch outline that crosses or touches itself (a bow-tie from a corner slider) is refused before it is extruded or cut
//                   (the outline guard of the extrude-pocket group, contract/outline-guard.mjs, applied to every sketch the translator maps).
//     * plain: every refusal text the translator produces is rewritten as ONE plain sentence by plainFor() below. The raw text is kept
//       in feature.rawRefusal.
import * as L from './lib.mjs';
import { pathToFileURL } from 'node:url';
const SD = await import(pathToFileURL(new URL('../shell-draft-translate.mjs', import.meta.url).pathname).href);
const OG = await import(pathToFileURL(new URL('../outline-guard.mjs', import.meta.url).pathname).href);

const WORD = { '+z': 'top', '-z': 'bottom', '-y': 'front', '+y': 'back', '-x': 'left', '+x': 'right', side: 'side' };
const OPP = { '+z': '-z', '-z': '+z', '-y': '+y', '+y': '-y', '-x': '+x', '+x': '-x' };
const VERBED = { union: 'joined', subtract: 'cut', intersect: 'intersected' };
const fmt = (n) => (Number.isInteger(n) ? String(n) : String(+Number(n).toFixed(3)));
const GUARDED = new Set(['solid.draft', 'solid.shell', 'solid.chamfer']);

// ---------------------------------------------------------------------------------------------------------------- guards
const agg = (res, name) => {
  const b = (res.measure?.bodies ?? []).find((x) => x.name === name);
  if (!b) return null;
  return { volume: b.volume_mm3, faces: b.faces, curved: Object.keys(b.face_types ?? {}).some((k) => k !== 'plane'), bbox: [...b.bbox.min, ...b.bbox.max], faceTypes: b.face_types ?? {} };
};
/**
 * G-HOLLOW test (round 6). Round 3 used one rule: a hollow must lose volume and gain faces. On a curved part that is wrong: SolidCraft's volume of a
 * cylinder is derived from its tessellation, so the volume of a VALID thin-walled cylinder hollow (cylinder(20,30), wall 9.9, open top: built 9424.053)
 * is above the un-hollowed volume (9423.69) and the rule refused a good build with the sentence "wall of 9.9 ... has to be under 10".
 * For a plain box or a plain cylinder whose open face is found, the decision is now the closed-form collapse limit min(depth, narrowest lateral / 2),
 * the same limit the sentence states, so a wall under the limit is never refused and one at or past it always is. For a plain cylinder the
 * built volume is also checked against the closed form pi*(R^2 h - (R-t)^2 (h-t)) with the 3e-4 curved bar the sweeps already used
 * (fixed before this run, not fitted). Everything else keeps the round-3 rule (volume must drop, faces must rise).
 * Returns true when the hollow must be refused. `last.params.faces[0]` is a point on the open face.
 */
export function hollowBad(last, before, after) {
  const q = last.params.faces?.[0]; const t = last.params.thickness;
  const types = Object.keys(before.faceTypes ?? {});
  const planarBox = before.faces === 6 && types.every((k) => k === 'plane');
  const cyl = before.faces === 3 && before.faceTypes.cylinder === 1 && before.faceTypes.plane === 2 && types.length === 2;
  const ext = [0, 1, 2].map((i) => before.bbox[i + 3] - before.bbox[i]);
  const a = q && (planarBox || cyl) ? [0, 1, 2].find((i) => Math.abs(q[i] - before.bbox[i]) < 1e-6 || Math.abs(q[i] - before.bbox[i + 3]) < 1e-6) : undefined;
  if (a === undefined) return !(after.volume < before.volume * (1 - 1e-9) && after.faces > before.faces);
  const lat = Math.min(...ext.filter((_, i) => i !== a)) / 2;
  if (t >= Math.min(ext[a], lat) * (1 - 1e-9)) return true; // at or past the collapse point
  if (!(after.faces > before.faces)) return true;
  if (planarBox) return !(after.volume < before.volume * (1 - 1e-9));
  const o = [0, 1, 2].filter((i) => i !== a);
  if (Math.abs(ext[o[0]] - ext[o[1]]) < 1e-6 * ext[o[0]]) { // a cylinder whose axis is the open axis
    const R = ext[o[0]] / 2; const h = ext[a];
    const want = Math.PI * (R * R * h - (R - t) ** 2 * (h - t));
    return !(Math.abs(after.volume - want) <= 3e-4 * want);
  }
  return !(after.faces > before.faces);
}
export const guardLog = new Map(); // JSON(last command) -> {guard, before, after}
export function guardedRunSC(base = L.runSC) {
  return (cmds) => {
    const res = base(cmds);
    const last = cmds[cmds.length - 1];
    if (!res.ok || !last) return res;
    if (last.command === 'solid.shell') {
      const body = last.params.body; const q = last.params.faces?.[0]; const t = last.params.thickness;
      const fl = cmds.slice(0, -1).filter((c) => c.command === 'solid.fillet' && c.params.body === body);
      if (q && fl.length) {
        const pre = agg(base(cmds.slice(0, -1)), body);
        const a = pre ? [0, 1, 2].find((i) => Math.abs(q[i] - pre.bbox[i]) < 1e-6 || Math.abs(q[i] - pre.bbox[i + 3]) < 1e-6) : undefined;
        const hit = a === undefined ? null : fl.find((c) => c.params.radius >= t - 1e-9 && (c.params.edges ?? []).some((p) => Math.abs(p[a] - q[a]) < 1e-6));
        if (hit) {
          guardLog.set(JSON.stringify(last), { guard: 'G-RIMFIRST', t, r: hit.params.radius });
          return { ok: false, failed: { command: last.command, error: '@@G-RIMFIRST@@' } };
        }
      }
    }
    if (last.command === 'solid.fillet') {
      const body = last.params.body; let j = -1; for (let i = cmds.length - 2; i >= 0; i--) if (cmds[i].command === 'solid.shell' && cmds[i].params.body === body) { j = i; break; }
      if (j < 0) return res;
      const sh = cmds[j]; const t = sh.params.thickness; const q = sh.params.faces?.[0]; const p = last.params.edges?.[0];
      const pre = agg(base(cmds.slice(0, j)), body);
      if (!q || !p || !pre) return res;
      const a = [0, 1, 2].find((i) => Math.abs(q[i] - pre.bbox[i]) < 1e-6 || Math.abs(q[i] - pre.bbox[i + 3]) < 1e-6);
      if (a !== undefined && Math.abs(p[a] - q[a]) < 1e-6 && last.params.radius >= t - 1e-9) {
        guardLog.set(JSON.stringify(last), { guard: 'G-RIM', t });
        return { ok: false, failed: { command: last.command, error: '@@G-RIM@@' } };
      }
      return res;
    }
    if (last.command === 'solid.draft') {
      // G-DRAFT-WALL (round 4, critic): drafting a wall of a hollowed part by an angle whose inward move over the part's height exceeds the wall pierces the wall.
      // The engine keeps the face count, so G-DRAFT does not see it, and the volume comes out ~3% low.
      const body = last.params.body; let j = -1; for (let i = cmds.length - 2; i >= 0; i--) if (cmds[i].command === 'solid.shell' && cmds[i].params.body === body) { j = i; break; }
      if (j >= 0) {
        const t = cmds[j].params.thickness; const pull = last.params.pull; const n0 = last.params.neutral?.origin;
        const a = pull ? [0, 1, 2].find((i) => Math.abs(pull[i]) > 0.5) : undefined;
        const bb = agg(base(cmds.slice(0, -1)), body)?.bbox;
        if (a !== undefined && n0 && bb) {
          const s = Math.sign(pull[a]) || 1; const lo = bb[a], hi = bb[a + 3];
          // doc semantics (r3a): a positive angle leans IN above the neutral plane and OUT below it; a negative one the reverse. Only the side that leans IN can pierce.
          // Measured r4g/r4h: this rule matches the set of cases where SolidCraft is off the half-space closed form 54 of 54 (0 false, 0 missed) over 192 cases.
          const far = last.params.angle * s >= 0 ? Math.max(0, hi - n0[a]) : Math.max(0, n0[a] - lo);
          if (far * Math.tan((Math.abs(last.params.angle) * Math.PI) / 180) >= t * (1 - 1e-9)) {
            guardLog.set(JSON.stringify(last), { guard: 'G-DRAFTWALL', t, far });
            return { ok: false, failed: { command: last.command, error: '@@G-DRAFTWALL@@' } };
          }
        }
      }
    }
    if (!GUARDED.has(last.command)) return res;
    const body = last.params.body;
    const before = agg(base(cmds.slice(0, -1)), body); const after = agg(res, body);
    if (!before || !after) return res;
    let guard = null;
    if (last.command === 'solid.draft' && after.faces !== before.faces) guard = 'G-DRAFT';
    else if (last.command === 'solid.shell' && hollowBad(last, before, after)) guard = 'G-HOLLOW';
    else if (last.command === 'solid.chamfer' && after.faces !== before.faces + 1) guard = 'G-BEVEL';
    if (!guard) return res;
    guardLog.set(JSON.stringify(last), { guard, before, after });
    return { ok: false, failed: { command: last.command, error: `@@${guard}@@` } };
  };
}

// ---------------------------------------------------------------------------------------------------------------- plain sentences
const byIdOf = (doc) => Object.fromEntries(doc.features.map((f) => [f.id, f]));
const nextOf = (f) => (f.kind === 'combine' ? f.targets?.[0] : f.target);
function chainOf(doc, f) { const by = byIdOf(doc); const out = []; for (let c = nextOf(f), s = new Set(); c && by[c] && !s.has(c); c = nextOf(by[c])) { s.add(c); out.push(by[c]); } return out; }
const labelOf = (f) => (f.kind === 'fillet' ? (f.style === 'chamfer' ? 'bevel' : 'round') : f.kind === 'shell' ? 'hollow' : f.kind);
const nounOf = (f) => (f.kind === 'fillet' ? 'edges' : 'faces');
function nameDesc(n) {
  if (!n) return '?';
  if (n.cause === 'primitive') return WORD[n.part] ?? n.part;
  if (n.cause === 'carried') return nameDesc(n.of);
  if (n.cause === 'swept') return `wall ${n.edge + 1}`;
  return n.cause;
}
const partOf = (n) => (n?.cause === 'carried' ? partOf(n.of) : n?.cause === 'primitive' ? n.part : null);
const wordInRaw = (raw) => { const m = /\.face\[([+-][xyz])\]/.exec(raw); return m ? WORD[m[1]] : null; };

/** Round 4 (critic): a bevel between two swept walls of one sketch is on an INSIDE corner when the sketch vertex is reflex XOR the extrude is a cutter
 *  (a pocket corner). SolidCraft builds some of these as a wrong solid; G-BEVEL catches them by face count, this only chooses the sentence. */
function insideCornerSwept(f, doc) {
  const e = f.edge; if (e?.cause !== 'between' || e.of?.length !== 2 || e.of.some((n) => n.cause !== 'swept') || e.of[0].from !== e.of[1].from) return false;
  const sk = byIdOf(doc)[e.of[0].from]; const pts = sk?.points; if (!pts || pts.length < 3 || sk.bulges) return false;
  const [a, b] = [e.of[0].edge, e.of[1].edge]; const n = pts.length;
  const i = (a + 1) % n === b ? b : (b + 1) % n === a ? a : -1; if (i < 0) return false;
  const p = pts[(i + n - 1) % n], q = pts[i], r = pts[(i + 1) % n];
  const area = pts.reduce((t, c, k) => t + (c[0] * pts[(k + 1) % n][1] - pts[(k + 1) % n][0] * c[1]), 0);
  const turn = (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]);
  const reflex = turn * Math.sign(area) < 0;
  const cutter = doc.features.some((c) => c.kind === 'combine' && c.op === 'subtract' && (c.targets ?? []).slice(1).includes(e.of[0].feature));
  return reflex !== cutter;
}

/** Guard sentences need the before/after measures the guard logged. */
function guardSentence(f, doc, info) {
  const { guard, before, after } = info;
  const id = f.id;
  if (guard === 'G-DRAFT') {
    const part = f.face?.part ?? partOf(f.face);
    const planarBox = before.faces === 6 && Object.keys(before.faceTypes).every((k) => k === 'plane');
    let tail = 'use a smaller angle';
    if (planarBox && part) {
      const ax = { x: 0, y: 1, z: 2 }[part.slice(1)]; const pax = { x: 0, y: 1, z: 2 }[f.pull ?? 'z'];
      const W = before.bbox[ax + 3] - before.bbox[ax]; const lo = before.bbox[pax], hi = before.bbox[pax + 3];
      // doc semantics (measured in r3a): a positive angle leans OUT below the neutral plane and IN above it; a negative one the reverse.
      // The face moves inward by (distance from the neutral plane) * tan(angle) on the inward side, and the part is valid while that stays under W.
      const far = f.angle >= 0 ? Math.max(0, hi - f.neutral) : Math.max(0, f.neutral - lo);
      const lim = (Math.atan(W / far) * 180) / Math.PI;
      tail = `the most it can tilt here is about ${(Math.floor(lim * 10) / 10).toFixed(1)} degrees`;
    }
    return `${id} is not built: tilting the ${nameDesc(f.face)} face by ${fmt(f.angle)} degrees would run it into the opposite side of the part -- ${tail}.`;
  }
  if (guard === 'G-HOLLOW') {
    const part = f.open?.part ?? partOf(f.open);
    const simple = (before.faces === 6 && Object.keys(before.faceTypes).every((k) => k === 'plane')) || (Object.keys(before.faceTypes).every((k) => k === 'plane' || k === 'cylinder') && before.faces <= 4);
    let tail = 'use a thinner wall';
    if (simple && part) {
      const ax = { x: 0, y: 1, z: 2 }[part.slice(1)];
      const ext = [0, 1, 2].map((i) => before.bbox[i + 3] - before.bbox[i]);
      const lat = Math.min(...ext.filter((_, i) => i !== ax)) / 2;
      tail = `the wall has to be under ${fmt(+Math.min(ext[ax], lat).toFixed(4))}`;
    }
    return `${id} is not built: a wall of ${fmt(f.thickness)} would collapse ${f.target} -- ${tail}.`;
  }
  if (guard === 'G-DRAFTWALL') {
    const lim = (Math.atan(info.t / info.far) * 180) / Math.PI;
    return `${id} is not built: tilting the ${nameDesc(f.face)} face by ${fmt(f.angle)} degrees would cut through the ${fmt(info.t)} mm wall of the hollow -- the most it can tilt here is about ${(Math.floor(lim * 10) / 10).toFixed(1)} degrees.`;
  }
  if (guard === 'G-RIM') return `${id} is not built: a round of ${fmt(f.size)} is as large as or larger than the ${fmt(info.t)} mm wall of the hollow, so it would cut through the wall -- use a size smaller than the wall.`;
  if (guard === 'G-RIMFIRST') return `${id} is not built: the open edge of the part was rounded with a radius of ${fmt(info.r)}, which is as large as or larger than the ${fmt(info.t)} mm wall, so the rim would have no thickness -- make the round smaller than the wall.`;
  if (guard === 'G-BEVEL') {
    if (insideCornerSwept(f, doc)) return `${id} is not built: a bevel of ${fmt(f.size)} cannot be cut cleanly on this inside corner where it reaches the end of the cut or of the part -- use round() on the edge instead, or leave the bevel out.`;
    return `${id} is not built: a bevel of ${fmt(f.size)} is too large for the faces next to this edge -- use a smaller size.`;
  }
  return null;
}

/**
 * f: the ModelDoc feature that was refused; raw: the translator's refusal text; doc: the solved doc; info: guard log entry (or null).
 * Returns ONE plain sentence. Rules are ordered; the first that matches wins.
 */
export function plainFor(f, doc, raw, info = null) {
  const id = f.id; const lab = labelOf(f); const by = byIdOf(doc);
  let m;
  if (/@@G-[A-Z]+@@/.test(raw)) { const g = /@@(G-[A-Z]+)@@/.exec(raw)[1]; const s = info && guardSentence(f, doc, { ...info, guard: g }); if (s) return s; }
  if ((m = /sketch (\w+) has no usable outline \(@@G-OUTLINE@@\)/.exec(raw))) return `${id} is not built: the outline of sketch ${m[1]} crosses or touches itself, so it is not a closed shape -- move its corners so the outline does not cross.`;
  // a dependent of a refused feature
  if ((m = /its target (\w+) was refused/.exec(raw))) return `${id} is not built because ${m[1]} could not be built, so ${id} is shown without it.`;
  // a target that an earlier operation used up
  if ((m = /its target (\w+) was already changed in place by (\w+)/.exec(raw))) {
    const op = by[m[2]]; const verbed = op?.kind === 'combine' ? VERBED[op.op] ?? 'combined' : op?.kind === 'mirror' ? 'mirrored' : op?.kind === 'pattern' ? 'repeated' : 'changed';
    return `${id} is not built: ${m[1]} was already ${verbed} by ${m[2]}, so its edges can no longer be picked -- pick the edge on the result of ${m[2]} instead.`;
  }
  // moved or turned before the pick
  if (/is rotated; this demo resolves primitive faces only|is a move, which moves or copies faces/.test(raw)) return `${id} is not built: the part was moved or turned before this ${lab}, and its ${nounOf(f)} cannot be found again yet -- put the ${lab} before the move() or turn() line.`;
  if (/a copying move is not mapped/.test(raw)) return `${id} is not built: a move that leaves a copy behind is not supported yet -- use repeat() to make copies.`;
  if (/carries a whole-shape round/.test(raw)) return `${id} is not built: ${f.target} was rounded as a whole, which changed its faces and edges, so they cannot be found again yet -- pick the ${lab === 'round' || lab === 'bevel' ? 'edge' : 'face'} before the whole-shape round.`;
  // Round 5: a cap name on an extrude that goes DOWN (negative height): the resolver looks for the cap at sketch plane + height with an upward normal
  if (/\.cap\[(top|bottom)\] matches no face on .*outward normal along the sketch normal/.test(raw)) return `${id} is not built: this shape was extruded downward (negative height), and its top and bottom caps cannot be picked by name yet -- extrude upward with a positive height instead.`;
  // the edge or face is no longer whole on the target
  if (/no longer present whole/.test(raw)) {
    const ch = chainOf(doc, f);
    const mv = ch.find((c) => c.kind === 'move' || c.kind === 'rotate'); const sh = ch.find((c) => c.kind === 'shell'); const fi = ch.find((c) => c.kind === 'fillet');
    if (mv) return `${id} is not built: the part was moved or turned before this ${lab}, and its ${nounOf(f)} cannot be found again yet -- put the ${lab} before the move() or turn() line.`;
    if (sh) return `${id} is not built: the hollow changed the edges of ${ch.at(-1)?.id ?? f.target}, so this edge cannot be found again yet -- ${lab} it before the hollow() line.`;
    if (fi && f.kind === 'fillet') return `${id} is not built: ${fi.id} already worked on the corner this edge shares with it, and edges that meet at a corner cannot be rounded or bevelled one after the other yet.`;
    return `${id} is not built: an earlier step changed this ${f.kind === 'fillet' ? 'edge' : 'face'}, so it cannot be found again yet -- do the ${lab} first.`;
  }
  // words the page cannot resolve
  if ((m = /faces of a (sphere|cone|torus|wedge) are not resolved/.exec(raw))) return `${id} is not built: the faces of a ${m[1] === 'torus' ? 'ring' : m[1]} cannot be picked by direction yet.`;
  if (/a prism has no [+-][xy] face/.test(raw)) return `${id} is not built: picking the sides of a prism by direction (left, right, front or back) is not supported yet -- only its top and bottom can be picked.`;
  if (/a cylinder has no [+-][xy] face/.test(raw)) return `${id} is not built: a cylinder has no left, right, front or back face, only a top, a bottom and one curved side.`;
  if (/drafting faces that aren't parallel to the pull|a chosen face isn't parallel to the pull/.test(raw)) return `${id} is not built: the top and bottom faces are square to the pull direction, so they cannot be tilted -- draft a side face (left, right, front or back) instead.`;
  if (/names a set of 2 faces/.test(raw) && f.kind === 'draft') return `${id} is not built: the curved side of a cylinder cannot be drafted yet -- draft a flat face instead.`;
  // Round 4 (critic): an edge pick on the result of subtract/join where the engine left the straight edge in several collinear pieces
  if ((m = /matches (\d+) separate edges on .* that do not form one closed loop/.exec(raw))) {
    const w = [...raw.matchAll(/face\[([+-][xyz])\]/g)].map((x) => WORD[x[1]]).filter(Boolean);
    const pair = w.length >= 2 ? `the ${w[0]} and ${w[1]} faces` : 'these two faces';
    return `${id} is not built: the edge between ${pair} came out of the cut in ${m[1]} pieces and joining them back into one edge is not supported yet -- ${lab === 'round' ? 'round' : 'bevel'} the edge before the cut instead.`;
  }
  if ((m = /matches (\d+) faces on/.exec(raw))) { const w = wordInRaw(raw) ?? 'face'; return `${id} is not built: two separate faces of this part are both the ${w} (same direction, same height), so '${w}' does not pick just one of them.`; }
  if (/matches no face on/.test(raw) && f.kind === 'draft') { const w = wordInRaw(raw) ?? 'side'; return `${id} is not built: no flat face of this part points exactly to the ${w}, so there is nothing to draft -- draft a face that does.`; }
  if (/matches no (edge|face) on/.test(raw) && f.kind === 'fillet') {
    const [a, b] = f.edge?.of ?? []; const pa = partOf(a), pb = partOf(b);
    if (pa && pb && OPP[pa] === pb) return `${id} is not built: the ${WORD[pa]} and ${WORD[pb]} faces never meet, so there is no edge between them -- name two faces that touch.`;
    if (a?.cause === 'swept' && b?.cause === 'swept') return `${id} is not built: ${nameDesc(a)} and ${nameDesc(b)} of the pocket do not touch, so there is no edge between them -- name two walls that meet.`;
    return `${id} is not built: the two faces named for this edge do not meet on the part as it is now, so there is no edge to ${lab}.`;
  }
  if ((m = /(\w+) has no edge (\d+)/.exec(raw))) { const sk = by[m[1]]; const cnt = sk?.points?.length; return `${id} is not built: it names edge ${+m[2] + 1} of sketch ${m[1]}, which has only ${cnt ?? 'fewer'} edges now.`; }
  if (/is a circle or a rows-and-rules sketch|has rounded or chamfered corners/.test(raw)) return f.kind === 'fillet'
    ? `${id} is not built: the walls of a circular or rounded-corner pocket cannot be picked one by one yet -- only pockets with plain straight sides can.`
    : `${id} is not built: a face swept from a curved, rounded or revolved sketch edge cannot be picked yet -- only faces from straight sketch edges can.`;
  if (/is an arc; a swept name over an arc|is a revolve, not a plain extrude/.test(raw)) return `${id} is not built: a face swept from a curved, rounded or revolved sketch edge cannot be picked yet -- only faces from straight sketch edges can.`;
  if (/a name made by a ROUNDED sketch corner/.test(raw)) return `${id} is not built: a face made by a rounded sketch corner cannot be picked yet.`;
  if (/a 'split' name/.test(raw)) return `${id} is not built: a piece of a split face cannot be picked yet.`;
  if (/a 'made' name/.test(raw)) return `${id} is not built: a face made by an earlier cut cannot be picked by name yet.`;
  if ((m = /the (midplane|taper|reversed|length2|direction|through) option is not mapped/.exec(raw))) return `${id} is not built: an extrude with the ${m[1]} option is not supported yet -- use a plain one-sided extrude.`;
  // sizes
  if ((m = /solid\.(fillet|chamfer): not supported yet: the blend is (larger than the neighbouring faces|larger than a corner radius|taller than the walls)/.exec(raw))) {
    const pocketWall = f.edge?.of?.find((n) => n?.cause === 'swept'); const ex = pocketWall && by[pocketWall.feature]; // a pocket is cut by an extrude whose height is the wall height
    const depth = ex && typeof ex.height === 'number' ? Math.abs(ex.height) : null;
    if (depth !== null && f.size >= depth) return `${id} is not built: a ${lab} of ${fmt(f.size)} is too large for the ${fmt(depth)} mm tall pocket wall it sits on -- use a smaller size.`;
    return `${id} is not built: a ${lab} of ${fmt(f.size)} is too large for the faces next to this edge -- use a smaller size.`;
  }
  if (/counterbore and countersink are not mapped/.test(raw)) return `${id} is not built: counterbore and countersink holes are not supported yet -- use a plain hole.`;
  if (/circular pattern over less than 360/.test(raw)) return `${id} is not built: a circular pattern over less than 360 degrees is not supported yet -- use the full 360 degrees.`;
  if (/a whole-body draft is not mapped/.test(raw)) return `${id} is not built: drafting a whole shape is not supported yet -- draft its side faces one at a time, for example draft(shape.face('right'), 5).`;
  if (/a closed hollow box is not mapped/.test(raw)) return `${id} is not built: a hollow with no open side is not supported yet -- add open:'top' (or bottom, front, back, left, right) to leave one side open.`;
  if (/solid\.box: invalid input: box needs a positive size/.test(raw)) return `${id} is not built: a box needs a size above zero in every direction.`;
  if (/solid\.shell: boolean Cut/.test(raw)) return `${id} is not built: the hollow could not be cut from this part because a wall meets another face at a shallow angle -- use a thinner wall or move the hole.`;
  if (/solid\.revolve: boolean Cut|solid\.combine: boolean Intersect/.test(raw)) return `${id} is not built: these two shapes touch or cross in a way that cannot be ${f.kind === 'groove' ? 'cut' : 'intersected'} yet -- change their sizes or positions.`;
  if (/solid\.shell: (invalid input: the planes don't enclose a solid|the cut could not be computed reliably|offset: a corner whose faces don't meet the same way)/.test(raw)) return `${id} is not built: the wall is too thick for this part, so no hollow is left -- use a thinner wall.`;
  return null; // unmapped: the runner reports it
}

// ---------------------------------------------------------------------------------------------------------------- translator
export async function pageTranslate(doc, extra = {}) {
  return L.translateDoc(doc, { arc: L.arc, mt: L.mt, runSC: L.runSC, topologyOf: L.topologyOf, soups: {}, ...extra });
}
/** G-STALE (round 5): pick consumers whose target a pocket()/groove() already cut. */
export function staleConsumers(doc) {
  const out = new Map(); const cutBy = new Map();
  for (const f of doc.features) {
    if ((f.kind === 'pocket' || f.kind === 'groove') && f.into) cutBy.set(f.into, f.id);
    else if (['fillet', 'shell', 'draft'].includes(f.kind) && cutBy.has(f.target)) out.set(f.id, { target: f.target, cut: cutBy.get(f.target) });
  }
  return out;
}
export async function guardedTranslate(doc, { guards = true, plain = true } = {}) {
  guardLog.clear();
  const arcG = guards ? { ...L.arc, outlineOf: (sk) => { const o = L.arc.outlineOf(sk); if (o.ok && OG.selfTouch(o, L.arc)) return { ok: false, notes: ['@@G-OUTLINE@@'] }; return o; } } : L.arc;
  const tr = await L.translateDoc(doc, { arc: arcG, mt: L.mt, runSC: guards ? guardedRunSC() : L.runSC, topologyOf: L.topologyOf, soups: {} });
  const by = byIdOf(doc);
  const unmapped = [];
  if (guards) {
    const stale = staleConsumers(doc); const dead = new Set();
    const measureOf = (id) => tr.features.find((q) => q.id === id)?.measure;
    const headOf = (id) => { let cur = id; for (let k = 0; k < 50; k++) { const g = doc.features.find((q) => ['hole', 'pocket', 'groove'].includes(q.kind) && q.id !== cur && (q.into === cur || (q.kind === 'hole' && q.target === cur))); if (!g) break; cur = g.id; } return cur; };
    const holeExt = {}; for (const q of doc.features) if (q.kind === 'hole') { const m = measureOf(q.target); if (m?.bbox) holeExt[q.id] = [0, 1, 2].map((i) => m.bbox[i + 3] - m.bbox[i]); }
    const isPlainBox = (m) => m && m.faces === 6 && (m.faceTypes?.plane ?? 0) === 6 && Math.abs(m.volume - (m.bbox[3] - m.bbox[0]) * (m.bbox[4] - m.bbox[1]) * (m.bbox[5] - m.bbox[2])) <= 1e-9 * Math.max(1, m.volume);
    const concave = (f) => {
      if (f.kind !== 'shell' || !f.open) return null;
      const head = headOf(f.target);
      const cv = SD.convexity(head, by, L.arc, holeExt);
      if (cv.convex) return null;
      if (/^a (mirror|join)$/.test(cv.why) && isPlainBox(measureOf(head))) return null;
      if (/^it is already hollow/.test(cv.why)) return SD.SENTENCE.shellTwice(f);
      if (/^a blind hole/.test(cv.why)) return SD.SENTENCE.blindHole(f);
      return SD.SENTENCE.concave(f, cv.why);
    };
    for (const x of tr.features) {
      const f = by[x.id]; const st = stale.get(x.id);
      const cc = x.status === 'built' && !st && f ? concave(f) : null;
      if (cc) { x.rawRefusal = '(built by the page without a sentence)'; x.status = 'refused'; dead.add(x.id); x.refusal = cc; x.guard = 'G-CONVEX'; continue; }
      const deps = f ? (f.kind === 'combine' ? f.targets ?? [] : [f.target]) : [];
      if (x.status === 'built' && st) {
        x.rawRefusal = '(built by the page without a sentence)'; x.status = 'refused'; dead.add(x.id);
        x.refusal = `${x.id} is not built: ${st.target} was already cut by ${st.cut}, so this ${labelOf(f)} would not include the cut -- keep the result of the cut under a name (for example part = pocket(...)) and pick on that instead.`;
        x.guard = 'G-STALE';
      } else if (x.status === 'built' && deps.some((d) => dead.has(d))) {
        const d = deps.find((q) => dead.has(q)); dead.add(x.id); x.status = 'refused'; x.rawRefusal = '(built by the page without a sentence)';
        x.refusal = `${x.id} is not built because ${d} could not be built, so ${x.id} is shown without it.`; x.guard = 'G-STALE';
      }
    }
  }
  if (plain) for (const x of tr.features) {
    if (x.status !== 'refused' || x.guard) continue; // a document-level guard (G-STALE, G-CONVEX) already carries its own sentence
    x.rawRefusal = x.refusal;
    const info = guardLog.get(JSON.stringify(x.commands?.[0] ?? {})) ?? guardLog.get(JSON.stringify(x.commands?.at(-1) ?? {}));
    const s = plainFor(by[x.id] ?? x, doc, x.refusal, info);
    if (s) x.refusal = s; else unmapped.push({ id: x.id, raw: x.refusal });
  }
  tr.unmapped = unmapped;
  return tr;
}
