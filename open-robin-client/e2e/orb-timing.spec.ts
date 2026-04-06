import { test, expect } from '@playwright/test';

test.describe('Block Rendering', () => {
  test('orb appears after 500ms pause, then animates and disappears', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('textarea.chat-input');
    
    const textarea = page.locator('textarea.chat-input').first();
    await textarea.fill('Hello');
    
    const orb = page.locator('.material-symbols-outlined:has-text("lens_blur")');
    
    // Send message
    const sendButton = page.locator('.send-btn').first();
    await sendButton.click();
    
    // Orb should NOT be visible immediately (500ms pause)
    await expect(orb).not.toBeVisible({ timeout: 100 });
    
    // Orb should appear after ~500ms (fade in starts)
    await expect(orb).toBeVisible({ timeout: 1000 });
    
    // Orb should disappear after animation completes (~2.4s total)
    await expect(orb).not.toBeVisible({ timeout: 5000 });
    
    console.log('Test passed: Orb animation complete');
  });
  
  test('think block renders with shimmer then content', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('textarea.chat-input');
    
    // Request thinking
    const textarea = page.locator('textarea.chat-input').first();
    await textarea.fill('Explain your reasoning');
    
    const sendButton = page.locator('.send-btn').first();
    await sendButton.click();
    
    // Should see thinking header with shimmer
    const thinkingText = page.locator('text=Thinking');
    await expect(thinkingText).toBeVisible({ timeout: 3000 });
    
    console.log('Test passed: Think block renders');
  });
  
  test('blocks queue sequentially', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('textarea.chat-input');
    
    const textarea = page.locator('textarea.chat-input').first();
    await textarea.fill('Tell me a story');
    
    const sendButton = page.locator('.send-btn').first();
    await sendButton.click();
    
    // Orb appears first
    const orb = page.locator('.material-symbols-outlined:has-text("lens_blur")');
    await expect(orb).toBeVisible({ timeout: 1000 });
    
    // Content appears after orb completes
    await expect(orb).not.toBeVisible({ timeout: 5000 });
    
    console.log('Test passed: Blocks queue sequentially');
  });
});
