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
import { Download, FileText, FolderOpen, RotateCcw, Save } from 'lucide-react';
import ReshapeParamsPanel, { type ParamDef, type ParamValues } from './ReshapeParamsPanel.js';
import ModelEditor from './model/ModelEditor.js';
import BrepViewport, { type BrepViewportStats, type ViewportPick } from './model/BrepViewportThree.js';
import HandleOverlay, { type AnchorPoint, type SketchOutline, type SketchPart } from './model/HandleOverlay.js';
import type { RuleActions, TouchedPart } from './model/SketchConstraints.js';
import { writeSTL, writeOBJ, write3MF, type MeshInput } from './mesh-export.js';
import { outlineOf } from '@shuff57/reshape-sketch/sketch-arc';
import { handlesFor, planeAnchor } from '@shuff57/reshape-script/model-handles';
import { EMPTY_DOC, type Feature, isSketchOnly, type ModelDoc, nameMap, newPolygonSketch, newRectangleSketch } from '@shuff57/reshape-script/model-types';
import { ownerOf } from '@shuff57/reshape-script/model-selection';
import { partWordFor, type TopoName } from '@shuff57/reshape-script/topo-name';
import {
  applyParam,
  generatedParams,
  paramValues as docParams,
  solveDoc,
  solveSketchDrag,
} from '@shuff57/reshape-script/model-codegen';
import { toScript, type ScriptParamRef } from '@shuff57/reshape-script/reshape-script-gen';
import { getKernelBaseUrl } from '@shuff57/reshape-kernel/config';
import type { EngineAdapter } from '@shuff57/reshape-kernel/engine-adapter';

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

/** Structural equality for a TopoName -- a plain, serializable object (see
 *  lib/topo-name.ts), so JSON.stringify is a safe and cheap comparison. Used
 *  only to dedupe/toggle a Shift-click multi-selection (item E); nothing
 *  here builds a Fillet from the comparison itself. */
function sameTopo(a: TopoName, b: TopoName): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
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
const RULES_PANEL_WIDTH_PX = 280;
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

