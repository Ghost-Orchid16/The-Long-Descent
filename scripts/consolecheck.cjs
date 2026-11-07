// Load each stage headless and report console warnings/errors: node scripts/consolecheck.cjs [stages] [baseUrl]
const { chromium } = require('playwright');
(async () => {
  const stages = (process.argv[2] || '0,1,2,3,4,5,6,7,8,9,10,title').split(',');
  const base = process.argv[3] || 'http://localhost:5173/';
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  let total = 0;
  for (const st of stages) {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    const issues = [];
    page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') issues.push(`[${m.type()}] ${m.text()}`); });
    page.on('pageerror', (e) => issues.push(`[pageerror] ${e.message}`));
    const q = st === 'title' ? 'fixed=1' : `stage=${st}&fixed=1&sim=4`;
    const t0 = Date.now();
    await page.goto(base + '?' + q, { waitUntil: 'load' });
    try { await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000, polling: 500 }); } catch (e) { issues.push('[timeout] not ready'); }
    await page.waitForTimeout(6000);
    console.log(`stage ${st}: ${issues.length ? issues.length + ' issue(s)' : 'clean'} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    for (const i of [...new Set(issues)].slice(0, 12)) console.log('   ' + i.slice(0, 300));
    total += issues.length;
    await page.close();
  }
  await browser.close();
  process.exit(total ? 1 : 0);
})();
