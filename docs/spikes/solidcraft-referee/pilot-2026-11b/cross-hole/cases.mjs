// where the time goes when a hole is drilled into a hollowed cylinder
const cyl = (d, h) => `const c = cylinder(${d}, ${h})\n`;
const hol = (w, open = 'bottom') => `hollow(c, { wall: ${w}, open: '${open}' })\n`;
export const CASES = [
  { id: 'cyl-hollow', script: cyl(20, 30) + hol(3) },
  { id: 'cyl-cross-6', script: cyl(20, 30) + `hole(c, { across: 6, along: 'x' })\n` },
  { id: 'cyl-hollow-cross-6', script: cyl(20, 30) + hol(3) + `hole(c, { across: 6, along: 'x' })\n` },
  { id: 'cyl-hollow-cross-2', script: cyl(20, 30) + hol(3) + `hole(c, { across: 2, along: 'x' })\n` },
  { id: 'cyl-hollow-axial-4', script: cyl(20, 30) + hol(3) + `hole(c, { across: 4, at: [4, 0] })\n` },
  { id: 'cyl-hollow-axial-centre-4', script: cyl(20, 30) + hol(3) + `hole(c, { across: 4 })\n` },
  { id: 'cyl16-hollow1-cross-6', script: cyl(16, 20) + hol(1) + `hole(c, { across: 6, along: 'y' })\n` },
  { id: 'box-hollow-cross-6', script: `const c = box(20, 20, 30)\n` + hol(3) + `hole(c, { across: 6, along: 'x' })\n` },
  { id: 'cross-then-hollow', script: cyl(20, 30) + `hole(c, { across: 6, along: 'x' })\n` + hol(3) },
];
