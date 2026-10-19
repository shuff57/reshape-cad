// Round 4: round()/bevel() of the vertical edge between two adjacent pocket walls (script text: edge(wall a, wall b)). That edge is a REFLEX edge of the
// solid, so a bevel of leg d ADDS d*d/2*depth and a round of radius r ADDS (1-pi/4)*r*r*depth. Closed form: plate 40x30x10 minus 10x10x4 pocket = 11600.
import { L, T, save } from './common.mjs';
const H = (t=10, p=10, d=4, at='[20, 15]') => `const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] });
const plate = extrude(sk1, ${t});
const sk2 = sketch('top', ${t}); sk2.rect(${p}, ${p}, { at: ${at} });
const part = pocket(sk2, plate, ${d});
`;
const rows = [];
for (const fn of ['bevel', 'round']) for (const s of [0.5, 1, 2, 3]) for (const [a, b] of [[1, 2], [3, 4]]) {
  const o = await T(`${fn} edge(wall ${a}, wall ${b}) size ${s}`, H() + `${fn}(part.edge(part.wall(sk2, ${a}), part.wall(sk2, ${b})), ${s})`, { control: false });
  const add = fn === 'bevel' ? s * s / 2 * 4 : (1 - Math.PI / 4) * s * s * 4;
  const closed = 11600 + add;
  console.log(`   closed=${closed.toFixed(4)} SC=${o.truck?.volume?.toFixed?.(4)} rel=${o.truck?.volume ? (Math.abs(o.truck.volume - closed) / closed).toExponential(1) : '-'}`);
}
save('r4d-pocket-corner-bevel.json');
