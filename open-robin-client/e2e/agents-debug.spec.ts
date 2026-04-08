import { test } from '@playwright/test';

test('agents workspace debug', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));

  await page.goto('/');
  await page.waitForTimeout(2000);

  // Click agents tab (smart_toy icon)
  await page.locator('.tool-btn', { has: page.locator('.material-symbols-outlined', { hasText: 'smart_toy' }) }).click();
  await page.waitForTimeout(3000);

  const tiles = page.locator('.agent-tile');
  const loading = page.locator('.agent-tiles-loading');
  process.stdout.write(`tiles: ${await tiles.count()}\n`);
  process.stdout.write(`loading visible: ${await loading.isVisible().catch(() => false)}\n`);

  // List tile names
  const names = await page.locator('.agent-tile-name').allTextContents();
  process.stdout.write(`names: ${names.join(', ')}\n`);

  // Click first tile to test overlay
  if (await tiles.count() > 0) {
    await tiles.first().click();
    await page.waitForTimeout(500);
    const overlay = page.locator('.agent-overlay');
    process.stdout.write(`overlay visible: ${await overlay.isVisible()}\n`);

    const detailName = await page.locator('.agent-overlay-detail-name').textContent();
    process.stdout.write(`detail name: ${detailName}\n`);

    // Close overlay
    await page.locator('.agent-overlay-close').click();
    await page.waitForTimeout(300);
    process.stdout.write(`overlay after close: ${await overlay.isVisible().catch(() => false)}\n`);
  }

  await page.screenshot({ path: 'e2e/screenshots/agents-debug.png', fullPage: true });
});
