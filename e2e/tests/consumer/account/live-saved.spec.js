import { test, expect } from '../../../fixtures/live.js';
import { API, authHeaders, uniqueMobile, signedInAs } from '../../../helpers/liveAuth.js';

/* The Saved page against the shortlist the server keeps.
 *
 * ## What the mock version could not ask
 *
 * The retired twin wrote `dzSavedProps:9876500001` into localStorage to seed the shortlist and
 * then read the same key back to prove the page had changed it. Both halves are gone in
 * production: `SavedContext` fills from `GET /me/saved` and writes through
 * `PUT|DELETE /me/saved/{propId}`. So the old spec seeded through a door that does not exist and
 * verified against the page's own copy of the truth — a page that never called the server at all
 * would have passed every assertion in it.
 *
 * That is not hypothetical. The same shape of assertion in the reels spec was hiding a live bug
 * where the write was rejected and silently rolled back, because the only thing being checked was
 * the copy the page keeps for itself.
 *
 * ## The undo window is the interesting one
 *
 * Removing a card stages for `UNDO_WINDOW_MS` and only then commits. The mock proved "staged" by
 * showing a local array still had two entries. Live, staged means something much more specific and
 * much more worth protecting: **the server has not been told**. So the test counts
 * `DELETE /me/saved/*` requests leaving the browser — zero while the undo is on offer, exactly one
 * after it lapses — and then confirms the shortlist really shrank by asking the API from outside
 * the page. A build that unsaved immediately and merely *rendered* an undo affordance passes the
 * old spec and fails this one; and that build is the plausible regression, because the undo row is
 * pure presentation while the write is one call away in the same handler.
 *
 * ## Seeding
 *
 * A throwaway account per test, seeded over HTTP, because the assertions are of the form "the
 * shortlist is exactly this" and a shared actor carries whatever a previous run left behind.
 * `PUT /me/saved/{propId}` binds a UUID, not a slug — the same distinction that broke saving from
 * a reel — so the ids are resolved from the catalogue rather than assumed.
 */

const api = (path, headers, init = {}) => fetch(`${API}${path}`, { headers, ...init });

const rows = async (headers) => {
  const res = await api('/me/saved?size=100', headers);
  expect(res.status).toBe(200);
  const body = await res.json();
  return body.content || body.items || [];
};

/* Two sale and two rental listings, taken from the catalogue rather than hardcoded, so a reseed
   that renumbers the demo data fails loudly on "not enough listings" instead of quietly rendering
   an empty tab and passing a count assertion of zero. */
async function pickListings() {
  const res = await fetch(`${API}/properties?sort=newest&size=100`);
  expect(res.status).toBe(200);
  const body = await res.json();
  const all = body.content || body.items || body;
  const of = (deal) => all.filter((p) => p.deal === deal).slice(0, 2);
  const buy = of('buy');
  const rent = of('rent');
  expect(buy.length, 'the catalogue does not have two sale listings to shortlist').toBe(2);
  expect(rent.length, 'the catalogue does not have two rentals to shortlist').toBe(2);
  return { buy, rent };
}

/* `PUT /me/saved/{propId}` binds a UUID and the card rows carry a slug, so each id is resolved
   through the detail read the same way `propertyMapper` does for the browser. */
async function shortlist(headers, listings) {
  const uuids = [];
  for (const p of listings) {
    const detail = await fetch(`${API}/properties/${p.slug || p.id}`);
    expect(detail.status).toBe(200);
    const { id } = await detail.json();
    const put = await api(`/me/saved/${id}`, headers, { method: 'PUT' });
    expect(put.status, `could not shortlist ${p.slug}`).toBeLessThan(300);
    uuids.push(id);
  }
  return uuids;
}

async function actor() {
  const mobile = uniqueMobile();
  const headers = await authHeaders(mobile);
  expect(await rows(headers), 'a brand-new account already had a shortlist').toEqual([]);
  return { mobile, headers };
}

async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({
      necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now(),
    }));
  });
}

async function openSaved(page, mobile) {
  await seedConsent(page);
  await signedInAs(page, mobile);
  await page.goto('/saved');
}

test('a signed-out visitor gets the on-device shortlist and a sign-in prompt', async ({ page }) => {
  /* No server state involved — signed out, `GET /me/saved` 401s and the context holds an empty
     set by design. Kept because the claim is that /saved is NOT behind ProtectedRoute: saves are
     written while signed out from Reels, Compare and the map panel, so redirecting here would
     throw away a shortlist the visitor can see. */
  await page.goto('/saved');
  await expect(page).not.toHaveURL(/\/signin/);
  await expect(page.getByRole('heading', { name: 'Saved properties', exact: true })).toBeVisible();
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await expect(page.locator('a[href="/signin?reason=saved&next=%2Fsaved"]')).toBeVisible();
});

