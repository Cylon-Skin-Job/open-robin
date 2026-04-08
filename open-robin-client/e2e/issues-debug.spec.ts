import { test } from '@playwright/test';

test('issues workspace debug', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (msg) => {
    logs.push(`[${msg.type()}] ${msg.text()}`);
  });

  await page.goto('/');
  await page.waitForTimeout(2000);

  // Click issues tab
  await page.locator('.tool-btn', { has: page.locator('.material-symbols-outlined', { hasText: 'business_messages' }) }).click();
  await page.waitForTimeout(4000);

  // Check what rendered
  const ticketBoard = page.locator('.ticket-board');
  const ticketLoading = page.locator('.ticket-board-loading');
  const contentArea = page.locator('.content-area');

  process.stdout.write(`content-area count: ${await contentArea.count()}\n`);
  process.stdout.write(`ticket-board visible: ${await ticketBoard.isVisible().catch(() => false)}\n`);
  process.stdout.write(`ticket-board-loading visible: ${await ticketLoading.isVisible().catch(() => false)}\n`);

  // Check for ticket cards
  const cards = page.locator('.ticket-card');
  process.stdout.write(`ticket cards: ${await cards.count()}\n`);

  // Check columns
  const columns = page.locator('.ticket-column');
  process.stdout.write(`columns: ${await columns.count()}\n`);

  await page.screenshot({ path: 'e2e/screenshots/issues-debug.png', fullPage: true });

  // Print relevant console logs
  const relevant = logs.filter(l => l.includes('Ticket') || l.includes('issue') || l.includes('file_tree') || l.includes('Error'));
  process.stdout.write(`\n--- Console logs ---\n`);
  for (const l of relevant) {
    process.stdout.write(l + '\n');
  }
  process.stdout.write(`\n--- All logs (last 20) ---\n`);
  for (const l of logs.slice(-20)) {
    process.stdout.write(l + '\n');
  }
});
