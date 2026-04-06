import { test, expect } from '@playwright/test';

test('clipboard hover - no background change', async ({ page }) => {
  await page.goto('http://localhost:3001');
  await page.waitForTimeout(1500);

  const trigger = page.locator('.chat-area .clipboard-trigger:visible').first();

  // Default state
  const defaultStyles = await trigger.evaluate(el => {
    const computed = window.getComputedStyle(el);
    return {
      opacity: parseFloat(computed.opacity),
      backgroundColor: computed.backgroundColor
    };
  });

  console.log('Default:', defaultStyles);

  // Hover state
  await trigger.hover({ force: true });
  await page.waitForTimeout(100);

  const hoverStyles = await trigger.evaluate(el => {
    const computed = window.getComputedStyle(el);
    return {
      opacity: parseFloat(computed.opacity),
      backgroundColor: computed.backgroundColor
    };
  });

  console.log('Hover:', hoverStyles);

  // Opacity should increase
  expect(hoverStyles.opacity).toBeGreaterThan(defaultStyles.opacity);
  
  // Background should NOT change (should remain transparent/none)
  expect(hoverStyles.backgroundColor).toBe(defaultStyles.backgroundColor);
  expect(hoverStyles.backgroundColor).toBe('rgba(0, 0, 0, 0)');

  console.log('✅ Hover effect: opacity changes, background stays transparent');
});
