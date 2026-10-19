// Round-3 cases for the patterns-mirror contract (critic findings). Same shape as pm-cases.mjs: { id, row, src, note? }.
// Run: bun pm-run.mjs --r3 --only=r3-... ; heavy ones (cone/spin/sphere patterns) are killed by the 30 s time limit and REFUSE with a sentence.
const B = (at = [0, 0, 0], s = [10, 10, 10]) => `box(${s.join(',')}, { at: [${at.join(',')}] })`;
const WF = `const s = sketch('front'); s.polygon([[10,0],[20,0],[20,10],[10,10]]); const r = spin(s, 360);`; // washer, axis = y (spin lays the outline in (u, n))
const WT = `const s = sketch('top'); s.polygon([[10,0],[20,0],[20,10],[10,10]]); const r = spin(s, 360);`; // washer, axis = z
const VF = `const s = sketch('front'); s.polygon([[0,0],[20,0],[15,30],[0,30]]); const r = spin(s, 360);`; // vase (flat ends, sloped side), axis = y
const VT = `const s = sketch('top'); s.polygon([[0,0],[20,0],[15,30],[0,30]]); const r = spin(s, 360);`; // axis = z
const plateS = (w, d, h) => `const s1 = sketch('top'); s1.polygon([[0,0],[${w},0],[${w},${d}],[0,${d}]]); const plate = extrude(s1, ${h});`;
const boss = (w, d, h, shape, step, count, at = [10, 15]) => `${plateS(w, d, h)} const s2 = sketch('top', ${h}); s2.${shape}; const b = extrude(s2, 6); const bl = repeat(b, { count: ${count}, step: ${step} }); join(plate, bl);`;
export const CASES3 = [
  // ---- A. overlapping copies of cones and spun solids: truck's join fails and the OLD translator returned N separate bodies, volumes summed ----
  { id: 'r3-cone2-step3', row: 'rep-overlap-curved', src: `const c = cone(10, 20, { at: [0,0,0] }); repeat(c, { count: 2, step: [3,0,0] });`, note: 'critic repro 1' },
  { id: 'r3-cone3-step6', row: 'rep-overlap-curved', src: `const c = cone(10, 20, { at: [0,0,0] }); repeat(c, { count: 3, step: [6,0,0] });`, note: 'critic repro 2' },
  { id: 'r3-cone-ra-overlap', row: 'rep-overlap-curved', src: `const c = cone(10, 20, { at: [4,0,0] }); repeatAround(c, { count: 3 });`, note: 'critic repro 3' },
  { id: 'r3-washer2-y6', row: 'rep-overlap-curved', src: `${WF} repeat(r, { count: 2, step: [0,6,0] });`, note: 'critic repro 4: washers stacked along their axis, overlapping' },
  { id: 'r3-washer3-z6', row: 'rep-overlap-curved', src: `${WF} repeat(r, { count: 3, step: [0,0,6] });`, note: 'critic repro 5: sideways, overlapping' },
  { id: 'r3-cone2-step8', row: 'rep-overlap-curved', src: `const c = cone(10, 20, { at: [0,0,0] }); repeat(c, { count: 2, step: [8,0,0] });`, note: 'join succeeds' },
  { id: 'r3-cone2-step6', row: 'rep-overlap-curved', src: `const c = cone(10, 20, { at: [0,0,0] }); repeat(c, { count: 2, step: [6,0,0] });`, note: 'join succeeds' },
  { id: 'r3-cone2-y6', row: 'rep-overlap-curved', src: `const c = cone(10, 20, { at: [0,0,0] }); repeat(c, { count: 2, step: [0,6,0] });` },
  { id: 'r3-cone2-z12', row: 'rep-overlap-curved', src: `const c = cone(10, 20, { at: [0,0,0] }); repeat(c, { count: 2, step: [0,0,12] });`, note: 'cone stacked on cone, overlapping by 8' },
  { id: 'r3-cone2-disjoint', row: 'rep-disjoint-curved', src: `const c = cone(10, 20, { at: [0,0,0] }); repeat(c, { count: 3, step: [30,0,0] });`, note: 'copies provably apart: the unjoined fallback is correct' },
  { id: 'r3-cone2-gap-small', row: 'rep-disjoint-curved', src: `const c = cone(10, 20, { at: [0,0,0] }); repeat(c, { count: 2, step: [10.01,0,0] });`, note: 'cone bases 0.01 apart (bbox gap 1e-2 > 1e-3)' },
  { id: 'r3-vase2-x10', row: 'rep-overlap-curved', src: `${VF} repeat(r, { count: 2, step: [10,0,0] });` },
  { id: 'r3-vase2-y10', row: 'rep-overlap-curved', src: `${VF} repeat(r, { count: 2, step: [0,10,0] });`, note: 'along the axis, overlapping' },
  { id: 'r3-vase2-disjoint', row: 'rep-disjoint-curved', src: `${VF} repeat(r, { count: 3, step: [0,0,60] });` },
  { id: 'r3-spin-ra-overlap', row: 'rep-overlap-curved', src: `${WF} move(r, [18,0,0]); repeatAround(r, { count: 3 });` },
  { id: 'r3-washer2-z3', row: 'rep-overlap-curved', src: `${WF} repeat(r, { count: 2, step: [0,0,3] });`, note: 'join succeeds' },
  { id: 'r3-washer-y10-touch', row: 'rep-overlap-curved', src: `${WF} repeat(r, { count: 3, step: [0,10,0] });`, note: 'washers stacked flat on flat (face contact): the true volume is 3 x 9424.78 = 28274.33' },
  { id: 'r3-washer-disjoint', row: 'rep-disjoint-curved', src: `${WF} repeat(r, { count: 2, step: [0,0,50] });` },
  { id: 'r3-washerT-ra-overlap', row: 'rep-overlap-curved', src: `${WT} move(r, [30,0,0]); repeatAround(r, { count: 4 });` },
  { id: 'r3-cyl-hole-overlap', row: 'rep-overlap-curved', src: `const c = cylinder(20, 10, { at: [0,0,0] }); const h = cylinder(6, 20, { at: [0,0,0] }); const p = cut(c, h); repeat(p, { count: 2, step: [12,0,0] });`, note: 'curved non-cone overlap: join succeeds' },
  // ---- B. time ----
  { id: 'r3-sph2-step8', row: 'time', src: `const a = sphere(10, { at: [0,0,0] }); repeat(a, { count: 2, step: [8,0,0] });` },
  { id: 'r3-sph2-step7.5', row: 'time', src: `const a = sphere(10, { at: [0,0,0] }); repeat(a, { count: 2, step: [7.5,0,0] });` },
  { id: 'r3-sph2-step7', row: 'time', src: `const a = sphere(10, { at: [0,0,0] }); repeat(a, { count: 2, step: [7,0,0] });`, note: 'the cliff: 174 s in one bare session' },
  { id: 'r3-sph2-step6', row: 'time', src: `const a = sphere(10, { at: [0,0,0] }); repeat(a, { count: 2, step: [6,0,0] });` },
  { id: 'r3-sph3-step8', row: 'time', src: `const a = sphere(10, { at: [0,0,0] }); repeat(a, { count: 3, step: [8,0,0] });` },
  { id: 'r3-sph2-disjoint', row: 'time', src: `const a = sphere(10, { at: [0,0,0] }); repeat(a, { count: 2, step: [12,0,0] });` },
  { id: 'r3-ring3-far', row: 'time', src: `const t = ring(30, 6); repeat(t, { count: 3, step: [100,0,0] });`, note: 'three rings, clear of each other' },
  { id: 'r3-box-count-200', row: 'count', src: `const b = box(4,4,4,{at:[0,0,0]}); repeat(b, { count: 200, step: [3,0,0] });` },
  { id: 'r3-box-count-1000', row: 'count', src: `const b = box(4,4,4,{at:[0,0,0]}); repeat(b, { count: 1000, step: [3,0,0] });` },
  { id: 'r3-box-count-1001', row: 'count', src: `const b = box(4,4,4,{at:[0,0,0]}); repeat(b, { count: 1001, step: [3,0,0] });` },
  { id: 'r3-box-count-1e5', row: 'count', src: `const b = box(4,4,4,{at:[0,0,0]}); repeat(b, { count: 100000, step: [3,0,0] });` },
  { id: 'r3-around-count-1001', row: 'count', src: `const b = box(4,4,4,{at:[30,0,0]}); repeatAround(b, { count: 1001 });` },
  { id: 'r3-around-count-360', row: 'count', src: `const b = box(1,1,1,{at:[30,0,0]}); repeatAround(b, { count: 360 });`, note: 'ring of 360 boxes, neighbours 0.5 apart' },
  // ---- B2. pocket / hole pattern counts (the script lowers count N to N-1 more sketch+pocket pairs, so the translator sees 2N features) ----
  ...[10, 20, 40, 60].map((n) => ({ id: `r3-pocket-count-${n}`, row: 'count-pocket', src: `${plateS(n * 3 + 10, 30, 10)} const s = sketch('top', 10); s.circle(2, { at: [5, 15] }); const p = pocket(s, plate, 4); repeat(p, { count: ${n}, step: 3 });`, note: `${n} pockets d2 step 3 (overlapping slot)` })),
  ...[20, 60].map((n) => ({ id: `r3-hole-count-${n}`, row: 'count-pocket', src: `const plate = box(${n * 10 + 20},30,10,{at:[${(n * 10 + 20) / 2},15,5]}); const h = hole(plate, { across: 4, at: [-${(n * 10) / 2},0] }); repeat(h, { count: ${n}, step: [10,0,0] });`, note: `${n} disjoint holes` })),
  // ---- C. sub-micron steps on a 10 box, count 3 ----
  ...[1e-2, 1e-3, 1e-4, 1e-5, 3e-6, 1e-6, 1e-7, 1e-8, 1e-9, 0, -1e-9, -1e-8, -1e-7, -1e-6, -3e-6, -1e-5, -1e-4, -1e-3].map((d) => ({ id: `r3-sub-${d}`, row: 'subgap', src: `const b = ${B()}; repeat(b, { count: 3, step: [${10 + d},0,0] });`, note: `step 10${d >= 0 ? '+' : ''}${d}` })),
  // ---- D. tangent curved copies (repeat) ----
  { id: 'r3-cyl-tangent-x2', row: 'tangent', src: `const a = cylinder(10, 20, { at: [0,0,0] }); repeat(a, { count: 2, step: [10,0,0] });` },
  { id: 'r3-cyl-tangent-x3', row: 'tangent', src: `const a = cylinder(10, 20, { at: [0,0,0] }); repeat(a, { count: 3, step: [10,0,0] });` },
  { id: 'r3-cyl-tangent-diag', row: 'tangent', src: `const a = cylinder(10, 20, { at: [0,0,0] }); repeat(a, { count: 2, step: [6,8,0] });` },
  { id: 'r3-sphere-tangent', row: 'tangent', src: `const a = sphere(10, { at: [0,0,0] }); repeat(a, { count: 2, step: [10,0,0] });`, note: 'point contact' },
  { id: 'r3-cyl-tangent-mirror', row: 'tangent', src: `const a = cylinder(10, 20, { at: [20,0,0] }); mirror(a, 'left-right');` },
  // ---- E. mirror of spun parts, tapered, lofted, drafted, turned ----
  { id: 'r3-mir-washerT-tb', row: 'mirror-spin', src: `${WT} mirror(r, 'top-bottom');`, note: 'axis z: flat annulus ends face the mirror' },
  { id: 'r3-mir-washerT-lr', row: 'mirror-spin', src: `${WT} mirror(r, 'left-right');`, note: 'axis z: the curved side faces the mirror' },
  { id: 'r3-mir-washerT-tb-moved', row: 'mirror-spin', src: `${WT} move(r, [0,0,30]); mirror(r, 'top-bottom');` },
  { id: 'r3-mir-washerF-fb', row: 'mirror-spin', src: `${WF} mirror(r, 'front-back');`, note: 'axis y: flat ends face front-back' },
  { id: 'r3-mir-washerF-fb-moved', row: 'mirror-spin', src: `${WF} move(r, [0,30,0]); mirror(r, 'front-back');` },
  { id: 'r3-mir-washerF-tb', row: 'mirror-spin', src: `${WF} mirror(r, 'top-bottom');`, note: 'critic case x-spin-washer-tb: axis y, curved side faces top-bottom' },
  { id: 'r3-mir-washerF-tb-moved', row: 'mirror-spin', src: `${WF} move(r, [0,0,30]); mirror(r, 'top-bottom');`, note: 'critic case x-spin-washer-moved-tb' },
  { id: 'r3-mir-vaseF-tb', row: 'mirror-spin', src: `${VF} mirror(r, 'top-bottom');`, note: 'critic case x-spin-vase-tb' },
  { id: 'r3-mir-vaseF-fb', row: 'mirror-spin', src: `${VF} mirror(r, 'front-back');` },
  { id: 'r3-mir-vaseT-tb', row: 'mirror-spin', src: `${VT} mirror(r, 'top-bottom');` },
  { id: 'r3-mir-spin-offset-lr', row: 'mirror-spin', src: `${WF} move(r, [60,0,0]); mirror(r, 'left-right');`, note: 'critic case x-spin-offset-lr' },
  { id: 'r3-mir-taper-tb', row: 'mirror-taper', src: `const s = sketch('top'); s.polygon([[0,0],[20,0],[20,20],[0,20]]); const b = pull(s, 15, { taper: 5 }); move(b, [0,0,10]); mirror(b, 'top-bottom');`, note: 'critic case x-taper-tb' },
  { id: 'r3-mir-taper-lr', row: 'mirror-taper', src: `const s = sketch('top'); s.polygon([[20,0],[40,0],[40,20],[20,20]]); const b = pull(s, 15, { taper: 5 }); mirror(b, 'left-right');`, note: 'critic case x-taper-lr' },
  { id: 'r3-mir-taper-neg-tb', row: 'mirror-taper', src: `const s = sketch('top'); s.polygon([[0,0],[20,0],[20,20],[0,20]]); const b = pull(s, 15, { taper: -5 }); move(b, [0,0,10]); mirror(b, 'top-bottom');` },
  { id: 'r3-taper-alone', row: 'mirror-taper', src: `const s = sketch('top'); s.polygon([[0,0],[20,0],[20,20],[0,20]]); const b = pull(s, 15, { taper: 5 });` },
  { id: 'r3-mir-loft-tb', row: 'mirror-loft', src: `const a = sketch('top', 5); a.rect(40, 40); const b = sketch('top', 35); b.rect(20, 20); const l = loft(a, b, 30); mirror(l, 'top-bottom');` },
  { id: 'r3-mir-loft-lr', row: 'mirror-loft', src: `const a = sketch('top', 5); a.rect(40, 40, { at: [30, 0] }); const b = sketch('top', 35); b.rect(20, 20, { at: [30, 0] }); const l = loft(a, b, 30); mirror(l, 'left-right');` },
  { id: 'r3-mir-draft-tb', row: 'mirror-draft', src: `const a = box(20,20,20,{at:[0,0,10]}); draft(a.face('right'), 5); mirror(a, 'top-bottom');`, note: 'a face draft (needs a face pick)' },
  { id: 'r3-mir-draft-lr', row: 'mirror-draft', src: `const a = box(20,20,20,{at:[30,0,10]}); draft(a.face('top'), 5); mirror(a, 'left-right');` },
  { id: 'r3-mir-turned45-lr', row: 'mirror-turned', src: `const a = box(10,10,10,{at:[20,0,0]}); turn(a, [0,0,45]); mirror(a, 'left-right');`, note: 'box turned 45 about z: the nearest side is an edge' },
  { id: 'r3-mir-turned45-tb', row: 'mirror-turned', src: `const a = box(10,10,10,{at:[0,0,20]}); turn(a, [0,0,45]); mirror(a, 'top-bottom');`, note: 'flat top: builds' },
  { id: 'r3-mir-x45-tb', row: 'mirror-turned', src: `const a = box(10,10,10,{at:[0,0,20]}); turn(a, [45,0,0]); mirror(a, 'top-bottom');`, note: 'critic: turned about x, edge at the plane' },
  { id: 'r3-mir-turned90-lr', row: 'mirror-turned', src: `const a = box(10,6,10,{at:[20,0,0]}); turn(a, [0,0,90]); mirror(a, 'left-right');`, note: 'quarter turn: still a flat face' },
  // advice checks for the new mirror sentence: do the suggested fixes build?
  { id: 'r3-adv-cyl-lr', row: 'mirror-advice', src: `const a = cylinder(10, 20, { at: [20,0,0] }); mirror(a, 'left-right');`, note: 'refused (curved side)' },
  { id: 'r3-adv-cyl-turned-lr', row: 'mirror-advice', src: `const a = cylinder(10, 20, { at: [20,0,0] }); turn(a, [0,90,0]); mirror(a, 'left-right');`, note: 'advice: turn it so a flat end points that way' },
  { id: 'r3-adv-cyl-tb', row: 'mirror-advice', src: `const a = cylinder(10, 20, { at: [0,0,30] }); mirror(a, 'top-bottom');`, note: 'advice: mirror along an axis with a flat face' },
  { id: 'r3-adv-hex-lr', row: 'mirror-advice', src: `const a = prism(6, 10, 10, { at: [20,0,0] }); mirror(a, 'left-right');`, note: 'hexagon with a vertex toward x' },
  { id: 'r3-adv-hex-turned-lr', row: 'mirror-advice', src: `const a = prism(6, 10, 10, { at: [20,0,0] }); turn(a, [0,0,30]); mirror(a, 'left-right');`, note: 'turned 30: flat face toward x' },
  { id: 'r3-adv-pull-washer-tb', row: 'mirror-advice', src: `const a = cylinder(40, 10, { at: [0,0,5] }); const h = cylinder(20, 12, { at: [0,0,5] }); const w = cut(a, h); mirror(w, 'top-bottom');`, note: 'the same washer built from cylinders instead of spin(): flat annulus contact' },
  { id: 'r3-adv-sphere-lr', row: 'mirror-advice', src: `const a = sphere(10, { at: [20,0,0] }); mirror(a, 'left-right');` },
  { id: 'r3-adv-sphere-flat-lr', row: 'mirror-advice', src: `const a = sphere(10, { at: [20,0,0] }); const k = box(20,20,20,{at:[24,0,0]}); keep(a, k); mirror(a, 'left-right');`, note: 'advice: cut a flat face on that side (sphere kept inside a box whose left face is at x=14)' },
  // ---- F. script-layer refusals that rows 13/15/40 called supported ----
  { id: 'r3-pad-round-disjoint', row: 'pad-round', src: boss(60, 30, 5, 'circle(8, { at: [10, 15] })', '[14,0,0]', 3) },
  { id: 'r3-pad-round-overlap', row: 'pad-round', src: boss(60, 30, 5, 'circle(8, { at: [10, 15] })', '[5,0,0]', 3) },
  { id: 'r3-pad-round-tangent', row: 'pad-round', src: boss(60, 30, 5, 'circle(8, { at: [10, 15] })', '[8,0,0]', 3) },
  { id: 'r3-pad-round-z', row: 'pad-round', src: boss(60, 30, 5, 'circle(8, { at: [10, 15] })', '[0,0,4]', 2) },
  { id: 'r3-pad-rect-disjoint', row: 'pad-round', src: boss(60, 30, 5, 'rect(8, 8, { at: [10, 15] })', '[14,0,0]', 3) },
  { id: 'r3-pad-rect-touching', row: 'pad-round', src: boss(60, 20, 5, 'rect(8, 8, { at: [10, 10] })', '[8,0,0]', 3) },
  { id: 'r3-padra-round-overlap', row: 'pad-round', src: `${`const sk1 = sketch('top'); sk1.circle(80); const plate = extrude(sk1, 5);`} const s2 = sketch('top', 5); s2.circle(12, { at: [20, 0] }); const b = extrude(s2, 6); const bl = repeatAround(b, { count: 8 }); join(plate, bl);`, note: 'bosses d12 on a radius-20 ring, 8 of them: neighbours 15.3 apart, overlapping' },
  { id: 'r3-padra-round-ok', row: 'pad-round', src: `${`const sk1 = sketch('top'); sk1.circle(80); const plate = extrude(sk1, 5);`} const s2 = sketch('top', 5); s2.circle(6, { at: [20, 0] }); const b = extrude(s2, 6); const bl = repeatAround(b, { count: 4 }); join(plate, bl);` },
  { id: 'r3-mirhole-overlap', row: 'mirror-hole', src: `const plate = box(60,30,10,{at:[30,15,5]}); const h = hole(plate, { across: 6, at: [-20, 0] }); mirror(h, 'left-right', { at: 12 });`, note: 'hole at x=10 mirrored across x=12: the copy (x=14) overlaps it' },
  { id: 'r3-mirhole-at200', row: 'mirror-hole', src: `const plate = box(60,30,10,{at:[30,15,5]}); const h = hole(plate, { across: 6, at: [-20, 0] }); mirror(h, 'left-right', { at: 200 });` },
  { id: 'r3-mirhole-ok', row: 'mirror-hole', src: `const plate = box(60,30,10,{at:[30,15,5]}); const h = hole(plate, { across: 6, at: [-20, 0] }); mirror(h, 'left-right', { at: 30 });` },
  // ---- F2. repeat(pad) where the pad is join(plate, boss): the script lowers this to copies and refuses overlap / touching / z ----
  ...[['round-overlap', 'circle(8, { at: [10, 15] })', '[5,0,0]', 3], ['round-tangent', 'circle(8, { at: [10, 15] })', '[8,0,0]', 3], ['round-disjoint', 'circle(8, { at: [10, 15] })', '[14,0,0]', 3], ['round-z', 'circle(8, { at: [10, 15] })', '[0,0,4]', 2], ['rect-overlap', 'rect(8, 8, { at: [10, 15] })', '[5,0,0]', 3], ['rect-touching', 'rect(8, 8, { at: [10, 15] })', '[8,0,0]', 3], ['rect-disjoint', 'rect(8, 8, { at: [10, 15] })', '[14,0,0]', 3]].map(([n, shape, step, count]) => ({ id: `r3-padj-${n}`, row: 'pad-joined', src: `${plateS(60, 30, 5)} const s2 = sketch('top', 5); s2.${shape}; const boss = extrude(s2, 6); const padded = join(plate, boss); repeat(padded, { count: ${count}, step: ${step} });`, note: 'repeat(pad) with the pad = join(plate, boss)' })),
  { id: 'r3-padj-around-overlap', row: 'pad-joined', src: `const sk1 = sketch('top'); sk1.circle(80); const plate = extrude(sk1, 5); const s2 = sketch('top', 5); s2.circle(12, { at: [20, 0] }); const boss = extrude(s2, 6); const padded = join(plate, boss); repeatAround(padded, { count: 8 });`, note: 'bosses d12 on a radius-20 ring, 8 of them, neighbours overlap' },
  { id: 'r3-padj-around-ok', row: 'pad-joined', src: `const sk1 = sketch('top'); sk1.circle(80); const plate = extrude(sk1, 5); const s2 = sketch('top', 5); s2.circle(6, { at: [20, 0] }); const boss = extrude(s2, 6); const padded = join(plate, boss); repeatAround(padded, { count: 4 });` },
  // ---- G. partial-angle semantics: the same call on a solid and on a pocket ----
  { id: 'r3-ang-solid-90-n3', row: 'angle', src: `const a = box(4,4,4,{at:[30,0,0]}); repeatAround(a, { count: 3, angle: 90 });`, note: 'whole solid' },
  { id: 'r3-ang-pocket-90-n3', row: 'angle', src: `const sk1 = sketch('top'); sk1.circle(100); const plate = extrude(sk1, 10); const p1 = sketch('top', 10); p1.circle(4, { at: [30, 0] }); const pk = pocket(p1, plate, 12); repeatAround(pk, { count: 3, angle: 90 });`, note: 'pocket' },
];
