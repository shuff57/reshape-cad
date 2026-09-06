// reSHape Script -- the scripting side of the B-rep build. See
// .gauntlet/SPEC-reshape-script.md for the language this file implements.
//
// THE ONE IDEA (repeated from the spec, because it is the whole design): a
// reSHape script is the Build timeline written down. Every call below appends
// one step to the same ModelDoc the Build tools produce (lib/model-types.ts),
// using the SAME `new*` constructors and the SAME `nextId()` sequence a mouse
// click would use, so a script and a sequence of toolbar clicks that "mean
// the same thing" produce byte-comparable docs. There is no second geometry
// representation here -- runScript() never touches a kernel, never emits
// JSCAD or OpenCascade calls, and never draws anything. It only builds a
// ModelDoc and a parameter list; lib/occt-build.ts is what turns that into a
// solid, exactly as it already does for a doc the mouse built.
//
// WHY new Function() AND NOT eval(). Two reasons, both load-bearing. First,
// this file has to run identically in two hosts: a plain Node process
// (scripts/test-reshape-script.mjs, no DOM) and a sandboxed iframe compiled
// through scripts/build-brep-kernel.mjs (public/reshape/script-runner.html).
// eval() inside a module (this file compiles to one) is always the "indirect
// eval" form when called as `(0, eval)(...)`, or inherits strict mode from
// its caller otherwise -- new Function() sidesteps that ambiguity by always
// producing an ordinary, non-strict function body, matching the JSCAD runners'
// choice of a real <script> tag for the same reason (see runner.html's own
// comment on this). Second, a Function body appended with a `//# sourceURL=`
// comment gets its OWN name in a stack trace in both V8-based hosts (Node and
// Chromium), which is what makes error line numbers possible below without a
// parser of our own -- see lineOf().
//
// THE LINE-NUMBER OFFSET IS MEASURED, NOT ASSUMED. `new Function(a, b, body)`
// synthesizes `function anonymous(a,b\n) {\n<body>\n}`, so V8 reports every
// line inside <body> two lines higher than it actually sits. Measured
// directly against this exact construction (see the shell session that
// produced this file): a `throw` on body line 3 is reported at line 5,
// regardless of how many parameter names are passed. LINE_OFFSET encodes that
// gap in one place rather than as a magic number wherever a stack is parsed.

import {
  type Feature,
  type ModelDoc,
  type Vec3,
  type Axis3,
  type SketchPlane,
  type ShapeKind,
  type BoxFeature,
  type CylinderFeature,
  type ConeFeature,
  type TorusFeature,
  type SphereFeature,
  type SketchFeature,
  type SketchConstraint,
  type FilletFeature,
  type DraftFeature,
  type ShellFeature,
  nextId,
  newShape,
  newHole,
  newHoleCorners,
  newShell,
  newMove,
  newPattern,
  newSketch,
  RECTANGLE_CONSTRAINTS,
  newExtrude,
  newRevolve,
  newMirror,
  newBlend,
  extentAlong,
  isRoundable,
  canRotate,
  whyCannotRound,
  whyCannotOrbit,
} from './model-types.js';
import { generatedParams, applyParam, pname } from './model-codegen.js';
// addConstraintSettling is the SAME beginner-friendly settle a click on the
// Rules panel runs through (components/model/SketchConstraints.tsx's own
// settle()) -- reused rather than re-derived, so a script call and a click
// that "mean the same thing" leave the sketch in the identical state: an
// older rule quietly dropped when that resolves a fresh conflict, or the new
// rule left in place, fighting, when it does not -- see SPEC-d2-rules-in-script.md.
// `describe` is aliased -- this file already has its own local `describe()`
// for error messages (line 296), unrelated to sketch-solve.ts's constraint-
// naming one ("edge 1 = edge 2").
import {
  addConstraintSettling,
  seedForNewRule,
  solveSketch,
  collapsedByRatio,
  describe as describeConstraint,
} from '@shuff57/reshape-sketch/sketch-solve';
import type { TopoName } from './topo-name.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ParamDef {
  name: string;
  caption: string;
  value: number;
  min: number;
  max: number;
  step: number;
}

export interface ScriptError {
  message: string;
  /** 1-based line inside the student's own source, or null when no line
   *  could be recovered (a bare SyntaxError has no useful stack -- see
   *  lineOf()'s own comment). */
  line: number | null;
}

/**
 * A param() the script named, alongside every doc slot (pname() keys) its
 * value fed -- what toScript(doc, namedParams) needs to regenerate
 * `const wall = param('wall', 2, { min: 0.5, max: 10 })` once and reference
 * the same variable at every place it was used, instead of the name and
 * bounds being lost to a literal the moment the doc round-trips through
 * Build (see reshape-script-gen.ts's own header). `slots` is USUALLY one
 * entry (the common `hollow(b, { wall })` case); it can be more than one if
 * the same variable is read into more than one call (`const s = param(...);
 * box(s, s, s)`), in which case every slot gets the same substitution, even
 * though today's per-slot Dimensions panel still shows one row per slot --
 * see the file-level design-decision note at the bottom of this file.
 */
export interface NamedParamDef extends ParamDef {
  slots: string[];
}

export interface RunResult {
  doc: ModelDoc;
  /** Panel-facing, keyed the same way generatedParams() already keys a
   *  Build-mode slider (`pname(featureId, slot)`) -- unchanged shape from
   *  before NamedParamDef existed, so nothing that already reads this array
   *  needs to change. */
  params: ParamDef[];
  /** Every param() the script declared, keyed by ITS OWN name -- see
   *  NamedParamDef's own comment. Empty when the script named nothing. */
  namedParams: NamedParamDef[];
  errors: ScriptError[];
  /**
   * A rule call (.equal(), .pin(), ...) that never halts the script -- see
   * applyConstraint()'s own comment. Populated only when a freshly-added
   * sketch rule could not be cleanly settled by dropping one older rule and
   * is left in the constraint list still fighting, same as a live Rules
   * panel conflict. Empty on every script that never touches a rule, or
   * whose rules all settle. Optional so nothing that destructures RunResult
   * before this field existed has to change.
   */
  warnings?: string[];
}

/**
 * Every top-level name a reSHape script can call, in the exact order
 * runScript() installs them -- the single source of truth for "what is the
 * DSL", read by scripts/test-reshape-docs.mjs's COVERAGE and DRIFT groups so
 * they measure documentation coverage against what this file actually
 * implements rather than a hand-maintained list that can fall out of step
 * with it. `runScript()`'s own `globals` object below is built FROM this
 * array (`Object.fromEntries(VOCABULARY.map(...))`) rather than the other
 * way around, so the two cannot drift apart.
 */
export const VOCABULARY = [
  'box', 'cylinder', 'sphere', 'cone', 'ring',
  'hole', 'holes', 'hollow', 'round', 'bevel', 'repeat', 'repeatAround', 'mirror', 'move', 'turn',
  'join', 'cut', 'keep', 'draft',
  'sketch', 'pull', 'spin', 'blend',
  'param',
] as const;

export interface RunOptions {
  /** Values keyed exactly like generatedParams()'s own `name` field
   *  (`${featureId}_${slot}`, see pname() in lib/model-codegen.ts) -- the
   *  SAME key a Build-mode slider drag already uses. Applied with
   *  applyParam() after the script has built its doc from its own literal
   *  defaults; a script's own control flow (an `if` gated on a param())
   *  therefore still runs the branch its LITERAL default picked, even while
   *  a drag is live. That is a real, deliberate simplification over "re-run
   *  the whole script with the value substituted in", which would let a
   *  dragged param() reshape which STEPS exist, not just their numbers --
   *  see the file-level design-decision note at the bottom of this file. */
  values?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Error line recovery
// ---------------------------------------------------------------------------

const SOURCE_NAME = 'reshape-user-script.js';
// See the file header: measured against `new Function(...)` on this exact
// engine family (V8 -- Node and Chromium both), not derived from a spec.
const LINE_OFFSET = 2;

function lineOf(err: unknown): number | null {
  const stack = err instanceof Error ? err.stack : undefined;
  if (!stack) return null;
  const rx = new RegExp(SOURCE_NAME.replace(/\./g, '\\.') + ':(\\d+):(\\d+)');
  const m = rx.exec(stack);
  if (!m) return null;
  const line = parseInt(m[1], 10) - LINE_OFFSET;
  return line > 0 ? line : null;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Classic edit distance -- insert, delete, substitute, each cost 1. Used
 *  only to find the closest VOCABULARY word to a name a script misspelled;
 *  nothing here needs to be fast, a script's undefined names are typed by
 *  hand and there are at most 24 candidates to compare against. */
function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) d[i][0] = i;
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      d[i][j] = a[i - 1] === b[j - 1]
        ? d[i - 1][j - 1]
        : 1 + Math.min(d[i - 1][j - 1], d[i - 1][j], d[i][j - 1]);
    }
  }
  return d[a.length][b.length];
}

