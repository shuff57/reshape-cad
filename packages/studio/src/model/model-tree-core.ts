// model-tree-core.ts: the pure half of the model tree (the left panel).
//
// WHY THIS EXISTS. The left panel used to be a flat "Parts / Planes" list, and
// a feature's state (refused, rolled back, consumed by a later step) was only
// readable in the bottom timeline. A parametric CAD tree is the place a student
// reads the history of a part: one Body, its Origin, then every feature in
// build order with the sketch it was made from folded underneath it. This file
// builds that shape from a ModelDoc and nothing else -- no React, no DOM -- so
// `node --test` can pin it from dist/.
//
// The layout follows the conventional parametric-CAD browser (document > body >
// origin + features, profile sketches nested under the feature that consumes
// them, one "tip" marking where the history currently ends). Labels are the
// plain command names (Pad, Chamfer, ...); everything else -- icons, colours,
// wording of states -- is this project's own.
//
// STATES a row can be in, all derived, none stored on the doc:
//   tip        the last solid feature the model is built to (moves when the
//              student rolls the history back)
//   afterTip   rolled back past: built from nothing, shown dimmed
//   invalid    the kernel refused it; the sentence is the row's tooltip
//   suppressed switched off by the student; later features that are built from
//              it are skipped too and say so (`skipped`)
//
// Suppression is a VIEW state like the rollback bar: the doc and the script
// text are untouched, only the document handed to the kernel changes
// (`withoutSuppressed`).

import { dependsOn, topLevel, type Feature, type ModelDoc } from '@shuff57/reshape-script/model-types';
import { partWordFor } from '@shuff57/reshape-script/topo-name';

export type TreeIcon =
  | 'document' | 'body' | 'origin' | 'axis' | 'plane' | 'point'
  | 'sketch' | 'pad' | 'pocket' | 'revolution' | 'groove'
  | 'fillet' | 'chamfer' | 'hole' | 'mirrored' | 'linear-pattern' | 'polar-pattern'
  | 'thickness' | 'draft' | 'boolean' | 'datum' | 'transform' | 'primitive' | 'blend';

export type TreeNodeKind = 'document' | 'body' | 'origin' | 'origin-item' | 'feature';

export interface TreeNode {
  /** Stable across rebuilds, so expansion state survives an edit. */
  key: string;
  kind: TreeNodeKind;
  label: string;
  icon: TreeIcon;
  /** The ModelDoc feature this row stands for; absent on structural rows. */
  featureId?: string;
  /** For origin-item rows: which named plane it is, so a click can set the
   *  plane the next new sketch is drawn on. */
  plane?: 'xy' | 'xz' | 'yz';
  children: TreeNode[];
  tip?: boolean;
  afterTip?: boolean;
  invalid?: string;
  suppressed?: boolean;
  /** Not built because it is made from a suppressed feature. */
  skipped?: string;
}

export interface TreeOptions {
  /** The document's own name. */
  docName?: string;
  /** The rollback boundary (features at or past it are not built). */
  rollbackIndex?: number | null;
  /** Feature id -> the kernel's refusal sentence. */
  refusals?: ReadonlyMap<string, string>;
  /** Ids the student switched off. */
  suppressed?: ReadonlySet<string>;
}

const SOLID_KINDS_NOT: ReadonlySet<Feature['kind']> = new Set(['sketch', 'datum']);

/** The plain command name of a feature, numbered the way a CAD document
 *  numbers repeats: Pad, Pad001, Pad002. A name the student typed wins. */
export function treeLabels(doc: ModelDoc): Record<string, string> {
  const counts = new Map<string, number>();
  const out: Record<string, string> = {};
  for (const f of doc.features) {
    if (f.name) { out[f.id] = f.name; continue; }
    const base = baseLabel(f);
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    out[f.id] = n === 0 ? base : `${base}${String(n).padStart(3, '0')}`;
  }
  return out;
}

function baseLabel(f: Feature): string {
  switch (f.kind) {
    case 'sketch': return 'Sketch';
    case 'datum': return 'DatumPlane';
    case 'extrude': return 'Pad';
    case 'revolve': return 'Revolution';
    case 'groove': return 'Groove';
    case 'pocket': return 'Pocket';
    case 'fillet': return f.style === 'chamfer' ? 'Chamfer' : 'Fillet';
    case 'hole': return 'Hole';
    case 'mirror': return 'Mirrored';
    case 'pattern': return f.mode === 'circular' ? 'PolarPattern' : 'LinearPattern';
    case 'shell': return 'Thickness';
    case 'draft': return 'Draft';
    case 'combine': return 'Boolean';
    case 'move': return f.copy ? 'Copy' : 'Placement';
    case 'rotate': return 'Placement';
    case 'blend': return 'Loft';
    case 'box': return 'Box';
    case 'cylinder': return 'Cylinder';
    case 'sphere': return 'Sphere';
    case 'cone': return 'Cone';
    case 'torus': return 'Torus';
    case 'prism': return 'Prism';
    case 'wedge': return 'Wedge';
  }
  return 'Feature';
}

