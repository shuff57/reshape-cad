// packages/engine/src/config.ts
//
// Mirrors packages/kernel/src/config.ts exactly. The FreeCAD engine artifact
// set (FreeCADCmd.js/.wasm + freecad-data.js/.data) is not an external
// checkout like the replicad kernel is -- it lives inside THIS repo, under
// engine/build/g5-artifacts/ and engine/play/freecad-data.* -- but it is
// still not bundled into this package: it is served by whichever app hosts
// it (sandbox-dev today, via engineStaticServer() in
// packages/sandbox-dev/vite.config.ts, at /reshape/engine). Consumers that
// load the engine (load-browser.mjs) read the base URL from here instead of
// hardcoding a path, so the same loader works unmodified if the URL ever
// changes.
let engineBaseUrl = '/reshape/engine';

export function getEngineBaseUrl(): string {
  return engineBaseUrl;
}

export function setEngineBaseUrl(url: string): void {
  engineBaseUrl = url;
}
