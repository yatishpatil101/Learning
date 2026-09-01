import { test, expect } from '@playwright/test';
import { approveFlatmates, postAsGroup, switchToTeamUp } from '../../../helpers/app.js';

/* Anti-broker guardrails. Trust is the product, so one identity can only host a
   capped number of live flatmate posts (owner-verified posts are exempt), the same
   host can't list the same physical flat twice, and a different host claiming an
   address already claimed still posts but is flagged for the Ops review queue. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const MOBILE = '9812345678';
const OTHER = '9800000000';

function seedScript(mobile, groups) {
  return (args) => {
    const [m, g] = args;
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Guardrail Host', mobile: m, role: 'owner', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + m, JSON.stringify({ verified: true, aadhaarMobile: m, at: Date.now() }));
    /* Seed once, not on every navigation: an init script re-runs on each load, so
       an unconditional write would erase anything the test created before a
       reload — which is exactly what the contested-address case asserts on. */
    if (g && !localStorage.getItem('puneNestFlatmateGroups')) localStorage.setItem('puneNestFlatmateGroups', JSON.stringify(g));
  };
}

function activeGroup(id, title, ownerMobile, extra = {}) {
  return { id, title, locality: 'Baner', policy: 'any', rent: 45000, seatsTotal: 3, seatsOpen: 1, members: [{ name: 'Guardrail Host', initials: 'GH', verified: true }], tags: [], note: '', time: 'Just now', createdAt: Date.now(), ownerMobile, ownerName: 'Guardrail Host', hostRole: 'tenant', verificationTier: 'identity', ...extra };
}

async function openCreate(page) {
  await page.goto(`${BASE}/flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await postAsGroup(page);
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
  await expect(page.getByText(/live flatmate posts/i)).toBeVisible({ timeout: 5000 });
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
  await expect(page.getByText(/already have a live flatmate for this address/i)).toBeVisible({ timeout: 5000 });
  /* Dismiss the still-open create form before counting: it was BLOCKED, so the
     modal stays up and covers the tab strip. The seeded duplicate carries no
     address, so it lives on Team up (see tabOf() in flatmates/model.js). */
  await page.getByRole('button', { name: /^Cancel$/ }).click();
  await switchToTeamUp(page);
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
  // The new one is held for review (D72); the guardrail under test is the dedupe.
  await approveFlatmates(page, 'groups');
  await switchToTeamUp(page);
  await expect(page.locator('.sf-card', { hasText: title })).toHaveCount(2, { timeout: 5000 });
});

/* D71 — the cap the tests above enforce is only fair if the poster can relieve it.
   A live seeker post can be taken down ("Mark filled" or "Delete"), which is the
   operation the register said the platform lacked. Here we seed one live post,
   mark it filled, and assert the live-request banner clears — proof the take-down
   op runs end-to-end (mock seam here; the http `DELETE /flatmates/posts/{id}`
   round-trip is covered by the parity harness). */
function seekerSeedScript(mobile, posts) {
  return (args) => {
    const [m, p] = args;
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Seeker Sam', mobile: m, role: 'buyer', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + m, JSON.stringify({ verified: true, aadhaarMobile: m, at: Date.now() }));
    localStorage.setItem('puneNestFlatmatePosts', JSON.stringify(p));
  };
}

test('a live seeker post can be taken down, relieving the poster of their live-post cap (D71)', async ({ page }) => {
  const posts = [{
    id: 'sp-takedown-1', mobile: MOBILE, name: 'Seeker Sam', budget: 15000,
    localities: ['Baner'], gender: 'female', moveIn: 'now', flatPref: 'any',
    roomPref: 'any', tags: [], note: 'Quiet, non-smoker', time: 'Just now',
  }];
  await page.addInitScript(seekerSeedScript(MOBILE, posts), [MOBILE, posts]);
  await page.goto(`${BASE}/flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await switchToTeamUp(page);

  // The poster's own live-request banner is on the Team-up side, carrying the take-down controls.
  const banner = page.getByText('Your live request');
  await expect(banner).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: 'Mark filled' }).click();

  // The take-down ran: the confirmation toast shows and the live-request banner is gone, so the
  // poster is now under their cap and free to post again.
  await expect(page.getByText(/Marked as filled/)).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Your live request')).toHaveCount(0);
});
