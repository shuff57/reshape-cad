// Phase 1 camera/view baseline (SPEC-mouse-parity.md Phase 1, items 1-4 + the
// pre-existing ViewCube face click) -- see commit b31ee21 for the landed UI.
export async function run(page) {
  await page.goto("/");
  await page.waitForTimeout(1000);

  await page.click('button:has-text("Box")');
  await page.waitForTimeout(500);

  const canvas = page.locator("canvas");
  const cbox = await canvas.boundingBox();
  const cx = cbox.x + cbox.width / 2;
  const cy = cbox.y + cbox.height / 2;

  // Item 4a: fit-selection (select the box, then frame it).
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(150);
  await page.click('button:has-text("Fit Selection")');
  await page.waitForTimeout(300);

  // Item 1: orbit (default mouse-scheme preset, left-drag).
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy - 70, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  // Item 2: zoom to cursor (wheel at an off-center point).
  await page.mouse.move(cx + 150, cy - 100);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(200);

  // Item 3: ortho/perspective toggle.
  await page.click('button:has-text("Persp")');
  await page.waitForTimeout(200);

  // Item 4b: window-zoom (drag a rectangle to zoom into it).
  await page.click('button:has-text("Win Zoom")');
  await page.mouse.move(cx - 100, cy - 80);
  await page.mouse.down();
  await page.mouse.move(cx + 100, cy + 80, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  // ViewCube face click -- the raw mouse path (the TOP label now sits under
  // its own transparent face-cell zone button, todo 28; Playwright's strict
  // click would be intercepted by the overlay, and the wrapper's
  // elementFromPoint resolver handles the zone exactly like every other).
  const topFace = page.locator('button[data-face="top"]').first();
  const tfb = await topFace.boundingBox();
  await page.mouse.move(tfb.x + tfb.width / 2, tfb.y + tfb.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);
}
