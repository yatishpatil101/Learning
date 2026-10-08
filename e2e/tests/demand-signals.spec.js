/** Assertions are deltas on one locality: other live specs append to `demand_signals`, so absolute counts race. */
import { test, expect } from '@playwright/test';
import { API, authHeaders } from '../helpers/liveAuth.js';
import { ACTORS } from '../fixtures/live.js';

/** A slug no locality row will ever match, so this spec cannot collide with seeded demand. */
const SLUG = 'live-demand-probe';

/** Read the supply-gap row for SLUG, or null when nothing has been recorded for it yet. */
async function probeRow(request) {
  const res = await request.get(`${API}/admin/supply-gap`, {
    headers: await authHeaders(ACTORS.admin),
  });
  expect(res.status()).toBe(200);
  const rows = await res.json();
  return rows.find((r) => r.localitySlug === SLUG) || null;
}

test('an anonymous search signal reaches the admin supply-gap report', async ({ request }) => {
  const before = await probeRow(request);
  const beforeSearches = before?.searches ?? 0;

  // No authorization header at all: this is the signed-out visitor case, and it must be accepted.
  const res = await request.post(`${API}/demand-signals`, {
    headers: { 'content-type': 'application/json' },
    data: { kind: 'search', localitySlug: SLUG, deal: 'rent', bhk: '2' },
  });
  expect(res.status()).toBe(202);

  const after = await probeRow(request);
  expect(after).not.toBeNull();
  expect(after.searches).toBe(beforeSearches + 1);
  // No locality matches the slug, so the API leaves the name out rather than inventing one.
  expect(after.localityName ?? null).toBeNull();
  expect(after.supply).toBe(0);
});
