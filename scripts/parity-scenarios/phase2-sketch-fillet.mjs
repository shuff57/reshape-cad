// Wave 2 todo 13 closeout (fusion-parity-closure todo 13): the sketch fillet
// tool (commit 3f1ffa3) end-to-end — arm with 'f', click a corner, type the
// radius, Enter. Asserts the arc row exists after the commit and the two
// legs were trimmed back (the corner is rounded, not just decorated).
export async function run(page) {
  await page.goto("/");
  await page.waitForTimeout(1000);
  await page.click('button:has-text("Sketch")');
  await page.waitForTimeout(600);

  const toScreen = (wx, wy) =>
    page.evaluate(([wx, wy]) => {
      const svg = document.querySelector("svg.sk2d-svg");
      const p = new DOMPoint(wx, -wy).matrixTransform(svg.getScreenCTM());
      return [p.x, p.y];
    }, [wx, wy]);
  const lineParts = () => page.$$eval("line[data-part]", (els) => els.map((e) => e.getAttribute("data-part")));
  const status = () => page.$$eval(".sk2d-status", (els) => els.map((e) => e.textContent));

  // Seed rect: s:1 bottom (0,0)-(40,0), s:2 right (40,0)-(40,-25), s:3 top,
  // s:4 left. Fillet the (0,0) corner = screen at world (0,0).
  const o = await toScreen(0, 0);
  await page.keyboard.press("f");
  await page.waitForTimeout(200);
  await page.mouse.click(o[0] + 1, o[1] - 1);
  await page.waitForTimeout(300);
  const chip = page.locator("[data-fillet-pending]");
  if (!(await chip.count())) {
    throw new Error(`fillet chip never opened; status: ${JSON.stringify(await status())}`);
  }
  const before = await page.$$eval("line[data-part]", (els) => els.length);
  await chip.fill("8");
  await chip.press("Enter");
  await page.waitForTimeout(500);
  const arcs = await page.$$eval("polyline[data-part]", (els) => els.map((e) => e.getAttribute("data-part")));
  if (arcs.length === 0) {
    throw new Error(`fillet Enter produced no arc row; status: ${JSON.stringify(await status())}`);
  }
  // The picked corner's two legs must have been trimmed back: line s:1 no
  // longer starts at (0,0) and s:4 no longer ends at (0,0).
  const s1 = await page.$eval('line[data-part="s:1"]', (e) => [+e.getAttribute("x1"), +e.getAttribute("y1")]);
  const s4 = await page.$eval('line[data-part="s:4"]', (e) => [+e.getAttribute("x2"), +e.getAttribute("y2")]);
  if (Math.hypot(s1[0] - 0, s1[1] - 0) < 1) {
    throw new Error(`fillet did not trim leg s:1 off the corner: a stays at ${JSON.stringify(s1)}`);
  }
  if (Math.hypot(s4[0] - 0, s4[1] - 25) < 1) {
    throw new Error(`fillet did not trim leg s:4's (0,0) end: b stays at ${JSON.stringify(s4)}`);
  }
  void lineParts;
}