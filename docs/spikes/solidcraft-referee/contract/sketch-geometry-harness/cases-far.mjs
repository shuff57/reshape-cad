// Round 5: curved outlines far from the origin. Same part at growing distance (in-plane `at`, and the plane offset), scored against OCCT (volume, bbox, centre of mass / diagonal)
// and a closed form. The round-4 evidence for far coordinates was a plain rectangle only (planes row); this adds the curved shapes.
const P = Math.PI;
const H = 12;
const OFFS = [0, 1e2, 1e3, 1e4, 1e5, 1e6];
const tag = (o) => (o === 0 ? '0' : Number.isInteger(Math.log10(o)) ? `1e${Math.log10(o)}` : String(o));
const shapes = [
  { key: 'rrect', feature: '.round', body: (o) => `sk.rect(30,20,{at:[${o},${o}]}); sk.round(1,4); sk.round(3,4)`, vol: (600 - 2 * 16 * (1 - P / 4)) * H },
  { key: 'circle', feature: '.circle', body: (o) => `sk.circle(30,{at:[${o},0]})`, vol: P * 225 * H },
  { key: 'slot', feature: '.slot', body: (o) => `sk.slot([${o - 10},${o}],[${o + 10},${o}],4)`, vol: (20 * 8 + P * 16) * H },
  { key: 'plate-hole', feature: 'several shapes', body: (o) => `sk.rect(30,20,{at:[${o},${o}]}); sk.circle(8,{at:[${o},${o}]})`, vol: (600 - P * 16) * H },
  { key: 'rect', feature: '.rect', body: (o) => `sk.rect(30,20,{at:[${o},${o}]})`, vol: 600 * H },
];
export const cases = [];
for (const s of shapes) for (const o of OFFS) {
  cases.push({ id: `far-${s.key}-at-${tag(o)}`, feature: s.feature, what: `${s.key} at [${o}, ${o}]`, script: `const sk = sketch('top'); ${s.body(o)}; pull(sk, ${H})`, exact: { volume: s.vol } });
}
// the plane offset instead of `at` (the sketch plane itself sits far from the origin)
for (const o of [1e3, 1e4, 1e5, 1e6]) {
  cases.push({ id: `far-rrect-plane-${tag(o)}`, feature: '.round', what: `rounded rect on sketch('top', ${o})`, script: `const sk = sketch('top', ${o}); sk.rect(30,20); sk.round(1,4); sk.round(3,4); pull(sk, ${H})`, exact: { volume: (600 - 2 * 16 * (1 - P / 4)) * H } });
  cases.push({ id: `far-circle-plane-${tag(o)}`, feature: '.circle', what: `circle on sketch('top', ${o})`, script: `const sk = sketch('top', ${o}); sk.circle(30); pull(sk, ${H})`, exact: { volume: P * 225 * H } });
}

// ---- calibration grid for the far-from-origin guard: ONE round (no cancelling), sizes s in {0.25, 1, 4} x distances ---------------------------------------------------
// COM error is scored against OCCT as (max |dCOM|) / (3D bounding diagonal of the part), the same score every other row uses (bar 3e-5 for curved).
for (const s of [0.25, 1, 4]) for (const o of [1e3, 3e3, 1e4, 3e4, 1e5, 3e5, 1e6]) {
  const area = 600 * s * s - (4 * s) * (4 * s) * (1 - P / 4);
  cases.push({ id: `far-grid-rr-s${s}-at-${tag(o)}`, feature: '.round', what: `rect(${30 * s},${20 * s}) round(1,${4 * s}) at [${o},${o}], pulled ${12 * s}`, script: `const sk = sketch('top'); sk.rect(${30 * s},${20 * s},{at:[${o},${o}]}); sk.round(1,${4 * s}); pull(sk, ${12 * s})`, exact: { volume: area * 12 * s }, grid: true });
  cases.push({ id: `far-grid-ci-s${s}-at-${tag(o)}`, feature: '.circle', what: `circle(${30 * s}) at [${o},${o}], pulled ${12 * s}`, script: `const sk = sketch('top'); sk.circle(${30 * s},{at:[${o},${o}]}); pull(sk, ${12 * s})`, exact: { volume: P * 225 * s * s * 12 * s }, grid: true });
}
