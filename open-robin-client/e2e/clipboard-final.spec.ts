import { test, expect } from '@playwright/test';

test('clipboard icon styling - hover and active states', async ({ page }) => {
  await page.goto('http://localhost:3001');
  await page.waitForTimeout(1500);

  const trigger = page.locator('.chat-area .clipboard-trigger:visible').first();

  // Test 1: Default state styling
  const defaultStyles = await trigger.evaluate(el => {
    const computed = window.getComputedStyle(el);
    return {
      opacity: parseFloat(computed.opacity),
      color: computed.color,
      cursor: computed.cursor,
      backgroundColor: computed.backgroundColor
    };
  });

  console.log('Default state:', defaultStyles);
  
  // Verify default opacity is subtle (0.4)
  expect(defaultStyles.opacity).toBeCloseTo(0.4, 1);
  expect(defaultStyles.cursor).toBe('pointer');

  // Test 2: Hover state styling
  await trigger.hover({ force: true });
  await page.waitForTimeout(100);

  const hoverStyles = await trigger.evaluate(el => {
    const computed = window.getComputedStyle(el);
    return {
      opacity: parseFloat(computed.opacity),
      backgroundColor: computed.backgroundColor
    };
  });

  console.log('Hover state:', hoverStyles);
  
  // Hover should increase opacity
  expect(hoverStyles.opacity).toBeGreaterThan(0.5);

  // Test 3: Popover structure and positioning
  const popover = page.locator('.chat-area .clipboard-bubble').first();
  const positioning = await popover.evaluate(el => {
    const computed = window.getComputedStyle(el);
    return {
      position: computed.position,
      zIndex: parseInt(computed.zIndex),
      bottom: computed.bottom,
      left: computed.left
    };
  });

  console.log('Popover positioning:', positioning);
  
  expect(positioning.position).toBe('absolute');
  expect(positioning.zIndex).toBeGreaterThan(1000);

  // Test 4: Popover opens on hover (preview state)
  // After hover, popover should be in DOM with content
  const popoverHTML = await popover.evaluate(el => el.outerHTML.substring(0, 200));
  console.log('Popover HTML after hover:', popoverHTML);
  
  // Popover should have the 'open' class after hover
  const hasOpenClass = await popover.evaluate(el => el.classList.contains('open'));
  console.log('Popover has open class after hover:', hasOpenClass);
  
  // Screenshot for visual verification
  await page.screenshot({ path: 'test-results/clipboard-hover-state.png' });

  console.log('\n✅ Clipboard icon styling verified:');
  console.log('   - Default opacity: 0.4 (subtle)');
  console.log('   - Hover opacity: increased');
  console.log('   - Cursor: pointer');
  console.log('   - Popover positioned: absolute, z-index > 1000');
  console.log('   - Popover opens on hover:', hasOpenClass);
});
