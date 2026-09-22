'use client';

// The reSHape experience -- Build tools + kernel viewport, or reSHape Script's
// Code side -- extracted out of SandboxWorkspace.tsx (SPEC-A1) so a lesson can
// mount the SAME thing the sandbox does, controlled by a single saved
// artifact: `script.js`. See CLAUDE.md's "JSCAD is retired" section and
// .gauntlet/SPEC-reshape-script.md for the engine history this inherits.
//
// THE CONTRACT: `value`/`onChange` is `script.js`'s text, the single source
// of truth a caller persists. Build writes it (debounced, via toScript());
// Code edits it directly (through the store-backed
// <CodeEditor/>, which both the sandbox and a lesson already point at the
// same fileContents['script.js'] this component is handed). On mount, this
// component has `value` but no `doc` -- it silently runs `value` through the
// sandboxed script runner once to rebuild `doc`, so a reload shows the model
// the student built, not an empty canvas.

import {
  useCallback, useEffect, useMemo, useRef, useState,
  type ChangeEvent, type ComponentType, type ForwardRefExoticComponent, type ReactNode, type RefAttributes,
} from 'react';
import { Maximize2, Minimize2, PanelRightClose, PanelRightOpen } from 'lucide-react';
import ReshapeParamsPanel, { type ParamDef, type ParamValues } from './ReshapeParamsPanel.js';
import { noteColor, type StudioNote } from './notes.js';
import ModelEditor from './model/ModelEditor.js';
import BrepViewport, { type BrepViewportStats, type ViewportPick } from './model/BrepViewportThree.js';
import HandleOverlay, { type AnchorPoint, type SketchOutline } from './model/HandleOverlay.js';
import SketchCanvas2D from './model/SketchCanvas2D.js';
import ContextBar, { type ContextBarAction } from './model/ContextBar.js';
import type { ContextActions } from './model/ModelEditor.js';
import { writeSTL, writeOBJ, write3MF, type MeshInput } from './mesh-export.js';
import {
  add as addSelection,
  bodiesOf,
  clear as clearSelection,
  edgesOf,
  emptySelection,
  facesOf,
  featuresOf,
  ownerScoped,
  primaryOf,
  replace as replaceSelection,
  selectAllFeatures,
  toggle as toggleSelection,
  type SelectionItem,
  type SelectionState,
  verticesOf,
} from './selection-model.js';
import { outlineOf } from '@shuff57/reshape-sketch/sketch-arc';
import { handlesFor, featureCenter, type HandleSpec } from '@shuff57/reshape-script/model-handles';
import { EMPTY_DOC, type Feature, isSketchOnly, type ModelDoc, nameMap, newSketch, type SketchPlane } from '@shuff57/reshape-script/model-types';
import { ownerOf } from '@shuff57/reshape-script/model-selection';
import { partWordFor } from '@shuff57/reshape-script/topo-name';
import {
  applyParam,
  generatedParams,
  paramValues as docParams,
  solveDoc,
  solveSketchDrag,
} from '@shuff57/reshape-script/model-codegen';
import { toScript, type ScriptParamRef } from '@shuff57/reshape-script/reshape-script-gen';

/** The two pieces of shCode's lesson/sandbox chrome this component does not
 *  own -- CodeEditor is the shared, store-backed code editor used well
 *  beyond reSHape (LessonWorkspace, SandboxWorkspace), and ReshapePreview
 *  wraps the sandboxed script-runner iframe, itself dependent on shCode's
 *  MoshionPreview for its `encodeCode` helper. Neither is reSHape-only, so
 *  neither moved into this package (see reshape-cad's B1 extraction notes);
 *  the host app injects its own implementations instead. */
export type ReshapePreviewComponent = ForwardRefExoticComponent<
  { code: string; runKey: number; engine: 'brep' | 'script' } & RefAttributes<HTMLIFrameElement>
>;

/** Swap the FEATURE ids in a selection, leaving every viewport pick -- the
 *  edge/face items and the `primary` slot -- exactly where it was. This is
 *  what each old `setSelected([...])` call did back when `selected` was its
 *  own useState sitting beside the four pick states selection-model.ts's
 *  header names, and it is the ONE transition ModelEditor asks for through
 *  `onSelect`. Returns the SAME state object when the ids are already those
 *  ids, so the doc-prune effect below stays the no-op its
 *  `keep.length === s.length` check made it. Feature items lead, in the
 *  order given: selection ORDER is load-bearing (ModelEditor's combine()
 *  cuts the first-clicked shape with the second, not the first in list
 *  order). */
function withFeatureIds(state: SelectionState, ids: string[]): SelectionState {
  const features = state.items.filter((i) => i.kind === 'feature');
  if (features.length === ids.length && features.every((f, i) => f.target === ids[i])) return state;
  return {
    ...state,
    items: [
      ...ids.map((id): SelectionItem => ({ kind: 'feature', target: id })),
      ...state.items.filter((i) => i.kind !== 'feature'),
    ],
  };
}

/** The one SelectionItem a viewport pick IS: kind/target/name straight off
 *  the payload, plus the kernel-measured `size` the old `pickedSize` state
 *  held. ViewportPick's own `faceIndex` stays out -- a mesh re-highlight
 *  shortcut, a rendering concern rather than a selection one (see
 *  selection-model.ts's deviation list). */
function itemOfPick(p: ViewportPick): SelectionItem {
  return { kind: p.kind, target: p.target, name: p.name, size: p.size };
}

/** Ctrl/Meta-click: add `item` to the selection unless an equal item (same
 *  kind+target+name -- selection-model.ts's own sameItem() equality, which
 *  toggle()'s hit-check already uses) is already in it, in which case the
 *  selection is left untouched. selection-model.ts's own add() is a raw,
 *  no-presence-check append BY DESIGN (see its doc comment: "a caller that
 *  wants add only if absent calls toggle() after checking") precisely
 *  because Ctrl and Shift need DIFFERENT answers to "item already
 *  selected": Shift removes it (toggle()), Ctrl must never (it only ever
 *  adds) -- so the presence check happens here, once, rather than being a
 *  second copy of toggle()'s own. */
function addIfAbsent(state: SelectionState, item: SelectionItem): SelectionState {
  const present = state.items.some(
    (i) => i.kind === item.kind && i.target === item.target && JSON.stringify(i.name ?? null) === JSON.stringify(item.name ?? null),
  );
  return present ? state : addSelection(state, item);
}

/** Every DISTINCT feature id that owns at least one of `items`, in
*  first-seen order. A box-select can span MULTIPLE bodies (unlike a
*  single click's always-one-owner pick) -- collapsing to just the LAST
*  item's owner silently dropped every other solid's items from
*  `selected` (the status bar's "N selected" count and every
*  owner-scoped reader downstream of it), even though the raw item list
*  itself was correct. Exported so this box-select-multi-owner regression
*  has a direct unit test without needing the full React/viewport
*  harness (see onBoxSelect below, the one caller). */
export function distinctOwners(doc: ModelDoc, items: SelectionItem[]): string[] {
  const owners: string[] = [];
  for (const item of items) {
    const o = ownerOf(doc, { target: item.target, name: item.name ?? null });
    if (o && !owners.includes(o)) owners.push(o);
  }
  return owners;
}

export type ReshapeStudioProps = {
  /** script.js text -- the ONE saved artifact. Controlled: Code edits it
   *  through the store-backed CodeEditor this component renders, and Build
   *  regenerates it (debounced) through `onChange`. */
  value: string;
  onChange: (text: string) => void;
  /** Which panel(s) exist -- ['build'], ['code'], or both. */
  sides: ('build' | 'code')[];
  /** Which side to open on. Defaults to 'build' when both sides exist,
   *  otherwise whichever one does. Read once, at mount -- this component
   *  owns its own side state after that (see the module CLAUDE.md note: the
   *  localStorage keys stay in the caller). */
  startSide?: 'build' | 'code';
  /** The latest built doc, for a caller's grading pass. Called with `null`
   *  until the very first successful build (mount hydration or a Run). */
  onDocChange?: (doc: ModelDoc | null, refusals?: Record<string, string>) => void;
  /** For per-lesson UI keys; pass 'sandbox' from the sandbox. Currently
   *  unused by anything DOM-id-scoped (ModelEditor's ribbon/rules/timeline
   *  hosts are hardcoded ids and only one ReshapeStudio is ever mounted at a
   *  time), kept for a future per-instance need and so a caller always has
   *  something stable to key a remount on (e.g. a lesson's Reset button). */
  lessonId: string;
  /** Fires once on mount and again on every Build/Code toggle. A caller that
   *  wraps this in its own chrome (SandboxWorkspace hides its header and the
   *  program-type tabs while Build is showing, matching the pre-extraction
   *  look) needs to know the side live -- it is not derivable from `sides`. */
  onSideChange?: (side: 'build' | 'code') => void;
  /** Whether `value` should be silently run through the sandbox once on
   *  mount to hydrate `doc` (see the file header). Default true, for a
   *  lesson: `value` there is the student's own saved progress, and a
   *  reload with nothing on screen until they press Run would look like
   *  their work was lost. The sandbox passes false: `value` on a fresh
   *  session is RESHAPE_STARTER, a teaching example for the Code side, not
   *  built work -- auto-adopting it into Build silently pre-built a box and
   *  a hole before the student had touched a tool (SPEC-A1 rework 1). */
  autoRunOnMount?: boolean;
  /** Extra controls rendered at the end of this component's own toolbar row
   *  (see the file header's chrome note) -- SandboxWorkspace folds its Reset
   *  and Full-screen buttons in here so they sit in the SAME row as the
   *  Build ribbon, exactly as the pre-extraction sandbox rendered them, since
   *  those two actions need `shellRef`/localStorage this component has no
   *  reason to own. Unused by a lesson, which has its own separate toolbar. */
  toolbarExtra?: ReactNode;
  /** The store-backed code editor Code mode renders. Shared shCode chrome
   *  (LessonWorkspace and SandboxWorkspace both mount it too), so the host
   *  app supplies it rather than this package owning a copy. */
  CodeEditor: ComponentType;
  /** The sandboxed script-runner iframe wrapper. Also shCode chrome (it
   *  depends on MoshionPreview's `encodeCode`, outside reSHape entirely),
   *  injected the same way as `CodeEditor`. */
  ReshapePreview: ReshapePreviewComponent;
};

// ---- constants carried over from SandboxWorkspace.tsx verbatim -----------
// (see that file's own comments for why these particular numbers)
const TIMELINE_HEIGHT_PX = 58;
// The status bar's own height -- docked grid row 4 (adoption step 1,
// SPEC-ui-revamp-decisions.md §5).
const STATUS_BAR_HEIGHT_PX = 26;
// The toolbar's own height -- docked grid row 1 (adoption step 2): the
// ribbon's own .model-tools is 42px, so this row centers it with room to
// spare. It is a row, not an overlay, so nothing draws underneath it.
const TOOLBAR_HEIGHT_PX = 52;
const PREVIEW_DEGRADE_MS = 25;

function capitalize(name: string): string {
  return name.length ? name[0].toUpperCase() + name.slice(1) : name;
}

