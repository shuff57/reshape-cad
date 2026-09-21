// Phase 3.6 double-click / Ctrl+A / Delete baseline (SPEC-mouse-parity.md
// Phase 3.6): double-click a viewport body opens its params panel (the
// 600ms `reshape-params-flash` cue on `.reshape-pane-params`, the same
// class focusParams() adds), double-click a sketch's timeline row reopens
// its 2D editor, Ctrl+A selects every feature, and Delete (scoped to the
// viewport's own focus, per shouldHandleViewportDelete()) removes them.
// Coordinates/selectors confirmed live against a running sandbox-dev.
export async function run(page) {
  await page.goto("/");
  await page.waitForTimeout(1000);

  async function statusText() {
    return page.locator(".reshape-studio-status-sel").textContent();
  }

  // Feature 1: a box.
  await page.click('button:has-text("Box")');
  await page.waitForTimeout(300);

  const canvas = page.locator("canvas");
  const cbox = await canvas.boundingBox();
  const cx = cbox.x + cbox.width / 2;
  const cy = cbox.y + cbox.height / 2;

  // Double-click the box body: opens params (Dimensions) via the SAME
  // focusParams() the ✎ Dimensions button uses -- verified by the flash
  // class it applies for 600ms, not by trying to read the panel's content
  // (which varies by feature kind).
  await page.dblclick("canvas", { position: { x: cx - cbox.x, y: cy - cbox.y } });
  await page.waitForTimeout(150);
  const flashClass = await page.evaluate(
    () => document.querySelector(".reshape-pane-params")?.className ?? null,
  );
  if (!flashClass || !flashClass.includes("reshape-params-flash")) {
    throw new Error(`dblclick body: expected .reshape-pane-params to flash, got class "${flashClass}"`);
  }

  // Feature 2: a sketch, exited back to the 3D ribbon.
  await page.click('button:has-text("Sketch")');
  await page.waitForTimeout(500);
  await page.click('button:has-text("Done")');
  await page.waitForTimeout(300);

  const rowCount = await page.locator(".model-row").count();
  if (rowCount !== 2) {
    throw new Error(`expected 2 timeline rows (box + sketch), got ${rowCount}`);
  }

  // Double-click the sketch's timeline row (index 1, added second): reopens
  // the 2D editor via the SAME onEditFeature -> setSketchEditId path Edit 2D
  // uses, not a second way to enter it.
  await page.dblclick(".model-row >> nth=1");
  await page.waitForTimeout(400);
  const svgVisible = await page.locator("svg.sk2d-svg").count();
  if (svgVisible < 1) {
    throw new Error("dblclick sketch timeline row: expected the 2D sketcher (svg.sk2d-svg) to reopen");
  }
  await page.click('button:has-text("Done")');
  await page.waitForTimeout(300);

  // Ctrl+A: select every feature (canvas already has focus from the box
  // click below -- a click on canvas focuses it, per tabIndex=0).
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(150);
  await page.keyboard.press("Control+a");
  await page.waitForTimeout(150);
  const afterSelectAll = await statusText();
  if (afterSelectAll !== "2 selected") {
    throw new Error(`Ctrl+A: expected "2 selected" (box + sketch), got "${afterSelectAll}"`);
  }

  // Delete: scoped to viewport focus, removes both.
  await page.keyboard.press("Delete");
  await page.waitForTimeout(250);
  const afterDelete = await statusText();
  const rowsAfterDelete = await page.locator(".model-row").count();
  if (afterDelete !== "Nothing selected" || rowsAfterDelete !== 0) {
    throw new Error(
      `Delete: expected empty selection and 0 timeline rows, got status="${afterDelete}" rows=${rowsAfterDelete}`,
    );
  }
}
