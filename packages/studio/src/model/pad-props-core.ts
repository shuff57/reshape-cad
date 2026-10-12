// pad-props-core.ts: the pure half of the property view of a selected Pad (or Pocket).
//
// WHAT IT IS. The property pane under the model tree shows a Pad as a short
// list of named properties in groups (Base, Pad, Part Design, Side1, and Side2
// once the pad is two sided), the way a parametric CAD's property editor does.
// This file decides which rows exist, what each shows, what is editable, and
// what an edit means: it turns one edited cell into a new feature, or into a
// plain sentence saying why not. No React, so `node --test` pins it from dist/.
//
//   padPropertyGroups   feature -> groups of typed rows
//   applyPadProp        one edited cell -> the new feature (or a sentence)
//   formatQuantity      8 -> "8.00 mm", 30 -> "30.00 °"
//   parseQuantity       "0.5 in" -> 12.7 (millimetres), "45" -> 45 (degrees)
//
// The solid is never computed here: an edited feature is handed back to the
// document and brep-rs builds it or refuses it in a sentence.

import type { ModelDoc } from '@shuff57/reshape-script/model-types';
import {
  SIDE_OPTIONS, captionOf, checkDraft, draftOf, lengthSlot, pullNormal, reachLength, readBinding, withDraft,
  type PadDraft, type PadFeature, type SideMode, type Vec3,
} from './pad-task-core.js';

// ---- quantities ----------------------------------------------------------

export type QuantityDim = 'length' | 'angle' | 'plain';

const LENGTH_UNITS: Record<string, number> = {
  mm: 1, cm: 10, m: 1000, um: 0.001, 'µm': 0.001, in: 25.4, '"': 25.4, ft: 304.8, "'": 304.8, thou: 0.0254, mil: 0.0254,
};
const ANGLE_UNITS: Record<string, number> = { deg: 1, '°': 1, rad: 180 / Math.PI, gon: 0.9, grad: 0.9 };

/** How a number reads in a property cell: two decimals at least, more only
 *  when the value really has them (8 -> "8.00", 8.125 -> "8.125"). */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const r2 = Math.round(n * 100) / 100;
  if (Math.abs(n - r2) < 1e-9) return r2.toFixed(2);
  let s = (Math.round(n * 1e4) / 1e4).toFixed(4);
  while (s.endsWith('0') && /\.\d{3,}$/.test(s)) s = s.slice(0, -1);
  return s;
}

export function formatQuantity(n: number, dim: QuantityDim): string {
  const t = formatNumber(n);
  return dim === 'length' ? `${t} mm` : dim === 'angle' ? `${t} °` : t;
}

export type ParsedQuantity = { ok: true; value: number } | { ok: false; why: string };

/**
 * What a student typed into a quantity cell. A bare number is in the field's
 * own unit (mm, degrees); a unit suffix converts: "2 cm", "0.5in", "90 deg",
 * "1.5708 rad". A unit of the wrong kind is refused in a sentence.
 */
