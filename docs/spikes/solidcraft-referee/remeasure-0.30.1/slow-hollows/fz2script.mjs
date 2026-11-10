// fz2script.mjs: a Stage B fuzz case (cases-s1.jsonl row) -> the reSHape Script a student would write for it, or {why} when it cannot be written.
// Conventions (packages/script): box(w,d,h) is centred on the origin; hole() drills from the +axis face, at: is the offset from the target's bbox centre;
// a recess (counterbore / countersink) sits at the mouth (+z); hollow() takes ONE open face of the root primitive.
const f2 = (v) => +(+v).toFixed(4);
export function toScript(c, { firstOpenOnly = false } = {}) {
  const m = structuredClone(c.meta); const t = c.t; const notes = [];
  if (c.family === 'stepped') {
    // U body: base box + two wall boxes joined, a hole through the left wall, the open face is the TOP OF THE LEFT WALL (not a face of the root box)
    const md = c.model;
    const s = `const b = box(24, 16, 3);\nconst w1 = box(6, 16, 6, { at: [-9, 0, 4.5] });\nconst w2 = box(6, 16, 6, { at: [9, 0, 4.5] });\njoin(b, w1);\njoin(b, w2);\nhole(b, { across: 4, at: [-9, 0] });\nhollow(b, { wall: ${t}, open: 'top' });`;
    return { exact: false, why: "hollow()'s open: names a face of the first shape (the base box, top at z = 3); the fuzz case opens the top of the left wall (z = 9), which no open: word names", script: s, variantOf: 'open top of the base instead of the wall top' };
  }
  const opens = m.open.split('+');
  const word = { top: 'top', bot: 'bottom', xp: 'right', xn: 'left', yp: 'back', yn: 'front' };
  let exact = true; let why = null;
  if (opens.length > 1) { exact = false; why = `the fuzz case opens ${opens.length} faces (${m.open}); hollow() leaves exactly one face open`; }
  const W = m.W, D = m.D, H = m.H;
  const L = [`const b = box(${W}, ${D}, ${H});`];
  let flipped = false;
  // every recess / blind / pocket on the bottom and none on the top: write the mirror image (z -> -z), which a student would draw that way up
  const faced = m.feats.filter((x) => x.face); const mirror = faced.length && faced.every((x) => x.face === 'bot');
  if (mirror) { notes.push('mirror image in z (every recess on the bottom face)'); m.feats = m.feats.map((x) => ({ ...x, face: x.face ? 'top' : x.face, zc: x.zc != null ? H - x.zc : x.zc })); opens.splice(0, opens.length, ...opens.map((o) => o === 'top' ? 'bot' : o === 'bot' ? 'top' : o)); }
  const flip = () => { L.push(`turn(b, [180, 0, 0]);`); flipped = !flipped; };
  for (const ft of m.feats) {
    const bot = ft.face === 'bot';
    if (bot !== flipped && ['cbore', 'csink', 'blind', 'slot', 'pocket'].includes(ft.kind)) flip();
    const y = (v) => f2(flipped ? -v : v);
    const thru = flipped || L.some((l) => l.startsWith('turn')) ? `, deep: ${H + 2}` : '';
    const at = `at: [${f2(ft.xc)}, ${y(ft.yc)}]`;
    switch (ft.kind) {
      case 'vthru': L.push(`hole(b, { across: ${f2(2 * ft.r)}, ${at}${thru} });`); break;
      case 'cbore': L.push(`hole(b, { across: ${f2(2 * ft.r)}, ${at}${thru}, counterbore: { across: ${f2(2 * ft.R)}, deep: ${f2(ft.d)} } });`); break;
      case 'csink': { const ang = 2 * Math.atan((ft.R - ft.r) / ft.dep) * 180 / Math.PI; L.push(`hole(b, { across: ${f2(2 * ft.r)}, ${at}${thru}, countersink${thru ? '' : ''}: { across: ${f2(2 * ft.R)}, angle: ${f2(ang)} } });`); break; }
      case 'blind': L.push(`hole(b, { across: ${f2(2 * ft.r)}, deep: ${f2(ft.d)}, ${at} });`); break;
      case 'slot': case 'pocket': { const top = flipped ? H / 2 : H / 2; L.push(`{ const s = sketch('top', ${f2(top)}); s.rect(${ft.pw}, ${ft.pd}, { ${at} }); pocket(s, b, ${f2(ft.d)}); }`); break; }
      case 'hhole': { // along y, at [x, z offset from the bbox centre]
        const zc = flipped ? H - ft.zc : ft.zc; L.push(`hole(b, { across: ${f2(2 * ft.r)}, along: 'y', at: [${f2(ft.xc)}, ${f2(zc - H / 2)}]${thru ? `, deep: ${D + 2}` : ''} });`); break; }
      case 'rboss': L.push(`{ const c = cylinder(${f2(2 * ft.r)}, ${ft.bh}, { at: [${f2(ft.xc)}, ${y(ft.yc)}, ${f2(H / 2 + ft.bh / 2)}] }); join(b, c); }`); break;
      default: return { exact: false, why: `unknown fuzz feature ${ft.kind}`, script: null };
    }
  }
  if (flipped) flip();
  const o = opens[0];
  L.push(`hollow(b, { wall: ${t}, open: '${word[o]}' });`);
  return { exact, why, script: L.join('\n'), notes };
}
