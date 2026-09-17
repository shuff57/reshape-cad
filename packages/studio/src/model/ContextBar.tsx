'use client';

// The context bar: the ONE floating chrome element adoption step 4 adds
// (design/ui-revamp/SPEC-ui-revamp-decisions.md §1, row 10). Presentational
// only -- the selection state that decides whether to mount it, the actions
// it runs, and the screen anchor it floats above all live in the caller, so
// this file imports nothing from ReshapeStudio and wires nothing.
//
// Policy it encodes: anchored ABOVE the selection; FLIPS BELOW when the
// anchor is too near the top edge (the bar is ~34px tall); CLAMPS inside the
// viewport horizontally when the caller says how wide that is; Escape
// dismisses. Never over the docked rows -- the caller positions this inside
// the viewport cell, which reserves their space by construction.

import { useEffect, useRef } from 'react';

export interface ContextBarAction {
  label: string;
  /** Tooltip, e.g. the full sentence the toolbar button shows. */
  title?: string;
  /** The underline-accent verb, e.g. the ✎Dimensions focus action. */
  primary?: boolean;
  onRun: () => void;
}

interface Props {
  /** Feature kind word, for callers that style per-kind; v1 renders `name` only. */
  featureKind: string;
  /** Display name, e.g. "Pocket 1" -- doubles as the toolbar's aria-label. */
  name: string;
  /** Screen point to float above, in the offset parent's coordinates. Null hides the bar. */
  anchor: { x: number; y: number } | null;
  /** Mono readouts, e.g. { label: 'depth', value: '12 mm' }. */
  chips: { label: string; value: string }[];
  /** Why an action cannot run, shown inline in the danger colour. */
  refusal: string | null;
  actions: ContextBarAction[];
  onDismiss: () => void;
  /** Escape tiering: return false when something else (the sketch draw tool,
   *  the selection strip) owns Escape for this keypress, so one press does
   *  not clear both. Absent means the bar may always dismiss itself. */
  canDismiss?: () => boolean;
  /** Viewport width for horizontal clamping; absent means no clamp (v1). */
  viewWidth?: number;
}

// Measured bar height: padding 4px x2 + ~13px text + hairline borders.
const BAR_HEIGHT = 34;
// The gap left between the anchor and a bar flipped below it.
const FLIP_GAP = 6;

export default function ContextBar({
  featureKind: _featureKind,
  name,
  anchor,
  chips,
  refusal,
  actions,
  onDismiss,
  canDismiss,
  viewWidth,
}: Props) {
  // Escape dismisses -- the listener exists only while the bar does, and the
  // mount itself is what "a selection exists" means, so no activeElement
  // nuance is needed for v1 (buttons here never take a text caret). Both
  // callbacks live in refs refreshed each render so the listener itself is
  // mounted once (no add/remove churn per parent render) and the handlers
  // read the CURRENT values, per-render, without re-subscribing.
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const canDismissRef = useRef(canDismiss);
  canDismissRef.current = canDismiss;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (canDismissRef.current?.() ?? true)) onDismissRef.current?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!anchor) return null;

  const flip = anchor.y - BAR_HEIGHT < 8;
  let left = anchor.x;
  if (typeof viewWidth === 'number') {
    left = Math.max(4, Math.min(anchor.x, viewWidth - 4));
  }
  const style = flip
    ? { left, top: anchor.y + FLIP_GAP, transform: 'translate(-50%, 0)' }
    : { left, top: anchor.y, transform: 'translate(-50%, -100%)' };

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div className="ctx-bar-host" style={{ left: style.left, top: style.top }}>
      <div
        className={'ctx-bar' + (flip ? ' is-below' : '')}
        role="toolbar"
        aria-label={name + ' actions'}
        style={{ transform: flip ? 'translate(-50%, 0)' : 'translate(-50%, -100%)' }}
        onPointerDown={stop}
        onClick={stop}
      >
        <span className="ctx-who">{name}</span>
        <span className="ctx-sep" />
        {refusal && <span className="ctx-refusal">⚠ {refusal}</span>}
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            className={a.primary ? 'is-primary' : undefined}
            title={a.title ?? a.label}
            onPointerDown={stop}
            onClick={(e) => { e.stopPropagation(); a.onRun(); }}
          >
            {a.label}
          </button>
        ))}
        {chips.length > 0 && <span className="ctx-sep" />}
        {chips.map((c) => (
          <span key={c.label} className="ctx-chip">
            {c.label} <span className="ctx-chip-val">{c.value}</span>
          </span>
        ))}
      </div>
      <style>{`
        /* Host is the positioning shell: it never eats pointer events; the
           bar itself does, so orbit drags starting beside the bar still run. */
        .ctx-bar-host { position: absolute; pointer-events: none; z-index: 20; }
        .ctx-bar {
          pointer-events: auto; display: flex; align-items: center; gap: 4px;
          background: var(--card, var(--reshape-surface));
          border: 1px solid var(--border, var(--reshape-border));
          border-radius: 999px; padding: 4px 6px 4px 10px;
          font-size: var(--reshape-font-size-sm, 12px); white-space: nowrap;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45); color: var(--text, var(--reshape-text));
          font-family: var(--reshape-font-ui);
        }
        .ctx-bar .ctx-who { font-weight: 600; padding: 0 2px; }
        .ctx-bar .ctx-sep { width: 1px; height: 16px; background: var(--border, var(--reshape-border)); }
        .ctx-bar button {
          padding: 3px 7px; border-radius: 999px; border: none; background: none;
          color: inherit; font-size: inherit; cursor: pointer;
        }
        .ctx-bar button:hover {
          background: var(--reshape-surface-alt); color: var(--reshape-accent);
        }
        .ctx-bar button.is-primary {
          color: var(--text, var(--reshape-text)); text-decoration: underline;
          text-decoration-color: var(--reshape-accent); text-underline-offset: 3px;
        }
        .ctx-bar .ctx-refusal { color: var(--reshape-danger); padding: 0 4px; }
        .ctx-bar .ctx-chip {
          font-family: var(--reshape-font-mono); font-size: var(--reshape-font-size-sm, 12px);
          background: var(--bg, var(--reshape-bg));
          border: 1px solid var(--border, var(--reshape-border));
          border-radius: var(--reshape-radius, 4px); padding: 2px 8px;
        }
        .ctx-bar .ctx-chip-val { color: var(--reshape-accent); }
      `}</style>
    </div>
  );
}