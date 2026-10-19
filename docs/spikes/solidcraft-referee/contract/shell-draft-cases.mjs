// The shell-draft case list (reSHape Script text + an independent closed form where one exists). Consumed by shell-draft-runner.mjs.
// Groups (a group is one family of contract rows):
//   h-closed h-open-box h-open-curved h-thick h-prism h-extrude h-nonconvex h-move h-holes h-round h-combo h-misc
//   d-box d-angle d-neutral d-from d-multi d-whole d-curved d-prism d-nonconvex d-move d-fromstale d-tiny d-combo
const WORD = { top: '+z', bottom: '-z', front: '-y', back: '+y', left: '-x', right: '+x' };
const OPP = { top: 'bottom', bottom: 'top', front: 'back', back: 'front', left: 'right', right: 'left' };
const PULL_OF = { top: 'z', bottom: 'z', front: 'y', back: 'y', left: 'x', right: 'x' };
const AXI = { x: 0, y: 1, z: 2 };

export function CASES_FN({ P, sigma }) {
  const C = [];
  const add = (id, group, feature, script, extra = {}) => C.push({ id, group, feature, script, ...extra });

  // ---- closed-form helpers -------------------------------------------------------------------------------------------
  const boxP = (size, c = [0, 0, 0], rot) => {
    let pl = P.boxPlanes(size.map((s) => -s / 2), size.map((s) => s / 2));
    if (rot && rot.some(Boolean)) pl = P.rotatePlanes(pl, rot);
    return P.translatePlanes(pl, c);
  };
  const hollowE = (pl, word, t) => {
    const { index } = P.wordPlane(pl, WORD[word]);
    const h = P.hollow(pl, index, t);
    const ib = h.inner.bbox; const thin = !ib || ib.some((v) => !Number.isFinite(v)) || Math.min(ib[3] - ib[0], ib[4] - ib[1], ib[5] - ib[2]) < 1e-7 * Math.max(...h.bbox.map(Math.abs), 1);
    const collapse = thin || !(h.inner.volume > 1e-9);
    return { volume: h.volume, com: h.com, bbox: h.bbox, collapse };
  };
  const hollowAlt = (pl, word, t) => () => hollowE(pl, OPP[word], t);
  const draftE = (pl, drafts) => {
    const base = P.measure(pl);
    const q = pl.map((p) => ({ ...p }));
    for (const d of drafts) { const { index } = P.wordPlane(pl, WORD[d.word]); q[index] = P.draftPlane(pl[index], d.pull, d.neutral, d.deg, sigma); }
    const m = P.measure(q);
    return { volume: m.volume, com: m.com, bbox: m.bbox, vanish: m.faces !== base.faces, faces: m.faces };
  };
  // cylinder (axis z) hollow with the centre of mass, centre c, open top or bottom
  const sumE = (a, b) => { const V = a.volume + b.volume; return { volume: V, com: a.com.map((c, k) => (a.volume * c + b.volume * b.com[k]) / V), vanish: a.vanish || b.vanish }; };
  const cylHollow = (r, h, t, c, word) => {
    const Vo = Math.PI * r * r * h, Vc = Math.PI * (r - t) ** 2 * (h - t);
    const zc = c[2] + (word === 'top' ? t / 2 : -t / 2);
    const V = Vo - Vc;
    return { volume: V, com: [c[0], c[1], (Vo * c[2] - Vc * zc) / V] };
  };
  const cylOpen = (r, h, t) => (t >= Math.min(r, h) ? { collapse: true, volume: Math.PI * r * r * h } : { volume: Math.PI * r * r * h - Math.PI * (r - t) ** 2 * (h - t) });
  // rectilinear polygon inward offset area: A - w P + c w^2 - r (pi/4) w^2 (convex 90-degree vertices c, reflex r), exact while w is below half the narrowest feature
  const poly = (pts) => {
    let A = 0, Pm = 0, c = 0, r = 0; const n = pts.length;
    for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n], d = pts[(i + 2) % n]; A += a[0] * b[1] - b[0] * a[1]; Pm += Math.hypot(b[0] - a[0], b[1] - a[1]); const cr = (b[0] - a[0]) * (d[1] - b[1]) - (b[1] - a[1]) * (d[0] - b[0]); if (cr > 0) c++; else r++; }
    return { A: Math.abs(A) / 2, Pm, c, r };
  };
  const insetArea = (pts, w) => { const { A, Pm, c, r } = poly(pts); return A - w * Pm + c * w * w - r * Math.PI / 4 * w * w; };
  const prismHollow = (pts, h, t) => { const { A } = poly(pts); return { volume: A * h - insetArea(pts, t) * (h - t) }; };

  // ---- hollow: closed (no open face) -------------------------------------------------------------------------------------
  const BX = { s: [40, 30, 12], c: [15, -7, 3] };
  const bxs = `box(40, 30, 12, { at: [15, -7, 3] })`;
  const bxP = () => boxP(BX.s, BX.c);
  add('hollow-closed-box', 'h-closed', 'hollow closed', `const b = box(40, 30, 20);\nhollow(b, { wall: 2 });`);
  add('hollow-closed-box-offcentre', 'h-closed', 'hollow closed', `const b = ${bxs};\nhollow(b, { wall: 2 });`);
  add('hollow-closed-cylinder', 'h-closed', 'hollow closed', `const c = cylinder(24, 30);\nhollow(c, { wall: 2 });`);
  add('hollow-closed-sphere', 'h-closed', 'hollow closed', `const s = sphere(30);\nhollow(s, { wall: 2 });`);
  add('hollow-closed-prism6', 'h-closed', 'hollow closed', `const s = prism(6, 30, 20);\nhollow(s, { wall: 2 });`);

  // ---- hollow open, box, all six words -----------------------------------------------------------------------------------
  for (const w of Object.keys(WORD)) {
    add(`hollow-open-${w}`, 'h-open-box', `hollow open:${w}`, `const b = ${bxs};\nhollow(b, { wall: 2, open: '${w}' });`, { expect: () => hollowE(bxP(), w, 2), expectAlt: hollowAlt(bxP(), w, 2) });
  }
  const bx3 = (w) => `box(120, 90, 36, { at: [45, -21, 9] })`;
  for (const w of ['top', 'right']) add(`hollow-open-${w}-thin-3x`, 'h-open-box', `hollow open:${w} (3x scale, wall 0.3)`, `const b = ${bx3()};\nhollow(b, { wall: 0.3, open: '${w}' });`, { expect: () => hollowE(boxP([120, 90, 36], [45, -21, 9]), w, 0.3) });
  for (const [k, s] of [['1e-2', 0.01], ['1e0', 1], ['1e2', 100], ['2.5e3', 2500]]) {
    add(`hollow-open-top-scale-${k}`, 'h-scale', `hollow open:top at scale ${k}`, `const b = box(${40 * s}, ${30 * s}, ${12 * s}, { at: [${15 * s}, ${-7 * s}, ${3 * s}] });\nhollow(b, { wall: ${2 * s}, open: 'top' });`, { expect: () => hollowE(boxP([40 * s, 30 * s, 12 * s], [15 * s, -7 * s, 3 * s]), 'top', 2 * s) });
  }

  // ---- hollow, curved targets -----------------------------------------------------------------------------------------------
  const cyl = (at) => `const c = cylinder(24, 30, { at: [5, 3, 2] });`;
  for (const w of ['top', 'bottom']) add(`hollow-open-${w}-cylinder`, 'h-open-curved', `hollow open:${w} on a cylinder`, `${cyl()}\nhollow(c, { wall: 2, open: '${w}' });`, { expect: () => cylHollow(12, 30, 2, [5, 3, 2], w), expectAlt: () => cylHollow(12, 30, 2, [5, 3, 2], OPP[w]) });
  add('hollow-open-side-cylinder', 'h-open-curved', 'hollow open:side', `const c = cylinder(24, 30);\nhollow(c, { wall: 2, open: 'side' });`);
  add('hollow-open-left-cylinder', 'h-open-curved', 'hollow open:left on a cylinder (no such face)', `const c = cylinder(24, 30);\nhollow(c, { wall: 2, open: 'left' });`);
  add('hollow-open-top-sphere', 'h-open-curved', 'hollow open:top on a sphere', `const s = sphere(30);\nhollow(s, { wall: 2, open: 'top' });`);
  const coneBottom = (R, H, t) => { const d = t * Math.hypot(R, H) / H; return d >= R ? { collapse: true, volume: Math.PI * R * R * H / 3 } : { volume: Math.PI * H / (3 * R) * (R ** 3 - (R - d) ** 3) }; };
  add('hollow-open-bottom-cone', 'h-open-curved', 'hollow open:bottom on a cone', `const s = cone(30, 30);\nhollow(s, { wall: 2, open: 'bottom' });`, { expect: () => coneBottom(15, 30, 2) });
  add('hollow-open-top-cone', 'h-open-curved', 'hollow open:top on a cone (the top is the point)', `const s = cone(30, 30);\nhollow(s, { wall: 2, open: 'top' });`);
  add('hollow-closed-ring', 'h-open-curved', 'hollow on a ring', `const s = ring(40, 12);\nhollow(s, { wall: 2, open: 'top' });`);

  // ---- hollow: how thick can the wall be (G-THICK) ------------------------------------------------------------------------------
  for (const t of [5, 5.9, 6, 7, 11.9, 12, 12.5, 13, 14.9, 15, 16]) add(`hollow-wall-${t}-box-open-top`, 'h-thick', 'wall vs depth (box 40x30x12, open top)', `const b = ${bxs};\nhollow(b, { wall: ${t}, open: 'top' });`, { expect: () => hollowE(bxP(), 'top', t) });
  for (const t of [14.9, 15, 15.5]) add(`hollow-wall-${t}-tall-open-top`, 'h-thick', 'wall vs narrow side (box 40x30x50)', `const b = box(40, 30, 50, { at: [15, -7, 3] });\nhollow(b, { wall: ${t}, open: 'top' });`, { expect: () => hollowE(boxP([40, 30, 50], [15, -7, 3]), 'top', t) });
  for (const t of [5.9, 6, 6.5, 8]) add(`hollow-wall-${t}-box-open-right`, 'h-thick', 'wall vs thinnest side (box 40x30x12, open right)', `const b = ${bxs};\nhollow(b, { wall: ${t}, open: 'right' });`, { expect: () => hollowE(bxP(), 'right', t) });
  for (const t of [5.9, 6]) add(`hollow-wall-${t}-box-12-wide`, 'h-thick', 'wall vs half the width (box 12 wide x 40 x 20, open top)', `const b = box(12, 40, 20);\nhollow(b, { wall: ${t}, open: 'top' });`, { expect: () => hollowE(boxP([12, 40, 20]), 'top', t) });
  for (const t of [11, 11.9, 12, 13]) add(`hollow-wall-${t}-disc60x12`, 'h-thick', 'wall vs depth on a short wide cylinder (60x12)', `const c = cylinder(60, 12);\nhollow(c, { wall: ${t}, open: 'top' });`, { expect: () => cylOpen(30, 12, t) });
  for (const t of [11.9, 12, 13]) add(`hollow-wall-${t}-cyl24x30`, 'h-thick', 'wall vs radius (cylinder 24x30)', `const c = cylinder(24, 30, { at: [5, 3, 2] });\nhollow(c, { wall: ${t}, open: 'top' });`, { expect: () => cylOpen(12, 30, t) });
  for (const t of [11, 11.9, 12, 13, 14.9]) add(`hollow-wall-${t}-hex60x12`, 'h-thick', 'wall vs depth on a short hexagon (60x12)', `const c = prism(6, 60, 12);\nhollow(c, { wall: ${t}, open: 'top' });`, { expect: () => hollowE(P.prismPlanes(6, 30, 12), 'top', t) });
  for (const t of [2, 10, 14, 20]) add(`hollow-wall-${t}-cone`, 'h-thick', 'wall on a cone, open bottom', `const s = cone(30, 30);\nhollow(s, { wall: ${t}, open: 'bottom' });`, { expect: () => coneBottom(15, 30, t) });
  for (const t of [2, 5, 14, 15]) add(`hollow-wall-${t}-wedge`, 'h-thick', 'wall on a wedge, open top', `const s = wedge(30, 20, 15);\nhollow(s, { wall: ${t}, open: 'top' });`, { expect: () => hollowE(P.wedgePlanes(30, 20, 15), 'top', t) });

  // ---- hollow: prisms (face words, G-TIE) -----------------------------------------------------------------------------------------
  for (const n of [3, 4, 5, 6, 7, 8, 10, 12]) for (const w of Object.keys(WORD)) {
    add(`hollow-prism${n}-${w}`, 'h-prism', `hollow open:${w} on a ${n}-sided prism`, `const s = prism(${n}, 30, 20);\nhollow(s, { wall: 2, open: '${w}' });`, {
      expect: () => { const pl = P.prismPlanes(n, 15, 20); const wp = P.wordPlane(pl, WORD[w]); const e = hollowE(pl, w, 2); return { ...e, ambiguous: wp.ties > 1 }; },
    });
  }
  const wedgeP = () => P.wedgePlanes(30, 20, 15);
  for (const w of Object.keys(WORD)) add(`hollow-wedge-${w}`, 'h-prism', `hollow open:${w} on a wedge`, `const s = wedge(30, 20, 15);\nhollow(s, { wall: 2, open: '${w}' });`, { expect: () => { const wp = P.wordPlane(wedgeP(), WORD[w]); return { ...hollowE(wedgeP(), w, 2), ambiguous: wp.ties > 1 }; } });

  // ---- hollow: extrudes ---------------------------------------------------------------------------------------------------------
  const rect = `[[0,0],[40,0],[40,30],[0,30]]`;
  const ex = (plane, pts, h, call) => `const s1 = sketch('${plane}'); s1.polygon(${pts}); const p = extrude(s1, ${h}); ${call}`;
  for (const w of ['top', 'bottom', 'right', 'left']) add(`hollow-extrude-rect-${w}`, 'h-extrude', `hollow open:${w} on a rectangle extrude (top plane)`, ex('top', rect, 10, `hollow(p, {wall: 2, open:'${w}'});`), { expect: () => hollowE(boxP([40, 30, 10], [20, 15, 5]), w, 2) });
  for (const w of ['top', 'front', 'back']) add(`hollow-extrude-front-${w}`, 'h-extrude', `hollow open:${w} on a rectangle extrude (front plane)`, ex('front', rect, 10, `hollow(p, {wall: 2, open:'${w}'});`), { expect: () => hollowE(P.boxPlanes([0, -10, 0], [40, 0, 30]), w, 2) });
  const tri = `[[0,0],[40,0],[0,30]]`;
  for (const w of ['top', 'bottom']) add(`hollow-extrude-tri-${w}`, 'h-extrude', `hollow open:${w} on a triangle extrude`, ex('top', tri, 10, `hollow(p, {wall: 1, open:'${w}'});`), { expect: () => hollowE(P.polyPrismPlanes([[0, 0], [40, 0], [0, 30]], 0, 10), w, 1) });
  add('hollow-extrude-circle-top', 'h-extrude', 'hollow open:top on a circle extrude', `const s1 = sketch('top'); s1.circle(30); const p = extrude(s1, 10); hollow(p, {wall: 1, open:'top'});`);
  const Lpts = [[0, 0], [40, 0], [40, 10], [10, 10], [10, 40], [0, 40]];
  const Lstr = JSON.stringify(Lpts);
  for (const w of ['top', 'bottom']) add(`hollow-extrude-L-${w}`, 'h-nonconvex', `hollow open:${w} on an L-shaped extrude`, ex('top', Lstr, 10, `hollow(p, {wall: 1, open:'${w}'});`), { expect: () => prismHollow(Lpts, 10, 1) });
  // notch cut from one side (the critic's case): 40x40x20 box, 10 wide x 5 deep x full height notch, open top, wall 2
  const notch = [[-20, -20], [-5, -20], [-5, -15], [5, -15], [5, -20], [20, -20], [20, 20], [-20, 20]];
  add('hollow-notch-top', 'h-nonconvex', 'hollow open:top on a box with a notch cut from one side', `const a = box(40, 40, 20); const c = box(10, 10, 30, { at: [0, -20, 0] }); const r = cut(a, c); hollow(r, { wall: 2, open: 'top' });`, { expect: () => prismHollow(notch, 20, 2) });
  add('hollow-notch-bottom', 'h-nonconvex', 'hollow open:bottom on the notched box', `const a = box(40, 40, 20); const c = box(10, 10, 30, { at: [0, -20, 0] }); const r = cut(a, c); hollow(r, { wall: 2, open: 'bottom' });`, { expect: () => prismHollow(notch, 20, 2) });
  add('hollow-join-L-bottom', 'h-nonconvex', 'hollow of a join (L made of two boxes), open bottom', `const a = box(40,20,10); const c = box(20,20,10,{at:[10,20,0]}); const u = join(a, c); hollow(u, {wall: 2, open:"bottom"});`);
  add('hollow-join-boss-top', 'h-nonconvex', 'hollow of a box with a boss joined on top, open top', `const a = box(40,40,10); const c = box(10,10,10,{at:[0,0,10]}); const u = join(a, c); hollow(u, {wall: 2, open:"top"});`);
  add('hollow-join-boss-bottom', 'h-nonconvex', 'hollow of a box with a boss joined on top, open bottom', `const a = box(40,40,10); const c = box(10,10,10,{at:[0,0,10]}); const u = join(a, c); hollow(u, {wall: 2, open:"bottom"});`);
  add('hollow-join-pillar', 'h-nonconvex', 'hollow of a box with a pillar through it, open top', `const a = box(40,40,20); const c = box(10,10,30,{at:[0,0,0]}); const r = join(a, c); hollow(r, {wall: 2, open:"top"});`);
  add('hollow-join-cylinder-boss', 'h-nonconvex', 'hollow of a cylinder with a cylinder boss, open bottom', `const a = cylinder(40, 10); const c = cylinder(10, 10, {at:[0,0,10]}); const u = join(a, c); hollow(u, {wall: 2, open:"bottom"});`);
  add('hollow-slot-top', 'h-nonconvex', 'hollow open:top of a box with a slot cut across it', `const a = box(40,40,20); const c = box(10,50,12,{at:[0,0,4]}); const r = cut(a, c); hollow(r, {wall: 2, open:"top"});`);
  add('hollow-slot-bottom', 'h-nonconvex', 'hollow open:bottom of a box with a slot cut across it', `const a = box(40,40,20); const c = box(10,50,12,{at:[0,0,4]}); const r = cut(a, c); hollow(r, {wall: 2, open:"bottom"});`);
  add('hollow-pocket-top', 'h-nonconvex', 'hollow of a pocketed extrude, open top', `const s1 = sketch('top'); s1.polygon([[0,0],[40,0],[40,30],[0,30]]); const p = extrude(s1, 10); const s2 = sketch('top', 10); s2.polygon([[10,10],[20,10],[20,20],[10,20]]); pocket(s2, p, 5); hollow(p, {wall: 1.5, open:'top'});`);
  add('hollow-mirror', 'h-nonconvex', 'hollow of a mirrored (joined) part', `const b = box(40, 30, 12, {at:[30,10,0]}); const m = mirror(b, "left-right"); hollow(m, {wall: 2, open:"top"});`, { expect: () => hollowE(boxP([80, 30, 12], [10, 10, 0]), 'top', 2) }); // round 4: the mirror through the near face makes an 80 wide plain block
  add('hollow-repeat-top', 'h-nonconvex', 'hollow open:top of three repeated boxes', `const b = box(10, 10, 12); const r = repeat(b, {count:3, step:15}); hollow(r, {wall: 1, open:"top"});`);
  add('hollow-twice', 'h-nonconvex', 'hollow applied twice', `const b = box(40,40,20); hollow(b, {wall: 2, open:"top"}); hollow(b, {wall: 1, open:"bottom"});`);
  add('hollow-blind-hole', 'h-nonconvex', 'hollow open:top of a box with a blind hole', `const b = box(40,40,20); hole(b, {across: 6, deep: 10, at:[8,5]}); hollow(b, {wall: 2, open:"top"});`);

  // ---- hollow: after move / turn (G-PICK) -------------------------------------------------------------------------------------------
  const A = `const b = ${bxs}; `;
  const mv = (id, move, word, note) => {
    add(id, 'h-move', note, `${A}const m = move(b, [${move}]); hollow(m, {wall: 2, open: "${word}"});`, { expect: () => hollowE(boxP(BX.s, BX.c.map((v, i) => v + move[i])), word, 2), expectAlt: hollowAlt(boxP(BX.s, BX.c.map((v, i) => v + move[i])), word, 2) });
  };
  mv('hollow-move-dz12-top', [0, 0, 12], 'top', 'hollow open:top after move by the part height (old top centre sits on new bottom)');
  mv('hollow-move-dz-12-bottom', [0, 0, -12], 'bottom', 'hollow open:bottom after move down by the part height');
  mv('hollow-move-dx-40-right', [-40, 0, 0], 'right', 'hollow open:right after move by the part width');
  mv('hollow-move-dy-30-back', [0, -30, 0], 'back', 'hollow open:back after move by the part depth');
  mv('hollow-move-small-top', [1, 2, 3], 'top', 'hollow open:top after a small move');
  mv('hollow-move-dx5-top', [5, 0, 0], 'top', 'hollow open:top after an x move that keeps the old centre on the face');
  mv('hollow-move-far-top', [100, 50, 7], 'top', 'hollow open:top after a long move');
  mv('hollow-move-left-dx-40', [40, 0, 0], 'left', 'hollow open:left after a move');
  for (const [id, rot, word] of [['hollow-turn-z30-top', [0, 0, 30], 'top'], ['hollow-turn-z30-right', [0, 0, 30], 'right'], ['hollow-turn-z90-right', [0, 0, 90], 'right'], ['hollow-turn-y45-top', [0, 45, 0], 'top'], ['hollow-turn-y45-right', [0, 45, 0], 'right'], ['hollow-turn-x90-front', [90, 0, 0], 'front']]) {
    add(id, 'h-move', `hollow open:${word} on a part turned at creation (${rot})`, `const b = box(40, 30, 12, {at:[30,10,0]}); turn(b, [${rot}]); hollow(b, {wall: 2, open: "${word}"});`, { expect: () => hollowE(boxP([40, 30, 12], [30, 10, 0], rot), word, 2), expectAlt: hollowAlt(boxP([40, 30, 12], [30, 10, 0], rot), word, 2) });
  }
  add('hollow-move-cylinder-top', 'h-move', 'hollow open:top on a cylinder after a move up by its height', `const c = cylinder(24, 30, { at: [5, 3, 2] }); const m = move(c, [0, 0, 30]);\nhollow(m, { wall: 2, open: 'top' });`, { expect: () => cylHollow(12, 30, 2, [5, 3, 32], 'top'), expectAlt: () => cylHollow(12, 30, 2, [5, 3, 32], 'bottom') });
  add('hollow-move-extrude-top', 'h-move', 'hollow open:top on a rectangle extrude after a move up by its height', ex('top', rect, 10, `const m = move(p, [0, 0, 10]); hollow(m, {wall: 2, open:'top'});`), { expect: () => hollowE(boxP([40, 30, 10], [20, 15, 15]), 'top', 2), expectAlt: () => hollowE(boxP([40, 30, 10], [20, 15, 15]), 'bottom', 2) });
  add('hollow-move-hex-top', 'h-move', 'hollow open:top on a hexagon prism after a move up by its height', `const s = prism(6, 30, 20); const m = move(s, [0, 0, 20]);\nhollow(m, { wall: 2, open: 'top' });`, { expect: () => hollowE(P.translatePlanes(P.prismPlanes(6, 15, 20), [0, 0, 20]), 'top', 2), expectAlt: () => hollowE(P.translatePlanes(P.prismPlanes(6, 15, 20), [0, 0, 20]), 'bottom', 2) });
  for (const w of ['right', 'left', 'front', 'back', 'top']) {
    add(`hollow-turn-z45-square-${w}`, 'h-tie-box', `hollow open:${w} on a 40x40x12 box turned 45 degrees about z (word may name two faces)`, `const b = box(40, 40, 12, {at:[5,5,0]}); turn(b, [0,0,45]); hollow(b, {wall: 2, open: "${w}"});`, {
      expect: () => { const pl = boxP([40, 40, 12], [5, 5, 0], [0, 0, 45]); const wp = P.wordPlane(pl, WORD[w]); return { ...hollowE(pl, w, 2), ambiguous: wp.ties > 1 }; },
    });
  }
  add('hollow-then-turn', 'h-move', 'turn applied after the hollow', `const b = box(40, 30, 12, {at:[30,10,0]}); hollow(b, {wall: 2, open: "top"}); turn(b, [0,0,30]);`, {
    expect: () => { const h = hollowE(boxP([40, 30, 12]), 'top', 2); const R = P.rotatePlanes([{ n: [1, 0, 0], d: 0 }], [0, 0, 30])[0].n; const rotv = (v) => { const a = 30 * Math.PI / 180; return [Math.cos(a) * v[0] - Math.sin(a) * v[1], Math.sin(a) * v[0] + Math.cos(a) * v[1], v[2]]; }; const c = rotv(h.com); return { volume: h.volume, com: [c[0] + 30, c[1] + 10, c[2]] }; },
  });
  add('hollow-after-move-then-move', 'h-move', 'hollow then move the hollow part', `const b = ${bxs}; hollow(b, {wall: 2, open: "top"}); const m = move(b, [0,0,12]);`, { expect: () => { const h = hollowE(bxP(), 'top', 2); return { volume: h.volume, com: [h.com[0], h.com[1], h.com[2] + 12] }; } });

  // ---- hollow: holes -----------------------------------------------------------------------------------------------------------------
  const holeZ = (x, y, r, w, open) => 0; // placeholder to keep the linter quiet
  const body = 40 * 40 * 20;
  const holeFormulaZ = (r, t) => ({ volume: body - Math.PI * r * r * 20 - (36 * 36 * 18 - Math.PI * (r + t) ** 2 * 18) }); // open top/bottom, hole along z through
  const holeFormulaX_top = (r, t) => ({ volume: body - Math.PI * r * r * 40 - (36 * 36 * 18 - Math.PI * (r + t) ** 2 * 36) });
  const holeFormulaX_right = (r, t) => ({ volume: body - Math.PI * r * r * 40 - (36 * 16 * 38 - Math.PI * (r + t) ** 2 * 38) });
  add('hollow-hole-offcentre-top', 'h-holes', 'hollow open:top after a through hole (off-centre, along z)', `const b = box(40,40,20); hole(b, {across: 6, deep: 22, at:[8,5]}); hollow(b, {wall: 2, open:"top"});`, { expect: () => holeFormulaZ(3, 2) });
  add('hollow-hole-offcentre-bottom', 'h-holes', 'hollow open:bottom after a through hole (off-centre, along z)', `const b = box(40,40,20); hole(b, {across: 6, deep: 22, at:[8,5]}); hollow(b, {wall: 2, open:"bottom"});`, { expect: () => holeFormulaZ(3, 2) });
  add('hollow-hole-centred-top', 'h-holes', 'hollow open:top after a centred through hole (the face centre is in the hole)', `const b = box(40,40,20); hole(b, {across: 6, deep: 22}); hollow(b, {wall: 2, open:"top"});`, { expect: () => holeFormulaZ(3, 2) });
  add('hollow-hole-x-top', 'h-holes', 'hollow open:top after a through hole along x', `const b = box(40,40,20); hole(b, {across: 6, deep: 42, along:"x"}); hollow(b, {wall: 2, open:"top"});`, { expect: () => holeFormulaX_top(3, 2) });
  add('hollow-hole-x-right', 'h-holes', 'hollow open:right after a through hole along x (the open face has the hole)', `const b = box(40,40,20); hole(b, {across: 6, deep: 42, along:"x"}); hollow(b, {wall: 2, open:"right"});`, { expect: () => holeFormulaX_right(3, 2) });
  add('hollow-holes-corner-top', 'h-holes', 'hollow open:top after four corner through holes', `const b = box(60,60,20); holes(b, {across: 4, deep: 22, apart: [20, 20]}); hollow(b, {wall: 2, open:"top"});`, { expect: () => ({ volume: 60 * 60 * 20 - 4 * Math.PI * 4 * 20 - (56 * 56 * 18 - 4 * Math.PI * 16 * 18) }) });

  // ---- hollow after round -------------------------------------------------------------------------------------------------------------
  const steiner = (a, b, c, r) => (a - 2 * r) * (b - 2 * r) * (c - 2 * r) + 2 * r * ((a - 2 * r) * (b - 2 * r) + (b - 2 * r) * (c - 2 * r) + (a - 2 * r) * (c - 2 * r)) + Math.PI * r * r * ((a - 2 * r) + (b - 2 * r) + (c - 2 * r)) + 4 / 3 * Math.PI * r ** 3;
  for (const [r, t] of [[1, 2], [1.5, 2], [2, 2], [3, 2]]) {
    add(`hollow-round-r${r}-wall${t}`, 'h-round', `hollow open:top after round(box, ${r}) with wall ${t}`, `const b = box(40,40,20); round(b, ${r}); hollow(b, {wall: ${t}, open:"top"});`, { expect: () => (r < t ? { volume: steiner(40, 40, 20, r) - (40 - 2 * t) * (40 - 2 * t) * (20 - t) } : null) });
  }

  // single-edge round / bevel, then hollow open:top (box 40x40x20, wall 2). Outer volume = 32000 - (1 - pi/4) r^2 L (round) or c^2/2 L (bevel);
  // cavity = 36x36x18 box, its corner cut by the offset of the rounded/bevelled corner: sharp if r <= wall, an arc of radius r - wall otherwise.
  const kq = 1 - Math.PI / 4;
  const edgeRound = (r, t, edgeLen, cavLen, vertical) => ({ volume: 32000 - kq * r * r * edgeLen - (36 * 36 * 18 - (vertical && r > t ? kq * (r - t) ** 2 * cavLen : 0)) });
  // bevel of the open face's edge: the flat bevel face is offset inward by the wall too, so it cuts the cavity's top corner by a triangle with leg c + t sqrt2 - 2
  const bevelTop = (c, t) => { const leg = Math.max(0, c + t * Math.SQRT2 - 2); return { volume: 32000 - c * c / 2 * 40 - (36 * 36 * 18 - leg * leg / 2 * 36) }; };
  add('hollow-round-edge-vertical-r1', 'h-round', 'hollow open:top after rounding one vertical edge (r 1, wall 2)', `const b = box(40,40,20); round(b.edge('front','right'), 1); hollow(b, {wall: 2, open:"top"});`, { expect: () => edgeRound(1, 2, 20, 18, true) });
  add('hollow-round-edge-vertical-r3', 'h-round', 'hollow open:top after rounding one vertical edge (r 3 > wall 2)', `const b = box(40,40,20); round(b.edge('front','right'), 3); hollow(b, {wall: 2, open:"top"});`, { expect: () => edgeRound(3, 2, 20, 18, true) });
  add('hollow-round-edge-top-r1', 'h-round', 'hollow open:top after rounding one edge of the open face (r 1, wall 2)', `const b = box(40,40,20); round(b.edge('top','right'), 1); hollow(b, {wall: 2, open:"top"});`, { expect: () => edgeRound(1, 2, 40, 18, false) });
  add('hollow-round-edge-top-r2', 'h-round', 'hollow open:top after rounding one edge of the open face (r 2 = wall 2)', `const b = box(40,40,20); round(b.edge('top','right'), 2); hollow(b, {wall: 2, open:"top"});`);
  add('hollow-bevel-edge-top-1', 'h-round', 'hollow open:top after bevelling one edge of the open face (1, wall 2)', `const b = box(40,40,20); bevel(b.edge('top','right'), 1); hollow(b, {wall: 2, open:"top"});`, { expect: () => bevelTop(1, 2) });
  add('hollow-bevel-edge-top-2', 'h-round', 'hollow open:top after bevelling one edge of the open face (2 = wall 2)', `const b = box(40,40,20); bevel(b.edge('top','right'), 2); hollow(b, {wall: 2, open:"top"});`, { expect: () => bevelTop(2, 2) });
  add('hollow-bevel-edge-vertical', 'h-round', 'hollow open:top after bevelling one vertical edge (2, wall 2)', `const b = box(40,40,20); bevel(b.edge('front','right'), 2); hollow(b, {wall: 2, open:"top"});`, { expect: () => ({ volume: 32000 - 2 * 2 / 2 * 20 - (36 * 36 * 18 - (2 * Math.SQRT2 - 2) ** 2 / 2 * 18) }) });
  // ---- hollow with draft ----------------------------------------------------------------------------------------------------------------
  const drafted = (drafts) => { const pl = bxP(); const q = pl.map((p) => ({ ...p })); for (const d of drafts) { const { index } = P.wordPlane(pl, WORD[d.word]); q[index] = P.draftPlane(pl[index], d.pull, d.neutral, d.deg, sigma); } return q; };
  add('hollow-after-draft', 'h-combo', 'draft(face) then hollow open:top', `const b = ${bxs};\ndraft(b.face('right'), 5);\nhollow(b, { wall: 2, open: 'top' });`, { expect: () => hollowE(drafted([{ word: 'right', deg: 5, pull: 'z', neutral: 0 }]), 'top', 2) });
  add('hollow-after-draft-from-bottom', 'h-combo', 'draft(face, {from:bottom}) then hollow open:top', `const b = ${bxs};\ndraft(b.face('front'), 8, { from: 'bottom' });\nhollow(b, { wall: 2, open: 'top' });`, { expect: () => hollowE(drafted([{ word: 'front', deg: 8, pull: 'z', neutral: -3 }]), 'top', 2) });
  add('hollow-after-draft-open-right', 'h-combo', 'draft(right) then hollow open:right (the opened face was drafted)', `const b = ${bxs};\ndraft(b.face('right'), 5);\nhollow(b, { wall: 2, open: 'right' });`, { expect: () => hollowE(drafted([{ word: 'right', deg: 5, pull: 'z', neutral: 0 }]), 'right', 2) });
  add('draft-after-hollow', 'h-combo', 'hollow open:top then draft(face)', `const b = ${bxs};\nhollow(b, { wall: 2, open: 'top' });\ndraft(b.face('right'), 5);`, {
    expect: () => {
      const pl = bxP(); const dr = drafted([{ word: 'right', deg: 5, pull: 'z', neutral: 0 }]);
      const outer = P.measure(dr);
      const idx = P.wordPlane(pl, '+z').index;
      const cav = pl.map((p, i) => (i === idx ? p : { n: p.n, d: p.d - 2 })); cav.push(dr[0]);
      const cm = P.measure(cav); const V = outer.volume - cm.volume;
      return { volume: V, com: outer.com.map((c, k) => (outer.volume * c - cm.volume * cm.com[k]) / V), bbox: outer.bbox };
    },
  });
  add('draft-after-closed-hollow', 'h-combo', 'closed hollow then draft', `const b = box(40,40,20); hollow(b, {wall: 2}); draft(b.face("right"), 5, {from:"bottom"});`);

  // ---- hollow: misc picks ------------------------------------------------------------------------------------------------------------
  add('hollow-wrong-script-word', 'h-misc', 'hollow open: not a face word', `const b = ${bxs};\nhollow(b, { wall: 2, open: 'side' });`);

  // =============================== DRAFT ===============================================================================================
  const D = (word, deg, extra = {}) => ({ word, deg, pull: extra.pull ?? 'z', neutral: extra.neutral ?? 0 });
  const dBox = (drafts, size = BX.s, c = BX.c) => () => draftE(boxP(size, c), drafts);
  const dcase = (id, group, feature, face, deg, opts, drafts, extra = {}) => {
    const o = opts ? `, ${opts}` : '';
    add(id, group, feature, `const b = ${bxs};\ndraft(b.face('${face}'), ${deg}${o});`, { expect: dBox(drafts), ...extra });
  };
  const lo = (a) => BX.c[AXI[a]] - BX.s[AXI[a]] / 2;
  const hi = (a) => BX.c[AXI[a]] + BX.s[AXI[a]] / 2;
  for (const f of ['right', 'left', 'front', 'back']) dcase(`draft-${f}-default`, 'd-box', `draft(shape.face('${f}'), 8) default pull z, neutral 0`, f, 8, '', [D(f, 8)], { expectAlt: () => draftE(boxP(BX.s, BX.c), [D(OPP[f], 8)]) });
  for (const f of ['top', 'bottom']) dcase(`draft-${f}-default-parallel-to-pull`, 'd-box', `draft(shape.face('${f}'), 8) default pull z`, f, 8, '', [D(f, 8)], { expect: undefined });

  for (const d of [0, 1, 8, 30, 45, 60, 70, 77, -8, -45, -60, -80, -85]) dcase(`draft-right-angle-${d}`, 'd-angle', `draft angle ${d}`, 'right', d, '', [D('right', d)]);
  for (const d of [78, 80, 85, 89, -86, -89]) dcase(`draft-right-angle-${d}-steep`, 'd-angle', `draft angle ${d} (steep)`, 'right', d, '', [D('right', d)]);
  for (const d of [90, 95, 89.99, 89.5, -90]) dcase(`draft-right-angle-${d}-limit`, 'd-angle', `draft angle ${d} (limit)`, 'right', d, '', [D('right', d)], { shouldRefuse: true });
  add('draft-right-1deg-3x', 'd-angle', 'draft angle 1 at 3x scale', `const b = box(120, 90, 36, { at: [45, -21, 9] });\ndraft(b.face('right'), 1, { neutral: -9 });`, { expect: () => draftE(boxP([120, 90, 36], [45, -21, 9]), [D('right', 1, { neutral: -9 })]) });

  for (const n of [-3, 0, 5, 9, 12, -10, 50, -50]) dcase(`draft-right-neutral-${n}`, 'd-neutral', `draft neutral:${n}`, 'right', 8, `{ neutral: ${n} }`, [D('right', 8, { neutral: n })]);
  dcase('draft-right-from-bottom-neutral-override', 'd-neutral', 'draft from+neutral (neutral wins)', 'right', 8, `{ from: 'bottom', neutral: 4 }`, [D('right', 8, { neutral: 4 })]);

  for (const w of ['bottom', 'top']) dcase(`draft-right-from-${w}`, 'd-from', `draft from:${w}`, 'right', 8, `{ from: '${w}' }`, [D('right', 8, { neutral: w === 'bottom' ? lo('z') : hi('z') })]);
  for (const w of ['front', 'back']) dcase(`draft-right-from-${w}`, 'd-from', `draft from:${w}`, 'right', 8, `{ from: '${w}' }`, [D('right', 8, { pull: 'y', neutral: w === 'front' ? lo('y') : hi('y') })]);
  for (const w of ['left', 'right']) dcase(`draft-top-from-${w}`, 'd-from', `draft from:${w}`, 'top', 8, `{ from: '${w}' }`, [D('top', 8, { pull: 'x', neutral: w === 'left' ? lo('x') : hi('x') })]);
  dcase('draft-front-from-left', 'd-from', 'draft from:left', 'front', 8, `{ from: 'left' }`, [D('front', 8, { pull: 'x', neutral: lo('x') })]);
  dcase('draft-left-from-bottom', 'd-from', 'draft from:bottom', 'left', 8, `{ from: 'bottom' }`, [D('left', 8, { neutral: lo('z') })]);
  dcase('draft-front-from-bottom', 'd-from', 'draft from:bottom', 'front', 8, `{ from: 'bottom' }`, [D('front', 8, { neutral: lo('z') })]);
  dcase('draft-back-from-top', 'd-from', 'draft from:top', 'back', 8, `{ from: 'top' }`, [D('back', 8, { neutral: hi('z') })]);
  dcase('draft-right-from-right-parallel', 'd-from', 'draft from:right on the right face (face parallel to pull)', 'right', 8, `{ from: 'right' }`, [D('right', 8, { pull: 'x', neutral: hi('x') })]);
  dcase('draft-top-from-top-parallel', 'd-from', 'draft from:top on the top face (face parallel to pull)', 'top', 8, `{ from: 'top' }`, [D('top', 8, { neutral: hi('z') })]);
  add('draft-bad-from', 'd-from', 'draft from: not a face word', `const b = ${bxs};\ndraft(b.face('right'), 8, { from: 'up' });`);

  // multi-face, repeated
  add('draft-two-sides', 'd-multi', 'draft(face) on two faces (right, left)', `const b = ${bxs};\ndraft(b.face('right'), 5);\ndraft(b.face('left'), 5);`, { expect: dBox([D('right', 5), D('left', 5)]) });
  add('draft-four-sides', 'd-multi', 'draft(face) on all four sides, one at a time', `const b = ${bxs};\ndraft(b.face('right'), 5);\ndraft(b.face('left'), 5);\ndraft(b.face('front'), 5);\ndraft(b.face('back'), 5);`, { expect: dBox([D('right', 5), D('left', 5), D('front', 5), D('back', 5)]) });
  add('draft-adjacent-two', 'd-multi', 'draft(face) on two adjacent faces', `const b = ${bxs};\ndraft(b.face('right'), 5);\ndraft(b.face('back'), 5);`, { expect: dBox([D('right', 5), D('back', 5)]) });
  add('draft-same-face-twice', 'd-multi', 'draft the same face twice', `const b = ${bxs};\ndraft(b.face('right'), 5);\ndraft(b.face('right'), 3);`, { shouldRefuse: true });
  const b40 = (s) => `const b = box(40, 40, 20); ${s}`;
  add('draft-opposite-30', 'd-multi', 'two opposite faces at 30 degrees (still fits)', b40(`draft(b.face("front"), 30, {from:"bottom"}); draft(b.face("back"), 30, {from:"bottom"});`), { expect: () => draftE(boxP([40, 40, 20]), [D('front', 30, { neutral: -10 }), D('back', 30, { neutral: -10 })]) });
  add('draft-opposite-50', 'd-multi', 'two opposite faces at 50 degrees (faces cross)', b40(`draft(b.face("front"), 50, {from:"bottom"}); draft(b.face("back"), 50, {from:"bottom"});`), { expect: () => draftE(boxP([40, 40, 20]), [D('front', 50, { neutral: -10 }), D('back', 50, { neutral: -10 })]) });
  add('draft-opposite-60', 'd-multi', 'two opposite faces at 60 degrees (faces cross)', b40(`draft(b.face("front"), 60, {from:"bottom"}); draft(b.face("back"), 60, {from:"bottom"});`), { expect: () => draftE(boxP([40, 40, 20]), [D('front', 60, { neutral: -10 }), D('back', 60, { neutral: -10 })]) });

  // whole-body (unsupported: mapping gap)
  const four = (deg, neutral) => [D('right', deg, { neutral }), D('left', deg, { neutral }), D('front', deg, { neutral }), D('back', deg, { neutral })];
  add('draft-whole-arg', 'd-whole', 'draft(shape, angle) whole-shape draft', `const b = ${bxs};\ndraft(b, 5);`, { expect: dBox(four(5, 0)), whole: true });
  add('draft-whole-option', 'd-whole', 'draft(face, angle, {whole:true})', `const b = ${bxs};\ndraft(b.face('right'), 5, { whole: true });`, { expect: dBox(four(5, 0)), whole: true });
  add('draft-whole-from-bottom', 'd-whole', 'draft whole with from:bottom', `const b = ${bxs};\ndraft(b, 5, { whole: true, from: 'bottom' });`, { expect: dBox(four(5, lo('z'))), whole: true });
  add('draft-whole-neutral', 'd-whole', 'draft whole with neutral:3', `const b = ${bxs};\ndraft(b, 5, { whole: true, neutral: 3 });`, { expect: dBox(four(5, 3)), whole: true });
  add('draft-whole-cylinder', 'd-whole', 'draft whole on a cylinder', `const c = cylinder(24, 30);\ndraft(c, 5, { whole: true });`, { whole: true });
  add('draft-whole-sphere', 'd-whole', 'draft whole on a sphere', `const s = sphere(30);\ndraft(s, 5, { whole: true });`, { whole: true });

  // curved
  add('draft-cylinder-side', 'd-curved', 'draft(face) on the curved side of a cylinder', `const c = cylinder(24, 30);\ndraft(c.face('side'), 5);`, { expect: () => { const R = 12, H = 30, k = Math.tan(5 * Math.PI / 180); const r0 = (z) => R + sigma * k * (z - 0); const a = -15, b = 15; return { volume: Math.PI / 3 * (r0(b) ** 3 - r0(a) ** 3) / (sigma * k) }; } });
  add('draft-cylinder-top-default', 'd-curved', 'draft(face) on a cylinder cap (parallel to pull)', `const c = cylinder(24, 30);\ndraft(c.face('top'), 5);`);
  add('draft-sphere-face', 'd-curved', 'draft(face) on a sphere', `const s = sphere(30);\ndraft(s.face("right"), 5);`);

  // prisms / wedge / extrude
  for (const n of [3, 4, 5, 6, 7, 8, 10, 12]) for (const w of ['right', 'left', 'front', 'back']) {
    add(`draft-prism${n}-${w}`, 'd-prism', `draft ${w} on a ${n}-sided prism`, `const s = prism(${n}, 30, 20);\ndraft(s.face('${w}'), 5, {neutral: -10});`, {
      expect: () => { const pl = P.prismPlanes(n, 15, 20); const wp = P.wordPlane(pl, WORD[w]); return { ...draftE(pl, [D(w, 5, { neutral: -10 })]), ambiguous: wp.ties > 1 }; },
    });
  }
  for (const w of ['right', 'left', 'front', 'back']) add(`draft-wedge-${w}`, 'd-prism', `draft ${w} on a wedge`, `const s = wedge(30, 20, 15);\ndraft(s.face("${w}"), 5, {neutral: -7.5});`, { expect: () => { const pl = P.wedgePlanes(30, 20, 15); const wp = P.wordPlane(pl, WORD[w]); return { ...draftE(pl, [D(w, 5, { neutral: -7.5 })]), ambiguous: wp.ties > 1 }; } });
  for (const w of ['right', 'left', 'front', 'back']) add(`draft-extrude-rect-${w}`, 'd-prism', `draft ${w} on a rectangle extrude`, ex('top', rect, 10, `draft(p.face('${w}'), 5, {from:'bottom'});`), { expect: () => draftE(boxP([40, 30, 10], [20, 15, 5]), [D(w, 5, { neutral: 0 })]) });
  add('draft-extrude-circle-top', 'd-prism', 'draft top of a circle extrude (cap)', `const s1 = sketch('top'); s1.circle(30); const p = extrude(s1, 10); draft(p.face('top'), 5, {from:'bottom'});`);

  // non-convex
  for (const w of ['right', 'left', 'back', 'front']) add(`draft-L-${w}`, 'd-nonconvex', `draft ${w} on an L-shaped extrude`, ex('top', Lstr, 10, `draft(p.face('${w}'), 5, {neutral: 0});`));
  add('draft-U-right', 'd-nonconvex', 'draft right on a slotted box', `const a = box(40,40,20); const c = box(10,50,12,{at:[0,0,4]}); const r = cut(a, c); draft(r.face("right"), 5, {neutral: -10});`);
  const joinL = (neutral) => () => sumE(draftE(boxP([40, 20, 10]), [D('right', 5, { neutral })]), draftE(boxP([20, 20, 10], [10, 20, 0]), [D('right', 5, { neutral })]));
  add('draft-join-right', 'd-nonconvex', 'draft right on an L made of two joined boxes', `const a = box(40,20,10); const c = box(20,20,10,{at:[10,20,0]}); const u = join(a, c); draft(u.face("right"), 5, {neutral: -5});`, { expect: joinL(-5) });
  add('draft-hole-z-right', 'd-nonconvex', 'draft right on a box with a through hole along z', `const b = box(40,40,20); hole(b, {across: 6, deep: 22, at:[8,5]}); draft(b.face('right'), 5, {neutral: -10});`);
  add('draft-hole-x-right', 'd-nonconvex', 'draft right (the face with the hole through it) on a box with a hole along x', `const b = box(40,40,20); hole(b, {across: 6, deep: 42, along:"x"}); draft(b.face("right"), 5, {neutral: -10});`);
  add('draft-hole-x-right-offcentre', 'd-nonconvex', 'draft right on a box with an off-centre hole along x', `const b = box(40,40,20); hole(b, {across: 6, deep: 42, along:"x", at:[5,3]}); draft(b.face("right"), 5, {neutral: -10});`);
  add('draft-round-right', 'd-nonconvex', 'draft right on a rounded box', `const b = box(40,40,20); round(b, 3); draft(b.face('right'), 5, {neutral: -10});`);

  add('draft-notch-front', 'd-nonconvex', 'draft front (a face cut in two by a notch) on a notched box', `const a = box(40,40,20); const c = box(10,10,30,{at:[8,-20,0]}); const r = cut(a, c); draft(r.face("front"), 5, {neutral: -10});`);
  add('draft-notch-right', 'd-nonconvex', 'draft right on a box with a notch in the front face', `const a = box(40,40,20); const c = box(10,10,30,{at:[8,-20,0]}); const r = cut(a, c); draft(r.face("right"), 5, {neutral: -10});`);
  add('draft-boss-base-right', 'd-nonconvex', 'draft right on a box with a boss joined on top', `const a = box(40,40,10); const c = box(10,10,10,{at:[0,0,10]}); const u = join(a, c); draft(u.face("right"), 5, {neutral: -5});`);
  add('draft-blind-hole-z-right', 'd-nonconvex', 'draft right on a box with a blind hole along z', `const b = box(40,40,20); hole(b, {across: 6, deep: 10, at:[8,5]}); draft(b.face('right'), 5, {neutral: -10});`);
  // after move / turn
  const dmv = (id, move, word, neutralOpt, note) => add(id, 'd-move', note, `${A}const m = move(b, [${move}]); draft(m.face('${word}'), 5, ${neutralOpt});`, { expect: () => draftE(boxP(BX.s, BX.c.map((v, i) => v + move[i])), [D(word, 5, { neutral: 0 })]), expectAlt: () => draftE(boxP(BX.s, BX.c.map((v, i) => v + move[i])), [D(OPP[word], 5, { neutral: 0 })]) });
  dmv('draft-move-dx40-right', [40, 0, 0], 'right', '{ neutral: 0 }', 'draft right after move +40 in x (neutral given)');
  dmv('draft-move-dx-40-left', [-40, 0, 0], 'left', '{ neutral: 0 }', 'draft left after move -40 in x');
  dmv('draft-move-dy30-back', [0, 30, 0], 'back', '{ neutral: 0 }', 'draft back after move +30 in y');
  dmv('draft-move-dz12-right', [0, 0, 12], 'right', '{ neutral: 0 }', 'draft right after move up 12');
  add('draft-turn-z30-right', 'd-move', 'draft right on a part turned at creation (z 30)', `const b = box(40, 30, 12, {at:[30,10,0]}); turn(b, [0,0,30]); draft(b.face('right'), 5, {neutral: 0});`, { expect: () => draftE(boxP([40, 30, 12], [30, 10, 0], [0, 0, 30]), [D('right', 5, { neutral: 0 })]) });
  add('draft-turn-z90-right', 'd-move', 'draft right on a part turned 90 at creation', `const b = box(40, 30, 12, {at:[30,10,0]}); turn(b, [0,0,90]); draft(b.face('right'), 5, {neutral: 0});`, { expect: () => draftE(boxP([40, 30, 12], [30, 10, 0], [0, 0, 90]), [D('right', 5, { neutral: 0 })]) });
  add('draft-turn-after-draft', 'd-move', 'draft then turn', `const b = box(40, 30, 12, {at:[30,10,0]}); draft(b.face('right'), 5, {neutral: 0}); turn(b, [0,0,30]);`);
  add('draft-turn-then-draft-feature', 'd-move', 'draft after a turn that is a separate step (box, draft, turn, draft)', `const b = box(40, 30, 12, {at:[30,10,0]}); draft(b.face('right'), 5, {neutral: 0}); turn(b, [0,0,30]); draft(b.face('left'), 5, {neutral: 0});`);

  // from after things that move the part (G-FROM)
  const fs = (id, note, script, extra = {}) => add(id, 'd-fromstale', note, script, extra);
  fs('draft-from-bottom-unmoved-box', 'from:bottom on an unmoved box at the origin (control)', `const b = box(40, 40, 20);\ndraft(b.face('right'), 5, { from: 'bottom' });`, { expect: () => draftE(boxP([40, 40, 20]), [D('right', 5, { neutral: -10 })]) });
  fs('draft-from-bottom-after-move', 'from:bottom after the part was moved up', `const b = box(40, 40, 20); const m = move(b, [0,0,30]);\ndraft(m.face('right'), 5, { from: 'bottom' });`, { expect: () => draftE(boxP([40, 40, 20], [0, 0, 30]), [D('right', 5, { neutral: 20 })]) });
  fs('draft-from-bottom-after-turn', 'from:bottom after the part was turned about x', `const b = box(40, 40, 20); turn(b, [90,0,0]);\ndraft(b.face('right'), 5, { from: 'bottom' });`, { expect: () => draftE(boxP([40, 40, 20], [0, 0, 0], [90, 0, 0]), [D('right', 5, { neutral: -20 })]) });
  fs('draft-from-bottom-after-join', 'from:bottom after a join', `const a = box(40,20,10); const c = box(20,20,10,{at:[10,20,0]}); const u = join(a, c);\ndraft(u.face("right"), 5, { from: "bottom" });`, { expect: () => joinL(-5)() });
  fs('draft-from-bottom-prism-offset', 'from:bottom on a prism placed off the origin', `const s = prism(6, 30, 20, { at: [0, 0, 15] });\ndraft(s.face('back'), 5, { from: 'bottom' });`, { expect: () => draftE(P.translatePlanes(P.prismPlanes(6, 15, 20), [0, 0, 15]), [D('back', 5, { neutral: 5 })]) });
  fs('draft-from-bottom-prism-origin', 'from:bottom on a prism at the origin (bottom is -10)', `const s = prism(6, 30, 20);\ndraft(s.face('back'), 5, { from: 'bottom' });`, { expect: () => draftE(P.prismPlanes(6, 15, 20), [D('back', 5, { neutral: -10 })]) });
  fs('draft-from-bottom-wedge-origin', 'from:bottom on a wedge at the origin (bottom is -7.5)', `const s = wedge(30, 20, 15);\ndraft(s.face('left'), 5, { from: 'bottom' });`, { expect: () => draftE(P.wedgePlanes(30, 20, 15), [D('left', 5, { neutral: -7.5 })]) });
  fs('draft-from-bottom-extrude-lifted', 'from:bottom on an extrude lifted by a sketch offset', `const s1 = sketch('top', 7); s1.polygon([[0,0],[40,0],[40,30],[0,30]]); const p = extrude(s1, 10);\ndraft(p.face('right'), 5, { from: 'bottom' });`, { expect: () => draftE(boxP([40, 30, 10], [20, 15, 12]), [D('right', 5, { neutral: 7 })]) });
  fs('draft-from-top-after-hollow', 'from:top after a hollow (bbox unchanged)', `const b = box(40, 40, 20);\nhollow(b, { wall: 2, open: 'top' });\ndraft(b.face('right'), 5, { from: 'top' });`);
  fs('draft-neutral-explicit-after-move', 'explicit neutral after a move (must not be second-guessed)', `const b = box(40, 40, 20); const m = move(b, [0,0,30]);\ndraft(m.face('right'), 5, { neutral: 20 });`, { expect: () => draftE(boxP([40, 40, 20], [0, 0, 30]), [D('right', 5, { neutral: 20 })]) });

  // tiny angles
  for (const d of [0.001, 0.000001]) add(`draft-tiny-${d}`, 'd-tiny', `draft angle ${d}`, `const b = box(40,40,20); draft(b.face("front"), ${d}, {from:"bottom"});`, { expect: () => draftE(boxP([40, 40, 20]), [D('front', d, { neutral: -10 })]) });

  // draft + hollow
  add('draft-then-hollow-40x40x20', 'd-combo', 'draft then hollow on 40x40x20', `const b = box(40,40,20); draft(b.face('right'), 5, {from:'bottom'}); hollow(b, {wall: 2, open:'top'});`, { expect: () => hollowE((() => { const pl = boxP([40, 40, 20]); const q = pl.map((p) => ({ ...p })); q[0] = P.draftPlane(pl[0], 'z', -10, 5, sigma); return q; })(), 'top', 2) });
    // ---- through hole at random positions (some close enough to the wall to cut it): hollow open:top, box 40x40x20, wall 2, hole d6 ------------------------------
  // closed form: V = box - disc(r) ∩ plan * 20  -  (inner 36x36 plan - disc(r+t) ∩ inner plan) * 18, the disc-rectangle areas integrated numerically (error ~1e-9)
  const discRect = (cx, cy, rad, x0, x1, y0, y1) => { const N = 200000; let A = 0; const lo = Math.max(x0, cx - rad), hi = Math.min(x1, cx + rad); if (hi <= lo) return 0; const dx = (hi - lo) / N; for (let i = 0; i < N; i++) { const x = lo + (i + 0.5) * dx; const h = Math.sqrt(Math.max(0, rad * rad - (x - cx) ** 2)); const a = Math.max(y0, cy - h), b = Math.min(y1, cy + h); if (b > a) A += (b - a) * dx; } return A; };
  let hs = 7;
  const hr = () => { hs = (hs * 1103515245 + 12345) % 2147483648; return hs / 2147483648; };
  for (const [hx, hy] of [[0, 0], [8, 5], [12, 12], [14, 0], [15, -10], [16, 16], [17, 0], [18, 6], [-19, 0], [20, 0], [-12, 17], [10, -16], [6, 6], [-15, 15]].concat(Array.from({ length: 6 }, () => [+(hr() * 36 - 18).toFixed(1), +(hr() * 36 - 18).toFixed(1)]))) {
    add(`hollow-hole-pos-${hx}_${hy}`, 'h-holepos', `hollow open:top after a through hole d6 at [${hx}, ${hy}]`, `const b = box(40,40,20); hole(b, {across: 6, deep: 22, at:[${hx},${hy}]}); hollow(b, {wall: 2, open:"top"});`, {
      expect: () => { const Vb = 40 * 40 * 20 - discRect(hx, hy, 3, -20, 20, -20, 20) * 20; const cav = (36 * 36 - discRect(hx, hy, 5, -18, 18, -18, 18)) * 18; return { volume: Vb - cav }; },
    });
  }
  // ---- seeded random boxes: hollow and draft after any mix of move / turn, against the closed form --------------------------------------------
  let seed = 20261017;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const rr = (a, b) => +(a + rnd() * (b - a)).toFixed(1);
  for (let k = 0; k < 40; k++) {
    const size = [rr(20, 70), rr(20, 70), rr(10, 40)];
    const c = [rr(-50, 50), rr(-50, 50), rr(-30, 30)];
    const turnKind = pick(['none', 'none', 'z90', 'z37', 'x90', 'y90', 'z180']);
    const rot = { none: [0, 0, 0], z90: [0, 0, 90], z37: [0, 0, 37], x90: [90, 0, 0], y90: [0, 90, 0], z180: [0, 0, 180] }[turnKind];
    const mv = pick([null, null, [rr(-60, 60), rr(-60, 60), rr(-40, 40)]]);
    const word = pick(Object.keys(WORD));
    const pl0 = boxP(size, c, rot);
    const base = mv ? P.translatePlanes(pl0, mv) : pl0;
    const limit = Math.min(...size) / 2.2; // the part's own thinnest dimension, whatever the turn
    const wall = +(limit * (0.1 + 0.8 * rnd())).toFixed(2);
    const turnS = rot.some(Boolean) ? ` turn(b, [${rot}]);` : '';
    const body = `const b = box(${size}, {at:[${c}]});${turnS}`;
    const call = mv ? ` const m = move(b, [${mv}]); hollow(m, {wall: ${wall}, open: "${word}"});` : ` hollow(b, {wall: ${wall}, open: "${word}"});`;
    add(`fuzz-hollow-${String(k).padStart(2, '0')}`, 'h-fuzz', `random box ${turnKind}${mv ? '+move' : ''} open:${word}`, body + call, {
      expect: () => { const wp = P.wordPlane(base, WORD[word]); const e0 = hollowE(base, word, wall); return { ...e0, ambiguous: wp.ties > 1 }; },
      expectAlt: hollowAlt(base, word, wall),
    });
  }
  for (let k = 0; k < 40; k++) {
    const size = [rr(20, 70), rr(20, 70), rr(15, 40)];
    const c = [rr(-50, 50), rr(-50, 50), rr(-30, 30)];
    const rot = pick([[0, 0, 0], [0, 0, 0], [0, 0, 90], [0, 0, 29], [90, 0, 0], [0, 90, 0]]);
    const mv = pick([null, null, [rr(-60, 60), rr(-60, 60), rr(-40, 40)]]);
    const base = P.translatePlanes(boxP(size, c, rot), mv ?? [0, 0, 0]);
    const bb = P.measure(base).bbox;
    const word = pick(['right', 'left', 'front', 'back']);
    const deg = rr(-30, 30) || 5;
    const neutral = +(bb[2] + rnd() * (bb[5] - bb[2]) + rr(-10, 10)).toFixed(1);
    const turnS = rot.some(Boolean) ? ` turn(b, [${rot}]);` : '';
    const body = `const b = box(${size}, {at:[${c}]});${turnS}`;
    const call = mv ? ` const m = move(b, [${mv}]); draft(m.face("${word}"), ${deg}, {neutral: ${neutral}});` : ` draft(b.face("${word}"), ${deg}, {neutral: ${neutral}});`;
    add(`fuzz-draft-${String(k).padStart(2, '0')}`, 'd-fuzz', `random box rot ${rot}${mv ? '+move' : ''} draft ${word} ${deg}deg neutral ${neutral}`, body + call, {
      expect: () => { const wp = P.wordPlane(base, WORD[word]); const pl = base; const idx = wp.index; const q = pl.map((p) => ({ ...p })); const p0 = pl[idx]; if (Math.abs(p0.n[2]) > 1e-9) return { skip: true, volume: NaN }; const m0 = P.measure(pl); q[idx] = P.draftPlane(p0, 'z', neutral, deg, sigma); const m = P.measure(q); return { volume: m.volume, com: m.com, bbox: m.bbox, vanish: m.faces !== m0.faces, ambiguous: wp.ties > 1 }; },
    });
  }
  return C;
}
