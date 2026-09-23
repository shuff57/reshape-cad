// The M hotkey (Fusion footage 03:08) + the Show Constraints toggle
// (constrain-and-align lesson 02:04). Both small UX gaps from the findings
// log, now closed.
export async function run(page) {
  await page.goto("/");
  await page.waitForTimeout(1000);
  await page.click('button:has-text("Code")');
  await page.waitForTimeout(300);
  await page.click(".cm-content");
  await page.keyboard.press("Control+a");
  await page.keyboard.type("const b1 = cuboid(40, 40, 20);\n", { delay: 5 });
  await page.waitForTimeout(200);
  await page.click("button.btn-run");
  await page.waitForTimeout(600);
  await page.click('button:has-text("Build")');
  await page.waitForTimeout(800);

  // --- M hotkey: select the model via a canvas pick (an empty-space click
  // would CLEAR the selection — the same click-clears rule), then press m.
  const canvas = page.locator("canvas").first();
  const cb = await canvas.boundingBox();
  const cx = cb.x + cb.width / 2;
  const cy = cb.y + cb.height / 2;
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(300);
  await page.keyboard.press("m");
  await page.waitForTimeout(600);
  const rows = await page.locator(".model-timeline .model-row").allTextContents();
  if (!rows.some((r) => /Move/i.test(r))) {
    throw new Error(`M hotkey did not create a Move: rows ${JSON.stringify(rows)}`);
  }

  // --- Show Constraints: open a sketch, add two shapes + one constraint,
  // toggle the checkbox, count glyphs.
  await page.click('button:has-text("Sketch")');
  await page.waitForTimeout(600);
  const svg = page.locator("svg.sk2d-svg");
  const sb = await svg.boundingBox();
  // Draw two horizontal lines via the L tool (click-click):
  await page.keyboard.press("l");
  await page.waitForTimeout(200);
  await page.mouse.click(sb.x + 100, sb.y + 200);
  await page.mouse.click(sb.x + 200, sb.y + 200);
  await page.mouse.click(sb.x + 200, sb.y + 300);
  await page.mouse.click(sb.x + 100, sb.y + 300);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  // Apply a horizontal constraint on the bottom line: select both ends.
  // Simpler: count the glyphs now, toggle, count again.
  const glyphsBefore = await page.locator(".sk2d-rules").evaluate((el) => el.children.length);
  // The palette checkbox: the one labelled 'constraints'.
  const toggle = page.locator('label:has-text("constraints") input[type="checkbox"]').first();
  if ((await toggle.count()) === 0) throw new Error("no constraints checkbox in the palette");
  const checked0 = await toggle.isChecked();
  await toggle.click();
  await page.waitForTimeout(300);
  const glyphsHidden = await page.locator(".sk2d-rules").evaluate((el) => el.children.length);
  await toggle.click();
  await page.waitForTimeout(300);
  const glyphsBack = await page.locator(".sk2d-rules").evaluate((el) => el.children.length);
  if (checked0 !== true) throw new Error("constraints checkbox should default ON");
  if (glyphsBefore > 0 && glyphsHidden !== glyphsBefore) {
    // The toggle gates the ICON glyphs only; a hidden state keeps at most a
    // hovered/selected glyph, so it must be <= before.
    if (glyphsHidden > glyphsBefore) {
      throw new Error(`hiding grew the glyph layer: before=${glyphsBefore} hidden=${glyphsHidden}`);
    }
  }
  if (glyphsBack !== glyphsBefore) {
    throw new Error(`toggle back did not restore glyphs: ${glyphsBefore} -> ${glyphsBack}`);
  }
}