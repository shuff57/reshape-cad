// Phase 2 sketch baseline (SPEC-mouse-parity.md Phase 2, items 1-2,3,4,5,7,8)
// -- see commits 7101c04, e7373d9, b94f263, 88f9da2, 98ab880, 613feca.
export async function run(page) {
  await page.goto("/");
  await page.waitForTimeout(1000);

  // Open a sketch (item 1: sketch-view pan/zoom is the surface these tools sit on).
  await page.click('button:has-text("Sketch")');
  await page.waitForTimeout(500);

  const svg = page.locator("svg.sk2d-svg");
  const box = await svg.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Item 2: drag-create a rectangle in one gesture.
  await page.click('button.sk2d-tool:has-text("Rect")');
  await page.mouse.move(cx - 220, cy - 180);
  await page.mouse.down();
  await page.mouse.move(cx - 120, cy - 100, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  // Item 3: apply a snap -- start a line at an existing vertex.
  const startVertex = page.locator("circle.sk-vertex").first();
  const vb = await startVertex.boundingBox();
  await page.click('button.sk2d-tool:has-text("Line")');
  await page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await page.mouse.move(cx - 50, cy - 250, { steps: 6 });
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  // Item 4: drag a whole entity (bottom edge of the doc's starting rectangle).
  const edge = page.locator('line[data-part="s:1"]');
  const edgeBox = await edge.boundingBox();
  const edgeMidX = edgeBox.x + edgeBox.width / 2;
  const edgeMidY = edgeBox.y + edgeBox.height / 2;
  await page.click('button.sk2d-tool:has-text("Select")');
  await page.mouse.move(edgeMidX, edgeMidY);
  await page.mouse.down();
  await page.mouse.move(edgeMidX, edgeMidY - 60, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  // Item 5: marquee-select (window, left-to-right, fully enclosing).
  await page.mouse.move(cx - 260, cy - 260);
  await page.mouse.down();
  await page.mouse.move(cx + 260, cy + 60, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  // Item 7: place an on-canvas dimension, type a value, commit.
  const dimEdge = page.locator('line[data-part="s:1"]');
  const dimEdgeBox = await dimEdge.boundingBox();
  const dimMidX = dimEdgeBox.x + dimEdgeBox.width / 2;
  const dimMidY = dimEdgeBox.y + dimEdgeBox.height / 2;
  await page.click('button.sk2d-tool[title*="Dimension"]');
  await page.mouse.click(dimMidX, dimMidY);
  await page.waitForTimeout(120);
  await page.mouse.click(dimMidX, dimMidY - 40);
  await page.waitForTimeout(150);
  await page.keyboard.type("45");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);

  // Item 8: select and delete a constraint glyph (from the drag-created rect).
  const glyph = page.locator("circle.sk-rule-hit").first();
  const glyphBox = await glyph.boundingBox();
  await page.click('button.sk2d-tool:has-text("Select")');
  await page.mouse.click(glyphBox.x + glyphBox.width / 2, glyphBox.y + glyphBox.height / 2);
  await page.waitForTimeout(150);
  await page.keyboard.press("Delete");
  await page.waitForTimeout(200);
}
