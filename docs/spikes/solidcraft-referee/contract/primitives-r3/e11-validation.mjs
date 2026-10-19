// E11: interpreter-level validation, no kernel (a script the interpreter refuses never reaches truck). Run WITHOUT --guard to see the
// interpreter's own sentence; the last block are scripts the interpreter ACCEPTS silently (the guard lint refuses them).
const v = (id, row, script) => ({ id: `e11-${id}`, row, script, occt: false });
export default [
  v('box-neg', 'validation.size', 'box(-10, 30, 12);'), v('box-zero', 'validation.size', 'box(0, 30, 12);'), v('box-nan', 'validation.size', 'box(0/0, 30, 12);'),
  v('box-inf', 'validation.size', 'box(1/0, 30, 12);'), v('box-str', 'validation.size', "box('40', 30, 12);"), v('box-missing', 'validation.size', 'box(40, 30);'),
  v('box-null', 'validation.size', 'box(null, 30, 12);'), v('cyl-neg', 'validation.size', 'cylinder(-24, 30);'), v('cyl-zero-tall', 'validation.size', 'cylinder(24, 0);'),
  v('sph-neg', 'validation.size', 'sphere(-5);'), v('cone-zero', 'validation.size', 'cone(0, 10);'), v('ring-zero-tube', 'validation.size', 'ring(40, 0);'),
  v('ring-neg', 'validation.size', 'ring(40, -4);'), v('prism-neg', 'validation.size', 'prism(6, -30, 12);'), v('wedge-neg', 'validation.size', 'wedge(-40, 30, 12);'),
  v('wedge-missing', 'validation.size', 'wedge(40, 30);'), v('box-corner-zero', 'validation.size', 'box(40, 30, 12, { corner: 0 });'), v('box-corner-neg', 'validation.size', 'box(40, 30, 12, { corner: -1 });'),
  v('box-corner-str', 'validation.size', "box(40, 30, 12, { corner: '2' });"), v('prism-sides-zero', 'validation.sides', 'prism(0, 30, 12);'), v('prism-sides-neg', 'validation.sides', 'prism(-3, 30, 12);'),
  v('prism-2', 'validation.sides', 'prism(2, 30, 12);'), v('prism-13', 'validation.sides', 'prism(13, 30, 12);'),
  v('opt-colour', 'validation.option', 'box(40, 30, 12, { colour: 3 });'), v('opt-rotate', 'validation.option', 'box(40, 30, 12, { rotate: [0, 0, 90] });'), v('opt-center', 'validation.option', 'box(40, 30, 12, { center: [0, 0, 0] });'),
  v('cyl-unknown', 'validation.option', 'cylinder(24, 30, { fillet: 2 });'), v('sph-corner', 'validation.option', 'sphere(20, { corner: 2 });'), v('sph-rotate', 'validation.option', 'sphere(20, { rotate: [0, 0, 5] });'),
  v('cone-corner', 'validation.option', 'cone(20, 30, { corner: 2 });'), v('ring-corner', 'validation.option', 'ring(40, 10, { corner: 2 });'), v('prism-corner', 'validation.option', 'prism(6, 30, 12, { corner: 2 });'),
  v('wedge-corner', 'validation.option', 'wedge(40, 30, 12, { corner: 2 });'), v('opts-array', 'validation.option', 'box(40, 30, 12, [1]);'), v('box-extra-number', 'validation.option', 'box(40, 30, 12, 4);'),
  v('box-at-short', 'validation.option', 'box(40, 30, 12, { at: [1, 2] });'), v('box-at-str', 'validation.option', "box(40, 30, 12, { at: 'x' });"),
  v('bevel-box', 'box.chamfer', 'bevel(box(40, 30, 12), 3);'),
  v('cone-three-arg', 'cone.frustum', 'cone(10, 5, 10);'),
  // accepted silently by the interpreter today
  v('SILENT-box-surplus', 'validation.surplus', 'box(1, 2, 3, { at: [0, 0, 0] }, 99);'),
  v('SILENT-prism-surplus', 'validation.surplus', 'prism(6, 10, 5, { at: [0, 0, 0] }, 1);'),
  v('SILENT-prism-5.4', 'validation.sides', 'prism(5.4, 30, 12);'), v('SILENT-prism-5.5', 'validation.sides', 'prism(5.5, 30, 12);'),
  v('param-box', 'param', "box(param('w', 40), param('d', 30), param('h', 12), { at: [param('x', 5), 0, 0] });"),
  v('param-zero', 'param', "box(param('w', 0), 30, 12);"), v('param-neg', 'param', "box(param('w', -5), 30, 12);"), v('param-str', 'param', "box(param('w', '5'), 30, 12);"),
];
