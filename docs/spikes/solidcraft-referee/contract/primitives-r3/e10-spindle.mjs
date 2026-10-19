// E10: self-intersecting (spindle) and degenerate torus. Oracles OCCT and brep-rs are expected to AGREE with each other and be wrong:
// they report the plain 2 pi^2 R r^2, which counts the overlap of the tube with itself twice. Truck refuses.
export default [
  { id: 'e10-ring-40-38', script: 'ring(40, 38);', brep: true },
  { id: 'e10-ring-10-9.9999', script: 'ring(10, 9.9999);', brep: true },
  { id: 'e10-ring-10-6', script: 'ring(10, 6);', brep: true },
  { id: 'e10-ring-20-14', script: 'ring(20, 14);', brep: true },
  { id: 'e10-ring-20-10', script: 'ring(20, 10);', brep: true },
  { id: 'e10-ring-10-5', script: 'ring(10, 5);', brep: true },
  { id: 'e10-ring-10-10', script: 'ring(10, 10);', brep: true },
  { id: 'e10-ring-10-12', script: 'ring(10, 12);', brep: true },
];
