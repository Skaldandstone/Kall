import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Evidence capture is opt-in. Screenshots still need human visual inspection.
test('capture current-flow visual evidence', async ({ page }, testInfo) => {
  // Six separate pages may compile on first navigation in the local dev app.
  test.setTimeout(90_000);
  test.skip(process.env.KALL_UI_SCREENSHOTS !== '1', 'Opt in to capture screenshots.');
  await page.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  const pages = [
    ['dashboard', '/dashboard'],
    ['brief', '/morning-brief'],
    ['search', '/search'],
    ['preparation', '/applications/new?job=17&profile=1&title=Director%20of%20Quality%20Engineering'],
    ['review', '/applications/41'],
    ['profile-edit', '/profiles'],
  ];
  const measurements = [];
  for (const [name, path] of pages) {
    await page.goto(path);
    await expect(page.getByRole('link', { name: 'Open account settings' })).toHaveText('JA');
    if (name === 'brief') await expect(page.getByRole('heading', { name: 'Good morning, Jordan.' })).toBeVisible();
    if (name === 'search') await expect(page.getByLabel('Professional profile (optional)')).toBeEnabled();
    if (name === 'preparation') await expect(page.getByLabel('Resume', { exact: true })).toBeEnabled();
    if (name === 'review') await expect(page.getByLabel('Describe your quality leadership experience.')).toBeVisible();
    if (name === 'profile-edit') {
      await page.getByRole('button', { name: 'Edit profile', exact: true }).click();
      await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Quality Engineering');
    }
    await page.evaluate(() => document.fonts.ready);
    measurements.push({ page: name, ...await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      headingFont: getComputedStyle(document.querySelector('h1')!).fontFamily,
      fontStatus: document.fonts.status,
      fonts: Array.from(document.fonts).map((font) => ({ family: font.family, status: font.status })),
    })) });
    await page.screenshot({ path: testInfo.outputPath(`${name}-${testInfo.project.name}.png`), fullPage: true });
  }
  await writeFile(testInfo.outputPath(`measurements-${testInfo.project.name}.json`), JSON.stringify(measurements, null, 2));
});
