// What a sentence calls the PART (pilot 2026-11 F9, owner decision 2026-11-11): the step that MADE it (box1, pull1, cyl1, op1), not the last step that changed it.
// A script's handle moves on with every hole, round, hollow or draft, so a feature's `target` is the last such step: "the open edge of hole1", "Hollowing hole1".
// partNameOf walks back through the steps that only change a part to the step that made it. A sentence that means one particular step ("it comes after hole1",
// "it crosses hole1") does not use this.
type Step = { kind: string; target?: string; into?: string; copy?: boolean };
const CHANGES = new Set(['hole', 'fillet', 'shell', 'draft', 'move', 'rotate']);
/** the id of the step that made the part `id` belongs to; `id` itself when the history cannot be followed */
export function partNameOf(id: string | undefined, byId: Record<string, Step | undefined>): string | undefined {
  let cur = id; const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const f = byId[cur]; if (!f) return id;
    const next = CHANGES.has(f.kind) && !(f.kind === 'move' && f.copy) ? f.target : f.kind === 'pocket' || f.kind === 'groove' ? f.into : undefined;
    if (!next) return cur;
    cur = next;
  }
  return id;
}
const PART = new WeakMap<object, string>();
/** remember the part's name for the feature object the sentences are built from (set once, where the step starts) */
export const setPartName = (f: object, name: string | undefined): void => { if (name) PART.set(f, name); };
/** the part's name for a sentence: what setPartName recorded for this feature, else its target as before */
export const partName = (f: { target?: string }): string | undefined => PART.get(f as object) ?? f.target;
