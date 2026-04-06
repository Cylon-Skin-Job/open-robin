import { test, expect } from '@playwright/test';

test.describe('Typing Effect', () => {

  test('text block types characters progressively (not all at once)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('textarea.chat-input');

    // Install MutationObserver BEFORE sending demo — catches every DOM change
    await page.evaluate(() => {
      (window as any).__textLengths = [];
      const observer = new MutationObserver(() => {
        const el = document.querySelector('.text-block-content');
        if (el) {
          (window as any).__textLengths.push(el.textContent?.length ?? 0);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      (window as any).__textObserver = observer;
    });

    // Send /demo
    const textarea = page.locator('textarea.chat-input').first();
    await textarea.fill('/demo');
    await page.locator('.send-btn').first().click();

    // Wait for typing to finish (cursor disappears from text block)
    await page.waitForFunction(() => {
      const el = document.querySelector('.text-block-content');
      return el && el.textContent && el.textContent.length > 10 && !el.querySelector('.typing-cursor');
    }, { timeout: 20000 });

    // Get mutation-recorded lengths
    const lengths: number[] = await page.evaluate(() => {
      (window as any).__textObserver?.disconnect();
      return (window as any).__textLengths;
    });

    const nonZero = lengths.filter(l => l > 0);
    const uniqueLengths = [...new Set(nonZero)];

    console.log('Mutation observed:', lengths.length, 'events, unique:', uniqueLengths.length);
    console.log('Sample:', uniqueLengths.slice(0, 30));

    // Must have many distinct lengths from progressive typing
    expect(uniqueLengths.length).toBeGreaterThan(5);
  });

  test('text block markdown renders without flicker (bold tags stable)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('textarea.chat-input');

    const textarea = page.locator('textarea.chat-input').first();
    await textarea.fill('/demo');
    await page.locator('.send-btn').first().click();

    const textBlock = page.locator('.text-block-content').first();
    await expect(textBlock).toBeVisible({ timeout: 15000 });

    // Watch for the <strong> tag — once it appears, it must stay
    let strongAppeared = false;
    let strongDisappeared = false;

    for (let i = 0; i < 100; i++) {
      const html = await textBlock.innerHTML();
      const hasStrong = html.includes('<strong>');

      if (hasStrong && !strongAppeared) {
        strongAppeared = true;
      }
      if (strongAppeared && !hasStrong) {
        strongDisappeared = true;
        break;
      }

      await page.waitForTimeout(30);
    }

    console.log('Strong tag appeared:', strongAppeared);
    console.log('Strong tag disappeared after appearing:', strongDisappeared);

    // The strong tag should appear and never disappear (no flicker)
    expect(strongAppeared).toBe(true);
    expect(strongDisappeared).toBe(false);
  });

  test('code block types characters progressively', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('textarea.chat-input');

    const textarea = page.locator('textarea.chat-input').first();
    await textarea.fill('/demo');
    await page.locator('.send-btn').first().click();

    // Code block appears after text block
    const codeBlock = page.locator('pre code').first();
    await expect(codeBlock).toBeVisible({ timeout: 20000 });

    // Sample code content length over time
    const lengths: number[] = [];
    for (let i = 0; i < 50; i++) {
      const text = await codeBlock.textContent();
      lengths.push(text?.length ?? 0);
      await page.waitForTimeout(30);
    }

    const nonZero = lengths.filter(l => l > 0);
    const uniqueLengths = [...new Set(nonZero)];

    console.log('Code sampled lengths:', lengths.slice(0, 20));
    console.log('Code unique non-zero lengths:', uniqueLengths.length);

    expect(uniqueLengths.length).toBeGreaterThan(3);
  });

  test('collapsible block types characters progressively', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('textarea.chat-input');

    const textarea = page.locator('textarea.chat-input').first();
    await textarea.fill('/demo');
    await page.locator('.send-btn').first().click();

    // Wait for think block content (after shimmer settles)
    // The think block content area is inside the collapsible
    const thinkContent = page.locator('text=Analyzing').first();
    await expect(thinkContent).toBeVisible({ timeout: 10000 });

    // Sample the visible text length
    const lengths: number[] = [];
    const container = page.locator('div').filter({ hasText: 'Analyzing' }).first();
    for (let i = 0; i < 50; i++) {
      const text = await container.textContent();
      lengths.push(text?.length ?? 0);
      await page.waitForTimeout(30);
    }

    const nonZero = lengths.filter(l => l > 0);
    const uniqueLengths = [...new Set(nonZero)];

    console.log('Think sampled lengths:', lengths.slice(0, 20));
    console.log('Think unique lengths:', uniqueLengths.length);

    // Should have progressive typing
    expect(uniqueLengths.length).toBeGreaterThan(2);
  });
});
