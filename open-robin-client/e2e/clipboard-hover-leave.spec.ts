import { test, expect } from '@playwright/test';

test('clipboard returns to prior state when not hovered', async ({ page }) => {
  const allLogs: string[] = [];
  page.on('console', msg => {
    allLogs.push(msg.text());
  });

  await page.goto('http://localhost:3001');
  await page.waitForTimeout(1500);

  const trigger = page.locator('.chat-area .clipboard-trigger:visible').first();
  const popover = page.locator('.chat-area .clipboard-bubble').first();

  // Step 1: Verify default state
  const defaultState = await popover.evaluate(el => el.getAttribute('data-state'));
  console.log('Initial state:', defaultState);

  // Step 2: Hover trigger - popover should appear
  await trigger.hover({ force: true });
  await page.waitForTimeout(300);

  const previewState = await popover.evaluate(el => el.getAttribute('data-state'));
  console.log('After hover state:', previewState);
  expect(previewState).toBe('PREVIEW');

  // Step 3: Move mouse to a neutral position (not over trigger)
  const box = await trigger.boundingBox();
  if (box) {
    // Move to just outside the trigger
    await page.mouse.move(box.x - 10, box.y);
  }
  
  console.log('Waiting...');
  await page.waitForTimeout(500);

  // Step 4: Check state
  const finalState = await popover.evaluate(el => el.getAttribute('data-state'));
  console.log('After leaving state:', finalState);
  
  // Print relevant logs
  const relevantLogs = allLogs.filter(l => 
    l.includes('Clipboard') || l.includes('MOUSE') || l.includes('timer')
  );
  console.log('Relevant logs:', relevantLogs);

  expect(finalState).toBe('CLOSED');
});
