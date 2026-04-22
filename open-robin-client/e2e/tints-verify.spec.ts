import { test, expect } from '@playwright/test';

test('verify tints applied to wiki + tickets', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));

  await page.goto('/');
  await page.waitForTimeout(3000);

  // Take a baseline screenshot of whatever loads first
  await page.screenshot({ path: 'e2e/screenshots/tints-00-initial.png', fullPage: true });

  // Find all panels and their data-tint-* attributes
  const panels = await page.$$eval('.rv-panel', (els) =>
    els.map((el) => ({
      panel: el.getAttribute('data-panel'),
      active: el.classList.contains('active'),
      tintLeft: el.getAttribute('data-tint-left'),
      tintRight: el.getAttribute('data-tint-right'),
      tintCards: el.getAttribute('data-tint-cards'),
      tintBorderThreads: el.getAttribute('data-tint-border-threads'),
      tintBorderChat: el.getAttribute('data-tint-border-chat'),
      wsPrimary: (el as HTMLElement).style.getPropertyValue('--ws-primary'),
      wsSidebarBg: (el as HTMLElement).style.getPropertyValue('--ws-sidebar-bg'),
      wsPanelBorder: (el as HTMLElement).style.getPropertyValue('--ws-panel-border'),
    }))
  );
  console.log('PANELS:', JSON.stringify(panels, null, 2));

  // List nav buttons to identify the right title
  const navTitles = await page.$$eval('.rv-tool-btn', (els) =>
    els.map((el) => el.getAttribute('title'))
  );
  console.log('NAV TITLES:', JSON.stringify(navTitles));

  // Try to switch to wiki-viewer via title attribute
  const wikiNav = page.locator('.rv-tool-btn[title*="iki" i]').first();
  if (await wikiNav.count()) {
    await wikiNav.click().catch(() => {});
    await page.waitForTimeout(1500);
  }

  // After potential nav: re-screenshot, re-read attrs
  await page.screenshot({ path: 'e2e/screenshots/tints-01-wiki.png', fullPage: true });
  const wikiPanel = page.locator('.rv-panel[data-panel="wiki-viewer"]');
  const wikiAttrs = await wikiPanel.evaluate((el) => ({
    tintCards: el.getAttribute('data-tint-cards'),
    wsPrimary: (el as HTMLElement).style.getPropertyValue('--ws-primary'),
  })).catch((e) => ({ error: String(e) }));
  console.log('WIKI PANEL ATTRS:', JSON.stringify(wikiAttrs));

  // Inspect the wiki topic-list-header computed color
  const header = page.locator('.rv-wiki-topic-list-header').first();
  if (await header.count()) {
    const headerStyles = await header.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        color: cs.color,
        text: el.textContent?.trim(),
      };
    });
    console.log('WIKI TOPIC-LIST-HEADER:', JSON.stringify(headerStyles));
  } else {
    console.log('No .rv-wiki-topic-list-header found on page');
  }

  // Inspect wiki active topic (if any)
  const activeTopic = page.locator('.rv-wiki-topic-item.active').first();
  if (await activeTopic.count()) {
    const styles = await activeTopic.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { color: cs.color, background: cs.backgroundColor };
    });
    console.log('WIKI ACTIVE TOPIC:', JSON.stringify(styles));
  }

  // Inspect wiki breadcrumb
  const breadcrumb = page.locator('.rv-wiki-breadcrumb').first();
  if (await breadcrumb.count()) {
    const styles = await breadcrumb.evaluate((el) => getComputedStyle(el).color);
    console.log('WIKI BREADCRUMB color:', styles);
  }

  // Try issues
  const issuesNav = page.locator('.rv-tool-btn[title*="issue" i], .rv-tool-btn[title*="ticket" i]').first();
  if (await issuesNav.count()) {
    await issuesNav.click().catch(() => {});
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'e2e/screenshots/tints-02-issues.png', fullPage: true });

    const issuesPanel = page.locator('.rv-panel[data-panel="issues-viewer"]');
    const issuesAttrs = await issuesPanel.evaluate((el) => ({
      tintCards: el.getAttribute('data-tint-cards'),
      wsPrimary: (el as HTMLElement).style.getPropertyValue('--ws-primary'),
    })).catch((e) => ({ error: String(e) }));
    console.log('ISSUES PANEL ATTRS:', JSON.stringify(issuesAttrs));

    const card = page.locator('.rv-ticket-card').first();
    if (await card.count()) {
      const styles = await card.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { borderColor: cs.borderColor, background: cs.backgroundColor };
      });
      console.log('TICKET CARD:', JSON.stringify(styles));
    }

    const cardId = page.locator('.rv-ticket-card-id').first();
    if (await cardId.count()) {
      const color = await cardId.evaluate((el) => getComputedStyle(el).color);
      console.log('TICKET CARD ID color:', color);
    }
  }

  // Dump the bundle URL we actually loaded
  const stylesheets = await page.$$eval('link[rel=stylesheet]', (links) =>
    links.map((l) => (l as HTMLLinkElement).href)
  );
  console.log('STYLESHEETS:', JSON.stringify(stylesheets));

  // Tail console logs
  console.log('--- BROWSER CONSOLE TAIL ---');
  for (const line of logs.slice(-20)) console.log(line);
});
