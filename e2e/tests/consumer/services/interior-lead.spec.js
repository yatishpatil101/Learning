import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders } from '../../../helpers/liveAuth.js';

/* The request is read back from GET /service-requests with the account's own token, not the POST body. */

/** Someone other than the account holder — the whole point of the contact fields. */
const SITE_CONTACT = { name: 'Rohit Kale (site)', mobile: '9812345678' };

const FORM = {
  scope: 'Modular Kitchen',
  config: '3 BHK',
  status: 'Renovating existing home',
  budget: '\u20B96 \u2013 10 Lakh',
};

/** Newest-first is what the list promises, so index 0 is the request just filed. */
async function latestInteriorRequest() {
  const res = await fetch(`${API}/service-requests?type=interior&size=5`, {
    headers: await authHeaders(ACTORS.buyer),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  return (body.content || [])[0] || null;
}

/* The dropdowns are the project's own `Select`, not a native `<select>`: open the trigger and click
   the option. The wrapper div carries the `data-err` anchor. */
async function pickOption(page, dataErr, label) {
  await page.locator(`[data-err="${dataErr}"]`).click();
  await page.locator('.dz-dropdown__option', { hasText: label }).first().click();
}

async function fillAndSubmit(page) {
  await page.goto('/services/interior-renovation');
  await page.locator('input[data-err="name"]').fill(SITE_CONTACT.name);
  await page.locator('[data-err="mobile"] input').fill(SITE_CONTACT.mobile);
  await pickOption(page, 'scope', FORM.scope);
  await pickOption(page, 'config', FORM.config);
  await pickOption(page, 'status', FORM.status);
  await pickOption(page, 'budget', FORM.budget);
  await page.getByRole('button', { name: 'Book My Consultation' }).click();
  await expect(page.getByRole('heading', { name: 'Consultation booked!' })).toBeVisible();
}

test.describe('interior consultation lead (live)', () => {
  test('the lead reaches the server as one request carrying the typed contact and the whole brief', async ({ page, login }) => {
    await login.asBuyer();
    const before = await latestInteriorRequest();

    // Armed before the click: provenance is observed, not inferred from the visible confirmation.
    const posted = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/service-requests(\?|$)/.test(r.url()),
      { timeout: 15000 },
    );
    await fillAndSubmit(page);
    const response = await posted;
    expect(response.status()).toBe(201);
    expect(response.request().postDataJSON().type).toBe('interior');

    const req = await latestInteriorRequest();
    expect(req).not.toBeNull();
    // A delta, not an absolute: the seed may already hold interior requests.
    expect(req.id).not.toBe(before?.id);

    // The contact the customer typed, not the account holder: without it the desk gets a job with no
    // callback number.
    expect(req.details.contactMobile).toBe(SITE_CONTACT.mobile);
    expect(req.details.contactName).toBe(SITE_CONTACT.name);

    // The whole brief, because a mapper that drops keys drops them quietly.
    expect(req.details.scope).toBe(FORM.scope);
    expect(req.details.rooms).toBe(FORM.config);
    expect(req.details.timeline).toBe(FORM.status);
    expect(req.details.budget).toBe(FORM.budget);
    expect(req.type).toBe('interior');
  });
});
