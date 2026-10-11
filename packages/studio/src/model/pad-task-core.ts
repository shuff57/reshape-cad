// pad-task-core.ts: the pure half of the Pad / Pocket task panel.
//
// WHAT THE PANEL IS. A Pad (ExtrudeFeature) or a Pocket (PocketFeature) opens a
// task panel beside the viewport: OK / Cancel, a parameters group, and a preview
// group. The student edits a DRAFT of the feature; the viewport shows the draft
// built by the kernel (live preview); OK commits it as one undo step, Cancel
// throws it away (and a brand-new pad is removed again). This file is the part
// with no React in it, so `node --test` can pin it from dist/:
//
//   draftOf / withDraft   feature <-> the fields the panel shows
//   checkDraft            a plain sentence for a value the kernel could not use
//   upToFaceLength        a picked face -> a length, or why it cannot be one
//   readBinding           what a student typed into a field's expression box
//
// The solid itself is never computed here: a draft is only ever a ModelDoc
// handed to brep-rs, which builds it or refuses it in a sentence.

import {
  featureRangeAlong, type Axis3, type ExtrudeFeature, type Feature, type ModelDoc, type PocketFeature,
  type SketchFeature,
} from '@shuff57/reshape-script/model-types';
import { placementOf } from '@shuff57/reshape-script/model-handles';
import type { TopoName } from '@shuff57/reshape-script/topo-name';

export type PadKind = 'extrude' | 'pocket';
export type PadFeature = ExtrudeFeature | PocketFeature;

/** One sided, Two sides (a second length the other way), Symmetric to plane. */
export type SideMode = 'one' | 'two' | 'symmetric';
/**
 * What ends the length. 'through' is a Pocket-only type. The rest follow
 * FreeCAD's Type list: Dimension, To last / Through all, To first, Up to face,
 * Two dimensions, Up to shape. Two dimensions is not a type of its own here
 * (it is Two sides, see `PadDraft.twoDims`); the four "up to" types are
 * resolved to a plain length before anything is written to the document.
 */
export type LengthType = 'dimension' | 'through' | 'toLast' | 'toFirst' | 'upToFace' | 'upToShape';
/** The ids the Type select offers: a LengthType, or the Two dimensions entry. */
export type TypeChoice = LengthType | 'twoLengths';

/** Types that stop at the part's own last / first face: no pick needed. */
export const isReachType = (t: LengthType): boolean => t === 'toLast' || t === 'toFirst';
/** Types that stop at a face the student picks in the viewport. */
export const isFaceType = (t: LengthType): boolean => t === 'upToFace' || t === 'upToShape';
/** Types whose length is measured, not typed. */
export const isMeasuredType = (t: LengthType): boolean => isReachType(t) || isFaceType(t);

export interface PadDraft {
  kind: PadKind;
  side: SideMode;
  type: LengthType;
  /** The first length (a pad's height, a pocket's depth), always positive. */
  length: number;
  /** The second length of "Two sides", positive. Kept while another mode is on. */
  length2: number;
  reversed: boolean;
  /** Taper angle, degrees; positive grows the profile outward (FreeCAD's sign). */
  taper: number;
  /** Taper angle of the second side (Two sides / Two dimensions). Panel only:
   *  the document has no second taper, so anything but 0 is refused in a sentence. */
  taper2: number;
  /** Up to face / Up to shape: how far past (+) or short of (-) the face it ends. */
  offset: number;
  /** The Type select reads "Two dimensions" (side is 'two'). Panel only. */
  twoDims: boolean;
  /** Which way it is pulled: along the sketch normal, or a custom x / y / z. */
  dirMode: 'normal' | 'custom';
  /** The custom vector (world space); kept while the mode is back on normal. */
  dir: [number, number, number];
  /** Custom direction only: is the length measured along the sketch normal? */
  alongNormal: boolean;
}

export type Vec3 = [number, number, number];
/** Negation without the -0 that `-0` of a zero would leave in a document. */
const neg = (c: number): number => (c === 0 ? 0 : -c);

export const DEFAULT_LENGTH2 = 5;

