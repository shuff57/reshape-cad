// h8-round.mjs: round-number HALT-8 repros and controls with their closed form and oracle model (seed-family.mjs closedForm / modelOf conventions)
import { writeFileSync } from 'node:fs';
process.argv[2] = '1'; process.argv[3] = '/dev/null';
const { closedForm } = await import('./seed-family.mjs');
const { modelOfScript } = await import('./script2model.mjs');
const C = [
  { id: 'r-corner-csink90-w2', W: 30, D: 30, H: 12, t: 2, kind: 'csink', r: 1.5, Rm: 4, angle: 90, cx: 6, cy: 6, open: 'top' },
  { id: 'r-corner-csink90-w1', W: 20, D: 20, H: 6, t: 1, kind: 'csink', r: 1.5, Rm: 3, angle: 90, cx: 5, cy: 5, open: 'top' },
  { id: 'r-side-csink90-w2', W: 30, D: 30, H: 12, t: 2, kind: 'csink', r: 1.5, Rm: 4, angle: 90, cx: 6, cy: 0, open: 'top' },
  { id: 'r-corner-cbore-w2', W: 30, D: 30, H: 12, t: 2, kind: 'cbore', r: 1.5, Rm: 4, depth: 2, cx: 6, cy: 6, open: 'top' },
  { id: 'r-corner-csink90-w2-bottom', W: 30, D: 30, H: 12, t: 2, kind: 'csink', r: 1.5, Rm: 4, angle: 90, cx: 6, cy: 6, open: 'bottom' },
  { id: 'r-corner-csink90-w2-far', W: 30, D: 30, H: 12, t: 2, kind: 'csink', r: 1.5, Rm: 4, angle: 90, cx: 4, cy: 4, open: 'top' },
];
const out = C.map((c) => {
  const rec = c.kind === 'cbore' ? `counterbore: { across: ${2 * c.Rm}, deep: ${c.depth} }` : `countersink: { across: ${2 * c.Rm}, angle: ${c.angle} }`;
  const script = `const b = box(${c.W}, ${c.D}, ${c.H});\nhole(b, { across: ${2 * c.r}, at: [${c.cx}, ${c.cy}], ${rec} });\nhollow(b, { wall: ${c.t}, open: '${c.open}' });`;
  return { ...c, script, model: modelOfScript(script), frame: 'centred', closed: closedForm(c) };
});
writeFileSync('h8-round.json', JSON.stringify(out, null, 1));
for (const c of out) console.log(c.id, c.closed.P.toFixed(3), 'mouth gap / wall', (c.W / 2 - Math.abs(c.cx) - c.Rm) / c.t, (c.D / 2 - Math.abs(c.cy) - c.Rm) / c.t);
