#!/usr/bin/env node
// SPIKE, referee only (booleans group, round 3). Raw SolidCraft, no translator: how does solid.combine name and keep the PIECES of a split result,
// and what does it do when a per-piece cut / intersect meets a piece that the tool does not touch?
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/booleans-r3/probe-pieces.mjs
import { runRaw } from '../bool-raw.mjs';
const box = (n, l, w, h, c) => ({ command: 'solid.box', params: { length: l, width: w, height: h, center: c, body_name: n } });
const comb = (target, tools, operation, extra = {}) => ({ command: 'solid.combine', params: { target, tools, operation, ...extra } });
const show = (t, r) => console.log(t.padEnd(46), JSON.stringify(r.ok ? { ms: r.ms, bodies: r.bodies.map((b) => [b.name, +b.volume.toFixed(3), b.faces, b.kernel.shells]) } : r).slice(0, 400));
// plate 60x20x10 at origin, slot tool 10 wide through it => two pieces of 25x20x10 = 5000 each
const plate = box('A', 60, 20, 10, [0, 0, 0]); const slot = box('S', 10, 40, 20, [0, 0, 0]);
show('cut -> pieces', runRaw([plate, slot, comb('A', ['S'], 'cut')]));
// tool lying over the right piece only: x in [10,20]
const small = box('T', 10, 10, 30, [15, 0, 0]);
show('per-piece cut: piece A (1) untouched', runRaw([plate, slot, small, comb('A', ['S'], 'cut'), comb('A (1)', ['T'], 'cut', { keep_tools: true }), comb('A', ['T'], 'cut')]));
show('per-piece cut, T only touches A (1)', runRaw([plate, slot, small, comb('A', ['S'], 'cut'), comb('A', ['T'], 'cut', { keep_tools: true })]));
show('cut piece A (1) with T (consumed)', runRaw([plate, slot, small, comb('A', ['S'], 'cut'), comb('A (1)', ['T'], 'cut')]));
// intersect a piece that the tool misses: empty result
const big = box('B', 8, 40, 40, [-20, 0, 0]);
show('intersect piece with a tool that misses it', runRaw([plate, slot, big, comb('A', ['S'], 'cut'), comb('A (1)', ['B'], 'intersect', { keep_tools: true })]));
show('intersect target with a tool that misses it', runRaw([plate, big, box('M', 5, 5, 5, [100, 100, 100]), comb('A', ['M'], 'intersect')]));
// join with a multi-piece operand: join(pieces..., X)
const bridge = box('X', 20, 5, 5, [0, 0, 3]);
show('join pieces + bridge', runRaw([plate, slot, bridge, comb('A', ['S'], 'cut'), comb('A', ['A (1)', 'X'], 'join')]));
// cut with multi-piece TOOL: B - (pieces)
const wide = box('W', 100, 40, 20, [0, 0, 0]);
show('cut W by pieces (tool = 2 pieces)', runRaw([plate, slot, wide, comb('A', ['S'], 'cut'), comb('W', ['A', 'A (1)'], 'cut')]));
show('keep W with pieces (tool = 2 pieces)', runRaw([plate, slot, wide, comb('A', ['S'], 'cut'), comb('W', ['A', 'A (1)'], 'intersect')]));
// naming collisions: split a piece again while "A (1)" already exists
const slot2 = box('S2', 6, 40, 20, [17, 0, 0]);
show('re-split A while A (1) exists', runRaw([plate, slot, slot2, comb('A', ['S'], 'cut'), comb('A', ['S2'], 'cut')]));
show('re-split A (1) while A exists', runRaw([plate, slot, box('S3', 6, 40, 20, [-17, 0, 0]), comb('A', ['S'], 'cut'), comb('A (1)', ['S3'], 'cut')]));
