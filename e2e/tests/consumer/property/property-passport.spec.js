import { test, expect } from '../../../fixtures/live.js';
import { API, authHeaders, uniqueMobile } from '../../../helpers/liveAuth.js';

/** The record is created in wire vocabulary so the page renders only if toManaged() maps it; 80% = 4 of 5
 * checklist items (no docs). A throwaway owner avoids relying on unpublished seeded managed-property counts. */

/* Server vocabulary on purpose: propertyType, numeric bhk, deal buy|rent. Client spellings (type, "2 BHK",
   sale) would fail as a 422 rather than as a quietly-empty page. */
const RECORD = {
  title: '2 BHK Flat in Baner',
  deal: 'rent',
  propertyType: 'Flat',
  bhk: 2,
  price: 28000,
  locality: 'Baner',
  area: 950,
  areaUnit: 'sqft',
  furnishing: 'semi-furnished',
  valuation: { rent: { mid: 28000 }, sale: { mid: 6500000 }, perSqft: 6800 },
};

/** Returns the server's id; the route resolves it via GET /me/managed-properties/{id}, which parses a UUID. */
async function ownerWithPassport(page, login) {
  const mobile = await login.asNewOwner();
  const headers = await authHeaders(mobile);
  const res = await fetch(`${API}/me/managed-properties`, {
    method: 'POST',
    headers,
    body: JSON.stringify(RECORD),
  });
  expect(res.status, 'creating the managed property').toBe(201);
  const dto = await res.json();
  // The server owns `visibility` and `status` — the create request has no field for either, and
  // the page's "Private" chip is a render of what the server decided, not of what we asked for.
  expect(dto.visibility, 'a new managed record is born private').toBe('private');
  expect(dto.status).toBe('managed');
  expect(dto.id, 'the server issued an id').toBeTruthy();
  return { mobile, id: dto.id, headers };
}

test.describe('Property passport — /owner-hub/property/:id', () => {
  test('redirects to sign in when signed out', async ({ page }) => {
    /* A valid UUID the server never issued, so the guard is the only reason the passport does not render. */
    await page.goto('/owner-hub/property/00000000-0000-4000-8000-000000000000');
    await expect(page).toHaveURL(/\/signin/);
    await expect(page).toHaveURL(/next=/);
    await expect(page.getByText('Passport completeness')).toHaveCount(0);
  });

  test('renders the passport for the owning user, translated from the wire vocabulary, with no console errors', async ({ page, login, consoleErrors }) => {
    const { id } = await ownerWithPassport(page, login);
    await page.goto(`/owner-hub/property/${id}`);

    // Positive anchor first. Everything below is a claim about *this* record having rendered, and
    // an empty or errored hub would satisfy several of them vacuously.
    await expect(page.getByRole('heading', { name: '2 BHK Flat in Baner' })).toBeVisible();

    // Server-owned state, rendered as the visibility chip + the CTA that acts on it.
    await expect(page.getByText('Private', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Publish as listing/i })).toBeVisible();

    // The derived number. 4 of 5 checklist items — docs is the missing one, and a record created a
    // moment ago genuinely has no documents, so this is the honest value rather than a fixture.
    await expect(page.getByText('Passport completeness')).toBeVisible();
    await expect(page.getByTestId('passport-percent')).toHaveText('80%');

    // The three panels the passport is made of.
    await expect(page.getByRole('heading', { name: 'Document passport' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Rent tracking' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Valuation' })).toBeVisible();

    await expect(page.getByRole('link', { name: /My properties/i }).first()).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test('a managed property belonging to somebody else is not found', async ({ page, login }) => {
    /* A foreign record answers 404, not 403, so ids cannot be probed; the same empty state proves scoping. */
    const stranger = uniqueMobile();
    const headers = await authHeaders(stranger);
    const res = await fetch(`${API}/me/managed-properties`, {
      method: 'POST',
      headers,
      body: JSON.stringify(RECORD),
    });
    expect(res.status, "creating the stranger's managed property").toBe(201);
    const theirs = (await res.json()).id;

    // …and it really is readable by the person who owns it, so the absence below is about the
    // viewer rather than about the record.
    const asOwner = await fetch(`${API}/me/managed-properties/${theirs}`, { headers });
    expect(asOwner.status, 'the owner can read their own record').toBe(200);

    await login.asNewOwner();
    await page.goto(`/owner-hub/property/${theirs}`);

    await expect(page.getByRole('heading', { name: 'Property not found' })).toBeVisible();
    await expect(page.getByText('It may have been removed, or the link is incorrect.')).toBeVisible();
    await expect(page.getByRole('link', { name: /Back to My properties/i })).toBeVisible();
    // The record's own title must not leak through the not-found state.
    await expect(page.getByText('2 BHK Flat in Baner')).toHaveCount(0);
  });
});