test('the shortlist the page renders is the one the server holds', async ({ page }) => {
  const { mobile, headers } = await actor();
  const { buy, rent } = await pickListings();
  await shortlist(headers, [...buy, ...rent]);

  await openSaved(page, mobile);

  await expect(page.getByText('Saved on this device')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Saved properties', exact: true })).toBeVisible();

  const tabs = page.locator('.saved-tabs .saved-tab');
  await expect(tabs).toHaveCount(3);
  await expect(page.locator('.saved-tabs')).toContainText('For Sale');
  await expect(page.locator('.saved-tabs')).toContainText('For Rent');
  await expect(page.locator('.saved-tabs')).toContainText('Flatmates & Rooms');

  /* Both tabs, and by title rather than by count alone: two cards on the sale tab is also what
     you get if the page put the rentals there, and the split between the two tabs is the only
     thing the tab bar is for. */
  await expect(page.locator('.property-card')).toHaveCount(2);
  for (const p of buy) await expect(page.getByRole('heading', { name: p.title })).toBeVisible();

  await page.getByRole('button', { name: /For Rent/ }).click();
  await expect(page.locator('.property-card')).toHaveCount(2);
  for (const p of rent) await expect(page.getByRole('heading', { name: p.title })).toBeVisible();
});

test('remove stages an undo without telling the server, then commits the unsave when it lapses', async ({ page }) => {
  const { mobile, headers } = await actor();
  const { buy } = await pickListings();
  const uuids = await shortlist(headers, buy);

  /* Counted at the network, because "staged" is a claim about what the browser has NOT done yet.
     Reading a local array — which is all the mock could do — cannot distinguish a staged removal
     from one that already reached the server and was optimistically re-rendered. */
  const deletes = [];
  page.on('request', (req) => {
    if (req.method() === 'DELETE' && /\/me\/saved\//.test(req.url())) deletes.push(req.url());
  });

  await openSaved(page, mobile);
  await expect(page.locator('.property-card')).toHaveCount(2);

  await page.getByRole('button', { name: 'Remove from saved' }).first().click();

  const undo = page.getByRole('button', { name: /Undo removing/i });
  await expect(undo).toBeFocused();
  expect(deletes, 'the removal reached the server while it was still meant to be undoable').toEqual([]);
  expect(await rows(headers), 'the shortlist shrank before the undo window closed').toHaveLength(2);

  // The window lapses (5s) and the card animates out (~400ms).
  await expect(page.locator('.property-card')).toHaveCount(1, { timeout: 15_000 });

  await expect
    .poll(async () => (await rows(headers)).length, { message: 'the card vanished but the server shortlist did not' })
    .toBe(1);
  expect(deletes, 'the commit sent something other than exactly one unsave').toHaveLength(1);

  /* Which of the two went is not asserted by position — the page is free to order the shortlist
     however it likes, and pinning that here would make this test fail for a sort change that has
     nothing to do with removal. What must hold is that the two halves agree: the property the
     browser asked to unsave is exactly the one the server no longer has. */
  const survivor = (await rows(headers))[0];
  const survivorId = survivor.propertyId || survivor.property?.id || survivor.id;
  const removed = uuids.find((u) => u !== survivorId);
  expect(removed, 'the row left on the server is not one of the two that were shortlisted').toBeTruthy();
  expect(deletes[0], 'the browser unsaved a different property than the one the server dropped').toContain(removed);
});

test('the bell-plus action turns a saved home into a saved search on the server', async ({ page }) => {
  const { mobile, headers } = await actor();
  const { buy } = await pickListings();
  await shortlist(headers, buy);

  /* Captured so that "the server has no saved search" arrives with its reason attached. The write
     is fire-and-forget in the page (the toast does not wait on it), so without this a rejected
     POST shows up only as a count that stayed at zero — the single most expensive kind of test
     failure to diagnose, and the one this whole conversion exists to stop producing. */
  const posts = [];
  page.on('response', async (res) => {
    if (res.request().method() === 'POST' && /\/me\/saved-searches/.test(res.url())) {
      posts.push(`${res.status()} ${await res.text().catch(() => '<unreadable>')}`);
    }
  });

  await openSaved(page, mobile);
  await expect(page.locator('.property-card').first()).toBeVisible();
  await page.getByRole('button', { name: 'Create alert for similar properties' }).first().click();

  await expect(page.getByText(/Alert created/)).toBeVisible();

  /* Asked of the API rather than of localStorage: an alert is a standing instruction to notify
     this account later, so one that only exists in this browser is not an alert at all — the
     toast would be a promise the product cannot keep. */
  await expect
    .poll(async () => {
      const res = await api('/me/saved-searches?size=50', headers);
      const body = await res.json();
      return (Array.isArray(body) ? body : body.content || body.items || []).length;
    }, {
      message: () => 'the toast said the alert was created but the server has no saved search; '
        + `POST responses seen: ${posts.length ? posts.join(' | ') : '<none — the page never called>'}`,
    })
    .toBeGreaterThan(0);
});

test('shows the empty state when the account has nothing saved', async ({ page }) => {
  const { mobile } = await actor();
  await openSaved(page, mobile);

  await expect(page.getByRole('heading', { name: 'No saved properties yet' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Browse Properties/ })).toBeVisible();
  await expect(page.locator('.saved-tabs .saved-tab')).toHaveCount(0);
});

test('loads the saved page with no console errors', async ({ page, consoleErrors }) => {
  const { mobile, headers } = await actor();
  const { buy, rent } = await pickListings();
  await shortlist(headers, [...buy, ...rent]);

  await openSaved(page, mobile);
  await expect(page.getByRole('heading', { name: 'Saved properties', exact: true })).toBeVisible();
  await expect(page.locator('.property-card').first()).toBeVisible();
  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
});
