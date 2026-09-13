import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { ToolActions } from './model/ModelEditor.js';

/**
 * The literal File/Edit/View/Insert/Modify menu bar that sits above the
 * icon ribbon in Build mode -- the same "ribbon AND full menu for the same
 * actions" pairing FreeCAD and Fusion 360 both ship. Pure additional
 * discoverability: every Insert/Modify item below calls the EXACT SAME
 * function its ribbon equivalent already calls (handed up from
 * ModelEditor.tsx via the `registerToolActions` prop -- see that prop's own
 * doc comment on ModelEditor's Props interface), and every File/Edit item
 * calls the exact same handler ReshapeStudio.tsx's own toolbar chips
 * already call. Nothing here re-implements a tool; this component only
 * decides what to show and when to grey it out.
 *
 * Positioning follows ModelEditor.tsx's own FlyoutButton technique exactly
 * (search that file for `model-flyout-menu`): a CSS-only `position:
 * absolute` dropdown clips the moment its parent bar scrolls or sits near
 * an edge, so each open dropdown instead measures its OWN label's
 * `getBoundingClientRect()` on open and positions itself against the
 * viewport (`position: fixed`) at that rect -- out of any ancestor's clip
 * entirely, same reasoning as the ribbon's own comment there.
 */
export interface MenuBarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Same `canBuild` gate the existing "Clear model" toolbar chip already
   *  uses -- see ReshapeStudio.tsx's own chip. */
  canClearModel: boolean;
  onClearModel: () => void;
  /** Same `hasMesh` gate the existing Export STL/OBJ/3MF chips already use. */
  hasMesh: boolean;
  /** Same `engineKind` gate the existing Save/.FCStd/Export Drawing chips
   *  already use -- those gray out on the OCCT engine. */
  engineKind: 'occt' | 'freecad' | null;
  onExportSTL: () => void;
  onExportOBJ: () => void;
  onExport3MF: () => void;
  onSaveFCStd: () => void;
  onOpenFCStd: () => void;
  onExportDrawing: (format: 'svg' | 'pdf') => void;
  /** The existing rail-collapse state/setter this app already has -- View's
   *  one item this pass just flips it. */
  toolsHidden: boolean;
  onToggleTools: () => void;
  /** ModelEditor's own Create/Modify/Delete handlers -- see ModelEditor's
   *  `registerToolActions`/`ToolActions` doc comments. Read directly
   *  (`.current`) at both render time (for each item's disabled/title) and
   *  click time (to run it); a plain ref is enough since this is the only
   *  consumer. */
  toolActionsRef: RefObject<ToolActions | null>;
}

interface MenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  title?: string;
}

interface TopMenu {
  id: string;
  label: string;
  items: MenuItem[];
}

const PICK_TWO_TITLE = 'Pick two shapes first — click one, then hold Shift (or Ctrl, or Cmd) and click another.';

