// SPIKE, referee only. PLAIN REFUSAL SENTENCES for round() / bevel(). Round 2 admitted that none of this group's refusal texts was plain: the pane shows the kernel's
// first error behind a command-list prefix ("round1 (fillet): solidcraft refused it -- solid.fillet: not supported yet: the blend is larger than the neighbouring faces",
// "box1.edge[box1.face[+z] ^ box1.face[+x]] resolves to F1:+x|F1:+z on box1, but that edge is no longer present whole on b_box1 (...); nothing is picked") and the
// interpreter's own texts are often TWO sentences ("Rounding works on a shape, not a combination. Round the shape before you cut it.").
// plainSentence(raw) maps ANY raw refusal / interpreter error of this group to ONE plain sentence of the shape
//     <what happened to which step> , so <that step> is shown without it -- <what to try>.
// and fc-sentences-check.mjs runs it over every raw text recorded in the pane runs (browser-results*.json) and fails on an unmapped or non-plain one.
// This file is the contract: the page has to show these in place of the raw texts.

const style = (id) => (/^bevel|^chamfer/.test(id) ? 'bevel' : 'round');
const noun = (id) => (style(id) === 'bevel' ? 'bevel' : 'round');
const fmt = (n) => (Number.isInteger(+n) ? String(+n) : String(+(+n).toFixed(4)));

// ---- sentences for the guard's verdicts (fc-guard.mjs codes) --------------------------------------------------------------------------
// id = the step ("round2", "bevel1"), st = 'round' | 'bevel'. Every one is a single sentence: what was asked, why not, that the step is shown without it, and what to try.
export function guardSentence(g, id, st) {
  const a = g.args ?? {};
  const fm = (x) => fmt(Math.floor(x * 100) / 100);
  switch (g.code) {
    case 'too-big': return a.face === 'cap' ? `The ${st} ${id} is almost as big as the end of the cylinder (radius ${fm(a.extent)}), so ${id} is shown without it -- use a size under ${fm(a.extent - (a.margin ?? 0.1))}.`
      : a.face === 'side' ? `The ${st} ${id} is almost as big as the cylinder is tall (${fm(a.extent)}), so ${id} is shown without it -- use a size under ${fm(a.extent - (a.margin ?? 0.1))}.`
      : `The ${st} ${id} is as big as or bigger than the face it cuts into (${fm(a.extent)} wide), so ${id} is shown without it -- use a size under ${fm(a.extent)}.`;
    case 'in-the-way': return `The ${st} ${id} would reach a hole, pocket or cut next to the edge, so ${id} is shown without it -- ${st} the edge before you cut, or use a smaller size.`;
    case 'corner': return `The ${st} ${id} meets an edge that was already rounded, so ${id} is shown without it -- ${st} edges that do not touch each other, or leave one out.`;
    case 'split': return `The edge for ${id} has been cut in two by a pocket or hole, so ${id} is shown without it -- ${st} the edge before you cut, or move the cut away from the edge.`;
    case 'too-small': return `The ${st} size of ${id} is zero, negative or smaller than 0.01, so ${id} is shown without it -- give it a size of at least 0.01.`;
    case 'whole-chamfer': return `Bevelling every edge of a box at once is not supported, so ${id} is shown without it -- bevel the edges one at a time.`;
    case 'twice': return `The ${st} ${id} names the same edge twice, so ${id} is shown without it -- name each edge once.`;
    case 'crowded': return `The ${st} ${id} is too big for the ${a.ofGroup > 2 ? 'edges rounded together' : 'two edges'} on the face between them (${fm(a.gap)} apart), so ${id} is shown without it -- use a size under ${fm(a.gap / 2)}.`;
    case 'corner3': return `The ${st}s of ${id} meet three at one corner, where other CAD programs add a small triangle that this one does not, so ${id} is shown without it -- ${st} at most two edges at a corner, or use round instead.`;
    case 'knife-rim': return `The hollow's open edge is rounded with a radius of ${fmt(a.size)}, which is at least as large as the wall (${fmt(a.wall)}), so the rim would have no thickness and ${id} is shown without it -- make the round smaller than the wall.`;
    case 'negative': return `The ${st} size of ${id} is negative, so ${id} is shown without it -- give it a size above zero.`;
    case 'no-topology': return `The part before ${id} could not be read back, so ${id} is shown without it -- try again with a simpler part.`;
    case 'face-count': return `The ${st} ${id} did not give the part the new face it should, so ${id} is shown without it -- use a smaller size.`;
    case 'no-edge': case 'unknown-edge': case 'orientation': return `The edge for ${id} could not be found on the part as it is now, so ${id} is shown without it -- name two faces that meet there, such as top and front.`;
    case 'curved-face': case 'curved-edge': return `The ${st} ${id} is on an edge next to a curved face other than the end of a cylinder, which is not supported yet, so ${id} is shown without it -- ${st} a straight edge between two flat faces instead.`;
    default: return null;
  }
}

