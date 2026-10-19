// NEGATIVE CONTROL: run with SG_NO_PROFILES=1 (no even-odd profile selection, i.e. solidcraft's default profiles:"all").
const P = Math.PI;
export const cases = [
  { id: 'ctl-noprofiles-plate-hole', feature: 'several shapes', what: 'plate with hole, profiles:all', script: "const sk = sketch('top'); sk.rect(30, 20); sk.circle(6); extrude(sk, 10)", exact: { volume: (600 - P * 9) * 10 }, curved: true },
  { id: 'ctl-noprofiles-ring', feature: 'several shapes', what: 'ring (two concentric circles), profiles:all', script: "const sk = sketch('top'); sk.circle(20); sk.circle(8); extrude(sk, 10)", exact: { volume: P * 84 * 10 }, curved: true },
  { id: 'ctl-noprofiles-island', feature: 'several shapes', what: 'island in a hole in a plate, profiles:all', script: "const sk = sketch('top'); sk.rect(40, 30); sk.circle(20); sk.circle(8); extrude(sk, 10)", exact: { volume: (1200 - P * 100 + P * 16) * 10 }, curved: true },
  { id: 'ctl-noprofiles-slot-hole', feature: 'several shapes', what: 'slot cut as a hole in a plate, profiles:all', script: "const sk = sketch('top'); sk.rect(40, 20); sk.slot([-10, 0], [10, 0], 4); extrude(sk, 10)", exact: { volume: (800 - (2 * 4 * 20 + P * 16)) * 10 }, curved: true },
];
