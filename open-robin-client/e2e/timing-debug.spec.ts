import { test, expect } from '@playwright/test';

/**
 * Timing debug — captures [TIMING] console logs and does the math.
 *
 * Measures: SEND → FIRST TOKEN → ORB START → ORB END → RENDER SIGNAL → REVEAL START
 * Reports all gaps so we can see where time is being lost.
 */

test('timing debug — measure render gap', async ({ page }) => {
  test.setTimeout(60000);

  // Collect all console logs
  const logs: { time: number; text: string }[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    logs.push({ time: Date.now(), text });
    if (text.includes('[TIMING]') || text.includes('[WS]')) {
      console.log(text);
    }
  });

  await page.goto('/');
  await page.waitForTimeout(2000);

  // Find visible chat input
  const inputs = page.locator('textarea.chat-input');
  let visibleInput = null;
  for (let i = 0; i < await inputs.count(); i++) {
    const inp = inputs.nth(i);
    if (await inp.isVisible()) {
      visibleInput = inp;
      break;
    }
  }

  if (!visibleInput) {
    console.log('[TEST] No visible chat input — aborting');
    return;
  }

  // Send message
  await visibleInput.fill('Hello');
  await visibleInput.press('Enter');
  console.log('[TEST] Message sent — waiting for response...');

  // Wait for response to complete (up to 30s)
  // Check every 200ms for timing logs
  let gotRenderSignal = false;
  for (let i = 0; i < 150; i++) {
    await page.waitForTimeout(200);

    const hasRender = logs.some(l => l.text.includes('RENDER SIGNAL'));
    if (hasRender && !gotRenderSignal) {
      gotRenderSignal = true;
      // Wait a bit more for REVEAL START
      await page.waitForTimeout(1000);
      break;
    }
  }

  // Extract timing data from the page
  const timing = await page.evaluate(() => {
    return (window as any).__TIMING || null;
  });

  console.log('\n========================================');
  console.log('  TIMING REPORT');
  console.log('========================================\n');

  if (!timing) {
    console.log('[TEST] ERROR: No __TIMING data found on window!');
    console.log('[TEST] All captured logs:');
    logs.forEach(l => console.log(`  ${l.text}`));
    return;
  }

  // Print raw values
  console.log(`SEND:          ${timing.sendAt?.toFixed(1) || 'MISSING'}ms`);
  console.log(`FIRST TOKEN:   ${timing.firstTokenAt?.toFixed(1) || 'MISSING'}ms (${timing.firstTokenType || '?'})`);
  console.log(`ORB START:     ${timing.orbStartAt?.toFixed(1) || 'MISSING'}ms`);
  console.log(`ORB END:       ${timing.orbEndAt?.toFixed(1) || 'MISSING'}ms`);

  // Calculate gaps
  if (timing.sendAt && timing.firstTokenAt) {
    const ttft = timing.firstTokenAt - timing.sendAt;
    console.log(`\n--- TIME TO FIRST TOKEN: ${ttft.toFixed(1)}ms ---`);
  }

  if (timing.sendAt && timing.orbStartAt) {
    const orbLag = timing.orbStartAt - timing.sendAt;
    console.log(`SEND → ORB START: ${orbLag.toFixed(1)}ms`);
  }

  if (timing.sendAt && timing.orbEndAt) {
    const orbTotal = timing.orbEndAt - timing.sendAt;
    console.log(`SEND → ORB END: ${orbTotal.toFixed(1)}ms`);
  }

  if (timing.firstTokenAt && timing.orbEndAt) {
    const buffer = timing.orbEndAt - timing.firstTokenAt;
    console.log(`FIRST TOKEN → ORB END: ${buffer.toFixed(1)}ms (buffer time — token sitting idle)`);
  }

  // Now get render signal timing from console logs
  const renderLog = logs.find(l => l.text.includes('RENDER SIGNAL'));
  const revealLog = logs.find(l => l.text.includes('REVEAL START'));

  if (renderLog) {
    console.log(`\nRENDER SIGNAL log: ${renderLog.text}`);
  }
  if (revealLog) {
    console.log(`REVEAL START log: ${revealLog.text}`);
  }

  // Print all TIMING logs in order
  console.log('\n--- ALL TIMING LOGS (in order) ---');
  const timingLogs = logs.filter(l => l.text.includes('[TIMING]'));
  timingLogs.forEach(l => console.log(`  ${l.text}`));

  console.log('\n========================================');
  console.log('  END TIMING REPORT');
  console.log('========================================');
});
