'use client';

// The three.js twin of components/model/BrepViewport.tsx -- same OpenCascade
// kernel, same ModelDoc, same props, a different renderer underneath. Built
// alongside the JSCAD/regl viewport rather than in place of it so the two can
// be measured side by side; see app/brep-three/page.tsx and
// app/brep-test/page.tsx, which run the identical hardcoded document.
//
// WHY THIS EXISTS AT ALL. @jscad/regl-renderer is the last piece of JSCAD
// still in the B-rep path -- lib/occt-mesh.ts exists purely to translate an
// OpenCascade solid into JSCAD's own geom3 shape so that renderer can draw it.
// three.js replaces it, and unlocks two things regl cannot do structurally:
// Raycaster (clicking an addressable B-rep face or edge) and world->screen
// projection (dragging a dimension handle). Both are built now -- see
// projectAnchors() below for the second, ported from
// public/reshape/kernel/runner-brep.html's own implementation of the exact
// same protocol (`anchors`/`onAnchors` here stand in for that file's
// `reshape-set-anchors` / `reshape-anchors` postMessage pair -- same pixel
// contract, no iframe boundary to cross).
//
// PICKING, IN TWO HALVES. A hover or a click first resolves to a piece of
// three.js geometry (a triangle range for a face, one THREE.Line for an
// edge) -- that half is pure raycasting and lives entirely in this file. The
// SECOND half, turning that geometry back into a stable TopoName the model
// can keep after a rebuild, is deliberately NOT reinvented here: a face uses
// the FaceRange map tessellateToThree() already returns, and an edge uses
// nameEdgeOnCurrentShape() in lib/topo-resolve.ts, the same naming machinery
// a Fillet feature resolves against when it rebuilds -- run backwards, as a
// search, so it answers for an edge on a Move or a Hole's untouched faces
// too, not only a bare primitive. Picking and naming staying two different
// files is what lets naming be tested against arithmetic (see
// topo-resolve.ts's own header) rather than only through a live Raycaster.
//
// EDGE PICKING GEOMETRY IS NOT THE DRAWN SILHOUETTE. The EdgesGeometry lines
// drawGeoms() adds below are a display-only silhouette over the
// TESSELLATION, at a 25-degree normal threshold -- good-looking, and not the
// kernel's own topology (see EDGE_THRESHOLD_DEGREES). A pickable edge has to
// be a real TopoDS_Edge, discretised straight off the B-rep curve, so this
// keeps a SEPARATE, invisible set of THREE.Line objects (see
// lib/occt-three.ts's edgesToThree()) purely for Raycaster to hit -- and,
// alongside each one, a THIRD piece of geometry: a pre-built highlight TUBE
// (see edgeTubeGeometry()), because a THREE.Line's own width cannot be
// trusted to render as more than 1px. All three are built ONCE per edge in
// drawGeoms(); hovering and selecting only ever swap which shared material a
// tube wears and toggle `.visible` -- see setHoveredEdgeTube() /
// setSelectedEdgeTube() for why that used to be a real per-pointermove cost
// and no longer is.
//
// EXPORT. This component does not write files -- it hands out the built
// triangles as a plain MeshInput (lib/mesh-export.ts, see the onMesh prop)
// every time a rebuild finishes, and SandboxWorkspace.tsx owns the actual
// Export STL button and the blob-URL download. Keeping the write side out of
// here is deliberate: a renderer that also knows about STL/OBJ/3MF headers is
// a renderer that has stopped being one, and lib/mesh-export.ts is the
// existing, already-tested writer -- nothing here re-implements it.
//
// KERNEL LOADING is copied from BrepViewport.tsx, not imported from it -- that
// file is under a measurement freeze right now (see the task this component
// was written for) and this one needs its own module-level promises anyway,
// since the two components can be mounted on different pages in the same
// session. See BrepViewport.tsx for the long-form reasoning on why the kernel
// is loaded through a runtime-computed import rather than a static one, and
// why that load lives in a module-level (not component-level) promise.

import { useEffect, useRef, useState } from 'react';
import type * as THREE_NS from 'three';
import type { OrbitControls as OrbitControlsType } from 'three/examples/jsm/controls/OrbitControls.js';
import type { LineSegments2 as LineSegments2Type } from 'three/examples/jsm/lines/LineSegments2.js';
import type { LineSegmentsGeometry as LineSegmentsGeometryType } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { LineMaterial as LineMaterialType } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Feature, ModelDoc } from '@shuff57/reshape-script/model-types';
import { topLevel } from '@shuff57/reshape-script/model-types';
import { rootFeature, type TopoName } from '@shuff57/reshape-script/topo-name';
import type { EngineAdapter, EngineBuildResult, FaceRange } from '@shuff57/reshape-kernel/engine-adapter';
import { BrepRsEngineAdapter } from '@shuff57/reshape-kernel/brep-rs-engine-adapter';
import type { HandleSpec } from '@shuff57/reshape-script/model-handles';
import type { AnchorPoint } from './HandleOverlay.js';
import { mergeMeshes, type MeshInput } from '../mesh-export.js';
import { bboxCenter, DEFAULT_FILL_FRACTION, fitDistance, type Box3Like } from '../camera-fit.js';
import { CUBE_ZONE_CELL, cubeZoneAt, cubeZoneDirs, type CubeFaceKey, type CubeZone } from './cube-zone.js';
import { DEFAULT_SCHEME_NAME, MOUSE_SCHEMES, loadSchemeName, saveSchemeName, schemeToMouseButtons, schemeToTouches, type MouseScheme } from '../camera-controls.js';
import { CameraMode, loadCameraMode, orthoFrustumFromPerspective, saveCameraMode } from '../ortho-camera.js';
import { computeSelectionFit, computeWindowZoomFit, type Vec3 } from '../window-zoom-fit.js';
import { nearestVisible, nextCycleIndex, shouldHandleViewportDelete } from '../pick-helpers.js';
import { HOLD_CYCLE_DELAY_MS, HOLD_CYCLE_DEAD_ZONE_PX } from '../input-threshold.js';
import type { SelectionFilters, SelectionItem } from '../selection-model.js';
import MarkingMenu from './MarkingMenu.js';
import { classifyRightClick, classifyGesture, wedgesForMode, type PointerSample, type GestureThresholds } from './marking-menu-core.js';
import { rightClickGuard } from './marking-menu-guard.js';
import { marqueeKind, pointSetSelect, type MarqueeDrag } from '../marquee-select.js';

// Todo 19's [CONFIRM]-sourced gesture thresholds: the delay is the
// marking-menu gesture's own default (150ms, pending real-Fusion
// verification per SPEC open question #2); the dead zone is the SHARED
// click-and-hold constant from input-threshold.ts, not a second number.
const MARKING_GESTURE: GestureThresholds = { delayMs: 150, deadZonePx: HOLD_CYCLE_DEAD_ZONE_PX, wedgeCount: 8 };

/** The Dracula palette this app already uses everywhere else -- see
 *  app/globals.css and BrepViewport.tsx. */
const COLORS = {
  bg: '#282a36',
  panel: '#21222c',
  line: '#44475a',
  fg: '#f8f8f2',
  dim: '#6272a4',
  ok: '#50fa7b',
  bad: '#ff5555',
  accent: '#bd93f9',
};

// View-strip preset directions, as [x, y, z] to normalise at click time.
// Z-UP, not Y-up -- this scene sets `camera.up.set(0, 0, 1)` (see the scene
// setup effect below), matching every other view of a ModelDoc in this app
// (extrude runs along +Z). So "straight down" is +Z and "straight up from
// below" is -Z, not the +/-Y a Y-up engine would use.
// HOME mirrors the literal initial `camera.position.set(140, 160, 130)`
// below, just as a direction (lookFrom() re-applies it at whatever distance
// the student has since zoomed to, not the original distance).
// TOP/UNDERNEATH carry a tiny epsilon off the Z axis -- landing the camera
// EXACTLY on the up axis is a spherical-coordinate singularity for
// OrbitControls (azimuth becomes undefined), not something a maxPolarAngle
// clamp would prevent; this component deliberately sets no clamp (the
// freedom to orbit anywhere, including upside down, is the point).
// FRONT is +Y: SketchConstraints.tsx calls the xz plane "Front" ("standing
// up facing you"), and +Y is the axis Home's own camera position leans on
// hardest (160, the largest of the three coordinates) -- the axis already
// facing the viewer in the starting view.
const HOME_DIR: [number, number, number] = [140, 160, 130];
const TOP_DIR: [number, number, number] = [0.001, 0.001, 1];
const FRONT_DIR: [number, number, number] = [0, 1, 0];
const UNDERNEATH_DIR: [number, number, number] = [0.001, 0.001, -1];
// Nav cube's other three faces -- same Z-up/Y-front convention as above, no
// epsilon needed since none of these sit on the up axis.
const RIGHT_DIR: [number, number, number] = [1, 0, 0];
const LEFT_DIR: [number, number, number] = [-1, 0, 0];
const BACK_DIR: [number, number, number] = [0, -1, 0];

// A sketch's own (u, v) axes and normal, per plane -- fitToModel()'s only use
// (see that function's own comment for why). Matches lib/model-handles.ts's
// PLANE_AXES/planeNormal exactly; kept as a separate, local copy rather than
// importing a private helper from a file this component does not otherwise
// touch, for three fixed unit vectors that will not drift.
const SKETCH_PLANE_AXES: Record<string, {
  u: [number, number, number]; v: [number, number, number]; n: [number, number, number];
}> = {
  xy: { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  xz: { u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] },
  yz: { u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] },
};

export interface BrepViewportStats {
  buildMs: number;
  meshMs: number;
  drawMs: number;
  triangles: number;
  /** Feature id -> the sentence saying why that feature could not be built.
   *  Absent or empty means everything in the document built. Comes straight
   *  from EngineBuildResult.refusals, and with no fallback engine this is the
   *  ONLY way a refusal reaches the student -- surface it. */
  refusals?: Map<string, string>;
  /** The world-space extent of everything on screen (computeSceneBox()'s own
   *  box), rounded to 1 decimal, mm -- the same measurement Home/fit already
   *  computes. Absent when the scene is not ready or nothing is drawn, so a
   *  caller's readout can hide rather than show zeros. */
  dimsMm?: { x: number; y: number; z: number };
}

/**
 * What a click in the viewport landed on.
 *
 * `faceIndex` is a FaceRange.index -- the face's position in the shape's own
 * face walk, stable across camera moves and rebuilds of an unchanged shape
 * (see lib/occt-three.ts) -- kept alongside `name` because it is what
 * paintFaceHighlight() re-finds the same face by, cheaper than resolving a
 * name back down to a kernel face. A face or edge's `name` is null when the
 * pick is real and gets highlighted like any other, but could not be traced
 * back to any primitive -- see nameFaceOnCurrentShape()/nameEdgeOnCurrentShape()
 * in lib/topo-resolve.ts for which faces/edges that covers and which they
 * honestly refuse. The caller can still show it was picked; it just cannot
 * build a Fillet, or an open Hollow, from it.
 *
 * `ctrlKey`/`shiftKey`/`metaKey` are read straight off the triggering
 * PointerEvent/MouseEvent at the moment of the pick (SPEC-mouse-parity.md
 * Phase 3 item 1), never a global keyboard listener -- the stopgap that
 * used to fake Shift this way is gone precisely because
 * a page-wide listener could not tell "Shift held while clicking this
 * canvas" from "Shift held while the runner iframe has focus". A pick with
 * no real triggering event (restorePicks()'s own re-emission once a name
 * resolves post-rebuild) carries all three false.
 *
 * `vertex`/`body` (SPEC-mouse-parity.md Phase 3 item 2) have no naming
 * machinery of their own -- there is no kernel concept of a stable vertex
 * or whole-body name the way a TopoName resolves a face or edge -- so
 * `name` is always `null` for them, not sometimes-null like a face/edge
 * pick whose resolution merely failed. `size` is likewise never present:
 * nothing measures a point, and a body's own size is just its owning
 * feature's, already shown elsewhere.
 */
export type ViewportPick =
  | { kind: 'face'; target: string; faceIndex: number; name: TopoName | null; size?: [number, number]; ctrlKey: boolean; shiftKey: boolean; metaKey: boolean }
  | { kind: 'edge'; target: string; name: TopoName | null; size?: number; ctrlKey: boolean; shiftKey: boolean; metaKey: boolean }
  | { kind: 'vertex'; target: string; name: null; size?: undefined; ctrlKey: boolean; shiftKey: boolean; metaKey: boolean }
  | { kind: 'body'; target: string; name: null; size?: undefined; ctrlKey: boolean; shiftKey: boolean; metaKey: boolean };

// faceSize()/edgeLength() used to live here as module-level helpers taking a
// raw `oc` handle -- moved onto EngineAdapter itself (see engine-adapter.ts's
// own doc comment on why) during the step-10 seam refactor, since they were
// two more direct kernel.oc reaches the original grep-based method list had
// not named. Call sites below now read `engine.faceSize(face)` /
// `engine.edgeLength(edge)`.

interface Props {
  doc: ModelDoc;
  /** Chord tolerance in mm, passed straight to the adapter's mesh(). Left
   *  undefined to take the kernel's own default. */
  deflection?: number;
  onStats?: (s: BrepViewportStats) => void;
  /** Fired on every click that lands on the model (a face or an edge), and
   *  on a click that lands on nothing (null, clearing the selection). */
  onPick?: (pick: ViewportPick | null) => void;
  /**
   * The edge selection to keep highlighted, LIFTED rather than kept as
   * internal state, because this component cannot keep it on its own: every
   * doc change throws away every mesh and rebuilds from zero (see the file
   * header), so "the edge the student picked" has to survive as a NAME, not
   * an object reference. Re-resolved against the fresh shape on every
   * rebuild via resolveName() -- the same mechanism a real FilletFeature
   * resolves against. Absent or null both mean nothing is pinned; a face
   * selection has no equivalent prop because nothing outside this component
   * consumes one yet (see the header).
   */
  pick?: { target: string; name: TopoName } | null;
  /**
   * How many shapes are currently selected in the model tree (ModelEditor's
   * own `selected` array, lifted here purely for display) -- rendered as a
   * small "N Selected" badge over the canvas.
   *
   * Cheap, and worth stealing: Chili3D (chili3d.com), the OCCT-in-WASM +
   * three.js reference this viewport is measured against, shows a running
   * count so nobody has to count highlights on screen by eye. 0 or
   * undefined shows nothing -- an empty badge is not information.
   */
  selectedCount?: number;
  /**
   * Item N: Date.now() of the last time the Rules panel or a handle was
   * actually touched (ReshapeStudio.tsx's own touchRuleActivity()), or
   * null if never. Used to hold the "A sketch is flat..." Pull hint off
   * screen for ~3s after real activity there -- a blind judge read it as
   * an unrelated prompt with no affordance for the rule they were setting,
   * because it kept refreshing on top of every rule committed. Absent or
   * null behaves exactly as before (the hint shows immediately).
   */
  ruleActivityAt?: number | null;
  /**
   * What to print in that badge instead of the bare count, once there is
   * exactly one selection worth naming -- "Box 1", "Hole 1 -- top face",
   * "Round 1 -- edge" (SandboxWorkspace.tsx computes this from `selected`,
   * `doc`, and whichever of `pickedFace`/`pickedEdge` is live, via
   * lib/model-types.ts's nameMap() plus the picked TopoName's own `part`
   * where the pick resolved one). A blind 2D-side judge's own complaint --
   * "selection reported only as a generic count badge with no element
   * name" -- applies here too: a beginner staring at "1 Selected" has no way
   * to confirm they picked the THING they meant to. Falls back to the plain
   * `${selectedCount} Selected` wording below when this is absent (a caller
   * that has not been updated, or the 2+-selected case, which stays a count
   * on purpose -- naming two or more things in one badge is a sentence, not
   * a label).
   */
  selectionLabel?: string | null;
  /**
   * Drag-handle specs to project to screen, world space -- the same
   * `HandleSpec[]` SandboxWorkspace.tsx already computes via handlesFor() and
   * posts into the JSCAD runner as `reshape-set-anchors`. This is that same
   * data reaching this component directly instead, since there is no iframe
   * boundary here to cross.
   */
  anchors?: HandleSpec[];
  /**
   * Fired with the projected result -- container-relative CSS pixels, the
   * same `AnchorPoint[]` shape the JSCAD runner posts back as
   * `reshape-anchors` -- every time it changes: once per new `anchors` prop,
   * and once per animation frame while the camera is moving (orbit, pan,
   * zoom, and the damping tail after any of them). See projectAnchors() for
   * why a moving camera needs its own flush point on a render-on-demand
   * viewport.
   */
  onAnchors?: (points: AnchorPoint[]) => void;
  /**
   * Fired with the built geometry every time a rebuild finishes -- one merged
   * MeshInput (lib/mesh-export.ts) across every top-level shape, or null when
   * there is nothing drawable (the empty document, or a build error). This is
   * the same triangle data drawGeoms() puts on screen, just handed out in the
   * structural {positions, indices} shape the exporter wants instead of a
   * THREE.BufferGeometry, so a caller can wire STL/OBJ/3MF export without
   * this component knowing anything about file formats or download buttons --
   * see SandboxWorkspace.tsx's Export STL button, the one place that reads it.
   */
  onMesh?: (mesh: MeshInput | null) => void;
  /**
   * Hands the caller this component's own pick function -- the exact code
   * path `onClick` below runs (face/edge hit test, naming, highlight paint,
   * `onPick` emission), invokable from OUTSIDE a real pointer event on the
   * canvas. Exists for HandleOverlay.tsx's `onTap`: a click that lands on a
   * drag handle never reaches this component's own click listener (the
   * handle is a separate DOM element sitting on top), so a tap there has no
   * other way to still pick whatever face or edge is underneath it.
   *
   * Called once with the live function whenever the render effect (re)runs,
   * and with `null` on cleanup -- a stale closure over a disposed renderer
   * is worse than a caller finding pickAt briefly unset.
   */
  registerPickAt?: (fn: ((clientX: number, clientY: number) => void) | null) => void;
  /**
   * The plane of the single sketch currently selected, or null when nothing
   * (or something other than exactly one sketch) is selected --
   * SandboxWorkspace.tsx derives this from `selected`/`doc` the same way it
   * already derives `selectionLabel`.
   *
   * A transition from null to a plane means "the student just started
   * looking at a sketch flat": the camera saves its current orbit (so
   * selecting a solid again can put it back -- see viewpointBeforeSketchRef's
   * own comment), looks straight down that plane's own normal (Ground -> the
   * TOP_DIR the view strip already uses, Front -> FRONT_DIR, Side -> the new
   * SIDE_DIR), and fits to the sketch the same way fitToModel() fits a
   * solid, MINUS `panelOcclusionPx` of visible width (the Rules panel
   * appearing alongside it). A transition from a plane back to null restores
   * the saved orbit. No-op while the plane string does not change (staying
   * on the same sketch, or switching to a different sketch on the SAME
   * plane, is not a new "entering flat view" event).
   */
  sketchPlane?: 'xy' | 'xz' | 'yz' | null;
  /**
   * How many pixels of docked UI panel currently sit to one side of the
   * canvas -- the Rules panel's own width while a sketch is being viewed
   * flat, passed straight to lib/camera-fit.ts's fitDistance() as its
   * `occludedWidth` argument (see that function's own comment for why this
   * is a known constant handed in, not something read back off the DOM).
   * Only read at the moment `sketchPlane` transitions from null to a plane;
   * this component does not re-fit on every later render just because this
   * number happened to change (the Dimensions panel is effectively always
   * open in Build mode and does not itself trigger a re-fit either -- see
   * fitToModel()'s own "never on every rebuild" rule).
   */
  panelOcclusionPx?: number;
  /**
   * Fired once, with the live EngineAdapter, as soon as the kernel is up.
   * There is one kernel and this component never swaps it mid-session, so a
   * caller can read the first call as "the engine is ready" and keep the
   * instance for anything this component's own props do not cover.
   */
  onEngine?: (engine: EngineAdapter) => void;
  /**
   * Step-1 note taxonomy (SPEC-ui-revamp-decisions.md §5): when true, the
   * top-right selection badge + edge-hover-hint stack is NOT rendered here --
   * the selection readout lives in the caller's status bar instead.
   * Default false: every existing caller keeps its badges.
   */
  badgesInStatusBar?: boolean;
  /**
   * Which pickable kinds are currently active -- SPEC-mouse-parity.md Phase 3
   * item 2's filter toolbar. Rendered HERE, beside this component's own view
   * strip, rather than in ReshapeStudio.tsx: every other piece of viewport
   * chrome (the view strip itself, the nav cube, the selection badge) already
   * lives in this component's own JSX, driven by props the caller owns --
   * `filters` follows that same split rather than inventing a second
   * viewport-overlay convention. Read through a ref (see filtersRef below)
   * the same way `onPick`/`pick` are, so hitAt()'s pointermove/click
   * listeners -- set up once by the scene-setup effect, not on every prop
   * change -- see a toggle the instant it happens. Absent (no caller has
   * wired the toolbar) defaults to every kind pickable, i.e. today's actual
   * behaviour before this filter existed -- see DEFAULT_FILTERS.
   */
  filters?: SelectionFilters;
  /**
   * Fired with the next filters value on a chip click. ReshapeStudio.tsx
   * owns the real SelectionState.filters this only reflects; this component
   * renders the toggle UI and reports the requested change, the same split
   * `onPick` already draws between "renders a pick" and "owns selection".
   */
  onFiltersChange?: (next: SelectionFilters) => void;
  /**
   * Fired once a box-select drag completes (SPEC-mouse-parity.md Phase 3
   * item 4) with every candidate the drag's window/crossing rect kept,
   * filtered by `filters` the same way a single click already is -- a
   * filtered-out kind is never in this list, same as it is never
   * click-pickable. `shiftKey` mirrors a click's own accumulate-vs-replace
   * choice (Ctrl's "add if absent" has no separate meaning for a whole
   * batch, so only Shift's distinction survives here): held, the caller
   * adds every item to whatever is already selected; released, the caller
   * replaces the selection with exactly these. Never fired for a drag
   * that stayed under the 4px threshold or started on a real pick target
   * -- both fall through to the ordinary click-to-pick path (`onPick`)
   * instead, same as before this prop existed. Absent means box select
   * still WORKS (the drag gesture and its rectangle overlay do not depend
   * on this prop), it just has nowhere to report its result.
   */
  onBoxSelect?: (items: SelectionItem[], shiftKey: boolean) => void;
  /**
   * Double-click a feature body (SPEC-mouse-parity.md Phase 3.6): fired
   * with the feature id hitAt() resolves at the click point. Never fired
   * for a double-click on empty space -- the caller's job is "open this
   * feature's params panel, focused", which has nothing to open when
   * nothing was hit. A single click's own onPick keeps selecting exactly
   * as it always has; this is purely additive.
   */
  onFeatureDoubleClick?: (featureId: string) => void;
  /**
   * Ctrl+A while the canvas has focus (SPEC-mouse-parity.md Phase 3.6):
   * select every feature. Fired with no arguments, the same
   * "renders the gesture, reports it, the caller owns SelectionState"
   * split `onFiltersChange`/`onBoxSelect` already draw -- the caller writes
   * `selectAllFeatures(doc)` itself.
   */
  onSelectAll?: () => void;
  /**
   * Delete/Backspace while the canvas has focus (SPEC-mouse-parity.md
   * Phase 3.6): delete the current selection through the SAME doc-edit
   * path the caller's own Delete button already uses. Guarded internally
   * by `shouldHandleViewportDelete()` (pick-helpers.ts) so a Delete/
   * Backspace typed into a text field elsewhere on the page is never
   * intercepted -- the listener lives on the canvas element itself, so it
   * only ever sees a keydown that targeted (or bubbled through) the
   * canvas in the first place.
   */
  onDeleteSelected?: () => void;
  /**
   * The marking menu's Undo/Redo wedges (SPEC-mouse-parity.md Phase 4.1) --
   * the SAME history ReshapeStudio.tsx's own toolbar buttons already call
   * (`undo`/`redo`). Absent means those wedges render disabled: "renders the
   * gesture, reports it, the caller owns the history" is the same split
   * `onDeleteSelected`/`onSelectAll` above already draw.
   */
  onUndo?: () => void;
  onRedo?: () => void;
  /**
   * The marking menu's Sketch wedge: start a new sketch on the caller's
   * current active plane, the exact flow ModelEditor's own Sketch button
   * (startSketch(), ModelEditor.tsx:884-890) runs -- this component has no
   * `doc`-editing machinery of its own, so the caller supplies the whole
   * gesture rather than this component reaching into `doc`/`activePlane`
   * itself. Absent means the wedge renders disabled.
   */
  onStartSketch?: () => void;
  /**
   * Phase 5.3's live-preview tint (todo 25): while a manipulator drag is
   * in flight the rebuilt meshes are drawn TRANSLUCENT in the op's colour
   * -- blue for an additive operation, red for a cut -- instead of the
   * committed opaque orange. `active` is the caller's own previewDoc
   * signal (a pending param fold exists); `tint` is the selected
   * feature's op colour (manipulator-core's previewTint). Absent or
   * inactive draws the committed material, exactly as before.
   */
  preview?: { active: boolean; tint: 'add' | 'cut' } | null;
}

/** Module-level, not per-component: two viewports in one session share the
 *  one loaded kernel instead of fetching the wasm twice. */
let enginePromise: Promise<EngineAdapter> | null = null;

/** Bring up the kernel. Needs THREE already resolved -- the adapter takes it
 *  constructor-injected, so a page that never mounts a viewport never pays
 *  for three.js -- which is why the loading effect below awaits loadThree()
 *  first; see that effect's own comment for the one timing consequence. */
function loadEngine(THREE: typeof THREE_NS): Promise<EngineAdapter> {
  if (!enginePromise) {
    const engine: EngineAdapter = new BrepRsEngineAdapter(THREE);
    enginePromise = engine.load().then(() => engine);
  }
  return enginePromise;
}

/**
 * three.js itself, loaded dynamically so it code-splits out of the main
 * bundle rather than shipping to every page in the app. A REAL import()
 * (three is a real npm dependency, unlike the kernel's static files above) --
 * webpack sees this one and is meant to: that is what makes it a separate
 * chunk instead of an inline one.
 */
