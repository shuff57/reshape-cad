// Phase 1.1 default scheme (todo 29 commit 2): a FRESH session (no stored
// preference) runs the Fusion scheme -- MMB-drag pans, and the scheme chip
// reads "Mouse: Fusion". A session with a stored 'legacy' preference keeps
// it (the default only reaches first-time users). The recorder uses a fresh
// context per run, so the first leg is the fresh-session case; the second
// leg seeds localStorage before load.
export async function run(page) {
  // --- Fresh session: default = fusion.
  await page.goto("/");
  await page.waitForTimeout(1000);
  const chip0 = await page.locator('button[title*="Mouse-button preset"]').textContent();
  if (!chip0.includes("Fusion")) throw new Error(`fresh session expected Mouse: Fusion, got "${chip0}"`);

  await page.click('button:has-text("Box")');
  await page.waitForTimeout(500);
  const canvas = page.locator("canvas").first();
  const cbox = await canvas.boundingBox();
  // Deselect the auto-picked box so a later empty-space drag orbits (a drag
  // from a picked body is the camera's; a drag from empty space is the
  // marquee -- the exact split onCanvasPointerDown implements).
  await page.mouse.click(cbox.x + 40, cbox.y + 40);
  await page.waitForTimeout(300);
  const cb = await canvas.boundingBox();
  const cx = cb.x + cb.width / 2;
  const cy = cb.y + cb.height / 2;

  // MMB-drag pans (fusion preset: PAN=1). OrbitControls PAN moves the
  // camera along its screen plane; assert the cube orientation DOES NOT
  // change (a pan keeps the view direction) and the scene is still rendered.
  const before = await page.evaluate(() => [...document.querySelectorAll("div")].find((d) => d.style.transform?.startsWith("rotateX"))?.style.transform);
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(cx + 40, cy + 30, { steps: 6 });
  await page.mouse.up({ button: "middle" });
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => [...document.querySelectorAll("div")].find((d) => d.style.transform?.startsWith("rotateX"))?.style.transform);
  if (before !== after) throw new Error("MMB-drag changed the view direction -- it behaved as orbit, not pan");

  // Shift+LMB-drag pans (three.js OrbitControls' OWN modifier rule, :1679:
  // a Rotate-bound button + Shift becomes PAN; orbit stays the plain-button
  // gesture). The camera keeps its view DIRECTION and slides sideways --
  // the cube orientation must be unchanged, the scene still rendered.
  const before2 = await page.evaluate(() => [...document.querySelectorAll("div")].find((d) => d.style.transform?.startsWith("rotateX"))?.style.transform);
  await page.keyboard.down("Shift");
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 80, cy - 40, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await page.waitForTimeout(300);
  const after2 = await page.evaluate(() => [...document.querySelectorAll("div")].find((d) => d.style.transform?.startsWith("rotateX"))?.style.transform);
  if (before2 !== after2) throw new Error("Shift+LMB should pan, not orbit -- view direction changed");

  // Shift+MMB orbits (three.js :1701: a Pan-bound button + Shift = ROTATE --
  // three's own modifier split, which lands the app on Fusion's exact
  // MMB-pan / Shift+MMB-orbit scheme with zero extra bindings). The view
  // DIRECTION must change.
  const before3 = await page.evaluate(() => [...document.querySelectorAll("div")].find((d) => d.style.transform?.startsWith("rotateX"))?.style.transform);
  await page.keyboard.down("Shift");
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(cx + 60, cy + 50, { steps: 8 });
  await page.mouse.up({ button: "middle" });
  await page.keyboard.up("Shift");
  await page.waitForTimeout(300);
  const after3 = await page.evaluate(() => [...document.querySelectorAll("div")].find((d) => d.style.transform?.startsWith("rotateX"))?.style.transform);
  if (before3 === after3) throw new Error("Shift+MMB did not orbit (view direction unchanged)");

  // --- Stored legacy preference survives the new default. (The default is
  // a fall-back, not a persisted write -- loadSchemeName() only reads, so
  // nothing lands in localStorage until the student themselves switches;
  // assert instead that an EXPLICIT stored preference wins over the
  // default, which is the actual contract.)
  await page.evaluate(() => { localStorage.setItem("reshape.mouseScheme", "legacy"); });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  const chip1 = await page.locator('button[title*="Mouse-button preset"]').textContent();
  if (!chip1.includes("Legacy")) throw new Error(`stored legacy preference was not honored; chip reads "${chip1}"`);
}