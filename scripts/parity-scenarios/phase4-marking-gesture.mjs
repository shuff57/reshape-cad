// Phase 4.2 gesture (todo 19): right-button hold + fast directional drag fires
// the wedge's command with NO visible menu flash. Drag UP (the first wedge,
// Repeat in the layout order: slot 0 points up).
export async function run(page) {
  await page.goto("/");
  await page.waitForTimeout(1000);
  // Draw a box first so the Delete wedge has something to act on... actually
  // slot 0 (up) is Repeat -- present-but-noop. Use the wedge whose dispatch
  // IS wired and direction is readable: Delete is slot 1 (upper-right).
  // Draw two boxes first.
  await page.click('button:has-text("Box")');
  await page.waitForTimeout(300);
  await page.click('button:has-text("Box")');
  await page.waitForTimeout(300);
  // Select one (click its canvas center area).
  const canvas = page.locator("canvas").first();
  const cbox = await canvas.boundingBox();
  const cx = cbox.x + cbox.width / 2;
  const cy = cbox.y + cbox.height / 2;
  await page.mouse.click(cx - 100, cy);
  await page.waitForTimeout(200);
  // Fast right-drag toward the upper-right (Delete, slot 1 at -45deg).
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(cx + 80, cy - 80, { steps: 3 });
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(400);
  // The Delete command fired: the status readout must NOT show the menu.
  const menuOpen = await page.$$eval(".marking-menu-wedge", (els) => els.length);
  if (menuOpen !== 0) {
    throw new Error(`a fast directional drag rendered the menu anyway (${menuOpen} wedges)`);
  }
  const status = await page.locator(".reshape-studio-status-sel").textContent();
  if (status !== "Nothing selected" && !/removed/i.test(status ?? "")) {
    throw new Error(`the wedge gesture did not fire Delete; status: "${status}"`);
  }
}