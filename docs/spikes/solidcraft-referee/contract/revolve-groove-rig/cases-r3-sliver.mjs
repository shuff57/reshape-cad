// Round-3 "graze" fuzz: grooves whose ring edge is placed 0..1 mm from a face of the part (lips) or whose round wall is placed 0..1 mm from a flat face (near-tangent), box and post, full and part turns.
// This is the class the fuzz of round 3 found to come back with wrong area / faces / volume. Deterministic: RG3_SEED (default 9), RG3_N (default 120). Ids: sl<seed>-<i>-<family>-<d>.
let seed = Number(process.env.RG3_SEED ?? 9) >>> 0;
const N = Number(process.env.RG3_N ?? 120);
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const rf = (a, b, d = 2) => +(a + rnd() * (b - a)).toFixed(d);
const tag = Number(process.env.RG3_SEED ?? 9);
const D = [0, 0.003, 0.01, 0.03, 0.07, 0.1, 0.15, 0.2, 0.3, 0.5, 1];
export const cases = [];
for (let i = 0; i < N; i++) {
  const fam = pick(['boxlip-top', 'boxlip-top', 'boxlip-side', 'boxtan-top', 'boxtan-side', 'postlip']);
  const d = pick(D); const sgn = pick([1, -1]); const ang = pick([360, 360, 360, 180, 90, 270, 45]);
  let src;
  if (fam === 'boxlip-top') {            // ring about Z (top plane), box lifted 1 (z 1..31): the ring top plane stops d short of the box top (z = 31) or its bottom plane d above z = 1
    const top = pick([true, false]); const r0 = rf(8, 24); const w = rf(2, 9); const hgt = rf(3, 12);
    const v1 = top ? 31 - d : 1 + d + hgt; const v0 = v1 - hgt;
    src = `const k = sketch('top', 1); k.rect(60, 40, { at: [0, 0] }); const b = extrude(k, 30); const s = sketch('top'); s.polygon([[${r0},${v0.toFixed(3)}],[${(r0 + w).toFixed(2)},${v0.toFixed(3)}],[${(r0 + w).toFixed(2)},${v1.toFixed(3)}],[${r0},${v1.toFixed(3)}]]); groove(s, b, ${ang});`;
  } else if (fam === 'boxlip-side') {    // ring about X (side plane), box x -30..30 lifted so the profile plane is clear of it: ring end d short of the end face x = 30
    const r0 = rf(14, 30); const w = rf(2, 8); const hgt = rf(3, 12); const v1 = 30 - d; const v0 = v1 - hgt;
    src = `const k = sketch('top', 1); k.rect(60, 40, { at: [0, 0] }); const b = extrude(k, 30); const s = sketch('side'); s.polygon([[-${r0},${v0.toFixed(3)}],[-${(r0 + w).toFixed(2)},${v0.toFixed(3)}],[-${(r0 + w).toFixed(2)},${v1.toFixed(3)}],[-${r0},${v1.toFixed(3)}]]); groove(s, b, ${ang});`;
  } else if (fam === 'boxtan-top') {     // ring about Z, round wall at the box side face x = 30 (distance 30 from the axis): outer radius 30 + sgn*d
    const r1 = 30 + sgn * d; const w = rf(3, 9); const v0 = rf(2, 14); const hgt = rf(3, 12);
    src = `const k = sketch('top', 1); k.rect(60, 40, { at: [0, 0] }); const b = extrude(k, 30); const s = sketch('top'); s.polygon([[${(r1 - w).toFixed(3)},${v0}],[${r1.toFixed(3)},${v0}],[${r1.toFixed(3)},${(v0 + hgt).toFixed(2)}],[${(r1 - w).toFixed(3)},${(v0 + hgt).toFixed(2)}]]); groove(s, b, ${ang});`;
  } else if (fam === 'boxtan-side') {    // ring about X through the origin, round wall at the top face z = 31 (distance 31): outer radius 31 + sgn*d, ring centred in x
    const r1 = 31 + sgn * d; const w = rf(3, 9); const c = rf(-12, 12);
    src = `const k = sketch('top', 1); k.rect(60, 40, { at: [0, 0] }); const b = extrude(k, 30); const s = sketch('side'); s.rect(${w}, 6, { at: [-${(r1 - w / 2).toFixed(3)}, ${c}] }); groove(s, b, ${pick([360, 360, 90])});`;
  } else {                                // post lip: ring about Z, ring top plane d short of the post top
    const r0 = rf(15, 19); const hgt = rf(3, 10);
    src = `const k = sketch('top'); k.circle(40); const p = extrude(k, 30); const s = sketch('top'); s.polygon([[${r0},${(30 - d - hgt).toFixed(3)}],[22,${(30 - d - hgt).toFixed(3)}],[22,${(30 - d).toFixed(3)}],[${r0},${(30 - d).toFixed(3)}]]); groove(s, p, 360);`;
  }
  cases.push({ id: `sl${tag}-${i}-${fam}-${sgn > 0 ? 'p' : 'm'}${d}`, src, tag: { fam, d, ang } });
}
