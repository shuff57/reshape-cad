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
// THE LINE-NUMBER OFFSET IS MEASURED, NOT ASSUMED. `new Function(a, body)`
// synthesizes `function anonymous(a\n) {\n<body>\n}`, so V8 reports every
// line inside <body> some fixed number of lines higher than it actually
// sits. The exact gap changed 2026-09-13 when the vocabulary stopped being
// passed as 37 separate parameters (see SCOPE_NAME below) and `body` itself
// gained one extra leading line (`with(SCOPE){`) that <source> is nested
// inside. Measured directly against THIS construction: a `throw` on source
// line 3 is reported at line 6, regardless of how many lines <source> has
// or what's in it. LINE_OFFSET encodes that gap in one place rather than as
// a magic number wherever a stack is parsed.

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
  type PrismFeature,
  type WedgeFeature,
  type GrooveFeature,
  type PocketFeature,
  type CombineFeature,
  type ExtrudeFeature,
  type HoleFeature,
  type SphereFeature,
  type SketchFeature,
  type SketchConstraint,
  type FilletFeature,
  type DraftFeature,
  type ShellFeature,
  nextId,
  sketchFrameOf,
  newShape,
  newHole,
  newHoleCorners,
  newShell,
  newMove,
  newRotate,
  newPattern,
  newSketch,
  newSketchOnFace,
  newDatum,
  type SketchFrame,
  RECTANGLE_CONSTRAINTS,
  newExtrude,
  newRevolve,
  newGroove,
  newPocket,
  newMirror,
  newBlend,
  extentAlong,
  throughExtentAlong,
  extentBoundAlong,
  featureRangeAlong,
  holeAxialOffset,
  isRoundable,
  canRotate,
  whyCannotRound,
  whyCannotOrbit,
  type SoupGeom,
  type SoupRule,
} from './model-types.js';
import { generatedParams, applyParam, pname, solveDoc } from './model-codegen.js';
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
  buildSlotRows,
} from '@shuff57/reshape-sketch/sketch-solve';
import { outlineOf, circleOf, tessellate } from '@shuff57/reshape-sketch/sketch-arc';
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
// OFFICIAL NAMES. Every shape/operation has an OFFICIAL geometry name, which
// is what the API teaches and what a student's variables get bound through:
// cuboid, torus, fillet, chamfer, extrude, revolve, loft, shell, subtract,
// union, intersect, linearPattern, polarPattern (SPEC-S2). The friendly
// course words (box, ring, round, bevel, pull, spin, blend, hollow, cut, join,
// keep, repeat, repeatAround) remain documented ALIASES pointing at the SAME
// function — same reference, not a wrapper, so the two vocabularies can never
// drift apart. OFFICIAL_NAMES fold lives here.
export const VOCABULARY = [
  // student words (course-facing, documented in the lesson pages)
  'box', 'cylinder', 'sphere', 'cone', 'ring',
  'prism', 'wedge', 'groove', 'pocket',
  'hole', 'holes', 'hollow', 'round', 'bevel', 'repeat', 'repeatAround', 'mirror', 'move', 'turn',
  'join', 'cut', 'keep', 'draft',
  'sketch', 'plane', 'pull', 'spin', 'blend',
  'param',
  // official geometry names (API-facing; same fns as their student alias)
  'cuboid', 'torus', 'fillet', 'chamfer',
  'shell', 'subtract', 'union', 'intersect',
  'linearPattern', 'polarPattern',
  'extrude', 'revolve', 'loft',
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
// The `with(SCOPE_NAME){...}` binding name below -- deliberately unlikely to
// collide with a student's own variable (see runScript's "run it" section).
const SCOPE_NAME = '__RESHAPE_SCOPE__';
// See the file header: measured against `new Function(SCOPE_NAME, wrapped)`
// on this exact engine family (V8 -- Node and Chromium both), not derived
// from a spec. Bumped 2 -> 3 2026-09-13 for the `with(SCOPE){` wrapper line
// -- see the header comment and SCOPE_NAME below.
const LINE_OFFSET = 3;

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
 *  hand and the candidate set is VOCABULARY's length (38: SPEC-S2's official-name
 *  aliases, then SPEC-datum-family's plane) — small either way. */
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
 * naming the nearest word in VOCABULARY by edit distance: the candidate set
 * is small (VOCABULARY's length), so "nearest" is always cheap and, for an
 * actual typo, always
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
    // 2026-09-13: `const box = box(40, 40, 20)` -- naming a variable the
    // SAME word as the tool that builds it, the single most natural name
    // to reach for. Legal in a Build-mouse-clicks world, illegal in JS: a
    // `const`/`let` declares its name for the WHOLE enclosing block from
    // the top, so the right-hand `box(...)` call is already inside that
    // name's temporal dead zone before its own declaration finishes. No
    // scope trick fixes this (measured -- see the shell session that
    // produced this fix); the only real fix is a different name. VOCABULARY
    // membership, not edit distance, decides this branch -- SCOPE's `set`
    // trap below only ever throws Error, so a ReferenceError this exact
    // shape is never anything BUT this.
    // The trailing `\.?` is not cosmetic: V8 ends this message without a full
    // stop and JavaScriptCore ends it with one (measured -- bun 1.4.2, which
    // is JSC, reports "Cannot access 'box' before initialization."). Anchored
    // without it, the whole rewrite below fired on Chrome and Firefox and
    // silently did not on Safari, where a student got the raw TDZ text instead
    // of the sentence telling them what to do about it.
    const tdz = /^Cannot access '([A-Za-z_$][\w$]*)' before initialization\.?$/.exec(err.message);
    if (tdz && (VOCABULARY as readonly string[]).includes(tdz[1])) {
      const name = tdz[1];
      return `You can't build ${name}() into a variable named "${name}" on the same line -- JS reserves that name for the whole line before ${name}(...) even runs. Give the result its own name instead, e.g. const my${name[0].toUpperCase()}${name.slice(1)} = ${name}(...).`;
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
/**
 * The turn of a groove(): more than 0 and at most 360 degrees. A groove's partial and reversed turns were never measured against
 * FreeCAD (only the full turn is built), so a negative or past-a-turn angle stays a sentence here.
 */
function sweepAngle(fn: string, v: unknown): void {
  const val = unwrap(v as number);
  if (!(val > 0 && val <= 360)) {
    throw new Error(`${fn}(): the angle is how far the sketch turns, more than 0 and at most 360 degrees -- got ${val}. A negative angle or one past a full turn is not a turn this kernel builds.`);
  }
}

/** The largest turn spin() takes, either way round: two full turns. Past a whole turn the part is the whole turn (FreeCAD clamps
 *  it the same way), so 400 and 720 build the full ring; more than that is a typo, not a turn. */
const MAX_SPIN_DEGREES = 720;

/**
 * The turn of a spin(): any angle other than 0, up to two full turns either way. A negative angle turns the other way round the
 * axis and a turn past 360 is the full turn -- the kernel builds both exactly as FreeCAD does (volume, bounding box, centre of
 * mass and faces, variants revolution__top-neg-90 / top-neg-180 / front-neg-90 / top-400). Zero turns nothing and an absurd
 * magnitude is almost certainly a mistake, so those stay a sentence.
 */
function spinAngle(v: unknown): void {
  const val = unwrap(v as number);
  if (val === 0) {
    throw new Error(`spin(): the angle is how far the sketch turns, and 0 degrees turns it nowhere -- got ${val}. Use a turn from 1 to 360 degrees (a negative one turns the other way).`);
  }
  if (!(Math.abs(val) <= MAX_SPIN_DEGREES)) {
    throw new Error(`spin(): the angle is how far the sketch turns, and ${val} degrees is more than ${MAX_SPIN_DEGREES} -- got ${val}. Use a turn of at most 360 degrees (a negative one turns the other way).`);
  }
}

/** The depth of a pocket(): a positive number of mm. The direction is fixed (into the material), so a zero or negative depth cannot mean anything, and the kernel's own sentence for it ("does not touch the part") names the wrong cause. */
function cutDepth(fn: string, v: unknown): void {
  const val = unwrap(v as number);
  if (!(val > 0)) {
    throw new Error(`${fn}(): the depth is how far the cut goes into the material, so it has to be a positive number -- got ${val}.`);
  }
}

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

/** A corner number as the script writes it: 1 is the first corner, the same count the Rules panel and
 *  .pin() use. Returns the 0-based index the document stores. `count` is the sketch's corner count
 *  (0 when it has none yet, in which case any whole number from 1 is let through). */
function cornerIndex(fn: string, v: unknown, count: number): number {
  const val = unwrap(requiredNumber(fn, 'corner', v));
  if (!Number.isInteger(val) || val < 1 || (count > 0 && val > count)) {
    throw new Error(
      `${fn}'s corner has to be a whole number from 1${count > 0 ? ` to ${count}` : ''} (corner 1 is the first corner) -- you gave it ${val}.`
    );
  }
  return val - 1;
}

/** What plane() returns. Plain data in a class only so sketch() can tell it
 *  from a hand-written frame; it is never stored in the doc. */
class PlaneValue {
  constructor(
    readonly datumId: string,
    readonly plane: SketchPlane | null,
    readonly offset: number | undefined,
    readonly frame: SketchFrame | null,
  ) {}
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
  /** The edge between two faces: each is a face word, or a pocket wall from `wall()`. */
  edge(a: FaceWord | TopoRef, b: FaceWord | TopoRef): TopoRef;
  /** The wall a pocket cut where side `n` (1-based) of its sketch ran: a face, for use in `edge('top', part.wall(sk, 1))`. */
  wall(sk: SketchHandle, n: number): TopoRef;
  /** The edges where a pocket opens through the top face, one per side of its sketch: `round(part.rim(sk), 1)`. */
  rim(sk: SketchHandle): TopoRef[];
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
  // P1f's measured Point-rules rows (Dist X, Dist Y, Symmetric, Angle) --
  // same panel-words rule as the rows above. distX/distY rather than
  // overloading .across(), which already means "this edge is level";
  // corner and edge numbers are 1-based, and every number below is SIGNED
  // (a negative gap or turn is a meaningful ask), unlike .length().
  distX(a: unknown, b: unknown, value: unknown): SketchHandle;
  distY(a: unknown, b: unknown, value: unknown): SketchHandle;
  symmetric(a: unknown, b: unknown, center: unknown): SketchHandle;
  angle(edge: unknown, other: unknown, degrees: unknown): SketchHandle;
  // The soup (SPEC-sketcher2.md §6.1): array-of-objects, evaluated as real
  // JS, so a row's `value` can be a param() reference -- the whole reason
  // rows beat an opaque blob (a blob cannot hold a param).
  geom(rows: unknown): SketchHandle;
  rules(rows: unknown): SketchHandle;
  // INPUT-ONLY sugar (SPEC-sketcher2 §6.3: toScript never reverse-engineers a
  // composite). slot(a, b, r): a and b are the centres of the two end caps,
  // r is the cap radius (the slot is 2r wide). APPENDS the studio slot tool's
  // 4 geometry rows + 8 rule rows to whatever the sketch already holds;
  // toScript emits them back as geom([...]) / rules([...]), never the word slot.
  slot(a: unknown, b: unknown, r: unknown): SketchHandle;
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

  /** The subtract that cut `toolId` out of a part (a pocket after pocketCutOf() has opened it into a pull and a subtract). */
  function cutOfTool(toolId: string): CombineFeature {
    const c = features.find((x): x is CombineFeature => x.kind === 'combine' && x.op === 'subtract' && x.targets.length === 2 && x.targets[1] === toolId);
    if (!c) throw new Error('.edge() with a wall needs a wall of a pocket.');
    return c;
  }

  /** The tool and the subtract of the pocket cut from sketch `skId`, or null when there is none.
   *
   *  The kernel can only find a pocket wall by the pull that swept it: a pocket feature leaves no record of its walls, so a name
   *  written against one never resolves ("edge could not be found"). So the first time a script names a wall, the pocket is
   *  written out as what it is, a downward pull of the same sketch subtracted from the part. Same id, same shape (the kernel
   *  runs the same cut), and the walls now belong to a pull the kernel knows. A cut written that way by hand is found as it is. */
  function pocketCutOf(skId: string): { toolId: string; cutId: string } | null {
    const p = features.find((x): x is PocketFeature => x.kind === 'pocket' && x.target === skId);
    if (p) {
      if (slotOverrides.has(pname(p.id, 'depth'))) {
        throw new Error('A pocket whose depth is a param() cannot have its walls named yet -- give pocket() a plain number for the depth, or cut it as subtract(shape, pull(sketch, -depth)).');
      }
      if (p.midplane || p.length2 !== undefined || p.reversed || p.through || p.taper || p.direction) {
        throw new Error('A pocket with a direction option (through, reversed, midplane, length2, taper, direction) cannot have its walls named yet -- name the walls of a plain one-sided pocket.');
      }
      const tool: ExtrudeFeature = { ...newExtrude(docNow(), skId), height: -p.depth };
      const cutF: CombineFeature = { id: p.id, kind: 'combine', op: 'subtract', targets: [p.into, tool.id] };
      if (p.name !== undefined) cutF.name = p.name;
      features = features.flatMap((x) => (x.id === p.id ? [tool, cutF] : [x]));
      return { toolId: tool.id, cutId: cutF.id };
    }
    const tool = features.find((x): x is ExtrudeFeature => x.kind === 'extrude' && x.target === skId && x.height < 0);
    const c = tool && features.find((x): x is CombineFeature => x.kind === 'combine' && x.op === 'subtract' && x.targets.length === 2 && x.targets[1] === tool.id);
    return tool && c ? { toolId: tool.id, cutId: c.id } : null;
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
      edge(a: FaceWord | TopoRef, b: FaceWord | TopoRef): TopoRef {
        const allowSide = handle.rootKind === 'cylinder';
        // A face of this edge is a face word, or a pocket wall named by wall(). A pocket wall is a face the pocket made, so
        // the word beside it names the face of the plate it cuts into (carried through the pocket), not a primitive of the pocket.
        const wallA = isTopoRef(a) && a.name.cause === 'swept';
        const wallB = isTopoRef(b) && b.name.cause === 'swept';
        if ((isTopoRef(a) && !wallA) || (isTopoRef(b) && !wallB)) {
          throw new Error('.edge() takes a face word (top, front, ...) or a pocket wall from .wall(sketch, n).');
        }
        if (wallA && wallB) {
          const [na, nb] = [a as TopoRef, b as TopoRef].map((r) => r.name as Extract<TopoName, { cause: 'swept' }>);
          if (na.feature === nb.feature && na.from === nb.from && na.edge === nb.edge) {
            throw new Error('.edge() needs two DIFFERENT faces to name the edge between them.');
          }
          return { __reshapeTopoRef: true, owner: handle, name: { cause: 'between', feature: cutOfTool(na.feature).id, kind: 'edge', of: [na, nb] } };
        }
        if (wallA || wallB) {
          const w = (wallA ? a : b) as TopoRef;
          const word = wallA ? b : a;
          const wn = w.name as Extract<TopoName, { cause: 'swept' }>;
          const cutF = cutOfTool(wn.feature);
          const part = facePart('.edge()', word, false);
          const plateFace: TopoName = {
            cause: 'carried', feature: cutF.id, kind: 'face',
            of: { cause: 'primitive', feature: cutF.targets[0], kind: 'face', part },
          };
          return { __reshapeTopoRef: true, owner: handle, name: { cause: 'between', feature: cutF.id, kind: 'edge', of: [plateFace, wn] } };
        }
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
      wall(sk: SketchHandle, n: number): TopoRef {
        if (!isSketchHandle(sk)) throw new Error('.wall() needs the sketch the pocket was cut from: part.wall(sketch2, 1).');
        const skF = features.find((x) => x.id === sk.id);
        const cutIds = skF && skF.kind === 'sketch' ? pocketCutOf(sk.id) : null;
        if (!cutIds || !skF || skF.kind !== 'sketch') {
          throw new Error('.wall() names a face a pocket cut, and no pocket(...) was cut from that sketch.');
        }
        const sides = skF.shape === 'circle' ? 1 : skF.points.length;
        const k = unwrap(n as number);
        if (!Number.isInteger(k) || k < 1 || k > sides) {
          throw new Error(`.wall() needs a side number from 1 to ${sides} (the sketch has ${sides}), and you gave it ${describe(n)}.`);
        }
        return {
          __reshapeTopoRef: true,
          owner: handle,
          name: { cause: 'swept', feature: cutIds.toolId, kind: 'face', from: sk.id, edge: k - 1 },
        };
      },
      rim(sk: SketchHandle): TopoRef[] {
        if (!isSketchHandle(sk)) throw new Error('.rim() needs the sketch the pocket was cut from: part.rim(sketch2).');
        const skF = features.find((x) => x.id === sk.id);
        if (!skF || skF.kind !== 'sketch') throw new Error('.rim() needs the sketch the pocket was cut from.');
        if (skF.plane !== 'xy' || skF.frame) {
          throw new Error('.rim() finds the opening of a pocket cut down from a top-plane sketch; for another pocket name its edges one at a time with .edge(face, part.wall(sketch, n)).');
        }
        const sides = skF.shape === 'circle' ? 1 : skF.points.length;
        const out: TopoRef[] = [];
        for (let i = 1; i <= sides; i++) out.push(handle.edge('top', handle.wall(sk, i)));
        return out;
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

  // prism(sides, across, tall) -> PrismFeature. `across` is the whole width
  // across corners (the circumradius doubled), matching how every other
  // student word names a diameter rather than a radius.
  function prism(sides: unknown, across: unknown, tall: unknown, opts?: unknown): SolidHandle {
    return placePrimitive('prism', 'prism', ['sides', 'across', 'tall'], [sides, across, tall], opts, (f, id) => {
      const pf = f as PrismFeature;
      const n = Math.round(unwrap(sides) as number);
      if (!(n >= 3 && n <= 12)) throw new Error('prism() needs 3 to 12 sides.');
      pf.sides = n;
      pf.radius = num(across, id, 'radius') / 2;
      pf.height = num(tall, id, 'height');
    });
  }

  // wedge(width, depth, tall) -> WedgeFeature: the right-triangle footprint
  // the kernel extrudes along Z (occt-build's wedgeOf, matching FreeCAD's own
  // PartDesign::Wedge default).
  function wedge(width: unknown, depth: unknown, tall: unknown, opts?: unknown): SolidHandle {
    return placePrimitive('wedge', 'wedge', ['width', 'depth', 'height'], [width, depth, tall], opts, (f, id) => {
      const wf = f as WedgeFeature;
      wf.width = num(width, id, 'width');
      wf.depth = num(depth, id, 'depth');
      wf.height = num(tall, id, 'height');
    });
  }

  // groove(sketch, target, angle): the subtractive revolve — spin the profile
  // around the sketch plane's own normal and CUT the ring out of the target
  // solid. Mirror of spin(), with the solid it cuts named.
  /** A word that takes no options object: a surplus argument is named, not
   *  silently dropped. Aliases share the implementation, so the error names
   *  the base word. */
  function noExtraArgs(word: string, takes: string, max: number, extra: unknown[], hint = ''): void {
    if (extra.length === 0) return;
    const ord = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
    const n = max + 1;
    const which = ord[n - 1] ?? `${n}th`;
    throw new Error(`${word}() takes ${takes}; the ${which} argument (${describe(extra[0])}) was ignored.${hint ? ' ' + hint : ''}`);
  }

  function groove(sk: unknown, target: unknown, angle: unknown, ...extra: unknown[]): SolidHandle {
    noExtraArgs('groove', 'a sketch, a shape and an angle', 3, extra);
    if (!isSketchHandle(sk)) throw new Error('groove() needs a sketch: groove(sketch1, shape, angle).');
    if (!isHandle(target)) throw new Error('groove() needs a shape to cut: groove(sketch1, shape, angle).');
    requiredNumber('groove', 'angle', angle);
    sweepAngle('groove', angle);
    const f = newGroove(docNow(), sk.id, target.id);
    f.angle = num(angle, f.id, 'angle');
    pushFeature(f);
    return makeSolidHandle(f);
  }

  // pocket(sketch, target, depth): the subtractive extrude — pull the profile
  // straight into the target solid and CUT the block out. Mirror of pull(),
  // with the solid it cuts named. Same argument order as groove() on purpose:
  // profile first, victim second, number last.
  function pocket(sk: unknown, target: unknown, depth: unknown, opts?: unknown, ...extra: unknown[]): SolidHandle {
    const known = opts !== undefined && isPlainOptions(opts) && Object.keys(opts).every((k) => ['through', 'reversed', 'midplane', 'length2', 'taper', 'direction', 'alongNormal'].includes(k));
    if (known) noExtraArgs('pocket', 'a sketch, a shape and a depth', 4, extra);
    else noExtraArgs('pocket', 'a sketch, a shape and a depth', 3, opts === undefined ? extra : [opts, ...extra]);
    if (!isSketchHandle(sk)) throw new Error('pocket() needs a sketch: pocket(sketch1, shape, depth).');
    if (!isHandle(target)) throw new Error('pocket() needs a shape to cut: pocket(sketch1, shape, depth).');
    requiredNumber('pocket', 'depth', depth);
    cutDepth('pocket', depth);
    const dir = readDirection('pocket', opts, true);
    const f = newPocket(docNow(), sk.id, target.id);
    f.depth = num(depth, f.id, 'depth');
    Object.assign(f, dir);
    pushFeature(f);
    return makeSolidHandle(f);
  }

  // ---- sketches ---------------------------------------------------------

  const PLANE_WORD: Record<string, SketchPlane> = { top: 'xy', front: 'xz', side: 'yz' };

  // The frame form: sketch({ origin: [x,y,z], u: [..], v: [..] }). The normal
  // is u x v (right-handed), exactly as SketchFeature.frame defines it. A
  // frame that is not unit-length and orthogonal is REFUSED rather than
  // normalised or re-orthogonalised: either repair would silently change the
  // sketch's scale or skew its outline, and a swapped u/v mirrors the part
  // (it flips the normal) -- the student must see that, so it is documented
  // in the error and nothing here guesses. Plain numbers only (no param()).
  const FRAME_TOL = 1e-6;
  function readFrame(given: Record<string, unknown>, fn = 'sketch'): SketchFrame {
    const o = readOptions(fn, ['origin', 'u', 'v'], given);
    for (const k of ['origin', 'u', 'v']) {
      if (o[k] === undefined) {
        throw new Error(`${fn}({ ... }) needs origin, u and v: ${fn}({ origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0] }). It is missing ${k}.`);
      }
    }
    const vec = (label: string): Vec3 => {
      const raw = readVec3(fn, label, o[label]).map((n) => unwrap(n as number)) as Vec3;
      if (!raw.every((n) => Number.isFinite(n))) {
        throw new Error(`${fn}()'s ${label} needs three finite numbers, like [x, y, z].`);
      }
      return raw;
    };
    const origin = vec('origin');
    const u = vec('u');
    const v = vec('v');
    const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
    for (const [label, a] of [['u', u], ['v', v]] as const) {
      if (Math.abs(len(a) - 1) > FRAME_TOL) {
        throw new Error(
          `${fn}()'s ${label} has to be a unit-length direction (its length is ${len(a)}, not 1). `
            + `Divide it by its length -- sketches are never silently rescaled.`,
        );
      }
    }
    const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    if (Math.abs(dot) > FRAME_TOL) {
      throw new Error(`${fn}()'s u and v have to be at right angles to each other (their dot product is ${dot}, not 0).`);
    }
    return { origin, u, v };
  }

  // plane(...): creates a `datum` feature (SPEC-datum-family Stage 3), which
  // shows in the timeline and has no geometry. A named plane keeps its NAMED
  // path (never a cross product: xz's u x v is -Y but it sweeps -Y on
  // purpose); a literal frame is validated by the same readFrame
  // sketch({...}) uses. The returned PlaneValue carries the datum id, so
  // sketch(plane(...)) can both point at the datum (onDatum) and copy its
  // placement into the sketch's own plane/offset/frame -- every reader and
  // the kernel keep working from those, and the kernel ignores onDatum.
  function plane(spec: unknown, offset?: unknown): PlaneValue {
    if (isPlainOptions(spec) && !(spec instanceof PlaneValue)) {
      if (offset !== undefined) {
        throw new Error('plane({ origin, u, v }) takes no offset: the origin already says where the plane sits.');
      }
      const frame = readFrame(spec, 'plane');
      const d = newDatum(docNow());
      d.frame = frame;
      pushFeature(d);
      return new PlaneValue(d.id, null, 0, frame);
    }
    if (typeof spec !== 'string' || !(spec in PLANE_WORD)) {
      throw new Error(`plane() needs a plane word: 'top', 'front' or 'side' (or a frame { origin, u, v }). You gave it ${describe(spec)}.`);
    }
    const d = newDatum(docNow());
    d.plane = PLANE_WORD[spec];
    // Canonical: a named datum always carries its offset (0 when none was
    // given), so plane('top') and plane('top', 0) are the same doc.
    d.offset = offset === undefined ? 0 : num(requiredNumber('plane', 'offset', offset), d.id, 'offset');
    pushFeature(d);
    return new PlaneValue(d.id, d.plane, d.offset, null);
  }

  function sketch(planeWord: unknown, offset?: unknown, ...extra: unknown[]): SketchHandle {
    noExtraArgs('sketch', 'a plane and an optional offset', 2, extra);
    if (planeWord instanceof PlaneValue) {
      if (offset !== undefined) {
        throw new Error('sketch(plane(...)) takes no offset: give the offset to plane(), like plane(\'top\', 10).');
      }
      const f = planeWord.frame
        ? newSketchOnFace(docNow(), { origin: [...planeWord.frame.origin], u: [...planeWord.frame.u], v: [...planeWord.frame.v] })
        : newSketch(docNow(), planeWord.plane!);
      if (!planeWord.frame) f.offset = planeWord.offset ?? 0;
      f.onDatum = planeWord.datumId;
      pushFeature(f);
      return makeSketchHandle(f.id);
    }
    if (isPlainOptions(planeWord)) {
      if (offset !== undefined) {
        throw new Error('sketch({ origin, u, v }) takes no offset: the origin already says where the plane sits.');
      }
      const f = newSketchOnFace(docNow(), readFrame(planeWord));
      pushFeature(f);
      return makeSketchHandle(f.id);
    }
    if (typeof planeWord !== 'string' || !(planeWord in PLANE_WORD)) {
      throw new Error(`sketch() needs a plane word: 'top', 'front' or 'side' (or a frame { origin, u, v }). You gave it ${describe(planeWord)}.`);
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
    // No cross-kind branch here: `a.kind !== b.kind` at the top of this
    // function already means a distanceX can never be compared with a
    // distanceY. (Reviewed 2026-09-09: an earlier version tested for that
    // pairing anyway, which read as if cross-kind matching were intended and
    // was unreachable either way.) A distX and a distY on one pair are
    // different rules; whether they can COEXIST is the solver's call, and
    // addConstraintSettling drops one on a rectangle diagonal because fixing
    // both dx and dy there over-constrains it -- measured, reported through
    // `removed`, and long-standing.
    if (a.kind === 'distanceX' && b.kind === 'distanceX') {
      return a.a === b.a && a.b === b.b && a.value === b.value;
    }
    if (a.kind === 'distanceY' && b.kind === 'distanceY') {
      return a.a === b.a && a.b === b.b && a.value === b.value;
    }
    if (a.kind === 'symmetric' && b.kind === 'symmetric') {
      return a.a === b.a && a.b === b.b && a.center === b.center;
    }
    if (a.kind === 'angle' && b.kind === 'angle') {
      return a.edge === b.edge && a.other === b.other && a.degrees === b.degrees;
    }
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

  // -- soup row readers (SPEC-sketcher2 §2.3/§2.5) --------------------------
  // The interpreter validates every row's SHAPE (the k discriminator and the
  // fields that kind carries) so a malformed row refuses here, with a line
  // number, instead of arriving in the kernel as a puzzle.

  const GEOM_SHAPES: Record<string, string[]> = {
    point: ['id', 'p'],
    line: ['id', 'a', 'b'],
    circle: ['id', 'c', 'r'],
    arc: ['id', 'c', 'r', 'a', 'b', 'sense'],
  };
  const GEOM_KEYS = new Set(['k', ...Object.values(GEOM_SHAPES).flat(), 'construction']);

  function readVec2(where: string, what: string, v: unknown): [number, number] {
    if (
      Array.isArray(v) && v.length === 2 &&
      typeof v[0] === 'number' && Number.isFinite(v[0]) &&
      typeof v[1] === 'number' && Number.isFinite(v[1])
    ) {
      return [v[0], v[1]];
    }
    throw new Error(`${where} needs ${what} as [u, v], got ${describe(v)}.`);
  }

  function readSoupGeom(where: string, v: unknown): SoupGeom {
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      throw new Error(`${where} needs geometry row objects like { k: 'line', id: 1, a: [0, 0], b: [40, 0] }, got ${describe(v)}.`);
    }
    const o = v as Record<string, unknown>;
    const k = o.k;
    const shape = typeof k === 'string' ? GEOM_SHAPES[k] : undefined;
    if (!shape) {
      throw new Error(
        `${where} row k must be one of point, line, circle, arc; got ${describe(k)}.`,
      );
    }
    if (typeof o.id !== 'number' || !Number.isInteger(o.id) || o.id <= 0) {
      throw new Error(`${where} row id must be a positive whole number, got ${describe(o.id)}.`);
    }
    for (const field of shape) {
      if (o[field] === undefined) {
        throw new Error(`${where} row ${k} needs a ${field}.`);
      }
    }
    if (k === 'point') {
      return { k, id: o.id as number, p: readVec2(where, 'p', o.p), ...(o.construction === true ? { construction: true } : {}) };
    }
    if (k === 'line') {
      return {
        k, id: o.id as number,
        a: readVec2(where, 'a', o.a), b: readVec2(where, 'b', o.b),
        ...(o.construction === true ? { construction: true as const } : {}),
      };
    }
    const r = o.r;
    // A radius may be a param() reference (§6.2) -- the wrapper unwraps
    // through num() in the caller once the feature id is known. A plain
    // number must still be positive HERE.
    if (r instanceof ParamNumber) {
      // shape-only check: the number itself is validated by num() below.
    } else if (typeof r !== 'number' || !(r > 0)) {
      throw new Error(`${where} row ${k} needs a positive radius r, got ${describe(r)}.`);
    }
    if (k === 'circle') {
      return { k, id: o.id as number, c: readVec2(where, 'c', o.c), r: r as number, ...(o.construction === true ? { construction: true as const } : {}) };
    }
    const sense = o.sense;
    if (sense !== 'ccw' && sense !== 'cw') {
      throw new Error(`${where} row arc needs sense 'ccw' or 'cw', got ${describe(sense)}.`);
    }
    return {
      k: 'arc', id: o.id as number, c: readVec2(where, 'c', o.c), r: r as number,
      a: readVec2(where, 'a', o.a), b: readVec2(where, 'b', o.b),
      sense, ...(o.construction === true ? { construction: true as const } : {}),
    };
  }

  const RULE_SHAPES: Record<string, string[]> = {
    coincident: ['a', 'b'],
    pointOnObject: ['a', 'b'],
    horizontal: ['a'],
    vertical: ['a'],
    parallel: ['a', 'b'],
    perpendicular: ['a', 'b'],
    tangent: ['a', 'b'],
    equal: ['a', 'b'],
    symmetric: ['a', 'b', 'c'],
    distance: ['a', 'b', 'value'],
    distanceX: ['a', 'b', 'value'],
    distanceY: ['a', 'b', 'value'],
    radius: ['a', 'value'],
    diameter: ['a', 'value'],
    angle: ['a', 'b', 'value'],
    lock: ['a'],
  };

  function readSoupRule(where: string, v: unknown): SoupRule {
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      throw new Error(`${where} needs constraint row objects like { k: 'tangent', a: 2, aEnd: 'b', b: 3, bEnd: 'a' }, got ${describe(v)}.`);
    }
    const o = v as Record<string, unknown>;
    const k = o.k;
    const fields = typeof k === 'string' ? RULE_SHAPES[k] : undefined;
    if (!fields) {
      throw new Error(`${where} row k must be one of the 16 constraint kinds, got ${describe(k)}.`);
    }
    for (const field of fields) {
      if (o[field] === undefined) {
        throw new Error(`${where} row ${k} needs a ${field}.`);
      }
    }
    for (const gref of ['a', 'b', 'c']) {
      if (o[gref] !== undefined) {
        if (typeof o[gref] !== 'number' || !Number.isInteger(o[gref] as number)) {
          throw new Error(`${where} row ${k} names geometry by whole id, got ${describe(o[gref])}.`);
        }
      }
    }
    if (o.value !== undefined) {
      if (typeof o.value !== 'number' && !(o.value instanceof ParamNumber)) {
        throw new Error(`${where} row ${k} needs a number (or a param()) as value, got ${describe(o.value)}.`);
      }
    }
    return o as unknown as SoupRule;
  }

  function makeSketchHandle(id: string): SketchHandle {
    // A sketch may hold SEVERAL closed shapes. The first rect()/circle()/polygon() is the plain outline the Rectangle and
    // Circle tools make; a second one (or one after sk.geom()/sk.slot()) turns the sketch into rows -- one loop per shape --
    // exactly the rows sk.geom([...]) writes, so the kernel nests them by the even-odd rule FreeCAD uses: a closed shape
    // inside another is a hole, a shape inside that hole stands on its own, shapes side by side are separate pieces, and
    // shapes that cross or touch are refused by the kernel in a sentence. Measured against FreeCAD (variants
    // pad-basic__*-one-sketch and the multi-loop variants).
    let outline: string | null = null;
    const starter = (findFeature(id) as SketchFeature).points.map((p): [number, number] => [p[0], p[1]]);
    const hasRows = (): boolean => {
      const c = findFeature(id) as SketchFeature;
      return Array.isArray(c.geoms) && c.geoms.length > 0;
    };
    const boundSlot = (): boolean => {
      for (const k of slotOverrides.keys()) if (k.startsWith(`${id}_`)) return true;
      return false;
    };
    const RULED = 'a sketch of several shapes keeps its sizes as plain numbers, so a param() cannot drive one of them. Give the number itself, or draw this shape on its own sketch().';
    const noParam = (call: string, ...vals: unknown[]): void => {
      if (vals.some((v) => v instanceof ParamNumber)) {
        throw new Error(`${call} is not the only shape on this sketch, and ${RULED}`);
      }
    };
    const rectRows = (base: number, x0: number, y0: number, x1: number, y1: number): { geoms: SoupGeom[]; rules: SoupRule[] } => {
      const p: Array<[number, number]> = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      const geoms: SoupGeom[] = p.map((a, i) => ({ k: 'line', id: base + i, a, b: p[(i + 1) % 4] }));
      const rules: SoupRule[] = [0, 1, 2, 3].map((i) => ({ k: 'coincident', a: base + i, aEnd: 'b', b: base + ((i + 1) % 4), bEnd: 'a' }));
      // the Rectangle tool's own rules: top and bottom run across, the sides run up
      rules.push({ k: 'horizontal', a: base }, { k: 'vertical', a: base + 1 }, { k: 'horizontal', a: base + 2 }, { k: 'vertical', a: base + 3 });
      return { geoms, rules };
    };
    const polyRows = (base: number, p: Array<[number, number]>): { geoms: SoupGeom[]; rules: SoupRule[] } => {
      const n = p.length;
      const geoms: SoupGeom[] = p.map((a, i) => ({ k: 'line', id: base + i, a, b: p[(i + 1) % n] }));
      const rules: SoupRule[] = p.map((_, i) => ({ k: 'coincident', a: base + i, aEnd: 'b', b: base + ((i + 1) % n), bEnd: 'a' }));
      return { geoms, rules };
    };
    /** The rows the sketch holds so far, to put one more shape beside. Null while this is the sketch's first shape. */
    const priorRows = (call: string): { geoms: SoupGeom[]; rules: SoupRule[] } | null => {
      const cur = findFeature(id) as SketchFeature;
      if (hasRows()) {
        outline = outline ?? 'rows';
        return { geoms: (cur.geoms as SoupGeom[]).slice(), rules: ((cur.rules ?? []) as SoupRule[]).slice() };
      }
      if (outline === null) return null;
      // A plain outline is already there: put it into rows unchanged, then the new shape goes beside it.
      if (boundSlot()) {
        throw new Error(`${call} would be the second shape on this sketch, and the first one is driven by a param(), which ${RULED}`);
      }
      if (cur.rounds && Object.keys(cur.rounds).length || cur.chamfers && Object.keys(cur.chamfers).length || cur.bulges && Object.keys(cur.bulges).length) {
        throw new Error(
          `${call} would be the second shape on this sketch, and the first has rounded or chamfered corners, which a sketch of several shapes cannot carry. ` +
          `Draw each shape on its own sketch(), or write the rounded shape as sk.geom([...]) rows.`,
        );
      }
      const hand = (cur.constraints ?? []).length > 0 && JSON.stringify(cur.constraints) !== JSON.stringify(RECTANGLE_CONSTRAINTS);
      if (hand) {
        throw new Error(
          `${call} would be the second shape on this sketch, and the first carries rules of its own (across, up, length and the like), which a sketch of several shapes cannot keep. ` +
          `Draw each shape on its own sketch(), or write the rules as sk.rules([...]) rows.`,
        );
      }
      if (cur.shape === 'circle' && cur.points.length === 2) {
        const [a, b] = cur.points;
        return {
          geoms: [{ k: 'circle', id: 1, c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], r: Math.hypot(b[0] - a[0], b[1] - a[1]) / 2 }],
          rules: [],
        };
      }
      const pts = cur.points.map((p): [number, number] => [p[0], p[1]]);
      const isRect = JSON.stringify(cur.constraints ?? []) === JSON.stringify(RECTANGLE_CONSTRAINTS) && pts.length === 4;
      if (isRect) return rectRows(1, pts[0][0], pts[0][1], pts[2][0], pts[2][1]);
      return polyRows(1, pts);
    };
    /** Writes the sketch as rows: what it held, then `added` (ids continue the dense 1-based run). */
    const putRows = (prior: { geoms: SoupGeom[]; rules: SoupRule[] }, added: { geoms: SoupGeom[]; rules: SoupRule[] }, call: string): void => {
      const cur = findFeature(id) as SketchFeature;
      const geoms = [...prior.geoms, ...added.geoms];
      replaceFeature(id, {
        ...cur,
        points: starter.map((p): [number, number] => [p[0], p[1]]),
        // what sketch() hands sk.geom() as well, so the document is the one sk.geom([...]) would have written
        shape: undefined, rounds: undefined, chamfers: undefined, bulges: undefined, constraints: RECTANGLE_CONSTRAINTS.slice(),
        geoms, geom: geoms, rules: [...prior.rules, ...added.rules],
      });
      outline = call.replace(/\(\)$/, '').replace(/^\./, '');
    };
    /** A corner or an edge is a number on a plain outline; rows have no such numbers. */
    const needOutline = (call: string): void => {
      if (hasRows()) {
        throw new Error(
          `${call} names a corner or an edge by number, and this sketch is drawn as rows (sk.geom, a slot, or several shapes). ` +
          `Say it with sk.rules([...]) rows instead.`,
        );
      }
    };
    const handle: SketchHandle = {
      __reshapeSketch: true,
      id,
      rect(w, h, opts) {
        requiredNumber('.rect()', 'width', w);
        requiredNumber('.rect()', 'height', h);
        const extra = readOptions('.rect()', ['at'], opts);
        const [ax, ay] = extra.at !== undefined ? readVec2('.rect()', 'at', extra.at) : [0, 0];
        const prior = priorRows('.rect()');
        if (prior) {
          noParam('.rect()', w, h);
          const ww = unwrap(w), hh = unwrap(h);
          if (!(ww > 0) || !(hh > 0)) throw new Error(`.rect() needs a width and a height above 0. You gave ${ww} by ${hh}.`);
          const base = prior.geoms.length + 1;
          putRows(prior, rectRows(base, ax - ww / 2, ay - hh / 2, ax + ww / 2, ay + hh / 2), '.rect()');
          return handle;
        }
        outline = 'rect';
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
        const prior = priorRows('.circle()');
        if (prior) {
          noParam('.circle()', d);
          const across = unwrap(d);
          if (!(across > 0)) throw new Error(`.circle() needs an across above 0. You gave ${across}.`);
          const base = prior.geoms.length + 1;
          putRows(prior, { geoms: [{ k: 'circle', id: base, c: [ax, ay], r: across / 2 }], rules: [] }, '.circle()');
          return handle;
        }
        outline = 'circle';
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
        const prior = priorRows('.polygon()');
        if (prior) {
          noParam('.polygon()', ...pointsArg.flat());
          const plain = points.map((p): [number, number] => [unwrap(p[0]), unwrap(p[1])]);
          putRows(prior, polyRows(prior.geoms.length + 1, plain), '.polygon()');
          return handle;
        }
        outline = 'polygon';
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
        needOutline('.round()');
        const cur = findFeature(id) as SketchFeature;
        const k = cornerIndex('.round()', corner, cur.points?.length ?? 0);
        const r = requiredNumber('.round()', 'radius', radius);
        const rounds = { ...(cur.rounds ?? {}), [k]: num(r, id, `r${k}`) };
        replaceFeature(id, { ...cur, rounds });
        return handle;
      },
      chamfer(corner, distance) {
        needOutline('.chamfer()');
        const cur = findFeature(id) as SketchFeature;
        const k = cornerIndex('.chamfer()', corner, cur.points?.length ?? 0);
        const dist = requiredNumber('.chamfer()', 'distance', distance) as number;
        const chamfers = { ...(cur.chamfers ?? {}), [k]: dist };
        replaceFeature(id, { ...cur, chamfers });
        return handle;
      },
      across(edge) {
        needOutline('.across()');
        const cur = findFeature(id) as SketchFeature;
        const e = wholeIndex('.across()', 'edge', edge, cur.points.length);
        applyConstraint(id, { kind: 'horizontal', edge: e });
        return handle;
      },
      up(edge) {
        needOutline('.up()');
        const cur = findFeature(id) as SketchFeature;
        const e = wholeIndex('.up()', 'edge', edge, cur.points.length);
        applyConstraint(id, { kind: 'vertical', edge: e });
        return handle;
      },
      length(edge, value) {
        needOutline('.length()');
        const cur = findFeature(id) as SketchFeature;
        const e = wholeIndex('.length()', 'edge', edge, cur.points.length);
        const v = positiveNumber('.length()', 'value', value);
        applyConstraint(id, { kind: 'length', edge: e, value: num(v, id, `len${e}`) });
        return handle;
      },
      equal(edge, other) {
        needOutline('.equal()');
        const cur = findFeature(id) as SketchFeature;
        const count = cur.points.length;
        const a = wholeIndex('.equal()', 'edge', edge, count);
        const b = wholeIndex('.equal()', 'other', other, count);
        if (a === b) throw new Error('.equal() needs two DIFFERENT edges.');
        applyConstraint(id, { kind: 'equal', edge: Math.min(a, b), other: Math.max(a, b) });
        return handle;
      },
      parallel(edge, other) {
        needOutline('.parallel()');
        const cur = findFeature(id) as SketchFeature;
        const count = cur.points.length;
        const a = wholeIndex('.parallel()', 'edge', edge, count);
        const b = wholeIndex('.parallel()', 'other', other, count);
        if (a === b) throw new Error('.parallel() needs two DIFFERENT edges.');
        applyConstraint(id, { kind: 'parallel', edge: Math.min(a, b), other: Math.max(a, b) });
        return handle;
      },
      perpendicular(edge, other) {
        needOutline('.perpendicular()');
        const cur = findFeature(id) as SketchFeature;
        const count = cur.points.length;
        const a = wholeIndex('.perpendicular()', 'edge', edge, count);
        const b = wholeIndex('.perpendicular()', 'other', other, count);
        if (a === b) throw new Error('.perpendicular() needs two DIFFERENT edges.');
        applyConstraint(id, { kind: 'perpendicular', edge: Math.min(a, b), other: Math.max(a, b) });
        return handle;
      },
      pin(corner) {
        needOutline('.pin()');
        const cur = findFeature(id) as SketchFeature;
        const c = wholeIndex('.pin()', 'corner', corner, cur.points.length);
        applyConstraint(id, { kind: 'lock', corner: c });
        return handle;
      },
      distX(a, b, value) {
        needOutline('.distX()');
        const cur = findFeature(id) as SketchFeature;
        const count = cur.points.length;
        const i = wholeIndex('.distX()', 'corner', a, count);
        const j = wholeIndex('.distX()', 'other', b, count);
        if (i === j) throw new Error('.distX() needs two DIFFERENT corners.');
        const v = requiredNumber('.distX()', 'value', value);
        applyConstraint(id, {
          kind: 'distanceX', a: Math.min(i, j), b: Math.max(i, j),
          value: num(v, id, `dx${Math.min(i, j)}_${Math.max(i, j)}`),
        });
        return handle;
      },
      distY(a, b, value) {
        needOutline('.distY()');
        const cur = findFeature(id) as SketchFeature;
        const count = cur.points.length;
        const i = wholeIndex('.distY()', 'corner', a, count);
        const j = wholeIndex('.distY()', 'other', b, count);
        if (i === j) throw new Error('.distY() needs two DIFFERENT corners.');
        const v = requiredNumber('.distY()', 'value', value);
        applyConstraint(id, {
          kind: 'distanceY', a: Math.min(i, j), b: Math.max(i, j),
          value: num(v, id, `dy${Math.min(i, j)}_${Math.max(i, j)}`),
        });
        return handle;
      },
      symmetric(a, b, center) {
        needOutline('.symmetric()');
        const cur = findFeature(id) as SketchFeature;
        const count = cur.points.length;
        const i = wholeIndex('.symmetric()', 'corner', a, count);
        const j = wholeIndex('.symmetric()', 'other', b, count);
        const k = wholeIndex('.symmetric()', 'about corner', center, count);
        if (i === j) throw new Error('.symmetric() needs two DIFFERENT corners.');
        if (k === i || k === j) {
          throw new Error('.symmetric() needs the about corner to be a THIRD corner.');
        }
        // `center` is a corner INDEX, not a measurement, so it goes in raw --
        // the same way pin() passes its corner. num() exists to register a
        // param-name override for a bindable dimension; wrapping an index in
        // it (behind a double cast, which was the tell) claims a student could
        // put a slider on "which corner", which is not a thing.
        applyConstraint(id, {
          kind: 'symmetric', a: Math.min(i, j), b: Math.max(i, j), center: k,
        });
        return handle;
      },
      angle(edge, other, degrees) {
        needOutline('.angle()');
        const cur = findFeature(id) as SketchFeature;
        const count = cur.points.length;
        const i = wholeIndex('.angle()', 'edge', edge, count);
        const j = wholeIndex('.angle()', 'other', other, count);
        if (i === j) throw new Error('.angle() needs two DIFFERENT edges.');
        const v = requiredNumber('.angle()', 'degrees', degrees);
        applyConstraint(id, {
          kind: 'angle', edge: Math.min(i, j), other: Math.max(i, j),
          degrees: num(v, id, `ang${Math.min(i, j)}_${Math.max(i, j)}`),
        });
        return handle;
      },
      geom(rows) {
        // SPEC-sketcher2 §2.1: ids are dense and 1-BASED, id == index + 1.
        // The explicit id is validated, never silently renumbered: soup
        // constraints reference geometry by id, so a round trip that
        // renumbers dangles every constraint (§2.1).
        if (!Array.isArray(rows)) throw new Error('.geom() needs an array of geometry rows.');
        if (outline !== null && !hasRows()) {
          throw new Error(
            `.geom() would replace the ${outline} already drawn on this sketch. ` +
            `Put every shape in the .geom([...]) rows, or draw a second shape with .rect() / .circle() / .polygon(), which adds it beside the first.`,
          );
        }
        const cur = findFeature(id) as SketchFeature;
        const out: SoupGeom[] = [];
        rows.forEach((row: unknown, i: number) => {
          const g = readSoupGeom('.geom()', row);
          // A row's radius may be a param() reference (§6.2: any numeric
          // slot may hold one). num() records the slot-key -> name binding
          // that the round trip re-binds through; the doc keeps the RESOLVED
          // number, exactly like every other feature -- the kernel reads
          // these rows directly, so a string here is a refusal.
          if (g.k === 'circle') {
            num(g.r, id, `g${g.id}r`);
            g.r = unwrap(g.r);
          }
          if (g.k === 'arc') {
            num(g.r, id, `g${g.id}r`);
            g.r = unwrap(g.r);
          }
          if (g.id !== i + 1) {
            throw new Error(
              `.geom() row ${i + 1} says id ${g.id} but sits at position ${i + 1}. ` +
                'Soup ids are sketch-local and dense: row ' + (i + 1) + ' carries id ' + (i + 1) + '.',
            );
          }
          out.push(g);
        });
        replaceFeature(id, { ...cur, geoms: out, geom: out });
        return handle;
      },
      rules(rows) {
        if (!Array.isArray(rows)) throw new Error('.rules() needs an array of constraint rows.');
        const cur = findFeature(id) as SketchFeature;
        const geoms = cur.geoms ?? cur.geom ?? [];
        const kindOf = new Map<number, SoupGeom['k']>();
        for (const g of geoms) kindOf.set(g.id, g.k);
        // Built-ins are fixed by the kernel and nameable by every rule form
        // that takes a line or a point.
        const builtinKind = (gid: number): string | null => {
          if (gid === -1) return 'point';
          if (gid === -2 || gid === -3) return 'line';
          return null;
        };
        const out: SoupRule[] = [];
        rows.forEach((row: unknown, i: number) => {
          const r = readSoupRule('.rules()', row);
          // Point-ref validation (§2.2): a line exposes 'a' and 'b' only, a
          // circle only 'c' -- and the archived UI's latent NaN came from
          // exactly this check being missing (pointWorld() read line fields
          // for a Point and produced NaN silently).
          const check = (gref: number, end: unknown) => {
            if (end === undefined || end === null) return;
            const kind = builtinKind(gref) ?? kindOf.get(gref);
            if (!kind) {
              throw new Error(
                `.rules() row ${i + 1} names geometry ${gref}, which this sketch does not have.`,
              );
            }
            const valid =
              (kind === 'point' && end === 'a') ||
              (kind === 'line' && (end === 'a' || end === 'b')) ||
              (kind === 'circle' && end === 'c') ||
              kind === 'arc';
            if (!valid) {
              throw new Error(
                `.rules() row ${i + 1} names point '${end}' on geometry ${gref}, but a ${kind} has no '${end}'.`,
              );
            }
          };
          const rr = r as { a?: unknown; b?: unknown; aEnd?: unknown; bEnd?: unknown; c?: unknown; cEnd?: unknown };
          if (rr.a !== undefined) check(rr.a as number, rr.aEnd);
          if (rr.b !== undefined) check(rr.b as number, rr.bEnd);
          if (rr.c !== undefined) check(rr.c as number, rr.cEnd);
          // equal across kinds is refused, not coerced (O18): a radius is
          // not a length in the same sense, and picking a reading would be
          // guessing at what the user meant.
          if (r.k === 'equal') {
            const ka = builtinKind(r.a) ?? kindOf.get(r.a);
            const kb = builtinKind(r.b) ?? kindOf.get(r.b);
            const isLen = (t?: string | null) => t === 'line';
            const isRad = (t?: string | null) => t === 'circle' || t === 'arc';
            if (ka && kb && ((isLen(ka) && isRad(kb)) || (isRad(ka) && isLen(kb)))) {
              throw new Error(
                '.rules() equal between a line and a circle is not defined; constrain lengths to lengths or radii to radii.',
              );
            }
          }
          // Only a rule's numeric value becomes a panel slot, named
          // rule${i}-value with the 0-based rules index (D8). A param()
          // reference is stored IN THE DOC as the param's NAME (a string):
          // the whole reason rows beat a blob (§6.2) is that the doc keeps
          // the binding, so toScript can re-emit the name and a reload can
          // re-bind it. num() still runs for its slotOverride side effect.
          const value = (r as { value?: unknown }).value;
          if (value !== undefined) {
            // num() FIRST, always: its slotOverride side effect is the only
            // place the pname-key -> param-name correlation is recorded. The
            // doc keeps the RESOLVED NUMBER, like every other feature (a
            // cuboid's width, a ring's across): the emitter re-binds by slot
            // key through numText() (§6.2's own mechanism). Storing the NAME
            // here instead made the doc lie about its own types -- value is
            // number -- and three consumers measured tripping on it: the
            // kernel refused the build, the emitter wrote NaN for the radius,
            // and applyParam's slider no-op'd on typeof !== 'number'.
            const v0 = num(value, id, `rule${i}-value`);
            (r as { value: unknown }).value = v0;
          }
          out.push(r);
        });
        replaceFeature(id, { ...cur, rules: out });
        return handle;
      },
      slot(a, b, r) {
        const cA = readVec2('.slot()', 'a (one end cap centre)', a);
        const cB = readVec2('.slot()', 'b (the other end cap centre)', b);
        const rp = positiveNumber('.slot()', 'radius', r);
        const rv = unwrap(rp);
        if (cA[0] === cB[0] && cA[1] === cB[1]) {
          throw new Error(`.slot() needs two different end centres -- a and b are both [${cA[0]}, ${cA[1]}], which holds no slot.`);
        }
        const cur = findFeature(id) as SketchFeature;
        const had = priorRows('.slot()');
        const geoms = (had ? had.geoms : (cur.geoms ?? cur.geom ?? [])) as SoupGeom[];
        // Continue the sketch's dense 1-based ids (SPEC-sketcher2 §2.1).
        const base = geoms.reduce((m, g) => Math.max(m, g.id), 0) + 1;
        const built = buildSlotRows(cA, cB, rv, base);
        if (!built) {
          throw new Error(`.slot() could not build a slot from centres [${cA}] and [${cB}] with radius ${rv}.`);
        }
        // r may be a param(): num() records the slot-key -> name binding the
        // round trip re-binds through, one per arc (both arcs share the value).
        for (const g of built.geoms) {
          if (g.k === 'arc') {
            num(rp, id, `g${g.id}r`);
            g.r = rv;
          }
        }
        const rules = (had ? had.rules : (cur.rules ?? [])) as SoupRule[];
        const outGeoms = [...geoms, ...(built.geoms as unknown as SoupGeom[])];
        replaceFeature(id, {
          ...cur, geoms: outGeoms, geom: outGeoms,
          ...(had && !hasRows() ? { points: starter.map((p): [number, number] => [p[0], p[1]]), shape: undefined, rounds: undefined, chamfers: undefined, bulges: undefined, constraints: RECTANGLE_CONSTRAINTS.slice() } : {}),
          rules: [...rules, ...(built.rules as unknown as SoupRule[])],
        });
        return handle;
      },
    };
    return handle;
  }

  /** The direction extras of pull()/pocket(): `{ reversed, midplane, length2 }` (and `through` for a pocket), read off the end of
   *  the call. Plain true/false and a positive number only -- a param() here would need a slot of its own. */
  function readDirection(fn: string, opts: unknown, allowThrough: boolean): {
    reversed?: boolean; midplane?: boolean; length2?: number; through?: boolean;
    taper?: number; direction?: [number, number, number]; alongNormal?: boolean;
  } {
    const allowed = allowThrough
      ? ['reversed', 'midplane', 'length2', 'through', 'taper', 'direction', 'alongNormal']
      : ['reversed', 'midplane', 'length2', 'taper', 'direction', 'alongNormal'];
    const o = readOptions(fn, allowed, opts);
    const out: {
      reversed?: boolean; midplane?: boolean; length2?: number; through?: boolean;
      taper?: number; direction?: [number, number, number]; alongNormal?: boolean;
    } = {};
    for (const k of ['reversed', 'midplane', 'through'] as const) {
      if (o[k] === undefined) continue;
      if (typeof o[k] !== 'boolean') throw new Error(`${fn}'s ${k} is true or false, like ${fn}(..., { ${k}: true }). You gave it ${describe(o[k])}.`);
      if (o[k]) out[k] = true;
    }
    if (o.length2 !== undefined) {
      const n = unwrap(o.length2 as number);
      if (typeof n !== 'number' || !(n > 0) || !Number.isFinite(n)) throw new Error(`${fn}'s length2 is the second length, a positive number. You gave it ${describe(o.length2)}.`);
      out.length2 = n;
    }
    if (o.taper !== undefined) {
      const n = unwrap(o.taper as number);
      if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) >= 90) throw new Error(`${fn}'s taper is an angle in degrees between -90 and 90, like ${fn}(..., { taper: 5 }). You gave it ${describe(o.taper)}.`);
      if (n !== 0) out.taper = n;
    }
    if (o.direction !== undefined) {
      const d = Array.isArray(o.direction) ? (o.direction as unknown[]).map((c) => unwrap(c as number)) : o.direction;
      if (!Array.isArray(d) || d.length !== 3 || d.some((c) => typeof c !== 'number' || !Number.isFinite(c))) {
        throw new Error(`${fn}'s direction is three numbers [x, y, z], like ${fn}(..., { direction: [1, 0, 1] }). You gave it ${describe(d)}.`);
      }
      if (d.every((c) => c === 0)) throw new Error(`${fn}'s direction [0, 0, 0] points nowhere. Give it at least one non-zero number.`);
      out.direction = [d[0], d[1], d[2]] as [number, number, number];
    }
    if (o.alongNormal !== undefined) {
      if (typeof o.alongNormal !== 'boolean') throw new Error(`${fn}'s alongNormal is true or false. You gave it ${describe(o.alongNormal)}.`);
      if (o.alongNormal === false) out.alongNormal = false;
    }
    if (out.alongNormal === false && !out.direction) {
      throw new Error(`${fn}'s alongNormal only matters with a direction: add direction: [x, y, z], or drop alongNormal.`);
    }
    if (out.midplane && out.length2 !== undefined) {
      throw new Error(`${fn}() takes midplane (the same length either side) or length2 (a second length the other way), not both.`);
    }
    return out;
  }

  function pull(sk: unknown, height: unknown, opts?: unknown, ...extra: unknown[]): SolidHandle {
    // The trailing { } object is the direction options; anything else there is a stray argument and is named as one.
    const known = opts !== undefined && isPlainOptions(opts) && Object.keys(opts).every((k) => ['reversed', 'midplane', 'length2', 'taper', 'direction', 'alongNormal'].includes(k));
    if (known) noExtraArgs('pull', 'a sketch and a height', 3, extra, 'To move the result, use move(...).');
    else noExtraArgs('pull', 'a sketch and a height', 2, opts === undefined ? extra : [opts, ...extra], 'To move the result, use move(...).');
    if (!isSketchHandle(sk)) throw new Error(`pull() needs a sketch: pull(sketch('top'), height).`);
    requiredNumber('pull', 'height', height);
    const dir = readDirection('pull', opts, false);
    const f = newExtrude(docNow(), sk.id);
    f.height = num(height, f.id, 'height');
    Object.assign(f, dir);
    pushFeature(f);
    return makeSolidHandle(f);
  }

  function spin(sk: unknown, angle: unknown, ...extra: unknown[]): SolidHandle {
    noExtraArgs('spin', 'a sketch and an angle', 2, extra, 'To move the result, use move(...).');
    if (!isSketchHandle(sk)) throw new Error(`spin() needs a sketch: spin(sketch('top'), angle).`);
    requiredNumber('spin', 'angle', angle);
    spinAngle(angle);
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
  function blend(a: unknown, b: unknown, gap: unknown, ...extra: unknown[]): SolidHandle {
    noExtraArgs('blend', 'two sketches and a gap', 3, extra);
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

  /** SPEC-brep-feature-provenance 5.2b: parse the recess options onto the hole.
   *
   *  The split of responsibility is deliberate and is not re-argued per option.
   *  This validates only what is nonsensical REGARDLESS of geometry: types,
   *  positivity, an included angle over 90, and the two being mutually exclusive.
   *  Genuine geometric degeneracy -- a counterbore wider than its bore, or deeper
   *  than it -- is deliberately NOT checked here. That has to reach the kernel
   *  and come back as a refusal sentence, because a script error would tell the
   *  student they typed something malformed, when in fact they asked for
   *  something impossible. Both answers are correct; they answer different
   *  questions.
   *
   *  The kernel has cut both recesses since 37c6091 and 8abd28f; until this
   *  existed nothing in the language could ask for them.
   */
  function applyRecess(fn: string, base: ReturnType<typeof newHole>, extra: Record<string, unknown>): void {
    const cb = extra.counterbore;
    const cs = extra.countersink;
    if (cb !== undefined && cs !== undefined) {
      throw new Error(
        `${fn}(): a hole takes a counterbore OR a countersink, not both -- one mouth, one shape.`,
      );
    }
    if (cb !== undefined) {
      const o = readOptions('counterbore', ['across', 'deep'], cb);
      if (o.across === undefined) {
        throw new Error(`${fn}(): counterbore needs { across: <number> } for the recess's diameter.`);
      }
      if (o.deep === undefined) {
        throw new Error(`${fn}(): counterbore needs { deep: <number> } for how far the recess is cut.`);
      }
      base.counterbore = {
        diameter: num(positiveNumber(fn, 'counterbore across', o.across), base.id, 'diameter'),
        depth: num(positiveNumber(fn, 'counterbore deep', o.deep), base.id, 'depth'),
      };
    }
    if (cs !== undefined) {
      const o = readOptions('countersink', ['across', 'angle'], cs);
      if (o.across === undefined) {
        throw new Error(`${fn}(): countersink needs { across: <number> } for its width at the mouth.`);
      }
      if (o.angle === undefined) {
        throw new Error(`${fn}(): countersink needs { angle: <number> } for the included cone angle (90 is the usual choice).`);
      }
      const angleDeg = num(positiveNumber(fn, 'countersink angle', o.angle), base.id, 'angleDeg');
      if (angleDeg > 90) {
        throw new Error(
          `${fn}(): a countersink's angle is its INCLUDED cone angle, so 90 is the widest -- got ${angleDeg}.`,
        );
      }
      base.countersink = {
        diameter: num(positiveNumber(fn, 'countersink across', o.across), base.id, 'diameter'),
        angleDeg,
      };
    }
  }

  /** Depth for a hole with no deep: -- it must go THROUGH. Never a guess: a
   *  shape whose thickness cannot be bounded is a script error, because the
   *  old flat 10 mm default silently drilled a blind hole into thicker parts. */
  function throughDepth(fn: string, target: SolidHandle, axis: Axis3): number {
    const extent = throughExtentAlong(docNow(), target.id, axis);
    if (extent == null) {
      throw new Error(
        `${fn}() cannot find how thick this ${findFeature(target.rootId).kind} is along ${axis} yet, so it cannot drill all the way through. Give it a depth: ${fn}(shape, { across: 4, deep: 20 }).`,
      );
    }
    return extent + 2;
  }

  /** A blind `deep:` must START AT THE DRILLED FACE: the kernel centres a hole's
   *  tool on the target's bbox centre, so the axial component of center is set
   *  to (thickness - deep) / 2 (see holeAxialOffset). That needs the EXACT
   *  thickness:
   *   - exact: the offset is set.
   *   - only an upper bound (a cut result, a prism across its corners): a deep
   *     that stops short of the bound cannot be placed, so it is a plain error --
   *     a wrong offset would float a cavity or start the hole short of the face.
   *   - nothing known (a rotated shape, a polar pattern ...): the offset stays 0
   *     and the hole is centred. That still builds, and the kernel refuses a
   *     tool that would leave a sealed cavity inside the part, so the student
   *     gets a sentence rather than a wrong solid (pinned in
   *     silent-noop-errors.test.mjs and hole-extent-extrude.test.mjs). */
  function blindOffset(fn: string, target: SolidHandle, axis: Axis3, deep: number, center: Vec3): void {
    const off = holeAxialOffset(docNow(), target.id, axis, deep);
    if (off != null) {
      center[axis === 'x' ? 0 : axis === 'y' ? 1 : 2] = off;
      return;
    }
    const known = extentBoundAlong(docNow(), target.id, axis);
    if (known && !known.exact) {
      throw new Error(
        `${fn}() cannot find where the top of this ${findFeature(target.rootId).kind} is along ${axis} exactly, so a hole that stops short of the other side cannot start at the top. Make it go all the way through (leave out deep:, or give a deep: at least ${known.extent}), or drill the shape before it is cut.`,
      );
    }
  }

  // ISO 273 medium-fit clearance diameters (mm), M3..M12. A CLEARANCE table
  // (the bolt passes through), not a tap drill. `size:` is interpret-time
  // sugar: it resolves to `across` here and the name is never persisted, so
  // toScript emits the resolved across, like the name aliases.
  const HOLE_SIZES: Record<string, number> = {
    M3: 3.4, M4: 4.5, M5: 5.5, M6: 6.6, M8: 9, M10: 11, M12: 13.5,
  };
  function resolveHoleSize(fn: string, extra: Record<string, unknown>): void {
    if (extra.size === undefined) return;
    if (extra.across !== undefined) {
      throw new Error(`${fn}() takes { size: 'M6' } OR { across: 6.6 }, not both -- size is a name for an across.`);
    }
    const key = typeof extra.size === 'string' ? extra.size.trim().toUpperCase() : '';
    if (!Object.prototype.hasOwnProperty.call(HOLE_SIZES, key)) {
      throw new Error(
        `${fn}() does not know the size ${describe(extra.size)}. Sizes are ${Object.keys(HOLE_SIZES).join(', ')} (clearance holes), or give { across: <number> }.`,
      );
    }
    extra.across = HOLE_SIZES[key];
    delete extra.size;
  }

  function hole(target: unknown, opts?: unknown): SolidHandle {
    if (!isHandle(target)) throw new Error('hole() needs a shape to drill into: hole(shape, { across: 6 }).');
    const extra = readOptions('hole', ['across', 'size', 'deep', 'at', 'along', 'counterbore', 'countersink'], opts);
    resolveHoleSize('hole', extra);
    if (extra.across === undefined) throw new Error('hole() needs { across: <number> } for the bit\'s diameter.');
    const across = positiveNumber('hole', 'across', extra.across);
    const base = newHole(docNow(), target.id);
    const { axis, center } = holeAxisAndCenter('hole', base.id, extra);
    base.axis = axis;
    base.diameter = num(across, base.id, 'diameter');
    if (extra.deep !== undefined) {
      base.depth = num(positiveNumber('hole', 'deep', extra.deep), base.id, 'depth');
      blindOffset('hole', target, axis, base.depth, center);
    } else {
      base.depth = throughDepth('hole', target, axis);
    }
    base.center = center;
    applyRecess('hole', base, extra);
    pushFeature(base);
    mutateHandle(target, base);
    return target;
  }

  function holes(target: unknown, opts?: unknown): SolidHandle {
    if (!isHandle(target)) throw new Error('holes() needs a shape to drill into: holes(shape, { across: 6, apart: [15, 10] }).');
    const extra = readOptions('holes', ['across', 'size', 'apart', 'at', 'along', 'deep', 'counterbore', 'countersink'], opts);
    resolveHoleSize('holes', extra);
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
      blindOffset('holes', target, axis, base.depth, center);
    } else {
      base.depth = throughDepth('holes', target, axis);
    }
    base.center = center;
    base.corners = {
      dx: num(spanX, base.id, 'dx') / 2,
      dy: num(spanY, base.id, 'dy') / 2,
    };
    applyRecess('holes', base, extra);
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

  function round(arg: unknown, size: unknown, ...extra: unknown[]): SolidHandle {
    noExtraArgs('round', 'a shape or edge and a size', 2, extra, 'To pick the edge, use shape.edge(faceA, faceB).');
    const s = requiredNumber('round', 'size', size);
    if (Array.isArray(arg)) return eachEdge('round', arg, (e) => round(e, size));
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

  /** round() / bevel() of a list of edges (part.rim(sk)): one feature per edge, in order. */
  function eachEdge(fn: string, edges: unknown[], one: (e: TopoRef) => SolidHandle): SolidHandle {
    if (edges.length === 0 || !edges.every((e) => isTopoRef(e) && e.name.cause === 'between')) {
      throw new Error(`${fn}() on a list needs a list of edges, like ${fn}(part.rim(sketch2), 1).`);
    }
    let last!: SolidHandle;
    for (const e of edges as TopoRef[]) last = one(e);
    return last;
  }

  function bevel(arg: unknown, size: unknown): SolidHandle {
    if (Array.isArray(arg)) { requiredNumber('bevel', 'size', size); return eachEdge('bevel', arg, (e) => bevel(e, size)); }
    if (isHandle(arg)) {
      throw new Error('bevel() needs one edge: a whole shape is not supported yet -- chamfer one edge with bevel(shape.edge(faceA, faceB), size), or round the whole box or cylinder with fillet(shape, size).');
    }
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

  // ---- pattern of a cut: N transformed copies of the CUT, never of the solid ----
  //
  // The kernel's pattern feature copies the whole target solid and unions the copies. For a pocket that is wrong twice over:
  // the copies overlap each other, and the union refills every hole. So a pattern whose target is a pocket is lowered here
  // into count - 1 more sketches (the first one rigidly moved) and pockets, each cutting into the one before. The original
  // pocket stays as copy 0. The kernel then sees only pockets, which it either cuts exactly or refuses in a sentence.
  type Frame3 = { origin: Vec3; u: Vec3; v: Vec3; n: Vec3 };
  const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  /** A pad is `join(base, pull(sketch, h))`: a union of exactly two shapes whose second is a plain pull of a sketch. */
  const isPadFeature = (f: Feature): f is CombineFeature =>
    f.kind === 'combine' && f.op === 'union' && f.targets.length === 2 && findFeature(f.targets[1]).kind === 'extrude';
  const isPocketTarget = (t: SolidHandle) => { const f = findFeature(t.id); return f.kind === 'pocket' || isPadFeature(f); };
  const isHoleTarget = (t: SolidHandle) => { const f = findFeature(t.id); return f.kind === 'hole'; };


  // ---- later features: a pattern or mirror of a handle that has been cut or padded since ----
  // pocket(), hole() and join() hand back a NEW handle and leave the old one pointing at the old feature. A mirror or pattern
  // built from the old handle would branch off there and leave the later features on a dead branch, out of the final shape. So
  // the new feature is chained onto the END of the line of features that were built on the target.
  const bodyInputOf = (f: Feature): string | null => {
    switch (f.kind) {
      case 'pocket': case 'groove': return f.into;
      case 'combine': return f.targets[0] ?? null;
      case 'hole': case 'shell': case 'fillet': case 'draft': case 'rotate': case 'mirror': case 'pattern': return f.target;
      case 'move': return f.copy ? null : f.target;
      default: return null;
    }
  };
  /** The last feature built on `from` (or `from` itself). `allowed` says which kinds the line may run through; any other
   *  feature built on it, or a fork, is refused in a sentence by `refuse`. */
  function tipOf(from: Feature, allowed: (f: Feature) => boolean, refuse: (why: string) => never): Feature {
    let cur = from;
    for (let guard = 0; guard < 256; guard++) {
      const next = docNow().features.filter((f) => f.id !== cur.id && bodyInputOf(f) === cur.id);
      if (next.length === 0) return cur;
      if (next.length > 1) return refuse('more than one later feature was built on this shape, so there is no single part to add to');
      if (!allowed(next[0])) return refuse(`a later ${next[0].kind} was built on this shape, and a copy added after it could not stay in step with it`);
      cur = next[0];
    }
    return cur;
  }
  const tipAny = (from: Feature): Feature => tipOf(from, () => true, (why) => { throw new Error(`This shape cannot be copied yet: ${why}. Copy it before building on it.`); });

  function rotateAbout(axis: 'x' | 'y' | 'z', deg: number): (p: Vec3) => Vec3 {
    const c = Math.cos((deg * Math.PI) / 180);
    const s = Math.sin((deg * Math.PI) / 180);
    return (p) => {
      const [x, y, z] = p;
      if (axis === 'x') return [x, c * y - s * z, s * y + c * z];
      if (axis === 'y') return [c * x + s * z, y, -s * x + c * z];
      return [c * x - s * y, s * x + c * y, z];
    };
  }

  // ---- do the copies of the cut stay clear of each other and of the rim? ----
  // The kernel cuts the pockets one after another. Where two cuts overlap, or a cut breaks out through the rim of the part, it
  // keeps the faces split where the reference modeller (FreeCAD) merges them, so the solid has the right volume but a different
  // face count. Rather than hand back a part that disagrees with the reference, such a pattern is refused in a sentence.
  type Flat = { c: [number, number]; r: number } | { poly: Array<[number, number]> };
  /** The sketch as the part is built from it. A sketch with rules (a .length(), an .equal(), ...) keeps its points as drawn here;
   *  they are solved when the document is adopted (model-codegen's solveDoc). Anything that reads or copies the OUTLINE has to
   *  read the solved one, through that same function, or it measures (or copies) a shape the part never has. */
  const solvedSketch = (sk: SketchFeature): SketchFeature => {
    if (!sk.constraints || sk.constraints.length === 0) return sk;
    return solveDoc({ version: 1, features: [sk] }).features[0] as SketchFeature;
  };
  const flatOf = (sk: SketchFeature, map: (a: number, b: number) => [number, number]): Flat => {
    const circ = circleOf(sk);
    if (circ) return { c: map(circ.center[0], circ.center[1]), r: circ.radius };
    return { poly: tessellate(sk).map(([a, b]) => map(a, b)) };
  };
  const polyOfFlat = (f: Flat): Array<[number, number]> => {
    if ('poly' in f) return f.poly;
    const N = 96, R = f.r / Math.cos(Math.PI / N); // circumscribed: never smaller than the circle
    return Array.from({ length: N }, (_, i) => [f.c[0] + R * Math.cos((2 * Math.PI * i) / N), f.c[1] + R * Math.sin((2 * Math.PI * i) / N)] as [number, number]);
  };
  const inPoly = (pt: [number, number], poly: Array<[number, number]>): boolean => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const segsCross = (a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean => {
    const o = (p: [number, number], q: [number, number], r: [number, number]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const [o1, o2, o3, o4] = [o(a, b, c), o(a, b, d), o(c, d, a), o(c, d, b)];
    // two segments on one line only meet if their spans overlap (the edges of two squares side by side share a line)
    if (o1 === 0 && o2 === 0 && o3 === 0 && o4 === 0) {
      const ax = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 0 : 1;
      return Math.max(Math.min(a[ax], b[ax]), Math.min(c[ax], d[ax])) <= Math.min(Math.max(a[ax], b[ax]), Math.max(c[ax], d[ax]));
    }
    return o1 * o2 <= 0 && o3 * o4 <= 0;
  };
  const polysTouch = (A: Array<[number, number]>, B: Array<[number, number]>): boolean => {
    for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) {
      if (segsCross(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length])) return true;
    }
    return inPoly(A[0], B) || inPoly(B[0], A);
  };
  /** [x0, y0, x1, y1] when the flat is an axis-aligned rectangle, else null */
  const rectOfFlat = (f: Flat): [number, number, number, number] | null => {
    if (!('poly' in f)) return null;
    const pts = f.poly.filter((q, i, all) => i === 0 || Math.hypot(q[0] - all[i - 1][0], q[1] - all[i - 1][1]) > 1e-12);
    if (pts.length === 5 && Math.hypot(pts[0][0] - pts[4][0], pts[0][1] - pts[4][1]) < 1e-12) pts.pop();
    if (pts.length !== 4) return null;
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    if (!(x1 - x0 > 1e-9 && y1 - y0 > 1e-9)) return null;
    const onSide = (q: [number, number]) => (Math.abs(q[0] - x0) < 1e-9 || Math.abs(q[0] - x1) < 1e-9) && (Math.abs(q[1] - y0) < 1e-9 || Math.abs(q[1] - y1) < 1e-9);
    return pts.every(onSide) && new Set(pts.map((q) => q.join(','))).size === 4 ? [x0, y0, x1, y1] : null;
  };
  const flatsTouch = (a: Flat, b: Flat): boolean => {
    if ('c' in a && 'c' in b) return Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1]) <= a.r + b.r + 1e-6;
    return polysTouch(polyOfFlat(a), polyOfFlat(b));
  };
  /** true when `cut` lies strictly inside `host` */
  const flatInside = (cut: Flat, host: Flat): boolean => {
    if ('c' in cut && 'c' in host) return Math.hypot(cut.c[0] - host.c[0], cut.c[1] - host.c[1]) + cut.r < host.r - 1e-6;
    const hp = polyOfFlat(host);
    const cp = polyOfFlat(cut);
    return cp.every((q) => inPoly(q, hp)) && !hp.some((q, i) => cp.some((_, j) => segsCross(q, hp[(i + 1) % hp.length], cp[j], cp[(j + 1) % cp.length])));
  };

  /** Lower a pattern of a pocket into copies of the cut. `place(k)` maps a world point of copy 0 to copy k (a rigid move).
   *  A sketch on a named plane keeps its plane, so `planeKept(n)` says whether the move leaves a plane with normal n in place
   *  (a slide along it, or a spin about its normal); a sketch with its own frame just has the frame moved. */
  function patternOfCut(
    fn: string, target: SolidHandle, count: number,
    place: (k: number) => (p: Vec3) => Vec3, planeKept: (n: Vec3) => boolean,
    improper = false,
    slides = false,
    turns = false,
  ): SolidHandle {
    const tf = findFeature(target.id);
    const isPad = isPadFeature(tf);
    const pk = (isPad ? findFeature((tf as CombineFeature).targets[1]) : tf) as PocketFeature | ExtrudeFeature;
    const sk = findFeature(pk.target) as SketchFeature;
    const refuse = (why: string): never => {
      throw new Error(isPad
        ? `${fn}() of a pad adds a copy of the pad at each place, and ${why}. Add the extra pads yourself, one sketch and join(shape, pull(...)) each.`
        : `${fn}() of a pocket cuts a copy of the pocket at each place, and ${why}. Cut the extra pockets yourself, one sketch and pocket(...) each.`);
    };
    if (sk.kind !== 'sketch') refuse('this pocket does not come from a flat sketch');
    if ((sk.geoms && sk.geoms.length) || (sk.geom && sk.geom.length)) refuse('its sketch is built from free-standing geometry and rules, which cannot be moved as a whole');
    const fr = sketchFrameOf(sk) as Frame3;
    const at = (a: number, b: number): Vec3 => [
      fr.origin[0] + a * fr.u[0] + b * fr.v[0], fr.origin[1] + a * fr.u[1] + b * fr.v[1], fr.origin[2] + a * fr.u[2] + b * fr.v[2],
    ];
    // plane coordinates (along the sketch's own u, v) of every copy of the cut, 0 = the original
    const worldOf = (k: number) => {
      const mv = k === 0 ? (p: Vec3) => p : place(k);
      return (a: number, b: number): [number, number] => {
        const w = mv(at(a, b));
        return [dot3(sub3(w, fr.origin), fr.u), dot3(sub3(w, fr.origin), fr.v)];
      };
    };
    // the outline the part is cut with: a sketch with rules is measured, and copied, as its rules solve it
    const skS = solvedSketch(sk);
    const flats: Flat[] = [];
    for (let k = 0; k < count; k++) flats.push(flatOf(skS, worldOf(k)));
    // Round copies slid along a line and cut one after another leave the same faces FreeCAD does (each surviving stretch of a
    // hole wall is one face, even across the wall's seam), so overlapping round copies of a slide are built, not refused. Any
    // other overlap (a reflection, a pad, a polygon) is still refused: its faces do not match FreeCAD's yet. Round copies
    // turned about an axis (repeatAround) are built the same way: measured against FreeCAD, volume, box and face count.
    const circlesOverlapCleanly = (slides || turns) && !isPad && flats.every((fl) => 'c' in fl);
    // A rectangular pocket reflected across a plane square to the part: both copies are rectangles that span the same stretch
    // across the mirror, so wherever they overlap their union is one rectangle, and the kernel cutting the two one after the
    // other leaves the very faces FreeCAD gives for that rectangle (measured on the mirror sweep, volume, box and face count).
    const rectsMirrored = improper && !isPad && flats.length === 2;
    const rA = rectsMirrored ? rectOfFlat(flats[0]) : null, rB = rectsMirrored ? rectOfFlat(flats[1]) : null;
    const sameSpan = (lo0: number, hi0: number, lo1: number, hi1: number) => Math.abs(lo0 - lo1) < 1e-9 && Math.abs(hi0 - hi1) < 1e-9;
    const mirrorRects = rA && rB && (sameSpan(rA[0], rA[2], rB[0], rB[2]) || sameSpan(rA[1], rA[3], rB[1], rB[3]));
    // A reflection that maps the cut onto itself (a round or polygonal cut centred or symmetric ON the mirror plane, the plane
    // standing square to the sketch) is the original cut again: FreeCAD's mirrored cut is that single cut, so the copy is
    // left out rather than refused as an overlap. It must be the same region in the same plane, pushed the same way.
    const dropped = new Set<number>();
    const sameFlat = (a: Flat, b: Flat): boolean => {
      const E = 1e-9;
      if ('c' in a && 'c' in b) return Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1]) < E && Math.abs(a.r - b.r) < E;
      if ('poly' in a && 'poly' in b) {
        const key = (q: [number, number]) => `${Math.round(q[0] / 1e-7)},${Math.round(q[1] / 1e-7)}`;
        const A = new Set(a.poly.map(key));
        const B = new Set(b.poly.map(key));
        return A.size === B.size && [...A].every((k) => B.has(k));
      }
      return false;
    };
    if (improper && !isPad) {
      for (let k = 1; k < count; k++) {
        const mv = place(k);
        const o2 = mv(fr.origin), n2 = sub3(mv([fr.origin[0] + fr.n[0], fr.origin[1] + fr.n[1], fr.origin[2] + fr.n[2]]), o2);
        const inPlane = Math.abs(dot3(sub3(o2, fr.origin), fr.n)) < 1e-9;
        const sameWay = Math.abs(dot3(n2, fr.n) - 1) < 1e-9;
        if (inPlane && sameWay && sameFlat(flats[0], flats[k])) dropped.add(k);
      }
    }
    for (let i = 0; i < flats.length; i++) for (let j = i + 1; j < flats.length; j++) {
      if (mirrorRects) continue;
      if (dropped.has(i) || dropped.has(j)) continue;
      // circles that only just touch (or nearly) leave a pinched, zero-width web the kernel cannot close: a clean overlap needs
      // the centres strictly inside r1+r2 by a real margin
      const a = flats[i], b = flats[j];
      const pinched = 'c' in a && 'c' in b
        && Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1]) >= (a.r + b.r) * (1 - 1e-3);
      if (flatsTouch(a, b) && (!circlesOverlapCleanly || pinched)) {
        refuse(`copy ${i + 1} and copy ${j + 1} of the cut overlap each other, so brep-rs cannot yet join overlapping cuts into the same single part FreeCAD gives`);
      }
    }
    // ---- does each copy land on the part? ----
    // The part being cut is followed back through its earlier pockets and holes to the shapes it was built from, and a join is
    // followed into EVERY shape it joins: a copy that misses the first shape can still land on a later pad. Each such member
    // gives its cross-section in the plane of the cut when it is a plain box, an upright cylinder cut square to its axis, or a
    // straight pull of a plain sketch (its outline, solved); any other shape gives only its bounding box, which bounds where the
    // shape can be but is never its outline.
    type Member = { kind: Feature['kind']; flat: Flat | null; box: Flat | null };
    const toPlane = (w: Vec3): [number, number] => [dot3(sub3(w, fr.origin), fr.u), dot3(sub3(w, fr.origin), fr.v)];
    const worldAxis = (v: Vec3): 0 | 1 | 2 | null => {
      const i = [0, 1, 2].find((a) => Math.abs(Math.abs(v[a]) - 1) < 1e-9);
      return i === undefined ? null : (i as 0 | 1 | 2);
    };
    const boxOf = (id: string): Flat | null => {
      const iu = worldAxis(fr.u), iv = worldAxis(fr.v);
      if (iu === null || iv === null) return null;
      const AX = ['x', 'y', 'z'] as const;
      const ru = featureRangeAlong(docNow(), id, AX[iu]), rv = featureRangeAlong(docNow(), id, AX[iv]);
      if (!ru || !rv) return null;
      const w = (x: number, y: number): [number, number] => {
        const p: Vec3 = [fr.origin[0], fr.origin[1], fr.origin[2]];
        p[iu] = x; p[iv] = y;
        return toPlane(p);
      };
      return { poly: [w(ru.lo, rv.lo), w(ru.hi, rv.lo), w(ru.hi, rv.hi), w(ru.lo, rv.hi)] };
    };
    const memberOf = (h: Feature): Member => {
      const box = boxOf(h.id);
      if (h.kind === 'box' && !(h.rotate && h.rotate.some((d) => d)) && !h.round) {
        // a plain box: its cross-section in the plane of the cut, when that plane stands square to one of the box's axes
        const m = worldAxis(fr.n);
        if (m !== null) {
          const [i, j] = [0, 1, 2].filter((a) => a !== m);
          const corner = (si: number, sj: number): [number, number] => {
            const w: Vec3 = [0, 0, 0];
            w[m] = fr.origin[m]; w[i] = h.center[i] + si * h.size[i] / 2; w[j] = h.center[j] + sj * h.size[j] / 2;
            return toPlane(w);
          };
          return { kind: h.kind, flat: { poly: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)] }, box };
        }
      }
      if (h.kind === 'cylinder' && !(h.rotate && h.rotate.some((d) => d)) && !h.round && worldAxis(fr.n) === 2) {
        // an upright cylinder cut square to its axis (z): its cross-section is a disc, at any height
        return { kind: h.kind, flat: { c: toPlane([h.center[0], h.center[1], fr.origin[2]]), r: h.radius }, box };
      }
      if (h.kind === 'extrude' && !h.taper && !h.direction) {
        // a straight pull (a taper or a slant carries its walls off the sketch outline, so that outline would be wrong here)
        const hs = findFeature(h.target);
        if (hs.kind === 'sketch' && !(hs.geoms && hs.geoms.length) && !(hs.geom && hs.geom.length)) {
          const hf = sketchFrameOf(hs) as Frame3;
          if (Math.abs(Math.abs(dot3(hf.n, fr.n)) - 1) < 1e-9) {
            const flat = flatOf(solvedSketch(hs), (a, b) => toPlane([
              hf.origin[0] + a * hf.u[0] + b * hf.v[0], hf.origin[1] + a * hf.u[1] + b * hf.v[1], hf.origin[2] + a * hf.u[2] + b * hf.v[2],
            ]));
            return { kind: h.kind, flat, box };
          }
        }
      }
      return { kind: h.kind, flat: null, box };
    };
    const members: Member[] = [];
    const visit = (id: string, depth: number): void => {
      let h = findFeature(id);
      for (let guard = 0; guard < 64; guard++) {
        if (h.kind === 'pocket') { h = findFeature(h.into); continue; }
        if (h.kind === 'hole') { h = findFeature(h.target); continue; }
        break;
      }
      if (h.kind === 'combine' && h.op === 'union' && h.targets.length > 0 && depth < 16) {
        for (const t of h.targets) visit(t, depth + 1);
        return;
      }
      members.push(memberOf(h));
    };
    visit(isPad ? (tf as CombineFeature).targets[0] : (pk as PocketFeature).into, 0);
    const known = members.filter((m): m is Member & { flat: Flat } => m.flat !== null);
    const unknown = members.filter((m) => m.flat === null);
    // a slanted or tapered cut (or pad) runs out past its own sketch outline as it goes, so its outline in the plane says
    // nothing about what it misses
    const straight = !(pk.taper || pk.direction);
    // Copies of a slide (linearPattern / repeat) that lie wholly clear of a part made only of straight pulls cut nothing:
    // FreeCAD leaves them out (measured), so they are dropped here. Only when the outline of EVERY shape joined into the part
    // is known, and never for a pad (it adds material off the part), a turn, a reflection, a box or a cylinder (not measured),
    // or a slanted or tapered cut. A copy off the part that is not dropped is refused in a sentence, never left out silently.
    const mayDrop = slides && !improper && !isPad && straight && known.length > 0 && unknown.length === 0
      && members.every((m) => m.kind === 'extrude');
    const what = isPad ? 'pad' : 'cut';
    const reach = (n: number) => members.length > 1
      ? `copy ${n} of the ${what} runs across where two shapes of the part are joined, or reaches the part's edge, so brep-rs cannot yet match the faces FreeCAD gives there`
      : isPad
        ? `copy ${n} of the pad reaches the edge of the part, so brep-rs cannot yet join it over an edge and match the face count FreeCAD gives`
        : `copy ${n} of the cut reaches the edge of the part, so brep-rs cannot yet cut through an edge and match the face count FreeCAD gives`;
    const off = (n: number) => isPad
      ? `copy ${n} of the pad lies wholly off the part, so it would stand apart from it`
      : `copy ${n} of the cut lies wholly off the part, so it would cut nothing`;
    const single = members.length === 1 ? known[0] : undefined;
    flats.forEach((fl, i2) => {
      const n = i2 + 1;
      if (known.some((m) => flatInside(fl, m.flat))) return;
      // a mirrored rectangle that runs out through ONE straight side of a rectangular part (and stays clear of the other
      // sides) is one pocket open at that side, which is how the kernel and FreeCAD both cut it
      const hr = single && mirrorRects ? rectOfFlat(single.flat) : null, cr = rectOfFlat(fl);
      if (hr && cr && rA && rB) {
        const e = 1e-9;
        const out = [cr[0] < hr[0] - e, cr[1] < hr[1] - e, cr[2] > hr[2] + e, cr[3] > hr[3] + e];
        const ok = [cr[0] > hr[0] + e, cr[1] > hr[1] + e, cr[2] < hr[2] - e, cr[3] < hr[3] - e];
        const sides = out.filter(Boolean).length;
        if (sides === 1 && out.every((o, k) => o || ok[k]) && cr[0] < hr[2] - e && cr[2] > hr[0] + e && cr[1] < hr[3] - e && cr[3] > hr[1] + e) return;
      }
      if (known.some((m) => flatsTouch(fl, m.flat))) refuse(reach(n));
      if (unknown.length === 0) {
        if (mayDrop && i2 > 0) { dropped.add(i2); return; }
        refuse(off(n));
      }
      // a shape whose outline is not known: a straight copy clear of its bounding box misses it for certain (refused, so the
      // copies after it are never left pointing at a cut the kernel refused); one inside the box may or may not cut it, which
      // only the kernel can tell -- it cuts it, or says in a sentence that it misses
      if (straight && unknown.every((m) => m.box && !flatsTouch(fl, m.box))) refuse(off(n));
    });
    // chain the copies onto the end of whatever was built on this feature since (a later pocket, hole or pad stays in the part)
    let last: Feature = tipOf(tf, (f) => f.kind === 'pocket' || f.kind === 'hole' || isPadFeature(f), refuse);
    for (let k = 1; k < count; k++) {
      if (dropped.has(k)) continue;
      const mv = place(k);
      // a copy of the SOLVED sketch, without its rules: rules are solved later, on the copy's own (moved) points, and a
      // rule such as horizontal() does not survive a turn; the solved outline moved is exactly the cut being copied
      const copy: SketchFeature = JSON.parse(JSON.stringify(skS));
      copy.id = nextId(docNow(), 'sk');
      delete copy.name;
      delete copy.constraints;
      delete copy.onDatum;
      if (sk.frame) {
        const o2 = mv(fr.origin);
        const u2 = sub3(mv(at(1, 0)), o2), v2 = sub3(mv(at(0, 1)), o2);
        if (improper) {
          // A reflection reverses handedness, so the moved axes u2, v2 would turn u x v (the way the cut is pushed) round. The
          // copy's frame takes them swapped (u = v2, v = u2), which keeps the push the reflected one; every point then has to
          // swap its two coordinates with them, so that (b, a) on the swapped frame is o2 + a u2 + b v2, the reflected point.
          // Swapping the coordinates mirrors the outline in its own plane, so it runs the other way round, and a bulge (which
          // bends to the left of the way its edge runs) changes sign to keep each arc on the same side.
          copy.frame = { origin: o2, u: v2, v: u2 };
          copy.points = copy.points.map(([a, b]) => [b, a] as [number, number]);
          if (copy.bulges) {
            copy.bulges = Object.fromEntries(Object.entries(copy.bulges).map(([k, b]) => [k, -b]));
          }
        } else {
          copy.frame = { origin: o2, u: u2, v: v2 };
        }
      } else {
        if (!planeKept(fr.n)) refuse('the move would tilt or lift the sketch off its plane');
        copy.points = skS.points.map(([a, b]) => {
          const d = sub3(mv(at(a, b)), fr.origin);
          return [dot3(d, fr.u), dot3(d, fr.v)] as [number, number];
        });
        copy.offset = (sk.offset ?? 0) + dot3(sub3(mv(fr.origin), fr.origin), fr.n);
      }
      pushFeature(copy);
      // a slanted pull or cut runs along a world direction, which the move turns (or reflects) with the copy: only a slide
      // leaves it as it is. Copied unchanged, every copy round a circle (or across a mirror) slanted the original's way.
      const turned = (d: Vec3): Vec3 => {
        const o = mv(fr.origin);
        return sub3(mv([fr.origin[0] + d[0], fr.origin[1] + d[1], fr.origin[2] + d[2]]), o);
      };
      if (isPad) {
        const ex = newExtrude(docNow(), copy.id);
        const src = pk as ExtrudeFeature;
        ex.height = src.height;
        if (src.reversed) ex.reversed = true;
        if (src.midplane) ex.midplane = true;
        if (src.length2 !== undefined) ex.length2 = src.length2;
        if (src.taper) ex.taper = src.taper;
        if (src.direction) ex.direction = turned(src.direction);
        if (src.alongNormal === false) ex.alongNormal = false;
        pushFeature(ex);
        const join: CombineFeature = { id: nextId(docNow(), 'op'), kind: 'combine', op: 'union', targets: [last.id, ex.id] };
        pushFeature(join);
        last = join;
      } else {
        const cut = newPocket(docNow(), copy.id, last.id);
        const src = pk as PocketFeature;
        cut.depth = src.depth;
        if (src.reversed) cut.reversed = true;
        if (src.midplane) cut.midplane = true;
        if (src.length2 !== undefined) cut.length2 = src.length2;
        if (src.through) cut.through = true;
        if (src.taper) cut.taper = src.taper;
        if (src.direction) cut.direction = turned(src.direction);
        if (src.alongNormal === false) cut.alongNormal = false;
        pushFeature(cut);
        last = cut;
      }
    }
    mutateHandle(target, last);
    return target;
  }

  /** Lower a pattern of a hole into copies of the hole, each drilled into the one before. A hole's centre is an offset from the
   *  bounding-box centre of the part it drills, so the part has to be one whose box this can find (a pull of a flat sketch,
   *  with any holes or pockets already in it), and the drill has to stay along the pattern's own direction. `shift(c2, o2, k)`
   *  gives copy k's offset from the part centre `c2`, given copy 0's offset `o2` (both in the plane of the hole). */
  function patternOfHole(
    fn: string, target: SolidHandle, count: number,
    shift: (axis: Axis3, c2: [number, number], o2: [number, number], k: number) => [number, number],
    needsAxis?: 'x' | 'y' | 'z',
    fallback: 'none' | 'linear' | 'any' = 'none',
  ): SolidHandle | null {
    const hf = findFeature(target.id) as HoleFeature;
    const refuse = (why: string): never => {
      throw new Error(`${fn}() of a hole drills a copy of the hole at each place, and ${why}. Drill the extra holes yourself, one hole(...) each.`);
    };
    if (hf.corners) refuse('a hole made by holes() already drills four at once, which cannot be repeated as a unit');
    const ax = hf.axis;
    if (needsAxis && needsAxis !== ax) refuse(`the hole is drilled along ${ax} but the spin is about ${needsAxis}, which would tilt the drill`);
    const ix: [number, number] = ax === 'z' ? [0, 1] : ax === 'y' ? [0, 2] : [1, 2];
    const axv: Vec3 = ax === 'x' ? [1, 0, 0] : ax === 'y' ? [0, 1, 0] : [0, 0, 1];
    const to2 = (p: Vec3): [number, number] => [p[ix[0]], p[ix[1]]];
    // follow the hole back to the pull of a flat sketch it drills
    let hostSk: SketchFeature | null = null;
    let hostBox: BoxFeature | null = null;
    let hostCyl: CylinderFeature | null = null;
    let cur: Feature = findFeature(hf.target);
    for (let guard = 0; guard < 64; guard++) {
      if (cur.kind === 'hole') { if (cur.corners) break; cur = findFeature(cur.target); continue; }
      if (cur.kind === 'pocket') { cur = findFeature(cur.into); continue; }
      if (cur.kind === 'box') {
        if (!(cur.rotate && cur.rotate.some((d) => d)) && !cur.round) hostBox = cur;
        break;
      }
      if (cur.kind === 'cylinder') {
        // a plain upright cylinder drilled along its own axis: its face is a disc
        if (!(cur.rotate && cur.rotate.some((d) => d)) && !cur.round && ax === 'z') hostCyl = cur;
        break;
      }
      if (cur.kind === 'extrude') {
        // The kernel places a hole from the middle of the part's bounding box. A taper or a slanted pull carries the walls off
        // the sketch outline, so the middle of the outline is not the middle of the part (a slant shifts it by half the slide),
        // and the outline does not bound where the walls are: a copy placed from it would land in the wrong place.
        if (cur.taper || cur.direction) {
          refuse(`the part it drills was pulled ${cur.taper && cur.direction ? 'with a taper and along a slant' : cur.taper ? 'with a taper' : 'along a slant'}, so brep-rs cannot yet tell where the middle of the part is, and a hole is placed from the middle`);
        }
        const hs = findFeature(cur.target);
        if (hs.kind === 'sketch' && !(hs.geoms && hs.geoms.length) && !(hs.geom && hs.geom.length)) {
          const hfr = sketchFrameOf(hs) as Frame3;
          // the outline as the part is built from it: a sketch with rules is read as its rules solve it
          if (Math.abs(Math.abs(dot3(hfr.n, axv)) - 1) < 1e-9) hostSk = solvedSketch(hs);
        }
      }
      break;
    }
    // a host this lowering cannot measure (a cylinder, a revolve, ...): hand back to the whole-shape pattern, which built these before
    if (!hostSk && !hostBox && !hostCyl) return refuse('brep-rs cannot yet find where the middle of the part is, and a hole is placed from the middle');
    let hostFlat: Flat;
    if (hostCyl) {
      hostFlat = { c: [hostCyl.center[ix[0]], hostCyl.center[ix[1]]], r: hostCyl.radius };
    } else if (hostBox) {
      // a box host: its face in the plane of the hole. A copy that overlaps another or leaves it is refused below; a hole
      // pattern is never handed to the whole-solid pattern here, which copies the plate itself and grows its bounding box.
      const hx = hostBox.size[ix[0]] / 2, hy = hostBox.size[ix[1]] / 2, bx = hostBox.center[ix[0]], by = hostBox.center[ix[1]];
      hostFlat = { poly: [[bx - hx, by - hy], [bx + hx, by - hy], [bx + hx, by + hy], [bx - hx, by + hy]] };
    } else {
      const hfr = sketchFrameOf(hostSk as SketchFeature) as Frame3;
      const hostW = (a: number, b: number): [number, number] => to2([
        hfr.origin[0] + a * hfr.u[0] + b * hfr.v[0], hfr.origin[1] + a * hfr.u[1] + b * hfr.v[1], hfr.origin[2] + a * hfr.u[2] + b * hfr.v[2],
      ]);
      hostFlat = flatOf(hostSk as SketchFeature, hostW);
    }
    let c2: [number, number];
    if ('c' in hostFlat) c2 = hostFlat.c;
    else {
      const xs = hostFlat.poly.map((q) => q[0]), ys = hostFlat.poly.map((q) => q[1]);
      c2 = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    }
    const o0: [number, number] = [hf.center[ix[0]], hf.center[ix[1]]];
    const r = Math.max(hf.diameter, hf.counterbore?.diameter ?? 0, hf.countersink?.diameter ?? 0) / 2;
    const places: Array<[number, number]> = [];
    for (let k = 0; k < count; k++) places.push(k === 0 ? o0 : shift(ax, c2, o0, k));
    const flats: Flat[] = places.map((o) => ({ c: [c2[0] + o[0], c2[1] + o[1]] as [number, number], r }));
    for (let i = 0; i < flats.length; i++) for (let j = i + 1; j < flats.length; j++) {
      if (flatsTouch(flats[i], flats[j])) refuse(`copy ${i + 1} and copy ${j + 1} of the hole overlap each other, so brep-rs cannot yet join overlapping holes into the same single part FreeCAD gives`);
    }
    flats.forEach((fl, i) => {
      if (!flatInside(fl, hostFlat)) refuse(`copy ${i + 1} of the hole reaches the edge of the part, so brep-rs cannot yet cut through an edge and match the face count FreeCAD gives`);
    });
    // a hole is placed from the middle of the part it drills, so only later cuts (which leave the middle where it was) may sit
    // between this hole and its copies; a later pad could move the middle
    let last: Feature = tipOf(hf, (f) => f.kind === 'pocket' || f.kind === 'hole', refuse);
    for (let k = 1; k < count; k++) {
      const copy: HoleFeature = JSON.parse(JSON.stringify(hf));
      copy.id = nextId(docNow(), 'hole');
      delete copy.name;
      copy.target = last.id;
      copy.center[ix[0]] = places[k][0];
      copy.center[ix[1]] = places[k][1];
      pushFeature(copy);
      last = copy;
    }
    mutateHandle(target, last);
    return target;
  }

  function repeat(target: unknown, opts?: unknown): SolidHandle {
    if (!isHandle(target)) throw new Error('repeat() needs a shape: repeat(shape, { count: 3, step: 60 }).');
    const extra = readOptions('repeat', ['count', 'step'], opts);
    if (extra.count === undefined) throw new Error('repeat() needs { count: <number> }.');
    const count = wholeNumberAtLeastOne('repeat', 'count', extra.count);
    if (isPocketTarget(target)) {
      let st: Vec3 = [0, 0, 0];
      if (extra.step !== undefined) {
        st = typeof extra.step === 'number' || extra.step instanceof Number
          ? [unwrap(extra.step), 0, 0]
          : (readVec3('repeat', 'step', extra.step).map((n) => unwrap(n as number)) as Vec3);
      }
      return patternOfCut('repeat', target, count, (k) => (p) => [p[0] + st[0] * k, p[1] + st[1] * k, p[2] + st[2] * k], () => true, false, true);
    }
    if (isHoleTarget(target)) {
      let st: Vec3 = [0, 0, 0];
      if (extra.step !== undefined) {
        st = typeof extra.step === 'number' || extra.step instanceof Number
          ? [unwrap(extra.step), 0, 0]
          : (readVec3('repeat', 'step', extra.step).map((n) => unwrap(n as number)) as Vec3);
      }
      const hax = (findFeature(target.id) as HoleFeature).axis;
      if (Math.abs(st[hax === 'x' ? 0 : hax === 'y' ? 1 : 2]) > 1e-9) {
        throw new Error(`repeat() of a hole drills a copy of the hole at each place, and the step moves the hole along its own drill direction (${hax}), which would lift it off the face. Step across the face instead.`);
      }
      const si = hax === 'z' ? [0, 1] : hax === 'y' ? [0, 2] : [1, 2];
      const lowered = patternOfHole('repeat', target, count, (_a, _c, o, k) => [o[0] + st[si[0]] * k, o[1] + st[si[1]] * k], undefined, 'linear');
      if (lowered) return lowered;
    }
    const tip = tipAny(findFeature(target.id));
    const base = newPattern(docNow(), tip.id, 'linear');
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
    if (isPocketTarget(target)) {
      const ax = extra.axis === undefined ? 'z' : extra.axis;
      if (ax !== 'x' && ax !== 'y' && ax !== 'z') {
        throw new Error(`repeatAround()'s "axis" has to be 'x', 'y' or 'z'. You gave it ${describe(extra.axis)}.`);
      }
      const total = extra.angle === undefined ? 360 : unwrap(requiredNumber('repeatAround', 'angle', extra.angle));
      const axv: Vec3 = ax === 'x' ? [1, 0, 0] : ax === 'y' ? [0, 1, 0] : [0, 0, 1];
      return patternOfCut(
        'repeatAround', target, count,
        // a full turn spaces copies by angle / count (the last would land on the first); anything less spaces them by
        // angle / (count - 1) so the last copy sits AT the end angle -- the way FreeCAD's PolarPattern does it
        (k) => rotateAbout(ax, (Math.abs(total) >= 360 - 1e-9 ? total / count : total / (count - 1)) * k),
        (n) => Math.abs(Math.abs(dot3(n, axv)) - 1) < 1e-9,
        false, false, true,
      );
    }
    if (isHoleTarget(target)) {
      const ax = extra.axis === undefined ? 'z' : extra.axis;
      if (ax !== 'x' && ax !== 'y' && ax !== 'z') {
        throw new Error(`repeatAround()'s "axis" has to be 'x', 'y' or 'z'. You gave it ${describe(extra.axis)}.`);
      }
      const total = extra.angle === undefined ? 360 : unwrap(requiredNumber('repeatAround', 'angle', extra.angle));
      const step = Math.abs(total) >= 360 - 1e-9 ? total / count : total / (count - 1);
      const lowered = patternOfHole('repeatAround', target, count, (hax, c2, o, k) => {
        const ixx = hax === 'z' ? [0, 1] : hax === 'y' ? [0, 2] : [1, 2];
        const p: Vec3 = [0, 0, 0];
        p[ixx[0]] = c2[0] + o[0]; p[ixx[1]] = c2[1] + o[1];
        const q = rotateAbout(ax, step * k)(p);
        return [q[ixx[0]] - c2[0], q[ixx[1]] - c2[1]];
      }, ax, 'any');
      if (lowered) return lowered;
    }
    const tip = tipAny(findFeature(target.id));
    const base = newPattern(docNow(), tip.id, 'circular');
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
    const f = tip;
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

  function mirror(target: unknown, word: unknown, opts?: unknown, ...extra: unknown[]): SolidHandle {
    if (opts !== undefined && !isPlainOptions(opts)) {
      noExtraArgs('mirror', 'a shape and a direction word', 2, [opts, ...extra]);
    }
    noExtraArgs('mirror', 'a shape and a direction word', 2, extra);
    if (!isHandle(target)) throw new Error('mirror() needs a shape: mirror(shape, "left-right").');
    if (typeof word !== 'string' || !(word in MIRROR_WORD)) {
      throw new Error(`mirror() needs 'left-right', 'front-back' or 'top-bottom'. You gave it ${describe(word)}.`);
    }
    const given = readOptions('mirror', ['at'], opts);
    if (given.at !== undefined) return mirrorCut(target, word, given.at);
    const f = newMirror(docNow(), tipAny(findFeature(target.id)).id, MIRROR_WORD[word]);
    pushFeature(f);
    return makeSolidHandle(f, target.rootId);
  }

  /** mirror(cut, word, { at }): reflect a pocket, hole or pad across the plane at coordinate `at` along the mirror axis, and
   *  add the reflected CUT (or pad) to the same part. The kernel's mirror reflects a whole solid through the part's own face,
   *  so it cannot do this; the reflection is lowered here into one more sketch and pocket (or hole, or pad) instead. */
  function mirrorCut(target: SolidHandle, word: string, atRaw: unknown): SolidHandle {
    const at = unwrap(requiredNumber('mirror', 'at', atRaw));
    if (!Number.isFinite(at)) throw new Error(`mirror()'s "at" has to be a finite number. You gave it ${describe(atRaw)}.`);
    if (!isPocketTarget(target) && !isHoleTarget(target)) {
      throw new Error(
        'mirror() with { at } reflects a pocket, a hole or a pad across a plane at that distance, and this shape is none of those. ' +
        'Leave out { at } to mirror the whole shape across the plane through the origin.'
      );
    }
    const m = MIRROR_WORD[word] === 'yz' ? 0 : MIRROR_WORD[word] === 'xz' ? 1 : 2;
    const what = isHoleTarget(target) ? 'hole' : (findFeature(target.id).kind === 'pocket' ? 'pocket' : 'pad');
    const parallel = () => {
      throw new Error(
        `mirror() of a ${what} across '${word}' reflects it through a plane parallel to the face it sits on, which would turn it ` +
        `to the other side of the part instead of copying it across. Mirror it across a plane that stands square to that face.`
      );
    };
    if (isHoleTarget(target)) {
      const hf = findFeature(target.id) as HoleFeature;
      if (hf.axis === (['x', 'y', 'z'] as const)[m]) parallel();
      return patternOfHole('mirror', target, 2, (hax, c2, o) => {
        const ixx = hax === 'z' ? [0, 1] : hax === 'y' ? [0, 2] : [1, 2];
        const j = ixx.indexOf(m);
        const out: [number, number] = [o[0], o[1]];
        out[j] = 2 * at - 2 * c2[j] - o[j];
        return out;
      }) as SolidHandle;
    }
    const tf = findFeature(target.id);
    const pk = (isPadFeature(tf) ? findFeature((tf as CombineFeature).targets[1]) : tf) as PocketFeature | ExtrudeFeature;
    const sk = findFeature(pk.target) as SketchFeature;
    if (sk.kind === 'sketch') {
      const fr = sketchFrameOf(sk) as Frame3;
      if (Math.abs(fr.n[m]) > 1e-9) parallel();
    }
    return patternOfCut(
      'mirror', target, 2,
      () => (p) => { const q: Vec3 = [p[0], p[1], p[2]]; q[m] = 2 * at - q[m]; return q; },
      () => true, true,
    );
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

  function turn(target: unknown, angles: unknown, ...extra: unknown[]): SolidHandle {
    noExtraArgs('turn', 'a shape and a list of angles', 2, extra);
    if (!isHandle(target)) throw new Error('turn() needs a shape: turn(shape, [rx, ry, rz]).');
    const f = findFeature(target.id);
    // A ball looks the same however it is turned, so turning one is not an error: it stays as it is. (The editor still hides the
    // control, which would only teach that some buttons do nothing.)
    if (f.kind === 'sphere') {
      readVec3('turn', 'angles', angles);
      return target;
    }
    const [rx, ry, rz] = readVec3('turn', 'angles', angles);
    if (f.kind === 'sketch' || f.kind === 'datum') {
      throw new Error(`turn() needs a solid shape, and a ${f.kind} is flat. Pull or spin it into a shape first, then turn that.`);
    }
    if (!canRotate(f)) {
      // A shape built up from others (a hole, a round, a join or cut, a mirror, a pull) turns in place about the centre of its
      // bounding box, as its own step, the way move() shifts one.
      const step = newRotate(docNow(), target.id, [0, 0, 0]);
      step.angles = [num(rx, step.id, 'rx'), num(ry, step.id, 'ry'), num(rz, step.id, 'rz')];
      pushFeature(step);
      mutateHandle(target, step);
      return target;
    }
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
    prism, wedge, groove, pocket,
    hole, holes, hollow, round, bevel, repeat, repeatAround, mirror, move, turn,
    join, cut, keep, draft,
    sketch, plane, pull, spin, blend,
    param,
    // Official names: SAME reference as their student alias (SPEC-S2) — an
    // alias that wrapped instead would drift the moment the student word's
    // implementation changed. tsc enforces every VOCABULARY entry has a key
    // here, both directions.
    cuboid: box, torus: ring, fillet: round, chamfer: bevel,
    shell: hollow, subtract: cut, union: join, intersect: keep,
    linearPattern: repeat, polarPattern: repeatAround,
    extrude: pull, revolve: spin, loft: blend,
  };
  const globals: Record<string, unknown> = fns;

  // scope is a `with()` base object, not a parameter list (changed
  // 2026-09-13; see the file header and LINE_OFFSET's own comment for why).
  // Passing the VOCABULARY words (38 at the time of writing) as `new Function` PARAMETER names meant a
  // student's own `const box = ...`, `let ring = ...`, or `class hollow {}`
  // was a SyntaxError -- "Identifier 'box' has already been declared" --
  // because `let`/`const`/`class` can never redeclare a name already bound
  // as a parameter, in the SAME scope, even for a totally reasonable reason.
  // `var box = 5` "worked" instead, silently reusing the parameter slot and
  // permanently losing the tool for the rest of the script -- worse, not
  // better. `with(scope){...}` fixes both: a `let`/`const`/`class`/function
  // declaration of any tool's name creates its own LOCAL binding that simply
  // shadows the tool, same as shadowing any other outer variable in JS.
  // Only a BARE assignment with no declaring keyword still reaches the tool
  // itself (`with` routes `box = ...` to the base object precisely because
  // no local binding exists to catch it first) -- the `set` trap below turns
  // that one remaining case into a clear error instead of silently
  // overwriting the tool for the rest of the run (measured: an unguarded
  // plain object let `box = 5` through, turning every LATER `box(...)` call
  // in the same script into "box is not a function").
  const scope = new Proxy(globals, {
    set(_target, prop) {
      const name = String(prop);
      throw new Error(
        `"${name}" is already a reSHape tool here (you call it like ${name}(...)) -- you can't assign to it directly with "${name} = ...". ` +
          `If you want your own value with that name, declare it first: "const ${name} = ...".`
      );
    },
  });
  const wrapped = `with(${SCOPE_NAME}){\n${source}\n}\n//# sourceURL=${SOURCE_NAME}`;

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
  // is the source text itself, one fixed `with()` line, and one fixed
  // comment -- `with` here binds a single trusted internal object, not user
  // input, so it carries none of the usual "avoid with()" ambiguous-scope
  // risk (that risk is about WHICH names resolve where in code someone else
  // has to read later; there is exactly one base object, chosen by us).
  const errors: ScriptError[] = [];
  try {
    const fn = new Function(SCOPE_NAME, wrapped);
    fn(scope);
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
      // A soup rule's slot row carries NaN when the doc's value is the
      // param's NAME (the binding itself, §6.2) -- the numeric default lives
      // in the named param, so it substitutes here.
      const value = Number.isFinite(p.value) ? p.value : named.value;
      return { name: p.name, caption: named.caption, value, min: named.min, max: named.max, step: named.step };
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

  // A round or chamfer bigger than its corner can give is cut down to what the
  // corner can give. The part is still right for that size, but the script
  // asked for another one, so say so instead of building it silently.
  for (const f of finalDoc.features) {
    if (f.kind !== 'sketch' || (!f.rounds && !f.chamfers)) continue;
    try {
      for (const n of outlineOf(f).notes) {
        const word = f.rounds && f.rounds[n.corner] !== undefined ? 'round' : 'chamfer';
        const fmt = (v: number) => String(Math.round(v * 100) / 100);
        ruleWarnings.push(
          n.got > 0
            ? `.${word}(${n.corner + 1}, ${fmt(n.want)}) is more than corner ${n.corner + 1} has room for, so it was made ${fmt(n.got)} instead.`
            : `.${word}(${n.corner + 1}, ${fmt(n.want)}) was left out: corner ${n.corner + 1} cannot take a ${word} (its edges are curved, in a straight line, or have no length).`
        );
      }
    } catch { /* a malformed sketch is reported elsewhere */ }
  }

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
