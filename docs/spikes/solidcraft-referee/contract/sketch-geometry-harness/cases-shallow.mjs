// Round 6 (critic): shallow edge bulges. The curve-size rule estimated a bulge's error with the SECTOR area of the arc, which for a nearly straight arc (radius 167, 5000 or 5e6 mm)
// is thousands of times the part's area: 20 mm square, bulge 0.03 on one edge was refused as "off by about 0.048%" while the measured error is 1.3e-5 to 6e-5, and bulge 1e-6 as
// "off by more than half its volume" while the measured error is 3.3e-7. This grid measures the truck error (against live OCCT) over chord length x bulge x pull so the estimate can be
// calibrated on the measurements and then checked against them. Ids: sh-<L>-<b>-<H>. Run it UNGUARDED (repro.sh shallow) for the raw truck error.
const bul = (b) => (d) => { const sk = d.features.find((f) => f.kind === 'sketch'); sk.bulges = b; return d; };
export const cases = [];
const Bs = [1e-6, 1e-4, 1e-3, 0.01, 0.03, 0.1, 0.3, 0.6, 0.9];
for (const L of [5, 20, 100]) for (const b of Bs) for (const sgn of [1, -1]) {
  const H = L / 2;
  const bb = sgn * b; if (sgn < 0 && b > 0.6) continue;
  cases.push({ id: `sh-${L}-${bb}-${H}`, feature: 'edge bulges', what: `${L} mm square, bulge ${bb} on edge 1, pulled ${H}`, curved: true, script: `const sk = sketch('top'); sk.polygon([[0,0],[${L},0],[${L},${L}],[0,${L}]]); pull(sk, ${H})`, edit: bul({ 0: bb }) });
}
// tall pulls make the mesh coarser (the tolerance follows the whole part): the 20 mm square with the same bulges
for (const H of [100, 400, 1000]) for (const b of [0.01, 0.03, 0.1, 0.3]) {
  cases.push({ id: `sh-20-${b}-${H}`, feature: 'edge bulges', what: `20 mm square, bulge ${b} on edge 1, pulled ${H}`, curved: true, script: `const sk = sketch('top'); sk.polygon([[0,0],[20,0],[20,20],[0,20]]); pull(sk, ${H})`, edit: bul({ 0: b }) });
}
// all four edges bulged
for (const b of [0.01, 0.05, 0.1]) cases.push({ id: `sh-4edge-${b}`, feature: 'edge bulges', what: `20 mm square, bulge ${b} on all four edges, pulled 10`, curved: true, script: `const sk = sketch('top'); sk.polygon([[0,0],[20,0],[20,20],[0,20]]); pull(sk, 10)`, edit: bul({ 0: b, 1: b, 2: b, 3: b }) });
// a minor arc segment of 60 degrees (the g-minor-arc case), via a bulge of tan(15deg)
cases.push({ id: 'sh-60deg-segment', feature: 'edge bulges', what: '60 degree segment on a 20 mm edge (bulge tan 15 deg)', curved: true, script: `const sk = sketch('top'); sk.polygon([[0,0],[20,0],[20,20],[0,20]]); pull(sk, 10)`, edit: bul({ 0: Math.tan(Math.PI / 12) }) });
