// Screenshot helper for visual verification (headless Chromium, software WebGL).
// Usage: node scripts/shot.cjs '<json array of {q, out, w?, h?, wait?, frames?}>' [baseUrl]
//    or: node scripts/shot.cjs 'dev=m1&cam=...' out.png
const { chromium } = require('playwright');

(async () => {
  let jobs;
  const a = process.argv[2] || '';
  if (a.trim().startsWith('[')) jobs = JSON.parse(a);
  else jobs = [{ q: a, out: process.argv[3] || 'shot.png' }];
  const base = (a.trim().startsWith('[') ? process.argv[3] : process.argv[4]) || 'http://localhost:5173/';
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const job of jobs) {
    const w = job.w || 1280, h = job.h || 720;
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const logs = [];
    page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
    const url = base + '?' + job.q;
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'load' });
    try {
      await page.waitForFunction(() => window.__ready === true, null, { timeout: job.timeout || 240000, polling: 250 });
    } catch (e) {
      logs.push('[shot] timeout waiting for __ready');
    }
    if (job.wait) await page.waitForTimeout(job.wait);
    if (job.eval) { try { const r = await page.evaluate(job.eval); if (r !== undefined) logs.push('[eval] ' + JSON.stringify(r)); } catch (e) { logs.push('[eval error] ' + e.message); } }
    console.log(`== ${job.out} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    for (const l of logs) console.log('   ' + l);
    try { await page.screenshot({ path: job.out, timeout: 120000 }); } catch (e) { console.log('   [shot] screenshot failed: ' + e.message.split('\n')[0]); }
    await page.close();
  }
  await browser.close();
})();
