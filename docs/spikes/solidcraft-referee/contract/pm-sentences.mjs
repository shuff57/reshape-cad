// SPIKE, referee only. The sentence layer for the REFUSALS THE SCRIPT LAYER MAKES in the patterns-mirror group.
//
// packages/script (read-only here) refuses some repeat / repeatAround / mirror calls before any kernel is involved. Six of its texts are
// two clauses long and name the retired kernel and FreeCAD ("so brep-rs cannot yet cut through an edge and match the face count FreeCAD
// gives"). The guard layer owns what a student reads, so this function is where the text a student sees is made: pm-run.mjs calls it on every
// script-layer refusal, stores BOTH texts (`shipped` = what runScript printed, `sentence` = what the guard layer shows) and make-rows asserts
// that every sentence is one sentence, names the student's own call, and carries no engine name or internal id.
//
// plainScriptSentence(text) -> { sentence, mapped }.  mapped=false means the text was already plain and is returned unchanged.
// A text this table does not know and that is not already a single plain sentence comes back with unmapped:true (the harness reports it and
// make-rows fails on it), so a new script text cannot slip through as a two-clause sentence.

const ENGINE = /brep-rs|FreeCAD|OCCT|truck|solidcraft|SolidCraft|SolidCore|kernel|solid\.\w+|`/;
const q = (s) => String(s);

/** Is `s` one plain sentence: ends in one full stop (or none for a code-like tail), no sentence break inside, no engine words. */
export function isPlainSentence(s) {
  if (typeof s !== 'string' || !s.trim()) return false;
  if (ENGINE.test(s)) return false;
  // a sentence break inside = '. ' or '? ' or '! ' followed by anything but a lower-case continuation of an abbreviation
  const body = s.trim().replace(/\([^)]*\)/g, '(...)').replace(/"[^"]*"/g, '"..."').replace(/'[^']*'/g, "'...'").replace(/\.\.\./g, '~');
  if (/[.!?]\s+\S/.test(body)) return false;
  return true;
}

const RULES = [
  // ---- cuts that reach the edge of the part (script: "... reaches the edge of the part, so brep-rs cannot yet cut through an edge ...")
  [/^(repeat|repeatAround)\(\) of a pocket .* reaches the edge of the part, so brep-rs/s, (m) => `${m[1]}(): a copy of the pocket reaches the edge of the part, which ${m[1]}() cannot cut yet -- cut the extra pockets yourself, one sketch and pocket(...) each.`],
  [/^repeat\(\) of a hole .* reaches the edge of the part, so brep-rs/s, () => 'repeat(): a copy of the hole reaches the edge of the part, which repeat() cannot drill yet -- drill the extra holes yourself, one hole(...) each.'],
  [/^repeatAround\(\) of a hole .* reaches the edge of the part, so brep-rs/s, () => 'repeatAround(): a copy of the hole reaches the edge of the part, which repeatAround() cannot drill yet -- drill the extra holes yourself, one hole(...) each.'],
  [/^mirror\(\) of a hole .* reaches the edge of the part, so brep-rs/s, () => "mirror(): the hole's reflection reaches the edge of the part, which mirror() cannot drill yet -- drill the second hole yourself with hole(...)."],
  [/^mirror\(\) of a pocket .* reaches the edge of the part, so brep-rs/s, () => "mirror(): the pocket's reflection reaches the edge of the part, which mirror() cannot cut yet -- cut the second pocket yourself, one sketch and pocket(...)."],
  // ---- holes that overlap each other
  [/^repeat\(\) of a hole .* overlap each other, so brep-rs/s, () => 'repeat(): two copies of the hole overlap, which repeat() cannot drill yet -- drill the extra holes yourself, one hole(...) each.'],
  [/^repeatAround\(\) of a hole .* overlap each other, so brep-rs/s, () => 'repeatAround(): two copies of the hole overlap, which repeatAround() cannot drill yet -- drill the extra holes yourself, one hole(...) each.'],
  [/^mirror\(\) of a hole .* overlap each other, so brep-rs/s, () => 'mirror(): the hole and its reflection overlap, which mirror() cannot drill yet -- drill the second hole yourself with hole(...).'],
  // ---- pads (bosses joined to a plate) that overlap, touch or sit on the mirror plane
  [/^(repeat|repeatAround)\(\) of a pad .* overlap each other, so brep-rs/s, (m) => `${m[1]}(): copies of the pad overlap or touch each other, which ${m[1]}() cannot add yet -- add the extra pads yourself, one sketch and join(shape, pull(...)) each.`],
  [/^mirror\(\) of a pad .* overlap each other, so brep-rs/s, () => 'mirror(): the pad and its reflection overlap, share a face or sit on the mirror plane, which mirror() cannot add yet -- add the second pad yourself, one sketch and join(shape, pull(...)).'],
  // ---- two-sentence script texts, folded into one sentence (no engine word in them, the second sentence is the way out)
  [/^repeat\(\) of a hole drills a copy of the hole at each place, and the step moves the hole along its own drill direction \((\w)\), which would lift it off the face\. Step across the face instead\.$/, (m) => `repeat(): the step runs along the hole's own drill direction (${m[1]}), which would lift the copies off the face -- step across the face instead.`],
  [/^repeat\(\) of a hole drills a copy of the hole at each place, and a hole made by holes\(\) already drills four at once, which cannot be repeated as a unit\. Drill the extra holes yourself, one hole\(\.\.\.\) each\.$/, () => 'repeat(): holes() already drills four holes at once and cannot be repeated as a unit -- repeat a single hole(), or drill the extra holes yourself, one hole(...) each.'],
  [/^repeatAround\(\) of a hole drills a copy of the hole at each place, and the hole is drilled along (\w) but the spin is about (\w), which would tilt the drill\. Drill the extra holes yourself, one hole\(\.\.\.\) each\.$/, (m) => `repeatAround(): the hole is drilled along ${m[1]} but the spin is about ${m[2]}, which would tilt the drill -- spin about ${m[1]}, or drill the extra holes yourself, one hole(...) each.`],
  [/^repeatAround\(\) of a pocket cuts a copy of the pocket at each place, and the move would tilt or lift the sketch off its plane\. Cut the extra pockets yourself, one sketch and pocket\(\.\.\.\) each\.$/, () => "repeatAround(): the spin would tilt or lift the pocket's sketch off its plane -- spin about the axis the sketch stands square to, or cut the extra pockets yourself, one sketch and pocket(...) each."],
  [/^mirror\(\) of a (hole|pad) across 'top-bottom' reflects it through a plane parallel to the face it sits on, which would turn it to the other side of the part instead of copying it across\. Mirror it across a plane that stands square to that face\.$/, (m) => `mirror(): reflecting a ${m[1]} through a plane parallel to its face would turn it to the other side of the part instead of copying it across -- mirror across a plane that stands square to that face.`],
  [/^mirror\(\) with \{ at \} reflects a pocket, a hole or a pad across a plane at that distance, and this shape is none of those\. Leave out \{ at \} to mirror the whole shape across the plane through the origin\.$/, () => 'mirror(): { at } only works on a pocket, a hole or a pad -- leave { at } out to mirror the whole shape across the plane through the origin.'],
  [/^Repeat Around spins copies about the middle of the world, so a shape sitting in the middle has nothing to spin around \S+ every copy would land on top of the first\. Move it away from the middle first \(in a script, move\(shape, \[30, 0, 0\]\)\)\.$/, () => 'repeatAround(): a shape sitting in the middle of the world would land every copy on top of the first -- move it away from the middle first, for example move(shape, [30, 0, 0]).'],
  [/^repeat's step needs three numbers, like \[x, y, z\]\. You gave it the text "(.*)"\.$/, (m) => `repeat(): the step needs three numbers like [x, y, z], and "${m[1]}" is not that.`],
  [/^repeat has no option called "(.*)"\. It takes (.*)\.$/, (m) => `repeat(): there is no option called "${m[1]}" -- it takes ${m[2].replace(/, ([^,]+)$/, ' and $1')}.`],
  [/^repeatAround\(\)'s "axis" has to be 'x', 'y' or 'z'\. You gave it the text "(.*)"\.$/, (m) => `repeatAround(): the "axis" has to be 'x', 'y' or 'z', and "${m[1]}" is none of them.`],
  [/^mirror\(\) needs 'left-right', 'front-back' or 'top-bottom'\. You gave it the text "(.*)"\.$/, (m) => `mirror(): the direction has to be 'left-right', 'front-back' or 'top-bottom', and "${m[1]}" is none of them.`],
  [/^mirror\(\) needs 'left-right', 'front-back' or 'top-bottom'\. You gave it nothing\.$/, () => "mirror(): it needs a direction, 'left-right', 'front-back' or 'top-bottom', and none was given."],
];

export function plainScriptSentence(text) {
  const t = q(text).trim();
  for (const [re, fn] of RULES) {
    const m = re.exec(t);
    if (m) return { sentence: fn(m), mapped: true };
  }
  return isPlainSentence(t) ? { sentence: t, mapped: false } : { sentence: t, mapped: false, unmapped: true };
}