function iconOf(f: Feature): TreeIcon {
  switch (f.kind) {
    case 'sketch': return 'sketch';
    case 'datum': return 'datum';
    case 'extrude': return 'pad';
    case 'revolve': return 'revolution';
    case 'groove': return 'groove';
    case 'pocket': return 'pocket';
    case 'fillet': return f.style === 'chamfer' ? 'chamfer' : 'fillet';
    case 'hole': return 'hole';
    case 'mirror': return 'mirrored';
    case 'pattern': return f.mode === 'circular' ? 'polar-pattern' : 'linear-pattern';
    case 'shell': return 'thickness';
    case 'draft': return 'draft';
    case 'combine': return 'boolean';
    case 'move': case 'rotate': return 'transform';
    case 'blend': return 'blend';
    default: return 'primitive';
  }
}

/** Ids a feature's profile sketch is read from, if it has one. */
function profileOf(f: Feature, byId: Map<string, Feature>): string | null {
  if (f.kind === 'extrude' || f.kind === 'revolve' || f.kind === 'pocket' || f.kind === 'groove') {
    return byId.get(f.target)?.kind === 'sketch' ? f.target : null;
  }
  return null;
}

/** Everything that cannot be built because it is made from a suppressed
 *  feature: the transitive dependents, mapped to the suppressed id that
 *  started the chain. The suppressed ids themselves are NOT in the map. */
export function skippedBy(doc: ModelDoc, suppressed: ReadonlySet<string>): Map<string, string> {
  const out = new Map<string, string>();
  if (suppressed.size === 0) return out;
  const gone = new Map<string, string>();
  for (const id of suppressed) gone.set(id, id);
  for (const f of doc.features) {
    if (gone.has(f.id)) continue;
    for (const d of dependsOn(f)) {
      const root = gone.get(d);
      if (root !== undefined) { gone.set(f.id, root); out.set(f.id, root); break; }
    }
  }
  return out;
}

/** The document the kernel should build: the rollback slice, minus the
 *  suppressed features and everything made from them. Returns `doc` itself
 *  when nothing is suppressed, so a memo keyed on identity stays quiet. */
export function withoutSuppressed(doc: ModelDoc, suppressed: ReadonlySet<string>): ModelDoc {
  if (suppressed.size === 0) return doc;
  const skipped = skippedBy(doc, suppressed);
  const keep = doc.features.filter((f) => !suppressed.has(f.id) && !skipped.has(f.id));
  return keep.length === doc.features.length ? doc : { ...doc, features: keep };
}

/** The suppressed set kept across a new document (an edit, an undo, a redo, a
 *  panel's OK -- every one goes through the studio's loadDoc): the ids the new
 *  document still has stay switched off, the ids it no longer has are dropped.
 *  Returns `suppressed` itself when nothing is dropped. */
export function pruneSuppressed(suppressed: ReadonlySet<string>, doc: ModelDoc): ReadonlySet<string> {
  if (suppressed.size === 0) return suppressed;
  const ids = new Set(doc.features.map((f) => f.id));
  const keep = [...suppressed].filter((id) => ids.has(id));
  return keep.length === suppressed.size ? suppressed : new Set(keep);
}

/** The eye overrides kept across a new document, the same way: a feature the
 *  new document still has keeps its eye, a gone one loses it, and the origin's
 *  own eyes (`origin:*`, not features) always stay. Returns `visibility` itself
 *  when nothing is dropped. */
export function pruneVisibility(visibility: ReadonlyMap<string, boolean>, doc: ModelDoc): ReadonlyMap<string, boolean> {
  if (visibility.size === 0) return visibility;
  const ids = new Set(doc.features.map((f) => f.id));
  const keep = [...visibility].filter(([id]) => id.startsWith('origin:') || ids.has(id));
  return keep.length === visibility.size ? visibility : new Map(keep);
}