const chipStyle: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 4,
  background: 'transparent',
  color: '#6272a4',
  border: '1px solid #44475a',
  cursor: 'pointer',
  fontSize: 13,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
};

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
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    setSelected((s) => {
      const keep = s.filter((id) => doc.features.some((f) => f.id === id));
      return keep.length === s.length ? s : keep;
    });
  }, [doc]);
  const [pickedEdge, setPickedEdge] = useState<{ target: string; edge: TopoName | null } | null>(null);
  const [pickedFace, setPickedFace] = useState<{ target: string; face: TopoName | null } | null>(null);
  // Item H (P20): the most recent pick's own size, straight off the kernel
  // (see BrepViewportThree.tsx's faceSize()/edgeLength()) -- kept separate
  // from pickedEdge/pickedFace above rather than added onto their shape,
  // since those two are also ModelEditor's own props and every existing
  // consumer there (round()'s edge-picked branch, Hole/Hollow's face
  // requirement, the disabled-state messages) only ever needed WHICH edge
  // or face, never its size. Purely additive, read only by selectionLabel
  // below.
  const [pickedSize, setPickedSize] = useState<number | [number, number] | null>(null);
  // Item E: a Shift-held click on a second edge/face adds it to the
  // selection instead of replacing it, the same way the timeline/sketch
  // chips already work (ModelEditor.tsx's pick()). `pickedEdge`/`pickedFace`
  // above stay exactly as they were -- "the most recent pick", which every
  // existing single-edge/single-face consumer (round(), Hole, Hollow, the
  // tooltip text) still reads unchanged -- these two arrays are purely
  // additive, read only by the multi-edge Round path and the selection pill.
  // BrepViewportThree.tsx's onPick carries no modifier-key info (a separate
  // team owns that file), so Shift is tracked here independently via
  // plain window listeners rather than threaded through the pick payload.
  const shiftHeldRef = useRef(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Shift') shiftHeldRef.current = true; };
    const up = (e: KeyboardEvent) => { if (e.key === 'Shift') shiftHeldRef.current = false; };
    const blur = () => { shiftHeldRef.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);
  const [pickedEdges, setPickedEdges] = useState<Array<{ target: string; edge: TopoName }>>([]);
  const [pickedFaces, setPickedFaces] = useState<Array<{ target: string; face: TopoName }>>([]);
  const [pointerHoverPart, setPointerHoverPart] = useState<{ kind: 'edge' | 'corner'; index: number } | null>(null);
  const [rowHoverPart, setRowHoverPart] = useState<
    { kind: 'edge' | 'corner'; index: number } | { kind: 'edge' | 'corner'; index: number }[] | null
  >(null);
  // Item N: when the Rules panel or a handle was last actually touched --
  // a click that commits a value (setRowHoverPart only fires with a real
  // touch, never on a plain mouse-leave clear) or a handle drag/commit.
  // BrepViewportThree.tsx uses this to hold its own "A sketch is flat..."
  // Pull hint off screen while a student is visibly busy in the panel,
  // rather than refreshing it on top of every rule they set.
  const [ruleActivityAt, setRuleActivityAt] = useState<number | null>(null);
  const touchRuleActivity = () => setRuleActivityAt(Date.now());
  // Item R: which edge(s)/corner of the active sketch a canvas CLICK has
  // selected -- see SketchPart's own doc comment for why this outlives a
  // hover. `ruleActionsRef` is the matching handle-out: SketchConstraints
  // (mounted inside ModelEditor, a sibling of HandleOverlay here) registers
  // its own row/cell handlers into it on every render, the same
  // `registerPickAt` pattern this file already uses for BrepViewportThree's
  // 3D pick. A plain ref, not state: the strip's buttons read it at click
  // time, and nothing here needs to re-render when it changes.
  const [selectedSketchParts, setSelectedSketchParts] = useState<SketchPart[]>([]);
  const ruleActionsRef = useRef<RuleActions | null>(null);
  // A stable object, created once, whose own methods dereference the ref
  // above at CALL time rather than at prop-pass time -- the same reasoning
  // `onTap={(x, y) => pickAtRef.current?.(x, y)}` below already relies on.
  // Without this indirection, HandleOverlay's `ruleActions` prop would be
  // whatever `ruleActionsRef.current` happened to be during ReshapeStudio's
  // OWN last render, one tick behind SketchConstraints' own render (a
  // child, whose registration effect runs after this component's).
  const ruleActionsProxy = useRef<RuleActions>({
    toggleEdge: (kind, edge) => ruleActionsRef.current?.toggleEdge(kind, edge),
    openLength: (edge) => ruleActionsRef.current?.openLength(edge),
    setPair: (a, b, kind) => ruleActionsRef.current?.setPair(a, b, kind),
    togglePin: (corner) => ruleActionsRef.current?.togglePin(corner),
    clearTouch: () => ruleActionsRef.current?.clearTouch(),
  }).current;
  const handleSelectPart = (part: SketchPart, opts: { shift: boolean }) => {
    touchRuleActivity();
    setSelectedSketchParts((cur) => {
      if (part.kind === 'corner') {
        // A corner selection is always solo; re-clicking the same one
        // clears it, the only way to dismiss the strip short of Escape
        // or clicking something else.
        return cur.length === 1 && cur[0].kind === 'corner' && cur[0].index === part.index
          ? [] : [part];
      }
      if (!opts.shift) {
        return cur.length === 1 && cur[0].kind === 'edge' && cur[0].index === part.index
          ? [] : [part];
      }
      const edges = cur.filter((p): p is SketchPart & { kind: 'edge' } => p.kind === 'edge');
      if (edges.some((p) => p.index === part.index)) {
        // Shift-clicking an already-selected edge removes it, same
        // toggle-within-a-multi-selection convention item E's 3D
        // multi-select already uses.
        return edges.filter((p) => p.index !== part.index);
      }
      // A pair rule only ever names two edges -- a third Shift-click drops
      // the older of the two rather than growing without bound.
      return [...edges.slice(-1), part];
    });
  };
  // Switching which feature the model tree has selected (a different
  // sketch, or none) makes any standing selection meaningless -- its
  // indices belong to whichever sketch's Rules panel was open when it was
  // made. Escape is the other way to clear it, for a student who wants the
  // strip gone without picking something else.
  useEffect(() => { setSelectedSketchParts([]); }, [selected]);
  // Item U: "Escape clears both" -- the canvas selection right here, AND
  // the Rules panel's OWN sticky "last touched" pink highlight, which
  // lives as SketchConstraints' own local state and is otherwise never
  // told a selection just ended. Goes through the same ref-backed proxy
  // its other three actions already do, so this reaches whichever sketch
  // is currently open without this file needing to know its shape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setSelectedSketchParts([]); ruleActionsProxy.clearTouch(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Item U: a panel row/cell commit (typing a length, pressing Level, a
  // pair rule, a pin) IS the canvas selection now, not a second state a
  // click has to separately catch up to -- round-6's own finding was an
  // edge left lit pink with no strip beside it, because "touched in the
  // panel" and "selected on the canvas" disagreed. `null` (Escape, or a
  // rule that removed itself) clears the selection the same way a plain
  // canvas click on nothing would.
  const handleTouch = (touched: TouchedPart | null) => {
    if (!touched) { setSelectedSketchParts([]); return; }
    setSelectedSketchParts(
      touched.kind === 'edge'
        ? touched.indices.map((index): SketchPart => ({ kind: 'edge', index }))
        : [{ kind: 'corner', index: touched.index }]
    );
  };
  const [rollbackIndex, setRollbackIndex] = useState<number | null>(null);
  const [drawTool, setDrawTool] = useState<'rect' | 'polygon' | null>(null);
  const [drawFirst, setDrawFirst] = useState<[number, number] | null>(null);
  const past = useRef<ModelDoc[]>([]);
  const future = useRef<ModelDoc[]>([]);
  const [depth, setDepth] = useState({ back: 0, forward: 0 });
  const [toolsHidden, setToolsHidden] = useState(false);
  const [cardHasContent, setCardHasContent] = useState(true);
  const [anchors, setAnchors] = useState<AnchorPoint[]>([]);
  const meshRef = useRef<MeshInput | null>(null);
  const [hasMesh, setHasMesh] = useState(false);
  // The live EngineAdapter instance, handed up by BrepViewport's own
  // onEngine prop -- see that prop's own comment. `engineKind` tracks which
  // kind is ACTUALLY active (not just the configured getEngineMode()): a
  // FreeCAD-refusal fallback can swap the live engine to OCCT mid-session,
  // and Save/Open need to gray out for that too, not just for a session that
  // started in 'occt' mode. Null until the viewport's first load finishes.
  const engineRef = useRef<EngineAdapter | null>(null);
  const [engineKind, setEngineKind] = useState<'occt' | 'freecad' | null>(null);
  const openInputRef = useRef<HTMLInputElement | null>(null);
  const pickAtRef = useRef<((clientX: number, clientY: number) => void) | null>(null);
  const specsRef = useRef<unknown[]>([]);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  const [scriptDoc, setScriptDoc] = useState<ModelDoc | null>(null);
  const [scriptNamedParams, setScriptNamedParams] = useState<ScriptParamRef[] | null>(null);
  const [scriptErrorMessage, setScriptErrorMessage] = useState<string | null>(null);
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
    if (drawTool) return [planeAnchor('xy', 0)];
    if (doc.features.length === 0) return [planeAnchor('xy', 0)];
    const picked = doc.features.filter((f) => selected.includes(f.id)).flatMap((f) => handlesFor(f, doc));
    const otherSketches = doc.features
      .filter((f): f is Feature & { kind: 'sketch' } =>
        f.kind === 'sketch' && !selected.includes(f.id) && sketchIsUnconsumed(doc, f.id))
      .flatMap((f) => handlesFor(f, doc));
    return [...picked, ...otherSketches];
  }, [build, doc, selected, drawTool]);

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

  const selectionLabel = useMemo(() => {
    if (selected.length === 0) return null;
    if (selected.length > 1) return `${selected.length} selected`;
    const id = selected[0];
    if (!doc.features.some((f) => f.id === id)) return null;
    const base = nameMap(doc)[id] ?? id;
    // Item E: "3 edges"/"2 faces" once a Shift-click multi-selection is two
    // or more deep on the currently selected solid -- ownerOf() filters out
    // anything a stray pick left pointing at a different solid, the same
    // guard round()'s multi-edge path applies before it builds anything.
    const edgesHere = pickedEdges.filter((e) => ownerOf(doc, e) === id);
    const facesHere = pickedFaces.filter((f) => ownerOf(doc, f) === id);
    // Item H (P20): a single picked edge/face carries its own kernel-
    // measured size as a third segment -- "Box 1 · top face · 40 x 40",
    // "Box 1 · edge · 20" -- but a multi-selection ("3 edges") has no one
    // size to show, so pickedSize is read only in the single-pick branches.
    const single = edgesHere.length <= 1 && facesHere.length <= 1;
    const part = edgesHere.length > 1
      ? `${edgesHere.length} edges`
      : facesHere.length > 1
        ? `${facesHere.length} faces`
        : pickedEdge && ownerOf(doc, pickedEdge) === id
          ? (partWordFor(pickedEdge.edge) ?? 'edge')
            + (single && typeof pickedSize === 'number' ? ` · ${pickedSize}` : '')
          : pickedFace && ownerOf(doc, pickedFace) === id
            ? (partWordFor(pickedFace.face) ?? 'face')
              + (single && Array.isArray(pickedSize) ? ` · ${pickedSize[0]} x ${pickedSize[1]}` : '')
            : null;
    return part ? `${base} · ${part}` : base;
  }, [selected, doc, pickedFace, pickedEdge, pickedEdges, pickedFaces, pickedSize]);

  const activeSketchPlane = useMemo<'xy' | 'xz' | 'yz' | null>(() => {
    if (drawTool) return 'xy';
    if (selected.length !== 1) return null;
    const f = doc.features.find((x) => x.id === selected[0]);
    return f && f.kind === 'sketch' ? (f.plane ?? 'xy') : null;
  }, [drawTool, selected, doc]);

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
            constraints: f.constraints ?? [],
            selected: selected.includes(f.id),
          };
        });
    },
    [doc, selected]
  );

  useEffect(() => {
    specsRef.current = specs;
    frameRef.current?.contentWindow?.postMessage(
      { source: 'reshape-set-anchors', anchors: specs },
      '*'
    );
    if (specs.length === 0) setAnchors([]);
  }, [specs]);

  useEffect(() => {
    if (!drawTool) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setDrawTool(null); setDrawFirst(null); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawTool]);

  function handlePlace(u: number, v: number) {
    if (drawTool === 'rect') {
      if (!drawFirst) { setDrawFirst([u, v]); return; }
      const f = newRectangleSketch(doc, 'xy', drawFirst, [u, v]);
      if (!f) return;
      applyDoc({ ...doc, features: [...doc.features, f] });
      setSelected([f.id]);
      setDrawTool(null);
      setDrawFirst(null);
    } else if (drawTool === 'polygon') {
      if (!drawFirst) { setDrawFirst([u, v]); return; }
      const f = newPolygonSketch(doc, 'xy', drawFirst, [u, v]);
      if (!f) return;
      applyDoc({ ...doc, features: [...doc.features, f] });
      setSelected([f.id]);
      setDrawTool(null);
      setDrawFirst(null);
    }
  }

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
      if (d?.type === 'brep-kernel-please') {
        const from = e.source;
        fetch(`${getKernelBaseUrl()}/replicad_single.wasm`)
          .then((r) => r.arrayBuffer())
          .then((bytes) => {
            (from as Window | null)?.postMessage({ type: 'brep-kernel-bytes', bytes }, '*', [bytes]);
          })
          .catch(() => { /* the runner falls back to its own network fetch */ });
        return;
      }
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
    setSelected([]);
    setPickedEdge(null);
    setPickedFace(null);
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

  // Save/Open .FCStd -- packages/kernel/src/engine-adapter.ts's own
  // saveDocument()/openDocument(), FreeCAD-only (see engineRef/engineKind's
  // own comment above for why the button grays out on OCCT rather than
  // failing after a click). Mirrors exportSTL()'s bytes-to-Blob download
  // pattern above; Open mirrors engine/play/studio.js's own hidden-
  // <input type="file"> pattern (retiring, but its Save/Open buttons are the
  // ones this replaces).
  function saveFCStd() {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      const bytes = engine.saveDocument(docRef.current);
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = exportFilename('FCStd');
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      window.alert(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 2D engineering drawing (front/top/right/iso on a titled sheet) --
  // packages/kernel/src/engine-adapter.ts's own exportDrawing(), FreeCAD-only
  // (OcctEngineAdapter throws "not supported"), same "disable, don't fail"
  // bar and Blob-download pattern as saveFCStd() above.
  function exportDrawing() {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      const bytes = engine.exportDrawing(docRef.current);
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = exportFilename('svg');
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      window.alert(`Could not export drawing: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function openFCStdClick() {
    openInputRef.current?.click();
  }

  async function openFCStdFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-opening the same file
    if (!file) return;
    const engine = engineRef.current;
    if (!engine) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // Null is a real, expected answer here -- see openDocument()'s own
      // doc comment -- not something to treat as a crash: a `.FCStd` this
      // app didn't save has no ModelDoc-shaped history to recover.
      const next = engine.openDocument(bytes);
      if (!next) {
        window.alert(`"${file.name}" wasn't created by this app's Save, so it can't be reopened here.`);
        return;
      }
      loadDoc(next);
      setSelected([]);
      setPickedEdge(null);
      setPickedFace(null);
      past.current = [];
      future.current = [];
      setDepth({ back: 0, forward: 0 });
    } catch (e) {
      window.alert(`Could not open "${file.name}": ${e instanceof Error ? e.message : String(e)}`);
    }
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

  return (
    <div
      className={
        'reshape-studio'
        + (build ? ' is-build' : '')
        + (build && toolsHidden ? ' is-tools-hidden' : '')
        + (build && !cardHasContent ? ' is-card-empty' : '')
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
          <button className="btn-run" onClick={run}>▶ Run</button>
        )}
        {build && canBuild && (
          <button style={chipStyle} onClick={clearModel}>
            <RotateCcw size={12} />
            Clear model
          </button>
        )}
        {build && (
          <>
            <button
              style={hasMesh ? chipStyle : { ...chipStyle, opacity: 0.35, cursor: 'not-allowed' }}
              onClick={exportSTL}
              disabled={!hasMesh}
              title={hasMesh ? 'Download the current model as an STL file' : 'Build a shape first'}
            >
              <Download size={12} />
              Export STL
            </button>
            <button
              style={hasMesh ? chipStyle : { ...chipStyle, opacity: 0.35, cursor: 'not-allowed' }}
              onClick={exportOBJ}
              disabled={!hasMesh}
              title={hasMesh ? 'Download the current model as an OBJ file' : 'Build a shape first'}
            >
              <Download size={12} />
              Export OBJ
            </button>
            <button
              style={hasMesh ? chipStyle : { ...chipStyle, opacity: 0.35, cursor: 'not-allowed' }}
              onClick={export3MF}
              disabled={!hasMesh}
              title={hasMesh ? 'Download the current model as a 3MF file' : 'Build a shape first'}
            >
              <Download size={12} />
              Export 3MF
            </button>
            {/* .FCStd is FreeCAD-native -- OcctEngineAdapter has no concept of
                it at all (see occt-engine-adapter.ts's own saveDocument()/
                openDocument()), so these gray out on the OCCT engine (or
                before the engine has loaded) rather than showing an error
                after a click, same "disable, don't fail" bar as the
                hasMesh-gated Export buttons above. */}
            <button
              style={engineKind === 'freecad' && hasMesh ? chipStyle : { ...chipStyle, opacity: 0.35, cursor: 'not-allowed' }}
              onClick={saveFCStd}
              disabled={!(engineKind === 'freecad' && hasMesh)}
              title={
                engineKind !== 'freecad'
                  ? 'Save/Open .FCStd needs the FreeCAD engine'
                  : hasMesh ? 'Download the current model as a FreeCAD .FCStd file' : 'Build a shape first'
              }
            >
              <Save size={12} />
              Save
            </button>
            <button
              style={engineKind === 'freecad' && hasMesh ? chipStyle : { ...chipStyle, opacity: 0.35, cursor: 'not-allowed' }}
              onClick={exportDrawing}
              disabled={!(engineKind === 'freecad' && hasMesh)}
              title={
                engineKind !== 'freecad'
                  ? 'Export Drawing needs the FreeCAD engine'
                  : hasMesh ? 'Download a 2D engineering drawing (SVG) of the current model' : 'Build a shape first'
              }
            >
              <FileText size={12} />
              Export Drawing
            </button>
            <button
              style={engineKind === 'freecad' ? chipStyle : { ...chipStyle, opacity: 0.35, cursor: 'not-allowed' }}
              onClick={openFCStdClick}
              disabled={engineKind !== 'freecad'}
              title={engineKind === 'freecad' ? 'Open a previously-saved .FCStd file' : 'Save/Open .FCStd needs the FreeCAD engine'}
            >
              <FolderOpen size={12} />
              Open
            </button>
            <input
              ref={openInputRef}
              type="file"
              accept=".FCStd,.fcstd"
              style={{ display: 'none' }}
              onChange={openFCStdFile}
            />
          </>
        )}
        {toolbarExtra}
      </div>

      <div className="reshape-studio-body">
        {build && (
          <div className="reshape-studio-tools">
            <ModelEditor
              doc={doc}
              onChange={applyDoc}
              selected={selected}
              onSelect={setSelected}
              rollbackIndex={rollbackIndex}
              onRollback={setRollbackIndex}
              onStartDraw={setDrawTool}
              drawTool={drawTool}
              hoveredPart={pointerHoverPart}
              onHoverPart={(p) => { setRowHoverPart(p); if (p) touchRuleActivity(); }}
              registerActions={(actions) => { ruleActionsRef.current = actions; }}
              onTouch={handleTouch}
              onUndo={undo}
              onRedo={redo}
              canUndo={depth.back > 0}
              canRedo={depth.forward > 0}
              historyGen={historyGen}
              collapsible
              onCollapsed={setToolsHidden}
              onContentChange={setCardHasContent}
              pickedEdge={pickedEdge}
              onClearPickedEdge={() => setPickedEdge(null)}
              pickedFace={pickedFace}
              onClearPickedFace={() => setPickedFace(null)}
              pickedEdges={pickedEdges}
              onClearPickedEdges={() => setPickedEdges([])}
              refusals={refusals}
            />
          </div>
        )}
        {!build && canCode && (
          <div className="reshape-studio-code">
            <CodeEditor />
          </div>
        )}

        <div className="reshape-pane">
          <div id="reshapeRules" className="reshape-pane-rules" aria-hidden={!build} />
          <div className="reshape-pane-view">
            {(showBrep || showBrepOnCode) ? (
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
                }}
                onPick={showBrep ? (p: ViewportPick | null) => {
                  if (!p) {
                    setSelected([]);
                    setPickedEdge(null);
                    setPickedFace(null);
                    setPickedEdges([]);
                    setPickedFaces([]);
                    setPickedSize(null);
                    return;
                  }
                  const owner = ownerOf(doc, p);
                  if (owner) setSelected([owner]);
                  setPickedEdge(p.kind === 'edge' ? { target: p.target, edge: p.name } : null);
                  setPickedFace(p.kind === 'face' ? { target: p.target, face: p.name } : null);
                  setPickedSize(p.size ?? null);
                  // Item E: an unnamed pick (nameEdgeOnCurrentShape/
                  // nameFaceOnCurrentShape honestly refused it -- see
                  // ViewportPick's own comment) cannot join a multi-select,
                  // since Round/Angled Corner need a real name to build
                  // from same as the single-edge path already does.
                  const shift = shiftHeldRef.current;
                  if (p.kind === 'edge' && p.name) {
                    const name = p.name;
                    setPickedEdges((prev) => {
                      const hit = shift && prev.some((e) => e.target === p.target && sameTopo(e.edge, name));
                      if (hit) return prev.filter((e) => !(e.target === p.target && sameTopo(e.edge, name)));
                      return shift ? [...prev, { target: p.target, edge: name }] : [{ target: p.target, edge: name }];
                    });
                    setPickedFaces([]);
                  } else if (p.kind === 'face' && p.name) {
                    const name = p.name;
                    setPickedFaces((prev) => {
                      const hit = shift && prev.some((e) => e.target === p.target && sameTopo(e.face, name));
                      if (hit) return prev.filter((e) => !(e.target === p.target && sameTopo(e.face, name)));
                      return shift ? [...prev, { target: p.target, face: name }] : [{ target: p.target, face: name }];
                    });
                    setPickedEdges([]);
                  } else {
                    setPickedEdges([]);
                    setPickedFaces([]);
                  }
                } : () => { /* Code's viewport is read-only: no ModelEditor here to act on a pick, and `selected`/`pickedEdge` are Build's own state, resolved against `doc`, not `scriptDoc` -- reusing them here would risk a stale/wrong-looking selection. */ }}
                pick={showBrep && pickedEdge?.edge ? { target: pickedEdge.target, name: pickedEdge.edge } : null}
                selectedCount={showBrep ? selected.length : 0}
                selectionLabel={showBrep ? selectionLabel : null}
                sketchPlane={activeSketchPlane}
                panelOcclusionPx={activeSketchPlane ? RULES_PANEL_WIDTH_PX : 0}
                anchors={specs}
                onAnchors={setAnchors}
                onMesh={(m) => {
                  meshRef.current = m;
                  setHasMesh(m !== null);
                }}
                onEngine={(engine, kind) => {
                  engineRef.current = engine;
                  setEngineKind(kind);
                }}
                registerPickAt={(fn) => { pickAtRef.current = fn; }}
              />
            ) : (
              <ReshapePreview
                ref={frameRef}
                code={code}
                runKey={runKey}
                engine="script"
              />
            )}
            {wantsHydrationShadow && (
              // Never shown -- see wantsHydrationShadow's own comment. Its
              // only job is to run `code` through the sandbox on mount so
              // `doc` can be hydrated from `value` while the visible pane
              // above is the B-rep viewport, not an iframe. The wrapper is
              // load-bearing, not decorative: ReshapePreview's OWN "nothing
              // to run yet" placeholder (runKey still 0 -- always true here
              // when autoRunOnMount is off, e.g. the sandbox) is an ordinary
              // visible <div>, not styled hidden the way its iframe is, and
              // painted straight into this pane over the B-rep canvas.
              <div style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
                <ReshapePreview ref={frameRef} code={code} runKey={runKey} engine="script" />
              </div>
            )}
            {build && (
              <HandleOverlay
                points={anchors}
                values={paramValues}
                scales={scales}
                onDrag={(param, val) => { sendParams({ [param]: val }); touchRuleActivity(); }}
                onCommit={() => { commitParams(); touchRuleActivity(); }}
                onTap={(x, y) => pickAtRef.current?.(x, y)}
                outlines={outlines}
                drawing={drawTool ?? false}
                onPlace={handlePlace}
                onHoverPart={setPointerHoverPart}
                forcedHoverPart={rowHoverPart}
                selectedParts={selectedSketchParts}
                onSelectPart={handleSelectPart}
                ruleActions={ruleActionsProxy}
                bottomInset={TIMELINE_HEIGHT_PX}
              />
            )}
          </div>
          {(runKey > 0 || build) && (
            <aside className="reshape-pane-params">
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

      <style>{`
        .reshape-studio {
          display: flex;
          flex-direction: column;
          flex: 1 1 auto;
          width: 100%;
          min-width: 0;
          height: 100%;
          min-height: 0;
          position: relative;
        }
        .reshape-studio-toolbar {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 0 0 auto;
          padding: 4px 0 8px;
        }
        /* Build: the toolbar floats over the canvas instead of taking its own
           row -- the ribbon (ModelEditor's shape tools, portaled into
           #reshapeRibbon below), Reset/Export/Full-screen (toolbarExtra) all
           read as one strip directly under the site nav, Onshape-style. This
           is the exact chrome the parity loop's blind rounds were judged
           against (scratchpad/parity/ours-r5/3d/*.png) -- restored here
           after a plainer flex layout regressed it (SPEC-A1 rework 1). */
        .reshape-studio.is-build .reshape-studio-toolbar {
          position: absolute;
          left: 0;
          right: 0;
          top: 0;
          z-index: 50;
          padding: 4px 10px;
          background: transparent;
        }
        /* The one flexible child: it, not the mode toggle or the Reset/
           Export chips either side of it, gives way (scrolling its own
           tool icons) if the row is ever too narrow for all of it -- see
           the flex-shrink:0 on .sandbox-modes and button[style] below.
           Measured 2026-09-04: without this "Build" clipped to "Buil" at
           1440px, .sandbox-modes shrinking along with everything else. */
        .reshape-studio-ribbon { flex: 1 1 auto; min-width: 0; overflow-x: auto; display: flex; align-items: center; }
        .reshape-studio-ribbon .model-tools { height: 34px; background: transparent; border-bottom: 0; }
        .sandbox-modes {
          display: inline-flex;
          flex-shrink: 0;
          border: 1px solid #44475a;
          border-radius: 4px;
          overflow: hidden;
        }
        .sandbox-mode {
          padding: 6px 13px;
          background: transparent;
          color: #6272a4;
          border: 0;
          border-right: 1px solid #44475a;
          cursor: pointer;
          font-size: 13px;
        }
        .sandbox-mode:last-child { border-right: 0; }
        .sandbox-mode:hover { color: var(--text); }
        .sandbox-mode.is-active { background: #44475a; color: #f8f8f2; }
        /* The mode toggle and Reset/Export chips lose their chip borders and
           read as flat ribbon buttons, same as the pre-extraction sandbox. */
        .reshape-studio.is-build .sandbox-modes { border: 0; background: transparent; }
        .reshape-studio.is-build .sandbox-mode { border-right: 0; color: #d3d5e3; }
        .reshape-studio.is-build .sandbox-mode.is-active { background: #44475a; color: #f8f8f2; }
        .reshape-studio.is-build .sandbox-mode:hover { color: #f8f8f2; }
        .reshape-studio.is-build .reshape-studio-toolbar button[style] {
          border: 0 !important;
          color: #d3d5e3;
          flex-shrink: 0;
        }
        .reshape-studio-body {
          display: flex;
          flex: 1 1 auto;
          min-height: 0;
          gap: 8px;
          position: relative;
        }
        /* Build: the tool card floats over the canvas at the left edge
           instead of sharing the row with it -- see #editorPane's own
           history in the pre-extraction SandboxWorkspace for the exact
           numbers this restores (measured against Playwright screenshots,
           not guessed). */
        .reshape-studio.is-build .reshape-studio-tools {
          position: absolute;
          left: 12px;
          top: 48px;
          bottom: 12px;
          height: auto;
          width: min(420px, 45%);
          z-index: 40;
          background: var(--card);
          border: 1px solid #565a70;
          border-radius: 6px;
          box-shadow: 0 12px 36px rgba(0,0,0,0.6);
          overflow: hidden;
        }
        /* Collapsed by the student (is-tools-hidden) or empty on its own
           (is-card-empty, e.g. no note and no docked sketch rules -- the
           feature LIST lives in the bottom timeline, not this card) --
           either way it shrinks to a rail rather than an empty box over the
           canvas. Only is-card-empty also pulls the timeline's own left
           edge in (below); a MANUAL collapse leaves room in case the
           student reopens it. */
        .reshape-studio.is-tools-hidden .reshape-studio-tools,
        .reshape-studio.is-card-empty .reshape-studio-tools {
          width: 46px;
          box-shadow: none;
          background: rgba(40, 42, 54, 0.72);
        }
        .reshape-studio-tools {
          min-width: 0;
          overflow-y: auto;
          border: 1px solid var(--border);
          border-radius: 4px;
          background: var(--card);
        }
        .reshape-studio-tools .model-tools { display: none; }
        .reshape-studio-code {
          flex: 1 1 40%;
          min-width: 0;
          display: flex;
          border: 1px solid var(--border);
          border-radius: 4px;
          overflow: hidden;
        }
        .reshape-pane { flex: 1 1 auto; min-width: 0; display: flex; position: relative; }
        .reshape-pane-rules:empty { display: none; }
        .reshape-pane-rules:not(:empty) {
          flex: 0 0 ${RULES_PANEL_WIDTH_PX}px;
          min-width: 0;
          overflow-y: auto;
          border-right: 1px solid var(--border);
          background: var(--card);
        }
        /* Clears the floating ribbon and stops short of the timeline, the
           same offsets #reshapeRules used pre-extraction. */
        /* margin-left below also clears the floating tools card SIDEWAYS,
           the one dimension the comment above never covered:
           .reshape-studio-tools is position:absolute and z-index:40, so
           it visually and interactively sits ON TOP of whatever the
           (position:relative, z-index:auto) rules pane draws underneath
           it, even at its collapsed 46px rail width -- a real mouse click
           at a "Rules between two edges" cell within that band lands on
           the rail's own div instead (measured 2026-09-04, S08/S12: a
           click at the button's own live getBoundingClientRect() center
           resolved via document.elementFromPoint to .model-editor inside
           .reshape-studio-tools, not the button). The timeline strip below
           already dodges the same card this way; the rules pane never got
           the equivalent margin.
           NB: no backticks in this comment -- this whole block is a
           template literal, and a backtick here closes it early, which is
           exactly what broke this file the first time this comment was
           written. */
        .reshape-studio.is-build .reshape-pane-rules:not(:empty) {
          margin-top: 48px;
          height: calc(100% - 48px - ${TIMELINE_HEIGHT_PX}px);
          margin-left: calc(min(420px, 45%) + 24px);
        }
        .reshape-studio.is-build.is-card-empty .reshape-pane-rules:not(:empty) {
          margin-left: 66px;
        }
        .reshape-pane-view { flex: 1 1 auto; min-width: 0; display: flex; position: relative; }
        .reshape-pane-view .reshape-frame, .reshape-pane-view .reshape-empty { flex: 1; }
        /* Reserves the timeline strip's own height so the render surface
           (and the handle overlay, via its own bottomInset prop) end above
           it instead of underneath it. */
        .reshape-studio.is-build .reshape-pane-view { padding-bottom: ${TIMELINE_HEIGHT_PX}px; }
        .reshape-pane-params {
          flex: 0 0 208px;
          min-width: 0;
          border-left: 1px solid var(--border);
          background: var(--card);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .reshape-studio.is-build .reshape-pane-params { margin-top: 48px; }
        .reshape-studio-timeline {
          position: absolute;
          bottom: 0;
          height: ${TIMELINE_HEIGHT_PX}px;
          display: flex;
          align-items: stretch;
          background: rgba(40, 42, 54, 0.88);
          border-top: 1px solid #44475a;
          border-radius: 0 0 4px 4px;
        }
        .reshape-studio.is-build .reshape-studio-timeline {
          left: calc(min(420px, 45%) + 24px);
          right: 220px;
        }
        .reshape-studio.is-build.is-card-empty .reshape-studio-timeline { left: 66px; }
        .reshape-studio-timeline.is-hidden { display: none; }
        .reshape-studio-timeline .model-timeline { flex: 1 1 auto; min-width: 0; }
      `}</style>
    </div>
  );
}
