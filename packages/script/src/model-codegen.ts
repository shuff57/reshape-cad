// The doc-level half of a ModelDoc's parameter system -- the half that
// survives independent of any engine. generatedParams()/paramValues() list
// every number a feature exposes (a slider or a drag handle target);
// applyParam() writes one back into the doc; solveDoc()/solveSketchDrag()
// re-run the sketch constraint solver after a param write moves a sketch
// corner. Every one of these is engine-agnostic -- they read and write
// ModelDoc fields, never emit source for any runtime.
//
// This file used to ALSO emit JSCAD-flavoured reSHape source text
// (toReshape(), removed here) for the JSCAD runner. That runner is gone
// (CLAUDE.md's "JSCAD is retired" section) -- the one surviving source
// emitter is lib/reshape-script-gen.ts's toScript(), which targets reSHape
// Script instead and is not engine source at all: the kernel builds a
// ModelDoc directly, through lib/occt-build.ts, with no text in between.

import { solveSketch, collapsedByRatio, type Point } from '@shuff57/reshape-sketch/sketch-solve';
import { maxFilletRadius, outlineOf } from '@shuff57/reshape-sketch/sketch-arc';
import {
  type Feature,
  type ModelDoc,
  type Vec3,
  canRotate,
  extentAlong,
  isRoundable,
  isShape,
  maxRound,
  nameMap,
} from './model-types.js';
import { rootFeature } from './topo-name.js';

export interface GeneratedParam {
  name: string;
  caption: string;
  value: number;
  min: number;
  max: number;
  step: number;
}

const AXIS = ['width', 'depth', 'height'] as const;

/** Param names must survive an edit, or pushing values into a live frame
 *  would land on the wrong slot. Keyed by feature id, never by position.
 *  Exported so lib/reshape-script.ts can correlate a script's own `param()`
 *  name with the exact doc slot it lands in, using the identical key format
 *  generatedParams() below already uses -- two different producers of the
 *  same panel row must agree on its key, or a slider drawn from one and a
 *  value pushed by the other silently miss each other. */
export function pname(id: string, slot: string): string {
  return `${id}_${slot}`;
}

function sizeBounds(value: number): { min: number; max: number; step: number } {
  return { min: 1, max: Math.max(100, Math.ceil(value * 4)), step: 1 };
}