export function isPadFeature(f: Feature | undefined | null): f is PadFeature {
  return !!f && (f.kind === 'extrude' || f.kind === 'pocket');
}

/** The slot a feature's first length is bound to (the name generatedParams uses). */
export function lengthSlot(f: PadFeature): string {
  return `${f.id}_${f.kind === 'extrude' ? 'height' : 'depth'}`;
}

export function draftOf(f: PadFeature, normal: Vec3 = [0, 0, 1]): PadDraft {
  const length = f.kind === 'extrude' ? f.height : f.depth;
  const side: SideMode = f.midplane ? 'symmetric' : f.length2 !== undefined && f.length2 > 0 ? 'two' : 'one';
  return {
    kind: f.kind,
    side,
    type: f.kind === 'pocket' && f.through ? 'through' : 'dimension',
    length: Math.abs(length),
    length2: f.length2 !== undefined && f.length2 > 0 ? f.length2 : DEFAULT_LENGTH2,
    // A pad pulled with a negative height is the old spelling of "reversed".
    reversed: f.reversed === true || (f.kind === 'extrude' && f.height < 0),
    taper: f.taper ?? 0,
    taper2: 0,
    offset: 0,
    twoDims: false,
    dirMode: f.direction ? 'custom' : 'normal',
    dir: f.direction ? [...f.direction] as Vec3 : [...normal] as Vec3,
    alongNormal: f.alongNormal !== false,
  };
}

/** The feature with the draft written into it. Only fields that are set appear,
 *  so an untouched pad stays byte-identical to what the script already wrote. */
export function withDraft<F extends PadFeature>(f: F, d: PadDraft): F {
  const was = draftOf(f, d.dir);
  const sameDir = was.dirMode === d.dirMode
    && (d.dirMode === 'normal' || (was.dir.every((c, i) => c === d.dir[i]) && was.alongNormal === d.alongNormal));
  if (was.side === d.side && was.type === d.type && was.length === d.length && was.reversed === d.reversed
    && (d.side !== 'two' || was.length2 === d.length2) && was.taper === d.taper && sameDir) {
    return f;
  }
  const out = { ...f } as F & Record<string, unknown>;
  delete out.midplane;
  delete out.length2;
  delete out.reversed;
  delete out.through;
  delete out.taper;
  delete out.direction;
  delete out.alongNormal;
  if (d.taper !== 0 && Number.isFinite(d.taper)) out.taper = d.taper;
  if (d.dirMode === 'custom') {
    out.direction = [...d.dir];
    if (!d.alongNormal) out.alongNormal = false;
  }
  // A pad stored with a negative height already means "reversed": keep that
  // spelling when it is still the direction asked for, so a script that wrote
  // pull(sk, -5) is not rewritten into a different-looking one.
  const legacyNegative = f.kind === 'extrude' && (f as ExtrudeFeature).height < 0;
  if (f.kind === 'extrude') {
    if (legacyNegative && d.reversed) out.height = -d.length;
    else {
      out.height = d.length;
      if (d.reversed) out.reversed = true;
    }
  } else {
    out.depth = d.length;
    if (d.reversed) out.reversed = true;
  }
  if (d.side === 'symmetric') out.midplane = true;
  else if (d.side === 'two' && d.type !== 'through') out.length2 = d.length2;
  if (f.kind === 'pocket' && d.type === 'through') out.through = true;
  return out;
}

