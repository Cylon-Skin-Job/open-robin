import { test, expect } from '@playwright/test';

test('debug thread UI', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await page.waitForTimeout(3000);
  
  // Check console logs
  const logs: string[] = [];
  page.on('console', msg => {
    const text = `[${msg.type()}] ${msg.text()}`;
    logs.push(text);
    console.log(text);
  });
  
  // Wait a bit more for thread:list
  await page.waitForTimeout(2000);
  
  // Take screenshot
  await page.screenshot({ path: 'test-results/thread-ui-debug.png' });
  
  // Check if thread-list exists
  const threadList = page.locator('.thread-list');
  const count = await threadList.count();
  console.log('thread-list count:', count);
  
  if (count > 0) {
    const html = await threadList.first().innerHTML();
    console.log('thread-list HTML (first 500 chars):', html.substring(0, 500));
    
    const chatItems = await threadList.locator('.chat-item').count();
    console.log('chat-item count:', chatItems);
  }
  
  console.log('\n=== Console logs ===');
  logs.forEach(l => console.log(l));
});