/**
 * Beginner-lens finding, 2026-09-04: a misspelled call (`boxx(10)`) surfaced
 * the raw engine message -- "boxx is not defined" -- which is true and
 * useless to someone who has never heard the word "defined" used that way.
 * A ReferenceError of exactly that shape gets rewritten in the house voice,
 * naming the nearest word in VOCABULARY by edit distance: there are only 24
 * candidates, so "nearest" is always cheap and, for an actual typo, always
 * the right one. Every OTHER error (a validation throw, a plain JS bug in
 * the student's own logic) passes through messageOf() unchanged -- this
 * rewrite is narrowly scoped to the one error shape a name that does not
 * exist produces.
 *
 * A misspelling FAR from every real name (a genuine undeclared variable, not
 * a typo of a tool) drops the "Did you mean" half rather than guessing --
 * offering `box()` for `totallyUnrelatedName` would be a worse answer than no
 * answer. "Far" is edit distance beyond half the name's own length (floored
 * at 2, so a short name like "abc" still gets a real cutoff rather than
 * "distance > 1.5" rounding away to nothing) -- generous enough that any
 * plausible one- or two-letter typo of a 3-24-letter word still qualifies,
 * and tight enough that an unrelated word does not.
 */
function friendlyMessage(err: unknown): string {
  if (err instanceof ReferenceError) {
    const m = /^([A-Za-z_$][\w$]*) is not defined$/.exec(err.message);
    if (m) {
      const name = m[1];
      let nearest: string = VOCABULARY[0];
      let best = Infinity;
      for (const word of VOCABULARY) {
        const d = levenshtein(name, word);
        if (d < best) { best = d; nearest = word; }
      }
      const closeEnough = best <= Math.max(2, Math.ceil(name.length / 2));
      return closeEnough
        ? `${name} is not a tool here. Did you mean ${nearest}()?`
        : `${name} is not a tool here.`;
    }
  }
  return messageOf(err);
}

// ---------------------------------------------------------------------------
// Boxed numbers -- how a named param() correlates to the doc slot it lands in
// ---------------------------------------------------------------------------

/**
 * What param() returns. A subclass of Number rather than a bare number so it
 * keeps working as a number everywhere ordinary JavaScript expects one --
 * arithmetic, comparisons, template strings, Math.*, .toFixed() -- while
 * still carrying which name produced it. Every place a DSL function reads a
 * numeric argument unwraps through num()/unwrap() below, which also
 * RECORDS the correlation (this value's name -> the exact doc slot it is
 * about to fill) so the final params list can caption that slot with the
 * student's own name instead of the Build tool's automatic one -- see
 * PARAMS ASSEMBLY at the bottom of runScript().
 */
class ParamNumber extends Number {
  constructor(v: number, public readonly paramName: string) {
    super(v);
  }
}

function paramNameOf(v: unknown): string | null {
  return v instanceof ParamNumber ? v.paramName : null;
}

function unwrap(v: unknown): number {
  return v instanceof ParamNumber ? v.valueOf() : (v as number);
}

// ---------------------------------------------------------------------------
// Validation, in the old JSCAD sugar layer's own voice (plain-English
// sentence, names the thing that is wrong, never a stack trace) -- matching
// the house style its requireNumbers()/readOptions() guards used, in the
// now-deleted public/reshape/reshape.js. Not literally shared code even
// then: those guards duck-typed a JSCAD geometry object, which does not
// exist on this path at all (runScript never builds one), so a fresh,
// smaller pair of guards is honest about what this layer actually has to
// tell apart -- a number (boxed or not), a plain { } options object, and
// everything else.
// ---------------------------------------------------------------------------

function isFiniteNumber(v: unknown): boolean {
  if (v instanceof ParamNumber) return Number.isFinite(v.valueOf());
  return typeof v === 'number' && Number.isFinite(v);
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'nothing';
  if (typeof v === 'string') return `the text "${v}"`;
  if (typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `a list of ${v.length}`;
  if (isTopoRef(v)) return v.name.cause === 'between' ? 'an edge' : 'a face';
  if (isHandle(v)) return `a ${v.kind} from earlier in the script`;
  if (typeof v === 'object') return 'a { } object';
  if (typeof v === 'function') return 'a function';
  return String(v);
}

function requiredNumber(fn: string, label: string, v: unknown): number {
  if (v === undefined) {
    throw new Error(`${fn} needs a number for ${label}.`);
  }
  if (!isFiniteNumber(v)) {
    throw new Error(`${fn}'s ${label} has to be a number, and you gave it ${describe(v)}.`);
  }
  return v as number; // caller unwraps via num() where the slot matters
}

function optionalNumber(fn: string, label: string, v: unknown): number | undefined {
  if (v === undefined) return undefined;
  if (!isFiniteNumber(v)) {
    throw new Error(`${fn}'s ${label} has to be a number, and you gave it ${describe(v)}.`);
  }
  return v as number;
}

/**
 * A dimension that has to be MORE than zero -- a size, a diameter, a wall
 * thickness, a pocket depth. Silently building a 10 mm box from
 * `box(-10, -10, -10)` (measured 2026-09-04: the advanced student lens found
 * this on the first pass) is the same class of defect whyCannotRound() and
 * its siblings exist to close elsewhere in this app -- a control that
 * quietly does something other than what was asked, with nothing on screen
 * saying so. `${fn}():` (with the parens) is a deliberately different
 * template from the `${fn}'s ${label}` one requiredNumber() uses -- this is
 * a distinct failure ("the number means something impossible"), not "not a
 * number at all", and the two should never read as the same sentence
 * reworded.
 */
function positiveNumber(fn: string, label: string, v: unknown): number {
  const n = requiredNumber(fn, label, v);
  const val = unwrap(n);
  if (!(val > 0)) {
    throw new Error(`${fn}(): a size has to be a positive number -- got ${val} for ${label}.`);
  }
  return n; // still possibly boxed -- caller unwraps (and correlates) via num()
}

/**
 * A count of copies -- repeat()/repeatAround(). Has to be a whole number of
 * at least one; refused rather than silently rounded or clamped, the same
 * stance positiveNumber() takes on a bad size.
 */
function wholeNumberAtLeastOne(fn: string, label: string, v: unknown): number {
  const n = requiredNumber(fn, label, v);
  const val = unwrap(n);
  if (!(val >= 1) || !Number.isInteger(val)) {
    throw new Error(`${fn}(): ${label} has to be a whole number of at least 1 -- got ${val}.`);
  }
  return n;
}

/**
 * A rule call's edge or corner number -- the Rules panel's own 1-based
 * numbering (edgeCorners()/the panel's row index + 1), bounded to the
 * sketch's actual edge count so `sk.across(9)` on a rectangle is refused
 * the same way an out-of-range param() slot would be, rather than handed to
 * the solver as a silently-wrapped index. Returns the 0-based design index
 * sketch-solve.ts's Constraint shape stores.
 */
function wholeIndex(fn: string, label: string, v: unknown, count: number): number {
  const n = requiredNumber(fn, label, v);
  const val = unwrap(n);
  if (!Number.isInteger(val) || val < 1 || val > count) {
    throw new Error(`${fn}'s ${label} has to be a whole number from 1 to ${count} -- you gave it ${val}.`);
  }
  return val - 1;
}

function isPlainOptions(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Number) && !isTopoRef(v) && !isHandle(v);
}