/** Every numeric slot in the doc, in panel order. */
export function generatedParams(doc: ModelDoc): GeneratedParam[] {
  const out: GeneratedParam[] = [];
  const names = nameMap(doc);
  doc.features.forEach((f) => {
    const label = names[f.id];
    const push = (slot: string, caption: string, value: number, b = sizeBounds(value)) =>
      out.push({ name: pname(f.id, slot), caption: `${label} ${caption}`, value, ...b });

    if (f.kind === 'box') {
      AXIS.forEach((a, ax) => push(a, a, f.size[ax]));
      pushCentre(out, f.id, label, f.center);
      if (f.round !== undefined) push('round', 'corner', f.round, { min: 0, max: 40, step: 0.5 });
      pushTurn(out, f.id, label, f.rotate);
    } else if (f.kind === 'cylinder') {
      // "across" (diameter), not "radius" -- the course word from
      // reference.md's Shapes section (cylinder(30, 80) is 30mm ACROSS),
      // matching Ring/Circle's own convention. The slot name stays
      // 'radius' (applyParam converts back on the way in); only the
      // caption and the displayed number change.
      push('radius', 'across', f.radius * 2);
      push('height', 'height', f.height);
      pushCentre(out, f.id, label, f.center);
      if (f.round !== undefined) push('round', 'corner', f.round, { min: 0, max: 40, step: 0.5 });
      pushTurn(out, f.id, label, f.rotate);
    } else if (f.kind === 'cone') {
      push('radius', 'across', f.radius * 2);
      push('height', 'height', f.height);
      pushCentre(out, f.id, label, f.center);
      pushTurn(out, f.id, label, f.rotate);
    } else if (f.kind === 'torus') {
      // Same formula reshape-script.ts's ring() already uses for the
      // OTHER direction (script text -> ringRadius/tubeRadius): the ring's
      // "across" is the OUTSIDE diameter of the whole donut, not twice the
      // centreline radius, and the tube's "across" is its own diameter.
      // Keeping this in step with that formula means Build and Code agree
      // on what "across" means for a Ring, not just Cylinder/Sphere/Cone.
      push('ring', 'across', 2 * (f.ringRadius + f.tubeRadius));
      push('tube', 'tube across', 2 * f.tubeRadius);
      pushCentre(out, f.id, label, f.center);
    } else if (f.kind === 'sphere') {
      push('radius', 'across', f.radius * 2);
      pushCentre(out, f.id, label, f.center);
    } else if (f.kind === 'prism') {
      push('radius', 'across', f.radius * 2);
      push('height', 'height', f.height);
      pushCentre(out, f.id, label, f.center);
      pushTurn(out, f.id, label, f.rotate);
    } else if (f.kind === 'wedge') {
      push('width', 'width', f.width);
      push('depth', 'depth', f.depth);
      push('height', 'height', f.height);
      pushCentre(out, f.id, label, f.center);
      pushTurn(out, f.id, label, f.rotate);
    } else if (f.kind === 'groove') {
      push('angle', 'angle', f.angle);
    } else if (f.kind === 'pocket') {
      push('depth', 'deep', f.depth);
    } else if (f.kind === 'sketch') {
      // A soup sketch (SPEC-sketcher2 §6) carries rows, not corners: its
      // panel slots are the rules' values, named rule${i}-value (D8), and
      // its coordinates are the basin selector -- they get NO slots, or a
      // 30-primitive sketch floods the panel with ~200 rows nobody can use.
      if (f.geoms) {
        (f.rules ?? []).forEach((raw, i) => {
          const r = raw as { k?: string; value?: number | string };
          if (r.value === undefined) return;
          // A param()-bound rule stores its NAME in the doc (§6.2); the slot
          // row's numeric default is then unknown here -- the named param's
          // own default is what runScript's assembly substitutes (it prefers
          // named.value for a non-finite generated value).
          const numeric = typeof r.value === 'number' ? r.value : NaN;
          out.push({
            name: pname(f.id, `rule${i}-value`),
            caption: `${label} ${r.k ?? 'rule'}`,
            value: numeric,
            min: 0,
            max: Math.max(Number.isFinite(numeric) ? Math.abs(numeric) * 4 : 100, 100),
            step: 1,
          });
        });
        push('offset', 'offset', f.offset, { min: -500, max: 500, step: 1 });
        return out;
      }
      if (f.shape === 'circle' && f.points.length === 2) {
        // A circle is stored as the two ends of a diameter (see
        // newCircleSketch's own comment on why) -- but that is a storage
        // choice, not something a student should have to reverse-engineer
        // from two raw corner coordinates to answer "how big is this
        // circle". Measured 2026-09-04: the lens had to compute a diameter
        // by hand from "corner 1 across -5, corner 2 across 5" to hit an
        // exact Ø10. "Across" (not "diameter") matches the Rectangle/Box
        // tools' own vocabulary for a straight-line measurement.
        const [p0, p1] = f.points;
        const across = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        const cx = (p0[0] + p1[0]) / 2;
        const cy = (p0[1] + p1[1]) / 2;
        push('across', 'across', across);
        out.push({ name: pname(f.id, 'x'), caption: `${label} centre x`, value: cx, min: -500, max: 500, step: 1 });
        out.push({ name: pname(f.id, 'y'), caption: `${label} centre y`, value: cy, min: -500, max: 500, step: 1 });
      } else {
        // Two per corner. A sketch with a dozen corners is a long panel,
        // which is why the corners are dragged rather than typed most of
        // the time.
        f.points.forEach(([u, v], n) => {
          out.push({ name: pname(f.id, `p${n}u`), caption: `${label} corner ${n + 1} across`, value: u, min: -500, max: 500, step: 1 });
          out.push({ name: pname(f.id, `p${n}v`), caption: `${label} corner ${n + 1} up`, value: v, min: -500, max: 500, step: 1 });
        });
        // One slider per corner the student rounded. Emitted from `rounds`, the
        // request -- so the radius is a live parameter the frame can be handed
        // without regenerating the source, exactly like every other dimension.
        // Before this the radius existed only baked into a bulge literal, which
        // is why nothing anywhere in the app could show a student what it was.
        for (const [key, want] of Object.entries(f.rounds ?? {})) {
          const k = Number(key);
          if (!Number.isInteger(k) || k < 0 || k >= f.points.length || !(want > 0)) continue;
          const ceiling = maxFilletRadius(f.points, k, f.bulges);
          out.push({
            name: pname(f.id, `r${k}`),
            caption: `${label} corner ${k + 1} round`,
            value: want,
            min: 0,
            // The ceiling can sit BELOW what is currently stored (another round
            // on the shared edge, or a corner the solver has since sharpened).
            // Clamping the slider's max below its own value would snap the
            // radius down the first time the panel rendered, silently -- which
            // is the shape of bug this whole round exists to stop.
            max: Math.max(ceiling, want),
            step: 0.5,
          });
        }
      }
      push('offset', 'offset', f.offset, { min: -500, max: 500, step: 1 });
    } else if (f.kind === 'extrude') {
      push('height', 'height', f.height);
    } else if (f.kind === 'revolve') {
      push('angle', 'angle', f.angle, { min: 1, max: 360, step: 1 });
    } else if (f.kind === 'pattern') {
      push('count', 'count', f.count, { min: 1, max: 24, step: 1 });
      if (f.mode === 'circular') {
        push('totalangle', 'angle', f.totalAngle ?? 360, { min: 1, max: 360, step: 1 });
      } else {
        const step = f.step ?? [0, 0, 0];
        push('stepx', 'step x', step[0], { min: -500, max: 500, step: 1 });
        push('stepy', 'step y', step[1], { min: -500, max: 500, step: 1 });
        push('stepz', 'step z', step[2], { min: -500, max: 500, step: 1 });
      }
    } else if (f.kind === 'hole') {
      push('diameter', 'diameter', f.diameter);
      push('depth', 'depth', f.depth);
      pushCentre(out, f.id, label, f.center);
      // Item P: "corner spacing" (HoleFeature.corners' own stored dx/dy --
      // half the distance BETWEEN two opposite holes, i.e. measured from
      // the CENTRE) reads as "inset from the edge" only when the target's
      // width and depth happen to be equal. Typing the same number for
      // both axes on a non-square target gave two DIFFERENT actual edge
      // margins -- exactly how a round-3 blind judge's capture ended up
      // with one hole crowding an edge, typing 8 meaning "8 in from each
      // side" on both. The panel now shows/accepts the inset itself
      // (half the target's own extent along that axis, minus the stored
      // centre-offset) so the same typed number means the same margin
      // regardless of the target's shape; converted back on the way in,
      // see applyParam's own comment. Falls back to the raw stored value
      // (old behaviour) when the target's extent cannot be read (a Move,
      // a rotated shape, ...) -- there is no side to measure "in from"
      // then, so the centre-offset is still the only honest number.
      if (f.corners) {
        const fullX = extentAlong(doc, f.target, 'x');
        const fullY = extentAlong(doc, f.target, 'y');
        const insetX = fullX != null ? fullX / 2 - f.corners.dx : f.corners.dx;
        const insetY = fullY != null ? fullY / 2 - f.corners.dy : f.corners.dy;
        // An inset below the hole's own radius would break through the
        // side it is measured from -- the panel's own min now says so
        // (plus a hair of margin, so the hole does not sit exactly
        // tangent to the edge), rather than letting a typed value that
        // small quietly cut through it. See ReshapeParamsPanel.tsx's own
        // clamp-note for the sentence shown when this actually clamps.
        const margin = f.diameter / 2 + 0.5;
        push('dx', 'in from each side (across)', insetX, { min: margin, max: 250, step: 0.5 });
        push('dy', 'in from each side (up)', insetY, { min: margin, max: 250, step: 0.5 });
      }
    } else if (f.kind === 'shell') {
      push('thickness', 'wall', f.thickness, { min: 0.5, max: 40, step: 0.5 });
    } else if (f.kind === 'move') {
      pushCentre(out, f.id, label, f.offset);
    } else if (f.kind === 'fillet') {
      // The ceiling is the same one maxRound() gives the box/cylinder's own
      // round slider -- borrowed from the root primitive the named edge
      // actually sits on (rootFeature() of f.edge), not from f.target, which
      // can be a later feature in the chain. A root this file cannot resolve
      // to a primitive falls back to the stored value itself: not roomy, but
      // never a max below the current size, which is the bug this whole
      // pattern exists to avoid (see the sketch-round comment above).
      const root = doc.features.find((x) => x.id === rootFeature(f.edge));
      const ceiling = root && isRoundable(root) ? maxRound(root) : f.size;
      push('size', f.style === 'chamfer' ? 'cut' : 'radius', f.size, {
        // 0.5-step from 0.5, so every whole and half number is a stop the
        // slider can land on; from 0.1 the stops were 0.1, 0.6, 1.1 ... and
        // typing 3 snapped to 3.1 with no warning.
        min: 0.5,
        // On the step grid, or a typed 15 clamps the text box to 9.99 while
        // the slider beside it sits on 9.5 (measured 2026-09-03).
        max: Math.max(Math.floor(ceiling / 0.5) * 0.5, f.size),
        step: 0.5,
      });
    }
    // Phase 5.1 part 2 (todo 23): the draft's angle joins the panel the
    // same way it joins the manipulator -- one slot, one caption family.
    // |angle| < 90; negative leans in, 0 is "no taper" (identity).
    if (f.kind === 'draft') {
      push('angle', 'taper angle', f.angle, { min: -89.5, max: 89.5, step: 0.5 });
    }
    // mirror carries no numeric slot -- its only input is a plane choice.
  });
  return out;
}