/** Which built shapes the viewport draws, in order, and whether the eyes hid
 *  them all. The top-level features that built; when none did (a refused
 *  top-level feature empties the top of the tree), the NEWEST feature that
 *  built, so the part stays on screen "shown without" the refused one. Then
 *  the eyes: a shape set to false is not drawn, a feature set to true is drawn
 *  beside the rest. `hiddenByEye` is true only when shapes DID build and the
 *  eyes took every one of them off -- never for a build that made nothing. */
export function shapesToDraw(
  doc: ModelDoc,
  isBuilt: (featureId: string) => boolean,
  visibility?: ReadonlyMap<string, boolean>,
): { ids: string[]; hiddenByEye: boolean } {
  let ids = topLevel(doc).map((f) => f.id).filter(isBuilt);
  if (ids.length === 0) {
    const fallback = [...doc.features].reverse().find((f) => isBuilt(f.id));
    if (fallback) ids = [fallback.id];
  }
  if (!visibility || visibility.size === 0) return { ids, hiddenByEye: false };
  const before = ids.length;
  const extra = doc.features
    .filter((f) => visibility.get(f.id) === true && !ids.includes(f.id) && isBuilt(f.id))
    .map((f) => f.id);
  ids = [...ids.filter((id) => visibility.get(id) !== false), ...extra];
  return { ids, hiddenByEye: before > 0 && ids.length === 0 };
}

/** The status after a viewport build: 'empty' when it drew nothing, unless the
 *  document is only flat sketches (nothing to draw is not a failure there) or
 *  the tree's eyes hid every shape that DID build. An eye switched off somewhere
 *  says nothing by itself: a build that made nothing is still empty. */
export function emptyAfterBuild(r: { triangles: number; hiddenByEye?: boolean }, sketchOnly: boolean): 'empty' | null {
  return r.triangles > 0 || sketchOnly || r.hiddenByEye === true ? null : 'empty';
}

/** The tip: the last solid-making feature inside the rollback boundary. */
export function tipId(doc: ModelDoc, rollbackIndex: number | null | undefined, suppressed?: ReadonlySet<string>): string | null {
  const end = rollbackIndex == null ? doc.features.length : Math.min(rollbackIndex, doc.features.length);
  const skipped = suppressed ? skippedBy(doc, suppressed) : new Map<string, string>();
  for (let i = end - 1; i >= 0; i--) {
    const f = doc.features[i];
    if (SOLID_KINDS_NOT.has(f.kind)) continue;
    if (suppressed?.has(f.id) || skipped.has(f.id)) continue;
    return f.id;
  }
  return null;
}

/** Is this feature's own shape on screen by default (before the student
 *  touches an eye)? Solids: the ones nothing later consumed. Sketches: the
 *  ones no pull or spin consumed -- the same rule the outline overlay uses. */
export function sketchDrawnByDefault(doc: ModelDoc, sketchId: string): boolean {
  return !doc.features.some((f) =>
    ((f.kind === 'extrude' || f.kind === 'revolve') && f.target === sketchId)
    || (f.kind === 'blend' && f.targets.includes(sketchId))
  );
}

export const ORIGIN_ITEMS: ReadonlyArray<{ key: string; label: string; icon: TreeIcon; plane?: 'xy' | 'xz' | 'yz' }> = [
  { key: 'origin:x', label: 'X-axis', icon: 'axis' },
  { key: 'origin:y', label: 'Y-axis', icon: 'axis' },
  { key: 'origin:z', label: 'Z-axis', icon: 'axis' },
  { key: 'origin:xy', label: 'XY-plane', icon: 'plane', plane: 'xy' },
  { key: 'origin:xz', label: 'XZ-plane', icon: 'plane', plane: 'xz' },
  { key: 'origin:yz', label: 'YZ-plane', icon: 'plane', plane: 'yz' },
  { key: 'origin:o', label: 'Origin-Point', icon: 'point' },
];