export default function MenuBar({
  canUndo, canRedo, onUndo, onRedo, canClearModel, onClearModel,
  hasMesh, engineKind, onExportSTL, onExportOBJ, onExport3MF, onSaveFCStd, onOpenFCStd, onExportDrawing,
  toolsHidden, onToggleTools, toolActionsRef,
}: MenuBarProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const labelRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Measured on open only, same as FlyoutButton's own `at` -- out of the
  // bar's own stacking/clip context entirely (see file-top comment).
  useEffect(() => {
    if (!open) { setAt(null); return; }
    const r = labelRefs.current[open]?.getBoundingClientRect();
    if (r) setAt({ left: r.left, top: r.bottom + 2 });
  }, [open]);

  // Clicking anywhere outside the open dropdown (or its own label) closes
  // it; so does Escape. Matches FlyoutButton's "clicking anywhere closes
  // it, which is the next thing a student does" comment.
  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (dropdownRef.current?.contains(target)) return;
      if (labelRefs.current[open]?.contains(target)) return;
      setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    document.addEventListener('pointerdown', onDocPointer, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointer, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const tool = toolActionsRef.current;

  const fileItems: MenuItem[] = [
    {
      id: 'open', label: 'Open (.FCStd)', onSelect: onOpenFCStd,
      disabled: engineKind !== 'freecad',
      title: engineKind === 'freecad' ? 'Open a previously-saved .FCStd file' : 'Save/Open .FCStd needs the FreeCAD engine',
    },
    {
      id: 'save', label: 'Save (.FCStd)', onSelect: onSaveFCStd,
      disabled: !(engineKind === 'freecad' && hasMesh),
      title: engineKind !== 'freecad' ? 'Save/Open .FCStd needs the FreeCAD engine'
        : hasMesh ? 'Download the current model as a FreeCAD .FCStd file' : 'Build a shape first',
    },
    {
      id: 'export-stl', label: 'Export STL', onSelect: onExportSTL, disabled: !hasMesh,
      title: hasMesh ? 'Download the current model as an STL file' : 'Build a shape first',
    },
    {
      id: 'export-obj', label: 'Export OBJ', onSelect: onExportOBJ, disabled: !hasMesh,
      title: hasMesh ? 'Download the current model as an OBJ file' : 'Build a shape first',
    },
    {
      id: 'export-3mf', label: 'Export 3MF', onSelect: onExport3MF, disabled: !hasMesh,
      title: hasMesh ? 'Download the current model as a 3MF file' : 'Build a shape first',
    },
    {
      id: 'export-drawing-svg', label: 'Export Drawing (SVG)', onSelect: () => onExportDrawing('svg'),
      disabled: !(engineKind === 'freecad' && hasMesh),
      title: engineKind !== 'freecad' ? 'Export Drawing needs the FreeCAD engine'
        : hasMesh ? 'Download a 2D engineering drawing (SVG) of the current model' : 'Build a shape first',
    },
    {
      id: 'export-drawing-pdf', label: 'Export Drawing (PDF)', onSelect: () => onExportDrawing('pdf'),
      disabled: !(engineKind === 'freecad' && hasMesh),
      title: engineKind !== 'freecad' ? 'Export PDF needs the FreeCAD engine'
        : hasMesh ? 'Download a 2D engineering drawing (PDF) of the current model' : 'Build a shape first',
    },
  ];
  // No distinct "New" -- Clear model (under Edit) is the only "start a
  // fresh empty model" action this app has; see MenuBar's own report for
  // why a second, separate New was not invented for this pass.

  const editItems: MenuItem[] = [
    { id: 'undo', label: 'Undo', onSelect: onUndo, disabled: !canUndo, title: 'Undo (Ctrl+Z)' },
    { id: 'redo', label: 'Redo', onSelect: onRedo, disabled: !canRedo, title: 'Redo (Ctrl+Shift+Z)' },
    {
      id: 'delete', label: 'Delete', onSelect: () => tool?.deleteSelected.run(),
      disabled: tool?.deleteSelected.disabled ?? true,
      title: tool?.deleteSelected.title ?? 'Delete the selected',
    },
    {
      id: 'clear', label: 'Clear model', onSelect: onClearModel, disabled: !canClearModel,
      title: 'Clear the model and start again',
    },
  ];

  const viewItems: MenuItem[] = [
    {
      id: 'toggle-tools', label: toolsHidden ? 'Show Tools Panel' : 'Hide Tools Panel',
      onSelect: onToggleTools,
      title: toolsHidden ? 'Show the shape tools' : 'Collapse the tools to a rail, so the shape fills the window',
    },
    // Fit/Reset view is deliberately absent -- no existing camera fit/reset
    // capability was found in BrepViewportThree.tsx to call (see MenuBar's
    // own report). Not invented here; a later pass that adds one should
    // wire it in alongside this item, not build new camera math in here.
  ];

  const insertItems: MenuItem[] = [
    { id: 'sketch', label: 'Sketch', onSelect: () => tool?.sketch.run(), disabled: tool?.sketch.disabled ?? true, title: tool?.sketch.title },
    { id: 'box', label: 'Box', onSelect: () => tool?.addShape('box'), disabled: !tool },
    { id: 'cylinder', label: 'Cylinder', onSelect: () => tool?.addShape('cylinder'), disabled: !tool },
    { id: 'cone', label: 'Cone', onSelect: () => tool?.addShape('cone'), disabled: !tool },
    { id: 'torus', label: 'Torus', onSelect: () => tool?.addShape('torus'), disabled: !tool },
    { id: 'sphere', label: 'Sphere', onSelect: () => tool?.addShape('sphere'), disabled: !tool },
    { id: 'pull', label: 'Pull', onSelect: () => tool?.pull.run(), disabled: tool?.pull.disabled ?? true, title: tool?.pull.title },
    { id: 'spin', label: 'Spin', onSelect: () => tool?.spin.run(), disabled: tool?.spin.disabled ?? true, title: tool?.spin.title },
    { id: 'blend', label: 'Blend', onSelect: () => tool?.blend.run(), disabled: tool?.blend.disabled ?? true, title: tool?.blend.title },
  ];

  const modifyItems: MenuItem[] = [
    { id: 'round', label: 'Round', onSelect: () => tool?.round('fillet').run(), disabled: tool ? tool.round('fillet').disabled : true, title: tool?.round('fillet').title },
    { id: 'chamfer', label: 'Chamfer', onSelect: () => tool?.round('chamfer').run(), disabled: tool ? tool.round('chamfer').disabled : true, title: tool?.round('chamfer').title },
    { id: 'turn', label: 'Turn', onSelect: () => tool?.turn.run(), disabled: tool?.turn.disabled ?? true, title: tool?.turn.title },
    { id: 'hole', label: 'Hole', onSelect: () => tool?.hole.run(), disabled: tool?.hole.disabled ?? true, title: tool?.hole.title },
    { id: 'hole-4corner', label: 'Hole (Four Corners)', onSelect: () => tool?.holeFourCorners.run(), disabled: tool?.holeFourCorners.disabled ?? true, title: tool?.holeFourCorners.title },
    { id: 'hollow', label: 'Hollow', onSelect: () => tool?.hollow.run(), disabled: tool?.hollow.disabled ?? true, title: tool?.hollow.title },
    { id: 'open-hollow', label: 'Hollow (Open Face)', onSelect: () => tool?.openHollow.run(), disabled: tool?.openHollow.disabled ?? true, title: tool?.openHollow.title },
    { id: 'pattern-linear', label: 'Pattern (Linear)', onSelect: () => tool?.patternLinear.run(), disabled: tool?.patternLinear.disabled ?? true, title: tool?.patternLinear.title },
    { id: 'pattern-circular', label: 'Pattern (Circular)', onSelect: () => tool?.patternCircular.run(), disabled: tool?.patternCircular.disabled ?? true, title: tool?.patternCircular.title },
    { id: 'mirror-yz', label: 'Mirror (Left-Right)', onSelect: () => tool?.mirror('yz').run(), disabled: tool ? tool.mirror('yz').disabled : true, title: tool?.mirror('yz').title },
    { id: 'mirror-xz', label: 'Mirror (Front-Back)', onSelect: () => tool?.mirror('xz').run(), disabled: tool ? tool.mirror('xz').disabled : true, title: tool?.mirror('xz').title },
    { id: 'mirror-xy', label: 'Mirror (Top-Bottom)', onSelect: () => tool?.mirror('xy').run(), disabled: tool ? tool.mirror('xy').disabled : true, title: tool?.mirror('xy').title },
    { id: 'move', label: 'Move', onSelect: () => tool?.move.run(), disabled: tool?.move.disabled ?? true, title: tool?.move.title },
    { id: 'copy', label: 'Copy', onSelect: () => tool?.copy.run(), disabled: tool?.copy.disabled ?? true, title: tool?.copy.title },
    { id: 'join', label: 'Join', onSelect: () => tool?.join.run(), disabled: tool?.join.disabled ?? true, title: tool?.join.title ?? PICK_TWO_TITLE },
    { id: 'cut', label: 'Cut', onSelect: () => tool?.cut.run(), disabled: tool?.cut.disabled ?? true, title: tool?.cut.title ?? PICK_TWO_TITLE },
    { id: 'overlap', label: 'Overlap', onSelect: () => tool?.overlap.run(), disabled: tool?.overlap.disabled ?? true, title: tool?.overlap.title ?? PICK_TWO_TITLE },
  ];

  const menus: TopMenu[] = [
    { id: 'file', label: 'File', items: fileItems },
    { id: 'edit', label: 'Edit', items: editItems },
    { id: 'view', label: 'View', items: viewItems },
    { id: 'insert', label: 'Insert', items: insertItems },
    { id: 'modify', label: 'Modify', items: modifyItems },
  ];

  const openMenu = menus.find((m) => m.id === open);

  return (
    <div className="reshape-menu-bar" role="menubar" aria-label="Menu">
      {menus.map((m) => (
        <button
          key={m.id}
          ref={(el) => { labelRefs.current[m.id] = el; }}
          type="button"
          className={open === m.id ? 'reshape-menu-label is-open' : 'reshape-menu-label'}
          aria-haspopup="menu"
          aria-expanded={open === m.id}
          onClick={() => setOpen((cur) => (cur === m.id ? null : m.id))}
        >
          {m.label}
        </button>
      ))}
      {openMenu && at && (
        <div ref={dropdownRef} className="reshape-menu-dropdown" role="menu" style={{ left: at.left, top: at.top }}>
          {openMenu.items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.title}
              onClick={() => { setOpen(null); item.onSelect(); }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      <style>{`
        .reshape-menu-bar {
          display: flex;
          align-items: stretch;
          gap: 1px;
          background: var(--reshape-bg);
          border-bottom: 1px solid var(--reshape-border);
        }
        .reshape-menu-label {
          background: transparent;
          border: none;
          color: #d3d5e3;
          font-size: 12px;
          padding: 0 12px;
          cursor: pointer;
        }
        .reshape-menu-label:hover, .reshape-menu-label.is-open {
          background: var(--reshape-border);
          color: var(--reshape-text);
        }
        .reshape-menu-label:focus-visible { outline: 1px solid var(--reshape-accent); outline-offset: -2px; }
        .reshape-menu-dropdown {
          position: fixed;
          z-index: 70;
          display: flex;
          flex-direction: column;
          gap: 1px;
          background: var(--reshape-bg);
          border: 1px solid var(--reshape-border);
          border-radius: 3px;
          padding: 3px;
          min-width: 210px;
          max-height: 70vh;
          overflow-y: auto;
          box-shadow: 0 6px 18px rgba(0,0,0,0.5);
        }
        .reshape-menu-dropdown button {
          display: block;
          width: 100%;
          text-align: left;
          background: transparent;
          border: none;
          border-radius: 2px;
          color: var(--reshape-text);
          font-size: 12px;
          padding: 6px 10px;
          cursor: pointer;
        }
        .reshape-menu-dropdown button:hover:not(:disabled) { background: #3d4051; }
        .reshape-menu-dropdown button:disabled { opacity: 0.35; cursor: not-allowed; color: #d3d5e3; }
      `}</style>
    </div>
  );
}