/** A sentence for a draft the kernel cannot use, or null when it is fine. */
export function checkDraft(d: PadDraft): string | null {
  const word = 'Length';
  if (!(d.length > 0) || !Number.isFinite(d.length)) {
    return `${word} has to be a number above 0 -- there is nothing to ${d.kind === 'extrude' ? 'pad' : 'cut'} otherwise.`;
  }
  if (d.side === 'two' && d.type !== 'through' && (!(d.length2 > 0) || !Number.isFinite(d.length2))) {
    return 'Length 2 has to be a number above 0 for Two sides.';
  }
  if (!Number.isFinite(d.taper) || Math.abs(d.taper) >= 90) {
    return 'Taper angle has to be a number between -90 and 90 degrees.';
  }
  if (d.side === 'two' && (!Number.isFinite(d.taper2) || Math.abs(d.taper2) >= 90)) {
    return 'Taper angle 2 has to be a number between -90 and 90 degrees.';
  }
  if (d.side === 'two' && d.taper2 !== 0) {
    return 'A taper on the second side is not built yet: set Taper angle 2 to 0, or choose One sided.';
  }
  if (isFaceType(d.type) && !Number.isFinite(d.offset)) return 'Offset has to be a number.';
  if (d.dirMode === 'custom') {
    if (d.dir.some((c) => !Number.isFinite(c))) return 'The direction X, Y and Z have to be numbers.';
    if (d.dir.every((c) => c === 0)) return 'A custom direction of 0, 0, 0 points nowhere. Give X, Y or Z a value.';
  }
  return null;
}

/** Which values the panel offers for each select, in the order shown. */
export const SIDE_OPTIONS: ReadonlyArray<{ id: SideMode; label: string }> = [
  { id: 'one', label: 'One sided' },
  { id: 'two', label: 'Two sides' },
  { id: 'symmetric', label: 'Symmetric to plane' },
];

export function typeOptions(kind: PadKind): ReadonlyArray<{ id: TypeChoice; label: string }> {
  return [
    { id: 'dimension', label: 'Dimension' },
    kind === 'extrude' ? { id: 'toLast', label: 'To last' } : { id: 'through', label: 'Through all' },
    { id: 'toFirst', label: 'To first' },
    { id: 'upToFace', label: 'Up to face' },
    { id: 'twoLengths', label: 'Two dimensions' },
    { id: 'upToShape', label: 'Up to shape' },
  ];
}

/** What the Type select shows for a draft. */
export function typeChoiceOf(d: PadDraft): TypeChoice {
  return d.twoDims && d.side === 'two' && d.type === 'dimension' ? 'twoLengths' : d.type;
}

// ---- the draft's own block ---------------------------------------------

/** Id of the free-standing block the preview overlay draws for a draft. */
export const toolIdOf = (f: PadFeature): string => `${f.id}__tool`;

/**
 * The block a pad adds or a pocket removes, as a pad of its own: the same
 * profile, swept the same way, handed to the kernel like any other pad so the
 * overlay is the kernel's solid and never a drawing of one. A pocket's block is
 * the pad pulled the other way, so its direction vector is negated; "through
 * all" becomes a length that clears the part it cuts.
 */
export function toolOf(doc: ModelDoc, f: PadFeature): ExtrudeFeature {
  const id = toolIdOf(f);
  if (f.kind === 'extrude') return { ...f, id };
  let depth = f.depth;
  if (f.through) {
    let diag2 = 0;
    for (const axis of ['x', 'y', 'z'] as const) {
      const r = featureRangeAlong(doc, f.into, axis);
      diag2 += r ? (r.hi - r.lo) ** 2 : 1000 ** 2;
    }
    depth = 3 * Math.sqrt(diag2) + 10;
  }
  const out: ExtrudeFeature = { id, kind: 'extrude', target: f.target, height: -depth };
  if (f.reversed) out.reversed = true;
  if (f.midplane) out.midplane = true;
  else if (f.length2 !== undefined && f.length2 > 0 && !f.through) out.length2 = f.length2;
  if (f.taper) out.taper = f.taper;
  if (f.direction) {
    out.direction = [neg(f.direction[0]), neg(f.direction[1]), neg(f.direction[2])];
    if (f.alongNormal === false) out.alongNormal = false;
  }
  return out;
}

// ---- the live preview and the check OK waits for ----------------------

/** What the panel asks the viewport for: `feature` is the draft to DRAW (null: draw the model as it is), `check` the
 *  draft to CHECK -- built in place of the feature for its refusal whatever is drawn (null: nothing to check yet). */
export interface PadPreviewRequest {
  feature: PadFeature | null;
  check: PadFeature | null;
  overlay: boolean;
  final: boolean;
}

