import { test, expect } from '@playwright/test';

/* Anti-broker guardrails. Trust is the product, so one identity can only host a
   capped number of live flat-shares (owner-verified posts are exempt), the same
   host can't list the same physical flat twice, and a different host claiming an
   address already claimed still posts but is flagged for the Ops review queue. */

const BASE = 'http://localhost:5173';
const MOBILE = '9812345678';
const OTHER = '9800000000';

function seedScript(mobile, groups) {
  return (args) => {
    const [m, g] = args;
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Guardrail Host', mobile: m, role: 'owner', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + m, JSON.stringify({ verified: true, aadhaarMobile: m, at: Date.now() }));
    if (g) localStorage.setItem('puneNestShareGroups', JSON.stringify(g));
  };
}

function activeGroup(id, title, ownerMobile, extra = {}) {
  return { id, title, locality: 'Baner', policy: 'any', rent: 45000, seatsTotal: 3, seatsOpen: 1, members: [{ name: 'Guardrail Host', initials: 'GH', verified: true }], tags: [], note: '', time: 'Just now', createdAt: Date.now(), ownerMobile, ownerName: 'Guardrail Host', hostRole: 'tenant', verificationTier: 'identity', ...extra };
}

async function openCreate(page) {
  await page.goto(`${BASE}/share-flat?view=groups`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /Create a group/i }).click();
}

async function fillGroup(page, title, { locality } = {}) {
  await page.getByPlaceholder(/2 girls/i).fill(title);
  await page.getByPlaceholder(/e\.g\. 34000/i).fill('45000');
  await page.locator('input[type="number"]').nth(1).fill('3'); // People sharing
  await page.locator('input[type="number"]').nth(2).fill('1'); // Seats open now
  await page.getByPlaceholder(/Your name/i).fill('Guardrail Host');
  if (locality) await page.getByRole('button', { name: /Attach a verified property/i }).catch(() => {});
}

test('per-identity cap: a 4th live share is blocked for a non-owner host', async ({ page }) => {
  const seeded = [
    activeGroup('mgA', 'Cap seed one in Baner', MOBILE),
    activeGroup('mgB', 'Cap seed two in Baner', MOBILE),
    activeGroup('mgC', 'Cap seed three in Baner', MOBILE),
  ];
  await page.addInitScript(seedScript(MOBILE, seeded), [MOBILE, seeded]);
  await openCreate(page);
  const title = 'Cap fourth ZZZ in Baner';
  await fillGroup(page, title);
  await page.getByRole('button', { name: /Create group/i }).click();
  // Blocked: the cap toast shows and the 4th group is NOT created.
  await expect(page.getByText(/live flat-shares/i)).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.sf-card', { hasText: title })).toHaveCount(0);
});

test('address dedupe: the same host cannot list the same flat twice', async ({ page }) => {
  const title = 'Dedupe same flat in Baner';
  const seeded = [activeGroup('mgDup', title, MOBILE)];
  await page.addInitScript(seedScript(MOBILE, seeded), [MOBILE, seeded]);
  await openCreate(page);
  await fillGroup(page, title);
  await page.getByRole('button', { name: /Create group/i }).click();
  // Blocked: duplicate-address toast; still exactly one card with that title.
  await expect(page.getByText(/already have a live flat-share for this address/i)).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.sf-card', { hasText: title })).toHaveCount(1);
});

test('address dedupe: a DIFFERENT host claiming the same address still posts (flagged, not blocked)', async ({ page }) => {
  const title = 'Contested flat in Baner';
  const seeded = [activeGroup('mgOther', title, OTHER)];
  await page.addInitScript(seedScript(MOBILE, seeded), [MOBILE, seeded]);
  await openCreate(page);
  await fillGroup(page, title);
  await page.getByRole('button', { name: /Create group/i }).click();
  // Posts successfully: now two cards share the contested title (seed + new).
  await expect(page.locator('.sf-card', { hasText: title })).toHaveCount(2, { timeout: 5000 });
});
