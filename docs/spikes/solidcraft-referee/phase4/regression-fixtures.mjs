// SPIKE (phase 4), referee only. PERMANENT regression fixtures from the phase 4 critic. Each is a ModelDoc plus what the
// page MUST do. verify-regression.mjs drives the real page and exits 1 if any expectation is not met, so a regression
// turns this red. `expect`: 'refuse' (sentence must contain `contains`), 'build' (must equal live OCCT at `bar`),
// 'any' (classified only: either refused by the resolver with a count, or built and equal to OCCT; never a mismatch).
const face = (feature, part) => ({ cause: 'primitive', feature, kind: 'face', part });
const box = (id, size, center = [0, 0, 0]) => ({ id, kind: 'box', size, center });
const slotShell = (x) => ({ id: `slot-shell-x${x}`, measure: 's1', expect: 'refuse', contains: 'matches 2 faces',
  why: 'a channel splits the top into 2 coplanar pieces; the name does not say which; the page must not choose',
  features: [box('b1', [60, 40, 20]), box('t', [10, 50, 10], [x, 0, 10]), { id: 'op1', kind: 'combine', op: 'subtract', targets: ['b1', 't'] },
    { id: 's1', kind: 'shell', target: 'op1', thickness: 1, open: face('b1', '+z') }] });
const sk = (id, plane, offset, points) => ({ id, kind: 'sketch', plane, offset, points });
const xzCase = (id, points, offset, nameSpec) => ({ id, measure: 's1', expect: 'build', bar: 3e-4,
  why: 'xz-plane sketches: the sweep runs along u x v = -Y; cap/swept names must resolve on them',
  features: [sk('sk1', 'xz', offset, points), { id: 'e1', kind: 'extrude', target: 'sk1', height: 12 },
    { id: 's1', kind: 'shell', target: 'e1', thickness: 1, open: nameSpec }] });
const CCW = [[0, 0], [40, 0], [40, 25], [0, 25]];
const CW = [...CCW].reverse();
const cap = (end) => ({ cause: 'cap', feature: 'e1', kind: 'face', end });
const swept = (edge) => ({ cause: 'swept', feature: 'e1', kind: 'face', from: 'sk1', edge });
const stub = (id, size, center, extra = {}) => ({ id, measure: 's1', expect: 'any',
  why: 'b2 stub on b1.+z: the +z plane of b1 after the union is an annulus; shell must build the right solid or refuse with a count',
  features: [box('b1', [40, 30, 10]), box('b2', size, center), { id: 'op1', kind: 'combine', op: 'union', targets: ['b1', 'b2'] },
    { id: 's1', kind: 'shell', target: 'op1', thickness: 1, open: face('b1', '+z') }], ...extra });
export const REGRESSIONS = [
  slotShell(15), slotShell(-15), slotShell(5),
  { id: 'hole-then-shell', measure: 's1', expect: 'build', bar: 3e-4,
    why: 'the top face is an annulus: its centroid is in the hole; an interior point ON THE TARGET must be used (live OCCT 2656.478)',
    features: [box('b1', [40, 30, 10]), { id: 'h1', kind: 'hole', target: 'b1', diameter: 10, depth: 12, center: [0, 0, 0], axis: 'z' },
      { id: 's1', kind: 'shell', target: 'h1', thickness: 1, open: face('b1', '+z') }] },
  xzCase('xz-cap-top-ccw', CCW, 0, cap('top')), xzCase('xz-cap-bottom-ccw', CCW, 0, cap('bottom')),
  xzCase('xz-cap-top-cw', CW, 0, cap('top')), xzCase('xz-cap-bottom-cw-offset', CW, 7, cap('bottom')),
  xzCase('xz-swept-0-ccw', CCW, 0, swept(0)), xzCase('xz-swept-2-ccw-offset', CCW, 5, swept(2)),
  xzCase('xz-swept-1-cw', CW, 0, swept(1)), xzCase('xz-swept-3-cw-offset', CW, -4, swept(3)),
  stub('stub-centre', [10, 10, 8], [0, 0, 9]), stub('stub-offset-x', [10, 10, 8], [10, 0, 9]), stub('stub-corner', [10, 10, 8], [15, 10, 9]),
  stub('stub-edge-flush', [10, 10, 8], [15, 0, 9]), stub('stub-tall', [8, 8, 30], [-8, 5, 20]), stub('stub-strip-across', [10, 40, 8], [0, 0, 9]),
  stub('stub-strip-along', [50, 8, 8], [0, 0, 9]), stub('stub-full-top', [40, 30, 8], [0, 0, 9]), stub('stub-low', [12, 12, 2], [5, -5, 6]),
];
