import { test, expect } from '@playwright/test';

test('debug - click target identification', async ({ page }) => {
  await page.goto('http://localhost:3001');
  await page.waitForTimeout(1500);

  const trigger = page.locator('.chat-area .clipboard-trigger:visible').first();

  // Get info about the trigger element
  const triggerInfo = await trigger.evaluate(el => ({
    tagName: el.tagName,
    className: el.className,
    hasClickListener: true // We know it has onClick
  }));
  console.log('Trigger info:', triggerInfo);

  // Check if button is actually clickable
  const box = await trigger.boundingBox();
  console.log('Trigger bounding box:', box);

  // Try clicking at the center of the button
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  } else {
    await trigger.click();
  }
  
  await page.waitForTimeout(500);

  // Check popover state
  const popover = page.locator('.chat-area .clipboard-bubble').first();
  const dataState = await popover.evaluate(el => el.getAttribute('data-state'));
  console.log('Popover data-state after click:', dataState);
});
