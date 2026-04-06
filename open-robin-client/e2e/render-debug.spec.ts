import { test } from '@playwright/test';

/**
 * Render debug — send message in existing workspace, rapid screenshots.
 */

test('render debug — fresh message', async ({ page }) => {
  // Increase timeout for this diagnostic test
  test.setTimeout(60000);

  await page.goto('/');
  await page.waitForTimeout(2000);

  // Screenshot to see what we're working with
  await page.screenshot({ path: 'e2e/screenshots/00-initial.png', fullPage: true });

  // Find any visible chat input
  const inputs = page.locator('textarea.chat-input');
  const inputCount = await inputs.count();
  console.log(`[INIT] Found ${inputCount} chat inputs`);

  // Find the visible one
  let visibleInput = null;
  for (let i = 0; i < inputCount; i++) {
    const inp = inputs.nth(i);
    if (await inp.isVisible()) {
      visibleInput = inp;
      const placeholder = await inp.getAttribute('placeholder');
      console.log(`[INIT] Visible input ${i}: "${placeholder}"`);
      break;
    }
  }

  if (!visibleInput) {
    console.log('[INIT] No visible chat input found');
    return;
  }

  // Check if there's a new chat button visible
  const newChatBtns = page.locator('.new-chat-btn');
  for (let i = 0; i < await newChatBtns.count(); i++) {
    const btn = newChatBtns.nth(i);
    const vis = await btn.isVisible();
    console.log(`[INIT] new-chat-btn[${i}] visible=${vis}`);
    if (vis) {
      console.log('[INIT] Clicking new chat button');
      await btn.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'e2e/screenshots/01-after-new-chat.png', fullPage: true });
      break;
    }
  }

  // Send message
  await visibleInput.fill('Tell me a short joke.');
  await visibleInput.press('Enter');
  console.log('[SEND] Message sent');

  // Rapid screenshots — every 500ms for 20s
  for (let i = 1; i <= 40; i++) {
    await page.waitForTimeout(500);
    await page.screenshot({
      path: `e2e/screenshots/${String(i + 1).padStart(2, '0')}-t${i * 500}ms.png`,
      fullPage: true,
    });

    const assistantDivs = page.locator('.message-assistant');
    const count = await assistantDivs.count();

    if (count > 0) {
      for (let m = 0; m < count; m++) {
        const div = assistantDivs.nth(m);
        const text = await div.textContent();
        const trimmed = (text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        console.log(`[T=${i * 500}ms] msg[${m}]: "${trimmed}"`);
      }

      // Check for clipped content
      const clipped = await page.evaluate(() => {
        const results: string[] = [];
        document.querySelectorAll('.message-assistant *').forEach(el => {
          const s = window.getComputedStyle(el);
          if (s.overflow === 'hidden' && el.scrollHeight > el.clientHeight + 2) {
            results.push(`${el.tagName}.${el.className} sH=${el.scrollHeight} cH=${el.clientHeight} maxH=${s.maxHeight}`);
          }
        });
        return results;
      });
      if (clipped.length > 0) console.log(`[T=${i * 500}ms] CLIPPED:`, clipped);
    } else {
      console.log(`[T=${i * 500}ms] (no assistant content)`);
    }
  }
});
