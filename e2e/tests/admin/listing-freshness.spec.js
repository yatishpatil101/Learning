/* Admin anti-staleness: when a LIVE listing goes unconfirmed (freshness stale/dormant),
 * ops can surface it under Properties → Needs Follow-up → "Unconfirmed (stale)" and send the owner
 * a WhatsApp nudge to confirm availability.
 *
 * Converted to the shared `login` / `consoleErrors` fixtures and relative paths; the hardcoded
 * `http://localhost:5173` ignored `BASE_URL`, so this file silently tested the wrong server
 * whenever the port moved. Five `waitForTimeout` calls are gone — each stood in for the assertion
 * that the thing being waited for had arrived, which is what the test wanted to say anyway and is
 * both faster and not a flake on a slow machine.
 *
 * Still not a live spec, but no longer for the reason recorded here before. That reason was: "the
 * freshness confirmation this screen chases has no server path at all ... `freshenedAt` is a
 * browser-local fact and so is every badge derived from it." That was true when it was written and
 * is not any more — V86 added `properties.last_confirmed_at` and `POST
 * /me/listings/{id}/confirm-available`, and FINDING 7 is closed. What remains browser-local is the
 * *admin* half this file exercises: the "Needs Follow-up" board and its WhatsApp nudge are still
 * assembled client-side from mock rows, so the fixture below stays a seeded localStorage document.
 * The owner-side confirmation is proven against the server in
 * `backend/.../ListingConfirmAvailableTest`.
 */
import { test, expect } from '../../fixtures/base.js';
import { readFileSync } from 'node:fs';

const SEED_DB = JSON.parse(readFileSync(new URL('../../../frontend/src/data/db.json', import.meta.url), 'utf-8'));
const dISO = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);

/** The seeded listing this file is about: live, forty days old, last confirmed twenty days ago. */
const STALE_TITLE = 'Unconfirmed Stale Flat';
const STALE_OWNER = 'Stale Owner';

const liveListing = (over) => ({
  bhk: '2 BHK', bhkNum: 2, bath: 2, locality: 'Baner', localitySlug: 'baner',
  loc: 'Baner, Pune', deal: 'buy', owner: STALE_OWNER, ownerMobile: '9800022233',
  status: 'approved', real: true, featured: false, views: 5, enquiries: 1,
  furnishing: 'unfurnished', construction: 'ready', amenities: [], img: '', image: '',
  gallery: [], desc: '', type: 'Flat', area: 1500, price: 8000000, createdAt: dISO(40), ...over,
});

async function seedAndLogin(page, login) {
  const db = { ...SEED_DB };
  db.listings = [
    liveListing({ id: 'STALE-LIVE-1', title: STALE_TITLE, freshenedAt: dISO(20) }),
    ...(SEED_DB.listings || []),
  ];
  // Registered before any navigation, so the seed is in place for the login redirect too.
  await page.addInitScript(([key, value]) => {
    localStorage.setItem(key, value);
    localStorage.setItem('puneNest_conciergeSeeded_v1', '1');
  }, ['puneNestDB_v5', JSON.stringify(db)]);

  await login.asAdmin();
  await page.goto('/admin/properties');
  // Replaces `waitForTimeout(1200)`: the tab strip is the page's own "I have rendered" signal.
  await expect(page.getByRole('tab', { name: 'Needs Follow-up' })).toBeVisible();
}

async function openUnconfirmed(page) {
  await page.getByRole('tab', { name: 'Needs Follow-up' }).click();
  await page.locator('[aria-label="Filter by reason"]').click();
  const option = page.locator('.pn-dropdown__option', { hasText: 'Unconfirmed (stale)' });
  await expect(option).toBeVisible();
  await option.click();
  await expect(page.locator('.pn-dropdown__option')).toHaveCount(0);
  // The demo seed also contains unconfirmed listings, so narrow to ours before asserting counts.
  await page.getByPlaceholder(/Search title/).fill(STALE_TITLE);
}

test('Unconfirmed (stale) sub-filter lists unconfirmed live listings', async ({ page, login }) => {
  await seedAndLogin(page, login);
  await openUnconfirmed(page);
  await expect(page.getByText(STALE_TITLE)).toBeVisible();
  await expect(page.getByText(/haven't confirmed availability/i)).toBeVisible();
});

test('admin can send a WhatsApp availability-confirmation reminder to the owner', async ({ page, login, consoleErrors }) => {
  await seedAndLogin(page, login);
  await openUnconfirmed(page);

  const remind = page.getByTitle('Send WhatsApp reminder to owner').first();
  await expect(remind).toBeVisible();
  await remind.click();
  /* "Chaser written", not "WhatsApp sent". The button used to compose the text in the browser and
     open wa.me itself, so the toast claimed a send that nothing had observed. It now asks the
     server to write the message into the outbound ledger and hands the staff member a link they
     still have to press send on -- and may edit, or close. The copy says so, and this asserts the
     honest wording rather than the old claim. */
  await expect(page.getByText(new RegExp(`Chaser written for ${STALE_OWNER}`, 'i'))).toBeVisible();
  expect(consoleErrors).toHaveLength(0);
});
