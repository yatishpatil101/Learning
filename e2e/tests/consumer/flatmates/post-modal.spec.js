import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAsNew } from '../../../helpers/liveAuth.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';
import { trackErrors } from '../../../helpers/console.js';

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

const track = flatmateCleanup(test);

async function pickFrom(page, trigger, options, { closes = false } = {}) {
  const picker = page.getByRole('button', { name: trigger });
  const list = page.locator('.dz-dropdown__option');
  for (const [i, option] of options.entries()) {
    if (i === 0 || closes) await picker.click();
    await list.filter({ hasText: option }).first().click();
    if (closes) await expect(list.first()).toBeHidden();
  }
  if (!closes) await picker.click();
}

test.describe('LIVE: post-request form', () => {
  test('every field the redesigned form collects reaches the server intact', async ({ page }) => {
    const errors = trackErrors(page);
    const mobile = await signedInAsNew(page);

    await page.goto('/flatmates?post=1');
    await expect(page.getByRole('heading', { name: /Post your flatmate request/i })).toBeVisible({ timeout: 20_000 });
    /* By accessible name, not visible text: `NativeSelect` renders a button the `<label>` above it
       does not label, so both P0 selects once reached assistive tech unnamed. */

    await expect(page.getByRole('button', { name: 'Preferred localities' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lifestyle preferences' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Looking to share with' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Room preference' })).toBeVisible();

    await page.getByPlaceholder('e.g. Riya').fill('Redesign Seeker');
    const budget = page.getByLabel('Lowest monthly budget');
    await budget.fill('17500');
    await expect(budget).toHaveValue('17,500');
    await expect(page.getByText('≈ ₹ 17.50 Thousand')).toBeVisible();
    await page.getByLabel('Highest monthly budget').fill('15000');
    await page.getByRole('button', { name: /Post request/i }).click();
    await expect(page.locator('.dz-field-error', { hasText: 'Max budget can’t be below min.' })).toBeVisible();
    await page.getByLabel('Highest monthly budget').fill('22000');

    await pickFrom(page, 'Preferred localities', ['Baner', 'Wakad'], { closes: true });
    await pickFrom(page, 'Lifestyle preferences', ['Vegetarian', 'Non-smoker']);

    await page.getByRole('button', { name: 'Looking to share with' }).click();
    await page.getByRole('option', { name: 'Women only', exact: true }).click();
    await page.getByRole('button', { name: 'Room preference' }).click();
    await page.getByRole('option', { name: 'Private room', exact: true }).click();

    const moveIn = page.getByTestId('move-in-field');
    await expect(moveIn.getByRole('button', { name: 'Immediate', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await moveIn.getByRole('button', { name: 'Flexible', exact: true }).click();
    await expect(moveIn.getByRole('button', { name: 'Flexible', exact: true })).toHaveAttribute('aria-pressed', 'true');

    const headline = page.getByLabel('Headline');
    await expect(headline).toHaveAttribute('placeholder', 'Flatmate looking for a room in Baner, Wakad');
    await page.getByRole('button', { name: 'Use suggestion' }).click();
    await expect(headline).toHaveValue('Flatmate looking for a room in Baner, Wakad');
    await headline.fill('Call me on 9876543210');
    await page.getByRole('button', { name: /Post request/i }).click();
    await expect(page.locator('.dz-field-error', { hasText: 'Remove phone numbers, emails or links from the headline.' })).toBeVisible();
    await headline.fill('Quiet designer wants a sunny room near Baner');

    const posted = page.waitForResponse(
      (r) => r.url().includes('/flatmates/posts') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /Post request/i }).click();
    const created = await posted;
    expect(created.status(), 'the server should accept everything the form collected').toBe(201);

    const { accessToken } = await apiLogin(mobile);
    const body = await created.json();
    track('posts', body.id, accessToken);
    /* Read back rather than trusting the create response, so a field echoed out of the request body
       without ever being persisted cannot pass. */

    const mine = await (await fetch(`${API}/me/flatmate-posts?size=100`, { headers: auth(accessToken) })).json();
    const rows = mine.content ?? mine.items ?? mine;
    const saved = rows.find((r) => r.id === body.id);
    expect(saved, 'the post should be on the caller own board').toBeTruthy();

    expect(saved.localities?.slice().sort(), 'both localities should have been stored')
      .toEqual(['Baner', 'Wakad']);
    expect(saved.tags?.slice().sort(), 'both lifestyle tags should have been stored')
      .toEqual(['Non-smoker', 'Vegetarian']);
    /* The selects carry option *labels* on screen and enum values on the wire, so asserting the
       stored value is what proves the translation happened. */
    expect(saved.flatPref, '"Women only" should be stored as the enum').toBe('women');
    expect(saved.roomPref, '"Private room" should be stored as the enum').toBe('private');
    expect(saved.budget, 'the grouped display must not leak commas onto the wire').toBe(17500);
    expect(saved.budgetMax, 'the budget ceiling should be stored as the top of the range').toBe(22000);
    expect(saved.title, 'the headline the poster wrote should be stored as written').toBe('Quiet designer wants a sunny room near Baner');
    expect(saved.moveIn ?? null, '"Flexible" states no move-in date, so every move-in filter passes it').toBeNull();

    await page.goto(`/flatmates/post/${body.id}`);
    await expect(page.getByText('₹17,500 – ₹22,000').first()).toBeVisible({ timeout: 15_000 });

    expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
  });
});

test.describe('post-request form on a phone', () => {
  test.use({ viewport: { width: 440, height: 956 }, hasTouch: true, isMobile: true });

  test('a tapped locality is chosen and the sheet closes; the verified-only note reads as one sentence', async ({ page }) => {
    await signedInAsNew(page);
    await page.goto('/flatmates?post=1');
    await expect(page.getByRole('heading', { name: /Post your flatmate request/i })).toBeVisible({ timeout: 20_000 });

    const picker = page.getByRole('button', { name: 'Preferred localities' });
    await picker.tap();
    await page.locator('.dz-dropdown__option', { hasText: 'Wakad' }).first().tap();
    await expect(page.locator('.dz-dropdown__option').first()).toBeHidden();
    await expect(picker).toContainText('Wakad');

    const note = page.locator('label', { hasText: 'Verified Seekers' });
    await expect(note).toHaveText('Only let Verified Seekers express interest in my post');
    expect((await note.boundingBox()).height).toBeLessThan(64);
  });
});
