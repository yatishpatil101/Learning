import { test, expect } from '../../../fixtures/live.js';

/* `dz_help_feedback_v1` is only the widget's memory, keyed by slug; the verdict itself goes to
 * `POST /help/feedback`. The two must not be confused for each other. */

const ARTICLE = '/help/a/what-is-draazy';
const feedback = (page) => page.locator('section[aria-labelledby="article-feedback"]');

async function openArticle(page, path = ARTICLE) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });
}

test.describe('Help article feedback', () => {
  test('the widget asks about the article by name', async ({ page, consoleErrors }) => {
    await openArticle(page);
    await expect(feedback(page).getByText(/Was “.+” helpful\?/)).toBeVisible();
    await expect(feedback(page).getByRole('button', { name: /Yes/i })).toBeVisible();
    await expect(feedback(page).getByRole('button', { name: /No/i })).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test('a positive answer is recorded immediately and thanks the reader', async ({ page }) => {
    await openArticle(page);
    await feedback(page).getByRole('button', { name: /Yes/i }).click();

    await expect(feedback(page).getByText(/Thanks/i)).toBeVisible();
    // Still offers the ticket route — "helpful" is not the same as "solved".
    await expect(feedback(page).getByRole('link', { name: /ticket/i })).toBeVisible();

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('dz_help_feedback_v1') || '{}'));
    expect(stored['what-is-draazy']).toMatchObject({ helpful: true });
  });

  test('a negative answer asks what was missing before remembering it locally', async ({ page }) => {
    await openArticle(page);
    await feedback(page).getByRole('button', { name: /No/i }).click();

    // The comment form opens; the local record is not written yet, so a reader who
    // abandons here is asked again next time rather than being stuck on "thanks".
    await expect(feedback(page).getByText('What was missing?')).toBeVisible();
    const beforeSubmit = await page.evaluate(() => localStorage.getItem('dz_help_feedback_v1'));
    expect(beforeSubmit == null || !JSON.parse(beforeSubmit)['what-is-draazy']).toBeTruthy();

    // The reader can bail out to support instead of writing prose.
    await expect(feedback(page).getByRole('link', { name: /Contact support/i })).toBeVisible();

    await feedback(page).locator('#feedback-comment').fill('It never explains the contact gate.');
    await feedback(page).getByRole('button', { name: /Send feedback/i }).click();

    await expect(feedback(page).getByText(/Thanks/i)).toBeVisible();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('dz_help_feedback_v1') || '{}'));
    expect(stored['what-is-draazy']).toMatchObject({ helpful: false, comment: 'It never explains the contact gate.' });
  });

  test('cancelling the comment form returns to the question without remembering it', async ({ page }) => {
    await openArticle(page);
    await feedback(page).getByRole('button', { name: /No/i }).click();
    await feedback(page).getByRole('button', { name: /Cancel/i }).click();

    await expect(feedback(page).getByText(/Was “.+” helpful\?/)).toBeVisible();
    const stored = await page.evaluate(() => localStorage.getItem('dz_help_feedback_v1'));
    expect(stored == null || !JSON.parse(stored)['what-is-draazy']).toBeTruthy();
  });

  test('an answer persists for that article and does not leak to the next one', async ({ page }) => {
    await openArticle(page);
    await feedback(page).getByRole('button', { name: /Yes/i }).click();
    await expect(feedback(page).getByText(/Thanks/i)).toBeVisible();

    // Same article, fresh load — the answer is remembered, not re-asked.
    await openArticle(page);
    await expect(feedback(page).getByText(/Thanks/i)).toBeVisible();

    // A different article starts unanswered. Reached by CLICKING, not `goto`: a full reload
    // remounts the widget whatever its state handling, so it would pass with the reset broken.
    const links = page.locator('a[href*="/help/a/"]:not([href*="what-is-draazy"])');
    await expect(links.first()).toBeVisible({ timeout: 15_000 });
    await links.first().click();

    await expect(page).not.toHaveURL(/what-is-draazy/);
    await expect(feedback(page).getByText(/Was “.+” helpful\?/)).toBeVisible();
  });

  /* The verdict also leaves the browser. localStorage alone made the widget
   * remember an answer nobody could ever read, which is not a measurement. */

  test('a positive answer reaches the server', async ({ page }) => {
    await openArticle(page);
    const sent = page.waitForRequest((r) => r.url().includes('/help/feedback') && r.method() === 'POST');
    await feedback(page).getByRole('button', { name: /Yes/i }).click();

    const body = (await sent).postDataJSON();
    expect(body).toMatchObject({ slug: 'what-is-draazy', helpful: true, lang: 'en' });
    // No reason was given, so none is claimed.
    expect(body.comment).toBeUndefined();
  });

  test('a negative answer carries the reason the reader typed', async ({ page }) => {
    await openArticle(page);
    await feedback(page).getByRole('button', { name: /No/i }).click();
    await feedback(page).locator('#feedback-comment').fill('It never explains the contact gate.');

    const sent = page.waitForRequest((r) => r.url().includes('/help/feedback')
      && r.method() === 'POST'
      && r.postDataJSON()?.comment != null);
    await feedback(page).getByRole('button', { name: /Send feedback/i }).click();

    const request = await sent;
    expect(request.postDataJSON()).toMatchObject({
      slug: 'what-is-draazy',
      helpful: false,
      comment: 'It never explains the contact gate.',
    });
    // Accepted, not merely dispatched — a 4xx here would mean the wire shape drifted.
    expect((await request.response()).status()).toBe(202);
  });

  test('a negative abandoned before the reason is typed still reaches the server', async ({ page }) => {
    await openArticle(page);
    const sent = page.waitForRequest((r) => r.url().includes('/help/feedback') && r.method() === 'POST');
    await feedback(page).getByRole('button', { name: /No/i }).click();

    // Most readers never type a reason. Counting only the ones who did would hide
    // the articles whose readers gave up on us, which are the ones worth finding.
    const body = (await sent).postDataJSON();
    expect(body).toMatchObject({ slug: 'what-is-draazy', helpful: false, lang: 'en' });
    expect(body.comment).toBeUndefined();
  });

  test('a reader on a dead connection is thanked exactly the same', async ({ page }) => {
    await page.route('**/help/feedback', (route) => route.abort());
    await openArticle(page);
    await feedback(page).getByRole('button', { name: /Yes/i }).click();

    // The thank-you comes from the local record, so the upload failing is ours
    // to notice and not the reader's.
    await expect(feedback(page).getByText(/Thanks/i)).toBeVisible();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('dz_help_feedback_v1') || '{}'));
    expect(stored['what-is-draazy']).toMatchObject({ helpful: true });
  });

  test('the language on screen is the language reported', async ({ page }) => {
    await openArticle(page, '/mr/help/a/what-is-draazy');
    const sent = page.waitForRequest((r) => r.url().includes('/help/feedback') && r.method() === 'POST');
    await feedback(page).getByRole('button', { name: /Yes|होय/i }).click();

    // An article with no Marathi translation renders English and must say so —
    // otherwise a fine English article accrues complaints against `mr`.
    const body = (await sent).postDataJSON();
    expect(['mr', 'en']).toContain(body.lang);
  });
});
