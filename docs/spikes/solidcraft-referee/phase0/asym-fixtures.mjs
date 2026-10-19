// Asymmetric fixtures for phase 0 (defined here; scripts/brep-parity-fixtures.mjs is not touched).
// Pick fixtures are OFF-CENTRE and non-symmetric so a pick on the opposite edge/face gives the same volume and bbox but a
// different centre of mass. They come in sizes that make the localized feature small (r=0.5, thin wall, 1 degree, 3x box):
// a control that only fails on one large feature is an artifact of that feature, not evidence the pick is checked.
// Revolve fixtures have no pick: they pin the partial-revolve sweep direction (a wrong direction leaves volume and bbox
// of a symmetric case unchanged; centre of mass moves).
const face = (feature, part) => ({ cause: 'primitive', feature, kind: 'face', part });
const boxAt = (k) => ({ id: 'b1', kind: 'box', size: [40 * k, 30 * k, 12 * k], center: [15 * k, -7 * k, 3 * k] });
const filletFx = (id, k, size) => ({ id, kind: 'fillet', tol: 'approx', measure: 'r1', pickOf: 'r1', features: [boxAt(k),
  { id: 'r1', kind: 'fillet', target: 'b1', size, style: 'fillet', edge: { cause: 'between', feature: 'b1', kind: 'edge', of: [face('b1', '+x'), face('b1', '+y')] } }] });
const shellFx = (id, k, t) => ({ id, kind: 'shell', tol: 'tight', measure: 'sh1', pickOf: 'sh1', features: [boxAt(k),
  { id: 'sh1', kind: 'shell', target: 'b1', thickness: t, open: face('b1', '+x') }] });
const draftFx = (id, k, angle) => ({ id, kind: 'draft', tol: 'approx', measure: 'd1', pickOf: 'd1', features: [boxAt(k),
  { id: 'd1', kind: 'draft', target: 'b1', angle, pull: 'z', neutral: -3 * k, face: face('b1', '+x') }] });
const rimFx = (id, k, size) => ({ id, kind: 'fillet', tol: 'approx', measure: 'r1', pickOf: 'r1', features: [
  { id: 'c1', kind: 'cylinder', radius: 12 * k, height: 30 * k, center: [5 * k, 3 * k, 2 * k] },
  { id: 'r1', kind: 'fillet', target: 'c1', size, style: 'fillet', edge: { cause: 'between', feature: 'c1', kind: 'edge', of: [face('c1', '+z'), face('c1', 'side')] } }] });
const sk = (id, plane, offset, points) => ({ id, kind: 'sketch', plane, offset, points });
const revFx = (id, plane, offset, angle) => ({ id, kind: 'revolve', tol: 'approx', measure: 'r1', features: [
  sk('sk1', plane, offset, [[10, 3], [20, 3], [20, 25], [10, 25]]), { id: 'r1', kind: 'revolve', target: 'sk1', angle }] });
const grooveFx = (id, plane, offset, angle) => ({ id, kind: 'groove', tol: 'approx', measure: 'g1', features: [
  { id: 'b1', kind: 'box', size: [60, 60, 40], center: [0, 0, 0] },
  sk('sk1', plane, offset, [[5, -10], [12, -10], [12, 6], [5, 6]]), { id: 'g1', kind: 'groove', target: 'sk1', into: 'b1', angle }] });

export function asymFixtures() {
  return [
    filletFx('asym-fillet-short-edge', 1, 3),
    filletFx('asym-fillet-r1', 1, 1),
    filletFx('asym-fillet-r0p5', 1, 0.5),
    filletFx('asym-fillet-3x-r3', 3, 3),
    shellFx('asym-shell-open-side', 1, 2),
    shellFx('asym-shell-thin-3x', 3, 0.3),
    draftFx('asym-draft-face', 1, 8),
    draftFx('asym-draft-1deg-3x', 3, 1),
    rimFx('asym-cylinder-one-rim', 1, 3),
    rimFx('asym-cylinder-rim-r0p5', 1, 0.5),
    rimFx('asym-cylinder-rim-3x-r3', 3, 3),
    revFx('asym-revolve-90-xy', 'xy', 0, 90),
    revFx('asym-revolve-200-xz-offset', 'xz', 5, 200),
    grooveFx('asym-groove-270-yz-offset', 'yz', 4, 270),
  ];
}
