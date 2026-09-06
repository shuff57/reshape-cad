// Checks a student's ModelDoc against a lesson's expected shapes/dimensions.
//
// Pure: no DOM, no kernel, no import from components/. A `model` requirement
// (lib/types.ts) hands this the whole ModelDoc that the reSHape kernel
// already built in the browser (or in a node script — see
// scripts/check-reshape-solutions.mjs, which runs a reference solution
// through runScript() and checks it here with no kernel at all). This file
// never runs a kernel itself; it only reads the feature list.
//
// MATCHING. Order-insensitive, greedy: each `expect` entry claims one
// DISTINCT feature of its `kind`, so two `{kind:'hole'}` entries need two
// holes. Only the fields named on an entry are checked — a lesson that only
// cares about `diameter` says nothing about `depth`, and any extra features
// in the doc are ignored. Numbers compare within `tolerance` (default 0.01,
// absolute); arrays element-wise with the same tolerance; strings/booleans
// exact.
//
// DERIVED FIELDS exist so a beginner lesson can check what a student SEES
// rather than the feature's internal storage: a box's `width`/`depth`/
// `height` are its `size` tuple; a hole's `across` is its `diameter`; a
// sketch's `width`/`depth` are the bbox of its design `points`, and a circle
// sketch's `across` is the distance between the two points it stores as the
// ends of a diameter (the same number model-codegen.ts shows the student —
// see its own comment on why "across" and not "diameter" there).
//
// TOPO-NAMED FIELDS (`ShellFeature.open`, `FilletFeature.edge`) are TopoName
// objects, not the strings a lesson author writes. `open: true` matches any
// open face at all — a beginner lesson usually wants "some hollow", not one
// exact face — and a string matches the field's formatName() text exactly.

import type { Feature, ModelDoc } from './model-types.js';
import { formatName, type TopoName } from './topo-name.js';

/** One shape (and, optionally, some of its fields) a `model` requirement
 *  expects to find in the student's ModelDoc. Only the named fields are
 *  checked — see the file header. */
export type ModelExpect = {
  kind: Feature['kind'];
  [field: string]: unknown;
};

export type ModelCheckResult = {
  passed: boolean;
  /** `expect` entries that found no matching feature, in the order given. */
  missing: ModelExpect[];
  /** One plain sentence for the student, naming the first missing entry.
   *  Empty when `passed`. */
  message: string;
};

const DEFAULT_TOLERANCE = 0.01;

function isTopoNameObj(v: unknown): v is TopoName {
  return typeof v === 'object' && v !== null && typeof (v as { cause?: unknown }).cause === 'string';
}

function numClose(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

function valuesClose(expected: unknown, actual: unknown, tol: number): boolean {
  if (typeof expected === 'number' && typeof actual === 'number') return numClose(expected, actual, tol);
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) return false;
    return expected.every((v, i) => valuesClose(v, actual[i], tol));
  }
  return expected === actual;
}

/** A feature's value for `name`, resolving the aliases and derived fields
 *  documented in the file header. `found: false` means the field genuinely
 *  is not there (a straight sketch has no `across`), which a match must
 *  treat as a miss rather than comparing against `undefined`. */
function resolveField(f: Feature, name: string): { value: unknown; found: boolean } {
  if (f.kind === 'box') {
    if (name === 'width') return { value: f.size[0], found: true };
    if (name === 'depth') return { value: f.size[1], found: true };
    if (name === 'height') return { value: f.size[2], found: true };
  }
  if (f.kind === 'hole' && name === 'across') {
    return { value: f.diameter, found: true };
  }
  if (f.kind === 'sketch') {
    if (name === 'width' || name === 'depth') {
      const pts = f.points;
      if (!Array.isArray(pts) || pts.length === 0) return { value: undefined, found: false };
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const width = Math.max(...xs) - Math.min(...xs);
      const depth = Math.max(...ys) - Math.min(...ys);
      return { value: name === 'width' ? width : depth, found: true };
    }
    if (name === 'across') {
      if (f.shape === 'circle' && Array.isArray(f.points) && f.points.length === 2) {
        const [p0, p1] = f.points;
        return { value: Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), found: true };
      }
      return { value: undefined, found: false };
    }
  }
  if (f.kind === 'shell' && name === 'open') {
    const open = f.open;
    return { value: open, found: open !== undefined };
  }
  const value = (f as unknown as Record<string, unknown>)[name];
  return { value, found: value !== undefined };
}

function matchField(f: Feature, name: string, expected: unknown, tol: number): boolean {
  const { value, found } = resolveField(f, name);
  if (!found) return false;
  if (isTopoNameObj(value)) {
    if (expected === true) return true; // presence alone: "any face is open"
    if (typeof expected === 'string') return formatName(value) === expected;
    return false;
  }
  return valuesClose(expected, value, tol);
}

