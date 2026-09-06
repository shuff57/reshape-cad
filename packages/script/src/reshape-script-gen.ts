// ModelDoc -> reSHape Script source. The other half of lib/reshape-script.ts's
// contract: runScript(toScript(doc)).doc must equal doc up to ids and
// defaults (see that file's own header, and scripts/test-reshape-script.mjs,
// which pins this against every fixture in .gauntlet/oracle.json -- a frozen
// fixture now that the JSCAD-era scripts/oracle-measure.mjs that recorded it
// is deleted, CLAUDE.md's "JSCAD is retired" section).
//
// ONE LINE PER FEATURE, in doc order -- lib/model-codegen.ts's now-deleted
// toReshape() followed the same rule, for the same reason: a script is the
// Build timeline written down, so its shape on the page should mirror the
// timeline's own shape.
//
// THE HARD PART IS NOT THE ARITHMETIC, IT IS THE VARIABLE. A Build-mode doc
// names its OWN targets by feature id (`hole1.target === 'box1'`), but a
// script variable that has been drilled, hollowed, rounded or repeated keeps
// its ORIGINAL name and simply points at a different row afterwards -- see
// lib/reshape-script.ts's SolidHandle comment for why. So before any code is
// emitted, chainVar() below walks the doc once and decides, for every
// feature id, which script VARIABLE currently represents it: a fresh
// primitive, sketch, boolean, mirror or move-with-copy gets a new one; a
// hole, hollow, one-edge round or bevel, draft, repeat or plain move
// (consuming, per lib/model-types.ts's topLevel()) inherits its target's.
//
// NAMED PARAMS ARE THE SECOND HARD PART, added 2026-09-04 after the advanced
// student lens measured it missing: Build -> Code used to always emit a
// literal (`hollow(box1, { wall: 2 })`), even when the script that BUILT
// this doc had named that 2 with `param('wall', 2, { min: 0.5, max: 10 })`.
// The caption and bounds were silently lost the moment a doc round-tripped
// through Build, because nothing carried the binding between "this doc slot"
// and "this script variable" back out of runScript(). lib/reshape-script.ts's
// RunResult.namedParams now does (see its own doc comment); the optional
// second argument here is that array, and paramBindings() below turns it
// into the one thing this file actually needs -- a slot key -> variable name
// map -- which numText()/optText() consult everywhere a literal would
// otherwise be printed. Passing nothing (the Build-mode doc, which was never
// built by a script and carries no param() calls at all) reproduces exactly
// today's literal-only output.

import {
  type ModelDoc,
  type SketchFeature,
  type SketchConstraint,
  newShape,
  newSketch,
  RECTANGLE_CONSTRAINTS,
  extentAlong,
} from './model-types.js';
import { generatedParams, pname } from './model-codegen.js';
import type { TopoName } from './topo-name.js';

/** Just enough of lib/reshape-script.ts's NamedParamDef for this file to read
 *  -- a type-only import of the real one would work too, but this file has
 *  no other reason to depend on the interpreter, and duplicating a three-line
 *  shape here keeps it that way. Keep in sync with NamedParamDef by hand;
 *  scripts/test-reshape-script.mjs's round-trip checks catch a drift that
 *  breaks anything real. */
export interface ScriptParamRef {
  name: string;
  caption: string;
  value: number;
  min: number;
  max: number;
  step: number;
  slots: string[];
}

function lit(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 1e6) / 1e6;
  return String(r);
}

function litVec(v: readonly number[]): string {
  return `[${v.map(lit).join(', ')}]`;
}

function near(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) <= tol;
}

/** Exactly the rectangle rules a Rectangle-tool (or plain Sketch-tool)
 *  sketch is born with -- lib/model-types.ts's own RECTANGLE_CONSTRAINTS,
 *  structurally, not by reference (a doc that survived a save/load cycle
 *  carries its own object instances). */
function hasRectangleConstraints(constraints?: SketchFeature['constraints']): boolean {
  if (!constraints || constraints.length !== RECTANGLE_CONSTRAINTS.length) return false;
  return RECTANGLE_CONSTRAINTS.every((want, i) => {
    const got = constraints[i];
    return got?.kind === want.kind && 'edge' in got && got.edge === (want as { edge: number }).edge;
  });
}

