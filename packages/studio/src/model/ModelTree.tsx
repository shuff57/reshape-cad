// ModelTree.tsx: the left panel's feature tree.
//
// Presentational: the document, the selection, the view states (rollback,
// suppress, eye overrides) and every action are owned by the caller
// (ModelEditor / ReshapeStudio). This file draws the rows from
// model-tree-core.ts's tree and reports what the student did. Same rule as
// ContextBar: no selection logic of its own, so a click here and a click in the
// viewport can never be two copies of the state that have to agree.
//
// Behaviour (the part that matters more than the look):
//   click          select (Ctrl/Cmd/Shift adds to the selection)
//   double-click   edit that feature (a sketch opens its 2D sketcher)
//   right-click    context menu (the caller's)
//   eye            show / hide that feature's shape in the viewport
//   arrow          expand / collapse; selecting something in the viewport that
//                  lives inside a collapsed branch opens the branch and
//                  scrolls the row into view
//   keyboard       Up/Down move, Left/Right fold, Enter edit, Space eye,
//                  Delete removes
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Feature, ModelDoc, SketchPlane } from '@shuff57/reshape-script/model-types';
import {
  ancestorKeys, buildModelTree, DEFAULT_EXPANDED, featureProperties, isShown, ORIGIN_ITEMS, treeLabels, visibleRows,
  type PropGroup, type TreeIcon, type TreeNode,
} from './model-tree-core.js';
import { SolidIcon } from '../icons/SolidIcon.js';
import type { SolidIconId } from '../icons/solidcraft-icons.js';
import PadProperties from './PadProperties.js';
import { applyPadProp, padPropertyGroups, parseQuantity, readPaneBinding, type PropRow } from './pad-props-core.js';
import { isPadFeature, lengthSlot } from './pad-task-core.js';

/** How the property view reaches the script's named parameters (fx chips). */
export interface PropertyBinding {
  boundTo: (slot: string) => string | undefined;
  known: readonly string[];
  /** The value a parameter has right now, or undefined for a name that is not one. */
  valueOf?: (name: string) => number | undefined;
  /** Bind a slot to a parameter name, or free it with null. */
  onBind: (slot: string, name: string | null, value: number, intent?: 'bind' | 'follow') => { value: number } | { why: string };
  /** The Pad task panel holds a draft of the selected feature: no edits here. */
  locked?: boolean;
}

interface Props {
  doc: ModelDoc;
  docName?: string;
  selected: string[];
  refusals?: Map<string, string>;
  rollbackIndex?: number | null;
  suppressed: ReadonlySet<string>;
  visibility: ReadonlyMap<string, boolean>;
  /** Ids of the solids on screen by default (the model's own top level). */
  topLevelIds: ReadonlySet<string>;
  activePlane: SketchPlane;
  onPick: (id: string, additive: boolean) => void;
  /** Replace the selection with exactly these ids (the Body row). */
  onSelectMany: (ids: string[]) => void;
  onPlane: (plane: SketchPlane) => void;
  /** value null clears the override (back to the default). */
  onSetVisible: (ids: string[], value: boolean | null) => void;
  onEdit: (id: string) => void;
  onMenu: (id: string, x: number, y: number) => void;
  onDelete: (id: string) => void;
  /** A property edited in the Data tab: the feature, replaced as one undo step. */
  onChangeFeature?: (next: Feature) => void;
  onToggleSuppressed?: (id: string) => void;
  /** The script's named parameters, for the fx chips of the Data tab. */
  propertyBinding?: PropertyBinding;
}

/** 16px glyphs, drawn for this project. Outline in currentColor, one accent
 *  fill per family so Pad/Pocket/Chamfer read apart at a glance. */
const TREE_PACK_ICON: Partial<Record<TreeIcon, SolidIconId>> = {
  body: '3d-component', axis: '2d-axis', plane: '2d-plane', point: '2d-point',
  pad: '3d-extrude', pocket: '3d-cut', revolution: '3d-revolve', fillet: '3d-fillet-3d', chamfer: '3d-chamfer',
  hole: '3d-hole', mirrored: '3d-mirror', 'linear-pattern': '3d-pattern', 'polar-pattern': '3d-pattern-circ',
  thickness: '3d-shell', draft: '3d-draft', boolean: '3d-combine', transform: '3d-transform', blend: '3d-loft',
};

