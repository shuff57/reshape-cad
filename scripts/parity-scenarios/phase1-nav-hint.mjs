// The status bar's mouse-binding hint (todo: stale "Right-drag orbit" hint):
// the hint must name the ACTIVE scheme's bindings and follow the Mouse chip
// live. The fusion default (todo 29) made the old hardcoded string a lie.
export async function run(page) {
  await page.goto("/");
  await page.waitForTimeout(1000);

  // Fresh session: fusion default. The hint must say M-pan / R-dolly, and
  // must NOT carry the old "Right-drag orbit" lie.
  const hint = await page.locator(".reshape-studio-status-nav").textContent();
  if (!hint.includes("Middle-drag: pan")) {
    throw new Error(`fresh session hint should name Middle-drag pan (fusion), got: "${hint}"`);
  }
  if (/Right-drag:?\s+orbit/i.test(hint)) {
    throw new Error(`the stale "Right-drag orbit" lie is back: "${hint}"`);
  }
  if (!hint.includes("Scroll: zoom")) throw new Error(`hint lost the scroll line: "${hint}"`);

  // Flip to legacy through the viewport's Mouse chip: the hint follows.
  await page.click('button:has-text("Mouse: Fusion")');
  await page.waitForTimeout(300);
  const legacy = await page.locator(".reshape-studio-status-nav").textContent();
  if (!legacy.includes("Right-drag: pan")) {
    throw new Error(`legacy hint should name Right-drag pan, got: "${legacy}"`);
  }
  if (legacy.includes("Middle-drag: pan")) {
    throw new Error(`legacy hint still names Middle-drag pan: "${legacy}"`);
  }
  // Shift+Right-drag orbit is CORRECT under legacy too (three.js's
  // Pan+Shift=Rotate rule) — the fusion-only line is Shift+Middle-drag.
  if (legacy.includes("Shift+Middle-drag: orbit")) {
    throw new Error(`legacy hint carries the fusion Shift+MMB line: "${legacy}"`);
  }

  // And back: the words follow the bindings both ways.
  await page.click('button:has-text("Mouse: Legacy")');
  await page.waitForTimeout(300);
  const back = await page.locator(".reshape-studio-status-nav").textContent();
  if (!back.includes("Middle-drag: pan")) {
    throw new Error(`flipping back did not restore the fusion hint: "${back}"`);
  }
}