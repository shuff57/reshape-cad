// Phase 3 mixed selection baseline (SPEC-mouse-parity.md Phase 3 item 3):
// Ctrl-click a face, then Ctrl-click an edge of the SAME body, and confirm
// the reducer keeps both (ModelEditor.tsx's mixedSelectionNote() is what
// later consumes this -- fillet only uses the edge item, and says so rather
// than silently dropping the face, per that function's own doc comment).
// A vertex candidate was probed live but not reliably reachable by blind
// screen-space coordinates (its hit band is a few px around an exact
// projected corner) -- skipped per the plan's "if reachable" allowance;
// face+edge alone already exercises the mixed-kind path.
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

  await page.click('button:has-text("Box")');
  await page.waitForTimeout(300);
  await clearSel();

  const canvas = page.locator("canvas");
  const cbox = await canvas.boundingBox();
  const cx = cbox.x + cbox.width / 2;
  const cy = cbox.y + cbox.height / 2;

  await page.click('button:has-text("Persp")');
  await page.waitForTimeout(200);
  await page.click('text="FRONT"');
  await page.waitForTimeout(400);

  // Face: dead center of the box's +y face. Ctrl held via explicit
  // keyboard.down/up rather than mouse.click's `modifiers` option --
  // confirmed live that `modifiers: ['Control']` does not reliably hold
  // Ctrl across the click in this environment (the second click silently
  // REPLACED instead of adding), while keyboard.down/up does.
  await page.keyboard.down("Control");
  await page.mouse.click(cx, cy);
  await page.keyboard.up("Control");
  await page.waitForTimeout(150);
  const afterFace = await statusText();
  if (!afterFace || !afterFace.includes("face")) {
    throw new Error(`mixed-select: expected a single face selected first, got "${afterFace}"`);
  }

  // Edge: confirmed live at dy=-85 from center (the box's top edge band).
  await page.keyboard.down("Control");
  await page.mouse.click(cx, cy - 85);
  await page.keyboard.up("Control");
  await page.waitForTimeout(150);
  const afterEdge = await statusText();
  if (afterEdge !== "Box 1 \u00b7 1 face + 1 edge") {
    throw new Error(`mixed-select: expected "1 face + 1 edge" (both kept together), got "${afterEdge}"`);
  }
}