/**
 * Width, height and centre of a 4-point outline in EXACTLY the corner order
 * newRectangleSketch()/.rect() produce -- [[loU,loV],[hiU,loV],[hiU,hiV],
 * [loU,hiV]] -- or null if the points are not that shape. Order-sensitive on
 * purpose: a rectangle drawn or rotated by hand into some other winding is
 * not what .rect() can express, and .polygon() is the honest fallback for it.
 */
function rectDims(points: Array<[number, number]>): [number, number, number, number] | null {
  if (points.length !== 4) return null;
  const [p0, p1, p2, p3] = points;
  if (!near(p0[1], p1[1]) || !near(p1[0], p2[0]) || !near(p2[1], p3[1]) || !near(p3[0], p0[0])) return null;
  const w = Math.abs(p1[0] - p0[0]);
  const h = Math.abs(p2[1] - p1[1]);
  if (!(w > 1e-9) || !(h > 1e-9)) return null;
  return [w, h, (p0[0] + p1[0]) / 2, (p0[1] + p2[1]) / 2];
}

const FACE_WORD: Record<string, string> = {
  '+z': 'top', '-z': 'bottom', '-y': 'front', '+y': 'back', '-x': 'left', '+x': 'right', side: 'side',
};
function faceWord(part: string): string {
  return FACE_WORD[part] ?? part;
}

const MIRROR_WORD: Record<string, string> = { yz: 'left-right', xz: 'front-back', xy: 'top-bottom' };
const PLANE_WORD: Record<string, string> = { xy: 'top', xz: 'front', yz: 'side' };

/** One rule as a script call on sketch variable `v` -- the Rules panel's own
 *  words (SketchConstraints.tsx's Across/Up columns, its equal/parallel/
 *  perpendicular pair grid, its Pin a corner row), 1-based, matching
 *  lib/reshape-script.ts's SketchHandle methods exactly (see that file's own
 *  comment on why "across"/"up" rather than a synonym like "level"). */
function constraintCallLine(v: string, c: SketchConstraint): string {
  if (c.kind === 'horizontal') return `${v}.across(${c.edge + 1})`;
  if (c.kind === 'vertical') return `${v}.up(${c.edge + 1})`;
  if (c.kind === 'length') return `${v}.length(${c.edge + 1}, ${lit(c.value)})`;
  if (c.kind === 'lock') return `${v}.pin(${c.corner + 1})`;
  return `${v}.${c.kind}(${c.edge + 1}, ${c.other + 1})`; // equal / parallel / perpendicular
}

/** For every feature id, the script variable that currently represents it --
 *  see the file header. Consuming kinds (hole, shell, fillet, draft,
 *  pattern, a copy-less move) inherit their target's variable; everything
 *  else -- including extrude/revolve, whose target is a SKETCH, a different
 *  handle type that is never chain-mutated -- gets its own. */
function chainVars(doc: ModelDoc): Map<string, string> {
  const varOf = new Map<string, string>();
  for (const f of doc.features) {
    const inherits =
      f.kind === 'hole' || f.kind === 'shell' || f.kind === 'fillet' || f.kind === 'draft' ||
      f.kind === 'pattern' || (f.kind === 'move' && !f.copy);
    if (inherits && 'target' in f) {
      varOf.set(f.id, varOf.get(f.target) ?? f.target);
    } else {
      varOf.set(f.id, f.id);
    }
  }
  return varOf;
}

/** Would newShape() have centred a fresh primitive of this kind here on its
 *  own, given only the features already emitted? Mirrors the auto-placement
 *  lib/model-types.ts's newShape() already does, so the generated script
 *  only writes `{ at: [...] }` when the student's own doc actually needed a
 *  non-default position -- see box()'s call site below. */
