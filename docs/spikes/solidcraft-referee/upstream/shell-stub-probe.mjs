// Repro for draft 04. SOLIDCRAFT_REFEREE_PKG2=<dir> node shell-stub-probe.mjs
// Only solidcraft command JSON: solid.box x2, solid.combine join, solid.shell (face picked by [x,y,z]), model.faces.
// Base 40x30x10 centred at the origin (top z=5), stub box on top, shell t=1 with the base's top open.
import { run } from './run.mjs';
const REF = { // independent references (phase4/stub-reference-results.json): P plane offset, L connected erosion
  centre: [2776, 2856], 'offset-x': [2776, 2856], corner: [2776, 2812], 'edge-flush': [2776, 2832], tall: [3300, 3364], low: [2612, 2708] };
const V = {
  centre: [[10, 10, 8], [0, 0, 9]], 'offset-x': [[10, 10, 8], [10, 0, 9]], corner: [[10, 10, 8], [15, 10, 9]],
  'edge-flush': [[10, 10, 8], [15, 0, 9]], tall: [[8, 8, 30], [-8, 5, 20]], low: [[12, 12, 2], [5, -5, 6]] };
const cmds = (sz, c, withShell = true) => [
  { command: 'solid.box', params: { length: 40, width: 30, height: 10, center: [0, 0, 0], body_name: 'b1' } },
  { command: 'solid.box', params: { length: sz[0], width: sz[1], height: sz[2], center: c, body_name: 'b2' } },
  { command: 'solid.combine', params: { target: 'b1', tools: ['b2'], operation: 'join' } },
  ...(withShell ? [{ command: 'solid.shell', params: { faces: [[-17, -12, 5]], thickness: 1, body: 'b1' } }] : []),
  { command: 'model.faces', params: { body: 'b1' } }];
const only = process.argv[2];
for (const [id, [sz, c]] of Object.entries(V)) {
  if (only && only !== id) continue;
  const r = run(cmds(sz, c));
  const bad = r.results.filter((x) => !x.ok);
  const m = { volume: r.measure.out.total.volume_mm3 };
  console.log(`${id}: size ${JSON.stringify(sz)} centre ${JSON.stringify(c)}  solidcraft volume ${m.volume}  [P ${REF[id][0]}, L ${REF[id][1]}]` + (bad.length ? '  ERR ' + JSON.stringify(bad) : ''));
}
if (!only || only === 'centre') {
  // Where does the tube end? Faces of the shelled centre case, with and without the shell.
  const faces = (w) => run(cmds(...V.centre, w)).results.at(-1).out.faces;
    const slim = (f) => f.filter((q) => /F2|inner:F1:\+z|F1:\+z/.test(q.name)).map((q) => `${q.name.padEnd(16)} area ${q.area.toFixed(3).padStart(8)}  centroid z ${q.centroid[2].toFixed(3)}  normal ${JSON.stringify(q.plane_normal)}`).join('\n');
console.log('\n-- model.faces BEFORE shell (join only), stub faces and base top:\n' + slim(faces(false)));
  console.log('\n-- model.faces AFTER shell (volume 2644.346: the stub outer walls F2:* centroid z 10.829 area 43.43 => span z 8.657..13, not 5..13):\n' + slim(faces(true)));
}