export function parseQuantity(text: string, dim: QuantityDim): ParsedQuantity {
  const t = text.trim().replace(',', '.');
  if (!t) return { ok: false, why: 'Type a number.' };
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([A-Za-zµ°"']*)$/.exec(t);
  if (!m) return { ok: false, why: `${text.trim()} is not a number with an optional unit.` };
  const base = Number(m[1]);
  if (!Number.isFinite(base)) return { ok: false, why: 'That is not a number.' };
  const unit = m[2].toLowerCase() === 'deg' || m[2] === '°' ? m[2].toLowerCase() : m[2];
  if (unit === '') return { ok: true, value: base };
  if (dim === 'plain') return { ok: false, why: 'This field is a plain number: it has no unit.' };
  const table = dim === 'length' ? LENGTH_UNITS : ANGLE_UNITS;
  const other = dim === 'length' ? ANGLE_UNITS : LENGTH_UNITS;
  const k = table[unit] ?? table[unit.toLowerCase()];
  if (k === undefined) {
    if (other[unit] !== undefined || other[unit.toLowerCase()] !== undefined) {
      return { ok: false, why: `${unit} is ${dim === 'length' ? 'an angle' : 'a length'}, but this field takes ${dim === 'length' ? 'a length' : 'an angle'}.` };
    }
    return { ok: false, why: `${unit} is not a unit this field knows. Use ${dim === 'length' ? 'mm, cm, m or in' : 'deg or rad'}.` };
  }
  return { ok: true, value: Math.round(base * k * 1e9) / 1e9 };
}

// ---- rows ----------------------------------------------------------------

export interface EnumOption { id: string; label: string }

export type PropCell =
  | { t: 'text'; value: string }
  | { t: 'bool'; value: boolean }
  | { t: 'enum'; value: string; options: EnumOption[] }
  | {
      t: 'quantity'; value: number; dim: QuantityDim;
      /** Name of the parameter this cell follows, if any. */
      bound?: string;
      /** The cell can follow a parameter (only the first length can). */
      canBind?: boolean;
      /** Lowest value the cell accepts, shown in the sentence when it is not met. */
      min?: number;
    }
  | { t: 'vector'; value: Vec3 };

export interface PropRow {
  /** Stable id for edits: `side`, `custom`, `dirX`, `length` ... */
  key: string;
  label: string;
  cell: PropCell;
  /** Shown but not editable. `why` becomes its tooltip. */
  readOnly?: boolean;
  why?: string;
  /** Greyed (kept, because FreeCAD keeps the row) until something enables it. */
  dim?: boolean;
  children?: PropRow[];
}

export interface PropGroupX { name: string; rows: PropRow[] }

export interface PadPropContext {
  label: string;
  suppressed: boolean;
  /** Name of the parameter bound to a slot, if any. */
  boundTo: (slot: string) => string | undefined;
}

const TYPE_LENGTH = 'length';
export function sideTypeOptions(): EnumOption[] {
  return SIDE_OPTIONS.map((o) => ({ id: o.id, label: o.label }));
}

/** The Side1 Type list, in FreeCAD's order and its words. */
export function sideOneTypes(kind: 'extrude' | 'pocket'): EnumOption[] {
  return [
    { id: TYPE_LENGTH, label: 'Length' },
    kind === 'extrude' ? { id: 'toLast', label: 'To last' } : { id: 'through', label: 'Through all' },
    { id: 'toFirst', label: 'To first' },
    { id: 'upToFace', label: 'Up to face' },
    { id: 'twoLengths', label: 'Two lengths' },
    { id: 'upToShape', label: 'Up to shape' },
  ];
}

function typeIdOf(d: PadDraft): string {
  if (d.type === 'through') return 'through';
  if (d.side === 'two') return 'twoLengths';
  return TYPE_LENGTH;
}

export function padPropertyGroups(doc: ModelDoc, f: PadFeature, ctx: PadPropContext): PropGroupX[] {
  const normal = pullNormal(doc, f);
  const d = draftOf(f, normal);
  const custom = d.dirMode === 'custom';
  const dir: Vec3 = custom ? d.dir : normal;
  const slot = lengthSlot(f);
  const bound = ctx.boundTo(slot);
  const through = d.type === 'through';
  const noun = f.kind === 'extrude' ? 'Pad' : 'Pocket';

  const base: PropGroupX = {
    name: 'Base',
    rows: [
      { key: 'label', label: 'Label', cell: { t: 'text', value: ctx.label }, readOnly: true,
        why: 'The name comes from the script. Rename the step there.' },
      { key: 'suppressed', label: 'Suppressed', cell: { t: 'bool', value: ctx.suppressed } },
    ],
  };
  const own: PropGroupX = {
    name: noun,
    rows: [
      { key: 'side', label: 'Side Type', cell: { t: 'enum', value: d.side, options: sideTypeOptions() } },
      { key: 'custom', label: 'Use Custom Vector', cell: { t: 'bool', value: custom } },
      {
        key: 'direction', label: 'Direction', cell: { t: 'vector', value: dir }, dim: !custom,
        children: (['X', 'Y', 'Z'] as const).map((c, i) => ({
          key: `dir${c}`, label: c,
          cell: { t: 'quantity' as const, value: dir[i], dim: 'plain' as const },
          readOnly: !custom, why: custom ? undefined : 'Tick Use Custom Vector to type a direction.',
        })),
      },
      { key: 'refAxis', label: 'Reference Axis', cell: { t: 'text', value: '' }, readOnly: true,
        why: 'A pad cannot be pulled along an edge or axis yet. Use a custom vector.' },
      { key: 'alongNormal', label: 'Along Sketch Normal', cell: { t: 'bool', value: d.alongNormal }, readOnly: !custom,
        why: custom ? undefined : 'Only matters for a custom vector.' },
    ],
  };
  const partDesign: PropGroupX = {
    name: 'Part Design',
    rows: [
      { key: 'refine', label: 'Refine', cell: { t: 'bool', value: true }, readOnly: true,
        why: 'The kernel always merges coplanar faces.' },
      { key: 'fuzzy', label: 'Fuzzy Tolerance', cell: { t: 'quantity', value: 0, dim: 'plain' }, readOnly: true,
        why: 'The kernel does not use a fuzzy tolerance.' },
    ],
  };
  const side1: PropGroupX = {
    name: 'Side1',
    rows: [
      { key: 'type', label: 'Type', cell: { t: 'enum', value: typeIdOf(d), options: sideOneTypes(f.kind) } },
      { key: 'length', label: 'Length',
        cell: { t: 'quantity', value: d.length, dim: 'length', bound, canBind: true, min: 0 },
        readOnly: through, why: through ? 'Through all has no length.' : undefined },
      { key: 'upToFace', label: 'Up To Face', cell: { t: 'text', value: '' }, readOnly: true,
        why: 'Choose Type "Up to face" and click the face in the viewport.' },
      { key: 'upToShape', label: 'Up To Shape', cell: { t: 'text', value: '' }, readOnly: true,
        why: 'Choose Type "Up to shape" and click a face in the viewport.' },
      { key: 'offset', label: 'Offset', cell: { t: 'quantity', value: 0, dim: 'length' }, readOnly: true,
        why: 'Offset applies to Up to face and Up to shape.' },
      { key: 'taper', label: 'Taper Angle', cell: { t: 'quantity', value: d.taper, dim: 'angle' } },
    ],
  };
  const groups = [base, own, partDesign, side1];
  if (d.side === 'two' && !through) {
    groups.push({
      name: 'Side2',
      rows: [
        { key: 'type2', label: 'Type', cell: { t: 'text', value: 'Length' }, readOnly: true },
        { key: 'length2', label: 'Length', cell: { t: 'quantity', value: d.length2, dim: 'length', min: 0 } },
        { key: 'taper2', label: 'Taper Angle', cell: { t: 'quantity', value: 0, dim: 'angle' }, readOnly: true,
          why: 'A taper on the second side is not built yet.' },
      ],
    });
  }
  return groups;
}

// ---- edits ---------------------------------------------------------------

export type PadEdit =
  | { ok: true; feature: PadFeature; /** the length slot a length edit moves, when a parameter drives it */ slot?: string }
  | { ok: false; why: string }
  /** Needs a face picked in the viewport: the task panel is the place for it. */
  | { ok: 'open'; why: string };

/** What editing one cell of a Pad's property view does to the feature. */
export function applyPadProp(doc: ModelDoc, f: PadFeature, key: string, value: unknown): PadEdit {
  const normal = pullNormal(doc, f);
  const d: PadDraft = draftOf(f, normal);
  const num = (v: unknown): number => (typeof v === 'number' ? v : NaN);
  switch (key) {
    case 'side': {
      const s = value as SideMode;
      if (!SIDE_OPTIONS.some((o) => o.id === s)) return { ok: false, why: 'Choose one of the listed side types.' };
      d.side = s;
      d.twoDims = false;
      break;
    }
    case 'custom':
      // Switching on starts from the way the pull already goes (draftOf put
      // the sketch normal, or the stored vector, in d.dir): nothing moves yet.
      d.dirMode = value === true ? 'custom' : 'normal';
      break;
    case 'dirX': case 'dirY': case 'dirZ': {
      if (d.dirMode !== 'custom') return { ok: false, why: 'Tick Use Custom Vector to type a direction.' };
      const n = num(value);
      if (!Number.isFinite(n)) return { ok: false, why: 'The direction X, Y and Z have to be numbers.' };
      d.dir = [...d.dir] as Vec3;
      d.dir[key === 'dirX' ? 0 : key === 'dirY' ? 1 : 2] = n;
      break;
    }
    case 'alongNormal':
      if (d.dirMode !== 'custom') return { ok: false, why: 'Only matters for a custom vector.' };
      d.alongNormal = value === true;
      break;
    case 'type': {
      const t = String(value);
      if (t === 'upToFace' || t === 'upToShape') {
        return { ok: 'open', why: `${t === 'upToFace' ? 'Up to face' : 'Up to shape'} needs a face picked in the viewport: finish it in the task panel.` };
      }
      if (t === 'toLast' || t === 'toFirst') {
        const r = reachLength(doc, f, t === 'toFirst' ? 'first' : 'last', d.reversed);
        if (!r.ok) return { ok: false, why: r.why };
        d.length = r.length; d.type = 'dimension'; d.twoDims = false; d.side = 'one';
      } else if (t === 'through') {
        d.type = 'through'; d.twoDims = false;
      } else if (t === 'twoLengths') {
        d.type = 'dimension'; d.side = 'two'; d.twoDims = true;
      } else if (t === TYPE_LENGTH) {
        d.type = 'dimension';
        if (d.side === 'two') { d.side = 'one'; d.twoDims = false; }
      } else return { ok: false, why: 'Choose one of the listed types.' };
      break;
    }
    case 'length': d.length = num(value); break;
    case 'length2': d.length2 = num(value); break;
    case 'taper': d.taper = num(value); break;
    default:
      return { ok: false, why: 'This property is read-only.' };
  }
  const problem = checkDraft(d);
  if (problem) return { ok: false, why: problem };
  return { ok: true, feature: withDraft(f, d), slot: key === 'length' ? lengthSlot(f) : undefined };
}

// ---- binding a field to a named parameter --------------------------------

/** The shape of one named parameter the property view binds a slot to
 *  (reshape-script-gen's ScriptParamRef satisfies it). */
export interface NamedParamLike {
  name: string;
  caption: string;
  value: number;
  min: number;
  max: number;
  step: number;
  slots: string[];
}

/**
 * 'bind'    the field starts following `name`. The field takes the parameter's
 *           value; no parameter's value is touched, the one it followed before
 *           included.
 * 'follow'  the field already follows `name` and a number was typed into it:
 *           that moves the parameter (and every other field on it).
 * Anything that binds is 'bind'; only a typed number on an already bound field
 * is 'follow', so a repeated or stale bind can never rewrite a parameter.
 */
export type BindIntent = 'bind' | 'follow';

export interface BindResult<T extends NamedParamLike> {
  params: T[];
  /** The number the field now has. */
  value: number;
}

/**
 * The value a parameter has right now: its bound slots' live value in the
 * document when one exists (a slider drag edits the document and leaves the
 * parameter's own `value` stale), else the parameter's own.
 */
export function paramValueOf(
  params: readonly NamedParamLike[] | null, name: string, live: ReadonlyMap<string, number>,
): number | undefined {
  const p = (params ?? []).find((q) => q.name === name);
  if (!p) return undefined;
  const s = p.slots.find((x) => live.has(x));
  return s !== undefined ? live.get(s)! : p.value;
}

/**
 * Pure: what the named-parameter list becomes when `slot` is bound to `name`
 * (or freed, with null), and the value the field takes.
 *
 * `live` maps a slot to the value the document holds for it right now. The
 * parameter's own `value` can be stale (a slider drag edits the document and
 * never touches it), so the bound slots' live value wins when one exists.
 */
export function bindSlot<T extends NamedParamLike>(
  params: readonly T[] | null,
  slot: string,
  name: string | null,
  value: number,
  live: ReadonlyMap<string, number>,
  intent: BindIntent = 'bind',
  make?: (name: string, value: number, slot: string) => T,
): BindResult<T> {
  const before = params ?? [];
  const list = before.map((p) => ({ ...p, slots: p.slots.filter((x) => x !== slot) }));
  if (name === null) {
    // Freed: the parameter keeps its value and its other fields. One left with
    // no field at all is dropped, unless it was already declared unused.
    const kept = list.filter((p) => p.slots.length > 0 || before.some((q) => q.name === p.name && q.slots.length === 0));
    return { params: kept, value };
  }
  const existing = list.find((p) => p.name === name);
  if (existing) {
    const was = before.find((p) => p.name === name);
    const follows = !!was && was.slots.includes(slot);
    if (intent === 'follow' && follows) {
      existing.value = value;
      existing.slots = [...existing.slots, slot];
      return { params: list, value };
    }
    const v = paramValueOf(list, name, live) ?? existing.value;
    existing.slots = [...existing.slots, slot];
    return { params: list, value: v };
  }
  const made = make
    ? make(name, value, slot)
    : ({
        name, caption: captionOf(name), value,
        min: Math.min(1, value), max: Math.max(100, Math.ceil(value * 4)), step: 1, slots: [slot],
      } as unknown as T);
  return { params: [...list, made], value };
}

/**
 * What typing "=text" into a Length cell of the property view means, given the
 * parameters that exist: a number frees the field, a known name binds it, and
 * anything else is a sentence. A name that is not a parameter is refused here
 * rather than quietly created: a new parameter is made in the Pad task panel or
 * with param() in the script.
 */
export type PaneBinding =
  | { kind: 'number'; value: number }
  | { kind: 'param'; name: string }
  | { kind: 'error'; why: string };

export function readPaneBinding(text: string, known: readonly string[], featureIds: readonly string[]): PaneBinding {
  const b = readBinding(text, known, featureIds);
  if (b.kind !== 'param') return b;
  if (b.isNew) {
    const list = known.length ? ` The parameters here are ${known.join(', ')}.` : ' This model has no parameters yet.';
    return { kind: 'error', why: `${b.name} is not a parameter of this model.${list} Add it with param() in the script, or from the Pad task panel.` };
  }
  return { kind: 'param', name: b.name };
}