/**
 * The document the draft is checked on: the model with the draft in place of
 * the feature, every later feature kept. Built for the draft's own refusal even
 * when only the overlay is drawn -- the overlay's block is a free-standing pad,
 * which builds happily where the draft cut into (or joined to) the part is
 * refused, so a doc of the overlay alone can never say "this pocket misses".
 * Null when the feature is not in `doc` (suppressed, or past the rollback bar).
 */
export function draftCheckDoc(doc: ModelDoc, id: string, draft: PadFeature): ModelDoc | null {
  if (!doc.features.some((x) => x.id === id)) return null;
  return { ...doc, features: doc.features.map((x) => (x.id === id ? draft as Feature : x)) };
}

/**
 * The document the viewport DRAWS for the panel, after FreeCAD's two preview
 * modes: the final result (the draft built into the model, with its block drawn
 * translucent over a pocket when the overlay is ticked too) or the overlay alone
 * (the model as it stood before the feature, with the draft's own block). The
 * features after the draft are held back in the overlay, as the tip of a
 * FreeCAD body is. When the drawn document is just the draft in place it IS
 * `checkDoc` (same object), so the viewport builds it once for both.
 */
export function padDisplayDoc(
  doc: ModelDoc, id: string, preview: PadPreviewRequest, checkDoc: ModelDoc | null,
): { doc: ModelDoc; toolId: string | null } | null {
  const draft = preview.feature;
  if (!draft) return null;
  const at = doc.features.findIndex((x) => x.id === id);
  if (at < 0) return null;
  const swapped = (): ModelDoc => (checkDoc && checkDoc.features[at] === draft ? checkDoc : draftCheckDoc(doc, id, draft)!);
  const wantTool = preview.overlay && !(preview.final && draft.kind === 'extrude');
  const tool = wantTool ? toolOf(doc, draft) : null;
  if (preview.final) {
    const s = swapped();
    return tool ? { doc: { ...s, features: [...s.features, tool] }, toolId: tool.id } : { doc: s, toolId: null };
  }
  if (!tool) return { doc: swapped(), toolId: null };
  return { doc: { ...doc, features: [...doc.features.slice(0, at), tool] }, toolId: tool.id };
}

/** One finished check build: the document built, the draft in it, and the
 *  sentence the kernel refused the draft with (null when it built). */
export interface DraftCheckRun {
  doc: ModelDoc;
  feature: PadFeature;
  refusal: string | null;
}

/** What the panel is told about its draft. `feature` is the draft the sentence
 *  belongs to, or null while the check of the draft the panel holds NOW is still
 *  being built (the sentence is then the previous draft's, kept on screen). */
export interface DraftCheck {
  feature: PadFeature | null;
  refusal: string | null;
}

/** The kernel's sentence for the draft out of a check build's refusals, or the
 *  build's own error when the whole document failed; null when it built. */
export function draftRefusalOf(refusals: ReadonlyMap<string, string> | undefined, id: string, error?: string | null): string | null {
  return refusals?.get(id) ?? error ?? null;
}

/** A finished check build, read for the draft `id`. Null when the draft is not in the document built. */
export function draftCheckRun(
  doc: ModelDoc, id: string, refusals: ReadonlyMap<string, string> | undefined, error?: string | null,
): DraftCheckRun | null {
  const f = doc.features.find((x) => x.id === id);
  return isPadFeature(f) ? { doc, feature: f, refusal: draftRefusalOf(refusals, id, error) } : null;
}

/**
 * The panel's view of the check: the last run when it was built from the
 * document asked for now, else the last run's sentence marked as not the
 * current draft's. A draft with no document to check it in (its feature is
 * suppressed or past the rollback bar, so nothing builds it) has nothing to
 * refuse it.
 */
export function draftCheckOf(want: PadFeature | null, checkDoc: ModelDoc | null, last: DraftCheckRun | null): DraftCheck | null {
  if (want && !checkDoc) return { feature: want, refusal: null };
  if (last && checkDoc && last.doc === checkDoc) return { feature: last.feature, refusal: last.refusal };
  return last ? { feature: null, refusal: last.refusal } : null;
}

