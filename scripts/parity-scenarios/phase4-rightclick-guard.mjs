// Phase 4.3 right-click guard (todo 20): a right-DRAG orbits/pans the camera;
// a clean right-click opens the menu. Both behaviors in the same session.
export async function run(page) {
  await page.goto("/");
  await page.waitForTimeout(1000);
  const canvas = page.locator("canvas").first();
  const cbox = await canvas.boundingBox();
  const cx = cbox.x + cbox.width / 2;
  const cy = cbox.y + cbox.height / 2;
  // Right-DRAG (slow, well past the dead zone): camera gesture, no menu.
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(cx + 200, cy + 120, { steps: 10 });
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(400);
  const afterDrag = await page.$$eval(".marking-menu-wedge", (els) => els.length);
  if (afterDrag !== 0) {
    throw new Error(`a right-DRAG opened the marking menu (${afterDrag} wedges) -- the camera gesture must own it`);
  }
  // Clean right-click (no movement): menu opens.
  await page.mouse.click(cx, cy, { button: "right" });
  await page.waitForTimeout(300);
  const afterClick = await page.$$eval(".marking-menu-wedge", (els) => els.length);
  if (afterClick === 0) {
    throw new Error("a clean right-click did NOT open the marking menu");
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
}