// ---- the edge a step names was changed by an earlier step: say WHICH kind of step (ctx.causes = [{id, kind, style?, size?}] from the translator, ctx.self = {style, size}) ----
const KIND_WORD = { fillet: 'round or bevel', draft: 'draft', hole: 'hole', pocket: 'pocket', combine: 'join or cut', shell: 'hollow', move: 'move', rotate: 'turn', mirror: 'mirror', pattern: 'repeat', groove: 'groove' };
function edgeTouched(id, st, ctx) {
  const causes = (ctx.causes ?? []).filter((c) => KIND_WORD[c.kind]);
  const blends = causes.filter((c) => c.kind === 'fillet');
  const me = ctx.self ?? {};
  if (blends.length && causes.length === blends.length) {
    const other = blends[blends.length - 1];
    if (other.style === me.style && other.size === me.size) return { cls: 'edge-touched', sentence: `The ${st} ${id} touches an edge that ${other.id} already changed, and something stands between them, so ${id} is shown without it -- put touching ${st}s of the same size one straight after the other.` };
    return { cls: 'edge-touched', sentence: `The ${st} ${id} touches an edge that ${other.id} already changed with a different ${other.style !== me.style ? 'kind of blend' : 'size'}, so ${id} is shown without it -- give touching edges the same size and kind so they are blended together, or leave one out.` };
  }
  if (causes.length) {
    const words = [...new Set(causes.map((c) => KIND_WORD[c.kind]))];
    return { cls: 'edge-touched', sentence: `The edge for ${id} was already changed by an earlier ${words.length > 1 ? words.slice(0, -1).join(', ') + ' or ' + words.at(-1) : words[0]}, so ${id} is shown without it -- ${st} the edge before that step, or name an edge it left alone.` };
  }
  return { cls: 'edge-touched', sentence: `The edge for ${id} was already changed by an earlier step, so ${id} is shown without it -- ${st} the edge before that step, or name an edge it left alone.` };
}

