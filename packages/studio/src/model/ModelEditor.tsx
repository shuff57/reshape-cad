'use client';

// The mouse half of the JSCAD workspace: a toolbar of shapes and operations,
// and the ordered list of what they built.
//
// The list is the point. Each row is a statement, the order decides the result,
// and Cut 1 reading "Box 1 - Cylinder 1" is the same fact as
// booleans.subtract(box1, cyl1) in the generated file next to it.
//
// Toolbar grouping mirrors Onshape's Part Studio bar (fetched from
// cad.onshape.com/help — see .gauntlet/parity.json "chrome" entry): tools run
// create -> modify -> pattern/transform -> delete, separated by dividers, and
// a family with variants (five primitives, three booleans, fillet/chamfer,
// linear/circular pattern, move/copy) collapses into ONE button with a caret
// flyout whose face shows the last variant used, instead of one button per
// variant. Search tools (Onshape: alt+c) is the same idea here.
//
// Deliberately NOT copied: Onshape puts Undo/Redo at the far left and buries
// Delete mid-bar next to Transform. reSHape keeps Undo/Redo/Delete clustered at
// the end, as it already did before this pass — for a first CS course "the
// row at the end for fixing mistakes" is one easy-to-teach unit, and there is
// no reach-distance problem here worth optimizing away from that.

import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import {
  Box as BoxIcon,
  Circle,
  Cylinder as CylIcon,
  Cone as ConeIcon,
  Torus as TorusIcon,
  Combine,
  Scissors,
  SquareDashedBottom,
  PenLine,
  MoveUp,
  PanelLeftClose,
  RotateCw,
  Trash2,
  Undo2,
  Redo2,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
  Disc3,
  Layers,
  FlipHorizontal2,
  FlipHorizontal,
  FlipVertical2,
  MoveHorizontal,
  RefreshCw,
  CircleDot,
  Grid2x2,
  PackageOpen,
  Move as MoveIcon,
  Copy as CopyIcon,
  SquareRoundCorner,
  Octagon,
  Save,
  FolderOpen,
  Download,
  Eraser,
  ArrowLeft,
} from 'lucide-react';
import { withoutFeatures, orphanedBy } from '@shuff57/reshape-script/model-deps';
import {
  type Feature,
  type FilletFeature,
  type ModelDoc,
  type RoundStyle,
  type SketchFeature,
  type SketchPlane,
  canRotate,
  dependsOn,
  extentAlong,
  isRoundable,
  maxRound,
  nameMap,
  newExtrude,
  newHole,
  newHoleCorners,
  newBlend,
  newMirror,
  newPattern,
  newRevolve,
  newShape,
  newShell,
  newSketch,
  shellInsertion,
  whyCannotBlend,
  newMove,
  nextId,
  type ShapeKind,
  topLevel,
  whyCannotOrbit,
  whyCannotRound,
} from '@shuff57/reshape-script/model-types';
import { partWordFor, type TopoName } from '@shuff57/reshape-script/topo-name';
import { ownerOf } from '@shuff57/reshape-script/model-selection';

interface Props {
  doc: ModelDoc;
  onChange: (next: ModelDoc) => void;
  /** Lifted so the preview knows whose drag handles to draw. */
  selected: string[];
  onSelect: (ids: string[]) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Bumped by the caller on every Undo/Redo, whichever way it was
   *  triggered -- the toolbar button here, or the Ctrl+Z/Ctrl+Shift+Z
   *  shortcut, which the caller owns and this component never sees
   *  directly. Clears the info banner below on change (see its own
   *  effect): an Undo that puts a curved edge back to straight left the
   *  banner still claiming it curves (EXPLORE-2d, 2026-09-04), because
   *  nothing told this component the doc it is reading just moved a step
   *  in time rather than forward from a fresh edit. */
  historyGen?: number;
  /** When set, the panel breaks down to a thin preview bar and back. Used by
   *  the sandbox's Build mode, where the canvas owns the window and the tools
   *  are a sidebar the student can hide to look at the shape. The state lives
   *  here — inside the editor — rather than in the sandbox, so the shape
   *  toolbar's own strip is the only control that moves it. */
  collapsible?: boolean;
  /** Mirrors the collapsed state up, so the sandbox can dress its shell
   *  (the floating panel must turn transparent when the strip is all that
   *  is left of it, or a 420px card sits over the canvas). */
  onCollapsed?: (collapsed: boolean) => void;
  /** Mirrors whether the card holds anything (a note or the sketch rules).
   *  The feature list lives in the bottom timeline now, so an empty card is
   *  hidden entirely rather than sitting over the canvas as a click-eater. */
  onContentChange?: (hasContent: boolean) => void;
  /** Rollback bar boundary (0..features.length): features at or past this
   *  index are suppressed from the rebuilt model. null means "show everything".
   *  A view change, not a structural edit -- the sandbox regenerates the live
   *  runner when this changes, without touching the doc or its history. */
  rollbackIndex?: number | null;
  /** Set the rollback boundary, or null to clear it (show the full model). */
  onRollback?: (i: number | null) => void;
  /**
   * An edge picked in the 3D viewport (BrepViewportThree's `onPick`), lifted
   * up alongside `selected` for the same reason: the pick outlives any one
   * render and the sandbox is what owns the viewport this came from.
   *
   * `edge` is null when the picked edge is real (and highlighted in the
   * viewport) but could not be turned into a TopoName -- anything past a box
   * or cylinder; see nameEdgeBetweenPrimitiveFaces() in lib/topo-resolve.ts.
   * round() below only acts on a non-null edge and otherwise falls back to
   * the whole-shape tool, same as picking nothing at all.
   */
  pickedEdge?: { target: string; edge: TopoName | null } | null;
  /** Called once a picked edge has been consumed into a new FilletFeature,
   *  so the sandbox stops pinning a selection that no longer points at
   *  anything useful (its target feature is now consumed -- see topLevel()). */
  onClearPickedEdge?: () => void;
  /** The last FACE picked in the viewport, the same way pickedEdge tracks an
   *  edge -- see ShellFeature.open. `face` is null the same way pickedEdge's
   *  `edge` can be: a real pick that could not be traced back to a named
   *  primitive face (see nameFaceOnCurrentShape() in lib/topo-resolve.ts).
   *  openHollow() below only acts on a non-null face and otherwise refuses
   *  with a reason, rather than falling back to a closed hollow silently. */
  pickedFace?: { target: string; face: TopoName | null } | null;
  /** Called once a picked face has been consumed into a new open ShellFeature,
   *  the same reason onClearPickedEdge exists. */
  onClearPickedFace?: () => void;
  /**
   * Every edge the student has Shift-added to the selection (item E), most
   * recent last -- purely additive over `pickedEdge` above, which keeps
   * meaning "the most recent pick" for every consumer that only ever cared
   * about one edge (the tooltip, the disabled-state message, Hole/Hollow's
   * own single-face requirement). round() below only takes the multi-edge
   * path once two or more of these resolve to the SAME solid as `chosen`;
   * otherwise it falls straight through to the single-edge/whole-shape
   * logic that already existed, unchanged.
   */
  pickedEdges?: Array<{ target: string; edge: TopoName }>;
  /** Called once every edge in a multi-selection has been consumed into new
   *  FilletFeatures, the same reason onClearPickedEdge exists. */
  onClearPickedEdges?: () => void;
  /** Feature id -> why that feature could not be built, from the B-rep build.
   *  A refused feature is ABSENT from the model but still present in the
   *  history, which without this marker looks like the app ignoring a click. */
  refusals?: Map<string, string>;
  /** Adoption step 4 piece B: this component's own toolbar verbs (the same
   *  remove/round/hole/... closures the ribbon buttons call), handed UP so
   *  ReshapeStudio's context bar can offer them without owning a second
   *  copy of any verb. Null on unmount/collapse of the thing being handed;
   *  the caller treats null as "no actions, omit the buttons". */
  registerContextActions?: (actions: ContextActions | null) => void;
  /** The File group's own gate -- the same condition the retired MenuBar.tsx
   *  used to compute, now read directly by the ribbon's File group instead of
   *  being handed up to a second component. */
  hasMesh: boolean;
  onExportSTL: () => void;
  onExportOBJ: () => void;
  onExport3MF: () => void;
  /** Same `canBuild` gate the retired MenuBar's Clear-model item used. */
  canClearModel: boolean;
  onClearModel: () => void;
  /** Which plane a new Sketch/Circle/Rectangle/Polygon starts on -- set by
   *  clicking a plane in this component's own Planes tree (see the
   *  `model-browser` JSX below). Lives in the caller (ReshapeStudio) since
   *  the Rectangle/Polygon draw tool's own placement handler is there too. */
  activePlane: SketchPlane;
  onActivePlaneChange: (plane: SketchPlane) => void;
  /** True while a sketch is open in the 2D constraint sketcher (ReshapeStudio's
   *  sketchEditId is set). The ribbon shows only File/Edit and a Done button
   *  while this holds, and Sketch/Circle route into 2D instead of the legacy
   *  drag-corners-in-3D flow -- the clear 2D/3D tool divide this exists for. */
  sketchMode?: boolean;
  /** Create a sketch, then hand its id to the caller to open in the 2D
   *  sketcher -- the caller owns sketchEditId (see sketchMode above). */
  onOpenSketch2D?: (id: string) => void;
  /** Leave the 2D sketcher and return to the 3D ribbon. */
  onExitSketch2D?: () => void;
}

type BoolOp = 'union' | 'subtract' | 'intersect';
type PatternMode = 'linear' | 'circular';
type MenuId = 'shape' | 'bool' | 'round' | 'pattern' | 'move' | 'mirror' | 'hole' | 'hollow' | 'export' | null;

/** Adoption step 4 piece B: the toolbar's own verbs, handed up to the caller
 *  (ReshapeStudio's context bar) via registerContextActions. Each entry IS
 *  the same closure the ribbon button calls -- thin arrows, no second
 *  implementation of any verb, so a context-bar Round and a ribbon Round
 *  can never drift apart. RoundStyle/SketchPlane/PatternMode mirror the
 *  toolbar's own flyout signatures. */
export interface ContextActions {
  remove: () => void;
  moveTool: (copy: boolean) => void;
  round: (style: RoundStyle) => void;
  drillHole: () => void;
  hollow: () => void;
  pull: () => void;
  spin: () => void;
  turn: () => void;
  repeat: (mode: PatternMode) => void;
  mirror: (plane: SketchPlane) => void;
}

function shapeIcon(kind: ShapeKind) {
  if (kind === 'box') return <BoxIcon size={14} />;
  if (kind === 'cylinder') return <CylIcon size={14} />;
  if (kind === 'cone') return <ConeIcon size={14} />;
  if (kind === 'torus') return <TorusIcon size={14} />;
  return <Circle size={14} />;
}
function shapeLabel(kind: ShapeKind) {
  return kind === 'box' ? 'Box'
    : kind === 'cylinder' ? 'Cylinder'
    : kind === 'cone' ? 'Cone'
    : kind === 'torus' ? 'Ring'
    : 'Sphere';
}
const SHAPE_KINDS: ShapeKind[] = ['box', 'cylinder', 'sphere', 'cone', 'torus'];

function boolIcon(op: BoolOp) {
  if (op === 'union') return <Combine size={14} />;
  if (op === 'subtract') return <Scissors size={14} />;
  return <SquareDashedBottom size={14} />;
}
/** Item P: the same inset-from-the-side conversion generatedParams()/
 *  applyParam() (lib/model-codegen.ts) apply to the Dimensions panel,
 *  used here so the timeline chip says the same number the panel does --
 *  "4 holes ⌀6, 8 in from the sides" -- rather than the raw stored
 *  centre-offset nothing else on screen matches. One number when both
 *  axes agree (the common case, and what a student actually typed); both
 *  named when they do not. Falls back to the raw dx/dy the same way the
 *  panel does when the target's own extent cannot be read (a Move, a
 *  rotated shape, ...). */
