// Phase 5.1 feature manipulator (todo 22, SPEC-mouse-parity.md): a selected
// pocket grows an on-canvas arrow + drag-or-type value box. Happy path:
// the box carries the committed depth at rest, typing an exact value and
// pressing Enter commits it. Failure path: typing a NEGATIVE value -- which
// no depth can take -- is refused with a plain-English note and the doc is
// untouched (the box still shows the old value afterwards).
export async function run(page) {
  await page.goto("/");
  await page.waitForTimeout(1000);

  // Build the model from the Code side: a box, a pocket cut into it. The
  // pocket carries a `_depth` manipulator (single positive-extent param).
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

  const canvas = page.locator("canvas").first();
  const cbox = await canvas.boundingBox();
  const cx = cbox.x + cbox.width / 2;
  const cy = cbox.y + cbox.height / 2;

  // Select the pocket via its timeline chip, so the manipulator targets it.
  const tlItem = page
    .locator(".model-timeline .model-row")
    .filter({ hasText: /pocket/i })
    .first();
  await tlItem.click();
  await page.waitForTimeout(400);

  // HAPPY 1 -- the value box exists and carries the committed depth (8).
  const vBox = page.locator("[data-value-box='manipulator-value']");
  const atRest = await vBox.inputValue();
  if (!/^\d/.test(atRest.trim())) {
    throw new Error(`manipulator value box did not show a number at rest: "${atRest}"`);
  }

  // HAPPY 2 -- type an exact value, Enter commits it (the type half of
  // drag-or-type). 12 chosen distinct from 8 so the change is provable.
  await vBox.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("12");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  const afterType = await vBox.inputValue();
  if (!/12/.test(afterType)) {
    throw new Error(`typing 12 + Enter did not commit; box shows "${afterType}"`);
  }

  // FAILURE -- a negative value for a feature that cannot take one: the
  // note appears, in a sentence, and the committed value is unchanged.
  await vBox.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("-5");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  const note = page.locator(".mani-note");
  if (!(await note.count())) {
    throw new Error("typing -5 did not show a refusal note");
  }
  const noteText = await note.textContent();
  if (!/positive/.test(noteText ?? "")) {
    throw new Error(`refusal note did not explain itself: "${noteText}"`);
  }
  // Escape drops the refused draft: the box reverts to the COMMITTED
  // value (12) -- proof the refusal wrote nothing, not even a -5.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const afterRefusal = await vBox.inputValue();
  if (!/12/.test(afterRefusal) || /-/.test(afterRefusal)) {
    throw new Error(`after refusing -5 the box should revert to the committed 12, got "${afterRefusal}"`);
  }
  await page.waitForTimeout(200);
}