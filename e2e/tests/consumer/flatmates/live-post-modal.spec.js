import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAsNew } from '../../../helpers/liveAuth.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';
import { trackErrors } from '../../../helpers/console.js';

/**
 * LIVE: the redesigned "Post your flatmate request" form, proved by what the server stored.
 *
 * ## Why this stopped being a mock keeper
 *
 * `post-modal.spec.js` was held back on the stated grounds that "none of those three controls is
 * read back over the API by any live spec, so there is no live assertion to make". That was true of
 * the *specs* and false of the *product*: `FlatmateSeekerPostDto` carries `localities`, `tags`,
 * `flatPref` and `roomPref`, and `flatmateMapper.js:225-229` has been mapping all four for as long
 * as the http provider has existed. Every control the redesign introduced writes a field the wire
 * already had. So the claim was never "these fields cannot be tested live" — it was "nobody had
 * tested them live yet", which is a different sentence.
 *
 * ## And the claim got stronger in the move
 *
 * The mock asserted that four controls were *on screen*: two `dz-dropdown` triggers instead of the
 * chip rows the redesign replaced, and the two P0 matching selects. A form can render all four and
 * still drop every value on submit — the redesign changed how these fields are collected, which is
 * exactly the kind of change that loses a binding, and rendering is the half that cannot catch it.
 *
 * So this drives all four controls the way a person does, then reads the post back off
 * `GET /me/flatmate-posts` on a connection the page is not holding. Presence is still asserted, but
 * as the setup for the round-trip rather than as the finding. The multi-selects are the point: they
 * are the two fields whose collection UI actually changed, and they are the two that carry arrays,
 * where "the value arrived" and "the value arrived intact" are separate facts.
 *
 * Matching semantics are not claimed here. That `roomPref: 'private'` should rank private rooms
 * higher belongs to the ranking specs; this file only proves the preference survives the trip.
 */

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

/* Every published post joins one shared, publicly visible board, so anything created here has to be
   removed again — `live-filters` and `live-smart-search` count cards on that board. */
const track = flatmateCleanup(test);

/** Open a themed multi-select, tick options by their visible text, and close it. */
async function pickFrom(page, trigger, options) {
  await page.getByRole('button', { name: trigger }).click();
  for (const option of options) {
    await page.locator('.dz-dropdown__option', { hasText: option }).first().click();
  }
  await page.keyboard.press('Escape');
}

test.describe('LIVE: post-request form', () => {
  test('every field the redesigned form collects reaches the server intact', async ({ page }) => {
    const errors = trackErrors(page);
    const mobile = await signedInAsNew(page);

    await page.goto('/flatmates?post=1');
    await expect(page.getByRole('heading', { name: /Post your flatmate request/i })).toBeVisible({ timeout: 20_000 });

    /* The shape the redesign is: localities and lifestyle as dropdown triggers rather than chip
       rows, and the two P0 matching selects present at all. Asserted before touching anything,
       because a trigger that is missing and a trigger that is present but unbound fail the
       round-trip below identically, and only one of them is this form's fault.

       By role-and-name rather than by visible text, which is what the mock used. `NativeSelect`
       renders a button, so the `<label>` above it labels nothing — both P0 selects reached
       assistive tech as unnamed buttons while every other control on this form was named. Asserting
       the accessible name is what surfaced that, and is what keeps it fixed. */
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
    /* The selects carry option *labels* on screen and enum values on the wire — "Women only" is
       stored as `women`. Asserting the stored value is what proves the translation happened rather
       than the label being persisted verbatim. */
    expect(saved.flatPref, '"Women only" should be stored as the enum').toBe('women');
    expect(saved.roomPref, '"Private room" should be stored as the enum').toBe('private');

    expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
  });
});
