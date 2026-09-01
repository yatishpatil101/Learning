/**
 * Demand signals, end to end against the live API.
 *
 * Covers the two halves of the seam that mock mode cannot: that an anonymous browser can write a
 * demand signal at all (the route is the only unauthenticated POST added in a while, so it is worth
 * a standing check that it has not drifted behind the security config), and that the admin report
 * reads that write back.
 *
 * Deltas, not absolutes. `demand_signals` is append-only and every other live spec that touches a
 * listing page contributes to it, so an absolute count here would be a fixture-ordering trap. Each
 * assertion measures the same locality before and after.
 *
 * Fixtures: ACTORS.admin for the report; a fresh unauthenticated request for the write.
 */
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
  // The slug matches no locality, so there is no display name to show. That is the report's most
  // actionable row -- demand for somewhere Draazy does not cover -- and the API says so by
  // leaving the name out rather than inventing one.
  expect(after.localityName ?? null).toBeNull();
  expect(after.supply).toBe(0);
});

test('alert and view signals are counted separately and weighted differently', async ({ request }) => {
  const before = await probeRow(request);
  const beforeAlerts = before?.alerts ?? 0;
  const beforeViews = before?.views ?? 0;
  const beforeDemand = before?.demand ?? 0;

  const headers = { 'content-type': 'application/json' };
  expect((await request.post(`${API}/demand-signals`, { headers, data: { kind: 'alert', localitySlug: SLUG } })).status()).toBe(202);
  expect((await request.post(`${API}/demand-signals`, { headers, data: { kind: 'view', localitySlug: SLUG } })).status()).toBe(202);

  const after = await probeRow(request);
  expect(after.alerts).toBe(beforeAlerts + 1);
  expect(after.views).toBe(beforeViews + 1);
  // Weights are alert 5, search 2, view 1. One alert plus one view is six points of demand, and the
  // difference between the two is the whole reason the report distinguishes them: somebody asking
  // to be told when a home appears is worth more than somebody scrolling past one.
  expect(after.demand).toBe(beforeDemand + 6);
});

test('a signal with an unknown kind is rejected rather than silently dropped', async ({ request }) => {
  const res = await request.post(`${API}/demand-signals`, {
    headers: { 'content-type': 'application/json' },
    data: { kind: 'purchase', localitySlug: SLUG },
  });
  // 422, not 400: this is bean validation on the request body, and the distinction matters because
  // a client that cannot tell "you sent nonsense" from "the server refused" cannot retry correctly.
  expect(res.status()).toBe(422);
});

test('the supply-gap report is closed to signed-out callers', async ({ request }) => {
  const res = await request.get(`${API}/admin/supply-gap`);
  // The write is public and the read is not, which is the asymmetry the whole design rests on: a
  // visitor may contribute to the measurement without being allowed to see it.
  expect([401, 403]).toContain(res.status());
});
