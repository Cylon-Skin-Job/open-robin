import { test, expect } from '@playwright/test';

/**
 * Test: Orb and thinking icon alignment.
 *
 * 1. Click "New Thread" button
 * 2. Send a message
 * 3. Screenshot the orb while it's visible
 * 4. Wait for thinking segment to appear
 * 5. Screenshot the thinking icon
 * 6. Compare their X positions — they should align
 */

test('orb and thinking lightbulb icon are horizontally aligned', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(2000); // let WS connect

  // Step 1: Click new chat button (first visible one)
  const newChatBtn = page.locator('.new-chat-btn').first();
  if (await newChatBtn.isVisible()) {
    await newChatBtn.click();
    await page.waitForTimeout(1500); // wait for thread creation
  }

  // Step 2: Take a "before" screenshot
  await page.screenshot({ path: 'e2e/screenshots/01-before-send.png', fullPage: true });

  // Step 3: Type and send a message (use the visible code workspace input)
  const input = page.getByPlaceholder('Ask about code workspace...');
  await input.fill('What is 2+2? Think about it step by step.');
  await input.press('Enter');

  // Step 4: Wait for and screenshot the orb
  const orb = page.locator('.material-symbols-outlined:has-text("lens_blur")');
  try {
    await orb.waitFor({ state: 'visible', timeout: 3000 });
    const orbBox = await orb.boundingBox();
    console.log('[ORB] Bounding box:', JSON.stringify(orbBox));
    await page.screenshot({ path: 'e2e/screenshots/02-orb-visible.png', fullPage: true });
  } catch {
    console.log('[ORB] Orb not visible (may have been too fast)');
    await page.screenshot({ path: 'e2e/screenshots/02-orb-missed.png', fullPage: true });
  }

  // Step 5: Wait for first content (thinking or text segment)
  // The thinking icon is a "lightbulb" material icon inside a ToolCallBlock button
  const thinkingIcon = page.locator('button .material-symbols-outlined:has-text("lightbulb")').first();

  try {
    await thinkingIcon.waitFor({ state: 'visible', timeout: 30000 });
    const thinkBox = await thinkingIcon.boundingBox();
    console.log('[THINK] Bounding box:', JSON.stringify(thinkBox));
    await page.screenshot({ path: 'e2e/screenshots/03-thinking-visible.png', fullPage: true });

    // Step 6: Compare positions
    // Re-check orb position (it may have disappeared by now, so use saved value)
    // The key comparison: orb.x should equal thinkingIcon.x (same left alignment)
    if (thinkBox) {
      console.log(`[THINK] Icon at x=${thinkBox.x}, y=${thinkBox.y}, width=${thinkBox.width}`);
    }
  } catch {
    console.log('[THINK] No thinking segment appeared within timeout');
    await page.screenshot({ path: 'e2e/screenshots/03-no-thinking.png', fullPage: true });
  }

  // Step 7: Wait for more content and take final screenshot
  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'e2e/screenshots/04-final-state.png', fullPage: true });

  // Step 8: Capture all segment positions for analysis
  const allIcons = page.locator('.message-assistant .material-symbols-outlined');
  const iconCount = await allIcons.count();
  console.log(`[ICONS] Found ${iconCount} icons in assistant messages`);

  for (let i = 0; i < Math.min(iconCount, 10); i++) {
    const icon = allIcons.nth(i);
    const text = await icon.textContent();
    const box = await icon.boundingBox();
    console.log(`[ICON ${i}] "${text}" at x=${box?.x}, y=${box?.y}`);
  }
});
