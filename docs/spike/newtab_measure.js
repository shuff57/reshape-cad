async (page) => {
  const context = page.context();
  const page2 = await context.newPage();
  const t0 = Date.now();
  const consoleReady = page2.waitForEvent('console', {
    predicate: msg => msg.text().includes('STARTUP_DONE'),
    timeout: 180000,
  });
  await page2.goto('https://magik.net/freecad/app.html', { waitUntil: 'commit' });
  await consoleReady;
  const t1 = Date.now();

  const perf = await page2.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource');
    const transferBytes = resources.reduce((sum, r) => sum + (r.transferSize || 0), 0) + (nav ? nav.transferSize || 0 : 0);
    const detail = resources
      .filter(r => r.name.endsWith('.data') || r.name.endsWith('.wasm'))
      .map(r => ({ name: r.name.split('/').pop(), transferSize: r.transferSize, encodedBodySize: r.encodedBodySize }));
    return {
      transferBytes,
      crossOriginIsolated: self.crossOriginIsolated,
      resourceCount: resources.length,
      detail,
    };
  });

  await page2.close();

  return {
    elapsedMs: t1 - t0,
    ...perf,
  };
}
