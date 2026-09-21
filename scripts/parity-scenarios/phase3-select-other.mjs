// Phase 3 click-and-hold "select other" baseline (SPEC-mouse-parity.md
// Phase 3.5, [CONFIRM behaviour] -- see input-threshold.ts for the settled
// 300ms/4px numbers vs the unverified-against-real-Fusion qualitative
// claim). Two boxes are placed at the IDENTICAL center via the Code side
// (not the Box button, whose newShape() auto-offset always spreads
// siblings along +X -- there is no ribbon action for "stack two bodies
// exactly", so this is the only way to get 2+ genuine overlapping
// candidates at one screen pixel, confirmed live: every point on their
// shared face returns exactly 2 hitCandidatesAt() results, cycling
// Box 2 -> Box 1 -> Box 2 on successive 300ms+ holds at the same point).
export async function run(page) {
  await page.goto("/");
  await page.waitForTimeout(1000);

  async function statusText() {
    return page.locator(".reshape-studio-status-sel").textContent();
  }
  async function clearSel() {
    const el = page.locator(".reshape-studio-status-sel");
    const txt = await el.textContent();
    if (txt && txt !== "Nothing selected") {
      await el.click();
      await page.waitForTimeout(120);
    }
  }

  await page.click('button:has-text("Code")');
  await page.waitForTimeout(300);
  await page.click(".cm-content");
  await page.keyboard.press("Control+a");
  await page.keyboard.type(
    "box(40, 40, 20, { at: [0, 0, 0] });\nbox(40, 40, 20, { at: [0, 0, 0] });\n",
    { delay: 5 },
  );
  await page.waitForTimeout(200);
  await page.click("button.btn-run");
  await page.waitForTimeout(600);
  await page.click('button:has-text("Build")');
  await page.waitForTimeout(500);

  const canvas = page.locator("canvas");
  const cbox = await canvas.boundingBox();
  const cx = cbox.x + cbox.width / 2;
  const cy = cbox.y + cbox.height / 2;

  // Hold #1: 300ms+ press-and-release with no movement -- commits the
  // cycle's first advance.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(350);
  await page.mouse.up();
  await page.waitForTimeout(120);
  const afterHold1 = await statusText();

  // Hold #2 at the SAME point: advances the cycle again.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(350);
  await page.mouse.up();
  await page.waitForTimeout(120);
  const afterHold2 = await statusText();

  if (afterHold1 === afterHold2) {
    throw new Error(
      `select-other: expected the selection to CHANGE between two 300ms+ holds at the same point, ` +
        `got "${afterHold1}" both times`,
    );
  }
  await clearSel();
}