function sketchIsUnconsumed(doc: ModelDoc, sketchId: string): boolean {
  return !doc.features.some((f) =>
    ((f.kind === 'extrude' || f.kind === 'revolve') && f.target === sketchId)
    || (f.kind === 'blend' && f.targets.includes(sketchId))
  );
}

function foldParams(base: ModelDoc, pending: ParamValues): ModelDoc {
  const numeric: Record<string, number> = {};
  for (const [k, v] of Object.entries(pending)) {
    if (typeof v === 'number') numeric[k] = v;
  }
  let next = base;
  for (const [k, v] of Object.entries(numeric)) next = applyParam(next, k, v);
  if (next === base) return base;
  // Re-run the exact pinned solve the live drag preview already promised --
  // solveSketchDrag holds whichever corner(s) `pending` names still, the
  // same way sendParams() pins them for the in-progress drag -- before the
  // generic solveDoc() pass below, which only ever holds a corner for a
  // `lock` rule. Without this, a sketch with an ACTIVE lock on one corner
  // could resolve a drag on a DIFFERENT corner by moving the just-dragged
  // corner again to satisfy its own horizontal/vertical rules, landing the
  // committed doc on a point neither panel had just shown: pin corner 1,
  // drag corner 2, and the committed shape no longer matched either the
  // Dimensions panel (which reads THIS pinned solve) or what the drag had
  // just drawn (measured 2026-09-04, S12). Harmless for every param that
  // is not a sketch corner -- solveSketchDrag only ever touches names
  // shaped `<sketchId>_p<n>u`/`v`, so a box width or a radius passes
  // through untouched.
  const pinned = solveSketchDrag(next, numeric);
  for (const [k, v] of Object.entries(pinned)) next = applyParam(next, k, v);
  return solveDoc(next);
}

const EMPTY_REFUSALS: Map<string, string> = new Map();
function refusalsUnchanged(
  prev: Map<string, string> | undefined,
  next: Map<string, string> | undefined,
): boolean {
  const a = prev ?? EMPTY_REFUSALS;
  const b = next ?? EMPTY_REFUSALS;
  if (a.size !== b.size) return false;
  for (const [id, why] of b) {
    const prevWhy = a.get(id);
    if (prevWhy === undefined || prevWhy !== why) return false;
  }
  return true;
}

