// The kernel wasm (replicad's OCCT build, replicad_single.wasm/.js) is not
// vendored in this package -- it is 23MB, gitignored in both this repo and
// shCode, and is served by whichever app hosts the kernel (shCode today, at
// /reshape/kernel; the plan's S3 task moves it to R2 later). Consumers that
// dynamically import the wasm glue (packages/studio's BrepViewportThree) or
// fetch the .wasm bytes directly (ReshapeStudio) read the base URL from here
// instead of hardcoding a path, so the same component works unmodified once
// the URL changes to an R2 bucket.
let kernelBaseUrl = '/reshape/kernel';

export function getKernelBaseUrl(): string {
  return kernelBaseUrl;
}

export function setKernelBaseUrl(url: string): void {
  kernelBaseUrl = url;
}

// Which kernel BrepViewportThree.tsx's loadEngine() should bring up --
// Default flipped to 'brep-rs' (2026-09-17, FreeCAD kernel removed).
// sandbox-dev reads VITE_RESHAPE_ENGINE at startup and calls this once,
// the same pattern RESHAPE_KERNEL_DIR already uses for the URL above;
// a future UI toggle calls it directly.
let engineMode: 'occt' | 'brep-rs' = 'brep-rs';

export function getEngineMode(): 'occt' | 'brep-rs' {
  return engineMode;
}

export function setEngineMode(mode: 'occt' | 'brep-rs'): void {
  engineMode = mode;
}
