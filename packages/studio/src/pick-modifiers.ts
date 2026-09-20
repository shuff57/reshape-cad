'use client';

// Was Shift held when the viewport pick landed? -- for exactly as long as
// that still has to be guessed.
//
// BrepViewportThree's ViewportPick (BrepViewportThree.tsx:168) carries no
// modifier-key information, so the Shift-adds-instead-of-replaces behaviour
// in ReshapeStudio's onPick has always read plain window keydown/keyup/blur
// listeners rather than the pick's own event. This hook IS that listener,
// lifted verbatim out of ReshapeStudio.tsx (where it lived as `shiftHeldRef`)
// when the six split selection useStates were unified into one SelectionState
// (SPEC-mouse-parity.md Phase 3 item 7), so the file that owns selection
// state no longer owns a keyboard listener too.
//
// Deliberately a stopgap with one job and one call site: Phase 3 item 1
// ("Modifier semantics. Carry modifiers into `onPick` -- today a window
// keydown listener fakes it") deletes this file and reads e.shiftKey off the
// real pointer event instead. It is kept byte-identical to the version it
// replaces -- only the literal 'Shift' key sets the flag, losing the window
// clears it -- because the unification that moved it here was a pure
// refactor, and a real modifier payload would change behaviour in the cases
// this fake one gets wrong (Shift pressed while focus sits inside the
// runner iframe, say).

import { useEffect, useRef } from 'react';

/** A ref that reads true while Shift is down. A ref, not state: the only
 *  reader is an event handler asking at click time, and re-rendering the
 *  whole shell on every Shift press would buy nothing. */
export function useShiftHeld(): { current: boolean } {
  const held = useRef(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Shift') held.current = true; };
    const up = (e: KeyboardEvent) => { if (e.key === 'Shift') held.current = false; };
    const blur = () => { held.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);
  return held;
}
