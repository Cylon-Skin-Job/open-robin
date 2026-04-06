import { test, expect } from '@playwright/test';

test('debug block rendering', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('textarea.chat-input');
  
  // Listen to console logs
  page.on('console', msg => console.log('CONSOLE:', msg.text()));
  
  const textarea = page.locator('textarea.chat-input').first();
  await textarea.fill('test');
  
  const sendButton = page.locator('.send-btn').first();
  await sendButton.click();
  
  // Wait for orb to appear
  await page.waitForTimeout(600);
  
  // Check what's in the simple-block-renderer
  const renderer = page.locator('.simple-block-renderer');
  const html = await renderer.innerHTML().catch(() => 'empty');
  console.log('Renderer HTML:', html);
  
  // Screenshot
  await page.screenshot({ path: 'test-results/debug.png' });
});