export type OkVerdict = { kind: 'wait' } | { kind: 'refused'; why: string } | { kind: 'ok' };

/** What OK does with the draft the panel holds: wait for its check (none yet,
 *  or the one in hand is for another draft), refuse with the kernel's sentence,
 *  or accept. Never accepts on a check of a different draft. */
export function okVerdict(draft: PadFeature, check: DraftCheck | null): OkVerdict {
  if (!check || check.feature !== draft) return { kind: 'wait' };
  return check.refusal ? { kind: 'refused', why: check.refusal } : { kind: 'ok' };
}

/** The refusals the studio keeps after a viewport build. A build of the panel's
 *  preview (the overlay, or the final result) is not the model as it is: its
 *  refusals would hide the model's own (a later feature's, say) while the panel
 *  is open, so the studio's refusals stay as they were. */
export function refusalsAfterBuild<T>(prev: T, next: T, previewBuild: boolean): T {
  return previewBuild ? prev : next;
}

// ---- the direction arrow ----------------------------------------------

/** The sketch normal a pad grows along (a pocket cuts the opposite way), or [0, 0, 1]. */
export function pullNormal(doc: ModelDoc, f: PadFeature): Vec3 {
  const sk = doc.features.find((x) => x.id === f.target);
  if (!sk || sk.kind !== 'sketch') return [0, 0, 1];
  const w = placementOf(sk as SketchFeature).w;
  const sign = f.kind === 'pocket' ? -1 : 1;
  return [w[0] * sign + 0, w[1] * sign + 0, w[2] * sign + 0].map((c) => (c === 0 ? 0 : c)) as Vec3;
}

/**
 * Where the on-model arrow sits and which way it points for a draft: at the
 * middle of the profile, along the way the material is pushed (a pad) or cut
 * (a pocket), turned round by Reversed. null when the sketch is gone.
 */
export function pullArrow(doc: ModelDoc, f: PadFeature, d: PadDraft): { origin: Vec3; dir: Vec3 } | null {
  const sk = doc.features.find((x) => x.id === f.target);
  if (!sk || sk.kind !== 'sketch') return null;
  const s = sk as SketchFeature;
  const pf = placementOf(s);
  if (!s.points || s.points.length === 0) return null;
  let cu = 0, cv = 0;
  if (s.shape === 'circle' && s.points.length >= 2) {
    cu = (s.points[0][0] + s.points[1][0]) / 2;
    cv = (s.points[0][1] + s.points[1][1]) / 2;
  } else {
    for (const p of s.points) { cu += p[0]; cv += p[1]; }
    cu /= s.points.length; cv /= s.points.length;
  }
  const origin: Vec3 = [0, 1, 2].map((j) => pf.origin[j] + pf.u[j] * cu + pf.v[j] * cv) as Vec3;
  let dir: Vec3 = d.dirMode === 'custom' ? [...d.dir] as Vec3 : pullNormal(doc, f);
  const l = Math.hypot(dir[0], dir[1], dir[2]);
  if (!(l > 1e-12)) return null;
  dir = dir.map((c) => c / l) as Vec3;
  if (d.reversed) dir = dir.map(neg) as Vec3;
  return { origin, dir };
}

// ---- Up to face --------------------------------------------------------

export type UpTo =
  | { ok: true; length: number; label: string }
  | { ok: false; why: string };

const AXIS_OF_PART: Record<string, { axis: Axis3; sign: 1 | -1 }> = {
  '+x': { axis: 'x', sign: 1 }, '-x': { axis: 'x', sign: -1 },
  '+y': { axis: 'y', sign: 1 }, '-y': { axis: 'y', sign: -1 },
  '+z': { axis: 'z', sign: 1 }, '-z': { axis: 'z', sign: -1 },
};
const AXIS_INDEX: Record<Axis3, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };
// Steps that move or copy a solid: a face named on the primitive is no longer
// where the primitive put it, so a length read off the primitive would be wrong.
const MOVES_FACES = new Set(['move', 'rotate', 'mirror', 'pattern', 'combine', 'revolve', 'groove']);

