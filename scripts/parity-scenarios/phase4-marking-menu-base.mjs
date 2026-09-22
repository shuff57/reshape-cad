// Phase 4.1 marking-menu base (SPEC-mouse-parity.md Phase 4.1) -- right-click
// opens the radial menu in the part viewport, with mode-appropriate contents;
// the Sketch wedge opens its second-level flyout on hover (todo 18).
export async function run(page) {
  await page.goto("/");
  await page.waitForTimeout(1000);

  // Part-viewport right-click: the marking menu opens at the cursor.
  const canvas = page.locator("canvas").first();
  const cbox = await canvas.boundingBox();
  const cx = cbox.x + cbox.width / 2;
  const cy = cbox.y + cbox.height / 2;
  await page.mouse.click(cx, cy, { button: "right" });
  await page.waitForTimeout(300);
  const wedges = await page.$$eval(".marking-menu-wedge", (els) => els.map((e) => e.textContent?.trim()));
  if (!wedges.some((t) => /repeat/i.test(t ?? ""))) {
    throw new Error(`part-viewport right-click did not open the marking menu; wedges: ${JSON.stringify(wedges)}`);
  }
  const expected = ["Repeat", "Delete", "Press Pull", "Undo", "Redo", "Move/Copy", "Hole", "Sketch"];
  for (const label of expected) {
    if (!wedges.includes(label)) {
      throw new Error(`marking menu missing the SPEC wedge "${label}"; wedges: ${JSON.stringify(wedges)}`);
    }
  }
  // Close: Escape.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  const still = await page.$$eval(".marking-menu", (els) => els.length);
  if (still !== 0) {
    throw new Error(`Escape did not close the marking menu (${still} menu roots remain)`);
  }

  // Sketch mode: the Sketch wedge should open its flyout on hover.
  await page.click('button:has-text("Sketch")');
  await page.waitForTimeout(500);
  const svg = page.locator("svg.sk2d-svg");
  const sbox = await svg.boundingBox();
  await page.mouse.click(sbox.x + sbox.width / 2, sbox.y + 60, { button: "right" });
  await page.waitForTimeout(300);
  const skWedges = await page.$$eval(".marking-menu-wedge", (els) => els.map((e) => e.textContent?.trim()));
  for (const label of ["Done", "Horizontal", "Vertical", "Tangent", "Lock"]) {
    if (!skWedges.includes(label)) {
      throw new Error(`sketch marking menu missing "${label}"; wedges: ${JSON.stringify(skWedges)}`);
    }
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
}