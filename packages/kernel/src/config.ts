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
