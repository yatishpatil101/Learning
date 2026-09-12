import { test, expect } from '@playwright/test';

/**
 * The city waitlist ask, against the live API.
 *
 * ## What this proves that nothing else did
 *
 * `POST /cities/waitlist` and the `city_waitlist` table shipped, and the form in front of them kept
 * writing to a `dzCityRequests` array in the shopper's own browser. Every ask ever made was
 * therefore recorded in the one place nobody at Draazy could read, and the shopper was told
 * "You're on the Mumbai waitlist 🎉" for a row that existed only until they cleared their cache.
 * The admin console even had a "City Expansion Requests" panel reading that key — which meant it
 * showed the operator the asks *the operator themselves* had made while browsing.
 *
 * Nothing failed, which is why it survived: the toast fired, the modal closed, and the demand
 * signal the expansion queue is supposed to run on was silently zero. So this spec is about the
 * request leaving the browser at all. The wire is the strongest assertion available *here* — a UI
 * check could not tell the fixed version from the broken one, since both toast. That the ask then
 * reaches an operator is a separate claim, owned by
 * `admin/live-analytics-page.spec.js` ("City Expansion Requests counts the asks the server holds"),
 * which reads them back through `GET /admin/cities/waitlist`.
 *
 * ## Why the refusal case is forced
 *
 * A POST that succeeds cannot demonstrate that a POST that fails is reported. Before this change
 * the handler was synchronous and could not fail, so the toast was unconditional; now it is awaited
 * and a rejection has to keep the shopper on their filled-in form instead of congratulating them.
 * The 500 is routed rather than provoked because the server has no input this form can send that it
 * would refuse — the client validates the mobile first.
 *
 * Public route (`security: []`), so no sign-in: the point of a waitlist is that the person is not a
 * user yet.
 */

/** Not live in the seeded roster, so the switcher answers with the waitlist modal rather than a
 *  city switch. `live-geo-policy` asserts the same default from the other direction. */
const CITY = 'Mumbai';

async function openWaitlistModal(page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^City: / }).first().click();
  await page.getByRole('listbox', { name: 'Select city' }).getByRole('button', { name: new RegExp(CITY) }).click();
  await expect(page.getByRole('heading', { name: new RegExp(`Join the ${CITY} waitlist`, 'i') })).toBeVisible();
}

async function fillWaitlist(page, mobile) {
  await page.getByPlaceholder('Enter mobile number').fill(mobile);
  await page.getByPlaceholder('you@example.com').fill('waitlist.tester@example.com');
}

test.describe('City waitlist (live)', () => {
  test('joining the waitlist posts the ask to the server, not to this browser', async ({ page }) => {
    /* Unique per run: the table takes repeats (the server answers 201 either way), but a fixed
       number would make a passing run indistinguishable from one that matched an older row. */
    const mobile = `9${String(Date.now()).slice(-9)}`;

    await openWaitlistModal(page);
    await fillWaitlist(page, mobile);

    const posted = page.waitForRequest((r) => r.url().includes('/cities/waitlist') && r.method() === 'POST');
    const answered = page.waitForResponse((r) => r.url().includes('/cities/waitlist') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Notify me when live' }).click();

    const req = await posted;
    /* The city has to travel. It is not in the form — the modal knows it from the switcher — so a
       version that posted only the contact details would still 201 and still toast, and every ask
       would land under whatever city the server defaulted to. */
    expect(req.postDataJSON()).toMatchObject({ city: CITY, mobile });
    expect((await answered).status()).toBe(201);

    await expect(page.getByText(`You're on the ${CITY} waitlist`, { exact: false })).toBeVisible();
    await expect(page.getByRole('heading', { name: new RegExp(`Join the ${CITY} waitlist`, 'i') })).toHaveCount(0);
  });

  test('a refused ask keeps the shopper on the form instead of congratulating them', async ({ page }) => {
    await page.route('**/cities/waitlist', (route) => route.fulfill({ status: 500, body: '{}' }));

    await openWaitlistModal(page);
    await fillWaitlist(page, '9876543210');
    await page.getByRole('button', { name: 'Notify me when live' }).click();

    /* Asserted as a pair. The failure message alone is satisfied by a page that also toasts, and
       the missing toast alone is satisfied by a page that says nothing at all. */
    await expect(page.getByText(/couldn't record that just now/i)).toBeVisible();
    await expect(page.getByText(`You're on the ${CITY} waitlist`, { exact: false })).toHaveCount(0);

    // And the form survives, so "try again" is a retry rather than a re-type. The mobile is the
    // field worth checking: it is the one the shopper typed and the only one the ask needs.
    await expect(page.getByRole('heading', { name: new RegExp(`Join the ${CITY} waitlist`, 'i') })).toBeVisible();
    await expect(page.getByPlaceholder('Enter mobile number')).toHaveValue('9876543210');
    await expect(page.getByRole('button', { name: 'Notify me when live' })).toBeEnabled();
  });
});