// Only when the shape has actually been given a rotation, so an unrotated model
// does not carry three dead angle rows per shape.
function pushTurn(out: GeneratedParam[], id: string, label: string, r?: Vec3) {
  if (!r) return;
  (['rx', 'ry', 'rz'] as const).forEach((a, i) => {
    out.push({
      name: pname(id, a),
      caption: `${label} turn ${a[1]}`,
      value: r[i],
      min: -180,
      max: 180,
      step: 5,
    });
  });
}

function pushCentre(out: GeneratedParam[], id: string, label: string, c: Vec3) {
  (['x', 'y', 'z'] as const).forEach((a, i) => {
    out.push({
      name: pname(id, a),
      caption: `${label} ${a}`,
      value: c[i],
      min: -500,
      max: 500,
      step: 1,
    });
  });
}

/** Live values keyed by generated param name — what gets posted to the frame. */
export function paramValues(doc: ModelDoc): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of generatedParams(doc)) out[p.name] = p.value;
  return out;
}

/**
 * Write a value the panel produced back into the doc.
 *
 * The panel talks in generated names (`b1_width`), the doc in fields. Without
 * this the two drift the moment a dimension is typed: the frame would show one
 * model and the generated code would still say another.
 */
export function applyParam(doc: ModelDoc, name: string, value: number): ModelDoc {
  const cut = name.lastIndexOf('_');
  if (cut < 0) return doc;
  const id = name.slice(0, cut);
  const slot = name.slice(cut + 1);
  let changed = false;

  const features = doc.features.map((f) => {
    if (f.id !== id) return f;
    const turn = slot === 'rx' ? 0 : slot === 'ry' ? 1 : slot === 'rz' ? 2 : null;
    // A sphere has no rotate field, which is the type system saying the same
    // thing canRotate() does: turning it would change nothing to look at.
    if (turn !== null && canRotate(f) && f.rotate) {
      const rotate: Vec3 = [f.rotate[0], f.rotate[1], f.rotate[2]];
      rotate[turn] = value;
      changed = true;
      return { ...f, rotate };
    }
    const axis = slot === 'x' ? 0 : slot === 'y' ? 1 : slot === 'z' ? 2 : null;
    if (axis !== null && isShape(f)) {
      const center: Vec3 = [...f.center];
      center[axis] = value;
      changed = true;
      return { ...f, center };
    }
    if (f.kind === 'box') {
      const ax = AXIS.indexOf(slot as (typeof AXIS)[number]);
      if (ax === 0 || ax === 1 || ax === 2) {
        const size: Vec3 = [...f.size];
        size[ax] = value;
        changed = true;
        return { ...f, size };
      }
      if (slot === 'round') { changed = true; return { ...f, round: value }; }
    }
    if (f.kind === 'cylinder') {
      // The panel now shows/accepts "across" (diameter) -- see
      // generatedParams -- so the incoming value halves back to the
      // stored radius.
      if (slot === 'radius') { changed = true; return { ...f, radius: value / 2 }; }
      if (slot === 'height') { changed = true; return { ...f, height: value }; }
      if (slot === 'round') { changed = true; return { ...f, round: value }; }
    }
    if (f.kind === 'cone') {
      if (slot === 'radius') { changed = true; return { ...f, radius: value / 2 }; }
      if (slot === 'height') { changed = true; return { ...f, height: value }; }
    }
    if (f.kind === 'torus') {
      // Inverse of generatedParams' 2*(ringRadius+tubeRadius) / 2*tubeRadius.
      // Each field holds the OTHER one's currently-shown "across" number
      // fixed -- editing tube across must not silently move the ring
      // across number the student did not touch, and vice versa (the
      // same "changing one field must not re-aim another" rule the
      // circle sketch's 'across' handling below already follows).
      if (slot === 'ring') { changed = true; return { ...f, ringRadius: value / 2 - f.tubeRadius }; }
      if (slot === 'tube') {
        changed = true;
        const tubeRadius = value / 2;
        const ringRadius = f.ringRadius + f.tubeRadius - tubeRadius;
        return { ...f, ringRadius, tubeRadius };
      }
    }
    if (f.kind === 'prism') {
      if (slot === 'radius') { changed = true; return { ...f, radius: value / 2 }; }
      if (slot === 'height') { changed = true; return { ...f, height: value }; }
    }
    if (f.kind === 'wedge') {
      if (slot === 'width') { changed = true; return { ...f, width: value }; }
      if (slot === 'depth') { changed = true; return { ...f, depth: value }; }
      if (slot === 'height') { changed = true; return { ...f, height: value }; }
    }
    if (f.kind === 'groove') {
      if (slot === 'angle') { changed = true; return { ...f, angle: value }; }
    }
    if (f.kind === 'pocket') {
      if (slot === 'depth') { changed = true; return { ...f, depth: value }; }
    }
    if (f.kind === 'sketch') {
      if (f.shape === 'circle' && f.points.length === 2 && (slot === 'across' || slot === 'x' || slot === 'y')) {
        const [p0, p1] = f.points;
        const cx = (p0[0] + p1[0]) / 2;
        const cy = (p0[1] + p1[1]) / 2;
        // Half the diameter vector, kept fixed by 'x'/'y' (moving the centre
        // must not change the size) and only rescaled -- never re-aimed -- by
        // 'across' (so dragging one handle earlier does not un-do a diameter
        // the student dragged into some other direction).
        const hx = (p1[0] - p0[0]) / 2;
        const hy = (p1[1] - p0[1]) / 2;
        if (slot === 'across') {
          const halfLen = Math.hypot(hx, hy);
          const newHalf = Math.max(0, value) / 2;
          const dirx = halfLen > 1e-9 ? hx / halfLen : 1;
          const diry = halfLen > 1e-9 ? hy / halfLen : 0;
          const points: Array<[number, number]> = [
            [cx - dirx * newHalf, cy - diry * newHalf],
            [cx + dirx * newHalf, cy + diry * newHalf],
          ];
          changed = true;
          return { ...f, points };
        }
        const newCx = slot === 'x' ? value : cx;
        const newCy = slot === 'y' ? value : cy;
        const points: Array<[number, number]> = [
          [newCx - hx, newCy - hy],
          [newCx + hx, newCy + hy],
        ];
        changed = true;
        return { ...f, points };
      }
      // slot is p<n>u or p<n>v
      const m = /^p(\d+)([uv])$/.exec(slot);
      if (m) {
        const n = Number(m[1]);
        if (n >= 0 && n < f.points.length) {
          const points = f.points.map((pt, i) =>
            i === n
              ? (m[2] === 'u' ? [value, pt[1]] : [pt[0], value]) as [number, number]
              : pt
          );
          changed = true;
          return { ...f, points };
        }
      }
      // r<n>: the radius asked for on DESIGN corner n. Writes the request,
      // never geometry -- outlineOf() turns it into trim points and a bulge
      // wherever the outline is needed, so a drag on this handle cannot leave
      // a stale arc endpoint behind for another mover to find.
      const r = /^r(\d+)$/.exec(slot);
      if (r) {
        const k = Number(r[1]);
        if (k >= 0 && k < f.points.length) {
          const rounds = { ...(f.rounds ?? {}) };
          // Dragged to nothing is un-rounded, not rounded-by-zero: a zero left
          // in the map would keep emitting a dead slider and a dead handle.
          if (value > 0) rounds[k] = value;
          else delete rounds[k];
          changed = true;
          return { ...f, rounds };
        }
      }
      if (slot === 'offset') { changed = true; return { ...f, offset: value }; }
      // A soup rule's value slot (D8): rule${i}-value writes back into
      // rules[i].value, the same field the emitter reads. The kernel solves
      // the soup at build time, so the doc write IS the solve request.
      const rm = /^rule(\d+)-value$/.exec(slot);
      if (rm && f.rules) {
        const i = Number(rm[1]);
        const r = f.rules[i] as { value?: number | string } | undefined;
        if (r && typeof r.value === 'number') {
          const rules = f.rules.map((x, j) => (j === i ? { ...x, value } : x));
          changed = true;
          return { ...f, rules };
        }
      }
    }
    if (f.kind === 'extrude' && slot === 'height') {
      changed = true;
      return { ...f, height: value };
    }
    if (f.kind === 'sphere' && slot === 'radius') {
      changed = true;
      return { ...f, radius: value / 2 };
    }
    if (f.kind === 'revolve' && slot === 'angle') {
      changed = true;
      return { ...f, angle: value };
    }
    if (f.kind === 'pattern') {
      if (slot === 'count') { changed = true; return { ...f, count: Math.max(1, Math.round(value)) }; }
      if (slot === 'totalangle') { changed = true; return { ...f, totalAngle: value }; }
      const stepAx = slot === 'stepx' ? 0 : slot === 'stepy' ? 1 : slot === 'stepz' ? 2 : null;
      if (stepAx !== null) {
        const step: Vec3 = f.step ? [...f.step] : [0, 0, 0];
        step[stepAx] = value;
        changed = true;
        return { ...f, step };
      }
    }
    if (f.kind === 'hole') {
      if (slot === 'diameter') { changed = true; return { ...f, diameter: value }; }
      if (slot === 'depth') { changed = true; return { ...f, depth: value }; }
      const holeAx = slot === 'x' ? 0 : slot === 'y' ? 1 : slot === 'z' ? 2 : null;
      if (holeAx !== null) {
        const center: Vec3 = [...f.center];
        center[holeAx] = value;
        changed = true;
        return { ...f, center };
      }
      if (f.corners && (slot === 'dx' || slot === 'dy')) {
        // Inverse of generatedParams' inset conversion above: the panel
        // hands back "N in from the side", converted back to the stored
        // centre-offset the same way (half the target's own extent minus
        // the typed inset), so a value typed under the OLD raw-offset
        // reading never lingers -- see that comment for why.
        const axis = slot === 'dx' ? 'x' : 'y';
        const full = extentAlong(doc, f.target, axis);
        const stored = full != null ? full / 2 - value : value;
        changed = true;
        return { ...f, corners: { ...f.corners, [slot]: stored } };
      }
    }
    if (f.kind === 'shell' && slot === 'thickness') {
      changed = true;
      return { ...f, thickness: value };
    }
    if (f.kind === 'move') {
      const moveAx = slot === 'x' ? 0 : slot === 'y' ? 1 : slot === 'z' ? 2 : null;
      if (moveAx !== null) {
        const offset: Vec3 = [...f.offset];
        offset[moveAx] = value;
        changed = true;
        return { ...f, offset };
      }
    }
    if (f.kind === 'fillet' && slot === 'size') { changed = true; return { ...f, size: value }; }
    if (f.kind === 'draft' && slot === 'angle') { changed = true; return { ...f, angle: value }; }
    return f;
  });

  return changed ? { ...doc, features } : doc;
}

