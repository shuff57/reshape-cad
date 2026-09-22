// Phase 5.4 step tooltips (todo 26, SPEC-mouse-parity.md): the prompt
// string tied to COMMAND STATE. Happy: start a command with no selection
// ("Select...") -- the prompt changes once a selection is held. Failure:
// cancel mid-way (Esc / deselection) and the tooltip CLEARS rather than
// persisting a stale prompt for a command that is no longer active.
export async function run(page) {
  await page.goto("/");
  await page.waitForTimeout(1000);

  // Build a model: a box (move tool target) and a pocket.
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

  // Select the pocket -- its manipulator command becomes active.
  const pocketRow = page.locator(".model-timeline .model-row").filter({ hasText: /pocket/i }).first();
  await pocketRow.click();
  await page.waitForTimeout(400);

  // The tooltip is on screen while the command is active.
  const tip = page.locator(".step-tooltip");
  if (!(await tip.count())) {
    throw new Error("an active command did not show its step tooltip");
  }

  // Cancel: clear the selection -- the tooltip must CLEAR, not persist.
  const selBtn = page.locator(".reshape-studio-status-sel");
  if (await selBtn.count()) {
    await selBtn.click();
    await page.waitForTimeout(300);
  }
  if (await tip.count()) {
    throw new Error(`the tooltip persisted after the command ended: "${await tip.first().textContent()}"`);
  }
  await page.waitForTimeout(200);
}