// Scripted play-through helper: node scripts/play.cjs '<json>' — {q, steps:[{eval}|{wait}|{shot}|{waitFor}]}
const { chromium } = require('playwright');
(async () => {
  const arg = process.argv[2];
  const job = arg.trim().startsWith('{') ? JSON.parse(arg) : require(require('path').resolve(arg));
  const base = process.argv[3] || 'http://localhost:5173/';
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: job.w || 1280, height: job.h || 720 }, deviceScaleFactor: 1 });
  const t0 = Date.now();
  const log = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
  page.on('console', (m) => { const t = m.text(); if (!/\[vite\]/.test(t)) log(`[${m.type()}] ${t}`); });
  page.on('pageerror', (e) => log(`[pageerror] ${e.message}\n${e.stack || ''}`));
  await page.goto(base + '?' + job.q, { waitUntil: 'load' });
  for (const s of job.steps) {
    try {
      if (s.waitFor) await page.waitForFunction(s.waitFor, null, { timeout: s.timeout || 240000, polling: 250 });
      if (s.wait) await page.waitForTimeout(s.wait);
      if (s.eval) { const r = await page.evaluate(s.eval); if (r !== undefined) log('[eval] ' + JSON.stringify(r)); }
      if (s.shot) { await page.screenshot({ path: s.shot, timeout: 120000 }); log('shot ' + s.shot); }
    } catch (e) { log('[step error] ' + e.message.split('\n')[0]); }
  }
  await browser.close();
})();
