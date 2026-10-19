// SPIKE, referee only (booleans group, round 3). The ONE function the page's combine step needs to be right for results that fall into several pieces and for keep() of
// three or more shapes. Pure: the caller hands it `runSC(commands) -> parsed sc.run result`, so it is exercised both through the generated translator and alone.
//
// Facts it rests on (probe-pieces.mjs / probe-nary-intersect.mjs, raw SolidCraft, no translator; output committed next to them):
//   1. when a cut / intersect leaves SEVERAL separate solids, solidcraft keeps the first under the target's name and names the others "<name> (1)", "<name> (2)", ...
//      (a name that already exists is never reused: re-splitting "A" while "A (1)" exists gives "A (2)"), so the new pieces are found by DIFFING the body list.
//   2. an n-ary solid.combine intersect is target & (union of the tools), NOT the intersection of all of them (A,P,Q slabs: 24000 against the closed form 8000), so
//      keep(a, b, c) is one intersect per tool operand, in order.
//   3. a cut or an intersect of a piece that the tool does not touch is ok:true (a cut changes nothing; an intersect makes the piece vanish), so a handle that is
//      several pieces is combined PIECE BY PIECE, the tool kept alive (keep_tools) until the last piece.
//   4. a tool that is several pieces is fine as it stands: cut = minus the union, intersect = with the union (probe rows 'tool = 2 pieces').
// Returns {cmds, produces, res} or {err}. `produces` is every piece of the result (the handle of the combine feature); an empty list is reported as the same
// "no body named ..." text the pristine translator used, which plainSentence() already maps (keep -> nothing in common, cut -> nothing left).
export function execCombine(plan, accepted, runSC, live0) {
  const { op, groups, keep } = plan.r3;            // groups[i] = body names of operand i (several when an earlier combine left pieces); keep[i] = operand i must survive this combine
  const cmds = []; let live = new Set(live0); let res = null;
  const run = (cmd) => {
    let r; try { r = runSC([...accepted, ...cmds, cmd]); } catch (e) { r = { ok: false, failed: { error: `WASM TRAP: ${e.message}` } }; }
    if (!r.ok) return { err: r.failed ? `${r.failed.command}: ${r.failed.error}` : String(r.error ?? 'unknown') };
    cmds.push(cmd); res = r;
    return { names: new Set(r.measure.bodies.map((b) => b.name)) };
  };
  // one solid.combine of `piece` with `tools`; returns the pieces that came out of it (the piece itself if it survived, plus every NEW body name)
  const step = (piece, tools, keepTools) => {
    const before = live;
    const r = run({ command: 'solid.combine', params: { target: piece, tools, operation: op === 'union' ? 'join' : op === 'subtract' ? 'cut' : 'intersect', ...(keepTools ? { keep_tools: true } : {}) } });
    if (r.err) return r;
    live = r.names;
    const out = [];
    if (r.names.has(piece)) out.push(piece);
    for (const n of r.names) if (!before.has(n)) out.push(n);
    return { pieces: out };
  };
  const toolGroups = groups.slice(1);
  let pieces = groups[0].slice();
  if (op === 'union') {
    // join: everything is fused into the first piece; a kept operand is fused one operand at a time so keep_tools can be set on it
    const anyKeep = keep.some(Boolean);
    const extra = pieces.slice(1);                  // the other pieces of the first operand are fused in as tools too
    if (!anyKeep) {
      const r = step(pieces[0], [...extra, ...toolGroups.flat()], false);
      if (r.err) return r;
      pieces = r.pieces;
    } else {
      let cur = pieces[0];
      if (extra.length) { const r = step(cur, extra, false); if (r.err) return r; cur = r.pieces[0] ?? cur; }
      for (let j = 0; j < toolGroups.length; j++) { const r = step(cur, toolGroups[j], !!keep[j + 1]); if (r.err) return r; cur = r.pieces[0] ?? cur; }
      pieces = [cur];
    }
  } else {
    // cut: when no operand is kept, all tools go into ONE combine per piece (the shape the round-2 measurements used); intersect (and a cut with a kept tool) goes one tool operand at a time
    const oneShot = op === 'subtract' && !keep.some(Boolean);
    const rounds = oneShot ? [{ tools: toolGroups.flat(), keepTools: false }] : toolGroups.map((g, j) => ({ tools: g, keepTools: !!keep[j + 1] }));
    for (const rd of rounds) {
      const next = [];
      for (let i = 0; i < pieces.length; i++) {
        const r = step(pieces[i], rd.tools, rd.keepTools || i < pieces.length - 1);
        if (r.err) return r;
        next.push(...r.pieces);
      }
      pieces = next;
      if (!pieces.length) break;
    }
  }
  if (!pieces.length) return { err: `solidcraft ran the commands but no body named ${groups[0].join(', ')} came back` };
  return { cmds, produces: pieces, res };
}
