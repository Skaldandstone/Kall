import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const primaryRoutes = [
  '/dashboard',
  '/morning-brief',
  '/search',
  '/applications/new?job=17&profile=1',
  '/applications/41',
  '/profiles',
  '/settings/notifications',
  '/billing',
  '/onboarding',
];

const tabRoutes = [
  '/search?tab=discovery',
  '/search?tab=sources',
  '/profiles?tab=employment',
  '/profiles?tab=record',
  '/profiles?tab=growth',
  '/profiles?tab=achievements',
  '/profiles?tab=references',
];

test.beforeEach(async ({ page }) => {
  // Keep the audit deterministic and prevent Clerk, Google, or font providers
  // from receiving requests during fixture tests.
  await page.route('**/*', (route) =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
  );
});

test('primary workflows have no serious automated WCAG violations', async ({ page }) => {
  for (const path of primaryRoutes) {
    await page.goto(path, { waitUntil: 'networkidle' });
    await expect(page.locator('main h1')).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const serious = results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical');
    expect(serious, `${path}: ${serious.map(({ id, help }) => `${id}: ${help}`).join('; ')}`).toEqual([]);
  }
});

test('error notifications remain readable while entering', async ({ page }) => {
  await page.goto('/dashboard', { waitUntil: 'networkidle' });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('kall:toast', {
    detail: { message: 'Unable to complete that request.', kind: 'error', duration: 10_000 },
  })));
  await expect(page.locator('.kall-toast-error')).toContainText('Unable to complete that request.');
  const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(results.violations).toEqual([]);
});

test('every application section keeps one page heading and named form controls', async ({ page }) => {
  for (const path of [...primaryRoutes, ...tabRoutes]) {
    await page.goto(path, { waitUntil: 'networkidle' });
    await expect(page.locator('main h1')).toHaveCount(1);
    const unnamedControls = await page.locator('input, select, textarea').evaluateAll((controls) =>
      controls
        .filter((control) => {
          const element = control as HTMLInputElement;
          if (element.type === 'hidden') return false;
          const labelledBy = element.getAttribute('aria-labelledby');
          const ariaLabel = element.getAttribute('aria-label');
          const labels = 'labels' in element ? element.labels : null;
          return !ariaLabel && !labelledBy && (!labels || labels.length === 0);
        })
        .map((control) => control.outerHTML),
    );
    expect(unnamedControls, `${path}: unnamed controls`).toEqual([]);
  }
});

test('primary workflows reflow at 320 CSS pixels', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  for (const path of primaryRoutes) {
    await page.goto(path, { waitUntil: 'networkidle' });
    await expect(page.locator('main h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
  }
});