/**
 * How far the pad / pocket has to reach from its sketch plane to stop at a
 * picked face. Honest rather than clever: it answers only for a flat face of an
 * unturned box or cylinder that no later step has moved, lying square to the
 * sketch; everything else is refused in a sentence and the length is left alone.
 */
export function upToFaceLength(
  doc: ModelDoc,
  feature: PadFeature,
  face: { target: string; name: TopoName | null | undefined; label: string },
  reversed: boolean,
): UpTo {
  const sk = doc.features.find((x) => x.id === feature.target);
  if (!sk || sk.kind !== 'sketch') return { ok: false, why: 'The profile sketch is gone, so there is nothing to measure from.' };
  let name: TopoName | null | undefined = face.name;
  while (name && (name.cause === 'carried' || name.cause === 'split')) name = name.of;
  if (!name || name.kind !== 'face') {
    return { ok: false, why: 'Pick a flat face of a box, cylinder or pad: this face cannot be measured yet.' };
  }
  let rootId: string;
  let axis: Axis3;
  let faceAt = 0;
  if (name.cause === 'primitive') {
    const part = AXIS_OF_PART[name.part];
    if (!part) return { ok: false, why: 'Pick a flat face of a box, cylinder or pad: a curved side has no single distance.' };
    const root = doc.features.find((x) => x.id === name!.feature);
    if (!root || (root.kind !== 'box' && root.kind !== 'cylinder')) {
      return { ok: false, why: 'Pick a flat face of a box, cylinder or pad: this face cannot be measured yet.' };
    }
    if (root.rotate && root.rotate.some((v) => v !== 0)) {
      return { ok: false, why: 'That face belongs to a turned shape, so its distance is not a plain number. Turn it back first.' };
    }
    rootId = root.id;
    axis = part.axis;
  } else if (name.cause === 'cap' || name.cause === 'swept') {
    // A face of a pad: its cap, or the wall one straight sketch edge swept.
    const root = doc.features.find((x) => x.id === name!.feature);
    if (!root || root.kind !== 'extrude') {
      return { ok: false, why: 'Pick a flat face of a box, cylinder or pad: this face cannot be measured yet.' };
    }
    if (root.taper || root.direction) {
      return { ok: false, why: 'That pad is tapered or pulled at an angle, so its faces are not square to the sketch. Pick a face of a plain pad.' };
    }
    const psk = doc.features.find((x) => x.id === root.target);
    if (!psk || psk.kind !== 'sketch') return { ok: false, why: 'The pad’s own sketch is gone, so that face cannot be measured.' };
    const pf = placementOf(psk as SketchFeature);
    const nIdx = [0, 1, 2].find((j) => Math.abs(Math.abs(pf.n[j]) - 1) < 1e-9 && [0, 1, 2].every((k) => k === j || Math.abs(pf.n[k]) < 1e-9));
    if (nIdx === undefined) return { ok: false, why: 'That pad’s sketch is not square to an axis, so its faces cannot be measured.' };
    const nAxis = (['x', 'y', 'z'] as const)[nIdx];
    if (name.cause === 'cap') {
      const r = featureRangeAlong(doc, root.id, nAxis);
      if (!r || !r.exact) return { ok: false, why: 'That pad’s end cannot be measured exactly, so the length is left as it was.' };
      axis = nAxis;
      faceAt = pf.n[nIdx] > 0 ? (name.end === 'top' ? r.hi : r.lo) : (name.end === 'top' ? r.lo : r.hi);
    } else {
      const sk2 = psk as SketchFeature;
      const i = name.edge;
      const pts = sk2.points;
      if (sk2.shape === 'circle' || !pts || i < 0 || i >= pts.length || (sk2.bulges && Object.keys(sk2.bulges).length > 0)) {
        return { ok: false, why: 'Pick a flat face of a box, cylinder or pad: a curved side has no single distance.' };
      }
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const at = (p: readonly [number, number]) => [0, 1, 2].map((j) => pf.origin[j] + pf.u[j] * p[0] + pf.v[j] * p[1]);
      const pa = at(a), pb = at(b);
      const d = [0, 1, 2].map((j) => pb[j] - pa[j]);
      const m = [
        pf.n[1] * d[2] - pf.n[2] * d[1],
        pf.n[2] * d[0] - pf.n[0] * d[2],
        pf.n[0] * d[1] - pf.n[1] * d[0],
      ];
      const ml = Math.hypot(m[0], m[1], m[2]);
      if (!(ml > 1e-12)) return { ok: false, why: 'That wall has no length, so it cannot be measured.' };
      const mIdx = [0, 1, 2].find((j) => Math.abs(Math.abs(m[j] / ml) - 1) < 1e-9);
      if (mIdx === undefined) return { ok: false, why: 'That wall is slanted in the sketch, so there is no single distance to it.' };
      axis = (['x', 'y', 'z'] as const)[mIdx];
      faceAt = pa[mIdx];
    }
    rootId = root.id;
  } else {
    return { ok: false, why: 'Pick a flat face of a box, cylinder or pad: this face cannot be measured yet.' };
  }
  const root = doc.features.find((x) => x.id === rootId)!;
  // Walk from the solid the face was picked on back to the primitive.
  let id: string | undefined = face.target;
  for (let hop = 0; hop < 32 && id && id !== root.id; hop++) {
    const f: Feature | undefined = doc.features.find((x) => x.id === id);
    if (!f) break;
    if (MOVES_FACES.has(f.kind)) {
      return { ok: false, why: `That face has been through ${f.kind === 'combine' ? 'a join or cut' : `a ${f.kind}`} since it was made, so its distance cannot be read off the shape. Pick the face on the shape it came from.` };
    }
    id = 'into' in f ? (f as PocketFeature).into : 'target' in f ? (f as { target: string }).target : undefined;
  }
  if (name.cause === 'primitive') {
    const part = AXIS_OF_PART[name.part];
    const range = featureRangeAlong(doc, root.id, part.axis);
    if (!range || !range.exact) return { ok: false, why: 'That face’s position cannot be measured exactly, so the length is left as it was.' };
    faceAt = part.sign > 0 ? range.hi : range.lo;
  }

  const { origin, n, w } = placementOf(sk as SketchFeature);
  const ai = AXIS_INDEX[axis];
  const square = (v: readonly number[]) => Math.abs(Math.abs(v[ai]) - 1) < 1e-9
    && [0, 1, 2].every((j) => j === ai || Math.abs(v[j]) < 1e-9);
  if (!square(n)) {
    return { ok: false, why: 'That face is not parallel to the sketch, so there is no single length to it.' };
  }
  const growth = feature.kind === 'extrude' ? w[ai] : -w[ai];
  const heading = growth * (reversed ? -1 : 1);
  const length = (faceAt - origin[ai]) * heading;
  if (!(length > 1e-9)) {
    return {
      ok: false,
      why: length < -1e-9
        ? `That face is behind the sketch plane for this direction. Tick Reversed, or pick a face ahead of it.`
        : 'That face lies in the sketch plane, so the length would be 0.',
    };
  }
  return { ok: true, length: Math.round(length * 1e6) / 1e6, label: face.label };
}

