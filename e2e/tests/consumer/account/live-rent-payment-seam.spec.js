/**
 * The rent screen's two claims about money that were not true.
 *
 * Both defects lived one layer out from the mapper, which is why the mapper reads correctly and
 * nothing here ever failed. `rentMapper` has emitted `paymentSessionId` and `settled` for as long
 * as it has existed, with a docblock on each explaining what it is for. `PayRent.jsx` read neither.
 *
 * ## 1. Three of the five payment methods could not pay rent
 *
 * The `<select>` carried five bare `<option>` labels and no values, so the browser sent the label
 * back as the value, and the call site posted `String(method).toLowerCase()`. `upi` and
 * `netbanking` survive that trip unchanged — which is exactly why nobody noticed. The other three
 * arrive as `credit card`, `debit card` and `upi autopay (recurring)`, none of which is a member of
 * `PaymentMethods`, so `RentService.requirePayableMethod` answered 400 (`BadRequestException` — not
 * the 422 a bean-validation failure would give, because there is no `@Pattern` on the field to
 * intercept it first) and the tenant could not pay by card at all. Two enums that agree on most
 * members is the dangerous kind; here they agreed on two out of five.
 *
 * The fix makes the wire word the option's `value`, and the two card labels collapse to the one
 * method the column stores — the gateway distinguishes credit from debit, we do not, and offering
 * the tenant a choice that transmits the same value is offering a choice that does not exist.
 *
 * ## 2. The tenant was never taken to the payment page
 *
 * `POST /me/rent-payments` opens a real Cashfree order and hands back a single-use
 * `paymentSessionId`. The screen dropped it and went straight to "waiting for your bank to
 * confirm". Nothing errored. The row simply stayed `due` for ever and the owner was never paid.
 *
 * ## 3. The owner was told they had received money nobody had sent
 *
 * `GET /me/rent-ledger` returns the owner's whole ledger — `due`, `overdue` and `failed` rows
 * alongside `paid`; the seeded unsettled row is a `failed` one. The received figure summed all of
 * them. The tenant's side of the same data already filtered on `settled`, so the two screens
 * disagreed about the same payments and the larger, wrong number was the one shown to the person
 * owed the money.
 *
 * ## Why the method test builds its own tenancy
 *
 * `POST /me/rent-payments` is a **write**: `RentService` commits the row before it opens the
 * gateway order, and nothing anywhere deletes a rent payment. Probing the methods against the
 * seeded Priya/Meera tenancy therefore left a real `due` row on a fixture other specs read — it is
 * a fourth row in `MyRentalPanel`, which labels every unsettled row "Payment failed", so
 * `live-my-rental` counted two "No receipt" rows where the seed has one. Single worker, one reset
 * per run, and `tests/consumer/account/` sorts first, so the leak landed before its victim every
 * time. This spec mints an owner, a tenant and a tenancy of its own instead, exactly as the
 * neighbouring creating specs do.
 *
 * ## Why the method test asserts "not 400" rather than 201
 *
 * Only one live payment may exist per tenancy per due date (V14's partial unique index), so the
 * second valid method in a run is answered 409 — and 409 is proof the method passed validation,
 * because `requirePayableMethod` runs before the duplicate-month check. Asserting 201 would make
 * the test a fact about how many times it had been run today.
 *
 * The one thing that would make `not.toBe(400)` vacuous is the *other* 409, the `expectedAmount`
 * mismatch — that one is raised **before** the method is looked at, so a wrong amount would
 * satisfy every positive assertion here without the method ever being read. The amount is taken
 * from the tenancy the test just created rather than written down as a constant, which is what
 * keeps that from being possible.
 *
 * The negative direction is the sharp one anyway: the exact strings the screen used to send must be
 * refused, and they are refused with a 400 carrying `method must be one of: ...` — which is
 * asserted too, so an unrelated 400 (a malformed body, a changed required field) cannot be mistaken
 * for the rejection under test.
 */