export default function ReshapeStudio({
  value,
  onChange,
  sides,
  startSide,
  onDocChange,
  onSideChange,
  toolbarExtra,
  autoRunOnMount = true,
  CodeEditor,
  ReshapePreview,
}: ReshapeStudioProps) {
  const canBuild = sides.includes('build');
  const canCode = sides.includes('code');
  const [build, setBuild] = useState(() => (startSide ? startSide === 'build' : canBuild));

  const onSideChangeRef = useRef(onSideChange);
  useEffect(() => { onSideChangeRef.current = onSideChange; });
  // Fire once on mount (whatever `build`'s initial value resolved to) and
  // again on every later toggle -- see this prop's own doc comment for why a
  // caller needs it live rather than deriving it from `sides`.
  useEffect(() => {
    onSideChangeRef.current?.(build ? 'build' : 'code');
  }, [build]);

  // A gate arriving late (or `sides` narrowing after mount, e.g. a teacher
  // flips the class-wide mode) must not leave a student on a side they can
  // no longer reach.
  useEffect(() => {
    if (build && !canBuild) setBuild(false);
    if (!build && !canCode) setBuild(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canBuild, canCode]);

  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });
  const onDocChangeRef = useRef(onDocChange);
  useEffect(() => { onDocChangeRef.current = onDocChange; });

  const [paramDefs, setParamDefs] = useState<ParamDef[]>([]);
  const [paramValues, setParamValues] = useState<ParamValues>({});
  const [rebuildMs, setRebuildMs] = useState<number | null>(null);
  const [stale, setStale] = useState<'empty' | 'error' | null>(null);
  const [refusals, setRefusals] = useState<Map<string, string> | undefined>(undefined);

  const [doc, setDoc] = useState<ModelDoc>(EMPTY_DOC);
  // ONE selection state for the whole shell (SPEC-mouse-parity.md Phase 3
  // item 7). It replaces six useStates that had to be kept in step by hand:
  // `selected` (the feature ids, set both by ModelEditor's pick() and by a
  // viewport pick's resolved owner), `pickedEdge`/`pickedFace`/`pickedSize`
  // (the single most recent viewport pick -- now the one `primary` slot,
  // which is faithful because onPick has always set one of those two and
  // nulled the other on every pick), and the two Shift-accumulated
  // multi-pick arrays beside them -- now the edge/face `items`. Every read
  // below goes through selection-model.ts's own ops, and ModelEditor is
  // handed this same object rather than a parallel copy of half of it.
  const [selection, setSelection] = useState<SelectionState>(emptySelection);
  const selected = useMemo(() => featuresOf(selection), [selection]);
  const primaryPick = primaryOf(selection);
  /** Replace the selected feature ids, leaving the viewport picks alone --
   *  ModelEditor's `onSelect`, and this file's own clear-the-selection
   *  affordances. */
  const selectFeatures = useCallback((ids: string[]) => {
    setSelection((s) => withFeatureIds(s, ids));
  }, []);
  // A selection can outlive its feature (an undo, a rollback, a delete), so
  // prune ids the doc no longer has -- withFeatureIds hands back the same
  // state object when there is nothing to prune, so this stays a no-op.
  useEffect(() => {
    setSelection((s) => withFeatureIds(s, featuresOf(s).filter((id) => doc.features.some((f) => f.id === id))));
  }, [doc]);
  // Item N: when a handle was last actually touched (a drag/commit) -- 
  // BrepViewportThree.tsx uses this to hold its own "A sketch is flat..."
  // Pull hint off screen while a student is visibly busy dragging a handle,
  // rather than refreshing it on top of every drag they make.
  const [ruleActivityAt, setRuleActivityAt] = useState<number | null>(null);
  const touchRuleActivity = () => setRuleActivityAt(Date.now());
  const [rollbackIndex, setRollbackIndex] = useState<number | null>(null);
  // Which plane a new sketch starts on -- set by clicking a plane in the
  // ribbon's left Planes tree (model/ModelEditor.tsx).
  const [activePlane, setActivePlane] = useState<SketchPlane>('xy');
  // The soup sketcher (SPEC-sketcher2 §7): the id of the sketch open in the
  // 2D canvas, or null. While set, SketchCanvas2D replaces the 3D viewport.
  const [sketchEditId, setSketchEditId] = useState<string | null>(null);
  const past = useRef<ModelDoc[]>([]);
  const future = useRef<ModelDoc[]>([]);
  const [depth, setDepth] = useState({ back: 0, forward: 0 });
  const [toolsHidden, setToolsHidden] = useState(false);
  // Code mode's own chrome, shared regardless of which `CodeEditor` a host
  // plugs in -- see this file's header + the plan doc for why this lives
  // here rather than inside CodeEditor itself. `codeHidden` mirrors
  // `toolsHidden`'s rail-collapse (the row-2 middle cell reclaims the freed
  // width); `codeFullscreen` instead takes over the WHOLE main row
  // (toolbar/viewport/params/timeline all hidden around it), Escape-able the
  // same way the sketch selection strip already is below.
  const [codeHidden, setCodeHidden] = useState(false);
  const [codeFullscreen, setCodeFullscreen] = useState(false);
  // Piece B: whether the context bar is on screen right now, as a ref so the
  // Escape tiering below (declared before the bar's own derived state, which
  // needs `anchors`/`effectiveDoc` from further down) can read it at
  // keypress time without reordering half this component. Assigned fresh on
  // every render, below, from the same expression the mount itself uses.
  const ctxBarVisibleRef = useRef(false);
  useEffect(() => {
    if (!codeFullscreen) return;
    // Escape exits fullscreen -- but only when nothing ELSE already owns
    // Escape for something more locally modal: the context bar itself
    // (piece B -- its own listener dismisses it, so one keypress must not
    // ALSO exit fullscreen). Checking its own state here (rather than a
    // shared "who owns Escape" registry) keeps this a one-line addition;
    // if a SECOND Escape consumer ever appears, that's the point to build
    // a real stack.
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (ctxBarVisibleRef.current) return; // ditto the context bar's own dismiss
      setCodeFullscreen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [codeFullscreen]);
  // Leaving Code mode (or the panel losing its host entirely) with
  // fullscreen still on would strand the rest of the chrome hidden the next
  // time Build is chosen -- of the two, only fullscreen needs this: a
  // collapsed rail is harmless left collapsed.
  useEffect(() => {
    if (build && codeFullscreen) setCodeFullscreen(false);
  }, [build, codeFullscreen]);
  const [anchors, setAnchors] = useState<AnchorPoint[]>([]);
  // ---- the context bar (adoption step 4, piece B) ---------------------------
  // One Escape-tier dismissal per selection: ContextBar itself owns the
  // Escape listener while mounted, but "the bar came back the instant I
  // pressed Escape" would be the same bar refusing to leave, so the press
  // records a dismissal that lives until the SELECTION changes. ModelEditor's
  // verbs (registered up via registerContextActions) ride in a REF, not
  // state: ModelEditor
  // registers a FRESH object every render (its own comment explains why
  // memoizing would pin stale doc closures), so storing that object in
  // state would setState every render and loop. The state beside it tracks
  // only PRESENCE -- registered or not -- which is all the "omit buttons
  // until registered" gate needs; the buttons' onRun wrappers read the ref
  // at CLICK time, so every click gets this render's fresh closures.
  const [ctxDismissed, setCtxDismissed] = useState(false);
  const ctxActionsRef = useRef<ContextActions | null>(null);
  const [ctxActions, setCtxActions] = useState(false);
  useEffect(() => { setCtxDismissed(false); }, [selected[0]]);
  // The ✎ Dimensions action: point at the params aside, not just scroll --
  // a 600ms accent border flash is the "it happened, there" cue (the CSS
  // class lives in this file's own <style> block below).
  const flashParamsRef = useRef<HTMLDivElement | null>(null);
  const focusParams = useCallback(() => {
    const el = flashParamsRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    el.classList.remove('reshape-params-flash');
    // restart the animation even when the class was still on it
    void el.offsetWidth;
    el.classList.add('reshape-params-flash');
    const t = setTimeout(() => el.classList.remove('reshape-params-flash'), 600);
    return () => clearTimeout(t);
  }, []);
  // Double-click entry point (SPEC-mouse-parity.md Phase 3.6): a feature
  // body in the viewport, or a timeline row in ModelEditor.tsx, selects
  // the feature and then reuses whichever per-kind "open this" action the
  // context bar already offers a single-selected feature -- Edit 2D for a
  // sketch (setSketchEditId, same as its own button), focusParams for
  // every other kind (same flash-and-scroll the Dimensions button already
  // triggers). Not a second way to open either panel, just a second way
  // to reach the first one.
  const editFeature = useCallback((id: string) => {
    selectFeatures([id]);
    const f = doc.features.find((x) => x.id === id);
    if (f?.kind === 'sketch') setSketchEditId(id);
    else focusParams();
  }, [doc, selectFeatures, focusParams]);
  const meshRef = useRef<MeshInput | null>(null);
  const [hasMesh, setHasMesh] = useState(false);
  const [engineReady, setEngineReady] = useState(false);
  const pickAtRef = useRef<((clientX: number, clientY: number) => void) | null>(null);
  const specsRef = useRef<unknown[]>([]);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  const [scriptDoc, setScriptDoc] = useState<ModelDoc | null>(null);
  const [scriptNamedParams, setScriptNamedParams] = useState<ScriptParamRef[] | null>(null);
  const [scriptErrorMessage, setScriptErrorMessage] = useState<string | null>(null);
  // The status bar's model dimensions, fed by BrepViewport's own onStats
  // (computeSceneBox()) -- see the onStats handler and dimsMm on
  // BrepViewportStats. Null until the viewport reports an extent, so the
  // readout hides rather than shows zeros.
  const [bboxMm, setBboxMm] = useState<{ x: number; y: number; z: number } | null>(null);
  const [code, setCode] = useState('');
  const [runKey, setRunKey] = useState(0);
  // Whether the very first build (mount hydration, or the first manual Run)
  // has landed yet -- gates onDocChange(null) vs onDocChange(doc), and gates
  // the ONE automatic doc-adoption a fresh mount gets (see the mount effect
  // and the 'reshape-doc' branch of onMessage below).
  const [hydrated, setHydrated] = useState(false);
  // Set right before a doc adoption that must NOT re-trigger the Build ->
  // script regeneration effect below -- otherwise hydrating `doc` FROM
  // `value` immediately writes a (re-serialized, possibly reformatted)
  // copy of that same text right back over it on every single page load.
  const skipNextRegenRef = useRef(false);

  const docRef = useRef(doc);
  useEffect(() => { docRef.current = doc; }, [doc]);

  const effectiveDoc = useMemo(
    () => (rollbackIndex == null ? doc : { ...doc, features: doc.features.slice(0, rollbackIndex) }),
    [doc, rollbackIndex]
  );

  const loadDoc = useCallback((raw: ModelDoc) => {
    const next = solveDoc(raw);
    setDoc(next);
    docRef.current = next;
    uncommitted.current = {};
    setParamDefs([]);
    setParamValues(() => docParams(next));
    setRebuildMs(null);
    setStale(null);
    setRollbackIndex(null);
  }, []);

  const remember = useCallback((prev: ModelDoc) => {
    past.current = [...past.current.slice(-49), prev];
    future.current = [];
    setDepth({ back: past.current.length, forward: 0 });
  }, []);

  const applyDoc = useCallback((next: ModelDoc) => {
    const pending = uncommitted.current;
    uncommitted.current = {};
    const merged = Object.keys(pending).length ? foldParams(next, pending) : next;
    remember(docRef.current);
    loadDoc(merged);
  }, [remember, loadDoc]);

  // Bumped on every Undo/Redo so ModelEditor can clear its own info banner
  // regardless of which trigger fired it -- the toolbar button (which calls
  // this same `undo`/`redo`) or the Ctrl+Z/Ctrl+Shift+Z shortcut below,
  // which ModelEditor never sees at all.
  const [historyGen, setHistoryGen] = useState(0);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current = [docRef.current, ...future.current];
    setDepth({ back: past.current.length, forward: future.current.length });
    loadDoc(prev);
    setHistoryGen((g) => g + 1);
  }, [loadDoc]);

  const redo = useCallback(() => {
    const [next, ...rest] = future.current;
    if (!next) return;
    past.current = [...past.current, docRef.current];
    future.current = rest;
    setDepth({ back: past.current.length, forward: rest.length });
    loadDoc(next);
    setHistoryGen((g) => g + 1);
  }, [loadDoc]);

  const uncommitted = useRef<ParamValues>({});
  const previewDocRef = useRef<ModelDoc | null>(null);
  const [previewDoc, setPreviewDoc] = useState<ModelDoc | null>(null);
  const previewRafRef = useRef<number | null>(null);
  const previewDegradedRef = useRef(false);
  useEffect(() => () => {
    if (previewRafRef.current != null) cancelAnimationFrame(previewRafRef.current);
  }, []);

  const sendParams = useCallback((next: ParamValues) => {
    const numeric: Record<string, number> = {};
    for (const [k, v] of Object.entries(next)) {
      if (typeof v === 'number') numeric[k] = v;
    }
    const solved: ParamValues = Object.keys(numeric).length
      ? { ...next, ...solveSketchDrag(docRef.current, numeric) }
      : next;

    setParamValues((prev) => ({ ...prev, ...solved }));
    uncommitted.current = { ...uncommitted.current, ...solved };
    frameRef.current?.contentWindow?.postMessage(
      { source: 'reshape-set-params', params: solved },
      '*'
    );

    if (build && !previewDegradedRef.current) {
      previewDocRef.current = foldParams(docRef.current, uncommitted.current);
      if (previewRafRef.current == null) {
        previewRafRef.current = requestAnimationFrame(() => {
          previewRafRef.current = null;
          if (previewDegradedRef.current) return;
          setPreviewDoc(previewDocRef.current);
        });
      }
    }
  }, [build]);

  const commitParams = useCallback(() => {
    const pending = uncommitted.current;
    uncommitted.current = {};
    if (previewRafRef.current != null) {
      cancelAnimationFrame(previewRafRef.current);
      previewRafRef.current = null;
    }
    previewDocRef.current = null;
    previewDegradedRef.current = false;
    setPreviewDoc(null);
    if (!Object.keys(pending).length) return;
    const next = foldParams(docRef.current, pending);
    if (next === docRef.current) return;
    remember(docRef.current);
    setDoc(next);
    docRef.current = next;
    // Re-derive EVERY param fresh from the committed doc, the same call
    // loadDoc() already makes on every doc adoption -- not just the ones
    // `pending` named. Without this, the Dimensions panel keeps showing
    // whatever the last live-drag frame computed (sendParams' own
    // setParamValues, mid-gesture), and a commit that lands anywhere other
    // than that exact frame -- a sketch's OWN constraint solve moving a
    // second corner to keep an edge rule true, say -- leaves the panel
    // stating a number the committed doc no longer has (measured
    // 2026-09-04, S12/EXPLORE-2d's circle-rim case: same defect, two
    // different sketch tools, neither one exercising a lock).
    setParamValues(docParams(next));
  }, [remember]);

  const specs = useMemo(() => {
    if (!build) return [];
    const picked = doc.features.filter((f) => selected.includes(f.id)).flatMap((f) => handlesFor(f, doc));
    const otherSketches = doc.features
      .filter((f): f is Feature & { kind: 'sketch' } =>
        f.kind === 'sketch' && !selected.includes(f.id) && sketchIsUnconsumed(doc, f.id))
      .flatMap((f) => handlesFor(f, doc));
    // Piece B: one synthetic spec at the single selected feature's own
    // centre, so the context bar has an anchor even when the feature has
    // no drag handles of its own (a hole, a shell, a move). 'point' is the
    // least-intrusive existing kind: BrepViewportThree's projector passes
    // every kind through, and HandleOverlay draws a 'point' as a plain
    // small square. The __ctx_ prefix keys the projected anchor without
    // colliding with any generated param name (applyParam splits at the
    // LAST underscore, so a drag would ask for feature id __ctx, which no
    // feature has -- it lands as a no-op rather than a mutation).
    let ctx: HandleSpec[] = [];
    if (selected.length === 1) {
      const f = doc.features.find((x) => x.id === selected[0]);
      const c = f ? featureCenter(f, doc) : null;
      if (f && c) ctx = [{
        kind: 'point',
        param: `__ctx_${f.id}`,
        origin: c,
        axis: [1, 0, 0],
        scale: 1,
        label: 'context',
      }];
    }
    return [...picked, ...otherSketches, ...ctx];
  }, [build, doc, selected]);

  const brepParamDefs = useMemo(() => {
    if (selected.length === 0) return [];
    const bindings = new Map<string, ScriptParamRef>();
    if (scriptNamedParams) {
      for (const p of scriptNamedParams) {
        for (const slot of p.slots) bindings.set(slot, p);
      }
    }
    return generatedParams(doc)
      .filter((p) => selected.some((id) => p.name.startsWith(`${id}_`)))
      .map((p): ParamDef => {
        const named = bindings.get(p.name);
        if (!named) {
          return { name: p.name, caption: p.caption, initial: p.value, min: p.min, max: p.max, step: p.step };
        }
        const caption = named.caption !== named.name ? named.caption : capitalize(named.name);
        return { name: p.name, caption, initial: p.value, min: named.min, max: named.max, step: named.step };
      });
  }, [doc, selected, scriptNamedParams]);
  const scales = useMemo(
    () => Object.fromEntries(specs.map((h) => [h.param, h.scale])),
    [specs]
  );

  // ---- the context bar's own derived state (piece B) -----------------------
  // ctxFeature reads effectiveDoc (rollback-respecting), not doc: a feature
  // the rollback bar suppresses is not on screen, so a bar floating over the
  // spot it WOULD occupy is the "bar over nothing" state featureCenter()
  // refuses. Single selection only -- "2 selected" has no one anchor.
  const ctxFeature = useMemo(
    () => selected.length === 1 ? effectiveDoc.features.find((f) => f.id === selected[0]) : undefined,
    [selected, effectiveDoc]
  );
  // The anchor: the synthetic __ctx_ spec first, then (for features with no
  // centre -- a hole, a shell) the first of the feature's own real handle
  // anchors, which at least floats the bar over the feature's geometry.
  const ctxAnchor = useMemo(() => {
    if (selected.length !== 1) return null;
    const id = selected[0];
    const direct = anchors.find((a) => a.param === `__ctx_${id}`);
    if (direct) return { x: direct.x, y: direct.y };
    const fallback = anchors.find((a) => a.param.startsWith(`${id}_`));
    return fallback ? { x: fallback.x, y: fallback.y } : null;
  }, [anchors, selected]);
  const ctxRefusal = selected.length === 1 ? refusals?.get(selected[0]) ?? null : null;
  // Up to three mono readouts off the SAME defs the Dimensions panel shows
  // (brepParamDefs already filters to the selection), mapped to short
  // student words -- the chip says "Depth 12" (or "⌀6"), not
  // "Box 1 depth". The suffix map keeps the panel and the chip honest
  // about the same slot: a cylinder's _radius param IS its across number.
  const ctxChips = useMemo(() => {
    if (!ctxFeature) return [];
    const short: Record<string, string> = {
      diameter: '⌀', radius: '⌀', depth: 'Depth', width: 'Width', height: 'Height',
      ring: '⌀', tube: 'Tube', thickness: 'Wall', across: '⌀', size: 'Size',
    };
    return brepParamDefs.slice(0, 3).map((p) => {
      const slot = p.name.slice(p.name.lastIndexOf('_') + 1);
      const label = short[slot] ?? capitalize(slot);
      const value = paramValues[p.name];
      return { label, value: typeof value === 'number' ? String(value) : String(p.initial) };
    });
  }, [ctxFeature, brepParamDefs, paramValues]);
  // The action list is per feature kind, built inline in the mount below --
  // it reads ctxActions (state from ModelEditor) and focusParams, both of
  // which already gate themselves. Every registered verb is optional-chained:
  // a missing verb omits its button rather than showing a dead one.
  // The one mount condition, shared with the Escape tier above via a ref:
  // Build side, one selected feature the rollback has not suppressed, the
  // bar not dismissed, and a screen anchor to float over.
  const ctxBarVisible = build && !!ctxFeature && !ctxDismissed && !!ctxAnchor;
  ctxBarVisibleRef.current = ctxBarVisible;
  const ctxActionsList: ContextBarAction[] = useMemo(() => {
    if (!ctxFeature) return [];
    const hasActions = ctxActions;
    const dims: ContextBarAction = {
      label: '✎ Dimensions', title: 'Show this step\u2019s numbers in the panel',
      primary: true, onRun: focusParams,
    };
    // Delete is the one verb the bar always offers once the registrar exists:
    // it calls ModelEditor's own remove(), so the dependents-confirm flow
    // stays exactly where it lives.
    const del: ContextBarAction | null = hasActions ? { label: 'Delete', title: 'Delete the selected', onRun: () => ctxActionsRef.current?.remove() } : null;
    const kind = ctxFeature.kind;
    if (kind === 'sketch') {
      const out: ContextBarAction[] = [
        { label: 'Edit 2D', title: 'Open this sketch in the 2D constraint sketcher', primary: true, onRun: () => setSketchEditId(ctxFeature.id) },
      ];
      if (hasActions) {
        out.push(
          { label: 'Pull', title: 'Pull the sketch straight up into a solid', onRun: () => ctxActionsRef.current?.pull() },
          { label: 'Spin', title: 'Spin the sketch around to make a solid', onRun: () => ctxActionsRef.current?.spin() },
        );
      }
      if (del) out.push(del);
      return out;
    }
    if (kind === 'box' || kind === 'cylinder' || kind === 'sphere' || kind === 'cone' || kind === 'torus') {
      const out: ContextBarAction[] = [dims];
      if (hasActions) {
        out.push(
          { label: 'Move', title: 'Shift the selected solid', onRun: () => ctxActionsRef.current?.moveTool(false) },
          { label: 'Copy', title: 'Add a copy, shifted over', onRun: () => ctxActionsRef.current?.moveTool(true) },
          { label: 'Round', title: 'Round the edges off (fillet)', onRun: () => ctxActionsRef.current?.round('fillet') },
        );
        if (kind !== 'sphere') out.push({ label: 'Turn', title: 'Turn this shape', onRun: () => ctxActionsRef.current?.turn() });
        out.push(
          { label: 'Hole', title: 'Drill a round hole through the selected solid', onRun: () => ctxActionsRef.current?.drillHole() },
          { label: 'Hollow', title: 'Hollow the selected solid out, leaving a wall', onRun: () => ctxActionsRef.current?.hollow() },
          { label: 'Repeat', title: 'Make copies of the selected solid', onRun: () => ctxActionsRef.current?.repeat('linear') },
          { label: 'Mirror', title: 'Flip a copy left to right (the yz plane)', onRun: () => ctxActionsRef.current?.mirror('yz') },
        );
      }
      if (del) out.push(del);
      return out;
    }
    // Every other kind (extrude/pocket/fillet/hole/shell/pattern/move/...):
    // the modify verbs need a plain solid, so the bar offers the safe set.
    const out: ContextBarAction[] = [dims];
    if (hasActions) {
      out.push(
        { label: 'Move', title: 'Shift the selected solid', onRun: () => ctxActionsRef.current?.moveTool(false) },
        { label: 'Copy', title: 'Add a copy, shifted over', onRun: () => ctxActionsRef.current?.moveTool(true) },
      );
    }
    if (del) out.push(del);
    return out;
  }, [ctxFeature, ctxActions, focusParams]);

  const selectionLabel = useMemo(() => {
    if (selected.length === 0) return null;
    if (selected.length > 1) return `${selected.length} selected`;
    const id = selected[0];
    if (!doc.features.some((f) => f.id === id)) return null;
    const base = nameMap(doc)[id] ?? id;
    // Item E: "3 edges"/"2 faces" once a Shift-click multi-selection is two
    // or more deep on the currently selected solid -- ownerScoped() runs the
    // same ownerOf() filter this used to spell out over the two multi-pick
    // arrays, so anything a stray pick left pointing at a different
    // solid still drops out, the same guard round()'s multi-edge path
    // applies before it builds anything.
    const scoped = ownerScoped(selection, doc, id);
    // P3.3: the kind-filtered views, not hand-rolled .filter calls -- the
    // same views the commands read, so label and command can never drift.
    const scopedState: SelectionState = { ...selection, items: scoped };
    const edgesHere = edgesOf(scopedState);
    const facesHere = facesOf(scopedState);
    const verticesHere = verticesOf(scopedState);
    const bodiesHere = bodiesOf(scopedState);
    // Item H (P20): a single picked edge/face carries its own kernel-
    // measured size as a third segment -- "Box 1 · top face · 40 x 40",
    // "Box 1 · edge · 20" -- but a multi-selection ("3 edges") has no one
    // size to show, so the primary pick's size is read only in the
    // single-pick branches.
    const size = primaryPick?.size ?? null;
    const single = edgesHere.length <= 1 && facesHere.length <= 1;
    // The most recent pick, only while it still belongs to this solid --
    // the `pickedEdge && ownerOf(doc, pickedEdge) === id` guard the two
    // branches below each used to carry, asked once now that one `primary`
    // slot holds whichever kind was picked.
    const here = primaryPick && ownerOf(doc, { target: primaryPick.target, name: primaryPick.name ?? null }) === id
      ? primaryPick
      : null;
    // P3.3: a mixed selection says so -- "1 face + 1 edge + 1 vertex" --
    // instead of reading as whichever kind happened to be picked last.
    const held = [
      facesHere.length ? `${facesHere.length} face${facesHere.length > 1 ? 's' : ''}` : null,
      edgesHere.length ? `${edgesHere.length} edge${edgesHere.length > 1 ? 's' : ''}` : null,
      verticesHere.length ? `${verticesHere.length} ${verticesHere.length > 1 ? 'vertices' : 'vertex'}` : null,
      bodiesHere.length ? `${bodiesHere.length} bod${bodiesHere.length > 1 ? 'ies' : 'y'}` : null,
    ].filter((s): s is string => s != null);
    const part = held.length > 1
      ? held.join(' + ')
      : edgesHere.length > 1
        ? `${edgesHere.length} edges`
        : facesHere.length > 1
          ? `${facesHere.length} faces`
          : here?.kind === 'edge'
            ? (partWordFor(here.name) ?? 'edge')
              + (single && typeof size === 'number' ? ` · ${size}` : '')
            : here?.kind === 'face'
              ? (partWordFor(here.name) ?? 'face')
                + (single && Array.isArray(size) ? ` · ${size[0]} x ${size[1]}` : '')
              : here?.kind === 'vertex'
                ? 'vertex'
                : here?.kind === 'body'
                  ? 'body'
                  : null;
    return part ? `${base} · ${part}` : base;
  }, [selected, doc, selection, primaryPick]);

  const activeSketchPlane = useMemo<'xy' | 'xz' | 'yz' | null>(() => {
    if (selected.length !== 1) return null;
    const f = doc.features.find((x) => x.id === selected[0]);
    return f && f.kind === 'sketch' ? (f.plane ?? 'xy') : null;
  }, [selected, doc]);

  const outlines = useMemo(
    () => {
      return doc.features
        .filter((f): f is Feature & { kind: 'sketch' } => f.kind === 'sketch' && sketchIsUnconsumed(doc, f.id))
        .map((f): SketchOutline => {
          const o = outlineOf(f);
          return {
            corners: f.points.map((_, i) => `${f.id}_p${i}u`),
            design: f.points,
            points: o.points,
            basis: o.basis,
            shape: f.shape,
            bulges: o.bulges,
          };
        });
    },
    [doc]
  );

  useEffect(() => {
    specsRef.current = specs;
    frameRef.current?.contentWindow?.postMessage(
      { source: 'reshape-set-anchors', anchors: specs },
      '*'
    );
    if (specs.length === 0) setAnchors([]);
  }, [specs]);


  // ---- the seam: value <-> doc -------------------------------------------

  // Mount: `value` exists, `doc` does not. Run it through the sandboxed
  // runner once so a reload shows the model the student built. Applies
  // regardless of which side is open (see the shadow ReshapePreview
  // instance in the JSX below for the build+brep case, where the visible
  // pane is the B-rep viewport, not an iframe).
  useEffect(() => {
    if (!autoRunOnMount) return;
    onDocChangeRef.current?.(null);
    if (value.trim()) {
      setCode(value);
      setRunKey((k) => k + 1);
    }
    // Mount-only: a later `value` change (Code side edits) is picked up by
    // the student's own explicit Run, never silently re-run underneath them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (frameRef.current && e.source !== frameRef.current.contentWindow) return;
      const d = e.data as {
        source?: string; type?: string; defs?: ParamDef[]; values?: ParamValues;
        ms?: number; empty?: boolean; failed?: boolean; points?: AnchorPoint[];
        doc?: ModelDoc; params?: unknown; namedParams?: ScriptParamRef[];
        error?: { message?: string; line?: number | null };
      };
      if (d?.source === 'reshape-params') {
        frameRef.current?.contentWindow?.postMessage(
          { source: 'reshape-set-anchors', anchors: specsRef.current },
          '*'
        );
        setParamDefs(Array.isArray(d.defs) ? d.defs : []);
        setParamValues(d.values ?? {});
        setRebuildMs(null);
        setStale(null);
      } else if (d?.source === 'reshape-rebuilt' && typeof d.ms === 'number') {
        setStale(d.failed ? 'error' : d.empty ? 'empty' : null);
        if (!d.empty && !d.failed) setRebuildMs(d.ms);
      } else if (d?.source === 'reshape-anchors') {
        setAnchors(Array.isArray(d.points) ? d.points : []);
      } else if (d?.source === 'reshape-doc') {
        const arrived = d.doc ?? null;
        setScriptDoc(arrived);
        setScriptNamedParams(Array.isArray(d.namedParams) ? d.namedParams : []);
        setStale(null);
        setScriptErrorMessage(null);
        if (!hydrated) {
          // The one and only automatic doc adoption: whatever the mount run
          // (or, for a build-only lesson, the FIRST run there will ever be)
          // just built becomes the Build doc too, so Build shows the
          // model the student already has without them re-running it.
          if (arrived) {
            skipNextRegenRef.current = true;
            loadDoc(arrived);
          }
          setHydrated(true);
        }
      } else if (d?.source === 'preview-error') {
        setStale('error');
        if (!hydrated) setHydrated(true);
        if (!build) {
          const line = typeof d.error?.line === 'number' ? d.error.line : null;
          const msg = d.error?.message ?? 'The script stopped before it finished.';
          setScriptErrorMessage(line ? `Line ${line}: ${msg}` : msg);
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [build, hydrated, loadDoc]);

  // Report the latest built doc to the caller for grading: the Build doc
  // while on Build, the last script run's doc while on Code (falling back
  // to `doc` before any Run happens there, e.g. right after mount hydration).
  useEffect(() => {
    // Before hydration the doc is still the empty placeholder and the caller
    // already holds null -- unless the student has started building in the
    // gap (or the mount run never answers, e.g. a comment-only starter), in
    // which case what they built must still reach the grader.
    if (!hydrated && doc.features.length === 0) return;
    // Refusals ride along so a declared-but-unbuilt feature (a Round the
    // kernel "shows without") cannot satisfy a model requirement. They land
    // after the kernel build, later than the doc, so this fires again then.
    const refused = refusals && refusals.size > 0 ? Object.fromEntries(refusals) : undefined;
    onDocChangeRef.current?.(build ? doc : (scriptDoc ?? doc), refused);
  }, [hydrated, build, doc, scriptDoc, refusals]);

  // Build -> script.js. Debounced so a drag doesn't write on every frame
  // (dimension drags only land in `doc` on release anyway -- see
  // commitParams -- so in practice this fires once per commit or structural
  // edit). Skipped once right after the mount/first-run hydration adopts a
  // doc that came FROM `value` in the first place -- otherwise every page
  // load rewrites script.js with a re-serialized copy of what was already
  // there.
  //
  // ALSO skipped on the component's very first render, unconditionally --
  // `useEffect` runs after every render INCLUDING the first one, so with
  // only the ref above this fired on mount whenever the mount hydration
  // never adopts a doc at all (a comment-only starter: `value` has no
  // box()/hole() calls, so the sandboxed run produces an empty doc, and the
  // runner deliberately WITHHOLDS `reshape-doc` for an empty result -- see
  // that branch's own comment -- so skipNextRegenRef is never even set).
  // `doc` still starts at its EMPTY_DOC initial value regardless, so this
  // effect ran anyway, 300ms later called onChange(toScript(EMPTY_DOC)),
  // and silently replaced a comment-only starter (e.g.
  // lessons/8-1-11-project-desk-tray/script.js) with near-nothing before
  // the student had touched anything (SPEC-A1 rework 2, mode:"both" lens).
  //
  // ALSO gated on `build` -- Build tools are the ONLY legitimate source of a
  // student EDIT to `doc`; on the Code side `doc` only ever changes via the
  // mount/first-run hydration adopt above, which has no business writing
  // ANYTHING back into the text the student is actively looking at and
  // typing into. This is not just belt-and-suspenders for the same case
  // skipNextRegenRef covers: once `scriptDoc` is non-null, `showBrepOnCode`
  // flips true and the visible pane swaps from the runner iframe to
  // BrepViewport -- which, in the same commit, MOUNTS the (until-now absent)
  // hidden shadow runner instance for the first time (`wantsHydrationShadow`
  // becomes true). That fresh iframe navigates with the SAME `code`/`runKey`
  // it inherits and re-runs it, so a second, redundant 'reshape-doc' arrives
  // with a NEW `namedParams` array (referentially different even with equal
  // content). `hydrated` is already true by then, so the adopt branch (and
  // its skipNextRegenRef) never re-arms -- but `scriptNamedParams` is still
  // in this effect's deps and just changed, firing it with the guard
  // already spent. Measured 2026-09-04, 8-1-9 (mode:"code"): script.js was
  // emptied by this exact sequence, seconds after a successful Run.
  const isMountRenderRef = useRef(true);
  useEffect(() => {
    if (isMountRenderRef.current) { isMountRenderRef.current = false; return; }
    if (!build) return;
    if (skipNextRegenRef.current) { skipNextRegenRef.current = false; return; }
    const t = setTimeout(() => {
      const text = toScript(doc, scriptNamedParams ?? undefined);
      onChangeRef.current(text);
    }, 300);
    return () => clearTimeout(t);
  }, [doc, scriptNamedParams, build]);

  function chooseSide(next: 'build' | 'code') {
    if (next === 'build' && scriptDoc && !build) {
      // Code -> Build: adopt whatever the last Run built, same as the
      // sandbox's own chooseBuild() always has.
      loadDoc(scriptDoc);
    }
    setBuild(next === 'build');
  }

  const run = useCallback(() => {
    setCode(value);
    setRunKey((k) => k + 1);
  }, [value]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Enter' && !build && canCode) {
        e.preventDefault();
        run();
        return;
      }
      if (!build || !(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [build, canCode, run, undo, redo]);

  function clearModel() {
    if (!window.confirm('Clear the model and start again? Unsaved work will be lost.')) return;
    loadDoc(EMPTY_DOC);
    // The feature ids and the most recent pick go; the Shift-accumulated
    // edge/face items stay, exactly as this read when it was setSelected([])
    // beside setPickedEdge(null)/setPickedFace(null), with the two multi-pick
    // arrays left alone.
    setSelection((s) => ({ ...withFeatureIds(s, []), primary: null }));
    past.current = [];
    future.current = [];
    setDepth({ back: 0, forward: 0 });
  }

  function exportFilename(ext: string): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
      + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const n = docRef.current.features.length;
    return `reshape-${n}-feature${n === 1 ? '' : 's'}-${stamp}.${ext}`;
  }

  function exportSTL() {
    const mesh = meshRef.current;
    if (!mesh) return;
    const bytes = writeSTL(mesh);
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/sla' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFilename('stl');
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportOBJ() {
    const mesh = meshRef.current;
    if (!mesh) return;
    const text = writeOBJ(mesh);
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFilename('obj');
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function export3MF() {
    const mesh = meshRef.current;
    if (!mesh) return;
    const bytes = await write3MF(mesh);
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFilename('3mf');
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const showBrep = build;
  // Code's own visible model: once a Run (or the mount hydration) has built
  // something, Code shows the SAME B-rep viewport Build uses, fed by the
  // last thing the script produced -- a Code-only lesson (`mode: "code"`,
  // no Build side at all) otherwise has NO way to ever see a shape, and a
  // `both` lesson's Code tab went from "editor + blank pane" back to
  // "editor + model" the way the pre-extraction sandbox always showed it.
  // Never true before the first successful build (scriptDoc still null) --
  // that state keeps ReshapePreview's own "write a script and click Run"
  // placeholder instead, in the branch below.
  const showBrepOnCode = !build && scriptDoc != null;
  const shownDoc = showBrep ? (previewDoc ?? effectiveDoc) : (scriptDoc ?? EMPTY_DOC);
  // reSHape Script's format is round-trippable -- toScript()'s output can be
  // re-run to recover `doc` from text, which is what makes the shadow iframe
  // below work at all. Needed whenever the VISIBLE pane is a BrepViewport
  // rather than the runner iframe itself -- Build always, and Code once it
  // has switched over to showBrepOnCode -- so a later Run still has
  // something to execute it.
  const wantsHydrationShadow = showBrep || showBrepOnCode;

  // ---- the status bar's note ticker ---------------------------------------
  // One note at a time, derived fresh each render from state this component
  // ALREADY owns -- nothing new to track, and nothing here duplicates a panel
  // row: the ticker is the app-wide readout for notes that outlast the
  // interaction (SPEC §2 principle 3, §5.9). FINAL priority order, after the
  // 2026-09-16 rework: (1) stale 'error' WITH a script error -> conflict
  // (the script message itself -- Code mode's preview-error sets BOTH
  // stale='error' and scriptErrorMessage, and the specific message must
  // outrank the generic build-failed note); (2) stale 'error' WITHOUT one ->
  // conflict (first refusal, else the generic build-failed text); (3) a
  // refusal -> conflict; (4) a script error on its own -> conflict;
  // (5) stale 'empty' -> status (Build: "the last version that worked is on
  // screen"; Code: "Script ran but built nothing..." -- the runner withholds
  // the doc for an empty result, so Code has no last version); (6) rebuild
  // timing -> status; (7) quiet (null).
  const statusNote: StudioNote | null = useMemo(() => {
    if (stale === 'error') {
      if (scriptErrorMessage) {
        return { severity: 'conflict', text: scriptErrorMessage, source: 'script' };
      }
      const first = refusals instanceof Map && refusals.size > 0
        ? refusals.entries().next().value
        : undefined;
      return first
        ? { severity: 'conflict', text: first[1], source: first[0] }
        : { severity: 'conflict', text: 'Build failed -- the last version that worked is on screen.' };
    }
    if (refusals instanceof Map && refusals.size > 0) {
      const entry = refusals.entries().next().value;
      return entry
        ? { severity: 'conflict', text: entry[1], source: entry[0] }
        : null;
    }
    if (scriptErrorMessage) {
      return { severity: 'conflict', text: scriptErrorMessage, source: 'script' };
    }
    if (stale === 'empty') {
      // Mode-aware (2026-09-16 polish): a script that built nothing withholds
      // its doc entirely, so in Code mode "the last version that worked" is a
      // lie -- nothing ran to completion. Build mode keeps the original text.
      return build
        ? { severity: 'status', text: 'The last version that worked is on screen.' }
        : { severity: 'status', text: 'Script ran but built nothing — add a shape (box, cylinder…) and Run again.' };
    }
    if (rebuildMs != null) {
      return { severity: 'status', text: `rebuilt in ${rebuildMs} ms` };
    }
    return null;
  }, [stale, refusals, scriptErrorMessage, rebuildMs, build]);

  return (
          <div
            className={
              'reshape-studio'
              + (build ? ' is-build' : '')
              + (build && toolsHidden ? ' is-tools-hidden' : '')
              + (!build && codeHidden ? ' is-code-collapsed' : '')
              + (!build && codeFullscreen ? ' is-code-fullscreen' : '')
            }
          >
      <div className="reshape-studio-toolbar">
        {canBuild && canCode && (
          <div className="sandbox-modes" role="group" aria-label="Editing mode">
            <button
              type="button"
              aria-pressed={!build}
              className={!build ? 'sandbox-mode is-active' : 'sandbox-mode'}
              onClick={() => chooseSide('code')}
            >
              Code
            </button>
            <button
              type="button"
              aria-pressed={build}
              className={build ? 'sandbox-mode is-active' : 'sandbox-mode'}
              onClick={() => chooseSide('build')}
            >
              Build
            </button>
          </div>
        )}
        {/* ModelEditor's shape-tools bar portals in here when build. */}
        <span id="reshapeRibbon" className="reshape-studio-ribbon" aria-hidden={!build} />
        {!build && canCode && (
          <button className="btn-run" style={{ flexShrink: 0 }} onClick={run}>▶ Run</button>
        )}
        {/* Clear model / Export STL,OBJ,3MF / Save,Open / Export Drawing
            (SVG,PDF) used to live here as a fixed row of chips, then in a
            separate File/Edit/View/Insert/Modify menu bar (MenuBar.tsx).
            Both are gone now (2026-09-13): the ribbon's own File and Edit
            groups (model/ModelEditor.tsx) call these same handlers directly,
            so there is exactly one place these actions live, not three. */}
        {toolbarExtra}
      </div>

      <div className="reshape-studio-body">
        {/* The left dock (grid-area tools): ModelEditor's collapsible card,
           the only thing in it now that the Rules panel is gone (it lived
           in this same grid area, below the card -- see reshape-studio-left's
           own history if that host is ever needed again). */}
        {build && (
          <div className="reshape-studio-left">
            <div className="reshape-studio-tools">
              <div className="reshape-studio-tools-kicker">Browser</div>
              <ModelEditor
              doc={doc}
              onChange={applyDoc}
              selection={selection}
              onSelect={selectFeatures}
              onSelectionChange={setSelection}
              rollbackIndex={rollbackIndex}
              onRollback={setRollbackIndex}
              registerContextActions={(a) => { const had = ctxActionsRef.current != null; const has = a != null; ctxActionsRef.current = a; if (had !== has) setCtxActions(has); }}
              onUndo={undo}
              onRedo={redo}
              canUndo={depth.back > 0}
              canRedo={depth.forward > 0}
              historyGen={historyGen}
              collapsible
              onCollapsed={setToolsHidden}
              refusals={refusals}
              hasMesh={hasMesh}
              onExportSTL={exportSTL}
              onExportOBJ={exportOBJ}
              onExport3MF={export3MF}
              canClearModel={canBuild}
              onClearModel={clearModel}
              activePlane={activePlane}
              onActivePlaneChange={setActivePlane}
              sketchMode={sketchEditId !== null}
              onOpenSketch2D={setSketchEditId}
              onExitSketch2D={() => setSketchEditId(null)}
              onEditFeature={editFeature}
            />
            </div>
          </div>
        )}
        {!build && canCode && (
            <div className="reshape-studio-code">
            {codeHidden ? (
              <div className="reshape-code-collapsed" role="group" aria-label="Code editor">
                <button
                  type="button"
                  onClick={() => setCodeHidden(false)}
                  title="Show the code editor"
                  aria-label="Show the code editor"
                >
                  <PanelRightOpen size={14} />
                </button>
              </div>
            ) : (
              <>
                {/* The one primary, must-find affordance: right on the panel
                    itself, not buried behind a menu -- there is no build-mode
                    menu bar any more, and this control has no ribbon home in
                    Code mode's editor-only chrome anyway. */}
                <div className="reshape-code-toolbar" role="group" aria-label="Code panel view controls">
                  <button
                    type="button"
                    onClick={() => setCodeFullscreen((v) => !v)}
                    title={codeFullscreen ? 'Exit full screen (Esc)' : 'Full screen the code editor'}
                    aria-label={codeFullscreen ? 'Exit full screen' : 'Full screen the code editor'}
                    aria-pressed={codeFullscreen}
                  >
                    {codeFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                  </button>
                  {!codeFullscreen && (
                    <button
                      type="button"
                      onClick={() => setCodeHidden(true)}
                      title="Collapse the code editor, so the model fills the window"
                      aria-label="Collapse the code editor"
                    >
                      <PanelRightClose size={14} />
                    </button>
                  )}
                </div>
                <CodeEditor />
              </>
            )}
          </div>
        )}

        {/* Viewport + params: grid row 2. The pane holds both internally
            (view flexes; the params aside keeps its fixed 240px) -- Build's
            tools dock is the only other row-2 cell. The rules host moved
            next to the tools card in the left dock above; the is-code-
            fullscreen hide is the pane-hiding mechanism that survives the
            grid. */}
        <div className="reshape-pane">
          <div className="reshape-pane-view">
            {sketchEditId && (() => {
              const sk = doc.features.find((f) => f.id === sketchEditId);
              return sk && sk.kind === 'sketch' ? (
                <SketchCanvas2D
                  key={sk.id}
                  sketch={sk}
                  doc={doc}
                  onChange={applyDoc}
                  onExit={() => setSketchEditId(null)}
                />
              ) : (
                setSketchEditId(null),
                null
              );
            })()}
            {!sketchEditId && (showBrep || showBrepOnCode) ? (
              <BrepViewport
                doc={shownDoc}
                ruleActivityAt={ruleActivityAt}
                onStats={(st: BrepViewportStats) => {
                  const total = st.buildMs + st.meshMs + st.drawMs;
                  if (previewDoc != null && total > PREVIEW_DEGRADE_MS) {
                    previewDegradedRef.current = true;
                    setPreviewDoc(null);
                  }
                  setRebuildMs(Math.round(total));
                  setStale(st.triangles > 0 || isSketchOnly(shownDoc) ? null : 'empty');
                  if (!refusalsUnchanged(refusals, st.refusals)) setRefusals(st.refusals);
                  // The same measurement Home/fit already computes, lifted so
                  // the status bar can show the model's own mm extents.
                  setBboxMm(st.dimsMm ?? null);
                }}
                onPick={showBrep ? (p: ViewportPick | null) => {
                  if (!p) {
                    // A click on nothing clears every axis at once -- what
                    // six separate setters used to spell out one per line --
                    // regardless of any modifier held: Ctrl+click on empty
                    // space clears too (SPEC-mouse-parity.md Phase 3 item 1's
                    // "empty click clears"), so there is no way to leave a
                    // stale selection stuck on by accident.
                    setSelection(clearSelection);
                    return;
                  }
                  const owner = ownerOf(doc, p);
                  const item = itemOfPick(p);
                  // Item E: an unnamed pick (nameEdgeOnCurrentShape/
                  // nameFaceOnCurrentShape honestly refused it -- see
                  // ViewportPick's own comment) cannot join a multi-select,
                  // since Round/Angled Corner need a real name to build
                  // from same as the single-edge path already does.
                  //
                  // Real modifiers, read off the triggering event at the
                  // moment of the pick (ViewportPick's own ctrlKey/shiftKey/
                  // metaKey) rather than a window keydown/keyup listener
                  // guessing at the live keyboard state -- SPEC-mouse-parity.md
                  // Phase 3 item 1. metaKey stands in for ctrlKey so a Mac's
                  // Cmd-click matches a PC's Ctrl-click. Both held at once:
                  // Shift wins (toggle) -- Fusion does not define this
                  // combination, so this file does, the same as it already
                  // has to for everything else `[CONFIRM ...]` in the spec.
                  const ctrl = p.ctrlKey || p.metaKey;
                  const shift = p.shiftKey;
                  setSelection((prev) => {
                    // SPEC-mouse-parity.md Phase 3 item 3 (mixed selection):
                    // Ctrl/Shift accumulate across EVERY kind now, not just
                    // the kind just clicked -- toggle()/addIfAbsent() already
                    // compare by kind+target+name (selection-model.ts's own
                    // sameItem() rule), so a face and an edge are never
                    // mistaken for each other; the only thing standing in the
                    // way of holding both at once was this reducer
                    // pre-filtering `prev.items` down to the just-clicked
                    // kind before handing it to them -- the two-separate-
                    // arrays quirk P3.2's vertex/body work (commit 1cb9a3b)
                    // inherited rather than fixed, since fixing it was always
                    // this later item's job. A plain click still replaces
                    // everything regardless of kind (replaceSelection ignores
                    // `prev.items` entirely), and an unresolved pick still
                    // clears everything (clearSelection ditto) -- neither of
                    // those two ever read the filtered copy this used to
                    // compute, so reading `prev` straight changes nothing
                    // about them.
                    //
                    // vertex/body (SPEC-mouse-parity.md Phase 3 item 2) have
                    // no naming machinery of their own -- ViewportPick's own
                    // `name` is always null for them, not sometimes-null the
                    // way a face/edge pick's resolution can fail (see
                    // ViewportPick's own doc comment) -- so the "an unnamed
                    // pick can't join a multi-select" rule above only ever
                    // meant a resolution FAILURE, not a kind with no name
                    // concept to begin with. `target` (the owning feature
                    // id) is always fully resolved for them, the same way a
                    // plain feature-kind item's already is.
                    const canSelect = p.kind === 'vertex' || p.kind === 'body' || !!p.name;
                    const members = canSelect
                      ? (shift ? toggleSelection(prev, item) : ctrl ? addIfAbsent(prev, item) : replaceSelection(prev, item))
                      : clearSelection(prev);
                    // An owner-less pick leaves the feature ids alone, the
                    // same way `if (owner) setSelected([owner])` did -- see
                    // ownerOf()'s own comment on why it answers null.
                    return {
                      ...withFeatureIds(members, owner ? [owner] : featuresOf(prev)),
                      // `primary` is the RAW pick, set apart from multi-select
                      // membership: pickedEdge/pickedFace/pickedSize were
                      // overwritten by whatever was just clicked even when that
                      // same click Shift-toggled the edge back OFF the
                      // multi-selection, so toggle()'s own primary-on-remove
                      // rule cannot stand in for this (selection-model.ts's
                      // header calls out that exact quirk).
                      primary: item,
                    };
                  });
                } : () => { /* Code's viewport is read-only: no ModelEditor here to act on a pick, and `selection` is Build's own state, resolved against `doc`, not `scriptDoc` -- reusing it here would risk a stale/wrong-looking selection. */ }}
                pick={showBrep && primaryPick?.kind === 'edge' && primaryPick.name ? { target: primaryPick.target, name: primaryPick.name } : null}
                selectedCount={showBrep ? selected.length : 0}
                selectionLabel={showBrep ? selectionLabel : null}
                sketchPlane={activeSketchPlane}
                anchors={specs}
                onAnchors={setAnchors}
                onMesh={(m) => {
                  meshRef.current = m;
                  setHasMesh(m !== null);
                }}
                onEngine={() => setEngineReady(true)}
                badgesInStatusBar={true}
                filters={selection.filters}
                onFiltersChange={(next) => setSelection((s) => ({ ...s, filters: next }))}
                onBoxSelect={showBrep ? (items, shiftKey) => {
                  // SPEC-mouse-parity.md Phase 3 item 4: a box-select drag's
                  // result lands here -- pure UI state, setSelection only,
                  // so it adds ZERO undo entries (undo history is doc
                  // history; `past`/`future` above are never touched).
                  // Shift held: every item joins whatever is already
                  // selected (addIfAbsent, the same no-duplicate rule a
                  // Ctrl-click uses); released: the box REPLACES the whole
                  // selection, the same way a plain click does. An empty
                  // box result replaces with nothing -- the same
                  // click-on-empty-space clears.
                  setSelection((prev) => {
                    // Shift + an empty box result is a complete no-op --
                    // "add nothing to what is there" must not fall through
                    // to the withFeatureIds() below and wipe the feature ids
                    // the drag started from.
                    if (shiftKey && items.length === 0) return prev;
                    const base = shiftKey ? prev : clearSelection(prev);
                    let next = base;
                    // addIfAbsent, not add: a box's corner vertex occupies
                    // several of the mesh's own position slots, so the raw
                    // result carries repeated identical items -- the same
                    // no-duplicate rule a Ctrl-click already applies.
                    for (const item of items) next = addIfAbsent(next, item);
                    const last = items[items.length - 1] ?? null;
                    // Every DISTINCT owner among the new items, not just the
                    // last one -- a box-select can span MULTIPLE bodies
                    // (unlike a single click's always-one-owner pick), and
                    // collapsing to the last item's owner alone silently
                    // dropped every other solid's items from `selected`
                    // (the status bar's "N selected" and every owner-scoped
                    // reader downstream of it) even though addIfAbsent()
                    // above had already added them to `next.items` -- a
                    // window-select across two solids looked like it kept
                    // both but visibly reported/scoped to only one.
                    const owners = distinctOwners(doc, items);
                    const ids = owners.length > 0
                      ? (shiftKey ? Array.from(new Set([...featuresOf(prev), ...owners])) : owners)
                      : items.length > 0 ? featuresOf(prev) : [];
                    return {
                      // An empty box result replaces with NOTHING -- the
                      // same click-on-empty-space clears -- so the feature
                      // ids the drag started from are not resurrected here.
                      ...withFeatureIds(next, ids),
                      primary: last,
                    };
                  });
                } : undefined}
                onFeatureDoubleClick={showBrep ? editFeature : undefined}
                onSelectAll={showBrep ? () => setSelection(selectAllFeatures(doc)) : undefined}
                onDeleteSelected={showBrep ? () => ctxActionsRef.current?.remove() : undefined}
                onUndo={showBrep ? undo : undefined}
                onRedo={showBrep ? redo : undefined}
                onStartSketch={showBrep ? () => {
                  // The marking menu's Sketch wedge: the same three steps
                  // ModelEditor's own startSketch() runs (ModelEditor.tsx:
                  // 884-890), minus its local `say(null)` status message,
                  // which has no equivalent here.
                  const f = newSketch(doc, activePlane);
                  applyDoc({ ...doc, features: [...doc.features, f] });
                  selectFeatures([f.id]);
                  setSketchEditId(f.id);
                } : undefined}
                registerPickAt={(fn) => { pickAtRef.current = fn; }}
              />
            ) : !sketchEditId ? (
              <ReshapePreview
                ref={frameRef}
                code={code}
                runKey={runKey}
                engine="script"
              />
            ) : null}
            {/* Sketch mode keeps a hydration runner alive even though the
                visible pane is SketchCanvas2D: the 0x0 shadow below would
                unmount here otherwise (build is still true), and the next
                Run after Done would have nothing mounted to execute. The
                visible ReshapePreview branch above skips sketch mode too --
                its iframe sat OVER the 2D canvas (same inset:0 box) and ate
                every click. */}
            {sketchEditId && build && (
              <div style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
                <ReshapePreview ref={frameRef} code={code} runKey={runKey} engine="script" />
              </div>
            )}
            {wantsHydrationShadow && !sketchEditId && (
              // Never shown -- see wantsHydrationShadow's own comment. Its
              // only job is to run `code` through the sandbox on mount so
              // `doc` can be hydrated from `value` while the visible pane
              // above is the B-rep viewport, not an iframe. The wrapper is
              // load-bearing, not decorative: ReshapePreview's OWN "nothing
              // to run yet" placeholder (runKey still 0 -- always true here
              // when autoRunOnMount is off, e.g. the sandbox) is an ordinary
              // visible <div>, not styled hidden the way its iframe is, and
              // painted straight into this pane over the B-rep canvas.
              // Sketch mode has its OWN shadow branch above -- the same
              // runner kept alive while SketchCanvas2D owns the visible
              // pane, so the two branches must never both mount.
              <div style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
                <ReshapePreview ref={frameRef} code={code} runKey={runKey} engine="script" />
              </div>
            )}
            {build && !sketchEditId && (
              // Hidden while the 2D sketcher owns the pane: its handles and
              // draw-catcher would sit over the canvas and eat its clicks.
              <HandleOverlay
                points={anchors.filter((a) => {
                  if (a.param.startsWith('__ctx_')) return false;
                  // A sketch's own corner/round anchors are excluded here --
                  // they exist only so outlineAnchors below can project its
                  // read-only outline; a sketch is edited in SketchCanvas2D's
                  // 2D canvas now, not by dragging a handle in this view.
                  return !doc.features.some((f) => f.kind === 'sketch' && a.param.startsWith(`${f.id}_`));
                })}
                values={paramValues}
                scales={scales}
                onDrag={(param, val) => { sendParams({ [param]: val }); touchRuleActivity(); }}
                onCommit={() => { commitParams(); touchRuleActivity(); }}
                onTap={(x, y) => pickAtRef.current?.(x, y)}
                outlines={outlines}
                outlineAnchors={anchors}
                bottomInset={0}
              />
            )}
            {ctxBarVisible && !sketchEditId && ctxFeature && ctxAnchor && (
              // Piece B: the context bar. anchor/point/absolute inside
              // .reshape-pane-view (position:relative), the same offset
              // parent HandleOverlay's handles use, so the bar floats over
              // the selection and never the docked rows. viewWidth is left
              // undefined in v1 (ContextBar's own comment: absent means no
              // horizontal clamp) -- the bar is short and the pane wide.
              <ContextBar
                featureKind={ctxFeature.kind}
                name={nameMap(doc)[ctxFeature.id] ?? ctxFeature.id}
                anchor={ctxAnchor}
                chips={ctxChips}
                refusal={ctxRefusal}
                actions={ctxActionsList}
                onDismiss={() => setCtxDismissed(true)}
              />
            )}
          </div>
          {(runKey > 0 || build) && (
            <aside className="reshape-pane-params" ref={flashParamsRef}>
              <ReshapeParamsPanel
                defs={brepParamDefs}
                emptyMessage={build
                  ? (selected.length
                    ? 'This step has no numbers to adjust.'
                    : 'Pick a step in the timeline, or a face on the model, to see its numbers.')
                  : "Run a script and its numbers appear here. param('name', value) gives one a caption."}
                notice={
                  !build && scriptErrorMessage
                    ? scriptErrorMessage
                    : selected.length === 1 ? refusals?.get(selected[0]) ?? null : null
                }
                values={paramValues}
                onChange={sendParams}
                onCommit={commitParams}
                lastMs={rebuildMs}
                stale={stale}
              />
            </aside>
          )}
        </div>
      </div>

      {/* The parametric timeline strip: ModelEditor portals its feature
          list here, Fusion-360-style, across the bottom of the canvas. */}
      <div id="reshapeTimeline" className={build ? 'reshape-studio-timeline' : 'reshape-studio-timeline is-hidden'} aria-hidden={!build} />

      {/* The status bar (adoption step 1): the single home every note,
          selection readout, and engine/bbox fact reports to -- a persistent
          26px docked row, last flex child so it always spans the bottom
          (mockup-A's grid). role=status/aria-live=polite so a screen reader
          hears the ticker without it stealing focus. Persists in Code mode
          and Code-fullscreen by design: it is app chrome, not Build chrome,
          and in Code mode its ticker carries scriptErrorMessage instead. */}
      <footer
        className="reshape-studio-status"
        role="status"
        aria-live="polite"
      >
        {selectionLabel ? (
          <button
            type="button"
            className="reshape-studio-status-sel"
            title="Click to clear the selection"
            aria-label="Clear the selection"
            onClick={() => selectFeatures([])}
          >
            {selectionLabel}
          </button>
        ) : showBrep ? (
          <span className="reshape-studio-status-sel is-muted">Nothing selected</span>
        ) : (
          <span className="reshape-studio-status-sel is-muted">Code</span>
        )}
        <span className="reshape-studio-status-grow" />
        {statusNote && (
          <span
            className="reshape-studio-status-note"
            style={{ color: noteColor(statusNote.severity) }}
            title={statusNote.source ? `${statusNote.source} — ${statusNote.text}` : statusNote.text}
          >
            {statusNote.source ? `${statusNote.source} — ` : ''}{statusNote.text}
          </span>
        )}
        <span
          className="reshape-studio-status-eng"
          title={
            stale == null && rebuildMs != null
              ? `rebuild ok (${rebuildMs} ms)`
              : undefined
          }
        >
          {/* The engine-state dot stays amber on stale 'error' (engine state)
              while the ticker note renders red (message severity) -- a
              deliberate split: state indicator vs message color. Do not unify. */}
          <i
            aria-hidden="true"
            className="reshape-studio-status-eng-dot"
            style={{
              background: engineReady && stale == null
                ? 'var(--reshape-success)'
                : stale === 'error'
                  ? 'var(--reshape-warn)'
                  : 'var(--reshape-text-muted)',
            }}
          />
          {engineReady ? 'brep-rs' : 'engine loading'}
        </span>
        {showBrep && bboxMm && (
          <span className="reshape-studio-status-bbox">
            {bboxMm.x} × {bboxMm.y} × {bboxMm.z} mm
          </span>
        )}
        <span className="reshape-studio-status-nav">Right-drag orbit · Scroll zoom</span>
      </footer>

      <style>{`
        /* The one place every --reshape-* token is defined -- everything
           else in this component (and model/ModelEditor.tsx,
           model/HandleOverlay.tsx,
           ReshapeParamsPanel.tsx) only ever references var(--reshape-*).
           Values are the Dracula palette this app and shCode's own embedded
           reSHape chrome already agreed on before this pass just never
           centralized it -- see .claude/plans/reshape-studio-design-tokens.md
           for the research this was pulled from. --reshape-pink and
           --reshape-yellow extend that plan's own 10-token list: both hexes
           (#ff79c6, #f1fa8c) were already load-bearing live colors here
           (HandleOverlay's "panel is pointing at this" cue and its point-
           handle border) with no reshape token assigned to them yet. */
        .reshape-studio {
          --reshape-bg: #282a36;
          --reshape-surface: #1e1f29;
          --reshape-surface-alt: #36333a;
          --reshape-border: #44475a;
          --reshape-text: #f8f8f2;
          --reshape-text-muted: #6272a4;
          --reshape-accent: #8be9fd;
          --reshape-accent-2: #bd93f9;
          --reshape-success: #50fa7b;
          --reshape-warn: #ffb86c;
          --reshape-danger: #ff5555;
          --reshape-pink: #ff79c6;
          --reshape-yellow: #f1fa8c;

          --reshape-space-1: 2px;
          --reshape-space-2: 4px;
          --reshape-space-3: 8px;
          --reshape-space-4: 12px;
          --reshape-space-5: 16px;
          --reshape-space-6: 24px;
          --reshape-radius: 4px;

          --reshape-font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          --reshape-font-mono: ui-monospace, "Fira Code", Consolas, monospace;
          --reshape-font-size-sm: 12px;
          --reshape-font-size-base: 13px;
          --reshape-font-size-lg: 15px;

          font-family: var(--reshape-font-ui);
          /* Pure fallback fill, not a layout change: nothing under this rule
             ever painted the root itself, and standalone (packages/
             sandbox-dev, no shCode host page behind it) that left a real
             white sliver above the docked toolbar until its own surface
             began -- caught by the exact "transparent where a card
             background should be" check this migration's verification step
             calls for. */
          background: var(--reshape-bg);
          /* Docked grid shell (adoption step 2, SPEC-ui-revamp-decisions.md
             section 1: Mockup A's rows/columns). Every child docks into a
             named area -- no absolute chrome, nothing floats over anything,
             so the whole floating-card collision class the five measured
             hacks were built to paper over dies here. Rows use the constants
             above so HandleOverlay and the portaled timeline keep single
             sources of truth. */
          display: grid;
          grid-template-rows: ${TOOLBAR_HEIGHT_PX}px 1fr ${TIMELINE_HEIGHT_PX}px ${STATUS_BAR_HEIGHT_PX}px;
          grid-template-columns: 280px 1fr;
          grid-template-areas:
            "toolbar toolbar"
            "tools view"
            "timeline timeline"
            "status status";
          flex: 1 1 auto;
          width: 100%;
          min-width: 0;
          height: 100%;
          min-height: 0;
          position: relative;
        }
        /* Code mode re-maps the shell: no left dock (the tools card is
            Build's own chrome), and the row-2 cells split as the old ~40/60
            flex did -- the code editor in the narrow column, the pane
            (which keeps view + the fixed-240px params aside internally) in
            the wide one. The timeline row is collapsed to 0 in Code mode:
            the #reshapeTimeline host stays mounted (ModelEditor resolves it
            by id), it just has no row to occupy -- its is-hidden class is
            now redundant but harmless. */
        .reshape-studio:not(.is-build) {
          grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
          grid-template-rows: ${TOOLBAR_HEIGHT_PX}px 1fr 0px ${STATUS_BAR_HEIGHT_PX}px;
          grid-template-areas:
            "toolbar toolbar"
            "tools view"
            "timeline timeline"
            "status status";
        }
        .reshape-studio:not(.is-build) .reshape-studio-left { display: none; }
        .reshape-studio-toolbar {
          grid-area: toolbar;
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
          padding: 4px 10px;
        }
        /* The one flexible child: it, not the mode toggle beside it, gives
           way (scrolling its own tool icons) if the row is ever too narrow
           for all of it -- see the flex-shrink:0 on .sandbox-modes below.
           Measured 2026-09-04: without this "Build" clipped to "Buil" at
           1440px, .sandbox-modes shrinking along with everything else. */
        .reshape-studio-ribbon { flex: 1 1 auto; min-width: 0; overflow-x: auto; display: flex; align-items: center; }
        .reshape-studio-ribbon .model-tools { height: 42px; background: transparent; border-bottom: 0; }
        .sandbox-modes {
          display: inline-flex;
          flex-shrink: 0;
          border: 1px solid var(--reshape-border);
          border-radius: var(--reshape-radius);
          overflow: hidden;
        }
        .sandbox-mode {
          padding: 6px 13px;
          background: transparent;
          color: var(--reshape-text-muted);
          border: 0;
          border-right: 1px solid var(--reshape-border);
          cursor: pointer;
          font-size: 13px;
        }
        .sandbox-mode:last-child { border-right: 0; }
        .sandbox-mode:hover { color: var(--text, var(--reshape-text)); }
        .sandbox-mode.is-active { background: var(--reshape-border); color: var(--reshape-text); }
        /* The mode toggle loses its chip border and reads as a flat ribbon
           control, same as the pre-extraction sandbox. (The Export/Save/
           Open chip row this rule also used to cover -- via a button[style]
           selector, no backticks here, see the NB a few lines below -- was
           removed 2026-09-13; see the toolbar JSX's own comment on why. Those
           actions now live in the ribbon's own File/Edit groups,
           model/ModelEditor.tsx.) */
        .reshape-studio.is-build .sandbox-modes { border: 0; background: transparent; }
        .reshape-studio.is-build .sandbox-mode { border-right: 0; color: #d3d5e3; }
        .reshape-studio.is-build .sandbox-mode.is-active { background: var(--reshape-border); color: var(--reshape-text); }
        .reshape-studio.is-build .sandbox-mode:hover { color: var(--reshape-text); }
        /* The JSX wrapper div: its children are the real grid items, so the
           wrapper itself steps out of layout entirely (display: contents) --
           the grid owns placement, the wrapper contributes no box. */
        .reshape-studio-body {
          display: contents;
        }
        /* The left dock (grid-area tools): ModelEditor's collapsible card
           fills the top of the column; the rules host sits below it, still
           scrollable and clamped, behind a hairline. Docked, not floating:
           border-right hairline, no shadow, no z-index, no canvas overlap --
           the margin dodges the floating card used to force on the rules
           pane and the timeline die with the card itself. */
        .reshape-studio-left {
          grid-area: tools;
          display: flex;
          flex-direction: column;
          min-width: 0;
          min-height: 0;
          background: var(--card, var(--reshape-surface));
          border-right: 1px solid var(--border, var(--reshape-border));
          overflow: hidden;
        }
        /* Collapsed by the student (is-tools-hidden) -- the dock track
           itself shrinks to a rail (the old item width hack left a 234px
           dead strip because the 280px track never moved), the rules host
           hidden with it (ModelEditor only portals rules while its own card
           is expanded, so the host is empty in that state anyway). */
        .reshape-studio.is-tools-hidden {
          grid-template-columns: 46px minmax(0, 1fr);
        }
        .reshape-studio.is-tools-hidden .reshape-studio-left {
          background: rgba(40, 42, 54, 0.72);
        }
        /* The 46px rail can't hold the kicker's label ("Browser" truncates) --
           hide the strip entirely; the rail's own tools below stay intact. */
        .reshape-studio.is-tools-hidden .reshape-studio-tools-kicker { display: none; }
        .reshape-studio-tools {
          flex: 1 1 auto;
          min-height: 0;
          overflow-y: auto;
        }
        .reshape-studio-tools-kicker {
          flex: 0 0 auto;
          padding: 6px 10px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--reshape-text-muted);
          border-bottom: 1px solid var(--border, var(--reshape-border));
        }
        .reshape-studio-tools .model-tools { display: none; }
        .reshape-studio-code {
          grid-area: tools;
          min-width: 0;
          min-height: 0;
          display: flex;
          position: relative;
          border: 1px solid var(--border, var(--reshape-border));
          border-radius: var(--reshape-radius);
          overflow: hidden;
        }
        /* Collapsed by the student -- the code track shrinks to a rail, the
           pane takes the rest (mockup-H spirit: cols are the collapse
           behavior, items span their area). Mirrors .reshape-studio-tools'
           own 46px rail treatment above, minus the Undo/Redo/Sketch
           shortcuts that rail keeps (this panel has no equivalent "useful
           while collapsed" content -- a bare re-expand button is the whole
           rail). */
        .reshape-studio:not(.is-build).is-code-collapsed {
          grid-template-columns: 32px minmax(0, 1fr);
        }
        .reshape-studio:not(.is-build).is-code-collapsed .reshape-studio-code {
          background: rgba(40, 42, 54, 0.72);
        }
        .reshape-code-collapsed {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding-top: 6px;
          width: 100%;
          background: rgba(40, 42, 54, 0.72);
        }
        .reshape-code-toolbar {
          position: absolute;
          top: 6px;
          right: 6px;
          z-index: 5;
          display: flex;
          gap: 4px;
        }
        .reshape-code-collapsed button,
        .reshape-code-toolbar button {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          padding: 0;
          background: var(--reshape-surface-alt);
          border: 1px solid var(--reshape-border);
          border-radius: var(--reshape-radius);
          color: var(--reshape-text-muted);
          cursor: pointer;
        }
        .reshape-code-collapsed button:hover,
        .reshape-code-toolbar button:hover {
          color: var(--reshape-text);
          border-color: var(--reshape-accent);
        }
        /* Full screen: the code panel takes the entire main row. The pane's
            grid-area is display:none, and the columns squeeze to one track
            so the editor's tools cell IS the full row (without the squeeze
            the 3fr track would sit empty beside it). The menu bar/ribbon
            above are already build-gated JSX, so Code mode never renders
            them in the first place. NB: no backticks in this comment --
            see the block's own top-of-style-tag warning on why one here
            breaks the whole template literal. */
        .reshape-studio.is-code-fullscreen:not(.is-build) {
          grid-template-columns: minmax(0, 1fr) 0px;
        }
        .reshape-studio.is-code-fullscreen:not(.is-build) .reshape-pane { display: none; }
        .reshape-pane { grid-area: view; min-width: 0; display: flex; position: relative; min-height: 0; }
        .reshape-pane-view { flex: 1 1 auto; min-width: 0; display: flex; position: relative; }
        .reshape-pane-view .reshape-frame, .reshape-pane-view .reshape-empty { flex: 1; }
        .reshape-pane-params {
          flex: 0 0 240px;
          min-width: 0;
          border-left: 1px solid var(--border, var(--reshape-border));
          background: var(--card, var(--reshape-surface));
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        /* The context bar's Dimensions focus cue (piece B): a 600ms accent
           border flash saying "the numbers are HERE". Added and removed by
           focusParams() in this file; a transition, not an animation, so it
           fades in on add and out on remove with no keyframes needed. */
        .reshape-pane-params.reshape-params-flash {
          border-left: 2px solid var(--reshape-accent);
          transition: border-color 150ms ease-in;
        }
        .reshape-studio-timeline {
          grid-area: timeline;
          height: ${TIMELINE_HEIGHT_PX}px;
          display: flex;
          align-items: stretch;
          background: rgba(40, 42, 54, 0.88);
          border-top: 1px solid var(--reshape-border);
        }
        .reshape-studio-timeline.is-hidden { display: none; }
        .reshape-studio-timeline .model-timeline { flex: 1 1 auto; min-width: 0; }
        /* The status bar (mockup-H's .status, in this file's own tokens):
           26px docked row, flat, hairline top border, kicker typography on
           its labels, mono only where the readout is numeric. NO backticks
           anywhere in this block -- see the NB comments above on why one
           here would close the whole template literal. */
        .reshape-studio-status {
          grid-area: status;
          height: ${STATUS_BAR_HEIGHT_PX}px;
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 0 12px;
          background: var(--reshape-bg);
          border-top: 1px solid var(--reshape-border);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--reshape-text-muted);
          overflow: hidden;
          white-space: nowrap;
        }
        .reshape-studio-status-sel {
          background: transparent;
          border: 0;
          padding: 0;
          font: inherit;
          letter-spacing: inherit;
          text-transform: inherit;
          color: var(--reshape-text-muted);
          text-align: left;
          cursor: pointer;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .reshape-studio-status-sel:hover { color: var(--reshape-text); }
        .reshape-studio-status-sel.is-muted { color: var(--reshape-text-muted); cursor: default; }
        .reshape-studio-status-grow { flex: 1 1 auto; }
        .reshape-studio-status-note {
          min-width: 0;
          flex: 0 1 auto;
          overflow: hidden;
          text-overflow: ellipsis;
          font-weight: 400;
          text-transform: none;
          letter-spacing: 0;
        }
        .reshape-studio-status-eng {
          flex: none;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .reshape-studio-status-eng-dot {
          width: 7px;
          height: 7px;
          border-radius: 999px;
          display: inline-block;
        }
        .reshape-studio-status-bbox {
          flex: none;
          font-family: var(--reshape-font-mono);
          font-size: 11px;
          font-weight: 400;
          text-transform: none;
          letter-spacing: 0;
          font-variant-numeric: tabular-nums;
        }
        .reshape-studio-status-nav { flex: none; white-space: nowrap; }
      `}</style>
    </div>
  );
}