// ---- To last / To first -------------------------------------------------

/**
 * How far a pad / pocket has to reach from its sketch plane to stop at the
 * part's last face (farthest ahead) or first face (nearest ahead), as FreeCAD's
 * To last / To first (Through all is the pocket's To last). The solid it is
 * measured on is the one the feature is joined to or cut from. Honest about
 * what it can prove: the last face needs only the part's exact extent; the
 * first face is answered for an unturned box or cylinder, or a plain pad.
 */
export function reachLength(doc: ModelDoc, feature: PadFeature, mode: 'first' | 'last', reversed: boolean): UpTo {
  const sk = doc.features.find((x) => x.id === feature.target);
  if (!sk || sk.kind !== 'sketch') return { ok: false, why: 'The profile sketch is gone, so there is nothing to measure from.' };
  const at = doc.features.findIndex((x) => x.id === feature.id);
  let host: Feature | undefined;
  if (feature.kind === 'pocket') host = doc.features.find((x) => x.id === feature.into);
  else {
    for (let i = (at < 0 ? doc.features.length : at) - 1; i >= 0; i--) {
      const x = doc.features[i];
      if (x.kind === 'sketch' || x.kind === 'datum') continue;
      host = x;
      break;
    }
  }
  const word = mode === 'last' ? 'last' : 'first';
  if (!host) return { ok: false, why: `There is no part in the way yet, so there is no ${word} face to stop at. Build the part first, or use Dimension.` };
  const { origin, n, w } = placementOf(sk as SketchFeature);
  const ai = [0, 1, 2].find((j) => Math.abs(Math.abs(n[j]) - 1) < 1e-9 && [0, 1, 2].every((k) => k === j || Math.abs(n[k]) < 1e-9));
  if (ai === undefined) return { ok: false, why: `The sketch is not square to an axis, so the ${word} face cannot be measured. Use Dimension.` };
  const axis = (['x', 'y', 'z'] as const)[ai];
  const r = featureRangeAlong(doc, host.id, axis);
  if (!r || !r.exact) return { ok: false, why: `The part's ${word} face cannot be measured exactly, so use Dimension or Up to face.` };
  const growth = feature.kind === 'extrude' ? w[ai] : -w[ai];
  const heading = growth * (reversed ? -1 : 1);
  const ahead = [r.lo, r.hi].map((v) => (v - origin[ai]) * heading).filter((l) => l > 1e-9);
  if (ahead.length === 0) {
    return { ok: false, why: `There is no face ahead of the sketch in this direction. Tick Reversed, or move the sketch.` };
  }
  if (mode === 'first') {
    const plain = (host.kind === 'box' || host.kind === 'cylinder')
      ? !(host.rotate && host.rotate.some((v) => v !== 0))
      : host.kind === 'extrude' && !host.taper && !host.direction;
    if (!plain) {
      return { ok: false, why: 'To first is measured on a plain box, cylinder or pad only. Use Up to face and click the face, or Dimension.' };
    }
  }
  const length = mode === 'last' ? Math.max(...ahead) : Math.min(...ahead);
  return { ok: true, length: Math.round(length * 1e6) / 1e6, label: `the ${word} face` };
}

