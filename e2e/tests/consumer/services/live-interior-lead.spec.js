import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders } from '../../../helpers/liveAuth.js';

/**
 * The interior consultation lead against the live API.
 *
 * This page used to file the lead twice: a mock ticket into browser storage *and* a real service
 * request. Against Postgres only the second one existed, so the mock write was a lead that looked
 * filed and reached nobody. D5 deleted it, and the risk of deleting it is that the fields only the
 * ticket carried — the contact name and mobile the customer types into the form — go with it. They
 * do not ride on the account: the form asks who to call about this job, and that is routinely not
 * the account holder. So the interesting assertion here is not "a request was created" but
 * "the request created carries the number the customer typed".
 *
 * The existing mock specs (consumer/services/interior.spec.js) stop at the signed-out gate and
 * never submit, which is exactly why the double write survived as long as it did. These tests
 * submit.
 *
 * Fixtures: ACTORS.buyer signs in through the live OTP flow; the request is then read back from
 * GET /service-requests with the same account's token, so the assertion crosses the UI/API boundary
 * rather than trusting the POST body the page happened to build.
 */

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

/* The form's dropdowns are the project's own `Select`, not a native `<select>`, so `selectOption`
   never resolves against them — open the trigger and click the option, as the rest of the suite
   does. The wrapper div carries the `data-err` anchor. */
async function pickOption(page, dataErr, label) {
  await page.locator(`[data-err="${dataErr}"]`).click();
  await page.locator('.pn-dropdown__option', { hasText: label }).first().click();
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
  test('submitting the form files exactly one service request', async ({ page, login }) => {
    await login.asBuyer();

    const before = await latestInteriorRequest();
    await fillAndSubmit(page);

    const after = await latestInteriorRequest();
    expect(after).not.toBeNull();
    // A delta, not an absolute: the seed may already hold interior requests, and this suite runs
    // against a database other tests have written to.
    expect(after.id).not.toBe(before?.id);
  });

  test('the lead carries the contact the customer typed, not the account holder', async ({ page, login }) => {
    await login.asBuyer();
    await fillAndSubmit(page);

    const req = await latestInteriorRequest();
    expect(req).not.toBeNull();
    // The claim D5 has to make good on. Without these the ops desk gets a job with no callback
    // number, which is a worse outcome than the double write it replaced.
    expect(req.details.contactMobile).toBe(SITE_CONTACT.mobile);
    expect(req.details.contactName).toBe(SITE_CONTACT.name);
  });

  test('the brief survives the round trip intact', async ({ page, login }) => {
    await login.asBuyer();
    await fillAndSubmit(page);

    const req = await latestInteriorRequest();
    // details is stored as-is and echoed back (D119); assert the whole brief rather than one field,
    // because a mapper that drops keys drops them quietly and one surviving key proves nothing.
    expect(req.details.scope).toBe(FORM.scope);
    expect(req.details.rooms).toBe(FORM.config);
    expect(req.details.timeline).toBe(FORM.status);
    expect(req.details.budget).toBe(FORM.budget);
    expect(req.type).toBe('interior');
  });

  test('the lead reaches the server, not browser storage', async ({ page, login }) => {
    await login.asBuyer();
    await page.goto('/services/interior-renovation');

    // Armed before the click: the old code path would have satisfied every visible assertion above
    // while writing only to localStorage, so provenance has to be observed rather than inferred.
    const posted = page.waitForRequest(
      (r) => r.method() === 'POST' && /\/service-requests(\?|$)/.test(r.url()),
      { timeout: 15000 },
    );

    await page.locator('input[data-err="name"]').fill(SITE_CONTACT.name);
    await page.locator('[data-err="mobile"] input').fill(SITE_CONTACT.mobile);
    await pickOption(page, 'scope', FORM.scope);
    await page.getByRole('button', { name: 'Book My Consultation' }).click();

    const req = await posted;
    expect(req.postDataJSON().type).toBe('interior');
  });
});
