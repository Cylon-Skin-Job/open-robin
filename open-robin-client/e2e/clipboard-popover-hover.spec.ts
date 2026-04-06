import { test, expect } from '@playwright/test';

test('popover stays open when hovered', async ({ page }) => {
  await page.goto('http://localhost:3001');
  await page.waitForTimeout(1500);

  const trigger = page.locator('.chat-area .clipboard-trigger:visible').first();
  const popover = page.locator('.chat-area .clipboard-bubble').first();

  // Step 1: Hover trigger to open popover
  await trigger.hover({ force: true });
  await page.waitForTimeout(300);

  const stateAfterHover = await popover.evaluate(el => el.getAttribute('data-state'));
  console.log('State after hover:', stateAfterHover);
  expect(stateAfterHover).toBe('PREVIEW');

  // Step 2: Move mouse from trigger to popover
  const popoverBox = await popover.boundingBox();
  if (popoverBox) {
    // Move to center of popover
    await page.mouse.move(
      popoverBox.x + popoverBox.width / 2,
      popoverBox.y + popoverBox.height / 2
    );
  }
  
  await page.waitForTimeout(200);

  // Step 3: Verify popover is still open
  const stateOnPopover = await popover.evaluate(el => el.getAttribute('data-state'));
  console.log('State while on popover:', stateOnPopover);
  expect(stateOnPopover).toBe('PREVIEW');

  // Step 4: Leave both trigger and popover
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);

  // Step 5: Should close after leaving both
  const finalState = await popover.evaluate(el => el.getAttribute('data-state'));
  console.log('Final state after leaving:', finalState);
  expect(finalState).toBe('CLOSED');

  console.log('✅ Popover stays open when hovered, closes when leaving both');
});
