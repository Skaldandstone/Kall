import { test, expect, signInAsNewUser } from './helpers';

/**
 * The public career page is the only thing in Kall a stranger can open, so
 * these check the boundary as much as the rendering: what a signed-out
 * visitor sees, and what they must not.
 */
test('a published page is readable signed out, an unpublished one is not', async ({ page, browser }) => {
  await signInAsNewUser(page, 'James Shattuck');

  await page.request.post('/api/kall/profile/resources/employment', {
    data: { data: { employer: 'Vaettir Systems', job_title: 'Head of Technology', start_date: '2021-03-01', is_current: true } },
  });
  const owned = await (await page.request.get('/api/kall/me/career-page')).json();
  const slug = owned.page.slug;

  // A stranger, with no Kall session at all.
  const visitor = await browser.newContext();
  const visitorPage = await visitor.newPage();

  await test.step('unpublished is not reachable', async () => {
    const response = await visitorPage.goto(`/p/${slug}`);
    expect(response?.status()).toBe(404);
  });

  await page.request.patch('/api/kall/me/career-page', {
    data: { published: true, headline: 'Head of Technology', summary: 'Twenty years of release quality.' },
  });

  await test.step('published reads without a session', async () => {
    await visitorPage.goto(`/p/${slug}`);
    await expect(visitorPage.getByRole('heading', { name: 'James Shattuck', level: 1 })).toBeVisible();
    await expect(visitorPage.getByText('Head of Technology').first()).toBeVisible();
    await expect(visitorPage.getByText('Vaettir Systems')).toBeVisible();
    // Never redirected to sign-in: the middleware must treat /p as public.
    expect(visitorPage.url()).toContain(`/p/${slug}`);
  });

  await test.step('no contact details reach the visitor', async () => {
    const html = await visitorPage.content();
    // The signed-in account's email must not appear on a page anyone can open.
    expect(html).not.toContain('@example.com');
  });

  await test.step('hiding a section removes it for visitors', async () => {
    const thesis = owned.sections.find((s: { kind: string }) => s.kind === 'thesis');
    await page.request.patch(`/api/kall/me/career-page/sections/${thesis.id}`, {
      data: { body: 'Draft nobody should see', visible: false },
    });
    await visitorPage.goto(`/p/${slug}?r=1`);
    expect(await visitorPage.content()).not.toContain('Draft nobody should see');
  });

  await visitor.close();
});

test('the editor composes a page and the order survives a reload', async ({ page }) => {
  await signInAsNewUser(page, 'James Shattuck');
  for (const record of [
    { employer: 'Vaettir Systems', job_title: 'Head of Technology', start_date: '2021-03-01', is_current: true },
    { employer: 'Northwind Systems', job_title: 'Director of Quality Engineering', start_date: '2017-01-01', end_date: '2021-02-01' },
  ]) {
    await page.request.post('/api/kall/profile/resources/employment', { data: { data: record } });
  }

  await page.goto('/settings/career-page');
  const titles = page.locator('input[aria-label$="title"]');
  // The editor loads its sections asynchronously; everything below depends on
  // them being there, so wait rather than racing the fetch.
  await expect(titles.first()).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Not published' })).toBeVisible();

  const read = () => titles.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
  const before = await read();
  await page.getByRole('button', { name: `Move ${before[2]} up` }).click();
  await expect.poll(async () => (await read())[1]).toBe(before[2]);

  await page.reload();
  await expect(titles.first()).toBeVisible();
  expect((await read())[1]).toBe(before[2]);

  await test.step('hiding a section keeps it in the editor', async () => {
    const shows = page.getByRole('checkbox', { name: 'Show' });
    await shows.first().uncheck();
    await page.reload();
    await expect(titles.first()).toBeVisible();
    await expect(titles).toHaveCount(before.length);
  });

  await test.step('publishing exposes the link', async () => {
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Published' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'View' })).toBeVisible();
  });
});