/** The whole tree, root first. */
export function buildModelTree(doc: ModelDoc, opts: TreeOptions = {}): TreeNode {
  const labels = treeLabels(doc);
  const byId = new Map(doc.features.map((f) => [f.id, f]));
  const end = opts.rollbackIndex == null ? doc.features.length : Math.min(opts.rollbackIndex, doc.features.length);
  const suppressed = opts.suppressed ?? new Set<string>();
  const skipped = skippedBy(doc, suppressed);
  const tip = tipId(doc, opts.rollbackIndex, suppressed);
  const indexOf = new Map(doc.features.map((f, i) => [f.id, i]));

  // Each profile sketch nests under the FIRST feature that consumes it.
  const nestedUnder = new Map<string, string>();
  for (const f of doc.features) {
    const p = profileOf(f, byId);
    if (p && !nestedUnder.has(p)) nestedUnder.set(p, f.id);
  }

  const nodeFor = (f: Feature): TreeNode => {
    const node: TreeNode = {
      key: `f:${f.id}`,
      kind: 'feature',
      label: labels[f.id],
      icon: iconOf(f),
      featureId: f.id,
      children: [],
    };
    const i = indexOf.get(f.id) ?? 0;
    if (tip === f.id) node.tip = true;
    if (i >= end) node.afterTip = true;
    const why = opts.refusals?.get(f.id);
    if (why && !node.afterTip) node.invalid = why;
    if (suppressed.has(f.id)) node.suppressed = true;
    const root = skipped.get(f.id);
    if (root !== undefined) node.skipped = `Not built: it is made from ${labels[root] ?? 'a suppressed step'}, which is suppressed.`;
    return node;
  };

  const body: TreeNode = {
    key: 'body',
    kind: 'body',
    label: 'Body',
    icon: 'body',
    children: [],
  };
  body.children.push({
    key: 'origin',
    kind: 'origin',
    label: 'Origin',
    icon: 'origin',
    children: ORIGIN_ITEMS.map((o) => ({
      key: o.key, kind: 'origin-item' as const, label: o.label, icon: o.icon, plane: o.plane, children: [],
    })),
  });
  const nodes = new Map<string, TreeNode>();
  for (const f of doc.features) nodes.set(f.id, nodeFor(f));
  for (const f of doc.features) {
    const parent = nestedUnder.get(f.id);
    const n = nodes.get(f.id)!;
    if (parent && nodes.has(parent)) nodes.get(parent)!.children.push(n);
    else body.children.push(n);
  }
  return {
    key: 'document',
    kind: 'document',
    label: opts.docName ?? 'Unnamed',
    icon: 'document',
    children: [body],
  };
}

/** Rows in display order, honouring which nodes are expanded. */
export function visibleRows(root: TreeNode, expanded: ReadonlySet<string>): Array<{ node: TreeNode; depth: number; parent: string | null }> {
  const out: Array<{ node: TreeNode; depth: number; parent: string | null }> = [];
  const walk = (n: TreeNode, depth: number, parent: string | null) => {
    out.push({ node: n, depth, parent });
    if (n.children.length && expanded.has(n.key)) {
      for (const c of n.children) walk(c, depth + 1, n.key);
    }
  };
  walk(root, 0, null);
  return out;
}

/** Keys of every ancestor of a feature's row, so selecting it elsewhere (in
 *  the viewport) can open the branch it lives in. */
export function ancestorKeys(root: TreeNode, featureId: string): string[] {
  const path: string[] = [];
  const find = (n: TreeNode): boolean => {
    if (n.featureId === featureId) return true;
    for (const c of n.children) {
      if (find(c)) { path.push(n.key); return true; }
    }
    return false;
  };
  find(root);
  return path;
}

export const DEFAULT_EXPANDED: ReadonlyArray<string> = ['document', 'body'];

/** Is a feature's own shape visible, given the student's eye overrides? */
export function isShown(doc: ModelDoc, id: string, overrides: ReadonlyMap<string, boolean>, topLevelIds: ReadonlySet<string>): boolean {
  const o = overrides.get(id);
  if (o !== undefined) return o;
  const f = doc.features.find((x) => x.id === id);
  if (!f) return false;
  if (f.kind === 'sketch') return sketchDrawnByDefault(doc, id);
  if (f.kind === 'datum') return false;
  return topLevelIds.has(id);
}

/** Which drawn solids a tree selection lights up in the viewport. A selected
 *  feature that is itself drawn lights its own shape; one that a later step
 *  consumed (a Pad under a Chamfer) lights every drawn shape that was built
 *  from it, so selecting any step of a part tints the part. Pure: ids in,
 *  ids out. */
export function highlightedShapeIds(doc: ModelDoc, selectedIds: readonly string[], shapeIds: readonly string[]): Set<string> {
  const out = new Set<string>();
  if (selectedIds.length === 0 || shapeIds.length === 0) return out;
  const drawn = new Set(shapeIds);
  const sel = new Set(selectedIds);
  // Walk forward in build order: a feature is "from" a selected one when any
  // of its inputs is selected or already from one.
  const from = new Set<string>(sel);
  for (const f of doc.features) {
    if (from.has(f.id)) continue;
    for (const d of dependsOn(f)) if (from.has(d)) { from.add(f.id); break; }
  }
  for (const id of sel) if (drawn.has(id)) out.add(id);
  for (const id of from) {
    if (sel.has(id)) continue;
    if (drawn.has(id)) out.add(id);
  }
  return out;
}

