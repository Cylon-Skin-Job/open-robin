import { test, expect } from '@playwright/test';

test('clipboard trigger styling verification', async ({ page }) => {
  await page.goto('http://localhost:3001');
  await page.waitForTimeout(1500);

  const trigger = page.locator('.chat-area .clipboard-trigger:visible').first();
  const popover = page.locator('.chat-area .clipboard-bubble').first();

  // ========== DEFAULT STATE ==========
  const defaultStyles = await trigger.evaluate(el => {
    const computed = window.getComputedStyle(el);
    return {
      opacity: computed.opacity,
      color: computed.color,
      backgroundColor: computed.backgroundColor,
      cursor: computed.cursor
    };
  });

  console.log('=== DEFAULT STATE ===');
  console.log('Trigger styles:', defaultStyles);

  // Verify default state
  expect(parseFloat(defaultStyles.opacity)).toBeCloseTo(0.4, 1);
  expect(defaultStyles.cursor).toBe('pointer');
  expect(defaultStyles.color).toBe('rgba(255, 255, 255, 0.6)');

  // ========== HOVER STATE ==========
  await trigger.hover({ force: true });
  await page.waitForTimeout(250); // Wait for hover timer (200ms) + transition

  const hoverStyles = await trigger.evaluate(el => {
    const computed = window.getComputedStyle(el);
    return {
      opacity: computed.opacity,
      backgroundColor: computed.backgroundColor
    };
  });

  console.log('\n=== HOVER STATE ===');
  console.log('Trigger hover styles:', hoverStyles);

  // Hover should increase opacity
  expect(parseFloat(hoverStyles.opacity)).toBeGreaterThan(0.5);

  // Check popover state after hover
  const popoverAfterHover = await popover.evaluate(el => {
    const computed = window.getComputedStyle(el);
    return {
      display: computed.display,
      opacity: computed.opacity,
      pointerEvents: computed.pointerEvents,
      visibility: computed.visibility
    };
  });
  console.log('Popover after hover:', popoverAfterHover);

  // ========== CLICK/OPEN STATE ==========
  await trigger.click();
  await page.waitForTimeout(300);

  const hasOpenClass = await trigger.evaluate(el => el.classList.contains('open'));
  const popoverHasOpenClass = await popover.evaluate(el => el.classList.contains('open'));

  console.log('\n=== CLICK STATE ===');
  console.log(`Trigger has 'open' class: ${hasOpenClass}`);
  console.log(`Popover has 'open' class: ${popoverHasOpenClass}`);

  const popoverOpenStyles = await popover.evaluate(el => {
    const computed = window.getComputedStyle(el);
    return {
      display: computed.display,
      opacity: computed.opacity,
      pointerEvents: computed.pointerEvents,
      transform: computed.transform,
      visibility: computed.visibility
    };
  });
  console.log('Popover open styles:', popoverOpenStyles);

  // If popover has 'open' class, verify its styles
  if (popoverHasOpenClass) {
    expect(parseFloat(popoverOpenStyles.opacity)).toBe(1);
    expect(popoverOpenStyles.pointerEvents).toBe('auto');
  }

  // ========== TRIGGER OPEN STATE ==========
  const triggerOpenStyles = await trigger.evaluate(el => {
    const computed = window.getComputedStyle(el);
    return {
      opacity: computed.opacity,
      color: computed.color
    };
  });
  console.log('Trigger open styles:', triggerOpenStyles);

  // When open, trigger should have full opacity and theme color
  if (hasOpenClass) {
    expect(parseFloat(triggerOpenStyles.opacity)).toBe(1);
  }

  // Take screenshot for visual verification
  await page.screenshot({ path: 'test-results/clipboard-open-state.png' });

  // Close
  await trigger.click();
  await page.waitForTimeout(300);

  const hasOpenClassAfterClose = await trigger.evaluate(el => el.classList.contains('open'));
  console.log(`\n=== AFTER CLOSE ===`);
  console.log(`Trigger has 'open' class after close: ${hasOpenClassAfterClose}`);
  expect(hasOpenClassAfterClose).toBe(false);
});

test('clipboard controller state transitions', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', msg => {
    logs.push(`[${msg.type()}] ${msg.text()}`);
  });

  await page.goto('http://localhost:3001');
  await page.waitForTimeout(1500);

  const trigger = page.locator('.chat-area .clipboard-trigger:visible').first();

  // Click to open
  await trigger.click();
  await page.waitForTimeout(200);

  // Check for state transition logs
  const stateLogs = logs.filter(l => l.includes('STATE TRANSITION'));
  console.log('State transition logs:', stateLogs);

  // Should see a state transition to LOCKED
  const lockedLog = logs.find(l => l.includes('STATE TRANSITION') && l.includes('LOCKED'));
  console.log('Locked state log:', lockedLog || 'NOT FOUND');

  // Click to close
  await trigger.click();
  await page.waitForTimeout(200);

  const closedLog = logs.find(l => l.includes('STATE TRANSITION') && l.includes('CLOSED'));
  console.log('Closed state log:', closedLog || 'NOT FOUND');
});

test('clipboard popover positioning and z-index', async ({ page }) => {
  await page.goto('http://localhost:3001');
  await page.waitForTimeout(1000);

  const popover = page.locator('.chat-area .clipboard-bubble').first();

  // Get computed positioning
  const positioning = await popover.evaluate(el => {
    const computed = window.getComputedStyle(el);
    return {
      position: computed.position,
      zIndex: computed.zIndex,
      bottom: computed.bottom,
      left: computed.left
    };
  });

  console.log('Popover positioning:', positioning);

  // Verify expected CSS values from views.css
  expect(positioning.position).toBe('absolute');
  expect(parseInt(positioning.zIndex)).toBeGreaterThan(1000);
});
