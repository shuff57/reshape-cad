// Phase 5.1 part 2 -- the taper/angle arc handle (todo 23,
// SPEC-mouse-parity.md "arc handle for taper/angle"). Re-targeted to
// DraftFeature.angle per plan review: ExtrudeFeature has no taper field,
// draft(angle) is the feature that genuinely carries one. Happy path:
// selecting the draft shows the arc + a typeable angle box. Failure path:
// selecting a fillet shows NO taper arc at all (absent, not disabled).
export async function run(page) {
  await page.goto("/");
  await page.waitForTimeout(1000);

  // Box + whole draft at 8 degrees. The draft carries the angle param.
  await page.click('button:has-text("Code")');
  await page.waitForTimeout(300);
  await page.click(".cm-content");
  await page.keyboard.press("Control+a");
  await page.keyboard.type(
    "const b1 = cuboid(60, 40, 20);\n" +
    "draft(b1, 8, { whole: true, from: 'top' });\n",
    { delay: 5 },
  );
  await page.waitForTimeout(200);
  await page.click("button.btn-run");
  await page.waitForTimeout(600);
  await page.click('button:has-text("Build")');
  await page.waitForTimeout(500);

  const canvas = page.locator("canvas").first();
  const cbox = await canvas.boundingBox();
  const cx = cbox.x + cbox.width / 2;
  const cy = cbox.y + cbox.height / 2;

  // Select the draft via its timeline chip.
  const draftRow = page.locator(".model-timeline .model-row").filter({ hasText: /draft/i }).first();
  await draftRow.click();
  await page.waitForTimeout(400);

  // HAPPY -- the taper arc + its value box exist for the draft, and the
  // box carries the committed angle (8).
  const taperSvg = page.locator(".mani-taper");
  if (!(await taperSvg.count())) {
    throw new Error("a selected draft did not render the taper arc");
  }
  const taperBox = page.locator("[data-value-box='manipulator-taper']");
  const atRest = await taperBox.inputValue();
  if (!/8/.test(atRest.trim())) {
    throw new Error(`taper value box did not show the committed angle 8 at rest: "${atRest}"`);
  }

  // Type a new angle, Enter commits it.
  await taperBox.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("15");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  const afterType = await taperBox.inputValue();
  if (!/15/.test(afterType)) {
    throw new Error(`typing 15 + Enter did not commit the angle; box shows "${afterType}"`);
  }

  // FAILURE -- select the fillet (add a Round first via the ribbon? No:
  // use the Code side to add one, rebuild, then select it).
  await page.click('button:has-text("Code")');
  await page.waitForTimeout(300);
  await page.click(".cm-content");
  await page.keyboard.press("Control+a");
  await page.keyboard.type(
    "const b1 = cuboid(60, 40, 20);\n" +
    "const r1 = round(b1.edge('top', 'front'), 3);\n",
    { delay: 5 },
  );
  await page.waitForTimeout(200);
  await page.click("button.btn-run");
  await page.waitForTimeout(600);
  await page.click('button:has-text("Build")');
  await page.waitForTimeout(500);
  const filletRow = page.locator(".model-timeline .model-row").filter({ hasText: /round|filleted/i }).first();
  await filletRow.click();
  await page.waitForTimeout(400);
  if (await taperSvg.count()) {
    throw new Error("a fillet rendered a taper arc -- the arc must be ABSENT for a feature with no angle param");
  }

  // Clear the selection for the camera.
  await page.mouse.click(cx, 10);
  await page.waitForTimeout(200);
}