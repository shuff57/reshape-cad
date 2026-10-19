// Round 6 (critic): the far-from-origin check was calibrated on NAMED planes only. On a TILTED frame the part sits far from the origin in all three world coordinates, not just in the
// sketch plane: a circle on a tilted frame with origin [1e4,2e4,3e4] and a part about 20 mm across had a centre-of-mass drift of 2.7e-4 of the diagonal (bar 3e-5), and a plain rectangle on the
// same frame 3.6e-5 (planar bar 1e-6), with volume and bounding box exact. This grid puts three shapes on a tilted frame and on an axis-aligned custom frame at growing distance D from the origin
// (origin = D x unit(1,2,3)), scored against live OCCT (volume, bbox, centre of mass / diagonal).
const P = Math.PI;
const H = 12;
const TILT = '{ origin: [OX, OY, OZ], u: [0.6, 0.8, 0], v: [-0.48, 0.36, 0.8] }'; // exact decimals: unit and square to 1e-16
const AXIS = '{ origin: [OX, OY, OZ], u: [1, 0, 0], v: [0, 1, 0] }';
const k = Math.hypot(1, 2, 3);
const DS = [1e2, 3e2, 1e3, 3e3, 1e4, 3e4, 1e5];
const tag = (o) => (Number.isInteger(Math.log10(o)) ? `1e${Math.log10(o)}` : `${o / 10 ** Math.floor(Math.log10(o))}e${Math.floor(Math.log10(o))}`);
const shapes = [
  { key: 'rect', body: 'sk.rect(30,20)', vol: 600 * H, curved: false },
  { key: 'circle', body: 'sk.circle(30)', vol: P * 225 * H, curved: true },
  { key: 'rrect', body: 'sk.rect(30,20); sk.round(1,4); sk.round(3,4)', vol: (600 - 2 * 16 * (1 - P / 4)) * H, curved: true },
];
export const cases = [];
for (const [fk, FR] of [['tilt', TILT], ['axis', AXIS]]) for (const s of shapes) for (const D of DS) {
  const o = [D * 1 / k, D * 2 / k, D * 3 / k].map((v) => Number(v.toPrecision(12)));
  const fr = FR.replace('OX', o[0]).replace('OY', o[1]).replace('OZ', o[2]);
  cases.push({ id: `ft-${fk}-${s.key}-${tag(D)}`, feature: 'far from the origin', what: `${s.key} (30 x 20 class) pulled ${H} on the ${fk} frame at distance ${D} from the origin`, curved: s.curved, script: `const sk = sketch(${fr}); ${s.body}; pull(sk, ${H})`, exact: { volume: s.vol } });
}
// the same distances on a NAMED plane with non-round coordinates (the earlier far cases used integers like 1e6, which are exact in floating point): where is the limit for a plain rectangle?
for (const s of shapes) for (const D of [1e3, 1e4, 3e4, 1e5, 1e6]) {
  const x = Number((D * 0.26726124191242).toPrecision(12)); const y = Number((D * 0.53452248382485).toPrecision(12)); const z = Number((D * 0.80178372573727).toPrecision(12));
  const body = s.key === 'rect' ? `sk.rect(30,20,{at:[${x},${y}]})` : s.key === 'circle' ? `sk.circle(30,{at:[${x},${y}]})` : `sk.rect(30,20,{at:[${x},${y}]}); sk.round(1,4); sk.round(3,4)`;
  cases.push({ id: `ft-named-${s.key}-${tag(D)}`, feature: 'far from the origin', what: `${s.key} on sketch('top', ${z}) at [${x}, ${y}] pulled ${H} (non-round coordinates)`, curved: s.curved, script: `const sk = sketch('top', ${z}); ${body}; pull(sk, ${H})`, exact: { volume: s.vol } });
}