function Glyph({ icon }: { icon: TreeIcon }) {
  const pack = TREE_PACK_ICON[icon];
  if (pack) return <SolidIcon id={pack} size={18} />;
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  const add = 'var(--tree-add, #8be9fd)';
  const sub = 'var(--tree-sub, #ff9a8a)';
  switch (icon) {
    case 'document':
      return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.8h5.6L12.5 4.7V14H4z" {...s} /><path d="M9.4 1.8v3.1h3" {...s} /></svg>;
    case 'body':
      return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 5.2 8 2.5l5.5 2.7v5.6L8 13.5l-5.5-2.7z" {...s} fill={add} fillOpacity=".22" /><path d="M2.5 5.2 8 8l5.5-2.8M8 8v5.5" {...s} /></svg>;
    case 'origin':
      return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M8 8l-5 3.5M8 8l5-3.5" {...s} /><circle cx="8" cy="8" r="1.3" fill="currentColor" /></svg>;
    case 'axis':
      return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 12.5 13 3.5" {...s} /></svg>;
    case 'plane':
      return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 11.5 5 4.5h8.5L11 11.5z" {...s} /></svg>;
    case 'point':
      return <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.2" fill="currentColor" /></svg>;
    case 'sketch':
      return <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="4" width="8.5" height="8" {...s} stroke="var(--tree-sketch, #ff7a7a)" /><path d="m9 9.6 4.2-4.2 1.4 1.4L10.4 11 8.7 11.4z" {...s} /></svg>;
    case 'pad':
      return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 7.2 8 4.6l5.5 2.6v4.6L8 14.4l-5.5-2.6z" {...s} fill={add} fillOpacity=".3" /><path d="M2.5 7.2 8 9.8l5.5-2.6M8 9.8v4.6M8 1.5v3.1M6.4 3 8 1.5 9.6 3" {...s} /></svg>;
    case 'pocket':
      return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 6 8 3.4 13.5 6v5.6L8 14.2l-5.5-2.6z" {...s} /><path d="M5.2 7.6 8 6.2l2.8 1.4v2.4L8 11.4 5.2 10z" {...s} fill={sub} fillOpacity=".55" /></svg>;
    case 'revolution':
      return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8v12.4" {...s} strokeDasharray="1.6 1.6" /><path d="M8 3.5c3.6 0 5.6 1.9 5.6 4.5s-2 4.5-5.6 4.5" {...s} fill={add} fillOpacity=".3" /></svg>;
    case 'groove':
      return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8v12.4" {...s} strokeDasharray="1.6 1.6" /><path d="M8 3.5c3.6 0 5.6 1.9 5.6 4.5s-2 4.5-5.6 4.5" {...s} fill={sub} fillOpacity=".5" /></svg>;
    case 'fillet':
      return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 13.5h11V8.5a5 5 0 0 0-5-5h-6z" {...s} fill={add} fillOpacity=".3" /></svg>;
    case 'chamfer':
      return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 13.5h11V7.5l-4-4h-7z" {...s} fill={add} fillOpacity=".3" /></svg>;
    case 'hole':
      return <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="1" {...s} /><circle cx="8" cy="8" r="2.8" {...s} fill={sub} fillOpacity=".55" /></svg>;
    case 'mirrored':
      return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8v12.4" {...s} strokeDasharray="1.6 1.6" /><path d="M2.5 5.5v5l4-2.5zM13.5 5.5v5l-4-2.5z" {...s} fill={add} fillOpacity=".3" /></svg>;
    case 'linear-pattern':
      return <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.8" y="5.5" width="3.6" height="5" {...s} fill={add} fillOpacity=".3" /><rect x="6.2" y="5.5" width="3.6" height="5" {...s} /><rect x="10.6" y="5.5" width="3.6" height="5" {...s} /></svg>;
    case 'polar-pattern':
      return <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.2" {...s} strokeDasharray="1.8 1.8" /><circle cx="8" cy="2.8" r="1.5" fill={add} /><circle cx="12.5" cy="10.6" r="1.5" fill="currentColor" /><circle cx="3.5" cy="10.6" r="1.5" fill="currentColor" /></svg>;
    case 'thickness':
      return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 6 8 3.4 13.5 6v5.6L8 14.2l-5.5-2.6z" {...s} /><path d="M5 7.4 8 6l3 1.4v3.2l-3 1.4-3-1.4z" {...s} /></svg>;
    case 'draft':
      return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13.5 5 3h6l2 10.5z" {...s} fill={add} fillOpacity=".3" /></svg>;
    case 'boolean':
      return <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="6" cy="8" r="4" {...s} /><circle cx="10" cy="8" r="4" {...s} fill={add} fillOpacity=".3" /></svg>;
    case 'datum':
      return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 11.5 5 4.5h8.5L11 11.5z" {...s} fill={add} fillOpacity=".25" /></svg>;
    case 'transform':
      return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v12M2 8h12M8 2 6.3 3.7M8 2l1.7 1.7M8 14l-1.7-1.7M8 14l1.7-1.7M2 8l1.7-1.7M2 8l1.7 1.7M14 8l-1.7-1.7M14 8l-1.7 1.7" {...s} /></svg>;
    case 'blend':
      return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 12.5c3-1 3-8 5.5-8s2.5 7 5.5 8z" {...s} fill={add} fillOpacity=".3" /></svg>;
    default:
      return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 5.2 8 2.5l5.5 2.7v5.6L8 13.5l-5.5-2.7z" {...s} fill={add} fillOpacity=".22" /><path d="M2.5 5.2 8 8l5.5-2.8M8 8v5.5" {...s} /></svg>;
  }
}

