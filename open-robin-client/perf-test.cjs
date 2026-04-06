const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => {
    console.log(`[BROWSER ${msg.type()}] ${msg.text()}`);
  });

  console.log('--- Loading page ---');
  await page.goto('http://localhost:3001', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const buttons = await page.$$('.tool-btn');
  console.log(`Found ${buttons.length} tool buttons`);

  for (let i = 0; i < buttons.length; i++) {
    const title = await buttons[i].getAttribute('title');
    const t0 = Date.now();
    await buttons[i].click();
    await page.waitForTimeout(100);
    const t1 = Date.now();
    console.log(`[TEST] Clicked "${title}" — wall time: ${t1 - t0}ms`);
  }

  console.log('--- Second pass ---');
  for (let i = 0; i < buttons.length; i++) {
    const title = await buttons[i].getAttribute('title');
    const t0 = Date.now();
    await buttons[i].click();
    await page.waitForTimeout(100);
    const t1 = Date.now();
    console.log(`[TEST] Clicked "${title}" — wall time: ${t1 - t0}ms`);
  }

  await browser.close();
})();
