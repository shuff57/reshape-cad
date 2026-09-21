// Phase 3 box select baseline (SPEC-mouse-parity.md Phase 3 item 4) -- also
// the live regression test for the box-select-multi-owner bug fixed in
// ReshapeStudio.tsx's distinctOwners() (see box-select-owners.test.mjs for
// the unit-level proof; this is the same claim proven end-to-end through a
// real drag). Coordinates below were confirmed live against a running
// sandbox-dev instance -- three boxes placed side-by-side by newShape()'s
// own auto-offset, viewed FRONT, land at dx ~[-310,-190] / [-160,-40] /
// [40,160] from canvas center. Throws (not just logs) on a wrong result so
// this scenario doubles as the regression's own assertion, not just a video
// source.
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

  // Three side-by-side boxes.
  await page.click('button:has-text("Box")');
  await page.waitForTimeout(300);
  await page.click('button:has-text("Box")');
  await page.waitForTimeout(300);
  await page.click('button:has-text("Box")');
  await page.waitForTimeout(300);
  await clearSel();

  const canvas = page.locator("canvas");
  const cbox = await canvas.boundingBox();
  const cx = cbox.x + cbox.width / 2;
  const cy = cbox.y + cbox.height / 2;
  const top = cbox.y + 20;
  const bot = cbox.y + cbox.height - 20;

  await page.click('button:has-text("Persp")');
  await page.waitForTimeout(200);
  await page.click('text="FRONT"');
  await page.waitForTimeout(400);

  // WINDOW (left-to-right): fully encloses box3+box2, box1 untouched.
  await page.mouse.move(cx - 350, top);
  await page.mouse.down();
  await page.mouse.move(cx - 30, bot, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const windowResult = await statusText();
  if (windowResult !== "2 selected") {
    throw new Error(`window box-select: expected "2 selected", got "${windowResult}"`);
  }
  await clearSel();

  // CROSSING (right-to-left): starts INSIDE box1 (touches it partially,
  // not fully enclosed -- this is what "crossing includes touched" means),
  // sweeps through box2 (fully enclosed) into box3 (fully enclosed). The
  // regression this guards: box-selecting across MULTIPLE bodies used to
  // collapse to only the LAST item's owner, so this would have reported
  // "1 selected" (or similar) instead of all three distinct owners.
  await page.mouse.move(cx + 100, top);
  await page.mouse.down();
  await page.mouse.move(cx - 350, bot, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const crossingResult = await statusText();
  if (crossingResult !== "3 selected") {
    throw new Error(`crossing box-select: expected "3 selected" (all 3 bodies), got "${crossingResult}"`);
  }
}
