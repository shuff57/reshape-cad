/**
 * Mouse scheme presets + localStorage persistence.
 * Pure numbers in/out so it is testable without a renderer.
 */

export type MouseScheme = 'legacy' | 'fusion';

export interface MouseButtons {
  ORBIT: number;
  PAN: number;
  DOLLY: number;
}

export interface Touches {
  ORBIT: number;
  PAN: number;
  DOLLY: number;
}

export const MOUSE_SCHEMES: Record<MouseScheme, { label: string; buttons: MouseButtons; touches: Touches }> = {
  legacy: {
    label: 'Legacy (L=Orbit, M=Dolly, R=Pan)',
    buttons: { ORBIT: 0, PAN: 2, DOLLY: 1 },
    touches: { ORBIT: 0, PAN: 1, DOLLY: 2 },
  },
  fusion: {
    label: 'Fusion (L=Orbit, M=Pan, R=Dolly)',
    buttons: { ORBIT: 0, PAN: 1, DOLLY: 2 },
    touches: { ORBIT: 0, PAN: 2, DOLLY: 1 },
  },
};

// Todo 29 (SPEC Phase 1.1): flipped from 'legacy' after the FmMNIGVpCng
// review (official Autodesk Fusion footage, filed in fusion-video-findings.md
// as "## Navigation / camera") CONFIRMED MMB-pan + Shift+MMB-orbit; the
// 'fusion' preset's MMB=PAN matches, and a stored preference still wins via
// loadSchemeName() -- the default only reaches first-time users.
export const DEFAULT_SCHEME_NAME: MouseScheme = 'fusion';

const STORAGE_KEY = 'reshape.mouseScheme';

export function loadSchemeName(): MouseScheme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (stored === 'legacy' || stored === 'fusion')) return stored;
  } catch { /* ignore */ }
  return DEFAULT_SCHEME_NAME;
}

export function saveSchemeName(name: MouseScheme): void {
  try { localStorage.setItem(STORAGE_KEY, name); } catch { /* ignore */ }
}

export function schemeToMouseButtons(scheme: MouseScheme): MouseButtons {
  return MOUSE_SCHEMES[scheme].buttons;
}

export function schemeToTouches(scheme: MouseScheme): Touches {
  return MOUSE_SCHEMES[scheme].touches;
}