function readOptions(fn: string, allowed: string[], given: unknown): Record<string, unknown> {
  if (given === undefined) return {};
  if (!isPlainOptions(given)) {
    throw new Error(
      `${fn}'s extras go in a { } object at the end, like ${fn}(..., { ${allowed[0]}: ... }). ` +
        `You gave it ${describe(given)}.`
    );
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(given)) {
    if (!allowed.includes(key)) {
      throw new Error(`${fn} has no option called "${key}". It takes ${allowed.join(', ')}.`);
    }
    out[key] = given[key];
  }
  return out;
}

function readVec3(fn: string, label: string, v: unknown): Vec3 {
  if (!Array.isArray(v) || v.length !== 3) {
    throw new Error(`${fn}'s ${label} needs three numbers, like [x, y, z]. You gave it ${describe(v)}.`);
  }
  return [
    requiredNumber(fn, `${label} x`, v[0]) as number,
    requiredNumber(fn, `${label} y`, v[1]) as number,
    requiredNumber(fn, `${label} z`, v[2]) as number,
  ];
}

function readVec2(fn: string, label: string, v: unknown): [number, number] {
  if (!Array.isArray(v) || v.length !== 2) {
    throw new Error(`${fn}'s ${label} needs two numbers, like [across, up]. You gave it ${describe(v)}.`);
  }
  return [
    requiredNumber(fn, `${label} 1`, v[0]) as number,
    requiredNumber(fn, `${label} 2`, v[1]) as number,
  ];
}

// ---------------------------------------------------------------------------
// Face and edge words -- see the spec's "Names" section. The six axis-aligned
// words are the same ones namePrimitiveFace() in lib/topo-resolve.ts already
// answers to; 'side' is the seventh, a cylinder's curved wall only.
// ---------------------------------------------------------------------------

export type FaceWord = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'side';

const FACE_PARTS: Record<string, string> = {
  top: '+z',
  bottom: '-z',
  front: '-y',
  back: '+y',
  left: '-x',
  right: '+x',
};

/** Which axis a face word's normal runs along -- used to pick draft's pull
 *  axis from a 'from' word, and to pick a hole's in-plane offset axes. */
const FACE_AXIS: Record<string, Axis3> = {
  top: 'z', bottom: 'z', front: 'y', back: 'y', left: 'x', right: 'x',
};

function facePart(fn: string, word: unknown, allowSide: boolean): string {
  if (typeof word !== 'string') {
    throw new Error(`${fn} needs a face word (top, bottom, front, back, left, right${allowSide ? ', or side' : ''}), and you gave it ${describe(word)}.`);
  }
  if (word === 'side') {
    if (!allowSide) throw new Error(`${fn}: "side" is the curved wall of a cylinder, not a flat face here.`);
    return 'side';
  }
  const part = FACE_PARTS[word];
  if (!part) {
    throw new Error(
      `${fn} does not know the face "${word}". Faces are named top, bottom, front, back, left, right` +
        (allowSide ? ', or side (a cylinder\'s curved wall)' : '') + '.'
    );
  }
  return part;
}

// ---------------------------------------------------------------------------
// Handles -- what every DSL call passes around. A solid handle tracks TWO
// ids on purpose: `rootId` never changes (it is the primitive .face()/.edge()
// names are rooted at, matching how lib/topo-name.ts's 'primitive' cause
// always keeps the ORIGINAL feature's id even after later steps replace it
// in the model), while `id` is mutated by every step that CONSUMES its
// target (hole, hollow, round, bevel, repeat, repeatAround, move without
// copy) so the next call chained off the same variable acts on the right
// row -- exactly the way clicking Hole and then Round on the SAME shape in
// the timeline acts on the row Hole just produced, not the box underneath it.
// ---------------------------------------------------------------------------

export interface SolidHandle {
  readonly __reshapeHandle: true;
  id: string;
  readonly rootId: string;
  readonly rootKind: 'box' | 'cylinder' | 'other';
  kind: Feature['kind'];
  face(word: FaceWord): TopoRef;
  edge(a: FaceWord, b: FaceWord): TopoRef;
}

/** A .face()/.edge() result. Carries the owning handle alongside the name so
 *  round()/bevel()/draft() can read (and mutate) the shape the name belongs
 *  to, not just the name itself -- see FilletFeature's own doc comment on why
 *  `target` and `edge`'s root can be different features. */
export interface TopoRef {
  readonly __reshapeTopoRef: true;
  owner: SolidHandle;
  name: TopoName;
}

export interface SketchHandle {
  readonly __reshapeSketch: true;
  id: string;
  rect(w: unknown, h: unknown, opts?: unknown): SketchHandle;
  circle(d: unknown, opts?: unknown): SketchHandle;
  polygon(points: unknown): SketchHandle;
  round(corner: unknown, radius: unknown): SketchHandle;
  chamfer(corner: unknown, distance: unknown): SketchHandle;
  // The Rules panel, one call per row -- SketchConstraints.tsx's own words
  // (its "Across"/"Up" columns, its pair grid's "equal"/"parallel"/
  // "perpendicular" labels, its "Pin a corner" row), not a renamed synonym.
  // Edge and corner numbers are 1-based, the same numbers the panel shows.
  across(edge: unknown): SketchHandle;
  up(edge: unknown): SketchHandle;
  length(edge: unknown, value: unknown): SketchHandle;
  equal(edge: unknown, other: unknown): SketchHandle;
  parallel(edge: unknown, other: unknown): SketchHandle;
  perpendicular(edge: unknown, other: unknown): SketchHandle;
  pin(corner: unknown): SketchHandle;
}

function isHandle(v: unknown): v is SolidHandle {
  return !!v && typeof v === 'object' && (v as { __reshapeHandle?: true }).__reshapeHandle === true;
}
function isTopoRef(v: unknown): v is TopoRef {
  return !!v && typeof v === 'object' && (v as { __reshapeTopoRef?: true }).__reshapeTopoRef === true;
}
function isSketchHandle(v: unknown): v is SketchHandle {
  return !!v && typeof v === 'object' && (v as { __reshapeSketch?: true }).__reshapeSketch === true;
}

function rootKindOf(kind: Feature['kind']): 'box' | 'cylinder' | 'other' {
  return kind === 'box' ? 'box' : kind === 'cylinder' ? 'cylinder' : 'other';
}

// ---------------------------------------------------------------------------
// The interpreter itself
// ---------------------------------------------------------------------------

