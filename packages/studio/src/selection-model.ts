// Pure selection-state type/op model for SPEC-mouse-parity.md Phase 3 item 7
// ("unify selection state between viewport and ModelEditor... the riskiest
// refactor in the phase"). This is the DESIGN only -- a later task wires it
// into ReshapeStudio.tsx/ModelEditor.tsx; nothing here touches React or the
// DOM, so it is unit-testable under node --test the same as camera-fit.ts.
//
// WHAT THIS REPLACES. Today selection is six separate useState calls in
// ReshapeStudio.tsx: `selected` (feature ids, mutated by ModelEditor's
// pick() at ModelEditor.tsx:1118-1125), `pickedEdge`/`pickedFace`/
// `pickedSize` (the single most-recent viewport pick, mutated only by
// onPick around ReshapeStudio.tsx:1223-1264), and `pickedEdges`/
// `pickedFaces` (a Shift-accumulated multi-pick, same onPick). Read back
// together at ReshapeStudio.tsx:517 (HandleOverlay's feature filter),
// :686-705 (the context bar's selectionLabel, ownerOf-filtered) and
// ModelEditor.tsx's chosen()/round()/hollow() (ownerOf-guarded against
// staleness -- see round()'s own regression comment at ModelEditor.tsx:724).
// `SelectionState` merges the three axes into one `items` list plus one
// `primary` slot; `featuresOf`/`primaryOf`/`ownerScoped` are the read shapes
// that replace `selected`/the pickedEdge-trio/the ownerOf-filtered reads
// above -- see each function's own comment for the exact line it stands in
// for.
//
// pick(id, additive) at ModelEditor.tsx:1118-1125 is exactly `replace`
// (additive=false, "selected = [id]") and `toggle` (additive=true,
// "selected.includes(id) ? filter it out : append it") below, generalised
// from bare feature ids to any SelectionItem; `toggleFeature` is the
// feature-only wrapper that IS pick()'s additive branch. Structural
// equality for an item with a TopoName reuses the same rule ReshapeStudio's
// own sameTopo() (ReshapeStudio.tsx:61-63) uses to dedupe a Shift-click
// multi-selection: JSON.stringify comparison, since TopoName is a plain
// serialisable object.
//
// DEVIATIONS FROM THE LITERAL SPEC SKETCH (reality won; see the design
// report for the full list):
//  - No `id?: string` field. Nothing in the real pick payloads (ViewportPick
//    in BrepViewportThree.tsx, PickName in model-selection.ts, or the bare
//    `selected: string[]`) carries an id independent of kind+target+name; a
//    feature-kind item already uses `target` as the feature id, so a
//    separate `id` would be redundant and could drift out of sync with it.
//  - No `faceIndex` field (ViewportPick's own -- a mesh re-highlight
//    shortcut, a rendering concern, not a selection-state one).
//  - `ownerScoped` takes `doc` as a second parameter. The pattern it
//    replaces (ReshapeStudio.tsx:686-687) calls `ownerOf(doc, item)`, and
//    `ownerOf` (model-selection.ts) needs `doc` to check whether a name's
//    root feature still exists -- there is no way to answer "which owner"
//    without it.
//  - `toggle`'s primary-on-remove rule ("the new last-remaining item, or
//    null") is a NEW rule this module defines, not a pre-existing behaviour
//    of pick() -- `selected` has no primary concept of its own to match.
//    It does NOT bit-for-bit match onPick's `pickedEdge`, which today is
//    unconditionally overwritten to whatever was just clicked
//    (ReshapeStudio.tsx:1235-1236) even when that same click is a
//    Shift-toggle-OFF in `pickedEdges` -- i.e. today, toggling an edge off
//    still leaves `pickedEdge` pointing at the just-removed edge until the
//    next click. A later refactor that wants that exact quirk preserved
//    cannot lean on this generic `toggle()` alone for the pickedEdge slot;
//    it would need to set `primary` from the raw pick separately from
//    updating multi-select membership.

import type { ModelDoc } from '@shuff57/reshape-script/model-types';
import { ownerOf } from '@shuff57/reshape-script/model-selection';
import type { TopoName } from '@shuff57/reshape-script/topo-name';

