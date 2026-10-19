// E16 (round 4): a rotate step on a sphere (turn(sphere(..), [..])): how is it stored, is the solid unchanged?
const D = (feats) => ({ version: 1, features: feats });
export default [
  { id: 'e16-sph-plain', script: 'sphere(20);', occt: true },
  { id: 'e16-sph-turn', script: 'turn(sphere(20), [20, 35, 50]);', occt: true },
  { id: 'e16-sph-at-turn', script: 'turn(sphere(20, { at: [30, -20, 10] }), [20, 35, 50]);', occt: true },
  { id: 'e16-sph-at-plain', script: 'sphere(20, { at: [30, -20, 10] });', occt: true },
  { id: 'e16-sph-turn-90', script: 'turn(sphere(20, { at: [30, 0, 0] }), [0, 0, 90]);', occt: true },
  { id: 'e16-sph-doc-rotate-field', doc: D([{ id: 'sph1', kind: 'sphere', center: [5, 5, 5], radius: 10, rotate: [20, 35, 50] }]), occt: true },
  { id: 'e16-cyl-at-turn-ref', script: 'turn(cylinder(20, 30, { at: [30, -20, 10] }), [20, 35, 50]);', occt: true },
];
