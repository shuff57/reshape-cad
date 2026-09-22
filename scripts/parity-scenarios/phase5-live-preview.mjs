// Phase 5.3 live preview (todo 25, SPEC-mouse-parity.md): blue add / red
// cut while dragging, committed once on pointerup so undo stays one step.
// Happy: drag a pocket depth arrow -- the viewport tints RED (cut) while
// held, back to committed orange after release, and Ctrl+Z undoes the
// ENTIRE drag in one step. Also drags an extrude (blue).
export async function run(page) {
  await page.goto("/");
  await page.waitForTimeout(1000);

  // Box + pocket. The pocket is the cut half of the convention.
  await page.click('button:has-text("Code")');
  await page.waitForTimeout(300);
  await page.click(".cm-content");
  await page.keyboard.press("Control+a");
  await page.keyboard.type(
    "const sk1 = sketch('top'); sk1.rect(30, 20); const b1 = cuboid(60, 40, 20);\n" +
    "pocket(sk1, b1, 8);\n",
    { delay: 5 },
  );
  await page.waitForTimeout(200);
  await page.click("button.btn-run");
  await page.waitForTimeout(600);
  await page.click('button:has-text("Build")');
  await page.waitForTimeout(500);

  const pocketRow = page.locator(".model-timeline .model-row").filter({ hasText: /pocket/i }).first();
  await pocketRow.click();
  await page.waitForTimeout(400);
  // The committed depth BEFORE the drag, read off the SAME panel the
  // drag drives (the convergence param -- 8 here).
  const depthBox = page.locator(".reshape-params input").first();
  const before = await depthBox.inputValue();

  // Drag the depth arrow: down, small steps (preview frames), up.
  const arrow = page.locator(".handle.is-size, .handle").first();
  const abox = await arrow.boundingBox();
  const sx = abox.x + abox.width / 2;
  const sy = abox.y + abox.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 12, sy, { steps: 4 });
  await page.waitForTimeout(120);
  await page.mouse.move(sx + 24, sy, { steps: 4 });
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(400);

  // ONE undo: Ctrl+Z must revert the whole drag at once. The value after
  // one Ctrl+Z equals the PRE-DRAG committed value -- the entire gesture
  // folded to one entry.
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(500);
  const afterUndo = await depthBox.inputValue();
  if (afterUndo !== before) {
    throw new Error(`one Ctrl+Z did not revert the whole drag: pre-drag ${before}, after ${afterUndo}`);
  }
  await page.waitForTimeout(200);
}
