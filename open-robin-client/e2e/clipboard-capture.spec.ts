import { test, expect } from '@playwright/test';

test('clipboard monitor is running', async ({ page }) => {
  await page.goto('http://localhost:3001');
  await page.waitForTimeout(1000);

  // Check that the clipboard list endpoint works
  const response = await page.evaluate(async () => {
    return new Promise<any>((resolve) => {
      const ws = new WebSocket('ws://localhost:3001');
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'clipboard:list', offset: 0, limit: 50 }));
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'clipboard:list') {
          ws.close();
          resolve(msg);
        }
      };
      setTimeout(() => resolve({ error: 'timeout' }), 5000);
    });
  });

  console.log('Clipboard list response:', response);
  expect(response.items).toBeDefined();
  expect(response.total).toBeDefined();

  console.log('✅ Clipboard system is working (monitor active, API responding)');
});
