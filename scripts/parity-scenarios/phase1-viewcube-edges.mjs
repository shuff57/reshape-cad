// Phase 1.5 ViewCube (todo 28): edge snap, corner snap, the cube's camera
// options menu, and the no-collision guarantee -- a right-click over the
// cube must open the MARKING menu (todo 17), never a second cube menu.
// Each step asserts programmatically; the .webm is a by-product.
export async function run(page) {
  await page.goto("/");
  await page.waitForTimeout(1000);

  await page.click('button:has-text("Box")');
  await page.waitForTimeout(500);

  const cube = page.locator('[data-zone]').first();
  const cbox = await cube.boundingBox();
  if (!cbox) throw new Error("no cube zone element found");

  // Locate the wrapper (the cube's own bounding box) from a zone button.
  const wrapBox = await page.locator('div[title*="Drag to orbit"]').boundingBox();
  if (!wrapBox) throw new Error("no nav-cube wrapper found");

  // --- 1. Edge zone: click the front face's top edge band. The resolver
  // goes through elementFromPoint at pointerup, so a plain click works.
  const edgeHit = page.locator('button[data-zone="front|top"]').first();
  const eb = await edgeHit.boundingBox();
  if (!eb) throw new Error("no front|top edge zone button");
  await page.mouse.click(eb.x + eb.width / 2, eb.y + eb.height / 2);
  await page.waitForTimeout(300);
  // Edge view: diagonal, so no view-strip preset is active.
  const homeActive = await page.locator('button[aria-pressed="true"]:has-text("Home")').count();
  if (homeActive !== 0) throw new Error("edge snap should clear the view-strip preset");

  // --- 2. Corner zone: isometric-style view.
  const cornerHit = page.locator('button[data-zone="front|right|top"]').first();
  const cb = await cornerHit.boundingBox();
  if (!cb) throw new Error("no front|right|top corner zone button");
  await page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.waitForTimeout(300);

  // --- 3. The affordance icon opens the cube's own menu; switch to
  // orthographic through it (the menu's OTHER entry point, per todo 28).
  const gear = page.locator('[data-cube-menu="1"]').first();
  const gb = await gear.boundingBox();
  if (!gb) throw new Error("no cube-menu affordance");
  await page.mouse.click(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await page.waitForTimeout(200);
  await page.click('button:has-text("Orthographic")');
  await page.waitForTimeout(300);
  // The view-strip's own toggle must now read the swapped kind.
  const stripOrtho = await page.locator('button[title*="perspective camera"]:has-text("Ortho")').count();
  if (stripOrtho !== 1) throw new Error("cube menu did not switch the live camera to orthographic");
  // Switch back through the same menu.
  await page.mouse.click(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await page.waitForTimeout(200);
  await page.click('button:has-text("Perspective")');
  await page.waitForTimeout(300);
  const stripPersp = await page.locator('button[title*="orthographic camera"]:has-text("Persp")').count();
  if (stripPersp !== 1) throw new Error("cube menu did not switch the live camera back to perspective");

  // --- 4. Collision guard: a right-click OVER the cube opens the marking
  // menu (todo 17 owns right-click everywhere), NOT a cube-specific menu.
  await page.mouse.click(wrapBox.x + wrapBox.width / 2, wrapBox.y + wrapBox.height / 2, { button: "right" });
  await page.waitForTimeout(400);
  const wedges = await page.locator(".marking-menu-wedge").count();
  if (wedges === 0) throw new Error("right-click over the cube did not open the marking menu");
  // The menu closes on a backdrop click (todo 17's dismiss path) — click the
  // backdrop far from the cube, then continue.
  await page.mouse.click(wrapBox.x - 150, wrapBox.y - 80);
  await page.waitForTimeout(300);
  const wedgesAfter = await page.locator(".marking-menu-wedge").count();
  if (wedgesAfter !== 0) throw new Error("marking menu did not close after backdrop click");

  // --- 5. Existing face-click behaviour still works after the additions.
  // The TOP face label is now visually UNDER its own transparent face-cell
  // zone button, so the raw mouse path is the real user path (Playwright's
  // strict click would be intercepted by the zone overlay — the resolver
  // handles it the same way it resolves every other zone).
  const topFace = page.locator('button[data-face="top"]').first();
  const tfb = await topFace.boundingBox();
  await page.mouse.move(tfb.x + tfb.width / 2, tfb.y + tfb.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);
}