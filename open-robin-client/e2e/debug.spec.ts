import { test, expect } from '@playwright/test';

test('debug what renders', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('textarea.chat-input');
  
  const textarea = page.locator('textarea.chat-input').first();
  await textarea.fill('test');
  
  const sendButton = page.locator('.send-btn').first();
  await sendButton.click();
  
  // Wait a bit
  await page.waitForTimeout(1000);
  
  // Get page content
  const content = await page.content();
  console.log('Page HTML:', content.slice(0, 2000));
  
  // Check for specific elements
  const hasOrb = await page.locator('.material-symbols-outlined:has-text("lens_blur")').count();
  const hasSimpleRenderer = await page.locator('.simple-block-renderer').count();
  const hasBlocks = await page.locator('[class*="block"]').count();
  
  console.log('Orb count:', hasOrb);
  console.log('Simple renderer count:', hasSimpleRenderer);
  console.log('Block count:', hasBlocks);
});
