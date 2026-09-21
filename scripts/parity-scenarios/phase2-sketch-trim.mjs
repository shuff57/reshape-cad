// Wave 2 todo 14 closeout (fusion-parity-closure todo 14): the sketch trim
// tool end-to-end — an extra line is drawn ACROSS the seed rect's bottom
// edge, then the excess overhang is trimmed away at the crossing. Asserts
// the clicked line got split-and-shrunk (the overhang piece deleted).
// The endpoint-letter preservation fix (commit fbebb5f) is covered by unit
// test 41 in sketch-canvas-core.test.mjs; this is the UI-level pass.
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
  const status = () => page.$$eval(".sk2d-status", (els) => els.map((e) => e.textContent));

  // Draw a line from (20, 10) down to (20, -20): it crosses the seed rect's
  // bottom edge (s:1, y=0 from x 0..40) at (20,0) and stops INSIDE the rect
  // (world y=-20, not -40: the svg's own bottom edge IS the timeline strip,
  // so (20,-40)'s click lands on the timeline and eats the pick).
  await page.keyboard.press("l");
  await page.waitForTimeout(200);
  const top = await toScreen(20, 10);
  const bot = await toScreen(20, -20);

  // Draw a line from (20, 10) down to (20, -20): it crosses the seed rect's
  // bottom edge (s:1, y=0 from x 0..40) at (20,0) and stops INSIDE the rect
  // (world y=-20, not -40: the svg's own bottom edge IS the timeline strip,
  // so (20,-40)'s click lands on the timeline and eats the pick).
  await page.mouse.click(top[0], top[1]);
  await page.waitForTimeout(250);
  await page.mouse.click(bot[0], bot[1]);
  await page.waitForTimeout(250);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  const lines = await page.$$eval("line[data-part]", (els) =>
    els.map((e) => ({
      p: e.getAttribute("data-part"),
      x1: +e.getAttribute("x1"), y1: -e.getAttribute("y1"),
      x2: +e.getAttribute("x2"), y2: -e.getAttribute("y2"),
    })),
  );
  // (Live-measured: the draw lands at (19.92, -10)-(19.92, 19.84) — the
  // solver's LM relaxes exact coordinates slightly. Match with a tolerance.)
  const crosser = lines.find((g) => Math.abs(g.x1 - g.x2) < 0.2 && g.x1 > 15 && g.x1 < 25);
  if (!crosser) {
    throw new Error(`crossing line not drawn as written; lines: ${JSON.stringify(lines)}`);
  }

  // Trim: click the crosser's LOWER piece (world (20,-12), below the
  // crossing at y=0). The piece under the click is deleted; the surviving
  // piece must span y 10 down to 0 (the crossing with s:1).
  await page.keyboard.press("t");
  await page.waitForTimeout(200);
  const clickAt = await toScreen(20, -12);
  await page.mouse.click(clickAt[0], clickAt[1]);
  await page.waitForTimeout(500);
  const lines2 = await page.$$eval("line[data-part]", (els) =>
    els.map((e) => ({
      p: e.getAttribute("data-part"),
      x1: +e.getAttribute("x1"), y1: -e.getAttribute("y1"),
      x2: +e.getAttribute("x2"), y2: -e.getAttribute("y2"),
    })),
  );
  const survivor = lines2.find((g) => Math.abs(g.x1 - 20) < 1 || Math.abs(g.x2 - 20) < 1);
  if (!survivor) {
    throw new Error(`trim deleted the whole line; lines after: ${JSON.stringify(lines2)}`);
  }
  const minY = Math.min(survivor.y1, survivor.y2);
  const maxY = Math.max(survivor.y1, survivor.y2);
  if (Math.abs(minY - 0) > 2 || Math.abs(maxY - 10.05) > 2) {
    throw new Error(
      `trim split the crosser at the wrong place: survivor spans y ${minY}..${maxY}, expected ~0..~10.0 (the clicked LOWER piece, midpoint nearest (20,-12), must be deleted). status: ${JSON.stringify(
        await status(),
      )}`,
    );
  }
  // The LOWER piece (extending below y=0) must be GONE.
  const past = lines2.filter((g) => (Math.abs(g.x1 - 20) < 1 || Math.abs(g.x2 - 20) < 1) && Math.min(g.y1, g.y2) < -2);
  if (past.length > 0) {
    throw new Error(`the clicked piece below the crossing still exists: ${JSON.stringify(past)}`);
  }
}