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
