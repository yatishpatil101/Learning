import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

/* Admin anti-staleness: when a LIVE listing goes unconfirmed (freshness stale/dormant),
   ops can surface it under Properties → Needs Follow-up → "Unconfirmed (stale)" and send
   the owner a WhatsApp nudge to confirm availability. */

const BASE = 'http://localhost:5173';

const SEED_DB = JSON.parse(readFileSync(new URL('../../../frontend/src/data/db.json', import.meta.url), 'utf-8'));
const dISO = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);

const liveListing = (over) => ({
  bhk: '2 BHK', bhkNum: 2, bath: 2, locality: 'Baner', localitySlug: 'baner',
  loc: 'Baner, Pune', deal: 'buy', owner: 'Stale Owner', ownerMobile: '9800022233',
  status: 'approved', real: true, featured: false, views: 5, enquiries: 1,
  furnishing: 'unfurnished', construction: 'ready', amenities: [], img: '', image: '',
  gallery: [], desc: '', type: 'Flat', area: 1500, price: 8000000, createdAt: dISO(40), ...over,
});

async function seedAndLogin(page) {
  const db = { ...SEED_DB };
  db.listings = [
    liveListing({ id: 'STALE-LIVE-1', title: 'Unconfirmed Stale Flat', freshenedAt: dISO(20) }),
    ...(SEED_DB.listings || []),
  ];
  await page.addInitScript(([key, value]) => {
    localStorage.setItem(key, value);
    localStorage.setItem('puneNest_conciergeSeeded_v1', '1');
  }, ['puneNestDB_v5', JSON.stringify(db)]);

  await page.goto(`${BASE}/staff-login`);
  await page.getByRole('button', { name: /Admin/i }).first().click();
  await page.waitForURL('**/admin');
  await page.goto(`${BASE}/admin/properties`);
  await page.waitForTimeout(1200);
}

async function openUnconfirmed(page) {
  await page.getByRole('tab', { name: 'Needs Follow-up' }).click();
  await page.waitForTimeout(400);
  await page.locator('[aria-label="Filter by reason"]').click();
  await page.waitForTimeout(200);
  await page.locator('.pn-dropdown__option', { hasText: 'Unconfirmed (stale)' }).click();
  await page.waitForTimeout(300);
  // Narrow to our seeded listing (demo seed data also contains unconfirmed listings).
  await page.getByPlaceholder(/Search title/).fill('Unconfirmed Stale Flat');
  await page.waitForTimeout(400);
}

test('Unconfirmed (stale) sub-filter lists unconfirmed live listings', async ({ page }) => {
  await seedAndLogin(page);
  await openUnconfirmed(page);
  await expect(page.getByText('Unconfirmed Stale Flat')).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/haven't confirmed availability/i)).toBeVisible();
});

test('admin can send a WhatsApp availability-confirmation reminder to the owner', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await seedAndLogin(page);
  await openUnconfirmed(page);

  const remind = page.getByTitle('Send WhatsApp reminder to owner').first();
  await expect(remind).toBeVisible({ timeout: 10000 });
  await remind.click();
  await expect(page.getByText(/WhatsApp sent to Stale Owner/i)).toBeVisible({ timeout: 10000 });
  expect(errors).toHaveLength(0);
});