/** Which of a shape's parts -- or which higher-level thing -- a selection
 *  entry names. Only 'feature' (ModelEditor's chip/timeline picks) and
 *  'edge'/'face' (BrepViewportThree's ViewportPick) are ever produced by
 *  any op in this module today; 'vertex' and 'body' are reserved for
 *  SPEC-mouse-parity.md Phase 3 item 2 (vertex/body picking, not yet
 *  built) so that landing them later does not need a breaking type change
 *  here. */
export type SelectionKind = 'feature' | 'edge' | 'face' | 'vertex' | 'body';

/** One selected thing. `target` is the feature id for a 'feature' item, or
 *  the owning mesh-batch feature id (ViewportPick's own `target` /
 *  PickName's own `target`) for an 'edge'/'face' item -- see
 *  model-selection.ts's PickName comment for why that is the TIP of the
 *  feature chain, not necessarily the feature that made the geometry.
 *  `name` is the resolved TopoName (pickedEdge.edge / pickedFace.face /
 *  ViewportPick.name), omitted for a 'feature' item and `null` for a real
 *  edge/face pick that could not be traced to a name. `size` mirrors
 *  ViewportPick.size / the old pickedSize, kernel-measured, present only
 *  when the pick resolved one. */
export interface SelectionItem {
  kind: SelectionKind;
  target: string;
  name?: TopoName | null;
  size?: number | [number, number];
}

/** Selection filters (SPEC-mouse-parity.md Phase 3 item 2 -- not built yet,
 *  no equivalent state exists in ReshapeStudio.tsx today). Carried on
 *  SelectionState so the later filter UI has somewhere to live without a
 *  second piece of lifted state; every op below leaves it untouched except
 *  the constructors, which default it to all-true ("nothing is filtered
 *  out" -- today's actual behaviour, since there is no filter yet). */
export interface SelectionFilters {
  face: boolean;
  edge: boolean;
  vertex: boolean;
  body: boolean;
}

export interface SelectionState {
  items: SelectionItem[];
  primary: SelectionItem | null;
  filters: SelectionFilters;
}

/** A fresh, nothing-selected state: empty items, no primary, and every
 *  filter open. The starting point every other constructor below builds
 *  from. */
export function emptySelection(): SelectionState {
  return { items: [], primary: null, filters: { face: true, edge: true, vertex: true, body: true } };
}

