// Round 2: hand the ENGINE the top edge of a prism's unique flat side and compare with live OCCT (same pick, by geometry).
import * as L from './lib.mjs';
for (const [n, word, dir] of [[6, 'front', [0, -1, 0]], [6, 'back', [0, 1, 0]], [3, 'left', [-1, 0, 0]], [5, 'left', [-1, 0, 0]], [10, 'front', [0, -1, 0]]]) {
  const f = L.fromScript(`const p=prism(${n},30,20)\nround(p.edge('top','${word}'),2)`);
  const ref = L.references(f.doc);
  // SolidCraft: build the prism alone, find the straight top edge whose midpoint is the extreme along dir
  const pr = f.doc.features.find((x) => x.kind === 'prism');
  const row0 = await L.scored({ version: 1, features: [pr] });
  const topo = await L.topologyOf(row0.commands); const body = topo.topology.bodies[0];
  const topEdges = body.edges.filter((e) => Math.abs(e.mid[2] - 10) < 1e-6 && Math.abs(e.start[2] - 10) < 1e-6 && Math.abs(e.end[2] - 10) < 1e-6);
  const score = (e) => e.mid[0] * dir[0] + e.mid[1] * dir[1];
  const best = Math.max(...topEdges.map(score)); const cands = topEdges.filter((e) => Math.abs(score(e) - best) < 1e-6);
  const cmds = [...row0.commands, { command: 'solid.fillet', params: { edges: [cands[0].mid], radius: 2, body: row0.commands[0].params.body_name } }];
  const m = L.runSC(cmds);
  const sc = m.ok ? m.measure.bodies.at(-1).volume_mm3 : JSON.stringify(m.failed).slice(0, 120);
  // OCCT with the same geometric pick: OCCT's own word resolution for the same name
  console.log(`prism(${n}) ${word}: candidate edges at the extreme ${cands.length}; engine round r=2 =`, sc, '| OCCT (word)', ref.occt?.volume ?? ref.occt?.refused, '| rel', typeof sc === 'number' && ref.occt?.volume ? ((sc - ref.occt.volume) / ref.occt.volume).toExponential(2) : '-', '| faces', m.ok ? m.measure.bodies.at(-1).faces : '');
}