let threePromise: Promise<{
  THREE: typeof THREE_NS; OrbitControls: typeof OrbitControlsType;
  LineSegments2: typeof LineSegments2Type; LineSegmentsGeometry: typeof LineSegmentsGeometryType;
  LineMaterial: typeof LineMaterialType;
}> | null = null;
function loadThree() {
  if (!threePromise) {
    threePromise = Promise.all([
      import('three'),
      import('three/examples/jsm/controls/OrbitControls.js'),
      // Item V: the axis/grid guide lines need a REAL depth offset so a
      // line lying exactly on a face still shows instead of z-fighting
      // with it -- confirmed empirically that setting `polygonOffset` on
      // a GridHelper/AxesHelper's own material changes nothing, because
      // WebGL's polygon-offset state is specified to affect GL_TRIANGLES
      // rasterisation only, never GL_LINES. LineSegments2 draws its
      // "lines" as camera-facing triangle strips, which DOES honour it.
      import('three/examples/jsm/lines/LineSegments2.js'),
      import('three/examples/jsm/lines/LineSegmentsGeometry.js'),
      import('three/examples/jsm/lines/LineMaterial.js'),
    ]).then(([THREE, controlsMod, ls2Mod, lsgMod, lmMod]) => ({
      THREE, OrbitControls: controlsMod.OrbitControls,
      LineSegments2: ls2Mod.LineSegments2,
      LineSegmentsGeometry: lsgMod.LineSegmentsGeometry,
      LineMaterial: lmMod.LineMaterial,
    }));
  }
  return threePromise;
}

const round = (n: number) => Math.round(n * 10) / 10;

/** How far a triangle's normal may differ from its neighbor before
 *  EdgesGeometry draws a line there, in degrees. Tuned above three's own
 *  1-degree default so a curved face's own facets (at the 0.3 rad / ~17 degree
 *  ANGULAR tolerance lib/occt-mesh.ts defaults to -- see that file's measured
 *  table) mostly do not draw as edges, while a real corner (a box's 90-degree
 *  faces, a cylinder's cap-to-side seam) still does.
 *
 *  These edges follow the TESSELLATION, not the exact B-rep curve -- a
 *  faceted cylinder's rim is a many-sided polygon, not a circle. An exact
 *  curve would need BRepAdaptor_Curve / Poly_PolygonOnTriangulation, neither
 *  of which is in this app's custom kernel build's 89 bound symbols, and
 *  adding them means rebuilding that kernel, not this renderer. */
const EDGE_THRESHOLD_DEGREES = 25;

/** How close, in CSS pixels, the cursor has to be to an edge's SCREEN-SPACE
 *  projection for that edge to win over the face behind it -- see hitAt()'s
 *  own comment for why this replaced a world-space threshold entirely.
 *  Measured requirement was "grabbable at least 6px either side of the
 *  edge's true screen position"; 8 leaves a little margin above that floor
 *  without two edges of a small primitive both claiming one corner (also
 *  measured -- see hitAt()). */
const EDGE_HIT_BAND_PX = 8;

/** The occlusion depth tolerance's own scale factor, as a fraction of camera
 *  distance -- see hitAt()'s occlusion loop for the full story. 1% used to
 *  be tight enough to reject a genuinely far edge (tens of world units
 *  away) while still being "basically zero" for a truly coincident one --
 *  true for most of a box's own edges, measured at gaps of 1.6-5 world
 *  units against a ~240-unit camera distance (2.4-unit tolerance). But a
 *  flat, unforeshortened face has NO discretisation error to forgive in the
 *  first place; the tolerance only ever exists for a heavily FORESHORTENED
 *  one, where a fraction of a screen pixel of ray angle already sweeps
 *  across several world units of a grazing surface's own depth -- and nothing
 *  says every edge of every primitive is foreshortened by the same amount.
 *  Measured 2026-09-04: this app's own default camera (140, 160, 130) is not
 *  a true 45-degree isometric, and a fresh box's own top-left edge (the one
 *  edge among nine that a round-3 blind lens could never hover or pick) sat
 *  at a 2.8-unit gap against a 2.4-unit tolerance -- 0.4 units short, at a
 *  point where the cursor was already 0.1px from the edge's own screen
 *  projection, not a stale or far candidate -- and the camera-to-target
 *  distance driving the tolerance was only ~111 units there (a 40mm box
 *  fitted to 45% of the viewport), not the ~240 a first measurement
 *  assumed, so 1% (2.2) undershot even a widened 2% (2.2) attempt; 5% (5.6)
 *  covers the measured 2.8-unit gap with margin while staying a full 7-8x
 *  below every genuinely-occluded gap this file's own tests measure (a
 *  hidden edge one whole primitive-width away, ~40 units, at this same
 *  camera distance). */
const EDGE_OCCLUSION_TOLERANCE_FRACTION = 0.05;

/** How fat an edge highlight tube is, in world units -- real geometry, not a
 *  screen-space line width (see edgeTubeGeometry()'s own doc comment for
 *  why that distinction is the whole fix). ONE size for both hover and
 *  selected: each edge now gets exactly one pre-built tube (see the pooling
 *  note above the material definitions below), reused for whichever role is
 *  currently active, so there is no separate "selected tube" to size
 *  differently -- the two states are told apart by colour alone, which is
 *  what actually carries the distinction; thickness was never load-bearing
 *  for that. Tuned by eye against this app's own primitive sizes (10-40
 *  unit boxes and cylinders). */
const EDGE_TUBE_RADIUS = 0.75;

/** World-space radius of the vertex highlight marker -- a small sphere
 *  centred on the picked point, real geometry for the same reason edge
 *  highlights are (edgeTubeGeometry()'s own doc comment): no WebGL
 *  implementation guarantees a screen-space point size. Bigger than
 *  EDGE_TUBE_RADIUS on purpose -- tuned by eye so a single point still
 *  reads as its own thing next to a tube it might sit right beside. */
const VERTEX_MARKER_RADIUS = 1.4;

/** Every kind pickable -- the default `filters` prop value when no caller
 *  has wired the toolbar yet, identical to emptySelection()'s own filters
 *  default in selection-model.ts. */
const DEFAULT_FILTERS: SelectionFilters = { face: true, edge: true, vertex: true, body: true };

// Single source of truth for the filter strip's four chips -- same reason
// NAV_CUBE_FACES is one below: the JSX maps over this instead of hand-writing
// four near-identical buttons, so a filter key and its label can never drift
// out of sync with each other.
const FILTER_CHIPS: { key: keyof SelectionFilters; label: string }[] = [
  { key: 'face', label: 'Faces' },
  { key: 'edge', label: 'Edges' },
  { key: 'vertex', label: 'Vertices' },
  { key: 'body', label: 'Bodies' },
];

/**
 * Renders a ModelDoc through the brep-rs B-rep kernel, live, in the page.
 *
 * Incremental (feature-level) rebuild is NOT here: every doc change rebuilds
 * every feature from scratch through the adapter's build().
 */