import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { authHeaders, API, uniqueMobile } from '../../../helpers/liveAuth.js';

/** Rent, and the price the deal closes at — `openFromClosedDeal` copies one into the other. */
const RENT = 41000;

const LISTING = {
  title: 'Zztest rent-method 2 BHK in Baner',
  deal: 'rent',
  propertyType: 'Flat',
  bhk: 2,
  price: RENT,
  locality: 'Baner',
  city: 'Pune',
  address: 'Rent Method Seam Residency, B-1204',
  area: 900,
  areaUnit: 'sqft',
  furnishing: 'semi-furnished',
  description: 'A rent listing that exists so a synthetic tenancy can be opened against it.',
};

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function post(headers, body) {
  return api('POST', '/me/rent-payments', headers, body);
}

/* Synthetic listings are taken back out of public reads the way a moderator would, matching
   `live-deal-visibility`. The tenancy and its payments stay — they belong to two throwaway users
   and are invisible to every seeded screen, and the baseline reset at the head of the next run is
   what actually removes them. */
const created = new Set();

test.afterAll(async () => {
  if (!created.size) return;
  const headers = await authHeaders(ACTORS.admin);
  for (const id of created) {
    const done = await api('PATCH', `/properties/${id}/status`, headers, {
      status: 'rejected',
      reason: 'Zztest cleanup \u2014 synthetic rent-payment-seam fixture',
    });
    expect(done.status, `cleaning up synthetic listing ${id}`).toBe(200);
  }
  created.clear();
});

/**
 * A fresh owner, a fresh tenant, and an active tenancy between them.
 *
 * Closing a rent deal is the only way a tenancy is opened (`TenancyService.openFromClosedDeal`,
 * called from `DealService.close` and nowhere else), and the tenant must hold an account for one to
 * exist at all — `tenancies.tenant_id` is a non-null FK, so an off-platform counterparty closes the
 * deal without opening a tenancy.
 */
async function tenancyOfItsOwn() {
  const ownerHeaders = await authHeaders(uniqueMobile());
  const tenantMobile = uniqueMobile();
  const tenantHeaders = await authHeaders(tenantMobile);

  const listing = await api('POST', '/me/listings', ownerHeaders, LISTING);
  expect(listing.status, `posting the listing (${JSON.stringify(listing.body)})`).toBe(201);
  created.add(listing.body.id);

  const approved = await api('PATCH', `/properties/${listing.body.id}/status`,
    await authHeaders(ACTORS.admin), { status: 'approved' });
  expect(approved.status, 'approving the listing').toBe(200);

  const closed = await api('POST', `/me/deals/${listing.body.id}/close`, ownerHeaders, {
    agreedPrice: RENT,
    counterpartyMobile: tenantMobile,
  });
  expect(closed.status, `closing the deal (${JSON.stringify(closed.body)})`).toBe(200);

  const mine = await api('GET', '/me/tenancies', tenantHeaders);
  const tenancy = (Array.isArray(mine.body) ? mine.body : mine.body?.items || [])[0];
  expect(tenancy?.id,
    'closing the rent deal opened no tenancy for the counterparty \u2014 the method assertions below '
    + 'would have nothing to run against').toBeTruthy();
  /* The rent the server recorded, not the one this file asked for. `expectedAmount` is checked
     *before* the method is, so a figure that has drifted would answer 409 without the method ever
     being read and every positive assertion below would pass on a request that proved nothing. */
  expect(tenancy.rent, 'the closed deal did not carry its agreed price onto the tenancy').toBe(RENT);

  return { headers: tenantHeaders, tenancyId: tenancy.id, rent: tenancy.rent };
}

