import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAsNew } from '../../../helpers/liveAuth.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';
import { trackErrors } from '../../../helpers/console.js';

/* Reads the post back off `GET /me/flatmate-posts` rather than trusting the rendered form: a form
   can render every control and still drop the value on submit. */

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

/* Every published post joins one shared, publicly visible board, so anything created here has to be
   removed again — `live-filters` and `live-smart-search` count cards on that board. */
const track = flatmateCleanup(test);

/** Open a themed multi-select, tick options by their visible text, and close it. */
async function pickFrom(page, trigger, options) {
  const picker = page.getByRole('button', { name: trigger });
  await picker.click();
  for (const option of options) {
    await page.locator('.dz-dropdown__option', { hasText: option }).first().click();
  }
  await picker.click();
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
    await page.locator('input[placeholder="₹ e.g. 15000"]').fill('17500');

    /* Two of each, from separate dropdowns. One would prove the array arrived; two prove it arrived
       whole, which is the failure a multi-select actually has — keeping only the last pick. */
    await pickFrom(page, 'Preferred localities', ['Baner', 'Wakad']);
    await pickFrom(page, 'Lifestyle preferences', ['Vegetarian', 'Non-smoker']);

    await page.getByRole('button', { name: 'Looking to share with' }).click();
    await page.getByRole('option', { name: 'Women only', exact: true }).click();
    await page.getByRole('button', { name: 'Room preference' }).click();
    await page.getByRole('option', { name: 'Private room', exact: true }).click();

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

    expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
  });
});