export function runScript(source: string, opts: RunOptions = {}): RunResult {
  let features: Feature[] = [];
  const namedParams = new Map<string, ParamDef>();
  // pname(id, slot) -> the param() name whose caption/bounds should win over
  // the Build tool's automatic one for that slot. See num()'s own comment.
  const slotOverrides = new Map<string, string>();
  const usedParamNames = new Set<string>();
  // See applyConstraint()'s own comment and RunResult.warnings.
  const ruleWarnings: string[] = [];

  const docNow = (): ModelDoc => ({ version: 1, features });

  /** Unwrap a possibly-boxed number, recording which slot it landed in so the
   *  final params list can caption that slot with the student's own name
   *  instead of the doc's automatic one -- see PARAMS ASSEMBLY below. Call
   *  this exactly where a value is about to be written into a Feature field,
   *  never earlier (an intermediate expression like `wall * 2` unwraps on
   *  its own through Number's arithmetic coercion and loses the tag, which
   *  is expected: the caption follows the NAMED value, not everything
   *  downstream of it). */
  function num(v: unknown, id: string, slot: string): number {
    const name = paramNameOf(v);
    if (name) slotOverrides.set(pname(id, slot), name);
    return unwrap(v);
  }

  function pushFeature(f: Feature): Feature {
    features = [...features, f];
    return f;
  }

  function replaceFeature(id: string, next: Feature) {
    features = features.map((f) => (f.id === id ? next : f));
  }

  function findFeature(id: string): Feature {
    const f = features.find((x) => x.id === id);
    if (!f) throw new Error(`internal: feature "${id}" is missing from the document.`);
    return f;
  }

  function makeSolidHandle(f: Feature, rootId = f.id): SolidHandle {
    const handle: SolidHandle = {
      __reshapeHandle: true,
      id: f.id,
      rootId,
      rootKind: rootKindOf(findFeature(rootId).kind),
      kind: f.kind,
      face(word: FaceWord): TopoRef {
        const allowSide = handle.rootKind === 'cylinder';
        const part = facePart('.face()', word, allowSide);
        return {
          __reshapeTopoRef: true,
          owner: handle,
          name: { cause: 'primitive', feature: handle.rootId, kind: 'face', part },
        };
      },
      edge(a: FaceWord, b: FaceWord): TopoRef {
        const allowSide = handle.rootKind === 'cylinder';
        const pa = facePart('.edge()', a, allowSide);
        const pb = facePart('.edge()', b, allowSide);
        if (pa === pb) throw new Error('.edge() needs two DIFFERENT faces to name the edge between them.');
        return {
          __reshapeTopoRef: true,
          owner: handle,
          name: {
            cause: 'between',
            feature: handle.rootId,
            kind: 'edge',
            of: [
              { cause: 'primitive', feature: handle.rootId, kind: 'face', part: pa },
              { cause: 'primitive', feature: handle.rootId, kind: 'face', part: pb },
            ],
          },
        };
      },
    };
    return handle;
  }

  function mutateHandle(handle: SolidHandle, next: Feature) {
    handle.id = next.id;
    handle.kind = next.kind;
  }

  // ---- shapes ---------------------------------------------------------

  function placePrimitive(
    fn: string,
    kind: ShapeKind,
    argNames: string[],
    args: unknown[],
    opts: unknown,
    setDims: (f: Feature, id: string) => void
  ): SolidHandle {
    for (let i = 0; i < argNames.length; i++) positiveNumber(fn, argNames[i], args[i]);
    const allowCorner = kind === 'box' || kind === 'cylinder';
    const extra = readOptions(fn, allowCorner ? ['at', 'corner'] : ['at'], opts);
    const base = newShape(docNow(), kind);
    const id = base.id;
    setDims(base, id);
    if (extra.at !== undefined) {
      const at = readVec3(fn, 'at', extra.at);
      (base as { center: Vec3 }).center = [
        num(at[0], id, 'x'),
        num(at[1], id, 'y'),
        num(at[2], id, 'z'),
      ];
    }
    if (allowCorner && extra.corner !== undefined) {
      const c = positiveNumber(fn, 'corner', extra.corner);
      (base as BoxFeature | CylinderFeature).round = num(c, id, 'round');
    }
    pushFeature(base);
    return makeSolidHandle(base);
  }

  function box(w: unknown, d: unknown, h: unknown, opts?: unknown): SolidHandle {
    return placePrimitive('box', 'box', ['width', 'depth', 'height'], [w, d, h], opts, (f, id) => {
      (f as BoxFeature).size = [num(w, id, 'width'), num(d, id, 'depth'), num(h, id, 'height')];
    });
  }

  function cylinder(across: unknown, tall: unknown, opts?: unknown): SolidHandle {
    return placePrimitive('cylinder', 'cylinder', ['across', 'tall'], [across, tall], opts, (f, id) => {
      const cf = f as CylinderFeature;
      cf.radius = num(across, id, 'radius') / 2;
      cf.height = num(tall, id, 'height');
    });
  }

  function sphere(across: unknown, opts?: unknown): SolidHandle {
    return placePrimitive('sphere', 'sphere', ['across'], [across], opts, (f, id) => {
      (f as SphereFeature).radius = num(across, id, 'radius') / 2;
    });
  }

  // cone(across, tall) -- TWO arguments, not the spec's three. ConeFeature
  // (lib/model-types.ts) carries exactly one radius: newShape('cone') and
  // the kernel's coneOf() (lib/occt-build.ts) both build a pointed cone with
  // no way to store a flat top radius at all, so the spec's
  // `cone(across, acrossTop, tall)` frustum form has nothing to write its
  // middle argument into. Implemented against what the Build tool
  // actually produces rather than inventing a doc field the rest of the app
  // does not read -- flagged in the build report as a deviation from the
  // spec text, not silently narrowed.
  function cone(across: unknown, tall: unknown, opts?: unknown): SolidHandle {
    return placePrimitive('cone', 'cone', ['across', 'tall'], [across, tall], opts, (f, id) => {
      const cf = f as ConeFeature;
      cf.radius = num(across, id, 'radius') / 2;
      cf.height = num(tall, id, 'height');
    });
  }

  // ring(across, tubeAcross) -> ringRadius/tubeRadius. The formula is the one
  // public/reshape/reshape.js's own header spells out for `ring`: ringRadius
  // is (across - thick) / 2, not "across / 2" -- across is the OUTSIDE
  // diameter of the whole donut, not the centreline the kernel's torus() call
  // actually takes.
  function ring(across: unknown, tubeAcross: unknown, opts?: unknown): SolidHandle {
    return placePrimitive('ring', 'torus', ['across', 'tubeAcross'], [across, tubeAcross], opts, (f, id) => {
      const tf = f as TorusFeature;
      // Neither raw argument is stored verbatim (ringRadius/tubeRadius are
      // both derived), so a named param() on either one is left uncorrelated
      // here -- unwrap() only, not num() -- rather than mislabel a slot with
      // bounds computed from the wrong number. See ring()'s own comment.
      const a = unwrap(across);
      const t = unwrap(tubeAcross);
      tf.tubeRadius = t / 2;
      tf.ringRadius = (a - t) / 2;
    });
  }

  // ---- sketches ---------------------------------------------------------

  const PLANE_WORD: Record<string, SketchPlane> = { top: 'xy', front: 'xz', side: 'yz' };

  function sketch(planeWord: unknown, offset?: unknown): SketchHandle {
    if (typeof planeWord !== 'string' || !(planeWord in PLANE_WORD)) {
      throw new Error(`sketch() needs a plane word: 'top', 'front' or 'side'. You gave it ${describe(planeWord)}.`);
    }
    const plane = PLANE_WORD[planeWord];
    const f = newSketch(docNow(), plane);
    if (offset !== undefined) f.offset = num(requiredNumber('sketch', 'offset', offset), f.id, 'offset');
    pushFeature(f);
    return makeSketchHandle(f.id);
  }

  /** True when a and b are the same rule on the same edge(s)/corner --
   *  used to make a rule call idempotent (calling across() a second time
   *  is a no-op, not a toggle-off: a script re-run has to land on the same
   *  doc every time, which a click-driven toggle cannot promise). */
  function sameConstraint(a: SketchConstraint, b: SketchConstraint): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'lock' && b.kind === 'lock') return a.corner === b.corner;
    if (a.kind === 'length' && b.kind === 'length') return a.edge === b.edge && a.value === b.value;
    if ((a.kind === 'horizontal' || a.kind === 'vertical') && 'edge' in b) return a.edge === b.edge;
    if ('other' in a && 'other' in b) return a.edge === b.edge && a.other === b.other;
    return false;
  }

  /** Is c a pair rule (equal/parallel/perpendicular) already sitting on
   *  this exact pair of edges, regardless of which of the three it is? Used
   *  to replace rather than stack -- SketchConstraints.tsx's cyclePair() only
   *  ever keeps one pair rule per pair, and a script call means the same
   *  thing a click through that grid does. */
  function isPairOn(c: SketchConstraint, edge: number, other: number): boolean {
    return (c.kind === 'equal' || c.kind === 'parallel' || c.kind === 'perpendicular')
      && c.edge === edge && c.other === other;
  }

  /**
   * Adds one rule to sketch sketchId, through the exact settling path the
   * live Rules panel uses (addConstraintSettling) -- so a fresh conflict
   * resolves itself by dropping an older rule when that fixes it, and is
   * left in the constraint list, fighting, when it does not. Either way the
   * result is written straight into the feature's constraints, same as
   * SketchConstraints.tsx's own settle(); the POINTS are left for whatever
   * already re-solves a doc on adoption (lib/model-codegen.ts's solveDoc) --
   * this function only ever changes which rules apply, never the geometry.
   *
   * NEVER throws for a rule that simply cannot hold. That is a refusal a
   * beginner asked for on purpose (equal/parallel/perpendicular/length can
   * always disagree with an earlier rule), not a mistake in the call itself
   * -- so the script keeps going, exactly like every other kernel-level
   * refusal this file's own docs describe, and the sketch is left fighting
   * for the Rules panel to show the moment you look at it, the same as a
   * click would. RunResult.warnings carries the house sentence for a caller
   * that never opens Build to look.
   */
  function applyConstraint(sketchId: string, added: SketchConstraint) {
    const cur = findFeature(sketchId) as SketchFeature;
    const existing = cur.constraints ?? [];
    if (existing.some((c) => sameConstraint(c, added))) return; // idempotent
    let base = existing;
    if (added.kind === 'horizontal' || added.kind === 'vertical') {
      // Across and Up on one edge is a contradiction, not a stack -- same
      // cleanup toggle() does before settling a fresh horizontal/vertical.
      const opposite = added.kind === 'horizontal' ? 'vertical' : 'horizontal';
      base = base.filter((c) => !(c.kind === opposite && 'edge' in c && c.edge === added.edge));
    } else if (added.kind === 'equal' || added.kind === 'parallel' || added.kind === 'perpendicular') {
      base = base.filter((c) => !isPairOn(c, added.edge, added.other));
    }
    const next = [...base, added];
    const points = cur.points.map((p): [number, number] => [p[0], p[1]]);
    const result = addConstraintSettling(points, next);
    replaceFeature(sketchId, { ...cur, constraints: result.constraints });
    // result.removed === null covers TWO cases: the rule fit cleanly (fine,
    // nothing to say), or nothing removed made it fit (genuinely fighting).
    // Tell them apart the same way addConstraintSettling's own isBad() does,
    // rather than trusting removed === null to mean either on its own.
    if (result.removed === null) {
      const seed = seedForNewRule(points, result.constraints);
      const solved = solveSketch(seed, result.constraints);
      if (solved.overConstrained || collapsedByRatio(points, solved.points)) {
        ruleWarnings.push(
          `${describeConstraint(added)} cannot hold along with the rules already on this sketch -- `
            + `the shape is as close as it can get to all of them. Remove one to settle it.`
        );
      }
    }
  }

  function makeSketchHandle(id: string): SketchHandle {
    const handle: SketchHandle = {
      __reshapeSketch: true,
      id,
      rect(w, h, opts) {
        requiredNumber('.rect()', 'width', w);
        requiredNumber('.rect()', 'height', h);
        const extra = readOptions('.rect()', ['at'], opts);
        const [ax, ay] = extra.at !== undefined ? readVec2('.rect()', 'at', extra.at) : [0, 0];
        const ww = num(w, id, 'width');
        const hh = num(h, id, 'height');
        const points: Array<[number, number]> = [
          [ax - ww / 2, ay - hh / 2],
          [ax + ww / 2, ay - hh / 2],
          [ax + ww / 2, ay + hh / 2],
          [ax - ww / 2, ay + hh / 2],
        ];
        const cur = findFeature(id) as SketchFeature;
        // Same rules a Rectangle-tool sketch is born with (lib/model-types.ts
        // RECTANGLE_CONSTRAINTS) -- set explicitly here rather than relying
        // on `cur` already carrying them (it does, from sketch()'s own
        // newSketch() call, but that inheritance breaks the moment .rect()
        // follows a .polygon() or .circle() on the same handle).
        replaceFeature(id, {
          ...cur, points, shape: undefined, rounds: undefined, chamfers: undefined, bulges: undefined,
          constraints: RECTANGLE_CONSTRAINTS.slice(),
        });
        return handle;
      },
      circle(d, opts) {
        requiredNumber('.circle()', 'across', d);
        const extra = readOptions('.circle()', ['at'], opts);
        const [ax, ay] = extra.at !== undefined ? readVec2('.circle()', 'at', extra.at) : [0, 0];
        const r = num(d, id, 'across') / 2;
        const cur = findFeature(id) as SketchFeature;
        replaceFeature(id, {
          ...cur,
          points: [[ax - r, ay], [ax + r, ay]],
          shape: 'circle',
          rounds: undefined,
          chamfers: undefined,
          bulges: undefined,
          // newCircleSketch() never carries a rule -- the Rules panel shows
          // only the plane row for a circle (no edges to rule). Explicit,
          // not inherited: `cur` may still be holding the rectangle set from
          // an earlier sketch('top') or .rect() on this same handle, and a
          // circle has no edge 0-3 for those to mean anything about.
          constraints: undefined,
        });
        return handle;
      },
      polygon(pointsArg) {
        if (!Array.isArray(pointsArg) || pointsArg.length < 3) {
          throw new Error(`.polygon() needs a list of at least three [x, y] points. You gave it ${describe(pointsArg)}.`);
        }
        const points: Array<[number, number]> = pointsArg.map((p: unknown, i: number) => {
          if (!Array.isArray(p) || p.length !== 2) {
            throw new Error(`.polygon()'s point ${i + 1} needs two numbers [x, y]. You gave it ${describe(p)}.`);
          }
          return [requiredNumber('.polygon()', `point ${i + 1} x`, p[0]) as number, requiredNumber('.polygon()', `point ${i + 1} y`, p[1]) as number];
        });
        const cur = findFeature(id) as SketchFeature;
        // newPolygonSketch() never carries a rule either, and the rectangle
        // set specifically indexes edges 0-3 -- meaningless, and dangerous
        // (an out-of-range edge index) once the shape has more or fewer
        // sides than that. Explicit clear, same reasoning as .circle()'s own.
        replaceFeature(id, {
          ...cur, points, shape: undefined, rounds: undefined, chamfers: undefined, bulges: undefined,
          constraints: undefined,
        });
        return handle;
      },
      round(corner, radius) {
        const k = requiredNumber('.round()', 'corner', corner) as number;
        const r = requiredNumber('.round()', 'radius', radius);
        const cur = findFeature(id) as SketchFeature;
        const rounds = { ...(cur.rounds ?? {}), [k]: num(r, id, `r${k}`) };
        replaceFeature(id, { ...cur, rounds });
        return handle;
      },
      chamfer(corner, distance) {
        const k = requiredNumber('.chamfer()', 'corner', corner) as number;
        const dist = requiredNumber('.chamfer()', 'distance', distance) as number;
        const cur = findFeature(id) as SketchFeature;
        const chamfers = { ...(cur.chamfers ?? {}), [k]: dist };
        replaceFeature(id, { ...cur, chamfers });
        return handle;
      },
      across(edge) {
        const cur = findFeature(id) as SketchFeature;
        const e = wholeIndex('.across()', 'edge', edge, cur.points.length);
        applyConstraint(id, { kind: 'horizontal', edge: e });
        return handle;
      },
      up(edge) {
        const cur = findFeature(id) as SketchFeature;
        const e = wholeIndex('.up()', 'edge', edge, cur.points.length);
        applyConstraint(id, { kind: 'vertical', edge: e });
        return handle;
      },
      length(edge, value) {
        const cur = findFeature(id) as SketchFeature;
        const e = wholeIndex('.length()', 'edge', edge, cur.points.length);
        const v = positiveNumber('.length()', 'value', value);
        applyConstraint(id, { kind: 'length', edge: e, value: num(v, id, `len${e}`) });
        return handle;
      },
      equal(edge, other) {
        const cur = findFeature(id) as SketchFeature;
        const count = cur.points.length;
        const a = wholeIndex('.equal()', 'edge', edge, count);
        const b = wholeIndex('.equal()', 'other', other, count);
        if (a === b) throw new Error('.equal() needs two DIFFERENT edges.');
        applyConstraint(id, { kind: 'equal', edge: Math.min(a, b), other: Math.max(a, b) });
        return handle;
      },
      parallel(edge, other) {
        const cur = findFeature(id) as SketchFeature;
        const count = cur.points.length;
        const a = wholeIndex('.parallel()', 'edge', edge, count);
        const b = wholeIndex('.parallel()', 'other', other, count);
        if (a === b) throw new Error('.parallel() needs two DIFFERENT edges.');
        applyConstraint(id, { kind: 'parallel', edge: Math.min(a, b), other: Math.max(a, b) });
        return handle;
      },
      perpendicular(edge, other) {
        const cur = findFeature(id) as SketchFeature;
        const count = cur.points.length;
        const a = wholeIndex('.perpendicular()', 'edge', edge, count);
        const b = wholeIndex('.perpendicular()', 'other', other, count);
        if (a === b) throw new Error('.perpendicular() needs two DIFFERENT edges.');
        applyConstraint(id, { kind: 'perpendicular', edge: Math.min(a, b), other: Math.max(a, b) });
        return handle;
      },
      pin(corner) {
        const cur = findFeature(id) as SketchFeature;
        const c = wholeIndex('.pin()', 'corner', corner, cur.points.length);
        applyConstraint(id, { kind: 'lock', corner: c });
        return handle;
      },
    };
    return handle;
  }

  function pull(sk: unknown, height: unknown): SolidHandle {
    if (!isSketchHandle(sk)) throw new Error(`pull() needs a sketch: pull(sketch('top'), height).`);
    requiredNumber('pull', 'height', height);
    const f = newExtrude(docNow(), sk.id);
    f.height = num(height, f.id, 'height');
    pushFeature(f);
    return makeSolidHandle(f);
  }

  function spin(sk: unknown, angle: unknown): SolidHandle {
    if (!isSketchHandle(sk)) throw new Error(`spin() needs a sketch: spin(sketch('top'), angle).`);
    requiredNumber('spin', 'angle', angle);
    const f = newRevolve(docNow(), sk.id);
    f.angle = num(angle, f.id, 'angle');
    pushFeature(f);
    return makeSolidHandle(f);
  }

  // blend(a, b, gap): BlendFeature takes no numbers of its own -- the gap
  // between the two sketches IS the difference in their own offsets (see
  // BlendFeature's doc comment in lib/model-types.ts) -- so the script's
  // third argument sets sk2's offset to sk1's offset + gap rather than being
  // stored anywhere new. toScript() reverses this by emitting the CURRENT
  // difference, so the two are exact inverses of each other.
  function blend(a: unknown, b: unknown, gap: unknown): SolidHandle {
    if (!isSketchHandle(a) || !isSketchHandle(b)) {
      throw new Error('blend() needs two sketches: blend(sketch1, sketch2, gap).');
    }
    requiredNumber('blend', 'gap', gap);
    const sa = findFeature(a.id) as SketchFeature;
    let sb = findFeature(b.id) as SketchFeature;
    const nextOffset = num(gap, b.id, 'offset') + sa.offset;
    if (sb.offset !== nextOffset) {
      sb = { ...sb, offset: nextOffset };
      replaceFeature(b.id, sb);
    }
    const f = newBlend(docNow(), sa, sb);
    pushFeature(f);
    return makeSolidHandle(f);
  }

  // ---- holes --------------------------------------------------------------

  /** `holeId` -- the hole FEATURE's own id, not the target's -- has to be
   *  known before this runs, because HoleFeature.center is keyed
   *  (pname(holeId, 'x'/'y'/'z'), per generatedParams()'s hole branch in
   *  lib/model-codegen.ts) to the HOLE, not to the shape it drills into.
   *  Correlating a param() here against target.id instead (the bug this
   *  comment replaces, caught while wiring toScript's own {at} substitution
   *  through the same slot names) would silently attach the caption/bounds
   *  to the TARGET's unrelated position slider instead of the hole's. */
  function holeAxisAndCenter(
    fn: string, holeId: string, opts: Record<string, unknown>
  ): { axis: Axis3; center: Vec3 } {
    let axis: Axis3 = 'z';
    if (opts.along !== undefined) {
      if (opts.along !== 'x' && opts.along !== 'y' && opts.along !== 'z') {
        throw new Error(`${fn}'s "along" has to be 'x', 'y' or 'z'. You gave it ${describe(opts.along)}.`);
      }
      axis = opts.along;
    }
    let center: Vec3 = [0, 0, 0];
    if (opts.at !== undefined) {
      const [a, b] = readVec2(fn, 'at', opts.at);
      // The two in-plane axes, in the order a student would read a face:
      // "which two numbers am I not choosing" -- see the file-level design
      // note on this at the bottom of the file.
      if (axis === 'z') center = [num(a, holeId, 'x'), num(b, holeId, 'y'), 0];
      else if (axis === 'y') center = [num(a, holeId, 'x'), 0, num(b, holeId, 'z')];
      else center = [0, num(a, holeId, 'y'), num(b, holeId, 'z')];
    }
    return { axis, center };
  }

  function hole(target: unknown, opts?: unknown): SolidHandle {
    if (!isHandle(target)) throw new Error('hole() needs a shape to drill into: hole(shape, { across: 6 }).');
    const extra = readOptions('hole', ['across', 'deep', 'at', 'along'], opts);
    if (extra.across === undefined) throw new Error('hole() needs { across: <number> } for the bit\'s diameter.');
    const across = positiveNumber('hole', 'across', extra.across);
    const base = newHole(docNow(), target.id);
    const { axis, center } = holeAxisAndCenter('hole', base.id, extra);
    base.axis = axis;
    base.diameter = num(across, base.id, 'diameter');
    if (extra.deep !== undefined) {
      base.depth = num(positiveNumber('hole', 'deep', extra.deep), base.id, 'depth');
    } else {
      const extent = extentAlong(docNow(), target.id, axis);
      base.depth = extent != null ? extent + 2 : 10;
    }
    base.center = center;
    pushFeature(base);
    mutateHandle(target, base);
    return target;
  }

  function holes(target: unknown, opts?: unknown): SolidHandle {
    if (!isHandle(target)) throw new Error('holes() needs a shape to drill into: holes(shape, { across: 6, apart: [15, 10] }).');
    const extra = readOptions('holes', ['across', 'apart', 'at', 'along'], opts);
    if (extra.across === undefined) throw new Error('holes() needs { across: <number> } for the bit\'s diameter.');
    if (extra.apart === undefined) throw new Error('holes() needs { apart: [across, up] } for the corner-to-corner spacing.');
    const across = positiveNumber('holes', 'across', extra.across);
    const [spanX, spanY] = readVec2('holes', 'apart', extra.apart);
    const base = newHoleCorners(docNow(), target.id);
    const { axis, center } = holeAxisAndCenter('holes', base.id, extra);
    base.axis = axis;
    base.diameter = num(across, base.id, 'diameter');
    if (extra.deep !== undefined) {
      base.depth = num(positiveNumber('holes', 'deep', extra.deep), base.id, 'depth');
    } else {
      const extent = extentAlong(docNow(), target.id, axis);
      base.depth = extent != null ? extent + 2 : 10;
    }
    base.center = center;
    base.corners = {
      dx: num(spanX, base.id, 'dx') / 2,
      dy: num(spanY, base.id, 'dy') / 2,
    };
    pushFeature(base);
    mutateHandle(target, base);
    return target;
  }

  // ---- hollow ---------------------------------------------------------------

  function hollow(target: unknown, opts?: unknown): SolidHandle {
    if (!isHandle(target)) throw new Error('hollow() needs a shape: hollow(shape, { wall: 2 }).');
    const extra = readOptions('hollow', ['wall', 'open'], opts);
    if (extra.wall === undefined) throw new Error('hollow() needs { wall: <number> } for the wall thickness.');
    const wall = positiveNumber('hollow', 'wall', extra.wall);
    let open: TopoName | undefined;
    if (extra.open !== undefined) {
      const part = facePart('hollow', extra.open, false);
      open = { cause: 'primitive', feature: target.rootId, kind: 'face', part };
    }
    const base = newShell(docNow(), target.id, open);
    base.thickness = num(wall, base.id, 'thickness');
    pushFeature(base);
    mutateHandle(target, base);
    return target;
  }

  // ---- round / bevel ----------------------------------------------------

  function round(arg: unknown, size: unknown): SolidHandle {
    const s = requiredNumber('round', 'size', size);
    if (isTopoRef(arg)) {
      if (arg.name.cause !== 'between') {
        throw new Error('round() on a single reference needs an edge -- try round(shape.edge(faceA, faceB), size).');
      }
      const owner = arg.owner;
      const id = nextId(docNow(), 'round');
      const f: FilletFeature = { id, kind: 'fillet', target: owner.id, edge: arg.name, size: num(s, id, 'size'), style: 'fillet' };
      pushFeature(f);
      mutateHandle(owner, f);
      return owner;
    }
    if (!isHandle(arg)) throw new Error('round() needs a shape or an edge (shape.edge(a, b)) to round.');
    const f = findFeature(arg.id);
    if (!isRoundable(f)) {
      throw new Error(whyCannotRound(f) ?? 'Rounding does not work on this shape.');
    }
    const next = { ...f, round: num(s, arg.id, 'round'), roundStyle: 'fillet' as const };
    replaceFeature(arg.id, next);
    arg.kind = next.kind;
    return arg;
  }

  function bevel(arg: unknown, size: unknown): SolidHandle {
    if (!isTopoRef(arg) || arg.name.cause !== 'between') {
      throw new Error('bevel() needs one edge -- try bevel(shape.edge(faceA, faceB), size).');
    }
    const s = requiredNumber('bevel', 'size', size);
    const owner = arg.owner;
    const id = nextId(docNow(), 'bevel');
    const f: FilletFeature = { id, kind: 'fillet', target: owner.id, edge: arg.name, size: num(s, id, 'size'), style: 'chamfer' };
    pushFeature(f);
    mutateHandle(owner, f);
    return owner;
  }

  // ---- repeat / repeatAround -------------------------------------------

  function repeat(target: unknown, opts?: unknown): SolidHandle {
    if (!isHandle(target)) throw new Error('repeat() needs a shape: repeat(shape, { count: 3, step: 60 }).');
    const extra = readOptions('repeat', ['count', 'step'], opts);
    if (extra.count === undefined) throw new Error('repeat() needs { count: <number> }.');
    const count = wholeNumberAtLeastOne('repeat', 'count', extra.count);
    const base = newPattern(docNow(), target.id, 'linear');
    base.count = num(count, base.id, 'count');
    if (extra.step !== undefined) {
      if (typeof extra.step === 'number' || extra.step instanceof Number) {
        base.step = [num(extra.step, base.id, 'stepx'), 0, 0];
      } else {
        base.step = readVec3('repeat', 'step', extra.step);
      }
    }
    pushFeature(base);
    mutateHandle(target, base);
    return target;
  }

  function repeatAround(target: unknown, opts?: unknown): SolidHandle {
    if (!isHandle(target)) throw new Error('repeatAround() needs a shape: repeatAround(shape, { count: 6, axis: "z" }).');
    const extra = readOptions('repeatAround', ['count', 'axis', 'angle'], opts);
    if (extra.count === undefined) throw new Error('repeatAround() needs { count: <number> }.');
    const count = wholeNumberAtLeastOne('repeatAround', 'count', extra.count);
    const base = newPattern(docNow(), target.id, 'circular');
    base.count = num(count, base.id, 'count');
    if (extra.axis !== undefined) {
      if (extra.axis !== 'x' && extra.axis !== 'y' && extra.axis !== 'z') {
        throw new Error(`repeatAround()'s "axis" has to be 'x', 'y' or 'z'. You gave it ${describe(extra.axis)}.`);
      }
      base.axis = extra.axis;
    }
    if (extra.angle !== undefined) {
      base.totalAngle = num(requiredNumber('repeatAround', 'angle', extra.angle), base.id, 'totalangle');
    }
    const f = findFeature(target.id);
    const why = whyCannotOrbit(f, base.axis ?? 'z');
    if (why) throw new Error(why);
    pushFeature(base);
    mutateHandle(target, base);
    return target;
  }

  // ---- mirror / move / turn -----------------------------------------------

  const MIRROR_WORD: Record<string, SketchPlane> = {
    'left-right': 'yz',
    'front-back': 'xz',
    'top-bottom': 'xy',
  };

  function mirror(target: unknown, word: unknown): SolidHandle {
    if (!isHandle(target)) throw new Error('mirror() needs a shape: mirror(shape, "left-right").');
    if (typeof word !== 'string' || !(word in MIRROR_WORD)) {
      throw new Error(`mirror() needs 'left-right', 'front-back' or 'top-bottom'. You gave it ${describe(word)}.`);
    }
    const f = newMirror(docNow(), target.id, MIRROR_WORD[word]);
    pushFeature(f);
    return makeSolidHandle(f, target.rootId);
  }

  function move(target: unknown, offset: unknown, opts?: unknown): SolidHandle {
    if (!isHandle(target)) throw new Error('move() needs a shape: move(shape, [x, y, z]).');
    const extra = readOptions('move', ['copy'], opts);
    const copy = extra.copy === true;
    const off = readVec3('move', 'offset', offset);
    const base = newMove(docNow(), target.id, copy);
    base.offset = [num(off[0], base.id, 'x'), num(off[1], base.id, 'y'), num(off[2], base.id, 'z')];
    pushFeature(base);
    if (copy) return makeSolidHandle(base, target.rootId);
    mutateHandle(target, base);
    return target;
  }

  function turn(target: unknown, angles: unknown): SolidHandle {
    if (!isHandle(target)) throw new Error('turn() needs a shape: turn(shape, [rx, ry, rz]).');
    const f = findFeature(target.id);
    if (!canRotate(f)) {
      throw new Error(
        `turn() only works on a shape you built directly with a tool like Box or Cylinder -- ` +
          `not on the result of ${f.kind}.`
      );
    }
    const [rx, ry, rz] = readVec3('turn', 'angles', angles);
    const next = { ...f, rotate: [num(rx, target.id, 'rx'), num(ry, target.id, 'ry'), num(rz, target.id, 'rz')] as Vec3 };
    replaceFeature(target.id, next);
    return target;
  }

  // ---- boolean combine ------------------------------------------------

  function combine(fn: string, op: 'union' | 'subtract' | 'intersect', args: unknown[]): SolidHandle {
    if (args.length < 2 || !args.every(isHandle)) {
      throw new Error(`${fn}() needs two or more shapes: ${fn}(a, b).`);
    }
    const handles = args as SolidHandle[];
    const id = nextId(docNow(), 'op');
    const f: Feature = { id, kind: 'combine', op, targets: handles.map((h) => h.id) };
    pushFeature(f);
    return makeSolidHandle(f);
  }
  const join = (...args: unknown[]) => combine('join', 'union', args);
  const cut = (...args: unknown[]) => combine('cut', 'subtract', args);
  const keep = (...args: unknown[]) => combine('keep', 'intersect', args);

  // ---- draft ------------------------------------------------------------

  /** The bounding extreme of a primitive along one axis, in world units --
   *  used to turn a 'from' word into DraftFeature.neutral. Only answerable
   *  for a plain primitive (same scope extentAlong() already has); anything
   *  else falls back to 0, which draft()'s {neutral} escape hatch exists to
   *  override by hand. */
  function primitiveExtreme(id: string, axis: Axis3, dir: 'lo' | 'hi'): number {
    const f = findFeature(id);
    const half = extentAlong(docNow(), id, axis);
    const center =
      f.kind === 'box' || f.kind === 'cylinder' || f.kind === 'sphere' || f.kind === 'cone' || f.kind === 'torus'
        ? f.center[axis === 'x' ? 0 : axis === 'y' ? 1 : 2]
        : 0;
    if (half == null) return 0;
    return dir === 'lo' ? center - half / 2 : center + half / 2;
  }

  function draft(arg: unknown, angle: unknown, opts?: unknown): SolidHandle {
    const a = requiredNumber('draft', 'angle', angle);
    const extra = readOptions('draft', ['from', 'neutral', 'whole'], opts);
    let owner: SolidHandle;
    let face: TopoName | undefined;
    let whole = false;
    if (isTopoRef(arg)) {
      if (arg.name.cause !== 'primitive') throw new Error('draft() needs a flat face -- try draft(shape.face("right"), angle).');
      owner = arg.owner;
      face = arg.name;
    } else if (isHandle(arg)) {
      owner = arg;
      whole = true;
    } else {
      throw new Error('draft() needs a face (shape.face("right")) or a whole shape to draft: draft(shape, angle, { whole: true }).');
    }
    if (extra.whole === true) whole = true;
    let pull: Axis3 = 'z';
    let neutral = 0;
    if (extra.from !== undefined) {
      if (typeof extra.from !== 'string' || !(extra.from in FACE_AXIS)) {
        throw new Error(`draft()'s "from" needs a face word (top, bottom, front, back, left, right). You gave it ${describe(extra.from)}.`);
      }
      pull = FACE_AXIS[extra.from];
      const dir: 'lo' | 'hi' = extra.from === 'bottom' || extra.from === 'front' || extra.from === 'left' ? 'lo' : 'hi';
      neutral = primitiveExtreme(owner.rootId, pull, dir);
    }
    if (extra.neutral !== undefined) neutral = requiredNumber('draft', 'neutral', extra.neutral) as number;
    const id = nextId(docNow(), 'draft');
    const f: DraftFeature = { id, kind: 'draft', target: owner.id, angle: num(a, id, 'angle'), pull, neutral, whole: whole || undefined };
    if (!whole && face) f.face = face;
    pushFeature(f);
    mutateHandle(owner, f);
    return owner;
  }

  // ---- param() ------------------------------------------------------------

  function param(name: unknown, value: unknown, opts?: unknown): number {
    if (typeof name !== 'string' || !name) {
      throw new Error(`param() needs a name first: param("wall", 2). You gave it ${describe(name)}.`);
    }
    if (usedParamNames.has(name)) {
      throw new Error(`param() already used the name "${name}" earlier in this script. Give each one its own name.`);
    }
    const v = requiredNumber('param', 'value', value) as number;
    const extra = readOptions('param', ['min', 'max', 'step', 'caption'], opts);
    usedParamNames.add(name);
    const min = optionalNumber('param', 'min', extra.min) ?? 0;
    const max = optionalNumber('param', 'max', extra.max) ?? Math.max(100, Math.ceil(Math.abs(v) * 4) || 100);
    const step = optionalNumber('param', 'step', extra.step) ?? 1;
    const caption = typeof extra.caption === 'string' ? extra.caption : name;
    namedParams.set(name, { name, caption, value: v, min, max, step });
    return new ParamNumber(v, name) as unknown as number;
  }

  // ---- run it ---------------------------------------------------------

  // Built FROM VOCABULARY, not the other way around (see that constant's own
  // comment) -- a name added to this local object without adding it there
  // would be a DSL call this file can execute but scripts/test-reshape-docs.mjs
  // has no way to count as implemented, which is exactly the drift that
  // constant exists to close.
  const fns: Record<(typeof VOCABULARY)[number], unknown> = {
    box, cylinder, sphere, cone, ring,
    hole, holes, hollow, round, bevel, repeat, repeatAround, mirror, move, turn,
    join, cut, keep, draft,
    sketch, pull, spin, blend,
    param,
  };
  const globals: Record<string, unknown> = fns;
  const names: string[] = [...VOCABULARY];
  const wrapped = `${source}\n//# sourceURL=${SOURCE_NAME}`;

  // INTENTIONAL new Function(). `source` is a STUDENT PROGRAM, not untrusted
  // input to be sanitized -- running arbitrary student JavaScript is this
  // file's entire job, the same job runner-brep.html already does (and the
  // now-deleted public/reshape/runner.html already did, for the JSCAD path)
  // with a real <script> tag.
  // The safety boundary is where this function is CALLED FROM, not how it
  // evaluates its argument: public/reshape/script-runner.html runs
  // runScript() inside an iframe sandboxed `allow-scripts` WITHOUT
  // `allow-same-origin` (opaque origin, no cookies, no same-origin fetch to
  // /api/*), and lib/reshape-script.ts must NEVER be imported into the main
  // app's own origin to evaluate student text -- see SandboxWorkspace.tsx's
  // comment on why Code -> Build only ever adopts a doc the sandboxed frame
  // already produced, rather than calling this function directly. Nothing
  // here is string-concatenated from a value an attacker chooses; `wrapped`
  // is the source text itself plus one fixed comment.
  const errors: ScriptError[] = [];
  try {
    const fn = new Function(...names, wrapped);
    fn(...names.map((n) => globals[n]));
  } catch (err) {
    errors.push({ message: friendlyMessage(err), line: lineOf(err) });
  }

  const doc = docNow();

  // Value overrides from a slider drag -- applied to the doc the script's
  // own literal defaults produced, via the exact same applyParam() a
  // Build-mode drag already uses. See RunOptions.values's own comment for
  // why this is a doc patch and not a second interpretation of the script.
  let finalDoc = doc;
  if (opts.values) {
    for (const [key, value] of Object.entries(opts.values)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        finalDoc = applyParam(finalDoc, key, value);
      }
    }
  }

  // PARAMS ASSEMBLY. Start from the Build tool's own automatic list (every
  // numeric slot in the doc, correctly captioned and bounded already), then
  // let a script's own param() calls win the caption/bounds for whichever
  // slot they actually filled -- see num()'s comment for how that
  // correlation was recorded. A param() whose value never reached a doc
  // field (used only in a comparison, say) still gets a row of its own,
  // appended at the end, so naming a number is never silently lost.
  const auto = generatedParams(finalDoc);
  const consumedNames = new Set<string>();
  const params: ParamDef[] = auto.map((p) => {
    const overrideName = slotOverrides.get(p.name);
    const named = overrideName ? namedParams.get(overrideName) : undefined;
    if (named) {
      consumedNames.add(named.name);
      return { name: p.name, caption: named.caption, value: p.value, min: named.min, max: named.max, step: named.step };
    }
    return { name: p.name, caption: p.caption, value: p.value, min: p.min, max: p.max, step: p.step };
  });
  for (const def of namedParams.values()) {
    if (!consumedNames.has(def.name)) params.push(def);
  }

  // Every doc slot (pname key) each NAMED param's value fed, grouped by the
  // param's OWN name -- the inverse of slotOverrides, and what
  // toScript(doc, namedParams) needs to know where to write `wall` instead
  // of a literal. Built from slotOverrides rather than re-walking the doc:
  // slotOverrides is recorded at the exact moment num() consumed a
  // ParamNumber, which is the only place that correlation ever existed.
  const slotsByParamName = new Map<string, string[]>();
  for (const [slotKey, paramName] of slotOverrides) {
    const list = slotsByParamName.get(paramName);
    if (list) list.push(slotKey);
    else slotsByParamName.set(paramName, [slotKey]);
  }
  const namedParamsOut: NamedParamDef[] = [...namedParams.values()].map((def) => ({
    ...def,
    slots: slotsByParamName.get(def.name) ?? [],
  }));

  return {
    doc: finalDoc, params, namedParams: namedParamsOut, errors,
    ...(ruleWarnings.length > 0 ? { warnings: ruleWarnings } : {}),
  };
}