/** A sentence with the document's internal feature ids replaced by the names
 *  the tree shows (bevel1 -> Chamfer). Quoted ids always; a bare id only when
 *  it looks like an id (has a digit or an underscore) so ordinary words stay. */
export function humanizeIds(text: string, labels: Record<string, string>): string {
  let out = text;
  const ids = Object.keys(labels).sort((a, b) => b.length - a.length);
  for (const id of ids) {
    const label = labels[id];
    if (!label || label === id) continue;
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`["'\u2018\u2019\`]${esc}["'\u2018\u2019\`]`, 'g'), label);
    if (/[0-9_]/.test(id)) out = out.replace(new RegExp(`(?<![A-Za-z0-9_])${esc}(?![A-Za-z0-9_])`, 'g'), label);
  }
  return out;
}

// ---- the property pane --------------------------------------------------------
//
// The pane under the tree reads a feature the way a parametric CAD's property
// editor does: named properties in groups (Base, then the feature's own), with
// references shown as the label of the thing they point at -- never the
// document's internal ids or the raw `kind` / `target` keys. Pure: doc in,
// groups out, so `node --test` can pin it.

export interface PropGroup {
  name: string;
  rows: Array<[string, string]>;
}

const r3 = (n: number) => String(Math.round(n * 1000) / 1000);
const mm = (n: number) => `${r3(n)} mm`;
const deg = (n: number) => `${r3(n)}°`;