// ---- expression binding -----------------------------------------------

export type Binding =
  | { kind: 'number'; value: number }
  | { kind: 'param'; name: string; isNew: boolean }
  | { kind: 'error'; why: string };

/**
 * What the expression box of a field means. Two forms are real here: a number
 * (the field stops following a parameter) and the name of a parameter (the
 * field follows it). A leading `=` is allowed because that is how an
 * expression is started in the box; arithmetic is refused, not guessed at.
 *
 * A NEW name needs a capital letter or an underscore inside it, so it can never
 * be one of the plain lowercase command words the script already owns (box,
 * pull, hole ...), and it must not be a step's own name.
 */
export function readBinding(text: string, known: readonly string[], featureIds: readonly string[]): Binding {
  const t = text.trim().replace(/^=\s*/, '');
  if (!t) return { kind: 'error', why: 'Type a number, or the name of a parameter.' };
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) {
    const value = Number(t);
    return Number.isFinite(value) ? { kind: 'number', value } : { kind: 'error', why: 'That is not a number.' };
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) {
    return { kind: 'error', why: 'A field takes a number or one parameter name -- sums such as 2*wall are not supported here yet.' };
  }
  if (known.includes(t)) return { kind: 'param', name: t, isNew: false };
  if (featureIds.includes(t)) return { kind: 'error', why: `${t} is the name of a step, so it cannot also be a parameter.` };
  if (!/[A-Z_]/.test(t)) {
    return { kind: 'error', why: `${t} is not a parameter yet. A new name needs a capital letter or an underscore inside it, like plateThickness or plate_t, so it never clashes with a command word.` };
  }
  return { kind: 'param', name: t, isNew: true };
}

/** "plateThickness" -> "Plate thickness", the caption a new parameter gets. */
export function captionOf(name: string): string {
  const words = name.replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
