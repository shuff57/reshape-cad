// Nothing imports this package through its bare `.` entry point -- every
// consumer uses a subpath, e.g. '@shuff57/reshape-kernel/engine-adapter' --
// so this barrel exists for completeness.
//
// occt-build.ts, occt-mesh.ts and topo-resolve.ts are deliberately absent.
// They are not part of this app: since brep-rs became the only engine they
// survive solely as the referee's apparatus for scripts/brep-parity-gate.mjs
// and scripts/brep-mesh-gate.mjs, which build every fixture on OCCT as well
// as on brep-rs and compare the two. Those gates load them out of dist/ by
// filesystem path, so they need no export here -- and giving them one would
// advertise a second kernel this app does not have.
export * from './config.js';
export * from './engine-adapter.js';
export { BrepRsEngineAdapter } from './brep-rs-engine-adapter.js';
