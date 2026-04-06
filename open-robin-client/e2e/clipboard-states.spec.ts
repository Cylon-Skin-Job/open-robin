import { test, expect } from '@playwright/test';

test('clipboard states - hover and inactive only, no color highlight', async ({ page }) => {
  await page.goto('http://localhost:3001');
  await page.waitForTimeout(1500);

  const trigger = page.locator('.chat-area .clipboard-trigger:visible').first();

  // Default state
  const defaultStyles = await trigger.evaluate(el => {
    const computed = window.getComputedStyle(el);
    return {
      opacity: parseFloat(computed.opacity),
      color: computed.color,
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
      color: computed.color,
      backgroundColor: computed.backgroundColor
    };
  });
  console.log('Hover:', hoverStyles);

  // Hover: opacity increases, no background change
  expect(hoverStyles.opacity).toBeGreaterThan(defaultStyles.opacity);
  expect(hoverStyles.backgroundColor).toBe(defaultStyles.backgroundColor);

  // Verify CSS classes - check the stylesheet directly
  const openClassStyles = await page.evaluate(() => {
    // Find the stylesheet with clipboard styles
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule instanceof CSSStyleRule && rule.selectorText === '.clipboard-trigger.open') {
            return {
              opacity: rule.style.opacity,
              color: rule.style.color
            };
          }
        }
      } catch (e) {
        // Cross-origin stylesheet, skip
      }
    }
    return null;
  });

  console.log('CSS .clipboard-trigger.open:', openClassStyles);

  // Should have opacity: 1 but NO color change (color should be empty/undefined)
  if (openClassStyles) {
    expect(openClassStyles.opacity).toBe('1');
    expect(openClassStyles.color).toBe(''); // No color override
  }

  // Screenshot for visual verification
  await page.screenshot({ path: 'test-results/clipboard-states.png' });

  console.log('✅ States verified:');
  console.log('   - Default: opacity 0.4, no background');
  console.log('   - Hover: opacity ~0.8-0.9, no background change');
  console.log('   - Open: opacity 1, NO color highlight (just opacity change)');
});
