// FreeCAD-backed variants for the patterns-mirror contract that the saved gauntlet refs (docs/replica, read-only) do not cover.
// Same shape as variants/defs.mjs: { id, ours (reSHape Script), fc (FreeCAD python body run after fc_prelude.py) }.
// Generate + run: bun pm-gen-fc.mjs <scratch dir>; the refs it writes are copied into ./pm-fc-refs/.
const plateS = (w, d, h) => `const s1 = sketch('top'); s1.polygon([[0,0],[${w},0],[${w},${d}],[0,${d}]]); const plate = extrude(s1, ${h});`;
const plateF = (w, d, h) => `doc, body = setup()\ns1 = sketch(body, 'top')\nrect(s1, 0, 0, ${w}, ${d})\nbase = pad(body, s1, ${h})`;
const discS = (r, h) => `const sk1 = sketch('top'); sk1.circle(${r}); const plate = extrude(sk1, ${h});`;
const discF = (r, h) => `doc, body = setup()\nsk1 = sketch(body, 'top')\ncircle(sk1, 0, 0, ${r / 2})\nbase = pad(body, sk1, ${h})`;
// block centred on the world origin in x/y/z for patterns about x, y or z: 60 x 60 x 60 built from the top plane at z=-30
const cubeS = `const s1 = sketch('top', -30); s1.polygon([[-30,-30],[30,-30],[30,30],[-30,30]]); const plate = extrude(s1, 60);`;
const cubeF = `doc, body = setup()\ns1 = sketch(body, 'top', -30)\nrect(s1, -30, -30, 30, 30)\nbase = pad(body, s1, 60)`;
export const FC_VARIANTS = [
  // ---- repeatAround of a pad (boss) / partial angles: the script lowers these to copies, count-1 spacing for less than a full turn
  { id: 'pm-polar-boss-partial-90-x3', desc: 'three bosses over 90 degrees (FreeCAD spaces angle/(n-1) = 45)',
    ours: `${discS(60, 10)} const s2 = sketch('top', 10); s2.circle(6, { at: [22, 0] }); const boss = extrude(s2, 5); const bl = repeatAround(boss, { count: 3, axis: 'z', angle: 90 }); join(plate, bl);`,
    fc: `${discF(60, 10)}\ns2 = sketch(body, 'top', 10)\ncircle(s2, 22, 0, 3)\nbp = pad(body, s2, 5)\npolar_pattern(body, bp, 'Z_Axis', 90, 3)` },
  { id: 'pm-polar-boss-partial-180-x4', desc: 'four bosses over 180 degrees',
    ours: `${discS(60, 10)} const s2 = sketch('top', 10); s2.circle(6, { at: [22, 0] }); const boss = extrude(s2, 5); const bl = repeatAround(boss, { count: 4, axis: 'z', angle: 180 }); join(plate, bl);`,
    fc: `${discF(60, 10)}\ns2 = sketch(body, 'top', 10)\ncircle(s2, 22, 0, 3)\nbp = pad(body, s2, 5)\npolar_pattern(body, bp, 'Z_Axis', 180, 4)` },
  { id: 'pm-polar-boss-neg90-x3', desc: 'three bosses over -90 degrees',
    ours: `${discS(60, 10)} const s2 = sketch('top', 10); s2.circle(6, { at: [22, 0] }); const boss = extrude(s2, 5); const bl = repeatAround(boss, { count: 3, axis: 'z', angle: -90 }); join(plate, bl);`,
    fc: `${discF(60, 10)}\ns2 = sketch(body, 'top', 10)\ncircle(s2, 22, 0, 3)\nbp = pad(body, s2, 5)\npolar_pattern(body, bp, 'Z_Axis', -90, 3)` },
  { id: 'pm-polar-boss-x4-around-x', desc: 'four bosses on the x=40 face of a block, turned about the x axis',
    ours: `${cubeS.replace("sketch('top', -30)", "sketch('side')").replace('[[-30,-30],[30,-30],[30,30],[-30,30]]', '[[-30,-30],[30,-30],[30,30],[-30,30]]').replace('extrude(s1, 60)', 'extrude(s1, 40)')} const s2 = sketch('side', 40); s2.circle(6, { at: [18, 0] }); const boss = extrude(s2, 5); const bl = repeatAround(boss, { count: 4, axis: 'x' }); join(plate, bl);`,
    fc: `doc, body = setup()\ns1 = sketch(body, 'side')\nrect(s1, -30, -30, 30, 30)\nbase = pad(body, s1, 40)\ns2 = sketch(body, 'side', 40)\ncircle(s2, 18, 0, 3)\nbp = pad(body, s2, 5)\npolar_pattern(body, bp, 'X_Axis', 360, 4)` },
  // ---- repeatAround of a pocket about x and y; partial and beyond-a-turn angles
  { id: 'pm-polar-holes-x4-around-x', desc: 'four blind holes in the x=40 face of a block, turned about the x axis',
    ours: `const s1 = sketch('side'); s1.polygon([[-30,-30],[30,-30],[30,30],[-30,30]]); const plate = extrude(s1, 40); const p1 = sketch('side', 40); p1.circle(6, { at: [18, 0] }); const pk = pocket(p1, plate, 12); repeatAround(pk, { count: 4, axis: 'x' });`,
    fc: `doc, body = setup()\ns1 = sketch(body, 'side')\nrect(s1, -30, -30, 30, 30)\nbase = pad(body, s1, 40)\np1 = sketch(body, 'side', 40)\ncircle(p1, 18, 0, 3)\npk = pocket(body, p1, 12)\npolar_pattern(body, pk, 'X_Axis', 360, 4)` },
  { id: 'pm-polar-holes-partial-90-x3-around-x', desc: 'three holes over 90 degrees about the x axis',
    ours: `const s1 = sketch('side'); s1.polygon([[-30,-30],[30,-30],[30,30],[-30,30]]); const plate = extrude(s1, 40); const p1 = sketch('side', 40); p1.circle(6, { at: [18, 0] }); const pk = pocket(p1, plate, 12); repeatAround(pk, { count: 3, axis: 'x', angle: 90 });`,
    fc: `doc, body = setup()\ns1 = sketch(body, 'side')\nrect(s1, -30, -30, 30, 30)\nbase = pad(body, s1, 40)\np1 = sketch(body, 'side', 40)\ncircle(p1, 18, 0, 3)\npk = pocket(body, p1, 12)\npolar_pattern(body, pk, 'X_Axis', 90, 3)` },
  { id: 'pm-polar-holes-x4-around-y', desc: 'four blind holes in the y=0 face (front sketch) of a cube centred on the origin, turned about the y axis',
    ours: `${cubeS.replace("sketch('top', -30)", "sketch('top', -30)")} const p1 = sketch('front', 0); p1.circle(6, { at: [18, 0] }); const pk = pocket(p1, plate, 12); repeatAround(pk, { count: 4, axis: 'y' });`,
    fc: `${cubeF}\np1 = sketch(body, 'front', 0)\ncircle(p1, 18, 0, 3)\npk = pocket(body, p1, 12)\npolar_pattern(body, pk, 'Y_Axis', 360, 4)` },
  { id: 'pm-polar-holes-neg90-x3', desc: 'three through holes over -90 degrees on a disc',
    ours: `${discS(60, 10)} const p1 = sketch('top', 10); p1.circle(6, { at: [20, 0] }); const pk = pocket(p1, plate, 12); repeatAround(pk, { count: 3, axis: 'z', angle: -90 });`,
    fc: `${discF(60, 10)}\np1 = sketch(body, 'top', 10)\ncircle(p1, 20, 0, 3)\npk = pocket(body, p1, None, through=True)\npolar_pattern(body, pk, 'Z_Axis', -90, 3)` },
  { id: 'pm-polar-holes-720-x4', desc: 'four through holes with angle 720 (more than a turn)',
    ours: `${discS(60, 10)} const p1 = sketch('top', 10); p1.circle(6, { at: [20, 0] }); const pk = pocket(p1, plate, 12); repeatAround(pk, { count: 4, axis: 'z', angle: 720 });`,
    fc: `${discF(60, 10)}\np1 = sketch(body, 'top', 10)\ncircle(p1, 20, 0, 3)\npk = pocket(body, p1, None, through=True)\npolar_pattern(body, pk, 'Z_Axis', 720, 4)` },
  { id: 'pm-polar-holes-neg360-x4', desc: 'four through holes with angle -360',
    ours: `${discS(60, 10)} const p1 = sketch('top', 10); p1.circle(6, { at: [20, 0] }); const pk = pocket(p1, plate, 12); repeatAround(pk, { count: 4, axis: 'z', angle: -360 });`,
    fc: `${discF(60, 10)}\np1 = sketch(body, 'top', 10)\ncircle(p1, 20, 0, 3)\npk = pocket(body, p1, None, through=True)\npolar_pattern(body, pk, 'Z_Axis', -360, 4)` },
  { id: 'pm-polar-holes-partial-90-x2', desc: 'two through holes over 90 degrees (second sits AT 90)',
    ours: `${discS(60, 10)} const p1 = sketch('top', 10); p1.circle(6, { at: [20, 0] }); const pk = pocket(p1, plate, 12); repeatAround(pk, { count: 2, axis: 'z', angle: 90 });`,
    fc: `${discF(60, 10)}\np1 = sketch(body, 'top', 10)\ncircle(p1, 20, 0, 3)\npk = pocket(body, p1, None, through=True)\npolar_pattern(body, pk, 'Z_Axis', 90, 2)` },
  // ---- repeat of a pocket / pad, signs and axes
  { id: 'pm-lin-holes-neg-step', desc: 'three holes with a NEGATIVE step: x=50, 30, 10',
    ours: `${plateS(60, 20, 10)} const p1 = sketch('top', 10); p1.circle(6, { at: [50, 10] }); const pk = pocket(p1, plate, 12); repeat(pk, { count: 3, step: -20 });`,
    fc: `${plateF(60, 20, 10)}\np1 = sketch(body, 'top', 10)\ncircle(p1, 50, 10, 3)\npk = pocket(body, p1, None, through=True)\nlp = body.newObject('PartDesign::LinearPattern', 'LP')\nlp.Originals = [pk]\nlp.Direction = (origin(body, 'X_Axis'), [''])\nlp.Length = 40\nlp.Occurrences = 3\nlp.Reversed = True\nbody.Tip = lp\nbody.Document.recompute()` },
  { id: 'pm-lin-boss-y3', desc: 'three bosses along y, step [0,14,0]',
    ours: `${plateS(30, 60, 5)} const s2 = sketch('top', 5); s2.circle(6, { at: [15, 8] }); const boss = extrude(s2, 6); const bl = repeat(boss, { count: 3, step: [0, 14, 0] }); join(plate, bl);`,
    fc: `${plateF(30, 60, 5)}\ns2 = sketch(body, 'top', 5)\ncircle(s2, 15, 8, 3)\nbp = pad(body, s2, 6)\nlinear_pattern(body, bp, 'Y_Axis', 28, 3)` },
  { id: 'pm-lin-boss-touching', desc: 'three bosses whose neighbours touch along an edge (step = width, rectangles)',
    ours: `${plateS(60, 20, 5)} const s2 = sketch('top', 5); s2.rect(8, 8, { at: [10, 10] }); const boss = extrude(s2, 6); const bl = repeat(boss, { count: 3, step: [8, 0, 0] }); join(plate, bl);`,
    fc: `${plateF(60, 20, 5)}\ns2 = sketch(body, 'top', 5)\nrect(s2, 6, 6, 14, 14)\nbp = pad(body, s2, 6)\nlinear_pattern(body, bp, 'X_Axis', 16, 3)` },
  { id: 'pm-lin-boss-overlap', desc: 'three bosses that overlap (step 5 on 8 wide rectangles) into one bar',
    ours: `${plateS(60, 20, 5)} const s2 = sketch('top', 5); s2.rect(8, 8, { at: [10, 10] }); const boss = extrude(s2, 6); const bl = repeat(boss, { count: 3, step: [5, 0, 0] }); join(plate, bl);`,
    fc: `${plateF(60, 20, 5)}\ns2 = sketch(body, 'top', 5)\nrect(s2, 6, 6, 14, 14)\nbp = pad(body, s2, 6)\nlinear_pattern(body, bp, 'X_Axis', 10, 3)` },
  // ---- mirror(pad, word, {at}) and boundaries
  { id: 'pm-mir-boss-front-back', desc: 'a round boss at (10,8) mirrored across y=15',
    ours: `${plateS(40, 30, 5)} const s2 = sketch('top', 5); s2.circle(8, { at: [10, 8] }); const boss = extrude(s2, 6); const padded = join(plate, boss); mirror(padded, 'front-back', { at: 15 });`,
    fc: `${plateF(40, 30, 5)}\ns2 = sketch(body, 'top', 5)\ncircle(s2, 10, 8, 4)\nbp = pad(body, s2, 6)\nmirrored(body, bp, 'front', -15)` },
  { id: 'pm-mir-boss-straddle', desc: 'a boss x 13..27 mirrored across x=24: the reflection (21..35) overlaps it',
    ours: `${plateS(60, 30, 5)} const s2 = sketch('top', 5); s2.rect(14, 10, { at: [20, 15] }); const boss = extrude(s2, 6); const padded = join(plate, boss); mirror(padded, 'left-right', { at: 24 });`,
    fc: `${plateF(60, 30, 5)}\ns2 = sketch(body, 'top', 5)\nrect(s2, 13, 10, 27, 20)\nbp = pad(body, s2, 6)\nmirrored(body, bp, 'side', 24)` },
  { id: 'pm-mir-boss-touching', desc: 'a boss x 10..20 mirrored across x=20: the reflection (20..30) shares a face with it',
    ours: `${plateS(60, 30, 5)} const s2 = sketch('top', 5); s2.rect(10, 10, { at: [15, 15] }); const boss = extrude(s2, 6); const padded = join(plate, boss); mirror(padded, 'left-right', { at: 20 });`,
    fc: `${plateF(60, 30, 5)}\ns2 = sketch(body, 'top', 5)\nrect(s2, 10, 10, 20, 20)\nbp = pad(body, s2, 6)\nmirrored(body, bp, 'side', 20)` },
  { id: 'pm-mir-boss-tangent-circles', desc: 'a round boss d10 at x=10 mirrored across x=15: the reflection is tangent to it',
    ours: `${plateS(60, 30, 5)} const s2 = sketch('top', 5); s2.circle(10, { at: [10, 15] }); const boss = extrude(s2, 6); const padded = join(plate, boss); mirror(padded, 'left-right', { at: 15 });`,
    fc: `${plateF(60, 30, 5)}\ns2 = sketch(body, 'top', 5)\ncircle(s2, 10, 15, 5)\nbp = pad(body, s2, 6)\nmirrored(body, bp, 'side', 15)` },
  { id: 'pm-mir-boss-on-plane', desc: 'a round boss centred ON the mirror plane x=20',
    ours: `${plateS(40, 30, 5)} const s2 = sketch('top', 5); s2.circle(8, { at: [20, 15] }); const boss = extrude(s2, 6); const padded = join(plate, boss); mirror(padded, 'left-right', { at: 20 });`,
    fc: `${plateF(40, 30, 5)}\ns2 = sketch(body, 'top', 5)\ncircle(s2, 20, 15, 4)\nbp = pad(body, s2, 6)\nmirrored(body, bp, 'side', 20)` },
  { id: 'pm-mir-pocket-lr-through-plate', desc: 'a through pocket mirrored left-right across x=20 in a thick block (z)',
    ours: `${plateS(40, 30, 20)} const s2 = sketch('top', 20); s2.rect(6, 6, { at: [8, 15] }); const p = pocket(s2, plate, 8); mirror(p, 'left-right', { at: 20 });`,
    fc: `${plateF(40, 30, 20)}\ns2 = sketch(body, 'top', 20)\nrect(s2, 5, 12, 11, 18)\npk = pocket(body, s2, 8)\nmirrored(body, pk, 'side', 20)` },
];