/**
 * Make every constrained sketch in a doc obey its own rules.
 *
 * Applied wherever a doc is adopted, so "the points satisfy the constraints as
 * far as they can" is an invariant of the doc rather than something each caller
 * has to remember. Solving at the call site instead meant a caller holding a
 * stale copy could solve the wrong points and write the result back -- which is
 * exactly how a typed corner value went missing the moment a rule was applied.
 */
export function solveDoc(doc: ModelDoc): ModelDoc {
  let changed = false;
  const features = doc.features.map((f) => {
    if (f.kind !== 'sketch' || !f.constraints || f.constraints.length === 0) return f;
    const solved = solveSketch(f.points.map((p) => [p[0], p[1]]), f.constraints);
    if (solved.residual === 0 && solved.iterations === 0) return f;
    const points = solved.points.map((p) => [p[0], p[1]] as [number, number]);
    if (points.every((p, i) => p[0] === f.points[i][0] && p[1] === f.points[i][1])) return f;
    // The solver is happy to satisfy a rule by collapsing an edge to nothing:
    // one Up toggle on a horizontal edge of a fresh rectangle drives both its
    // corners to the same point, residual 0, over-constrained false, no
    // message -- and Pull then extrudes the degenerate outline into a solid
    // (M3). residual cannot catch it, because the collapse is what SATISFIES
    // the rule. So the gate is geometric: if the solved design is no longer a
    // shape, keep the one that was.
    //
    // Refusing here rather than at the toggle is deliberate -- solveDoc runs
    // on EVERY doc adoption, so a load, an undo and a drag are covered by the
    // same line. The toggle says so out loud (ModelEditor.setConstraints);
    // this is the belt under that belt, and stays silent.
    //
    // collapsedByRatio catches the near-miss outlineOf cannot: a rule can be
    // satisfied by squeezing the shape to a sliver well short of a TRUE
    // zero-length edge (S09, 2026-09-04), and that is just as much a doc
    // this function should refuse to adopt.
    if (!outlineOf({ ...f, points }).ok) return f;
    if (collapsedByRatio(f.points.map((p) => [p[0], p[1]] as Point), points)) return f;
    changed = true;
    return { ...f, points };
  });
  return changed ? { ...doc, features } : doc;
}

