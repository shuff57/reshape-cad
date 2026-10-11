// The kernel wasm (packages/brep-rs's wasm-pack output) is not vendored in
// this package -- it is gitignored and rebuilt on demand, and is served by
// whichever app hosts it (sandbox-dev at /reshape/kernel today; an R2 bucket
// later). BrepRsEngineAdapter reads the base URL from here rather than
// hardcoding a path, so the same adapter works unmodified once that URL
// changes.
let kernelBaseUrl = '/reshape/kernel';

export function getKernelBaseUrl(): string {
  return kernelBaseUrl;
}

export function setKernelBaseUrl(url: string): void {
  kernelBaseUrl = url;
}
