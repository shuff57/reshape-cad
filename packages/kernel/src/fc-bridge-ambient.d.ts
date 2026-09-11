// packages/kernel/src/fc-bridge-ambient.d.ts
//
// packages/engine's bridge modules (fc-session.mjs, fc-commands.mjs,
// fc-sketch.mjs, load-browser.mjs) are plain, deliberately dependency-free
// .mjs -- no .d.ts of their own, and package.json's export map points at
// ./src/*.mjs directly rather than a compiled ./dist, so there is nothing
// for TypeScript to infer a shape from. Loose on purpose, the same
// discipline occt-build.ts's own `Occt` interface documents for the OCCT
// side: a wrong name fails loudly at the first real call (in
// freecad-engine-adapter.ts's own FcSessionLike, which does the actual
// typing) rather than this file duplicating every export's JSDoc.

declare module '@shuff57/reshape-engine/fc-session' {
  export function createFcSession(Module: unknown): any;
}

declare module '@shuff57/reshape-engine/fc-commands' {
  export function attachCommands(session: any): any;
}

declare module '@shuff57/reshape-engine/fc-sketch' {
  export function attachSketchCommands(session: any): any;
}

declare module '@shuff57/reshape-engine/load-browser' {
  export function loadFreeCadEngine(baseUrl?: string): Promise<unknown>;
}
