// The floating drag-or-type value box, shared by the sketch canvas's
// dimension chips (P2.7, commit 98ab880) and the 3D feature manipulator
// (SPEC-mouse-parity.md Phase 5.1, todo 22). One component so "drag OR
// type, either commits" stays one behaviour, not two that drift.
//
// The pattern both callers had already converged on, kept verbatim:
//   - a plain <input> styled as a floating chip, autoFocus + select on
//     open, so typing over the current value is the edit;
//   - Enter commits through `onCommit(text)` and Escape cancels;
//   - blur without Enter reverts (half a number is not an edit);
//   - pointerdown/click stopPropagation so a press on the box never
//     cancels the gesture or reaches the canvas underneath;
//   - the parent owns the value string and the parsed-number discipline:
//     this component never parses -- it hands back exactly what was typed,
//     and `onCommit` decides whether that is a number a feature can take.
import { useEffect, useRef } from 'react';

export interface ValueBoxProps {
  /** What the box shows right now: the typed draft, or the formatted
   *  committed value while untouched. Parent-owned. */
  value: string;
  onChange: (next: string) => void;
  /** Enter. Receives the raw text; the caller parses and refuses there,
   *  in a sentence, exactly as the sketch chips always have. */
  onCommit: () => void;
  /** Escape: drop the pending edit with no doc change. */
  onCancel: () => void;
  /** Anchor: CSS px inside the nearest positioned ancestor, top-left.
   *  The chip is centred on this point (translate(-50%,-50%)), the same
   *  convention chipAt()/worldToScreen handed the sketch chips. */
  x: number;
  y: number;
  /** data-* marker the Playwright scenarios key on (e.g. "dim-pending",
   *  "fillet-pending" -- and now "manipulator-value"). */
  testId: string;
  /** Optional extra chip text rendered under data-editing, for tests. */
  kind?: string;
  className?: string;
}

/** The chip itself. Not a text field with a label around it: the whole
 *  interaction is one input, and the styling below matches
 *  .sk2d-dim-chip's, so the sketch flow and this look like one family. */
export default function ValueBox({
  value, onChange, onCommit, onCancel, x, y, testId, kind, className = '',
}: ValueBoxProps) {
  const ref = useRef<HTMLInputElement>(null);
  // Autofocus selects the current text, so the first keystroke replaces it --
  // "type over it is the edit", the behaviour both callers relied on.
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      className={className || 'reshape-value-box'}
      data-value-box={testId}
      data-editing="true"
      {...(kind ? { 'data-value-kind': kind } : {})}
      style={{
        position: 'absolute',
        left: `${x}px`,
        top: `${y}px`,
        transform: 'translate(-50%, -50%)',
      }}
      size={Math.max(3, value.length + 1)}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onCommit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      // The named edge case from the sketch chips, still true: a press on
      // a value box must never reach the canvas, or the gesture it belongs
      // to gets cancelled underneath it.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/** A dimension-like value as the box shows it at rest: full float
 *  precision would print 39.99999999 for a 40 a solver produced. Same
 *  rounding formatDim() used in SketchCanvas2D; hoisted here because the
 *  3D value box needs it too and a second copy there would be the drift
 *  this file exists to prevent. */
export function formatValue(v: number): string {
  return String(Math.round(v * 1e4) / 1e4);
}