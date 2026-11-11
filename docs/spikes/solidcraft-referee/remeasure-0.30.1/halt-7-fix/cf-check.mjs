process.argv[2] = '1'; process.argv[3] = '/dev/null';
const { closedForm } = await import('./seed-family.mjs');
const { oracle } = await import('./oracle-com.mjs');
const T = [
  { n: 'csink-plate', W: 40, D: 30, H: 10, t: 2, kind: 'csink', r: 2, Rm: 5, angle: 90, cx: 0, cy: 0, open: 'top' },
  { n: 'cbore-plate', W: 40, D: 30, H: 10, t: 2, kind: 'cbore', r: 2, Rm: 4, depth: 3, cx: 0, cy: 0, open: 'top' },
  { n: 'v-01396-centre', W: 12, D: 10, H: 6, t: 1, kind: 'cbore', r: 1, Rm: 4, depth: 2, cx: 0, cy: 0, open: 'top' },
  { n: 'v-01024-one', W: 22, D: 14, H: 6, t: 1.5, kind: 'csink', r: 1, Rm: 4, angle: 90, cx: -4, cy: -1, open: 'top' },
  { n: 'v-00872-wall2', W: 18, D: 18, H: 12, t: 2, kind: 'csink', r: 1.5, Rm: 6, angle: 90, cx: 0, cy: 0, open: 'top' },
  { n: 'cbore-bottom', W: 30, D: 20, H: 10, t: 1.5, kind: 'cbore', r: 1.5, Rm: 3.5, depth: 2, cx: 3, cy: 1, open: 'bottom' },
  { n: 'csink-bottom', W: 30, D: 20, H: 10, t: 1.5, kind: 'csink', r: 1.5, Rm: 4, angle: 90, cx: 3, cy: 1, open: 'bottom' },
];
for (const c of T) {
  const cf = closedForm(c).P;
  const holes = c.kind === 'cbore' ? [{ type: 'cyl', axis: 'z', c: [c.cx, c.cy], r: c.r, range: [-1, c.H + 1] }, { type: 'cyl', axis: 'z', c: [c.cx, c.cy], r: c.Rm, range: [c.H - c.depth, c.H + 1] }]
    : [{ type: 'cone', c: [c.cx, c.cy], rb: c.r, zb: c.H - (c.Rm - c.r) / Math.tan(c.angle / 360 * Math.PI), rt: c.Rm, zt: c.H, r: c.r, range: [-1, c.H + 1] }];
  const opens = [c.open === 'top' ? { axis: 'z', dir: 1, coord: c.H, rect: [-c.W / 2, c.W / 2, -c.D / 2, c.D / 2], minus: [] } : { axis: 'z', dir: -1, coord: 0, rect: [-c.W / 2, c.W / 2, -c.D / 2, c.D / 2], minus: [] }];
  const o = oracle({ t: c.t, mode: 'rect', boxes: [[-c.W / 2, c.W / 2, -c.D / 2, c.D / 2, 0, c.H]], cuts: [], opens, holes, rbosses: [] }, { h: 0.05 });
  console.log(c.n.padEnd(16), 'closed', cf.toFixed(4), 'oracle', o.P.toFixed(4), 'rel', ((cf - o.P) / o.P).toExponential(2));
}