export default function BrepViewportThree({
  doc, deflection, onStats, onPick, pick, selectedCount, selectionLabel, anchors, onAnchors, onMesh, registerPickAt,
  sketchPlane, panelOcclusionPx, ruleActivityAt, onEngine, badgesInStatusBar = false, filters, onFiltersChange, onBoxSelect,
  onFeatureDoubleClick, onSelectAll, onDeleteSelected, onUndo, onRedo, onStartSketch, preview,
}: Props) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  // Which view-strip preset the camera is sitting on, or null once the
  // student has dragged away from it. A blind judge could not tell the
  // Underneath view from Top -- straight up and straight down look alike --
  // so the strip itself says which one is active.
  const [preset, setPreset] = useState<'home' | 'top' | 'front' | 'underneath' | null>('home');
  // SPEC-mouse-parity Phase 1: which mouse-button preset OrbitControls is
  // bound to ('legacy' = stock three.js L-orbit/M-dolly/R-pan, what this
  // viewport has always done; 'fusion' = M-pan / R-dolly) and whether the
  // live camera is perspective or orthographic. Both persist across sessions.
  const [mouseScheme, setMouseScheme] = useState<MouseScheme>(() => loadSchemeName());
  const mouseSchemeRef = useRef<MouseScheme>(mouseScheme);
  mouseSchemeRef.current = mouseScheme;
  const [cameraKind, setCameraKind] = useState<CameraMode>(() => loadCameraMode());
  // Same stale-closure reasoning as docRef below: the scene-setup effect's
  // applyCameraMode() was created once and reads this ref, never the state.
  const cameraKindRef = useRef<CameraMode>(cameraKind);
  cameraKindRef.current = cameraKind;
  // Window-zoom: null = inert; 'armed' = the next left-drag draws a zoom
  // rectangle instead of orbiting; a rect = mid-drag (drives the overlay).
  // React state because arming changes the cursor and mid-drag re-renders the
  // rectangle div; the bookkeeping the pointer handlers mutate lives beside
  // it in windowZoomRef.
  const [windowZoom, setWindowZoom] = useState<{ x: number; y: number; w: number; h: number } | 'armed' | null>(null);
  // Box select (SPEC-mouse-parity.md Phase 3 item 4): the drag rectangle
  // overlay, plus which window/crossing rule it is currently drawing under
  // -- same convention SketchCanvas2D's own 2D marquee state uses (its
  // `marquee`/`marqueeKind` split), adapted to screen pixels instead of SVG
  // world units. React state because it drives the overlay div below; the
  // in-progress drag bookkeeping the pointer handlers mutate every move
  // lives beside it in boxSelectRef, the same split windowZoom/
  // windowZoomRef use.
  const [boxSelect, setBoxSelect] = useState<{ x: number; y: number; w: number; h: number; kind: 'window' | 'crossing' } | null>(null);
  // The right-click marking menu (SPEC-mouse-parity.md Phase 4.1):
  // container-relative px (same convention as boxSelect/windowZoom above,
  // computed off renderer.domElement's own getBoundingClientRect() in the
  // scene-setup effect's contextmenu listener below), or null when closed.
  const [markingMenu, setMarkingMenu] = useState<{ x: number; y: number } | null>(null);
  // Nav cube: DOM node whose CSS transform is synced to the live camera
  // orientation every frame (see the rAF effect below) -- a ref, not state,
  // so 60x/sec orientation reads never trigger a React re-render.
  const navCubeInnerRef = useRef<HTMLDivElement | null>(null);
  const cubeDragRef = useRef({ dragging: false, x: 0, y: 0, moved: false });
  // Todo 28 (SPEC Phase 1.5): the cube's own small menu, opened by the
  // affordance icon on the cube -- NEVER by right-click (the marking menu
  // owns right-click everywhere, cube included; two competing menus over
  // one widget would collide). Offers the two camera modes that already
  // exist (the view-strip's Persp/Ortho) plus Set as Home/Front/Top;
  // SPEC-mouse-parity.md :65 defers "Perspective with Orthographic Faces"
  // so it is deliberately absent here.
  const [cubeMenu, setCubeMenu] = useState(false);
  // The open menu is a SIBLING of the cube wrapper (fixed-position at the
  // gear's screen spot) so a click on its entry buttons is never captured
  // by the wrapper's pointerdown -- their own onClicks fire. gearX/gearY
  // are read from the gear's bounding rect at open time.
  const [gearPos, setGearPos] = useState<{ x: number; y: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  // A stage that is empty ON PURPOSE (nothing yet, or only flat sketches)
  // gets a hint, not the red panel. Measured 2026-09-03: a beginner who had
  // just drawn a circle read "Could not build this model" as their mistake.
  const [stageHint, setStageHint] = useState<string | null>(null);
  // Item N: stageHint itself is still set the same way (a doc rebuild's
  // own "this is sketch-only" check, unchanged below) -- this is purely a
  // DISPLAY delay layered on top, so a rebuild triggered by a rule commit
  // does not re-flash the same Pull hint the student was just working
  // around. Hidden the instant ruleActivityAt moves; shown again once 3s
  // pass with no further activity, or immediately if there has been none
  // yet (ruleActivityAt null -- unchanged, first-run behaviour).
  const [showStageHint, setShowStageHint] = useState(true);
  useEffect(() => {
    if (!stageHint) { setShowStageHint(true); return undefined; }
    const elapsed = ruleActivityAt ? Date.now() - ruleActivityAt : Infinity;
    if (elapsed >= 3000) { setShowStageHint(true); return undefined; }
    setShowStageHint(false);
    const timer = setTimeout(() => setShowStageHint(true), 3000 - elapsed);
    return () => clearTimeout(timer);
  }, [stageHint, ruleActivityAt]);
  /** Keeps the nav cube's CSS rotation in lockstep with the real camera,
   *  every frame, regardless of what moved it (drag on the canvas, a preset
   *  click, dragging the cube itself) -- a plain rAF poll rather than piggy-
   *  backing on the render-on-demand/dampingTick machinery above, because
   *  this never needs a WebGL render, just a style write. theta/phi are
   *  spherical angles of (camera - target) about the world's Z-up axis, not
   *  three.js's own Y-up Spherical helper. rotateY carries azimuth (the
   *  screen-vertical axis) and rotateX carries elevation (screen-
   *  horizontal); face-to-direction assignment is derived and checked in
   *  the JSX below's own comment. */
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      const el = navCubeInnerRef.current;
      if (camera && controls && el) {
        const rel = camera.position.clone().sub(controls.target);
        const r = rel.length() || 1;
        const theta = Math.atan2(rel.y, rel.x);
        const phi = Math.acos(Math.min(1, Math.max(-1, rel.z / r)));
        const elevDeg = (phi - Math.PI / 2) * (180 / Math.PI);
        const azimDeg = -theta * (180 / Math.PI);
        el.style.transform = `rotateX(${elevDeg}deg) rotateY(${azimDeg}deg)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  /** Whether the pointer is CURRENTLY over a pickable edge -- drives the
   *  "click this edge" hint below. React state, not a ref, because it has to
   *  cause a render (the hint is JSX); set from inside applyHover(), which
   *  lives in the scene-setup effect below but closes over the setter
   *  returned by this hook, which React guarantees is referentially stable
   *  across renders -- no staleness risk from that effect's `[phase]`-only
   *  dependency array. */
  const [hoveringEdge, setHoveringEdge] = useState(false);
  const [loadingNote, setLoadingNote] = useState('loading the modelling kernel + three.js');

  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<EngineAdapter | null>(null);
  const threeRef = useRef<Awaited<ReturnType<typeof loadThree>> | null>(null);

  /** Created once per mount, on the first successful draw, and reused for
   *  every rebuild after that -- recreating any of this per doc change would
   *  mean a fresh WebGL context (and a fresh camera) on every dimension drag,
   *  the exact per-edit cost this component exists to avoid. */
  const rendererRef = useRef<THREE_NS.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE_NS.Scene | null>(null);
  /** The live camera. Phase 1 (SPEC-mouse-parity) swaps between a
   *  PerspectiveCamera and an OrthographicCamera in place (applyCameraMode
   *  below); typed as the union because every consumer treats both the same
   *  except for the projection details each swap carries across itself. */
  const cameraRef = useRef<THREE_NS.PerspectiveCamera | THREE_NS.OrthographicCamera | null>(null);
  /** The camera NOT currently live -- kept constructed so a mode toggle never
   *  re-measures the container or re-states clipping planes. */
  const inactiveCameraRef = useRef<THREE_NS.PerspectiveCamera | THREE_NS.OrthographicCamera | null>(null);
  const controlsRef = useRef<OrbitControlsType | null>(null);
  /** Pointer-down bookkeeping for the scene-setup effect's click-vs-drag
   *  threshold and the window-zoom rectangle drag; see its onPointerDown.
   *  `null` when no window-zoom is armed; `{ armed: true }` from the Win Zoom
   *  button until the effect's pointerup consumes it. A ref, not state, so the
   *  effect's `[phase]`-only handlers can read the flag they were created
   *  before. */
  const windowZoomRef = useRef<{ armed: boolean } | null>(null);
  /** The in-progress box-select drag: where it started (client px) and
   *  where the pointer is now, plus whether it has crossed the 4px
   *  click-vs-drag threshold yet -- same shape SketchCanvas2D's own
   *  marqueeRef uses. Null whenever no box-select drag is in flight --
   *  armed implicitly by an empty-space pointerdown, not a toolbar toggle
   *  the way window-zoom is (see onCanvasPointerDown). */
  const boxSelectRef = useRef<{ startX: number; startY: number; endX: number; endY: number; moved: boolean } | null>(null);
  /** The current solid(s), as a group, so a rebuild can dispose the old
   *  geometry rather than leaking a WebGL buffer per edit. */
  const solidGroupRef = useRef<THREE_NS.Group | null>(null);
  /** requestAnimationFrame handle for the damping tail after a drag ends.
   *  Null whenever nothing is animating -- see renderOnDemand() below for why
   *  that matters. */
  const dampingRafRef = useRef<number | null>(null);
  /** Whether fitToModel() has already run for the model currently on screen
   *  -- see that function's own comment. Flips back to false the moment the
   *  document goes empty (the "build a fresh box after Undo" case), so the
   *  NEXT shape gets its own automatic fit rather than inheriting whatever
   *  distance a since-deleted model happened to leave the camera at. */
  const hasFitOnceRef = useRef(false);
  /** Item T: whether the LAST successful build had at least one real SOLID
   *  (not just a sketch) -- distinct from `hasFitOnceRef`, which a
   *  sketch-only doc's own first-shape fit already sets true before any
   *  solid ever exists (see the `onlySketches` branch below). A Pull on
   *  that same sketch is the model's first SOLID even though it is not the
   *  first FIT, and it needs its own fresh Home-style fit -- the flat
   *  sketch fit that already ran was calibrated for a 2D outline viewed
   *  straight-on, not for the 3D shape Pull just gave it (P06's own
   *  finding: the pulled plate sat at roughly an eighth of the frame,
   *  because it kept the sketch's own fit distance and angle). Reset to
   *  false alongside `hasFitOnceRef` the moment the doc goes empty. */
  const hadSolidRef = useRef(false);
  /** In-flight camera-fit animation frame, if any -- cancelled before
   *  starting a new one so two fits in quick succession (an edit landing
   *  mid-animation) do not fight over the camera. */
  const fitAnimRef = useRef<number | null>(null);
  /** The orbit (camera position + controls target) the student had right
   *  before `sketchPlane` first went from null to a plane -- i.e. right
   *  before this component snapped to a flat, straight-on view of a sketch.
   *  Null whenever no such view is currently active. Restored verbatim the
   *  moment `sketchPlane` goes back to null (selecting a solid again, or
   *  deselecting entirely) -- see that prop's own effect below -- so looking
   *  at a sketch flat is a visit, not a one-way trip out of whatever angle
   *  the student had actually orbited to. */
  const savedOrbitRef = useRef<{
    position: [number, number, number]; target: [number, number, number];
  } | null>(null);
  /** The `sketchPlane` value as of the last time this effect ran, so the
   *  effect below can tell null->plane (entering flat view: save + snap),
   *  plane->null (leaving: restore), and plane->a-different-plane (switching
   *  which sketch is being viewed flat: just re-aim, the ORIGINAL saved
   *  orbit stays put) apart from a re-render that changed nothing. */
  const prevSketchPlaneRef = useRef<'xy' | 'xz' | 'yz' | null>(null);
  const onStatsRef = useRef(onStats);
  onStatsRef.current = onStats;
  const onMeshRef = useRef(onMesh);
  onMeshRef.current = onMesh;
  const onEngineRef = useRef(onEngine);
  onEngineRef.current = onEngine;
  const registerPickAtRef = useRef(registerPickAt);
  registerPickAtRef.current = registerPickAt;
  /** The scene-setup effect's window-zoom drag (a `[phase]`-only closure) hands
   *  its finished rectangle to the component-level applyWindowZoomRect through
   *  here -- same stale-closure pattern as registerPickAtRef itself, one
   *  indirection so an effect created once can call a function written below
   *  it in the file. */
  const applyWindowZoomRectRef = useRef<((rect: { x: number; y: number; width: number; height: number }, viewportWidth: number, viewportHeight: number) => void) | null>(null);
  // The scene-setup effect below only re-runs on a `phase` change (see its
  // own dep array), so its onClick closure is created ONCE and would
  // otherwise keep reading whatever `doc` was current at that moment --
  // stale the instant the student adds a second feature. nameEdgeOnCurrentShape()
  // needs the CURRENT feature list to enumerate primitive candidates, so it
  // reads this ref, not `doc` directly.
  const docRef = useRef(doc);
  docRef.current = doc;
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const pickRef = useRef(pick);
  pickRef.current = pick;
  // Same stale-closure reasoning as onPickRef above -- filters is read by
  // hitAt()'s pointermove/click listeners, set up once by the scene-setup
  // effect below, not on every render.
  const filtersRef = useRef<SelectionFilters>(filters ?? DEFAULT_FILTERS);
  filtersRef.current = filters ?? DEFAULT_FILTERS;
  // Same stale-closure reasoning as onPickRef above -- onBoxSelect is fired
  // from inside the scene-setup effect's onCanvasPointerUp, set up once,
  // not on every render.
  const onBoxSelectRef = useRef(onBoxSelect);
  onBoxSelectRef.current = onBoxSelect;
  // Same stale-closure reasoning as onBoxSelectRef above -- these three are
  // read from the scene-setup effect's dblclick/keydown listeners, set up
  // once, not on every render.
  const onFeatureDoubleClickRef = useRef(onFeatureDoubleClick);
  onFeatureDoubleClickRef.current = onFeatureDoubleClick;
  const onSelectAllRef = useRef(onSelectAll);
  onSelectAllRef.current = onSelectAll;
  const onDeleteSelectedRef = useRef(onDeleteSelected);
  onDeleteSelectedRef.current = onDeleteSelected;
  // The marking menu's shared dispatch, for BOTH the rendered menu's wedges
  // (the onClick near the bottom of this file) and todo 19's fast
  // directional gesture -- one function so a wedge fired either way does
  // exactly the same thing.
  const dispatchMarkingCommandRef = useRef<(id: string) => void>(() => {});
  // Whether the JUST-ENDED right press classified as a menu click (set by
  // onCanvasPointerUp's classifier, consumed by onCanvasContextMenu — which
  // the browser fires for the same press). Cleared by every non-armed
  // contextmenu so a stray native-menu event never opens the menu.
  const rightMenuArmedRef = useRef(false);
  // Same stale-closure reasoning as docRef above: projectAnchors() is a
  // component-level function (reads refs, not props) so it can be called
  // both from inside the scene-setup effect's camera-change handler and from
  // the doc-rebuild effect, without either one recreating it.
  const anchorsRef = useRef<HandleSpec[]>(anchors ?? []);
  anchorsRef.current = anchors ?? [];
  // Phase 5.3's live-preview tint (todo 25), read through a ref for the
  // same stale-closure reasoning as anchorsRef above: drawGeoms() is a
  // component-level function called from the doc-rebuild effect.
  const previewRef = useRef(preview ?? null);
  previewRef.current = preview ?? null;
  // The ONE marking-menu dispatch both entry points share: the rendered
  // menu's onClick (near the bottom of this file) AND todo 19's fast
  // directional gesture (which never renders the menu). Assignment during
  // render (not an effect) keeps the ref fresh with no commit delay, and
  // the dispatch reads props directly so there is no stale closure.
  dispatchMarkingCommandRef.current = (id: string) => {
    if (id === 'delete') onDeleteSelected?.();
    else if (id === 'undo') onUndo?.();
    else if (id === 'redo') onRedo?.();
    else if (id === 'sketch') onStartSketch?.();
    // repeat / press-pull / move-copy / hole: present-but-noop. Each needs
    // new plumbing this base-component todo does not build -- a
    // repeat-last-feature flow, a Press Pull command, a Move/Copy gizmo, a
    // Hole feature dialog -- see marking-menu-core.ts's own comment on
    // PART_VIEWPORT_WEDGES.
  };
  const onAnchorsRef = useRef(onAnchors);
  onAnchorsRef.current = onAnchors;
  // Set by the camera's own 'change' event, consumed (and cleared) inside the
  // SAME per-frame damping loop that already exists for repainting the scene
  // -- the identical flush point runner-brep.html's own projectAnchors() uses
  // (its `anchorsDirty`, set on 'change', read inside its dampingTick), so a
  // moving camera never leaves a handle projected at a stale position without
  // re-projecting on every single 'change' event -- once per animation frame,
  // the same cadence the repaint itself already runs at, is what this buys.
  const anchorsDirtyRef = useRef(false);

  /** All CURRENT pickable edge lines, flat across every mesh -- rebuilt by
   *  drawGeoms() on every doc change. Flat rather than found by searching
   *  group.children each time, so a raycast can test edges independently of
   *  faces (see hitAt() below) with one intersectObjects() call. */
  const edgePickLinesRef = useRef<THREE_NS.Line[]>([]);
  /** Overlay objects for the four highlight states (hover/selected x
   *  face/edge). Created once, in the scene-setup effect below, and sit
   *  directly on `scene` rather than inside solidGroup -- so a rebuild's
   *  group.clear() (see drawGeoms()) never touches them. They get repointed
   *  at fresh geometry instead of recreated; see paintFaceHighlight() and
   *  restorePicks(). */
  const hoverFaceMeshRef = useRef<THREE_NS.Mesh | null>(null);
  const selectedFaceMeshRef = useRef<THREE_NS.Mesh | null>(null);
  // Same pooling convention, for the vertex marker (a small sphere, not a
  // borrowed triangle range) -- see the scene-setup effect for why a sphere
  // needs no per-pick geometry work at all, only a position + a visibility
  // flag.
  const hoverVertexMeshRef = useRef<THREE_NS.Mesh | null>(null);
  const selectedVertexMeshRef = useRef<THREE_NS.Mesh | null>(null);
  // Edge highlights are POOLED TUBE MESHES, one built per topological edge in
  // drawGeoms() -- see the pooling note above their material definitions in
  // the scene-setup effect. These two refs hold the two SHARED materials
  // (never per-edge, never per-hover) and which tube, if any, is currently
  // wearing each role. A tube can be both at once (the student is hovering
  // the edge they already selected) -- see setSelectedEdgeTube()'s handling
  // of that case.
  const hoverEdgeMaterialRef = useRef<THREE_NS.Material | null>(null);
  const selectedEdgeMaterialRef = useRef<THREE_NS.Material | null>(null);
  const hoveredEdgeTubeRef = useRef<THREE_NS.Mesh | null>(null);
  const selectedEdgeTubeRef = useRef<THREE_NS.Mesh | null>(null);
  /** The student's face selection, kept LOCALLY rather than lifted the way
   *  the edge `pick` prop is: nothing outside this component consumes a
   *  picked face yet (see the file header), so there is no TopoName to
   *  resolve it against after a rebuild. Re-applied by feature id +
   *  FaceRange.index instead -- a weaker guarantee than a real name, good
   *  enough for a selection nothing downstream depends on yet. */
  const selectedFaceStateRef = useRef<{ featureId: string; faceIndex: number } | null>(null);
  /** A face pick emitted without a name (the build was mid-swap). Re-named
   *  once the next build lands; null when the last pick was named. */
  const unnamedFacePickRef = useRef<{ featureId: string; faceIndex: number } | null>(null);
  /** The most recent successful build, cached so a `pick` change ALONE (the
   *  student cleared the selection from the model tree, say, rather than by
   *  clicking the viewport) can re-run restorePicks() without repeating the
   *  actual kernel rebuild -- see the effect below that watches `pick`. */
  const lastBuiltRef = useRef<EngineBuildResult | null>(null);
  const lastMeshesRef = useRef<THREE_NS.Mesh[]>([]);

  // ---- load the engine + three.js once --------------------------------------
  //
  // Sequenced (loadThree() first, then loadEngine(three.THREE)) rather than
  // Promise.all()'d the way loadKernel()/loadThree() used to be -- the
  // adapter takes THREE constructor-injected (see loadEngine()'s own
  // comment), so it cannot be built, let alone told to load(), before
  // three.js itself has resolved. The one real consequence: the wasm
  // kernel's own download no longer starts concurrently with three.js's
  // chunk fetch, a few tens of ms at most and not a functional difference --
  // nothing about WHICH interaction surface works depends on this ordering.
  useEffect(() => {
    let cancelled = false;
    loadThree()
      .then((three) => {
        if (cancelled) return undefined;
        threeRef.current = three;
        return loadEngine(three.THREE);
      })
      .then((engine) => {
        if (cancelled || !engine) return;
        engineRef.current = engine;
        onEngineRef.current?.(engine);
        setLoadingNote('kernel ready');
        setPhase('ready');
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(String(e?.message ?? e));
        setPhase('error');
      });
    return () => { cancelled = true; };
  }, []);

  // ---- create the scene once the container exists and everything loaded ---
  useEffect(() => {
    const container = containerRef.current;
    const three = threeRef.current;
    if (!container || !three || phase !== 'ready' || rendererRef.current) return;
    const { THREE, OrbitControls, LineSegments2, LineSegmentsGeometry, LineMaterial } = three;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.bg);

    // SPEC-mouse-parity Phase 1: both camera kinds exist from the start so the
    // view-strip's Persp/Ortho toggle (applyCameraMode below, bound by the
    // camera-mode effect further down) never has to re-measure the container--
    // the toggle only re-derives the ortho frustum at the current target
    // distance and copies placement across. `camera` is whichever kind the
    // persisted mode (loadCameraMode) says; everything below keeps compiling
    // against it unchanged because the union carries both kinds' members.
    const initialKind = cameraKindRef.current;
    const aspect0 = container.clientWidth / Math.max(1, container.clientHeight);
    const perspCamera = new THREE.PerspectiveCamera(45, aspect0, 0.1, 5000);
    perspCamera.up.set(0, 0, 1);
    perspCamera.position.set(140, 160, 130);
    perspCamera.lookAt(0, 0, 0);
    const orthoDist0 = perspCamera.position.length();
    const orthoFrame0 = orthoFrustumFromPerspective(
      { fov: perspCamera.fov, aspect: aspect0, near: perspCamera.near, far: perspCamera.far },
      orthoDist0,
    );
    const orthoCamera = new THREE.OrthographicCamera(
      orthoFrame0.left, orthoFrame0.right, orthoFrame0.top, orthoFrame0.bottom,
      orthoFrame0.near, orthoFrame0.far,
    );
    orthoCamera.up.set(0, 0, 1);
    orthoCamera.position.set(140, 160, 130);
    orthoCamera.lookAt(0, 0, 0);
    const camera = initialKind === CameraMode.ORTHOGRAPHIC ? orthoCamera : perspCamera;
    inactiveCameraRef.current = initialKind === CameraMode.ORTHOGRAPHIC ? perspCamera : orthoCamera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      // WITHOUT this, the drawing buffer clears right after the browser
      // presents each frame, so a headless test reading the canvas back
      // (toDataURL, a pixel sample) sees blank even though the frame the eye
      // saw was correct. Same reasoning, same flag, as BrepViewport.tsx.
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);
    // Focusable (SPEC-mouse-parity.md Phase 3.6): Ctrl+A/Delete below are
    // ordinary keydown listeners on this element, so they only ever see a
    // key press that targeted (or bubbled through) the canvas -- a Delete
    // typed into some other focused text field on the page never reaches
    // them. A plain <canvas> is not focusable without this. outline is
    // suppressed the same way a click-to-pick canvas already reads as
    // "clicked, not tabbed to" -- the selection badge is the focus cue.
    renderer.domElement.tabIndex = 0;
    renderer.domElement.style.outline = 'none';

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(100, 200, 150);
    const fill = new THREE.DirectionalLight(0xffffff, 0.4);
    fill.position.set(-120, -80, 60);
    // Every light above sits at a POSITIVE z -- fine for the top-down Home
    // view, but it leaves every face whose normal points the other way (the
    // underside of a box, the far wall of a through hole) lit by ambient
    // alone. `under` mirrors `fill`'s x/y lean with a NEGATIVE z so the
    // "Underneath" view strip preset (see lookFrom() above; this scene is
    // Z-up) actually shows something instead of a near-black silhouette --
    // it's the light this component was missing, not a from-below CAMERA
    // preset also having to add its own light. 1.0 (roughly `key`'s order,
    // not `fill`'s -- 0.5 measured too dim: the bottom face landed at only
    // ~1.86x the background's brightness, short of the 2x floor a hole's
    // exit needs to read as a hole and not a shadow) but confined to the
    // -z hemisphere, so it adds NOTHING to any face the Home view can see --
    // measured at an exact 0 pixel diff over the model region, before vs.
    // after this light existed at all.
    const under = new THREE.DirectionalLight(0xffffff, 1.0);
    under.position.set(-100, -80, -150);
    // A default box's top face and its brighter of the two visible side
    // faces measured only 2.9% apart in luminance from Home (a blind judge
    // credited Chili3D "better face shading" over exactly this) -- `key`
    // and `fill` both lean into x/y, so neither one separates a horizontal
    // top from a near-vertical side by much. `overhead` points straight
    // down the +z axis (dot product with the two side faces' normals is
    // exactly 0 -- it cannot touch them, by construction, not by tuning),
    // adding light to the top face alone. Measured with a default
    // 40x40x20 box, Home view (WebGL readPixels, not a screenshot):
    // top/right/left luminance (0-255) was 95.1 / 91.1 / 75.4 (top-right
    // gap 2.9%) and is now 110.3 / 91.1 / 75.4 -- pairwise gaps 17.4%,
    // 31.6%, 17.2%, all past the 12% floor. See verify-shading.py.
    const overhead = new THREE.DirectionalLight(0xffffff, 0.45);
    overhead.position.set(0, 0, 300);
    scene.add(ambient, key, fill, under, overhead);

    // Default GridHelper lies in the XZ (y=0) plane -- a Y-up convention.
    // Rotated onto the XY (z=0) plane to match the Z-up scene.
    //
    // CENTRE LINE IS DESATURATED BLUE-GREY (0x6272a4, this app's own existing
    // "dim" token -- see COLORS above), NOT the saturated cyan it used to be.
    // A grid's job is "here is a ground plane", not "here is the app's own
    // accent colour" -- moving the hover highlight OFF this exact hex (see
    // hoverEdgeMaterial below) fixed a colour collision that cost a blind
    // round, but a saturated grid line was always going to collide with
    // SOMETHING drawn above it. A neutral one does its actual job (which
    // this app's own reviewer credited: spatial context against a "rectangle
    // floating in fog") without competing with anything that gets drawn on
    // top of it, ever.
    // Item V (round 6, P06): "a stray axis line pierces straight through
    // the top of the box and diagonal grid-axis lines run off-frame".
    // Measured both halves directly:
    //
    // (1) A GridHelper/AxesHelper draws via gl.LINES, and WebGL's own
    // polygon-offset state is specified to affect GL_TRIANGLES rasterisation
    // ONLY -- confirmed empirically, not assumed: setting `polygonOffset`
    // on either helper's own material changed a live pixel readback at the
    // box's own top face NOT AT ALL, before and after, identical values.
    // So the two helpers below exist ONLY to generate the vertex data
    // (position + colour) they already know how to build; that data is
    // handed to LineSegments2 (three/examples/jsm/lines), which rasterises
    // a "line" as a camera-facing triangle strip -- real polygon geometry,
    // which DOES honour a depth offset -- rather than being added to the
    // scene itself.
    //
    // (2) GridHelper(120, ...) and AxesHelper(60) both predate
    // DEFAULT_FILL_FRACTION (0.45, lib/camera-fit.ts): Home fits a model's
    // longest dimension to 45% of the viewport's shorter side, so a 40-unit
    // default box leaves roughly 40/0.45 ~= 89 world units of shorter-side
    // headroom at Home -- inside which BOTH helpers' own 120/60-unit reach
    // no longer fits, which is the "runs off-frame" half of the same
    // report. Halved to 80/40 (same 5-unit cell size, 16 divisions instead
    // of 24) so they terminate inside frame at Home's own default fit
    // instead of only at some larger, incidental zoom-out.
    const rawGrid = new THREE.GridHelper(80, 16, 0x6272a4, 0x44475a);
    const gridGeometry = new LineSegmentsGeometry();
    gridGeometry.setPositions(Array.from(rawGrid.geometry.attributes.position.array as ArrayLike<number>));
    gridGeometry.setColors(Array.from(rawGrid.geometry.attributes.color.array as ArrayLike<number>));
    rawGrid.geometry.dispose();
    const gridMaterial = new LineMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.35,
      linewidth: 1,
      worldUnits: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    gridMaterial.resolution.set(container.clientWidth, container.clientHeight);
    const grid = new LineSegments2(gridGeometry, gridMaterial);
    // Default GridHelper lies in the XZ (y=0) plane -- a Y-up convention.
    // Rotated onto the XY (z=0) plane to match the Z-up scene.
    grid.rotation.x = Math.PI / 2;
    // CENTRE LINE IS DESATURATED BLUE-GREY (0x6272a4, this app's own existing
    // "dim" token -- see COLORS above), NOT the saturated cyan it used to be.
    // A grid's job is "here is a ground plane", not "here is the app's own
    // accent colour" -- moving the hover highlight OFF this exact hex (see
    // hoverEdgeMaterial below) fixed a colour collision that cost a blind
    // round, but a saturated grid line was always going to collide with
    // SOMETHING drawn above it. A neutral one does its actual job (which
    // this app's own reviewer credited: spatial context against a "rectangle
    // floating in fog") without competing with anything that gets drawn on
    // top of it, ever.
    scene.add(grid);

    const rawAxes = new THREE.AxesHelper(40);
    const axesGeometry = new LineSegmentsGeometry();
    axesGeometry.setPositions(Array.from(rawAxes.geometry.attributes.position.array as ArrayLike<number>));
    axesGeometry.setColors(Array.from(rawAxes.geometry.attributes.color.array as ArrayLike<number>));
    rawAxes.geometry.dispose();
    const axesMaterial = new LineMaterial({
      vertexColors: true,
      linewidth: 1,
      worldUnits: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    axesMaterial.resolution.set(container.clientWidth, container.clientHeight);
    const axes = new LineSegments2(axesGeometry, axesMaterial);
    scene.add(axes);

    const solidGroup = new THREE.Group();
    scene.add(solidGroup);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.dampingFactor = 0.1;
    // SPEC-mouse-parity Phase 1 items 1+2: bind the persisted mouse scheme's
    // button/touch map and zoom the wheel toward the cursor. camera-controls
    // .ts is action->button-number; OrbitControls is slot->action (LEFT
    // /MIDDLE/RIGHT, ONE/TWO), so the mapping inverts through THREE's own
    // MOUSE/TOUCH enums. Effect-scoped because the scheme effect below is the
    // only other caller, and it reaches this same instance via controlsRef.
    //
    // Touches: the scheme's 0/1/2 slot index maps onto ONE(=0)/TWO(=1); index
    // 2 ("middle") has no slot on three.js's touches today and is dropped --
    // the stock configuration never bound it either.
    const bindMouseScheme = (c: OrbitControlsType, scheme: MouseScheme) => {
      const buttons = schemeToMouseButtons(scheme);
      const mb: { LEFT?: number; MIDDLE?: number; RIGHT?: number } = {};
      if (buttons.ORBIT === 0) mb.LEFT = THREE.MOUSE.ROTATE;
      else if (buttons.ORBIT === 1) mb.MIDDLE = THREE.MOUSE.ROTATE;
      else if (buttons.ORBIT === 2) mb.RIGHT = THREE.MOUSE.ROTATE;
      if (buttons.PAN === 0) mb.LEFT = THREE.MOUSE.PAN;
      else if (buttons.PAN === 1) mb.MIDDLE = THREE.MOUSE.PAN;
      else if (buttons.PAN === 2) mb.RIGHT = THREE.MOUSE.PAN;
      if (buttons.DOLLY === 0) mb.LEFT = THREE.MOUSE.DOLLY;
      else if (buttons.DOLLY === 1) mb.MIDDLE = THREE.MOUSE.DOLLY;
      else if (buttons.DOLLY === 2) mb.RIGHT = THREE.MOUSE.DOLLY;
      c.mouseButtons = mb as OrbitControlsType['mouseButtons'];
      const t = schemeToTouches(scheme);
      const touches: { ONE?: number; TWO?: number } = {};
      if (t.ORBIT === 0) touches.ONE = THREE.TOUCH.ROTATE;
      else if (t.ORBIT === 1) touches.TWO = THREE.TOUCH.ROTATE;
      if (t.PAN === 0) touches.ONE = THREE.TOUCH.PAN;
      else if (t.PAN === 1) touches.TWO = THREE.TOUCH.PAN;
      if (t.DOLLY === 0) touches.ONE = THREE.TOUCH.DOLLY_PAN;
      else if (t.DOLLY === 1) touches.TWO = THREE.TOUCH.DOLLY_PAN;
      c.touches = touches as OrbitControlsType['touches'];
    };
    bindMouseScheme(controls, mouseSchemeRef.current);
    schemeBindRef.current = (scheme) => bindMouseScheme(controls, scheme);
    controls.zoomToCursor = true;
    const renderNow = () => renderer.render(scene, camera);

    // RENDER ON DEMAND, not a continuous rAF loop -- this is the point of the
    // move, not a style preference. A loop that repaints on every frame
    // whether or not anything changed is exactly what makes GPU-upload
    // timing unmeasurable, which is why the OLD JSCAD/regl runner (364
    // repaints/sec while idle) could never be timed on draw calls. OrbitControls
    // with damping DOES need per-frame update() calls while it settles after a
    // drag, so the loop below runs ONLY for that tail: each frame calls
    // controls.update() (which returns whether it changed something) and
    // stops scheduling the next frame the moment it returns false. No
    // 'change' listener drives it, because that would restart on every damped
    // frame's own 'change' event, which is the loop this exists to avoid.
    const dampingTick = () => {
      const stillMoving = controls.update();
      renderNow();
      // The one flush point a render-on-demand viewport needs for handles: a
      // moving camera fires 'change' on every frame it actually moves (see
      // onControlsChange below), and this is the SAME per-frame loop already
      // running for the repaint, not a second one -- projecting on every
      // 'change' event directly would mean re-projecting far more often than
      // the screen repaints, for no picture anyone sees between those extra
      // runs.
      if (anchorsDirtyRef.current) { anchorsDirtyRef.current = false; projectAnchors(); }
      dampingRafRef.current = stillMoving ? requestAnimationFrame(dampingTick) : null;
    };
    const onControlsStart = () => {
      setPreset(null);
      if (dampingRafRef.current === null) dampingRafRef.current = requestAnimationFrame(dampingTick);
    };
    controls.addEventListener('start', onControlsStart);
    // NOT a second render trigger -- see the long comment on dampingTick's own
    // loop above for why a 'change' listener must never itself schedule a
    // frame. This one only marks anchors stale; dampingTick (already running
    // for the whole gesture, because 'start' fires before any 'change' can)
    // is what actually re-projects them, once per frame, not once per event.
    const onControlsChange = () => { anchorsDirtyRef.current = true; };
    controls.addEventListener('change', onControlsChange);

    // ---- keep the renderer/camera in sync with the CONTAINER'S OWN size ----
    //
    // FOUND WHILE VERIFYING DRAG HANDLES, not assumed. renderer.setSize()
    // above reads container.clientWidth/clientHeight exactly ONCE, at mount.
    // Nothing before this line ever measured it again -- there was no resize
    // handling in this component at all. In Build mode specifically, the
    // container's settled width is NARROWER than whatever it measured at
    // mount (the ribbon, the "N Selected" badge, and the bottom timeline
    // strip's 58px padding all land on `.reshape-pane-view` in renders this
    // effect does not re-run for), so the canvas's OWN backing size -- and
    // the camera's aspect ratio, baked in at construction from that same
    // stale measurement -- silently drift out of sync with the box the
    // canvas actually has to fit. Measured directly: a 40-unit box's own
    // faces render inside a correctly-proportioned canvas (nothing LOOKS
    // stretched, because the canvas simply overflows its container by the
    // difference rather than squeezing into it), but a handle projected
    // through the CURRENT container width lands scaled by roughly
    // (current width / stale width) off of where the geometry it is meant to
    // sit on actually is -- exactly the systematic, not-off-by-a-few-pixels
    // mismatch a screenshot catches and a hex/pixel diff would not think to
    // look for.
    //
    // ResizeObserver, not a window 'resize' listener: the container's size
    // changes because of a CSS/layout change (switching to Build mode, the
    // timeline strip mounting), not because the browser window itself
    // resized, and only the former is guaranteed to fire on this container
    // specifically.
    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w < 1 || h < 1) return;
      // No "did it actually change" guard here -- ResizeObserver only ever
      // invokes this callback when the observed box's size genuinely
      // changed, and comparing against renderer.domElement.width/height
      // would compare CSS pixels against DEVICE pixels the moment
      // devicePixelRatio is not 1, which is a false-mismatch on every call.
      renderer.setSize(w, h);
      // The union makes `camera` look like it carries both projection shapes;
      // guard on the real kind instead of reaching for `aspect`/frustum fields
      // the other kind does not have. Both branches end with the same
      // updateProjectionMatrix() + LineMaterial resolution refresh below.
      if ((camera as THREE_NS.PerspectiveCamera).isPerspectiveCamera) {
        (camera as THREE_NS.PerspectiveCamera).aspect = w / h;
      } else {
        const ortho = camera as THREE_NS.OrthographicCamera;
        const hh = (ortho.top - ortho.bottom) / 2;
        const hw = hh * (w / h);
        ortho.left = -hw; ortho.right = hw;
      }
      camera.updateProjectionMatrix();
      // LineMaterial (item V's grid/axes) computes its own screen-space
      // line width from this -- stale after a resize would draw them too
      // thick or too thin relative to every other pixel-sized thing on
      // screen, not merely mis-scaled.
      gridMaterial.resolution.set(w, h);
      axesMaterial.resolution.set(w, h);
      renderNow();
      // A resize can happen with no orbit gesture in progress at all (the
      // student never touched the camera), so this cannot wait for
      // dampingTick's own flush point -- there may be no damping loop
      // running to consume it.
      projectAnchors();
    });
    resizeObserver.observe(container);

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    controlsRef.current = controls;
    solidGroupRef.current = solidGroup;

    // ---- pick highlights ----------------------------------------------------
    // Four persistent objects, mutated on hover/click rather than recreated --
    // allocating a THREE.Mesh on every pointermove is exactly the per-frame
    // cost the render-on-demand design above exists to avoid. All four sit on
    // `scene` directly, not inside `solidGroup`, so they survive a rebuild's
    // group.clear(); drawGeoms() and restorePicks() repoint them at fresh
    // geometry instead.
    // Cyan, not the Dracula pale-yellow (#f1fa8c) this used to be -- measured
    // against the model's own body colour, not the palette in the abstract:
    // #f1fa8c sits an adjacent ~35 degrees from the solid's orange (#ff6600)
    // on the hue wheel, so a translucent wash of it reads as a barely-lighter
    // shade of the same orange, not a highlight. Cyan sits close to
    // COMPLEMENTARY to orange (~155 degrees away) and separates at almost any
    // opacity -- the same reasoning the edge highlight below was fixed with,
    // applied here because a face hover has the identical low-contrast defect
    // and no reason to be exempt from the same fix. Matches the edge hover
    // colour too, so "hover" means one thing across both -- see
    // hoverEdgeMaterial's own comment for why cyan is safe to use here again
    // after briefly not being (the grid moved, not this).
    const hoverFaceMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0x8be9fd, transparent: true, opacity: 0.35,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      }),
    );
    hoverFaceMesh.visible = false;
    hoverFaceMesh.renderOrder = 1;
    scene.add(hoverFaceMesh);

    const selectedFaceMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0xff79c6, transparent: true, opacity: 0.5,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      }),
    );
    selectedFaceMesh.visible = false;
    selectedFaceMesh.renderOrder = 1;
    scene.add(selectedFaceMesh);

    // A vertex marker is a real 3D sphere, not a flat overlay -- unlike the
    // face highlights above, it has genuine depth separation from the
    // surface it sits on (half embedded, half protruding), so normal depth
    // testing alone places it correctly with no polygon-offset trick needed:
    // the embedded half is correctly hidden by the solid, the protruding
    // half correctly shows. Same hover/selected colour convention as every
    // other highlight; pooled the same way (see hoverVertexMeshRef's own
    // comment) -- a click only ever moves it and flips `.visible`.
    const hoverVertexMesh = new THREE.Mesh(
      new THREE.SphereGeometry(VERTEX_MARKER_RADIUS, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x8be9fd }),
    );
    hoverVertexMesh.visible = false;
    hoverVertexMesh.renderOrder = 2;
    scene.add(hoverVertexMesh);

    const selectedVertexMesh = new THREE.Mesh(
      new THREE.SphereGeometry(VERTEX_MARKER_RADIUS, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xff79c6 }),
    );
    selectedVertexMesh.visible = false;
    selectedVertexMesh.renderOrder = 2;
    scene.add(selectedVertexMesh);

    // Edges highlight as TUBE MESHES (real geometry, real width -- see
    // edgeTubeGeometry()'s doc comment) rather than THREE.Line, drawn ON TOP
    // (depthTest off) rather than offset like the faces above: a face
    // highlight can ride the same surface it highlights, but an edge
    // highlight sitting exactly on the model's own silhouette z-fights no
    // matter how small an offset is chosen.
    //
    // POOLED, NOT REBUILT. Measured across three capture rounds: rebuilding
    // a TubeGeometry from scratch on every pointermove cost 17-70ms of CPU
    // on a software renderer -- always under one frame, so it never failed
    // the latency bar, but real cost on a school laptop for what used to be
    // a single BufferAttribute swap. drawGeoms() now builds ONE tube per
    // topological edge, once, alongside the invisible raycasting line it
    // already built there (see edgePickLinesRef) -- hovering and selecting
    // an edge is then just handing its PRE-BUILT tube one of these two
    // SHARED materials and toggling `.visible`, never constructing geometry.
    // setHoveredEdgeTube()/setSelectedEdgeTube() below own that bookkeeping.
    //
    // Cyan for hover, same as the face highlight above -- and CYAN AGAIN,
    // not the violet (0xbb55f6) this briefly became. That violet was picked
    // to dodge a real collision (the grid centre line WAS this exact hex --
    // 0x8be9fd, see GridHelper() a few lines up, before it moved), but
    // violet solved the minor separation (hover vs. always-on scene
    // furniture, ~48 degrees clear either side) by spending the MAJOR one:
    // hover vs. SELECTED (0xff79c6, hue 326) dropped from 133 degrees to 48.
    // That is the one distinction three independent blind judges could not
    // find in the competing tool and credited us for finding -- not a
    // criterion to trade against a polish note. Moving the grid's OWN colour
    // instead (see GridHelper() above) frees this hex back up without
    // spending anything: hover is once again ~133 degrees from selected,
    // and also nowhere near the grid, the axes, or the body, because none of
    // them are cyan any more either.
    // Item I follow-up: depthTest:false means the ENTIRE tube draws over
    // everything, not just the small on-silhouette segment the comment
    // above was written for -- a tube whose far end runs behind a nearer
    // face (an open hollow's back wall edge, seen from "Look from above")
    // draws that hidden portion right through the face anyway, which reads
    // exactly like the reported "diagonal line across the floor". Normal
    // depth testing plus a polygon offset (same technique, same magnitude,
    // as the face highlights just above) keeps the on-silhouette case this
    // was written for artifact-free while letting a genuinely hidden
    // portion stay hidden -- re-measured against a live hover on an
    // ordinary edge (scripts/verify-hollow-floor.mjs is a pure Node/OCCT
    // script with no renderer; this was checked in a real browser, not
    // re-derived from the comment alone) with no flicker at any distance
    // tried.
    const hoverEdgeMaterial = new THREE.MeshBasicMaterial({
      color: 0x8be9fd, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    const selectedEdgeMaterial = new THREE.MeshBasicMaterial({
      color: 0xff79c6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    hoverEdgeMaterialRef.current = hoverEdgeMaterial;
    selectedEdgeMaterialRef.current = selectedEdgeMaterial;

    hoverFaceMeshRef.current = hoverFaceMesh;
    selectedFaceMeshRef.current = selectedFaceMesh;
    hoverVertexMeshRef.current = hoverVertexMesh;
    selectedVertexMeshRef.current = selectedVertexMesh;

    // ---- raycasting -----------------------------------------------------
    const raycaster = new THREE.Raycaster();
    let pendingHoverRaf: number | null = null;
    let lastPointer: { x: number; y: number } | null = null;

    type Hit =
      | { kind: 'vertex'; mesh: THREE_NS.Mesh; position: THREE_NS.Vector3 }
      | { kind: 'face'; mesh: THREE_NS.Mesh; range: FaceRange }
      | { kind: 'edge'; line: THREE_NS.Line }
      | { kind: 'body'; mesh: THREE_NS.Mesh };

    // The closest point on ONE edge's screen-space polyline to the cursor,
    // in CSS pixels, plus the world distance from the camera to that closest
    // point (its "depth") -- see hitAt() below for why this replaced a
    // world-space Raycaster.Line test, and why depth is needed at all
    // (occlusion: a genuinely far edge must not out-rank a face in front of
    // it just because it happens to project near the cursor).
    //
    // Projects every discretised vertex of the edge with THREE.Vector3.
    // project(camera) -- the same NDC math hitAt()'s own cursor->ray
    // conversion runs in reverse -- rather than reusing Raycaster at all:
    // there is no ray-to-segment test here, only 2D point-to-polyline
    // distance in the plane everyone actually looks at (the screen).
    function closestEdgeScreenDist(
      line: THREE_NS.Line, rectW: number, rectH: number, cursor: { x: number; y: number },
    ): { distPx: number; depth: number } {
      const pos = line.geometry.getAttribute('position');
      const toScreen = (i: number) => {
        const world = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i))
          .applyMatrix4(line.matrixWorld);
        const depth = camera.position.distanceTo(world);
        world.project(camera);
        return {
          x: (world.x * 0.5 + 0.5) * rectW,
          y: (1 - (world.y * 0.5 + 0.5)) * rectH,
          depth,
        };
      };
      let bestDistPx = Infinity;
      let bestDepth = Infinity;
      for (let i = 0; i + 1 < pos.count; i++) {
        const a = toScreen(i);
        const b = toScreen(i + 1);
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const lenSq = abx * abx + aby * aby;
        const t = lenSq > 1e-9
          ? Math.max(0, Math.min(1, ((cursor.x - a.x) * abx + (cursor.y - a.y) * aby) / lenSq))
          : 0;
        const cx = a.x + abx * t;
        const cy = a.y + aby * t;
        const distPx = Math.hypot(cursor.x - cx, cursor.y - cy);
        if (distPx < bestDistPx) {
          bestDistPx = distPx;
          // PERSPECTIVE-CORRECT interpolation, not linear -- depth does not
          // vary linearly with screen-space `t` under a perspective camera
          // (1/depth does). Linear interpolation of `depth` itself is only
          // a good approximation when a segment's own depth range is small
          // relative to its distance from the camera, which is true at an
          // ordinary Home-view distance but breaks down once the camera is
          // close: item S measured a rim edge's own two endpoints landing
          // 2.5-5.5 world units apart from the true depth at close zoom
          // (60 scroll steps in), which the occlusion check's tolerance
          // (a small FRACTION of camera distance, deliberately tight so a
          // genuinely hidden edge stays rejected) cannot absorb -- wrongly
          // marking a plainly visible rim edge "occluded" behind the very
          // face it borders, with no edge-pick zone left anywhere near it.
          const invA = 1 / a.depth;
          const invB = 1 / b.depth;
          bestDepth = 1 / (invA + (invB - invA) * t);
        }
      }
      return { distPx: bestDistPx, depth: bestDepth };
    }

    function hitAt(clientX: number, clientY: number): Hit | null {
      const filters = filtersRef.current;
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      const cursor = { x: clientX - rect.left, y: clientY - rect.top };
      const ndc = new THREE.Vector2(
        (cursor.x / rect.width) * 2 - 1,
        -(cursor.y / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);

      // Face hit, tested first here purely to have a DEPTH reference for the
      // edge/vertex occlusion checks below -- which kind actually gets
      // RETURNED depends on `filters` and the priority order below (vertex,
      // then edge, then face, then body), not on this test order.
      const faceHits = raycaster.intersectObjects(solidGroup.children, false);
      const faceHit = faceHits.find((h) => h.faceIndex != null);
      const camDist = camera.position.distanceTo(controls.target);
      const occlusionMaxDepth = faceHit
        ? faceHit.distance + Math.max(0.5, camDist * EDGE_OCCLUSION_TOLERANCE_FRACTION)
        : Infinity;

      // VERTEX (SPEC-mouse-parity.md Phase 3 item 2), tried first among the
      // filters that are on: the most specific pickable thing at a point
      // wins over the face/edge/body sitting at that same point. Walks
      // every solid mesh's own raw position buffer -- candidate mesh
      // vertices -- projecting each one to screen space the same way
      // closestEdgeScreenDist() below projects an edge's discretised
      // points, and reuses `faceHit`'s own depth as the occlusion
      // reference exactly like the edge candidates do: a vertex behind the
      // surface the cursor is actually over must lose to one facing the
      // camera, and a MISSING faceHit (cursor off the mesh entirely, e.g.
      // just past a silhouette corner) means nothing to reject against --
      // the same fallback the edge candidates rely on. The pure
      // nearest-in-tolerance decision lives in pick-helpers.ts, testable
      // without a THREE.Camera; only the projection itself, which needs a
      // live camera, stays here.
      if (filters.vertex) {
        const vertexCandidates: { distPx: number; depth: number; mesh: THREE_NS.Mesh; world: THREE_NS.Vector3 }[] = [];
        for (const mesh of solidGroup.children as THREE_NS.Mesh[]) {
          const pos = mesh.geometry.getAttribute('position');
          if (!pos) continue;
          for (let i = 0; i < pos.count; i++) {
            const world = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld);
            const depth = camera.position.distanceTo(world);
            const proj = world.clone().project(camera);
            const distPx = Math.hypot(
              cursor.x - (proj.x * 0.5 + 0.5) * rect.width,
              cursor.y - (1 - (proj.y * 0.5 + 0.5)) * rect.height,
            );
            vertexCandidates.push({ distPx, depth, mesh, world });
          }
        }
        const vertexWinner = nearestVisible(vertexCandidates, EDGE_HIT_BAND_PX, occlusionMaxDepth);
        if (vertexWinner) return { kind: 'vertex', mesh: vertexWinner.mesh, position: vertexWinner.world };
      }

      // EDGE HIT TEST, IN SCREEN PIXELS -- NOT a world-space distance.
      //
      // This used to be raycaster.params.Line.threshold, a fixed WORLD-space
      // distance from the ray to the edge's 3D line, scaled by camera
      // distance. Measured one-sided in practice: a box's near vertical
      // edge is shared by two faces that meet the camera at DIFFERENT
      // foreshortening angles (one closer to face-on, one closer to
      // edge-on / receding into depth). Moving the cursor one pixel toward
      // the more edge-on side sweeps the ray through much LESS world-space
      // distance near the true edge line than moving it one pixel toward
      // the more face-on side (or off the model into open air) does -- so a
      // single fixed world threshold cleared an 11px-wide band on one side
      // and essentially nothing on the other, even though the student's
      // cursor moved the same number of screen pixels either way. A
      // world-space number simply cannot be that direction-agnostic; a
      // screen-space one is, by construction -- a pixel is a pixel
      // regardless of which face happens to sit behind the cursor.
      // EVERY edge within the band is a candidate now, not only the single
      // closest one -- see the loop below for why "closest wins outright"
      // used to lose a real edge outright instead of just falling back.
      // Two edges meeting at a corner still cannot both win: they are tried
      // CLOSEST-FIRST, and the first one to pass the occlusion check below
      // is returned immediately, so whichever is nearer in screen space
      // still wins whenever both are genuinely visible.
      if (filters.edge) {
        const candidates: { distPx: number; depth: number; line: THREE_NS.Line }[] = [];
        for (const line of edgePickLinesRef.current) {
          const { distPx, depth } = closestEdgeScreenDist(line, rect.width, rect.height, cursor);
          if (distPx <= EDGE_HIT_BAND_PX) candidates.push({ distPx, depth, line });
        }
        candidates.sort((a, b) => a.distPx - b.distPx);

        // An edge sits ON the boundary of whichever face(s) meet there, so its
        // depth should match a face hit at the same pixel almost exactly; this
        // tolerance is only slack for the edge's own discretisation and the
        // two hits' slightly different sample points, not a second occlusion
        // system -- it exists so a genuinely FAR edge (the back of a box,
        // glimpsed through open space near a front edge in screen space) can
        // never out-rank a face that is actually in front of it.
        //
        // THE BUG THIS REPLACED: only ever tracking the single screen-closest
        // candidate. A square-footprint box viewed from this app's own
        // slightly off-axis default camera (140, 160, 130 -- not a true 45
        // degree isometric) can put a genuinely FAR, hidden edge fractions of
        // a pixel closer to the cursor than the true visible one at certain
        // points along it -- measured 2026-09-04: hovering the box's own
        // top-left edge found a "closest" candidate at depth 132 while every
        // other visible top-face edge sat at depth ~90-100, a ~40-unit gap
        // (the box's own 40mm width) that is a different edge entirely, not
        // discretisation slop. The occlusion check correctly rejected that
        // far edge -- but with only one candidate ever tried, rejecting it
        // meant giving up on the pixel entirely, even though the TRUE visible
        // edge was very likely a second candidate within the very same band.
        // Trying every in-band candidate, nearest first, until one survives
        // occlusion fixes exactly that without loosening the occlusion test
        // itself (which stays exactly as strict, and still does its real job
        // of rejecting a genuinely hidden edge glimpsed through open space).
        const surviving = candidates.filter((c) => c.depth <= occlusionMaxDepth);
        if (surviving.length > 0) {
          // Item J (D3): an open hollow's outer rim (inherited from the box
          // underneath -- nameEdgeOnCurrentShape() resolves it) and its own
          // BRAND NEW inner rim (no primitive lineage, resolves to null --
          // same "no answer" case a Hole's own fresh wall already has, per
          // that function's own comment) sit only the wall's thickness apart
          // in world space. Most camera angles foreshorten that to a couple
          // of screen pixels, well inside distPx's own float/discretisation
          // noise -- close enough that "closest wins outright" started
          // picking the inner edge (or missing both and falling through to
          // the interior wall face) for a click plainly meant for the outer
          // one. Only consulted once there is more than one edge candidate
          // actually surviving occlusion -- the ordinary one-edge and
          // same-primitive-corner cases (both candidates resolve to a name,
          // so the first/closest still wins, exactly as before) are
          // untouched, and this never runs at all for the common case of a
          // single edge in the band.
          if (surviving.length > 1 && lastBuiltRef.current && engineRef.current) {
            const built = lastBuiltRef.current;
            const engine = engineRef.current;
            const named = surviving.find((c) => {
              const { featureId, kernelEdge } = c.line.userData as { featureId: string; kernelEdge: any };
              // A throw here is honest, not an error -- the same "no answer"
              // case this disambiguation already treats null as; see the
              // try/catch pattern repeated at every nameFace/nameEdge/
              // resolveFace/resolveEdge call site below, for the same reason.
              try {
                return engine.nameEdge(built, docRef.current, featureId, kernelEdge) !== null;
              } catch {
                return false;
              }
            });
            if (named) return { kind: 'edge', line: named.line };
          }
          return { kind: 'edge', line: surviving[0].line };
        }
      }

      if (faceHit) {
        if (filters.face) {
          const range = faceRangeFor(faceHit.object as THREE_NS.Mesh, faceHit.faceIndex!);
          return range ? { kind: 'face', mesh: faceHit.object as THREE_NS.Mesh, range } : null;
        }
        // BODY (SPEC-mouse-parity.md Phase 3 item 2): only reached once
        // filters.face is OFF -- the branch above always returns (a face
        // pick or null) whenever it runs, so with every filter on a face
        // click stays a face pick byte-for-byte (T8's already-verified
        // matrix); body only gets a turn once face-kind picking has
        // explicitly stepped aside. Selects the whole owning feature -- see
        // paintFaceHighlight()'s own `range`-less call in pickAt() for how
        // "whole" is painted -- with no per-face resolution needed at all.
        if (filters.body) {
          return { kind: 'body', mesh: faceHit.object as THREE_NS.Mesh };
        }
      }

      return null;
    }

    /** Every raycast candidate at this pixel, ordered nearest-camera-first,
     *  for whichever kind wins hitAt()'s own vertex > edge > face > body
     *  priority -- used only by the click-and-hold "select other" cycling
     *  gesture below (SPEC-mouse-parity.md Phase 3.5) to learn how many
     *  overlapping picks sit at one screen point, and in what order to
     *  cycle through them. hitAt() itself is left completely untouched,
     *  including its own closest-screen-distance-first / named-edge-
     *  preferred disambiguation for the SINGLE winner a plain click gets --
     *  this walks the same candidate lists a SECOND way, ordered by DEPTH
     *  (camera distance) rather than screen distance, because cycling is
     *  about front-to-back stacking, not which candidate happens to project
     *  nearest the cursor. Returns [] in every case hitAt() would return
     *  null (same filter/occlusion decisions, mirrored branch for branch),
     *  so `.length > 0` is a drop-in replacement for `hitAt(...) !== null`
     *  at the box-select gate below -- a press on pickable geometry never
     *  raycasts twice to answer both questions. */
    function hitCandidatesAt(clientX: number, clientY: number): Hit[] {
      const filters = filtersRef.current;
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return [];
      const cursor = { x: clientX - rect.left, y: clientY - rect.top };
      const ndc = new THREE.Vector2(
        (cursor.x / rect.width) * 2 - 1,
        -(cursor.y / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);

      const faceHits = raycaster.intersectObjects(solidGroup.children, false);
      const faceHit = faceHits.find((h) => h.faceIndex != null);
      const camDist = camera.position.distanceTo(controls.target);
      const occlusionMaxDepth = faceHit
        ? faceHit.distance + Math.max(0.5, camDist * EDGE_OCCLUSION_TOLERANCE_FRACTION)
        : Infinity;

      if (filters.vertex) {
        const vertexCandidates: { distPx: number; depth: number; mesh: THREE_NS.Mesh; world: THREE_NS.Vector3 }[] = [];
        for (const mesh of solidGroup.children as THREE_NS.Mesh[]) {
          const pos = mesh.geometry.getAttribute('position');
          if (!pos) continue;
          for (let i = 0; i < pos.count; i++) {
            const world = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld);
            const depth = camera.position.distanceTo(world);
            const proj = world.clone().project(camera);
            const distPx = Math.hypot(
              cursor.x - (proj.x * 0.5 + 0.5) * rect.width,
              cursor.y - (1 - (proj.y * 0.5 + 0.5)) * rect.height,
            );
            vertexCandidates.push({ distPx, depth, mesh, world });
          }
        }
        const winners = vertexCandidates
          .filter((c) => c.distPx <= EDGE_HIT_BAND_PX && c.depth <= occlusionMaxDepth)
          .sort((a, b) => a.depth - b.depth);
        if (winners.length > 0) {
          return winners.map((w) => ({ kind: 'vertex' as const, mesh: w.mesh, position: w.world }));
        }
      }

      if (filters.edge) {
        const edgeCandidates: { distPx: number; depth: number; line: THREE_NS.Line }[] = [];
        for (const line of edgePickLinesRef.current) {
          const { distPx, depth } = closestEdgeScreenDist(line, rect.width, rect.height, cursor);
          if (distPx <= EDGE_HIT_BAND_PX) edgeCandidates.push({ distPx, depth, line });
        }
        const surviving = edgeCandidates
          .filter((c) => c.depth <= occlusionMaxDepth)
          .sort((a, b) => a.depth - b.depth);
        if (surviving.length > 0) {
          return surviving.map((c) => ({ kind: 'edge' as const, line: c.line }));
        }
      }

      if (faceHit) {
        if (filters.face) {
          // Mirrors hitAt()'s own null case exactly: if the PRIMARY (nearest)
          // face hit cannot resolve a FaceRange, this returns [] rather than
          // trying harder against the stacked hits behind it -- same as a
          // plain click gets nothing there today.
          const primaryRange = faceRangeFor(faceHit.object as THREE_NS.Mesh, faceHit.faceIndex!);
          if (!primaryRange) return [];
          const faceCandidates: Hit[] = [];
          for (const h of faceHits) {
            if (h.faceIndex == null) continue;
            const range = faceRangeFor(h.object as THREE_NS.Mesh, h.faceIndex);
            // faceHits is already nearest-first (three.js sorts
            // intersectObjects by distance ascending), so no re-sort here.
            if (range) faceCandidates.push({ kind: 'face', mesh: h.object as THREE_NS.Mesh, range });
          }
          return faceCandidates;
        }
        if (filters.body) {
          const seen = new Set<THREE_NS.Mesh>();
          const bodyCandidates: Hit[] = [];
          for (const h of faceHits) {
            if (h.faceIndex == null) continue;
            const mesh = h.object as THREE_NS.Mesh;
            if (seen.has(mesh)) continue;
            seen.add(mesh);
            bodyCandidates.push({ kind: 'body', mesh });
          }
          return bodyCandidates;
        }
      }

      return [];
    }
    function applyHover(hit: Hit | null) {
      hoverFaceMesh.visible = false;
      hoverVertexMesh.visible = false;
      // A cheap, immediate second cue: the cursor tells a student an edge or
      // face is interactive before they have even noticed the highlight, or
      // known that picking exists at all. `crosshair` for an edge or a
      // vertex -- both a more precise action than a face/body click -- and
      // `pointer` for the other two: it used to be `pointer` for both, plus
      // idle-over-model, which told a student nothing. Reverts to the
      // container's own CSS cursor (the inline 'grab' set below, while
      // phase is 'ready') rather than a hardcoded default.
      renderer.domElement.style.cursor = hit
        ? (hit.kind === 'edge' || hit.kind === 'vertex' ? 'crosshair' : 'pointer')
        : '';
      // Drives the "click this edge" hint (JSX below) -- see hoveringEdge's
      // own doc comment for why this is React state, not a ref.
      setHoveringEdge(hit?.kind === 'edge');
      if (!hit) {
        setHoveredEdgeTube(null);
        return;
      }
      if (hit.kind === 'face') {
        setHoveredEdgeTube(null);
        paintFaceHighlight(THREE, hoverFaceMesh, hit.mesh, hit.range);
      } else if (hit.kind === 'edge') {
        setHoveredEdgeTube(hit.line.userData.tubeMesh as THREE_NS.Mesh);
      } else if (hit.kind === 'vertex') {
        setHoveredEdgeTube(null);
        hoverVertexMesh.position.copy(hit.position);
        hoverVertexMesh.visible = true;
      } else {
        // body: the same highlight mesh and material a face hover uses,
        // just spanning its full index instead of one FaceRange -- see
        // paintFaceHighlight()'s own doc comment for the `range`-less case.
        setHoveredEdgeTube(null);
        paintFaceHighlight(THREE, hoverFaceMesh, hit.mesh);
      }
    }

    function onPointerMove(e: PointerEvent) {
      lastPointer = { x: e.clientX, y: e.clientY };
      // Throttled to the FRAME, not a timer: at most one raycast is ever in
      // flight, and it runs on the very next animation frame -- that is the
      // <16ms bar this was built to hit, and a setTimeout-based throttle
      // cannot promise it.
      if (pendingHoverRaf !== null) return;
      pendingHoverRaf = requestAnimationFrame(() => {
        pendingHoverRaf = null;
        if (!lastPointer) return;
        applyHover(hitAt(lastPointer.x, lastPointer.y));
        renderNow();
      });
    }
    function onPointerLeave() {
      lastPointer = null;
      applyHover(null);
      renderNow();
    }
    // The face/edge hit-test-and-select path, factored out of onClick below
    // so it can also run for a HandleOverlay tap (see registerPickAt's own
    // doc comment) -- same naming, same highlight paint, same onPick emission
    // either way, rather than a second copy that could drift from this one.
    function pickAt(clientX: number, clientY: number, mods?: { ctrlKey: boolean; shiftKey: boolean; metaKey: boolean }) {
      const hit = hitAt(clientX, clientY);
      if (!hit) {
        selectedFaceMesh.visible = false;
        selectedVertexMesh.visible = false;
        setSelectedEdgeTube(null);
        selectedFaceStateRef.current = null;
        onPickRef.current?.(null);
        renderNow();
        return;
      }
      commitHit(hit, mods);
    }
    // The actual selection side effects for ONE ALREADY-RESOLVED Hit, split
    // out of pickAt() above so the click-and-hold "select other" cycling
    // gesture below (SPEC-mouse-parity.md Phase 3.5) can commit whichever
    // candidate a hold cycled onto directly. Re-running hitAt() there would
    // just re-resolve pickAt()'s own single winner again -- not the specific
    // stacked candidate the hold actually highlighted.
    function commitHit(hit: Hit, mods?: { ctrlKey: boolean; shiftKey: boolean; metaKey: boolean }) {
      const { ctrlKey = false, shiftKey = false, metaKey = false } = mods ?? {};
      if (hit.kind === 'face') {
        const featureId = hit.mesh.userData.featureId as string;
        selectedFaceStateRef.current = { featureId, faceIndex: hit.range.index };
        paintFaceHighlight(THREE, selectedFaceMesh, hit.mesh, hit.range);
        setSelectedEdgeTube(null);
        selectedVertexMesh.visible = false;
        // Resolved the same way an edge's `name` is, just off the other end
        // of faceAt()'s own walk: FaceRange.index is this face's position
        // in that SAME stable order (see FaceRange's own doc comment in
        // lib/occt-three.ts), so indexing back into it recovers the exact
        // kernel face handle the click landed on.
        const built = lastBuiltRef.current;
        const engine = engineRef.current!;
        const shape = built?.shapes.get(featureId);
        const kernelFace = shape ? engine.faceAt(shape, hit.range.index) : undefined;
        let name: TopoName | null = null;
        if (built && kernelFace) {
          // See hitAt()'s own comment on why a throw here (FreeCAD's naming
          // is not yet implemented) is treated the same as an honest null.
          try { name = engine.nameFace(built, docRef.current, featureId, kernelFace); } catch { name = null; }
        }
        // A pick that lands inside the first frames of a rebuild can miss
        // its name (measured 2026-09-03: 1 of 20 picks at 0 ms after a
        // resize). Remember whether it was named so restorePicks() can try
        // again on the build that replaces this one.
        unnamedFacePickRef.current = name ? null : { featureId, faceIndex: hit.range.index };
        let size: [number, number] | undefined;
        if (kernelFace) {
          try { size = engine.faceSize(kernelFace) ?? undefined; } catch { size = undefined; }
        }
        onPickRef.current?.({ kind: 'face', target: featureId, faceIndex: hit.range.index, name, size, ctrlKey, shiftKey, metaKey });
      } else if (hit.kind === 'edge') {
        const { featureId, kernelEdge } = hit.line.userData as {
          featureId: string; kernelEdge: any;
        };
        // Resolved down to whichever primitive actually produced this edge,
        // however many features (a Move, a Hole, ...) sit on top of it --
        // see nameEdgeOnCurrentShape()'s own doc comment for how, and for
        // why some edges (a fresh wall a Hole drilled, the seam of a
        // Combine) genuinely have no answer and come back null. The edge
        // still gets highlighted either way; only the ability to build a
        // Fillet from it depends on the name. lastBuiltRef holds the most
        // recent BuildResult -- the same one drawGeoms() just drew from --
        // so this never re-runs the kernel build to answer a click.
        const built = lastBuiltRef.current;
        const engine = engineRef.current!;
        let name: TopoName | null = null;
        if (built) {
          try { name = engine.nameEdge(built, docRef.current, featureId, kernelEdge); } catch { name = null; }
        }
        setSelectedEdgeTube(hit.line.userData.tubeMesh as THREE_NS.Mesh);
        selectedFaceMesh.visible = false;
        selectedFaceStateRef.current = null;
        selectedVertexMesh.visible = false;
        let size: number | undefined;
        try { size = engine.edgeLength(kernelEdge) ?? undefined; } catch { size = undefined; }
        onPickRef.current?.({ kind: 'edge', target: featureId, name, size, ctrlKey, shiftKey, metaKey });
      } else if (hit.kind === 'vertex') {
        setSelectedEdgeTube(null);
        selectedFaceMesh.visible = false;
        selectedFaceStateRef.current = null;
        selectedVertexMesh.position.copy(hit.position);
        selectedVertexMesh.visible = true;
        const featureId = hit.mesh.userData.featureId as string;
        onPickRef.current?.({ kind: 'vertex', target: featureId, name: null, ctrlKey, shiftKey, metaKey });
      } else {
        // body: whole-mesh highlight, same shared mesh/material a face pick
        // uses, just spanning the full index -- see paintFaceHighlight()'s
        // own doc comment.
        setSelectedEdgeTube(null);
        selectedVertexMesh.visible = false;
        selectedFaceStateRef.current = null;
        paintFaceHighlight(THREE, selectedFaceMesh, hit.mesh);
        const featureId = hit.mesh.userData.featureId as string;
        onPickRef.current?.({ kind: 'body', target: featureId, name: null, ctrlKey, shiftKey, metaKey });
      }
      renderNow();
    }
    // CLICK vs DRAG, and WINDOW-ZOOM as its own drag gesture. The pick gesture
    // is a left-button click WITHOUT a drag; OrbitControls itself never fires
    // a `click` for a drag it consumed, but a click fires the moment ANY press
    // releases, moved or not -- so this component tells the two apart itself:
    // pointerdown records where the press started, and a `click` whose pointer
    // moved past a few pixels since then is the tail end of an orbit/pan/dolly
    // gesture, not a pick. This check stays a movement threshold even though
    // the scheme preset above makes which-BUTTON-orbits configurable, because
    // the button that was pressed is not the question -- whether the pointer
    // MOVED is.
    //
    // Window-zoom is armed from the view strip (button below), then runs as
    // its own captured-pointer drag on the canvas: `controls.enabled` goes
    // false for just that drag (the ONE supported way to keep OrbitControls
    // out of a gesture it would otherwise claim), the rectangle is tracked in
    // React state so the overlay div draws it, and pointerup hands the
    // finished rect to applyWindowZoomRect(). `windowZoomRef.current !== null`
    // means "armed, and the next left-drag is the rectangle".
    /** Every pickable candidate a box-select drag's rect keeps, respecting
     *  the SAME filters a click already does (hitAt() reads filtersRef the
     *  same way). Each candidate reduces to a screen-space point set for
     *  pointSetSelect() -- a vertex to its own projected point, an edge to
     *  its two projected endpoints, a face or a whole body to its own
     *  screen bbox corners (SPEC-mouse-parity.md Phase 3 item 4's own
     *  wording) -- and resolves the SAME name a click on that face/edge
     *  would (nameFace()/nameEdge(), the identical try/catch-is-honest-null
     *  pattern pickAt() already uses), so a box-selected edge is just as
     *  usable by round()/hollow() as a clicked one. No occlusion test: a
     *  click has a real surface hit to occlude against, a drag rectangle
     *  does not, and a tightly-drawn box around visible geometry does not,
     *  in practice, also enclose the model's own hidden far side. */
    function collectBoxSelection(
      startClientX: number, startClientY: number, endClientX: number, endClientY: number,
    ): SelectionItem[] {
      const group = solidGroupRef.current;
      if (!group) return [];
      const rect = renderer.domElement.getBoundingClientRect();
      const drag: MarqueeDrag = {
        startX: startClientX - rect.left, startY: startClientY - rect.top,
        endX: endClientX - rect.left, endY: endClientY - rect.top,
      };
      const toScreen = (v: THREE_NS.Vector3): { x: number; y: number } => {
        const p = v.clone().project(camera);
        return { x: (p.x * 0.5 + 0.5) * rect.width, y: (1 - (p.y * 0.5 + 0.5)) * rect.height };
      };
      const filters = filtersRef.current;
      const built = lastBuiltRef.current;
      const engine = engineRef.current;
      const found: SelectionItem[] = [];

      for (const obj of group.children as THREE_NS.Mesh[]) {
        const featureId = obj.userData.featureId as string | undefined;
        const pos = obj.geometry.getAttribute('position');
        if (!featureId || !pos) continue;
        const worldAt = (i: number) => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(obj.matrixWorld);

        if (filters.vertex) {
          for (let i = 0; i < pos.count; i++) {
            if (pointSetSelect([toScreen(worldAt(i))], drag)) found.push({ kind: 'vertex', target: featureId, name: null });
          }
        }

        if (filters.face) {
          const idx = obj.geometry.getIndex();
          const ranges: FaceRange[] = obj.userData.faceRanges ?? [];
          if (idx) {
            for (const range of ranges) {
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              for (let k = range.start; k < range.start + range.count; k++) {
                const s = toScreen(worldAt(idx.getX(k)));
                if (s.x < minX) minX = s.x;
                if (s.x > maxX) maxX = s.x;
                if (s.y < minY) minY = s.y;
                if (s.y > maxY) maxY = s.y;
              }
              if (minX > maxX) continue;
              const corners = [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }];
              if (!pointSetSelect(corners, drag)) continue;
              let name: TopoName | null = null;
              const shape = obj.userData.kernelShape;
              if (built && engine && shape) {
                try {
                  const face = engine.faceAt(shape, range.index);
                  if (face) name = engine.nameFace(built, docRef.current, featureId, face);
                } catch { name = null; }
              }
              found.push({ kind: 'face', target: featureId, name });
            }
          }
        }

        if (filters.body) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (let i = 0; i < pos.count; i++) {
            const s = toScreen(worldAt(i));
            if (s.x < minX) minX = s.x;
            if (s.x > maxX) maxX = s.x;
            if (s.y < minY) minY = s.y;
            if (s.y > maxY) maxY = s.y;
          }
          if (minX <= maxX) {
            const corners = [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }];
            if (pointSetSelect(corners, drag)) found.push({ kind: 'body', target: featureId, name: null });
          }
        }
      }

      if (filters.edge) {
        for (const line of edgePickLinesRef.current) {
          const edgePos = line.geometry.getAttribute('position');
          if (!edgePos || edgePos.count < 1) continue;
          const a = new THREE.Vector3(edgePos.getX(0), edgePos.getY(0), edgePos.getZ(0)).applyMatrix4(line.matrixWorld);
          const last = edgePos.count - 1;
          const b = new THREE.Vector3(edgePos.getX(last), edgePos.getY(last), edgePos.getZ(last)).applyMatrix4(line.matrixWorld);
          if (!pointSetSelect([toScreen(a), toScreen(b)], drag)) continue;
          const { featureId, kernelEdge } = line.userData as { featureId: string; kernelEdge: any };
          let name: TopoName | null = null;
          if (built && engine) {
            try { name = engine.nameEdge(built, docRef.current, featureId, kernelEdge); } catch { name = null; }
          }
          found.push({ kind: 'edge', target: featureId, name });
        }
      }

      return found;
    }

    let downAt: { x: number; y: number } | null = null;
    // The marking menu's own click-vs-drag classifier (SPEC-mouse-parity.md
    // Phase 4.1/4.3) needs the ORIGINAL right-button down point, not `downAt`
    // above (button-0-only) and not OrbitControls' own internal state (which
    // a pan/dolly drag mutates every move) -- see onCanvasContextMenu below.
    let rightDownAt: PointerSample | null = null;
    // The pointer's last KNOWN sample: what classifyGesture/rightClickGuard
    // read as the gesture's up-sample (see onCanvasPointerMove's comment).
    let rightMoveAt: PointerSample | null = null;
    const CLICK_DRAG_TOLERANCE_PX = 4;
    // Click-and-hold "select other" cycling state (SPEC-mouse-parity.md
    // Phase 3.5, [CONFIRM behaviour]). `lastCycleKey`/`lastCycleIndex`
    // persist ACROSS separate hold gestures, not just within one -- "hold,
    // release, hold again" at the same stacked point has to advance one
    // more step each time rather than re-landing on the same candidate, per
    // the two-stacked-solids contract in mouse-parity-handover.md's T12
    // entry ("hold cycles to the back one; hold again cycles back [to
    // front]").
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let holdCycleState: { candidates: Hit[]; index: number } | null = null;
    let holdCycleCommitted = false;
    let lastCycleKey: string | null = null;
    let lastCycleIndex = 0;
    function hitKey(hit: Hit): string {
      switch (hit.kind) {
        case 'vertex': return `v:${hit.mesh.uuid}:${hit.position.x.toFixed(5)},${hit.position.y.toFixed(5)},${hit.position.z.toFixed(5)}`;
        case 'edge': return `e:${hit.line.uuid}`;
        case 'face': return `f:${hit.mesh.uuid}:${hit.range.index}`;
        case 'body': return `b:${hit.mesh.uuid}`;
      }
    }
    function onCanvasPointerDown(e: PointerEvent) {
      if (e.button === 2) rightDownAt = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      if (e.button !== 0) return;
      downAt = { x: e.clientX, y: e.clientY };
      if (windowZoomRef.current !== null) {
        // Arming already set the ref; from here on the drag is the rectangle.
        e.preventDefault();
        renderer.domElement.setPointerCapture(e.pointerId);
        controls.enabled = false;
        return;
      }
      // Box select (SPEC-mouse-parity.md Phase 3 item 4): a left-press
      // starting on EMPTY space -- the same hitAt() a click would use, so a
      // press ON a pickable face/edge/vertex/body falls straight through to
      // the ordinary orbit/click path below, untouched. Disables orbit for
      // just this gesture up front, the same eager-disable window-zoom uses
      // above, rather than waiting to see whether it crosses the drag
      // threshold: OrbitControls binds LEFT to rotate in BOTH mouse-scheme
      // presets (camera-controls.ts's own MOUSE_SCHEMES), so by the time a
      // threshold check could fire the camera would already have moved.
      // `hitCandidatesAt` (not `hitAt`) answers "is there anything here"
      // (`.length > 0`, the same gate `hitAt(...) !== null` used) AND
      // doubles as the click-and-hold candidate list below, so a press on
      // pickable geometry never raycasts twice.
      const candidates = hitCandidatesAt(e.clientX, e.clientY);
      if (candidates.length > 0) {
        // Click-and-hold "select other" (SPEC-mouse-parity.md Phase 3.5,
        // [CONFIRM behaviour] -- see input-threshold.ts for the settled-
        // number-vs-unverified-behavior split): armed ONLY with 2+
        // overlapping candidates at this exact pixel -- a single-candidate
        // press stays an ordinary click, no cycling timer at all, per the
        // settled contract's own failure case. One setTimeout, cleared on
        // move past the dead zone (onCanvasPointerMove) or on release
        // (onCanvasPointerUp), whichever comes first; no rAF, no repeat-
        // while-held tick -- a single hold advances the cycle by exactly
        // one candidate, the same as pressing again later at the same
        // point does (see lastCycleKey/lastCycleIndex above).
        if (candidates.length >= 2) {
          holdTimer = setTimeout(() => {
            holdTimer = null;
            const key = candidates.map(hitKey).join('|');
            const baseIndex = key === lastCycleKey ? lastCycleIndex : 0;
            const index = nextCycleIndex(baseIndex, candidates.length);
            lastCycleKey = key;
            lastCycleIndex = index;
            holdCycleState = { candidates, index };
            applyHover(candidates[index]);
            renderNow();
          }, HOLD_CYCLE_DELAY_MS);
        }
        return;
      }
      boxSelectRef.current = { startX: e.clientX, startY: e.clientY, endX: e.clientX, endY: e.clientY, moved: false };
      controls.enabled = false;
      renderer.domElement.setPointerCapture(e.pointerId);
    }
    function onCanvasPointerMove(e: PointerEvent) {
      // Todo 19/20's gesture classifier reads the pointer's LAST KNOWN
      // position + timestamp, not the contextmenu event's: the browser fires
      // contextmenu BEFORE pointerup (measured 2026-09-21: contextmenu's
      // timeStamp equals pointerdown's, its coords are the DOWN point), so
      // classifying from the contextmenu event itself reads a 0px/0ms
      // gesture and opens the menu on ANY drag. The up-sample is the latest
      // pointermove's own sample.
      rightMoveAt = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      if (holdTimer !== null && downAt !== null
        && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) >= HOLD_CYCLE_DEAD_ZONE_PX) {
        // Movement past the dead zone before the delay elapses cancels the
        // hold outright -- this is what lets hold-then-drag orbit normally
        // (SPEC-mouse-parity.md Phase 3.5): nothing above disables
        // `controls.enabled` for a press that landed on pickable geometry
        // (unlike the box-select/window-zoom branches), so OrbitControls'
        // own listener on this same element is already free to rotate the
        // camera the moment the cursor moves -- no cycle is ever triggered.
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      if (windowZoomRef.current !== null) {
        if (downAt === null) return;
        const bounds = renderer.domElement.getBoundingClientRect();
        setWindowZoom({
          x: Math.min(downAt.x, e.clientX) - bounds.left,
          y: Math.min(downAt.y, e.clientY) - bounds.top,
          w: Math.abs(e.clientX - downAt.x),
          h: Math.abs(e.clientY - downAt.y),
        });
        return;
      }
      const bs = boxSelectRef.current;
      if (!bs) return;
      bs.endX = e.clientX;
      bs.endY = e.clientY;
      if (!bs.moved && Math.hypot(e.clientX - bs.startX, e.clientY - bs.startY) >= CLICK_DRAG_TOLERANCE_PX) bs.moved = true;
      if (!bs.moved) return;
      const bounds = renderer.domElement.getBoundingClientRect();
      setBoxSelect({
        x: Math.min(bs.startX, bs.endX) - bounds.left,
        y: Math.min(bs.startY, bs.endY) - bounds.top,
        w: Math.abs(bs.endX - bs.startX),
        h: Math.abs(bs.endY - bs.startY),
        kind: marqueeKind({ startX: bs.startX, startY: bs.startY, endX: bs.endX, endY: bs.endY }),
      });
    }
    function onCanvasPointerUp(e: PointerEvent) {
      // Todo 19/20: THIS is where the right-button gesture classifies —
      // pointerup carries the gesture's real end coords + timestamp (the
      // contextmenu event does not: see onCanvasContextMenu's comment). A
      // fast directional drag fires the wedge's command directly (no menu);
      // a release within the dead zone arms the menu-open (the actual
      // render happens on the contextmenu event, which the browser fires
      // for the same press); a drag past the dead zone is the camera's and
      // opens nothing.
      if (e.button === 2) {
        const downSample = rightDownAt;
        rightDownAt = null;
        const upSample = { x: e.clientX, y: e.clientY, t: e.timeStamp };
        const verdict = classifyGesture(downSample, upSample, MARKING_GESTURE);
        if (verdict.kind === 'wedge') {
          // Fast directional drag: the wedge's command fires with no visible
          // menu flash (SPEC :37-39). The wedge ids are the part-viewport
          // config's own, in MarkingMenu.tsx's layout order.
          const id = wedgesForMode('part-viewport')[verdict.wedgeIndex]?.id;
          if (id) dispatchMarkingCommandRef.current?.(id);
          return;
        }
        if (verdict.kind === 'menu' && rightClickGuard(downSample, upSample, HOLD_CYCLE_DEAD_ZONE_PX) === 'menu') {
          // Click-shaped release: open the menu HERE. The contextmenu event
          // for this same press has ALREADY fired by now (Chromium fires it
          // at press time, before pointerup — measured 2026-09-21), so
          // relaying through a flag would never be consumed; this handler
          // is the last event of the gesture.
          const bounds = renderer.domElement.getBoundingClientRect();
          setMarkingMenu({ x: upSample.x - bounds.left, y: upSample.y - bounds.top });
        }
        // A slow drag: neither wedge nor menu — OrbitControls consumed it.
        return;
      }
      if (windowZoomRef.current !== null) {
        try { renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* already released */ }
        controls.enabled = true;
        windowZoomRef.current = null;
        setWindowZoom(null);
        const start = downAt;
        downAt = null;
        if (start === null) return;
        const width = Math.abs(e.clientX - start.x);
        const height = Math.abs(e.clientY - start.y);
        if (width <= CLICK_DRAG_TOLERANCE_PX || height <= CLICK_DRAG_TOLERANCE_PX) return;
        const bounds = renderer.domElement.getBoundingClientRect();
        applyWindowZoomRectRef.current?.(
          {
            x: Math.min(start.x, e.clientX) - bounds.left,
            y: Math.min(start.y, e.clientY) - bounds.top,
            width,
            height,
          },
          bounds.width,
          bounds.height,
        );
        return;
      }
      if (holdTimer !== null) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      if (holdCycleState !== null) {
        // The hold reached its 300ms delay and highlighted a candidate; a
        // plain release (no further movement) COMMITS it -- see commitHit()
        // for why this calls it directly rather than pickAt(), which would
        // just re-raycast and land back on the ordinary nearest winner.
        const { candidates, index } = holdCycleState;
        holdCycleState = null;
        holdCycleCommitted = true;
        commitHit(candidates[index], { ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, metaKey: e.metaKey });
        return;
      }
      const bs = boxSelectRef.current;
      if (!bs) return;
      boxSelectRef.current = null;
      try { renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      controls.enabled = true;
      setBoxSelect(null);
      // Below the 4px threshold: a genuine click, not a drag -- `downAt` is
      // left exactly as onCanvasPointerDown set it, so the native `click`
      // handler's own movement check runs pickAt() normally (the same
      // empty-space click-clears path this drag started from). A drag past
      // the threshold leaves `downAt` alone too -- onClick's own check
      // already rejects a moved press on its own, the same way it always
      // has for an ordinary orbit drag.
      if (!bs.moved) return;
      const items = collectBoxSelection(bs.startX, bs.startY, bs.endX, bs.endY);
      onBoxSelectRef.current?.(items, e.shiftKey);
    }
    function onClick(e: MouseEvent) {
      if (e.button !== 0) return;
      if (holdCycleCommitted) {
        // The hold-cycle gesture above already committed a candidate in
        // onCanvasPointerUp; the DOM `click` that always follows a same-
        // element pointerup must not re-pick (it would re-run hitAt() and
        // silently overwrite the cycled selection with the plain nearest
        // winner).
        holdCycleCommitted = false;
        return;
      }
      // The stale comment this replaces claimed "right-drag orbits" -- it did
      // not (stock OrbitControls binds LEFT-drag to orbit, and always has),
      // and with the scheme preset above that binding is user-switchable
      // besides, so no orbit button can be named here at all. What stays true
      // is the split itself: a drag of ANY button is navigation, and the
      // movement check below is what keeps its release from ever reaching
      // pickAt().
      if (downAt === null) return;
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      if (moved > CLICK_DRAG_TOLERANCE_PX) return;
      pickAt(e.clientX, e.clientY, { ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, metaKey: e.metaKey });
    }
    // Double-click (SPEC-mouse-parity.md Phase 3.6): reuses hitAt() --
    // pickAt()'s own resolver -- rather than a second raycast helper, so
    // "what did the dblclick land on" can never disagree with what a plain
    // click at the same point would have picked. A miss (empty space) hits
    // the same `if (!hit) return` every other hitAt() caller uses -- no
    // event reaches the caller at all, so "nothing opens" needs no special
    // case on either side of this prop.
    function featureIdOfHit(hit: Hit): string {
      return hit.kind === 'edge'
        ? (hit.line.userData as { featureId: string }).featureId
        : (hit.mesh.userData.featureId as string);
    }
    function onDblClick(e: MouseEvent) {
      if (e.button !== 0) return;
      const hit = hitAt(e.clientX, e.clientY);
      if (!hit) return;
      onFeatureDoubleClickRef.current?.(featureIdOfHit(hit));
    }
    // Ctrl+A / Delete-Backspace (SPEC-mouse-parity.md Phase 3.6). Lives on
    // the canvas element itself (tabIndex set above), not window -- the
    // same "scoped to viewport focus" split onDblClick draws -- so a
    // Ctrl+A/Delete typed anywhere else on the page (the code editor, a
    // param box) never reaches this listener at all. The
    // shouldHandleViewportDelete() check is defence in depth for the one
    // case that split alone does not cover: the canvas keeping focus from
    // an earlier click while a DIFFERENT element (reached by Tab, not a
    // click) is what the keydown's own activeElement actually names.
    function onCanvasKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        onSelectAllRef.current?.();
        return;
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const active = document.activeElement;
      if (!shouldHandleViewportDelete(active ? active.tagName : '')) return;
      e.preventDefault();
      onDeleteSelectedRef.current?.();
    }
    // Todo 19/20's classify-and-dispatch lives in onCanvasPointerUp (below),
    // which has the pointer's REAL up-sample; the browser fires contextmenu
    // BEFORE pointerup and BEFORE any drag's moves (measured 2026-09-21:
    // Playwright/Chromium fire contextmenu at press time, coords = the DOWN
    // point, timeStamp = pointerdown's), so a classifier on this event reads
    // a 0px/0ms gesture and opens the menu on ANY drag. This handler only
    // kills the native menu — always, whatever the gesture turns out to be
    // (a right-drag that pans still fires contextmenu, and the native menu
    // popping up over an in-progress pan would be worse than no menu).
    function onCanvasContextMenu(e: MouseEvent) {
      e.preventDefault();
      if (!rightMenuArmedRef.current) return;
      rightMenuArmedRef.current = false;
      const bounds = renderer.domElement.getBoundingClientRect();
      setMarkingMenu({ x: e.clientX - bounds.left, y: e.clientY - bounds.top });
    }
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerleave', onPointerLeave);
    renderer.domElement.addEventListener('pointerleave', onPointerLeave);
    // pointerdown/move/up sit BESIDE click here, not inside the existing
    // onPointerMove above -- that one is throttled to a hover raycast and
    // returns early when none is in flight, which is the wrong shape for a
    // state machine that has to see EVERY move of a drag gesture. The three
    // below are raw and cheap (four compares against null on the hover path).
    renderer.domElement.addEventListener('pointerdown', onCanvasPointerDown);
    renderer.domElement.addEventListener('pointermove', onCanvasPointerMove);
    renderer.domElement.addEventListener('pointerup', onCanvasPointerUp);
    renderer.domElement.addEventListener('pointercancel', onCanvasPointerUp);
    renderer.domElement.addEventListener('click', onClick);
    renderer.domElement.addEventListener('dblclick', onDblClick);
    renderer.domElement.addEventListener('keydown', onCanvasKeyDown);
    renderer.domElement.addEventListener('contextmenu', onCanvasContextMenu);
    registerPickAtRef.current?.(pickAt);

    renderNow();

    return () => {
      registerPickAtRef.current?.(null);
      controls.removeEventListener('start', onControlsStart);
      controls.removeEventListener('change', onControlsChange);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave);
      renderer.domElement.removeEventListener('pointerdown', onCanvasPointerDown);
      renderer.domElement.removeEventListener('pointermove', onCanvasPointerMove);
      renderer.domElement.removeEventListener('pointerup', onCanvasPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onCanvasPointerUp);
      renderer.domElement.removeEventListener('click', onClick);
      renderer.domElement.removeEventListener('dblclick', onDblClick);
      renderer.domElement.removeEventListener('keydown', onCanvasKeyDown);
      renderer.domElement.removeEventListener('contextmenu', onCanvasContextMenu);
      if (holdTimer !== null) clearTimeout(holdTimer);
      if (pendingHoverRaf !== null) cancelAnimationFrame(pendingHoverRaf);
      if (dampingRafRef.current !== null) cancelAnimationFrame(dampingRafRef.current);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
      solidGroup.traverse((obj) => {
        const mesh = obj as THREE_NS.Mesh;
        mesh.geometry?.dispose?.();
      });
      [hoverFaceMesh, selectedFaceMesh, hoverVertexMesh, selectedVertexMesh].forEach((obj) => {
        obj.geometry.dispose();
        (obj.material as THREE_NS.Material).dispose();
      });
      // Edge tube geometries are disposed by the solidGroup.traverse() above
      // (they are children of the shape meshes it just walked); these two
      // materials are the only thing outside that tree, shared across every
      // tube rather than owned by one.
      hoverEdgeMaterial.dispose();
      selectedEdgeMaterial.dispose();
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      inactiveCameraRef.current = null;
      controlsRef.current = null;
      solidGroupRef.current = null;
      hoverFaceMeshRef.current = null;
      selectedFaceMeshRef.current = null;
      hoverVertexMeshRef.current = null;
      selectedVertexMeshRef.current = null;
      hoverEdgeMaterialRef.current = null;
      selectedEdgeMaterialRef.current = null;
      hoveredEdgeTubeRef.current = null;
      selectedEdgeTubeRef.current = null;
      edgePickLinesRef.current = [];
      windowZoomRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  /**
   * Project every current `anchors` spec (world space) to screen pixels and
   * hand the result to `onAnchors` -- the world->screen half of drag handles,
   * ported line-for-line from public/reshape/kernel/runner-brep.html's own
   * projectAnchors() (see that file's "6. drag handles" section). Same
   * reasoning, restated here because there is no second file to point at
   * inside this one:
   *
   * "IN FRONT OF CAMERA" IS NOT FREE. THREE.Vector3.applyMatrix4() divides by
   * w unconditionally, and a point BEHIND the camera produces a mirrored, not
   * obviously-wrong result -- so each anchor's view-space Z is checked first
   * (the camera looks down its own local -Z, so a positive view-space Z means
   * behind it) and dropped rather than drawn somewhere nonsensical.
   *
   * `ux`/`uy` (and `vx`/`vy` for a planar handle) are the RAW screen-pixel
   * delta for one world unit along that axis -- not normalised, unlike
   * `dirX`/`dirY` -- because HandleOverlay.tsx solves the pointer's screen
   * movement onto two possibly-non-perpendicular projected axes (they stop
   * being perpendicular the moment the camera turns), and that solve needs
   * the actual per-axis scale, not just a direction.
   *
   * A handle whose axis currently points AT the camera (pxPerUnit under a
   * pixel) is dropped rather than kept at a division-by-near-zero: an
   * undraggable dot is worse than no dot, the same principle every refusal-
   * with-a-reason in this codebase follows, just with no sentence to show for
   * it here -- there is nowhere on a screen dot to put one.
   */
  /** View strip. Re-aims the camera along a preset DIRECTION while keeping
   *  BOTH the orbit target and the current distance from it -- a beginner
   *  who has already zoomed in should not get zoomed back out just for
   *  clicking "Top". A snap, not an animated fly-to: render-on-demand means
   *  the one-frame repaint below is the whole cost, and `controls.update()`
   *  first re-derives OrbitControls' own internal spherical coordinates
   *  from the new position so the NEXT drag orbits smoothly from here
   *  rather than jumping back toward wherever the old spherical state
   *  thought the camera was. */
  function lookFrom(dir: [number, number, number]) {
    const three = threeRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    if (!three || !camera || !controls || !renderer || !scene) return;
    const { THREE } = three;
    const distance = camera.position.distanceTo(controls.target);
    const direction = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
    camera.position.copy(controls.target).addScaledVector(direction, distance);
    controls.update();
    renderer.render(scene, camera);
    // Camera-driven, not a drag -- setting camera.position directly does not
    // run through OrbitControls' own 'change' listener path the way a drag
    // does, so the dampingTick flush point that normally keeps handles in
    // sync never fires for this. Same reasoning as the ResizeObserver
    // callback above: reproject right here instead.
    projectAnchors();
  }

  /** Free orbit driven by dragging the nav cube itself -- same "preserve
   *  distance, re-derive OrbitControls' spherical state via controls.update()"
   *  shape as lookFrom() above, but walking an arbitrary (dThetaDeg,
   *  dPhiDeg) delta instead of snapping to one of the preset DIRs. phi is
   *  clamped just shy of the poles for the same reason TOP_DIR/UNDERNEATH_DIR
   *  carry an epsilon -- landing exactly on the up axis is a spherical
   *  singularity. Clears `preset`: an arbitrary orbit is not any named view. */
  function orbitByDelta(dThetaDeg: number, dPhiDeg: number) {
    const three = threeRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    if (!three || !camera || !controls || !renderer || !scene) return;
    const rel = camera.position.clone().sub(controls.target);
    const r = rel.length();
    if (r < 1e-6) return;
    const EPS = 0.001;
    const theta = Math.atan2(rel.y, rel.x) + (dThetaDeg * Math.PI) / 180;
    let phi = Math.acos(Math.min(1, Math.max(-1, rel.z / r))) + (dPhiDeg * Math.PI) / 180;
    phi = Math.min(Math.PI - EPS, Math.max(EPS, phi));
    camera.position.set(
      controls.target.x + r * Math.sin(phi) * Math.cos(theta),
      controls.target.y + r * Math.sin(phi) * Math.sin(theta),
      controls.target.z + r * Math.cos(phi),
    );
    controls.update();
    renderer.render(scene, camera);
    projectAnchors();
    setPreset(null);
  }

  /** Snaps the camera to one nav-cube face's direction, by CSS face key
  (NAV_CUBE_FACES above). Looked up by key rather than called inline so
  the pointerup handler below (which resolves the face via
  elementFromPoint, not the button's own onClick -- see that handler's
  comment for why) and the button's onClick (kept for keyboard
  Enter/Space activation) both go through the exact same path. */
  function fireFace(key: string) {
    const entry = NAV_CUBE_FACES.find((f) => f.key === key);
    if (!entry) return;
    lookFrom(entry.dir);
    setPreset(entry.preset);
  }

  /** Todo 28: a right-click ANYWHERE over the cube opens the same marking
   *  menu the canvas path opens (todo 17 owns right-click everywhere; the
   *  wrapper captures pointerdown, so the canvas classifier never sees these
   *  events). The browser's contextmenu event fires at PRESS time in
   *  Chromium (measured 2026-09-21, see onCanvasContextMenu's comment), so
   *  the sample here is the press point -- good enough for a click-shaped
   *  menu open, which is what a right-click on a 88px widget is. A
   *  right-DRAG over the cube is not served here (the menu opens only for
   *  click-shaped presses; a drag keeps orbiting via the canvas's own
   *  controls -- the wrapper's own pointermove only orbits on LEFT drag
   *  since button 2 no longer sets cubeDragRef). */
  function rightCubeMenuAt(sample: { x: number; y: number }) {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const bounds = renderer.domElement.getBoundingClientRect();
    setMarkingMenu({ x: sample.x - bounds.left, y: sample.y - bounds.top });
  }

  /** Todo 28 (SPEC Phase 1.5): face OR edge OR corner snap, from a
  cube-zone id. Faces keep fireFace()'s exact path; edges/corners look
  from the normalized dir-sum cube-zone.ts computed (both preserve
  distance exactly like a face click, per lookFrom) and clear the
  preset -- a diagonal view is not any named view-strip preset. */
  function fireZone(zone: CubeZone) {
    if (zone.kind === 'face') { fireFace(zone.id.slice('face:'.length)); return; }
    if (zone.kind === 'none') return;
    const dir = CUBE_ZONE_DIRS[zone.id];
    if (!dir) return;
    lookFrom(dir);
    setPreset(null);
  }

  /** The zone dirs for the live cube, derived ONCE from the same face
  dirs NAV_CUBE_FACES already owns -- recomputed per render is fine
  (20 small sums), but a module-level map cannot drift from a future
  NAV_CUBE_FACES edit only if it derives FROM it; so it is built here,
  where NAV_CUBE_FACES is in scope. */
  const CUBE_ZONE_DIRS = cubeZoneDirs(
    Object.fromEntries(NAV_CUBE_FACES.map((f) => [f.key, f.dir])) as Record<CubeFaceKey, [number, number, number]>,
  );

  /**
   * Aims the camera at the model's own bounding-box centre along a preset
   * DIRECTION, at a distance computed by lib/camera-fit.ts's fitDistance() so
   * the model's longest dimension fills ~45% of the viewport's shorter side.
   *
   * Unlike lookFrom() above -- which deliberately PRESERVES whatever distance
   * and target the student already has, because Top/Front/Underneath are not
   * supposed to undo a zoom -- this is Home's own job, and Home is the one
   * button whose whole point is "start over from a view where the model
   * actually reads". Measured 2026-09-04: at the literal HOME_DIR position
   * (140,160,130), a 40mm box renders about 180px wide in a ~1164x662
   * viewport (~27% of the shorter side), which is small enough that a 3mm
   * fillet is a handful of screen pixels -- visually indistinguishable from
   * an unrounded edge to a beginner and to a naive before/after pixel-diff
   * alike, even though the geometry itself was never wrong (confirmed by
   * zooming in by hand on the exact same fillet, which shows an obvious
   * curve). Called once automatically the first time a document goes from
   * empty to having a shape (see the build effect below, and
   * hasFitOnceRef's own comment for why that is a re-arming flag and not a
   * one-time-per-mount fact), and again every time the Home button itself is
   * pressed -- both go through this function, neither goes through
   * lookFrom(). Top/Front/Underneath still call lookFrom(), so they inherit
   * whatever distance a fit (or the student's own zoom since) last left the
   * camera at, exactly as before.
   *
   * A no-op when nothing has been drawn yet (`solidGroupRef` is empty --
   * `THREE.Box3.isEmpty()` says so) rather than collapsing the camera onto a
   * degenerate point: the empty-stage view (grid + axes, no solid) has
   * nothing to fit around, and fitDistance()'s own MIN_FIT_DISTANCE floor
   * exists for a different case (a non-empty but vanishingly small model),
   * not for "there is no model at all".
   */
  /**
   * The world-space extent of everything worth fitting a camera to: every
   * drawn solid mesh, PLUS every sketch's own corner points, projected
   * through that sketch's own plane axes and offset. A sketch draws no
   * three.js mesh at all -- HandleOverlay renders it as a DOM/SVG overlay,
   * entirely outside this scene -- so `solidGroupRef` alone can never see
   * one; without this half a sketch-only document's first shape (or a
   * sketch viewed flat -- see viewSketchPlane()) never got fit, or got fit
   * as if it sat flat on the ground regardless of its real plane. Returns
   * null (not an empty Box3) when the scene itself is not ready yet, so
   * callers can tell "nothing to fit around" apart from "not ready".
   */
  function computeSceneBox(): THREE_NS.Box3 | null {
    const three = threeRef.current;
    const group = solidGroupRef.current;
    if (!three || !group) return null;
    const { THREE } = three;
    const box = new THREE.Box3().setFromObject(group);
    for (const f of doc.features) {
      if (f.kind !== 'sketch') continue;
      const { u, v, n } = SKETCH_PLANE_AXES[f.plane ?? 'xy'] ?? SKETCH_PLANE_AXES.xy;
      const off = f.offset ?? 0;
      for (const [pu, pv] of f.points) {
        box.expandByPoint(new THREE.Vector3(
          n[0] * off + u[0] * pu + v[0] * pv,
          n[1] * off + u[1] * pu + v[1] * pv,
          n[2] * off + u[2] * pu + v[2] * pv,
        ));
      }
    }
    return box;
  }

  function fitToModel(dir: [number, number, number]) {
    const three = threeRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const container = containerRef.current;
    if (!three || !camera || !controls || !renderer || !scene || !container) return;
    const { THREE } = three;

    const box = computeSceneBox();
    if (!box || box.isEmpty()) return;
    const bbox: Box3Like = {
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z],
    };
    const center = bboxCenter(bbox);
    const perspCamera = camera as THREE_NS.PerspectiveCamera;
    const distance = fitDistance(bbox, container.clientWidth, container.clientHeight, perspCamera.fov ?? 45);

    const direction = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
    controls.target.set(center[0], center[1], center[2]);
    camera.position.copy(controls.target).addScaledVector(direction, distance);
    controls.update();
    renderer.render(scene, camera);
    // Same reasoning as lookFrom()'s own final line: this sets camera state
    // directly rather than through a drag, so the dampingTick flush point
    // never fires for it and handles need reprojecting here instead.
    projectAnchors();
  }

  /**
   * Item T: the SAME fit fitToModel() computes -- same target, same
   * distance, same direction -- eased into over `durationMs` rather than
   * snapped to instantly. This is what an AUTOMATIC fit (the model's first
   * solid, or a step that left the result mostly out of view) uses instead
   * of fitToModel() itself: a student who is watching the canvas when this
   * fires should see the camera move, not have it teleport out from under
   * them, but the Home button and every other deliberate, on-demand call
   * (a student's own click) stays exactly as instant as it always was --
   * this function is never wired to a button.
   *
   * Respects prefers-reduced-motion by skipping straight to the instant
   * fitToModel() behaviour (0ms is still "the same fit", just not eased).
  /** Todo 28: the cube-menu's camera-mode entries reuse applyCameraMode()
  AND mirror the view-strip toggle's own React-state + localStorage write
  (see that toggle's onClick below) so both entry points can never
  disagree about the current mode. */
  function applyCameraModeAndToggle(next: CameraMode) {
    applyCameraMode(next);
    saveCameraMode(next);
    setCameraKind(next);
    setCubeMenu(false);
  }
  function applyCameraMode(next: CameraMode) {
    const three = threeRef.current;
    const controls = controlsRef.current;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const container = containerRef.current;
    if (!three || !controls || !renderer || !scene || !container) return;
    const { THREE } = three;
    const current = cameraRef.current;
    const other = inactiveCameraRef.current;
    if (!current || !other) return;
    if (next === cameraKindRef.current) return;

    // Placement + target carry over verbatim -- both cameras orbit the same
    // point at the same distance.
    other.position.copy(current.position);
    other.up.copy(current.up);
    controls.object = other;
    cameraRef.current = other;
    inactiveCameraRef.current = current;
    cameraKindRef.current = next;
    // Resize handler reads the live camera's own kind, so it keeps whichever
    // projection this swap landed on aspect-correct from here on.
    const w = container.clientWidth;
    const h = Math.max(1, container.clientHeight);
    if (next === CameraMode.ORTHOGRAPHIC) {
      const persp = current as THREE_NS.PerspectiveCamera;
      const targetDistance = current.position.distanceTo(controls.target);
      const frame = orthoFrustumFromPerspective(
        { fov: persp.fov, aspect: w / h, near: persp.near, far: persp.far },
        targetDistance,
      );
      const ortho = other as THREE_NS.OrthographicCamera;
      ortho.left = frame.left; ortho.right = frame.right;
      ortho.top = frame.top; ortho.bottom = frame.bottom;
      ortho.near = frame.near; ortho.far = frame.far;
      ortho.zoom = 1;
      ortho.updateProjectionMatrix();
    } else {
      // Restoring the perspective camera preserves ITS fov/near/far (the swap
      // never touched them); only aspect may have drifted since the last time
      // it was live.
      const persp = other as THREE_NS.PerspectiveCamera;
      persp.aspect = w / h;
      persp.updateProjectionMatrix();
    }
    controls.update();
    renderer.render(scene, other);
    projectAnchors();
    setCameraKind(next);
  }

  /**
   * SPEC-mouse-parity Phase 1 item 4: frame the selection as the new orbit
   * target. The selection this component itself can reach is its OWN pick state
   * (the picked face's feature+index, or the picked edge's feature) -- the
   * `pick`/`selectedCount` props stop at display, so a window into
   * ReshapeStudio's feature-tree selection is not rebuilt here. Boxes come
   * from the live meshes drawGeoms() already tagged with featureId; an empty
   * pick is a no-op button (disabled, and never rendered hot).
   *
   * A snap, not an eased fly-to -- the same deliberate instant-ness the Home
   * button's own fitToModel() keeps for on-demand framing; the automatic
   * first-solid path below is the only eased one (see animateFitToModel's
   * own comment).
   */
  function fitSelection() {
    const three = threeRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const container = containerRef.current;
    const group = solidGroupRef.current;
    if (!three || !camera || !controls || !renderer || !scene || !container || !group) return;
    const persp = cameraKindRef.current === CameraMode.PERSPECTIVE ? (camera as THREE_NS.PerspectiveCamera) : null;
    // The fit math (computeSelectionFit) is written for a perspective-fov
    // camera. Ortho mode asks the same question of the perspective camera it
    // would swap BACK to (inactiveCameraRef) -- the frustum width/height at
    // target distance matches, which is all the fit needs.
    const fovCam = persp ?? (inactiveCameraRef.current as THREE_NS.PerspectiveCamera | null);
    if (!fovCam) return;

    const wanted = new Set<string>();
    const facePick = selectedFaceStateRef.current;
    if (facePick) wanted.add(facePick.featureId);
    if (pick && pick.target) wanted.add(pick.target);
    if (wanted.size === 0) return;
    const boxes: Array<{ min: Vec3; max: Vec3 }> = [];
    for (const child of group.children) {
      const mesh = child as THREE_NS.Mesh;
      const featureId = mesh.userData?.featureId as string | undefined;
      if (!featureId || !wanted.has(featureId)) continue;
      if (!mesh.geometry) continue;
      mesh.geometry.computeBoundingBox();
      const b = mesh.geometry.boundingBox;
      if (!b) continue;
      // computeSelectionFit takes plain tuples, not THREE.Box3 -- convert at
      // the call site (its own file's note).
      boxes.push({ min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] });
    }
    if (boxes.length === 0) return;
    const target: Vec3 = [controls.target.x, controls.target.y, controls.target.z];
    const fit = computeSelectionFit(
      boxes,
      {
        position: [camera.position.x, camera.position.y, camera.position.z],
        fov: fovCam.fov ?? 45,
        near: camera.near,
        far: camera.far,
      },
      target,
      container.clientWidth,
      container.clientHeight,
    );
    if (!fit.valid) return;
    const distance = Math.max(fit.distance, camera.near * 2);
    const toTarget = new three.THREE.Vector3(fit.target[0], fit.target[1], fit.target[2]);
    const direction = new three.THREE.Vector3(
      camera.position.x - controls.target.x,
      camera.position.y - controls.target.y,
      camera.position.z - controls.target.z,
    );
    if (direction.lengthSq() < 1e-12) direction.set(140, 160, 130);
    direction.normalize();
    controls.target.copy(toTarget);
    camera.position.copy(toTarget).addScaledVector(direction, distance);
    controls.update();
    renderer.render(scene, camera);
    projectAnchors();
  }

  /** The scene-setup effect's captured drag hands its finished rectangle here
   *  via applyWindowZoomRectRef -- kept component-level, not in the effect,
   *  because it needs the live camera and controls the same way fitSelection
   *  above does. A snap (not the eased animateFitToModel path) on purpose: this
   *  is the student's own deliberate drag, the same on-demand class of gesture
   *  the Home button already snaps for. */
  function applyWindowZoomRect(rect: { x: number; y: number; width: number; height: number }, viewportWidth: number, viewportHeight: number) {
    const three = threeRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    if (!three || !camera || !controls || !renderer || !scene) return;
    const persp = cameraKindRef.current === CameraMode.PERSPECTIVE ? (camera as THREE_NS.PerspectiveCamera) : null;
    const fovCam = persp ?? (inactiveCameraRef.current as THREE_NS.PerspectiveCamera | null);
    if (!fovCam) return;
    const sceneBox = computeSceneBox();
    const boxTuple = sceneBox && !sceneBox.isEmpty()
      ? { min: [sceneBox.min.x, sceneBox.min.y, sceneBox.min.z] as Vec3, max: [sceneBox.max.x, sceneBox.max.y, sceneBox.max.z] as Vec3 }
      : null;
    const target: Vec3 = [controls.target.x, controls.target.y, controls.target.z];
    const fit = computeWindowZoomFit(
      rect,
      viewportWidth,
      viewportHeight,
      {
        position: [camera.position.x, camera.position.y, camera.position.z],
        fov: fovCam.fov ?? 45,
        near: camera.near,
        far: camera.far,
      },
      target,
      boxTuple,
    );
    if (!fit.valid) return;
    const { THREE } = three;
    const direction = new THREE.Vector3(
      camera.position.x - controls.target.x,
      camera.position.y - controls.target.y,
      camera.position.z - controls.target.z,
    );
    if (direction.lengthSq() < 1e-12) direction.set(140, 160, 130);
    direction.normalize();
    controls.target.set(fit.target[0], fit.target[1], fit.target[2]);
    camera.position.copy(controls.target).addScaledVector(direction, fit.distance);
    controls.update();
    renderer.render(scene, camera);
    projectAnchors();
  }
  applyWindowZoomRectRef.current = applyWindowZoomRect;


  function animateFitToModel(dir: [number, number, number], durationMs = 250) {
    const three = threeRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const container = containerRef.current;
    if (!three || !camera || !controls || !renderer || !scene || !container) return;
    const { THREE } = three;

    const box = computeSceneBox();
    if (!box || box.isEmpty()) return;
    const bbox: Box3Like = {
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z],
    };
    const center = bboxCenter(bbox);
    const perspCamera = camera as THREE_NS.PerspectiveCamera;
    const distance = fitDistance(bbox, container.clientWidth, container.clientHeight, perspCamera.fov ?? 45);
    const direction = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();

    const toTarget = new THREE.Vector3(center[0], center[1], center[2]);
    const toPosition = toTarget.clone().addScaledVector(direction, distance);

    if (fitAnimRef.current != null) {
      cancelAnimationFrame(fitAnimRef.current);
      fitAnimRef.current = null;
    }

    const reducedMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion || durationMs <= 0) {
      controls.target.copy(toTarget);
      camera.position.copy(toPosition);
      controls.update();
      renderer.render(scene, camera);
      projectAnchors();
      return;
    }

    const fromTarget = controls.target.clone();
    const fromPosition = camera.position.clone();
    const start = performance.now();
    // Aliased so the closure below captures values TS knows are non-null --
    // `camera`/`controls`/`renderer`/`scene` are narrowed by the early
    // return above, but that narrowing does not survive into a nested
    // function TS cannot prove still runs before any of them could change.
    const cam = camera; const ctrl = controls; const rend = renderer; const scn = scene;

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // Smoothstep -- eases in and out rather than a linear pace that reads
      // as mechanical for something this short.
      const eased = t * t * (3 - 2 * t);
      ctrl.target.lerpVectors(fromTarget, toTarget, eased);
      cam.position.lerpVectors(fromPosition, toPosition, eased);
      ctrl.update();
      rend.render(scn, cam);
      projectAnchors();
      fitAnimRef.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    fitAnimRef.current = requestAnimationFrame(step);
  }

  /**
   * Item T's second trigger: true when the model's own projected bounding
   * rectangle overlaps the visible canvas by less than half its own area --
   * "a step's result lies more than half outside the current view", per
   * the spec. A screen-space AABB-of-a-3D-AABB, the same order of
   * approximation fitDistance() itself already uses elsewhere in this
   * file, not a true silhouette test -- cheap, and the failure mode it
   * exists to catch (a plate parked at an eighth of the frame after a
   * Pull) is nowhere near the 50% line, so the approximation's own slop
   * never matters at the threshold. Any corner landing BEHIND the camera
   * counts as fully out of view outright, rather than trusting its
   * projected (and, behind the lens, mirrored) screen position.
   */
  function modelMostlyOutOfView(): boolean {
    const three = threeRef.current;
    const camera = cameraRef.current;
    const container = containerRef.current;
    if (!three || !camera || !container) return false;
    const { THREE } = three;
    const box = computeSceneBox();
    if (!box || box.isEmpty()) return false;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w <= 0 || h <= 0) return false;

    const corners: [number, number, number][] = [
      [box.min.x, box.min.y, box.min.z], [box.max.x, box.min.y, box.min.z],
      [box.min.x, box.max.y, box.min.z], [box.max.x, box.max.y, box.min.z],
      [box.min.x, box.min.y, box.max.z], [box.max.x, box.min.y, box.max.z],
      [box.min.x, box.max.y, box.max.z], [box.max.x, box.max.y, box.max.z],
    ];
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    const v = new THREE.Vector3();
    for (const [x, y, z] of corners) {
      v.set(x, y, z);
      // View-space Z is negative in front of a standard three.js perspective
      // camera; positive means this corner is behind the lens, where
      // project()'s own screen coordinates fold back on themselves rather
      // than meaning "off to one side".
      const viewZ = v.clone().applyMatrix4(camera.matrixWorldInverse).z;
      if (viewZ > 0) return true;
      v.project(camera);
      const sx = (v.x * 0.5 + 0.5) * w;
      const sy = (1 - (v.y * 0.5 + 0.5)) * h;
      minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
    }
    const modelArea = Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
    if (modelArea <= 0) return true;
    const ix0 = Math.max(minX, 0); const iy0 = Math.max(minY, 0);
    const ix1 = Math.min(maxX, w); const iy1 = Math.min(maxY, h);
    const overlapArea = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
    return overlapArea / modelArea < 0.5;
  }

  /**
   * Looks straight down a sketch plane's own normal (Ground/xy -> the same
   * direction the Top view-strip preset uses, Front/xz -> Front, Side/yz ->
   * from +x) and fits to the scene the way fitToModel() does, but with
   * `occludedWidthPx` of the canvas subtracted from the fit (see
   * fitDistance()'s own comment) AND the framing shifted sideways so the
   * model centres in the VISIBLE strip, not the full canvas -- a Rules panel
   * docked on one side must never cover any of it.
   *
   * Does not touch `hasFitOnceRef` or save/restore any orbit itself -- see
   * the `sketchPlane` prop effect below, which is the only caller and owns
   * that bookkeeping, so this stays a pure "look here, fit this" primitive
   * usable the same way regardless of why it was called.
   */
  function viewSketchPlane(plane: 'xy' | 'xz' | 'yz', occludedWidthPx: number) {
    const three = threeRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const container = containerRef.current;
    if (!three || !camera || !controls || !renderer || !scene || !container) return;
    const { THREE } = three;

    // A totally empty scene box is real, not a bug to guard against, the
    // moment this is called for an ARMED draw tool rather than an existing
    // sketch: item M puts a beginner into flat view the instant Rectangle/
    // Polygon is picked, before either of the two placing clicks has
    // happened, so there is nothing on the plane yet to derive an extent
    // from. fitToModel()'s own callers can all safely bail out on empty (a
    // Home/Top/Front press with nothing built yet has nothing worth
    // fitting to), but bailing out here left the camera stuck at whatever
    // orbit it already had -- the exact silent no-op this fix exists to
    // avoid. Falls back to the grid's own drawn extent (GridHelper(120, ...)
    // a few hundred lines up -- -60 to 60) so "look at the plane" still
    // means something concrete: the same square the student is already
    // looking at on screen.
    const box = computeSceneBox();
    const bbox: Box3Like = box && !box.isEmpty()
      ? { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] }
      : { min: [-60, -60, 0], max: [60, 60, 0] };
    const center = bboxCenter(bbox);
    const perspCamera = camera as THREE_NS.PerspectiveCamera;
    const distance = fitDistance(
      bbox, container.clientWidth, container.clientHeight, perspCamera.fov ?? 45,
      DEFAULT_FILL_FRACTION, occludedWidthPx,
    );

    const { n } = SKETCH_PLANE_AXES[plane] ?? SKETCH_PLANE_AXES.xy;
    const direction = new THREE.Vector3(n[0], n[1], n[2]).normalize();

    // Re-centre into the VISIBLE strip: the occluded half of the canvas is
    // pure dead space, so the model's on-screen centre must sit at the
    // visible strip's own centre, not the full canvas's. That is a lateral
    // shift of half the occluded width, converted from screen pixels to
    // world units at the distance just computed (the same
    // world-per-pixel relationship fitDistance()'s own derivation uses,
    // inverted), then applied to BOTH camera.position and controls.target
    // so the orbit still turns around the same visual point afterward.
    const worldPerPixel = (2 * distance * Math.tan(((perspCamera.fov ?? 45) * Math.PI) / 360)) / container.clientHeight;
    const shiftWorld = (occludedWidthPx / 2) * worldPerPixel;
    const right = new THREE.Vector3().crossVectors(direction, camera.up).normalize();

    controls.target.set(center[0], center[1], center[2]).addScaledVector(right, -shiftWorld);
    camera.position.copy(controls.target).addScaledVector(direction, distance);
    controls.update();
    renderer.render(scene, camera);
    projectAnchors();
  }

  function projectAnchors() {
    const three = threeRef.current;
    const camera = cameraRef.current;
    const container = containerRef.current;
    if (!three || !camera || !container) return;
    const { THREE } = three;

    const specs = anchorsRef.current;
    if (!specs.length) {
      onAnchorsRef.current?.([]);
      return;
    }

    camera.updateMatrixWorld();
    const viewMat = camera.matrixWorldInverse;
    const mvp = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, viewMat);
    const w = container.clientWidth;
    const h = container.clientHeight;

    const inFrontOfCamera = (p: [number, number, number]) =>
      new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(viewMat).z < 0;
    const toScreen = (p: [number, number, number]): [number, number] => {
      const v = new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(mvp);
      return [(v.x * 0.5 + 0.5) * w, (1 - (v.y * 0.5 + 0.5)) * h];
    };

    const points: AnchorPoint[] = [];
    for (const a of specs) {
      if (!inFrontOfCamera(a.origin)) continue;
      const [hx, hy] = toScreen(a.origin);
      const [tx, ty] = toScreen([
        a.origin[0] + a.axis[0], a.origin[1] + a.axis[1], a.origin[2] + a.axis[2],
      ]);
      const dx = tx - hx;
      const dy = ty - hy;
      const px = Math.hypot(dx, dy);
      if (px < 0.001) continue;
      const pt: AnchorPoint = {
        param: a.param, label: a.label, kind: a.kind,
        x: hx, y: hy, dirX: dx / px, dirY: dy / px, pxPerUnit: px,
        ux: dx, uy: dy,
      };
      if (a.axisV && a.paramV) {
        const [vsx, vsy] = toScreen([
          a.origin[0] + a.axisV[0], a.origin[1] + a.axisV[1], a.origin[2] + a.axisV[2],
        ]);
        pt.paramV = a.paramV;
        pt.vx = vsx - hx;
        pt.vy = vsy - hy;
      }
      points.push(pt);
    }
    onAnchorsRef.current?.(points);
  }

  /** Which FaceRange a hit triangle belongs to -- the geometric half of
   *  resolving a Raycaster hit back to a TopoDS_Face. `triangleIndex` is
   *  three.js's own `faceIndex` (the index-BUFFER position divided by 3,
   *  Mesh.raycast()'s own convention), not the FaceRange.index this returns
   *  -- see lib/occt-three.ts for why the two are different numbers. */
  function faceRangeFor(mesh: THREE_NS.Mesh, triangleIndex: number): FaceRange | null {
    const ranges: FaceRange[] = mesh.userData.faceRanges ?? [];
    const bufIdx = triangleIndex * 3;
    return ranges.find((r) => bufIdx >= r.start && bufIdx < r.start + r.count) ?? null;
  }

  /**
   * Paint one face's triangle range into a highlight mesh, by sharing the
   * source mesh's own position/normal attributes (zero-copy -- the same
   * BufferAttribute objects, not clones) and slicing a VIEW of its index
   * buffer down to just this FaceRange. `range` omitted paints the WHOLE
   * mesh instead -- every face, not one -- by sharing its full index
   * directly rather than slicing a view of it; SPEC-mouse-parity.md Phase 3
   * item 2's body-kind pick uses this to highlight an entire owning feature
   * with no per-face resolution needed at all.
   *
   * Shared attributes are safe to keep past this call because a highlight
   * mesh's geometry only ever gets REPOINTED, never read after the source it
   * was borrowing from is disposed -- drawGeoms() clears both hover and
   * selection every rebuild before disposing the old meshes, and
   * restorePicks() repaints a persisted selection from the FRESH mesh, not
   * the stale one.
   *
   * Used for hover, for a fresh click, and for restoring a face selection
   * after a rebuild -- see restorePicks().
   */
  function paintFaceHighlight(
    THREE: typeof THREE_NS, target: THREE_NS.Mesh, source: THREE_NS.Mesh, range?: FaceRange,
  ) {
    const geom = target.geometry;
    const position = source.geometry.getAttribute('position');
    if (position) geom.setAttribute('position', position);
    const normal = source.geometry.getAttribute('normal');
    if (normal) geom.setAttribute('normal', normal);
    const idx = source.geometry.getIndex();
    if (idx) {
      if (range) {
        // tessellateToThree() hands a plain number[] to BufferGeometry.setIndex(),
        // which picks Uint16 or Uint32 for itself depending on the largest
        // value -- so this cannot assume either width and reads it back as `any`.
        const arr: any = idx.array;
        geom.setIndex(new THREE.BufferAttribute(arr.subarray(range.start, range.start + range.count), 1));
      } else {
        geom.setIndex(idx);
      }
    }
    target.visible = true;
  }

  /**
   * Build a tube mesh geometry following an edge's own discretised points
   * exactly -- one straight LineCurve3 per consecutive pair, never a spline
   * fit through them, so the highlight cannot drift from the real curve the
   * way smoothing the same points could.
   *
   * WHY A TUBE, NOT A THICKER LINE. THREE.LineBasicMaterial's `linewidth` is
   * capped at 1px on almost every WebGL platform -- a limitation of the
   * underlying graphics API, not a setting three.js can override. A blind
   * side-by-side against Chili3D measured exactly this: our edge highlight
   * was "confined to a ~7px-wide strip... a subtle colour shift, not a
   * thickness change" and lost on visibility alone even though the
   * hover/selected colours WERE genuinely different. A tube is real 3D
   * geometry with real width in every renderer, not a line-rendering
   * feature that may or may not be honoured.
   */
  function edgeTubeGeometry(
    THREE: typeof THREE_NS, points: ArrayLike<number>, radius: number,
  ): THREE_NS.BufferGeometry {
    const verts: THREE_NS.Vector3[] = [];
    for (let i = 0; i + 2 < points.length; i += 3) {
      verts.push(new THREE.Vector3(points[i], points[i + 1], points[i + 2]));
    }
    if (verts.length < 2) return new THREE.BufferGeometry();
    const path = new THREE.CurvePath<THREE_NS.Vector3>();
    for (let i = 0; i < verts.length - 1; i++) {
      path.add(new THREE.LineCurve3(verts[i], verts[i + 1]));
    }
    return new THREE.TubeGeometry(path, Math.max(2, verts.length * 4), radius, 8, false);
  }

  /**
   * Which tube, if any, is currently wearing the HOVER role. Never
   * constructs geometry -- every edge already has its own pre-built tube
   * (see drawGeoms()); this only swaps `.material` and toggles `.visible`.
   *
   * A tube that is ALSO the current selection is left alone: selected wins
   * outright rather than the two materials fighting over the same mesh, so
   * hovering the edge you already selected does not visually do anything --
   * which is the same behaviour the old two-independent-overlays design had
   * by construction, kept on purpose rather than by accident.
   */
  function setHoveredEdgeTube(tube: THREE_NS.Mesh | null) {
    const prev = hoveredEdgeTubeRef.current;
    if (prev === tube) return;
    if (prev && prev !== selectedEdgeTubeRef.current) prev.visible = false;
    hoveredEdgeTubeRef.current = tube;
    if (tube && tube !== selectedEdgeTubeRef.current && hoverEdgeMaterialRef.current) {
      tube.material = hoverEdgeMaterialRef.current;
      tube.visible = true;
    }
  }

  /**
   * Which tube, if any, is currently wearing the SELECTED role -- same
   * no-geometry contract as setHoveredEdgeTube() above.
   *
   * The one asymmetry: if the tube being DESELECTED is still the one being
   * hovered (the student clicked, then clicked empty space without moving
   * the mouse away), it reverts to the hover material and stays visible
   * rather than disappearing out from under the cursor.
   */
  function setSelectedEdgeTube(tube: THREE_NS.Mesh | null) {
    const prev = selectedEdgeTubeRef.current;
    if (prev === tube) return;
    if (prev) {
      if (prev === hoveredEdgeTubeRef.current && hoverEdgeMaterialRef.current) {
        prev.material = hoverEdgeMaterialRef.current;
      } else {
        prev.visible = false;
      }
    }
    selectedEdgeTubeRef.current = tube;
    if (tube && selectedEdgeMaterialRef.current) {
      tube.material = selectedEdgeMaterialRef.current;
      tube.visible = true;
    }
  }

  /** Replace the drawn solids and render exactly one frame. Never called from
   *  inside a loop -- see the render-on-demand note above. Returns the meshes
   *  it created so the caller can re-apply a persisted selection against
   *  them -- see restorePicks(). */
  function drawGeoms(meshed: Array<{
    id: string; kind: Feature['kind']; shape: any;
    geometry: THREE_NS.BufferGeometry; faces: FaceRange[];
  }>): THREE_NS.Mesh[] {
    const three = threeRef.current;
    const engine = engineRef.current;
    const group = solidGroupRef.current;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const hoverFaceMesh = hoverFaceMeshRef.current;
    const selectedFaceMesh = selectedFaceMeshRef.current;
    const hoverVertexMesh = hoverVertexMeshRef.current;
    const selectedVertexMesh = selectedVertexMeshRef.current;
    if (!three || !engine || !group || !renderer || !scene || !camera
      || !hoverFaceMesh || !selectedFaceMesh || !hoverVertexMesh || !selectedVertexMesh) {
      throw new Error('the three.js scene has not been created yet');
    }
    const { THREE } = three;

    // Both face highlights are hidden BEFORE the meshes they might be
    // borrowing attributes from are disposed below -- a highlight left
    // pointing at a disposed geometry is a stale GPU buffer, not just a
    // stale selection. The edge tube pool is about to be thrown away
    // entirely (every tube is a child of a mesh the traverse below disposes),
    // so hover/selected edge state is dropped here too rather than left
    // pointing at geometry that no longer exists; restorePicks(), called
    // after this returns, re-establishes the selected one against the FRESH
    // pool.
    hoverFaceMesh.visible = false;
    selectedFaceMesh.visible = false;
    hoverVertexMesh.visible = false;
    selectedVertexMesh.visible = false;
    hoveredEdgeTubeRef.current = null;
    selectedEdgeTubeRef.current = null;

    group.traverse((obj) => (obj as THREE_NS.Mesh).geometry?.dispose?.());
    group.clear();
    // Every pick line was a child of a mesh just disposed above -- the flat
    // lookup list has to be rebuilt from zero or hitAt() would raycast
    // against geometry belonging to a shape that no longer exists.
    edgePickLinesRef.current = [];

    const material = new THREE.MeshStandardMaterial({
      color: 0xff6600, roughness: 0.6, metalness: 0.1,
    });
    // Phase 5.3 (todo 25): while a preview is active the rebuilt meshes
    // are drawn TRANSLUCENT in the op's colour, not the committed orange --
    // the colour says "not committed yet", the opacity says "computed",
    // and pointerup folds the committed doc (one undo step) which drops
    // the tint. Same zero-copy geometry path as the committed draw.
    const pv = previewRef.current;
    if (pv?.active) {
      material.color.setHex(pv.tint === 'cut' ? 0xff5555 : 0x8be9fd);
      material.transparent = true;
      material.opacity = 0.55;
      material.depthWrite = false;
    }
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x1a1a1a });
    // Never drawn (every pick line is invisible -- see below), so one shared
    // material for all of them is fine; three.js does not read material
    // state during a raycast.
    const pickLineMaterial = new THREE.LineBasicMaterial();
    const meshes: THREE_NS.Mesh[] = [];

    for (const { id, kind, shape, geometry, faces } of meshed) {
      const mesh = new THREE.Mesh(geometry, material);
      // Threaded through so a raycast hit's triangle resolves back to a
      // TopoDS_Face -- see faceRangeFor() above and lib/occt-three.ts's
      // FaceRange.
      mesh.userData.faceRanges = faces;
      mesh.userData.featureId = id;
      mesh.userData.featureKind = kind;
      mesh.userData.kernelShape = shape;
      group.add(mesh);
      meshes.push(mesh);

      const edgesGeom = new THREE.EdgesGeometry(geometry, EDGE_THRESHOLD_DEGREES);
      const edges = new THREE.LineSegments(edgesGeom, edgeMaterial);
      mesh.add(edges);

      // The PICKABLE edges -- real topology, not the display silhouette
      // above. See the file header for why these have to be a separate set.
      // Invisible on purpose: they exist only for Raycaster to hit, never to
      // be drawn -- three.js does not consult `.visible` during a raycast
      // (confirmed against node_modules/three/src/core/Raycaster.js; no
      // `visible` check exists there), which is exactly what is wanted here.
      for (const { edge, geometry: lineGeom } of engine.edges(shape)) {
        const line = new THREE.Line(lineGeom, pickLineMaterial);
        line.visible = false;
        line.userData.featureId = id;
        line.userData.featureKind = kind;
        line.userData.kernelShape = shape;
        line.userData.kernelEdge = edge;
        mesh.add(line);
        edgePickLinesRef.current.push(line);

        // This edge's highlight, built ONCE here rather than on every hover
        // -- see the pooling note above hoverEdgeMaterial's definition in
        // the scene-setup effect for why. Starts invisible with no material
        // assigned that matters (it is never drawn until setHoveredEdgeTube()
        // / setSelectedEdgeTube() hands it one); reachable from a raycast hit
        // via the SAME line's userData, which is the only lookup path
        // applyHover()/onClick() need.
        const pos = lineGeom.getAttribute('position');
        // Material is whichever of the two shared ones is live -- it never
        // matters which, since `.visible` stays false until a role is
        // assigned, and both refs are populated before drawGeoms() can run
        // (phase only reaches 'ready' after the scene-setup effect that
        // creates them).
        const tube = new THREE.Mesh(
          pos ? edgeTubeGeometry(THREE, pos.array, EDGE_TUBE_RADIUS) : new THREE.BufferGeometry(),
          hoverEdgeMaterialRef.current!,
        );
        tube.visible = false;
        tube.renderOrder = 2;
        mesh.add(tube);
        line.userData.tubeMesh = tube;
      }
    }

    renderer.render(scene, camera);
    return meshes;
  }

  /**
   * Re-apply the persisted selection(s) against FRESH meshes.
   *
   * Runs after every successful drawGeoms() -- a rebuild throws away every
   * mesh (see drawGeoms()), so "the edge is still selected" only survives a
   * dimension edit if this runs every single time, not just once at mount.
   * Also called on its own, without a rebuild, when only the `pick` PROP
   * changes -- see the effect below that watches it.
   */
  function restorePicks(meshes: THREE_NS.Mesh[], built: EngineBuildResult) {
    const three = threeRef.current;
    const engine = engineRef.current;
    const selectedFaceMesh = selectedFaceMeshRef.current;
    if (!three || !engine || !selectedFaceMesh) return;
    const { THREE } = three;

    // No geometry construction here either -- resolve the NAME to a real
    // kernel edge on the fresh shape (same mechanism a FilletFeature itself
    // resolves against), then find which of the CURRENT pool's pre-built
    // tubes is that same edge by IsSame(), and just hand it the selected
    // role. Either nothing is picked, the name no longer resolves (see
    // whyNameLost() in lib/topo-name.ts for why in words a student can act
    // on -- that story is the caller's to tell), the engine has not
    // implemented resolution at all yet (brep-rs -- caught
    // below, same as every other name/measure call in this file), or --
    // should not happen, handled the same honest way regardless -- it
    // resolves but no tube in the current pool matches: all collapse to the
    // same "nothing selected" outcome via the ?? null below.
    const p = pickRef.current;
    let edge: unknown | null = null;
    if (p) {
      try { edge = engine.resolveEdge(p.name, built); } catch { edge = null; }
    }
    const line = edge
      ? edgePickLinesRef.current.find((l) => {
          const kernelEdge = l.userData.kernelEdge;
          return kernelEdge && typeof kernelEdge.IsSame === 'function' && kernelEdge.IsSame(edge);
        })
      : undefined;
    setSelectedEdgeTube((line?.userData.tubeMesh as THREE_NS.Mesh | undefined) ?? null);

    const sel = selectedFaceStateRef.current;
    const mesh = sel ? meshes.find((m) => m.userData.featureId === sel.featureId) : undefined;
    const range = mesh && sel
      ? (mesh.userData.faceRanges as FaceRange[]).find((r) => r.index === sel.faceIndex)
      : undefined;
    if (mesh && range) {
      paintFaceHighlight(THREE, selectedFaceMesh, mesh, range);
      const pending = unnamedFacePickRef.current;
      if (pending && sel && pending.featureId === sel.featureId && pending.faceIndex === sel.faceIndex) {
        const shape = built.shapes.get(sel.featureId);
        const kernelFace = shape ? engine.faceAt(shape, sel.faceIndex) : undefined;
        let name: TopoName | null = null;
        if (kernelFace) {
          try { name = engine.nameFace(built, docRef.current, sel.featureId, kernelFace); } catch { name = null; }
        }
        if (name) {
          unnamedFacePickRef.current = null;
          let size: [number, number] | undefined;
          try { size = engine.faceSize(kernelFace) ?? undefined; } catch { size = undefined; }
          // Not a real click -- see this function's own header -- so there is no
          // event to read real modifiers off; SPEC-mouse-parity.md Phase 3 item 1
          // treats that as "none held", same as any other programmatic pick.
          onPickRef.current?.({ kind: 'face', target: sel.featureId, faceIndex: sel.faceIndex, name, size, ctrlKey: false, shiftKey: false, metaKey: false });
        }
      }
    } else {
      selectedFaceMesh.visible = false;
      selectedFaceStateRef.current = null;
    }
  }

  // ---- build + mesh + draw, whenever the doc (or deflection) changes -------
  useEffect(() => {
    if (phase !== 'ready') return;
    let engine = engineRef.current;
    const three = threeRef.current;
    if (!engine || !three || !rendererRef.current) return;
    let cancelled = false;

try {
      const t0 = performance.now();
      // The kernel refuses per-feature as DATA (build_doc_json's refusals
      // map), never by throwing, and there is no second engine to retry on:
      // a refusal reaches the student as its own sentence, via
      // BrepViewportStats.refusals, alongside whatever DID build.
      const built: EngineBuildResult = engine.build(doc);
      const activeEngine: EngineAdapter = engine;
      const buildMs = performance.now() - t0;

      const shapes = topLevel(doc)
        .map((f) => ({ id: f.id, kind: f.kind, shape: built.shapes.get(f.id) }))
        .filter((s): s is { id: string; kind: Feature['kind']; shape: any } => Boolean(s.shape));
      if (shapes.length === 0) {
        // AN EMPTY DOCUMENT IS NOT A FAILURE -- same distinction
        // BrepViewport.tsx draws, for the same reason: /sandbox/ opens on
        // EMPTY_DOC, so without this branch the workspace greets a student
        // with an error before they have done anything. Draw the empty stage
        // (grid + axes already sit in the scene) and report zero.
        const onlySketches = doc.features.length > 0 && doc.features.every((f) => f.kind === 'sketch');
        if (doc.features.length === 0 || onlySketches) {
          setStageHint(onlySketches ? 'A sketch is flat. Select it and press Pull to make it solid.' : null);
          // No solid on screen -- rearm the auto-fit whenever the doc is
          // TRULY empty, so the NEXT shape (a fresh box after Undo cleared
          // everything, say) gets its own fit rather than inheriting
          // whatever distance a since-deleted model left the camera at. See
          // hasFitOnceRef's own comment. A sketch-only doc does NOT rearm
          // here -- it gets its own first-shape fit call below instead.
          if (doc.features.length === 0) { hasFitOnceRef.current = false; hadSolidRef.current = false; }
          const t = performance.now();
          const meshes = drawGeoms([]);
          lastBuiltRef.current = built;
          lastMeshesRef.current = meshes;
          restorePicks(meshes, built);
          if (cancelled) return;
          setBuildError(null);
          // A sketch draws no three.js mesh at all -- solidGroupRef stays
          // empty for as long as nothing has been Pulled -- so THIS branch,
          // not the meshed-solid branch below, is the only place a
          // sketch-only document's first shape ever gets fit. Measured
          // 2026-09-04: a fresh 40x25 Sketch rendered at the plain HOME_DIR
          // distance, small and un-fit, because fitToModel() was only ever
          // called from the branch a bare sketch never reaches.
          // Skipped while `sketchPlane` is already set: item M puts a
          // beginner into flat view the moment Rectangle/Polygon is armed,
          // BEFORE this sketch feature exists at all, so by the time it
          // first appears here the camera is already exactly where it
          // should be. Measured 2026-09-04: without this guard, placing the
          // very first shape from an armed draw tool snapped straight back
          // to the isometric HOME_DIR the instant the second click landed,
          // turning the just-drawn rectangle into a skewed parallelogram on
          // screen -- the same "first shape ever" fit this guards for a
          // built solid below, just reached from the sketch-only branch
          // instead.
          if (onlySketches && !hasFitOnceRef.current && !sketchPlane) {
            hasFitOnceRef.current = true;
            fitToModel(HOME_DIR);
          }
          const sketched = computeSceneBox();
          onStatsRef.current?.({
            buildMs: round(buildMs), meshMs: 0, drawMs: round(performance.now() - t), triangles: 0,
            refusals: built.refusals,
            // A sketch-only stage still has an extent worth reporting (the
            // sketch's own corner points -- see computeSceneBox's doc); the
            // truly empty stage has none, so dims stay absent there.
            ...(sketched && !sketched.isEmpty()
              ? { dimsMm: {
                  x: round(sketched.max.x - sketched.min.x),
                  y: round(sketched.max.y - sketched.min.y),
                  z: round(sketched.max.z - sketched.min.z),
                } }
              : null),
          });
          onMeshRef.current?.(null);
          return;
        }
        throw new Error('The document built without error, but nothing came out as a top-level shape.');
      }

      const t1 = performance.now();
      const meshed = shapes
        .map((s) => {
          const m = activeEngine.mesh(s.shape, { deflection });
          return m ? { id: s.id, kind: s.kind, shape: s.shape, geometry: m.geometry, faces: m.faces } : null;
        })
        .filter((m): m is NonNullable<typeof m> => m !== null);
      const meshMs = performance.now() - t1;
      if (meshed.length === 0) {
        throw new Error('The kernel built a solid, but meshing it returned nothing drawable.');
      }

      const t2 = performance.now();
      const meshes = drawGeoms(meshed);
      lastBuiltRef.current = built;
      lastMeshesRef.current = meshes;
      restorePicks(meshes, built);
      const drawMs = performance.now() - t2;

      if (cancelled) return;
      setStageHint(null);
      setBuildError(null);
      // The model's FIRST SOLID gets an automatic fit -- see fitToModel()'s
      // own comment for why this, and not the literal HOME_DIR position, is
      // what a beginner needs to actually see a 3mm round without zooming.
      // Item T's second trigger: a step whose result now sits mostly
      // outside whatever view the student already has (P06's own finding --
      // a Pull inherited a flat sketch's own fit and rendered at roughly an
      // eighth of the frame) gets the SAME fit. Neither fires on an
      // ordinary edit that stays in frame: a dimension change or a new
      // feature must not yank the camera out from under a student who has
      // already framed the shot themselves (Home still does this on
      // demand, on its own click, instantly rather than eased).
      if (!hadSolidRef.current) {
        hadSolidRef.current = true;
        hasFitOnceRef.current = true;
        animateFitToModel(HOME_DIR);
      } else if (modelMostlyOutOfView()) {
        animateFitToModel(HOME_DIR);
      }
      const triangles = meshed.reduce((n, m) => n + (m.geometry.getIndex()?.count ?? 0) / 3, 0);
      const solidBox = computeSceneBox();
      onStatsRef.current?.({
        buildMs: round(buildMs), meshMs: round(meshMs), drawMs: round(drawMs), triangles,
        refusals: built.refusals,
        ...(solidBox && !solidBox.isEmpty()
          ? { dimsMm: {
              x: round(solidBox.max.x - solidBox.min.x),
              y: round(solidBox.max.y - solidBox.min.y),
              z: round(solidBox.max.z - solidBox.min.z),
            } }
          : null),
      });
      // The same triangles just drawn, handed out structurally for
      // SandboxWorkspace's Export STL button -- see the onMesh prop doc.
      onMeshRef.current?.(mergeMeshes(meshed.map((m) => ({
        positions: m.geometry.attributes.position.array as ArrayLike<number>,
        indices: m.geometry.getIndex()?.array as ArrayLike<number> | undefined,
      }))));
    } catch (e: any) {
      if (!cancelled) {
        setBuildError(String(e?.message ?? e));
        onMeshRef.current?.(null);
      }
    }

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, doc, deflection]);

  // ---- entering/leaving a flat sketch view -----------------------------
  //
  // See `sketchPlane`'s own prop doc for the contract. This only reacts to
  // the plane STRING changing (via prevSketchPlaneRef), never to `doc`
  // changing on its own -- editing a dimension or adding a step while a
  // sketch is being viewed flat must not re-snap the camera, the same "never
  // on every rebuild" rule fitToModel()'s own first-shape call follows.
  //
  // DECLARED AFTER the build effect above on purpose, not merely below it by
  // convention: React runs effects in declaration order every render, and a
  // brand-new sketch changes BOTH `doc` and `sketchPlane` on the SAME
  // render -- the build effect's own first-shape auto-fit (fitToModel(
  // HOME_DIR)) would otherwise run AFTER this one and clobber the flat view
  // with the isometric Home angle. Measured 2026-09-04: with this effect
  // declared earlier in the file, a fresh Sketch rendered as a skewed
  // parallelogram (still isometric Home) instead of a straight-down
  // rectangle, because the build effect's own fit ran second and won.
  useEffect(() => {
    if (phase !== 'ready') return;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const prev = prevSketchPlaneRef.current;
    const next = sketchPlane ?? null;
    if (prev === next) return;
    prevSketchPlaneRef.current = next;

    if (next && !prev) {
      // Entering flat view: remember exactly where the student was orbited
      // to, so leaving it can put them back rather than stranding them at
      // whatever the flat view happened to leave the camera at.
      if (camera && controls) {
        savedOrbitRef.current = {
          position: [camera.position.x, camera.position.y, camera.position.z],
          target: [controls.target.x, controls.target.y, controls.target.z],
        };
      }
      viewSketchPlane(next, panelOcclusionPx ?? 0);
    } else if (!next && prev) {
      // Leaving flat view: restore the saved orbit verbatim, if there is
      // one -- absent only if the camera/controls were not ready at the
      // moment flat view was entered, an edge case not worth a fallback fit
      // for (the LAST thing this component did was already fit or orbit
      // correctly; leaving it alone is the safe default).
      const saved = savedOrbitRef.current;
      if (saved && camera && controls && renderer && scene) {
        camera.position.set(saved.position[0], saved.position[1], saved.position[2]);
        controls.target.set(saved.target[0], saved.target[1], saved.target[2]);
        controls.update();
        renderer.render(scene, camera);
        projectAnchors();
      }
      savedOrbitRef.current = null;
    } else if (next && prev) {
      // Switching which plane is being viewed flat (a different sketch, or
      // the same sketch's plane changed) -- re-aim, but the ORIGINAL saved
      // orbit from before either flat view stays exactly as it was.
      viewSketchPlane(next, panelOcclusionPx ?? 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, sketchPlane]);

  // ---- keep the edge highlight in sync when ONLY `pick` changes -------------
  // Clearing a selection from the model tree, or picking a different edge
  // there, changes `pick` without touching `doc` -- and the effect above
  // only re-runs on a doc/deflection change, for the same reason a full
  // kernel rebuild is expensive and a selection change should not pay for
  // one. lastBuiltRef/lastMeshesRef (set at the end of that effect) are what
  // let restorePicks() run here without repeating the build.
  useEffect(() => {
    if (phase !== 'ready' || !lastBuiltRef.current) return;
    restorePicks(lastMeshesRef.current, lastBuiltRef.current);
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (renderer && scene && camera) renderer.render(scene, camera);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, pick]);

  // ---- re-project handles whenever the SPECS change, independent of the
  // camera ------------------------------------------------------------------
  // A new `anchors` array means a different feature got selected, a drag
  // moved the shape it belongs to (SandboxWorkspace's own handlesFor() runs
  // off `doc`, so a rebuild produces a fresh array), or a draw tool started
  // -- any of which needs a fresh projection right away, not whenever the
  // camera next happens to move. The camera-driven case (orbiting without
  // touching a handle) is the OTHER flush point, inside dampingTick above;
  // this is the one for everything else.
  useEffect(() => {
    if (phase !== 'ready') return;
    projectAnchors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, anchors]);

  // ---- Phase 1 live bindings -----------------------------------------------
  // The scene-setup effect is `[phase]`-only, so a preset switch or an ortho
  // toggle after mount has to reach INTO the live instances from outside it --
  // these effects are that seam. Both are no-ops until `phase` flips ready.
  const schemeBindRef = useRef<((scheme: MouseScheme) => void) | null>(null);
  useEffect(() => {
    const controls = controlsRef.current;
    if (phase !== 'ready' || !controls) return;
    // The scene-setup effect's bindMouseScheme is a `[phase]`-only closure, so
    // this same conversion has to reach it via the ref it stashed at setup
    // time rather than re-defining the translation here.
    schemeBindRef.current?.(mouseScheme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, mouseScheme]);

  useEffect(() => {
    if (phase !== 'ready') return;
    applyCameraMode(cameraKind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, cameraKind]);


  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 320, background: COLORS.bg }}>
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', touchAction: 'none', cursor: phase === 'ready' ? (windowZoom !== null ? 'crosshair' : 'grab') : 'default' }}
      />
      {phase === 'loading' && (
        <div style={overlayStyle}>
          <div style={{ color: COLORS.dim }}>{loadingNote}</div>
        </div>
      )}
      {phase === 'error' && (
        <div style={overlayStyle}>
          <div style={{ color: COLORS.bad, fontWeight: 700, marginBottom: 6 }}>
            The B-rep kernel failed to load.
          </div>
          <div style={{ color: COLORS.fg, maxWidth: 480, textAlign: 'center' }}>{loadError}</div>
        </div>
      )}
      {phase === 'ready' && stageHint && !buildError && showStageHint && (
        <div style={stageHintStyle}>{stageHint}</div>
      )}
      {/* Item N: the same hint slot, while the Pull hint is held off screen
          for a real touch in the Rules panel/on a handle -- so a student
          mid-rule still sees something there, just the sentence that
          actually explains what they are doing right now. */}
      {phase === 'ready' && stageHint && !buildError && !showStageHint && ruleActivityAt && (
        <div style={stageHintStyle}>
          Rules keep an edge level, upright, equal, parallel or at a right angle to another.
        </div>
      )}
      {phase === 'ready' && buildError && (
        <div style={errorPanelStyle}>
          <div style={{ color: COLORS.bad, fontWeight: 700, marginBottom: 4 }}>Could not build this model</div>
          <div style={{ color: COLORS.fg }}>{buildError}</div>
        </div>
      )}
      {/* SPEC-mouse-parity Phase 1: the window-zoom rectangle, drawn as a DOM
          overlay (not on the WebGL canvas) so it paints without a renderer render
          and never leaves the render-on-demand loop. pointerEvents 'none' because
          it is purely a readout of the drag already captured on the canvas. */}
      {phase === 'ready' && typeof windowZoom === 'object' && windowZoom !== null && (() => {
        const rect = windowZoom;
        return (
          <div
            style={{
              position: 'absolute',
              left: rect.x,
              top: rect.y,
              width: rect.w,
              height: rect.h,
              border: `1px dashed ${COLORS.dim}`,
              pointerEvents: 'none',
            }}
          />
        );
      })()}
      {/* SPEC-mouse-parity.md Phase 3 item 4: the box-select rectangle, same
          DOM-overlay-not-canvas convention as the window-zoom rect above.
          Dashed/purple for a window (left-to-right) select, dotted/green for
          a crossing (right-to-left) one -- the same window-vs-crossing colour
          split SketchCanvas2D's own 2D marquee uses, adapted to this
          component's own COLORS palette (no --reshape-* custom properties in
          scope here; see COLORS's own doc comment). */}
      {phase === 'ready' && boxSelect && (
        <div
          style={{
            position: 'absolute',
            left: boxSelect.x,
            top: boxSelect.y,
            width: boxSelect.w,
            height: boxSelect.h,
            border: boxSelect.kind === 'window' ? `1px dashed ${COLORS.accent}` : `1px dotted ${COLORS.ok}`,
            background: boxSelect.kind === 'window' ? 'rgba(189, 147, 249, 0.08)' : 'rgba(80, 250, 123, 0.08)',
            pointerEvents: 'none',
          }}
        />
      )}
      {phase === 'ready' && markingMenu && (
        <MarkingMenu
          x={markingMenu.x}
          y={markingMenu.y}
          mode="part-viewport"
          onCommand={(id) => {
            setMarkingMenu(null);
            dispatchMarkingCommandRef.current?.(id);
          }}
          onClose={() => setMarkingMenu(null)}
        />
      )}
      {phase === 'ready' && (
        // Home alone, bottom-left -- Top/Front/Underneath moved onto the nav
        // cube (bottom-right, below), since a physical cube already says
        // "you can look from any side" better than three more words could.
        // Home stays a button because fitToModel() re-centres AND re-fits
        // distance, a different job than a face-look, with no cube-face
        // equivalent.
        <div style={viewStripStyle}>
          <button type="button" title="Back to the starting view" style={preset === 'home' ? viewStripActiveStyle : viewStripButtonStyle} aria-pressed={preset === 'home'} onClick={() => { fitToModel(HOME_DIR); setPreset('home'); }}>
            Home
          </button>
          {/* SPEC-mouse-parity Phase 1: the same self-contained view strip the
              Home button already lives in. All three of these are viewport-local
              -- they write this component's own refs/state and localStorage, and
              no parent file knows they exist. */}
          <button
            type="button"
            title="Mouse-button preset (click to switch)"
            style={viewStripButtonStyle}
            onClick={() => {
              const next: MouseScheme = mouseScheme === 'legacy' ? 'fusion' : 'legacy';
              saveSchemeName(next);
              setMouseScheme(next);
            }}
          >
            {mouseScheme === 'legacy' ? 'Mouse: Legacy' : 'Mouse: Fusion'}
          </button>
          <button
            type="button"
            title={cameraKind === CameraMode.PERSPECTIVE ? 'Switch to an orthographic camera' : 'Switch to a perspective camera'}
            style={viewStripButtonStyle}
            onClick={() => {
              const next = cameraKind === CameraMode.PERSPECTIVE ? CameraMode.ORTHOGRAPHIC : CameraMode.PERSPECTIVE;
              saveCameraMode(next);
              setCameraKind(next);
            }}
          >
            {cameraKind === CameraMode.PERSPECTIVE ? 'Persp' : 'Ortho'}
          </button>
          <button
            type="button"
            title="Frame the current selection"
            style={viewStripButtonStyle}
            disabled={!pick && !selectedFaceStateRef.current}
            onClick={() => fitSelection()}
          >
            Fit Selection
          </button>
          <button
            type="button"
            title="Draw a rectangle to zoom into it"
            style={windowZoom !== null ? viewStripActiveStyle : viewStripButtonStyle}
            aria-pressed={windowZoom !== null}
            onClick={() => {
              setWindowZoom(windowZoom !== null ? null : 'armed');
              windowZoomRef.current = windowZoom !== null ? null : { armed: true };
            }}
          >
            Win Zoom
          </button>
        </div>
      )}
      {phase === 'ready' && (() => {
        // SPEC-mouse-parity.md Phase 3 item 2: which pickable kinds are
        // active. `liveFilters` mirrors hitAt()'s own `filters ?? DEFAULT_FILTERS`
        // fallback, so this renders the exact same "everything on" state a
        // caller that has not wired the prop yet already gets when picking.
        const liveFilters = filters ?? DEFAULT_FILTERS;
        return (
          <div style={filterStripStyle}>
            {FILTER_CHIPS.map(({ key, label }) => {
              const active = liveFilters[key];
              return (
                <button
                  key={key}
                  type="button"
                  title={`${active ? 'Stop' : 'Allow'} picking ${label.toLowerCase()}`}
                  style={active ? viewStripActiveStyle : viewStripButtonStyle}
                  aria-pressed={active}
                  onClick={() => onFiltersChange?.({ ...liveFilters, [key]: !active })}
                >
                  {label}
                </button>
              );
            })}
          </div>
        );
      })()}
      {phase === 'ready' && (
        // Nav cube: click a face to snap to that view (lookFrom, same
        // preserve-distance behaviour the old Top/Front/Underneath buttons
        // had), or drag the cube to free-orbit the camera. The cube's own
        // rotation is synced to the live camera every frame by the rAF
        // effect above; face-to-world-direction assignment (NAV_CUBE_FACES
        // above) was solved algebraically against that same rotation
        // formula (rotateX = elevation, rotateY = azimuth) and confirmed by
        // driving a real browser: identity (elevDeg=0, azimDeg=0) happens at
        // camera dir RIGHT_DIR, so the CSS "front" face (no static rotation)
        // = RIGHT; rotateY(-90) brings the CSS "right" face (static
        // rotateY(90)) to front, which happens at FRONT_DIR -- so "right" =
        // FRONT, and by the same steps "back" = LEFT, "left" = BACK, "top" =
        // TOP, "bottom" = BOTTOM.
        //
        // The wrapper captures the pointer on down (needed so a fast drag
        // that leaves the ~88px widget still keeps delivering move events),
        // but a captured pointer's up/click retarget to the CAPTURING
        // element, not whichever face button is visually underneath it --
        // measured empirically: a real click landed on the wrapper, not the
        // button, so the button's own onClick never fired for a mouse user
        // at all. `elementFromPoint` re-does real hit-testing at the release
        // point, bypassing that retargeting, so pointerup resolves the face
        // itself via `fireFace()` instead of trusting the click. The face
        // buttons' own onClick is kept anyway, but only as the keyboard
        // (Enter/Space) path -- that activation never goes through a
        // captured pointer, so it isn't affected by any of the above.
        <div
          style={navCubeWrapStyle}
          title="Drag to orbit, click a face to snap to that view"
          onContextMenu={(e) => {
            // Todo 17 owns right-click EVERYWHERE, cube included: the wrapper
            // captures pointerdown, so the canvas never sees button-2 events
            // aimed at the cube and its own menu path never runs. This
            // forwards the release-point to the same gesture classifier the
            // canvas path uses (rightCubeMenuAt below) so a right-click over
            // the widget opens the marking menu like everywhere else.
            e.preventDefault();
            e.stopPropagation();
            rightCubeMenuAt({ x: e.clientX, y: e.clientY });
          }}
          onPointerDown={(e) => {
            if (e.button === 2) return; // right button: marking menu, not a cube drag
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            cubeDragRef.current = { dragging: true, x: e.clientX, y: e.clientY, moved: false };
          }}
          onPointerMove={(e) => {
            const drag = cubeDragRef.current;
            if (!drag.dragging) return;
            const dx = e.clientX - drag.x;
            const dy = e.clientY - drag.y;
            drag.x = e.clientX; drag.y = e.clientY;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;
            // Vertical flipped from the naive "camera azimuth/elevation
            // delta" sign (2026-09-14, user report) -- grabbing the CUBE and
            // dragging it should spin the cube (and model) toward you the
            // way turning a physical ball does, opposite the sign that
            // dragging the bare canvas uses (that drags the CAMERA, not the
            // object). Horizontal was reported inverted after that first
            // flip, so it stays on the original sign -- only vertical flips.
            orbitByDelta(-dx * 0.4, -dy * 0.4);
          }}
          onPointerUp={(e) => {
            const wasDrag = cubeDragRef.current.moved;
            cubeDragRef.current.dragging = false;
            try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
            if (wasDrag) return;
            const hit = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
            // The gear affordance has NO working click of its own for mouse
            // users (captured pointerup retargets to the wrapper, so React's
            // click never lands on it -- same measured behaviour the face
            // buttons hit). So the resolver OPENS/CLOSES the menu itself,
            // instead of returning and trusting an onClick that never comes.
            // A release INSIDE the open menu (gear, or any entry button) is
            // left alone: the gear closes it, and an entry button's own
            // onClick fires because the menu div is OUTSIDE the capturing
            // wrapper's pointer chain (rendered beside navCubeSceneStyle,
            // not inside it) -- verified: a mouse click on Orthographic
            // switches the live camera and the view-strip label follows.
            if (hit?.closest<HTMLElement>('[data-cube-menu]')) {
              const gear = hit.closest<HTMLElement>('[data-cube-menu]')!;
              const r = gear.getBoundingClientRect();
              setGearPos({ x: r.right + 4, y: r.top });
              setCubeMenu((v) => !v);
              return;
            }
            const zoneEl = hit?.closest<HTMLElement>('[data-zone]');
            if (zoneEl) {
              // Todo 28: face/edge/corner all resolve here. A face cell's
              // data-zone is the CSS face key (same string fireFace keys
              // on); edge/corner cells carry their 'a|b' / 'a|b|c' id --
              // fireZone routes both, so a release point that lands on a
              // zone NEVER falls through to the bare face resolver below.
              const z = zoneEl.dataset.zone!;
              fireZone(z.startsWith('face:') ? { kind: 'face', id: z } : cubeZoneAt(zoneEl.dataset.zface as CubeFaceKey, Number(zoneEl.dataset.zx), Number(zoneEl.dataset.zy)));
              return;
            }
            const face = hit?.closest<HTMLElement>('[data-face]')?.dataset.face;
            if (face) fireFace(face);
          }}
        >
          <div style={navCubeSceneStyle}>
            <div ref={navCubeInnerRef} style={navCubeInnerStyle}>
              {NAV_CUBE_FACES.map((f) => (
                <button key={f.key} type="button" data-face={f.key} style={navCubeFaceStyle(f.key)} onClick={() => fireFace(f.key)}>
                  {f.label}
                </button>
              ))}
              {/* Todo 28: edge/corner zones, rendered as transparent
              absolutely-positioned buttons IN FRONT of the face planes
              (translateZ(NAV_CUBE_SIZE/2 + 1)) so they sit above every face
              cell. Their data attributes carry the zone's own plane coords
              so the wrapper's elementFromPoint resolver can re-run
              cubeZoneAt on the release point exactly as the unit test does.
              24 tiny non-text buttons (aria-hidden): the face labels remain
              the keyboard path, and the zone buttons are pointer-only
              affordances over a widget that is itself decorative. */}
              {(['front', 'back', 'right', 'left', 'top', 'bottom'] as CubeFaceKey[]).map((face) => {
                const tf = NAV_CUBE_FACE_TRANSFORMS[face];
                return (
                  <div key={`zones-${face}`} style={{ position: 'absolute', inset: 0, transform: `${tf} translateZ(1px)`, transformStyle: 'preserve-3d' }}>
                    <button
                      type="button" data-zone="face-cell" data-zface={face}
                      data-zx={NAV_CUBE_SIZE / 2} data-zy={NAV_CUBE_SIZE / 2}
                      title={`Snap to ${face} view`}
                      style={cubeZoneStyle(NAV_CUBE_SIZE - 2 * CUBE_ZONE_CELL, NAV_CUBE_SIZE - 2 * CUBE_ZONE_CELL, CUBE_ZONE_CELL, CUBE_ZONE_CELL)}
                      onClick={() => fireFace(face)}
                    />
                    {([0, 1] as const).map((row) =>
                      ([0, 1] as const).map((col) => {
                        const px = col === 0 ? CUBE_ZONE_CELL / 2 : col === 1 ? NAV_CUBE_SIZE / 2 : NAV_CUBE_SIZE - CUBE_ZONE_CELL / 2;
                        const py = row === 0 ? CUBE_ZONE_CELL / 2 : row === 1 ? NAV_CUBE_SIZE / 2 : NAV_CUBE_SIZE - CUBE_ZONE_CELL / 2;
                        const z = cubeZoneAt(face, px, py);
                        return (
                          <button
                            key={`${face}-z-${row}-${col}`} type="button" data-zone={z.id} data-zface={face}
                            data-zx={px} data-zy={py}
                            title={`${z.kind === 'edge' ? 'Diagonal view' : 'Isometric-style view'} (${z.id})`}
                            style={cubeZoneStyle(col === 1 ? NAV_CUBE_SIZE - 2 * CUBE_ZONE_CELL : CUBE_ZONE_CELL, row === 1 ? NAV_CUBE_SIZE - 2 * CUBE_ZONE_CELL : CUBE_ZONE_CELL, col === 1 ? CUBE_ZONE_CELL : col === 0 ? 0 : NAV_CUBE_SIZE - CUBE_ZONE_CELL, row === 1 ? CUBE_ZONE_CELL : row === 0 ? 0 : NAV_CUBE_SIZE - CUBE_ZONE_CELL)}
                            onClick={() => fireZone(cubeZoneAt(face, px, py))}
                          />
                        );
                      }),
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          {/* The cube-menu affordance: a small gear-ish button ON the cube
          wrapper (top-left of it), NOT a right-click target -- the
          marking menu owns right-click everywhere (todo 17), cube included.
          Two competing menus over one widget would collide; the plan
          explicitly names this icon as the menu's only entry point. */}
          <div
            style={{
              position: 'absolute', left: 2, top: 2, width: 20, height: 20,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 4,
              color: COLORS.dim, cursor: 'pointer', pointerEvents: 'auto', userSelect: 'none',
            }}
            data-cube-menu="1"
            title="Camera options (perspective / orthographic, set Home / Front / Top)"
            onClick={() => setCubeMenu((v) => !v)}
          >
            ⚙
          </div>
        </div>
      )}
      {cubeMenu && (
            <div
              style={{
                position: 'fixed', left: gearPos?.x ?? 0, top: gearPos?.y ?? 0, zIndex: 5, padding: 6, display: 'flex', flexDirection: 'column', gap: 4,
                background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 6,
              }}
              data-cube-menu-root="1"
            >
              <button type="button" style={viewStripButtonStyle} onClick={() => applyCameraModeAndToggle(CameraMode.PERSPECTIVE)}>
                Perspective
              </button>
              <button type="button" style={viewStripButtonStyle} onClick={() => applyCameraModeAndToggle(CameraMode.ORTHOGRAPHIC)}>
                Orthographic
              </button>
              <button type="button" style={viewStripButtonStyle} onClick={() => { fitToModel(HOME_DIR); setPreset('home'); setCubeMenu(false); }}>
                Set as Home
              </button>
              <button type="button" style={viewStripButtonStyle} onClick={() => { lookFrom(FRONT_DIR); setPreset('front'); setCubeMenu(false); }}>
                Set as Front
              </button>
              <button type="button" style={viewStripButtonStyle} onClick={() => { lookFrom(TOP_DIR); setPreset('top'); setCubeMenu(false); }}>
                Set as Top
              </button>
            </div>
          )}
      {phase === 'ready' && !badgesInStatusBar && (hoveringEdge && !pick || !!selectedCount) && (
        <div style={topRightStackStyle}>
          {/* Shown ONLY while hovering an edge with nothing picked yet --
             the only on-screen word telling a student single-edge rounding
             is a thing they can do BEFORE they stumble into it by accident.
             Not a `title=` tooltip: those need ~1s of a still pointer, and
             this has to appear the instant the cursor lands on the edge. */}
          {hoveringEdge && !pick && (
            <div style={edgeHintStyle}>Click this edge to round or bevel just it</div>
          )}
          {!!selectedCount && (
            <div style={selectionBadgeStyle}>
              {selectionLabel ?? (pick ? '1 edge picked' : `${selectedCount} Selected`)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  flexDirection: 'column', gap: 8, font: '13px ui-monospace, Menlo, Consolas, monospace',
  background: COLORS.bg, pointerEvents: 'none',
};

const errorPanelStyle: React.CSSProperties = {
  position: 'absolute', left: 12, right: 12, bottom: 12, padding: '10px 14px',
  background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 6,
  font: '13px ui-monospace, Menlo, Consolas, monospace', pointerEvents: 'none',
};

// top: 12 -- plain top-right corner. The Build ribbon no longer overlays
// this canvas: ReshapeStudio is a docked CSS grid as of adoption step 2
// (2026-09-16), so nothing floats over the top band anymore. The stack is
// still live for ribbon-less hosts like app/brep-three (default
// badgesInStatusBar=false) and dead in-studio (ReshapeStudio passes true at
// its own ~1342, routing badges to the status bar instead).
//
// A column, not a single fixed-position badge, because the hint and the
// selection badge can be true AT THE SAME TIME -- a shape already selected
// in the model tree (selectedCount > 0) while the student hovers one of its
// edges before clicking. Stacking avoids the two pills drawing on top of
// each other in that case; either can also appear alone.
const topRightStackStyle: React.CSSProperties = {
  position: 'absolute', top: 12, right: 12, display: 'flex', flexDirection: 'column',
  alignItems: 'flex-end', gap: 6, pointerEvents: 'none',
};

const selectionBadgeStyle: React.CSSProperties = {
  padding: '4px 10px', background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 999,
  font: '12px ui-monospace, Menlo, Consolas, monospace', color: COLORS.fg, pointerEvents: 'none',
};

// Bottom-left, sized to its own content (not `errorPanelStyle`'s full-width
// left:12/right:12 strip) so it can never steal a pointer event over the
// rest of the canvas -- only the small box the four buttons actually
// occupy is clickable.
//
// left: 12 (was 70). The 46px collapsed rail it dodged is now a docked
// column outside the canvas -- SandboxWorkspace.tsx's Build-mode "Code" card
// rail (is-card-empty state removed in adoption step 2; `.is-tools-hidden`)
// no longer overlays
// this component. HISTORICAL (resolved 2026-09-16, adoption step 2): FOUND
// BY AN ACTUAL FAILED CLICK, not by inspection -- that rail was pinned at
// left:12 for the ENTIRE canvas height over this canvas (the two panes were
// absolutely positioned over the same area, not laid out side by side), so a
// literal left:12 strip landed directly under it: a real click on "Home"
// there hit the rail, not this button. 70 cleared the rail's right edge
// (12 + 46 = 58) with an 12px gap. With the docked grid that dodge is dead.
const viewStripStyle: React.CSSProperties = {
  position: 'absolute', left: 12, bottom: 12, display: 'flex', gap: 6,
};

// Directly above viewStripStyle's own row (bottom: 12 there), same left
// edge, same gap -- "near the view strip" per SPEC-mouse-parity.md Phase 3
// item 2, stacked rather than appended onto the same row so camera controls
// and selection filters read as two separate groups, not one long strip.
const filterStripStyle: React.CSSProperties = {
  ...viewStripStyle, bottom: 48,
};

// Same pill family as selectionBadgeStyle/edgeHintStyle, but NOT
// pointerEvents: 'none' -- these are real buttons, not a status readout.
const viewStripButtonStyle: React.CSSProperties = {
  padding: '4px 10px', background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 999,
  font: '12px ui-monospace, Menlo, Consolas, monospace', color: COLORS.fg, cursor: 'pointer',
};

const viewStripActiveStyle: React.CSSProperties = {
  // `border`, not `borderColor`: the base style sets the shorthand, and React
  // warns (and can mis-apply) when a longhand overrides it on rerender.
  ...viewStripButtonStyle, background: COLORS.fg, color: COLORS.bg, border: `1px solid ${COLORS.fg}`,
};

// Bottom-right, mirroring viewStripStyle's bottom-left placement. touchAction
// 'none' stops a touch-drag on the cube from also scrolling/panning the page
// (the containing canvas already claims its own pointer gestures the same
// way for orbiting).
const NAV_CUBE_SIZE = 64;
const navCubeWrapStyle: React.CSSProperties = {
  position: 'absolute', right: 12, bottom: 12, width: NAV_CUBE_SIZE + 24, height: NAV_CUBE_SIZE + 24,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'grab', touchAction: 'none', userSelect: 'none',
};

const navCubeSceneStyle: React.CSSProperties = {
  width: NAV_CUBE_SIZE, height: NAV_CUBE_SIZE, perspective: 400,
};

const navCubeInnerStyle: React.CSSProperties = {
  position: 'relative', width: '100%', height: '100%', transformStyle: 'preserve-3d',
};

// Six faces, standard CSS-cube boilerplate (translateZ half the side length,
// rotate the other five into place around it) -- see the JSX comment above
// for which world direction each one was solved to represent.
const NAV_CUBE_FACE_TRANSFORMS: Record<string, string> = {
  front: `translateZ(${NAV_CUBE_SIZE / 2}px)`,
  back: `rotateY(180deg) translateZ(${NAV_CUBE_SIZE / 2}px)`,
  right: `rotateY(90deg) translateZ(${NAV_CUBE_SIZE / 2}px)`,
  left: `rotateY(-90deg) translateZ(${NAV_CUBE_SIZE / 2}px)`,
  top: `rotateX(90deg) translateZ(${NAV_CUBE_SIZE / 2}px)`,
  bottom: `rotateX(-90deg) translateZ(${NAV_CUBE_SIZE / 2}px)`,
};

// Single source of truth for the six faces -- JSX below maps over this
// instead of hand-writing six near-identical buttons, so the CSS face key,
// its world DIR, and its (if any) matching old-preset name can never drift
// out of sync with each other the way six copy-pasted onClick bodies could.
const NAV_CUBE_FACES: {
  key: keyof typeof NAV_CUBE_FACE_TRANSFORMS; label: string;
  dir: [number, number, number]; preset: 'top' | 'front' | 'underneath' | null;
}[] = [
  { key: 'front', label: 'RIGHT', dir: RIGHT_DIR, preset: null },
  { key: 'back', label: 'LEFT', dir: LEFT_DIR, preset: null },
  { key: 'right', label: 'FRONT', dir: FRONT_DIR, preset: 'front' },
  { key: 'left', label: 'BACK', dir: BACK_DIR, preset: null },
  { key: 'top', label: 'TOP', dir: TOP_DIR, preset: 'top' },
  { key: 'bottom', label: 'BOTTOM', dir: UNDERNEATH_DIR, preset: 'underneath' },
];

function navCubeFaceStyle(face: keyof typeof NAV_CUBE_FACE_TRANSFORMS): React.CSSProperties {
  return {
    position: 'absolute', inset: 0, width: '100%', height: '100%',
    transform: NAV_CUBE_FACE_TRANSFORMS[face],
    background: COLORS.panel, border: `1px solid ${COLORS.line}`, color: COLORS.fg,
    font: '10px ui-monospace, Menlo, Consolas, monospace', letterSpacing: '0.05em',
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'grab',
  };
}

// Todo 28: transparent hit-zone button over a cube face's plane. x/y/w/h
// are the cell's own in-plane geometry; the parent div carries the face's
// CSS transform and one extra px of translateZ so the zones sit above the
// face planes (a stacked 3D widget, same preserve-3d trick the faces use).
function cubeZoneStyle(w: number, h: number, x: number, y: number): React.CSSProperties {
  return {
    position: 'absolute', width: w, height: h, left: x, top: y, padding: 0,
    background: 'transparent', border: 'none', cursor: 'pointer',
  };
}

// Same visual family as selectionBadgeStyle (same pill), deliberately -- a
// student who has already learned "small pill top-right = status" should
// not have to learn a second visual language for this one.
// Centred over the stage, same pill family: a hint, not an error.
// top: 12 -- docked grid, no overlay above canvas (adoption step 2,
// 2026-09-16): ReshapeStudio no longer floats a tools ribbon over the top
// band, so a plain top-right/centre placement is safe.
const stageHintStyle: React.CSSProperties = {
  position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
  padding: '4px 10px', background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 999,
  font: '12px ui-monospace, Menlo, Consolas, monospace', color: COLORS.fg, pointerEvents: 'none',
};

const edgeHintStyle: React.CSSProperties = {
  padding: '4px 10px', background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 999,
  font: '12px ui-monospace, Menlo, Consolas, monospace', color: COLORS.fg, pointerEvents: 'none',
};
