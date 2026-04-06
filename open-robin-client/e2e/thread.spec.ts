import { test, expect } from '@playwright/test';

test.describe('Thread Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173');
    // Wait for WebSocket connection
    await page.waitForTimeout(2000);
  });

  test('create new thread', async ({ page }) => {
    await page.goto('http://localhost:5173');
    await page.waitForTimeout(3000);
    
    // Get sidebar
    const sidebar = page.locator('.workspace.active .sidebar');
    const threadList = sidebar.locator('.thread-list');
    
    // Get initial thread count
    const initialThreads = await threadList.locator('.chat-item').count();
    console.log('Initial threads:', initialThreads);
    
    // Click New Thread button
    const newThreadBtn = sidebar.locator('.new-chat-btn');
    await expect(newThreadBtn).toBeVisible();
    await newThreadBtn.click();
    
    // Wait for server response and UI update
    await page.waitForTimeout(2000);
    
    // Verify new thread appears
    const finalThreads = await threadList.locator('.chat-item').count();
    console.log('Final threads:', finalThreads);
    
    expect(finalThreads).toBe(initialThreads + 1);
    
    // Verify the new thread has the default name
    const firstThread = threadList.locator('.chat-item').first();
    const threadText = await firstThread.locator('.chat-item-text').textContent();
    expect(threadText).toContain('New Chat');
    
    console.log('✅ Thread created:', threadText);
  });

  test('thread list loads from server', async ({ page }) => {
    // Wait for page to load
    await page.waitForLoadState('networkidle');
    
    // Wait for the active workspace to be visible
    const activeWorkspace = page.locator('.workspace.active');
    await expect(activeWorkspace).toBeVisible();
    
    // Find the sidebar in the active workspace
    const sidebar = activeWorkspace.locator('.sidebar');
    await expect(sidebar).toBeVisible();
    
    // Should show thread list (check it's in DOM, visibility handled by CSS)
    const threadList = sidebar.locator('.thread-list');
    await expect(threadList).toHaveCount(1);
    
    // Should have the "New Thread" button
    const newThreadBtn = sidebar.locator('.new-chat-btn');
    await expect(newThreadBtn).toBeVisible();
    
    console.log('✅ Thread list loaded');
  });
});