function sameName(a: TopoName | null | undefined, b: TopoName | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null;
  // Same rule as ReshapeStudio.tsx's own sameTopo(): TopoName is a plain
  // serialisable object (topo-name.ts), so JSON.stringify is a safe, cheap
  // structural comparison.
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Structural equality for two SelectionItems: same kind, same target, same
 *  name. `size` is deliberately excluded -- nothing in the current app ever
 *  compares picks by size (pickedEdges/pickedFaces dedupe on
 *  `target`+sameTopo(name) alone, ModelEditor.pick()'s `selected` dedupes
 *  on bare id equality, which this collapses to when `name` is absent on
 *  both sides). */
function sameItem(a: SelectionItem, b: SelectionItem): boolean {
  return a.kind === b.kind && a.target === b.target && sameName(a.name, b.name);
}

/** Clears everything, then selects only `item`. This is pick(id, false)
 *  at ModelEditor.tsx:1122 ("selected = [id]"), generalised from a bare
 *  feature id to any SelectionItem. `filters` survives unchanged -- a
 *  plain click has never reset a filter, since no filter exists yet. */
export function replace(state: SelectionState, item: SelectionItem): SelectionState {
  return { items: [item], primary: item, filters: state.filters };
}

/** Removes `item` if present (by structural equality, see sameItem above),
 *  else adds it. This is pick(id, true) at ModelEditor.tsx:1121
 *  ("selected.includes(id) ? filter it out : append it"), generalised the
 *  same way replace() is.
 *
 *  On add, the new item becomes primary -- "the most recent pick" is the
 *  same convention pickedEdge/pickedFace and pickedEdges/pickedFaces
 *  already use ("most recent last", ModelEditor.tsx:172). On remove,
 *  primary becomes the new last-remaining item, or null if none: see this
 *  file's header for why that is a rule this module defines rather than
 *  one pick() already had to make, and where it does not match onPick's
 *  own pickedEdge quirk. */
export function toggle(state: SelectionState, item: SelectionItem): SelectionState {
  const idx = state.items.findIndex((existing) => sameItem(existing, item));
  if (idx === -1) {
    return { items: [...state.items, item], primary: item, filters: state.filters };
  }
  const items = state.items.filter((_, i) => i !== idx);
  const primary = items.length ? items[items.length - 1] : null;
  return { items, primary, filters: state.filters };
}

/** Adds `item`, keeping every existing item -- no presence check, unlike
 *  toggle() (a caller that wants "add only if absent" calls toggle() after
 *  checking, the way onPick's own pickedEdges branch only appends after its
 *  own `hit` check already came back false). Primary is left alone unless
 *  `item` is the very first item this state has ever held, in which case it
 *  becomes primary the same way replace()/toggle()'s add branch would. */
export function add(state: SelectionState, item: SelectionItem): SelectionState {
  const primary = state.items.length === 0 ? item : state.primary;
  return { items: [...state.items, item], primary, filters: state.filters };
}

/** Empties items and primary, unconditionally. `filters` survives -- the
 *  same "not this axis's concern" reasoning as replace()'s. */
export function clear(state: SelectionState): SelectionState {
  return { items: [], primary: null, filters: state.filters };
}

/** pick(featureId, true) exactly -- the feature-kind convenience wrapper
 *  over toggle() a chip/timeline row's onClick calls
 *  (ModelEditor.tsx:1274, :1724, :1840: `pick(f.id, e.ctrlKey ||
 *  e.metaKey || e.shiftKey)`). */
export function toggleFeature(state: SelectionState, featureId: string): SelectionState {
  return toggle(state, { kind: 'feature', target: featureId });
}

/** Every feature in `doc`, selected -- the Ctrl+A case (SPEC-mouse-parity.md
 *  Phase 3 item 6). No existing state constructs this today (there is no
 *  Ctrl+A yet), so `primary` follows the same "most recent [i.e. last]
 *  wins" convention toggle()'s add branch uses; an empty doc returns
 *  emptySelection() in every field, not a special case. */
export function selectAllFeatures(doc: ModelDoc): SelectionState {
  const items: SelectionItem[] = doc.features.map((f) => ({ kind: 'feature' as const, target: f.id }));
  return { ...emptySelection(), items, primary: items.length ? items[items.length - 1] : null };
}

/** The current primary, whole. This replaces reading pickedEdge, pickedFace
 *  and pickedSize as three separate variables (ReshapeStudio.tsx:236-246,
 *  read together at :697-702): a caller reconstructs each legacy value by
 *  discriminating on `kind` --
 *    pickedEdge  == primary?.kind === 'edge' ? { target: primary.target, edge: primary.name ?? null } : null
 *    pickedFace  == primary?.kind === 'face' ? { target: primary.target, face: primary.name ?? null } : null
 *    pickedSize  == primary?.size ?? null
 *  -- which is exactly the information one SelectionItem already carries,
 *  so no separate accessor per legacy variable is needed. */
export function primaryOf(state: SelectionState): SelectionItem | null {
  return state.primary;
}

/** The feature ids currently selected, in item order -- replaces reading
 *  `selected` directly (e.g. the HandleOverlay filter at
 *  ReshapeStudio.tsx:517: `doc.features.filter((f) => selected.includes(f.id))`
 *  becomes `doc.features.filter((f) => featuresOf(state).includes(f.id))`). */
export function featuresOf(state: SelectionState): string[] {
  return state.items.filter((item) => item.kind === 'feature').map((item) => item.target);
}

/** Every item that belongs to `ownerId`, via the real ownerOf() -- replaces
 *  the filtering pattern at ReshapeStudio.tsx:686-687
 *  (`pickedEdges.filter((e) => ownerOf(doc, e) === id)`,
 *  `pickedFaces.filter((f) => ownerOf(doc, f) === id)`). Reuses ownerOf()
 *  itself rather than re-implementing its rootFeature-then-target
 *  fallback, so the two can never drift apart. */
export function ownerScoped(state: SelectionState, doc: ModelDoc, ownerId: string): SelectionItem[] {
  return state.items.filter((item) => ownerOf(doc, { target: item.target, name: item.name ?? null }) === ownerId);
}