function defaultCenter(doc: ModelDoc, upTo: number, kind: 'box' | 'cylinder' | 'cone' | 'torus' | 'sphere') {
  // newShape() always returns one of the five primitive kinds for these
  // `kind` values -- every one of which carries `center` -- but its own
  // return type is the full Feature union (it also builds sketches, whose
  // signature differs), so the cast states what is already true at runtime.
  return (newShape({ version: 1, features: doc.features.slice(0, upTo) }, kind) as { center: readonly number[] }).center;
}

function emitAt(bindings: Map<string, string>, featureId: string, center: readonly number[], def: readonly number[]): string {
  const bound = ['x', 'y', 'z'].some((s) => bindings.has(pname(featureId, s)));
  if (!bound && center.every((v, i) => near(v, def[i]))) return '';
  const parts = ['x', 'y', 'z'].map((s, i) => numText(bindings, featureId, s, lit(center[i])));
  return `, { at: [${parts.join(', ')}] }`;
}

/** Draft's `from` word, reversed out of pull + neutral -- try both words that
 *  point along `pull` and keep whichever one's own bounding-box extreme this
 *  target actually sits at. Returns null when neither matches (a hand-set
 *  neutral, or a target this file cannot read a bbox from at all), in which
 *  case the caller falls back to the numeric { neutral } escape hatch. */
function draftFromWord(doc: ModelDoc, rootId: string, pull: 'x' | 'y' | 'z', neutral: number): string | null {
  const AXIS_WORDS: Record<string, [string, string]> = {
    x: ['left', 'right'], y: ['front', 'back'], z: ['bottom', 'top'],
  };
  const [loWord, hiWord] = AXIS_WORDS[pull];
  const f = doc.features.find((x) => x.id === rootId);
  if (!f || !('center' in f)) return null;
  const half = extentAlong(doc, rootId, pull);
  if (half == null) return null;
  const c = (f as { center: readonly number[] }).center[pull === 'x' ? 0 : pull === 'y' ? 1 : 2];
  if (near(neutral, c - half / 2)) return loWord;
  if (near(neutral, c + half / 2)) return hiWord;
  return null;
}

// ---------------------------------------------------------------------------
// Named-param substitution -- see the file header.
// ---------------------------------------------------------------------------

/** slot key (pname(featureId, slot)) -> the script variable name a param()
 *  call declared for it. Built once per toScript() call from
 *  RunResult.namedParams; empty when the doc was never built by a script
 *  (the ordinary Build-mode case), so every lookup below misses and this
 *  file's output is unchanged from before named params existed. */
function paramBindings(namedParams: readonly ScriptParamRef[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!namedParams) return map;
  for (const p of namedParams) {
    for (const slot of p.slots) map.set(slot, p.name);
  }
  return map;
}

/** A single numeric value: the bound param's own variable name if this doc
 *  slot has one, else the literal text the caller already computed. Correct
 *  regardless of what arithmetic produced `literalText` (a diameter halved
 *  into a radius, a spacing halved into a corner offset, ...) because the
 *  correlation was recorded on the RAW pre-transform value in
 *  lib/reshape-script.ts's num(), and re-emitting the same variable name
 *  where that raw value used to go reproduces the identical doc field when
 *  the transform reapplies on the next run. */
function numText(bindings: Map<string, string>, featureId: string, slot: string, literalText: string): string {
  return bindings.get(pname(featureId, slot)) ?? literalText;
}

/** One `key: value` entry in an options object, or the bare-shorthand `key`
 *  when the bound param's own name happens to match the option key (the
 *  common, encouraged case: `param('wall', 2, ...)` feeding `{ wall }`). */
function optText(bindings: Map<string, string>, featureId: string, slot: string, key: string, literalText: string): string {
  const paramName = bindings.get(pname(featureId, slot));
  if (!paramName) return `${key}: ${literalText}`;
  return paramName === key ? key : `${key}: ${paramName}`;
}

