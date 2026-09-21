// Wave 2 todo 15 closeout (fusion-parity-closure todo 15): the sketch offset
// tool (commit b8c39a4) end-to-end — arm with 'o', click an edge, type the
// distance, Enter. Asserts a new parallel line at exactly the typed distance,
// the original kept (flipped to construction), and the zero-distance refusal
// (the plan's failure QA for this todo).
export async function run(page) {
  await page.goto("/");
  await page.waitForTimeout(1000);
  await page.click('button:has-text("Sketch")');
  await page.waitForTimeout(600);

  const status = () => page.$$eval(".sk2d-status", (els) => els.map((e) => e.textContent));
  const lineParts = () => page.$$eval("line[data-part]", (els) => els.length);

  // Seed rect present. Offset the bottom edge s:1 by 8, click BELOW it (the
  // side the click lands on decides which way the offset goes).
  await page.keyboard.press("o");
  await page.waitForTimeout(200);
  const mids = await page.$$eval("line[data-part]", (els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { p: e.getAttribute("data-part"), mx: r.x + r.width / 2, my: r.y + r.height / 2 };
    }),
  );
  const bottom = mids.reduce((a, b) => (b.my > a.my ? b : a));
  if (bottom.p !== "s:1") {
    throw new Error(`expected the seed rect's bottom edge to be s:1, got ${bottom.p}`);
  }
  await page.mouse.click(bottom.mx, bottom.my);
  await page.waitForTimeout(300);
  const chip = page.locator("[data-offset-pending]");
  if (!(await chip.count())) {
    throw new Error(`offset chip never opened; status: ${JSON.stringify(await status())}`);
  }
  const before = await lineParts();

  // Failure QA (plan todo 15): a zero-distance offset must be REFUSED with a
  // plain-English message, not create a duplicate coincident edge.
  await chip.fill("0");
  await chip.press("Enter");
  await page.waitForTimeout(400);
  const refusal = await status();
  const after0 = await lineParts();
  if (after0.length !== before.length) {
    throw new Error(`zero-distance offset created geometry (${before} -> ${after0} rows) instead of refusing`);
  }
  if (!refusal.some((t) => /positive distance/i.test(t ?? ""))) {
    throw new Error(`zero-distance offset refused without a plain-English message; status: ${JSON.stringify(refusal)}`);
  }

  // Then the real offset: 8mm below the bottom edge.
  await chip.fill("8");
  await chip.press("Enter");
  await page.waitForTimeout(500);
  const lines = await page.$$eval("line[data-part]", (els) =>
    els.map((e) => ({
      p: e.getAttribute("data-part"),
      x1: +e.getAttribute("x1"), y1: -e.getAttribute("y1"), // svg y -> world y
      x2: +e.getAttribute("x2"), y2: -e.getAttribute("y2"),
      cls: e.getAttribute("class") || "",
    })),
  );
  if (lines.length !== before + 1) {
    throw new Error(`offset should add exactly one row (${before} -> ${before + 1}), got ${lines.length}`);
  }
  const fresh = lines.find((g) => !["s:1", "s:2", "s:3", "s:4"].includes(g.p));
  if (!fresh) {
    throw new Error(`no new row after offset; lines: ${JSON.stringify(lines)}`);
  }
  // s:1 spans x 0..40 at y=0; the click ON the line itself resolves the side as +1
  // (the >= 0 tie in offsetChainPick), so the offset line sits at y=+8.
  const yVals = [fresh.y1, fresh.y2];
  if (!(Math.abs(fresh.x1 - fresh.x2) > 30)) {
    throw new Error(`offset row is not parallel to s:1: ${JSON.stringify(fresh)}`);
  }
  if (!yVals.some((y) => Math.abs(y - 8) < 0.1)) {
    throw new Error(`offset line not at exactly 8mm on the clicked side (expected y=+8): ${JSON.stringify(fresh)}`);
  }
  // Fusion-parity per the review: the ORIGINAL becomes construction.
  const orig = lines.find((g) => g.p === "s:1");
  if (!/sk-constr/.test(orig.cls)) {
    throw new Error(`original s:1 not flipped to construction; class: "${orig.cls}"`);
  }
}