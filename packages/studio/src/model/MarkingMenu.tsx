'use client';

// The radial first level of the right-click marking menu (SPEC-mouse-parity.md
// Phase 4.1). Renders exactly the wedges marking-menu-core.ts's config/filter
// hand it -- no menu contents live in this file, per that module's own "data
// keyed by mode" split. Second-level flyouts (todo 18) and the hold/drag
// gesture (todo 19/20) are not built here.
//
// Positioned the same way ContextBar.tsx is: an absolutely-positioned host at
// (x, y), meant to be mounted inside whatever positioned ancestor the caller
// already has (BrepViewportThree.tsx's own `position: relative` wrapper,
// SketchCanvas2D's `.sk2d-host`) -- x/y are THAT container's own pixels, not
// raw viewport coordinates; the caller computes them with
// getBoundingClientRect() the same way BrepViewportThree's own boxSelect/
// windowZoom overlays already do.
//
// Coexists with ContextBar (SPEC's own open question #4, resolved here as
// COEXIST): this file imports nothing from it and neither replaces the
// other.
//
// Dumb by design: no global click listener. "Left-click elsewhere closes it"
// is a full-viewport backdrop div UNDER the wedges (position: fixed, so it
// still covers the whole screen even though the menu itself is positioned
// relative to a smaller container) -- clicking it is what fires onClose, not
// a document-level subscription. Escape is the one exception, the same
// window keydown ContextBar.tsx already uses for the identical reason (an
// element with no children to catch a keypress on has nowhere else to attach
// the listener).

import { useEffect } from 'react';
import {
  wedgesForMode,
  validSketchConstraints,
  SKETCH_CONSTRAINT_IDS,
  type MarkingMenuMode,
  type MarkingMenuWedge,
  type SketchSelectionEntry,
} from './marking-menu-core.js';

const RADIUS = 90;
const GATED_IDS = new Set<string>(SKETCH_CONSTRAINT_IDS);

export interface MarkingMenuProps {
  x: number;
  y: number;
  mode: MarkingMenuMode;
  /** Sketch-mode selection, as geometry kinds (validSketchConstraints()'s own
   *  input shape) -- ignored in part-viewport mode. Absent/empty means every
   *  selection-gated constraint wedge renders disabled. */
  selection?: SketchSelectionEntry[];
  onCommand: (id: string) => void;
  onClose: () => void;
}

export default function MarkingMenu({ x, y, mode, selection, onCommand, onClose }: MarkingMenuProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const wedges = wedgesForMode(mode);
  const validIds = mode === 'sketch' ? new Set(validSketchConstraints(selection ?? [])) : null;

  function isEnabled(w: MarkingMenuWedge): boolean {
    if (w.enabled === false) return false;
    if (validIds !== null && GATED_IDS.has(w.id)) return validIds.has(w.id);
    return true;
  }

  const n = wedges.length;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <>
      <div
        className="marking-menu-backdrop"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div className="marking-menu" role="menu" style={{ left: x, top: y }}>
        {wedges.map((w, i) => {
          const angle = ((-90 + (360 / n) * i) * Math.PI) / 180;
          const wx = RADIUS * Math.cos(angle);
          const wy = RADIUS * Math.sin(angle);
          const enabled = isEnabled(w);
          return (
            <button
              key={w.id}
              type="button"
              role="menuitem"
              className="marking-menu-wedge"
              disabled={!enabled}
              title={w.shortcut ? `${w.label} (${w.shortcut})` : w.label}
              style={{ left: wx, top: wy }}
              onPointerDown={stop}
              onClick={(e) => {
                stop(e);
                if (enabled) onCommand(w.id);
              }}
            >
              {w.label}
            </button>
          );
        })}
      </div>
      <style>{`
        .marking-menu-backdrop { position: fixed; inset: 0; z-index: 29; }
        .marking-menu { position: absolute; width: 0; height: 0; z-index: 30; }
        .marking-menu-wedge {
          position: absolute; transform: translate(-50%, -50%);
          padding: 4px 8px; border-radius: 999px;
          border: 1px solid var(--border, var(--reshape-border));
          background: var(--card, var(--reshape-surface));
          color: var(--text, var(--reshape-text));
          font-size: var(--reshape-font-size-sm, 12px); font-family: var(--reshape-font-ui);
          white-space: nowrap; cursor: pointer;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
        }
        .marking-menu-wedge:disabled { opacity: 0.4; cursor: not-allowed; }
        .marking-menu-wedge:not(:disabled):hover {
          background: var(--reshape-surface-alt); color: var(--reshape-accent);
        }
      `}</style>
    </>
  );
}