/**
 * Run a corner change past the sketch's constraints.
 *
 * Returns every corner parameter the solver ended up moving, not just the one
 * that was dragged — a constrained edge moves its far end too, and the frame
 * has to be told about both or the model and the outline disagree.
 *
 * The dragged corners are pinned, so the solver moves everything else to meet
 * them. Without that the pointer fights the constraint and the corner crawls.
 */
export function solveSketchDrag(
  doc: ModelDoc,
  changed: Record<string, number>
): Record<string, number> {
  const out: Record<string, number> = { ...changed };

  for (const f of doc.features) {
    if (f.kind !== 'sketch' || !f.constraints || f.constraints.length === 0) continue;

    const pinned: number[] = [];
    const pts: Point[] = f.points.map((p) => [p[0], p[1]]);
    let touched = false;

    for (const [name, value] of Object.entries(changed)) {
      if (!name.startsWith(`${f.id}_p`)) continue;
      const m = /^p(\d+)([uv])$/.exec(name.slice(f.id.length + 1));
      if (!m) continue;
      const n = Number(m[1]);
      if (n < 0 || n >= pts.length) continue;
      pts[n][m[2] === 'u' ? 0 : 1] = value;
      pinned.push(n);
      touched = true;
    }
    if (!touched) continue;

    const solved = solveSketch(pts, f.constraints, pinned);
    solved.points.forEach((p, n) => {
      if (Math.abs(p[0] - f.points[n][0]) > 1e-9) out[pname(f.id, `p${n}u`)] = p[0];
      if (Math.abs(p[1] - f.points[n][1]) > 1e-9) out[pname(f.id, `p${n}v`)] = p[1];
    });
  }

  return out;
}

