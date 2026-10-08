import { test, expect } from '@playwright/test';

/* The waitlist must leave the browser and refusal must preserve the filled form; a toast alone
   cannot distinguish server persistence from localStorage. */

/** Not live in the seeded roster, so the switcher answers with the waitlist modal rather than a
 *  city switch. `geo-policy` asserts the same default from the other direction. */
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
    /* Unique per run because duplicate rows also answer 201 and would hide a stale match. The "91"
       lead is deliberate: a number that begins with the country code's digits is still a mobile. */
    const mobile = `91${String(Date.now()).slice(-8)}`;

    await openWaitlistModal(page);
    await fillWaitlist(page, mobile);
    const posted = page.waitForRequest((r) => r.url().includes('/cities/waitlist') && r.method() === 'POST');
    const answered = page.waitForResponse((r) => r.url().includes('/cities/waitlist') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Notify me when live' }).click();

    const req = await posted;
    /* City is switcher state, not form state; omitting it would still 201 and misfile the ask. */
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
