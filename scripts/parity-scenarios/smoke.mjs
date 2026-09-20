// Trivial scenario proving the parity-record.mjs harness end-to-end: opens
// the sandbox app and waits, producing a short, playable .webm.
export async function run(page) {
  await page.goto("/");
  await page.waitForTimeout(2000);
}
