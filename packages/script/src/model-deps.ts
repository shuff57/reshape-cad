// What an edit costs, before it is made.
//
// A ModelDoc is a list of features that refer to each other by id: a Pull names
// the sketch it came from, a Hole names the solid it drills, a Cut names both
// its inputs. Those references are the document's selections, and this file is
// about not letting one dangle.
//
// THE DEFECT THIS EXISTS FOR, measured 2026-09-01. Deleting a sketch removed
// only the sketch. dependsOn() in lib/model-types.ts already knew every kind
// that names a target -- reordering the timeline used it -- but the delete path
// filtered combines and nothing else, so a Pull built from the deleted sketch
// stayed in the timeline pointing at nothing. What the student got was this,
// emitted straight into the preview:
//
//   const pull1 = extrudeOnPlane(sk1, p.pull1_height, 'xy', p.sk1_offset)
//                                ^^^                       ^^^^^^^^^^^^
//
// `sk1` is not declared, so the model stopped rendering with
// "ReferenceError: sk1 is not defined". A raw JavaScript error, for an action
// that is not a mistake -- deleting a sketch is a perfectly ordinary thing to
// do. The student has no way to connect that sentence to what they just
// clicked.
//
// THE CONTRACT, which is the repo's already: say what an edit costs, in words,
// and let the caller decide. whyCannotRoundCorner() and
// whyRemovingCornerCosts() in lib/sketch-arc.ts are the same shape, and
// whyNameLost() in lib/topo-name.ts is the face-level version of the same idea.
// Nothing here refuses anything or edits anything on its own.
//
// NO KERNEL, ON PURPOSE. Whether a reference can still be honoured is a
// question about the document, not about geometry, so it is answerable while
// designing and testable without OpenCascade -- the same reason lib/topo-name.ts
// is split from lib/topo-resolve.ts.

import { dependsOn } from './model-types.js';
import type { Feature, ModelDoc } from './model-types.js';

/**
 * Every feature that could not be built if `ids` were removed -- the ids
 * themselves plus everything that leans on them, however far down the chain.
 *
 * A Pull leans on its sketch, a Hole on the Pull, a Cut on the Hole. Removing
 * the sketch takes all four, and it has to be computed rather than assumed:
 * checking one level deep leaves the Hole pointing at a Pull that is also gone.
 *
 * Run to a fixed point rather than in one forward pass. A doc loaded from disk
 * is not guaranteed to be in dependency order -- the timeline enforces that on
 * reorder, but nothing enforces it on load -- and a single pass over an
 * out-of-order doc would miss the features it had already walked past.
 */
export function orphanedBy(doc: ModelDoc, ids: string[]): Set<string> {
  const doomed = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of doc.features) {
      if (doomed.has(f.id)) continue;
      if (dependsOn(f).some((t) => doomed.has(t))) {
        doomed.add(f.id);
        grew = true;
      }
    }
  }
  return doomed;
}

/**
 * What deleting `ids` would take with it, phrased for a student, or null when
 * nothing else is lost.
 *
 * `label` turns a feature id into the name on its timeline row, so the sentence
 * names the thing the student clicked rather than `pull1`.
 *
 * A combine that loses one of three inputs is reported as lost along with the
 * rest. That is what the delete path has always done and it is the predictable
 * reading -- "this Cut was made from those two shapes" -- even though the
 * builder would tolerate carrying on with the survivors. Changing it is a
 * product decision, not a bug fix, so it is left as it stands and written down
 * here rather than quietly altered.
 */
export function whyDeletingCosts(
  doc: ModelDoc,
  ids: string[],
  label: (id: string) => string,
): string | null {
  const doomed = orphanedBy(doc, ids);
  const asked = new Set(ids);
  // In timeline order, so the sentence reads the way the panel looks.
  const extra = doc.features.filter((f) => doomed.has(f.id) && !asked.has(f.id));
  if (extra.length === 0) return null;
  const names = extra.map((f) => label(f.id));
  const list = names.length === 1
    ? names[0]
    : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  const subject = ids.length === 1 ? label(ids[0]) : 'those';
  return names.length === 1
    ? `${list} is built from ${subject}, so it goes too.`
    : `${list} are built from ${subject}, so they go too.`;
}

/** One reference that names a feature the document does not contain. */
export interface DanglingRef {
  /** The feature holding the broken reference. */
  feature: string;
  /** The id it names, which is not in the document. */
  missing: string;
}

/**
 * Every reference in the document that names a feature that is not there.
 *
 * This should always come back empty. It is an invariant, not a diagnostic:
 * a doc that fails it generates source referring to an undeclared variable, and
 * the preview dies with a ReferenceError rather than a sentence. Held as a
 * function so the delete path, a load, and the test gate can all ask the same
 * question the same way.
 *
 * Face-level selections are covered too, now that Round and Draft carry one.
 * dependsOn() folds in every feature id a TopoName passes through (see
 * topoRefs in lib/model-types.ts), so a Round whose edge names a deleted box is
 * reported here exactly like a Pull whose sketch is gone -- and cascaded by
 * orphanedBy() for the same reason, without either function knowing what a
 * TopoName is.
 */
export function danglingRefs(doc: ModelDoc): DanglingRef[] {
  const have = new Set(doc.features.map((f) => f.id));
  const out: DanglingRef[] = [];
  for (const f of doc.features) {
    for (const t of dependsOn(f)) {
      if (!have.has(t)) out.push({ feature: f.id, missing: t });
    }
  }
  return out;
}

/**
 * The document with `ids` and everything that leans on them removed.
 *
 * The delete path's whole job, in one place, so that the panel does the asking
 * and this does the arithmetic. Feature order is preserved: the timeline is the
 * student's mental model of what happens in what order, and reshuffling it
 * during a delete would be a second, invisible edit.
 */
export function withoutFeatures(doc: ModelDoc, ids: string[]): ModelDoc {
  const doomed = orphanedBy(doc, ids);
  const features: Feature[] = doc.features.filter((f) => !doomed.has(f.id));
  return { ...doc, features };
}