function fmtNum(n: unknown): string {
  if (typeof n !== 'number') return '?';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** A plain-English name for a feature (real or hoped-for), built from
 *  whichever named fields `get` can answer. Shared by the "expected" and
 *  "found" halves of a failure message — see checkModel(). */
/** The word the course uses for a feature kind: the module brief replaced
 *  "fillet" and "shell" with round and hollow, and a failure message is
 *  read by a beginner who has only ever seen the course's words. */
export function studentWord(kind: string, style?: unknown): string {
  switch (kind) {
    case 'fillet': return style === 'chamfer' ? 'bevel' : 'round';
    case 'shell': return 'hollow';
    case 'extrude': return 'pull';
    case 'revolve': return 'spin';
    case 'combine': return 'join';
    default: return kind;
  }
}

function describeFeature(kind: string, get: (name: string) => unknown): string {
  switch (kind) {
    case 'box': {
      const size = get('size');
      if (Array.isArray(size)) return `a box ${fmtNum(size[0])} x ${fmtNum(size[1])} x ${fmtNum(size[2])}`;
      const w = get('width');
      const d = get('depth');
      const h = get('height');
      if (w !== undefined || d !== undefined || h !== undefined) {
        return `a box ${fmtNum(w)} x ${fmtNum(d)} x ${fmtNum(h)}`;
      }
      return 'a box';
    }
    case 'hole': {
      const across = get('across') ?? get('diameter');
      return across !== undefined ? `a hole across ${fmtNum(across)}` : 'a hole';
    }
    case 'sketch': {
      const across = get('across');
      if (across !== undefined) return `a circle sketch across ${fmtNum(across)}`;
      const w = get('width');
      const d = get('depth');
      if (w !== undefined || d !== undefined) return `a sketch ${fmtNum(w)} x ${fmtNum(d)}`;
      return 'a sketch';
    }
    case 'shell': {
      const t = get('thickness');
      return t !== undefined ? `a hollow with a ${fmtNum(t)} wall` : 'a hollow';
    }
    case 'fillet': {
      const style = get('style');
      const size = get('size');
      const word = `a ${studentWord('fillet', style)}`;
      return size !== undefined ? `${word} ${fmtNum(size)}` : word;
    }
    default:
      return `a ${studentWord(kind)}`;
  }
}

/** Feature ids the kernel could not build, with its reason for each --
 *  BuildResult.refusals (lib/occt-build.ts) flattened to a plain object so it
 *  crosses the grading boundary as JSON. A refused feature is in the doc but
 *  not in the shape ("Rounding Round 1 at 3 would not fit its edge, shown
 *  without it"), so for grading it does not exist: the moderate lens passed
 *  8.1.11 with a sharp corner and a declared Round, 2026-09-04. */
export type Refusals = Readonly<Record<string, string>>;

export function checkModel(
  req: { expect?: ModelExpect[]; tolerance?: number },
  doc: ModelDoc | null,
  refusals?: Refusals | null
): ModelCheckResult {
  const expect = req.expect ?? [];

  if (!doc) {
    return { passed: false, missing: expect, message: 'Build or run the model first' };
  }

  const tolerance = req.tolerance ?? DEFAULT_TOLERANCE;
  const used = new Set<string>();
  const missing: ModelExpect[] = [];
  const refused = refusals ?? {};

  for (const entry of expect) {
    const { kind, ...fields } = entry;
    const fieldNames = Object.keys(fields);
    let matchedId: string | null = null;
    for (const f of doc.features) {
      if (f.kind !== kind) continue;
      if (used.has(f.id)) continue;
      if (refused[f.id] !== undefined) continue;
      if (fieldNames.every((name) => matchField(f, name, fields[name], tolerance))) {
        matchedId = f.id;
        break;
      }
    }
    if (matchedId) used.add(matchedId);
    else missing.push(entry);
  }

  if (missing.length === 0) return { passed: true, missing: [], message: '' };

  const first = missing[0];
  const { kind } = first;
  const expectedFields = first as Record<string, unknown>;
  const expectedDesc = describeFeature(kind, (name) => expectedFields[name]);
  // A refused feature of the wanted kind is the most useful thing to name:
  // the student did the step and the kernel could not build it.
  const refusedOfKind = doc.features.find((f) => f.kind === kind && refused[f.id] !== undefined);
  const candidate =
    doc.features.find((f) => f.kind === kind && !used.has(f.id) && refused[f.id] === undefined) ??
    doc.features.find((f) => f.kind === kind && refused[f.id] === undefined);

  const word = studentWord(kind, expectedFields.style);
  const message = refusedOfKind && !candidate
    ? `Expected ${expectedDesc}; the ${word} could not be built: ${refused[refusedOfKind.id]}`
    : candidate
    ? `Expected ${expectedDesc}, found ${describeFeature(kind, (name) => resolveField(candidate, name).value)}.`
    : `Expected ${expectedDesc}; there is no ${word}.`;

  return { passed: false, missing, message };
}
