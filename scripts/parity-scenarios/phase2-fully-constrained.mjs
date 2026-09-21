// Todo 12 of fusion-parity-closure.md (Wave 2): verify the pre-existing DoF
// badge visual actually reaches the DOM as constraints are added, using the
// doc's own default sketch rectangle (opening Sketch mode always seeds one --
// confirmed live, contradicting an earlier assumption of an empty sketch).
//
// commitRect's own rules only cover 2 of the rect's 4 edges: `horizontal` on
// the FIRST line (base, s:1 here) and `vertical` on the SECOND (base+1, s:2)
// -- confirmed live via bounding boxes: s:1 is the bottom edge, s:2 the right
// edge, s:3 the top edge (no rule yet), s:4 the left edge (no rule yet, the
// closing segment). So s:3/H and s:4/V are exactly the two additions needed
// to fully angle-pin the rectangle.
//
// Dimensions are committed WITHOUT retyping the pre-filled value (the on-
// canvas dim chip pre-fills with the entity's CURRENT measured length --
// SketchCanvas2D.tsx's onDimClick/commitPlacedDim). Retyping an arbitrary
// number here (confirmed live) can snap the least-squares solve to a distant,
// non-rectangular configuration since only 2 of 4 edges carry an explicit
// H/V rule before this point -- keeping the current value commits a
// zero-residual constraint and leaves the rendered shape undisturbed.
//
// Live investigation (this scenario's own reason to exist) found that
// H / V / distance dims each reliably remove exactly 1 DoF, but the "Lock"
// button (`applyRule({k:'lock',...})`, canLock = selPoints.length===1) does
// NOT reduce the reported DoF at all, on any geometry, ever. Root-caused by
// reading brep-rs: `ConstraintKind::Lock` is deliberately zero Jacobian rows
// ("a lock is column removal, not a rule the solver can trade against other
// rules", mod.rs:441) and column removal is `ParamBlock::lock()`
// (params.rs:419, unit-tested at params.rs:797 -- the primitive itself
// works). But `.lock(` is called ONLY from that unit test, from mod.rs's own
// test, and from fd.rs's finite-difference test helper -- never from
// session.rs or wasm.rs, the actual JSON-rules-to-ParamBlock path the studio
// UI runs through. The Lock button is wired to push a rule row the session
// builder then silently drops for DoF purposes. Reaching literal DoF===0 is
// therefore NOT currently achievable through the live UI for any freestanding
// sketch (nothing else pins absolute position). This scenario documents that
// gap by asserting it explicitly rather than either faking a "Fully
// constrained" result or silently accepting a false pass.
export async function run(page) {
  await page.goto("/");
  await page.waitForTimeout(1000);

  await page.click('button:has-text("Sketch")');
  await page.waitForTimeout(500);

  async function dof() {
    const el = page.locator("span.sk-dof");
    const cls = await el.getAttribute("class");
    const text = await el.textContent();
    const m = /^(\d+) DoF$/.exec(text || "");
    const n = m ? Number(m[1]) : text === "Fully constrained \u2713" ? 0 : null;
    return { cls, text, n };
  }

  async function clickCenter(locator) {
    const bb = await locator.boundingBox();
    await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
  }

  async function commitDimKeepingPrefill(part) {
    const el = page.locator(`line[data-part="${part}"]`);
    const bb = await el.boundingBox();
    const mx = bb.x + bb.width / 2;
    const my = bb.y + bb.height / 2;
    await page.click('button.sk2d-tool[title*="Dimension"]');
    await page.mouse.click(mx, my);
    await page.waitForTimeout(120);
    // Place the label offset from the edge -- direction doesn't matter here,
    // only that the second click lands off the entity itself.
    await page.mouse.click(mx + (bb.width > bb.height ? 0 : 40), my - (bb.width > bb.height ? 40 : 0));
    await page.waitForTimeout(150);
    // No retype: Enter alone commits the pre-filled CURRENT measured value.
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
  }

  const d0 = await dof();
  if (d0.cls.includes("sk-dof-ok") || d0.n === 0) {
    throw new Error(`baseline: expected the default rect under-constrained, got "${d0.text}"`);
  }

  await page.click('button.sk2d-tool:has-text("Select")');

  // H on the top edge (s:3), the one commitRect leaves unconstrained.
  await clickCenter(page.locator('line[data-part="s:3"]'));
  await page.waitForTimeout(120);
  await page.click('button.sk2d-tool[title="Horizontal"]');
  await page.waitForTimeout(200);
  const d1 = await dof();
  if (d1.n !== d0.n - 1) {
    throw new Error(`H(top): expected DoF ${d0.n} -> ${d0.n - 1}, got "${d1.text}"`);
  }

  // V on the left edge (s:4), the other one commitRect leaves unconstrained.
  await clickCenter(page.locator('line[data-part="s:4"]'));
  await page.waitForTimeout(120);
  await page.click('button.sk2d-tool[title="Vertical"]');
  await page.waitForTimeout(200);
  const d2 = await dof();
  if (d2.n !== d1.n - 1) {
    throw new Error(`V(left): expected DoF ${d1.n} -> ${d1.n - 1}, got "${d2.text}"`);
  }

  // Width dimension on the bottom edge, height on the left edge -- both
  // committed at their current (unchanged) measured length.
  await commitDimKeepingPrefill("s:1");
  const d3 = await dof();
  if (d3.n !== d2.n - 1) {
    throw new Error(`width dim: expected DoF ${d2.n} -> ${d2.n - 1}, got "${d3.text}"`);
  }

  await commitDimKeepingPrefill("s:4");
  const d4 = await dof();
  if (d4.n !== d3.n - 1) {
    throw new Error(`height dim: expected DoF ${d3.n} -> ${d3.n - 1}, got "${d4.text}"`);
  }
  // After both H/V additions and both length dims, the badge visual must have
  // moved from "under-constrained" toward a lower reading -- this is the
  // render-path proof todo 12 asked for (dofClass/dofText DO reach the DOM
  // live, not just get computed and discarded).
  if (!d4.cls.includes("sk-dof-warn") && d4.n !== 0) {
    throw new Error(`after 4 constraints: expected still sk-dof-warn (or reaching 0), got class "${d4.cls}" text "${d4.text}"`);
  }

  // Lock the bottom-left corner -- the "position" ingredient the plan's own
  // commit c2e4bd0 names. Per this scenario's header comment, this is
  // confirmed to have NO effect on the reported DoF through the live UI
  // (the session builder never calls ParamBlock::lock()). Assert that
  // observed gap explicitly so a future fix is caught by this scenario
  // failing loudly (a false "no change" here would be silently stale).
  // Re-arm the Select tool first: committing a dimension above leaves
  // `tool` at 'dim' (SketchCanvas2D.tsx never resets it on commit), so a
  // click on the vertex would otherwise route through onDimClick (starting
  // a NEW point-to-point measurement) instead of onSelectClick -- confirmed
  // live, this was the first version's bug.
  await page.click('button.sk2d-tool:has-text("Select")');
  await page.waitForTimeout(120);
  await clickCenter(page.locator('circle.sk-vertex[data-part="v:1:a"]'));
  await page.waitForTimeout(120);
  const lockBtn = page.locator('button.sk2d-tool[title="Lock this point where it is"]');
  if ((await lockBtn.getAttribute("disabled")) !== null) {
    throw new Error("Lock: expected the button enabled with exactly one point selected");
  }
  await lockBtn.click();
  await page.waitForTimeout(250);
  const d5 = await dof();
  if (d5.n !== d4.n) {
    throw new Error(
      `Lock: expected NO DoF change (known gap -- ParamBlock::lock() is never called from session.rs/wasm.rs), ` +
        `but DoF moved ${d4.n} -> ${d5.n}. If this now reduces DoF, the gap this scenario documents has been fixed: ` +
        `update this file's header comment and docs/fusion-video-findings.md accordingly.`,
    );
  }
}
