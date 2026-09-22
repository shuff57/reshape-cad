// Phase 4.4 timeline context menu + drag-reorder (todo 21): drag-reorder two
// timeline features, then right-click one for Edit.
export async function run(page) {
  await page.goto("/");
  await page.waitForTimeout(1000);
  // Two boxes on the timeline.
  await page.click('button:has-text("Box")');
  await page.waitForTimeout(300);
  await page.click('button:has-text("Box")');
  await page.waitForTimeout(300);
  const rows = () => page.locator(".model-timeline .model-row");
  const firstLabel = await rows().nth(0).locator(".model-name").textContent();
  const secondLabel = await rows().nth(1).locator(".model-name").textContent();
  if (!firstLabel || !secondLabel) throw new Error("timeline rows not found");
  // Drag the first row ONTO the second row (HTML5 DnD via mouse events).
  const r1 = await rows().nth(0).boundingBox();
  const r2 = await rows().nth(1).boundingBox();
  await page.mouse.move(r1.x + r1.width / 2, r1.y + r1.height / 2);
  await page.mouse.down();
  await page.mouse.move(r2.x + r2.width / 2, r2.y + r2.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const newFirst = await rows().nth(0).locator(".model-name").textContent();
  if (newFirst !== secondLabel) {
    throw new Error(`drag-reorder did not swap the rows: first "${newLabel(newFirst)}", was "${firstLabel}"`);
  }
  function newLabel(t) { return (t ?? "").trim(); }
  // Keyboard fallback still works: the up/down buttons remain functional.
  // (Click the LAST row's "move earlier" button; it should swap back to
  // the pre-drag order.)
  const moveBtn = rows().nth(1).locator('button[aria-label*="earlier"]');
  await moveBtn.click();
  await page.waitForTimeout(300);
  const restored = await rows().nth(0).locator(".model-name").textContent();
  if (restored !== firstLabel) {
    throw new Error(`keyboard fallback regressed: expected "${firstLabel}" back at row 1, got "${restored}"`);
  }
  // Right-click context menu: Edit.
  await rows().nth(0).click({ button: "right" });
  await page.waitForTimeout(300);
  const menuItems = await page.$$eval(".tl-menu-row", (els) => els.map((e) => e.textContent?.trim()));
  for (const label of ["Edit", "Delete", "Rollback to here"]) {
    if (!menuItems.includes(label)) {
      throw new Error(`timeline context menu missing "${label}"; items: ${JSON.stringify(menuItems)}`);
    }
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
}