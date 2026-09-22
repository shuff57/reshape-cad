// Command-state step tooltips (todo 26, SPEC-mouse-parity.md Phase 5.4):
// the prompt string follows the ACTIVE COMMAND's own step, not the hover
// target -- "Select sketch profiles or planar faces" while an extrude
// awaits its first selection, then "Hold Ctrl to modify selection" once
// one exists (SPEC's exact observed strings, :45-48). The viewport's
// static hints stay; this is the manipulator commands' slot.
//
// Pure: state in, sentence out -- testable under node --test with no
// renderer. The caller (HandleOverlay's gizmo wrap) shows the returned
// string and clears it on command end.

export type ToolCommand = 'extrude' | 'press-pull' | 'fillet' | 'move' | 'pocket';

/** What a command's tooltip says right now. `selectionCount` is how many
 *  picks the command holds; `hasModifier` says the command can still be
 *  modified (Ctrl) -- the general tooltip reused across all of them. */
export function stepTooltip(
  command: ToolCommand | string,
  state: { active: boolean; selectionCount: number; hasModifier?: boolean },
): string | null {
  if (!state.active) return null;
  switch (command) {
    case 'extrude':
    case 'press-pull':
      if (state.selectionCount === 0) return 'Select sketch profiles or planar faces';
      return 'Hold Ctrl to modify selection';
    case 'fillet':
      if (state.selectionCount === 0) return 'Select an edge to round or bevel';
      return 'Hold Ctrl to modify selection';
    case 'move':
    case 'pocket':
      if (state.selectionCount === 0) return command === 'pocket' ? 'Select a face to cut deeper' : 'Select a body to move or copy';
      return 'Hold Ctrl to modify selection';
    default:
      return null;
  }
}
