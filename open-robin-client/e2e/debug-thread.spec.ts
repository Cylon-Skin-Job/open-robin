import { test, expect } from '@playwright/test';

test('debug new thread click', async ({ page }) => {
  const consoleLogs: string[] = [];
  const errors: string[] = [];
  
  page.on('console', msg => {
    const text = `[${msg.type()}] ${msg.text()}`;
    consoleLogs.push(text);
    console.log(text);
  });
  
  page.on('pageerror', err => {
    const text = `[PAGE ERROR] ${err.message}`;
    errors.push(text);
    console.log(text);
  });
  
  await page.goto('http://localhost:5173');
  await page.waitForTimeout(3000);
  
  console.log('=== Page loaded, clicking button ===');
  
  // Find and click the New Thread button
  const btn = page.locator('.new-chat-btn').first();
  await btn.click();
  
  await page.waitForTimeout(2000);
  
  console.log('=== Console logs ===');
  consoleLogs.forEach(log => console.log(log));
  
  console.log('=== Errors ===');
  errors.forEach(err => console.log(err));
  
  // Take screenshot
  await page.screenshot({ path: 'test-results/debug-thread.png' });
  
  expect(errors.length).toBe(0);
});