export function toScript(doc: ModelDoc, namedParams?: readonly ScriptParamRef[]): string {
  const varOf = chainVars(doc);
  const byId = new Map(doc.features.map((f) => [f.id, f]));
  const v = (id: string) => varOf.get(id) ?? id;
  const bindings = paramBindings(namedParams);
  // The authoritative "which slots exist in THIS doc, right now, and what
  // are they currently set to" -- generatedParams() (the same function the
  // Dimensions panel itself reads) is the one thing that actually knows.
  // Used two ways below: deciding whether a param() declaration is still
  // live at all (at least one of its recorded slots has to still exist),
  // and -- the fix for a real bug this file's own drag-then-round-trip test
  // caught -- reading the VALUE to declare it with. A Build-mode slider
  // drag calls applyParam() straight on the doc; it has no idea a slot was
  // ever named, so it never touches namedParams[i].value, which is why that
  // field can be stale the moment a drag has happened since the script last
  // ran. The doc itself is never stale -- it is what the drag just wrote.
  const liveValues = new Map(generatedParams(doc).map((p) => [p.name, p.value]));
  const lines: string[] = [];

  // Every param() declaration first, in the order the script originally
  // registered them (RunResult.namedParams preserves that order -- see
  // runScript()'s own `namedParams` Map) -- a variable has to exist before
  // any feature line below can reference it. A param whose every bound slot
  // has since gone missing from THIS doc (the feature it fed was deleted, or
  // this is a stale namedParams array from a different doc entirely) is
  // skipped rather than emitted dead: declaring `wall` and never using it is
  // not what round-tripping a doc should produce.
  if (namedParams) {
    for (const p of namedParams) {
      // Skip a param() whose every bound slot has gone missing from THIS
      // doc (its feature was deleted, or namedParams came from a different
      // doc entirely) -- declaring a variable nothing below will reference
      // is worse than falling back to the literal it used to be.
      if (p.slots.length === 0) continue;
      const liveSlot = p.slots.find((s) => liveValues.has(s));
      if (liveSlot === undefined) continue;
      // The doc's OWN current value at that slot, not p.value -- see
      // liveValues's own comment for why those two can disagree.
      const currentValue = liveValues.get(liveSlot)!;
      const opts: string[] = [];
      if (!near(p.min, 0)) opts.push(`min: ${lit(p.min)}`);
      if (!near(p.max, Math.max(100, Math.ceil(Math.abs(p.value) * 4) || 100))) opts.push(`max: ${lit(p.max)}`);
      if (p.step !== 1) opts.push(`step: ${lit(p.step)}`);
      if (p.caption !== p.name) opts.push(`caption: '${p.caption.replace(/'/g, "\\'")}'`);
      const optsText = opts.length ? `, { ${opts.join(', ')} }` : '';
      lines.push(`const ${p.name} = param('${p.name}', ${lit(currentValue)}${optsText})`);
    }
  }

  doc.features.forEach((f, i) => {
    if (f.kind === 'box') {
      const def = defaultCenter(doc, i, 'box');
      const at = emitAt(bindings, f.id, f.center, def);
      const w = numText(bindings, f.id, 'width', lit(f.size[0]));
      const d = numText(bindings, f.id, 'depth', lit(f.size[1]));
      const h = numText(bindings, f.id, 'height', lit(f.size[2]));
      lines.push(`const ${f.id} = box(${w}, ${d}, ${h}${at})`);
      if (f.round) lines.push(`round(${f.id}, ${numText(bindings, f.id, 'round', lit(f.round))})`);
      if (f.rotate && f.rotate.some((n) => n !== 0)) {
        const rx = numText(bindings, f.id, 'rx', lit(f.rotate[0]));
        const ry = numText(bindings, f.id, 'ry', lit(f.rotate[1]));
        const rz = numText(bindings, f.id, 'rz', lit(f.rotate[2]));
        lines.push(`turn(${f.id}, [${rx}, ${ry}, ${rz}])`);
      }
      return;
    }
    if (f.kind === 'cylinder') {
      const def = defaultCenter(doc, i, 'cylinder');
      const at = emitAt(bindings, f.id, f.center, def);
      const across = numText(bindings, f.id, 'radius', lit(f.radius * 2));
      const tall = numText(bindings, f.id, 'height', lit(f.height));
      lines.push(`const ${f.id} = cylinder(${across}, ${tall}${at})`);
      if (f.round) lines.push(`round(${f.id}, ${numText(bindings, f.id, 'round', lit(f.round))})`);
      if (f.rotate && f.rotate.some((n) => n !== 0)) {
        const rx = numText(bindings, f.id, 'rx', lit(f.rotate[0]));
        const ry = numText(bindings, f.id, 'ry', lit(f.rotate[1]));
        const rz = numText(bindings, f.id, 'rz', lit(f.rotate[2]));
        lines.push(`turn(${f.id}, [${rx}, ${ry}, ${rz}])`);
      }
      return;
    }
    if (f.kind === 'sphere') {
      const def = defaultCenter(doc, i, 'sphere');
      const at = emitAt(bindings, f.id, f.center, def);
      const across = numText(bindings, f.id, 'radius', lit(f.radius * 2));
      lines.push(`const ${f.id} = sphere(${across}${at})`);
      return;
    }
    if (f.kind === 'cone') {
      const def = defaultCenter(doc, i, 'cone');
      const at = emitAt(bindings, f.id, f.center, def);
      const across = numText(bindings, f.id, 'radius', lit(f.radius * 2));
      const tall = numText(bindings, f.id, 'height', lit(f.height));
      lines.push(`const ${f.id} = cone(${across}, ${tall}${at})`);
      if (f.rotate && f.rotate.some((n) => n !== 0)) {
        const rx = numText(bindings, f.id, 'rx', lit(f.rotate[0]));
        const ry = numText(bindings, f.id, 'ry', lit(f.rotate[1]));
        const rz = numText(bindings, f.id, 'rz', lit(f.rotate[2]));
        lines.push(`turn(${f.id}, [${rx}, ${ry}, ${rz}])`);
      }
      return;
    }
    if (f.kind === 'torus') {
      // ring()'s two arguments are never correlated to a param() -- see
      // lib/reshape-script.ts's own ring() comment (neither ringRadius nor
      // tubeRadius is stored verbatim) -- so this branch has no substitution
      // to make even when namedParams is non-empty.
      const across = 2 * (f.ringRadius + f.tubeRadius);
      const tubeAcross = 2 * f.tubeRadius;
      const def = defaultCenter(doc, i, 'torus');
      const at = emitAt(bindings, f.id, f.center, def);
      lines.push(`const ${f.id} = ring(${lit(across)}, ${lit(tubeAcross)}${at})`);
      return;
    }
    if (f.kind === 'sketch') {
      const plane = PLANE_WORD[f.plane] ?? 'top';
      const offsetArg = f.offset !== 0 ? `, ${lit(f.offset)}` : '';
      lines.push(`const ${f.id} = sketch('${plane}'${offsetArg})`);
      const fresh = newSketch({ version: 1, features: [] }, f.plane);
      // A sketch whose points ARE an axis-aligned rectangle and whose rules
      // ARE exactly the rectangle set (lib/model-types.ts's own
      // RECTANGLE_CONSTRAINTS, both newSketch()/newRectangleSketch() and
      // sketch()/.rect() write this same set) is what the Sketch and
      // Rectangle tools build -- and what .rect() can reproduce exactly.
      // Anything else -- a plain polygon, a shape a corner drag pulled off
      // axis, or rules a student set by hand through the panel -- is outside
      // .rect()'s language and falls through to .polygon() below.
      const rectRules = hasRectangleConstraints(f.constraints);
      const isPristineDefault =
        !f.shape && !f.rounds && !f.chamfers && !f.bulges && rectRules &&
        f.points.length === fresh.points.length &&
        f.points.every((p, k) => near(p[0], fresh.points[k][0]) && near(p[1], fresh.points[k][1]));
      if (isPristineDefault) {
        // Untouched Sketch-tool starter -- nothing more to say.
      } else if (f.shape === 'circle' && f.points.length === 2) {
        const [a, b] = f.points;
        const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
        const across = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const at = near(cx, 0) && near(cy, 0) ? '' : `, { at: [${lit(cx)}, ${lit(cy)}] }`;
        lines.push(`${f.id}.circle(${numText(bindings, f.id, 'across', lit(across))}${at})`);
      } else {
        const rect = !f.shape ? rectDims(f.points) : null;
        if (rect && rectRules) {
          const [w, h, cx, cy] = rect;
          const at = near(cx, 0) && near(cy, 0) ? '' : `, { at: [${lit(cx)}, ${lit(cy)}] }`;
          lines.push(
            `${f.id}.rect(${numText(bindings, f.id, 'width', lit(w))}, ${numText(bindings, f.id, 'height', lit(h))}${at})`,
          );
        } else {
          lines.push(`${f.id}.polygon([${f.points.map((p) => litVec(p)).join(', ')}])`);
          // A rule set by hand through the Rules panel -- equal, parallel,
          // a Length, or the rectangle set itself sitting on a shape .rect()
          // cannot describe (not axis-aligned, a corner dragged off, and so
          // on) -- now has a .polygon() equivalent: one call per rule, in the
          // Rules panel's own words (SPEC-d2-rules-in-script.md). This used
          // to emit a `// N rules set in Build are not written here` comment
          // instead and drop them on the Code -> Run round trip; every rule
          // in `f.constraints` is written here now, so nothing is lost.
          for (const c of f.constraints ?? []) {
            lines.push(constraintCallLine(f.id, c));
          }
        }
        for (const [k, r] of Object.entries(f.rounds ?? {})) {
          if (r > 0) lines.push(`${f.id}.round(${k}, ${lit(r)})`);
        }
        for (const [k, d] of Object.entries(f.chamfers ?? {})) {
          if (d > 0) lines.push(`${f.id}.chamfer(${k}, ${lit(d)})`);
        }
      }
      return;
    }
    if (f.kind === 'extrude') {
      lines.push(`const ${f.id} = pull(${v(f.target)}, ${numText(bindings, f.id, 'height', lit(f.height))})`);
      return;
    }
    if (f.kind === 'revolve') {
      lines.push(`const ${f.id} = spin(${v(f.target)}, ${numText(bindings, f.id, 'angle', lit(f.angle))})`);
      return;
    }
    if (f.kind === 'blend') {
      const [loId, hiId] = f.targets;
      const lo = byId.get(loId) as SketchFeature | undefined;
      const hi = byId.get(hiId) as SketchFeature | undefined;
      const gap = (hi?.offset ?? 0) - (lo?.offset ?? 0);
      lines.push(`const ${f.id} = blend(${v(loId)}, ${v(hiId)}, ${numText(bindings, hiId, 'offset', lit(gap))})`);
      return;
    }
    if (f.kind === 'combine') {
      const fn = f.op === 'union' ? 'join' : f.op === 'subtract' ? 'cut' : 'keep';
      lines.push(`const ${f.id} = ${fn}(${f.targets.map(v).join(', ')})`);
      return;
    }
    if (f.kind === 'mirror') {
      const word = MIRROR_WORD[f.plane] ?? 'left-right';
      lines.push(`const ${f.id} = mirror(${v(f.target)}, '${word}')`);
      return;
    }
    if (f.kind === 'move') {
      const x = numText(bindings, f.id, 'x', lit(f.offset[0]));
      const y = numText(bindings, f.id, 'y', lit(f.offset[1]));
      const z = numText(bindings, f.id, 'z', lit(f.offset[2]));
      const args = `${v(f.target)}, [${x}, ${y}, ${z}]`;
      if (f.copy) {
        lines.push(`const ${f.id} = move(${args}, { copy: true })`);
      } else {
        lines.push(`move(${args})`);
      }
      return;
    }
    if (f.kind === 'pattern') {
      const countText = numText(bindings, f.id, 'count', lit(f.count));
      if (f.mode === 'linear') {
        const step = f.step ?? [0, 0, 0];
        // Only the bare-number shorthand (`step: N`, meaning [N, 0, 0]) is
        // ever correlated to a param() -- lib/reshape-script.ts's repeat()
        // only calls num() on that path, never on the full-vector form -- so
        // that is the only case substitution applies to here.
        const stepArg =
          step[1] === 0 && step[2] === 0
            ? numText(bindings, f.id, 'stepx', lit(step[0]))
            : litVec(step);
        lines.push(`repeat(${v(f.target)}, { count: ${countText}, step: ${stepArg} })`);
      } else {
        const angle =
          f.totalAngle !== undefined && f.totalAngle !== 360
            ? `, angle: ${numText(bindings, f.id, 'totalangle', lit(f.totalAngle))}`
            : '';
        lines.push(`repeatAround(${v(f.target)}, { count: ${countText}, axis: '${f.axis ?? 'z'}'${angle} })`);
      }
      return;
    }
    if (f.kind === 'hole') {
      // HoleFeature.center is keyed to the HOLE's own id (f.id), not the
      // target's -- matching generatedParams()'s hole branch, and the fix in
      // lib/reshape-script.ts's holeAxisAndCenter() this substitution work
      // caught (it used to correlate against the target instead).
      const opts: string[] = [optText(bindings, f.id, 'diameter', 'across', lit(f.diameter))];
      const extent = extentAlong(doc, f.target, f.axis);
      const throughDepth = extent != null ? extent + 2 : null;
      if (throughDepth == null || !near(f.depth, throughDepth)) {
        opts.push(optText(bindings, f.id, 'depth', 'deep', lit(f.depth)));
      }
      if (f.axis !== 'z') opts.push(`along: '${f.axis}'`);
      const [ca, cb, slotA, slotB] =
        f.axis === 'z' ? [f.center[0], f.center[1], 'x', 'y']
          : f.axis === 'y' ? [f.center[0], f.center[2], 'x', 'z']
          : [f.center[1], f.center[2], 'y', 'z'];
      const atBound = bindings.has(pname(f.id, slotA)) || bindings.has(pname(f.id, slotB));
      if (atBound || !near(ca, 0) || !near(cb, 0)) {
        const at = numText(bindings, f.id, slotA, lit(ca));
        const bt = numText(bindings, f.id, slotB, lit(cb));
        opts.push(`at: [${at}, ${bt}]`);
      }
      if (f.corners) {
        const apartX = numText(bindings, f.id, 'dx', lit(f.corners.dx * 2));
        const apartY = numText(bindings, f.id, 'dy', lit(f.corners.dy * 2));
        opts.push(`apart: [${apartX}, ${apartY}]`);
        lines.push(`holes(${v(f.target)}, { ${opts.join(', ')} })`);
      } else {
        lines.push(`hole(${v(f.target)}, { ${opts.join(', ')} })`);
      }
      return;
    }
    if (f.kind === 'shell') {
      const opts: string[] = [optText(bindings, f.id, 'thickness', 'wall', lit(f.thickness))];
      if (f.open && f.open.cause === 'primitive') opts.push(`open: '${faceWord(f.open.part)}'`);
      lines.push(`hollow(${v(f.target)}, { ${opts.join(', ')} })`);
      return;
    }
    if (f.kind === 'fillet') {
      const edge = f.edge as Extract<TopoName, { cause: 'between' }>;
      const [a, b] = edge.of;
      const wordOf = (n: TopoName) => (n.cause === 'primitive' ? faceWord(n.part) : 'top');
      const ref = `${v(f.target)}.edge('${wordOf(a)}', '${wordOf(b)}')`;
      const fn = f.style === 'chamfer' ? 'bevel' : 'round';
      lines.push(`const ${f.id} = ${fn}(${ref}, ${numText(bindings, f.id, 'size', lit(f.size))})`);
      return;
    }
    if (f.kind === 'draft') {
      const opts: string[] = [];
      if (f.whole) opts.push('whole: true');
      const from = draftFromWord(doc, f.target, f.pull, f.neutral);
      if (from) opts.push(`from: '${from}'`);
      else opts.push(`neutral: ${lit(f.neutral)}`);
      const ref =
        !f.whole && f.face && f.face.cause === 'primitive'
          ? `${v(f.target)}.face('${faceWord(f.face.part)}')`
          : v(f.target);
      lines.push(`const ${f.id} = draft(${ref}, ${numText(bindings, f.id, 'angle', lit(f.angle))}, { ${opts.join(', ')} })`);
      return;
    }
  });

  return lines.join('\n') + (lines.length ? '\n' : '');
}