function cornerInsetText(doc: ModelDoc, target: string, corners: { dx: number; dy: number }): string {
  const fullX = extentAlong(doc, target, 'x');
  const fullY = extentAlong(doc, target, 'y');
  const round = (n: number) => Math.round(n * 100) / 100;
  const insetX = round(fullX != null ? fullX / 2 - corners.dx : corners.dx);
  const insetY = round(fullY != null ? fullY / 2 - corners.dy : corners.dy);
  return insetX === insetY ? `${insetX} in from the sides` : `${insetX} in from the sides across, ${insetY} up`;
}

function boolLabel(op: BoolOp) {
  return op === 'union' ? 'Join' : op === 'subtract' ? 'Cut' : 'Overlap';
}
const BOOL_OPS: BoolOp[] = ['union', 'subtract', 'intersect'];

// Decision, naming disagreement resolved: reference.md and studentWord()
// (lib/model-check.ts) both call this "bevel", so the button follows them
// rather than keeping its own plain-English "Angled Corner" -- one word for
// the tool everywhere a student meets it (toolbar, chip, failure message),
// not three. "Angled Corner" survives only as a search alias (see
// FlyoutVariant.alias) for a student who learned the old name first.
function roundLabel(style: RoundStyle) {
  return style === 'fillet' ? 'Round' : 'Bevel';
}
function roundIcon(style: RoundStyle) {
  return style === 'fillet' ? <SquareRoundCorner size={14} /> : <Octagon size={14} />;
}
// `edgePicked` is `pickedEdgeUsable` at the call site: round() tries the
// single-edge Fillet path FIRST whenever that is true (see round()'s own
// doc comment), so the button's title has to say so BEFORE the click, not
// just after -- a title that always read "Round the edges" was the whole
// reason single-edge rounding was invisible even though it already worked.
function roundDescription(style: RoundStyle, edgePicked: boolean) {
  if (edgePicked) {
    return style === 'fillet' ? 'Round this edge' : 'Bevel this edge';
  }
  return style === 'fillet'
    ? 'Round every edge. To round just one, click that edge first.'
    : 'Bevel every edge. To bevel just one, click that edge first.';
}
const ROUND_STYLES: RoundStyle[] = ['fillet', 'chamfer'];

function patternIcon(mode: PatternMode) {
  return mode === 'linear' ? <MoveHorizontal size={14} /> : <RefreshCw size={14} />;
}
function patternLabel(mode: PatternMode) {
  return mode === 'linear' ? 'Repeat' : 'Repeat Around';
}
const PATTERN_MODES: PatternMode[] = ['linear', 'circular'];

function moveIcon(copy: boolean) {
  return copy ? <CopyIcon size={14} /> : <MoveIcon size={14} />;
}
function moveLabel(copy: boolean) {
  return copy ? 'Copy' : 'Move';
}

// The plane is named by which way it flips, not by its axis letters -- "yz"
// means nothing to a student, but "left to right" is the picture in their
// head. The real CAD name still reaches them, in the tooltip.
const MIRROR_PLANES: SketchPlane[] = ['yz', 'xz', 'xy'];
function mirrorPlaneLabel(plane: SketchPlane) {
  return plane === 'yz' ? 'Left-Right' : plane === 'xz' ? 'Front-Back' : 'Top-Bottom';
}
function mirrorPlaneIcon(plane: SketchPlane) {
  return plane === 'yz' ? <FlipHorizontal2 size={14} />
    : plane === 'xz' ? <FlipHorizontal size={14} />
    : <FlipVertical2 size={14} />;
}
function mirrorPlaneTitle(plane: SketchPlane) {
  return plane === 'yz' ? 'Mirror left to right (the real name: the yz plane)'
    : plane === 'xz' ? 'Mirror front to back (the real name: the xz plane)'
    : 'Mirror top to bottom (the real name: the xy plane)';
}

/** A sketch can be pulled or spun, never both — either would produce a
 *  second solid from the same outline. Tells the caller which already claimed it. */
function sketchClaimedBy(doc: ModelDoc, id: string): 'extrude' | 'revolve' | null {
  for (const f of doc.features) {
    if ((f.kind === 'extrude' || f.kind === 'revolve') && f.target === id) return f.kind;
  }
  return null;
}

function whyCannotSolidOp(chosen: Feature[], verb: string): string | null {
  if (chosen.length !== 1) return `Pick one shape to ${verb}.`;
  if (chosen[0].kind === 'sketch') {
    return `${verb[0].toUpperCase()}${verb.slice(1)} works on a solid, not a flat sketch — pull or spin it into one first.`;
  }
  return null;
}

interface FlyoutVariant {
  id: string;
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  /** A retired display name kept searchable so a student who remembers it
   *  still finds the tool -- e.g. Bevel's own "Angled Corner" (see
   *  roundLabel's own comment). Checked the same way `id` already is;
   *  never shown anywhere, only searched. */
  alias?: string;
}

/** One family of tools (five primitives, three booleans, ...) collapsed into a
 *  single button whose face is the last variant used, plus a caret that opens
 *  the rest. Matches the Onshape flyout pattern this toolbar is modeled on. */
