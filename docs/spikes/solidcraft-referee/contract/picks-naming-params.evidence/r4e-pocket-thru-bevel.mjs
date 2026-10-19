// Round 4: bevel/round of edge(wall a, wall b) when the pocket goes the FULL thickness of the plate (depth = thickness), the script-text analogue of the
// critic's reflex-vertex full-height chamfer. Closed form: plate 40x30x10 minus 10x10x10 = 11000; bevel adds d*d/2*10; round adds (1-pi/4)r^2*10.
import { L, T, save } from './common.mjs';
const H = (t, p, d) => `const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] });\nconst plate = extrude(sk1, ${t});\nconst sk2 = sketch('top', ${t}); sk2.rect(${p}, ${p}, { at: [20, 15] });\nconst part = pocket(sk2, plate, ${d});\n`;
for (const [t, d] of [[10, 10], [10, 9.5], [10, 12]]) for (const fn of ['bevel', 'round']) for (const s of [1, 2]) {
  const depth = Math.min(t, d); const vol = 40 * 30 * t - 100 * depth;
  const o = await T(`thick ${t} depth ${d}: ${fn} edge(wall1, wall2) ${s}`, H(t, 10, d) + `${fn}(part.edge(part.wall(sk2, 1), part.wall(sk2, 2)), ${s})`, { control: false });
  const closed = vol + (fn === 'bevel' ? s * s / 2 * depth : (1 - Math.PI / 4) * s * s * depth);
  console.log(`   closed=${closed.toFixed(4)} SC=${o.truck?.volume?.toFixed?.(4)} faces=${o.truck?.faces} rel=${o.truck?.volume ? (Math.abs(o.truck.volume - closed) / closed).toExponential(1) : '-'}`);
}
save('r4e-pocket-thru-bevel.json');
