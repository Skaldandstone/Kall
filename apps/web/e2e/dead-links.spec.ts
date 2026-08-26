import { test, expect, signInAsNewUser } from './helpers';

/**
 * Flagging a dead job posting has to survive more than the current tab -- that
 * is the whole reason the list moved off localStorage and onto the server.
 *
 * This deliberately does not drive the Google Programmable Search widget: it
 * renders live results from Google, so the specific postings it returns are
 * outside this suite's control and asserting on them would be flaky. The
 * suppression list itself is what this covers; that a flagged posting is kept
 * out of the daily brief is covered by tests/test_suppressed_results.py
 * against a fake provider.
 */
const DEAD_URL = 'https://boards.example.com/acme/jobs/1?gh_jid=1';

test('a flagged dead link survives a reload and can be restored', async ({ page }) => {
  await signInAsNewUser(page, 'Dead Link Test');

  await test.step('flagging a posting records it against the account', async () => {
    const flagged = await page.request.post('/api/kall/search/suppressed', {
      data: { url: DEAD_URL, title: 'Filled role', reason: 'dead_link' },
    });
    expect(flagged.ok()).toBeTruthy();
  });

  await test.step('the search workspace hydrates the list from the server', async () => {
    // A fresh page load holds no client-side record of the flag, so the count
    // appearing here is proof it came back from the API.
    await page.goto('/search');
    await expect(page.getByRole('button', { name: /Restore hidden results \(1\)/ })).toBeVisible();
  });

  await test.step('the same posting written differently is still one flag', async () => {
    // Matches match_keys() in backend/kall/services/suppression.py: the query
    // string an ATS uses to identify a posting is stripped when discovery
    // stores it, so both spellings have to resolve to the same suppression.
    const again = await page.request.post('/api/kall/search/suppressed', {
      data: { url: 'https://Boards.Example.com/acme/jobs/1?gh_jid=1#apply', reason: 'dead_link' },
    });
    expect(again.ok()).toBeTruthy();

    const listed = await page.request.get('/api/kall/search/suppressed');
    expect((await listed.json()).length).toBe(1);
  });

  await test.step('restoring clears it for good', async () => {
    await page.goto('/search');
    await page.getByRole('button', { name: /Restore hidden results/ }).click();
    await expect(page.getByRole('button', { name: /Restore hidden results/ })).toBeHidden();

    const listed = await page.request.get('/api/kall/search/suppressed');
    expect(await listed.json()).toEqual([]);
  });
});