function FlyoutButton({
  label, icon, onMain, disabled, title, open, onToggleOpen, variants, matches, searchActive, alias,
}: {
  label: string;
  icon: ReactNode;
  onMain: () => void;
  disabled: boolean;
  title: string;
  open: boolean;
  onToggleOpen: () => void;
  variants: FlyoutVariant[];
  /** Checked against a variant's label, its id, and its retired alias (see
   *  FlyoutVariant.alias) if it has one, so a variant can still be found by
   *  its real-world/CAD name (searching "chamfer") or its own retired
   *  display name (searching "Angled Corner") even when its visible label
   *  is neither. */
  matches: (text: string) => boolean;
  /** Whether the search box currently has text in it. */
  searchActive: boolean;
  /** The face's own retired name, when the last-used variant has one --
   *  same reasoning as FlyoutVariant.alias, for the main button rather
   *  than a dropdown row. */
  alias?: string;
}) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const shown = variants.filter((v) => matches(v.label) || matches(v.id) || (v.alias ? matches(v.alias) : false));
  const faceMatches = matches(label) || (alias ? matches(alias) : false);
  const filteredOut = !faceMatches && shown.length === 0;
  // A match hiding inside a closed flyout is invisible to the student who
  // typed for it -- if the face itself doesn't match but a variant does,
  // pop the flyout open so the match is on screen, not just in the data.
  const revealed = !filteredOut && (open || (searchActive && !faceMatches && shown.length > 0));
  // The bar can scroll sideways, and a box that scrolls on one axis clips the
  // other -- an absolutely positioned menu would be sliced off inside a 38px
  // strip. So the menu is measured off the button and positioned against the
  // viewport instead, out of the bar's clip entirely.
  // ponytail: measured on open only. Scrolling the bar with a menu already
  // open leaves it where it was; clicking anywhere closes it, which is the
  // next thing a student does.
  //
  // This hook runs BEFORE the filtered-out return on purpose. Typing in the
  // search box unmounts most of the bar, and a hook below that return means
  // this component renders a different number of hooks on that keystroke than
  // it did on the last one -- which React treats as a crash, taking the whole
  // toolbar with it.
  useEffect(() => {
    if (!revealed) { setAt(null); return; }
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setAt({ left: r.left, top: r.bottom + 3 });
  }, [revealed]);
  if (filteredOut) return null;
  return (
    <span className="model-flyout" ref={wrapRef}>
      <button onClick={onMain} disabled={disabled} title={title}>
        {icon} {label}
      </button>
      <button
        className="model-flyout-caret"
        onClick={onToggleOpen}
        disabled={disabled}
        aria-label={`More ${label.toLowerCase()} tools`}
        title={`More ${label.toLowerCase()} tools`}
      >
        <ChevronDown size={9} />
      </button>
      {revealed && at && shown.length > 0 && (
        <div className="model-flyout-menu" style={{ left: at.left, top: at.top }}>
          {shown.map((v) => (
            <button key={v.id} onClick={v.onClick} disabled={v.disabled} title={v.title}>
              {v.icon} {v.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

export default function ModelEditor({
  doc, onChange, selected, onSelect, onUndo, onRedo, canUndo, canRedo, collapsible, onCollapsed, onContentChange, rollbackIndex, onRollback, pickedEdge, onClearPickedEdge, pickedFace, onClearPickedFace, pickedEdges, onClearPickedEdges, refusals,
  registerContextActions, historyGen,
  hasMesh, onExportSTL, onExportOBJ, onExport3MF,
  canClearModel, onClearModel, activePlane, onActivePlaneChange,
  sketchMode, onOpenSketch2D, onExitSketch2D,
}: Props) {
  const [note, setNote] = useState<string | null>(null);
  // Which single rule the student most recently set or changed in the Rules
  // panel, if any -- so the toolbar Delete can tell "delete this rule" apart
  // from "delete the whole sketch". Both stay selected together (the Rules
  // panel only ever shows for the one selected sketch), so selection alone
  // cannot make that call; EXPLORE-2d.md's own reproduction (cycle Edges 1
  // and 2 to equal, press the toolbar Delete, the ENTIRE SKETCH vanished)
  // is exactly the case this exists to catch. Cleared whenever the student
  // re-clicks a chip (pick(), below) -- a fresh click on the sketch's own
  // chip is what re-arms "the sketch goes" per item B.
  // Pending confirmation for a Delete that would take dependents with it
  // (item B / D4): named in the course's words, Delete or Keep, Undo still
  // works afterward same as any other edit. A delete with NOTHING riding on
  // it (the common case) still goes through immediately -- only a delete
  // that would silently cost the student more than they clicked gets a stop
  // sign, the same principle Clear model already applies to wiping the
  // whole document.
  const [confirmDelete, setConfirmDelete] = useState<{ ids: string[]; message: string; removedNames: string[] } | null>(null);
  // A note describes something that just happened going FORWARD -- a rule
  // applied, a refusal explained. An Undo/Redo moves the doc a step in
  // TIME instead, and whatever note was on screen may no longer describe
  // it at all (EXPLORE-2d, 2026-09-04: undoing a Bow left "Edge 1 now
  // curves..." on screen after the edge was straight again). Skips the
  // very first render (historyGen starts undefined/0 with nothing to
  // clear) so mounting fresh never wipes a note some OTHER effect just set
  // in the same tick.
  const historyGenMounted = useRef(false);
  useEffect(() => {
    if (!historyGenMounted.current) { historyGenMounted.current = true; return; }
    setNote(null);
    setConfirmDelete(null);
  }, [historyGen]);
  // An empty document has nothing for a note to be about: Reset clears the
  // model but used to leave "Hollowed, open at the face you clicked." beside
  // "Nothing here yet" (moderate lens, round 2).
  //
  // suppressEmptyNoteClear is the one exception: a cascading Delete that
  // empties the WHOLE document is exactly the case item B/D4's after-state
  // note exists for ("Box 1 and Round 1 removed. Undo puts them back.") --
  // without it, this same effect fired on the very same features.length
  // transition and wiped that note before a student ever saw it.
  const suppressEmptyNoteClear = useRef(false);
  useEffect(() => {
    if (doc.features.length === 0) {
      if (suppressEmptyNoteClear.current) {
        suppressEmptyNoteClear.current = false;
      } else {
        setNote(null);
      }
      setConfirmDelete(null);
    }
  }, [doc.features.length]);
  const [search, setSearch] = useState('');
  const [menu, setMenu] = useState<MenuId>(null);
  // A collapsible editor starts out expanded: the tools are the point of
  // Build mode, so the panel's first face is the full toolbar and list over
  // the canvas. The rail is what collapsing buys -- shapes-only, with the
  // essential tools still one click away.
  const [collapsed, setCollapsed] = useState(false);
  const collapse = (next: boolean) => {
    setCollapsed(next);
    onCollapsed?.(next);
  };
  const [lastShape, setLastShape] = useState<ShapeKind>('box');
  const [lastRound, setLastRound] = useState<RoundStyle>('fillet');
  const [lastPattern, setLastPattern] = useState<PatternMode>('linear');
  const [lastMoveCopy, setLastMoveCopy] = useState(false);
  // null until the student has picked a plane once -- see mirror() below.
  // There is no safe default here the way 'fillet' or 'linear' are for the
  // other flyouts: the wrong plane produces a solid that LOOKS fine and is
  // wrong, so the first click has to ask rather than guess.
  const [lastMirrorPlane, setLastMirrorPlane] = useState<SketchPlane | null>(null);
  const setSelected = onSelect;

  const toolsRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // Onshape's Search tools is a magnifier that opens a field, not a field
  // parked on the bar. Same thing here, and it is also what keeps the last
  // chip from being sliced in half when the bar runs out of room.
  const [searchOpen, setSearchOpen] = useState(false);

  // Build mode renders the tools bar into the ribbon at the top of the
  // canvas, Onshape-style, instead of inside the feature card. A portal keeps
  // React in charge of the node wherever it sits -- a manual appendChild
  // crashed the tree on collapse, because React then tried to removeChild the
  // bar from a parent it no longer had. The host is a sibling of the card in
  // the toolbar, so it exists before this component mounts and there is no
  // portal-target race.
  // Not gated on `collapsed` -- unlike the Parts/Planes tree below (and the
  // Rules panel further down), the ribbon is a fixed top toolbar now, not
  // part of the collapsible left card it used to share a "tools card" with.
  // Collapsing used to hide the ribbon and timeline along with the tree
  // (they all gated on the same `collapsible && !collapsed`), which meant
  // the one button meant to shrink the left panel also blanked the entire
  // toolbar -- collapse now only affects the tree/rail below.
  const ribbonHost =
    typeof document !== 'undefined' && collapsible
      ? document.getElementById('reshapeRibbon')
      : null;
  // The feature list is the parametric timeline: a horizontal strip across
  // the bottom of the canvas, Fusion 360 style, instead of a vertical list
  // in the left card. Same portal pattern as the ribbon -- the host is a
  // sibling rendered by the sandbox, so it exists before this mounts. Same
  // "not gated on collapsed" reasoning as ribbonHost just above.
  const timelineHost =
    typeof document !== 'undefined' && collapsible
      ? document.getElementById('reshapeTimeline')
      : null;
  // Alt+C (Onshape's own shortcut) focuses Search tools; Escape closes
  // whichever flyout is open, wherever focus happens to be.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.altKey && e.code === 'KeyC') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === 'Escape') {
        setMenu(null);
        setSearchOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The field only exists once it is open, so focus has to wait for it.
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  // A flyout menu closes on any click outside the toolbar, same as a native
  // dropdown -- otherwise it just sits open over the canvas.
  useEffect(() => {
    if (!menu) return;
    function onDocClick(e: MouseEvent) {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) setMenu(null);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menu]);

  const chosen = doc.features.filter((f) => selected.includes(f.id));
  const names = nameMap(doc);
  const parts = topLevel(doc);
  const shownIds = new Set(parts.map((f) => f.id));

  function matches(text: string): boolean {
    const q = search.trim().toLowerCase();
    return !q || text.toLowerCase().includes(q);
  }
  const searchActive = search.trim() !== '';
  function toggleMenu(id: MenuId) {
    setMenu((m) => (m === id ? null : id));
  }

  function say(msg: string | null) {
    setNote(msg);
  }

  function addShape(kind: ShapeKind) {
    const f = newShape(doc, kind);
    onChange({ ...doc, features: [...doc.features, f] });
    setSelected([f.id]);
    setLastShape(kind);
    setMenu(null);
    say(null);
  }

  function blend() {
    if (chosen.length !== 2) {
      say('Blend joins exactly two sketches. Click one, then hold Shift (or Ctrl, or Cmd) and click the other.');
      return;
    }
    const [a, b] = chosen;
    // Every refusal names what to do about it. A blend that quietly did
    // nothing, or picked one of two disagreeing planes, is worse than one
    // that says why it will not -- the two sketches look identical on the
    // canvas whether or not they can be blended.
    const why = whyCannotBlend(a, b);
    if (why) { say(why); return; }
    const f = newBlend(doc, a as Extract<Feature, { kind: 'sketch' }>, b as Extract<Feature, { kind: 'sketch' }>);
    onChange({ ...doc, features: [...doc.features, f] });
    setSelected([f.id]);
    say('The two outlines are skinned together. Slide either sketch along its plane to change the taper.');
  }

  function combine(op: BoolOp) {
    if (chosen.length < 2) {
      say('Pick two shapes first — click one, then hold Shift (or Ctrl, or Cmd) and click another.');
      return;
    }
    // Selection order, not list order: subtract(a, b) is not subtract(b, a),
    // and the first one clicked is the body being cut.
    const targets = selected.filter((id) => doc.features.some((f) => f.id === id));
    const f: Feature = { id: nextId(doc, 'op'), kind: 'combine', op, targets };
    onChange({ ...doc, features: [...doc.features, f] });
    setSelected([f.id]);
    setMenu(null);
    say(null);
  }

  function round(style: RoundStyle) {
    // Item E: two or more Shift-selected edges on the SAME solid as `chosen`
    // round/bevel together from one click. ownerOf() re-checks each one the
    // same staleness-guard reason the single-edge branch below re-checks
    // pickedEdge -- a picked edge whose solid the student has since
    // deselected does not belong in this batch.
    //
    // This lands as one FilletFeature PER edge, not one feature naming
    // several edges: lib/occt-build.ts's fillet builder (this pass's item F
    // is the only change owned there) resolves a Fillet against exactly one
    // named edge, and giving it a list is a kernel-side change out of
    // scope here. Functionally this is still "Round applies to every
    // selected edge in one step" -- one click, every edge rounds -- just as
    // several timeline rows instead of one; flagged rather than silently
    // presented as a single feature.
    const multi = (pickedEdges ?? []).filter(
      (e) => chosen.length === 1 && chosen[0].id === ownerOf(doc, e)
    );
    if (multi.length > 1) {
      let building = doc;
      const made: FilletFeature[] = [];
      for (const e of multi) {
        const root = building.features.find((x) => x.id === e.edge.feature);
        const size = root && isRoundable(root) ? Math.min(maxRound(root), 4) : 4;
        const f: FilletFeature = {
          id: nextId(building, style === 'chamfer' ? 'bevel' : 'round'),
          kind: 'fillet',
          target: e.target,
          edge: e.edge,
          size,
          style,
        };
        made.push(f);
        building = { ...building, features: [...building.features, f] };
      }
      onChange(building);
      setSelected(made.map((f) => f.id));
      onClearPickedEdges?.();
      onClearPickedEdge?.();
      setLastRound(style);
      setMenu(null);
      say(null);
      return;
    }
    // A picked EDGE (a click in the 3D viewport) takes priority over the
    // whole-shape round below -- see FilletFeature's own doc comment for why
    // this is a different feature kind, not a narrower case of the same
    // round() call. Guarded against staleness by re-checking `chosen`
    // rather than trusting the prop on its own: picking an edge always
    // selects its owning shape too (see the sandbox's onPick wiring), so if
    // the student has since chosen something else from the feature list,
    // chosen[0] no longer matches the edge's owner and this falls straight
    // through to the whole-shape path below -- the same one that always ran
    // before edge-picking existed.
    //
    // ownerOf(doc, pickedEdge), NOT pickedEdge.target directly -- REGRESSION,
    // measured 2026-09-04: once a Hole sat on top of the box the edge came
    // from, `pickedEdge.target` is the TIP of the chain ("Hole 1", the
    // feature whose mesh batch currently draws that edge -- see
    // lib/model-selection.ts's PickName comment), but `selected` (and so
    // `chosen[0].id`) is the RESOLVED owner the sandbox's onPick handler now
    // sets via the SAME ownerOf() -- "Box 1" for an edge that traces back to
    // a primitive face. Comparing chosen[0].id straight against the raw
    // target compared "Box 1" to "Hole 1", always failed, and silently fell
    // through to the whole-shape round -- exactly the bug report's "Rounded
    // every edge" / "Box 1 corner" result for a click that named one edge.
    if (pickedEdge?.edge && chosen.length === 1 && chosen[0].id === ownerOf(doc, pickedEdge)) {
      // The picked SHAPE need not itself be isRoundable() -- that check is
      // only meaningful for the whole-shape path below, which writes
      // round/roundStyle fields a box or cylinder carries directly. A
      // Fillet targets one NAMED EDGE, and that edge's own name (resolved
      // by nameEdgeOnCurrentShape() in the viewport) can be rooted at a
      // primitive sitting underneath a Move, a Hole, or anything else --
      // see FilletFeature's doc comment. The size default still wants a
      // real dimension to shrink from where one is reachable: walk back to
      // whichever primitive the edge's name is actually rooted at
      // (pickedEdge.edge.feature) and use maxRound() on THAT, falling back
      // to a flat default when the root is not a plain box/cylinder --
      // e.g. two different primitives met at this edge in a Combine, which
      // nameEdgeOnCurrentShape() only ever names when it traces to ONE.
      const edge = pickedEdge.edge;
      const root = doc.features.find((x) => x.id === edge.feature);
      const size = root && isRoundable(root) ? Math.min(maxRound(root), 4) : 4;
      const f: FilletFeature = {
        id: nextId(doc, style === 'chamfer' ? 'bevel' : 'round'),
        kind: 'fillet',
        target: pickedEdge.target,
        edge,
        size,
        style,
      };
      onChange({ ...doc, features: [...doc.features, f] });
      setSelected([f.id]);
      onClearPickedEdge?.();
      setLastRound(style);
      setMenu(null);
      say(null);
      return;
    }
    if (chosen.length !== 1) {
      say('Pick one shape to round.');
      return;
    }
    const f = chosen[0];
    const why = whyCannotRound(f);
    if (why) {
      say(why);
      return;
    }
    if (!isRoundable(f)) return;
    const size = Math.min(maxRound(f), 4);
    onChange({
      ...doc,
      features: doc.features.map((x) =>
        x.id === f.id ? { ...x, round: size, roundStyle: style } : x
      ),
    });
    setLastRound(style);
    setMenu(null);
    // The whole-shape path just ran, which means single-edge rounding was
    // NOT used -- the one moment a student is guaranteed to be looking at
    // this panel and thinking about rounding at all, so it is also the best
    // moment to teach the narrower tool exists, for next time.
    say(style === 'fillet'
      ? 'Rounded every edge. To round one edge, click it first, then Round.'
      : 'Beveled every edge. To bevel one edge, click it first, then Round.');
  }

  // Rotation is opt-in per shape, the same way rounding is: three angle rows
  // and three ring handles on every shape from the start would be clutter for
  // the many models that never turn anything.
  function turn() {
    if (chosen.length !== 1) {
      say('Pick one shape to turn.');
      return;
    }
    const f = chosen[0];
    if (!canRotate(f)) {
      say('A sphere looks the same whichever way you turn it.');
      return;
    }
    onChange({
      ...doc,
      features: doc.features.map((x) =>
        x.id === f.id && canRotate(x)
          ? { ...x, rotate: x.rotate ?? [0, 0, 0] }
          : x
      ),
    });
    say(null);
  }

  function startSketch() {
    const f = newSketch(doc, activePlane);
    onChange({ ...doc, features: [...doc.features, f] });
    setSelected([f.id]);
    say(null);
    onOpenSketch2D?.(f.id);
  }

  function pull() {
    const f = chosen[0];
    if (chosen.length !== 1 || !f || f.kind !== 'sketch') {
      say('Pick a sketch to pull into a solid.');
      return;
    }
    const claim = sketchClaimedBy(doc, f.id);
    if (claim) {
      say(claim === 'extrude'
        ? 'That sketch has already been pulled. Change its height instead.'
        : 'That sketch has already been spun into a solid. Pull needs a fresh sketch.');
      return;
    }
    const e = newExtrude(doc, f.id);
    onChange({ ...doc, features: [...doc.features, e] });
    setSelected([e.id]);
    say(null);
  }

  function spin() {
    const f = chosen[0];
    if (chosen.length !== 1 || !f || f.kind !== 'sketch') {
      say('Pick a sketch to spin into a solid.');
      return;
    }
    const claim = sketchClaimedBy(doc, f.id);
    if (claim) {
      say(claim === 'revolve'
        ? 'That sketch has already been spun. Change its angle instead.'
        : 'That sketch has already been pulled into a solid. Spin needs a fresh sketch.');
      return;
    }
    const r = newRevolve(doc, f.id);
    onChange({ ...doc, features: [...doc.features, r] });
    setSelected([r.id]);
    say(null);
  }

  function mirror(plane: SketchPlane) {
    const why = whyCannotSolidOp(chosen, 'mirror');
    if (why) { say(why); return; }
    const f = newMirror(doc, chosen[0].id, plane);
    onChange({ ...doc, features: [...doc.features, f] });
    setSelected([f.id]);
    setLastMirrorPlane(plane);
    setMenu(null);
    say(null);
  }

  function repeat(mode: PatternMode) {
    const why = whyCannotSolidOp(chosen, 'repeat');
    if (why) { say(why); return; }
    const f = newPattern(doc, chosen[0].id, mode);
    // A circular pattern of a shape sitting on the axis stacks every copy on
    // the original -- six rows in the list, one shape on screen.
    if (f.mode === 'circular') {
      const nowhere = whyCannotOrbit(chosen[0], f.axis ?? 'z');
      if (nowhere) { say(nowhere); return; }
    }
    onChange({ ...doc, features: [...doc.features, f] });
    setSelected([f.id]);
    setLastPattern(mode);
    setMenu(null);
    say(null);
  }

  function drillHole() {
    const why = whyCannotSolidOp(chosen, 'drill');
    if (why) { say(why); return; }
    const f = newHole(doc, chosen[0].id);
    onChange({ ...doc, features: [...doc.features, f] });
    setSelected([f.id]);
    setMenu(null);
    say(null);
  }

  // One feature row, four bores, guaranteed symmetric: the two spacings show
  // up in the Dimensions panel as "corner spacing across/up" for a student to
  // set exactly, instead of dragging four separate holes into approximately
  // the right corners.
  function drillHoleCorners() {
    const why = whyCannotSolidOp(chosen, 'drill');
    if (why) { say(why); return; }
    const f = newHoleCorners(doc, chosen[0].id);
    onChange({ ...doc, features: [...doc.features, f] });
    setSelected([f.id]);
    setMenu(null);
    say(null);
  }

  /** English-joins a list of names for the note text below --
   *  "Hole 1", "Hole 1 and Round 1", "Hole 1, Round 1, and Draft 1". */
  function joinNames(names: string[]): string {
    if (names.length <= 1) return names[0] ?? '';
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
  }

  /** Builds a new Shell feature and splices it into the document at the
   *  position shellInsertion() says it belongs -- see that function's own
   *  comment for why "where the student clicked" and "where the feature
   *  actually has to go" are not always the same array index. Shared by
   *  hollow() and openHollow() so the reordering logic exists in exactly one
   *  place. Returns the built doc, the new feature (for selecting it), and
   *  the note to show, combining both facts worth telling a student about --
   *  that it opened at a face, that it moved earlier in the timeline, both,
   *  or neither (null). */
  function insertShell(open?: TopoName): { next: ModelDoc; feature: Feature; note: string | null } {
    const { target, insertAt, rewireId } = shellInsertion(doc, chosen[0].id);
    const f = newShell(doc, target, open);
    const features = [...doc.features];
    features.splice(insertAt, 0, f);
    const next: ModelDoc = rewireId
      ? {
        ...doc,
        features: features.map((x) => (x.id === rewireId && 'target' in x ? { ...x, target: f.id } : x)),
      }
      : { ...doc, features };
    // Named off `next` (after insertion), not `doc` -- nameMap() numbers per
    // kind by creationOrder(id), not array position, so this is safe either
    // way, but the new Hollow's own name only exists in `next`.
    const names = nameMap(next);
    // partWordFor(), not a local copy -- lib/topo-name.ts's own comment on
    // why this is the ONE place that decision is made, shared with
    // SandboxWorkspace.tsx's selection badge, so "Box 1 · top face" and
    // "Hollow 1 is open at the top face" can never name the same face two
    // different ways.
    const openPart = open ? partWordFor(open) : null;
    const sentences: string[] = [];
    if (openPart) sentences.push(`${names[f.id]} is open at the ${openPart}`);
    if (rewireId) {
      const movedPast = features.slice(insertAt + 1).map((x) => names[x.id] ?? x.id);
      sentences.push(
        openPart
          ? `placed before ${joinNames(movedPast)} so it could build`
          : `${names[f.id]} was placed before ${joinNames(movedPast)} so it could build`
      );
    }
    return { next, feature: f, note: sentences.length ? `${sentences.join(', ')}.` : null };
  }

  /** Opens at the picked face by default -- matching what "Open hollow"
   *  below has always done explicitly. Measured 2026-09-04, blind judge
   *  round 3: a closed shell under a picked top face is a correct but
   *  invisible-from-outside hollow ("zero visible change"); Chili3D opens
   *  the picked face and "reads instantly as hollow". `pickedFaceUsable`
   *  is the SAME staleness guard the Open Hollow flyout already uses --
   *  see that variable's own comment -- so a stale pick left over from
   *  before the student chose a different shape does not silently open
   *  the wrong one. */
  function hollow() {
    const why = whyCannotSolidOp(chosen, 'hollow out');
    if (why) { say(why); return; }
    const openFace = pickedFaceUsable ? pickedFace?.face ?? undefined : undefined;
    const { next, feature, note } = insertShell(openFace);
    onChange(next);
    setSelected([feature.id]);
    if (openFace) onClearPickedFace?.();
    say(note);
  }

  /** The explicit Open Hollow flyout -- newShell with the picked face
   *  carried as ShellFeature.open, so the kernel leaves that one face
   *  uncapped instead of building the fully closed default. hollow() above
   *  now does the exact same thing whenever a face happens to be picked
   *  (see its own comment); this stays reachable on its own for a student
   *  who wants to name a face explicitly through the flyout rather than by
   *  having clicked one already, and its own refusal sentence below still
   *  applies when nothing is picked at all -- the plain Hollow button
   *  builds closed in that case rather than refusing. */
  function openHollow() {
    const why = whyCannotSolidOp(chosen, 'hollow out');
    if (why) { say(why); return; }
    if (!pickedFaceUsable || !pickedFace?.face) {
      say('Click the face to leave open, then Open hollow.');
      return;
    }
    const { next, feature, note } = insertShell(pickedFace.face);
    onChange(next);
    setSelected([feature.id]);
    onClearPickedFace?.();
    setMenu(null);
    say(note ?? 'Hollowed, open at the face you clicked.');
  }

  function moveTool(copy: boolean) {
    const why = whyCannotSolidOp(chosen, 'move');
    if (why) { say(why); return; }
    const f = newMove(doc, chosen[0].id, copy);
    onChange({ ...doc, features: [...doc.features, f] });
    setSelected([f.id]);
    setLastMoveCopy(copy);
    setMenu(null);
    say(null);
  }

  function remove() {
    if (!chosen.length) return;
    // Everything built from what is going has to go too, however far down the
    // chain. Filtering only combines -- which is what this did -- left a Pull
    // pointing at a deleted sketch, and the generated source then referred to a
    // variable it never declared: the preview died with "ReferenceError: sk1 is
    // not defined" for the ordinary act of deleting a sketch. dependsOn() knew
    // about every one of those kinds the whole time; the reorder path beneath
    // this one was already using it.
    // `chosen`, not `selected`: the selection can outlive a feature (a rollback,
    // an undo), and a stale id would put a raw `pull1` into the sentence.
    const asked = chosen.map((f) => f.id);
    // Dependents named up front now (item B / D4), not after the fact: Clear
    // model already stops a student before it wipes the document, and a
    // Delete that can silently take dependent steps down with it deserves
    // the same stop sign. A delete with nothing riding on it (orphaned ==
    // asked, nothing else) still goes through on the one click -- only a
    // delete that costs MORE than what was clicked gets a confirm.
    const doomed = [...orphanedBy(doc, asked)];
    const extra = doc.features.filter((f) => doomed.includes(f.id) && !asked.includes(f.id));
    if (extra.length > 0) {
      const extraNames = extra.map((f) => names[f.id] ?? f.id);
      const list = extraNames.length === 1
        ? extraNames[0]
        : extraNames.slice(0, -1).join(', ') + ' and ' + extraNames[extraNames.length - 1];
      const subject = asked.length === 1 ? (names[asked[0]] ?? asked[0]) : 'these';
      const verb = extraNames.length === 1 ? 'goes' : 'go';
      // In timeline order, everything that is actually about to go --
      // `doomed` already contains `asked` itself (orphanedBy seeds with it),
      // so filtering doc.features by membership gives asked+extras together
      // in the order the panel shows them, for the after-state note below.
      const removedNames = doc.features.filter((f) => doomed.includes(f.id)).map((f) => names[f.id] ?? f.id);
      setConfirmDelete({ ids: asked, message: `Delete ${subject}? ${list} ${verb} with it.`, removedNames });
      return;
    }
    onChange(withoutFeatures(doc, asked));
    setSelected([]);
    say(null);
  }

  function confirmRemove() {
    if (!confirmDelete) return;
    const next = withoutFeatures(doc, confirmDelete.ids);
    // See suppressEmptyNoteClear's own comment: without this, the very
    // features.length transition this delete causes wipes the note two
    // lines below before it is ever seen.
    if (next.features.length === 0) suppressEmptyNoteClear.current = true;
    onChange(next);
    setSelected([]);
    // The after-state, not just the before-state warning: a cascading
    // delete can leave the canvas completely empty (D4's own repro did),
    // and an empty canvas with no explanation reads as broken, not as "it
    // did what the confirm said it would". Names every removed feature,
    // asked-for and dependent alike, same join convention the confirm
    // message itself uses.
    const removed = confirmDelete.removedNames;
    const list = removed.length === 1
      ? removed[0]
      : removed.slice(0, -1).join(', ') + ' and ' + removed[removed.length - 1];
    const verb = removed.length === 1 ? 'was' : 'were';
    setConfirmDelete(null);
    say(`${list} ${verb} removed. Undo puts ${removed.length === 1 ? 'it' : 'them'} back.`);
  }

  function cancelRemove() {
    setConfirmDelete(null);
  }

  function move(id: string, by: -1 | 1) {
    const i = doc.features.findIndex((f) => f.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= doc.features.length) return;
    const features = [...doc.features];
    [features[i], features[j]] = [features[j], features[i]];
    // A feature cannot be built before what it is made of. dependsOn() covers
    // every kind that names a target -- combine, hole, extrude, revolve,
    // mirror, pattern, shell, move -- not just combine, so dragging a Hole
    // above the box it drills is caught the same as dragging a Cut above
    // its inputs.
    const seen = new Set<string>();
    for (const f of features) {
      const missing = dependsOn(f).filter((t) => !seen.has(t));
      if (missing.length) {
        const what = missing.map((t) => names[t] ?? t).join(', ');
        say(`That would put ${names[f.id]} before ${what}, which it is built from.`);
        return;
      }
      seen.add(f.id);
    }
    onChange({ ...doc, features });
    say(null);
  }

  function pick(id: string, additive: boolean) {
    setSelected(
      additive
        ? selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
        : [id]
    );
    say(null);
  }

  // The feature list lives in the bottom timeline (Fusion 360 style). The card
  // itself always holds the Parts/Planes browser
  // tree (see `model-browser` in the JSX below) whenever it isn't collapsed
  // to the rail -- unlike the note/rules it used to gate on, the tree is
  // never empty (Planes always lists xy/xz/yz), so there is no "empty card
  // over the canvas" case left to collapse away from.
  const cardHasContent = true;
  useEffect(() => {
    onContentChange?.(cardHasContent);
  }, [cardHasContent, onContentChange]);

  const canCombine = chosen.length >= 2;
  // Same unconditional-reason rule as whyCannotSolidOp: a gated button never
  // goes silent, even at the most common early state (nothing picked yet).
  //
  // A usable picked edge overrides whyCannotRound() entirely -- round()
  // above tries that path FIRST and it does not care whether the picked
  // SHAPE is itself roundable, only whether the picked EDGE resolved to a
  // name. Without this the button stayed disabled the instant anything
  // (a Move, a Hole, ...) sat on top of the primitive the edge came from,
  // even though clicking Round would have worked.
  // ownerOf(doc, pickedEdge/pickedFace), not the raw .target -- see round()'s
  // own comment on the regression this exact pattern caused: the raw target
  // is the TIP of the feature chain, `chosen[0].id` is the RESOLVED owner,
  // and the two stop matching the moment anything (a Hole, a Move) sits on
  // top of the primitive the pick came from.
  const pickedEdgeUsable =
    !!pickedEdge?.edge && chosen.length === 1 && chosen[0].id === ownerOf(doc, pickedEdge);
  // A click near the rim of an open hollow lands on the hollow's INNER
  // corner edge, which has no name to round; the generic hollow sentence
  // then reads as nonsense to a student who has just picked an edge (both
  // student lenses hit this on the 8.1.11 tray, 2026-09-04). Say what they
  // caught and where the outer edge is.
  const roundBlockedBy = pickedEdgeUsable
    ? null
    : chosen.length !== 1
      ? 'Pick one shape to round.'
      : pickedEdge && !pickedEdge.edge && chosen[0].kind === 'shell'
        ? "That is the hollow's inner edge. Click the outer corner lower down, where the label names the shape itself, and round that."
        : whyCannotRound(chosen[0]);
  const canRound = roundBlockedBy === null;
  const turnBlockedBy =
    chosen.length !== 1
      ? 'Pick one shape to turn.'
      : chosen[0].kind === 'sphere'
        ? 'A sphere looks the same whichever way you turn it.'
        : null;
  const solidOpBlockedBy = whyCannotSolidOp(chosen, 'use');
  const canSolidOp = solidOpBlockedBy === null;
  // Same staleness guard pickedEdgeUsable uses above: picking a face also
  // selects its owning shape, so if the student has since chosen something
  // else, chosen[0] no longer matches the face's resolved owner and Open
  // Hollow goes back to disabled rather than silently hollowing the wrong
  // shape open.
  const pickedFaceUsable =
    !!pickedFace?.face && chosen.length === 1 && chosen[0].id === ownerOf(doc, pickedFace);
  const openHollowBlockedBy = !canSolidOp
    ? solidOpBlockedBy
    : pickedFaceUsable ? null : 'Click the face to leave open, then Open hollow.';

  // Group visibility for the search filter: a group's divider and wrapper
  // only render when at least one of its tools' names still matches.
  const sketchVisible = matches('Sketch');
  const createVisible = [...SHAPE_KINDS.map(shapeLabel), 'Pull', 'Spin'].some(matches);
  // 'Bevel' is the button's own current name; 'Fillet'/'Chamfer' are its
  // real CAD terms; 'Angled Corner' is the retired name kept searchable
  // (see FlyoutVariant.alias) -- this group-level gate is separate from
  // that per-tool matching and needs its own copy of the same list, or a
  // search for a name not on it hides the whole group before FlyoutButton
  // ever gets a chance to reveal itself.
  const modifyVisible = ['Round', 'Fillet', 'Chamfer', 'Bevel', 'Angled Corner', 'Turn', 'Hole', 'Four Corners', 'Hollow'].some(matches);
  // Split so a divider can mark the selection-rule boundary Onshape draws
  // too: Repeat/Mirror/Move work on ONE shape, Join/Cut/Overlap need TWO+.
  const patternSelectVisible = [
    'Repeat', 'Repeat Around', 'Mirror', 'Left-Right', 'Front-Back', 'Top-Bottom', 'Move', 'Copy',
  ].some(matches);
  const patternBoolVisible = ['Join', 'Cut', 'Overlap'].some(matches);
  const patternVisible = patternSelectVisible || patternBoolVisible;

  // Piece B: hand the caller this render's own verb closures -- the same
  // ones the ribbon buttons above call, wrapped as thin arrows. Re-registers
  // every render rather than off a dependency list, the same
  // registerContextActions pattern: every verb below closes over
  // `doc`/`chosen`/`pickedEdge` state that changes on renders this component
  // has no reason to otherwise re-run an effect for, and the receiver
  // (ReshapeStudio) only ever stores the object in state it re-reads at
  // render -- one redundant register costs nothing a student could notice.
  // useCallback would be the WRONG tool here: a memoized object would pin
  // stale doc closures until its deps changed, which is the exact drift this
  // hand-off exists to prevent.
  useEffect(() => {
    registerContextActions?.({
      remove: () => remove(),
      moveTool: (copy: boolean) => moveTool(copy),
      round: (style: RoundStyle) => round(style),
      drillHole: () => drillHole(),
      hollow: () => hollow(),
      pull: () => pull(),
      spin: () => spin(),
      turn: () => turn(),
      repeat: (mode: PatternMode) => repeat(mode),
      mirror: (plane: SketchPlane) => mirror(plane),
    });
    return () => registerContextActions?.(null);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="model-editor">
      {collapsible && collapsed && (
        <div className="model-collapsed" role="group" aria-label="Shape tools">
          <button
            onClick={() => collapse(false)}
            title="Show the shape tools"
            aria-label="Show the shape tools"
          >
            <PenLine size={14} />
          </button>
          <button onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
            <Undo2 size={14} />
          </button>
          <button onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
            <Redo2 size={14} />
          </button>
        </div>
      )}
      {/* The left panel's own content, Fusion-360-Browser-style (ui-ref/*.png):
          Parts (topLevel(doc) -- the bodies the model actually shows, same set
          the timeline's own "consumed" dimming already keys off) and Planes
          (the 3 fixed origin planes -- there is no separate plane ENTITY
          anywhere in the model, see SketchPlane's own doc comment, so these
          are synthesized here rather than read off `doc`). Clicking a Parts
          row selects it, same as clicking its timeline row (reuses `pick()`).
          Clicking a Planes row sets `activePlane`, which is what
          startSketch() below builds the next new sketch on -- previously
          hardcoded to 'xy' with no way to reach xz/yz from the UI at all,
          even though the model layer already accepted any plane. */}
      {!(collapsible && collapsed) && (
        <div className="model-browser">
          <div className="model-browser-section">
            <div className="model-browser-heading">Parts</div>
            {parts.length === 0 ? (
              <p className="model-browser-empty">Nothing built yet.</p>
            ) : parts.map((f) => (
              <button
                key={f.id}
                type="button"
                className={'model-browser-row' + (selected.includes(f.id) ? ' is-on' : '')}
                onClick={(e) => pick(f.id, e.ctrlKey || e.metaKey || e.shiftKey)}
              >
                {names[f.id]}
              </button>
            ))}
          </div>
          <div className="model-browser-section">
            <div className="model-browser-heading">Planes</div>
            {(['xy', 'xz', 'yz'] as const).map((pl) => (
              <button
                key={pl}
                type="button"
                className={'model-browser-row' + (activePlane === pl ? ' is-on' : '')}
                onClick={() => onActivePlaneChange(pl)}
                title={`Use the ${pl.toUpperCase()} plane for the next new sketch`}
              >
                {pl.toUpperCase()} Plane
              </button>
            ))}
          </div>
        </div>
      )}
      {ribbonHost ? createPortal(
        <div className="model-tools" ref={toolsRef}>
        {/* File and Edit sit at the top-left, ahead of the Sketch/Create/...
            command groups -- ui-ref/*.png's own layout, where document-level
            actions (open/save, undo/redo) anchor the left of the ribbon
            rather than trailing after every tool group. */}
        <div className="model-tool-group">
          <div className="model-tool-icons">
            {collapsible && (
              <button
                onClick={() => collapse(true)}
                title="Collapse the tools to a rail, so the shape fills the window"
                aria-label="Collapse the tools"
              >
                <PanelLeftClose size={14} />
              </button>
            )}
            <FlyoutButton
              label="Export"
              icon={<Download size={14} />}
              onMain={onExportSTL}
              disabled={!hasMesh}
              title={hasMesh ? 'Download the current model as an STL file' : 'Build a shape first'}
              open={menu === 'export'}
              onToggleOpen={() => toggleMenu('export')}
              matches={matches}
              searchActive={searchActive}
              variants={[
                { id: 'export-obj', label: 'Export OBJ', onClick: onExportOBJ, disabled: !hasMesh, title: hasMesh ? 'Download as an OBJ file' : 'Build a shape first' },
                { id: 'export-3mf', label: 'Export 3MF', onClick: onExport3MF, disabled: !hasMesh, title: hasMesh ? 'Download as a 3MF file' : 'Build a shape first' },
              ]}
            />
          </div>
          <span className="model-tool-group-label">File</span>
        </div>
        <div className="model-tool-divider" />

        <div className="model-tool-group">
          <div className="model-tool-icons">
            <button onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
              <Undo2 size={14} />
            </button>
            <button onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
              <Redo2 size={14} />
            </button>
            <button onClick={remove} disabled={!chosen.length} title="Delete the selected" aria-label="Delete">
              <Trash2 size={14} />
            </button>
            <button onClick={onClearModel} disabled={!canClearModel} title="Clear the model and start again" aria-label="Clear model">
              <Eraser size={14} />
            </button>
          </div>
          <span className="model-tool-group-label">Edit</span>
        </div>
        <div className="model-tool-divider" />

        {sketchMode && (
          <>
            <div className="model-tool-group">
              <div className="model-tool-icons">
                <button onClick={onExitSketch2D} title="Leave the 2D sketcher and return to the 3D tools">
                  <ArrowLeft size={14} /> Done
                </button>
              </div>
              <span className="model-tool-group-label">Sketch</span>
            </div>
            <div className="model-tool-divider" />
          </>
        )}

        {sketchVisible && !sketchMode && (
          <>
            <div className="model-tool-group">
              <div className="model-tool-icons">
                <button onClick={startSketch} title="Draw a flat sketch to pull or spin into a solid">
                  <PenLine size={14} /> Sketch
                </button>
              </div>
              <span className="model-tool-group-label">Sketch</span>
            </div>
            <div className="model-tool-divider" />
          </>
        )}

        {createVisible && !sketchMode && (
          <>
            <div className="model-tool-group">
              <div className="model-tool-icons">
                <FlyoutButton
                  label={shapeLabel(lastShape)}
                  icon={shapeIcon(lastShape)}
                  onMain={() => addShape(lastShape)}
                  disabled={false}
                  title={`Add a ${shapeLabel(lastShape).toLowerCase()}`}
                  open={menu === 'shape'}
                  onToggleOpen={() => toggleMenu('shape')}
                  matches={matches}
                  searchActive={searchActive}
                  variants={SHAPE_KINDS.map((k) => ({
                    id: k,
                    label: shapeLabel(k),
                    icon: shapeIcon(k),
                    onClick: () => addShape(k),
                  }))}
                />
                {matches('Pull') && (
                  <button
                    onClick={pull}
                    disabled={chosen.length !== 1 || chosen[0]?.kind !== 'sketch'}
                    title="Pull the selected sketch straight up into a solid"
                  >
                    <MoveUp size={14} /> Pull
                  </button>
                )}
                {matches('Spin') && (
                  <button
                    onClick={spin}
                    disabled={chosen.length !== 1 || chosen[0]?.kind !== 'sketch'}
                    title="Spin the selected sketch around to make a solid"
                  >
                    <Disc3 size={14} /> Spin
                  </button>
                )}
                {matches('Blend') && (
                  <button
                    onClick={blend}
                    disabled={chosen.length !== 2 || chosen.some((c) => c.kind !== 'sketch')}
                    title="Skin two sketches together into one tapered solid"
                  >
                    <Layers size={14} /> Blend
                  </button>
                )}
              </div>
              <span className="model-tool-group-label">Create</span>
            </div>
            <div className="model-tool-divider" />
          </>
        )}

        {modifyVisible && !sketchMode && (
          <>
            <div className="model-tool-group">
              <div className="model-tool-icons">
                <FlyoutButton
                  label={roundLabel(lastRound)}
                  icon={roundIcon(lastRound)}
                  onMain={() => round(lastRound)}
                  disabled={!canRound}
                  title={roundBlockedBy ?? roundDescription(lastRound, pickedEdgeUsable)}
                  open={menu === 'round'}
                  onToggleOpen={() => toggleMenu('round')}
                  matches={matches}
                  searchActive={searchActive}
                  alias={lastRound === 'chamfer' ? 'Angled Corner' : undefined}
                  variants={ROUND_STYLES.map((s) => ({
                    id: s,
                    label: roundLabel(s),
                    icon: roundIcon(s),
                    onClick: () => round(s),
                    title: s === 'fillet' ? 'Round the edges off (fillet)' : 'Slice the edge off at an angle (a bevel)',
                    alias: s === 'chamfer' ? 'Angled Corner' : undefined,
                  }))}
                />
                {matches('Turn') && (
                  <button
                    onClick={turn}
                    disabled={chosen.length !== 1 || !canRotate(chosen[0])}
                    title={turnBlockedBy ?? 'Turn this shape'}
                  >
                    <RotateCw size={14} /> Turn
                  </button>
                )}
                <FlyoutButton
                  label="Hole"
                  icon={<CircleDot size={14} />}
                  onMain={drillHole}
                  disabled={!canSolidOp}
                  title={solidOpBlockedBy ?? 'Drill a round hole through the selected solid'}
                  open={menu === 'hole'}
                  onToggleOpen={() => toggleMenu('hole')}
                  matches={matches}
                  searchActive={searchActive}
                  variants={[
                    {
                      id: 'four-corners', label: 'Four Corners', icon: <Grid2x2 size={14} />,
                      onClick: drillHoleCorners,
                      // Item P: "evenly spaced from the middle" was true of the
                      // stored numbers but not of what the panel showed a
                      // student typing -- the corner spacing fields now say
                      // exactly what they measure (in from each side), so the
                      // tooltip does too.
                      title: 'Drill four holes at once, the same distance in from every side — a bolt pattern with matching offsets on every corner',
                    },
                  ]}
                />
                <FlyoutButton
                  label="Hollow"
                  icon={<PackageOpen size={14} />}
                  onMain={hollow}
                  disabled={!canSolidOp}
                  title={solidOpBlockedBy ?? 'Hollow the selected solid out, leaving a wall'}
                  open={menu === 'hollow'}
                  onToggleOpen={() => toggleMenu('hollow')}
                  matches={matches}
                  searchActive={searchActive}
                  variants={[
                    {
                      id: 'open-face', label: 'Open hollow',
                      icon: <PackageOpen size={14} />,
                      onClick: openHollow,
                      disabled: openHollowBlockedBy !== null,
                      title: openHollowBlockedBy ?? 'Hollow out, leaving the face you clicked open',
                    },
                  ]}
                />
              </div>
              <span className="model-tool-group-label">Modify</span>
            </div>
            <div className="model-tool-divider" />
          </>
        )}

        {patternVisible && !sketchMode && (
          <>
            {patternSelectVisible && (
              <div className="model-tool-group">
                <div className="model-tool-icons">
                  <FlyoutButton
                    label={patternLabel(lastPattern)}
                    icon={patternIcon(lastPattern)}
                    onMain={() => repeat(lastPattern)}
                    disabled={!canSolidOp}
                    title={solidOpBlockedBy ?? 'Make copies of the selected solid'}
                    open={menu === 'pattern'}
                    onToggleOpen={() => toggleMenu('pattern')}
                    matches={matches}
                    searchActive={searchActive}
                    variants={PATTERN_MODES.map((m) => ({
                      id: m,
                      label: patternLabel(m),
                      icon: patternIcon(m),
                      onClick: () => repeat(m),
                      title: m === 'linear' ? 'Copies in a straight row' : 'Copies around a circle',
                    }))}
                  />
                  <FlyoutButton
                    label="Mirror"
                    icon={lastMirrorPlane ? mirrorPlaneIcon(lastMirrorPlane) : <FlipHorizontal2 size={14} />}
                    // No remembered plane yet -- the main click opens the picker
                    // instead of guessing, the same way the caret would. Once a
                    // student has chosen once, repeating THEIR choice on click is
                    // a shortcut, not a silent default.
                    onMain={() => (lastMirrorPlane ? mirror(lastMirrorPlane) : toggleMenu('mirror'))}
                    disabled={!canSolidOp}
                    title={
                      solidOpBlockedBy
                        ?? (lastMirrorPlane
                          ? mirrorPlaneTitle(lastMirrorPlane)
                          : 'Pick which way to flip the copy')
                    }
                    open={menu === 'mirror'}
                    onToggleOpen={() => toggleMenu('mirror')}
                    matches={matches}
                    searchActive={searchActive}
                    variants={MIRROR_PLANES.map((pl) => ({
                      id: pl,
                      label: mirrorPlaneLabel(pl),
                      icon: mirrorPlaneIcon(pl),
                      onClick: () => mirror(pl),
                      title: mirrorPlaneTitle(pl),
                    }))}
                  />
                  <FlyoutButton
                    label={moveLabel(lastMoveCopy)}
                    icon={moveIcon(lastMoveCopy)}
                    onMain={() => moveTool(lastMoveCopy)}
                    disabled={!canSolidOp}
                    title={solidOpBlockedBy ?? (lastMoveCopy ? 'Add a copy, shifted over' : 'Shift the selected solid')}
                    open={menu === 'move'}
                    onToggleOpen={() => toggleMenu('move')}
                    matches={matches}
                    searchActive={searchActive}
                    variants={[
                      { id: 'move', label: 'Move', icon: <MoveIcon size={14} />, onClick: () => moveTool(false), title: 'Shift the selected solid' },
                      { id: 'copy', label: 'Copy', icon: <CopyIcon size={14} />, onClick: () => moveTool(true), title: 'Add a copy, shifted over' },
                    ]}
                  />
                </div>
                <span className="model-tool-group-label">Arrange</span>
              </div>
            )}
            {/* The selection rule changes here: everything to the left needs
                exactly one shape, everything to the right needs two or more.
                That's the boundary a beginner hits first ("why is Join
                greyed out, I picked a shape") -- give it a visible edge. */}
            {patternSelectVisible && patternBoolVisible && <div className="model-tool-divider" />}
            {patternBoolVisible && (
              <div className="model-tool-group">
                <div className="model-tool-icons">
                  {/* Unlike every other flyout family on this bar, the Combine
                      group's main button does NOT show "the last variant used"
                      (see the file-top comment). A student who just Cut two
                      shapes and comes back later expects Join to still be
                      where they left it -- and "More join tools" to still say
                      "join" -- not to have to remember the button now reads
                      "Cut" and search under "More cut tools" to find Join
                      again (P19b/P19c). Join is pinned; Cut and Overlap live
                      only in the flyout. */}
                  <FlyoutButton
                    label={boolLabel('union')}
                    icon={boolIcon('union')}
                    onMain={() => combine('union')}
                    disabled={!canCombine}
                    title={canCombine ? boolLabel('union') : 'Pick two shapes first — click one, then hold Shift (or Ctrl, or Cmd) and click another.'}
                    open={menu === 'bool'}
                    onToggleOpen={() => toggleMenu('bool')}
                    matches={matches}
                    searchActive={searchActive}
                    variants={BOOL_OPS.map((op) => ({
                      id: op,
                      label: boolLabel(op),
                      icon: boolIcon(op),
                      onClick: () => combine(op),
                      title:
                        op === 'union' ? 'Join the selected shapes into one'
                        : op === 'subtract' ? 'Cut the later shapes out of the first'
                        : 'Keep only where they overlap',
                    }))}
                  />
                </div>
                <span className="model-tool-group-label">Combine</span>
              </div>
            )}
          </>
        )}

        {searchOpen || searchActive ? (
          <div className="model-tool-search" title="Search tools (Alt+C)">
            <Search size={13} />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              // Collapsing while it still has text would hide the reason half
              // the bar is missing, so an empty box is the only one that closes.
              onBlur={() => { if (!search.trim()) setSearchOpen(false); }}
              placeholder="Search tools..."
              aria-label="Search tools (Alt+C)"
            />
          </div>
        ) : (
          <button
            className="model-tool-searchbtn"
            onClick={() => setSearchOpen(true)}
            title="Search tools (Alt+C)"
            aria-label="Search tools (Alt+C)"
          >
            <Search size={14} />
          </button>
        )}
      </div>,
        ribbonHost
      ) : null}
      {note && !timelineHost && <p className="model-note">{note}</p>}
      {timelineHost && note ? createPortal(
        <p className="model-note model-note-timeline">{note}</p>,
        timelineHost
      ) : null}
      {/* Item B / D4: a Delete that would also take dependents down with it
          stops here first, named in the course's words, same posture Clear
          model already has for wiping the whole document. Rendered in the
          same spot the note occupies -- the status strip where the timeline
          usually sits -- so it reads as "what Delete is about to do", not a
          separate popup. */}
      {confirmDelete && !timelineHost && (
        <div className="model-confirm-delete">
          <span>{confirmDelete.message}</span>
          <button type="button" onClick={confirmRemove} className="model-confirm-delete-go">Delete</button>
          <button type="button" onClick={cancelRemove} className="model-confirm-delete-keep">Keep</button>
        </div>
      )}
      {timelineHost && confirmDelete ? createPortal(
        <div className="model-confirm-delete model-confirm-delete-timeline">
          <span>{confirmDelete.message}</span>
          <button type="button" onClick={confirmRemove} className="model-confirm-delete-go">Delete</button>
          <button type="button" onClick={cancelRemove} className="model-confirm-delete-keep">Keep</button>
        </div>,
        timelineHost
      ) : null}
      {timelineHost ? createPortal(
        <ol className="model-list model-timeline">
          {doc.features.length === 0 && (
            <li className="model-empty">
              Nothing here yet. Add a box, select it, and press{' '}
              <strong>Hole</strong> to drill through it. Drag the view to
              spin it.
            </li>
          )}
          {doc.features.map((f, i) => {
            const on = selected.includes(f.id);
            const rolledBack = rollbackIndex != null && i >= rollbackIndex;
            const refusedWhy = refusals?.get(f.id);
            return (
              <Fragment key={f.id}>
                <button
                  type="button"
                  className={
                    'model-rollback-handle'
                    + (rollbackIndex === i ? ' is-active' : '')
                  }
                  onClick={() => onRollback?.(rollbackIndex === i ? null : i)}
                  title={
                    rollbackIndex === i
                      ? 'Show the full model'
                      : `Roll back to before "${names[f.id]}"`
                  }
                  aria-label={
                    rollbackIndex === i
                      ? 'Show the full model'
                      : `Roll back to before "${names[f.id]}"`
                  }
                >
                  <span className="model-rollback-line" aria-hidden="true" />
                </button>
                <li
                  className={
                    'model-row' + (on ? ' is-on' : '') + (shownIds.has(f.id) ? '' : ' is-consumed') + (rolledBack ? ' is-rolled-back' : '') + (refusedWhy ? ' is-refused' : '')
                  }
                  onClick={(e) => pick(f.id, e.ctrlKey || e.metaKey || e.shiftKey)}
                  title={refusedWhy}
                  aria-label={refusedWhy ? `${names[f.id]}: ${refusedWhy}` : undefined}
                >
                <span className="model-step">{i + 1}</span>
                <span className="model-name">
                  {names[f.id]}
                  {refusedWhy && (
                    <>
                      <span className="model-refused" aria-hidden="true">⚠</span>
                      <span className="model-refused-why">{refusedWhy}</span>
                    </>
                  )}
                  {f.kind === 'sketch' && (
                    <em className="model-detail">
                      {' '}{f.points.length} corners, {f.plane}
                      {f.constraints?.length ? `, ${f.constraints.length} rules` : ''}
                    </em>
                  )}
                  {f.kind === 'extrude' && (
                    <em className="model-detail"> {names[f.target] ?? f.target}</em>
                  )}
                  {f.kind === 'revolve' && (
                    <em className="model-detail"> {names[f.target] ?? f.target}, {f.angle}°</em>
                  )}
                  {f.kind === 'mirror' && (
                    <em className="model-detail">
                      {' '}{names[f.target] ?? f.target}, {mirrorPlaneLabel(f.plane)}
                    </em>
                  )}
                  {f.kind === 'pattern' && (
                    <em className="model-detail">
                      {' '}{names[f.target] ?? f.target} × {f.count}
                      {f.mode === 'circular' ? ' around' : ''}
                    </em>
                  )}
                  {f.kind === 'hole' && (
                    <em className="model-detail">
                      {' '}{f.corners ? '4 holes ' : ''}⌀{f.diameter}
                      {f.corners ? `, ${cornerInsetText(doc, f.target, f.corners)}` : ''}
                      {' '}in {names[f.target] ?? f.target}
                    </em>
                  )}
                  {f.kind === 'shell' && (
                    <em className="model-detail"> {names[f.target] ?? f.target}, wall {f.thickness}{f.open ? ', open' : ''}</em>
                  )}
                  {f.kind === 'move' && (
                    <em className="model-detail">
                      {' '}{names[f.target] ?? f.target}{f.copy ? ' (copy)' : ''}
                    </em>
                  )}
                  {f.kind === 'combine' && (
                    <em className="model-detail">
                      {' '}
                      {f.targets.map((t) => names[t] ?? t).join(f.op === 'subtract' ? ' − ' : f.op === 'union' ? ' + ' : ' ∩ ')}
                    </em>
                  )}
                  {canRotate(f) && f.rotate && f.rotate.some((v) => v !== 0) ? (
                    <em className="model-detail"> turned</em>
                  ) : null}
                  {'round' in f && f.round ? (
                    <em className="model-detail"> {f.roundStyle === 'chamfer' ? 'chamfered' : 'filleted'}</em>
                  ) : null}
                </span>
                <span className="model-move">
                  <button
                    onClick={(e) => { e.stopPropagation(); move(f.id, -1); }}
                    disabled={i === 0}
                    aria-label={`Move ${names[f.id]} earlier`}
                  >
                    <ChevronLeft size={12} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); move(f.id, 1); }}
                    disabled={i === doc.features.length - 1}
                    aria-label={`Move ${names[f.id]} later`}
                  >
                    <ChevronRight size={12} />
                  </button>
                </span>
              </li>
              </Fragment>
            );
          })}
          <button
            type="button"
            className={
              'model-rollback-handle'
              + (rollbackIndex === doc.features.length ? ' is-active' : '')
            }
            onClick={() => onRollback?.(rollbackIndex === doc.features.length ? null : doc.features.length)}
            title="Show the full model"
            aria-label="Show the full model"
          >
            <span className="model-rollback-line" aria-hidden="true" />
          </button>
        </ol>,
        timelineHost
      ) : (
        <ol className="model-list">
          {doc.features.length === 0 && (
            <li className="model-empty">
              Nothing here yet. Add a box, select it, and press{' '}
              <strong>Hole</strong> to drill through it. Drag the view to
              spin it.
            </li>
          )}
          {doc.features.map((f, i) => {
            const on = selected.includes(f.id);
            const refusedWhy = refusals?.get(f.id);
            return (
              <li
                key={f.id}
                className={
                  'model-row' + (on ? ' is-on' : '') + (shownIds.has(f.id) ? '' : ' is-consumed')
                }
                onClick={(e) => pick(f.id, e.ctrlKey || e.metaKey || e.shiftKey)}
                title={refusedWhy}
                aria-label={refusedWhy ? `${names[f.id]}: ${refusedWhy}` : undefined}
              >
                <span className="model-step">{i + 1}</span>
                <span className="model-name">
                  {names[f.id]}
                  {refusedWhy && (
                    <>
                      <span className="model-refused" aria-hidden="true">⚠</span>
                      <span className="model-refused-why">{refusedWhy}</span>
                    </>
                  )}
                  {f.kind === 'sketch' && (
                    <em className="model-detail">
                      {' '}{f.points.length} corners, {f.plane}
                      {f.constraints?.length ? `, ${f.constraints.length} rules` : ''}
                    </em>
                  )}
                  {f.kind === 'extrude' && (
                    <em className="model-detail"> {names[f.target] ?? f.target}</em>
                  )}
                  {f.kind === 'revolve' && (
                    <em className="model-detail"> {names[f.target] ?? f.target}, {f.angle}°</em>
                  )}
                  {f.kind === 'mirror' && (
                    <em className="model-detail">
                      {' '}{names[f.target] ?? f.target}, {mirrorPlaneLabel(f.plane)}
                    </em>
                  )}
                  {f.kind === 'pattern' && (
                    <em className="model-detail">
                      {' '}{names[f.target] ?? f.target} × {f.count}
                      {f.mode === 'circular' ? ' around' : ''}
                    </em>
                  )}
                  {f.kind === 'hole' && (
                    <em className="model-detail">
                      {' '}{f.corners ? '4 holes ' : ''}⌀{f.diameter}
                      {f.corners ? `, ${cornerInsetText(doc, f.target, f.corners)}` : ''}
                      {' '}in {names[f.target] ?? f.target}
                    </em>
                  )}
                  {f.kind === 'shell' && (
                    <em className="model-detail"> {names[f.target] ?? f.target}, wall {f.thickness}{f.open ? ', open' : ''}</em>
                  )}
                  {f.kind === 'move' && (
                    <em className="model-detail">
                      {' '}{names[f.target] ?? f.target}{f.copy ? ' (copy)' : ''}
                    </em>
                  )}
                  {f.kind === 'combine' && (
                    <em className="model-detail">
                      {' '}
                      {f.targets.map((t) => names[t] ?? t).join(f.op === 'subtract' ? ' − ' : f.op === 'union' ? ' + ' : ' ∩ ')}
                    </em>
                  )}
                  {canRotate(f) && f.rotate && f.rotate.some((v) => v !== 0) ? (
                    <em className="model-detail"> turned</em>
                  ) : null}
                  {'round' in f && f.round ? (
                    <em className="model-detail"> {f.roundStyle === 'chamfer' ? 'chamfered' : 'filleted'}</em>
                  ) : null}
                </span>
                <span className="model-move">
                  <button
                    onClick={(e) => { e.stopPropagation(); move(f.id, -1); }}
                    disabled={i === 0}
                    aria-label={`Move ${names[f.id]} earlier`}
                  >
                    <ChevronUp size={12} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); move(f.id, 1); }}
                    disabled={i === doc.features.length - 1}
                    aria-label={`Move ${names[f.id]} later`}
                  >
                    <ChevronDown size={12} />
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}


      <style>{`
        .model-editor { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; }
        /* Onshape's Part Studio bar, measured against a screenshot of it: ONE
           row that never wraps, square icon-only buttons with no chrome of
           their own until you point at them, hairline dividers between
           groups, and -- where a family flies out -- a small caret in the
           button's own bottom-right corner rather than a second button
           beside it. Overflow scrolls; it does not stack into a second row,
           because a bar whose tools move when the window narrows is a bar
           you cannot build muscle memory on. */
        .model-tools {
          display: flex; flex-wrap: nowrap; align-items: center; gap: 2px;
          height: 46px; padding: 0 6px; box-sizing: border-box;
          border-bottom: 1px solid var(--border, var(--reshape-border)); flex-shrink: 0; position: relative;
          overflow-x: auto; overflow-y: visible; scrollbar-width: thin;
        }
        .model-tools::-webkit-scrollbar { height: 4px; }
        .model-tools::-webkit-scrollbar-thumb { background: var(--reshape-border); border-radius: 2px; }
        /* A Fusion-360-style command group: the icon row is the tool, the
           caption below names the group (CREATE/MODIFY/...) the way the
           ui-ref screenshots' ribbon does -- pure labeling, every icon still
           calls the exact same handler it did as a flat row. */
        .model-tool-group { display: inline-flex; flex-direction: column; align-items: center; gap: 2px; flex: 0 0 auto; }
        .model-tool-icons { display: inline-flex; gap: 2px; align-items: center; }
        .model-tool-group-label {
          font-size: 9px; line-height: 1; letter-spacing: 0.04em;
          text-transform: uppercase; color: var(--reshape-text-muted);
          white-space: nowrap;
        }
        .model-tool-divider {
          align-self: center; flex: 0 0 1px; width: 1px; height: 34px;
          background: var(--reshape-border); margin: 0 4px;
        }
        /* ponytail: font-size:0 blanks the bare text node sitting beside each
           icon, which is what makes the bar icon-only without wrapping twenty
           labels in spans. The words stay in the DOM for screen readers and
           are what the tooltip and the flyout menu show. Anything nested that
           SHOULD read as text sets its own size back (menu, search box) --
           add that line too if you nest something new in here. */
        .model-tools button {
          display: inline-flex; align-items: center; justify-content: center;
          width: 28px; height: 28px; padding: 0; gap: 0; font-size: 0;
          background: transparent; color: #d3d5e3;
          border: 1px solid transparent; border-radius: 3px; cursor: pointer;
          flex: 0 0 auto;
        }
        .model-tools button:hover:not(:disabled) {
          background: #3d4051; border-color: #565a70; color: var(--reshape-text);
        }
        .model-tools button:active:not(:disabled) { background: var(--reshape-border); }
        .model-tools button:disabled { opacity: 0.35; cursor: not-allowed; }
        .model-tools button:focus-visible { outline: 1px solid var(--reshape-accent); outline-offset: 1px; }
        /* A click-to-draw tool waiting for its placement click -- Rectangle
           or Polygon armed. Distinct from :active (a fleeting mouse-down)
           and from hover: this has to read as "still on" between clicks,
           with nothing but a canvas cursor otherwise saying so. The accent
           token, not the hover grey, so it survives a hover/unhover over the
           SAME button while armed. */
        .model-tools button[aria-pressed="true"] {
          background: var(--reshape-border); border-color: var(--reshape-accent-2); color: var(--reshape-text);
        }
        .model-tools button[aria-pressed="true"]:hover:not(:disabled) {
          background: #4b4e63; border-color: var(--reshape-accent-2);
        }
        .model-flyout { position: relative; display: inline-flex; flex: 0 0 auto; }
        /* Sits ON the main button's corner, Onshape-style: the corner opens
           the family, the rest of the face runs the tool on its face. */
        .model-flyout-caret {
          position: absolute; right: 0; bottom: 0; z-index: 1;
          width: 13px !important; height: 13px !important;
          border-color: transparent !important; border-radius: 0 3px 0 4px !important;
          background: transparent !important; color: #8a8fa8;
        }
        .model-flyout-caret:hover:not(:disabled) { color: var(--reshape-text); }
        .model-flyout:hover .model-flyout-caret { color: var(--reshape-text); }
        .model-flyout-menu {
          position: fixed; z-index: 60;
          display: flex; flex-direction: column; gap: 1px;
          background: var(--reshape-bg); border: 1px solid var(--reshape-border); border-radius: 3px;
          padding: 3px; min-width: 168px; box-shadow: 0 6px 18px rgba(0,0,0,0.5);
        }
        .model-flyout-menu button {
          justify-content: flex-start; border: none; border-radius: 2px;
          width: 100%; height: 26px; padding: 0 8px; gap: 8px; font-size: 12px;
        }
        /* File/Edit moved to the ribbon's top-left (ui-ref/*.png), so the
           search box is now the only thing left to push to the far right. */
        .model-tool-searchbtn { margin-left: auto; }
        .model-tool-search {
          display: inline-flex; align-items: center; gap: 6px;
          flex: 0 1 auto; min-width: 30px; overflow: hidden;
          margin-left: auto; padding: 4px 8px; font-size: 12px;
          background: var(--reshape-surface); border: 1px solid var(--reshape-border); border-radius: 3px;
          color: var(--reshape-text-muted);
        }
        .model-tool-search input {
          background: transparent; border: none; outline: none;
          color: var(--text, var(--reshape-text)); font-size: 12px;
          flex: 1 1 108px; width: 108px; min-width: 0;
        }
        .model-tool-search input::placeholder { color: var(--reshape-text-muted); }
        /* The magnifier is the last thing to go, so a squeezed search still
           reads as a search rather than as an empty chip. */
        .model-tool-search > svg { flex: 0 0 auto; }
        .model-note {
          margin: 0; padding: 7px 10px; font-size: 12px; line-height: 1.45;
          color: var(--reshape-warn); background-color: #3a2f22;
          border-left: 2px solid var(--reshape-warn); flex-shrink: 0;
        }
        .model-note-timeline { align-self: center; margin-left: 8px; margin-right: 8px; max-width: 46ch; order: 2; }
        /* Dracula red -- the same accent HandleOverlay.tsx already uses for
           its own destructive-adjacent state -- rather than the note's amber,
           so a delete confirm reads as a different kind of message than an
           ordinary teaching note. */
        .model-confirm-delete {
          display: flex; align-items: center; gap: 8px; flex-shrink: 0;
          margin: 0; padding: 7px 10px; font-size: 12px; line-height: 1.45;
          color: var(--reshape-danger); background-color: #3a2328;
          border-left: 2px solid var(--reshape-danger);
        }
        .model-confirm-delete-timeline { align-self: center; margin-left: 8px; margin-right: 8px; max-width: 52ch; order: 2; }
        .model-confirm-delete-go, .model-confirm-delete-keep {
          flex-shrink: 0; padding: 3px 10px; font-size: 12px; border-radius: 3px;
          cursor: pointer;
        }
        .model-confirm-delete-go { background: var(--reshape-danger); border: 1px solid var(--reshape-danger); color: var(--reshape-bg); }
        .model-confirm-delete-go:hover { background: #ff7777; border-color: #ff7777; }
        .model-confirm-delete-keep { background: transparent; border: 1px solid var(--reshape-danger); color: var(--reshape-danger); }
        .model-confirm-delete-keep:hover { background: #3a2328; }
        .model-list { margin: 0; padding: 6px; list-style: none; overflow-y: auto; flex: 1 1 auto; }
        /* The parametric timeline: the same feature list, laid out as a
           horizontal strip of chips across the bottom of the canvas, Fusion
           360 style. The list is portaled into the sandbox's timeline host,
           so this class only applies there. */
        .model-timeline {
          display: flex;
          flex-direction: row;
          align-items: stretch;
          gap: 4px;
          padding: 6px 8px;
          overflow-x: auto;
          overflow-y: hidden;
          flex: 1 1 auto;
          min-height: 0;
        }
        .model-timeline .model-row {
          flex: 0 0 auto;
          position: relative;
          flex-direction: column;
          align-items: flex-start;
          gap: 2px;
          min-width: 96px;
          max-width: 180px;
          padding: 5px 8px 3px;
          border: 1px solid var(--reshape-border);
          border-bottom: 2px solid var(--reshape-text-muted);
          border-radius: 3px;
          background: rgba(40, 42, 54, 0.6);
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .model-timeline .model-row:hover { background: #343746; }
        .model-timeline .model-row.is-on {
          background: var(--reshape-border);
          border-color: var(--reshape-pink);
        }
        .model-timeline .model-row.is-consumed { opacity: 0.55; }
        /* Chip state accents (shCode skin, §4a): the 2px bottom bar carries
           the chip's state -- selected pink, refused danger, everything
           else pending-muted. */
        .model-timeline .model-row.is-refused {
          border-bottom-color: var(--reshape-danger);
        }
        /* Suppressed by the rollback bar: features at or past the boundary are
           hidden from the rebuilt model. More suppressed than is-consumed so
           the two read as distinct states (a feature can be both). */
        .model-timeline .model-row.is-rolled-back { opacity: 0.35; filter: grayscale(0.6); }
        /* The rollback tick between chips: a hairline divider, click-to-set
           (not drag -- a deliberate adaptation of Onshape's draggable bar to
           reSHape's horizontal timeline). */
        .model-timeline .model-rollback-handle {
          flex: 0 0 auto;
          align-self: stretch;
          width: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          background: transparent;
          border: 0;
          cursor: pointer;
          border-radius: 2px;
        }
        .model-timeline .model-rollback-line {
          width: 1px;
          height: 16px;
          background: var(--reshape-text-muted);
          border-radius: 1px;
        }
        .model-timeline .model-rollback-handle:hover .model-rollback-line,
        .model-timeline .model-rollback-handle.is-active .model-rollback-line {
          background: var(--reshape-accent);
        }
        .model-timeline .model-step {
          flex: 0 0 auto;
          text-align: left;
          font-size: 10px;
        }
        .model-timeline .model-name {
          flex: 1 1 auto;
          min-width: 0;
          font-size: 11px;
          line-height: 1.3;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .model-timeline .model-detail { display: none; }
        /* The refusal sentence is panel-only: the timeline truncates prose to
           nothing (see .model-timeline .model-name), so there the row's title
           and aria-label carry it, with the ⚠ glyph alone as the marker. */
        .model-timeline .model-refused-why { display: none; }
        /* The ⚠ as a shCode warn badge (§4a idiom): danger tint at 13% bg /
           33% border, tiny chip radius. Timeline-only -- the panel list keeps
           the bare glyph. */
        .model-timeline .model-refused {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-left: 4px;
          padding: 0 4px;
          font-size: 11px;
          font-weight: 600;
          color: var(--reshape-danger);
          background: rgba(255, 85, 85, 0.13);
          border: 1px solid rgba(255, 85, 85, 0.33);
          border-radius: 3px;
        }
        .model-timeline .model-move {
          position: absolute;
          right: 2px;
          top: 2px;
          display: inline-flex;
          gap: 1px;
          opacity: 0;
        }
        .model-timeline .model-row:hover .model-move { opacity: 1; }
        .model-timeline .model-move button {
          padding: 1px;
          background: transparent;
          border: 0;
          color: var(--reshape-text-muted);
          cursor: pointer;
          border-radius: 2px;
        }
        .model-timeline .model-move button:hover:not(:disabled) { color: var(--text, var(--reshape-text)); background: var(--reshape-text-muted); }
        .model-timeline .model-move button:disabled { opacity: 0.25; cursor: default; }
        .model-timeline .model-empty {
          flex: 0 0 auto;
          align-self: center;
          padding: 0 10px;
          color: var(--reshape-text-muted);
          font-size: 12px;
          line-height: 1.5;
        }
        .model-empty { padding: 14px 10px; color: var(--reshape-text-muted); font-size: 12px; line-height: 1.6; }
        .model-row {
          display: flex; align-items: center; gap: 8px;
          padding: 6px 8px; border-radius: var(--reshape-radius); cursor: pointer;
          font-size: 12px; color: var(--text, var(--reshape-text));
        }
        .model-row:hover { background: #343746; }
        .model-row.is-on { background: var(--reshape-border); }
        /* Consumed by a later step, so it is no longer its own shape. */
        .model-row.is-consumed .model-name { color: var(--reshape-text-muted); }
        .model-step {
          flex: 0 0 18px; text-align: right; color: var(--reshape-text-muted);
          font-variant-numeric: tabular-nums; font-size: 11px;
        }
        .model-name { flex: 1 1 auto; min-width: 0; }
        .model-detail { color: var(--reshape-text-muted); font-style: normal; }
        /* A refused feature: built around, but not the feature itself. The ⚠
           shows in BOTH the timeline and the panel list; the sentence after
           the name is panel-only -- hidden in the timeline, where the row's
           title and aria-label carry the sentence instead. Orange, not red:
           the part built and is still usable, one step of it is missing. */
        .model-refused { color: var(--reshape-danger); margin-left: 4px; }
        .model-refused-why {
          display: block;
          margin-left: 4px;
          color: var(--reshape-warn);
          font-style: normal;
          font-size: 11px;
          white-space: normal;
        }
        .model-move { display: inline-flex; gap: 2px; }
        .model-move button {
          padding: 2px; line-height: 0; background: transparent;
          border: 0; color: var(--reshape-text-muted); cursor: pointer; border-radius: 3px;
        }
        .model-move button:hover:not(:disabled) { color: var(--text, var(--reshape-text)); background: var(--reshape-text-muted); }
        .model-move button:disabled { opacity: 0.25; cursor: default; }
        /* The collapsed strip: a thin rail of the essential tools on the
           canvas's left edge, dressed like the full toolbar. */
        .model-collapsed {
          display: flex; flex-direction: column; align-items: center; gap: 4px;
          padding: 6px 0; height: 100%; box-sizing: border-box;
          background: var(--card, var(--reshape-surface)); border-right: 1px solid var(--border, var(--reshape-border));
        }
        .model-collapsed button {
          display: inline-flex; align-items: center; justify-content: center;
          width: 28px; height: 28px; padding: 0; gap: 0; font-size: 0;
          background: transparent; color: #d3d5e3;
          border: 1px solid transparent; border-radius: 3px; cursor: pointer;
        }
        .model-collapsed button:hover:not(:disabled) {
          background: #3d4051; border-color: #565a70; color: var(--reshape-text);
        }
        .model-collapsed button:disabled { opacity: 0.35; cursor: not-allowed; }
        .model-collapsed button:focus-visible { outline: 1px solid var(--reshape-accent); outline-offset: 1px; }
        /* The Fusion-360-Browser-style tree that fills the card whenever it
           isn't collapsed to the rail above -- see this block's own JSX
           comment. */
        .model-browser { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 8px 0; }
        .model-browser-section + .model-browser-section { margin-top: 10px; }
        .model-browser-heading {
          font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
          color: var(--reshape-text-muted); padding: 0 10px 4px;
        }
        .model-browser-empty { margin: 0; padding: 2px 10px; font-size: 12px; color: var(--reshape-text-muted); }
        .model-browser-row {
          display: block; width: 100%; text-align: left;
          background: transparent; border: none; color: var(--reshape-text);
          font-size: 13px; padding: 5px 10px; cursor: pointer;
        }
        .model-browser-row:hover { background: #3d4051; }
        .model-browser-row.is-on { background: var(--reshape-border); color: var(--reshape-accent-2); }
      `}</style>
    </div>
  );
}
