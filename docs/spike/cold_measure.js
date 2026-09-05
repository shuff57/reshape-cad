async (page) => {
  const t0 = Date.now();
  const consoleReady = page.waitForEvent('console', {
    predicate: msg => msg.text().includes('STARTUP_DONE'),
    timeout: 180000,
  });
  await page.goto('https://magik.net/freecad/app.html', { waitUntil: 'commit' });
  const navTime = Date.now();
  await consoleReady;
  const t1 = Date.now();

  const perf = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource');
    const transferBytes = resources.reduce((sum, r) => sum + (r.transferSize || 0), 0) + (nav ? nav.transferSize || 0 : 0);
    return {
      transferBytes,
      crossOriginIsolated: self.crossOriginIsolated,
      resourceCount: resources.length,
    };
  });

  return {
    elapsedMs: t1 - t0,
    navToCommitMs: navTime - t0,
    ...perf,
  };
}
