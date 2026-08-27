import { test, expect, signInAsNewUser } from './helpers';

/**
 * Work samples on a public career page.
 *
 * The security-relevant assertions are the negative ones: an unrecognised
 * link must never become an iframe, and the frame that does appear must point
 * at the provider's embed URL rather than at whatever the user pasted.
 */
test('a work sample embeds on the public page, and an unknown link does not', async ({ page }) => {
  await signInAsNewUser(page, 'Sample Author');

  // Claim a page and add a samples section through the API, then drive the
  // editor for the part a person actually does.
  const wanted = `samples-${Date.now()}`;
  const created = await page.request.patch('/api/kall/me/career-page', {
    data: { slug: wanted, display_name: 'Sample Author', headline: 'Builder' },
  });
  expect(created.ok()).toBeTruthy();
  const { slug } = await created.json();

  const section = await page.request.post('/api/kall/me/career-page/sections', {
    data: { kind: 'samples', title: 'Selected work' },
  });
  expect(section.ok()).toBeTruthy();
  const { id: sectionId } = await section.json();

  await page.request.patch(`/api/kall/me/career-page/sections/${sectionId}`, {
    data: {
      options: {
        samples: [
          { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Launch demo' },
          { url: 'https://example.com/case-study', title: 'Case study' },
        ],
      },
    },
  });
  const published = await page.request.patch('/api/kall/me/career-page', {
    data: { published: true },
  });
  expect(published.ok()).toBeTruthy();

  await page.goto(`/p/${slug}`);

  await test.step('the known provider is framed from its embed URL', async () => {
    const frame = page.locator('iframe[title="Launch demo"]');
    await expect(frame).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    // The pasted watch URL must not be what the browser loads.
    await expect(page.locator('iframe[src*="youtube.com/watch"]')).toHaveCount(0);
  });

  await test.step('the unknown link is a link, not a frame', async () => {
    await expect(page.getByRole('link', { name: 'Case study' })).toBeVisible();
    await expect(page.locator('iframe[src*="example.com"]')).toHaveCount(0);
    // Exactly one frame on the page: the YouTube one.
    await expect(page.locator('iframe')).toHaveCount(1);
  });
});