// ---- raw text -> one plain sentence ------------------------------------------------------------------------------------------------------
const idOf = (raw) => (raw.match(/^([a-z]+\d+)\s*\(/i) ?? [])[1] ?? 'this step';
const stripPrefix = (raw) => raw.replace(/^[a-z]+\d+\s*\([a-z]+\):\s*/i, '');
const unwrapDependent = (raw) => { let r = raw; for (;;) { const m = r.match(/^[a-z]+\d+\s*\([a-z]+\):\s*its target ([a-z]+\d+) was refused \(([\s\S]*)\)\s*$/i); if (!m) return { raw: r, via: null }; const inner = m[2]; return { raw: inner, via: m[1], target: m[1] }; } };

/**
 * Returns { sentence, cls } for a raw refusal (pane text) or interpreter error text. `ctx` may carry { size, limit, shape }.
 */
export function plainSentence(rawIn, ctx = {}) {
  let raw = String(rawIn).replace(/^SCRIPT ERROR \(line \d+\):\s*/, '').trim();
  const id = idOf(raw);
  const st = style(id);
  // dependent step: the step it builds on was refused (nested to any depth)
  const dm = raw.match(/^[a-z]+\d+\s*\([a-z]+\):\s*its target ([a-z]+\d+) was refused/i);
  if (dm) return { cls: 'dependent', sentence: `${id} builds on ${dm[1]}, which is shown without its ${noun(dm[1])}, so ${id} is shown without it too -- fix ${dm[1]} first.` };
  const body = stripPrefix(raw);
  let m;
  // kernel size limits
  if (/solid\.(fillet|chamfer): not supported yet: the blend is (larger than the neighbouring faces|taller than the walls|larger than a corner radius)/.test(raw)) {
    const why = RegExp.$2;
    const what = ctx.shape ? `the ${ctx.shape}` : why === 'larger than a corner radius' ? 'the rim' : why === 'taller than the walls' ? 'the walls' : 'the faces next to the edge';
    return { cls: 'too-big', sentence: `The ${st} ${id} is too big for ${what}, so ${id} is shown without it -- use a smaller size${ctx.limit ? ` (under ${fmt(ctx.limit)})` : ''}.` };
  }
  if (/solid\.(fillet|chamfer): invalid input: (fillet|chamfer) size must be positive/.test(raw)) return { cls: 'size', sentence: `The ${st} size of ${id} is zero, negative or smaller than 0.01, so ${id} is shown without it -- give it a size of at least 0.01.` };
  if (/no edge near/.test(raw)) return { cls: 'whole-chamfer', sentence: guardSentence({ code: 'whole-chamfer' }, id, st) };
  // name resolution
  if (/but (that edge is|part of that edge is) no longer present whole on/.test(raw)) return edgeTouched(id, st, ctx);
  if (/is rotated; this demo resolves primitive faces only on unrotated/.test(raw)) return { cls: 'rotated', sentence: `The part for ${id} was turned, so its edge cannot be found reliably and ${id} is shown without it -- round or bevel the edge before you turn the part.` };
  if (/carries a whole-shape round, which changes its faces and edges/.test(raw)) return { cls: 'rounded-all-over', sentence: `The part for ${id} was already rounded all over, so its edges are not named any more and ${id} is shown without it -- round single edges or the whole shape, not both.` };
  if (/matches no face on/.test(raw)) return { cls: 'no-face', sentence: `A face named in the edge does not exist on this part (a disc pulled from a circle has only a top and a bottom), so ${id} is shown without it -- name two faces that exist, such as top and front on a box.` };
  if (/matches no edge on/.test(raw)) return { cls: 'no-edge', sentence: `Those two faces do not meet in an edge on the part as it is now, so ${id} is shown without it -- name two neighbouring faces, such as top and front.` };
  if (/a name must pick exactly one/.test(raw) || /matches \d+ (separate edges|faces)/.test(raw)) return { cls: 'ambiguous', sentence: `The edge for ${id} matches more than one place on the part, so ${id} is shown without it -- name it with two different faces that meet in a single edge.` };
  if (/a (prism|cylinder) has no [+-]?[a-z]+ face/.test(raw)) return { cls: 'no-such-face', sentence: `The edges of a ${RegExp.$1} cannot be picked yet, so ${id} is shown without it -- ${st} an edge of a box, a cylinder or a shape pulled from a sketch instead.` };
  if (/faces of a (wedge|sphere|cone|torus) are not resolved/.test(raw)) return { cls: 'unsupported-shape', sentence: `The edges of a ${RegExp.$1 === 'torus' ? 'ring' : RegExp.$1} cannot be picked yet, so ${id} is shown without it -- ${st} an edge of a box, a cylinder or a shape pulled from a sketch instead.` };
  if (/is a circle or a rows-and-rules sketch; a swept name over it/.test(raw)) return { cls: 'circle-pocket', sentence: `The edge of a circular or rule-driven pocket cannot be picked yet, so ${id} is shown without it -- use a pocket drawn with straight sides, or leave the rim sharp.` };
  if (/was already changed in place by/.test(raw)) return { cls: 'combined', sentence: `The shape for ${id} was already combined, moved or mirrored, so its edges are not named any more and ${id} is shown without it -- round or bevel before you combine, move or mirror.` };
  if (/the topology of .* is larger than/.test(raw)) return { cls: 'big-part', sentence: `The part for ${id} has too many faces to find an edge on, so ${id} is shown without it.` };
  if (/shell needs a face to remove/.test(raw)) return { cls: 'other-group', sentence: `The hollow before ${id} has no open side, so ${id} is shown without it -- hollow with an open side such as open:'top'.` };
  if (/solid\.draft/.test(raw)) return { cls: 'other-group', sentence: `The draft after ${id} cannot be built on a rounded part, so ${id} is shown without it -- draft the shape before you round its edges.` };
  // interpreter (reSHape Script) errors: always rewritten to one sentence
  if (/^Rounding a cone is not supported yet\./.test(raw)) return { cls: 'whole-other', sentence: 'A cone cannot be rounded all over yet -- round one of its edges, or use a box or cylinder.' };
  if (/^Rounding does not work on this shape\./.test(raw)) return { cls: 'whole-other', sentence: 'Rounding all over only works on a plain box or cylinder -- this shape is a prism, a wedge or already has a rounded or bevelled edge, so round its edges one at a time.' };
  if (/^Rounding works on a shape you build with a tool like Box or Cylinder, not one (pulled|spun) from a sketch/.test(raw)) return { cls: 'whole-other', sentence: `A shape ${RegExp.$1} from a sketch cannot be rounded all over -- round its sketch corners before you ${RegExp.$1 === 'pulled' ? 'pull' : 'spin'} it, or round one edge.` };
  if (/^Rounding works on a shape, not a combination/.test(raw)) return { cls: 'whole-other', sentence: 'A combined shape cannot be rounded all over -- round each shape before you join or cut it.' };
  if (/^Rounding works on the shape, not the hole cut into it/.test(raw)) return { cls: 'whole-other', sentence: 'A shape with a hole cannot be rounded all over -- round the shape before you drill the hole.' };
  if (/^Rounding works on a shape, not a hollowed-out one/.test(raw)) return { cls: 'whole-other', sentence: 'A hollowed shape cannot be rounded all over -- round its edges one at a time.' };
  if (/^Rounding the whole shape works on the original, not a moved copy/.test(raw)) return { cls: 'whole-other', sentence: 'A moved copy cannot be rounded all over -- round the shape before you move it, or round one edge.' };
  if (/^Rounding works on the original shape, not a repeated copy/.test(raw)) return { cls: 'whole-other', sentence: 'A repeated copy cannot be rounded all over -- round the shape before you repeat it.' };
  if (/^That shape has no edges to round/.test(raw)) return { cls: 'whole-other', sentence: 'A sphere has no edges to round -- use a box, cylinder or other shape with edges.' };
  if (/^(round|bevel)\(\) on a list needs a list of edges/.test(raw)) return { cls: 'arg', sentence: 'A list given to round() or bevel() has to be a list of edges that is not empty -- for example part.rim(sketch).' };
  if (/needs three numbers, like \[x, y, z\]/.test(raw)) return { cls: 'arg', sentence: 'That needs three numbers in brackets, like [10, 0, 5] -- check the commas and the number of values.' };
  if (/^turn\(\) needs a solid shape/.test(raw) || /^turn\(\) needs a shape/.test(raw)) return { cls: 'arg', sentence: 'turn() needs a solid shape and three angles, like turn(shape, [0, 0, 90]) -- a flat sketch has to be pulled into a shape first.' };
  if (/^Rounding works on the original shape, not a mirrored copy/.test(raw)) return { cls: 'whole-other', sentence: 'A mirrored copy cannot be rounded all over -- round the shape before you mirror it.' };
  if (/^Rounding the whole shape works on the original, not a copy made by Move/.test(raw)) return { cls: 'whole-other', sentence: 'A copy made by move() cannot be rounded all over -- round the original before you copy it, or round one edge.' };
  if (/^A circle has no corners to round/.test(raw)) return { cls: 'whole-other', sentence: 'A circle has no corners to round -- it is already round all the way, so use a shape with edges.' };
  if (/^Rounding works on a solid shape, not a flat sketch/.test(raw)) return { cls: 'whole-other', sentence: 'A flat sketch cannot be rounded as a shape -- round its corners in the sketch rules, or pull it into a shape first.' };
  if (/^(round|bevel)(\(\))? needs a number for size/.test(raw) || /^(round|bevel)'s size has to be a number/.test(raw)) return { cls: 'arg', sentence: 'The size has to be a number such as 2 -- text cannot be a size.' };
  if (/^round\(\) needs a shape or an edge/.test(raw)) return { cls: 'arg', sentence: 'round() needs a shape or an edge such as shape.edge(a, b) -- a sketch cannot be rounded.' };
  if (/^\.edge\(\) needs two DIFFERENT faces/.test(raw)) return { cls: 'arg', sentence: 'An edge needs two different faces to name it -- try shape.edge(\'top\', \'front\').' };
  if (/^\.(edge|face)\(\): "side" is the curved wall of a cylinder/.test(raw)) return { cls: 'arg', sentence: '"side" only names the curved wall of a cylinder made with cylinder() -- on a box use two of top, bottom, front, back, left and right, and for a disc pulled from a circle use cylinder() instead.' };
  if (/^\.edge\(\) does not know the face/.test(raw)) return { cls: 'arg', sentence: 'That is not a face name -- use top, bottom, front, back, left or right.' };
  if (/^round\(\) takes a shape or edge and a size/.test(raw)) return { cls: 'arg', sentence: 'round() takes a shape or an edge and one size, so the extra number was ignored -- pick the edge with shape.edge(faceA, faceB).' };
  if (/^bevel\(\) needs one edge: a whole shape is not supported yet/.test(raw)) return { cls: 'arg', sentence: raw };
  if (/^bevel\(\) needs one edge -- try/.test(raw) || /^round\(\) on a single reference needs an edge/.test(raw)) return { cls: 'arg', sentence: 'round() and bevel() need an edge such as shape.edge(a, b) -- a face or a number cannot be used.' };
  if (/^bevel\(\) on a list needs a list of edges/.test(raw)) return { cls: 'arg', sentence: 'A list given to bevel() has to be a list of edges -- for example part.rim(sketch).' };
  if (/^\.wall\(\) names a face a pocket cut, and no pocket/.test(raw)) return { cls: 'arg', sentence: 'That wall belongs to a pocket that was never cut from this sketch -- cut the pocket first.' };
  if (/^\.wall\(\) needs a side number/.test(raw)) return { cls: 'arg', sentence: 'That wall number does not exist -- use a number from 1 to the number of sides of the sketch.' };
  if (/^\.rim\(\) finds the opening of a pocket cut down from a top-plane sketch/.test(raw)) return { cls: 'arg', sentence: 'rim() only works on a pocket cut down from a top-plane sketch -- name its edges one at a time with edge(face, part.wall(sketch, n)).' };
  if (/^mirror\(\) needs/.test(raw)) return { cls: 'other-group', sentence: "mirror() needs 'left-right', 'front-back' or 'top-bottom' -- an object cannot be used." };
  if (/^\.(edge|face)\(\) needs a face word/.test(raw)) return { cls: 'arg', sentence: "A face is named with a word in quotes -- use top, bottom, front, back, left or right, like shape.edge('top', 'front')." };
  if (/^\.edge\(\) takes a face word/.test(raw)) return { cls: 'arg', sentence: "An edge is named with face words or pocket walls only -- use shape.edge('top', 'front') or shape.edge('top', part.wall(sketch, 1))." };
  if (/^\.wall\(\) needs the sketch the pocket was cut from/.test(raw)) return { cls: 'arg', sentence: 'wall() needs the sketch the pocket was cut from -- for example part.wall(sketch2, 1).' };
  if (/^\.rim\(\) needs the sketch the pocket was cut from/.test(raw)) return { cls: 'arg', sentence: 'rim() needs the sketch the pocket was cut from -- for example part.rim(sketch2).' };
  // an interpreter text that is already ONE plain sentence is shown as it is
  if (!/\n/.test(raw) && lintSentence(raw).length === 0) return { cls: 'verbatim', sentence: raw };
  return { cls: 'UNMAPPED', sentence: null };
}

/** The lint every contract sentence must pass: ONE sentence, no engine or command-list words, short. */
export function lintSentence(s) {
  const problems = [];
  if (typeof s !== 'string' || !s) return ['empty'];
  const ends = s.match(/[.!?](?=\s+[A-Z(])/g) ?? [];
  if (ends.length) problems.push('second sentence');
  if (!/[.?]$/.test(s)) problems.push('no full stop');
  if (/solid\.|solidcraft|resolves to|F\d+:|\bb_|bridge|topology|persistent|nothing is picked|kernel|wasm|ModelDoc|command|fillet\)|\(fillet|chamfer:|not supported yet: the blend|invalid input|; not guessing|this demo|in the browser/i.test(s)) problems.push('engine or command-list wording');
  if (s.length > 260) problems.push('too long');
  return problems;
}