test.describe('rent payment seam', () => {
  test('every method the screen offers is payable, and every label it used to send is not', async () => {
    const { headers, tenancyId, rent } = await tenancyOfItsOwn();

    /* The three option values now rendered by `PAY_METHODS`. `cash` is absent because the platform
       cannot initiate a cash payment, it can only be told one happened. `autopay` is absent for a
       different reason — see the assertion below. */
    for (const method of ['upi', 'card', 'netbanking']) {
      const res = await post(headers, { tenancyId, expectedAmount: rent, method });
      expect(res.status, `method "${method}" was rejected: ${JSON.stringify(res.body)}`).not.toBe(400);
    }

    /* `autopay` is payable server-side and deliberately **not** offered: it is charged by a standing
       mandate and nothing on this screen creates one, so offering it would open a one-off order
       stamped `autopay` with no mandate behind it. Asserting that the server takes it is what keeps
       the omission a product decision rather than a second broken mapping — when a mandate flow
       lands, this is the line that says the wire word was already right. */
    const auto = await post(headers, { tenancyId, expectedAmount: rent, method: 'autopay' });
    expect(auto.status, 'autopay left PAYABLE server-side; the screen withholds it on purpose').not.toBe(400);

    /* What the five bare labels became after `toLowerCase()`. `upi` and `netbanking` are missing
       from this list because the old code happened to produce them correctly — the coincidence
       that hid the other three. */
    for (const label of ['credit card', 'debit card', 'upi autopay (recurring)']) {
      const res = await post(headers, { tenancyId, expectedAmount: rent, method: label });
      expect(res.status, `"${label}" was accepted as a payment method`).toBe(400);
      expect(res.body?.message || '').toContain('method must be one of');
    }
  });

  test('the owner is credited only what has settled, not what is merely owed', async ({ page, login }) => {
    /* Computed from the server's own rows rather than hard-coded, so the number stays right as the
       seed grows and as the test above opens a pending payment. The two must agree: the whole
       defect was that the screen counted rows the bank has not moved. */
    const headers = await authHeaders(ACTORS.owner);
    /* `content`, not `items`: this fetch sits below `unwrapPage`, so it sees Spring's own page
       envelope rather than the shape the provider normalises it into. */
    const ledger = await fetch(`${API}/me/rent-ledger?size=100`, { headers }).then((r) => r.json());
    const rows = ledger?.content || [];
    const settled = rows.filter((r) => r.status === 'paid');
    const owedButUnpaid = rows.filter((r) => r.status !== 'paid');
    expect(settled.length, 'no settled rent in the seed — this test would pass vacuously').toBeGreaterThan(0);
    expect(owedButUnpaid.length,
      'every ledger row has settled, so a filtered and an unfiltered sum are the same number and '
      + 'this test cannot tell them apart').toBeGreaterThan(0);

    const expected = settled.reduce((s, r) => s + Number(r.amount || 0), 0);
    const inflated = rows.reduce((s, r) => s + Number(r.amount || 0), 0);

    /* The received figure only renders once a payout destination exists — before that the panel is
       the setup form, and an owner with no bank account is not yet being told anything. Setting one
       is what puts the number on screen, so the test sets it rather than depending on a seed row
       that does not exist.

       Not restored afterwards, because there is no route that removes one: `/me/payout-account` is
       GET and PUT only. The baseline reset at the head of every run is the teardown, and nothing
       else in the suite asserts this owner has no payout destination — `check-seed-coverage.mjs`
       reads `payout_accounts` during global setup, before this write. Should a spec ever need that
       absence, it needs an owner of its own rather than a restore here. */
    const payout = await fetch(`${API}/me/payout-account`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        accountHolder: 'Zztest Payout',
        accountNumber: '123456789012',
        ifsc: 'HDFC0001234',
      }),
    });
    expect(payout.status, await payout.text().catch(() => '')).toBe(200);

    await login.asOwner();
    await page.goto('/pay-rent');
    const received = page.getByTestId('rent-received');
    await expect(received).toBeVisible({ timeout: 20000 });

    const shown = Number((await received.innerText()).replace(/[^\d]/g, ''));
    expect(shown, `screen showed the unfiltered total (${inflated}) instead of the settled one`).toBe(expected);
    expect(shown).not.toBe(inflated);
  });
});
