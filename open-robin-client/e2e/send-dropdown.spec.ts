import { test, expect } from '@playwright/test';

test.use({
  permissions: ['clipboard-read', 'clipboard-write', 'notifications', 'microphone'],
  viewport: { width: 1920, height: 1080 },
});

test('send dropdown opens on click', async ({ page }) => {
  page.on('dialog', async dialog => await dialog.accept());
  
  await page.goto('/?panel=code-viewer');
  await page.waitForTimeout(4000);
  
  // Click Test Conversation
  await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('*'))
      .find(e => e.textContent?.includes('Test Conversation') && e.children.length === 0);
    el?.closest('div')?.click();
  });
  
  await page.waitForTimeout(3000);
  
  // Click the dropdown arrow button
  const dropdownClicked = await page.evaluate(() => {
    const btn = document.querySelector('.send-btn-secondary');
    if (btn) {
      (btn as HTMLElement).click();
      return true;
    }
    return false;
  });
  
  console.log('Dropdown button clicked:', dropdownClicked);
  
  await page.waitForTimeout(500);
  
  // Check if modal opened
  const modalInfo = await page.evaluate(() => {
    const modal = document.querySelector('.hover-icon-modal-container');
    const items = document.querySelectorAll('.send-dropdown-item');
    return {
      modalExists: !!modal,
      itemCount: items.length,
      itemTexts: Array.from(items).map(i => i.textContent),
    };
  });
  
  console.log('Modal info:', modalInfo);
  
  await page.screenshot({ path: '/Users/rccurtrightjr./projects/kimi-claude/test-results/dropdown-open.png' });
  
  expect(modalInfo.modalExists).toBe(true);
  expect(modalInfo.itemCount).toBe(3);
});

test('send button works independently', async ({ page }) => {
  page.on('dialog', async dialog => await dialog.accept());
  
  await page.goto('/?panel=code-viewer');
  await page.waitForTimeout(4000);
  
  await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('*'))
      .find(e => e.textContent?.includes('Test Conversation') && e.children.length === 0);
    el?.closest('div')?.click();
  });
  
  await page.waitForTimeout(3000);
  
  // Click main send button
  const sendClicked = await page.evaluate(() => {
    const btn = document.querySelector('.send-btn-main');
    if (btn) {
      (btn as HTMLElement).click();
      return true;
    }
    return false;
  });
  
  console.log('Send button clicked:', sendClicked);
  
  // Verify modal did NOT open
  const modalInfo = await page.evaluate(() => {
    const modal = document.querySelector('.hover-icon-modal-container');
    const isVisible = modal?.getAttribute('data-state') !== 'closed';
    return { modalExists: !!modal, isVisible };
  });
  
  console.log('Modal state after send click:', modalInfo);
  
  // Send button should not open the modal
  expect(modalInfo.isVisible).toBe(false);
});
