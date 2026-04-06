import { test } from '@playwright/test';

test('wiki floating chat', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await page.waitForTimeout(2000);

  // Navigate to wiki
  await page.locator('.material-symbols-outlined', { hasText: 'full_coverage' }).first().click();
  await page.waitForTimeout(1000);

  // Click Home topic so we have content
  await page.locator('.wiki-topic-item', { hasText: 'Home' }).click();
  await page.waitForTimeout(2000);

  await page.screenshot({ path: 'e2e/screenshots/01-wiki-with-fab.png', fullPage: true });

  // Check FAB exists
  const fab = page.locator('.floating-chat-fab');
  const fabVisible = await fab.isVisible();
  process.stdout.write(`FAB visible: ${fabVisible}\n`);

  if (fabVisible) {
    // Click FAB to open chat
    await fab.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'e2e/screenshots/02-chat-open.png', fullPage: true });

    // Check panel exists
    const panel = page.locator('.floating-chat-panel');
    process.stdout.write(`Panel visible: ${await panel.isVisible()}\n`);

    // Check ChatArea is inside
    const chatArea = page.locator('.floating-chat-body .chat-area');
    process.stdout.write(`ChatArea inside panel: ${await chatArea.count()}\n`);

    // Try dragging the panel
    const header = page.locator('.floating-chat-header');
    const box = await header.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 200, box.y + 100, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      await page.screenshot({ path: 'e2e/screenshots/03-chat-dragged.png', fullPage: true });
    }

    // Close the chat
    await page.locator('.floating-chat-close').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/screenshots/04-chat-closed.png', fullPage: true });

    // FAB should be back
    process.stdout.write(`FAB back after close: ${await fab.isVisible()}\n`);
  }
});