function Eye({ on }: { on: boolean }) {
  return on ? (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.5 8S4 3.8 8 3.8 14.5 8 14.5 8 12 12.2 8 12.2 1.5 8 1.5 8z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="2.1" fill="currentColor" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.5 8S4 3.8 8 3.8 14.5 8 14.5 8 12 12.2 8 12.2 1.5 8 1.5 8z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" opacity=".55" />
      <path d="M2.5 13.5 13.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export default function ModelTree({
  doc, docName, selected, refusals, rollbackIndex, suppressed, visibility, topLevelIds, activePlane,
  onPick, onSelectMany, onPlane, onSetVisible, onEdit, onMenu, onDelete,
  onChangeFeature, onToggleSuppressed, propertyBinding,
}: Props) {
  const root = useMemo(
    () => buildModelTree(doc, { docName, rollbackIndex, refusals, suppressed }),
    [doc, docName, rollbackIndex, refusals, suppressed],
  );
  // A structural row (document, body, origin, an axis) can be the cursor too.
  const [cursor, setCursor] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [propTab, setPropTab] = useState<'view' | 'data'>('data');
  // A feature that has a profile sketch folded under it opens the first time
  // it is seen (the Sketch is part of how the Pad reads); after that the
  // student's own fold/unfold choice is kept. Origin stays closed.
  const seenRef = useRef<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => {
    const out = new Set(DEFAULT_EXPANDED);
    const walk = (n: TreeNode) => {
      if (n.kind === 'feature' && n.children.length) { out.add(n.key); seenRef.current.add(n.key); }
      n.children.forEach(walk);
    };
    walk(buildModelTree(doc, { docName, rollbackIndex, refusals, suppressed }));
    return out;
  });
  useEffect(() => {
    const fresh: string[] = [];
    const walk = (n: TreeNode) => {
      if (n.kind === 'feature' && n.children.length && !seenRef.current.has(n.key)) fresh.push(n.key);
      n.children.forEach(walk);
    };
    walk(root);
    if (fresh.length === 0) return;
    for (const k of fresh) seenRef.current.add(k);
    setExpanded((prev) => new Set([...prev, ...fresh]));
  }, [root]);
  const rows = useMemo(() => visibleRows(root, expanded), [root, expanded]);

  // A selection made elsewhere (the viewport, the timeline) opens the branch
  // it lives in and scrolls its row into view.
  const selKey = selected.join('|');
  useEffect(() => {
    if (selected.length === 0) return;
    const need = new Set<string>();
    for (const id of selected) for (const k of ancestorKeys(root, id)) need.add(k);
    if (need.size) {
      setExpanded((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const k of need) if (!next.has(k)) { next.add(k); changed = true; }
        return changed ? next : prev;
      });
    }
    const id = selected[selected.length - 1];
    const el = hostRef.current?.querySelector<HTMLElement>(`[data-key="f:${CSS.escape(id)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey]);

  const toggle = (key: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const shown = (id: string) => isShown(doc, id, visibility, topLevelIds);
  const bodyIds = useMemo(
    () => doc.features.filter((f) => f.kind !== 'sketch' && f.kind !== 'datum' && topLevelIds.has(f.id)).map((f) => f.id),
    [doc, topLevelIds],
  );

  function isOn(n: TreeNode): boolean {
    if (n.featureId) return selected.includes(n.featureId);
    if (n.plane) return activePlane === n.plane && cursor === n.key;
    return cursor === n.key;
  }

  function activate(n: TreeNode, additive: boolean) {
    setCursor(n.key);
    // Keep the keyboard on the tree: nothing a click selects (the Dimensions
    // fields, the context bar) may pull focus off the arrows.
    hostRef.current?.focus({ preventScroll: true });
    if (n.featureId) onPick(n.featureId, additive);
    else if (n.plane) onPlane(n.plane);
    else if (n.kind === 'body') onSelectMany(bodyIds);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const i = Math.max(0, rows.findIndex((r) => r.node.key === cursor));
    const here = rows[i];
    if (!here) return;
    const go = (j: number) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, j))];
      if (r) activate(r.node, false);
    };
    if (e.key === 'ArrowDown') { e.preventDefault(); go(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(i - 1); }
    else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (here.node.children.length && !expanded.has(here.node.key)) toggle(here.node.key);
      else go(i + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (here.node.children.length && expanded.has(here.node.key)) toggle(here.node.key);
      else if (here.parent) {
        const p = rows.find((r) => r.node.key === here.parent);
        if (p) activate(p.node, false);
      }
    } else if (e.key === 'Enter' && here.node.featureId) { e.preventDefault(); onEdit(here.node.featureId); }
    else if (e.key === ' ' && here.node.featureId) { e.preventDefault(); toggleEye(here.node); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && here.node.featureId) { e.preventDefault(); onDelete(here.node.featureId); }
  }

  function toggleEye(n: TreeNode) {
    if (n.kind === 'body') {
      const anyShown = bodyIds.some(shown);
      if (anyShown) onSetVisible(bodyIds, false);
      else onSetVisible(bodyIds, null);
      return;
    }
    if (n.kind === 'origin') {
      const any = originKeys.some(originShown);
      onSetVisible(originKeys, any ? null : true);
      return;
    }
    if (n.kind === 'origin-item') {
      onSetVisible([n.key], originShown(n.key) ? null : true);
      return;
    }
    if (!n.featureId) return;
    const now = shown(n.featureId);
    // Back to the default as soon as the override equals it.
    onSetVisible([n.featureId], now ? false : true);
  }

  // The origin's rows start hidden (like a CAD origin) and their eyes drive
  // `origin:*` keys of the same visibility map; the viewport draws them.
  const originKeys = ORIGIN_ITEMS.map((o) => o.key);
  const originShown = (key: string) => visibility.get(key) === true;
  function hasEye(n: TreeNode): boolean {
    if (n.kind === 'origin' || n.kind === 'origin-item') return true;
    if (n.kind === 'body') return true;
    if (n.kind !== 'feature' || !n.featureId) return false;
    return doc.features.find((f) => f.id === n.featureId)?.kind !== 'datum';
  }
  function eyeOn(n: TreeNode): boolean {
    if (n.kind === 'origin') return originKeys.some(originShown);
    if (n.kind === 'origin-item') return originShown(n.key);
    if (n.kind === 'body') return bodyIds.length === 0 || bodyIds.some(shown);
    return !!n.featureId && shown(n.featureId);
  }

  // The property pane under the tree describes the last selected feature.
  const propId = [...selected].reverse().find((id) => doc.features.some((f) => f.id === id));
  const propNode = (() => {
    if (!propId) return null;
    const find = (n: TreeNode): TreeNode | null => {
      if (n.featureId === propId) return n;
      for (const c of n.children) { const r = find(c); if (r) return r; }
      return null;
    };
    return find(root);
  })();
  const propFeature = propId ? doc.features.find((f) => f.id === propId) : undefined;
  const [closedGroups, setClosedGroups] = useState<ReadonlySet<string>>(() => new Set());
  let propGroups: PropGroup[] = [];
  const padProps = propTab === 'data' && propFeature && isPadFeature(propFeature) && onChangeFeature && propertyBinding
    ? padPropertyGroups(doc, propFeature, {
        label: treeLabels(doc)[propFeature.id] ?? propFeature.id,
        suppressed: suppressed.has(propFeature.id),
        boundTo: propertyBinding.boundTo,
      })
    : null;

  /** One committed cell of the Pad's Data tab. A sentence back means refused. */
  function commitPadProp(key: string, value: unknown, freed = false): string | null {
    if (!propFeature || !isPadFeature(propFeature) || !onChangeFeature) return 'Nothing is selected.';
    if (key === 'suppressed') { onToggleSuppressed?.(propFeature.id); return null; }
    const r = applyPadProp(doc, propFeature, key, value);
    if (r.ok === 'open') { onEdit(propFeature.id); return r.why; }
    if (!r.ok) return r.why;
    // A length that follows a parameter moves the parameter, not just the step.
    if (r.slot && propertyBinding && !freed) {
      const name = propertyBinding.boundTo(r.slot);
      if (name && typeof value === 'number') propertyBinding.onBind(r.slot, name, value, 'follow');
    }
    onChangeFeature(r.feature);
    return null;
  }

  /** The "=name" / "=12" text of an expression typed into a quantity cell. */
  function commitPadExpr(key: string, text: string): string | null {
    if (!propFeature || !isPadFeature(propFeature) || !onChangeFeature || !propertyBinding) return 'Nothing is selected.';
    const b = readPaneBinding(text, propertyBinding.known, doc.features.map((x) => x.id));
    if (b.kind === 'error') return b.why;
    if (key !== 'length') {
      if (b.kind === 'param') return 'This field takes a number; only the first length can follow a parameter.';
      return commitPadProp(key, b.value);
    }
    const slot = lengthSlot(propFeature);
    const cur = propFeature.kind === 'extrude' ? Math.abs(propFeature.height) : propFeature.depth;
    if (b.kind === 'number') {
      // "=12" frees the binding: the value becomes a constant of this feature
      // and the parameter is left as it was (commitPadProp must not re-follow it).
      propertyBinding.onBind(slot, null, b.value);
      return commitPadProp('length', b.value, true);
    }
    // Binding follows the parameter: the field takes the parameter's value and
    // no parameter is rewritten. Check the edit with that value BEFORE the bind,
    // so a refused edit leaves every binding as it was.
    const target = propertyBinding.valueOf?.(b.name) ?? cur;
    const edit = applyPadProp(doc, propFeature, 'length', target);
    if (edit.ok !== true) return edit.why;
    const r = propertyBinding.onBind(slot, b.name, cur, 'bind');
    if ('why' in r) return r.why;
    onChangeFeature(edit.feature);
    return null;
  }
  const parseCell = (row: PropRow, t: string) => parseQuantity(t, row.cell.t === 'quantity' ? row.cell.dim : 'plain');

  if (propFeature && propNode) {
    if (propTab === 'data') {
      propGroups = featureProperties(doc, propFeature.id, treeLabels(doc), suppressed);
    } else {
      const idx = doc.features.findIndex((f) => f.id === propFeature.id);
      propGroups = [
        { name: 'Base', rows: [
          ['Visibility', propFeature.kind === 'datum' ? 'Hidden' : shown(propFeature.id) ? 'Shown' : 'Hidden'],
          ['Suppressed', propNode.suppressed ? 'true' : 'false'],
          ['Tip', propNode.tip ? 'true' : 'false'],
        ] },
        { name: 'Status', rows: [
          ['State', propNode.invalid ? 'Invalid' : propNode.suppressed ? 'Suppressed' : propNode.skipped ? 'Not built' : propNode.afterTip ? 'Rolled back' : propNode.tip ? 'Tip' : 'Built'],
          ['Step', `${idx + 1} of ${doc.features.length}`],
        ] },
      ];
    }
  }

  return (
    <div className="mtree-wrap">
    <div
      ref={hostRef}
      className="mtree"
      role="tree"
      aria-label="Model"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      {rows.map(({ node: n, depth }) => {
        const open = expanded.has(n.key);
        const on = isOn(n);
        const eye = hasEye(n);
        const dim = !!n.afterTip || !!n.skipped;
        const title = n.invalid
          ? n.invalid
          : n.skipped
            ? n.skipped
            : n.suppressed
              ? `${n.label} is suppressed. Right-click to switch it back on.`
              : n.tip
                ? `${n.label} is the tip: the model is built up to this step.`
                : n.afterTip
                  ? `${n.label} comes after the tip, so it is not built.`
                  : undefined;
        return (
          <div
            key={n.key}
            data-key={n.key}
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={n.children.length ? open : undefined}
            aria-selected={on}
            className={
              'mtree-row'
              + (on ? ' is-on' : '')
              + (n.kind === 'document' ? ' is-doc' : '')
              + (n.kind === 'origin' || n.kind === 'origin-item' ? ' is-origin' : '')
              + (n.tip ? ' is-tip' : '')
              + (dim ? ' is-dim' : '')
              + (n.suppressed ? ' is-suppressed' : '')
              + (n.invalid ? ' is-invalid' : '')
              + (eye && !eyeOn(n) && n.kind !== 'origin' && n.kind !== 'origin-item' ? ' is-hidden' : '')
            }
            style={{ paddingLeft: 4 + depth * 14 }}
            title={title}
            onClick={(e) => activate(n, e.ctrlKey || e.metaKey || e.shiftKey)}
            onDoubleClick={() => { if (n.featureId) onEdit(n.featureId); else if (n.children.length) toggle(n.key); }}
            onContextMenu={(e) => {
              if (!n.featureId) return;
              e.preventDefault();
              e.stopPropagation();
              onMenu(n.featureId, e.clientX, e.clientY);
            }}
          >
            <span
              className={'mtree-arrow' + (n.children.length ? (open ? ' is-open' : '') : ' is-leaf')}
              onClick={(e) => { e.stopPropagation(); if (n.children.length) toggle(n.key); }}
              aria-hidden="true"
            />
            {eye ? (
              <button
                type="button"
                tabIndex={-1}
                className={'mtree-eye' + (eyeOn(n) ? ' is-on' : '')}
                aria-label={`${eyeOn(n) ? 'Hide' : 'Show'} ${n.label}`}
                onClick={(e) => { e.stopPropagation(); toggleEye(n); }}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                <Eye on={eyeOn(n)} />
              </button>
            ) : n.kind === 'document' ? null : <span className="mtree-eye is-none" />}
            <span className={'mtree-icon icon-' + n.icon}>
              <Glyph icon={n.icon} />
              {n.tip && <span className="mtree-badge is-tip" aria-hidden="true" />}
              {n.invalid && <span className="mtree-badge is-invalid" aria-hidden="true">!</span>}
            </span>
            <span className="mtree-label">{n.label}</span>
            {n.suppressed && <span className="mtree-tag">suppressed</span>}
          </div>
        );
      })}
    </div>
    <div className="mprops" aria-label="Properties">
      <div className="mprops-body">
        {padProps ? (
          <PadProperties
            key={propFeature!.id}
            groups={padProps}
            locked={propertyBinding?.locked}
            onCommit={commitPadProp}
            onExpr={commitPadExpr}
            parse={parseCell}
          />
        ) : propGroups.length === 0 ? <div className="mprops-empty">Select a feature to see its properties.</div> : propGroups.map((g) => {
          const shut = closedGroups.has(g.name);
          return (
            <div className="mprops-group" key={g.name}>
              <button
                type="button"
                className={'mprops-gh' + (shut ? '' : ' is-open')}
                aria-expanded={!shut}
                onClick={() => setClosedGroups((prev) => { const n = new Set(prev); if (n.has(g.name)) n.delete(g.name); else n.add(g.name); return n; })}
              >{g.name}</button>
              {!shut && g.rows.map(([k, v]) => (
                <div className="mprops-row" key={k}><span className="mprops-k" title={k}>{k}</span><span className="mprops-v" title={v}>{v}</span></div>
              ))}
            </div>
          );
        })}
      </div>
      <div className="mprops-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={propTab === 'view'} className={propTab === 'view' ? 'is-on' : ''} onClick={() => setPropTab('view')}>View</button>
        <button type="button" role="tab" aria-selected={propTab === 'data'} className={propTab === 'data' ? 'is-on' : ''} onClick={() => setPropTab('data')}>Data</button>
      </div>
    </div>
      <style>{`
        .mtree-wrap { display: flex; flex-direction: column; height: 100%; min-height: 0; margin: -8px 0; }
        .mtree-wrap > .mtree { flex: 1 1 0; min-height: 120px; overflow-y: auto; }
        .mprops { color: var(--reshape-text); flex: 0 0 auto; height: 60%; min-height: 220px; display: flex; flex-direction: column; overflow: hidden; border-top: 1px solid var(--reshape-border); font-size: 12px; }
        .mprops-tabs { display: flex; justify-content: center; gap: 2px; padding: 0 6px; border-top: 1px solid var(--reshape-border); flex: 0 0 auto; }
        .mprops-tabs button {
          border: 0; background: transparent; color: var(--reshape-text-muted); padding: 3px 10px;
          border-radius: 0 0 4px 4px; cursor: pointer; font: inherit;
        }
        .mprops-tabs button.is-on { color: var(--reshape-text); background: rgba(248, 248, 242, 0.1); font-weight: 600; }
        .mprops-head, .mprops-row { display: grid; grid-template-columns: minmax(70px, 40%) 1fr; gap: 6px; padding: 2px 10px; }
        .mprops-head { color: var(--reshape-text-muted); font-size: 11px; background: rgba(248, 248, 242, 0.05); }
        .mprops-row { border-bottom: 1px solid rgba(248, 248, 242, 0.05); }
        .mprops-k { color: var(--reshape-text-muted); overflow: hidden; text-overflow: ellipsis; }
        .mprops-v { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mprops-body { flex: 1 1 0; min-height: 0; overflow-y: auto; }
        .mprops-gh {
          display: flex; align-items: center; gap: 6px; width: 100%; border: 0; text-align: left;
          background: rgba(248, 248, 242, 0.09); color: var(--reshape-text); font: inherit; font-weight: 600;
          padding: 3px 10px; cursor: pointer;
        }
        .mprops-gh::before {
          content: ""; border-style: solid; border-width: 4px 0 4px 6px;
          border-color: transparent transparent transparent var(--reshape-text-muted);
        }
        .mprops-gh.is-open::before { transform: rotate(90deg); }
        .mprops-row:hover { background: rgba(248, 248, 242, 0.05); }
        .mprops-row { padding-left: 22px; }
        .mprops-empty { padding: 8px 10px; color: var(--reshape-text-muted); }
        .mtree {
          --tree-row: 24px;
          font-size: 13px; color: var(--reshape-text); outline: none;
          padding: 2px 0 8px; user-select: none;
        }
        .mtree:focus-visible { box-shadow: inset 0 0 0 1px var(--reshape-accent); }
        .mtree-row {
          display: flex; align-items: center; gap: 2px; height: var(--tree-row);
          padding-right: 8px; cursor: default; white-space: nowrap;
          border-left: 3px solid transparent; position: relative;
        }
        .mtree-row:hover { background: rgba(248, 248, 242, 0.06); }
        .mtree-row.is-on {
          background: color-mix(in srgb, var(--reshape-accent) 34%, transparent);
          border-left: 3px solid var(--reshape-accent); padding-right: 8px;
          box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--reshape-accent) 70%, transparent);
        }
        .mtree-row.is-on .mtree-label { font-weight: 600; color: var(--reshape-text); }
        .mtree-row.is-doc .mtree-label { font-weight: 700; }
        .mtree-row.is-origin { color: var(--reshape-text-muted); }
        .mtree-row.is-origin .mtree-icon { color: var(--reshape-text-muted); }
        .mtree-row.is-dim .mtree-label, .mtree-row.is-dim .mtree-icon { opacity: 0.7; }
        .mtree-row.is-hidden .mtree-label { color: var(--reshape-text-muted); opacity: 0.7; }
        .mtree-row.is-hidden .mtree-icon { opacity: 0.55; }
        .mtree-row.is-on .mtree-label, .mtree-row.is-on .mtree-icon { opacity: 1; color: var(--reshape-text); }
        .mtree-row.is-suppressed .mtree-label { text-decoration: line-through; opacity: 0.7; }
        .mtree-row.is-suppressed .mtree-icon { opacity: 0.65; filter: grayscale(1); }
        .mtree-row.is-on.is-suppressed .mtree-label { opacity: 0.8; }
        .mtree-row.is-on.is-suppressed .mtree-icon { opacity: 0.8; }
        .mtree-row.is-on.is-tip, .mtree-row.is-on.is-suppressed {
          background: color-mix(in srgb, var(--reshape-accent) 34%, transparent);
          border-left-color: var(--reshape-accent);
        }
        .mtree-row.is-invalid .mtree-label { color: var(--reshape-danger); }
        .mtree-arrow { width: 14px; height: 14px; flex: 0 0 14px; position: relative; cursor: pointer; }
        .mtree-arrow::before {
          content: ""; position: absolute; left: 4px; top: 3px;
          border-style: solid; border-width: 4px 0 4px 6px;
          border-color: transparent transparent transparent var(--reshape-text-muted);
          transition: transform 0.08s;
        }
        .mtree-arrow.is-open::before { transform: rotate(90deg) translate(1px, 0); }
        .mtree-arrow.is-leaf { cursor: default; }
        .mtree-arrow.is-leaf::before { display: none; }
        .mtree-eye {
          width: 18px; height: 18px; flex: 0 0 18px; padding: 1px; border: 0; background: transparent;
          color: var(--reshape-text-muted); cursor: pointer; border-radius: 3px; display: inline-flex;
        }
        .mtree-eye svg { width: 16px; height: 16px; }
        .mtree-eye.is-on { color: var(--reshape-text); }
        .mtree-eye:hover:not(.is-none) { background: rgba(248, 248, 242, 0.12); }
        .mtree-eye.is-none { cursor: default; }
        .mtree-icon { position: relative; width: 18px; height: 18px; flex: 0 0 18px; display: inline-flex; margin: 0 3px 0 2px; }
        .mtree-icon svg { width: 18px; height: 18px; }
        .mtree-badge {
          position: absolute; right: -3px; bottom: -3px; width: 9px; height: 9px; border-radius: 50%;
          box-shadow: 0 0 0 1.5px var(--reshape-surface, #1e1f29);
        }
        .mtree-badge.is-tip { background: var(--reshape-success); }
        .mtree-badge.is-tip::after {
          content: ""; position: absolute; left: 2.5px; top: 2px;
          border-style: solid; border-width: 3px 2px 0 2px; border-color: #12331c transparent transparent transparent;
        }
        .mtree-badge.is-invalid {
          background: var(--reshape-danger); color: #fff; font-size: 8px; font-weight: 800; line-height: 9px; text-align: center;
        }
        .mtree-label { overflow: hidden; text-overflow: ellipsis; }
        .mtree-tag {
          margin-left: 6px; font-size: 10px; letter-spacing: 0.04em; text-transform: uppercase;
          color: var(--reshape-text-muted);
        }
      `}</style>
    </div>
  );
}
