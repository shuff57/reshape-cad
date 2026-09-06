// occt-api and occt-mesh both export `Occt`, and occt-mesh/occt-three both
// export `signedVolume`/`triangleCount` (occt-three re-exports occt-mesh's
// MeshOptions/Occt types too) -- a flat `export *` across all three is
// ambiguous. Nothing currently imports this package via its bare `.` entry
// point (every consumer uses a subpath, e.g.
// '@shuff57/reshape-kernel/occt-build'); this barrel exists for
// completeness, so the ambiguous ones are namespaced instead of flattened.
export * as occtApi from './occt-api.js';
export * as occtMesh from './occt-mesh.js';
export * as occtThree from './occt-three.js';
export * from './config.js';
// occt-build.ts and topo-resolve.ts are not re-exported here either, for the
// same reason and the same fix: import '@shuff57/reshape-kernel/occt-build'
// or '@shuff57/reshape-kernel/topo-resolve' directly.