function words(key: string): string {
  const s = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function partText(n: unknown): string | null {
  const w = partWordFor(n as Parameters<typeof partWordFor>[0]);
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : null;
}

/** Grouped, named properties of one feature (Data tab). */
export function featureProperties(
  doc: ModelDoc, id: string, labels: Record<string, string> = treeLabels(doc), suppressed: ReadonlySet<string> = new Set(),
): PropGroup[] {
  const f = doc.features.find((x) => x.id === id);
  if (!f) return [];
  const ref = (x: unknown): string => (typeof x === 'string' ? (labels[x] ?? x) : '');
  const rec = f as unknown as Record<string, unknown>;
  const label = labels[id] ?? id;
  const base: PropGroup = { name: 'Base', rows: [['Label', label], ['Suppressed', suppressed.has(id) ? 'true' : 'false']] };
  const own: PropGroup = { name: baseLabel(f), rows: [] };
  const rows = own.rows;
  const num = (k: string, fmt = mm): string | null => (typeof rec[k] === 'number' ? fmt(rec[k] as number) : null);
  const add = (k: string, v: string | null) => { if (v !== null) rows.push([k, v]); };
  const vec = (k: string, v: unknown) => {
    if (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number')) {
      const t = v as number[];
      rows.push([`${k} X`, mm(t[0])], [`${k} Y`, mm(t[1])], [`${k} Z`, mm(t[2])]);
    }
  };
  const used = new Set(['id', 'kind', 'name']);
  const take = (...ks: string[]) => ks.forEach((k) => used.add(k));

  switch (f.kind) {
    case 'sketch': {
      take('plane', 'offset', 'frame', 'onDatum', 'points', 'shape', 'bulges', 'rounds', 'rules', 'geoms');
      add('Support', rec.frame ? 'Face' : rec.onDatum ? ref(rec.onDatum) : `${String(rec.plane).toUpperCase()}-plane`);
      add('Attachment Offset', num('offset'));
      add('Shape', rec.shape === 'circle' ? 'Circle' : Array.isArray(rec.geoms) && rec.geoms.length ? 'Mixed geometry' : 'Polygon');
      if (Array.isArray(rec.points) && rec.points.length) add('Points', String(rec.points.length));
      if (Array.isArray(rec.geoms) && rec.geoms.length) add('Geometry', String(rec.geoms.length));
      if (Array.isArray(rec.rules) && rec.rules.length) add('Constraints', String(rec.rules.length));
      break;
    }
    case 'extrude':
      take('target', 'height', 'midplane', 'length2', 'reversed', 'taper', 'direction', 'alongNormal');
      add('Type', 'Length'); add('Length', num('height'));
      add('Side Type', rec.midplane === true ? 'Symmetric to plane' : typeof rec.length2 === 'number' ? 'Two sides' : 'One side');
      if (rec.midplane !== true && typeof rec.length2 === 'number') add('Length 2', num('length2'));
      if (typeof rec.taper === 'number') add('Taper Angle', num('taper', deg));
      add('Reversed', rec.reversed === true ? 'true' : 'false'); add('Profile', ref(rec.target));
      add('Direction', directionText(rec));
      break;
    case 'pocket':
      take('target', 'into', 'depth', 'midplane', 'length2', 'reversed', 'through', 'taper', 'direction', 'alongNormal');
      add('Type', rec.through === true ? 'Through all' : 'Dimension'); add('Length', num('depth'));
      add('Side Type', rec.midplane === true ? 'Symmetric to plane' : typeof rec.length2 === 'number' ? 'Two sides' : 'One side');
      if (rec.midplane !== true && typeof rec.length2 === 'number') add('Length 2', num('length2'));
      if (typeof rec.taper === 'number') add('Taper Angle', num('taper', deg));
      add('Reversed', rec.reversed === true ? 'true' : 'false');
      add('Profile', ref(rec.target));
      add('Direction', directionText(rec));
      base.rows.push(['Base', ref(rec.into)]);
      break;
    case 'revolve':
      take('target', 'angle');
      add('Type', 'Angle'); add('Angle', num('angle', deg)); add('Profile', ref(rec.target));
      break;
    case 'groove':
      take('target', 'angle', 'into');
      add('Type', 'Angle'); add('Angle', num('angle', deg)); add('Profile', ref(rec.target));
      if (typeof rec.into === 'string') base.rows.push(['Base', ref(rec.into)]);
      break;
    case 'fillet': {
      take('target', 'size', 'style', 'edge');
      const chamfer = f.style === 'chamfer';
      if (chamfer) add('Chamfer Type', 'Equal distance');
      add(chamfer ? 'Size' : 'Radius', num('size'));
      const e = rec.edge as { cause?: string; of?: unknown[] } | undefined;
      let edge: string | null = null;
      if (e?.cause === 'between' && Array.isArray(e.of)) {
        const [a, b] = e.of.map(partText);
        const short = (t: string) => t.replace(/ face$/i, '').replace(/^([+-])([xyz])$/i, (_m, sg: string, ax: string) => `${sg}${ax.toUpperCase()}`);
        if (a && b) edge = `${short(a)} / ${short(b)}`;
      }
      add('Edge', edge ?? 'Selected edge');
      base.rows.push(['Base', ref(rec.target)]);
      break;
    }
    case 'hole':
      take('target', 'diameter', 'depth', 'center', 'axis', 'corners', 'counterbore', 'countersink');
      add('Diameter', num('diameter')); add('Depth', num('depth'));
      if (typeof rec.axis === 'string') add('Direction', `${rec.axis.toUpperCase()} axis`);
      vec('Position', rec.center);
      base.rows.push(['Base', ref(rec.target)]);
      break;
    case 'shell':
      take('target', 'thickness', 'open');
      add('Thickness', num('thickness'));
      base.rows.push(['Base', ref(rec.target)]);
      break;
    default: {
      // Everything else: scalars and short vectors under their words, any
      // reference as its label. Nested outlines and TopoNames stay out.
      for (const [k, v] of Object.entries(rec)) {
        if (used.has(k)) continue;
        if (k === 'target' || (typeof v === 'string' && labels[v] !== undefined)) {
          add(k === 'target' ? 'Base' : words(k), ref(v));
        } else if (typeof v === 'number') add(words(k), r3(v));
        else if (typeof v === 'boolean') add(words(k), v ? 'true' : 'false');
        else if (typeof v === 'string' && v.length <= 40) add(words(k), words(v));
        else if (Array.isArray(v) && v.length > 0 && v.length <= 4 && v.every((x) => typeof x === 'number')) {
          add(words(k), (v as number[]).map(r3).join(', '));
        }
      }
    }
  }
  return [base, ...(own.rows.length ? [own] : [])];
}

/** The Direction row of a pad or pocket: the sketch normal, or the vector it was given. */
function directionText(rec: Record<string, unknown>): string {
  const d = rec.direction;
  if (Array.isArray(d) && d.length === 3 && d.every((c) => typeof c === 'number')) {
    const text = `Custom (${d.map((c) => String(Math.round((c as number) * 1e4) / 1e4)).join(', ')})`;
    return rec.alongNormal === false ? `${text}, length along it` : text;
  }
  return 'Normal to sketch';
}
