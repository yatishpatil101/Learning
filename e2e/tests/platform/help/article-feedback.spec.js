import { test, expect } from '../../../fixtures/base.js';

/* Help article feedback — "Was this helpful?".
 *
 * `help-centre` asserts the prose and the table of contents but never submits
 * feedback, so the only signal telling us which articles fail readers had no
 * coverage at all. The negative branch is the one that matters: a bare
 * thumbs-down is useless, so it must open the free-text field and offer the
 * support escape hatch instead of silently recording a downvote.
 *
 * Answers persist to `pn_help_feedback_v1`, keyed by slug — so the widget must
 * also reset when the reader moves to a different article.
 */

const ARTICLE = '/help/a/what-is-punenest';
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

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pn_help_feedback_v1') || '{}'));
    expect(stored['what-is-punenest']).toMatchObject({ helpful: true });
  });

  test('a negative answer asks what was missing before recording anything', async ({ page }) => {
    await openArticle(page);
    await feedback(page).getByRole('button', { name: /No/i }).click();

    // The comment form opens; nothing is written yet.
    await expect(feedback(page).getByText('What was missing?')).toBeVisible();
    const beforeSubmit = await page.evaluate(() => localStorage.getItem('pn_help_feedback_v1'));
    expect(beforeSubmit == null || !JSON.parse(beforeSubmit)['what-is-punenest']).toBeTruthy();

    // The reader can bail out to support instead of writing prose.
    await expect(feedback(page).getByRole('link', { name: /Contact support/i })).toBeVisible();

    await feedback(page).locator('#feedback-comment').fill('It never explains the contact gate.');
    await feedback(page).getByRole('button', { name: /Send feedback/i }).click();

    await expect(feedback(page).getByText(/Thanks/i)).toBeVisible();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pn_help_feedback_v1') || '{}'));
    expect(stored['what-is-punenest']).toMatchObject({ helpful: false, comment: 'It never explains the contact gate.' });
  });

  test('cancelling the comment form returns to the question without recording', async ({ page }) => {
    await openArticle(page);
    await feedback(page).getByRole('button', { name: /No/i }).click();
    await feedback(page).getByRole('button', { name: /Cancel/i }).click();

    await expect(feedback(page).getByText(/Was “.+” helpful\?/)).toBeVisible();
    const stored = await page.evaluate(() => localStorage.getItem('pn_help_feedback_v1'));
    expect(stored == null || !JSON.parse(stored)['what-is-punenest']).toBeTruthy();
  });

  test('an answer persists for that article and does not leak to the next one', async ({ page }) => {
    await openArticle(page);
    await feedback(page).getByRole('button', { name: /Yes/i }).click();
    await expect(feedback(page).getByText(/Thanks/i)).toBeVisible();

    // Same article, fresh load — the answer is remembered, not re-asked.
    await openArticle(page);
    await expect(feedback(page).getByText(/Thanks/i)).toBeVisible();

    // A different article starts unanswered. The component stays mounted across
    // route changes, so this is exactly where a missing reset would show up.
    const other = await page.locator('a[href*="/help/a/"]').first().getAttribute('href');
    test.skip(!other || other.includes('what-is-punenest'), 'no second article to navigate to');
    await openArticle(page, other);
    await expect(feedback(page).getByText(/Was “.+” helpful\?/)).toBeVisible();
  });
});
