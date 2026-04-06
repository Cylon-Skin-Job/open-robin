import { test, expect } from '@playwright/test';

test.use({
  permissions: ['clipboard-read', 'clipboard-write', 'notifications', 'microphone'],
  viewport: { width: 1920, height: 1080 }, // Large viewport
});

test('capture full composer layout', async ({ page }) => {
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
  
  // Take screenshot of the entire page
  await page.screenshot({ 
    path: '/Users/rccurtrightjr./projects/kimi-claude/test-results/full-page.png',
    fullPage: false
  });
  
  // Get the composer area and screenshot specifically
  const composerRect = await page.evaluate(() => {
    const composer = document.querySelector('.chat-composer, .chat-input-container');
    const metaRow = document.querySelector('.chat-composer-meta-row');
    return {
      composer: composer?.getBoundingClientRect(),
      metaRow: metaRow?.getBoundingClientRect(),
    };
  });
  
  console.log('Composer rect:', composerRect);
  
  // Screenshot the composer area
  if (composerRect.composer) {
    const rect = composerRect.composer;
    await page.screenshot({ 
      path: '/Users/rccurtrightjr./projects/kimi-claude/test-results/composer-area.png',
      clip: { 
        x: Math.max(0, rect.left - 50), 
        y: Math.max(0, rect.top - 20), 
        width: Math.min(1920, rect.width + 100), 
        height: rect.height + 100 
      }
    });
  }
  
  // Screenshot just the meta row
  if (composerRect.metaRow) {
    const rect = composerRect.metaRow;
    await page.screenshot({ 
      path: '/Users/rccurtrightjr./projects/kimi-claude/test-results/meta-row.png',
      clip: { 
        x: Math.max(0, rect.left - 20), 
        y: Math.max(0, rect.top - 10), 
        width: Math.min(1920, rect.width + 40), 
        height: rect.height + 20 
      }
    });
  }
});

test('analyze layout with large viewport', async ({ page }) => {
  page.on('dialog', async dialog => await dialog.accept());
  
  await page.goto('/?panel=code-viewer');
  await page.waitForTimeout(4000);
  
  await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('*'))
      .find(e => e.textContent?.includes('Test Conversation') && e.children.length === 0);
    el?.closest('div')?.click();
  });
  
  await page.waitForTimeout(3000);
  
  // Get detailed layout info
  const layout = await page.evaluate(() => {
    const metaRow = document.querySelector('.chat-composer-meta-row');
    const children = metaRow ? Array.from(metaRow.children) : [];
    
    return children.map((child, i) => {
      const rect = child.getBoundingClientRect();
      const style = window.getComputedStyle(child);
      return {
        index: i,
        tagName: child.tagName,
        className: child.className?.substring(0, 50),
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          right: Math.round(rect.right),
        },
        computed: {
          flex: style.flex,
          marginLeft: style.marginLeft,
          marginRight: style.marginRight,
          margin: style.margin,
        }
      };
    });
  });
  
  console.log('Meta Row Layout (1920x1080 viewport):');
  console.log(JSON.stringify(layout, null, 2));
  
  // Calculate total width and spacing
  const totalWidth = layout[layout.length - 1]?.rect.right - layout[0]?.rect.x;
  console.log(`Total width of elements: ${Math.round(totalWidth)}px`);
  
  // Check gaps
  for (let i = 1; i < layout.length; i++) {
    const gap = layout[i].rect.x - layout[i-1].rect.right;
    console.log(`Gap ${i-1}→${i}: ${Math.round(gap)}px`);
  }
});
