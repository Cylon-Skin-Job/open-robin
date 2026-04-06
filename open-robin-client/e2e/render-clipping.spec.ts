import { test, expect } from '@playwright/test';

/**
 * Test: Content clipping diagnosis.
 *
 * Send a message, then take screenshots at intervals to catch
 * the thinking and text content as it renders. Log content lengths
 * and visible text at each snapshot.
 */

test('diagnose content clipping during render', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(2000);

  // Click new chat
  const newChatBtn = page.locator('.new-chat-btn').first();
  if (await newChatBtn.isVisible()) {
    await newChatBtn.click();
    await page.waitForTimeout(1500);
  }

  // Send message
  const input = page.getByPlaceholder('Ask about code workspace...');
  await input.fill('Write me a haiku about the ocean. Think about it carefully first.');
  await input.press('Enter');

  // Wait for orb to finish (2s) + segments to start
  await page.waitForTimeout(3000);

  // Now take rapid screenshots to catch the rendering
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(1000);

    // Screenshot
    await page.screenshot({
      path: `e2e/screenshots/clip-${String(i).padStart(2, '0')}.png`,
      fullPage: true
    });

    // Log all visible content in assistant messages
    const assistantMsgs = page.locator('.message-assistant');
    const msgCount = await assistantMsgs.count();

    for (let m = 0; m < msgCount; m++) {
      const msg = assistantMsgs.nth(m);
      const text = await msg.textContent();
      const truncated = text?.slice(0, 200) || '(empty)';
      console.log(`[T=${i}s] msg[${m}]: "${truncated}"`);
    }

    // Check for any content with overflow:hidden that might be clipping
    const hiddenOverflow = await page.evaluate(() => {
      const elements = document.querySelectorAll('.message-assistant *');
      const clipped: string[] = [];
      elements.forEach(el => {
        const style = window.getComputedStyle(el);
        if (style.overflow === 'hidden' && el.scrollHeight > el.clientHeight) {
          const tag = el.tagName.toLowerCase();
          const cls = el.className;
          clipped.push(`${tag}.${cls} scrollH=${el.scrollHeight} clientH=${el.clientHeight} maxH=${style.maxHeight}`);
        }
      });
      return clipped;
    });

    if (hiddenOverflow.length > 0) {
      console.log(`[T=${i}s] CLIPPED ELEMENTS:`, hiddenOverflow);
    }

    // Check max-height values on content areas
    const maxHeights = await page.evaluate(() => {
      const items: string[] = [];
      document.querySelectorAll('.message-assistant div[style]').forEach(el => {
        const style = (el as HTMLElement).style;
        if (style.maxHeight) {
          const text = (el as HTMLElement).textContent?.slice(0, 50) || '';
          items.push(`maxH=${style.maxHeight} opacity=${style.opacity} text="${text}"`);
        }
      });
      return items;
    });

    if (maxHeights.length > 0) {
      console.log(`[T=${i}s] MAX-HEIGHT DIVS:`, maxHeights);
    }
  }
});
