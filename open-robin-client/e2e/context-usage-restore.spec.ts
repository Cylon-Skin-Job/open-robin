import { test, expect } from '@playwright/test';

test.use({
  permissions: ['clipboard-read', 'clipboard-write', 'notifications', 'microphone'],
});

test('context usage is restored when opening Test Conversation', async ({ page }) => {
  page.on('dialog', async dialog => await dialog.accept());
  
  const logs: string[] = [];
  page.on('console', msg => logs.push(msg.text()));
  
  await page.goto('/?panel=code-viewer');
  await page.waitForTimeout(4000);
  
  // Click Test Conversation
  await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('*'))
      .find(e => e.textContent?.includes('Test Conversation') && e.children.length === 0);
    el?.closest('div')?.click();
  });
  
  await page.waitForTimeout(3000);
  
  // Check if context-usage elements exist
  const elementInfo = await page.evaluate(() => {
    const fill = document.querySelector('.context-usage-fill');
    const text = document.querySelector('.context-usage span');
    const container = document.querySelector('.context-usage');
    
    return {
      containerExists: !!container,
      fillExists: !!fill,
      textExists: !!text,
      containerHTML: container?.outerHTML?.substring(0, 200),
      fillWidth: (fill as HTMLElement)?.style?.width,
      textContent: text?.textContent,
    };
  });
  
  console.log('Element info:', elementInfo);
  
  // Check logs
  const hasContextUsage = logs.some(l => 
    l.includes('thread:opened: d66fadd7') && l.includes('contextUsage: 0.21')
  );
  
  expect(hasContextUsage).toBe(true);
  expect(elementInfo.containerExists).toBe(true);
  expect(elementInfo.fillWidth).not.toBe('0%');
});
