// Phase 4.1 marking-menu flyout (todo 18): right-click in the part viewport,
// hover the Sketch wedge, verify the sketch-tool flyout opens; then hover a
// wedge back toward the center (away) and verify the flyout closes.
export async function run(page) {
  await page.goto("/");
  await page.waitForTimeout(1000);
  const canvas = page.locator("canvas").first();
  const cbox = await canvas.boundingBox();
  const cx = cbox.x + cbox.width / 2;
  const cy = cbox.y + cbox.height / 2;
  await page.mouse.click(cx, cy, { button: "right" });
  await page.waitForTimeout(300);
  // Hover the Sketch wedge: it is the last of the 8 (i=7, upper-left).
  const sketch = page.locator('button.marking-menu-wedge', { hasText: "Sketch" });
  const sb = await sketch.boundingBox();
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2, { steps: 4 });
  await page.waitForTimeout(300);
  const children = await page.$$eval(".marking-menu-flyout-item", (els) => els.map((e) => e.textContent?.trim()));
  const expected = ["Line", "Rect", "Circle", "Arc", "Slot", "Trim", "Fillet", "Dim"];
  for (const label of expected) {
    if (!children.includes(label)) {
      throw new Error(`sketch flyout missing "${label}"; children: ${JSON.stringify(children)}`);
    }
  }
  // The context list below the radial.
  const ctx = await page.$$eval(".marking-menu-context-row", (els) => els.map((e) => e.textContent?.trim()));
  for (const label of ["Pan/Zoom/Orbit", "Isolate", "Workspaces", "Saved shortcuts"]) {
    if (!ctx.includes(label)) {
      throw new Error(`context list missing "${label}"; rows: ${JSON.stringify(ctx)}`);
    }
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
}