// ---------------------------------------------------------------------------
// DESIGN DECISIONS worth a reviewer's eye (kept here rather than only in a
// chat message, so the next person to touch this file finds the reasoning
// beside the code it explains):
//
// 1. RunOptions.values patches the doc AFTER the script runs its own literal
//    defaults, rather than threading overrides back into param() so a drag
//    could change which branch of an `if` executes. The spec's "a slider
//    drag re-runs the script with the new value" reads as the more powerful,
//    control-flow-aware version; this file ships the simpler one. Revisit if
//    a lesson actually wants a param to gate which STEPS exist, not just
//    their numbers.
// 2. cone() takes two arguments (across, tall), not the spec's three --
//    ConeFeature has no field for a flat top radius. See cone()'s own
//    comment.
// 3. holes()'s `apart` is read as full corner-to-corner spacing and halved
//    into HoleFeature.corners' dx/dy (which the doc already defines as
//    half-spacings) -- not passed through directly.
// 4. sk.round()/sk.chamfer() are not in the spec's Language section. Without
//    them, a sketch with a rounded or chamfered corner (which SketchFeature
//    already supports, and the Rules panel already exposes) has no way to
//    reach that state from a script at all -- so this file adds the two
//    names rather than leave a real Build-mode capability unreachable from
//    Code. Flagged as an addition, not a spec deviation.
// 5. draft()'s {from} word is turned into a pull axis and a neutral value by
//    reading the target's own bounding box (see primitiveExtreme()) --
//    DraftFeature.neutral has no generatedParams() slider today, so nothing
//    else in the app derives it this way yet. A {neutral: N} escape hatch is
//    added alongside {from} so any doc (not only ones whose neutral sits
//    exactly on a bounding-box extreme) still round-trips through toScript().
// 6. A param() bound to MORE than one doc slot (`const s = param('s', 20);
//    box(s, s, s)`) still gets one Dimensions-panel row PER SLOT (three, for
//    that example), each independently draggable -- dragging one does not
//    move the other two, even though toScript(doc, namedParams) will
//    correctly regenerate all three as `s` on Code -> Build -> Code. A
//    single slider driving every bound slot at once would need the PANEL
//    (components/ReshapePreview.tsx / ReshapeParamsPanel.tsx), not this
//    file, to collapse NamedParamDef.slots into one row -- out of scope for
//    the fixes this note was added alongside (2026-09-04).
// ---------------------------------------------------------------------------
