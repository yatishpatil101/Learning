import { test, expect } from '@playwright/test';

// KYC-gated community contributions on the Society hub. Only Aadhaar-OTP verified
// members can add tips / local picks / photos or mark them Helpful. All state is
// localStorage (no backend). Society: the seeded verified "Skyline Heights, Baner".

const BASE = 'http://localhost:5173';
const SLUG = 'skyline-heights-baner';
const KYC_MOBILE = '9876543212';

// A 1x1 transparent PNG — a valid, tiny image the EvidenceUpload accepts.
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function seedUser(page, mobile) {
  await page.addInitScript((m) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Riya Sharma', mobile: m, role: 'owner', loginAt: Date.now() }));
  }, mobile);
}

async function seedKyc(page, mobile) {
  await seedUser(page, mobile);
  await page.addInitScript((m) => {
    localStorage.setItem('puneNestAadhaar:' + m, JSON.stringify({ verified: true, aadhaarMobile: m, at: Date.now() }));
  }, mobile);
}

async function seedContribs(page, slug, list) {
  await page.addInitScript(([s, arr]) => {
    localStorage.setItem('pnSocietyContributions', JSON.stringify({ [s]: arr }));
  }, [slug, list]);
}

async function gotoHub(page) {
  await page.goto(`${BASE}/society/${SLUG}?tab=community`);
  await expect(page.getByRole('heading', { level: 1, name: /Skyline Heights/i })).toBeVisible({ timeout: 8000 });
  await page.getByRole('heading', { name: 'Community insights' }).scrollIntoViewIfNeeded();
}

test('KYC-verified member can add a tip, a local pick and a photo — each shown with a Verified badge', async ({ page }) => {
  await seedKyc(page, KYC_MOBILE);
  await gotoHub(page);

  // Tip
  await page.getByRole('button', { name: 'Add tip' }).click();
  const tipDialog = page.getByRole('dialog', { name: /Add a community contribution/i });
  await expect(tipDialog).toBeVisible();
  await tipDialog.getByPlaceholder(/Water tanker fills/i).fill('Guest parking is behind D-wing, first come first served.');
  await tipDialog.getByRole('button', { name: 'Post to community' }).click();
  await expect(page.getByText('Guest parking is behind D-wing, first come first served.')).toBeVisible({ timeout: 8000 });

  // Local pick
  await page.getByRole('button', { name: 'Add local pick' }).click();
  const pickDialog = page.getByRole('dialog', { name: /Add a community contribution/i });
  await pickDialog.getByPlaceholder(/Person \/ service name/i).fill('Sunita — trusted maid');
  await pickDialog.getByPlaceholder(/^Phone/i).fill('9812345678');
  await pickDialog.getByRole('button', { name: 'Post to community' }).click();
  await expect(page.getByText('Sunita — trusted maid')).toBeVisible({ timeout: 8000 });

  // Photo
  await page.getByRole('button', { name: 'Add photo' }).click();
  const photoDialog = page.getByRole('dialog', { name: /Add a community contribution/i });
  await photoDialog.getByLabel('Upload a society photo').setInputFiles({
    name: 'entrance.png', mimeType: 'image/png', buffer: Buffer.from(PNG_BASE64, 'base64'),
  });
  await expect(photoDialog.getByText('entrance.png')).toBeVisible();
  await photoDialog.getByPlaceholder('Caption (optional)').fill('The main entrance at dusk');
  await photoDialog.getByRole('button', { name: 'Post to community' }).click();
  await expect(page.getByText('The main entrance at dusk')).toBeVisible({ timeout: 8000 });

  // Every contribution carries the author's Verified badge (non-resident KYC user).
  await expect(page.getByText('Verified', { exact: true }).first()).toBeVisible();
  expect(await page.getByText('Verified', { exact: true }).count()).toBe(3);

  // Persisted under the single contributions key.
  const store = await page.evaluate(() => JSON.parse(localStorage.getItem('pnSocietyContributions') || '{}'));
  expect(store[SLUG].length).toBe(3);
  expect(store[SLUG].map((c) => c.kind).sort()).toEqual(['photo', 'pick', 'tip']);
});

test('a logged-in member contributes directly — sign-in is the only floor (badge-not-gate)', async ({ page }) => {
  await seedUser(page, '9811111111'); // logged in, NOT Aadhaar-verified — still allowed
  await gotoHub(page);

  await page.getByRole('button', { name: 'Add tip' }).click();

  // Badge-not-gate (ADR-019): the contribution modal opens straight away and the
  // old Aadhaar identity wall never appears for a signed-in user.
  await expect(page.getByRole('dialog', { name: /Add a community contribution/i })).toBeVisible({ timeout: 8000 });
  await expect(page.getByRole('dialog', { name: /Verify your identity with Aadhaar/i })).toHaveCount(0);
});

test('filter chips narrow the feed, and Helpful toggles once per user and re-sorts most-helpful first', async ({ page }) => {
  const now = Date.now();
  await seedKyc(page, KYC_MOBILE);
  await seedContribs(page, SLUG, [
    { id: 'c-aaa', kind: 'tip', category: 'Water', text: 'AAA older tip about water timings', user: 'Neha', mobile: '9700000001', resident: false, at: now - 20000, helpful: [] },
    { id: 'c-bbb', kind: 'tip', category: 'Parking', text: 'BBB newer tip about parking', user: 'Amit', mobile: '9700000002', resident: false, at: now - 10000, helpful: [] },
    { id: 'c-pick', kind: 'pick', category: 'Maid', name: 'Meera the cook', user: 'Riya', mobile: '9700000003', resident: false, at: now - 5000, helpful: [] },
  ]);
  await gotoHub(page);

  const feed = page.locator('section', { has: page.getByRole('heading', { name: 'Community insights' }) });

  // All three visible under "All".
  await expect(feed.getByText('AAA older tip about water timings')).toBeVisible();
  await expect(feed.getByText('Meera the cook')).toBeVisible();

  // Filter → Tips hides the local pick.
  await feed.getByRole('button', { name: /^Tips \(2\)/ }).click();
  await expect(feed.getByText('Meera the cook')).toHaveCount(0);
  await expect(feed.getByText('BBB newer tip about parking')).toBeVisible();

  // Back to all, then Local picks (1).
  await feed.getByRole('button', { name: /^All \(3\)/ }).click();
  await feed.getByRole('button', { name: /^Local picks \(1\)/ }).click();
  await expect(feed.getByText('BBB newer tip about parking')).toHaveCount(0);
  await expect(feed.getByText('Meera the cook')).toBeVisible();

  // Newest-first by default: BBB (newer) sorts above AAA (older).
  await feed.getByRole('button', { name: /^All \(3\)/ }).click();
  const cards = feed.locator('div.glass.rounded-xl');
  await expect(cards.first()).toContainText('Meera the cook'); // newest overall

  // Mark AAA helpful → it jumps to the top (most-helpful first).
  const aaaCard = feed.locator('div.glass.rounded-xl', { hasText: 'AAA older tip about water timings' });
  await aaaCard.getByRole('button', { name: /Helpful/ }).click();
  await expect(feed.locator('div.glass.rounded-xl').first()).toContainText('AAA older tip about water timings');
  await expect(aaaCard.getByRole('button', { name: /Helpful \(1\)/ })).toBeVisible();

  // Toggling again removes the vote (once per user).
  await feed.locator('div.glass.rounded-xl', { hasText: 'AAA older tip about water timings' }).getByRole('button', { name: /Helpful/ }).click();
  await expect(feed.getByRole('button', { name: /Helpful \(1\)/ })).toHaveCount(0);
});

test('author can delete own contribution; a non-author sees no delete control on others', async ({ page }) => {
  const now = Date.now();
  await seedKyc(page, KYC_MOBILE);
  await seedContribs(page, SLUG, [
    { id: 'c-mine', kind: 'tip', category: 'Safety', text: 'MINE — gate closes at 11pm sharp', user: 'Riya Sharma', mobile: KYC_MOBILE, resident: false, at: now - 3000, helpful: [] },
    { id: 'c-theirs', kind: 'tip', category: 'General', text: 'THEIRS — clubhouse booking is on the app', user: 'Rahul', mobile: '9700000009', resident: false, at: now - 2000, helpful: [] },
  ]);
  await gotoHub(page);

  const feed = page.locator('section', { has: page.getByRole('heading', { name: 'Community insights' }) });
  const mine = feed.locator('div.glass.rounded-xl', { hasText: 'MINE — gate closes at 11pm sharp' });
  const theirs = feed.locator('div.glass.rounded-xl', { hasText: 'THEIRS — clubhouse booking is on the app' });

  // Only the author's own card shows the remove control.
  await expect(mine.getByRole('button', { name: 'Remove contribution' })).toBeVisible();
  await expect(theirs.getByRole('button', { name: 'Remove contribution' })).toHaveCount(0);

  // Deleting removes it from the feed and the store.
  await mine.getByRole('button', { name: 'Remove contribution' }).click();
  await expect(feed.getByText('MINE — gate closes at 11pm sharp')).toHaveCount(0);
  const store = await page.evaluate(() => JSON.parse(localStorage.getItem('pnSocietyContributions') || '{}'));
  expect(store[SLUG].map((c) => c.id)).toEqual(['c-theirs']);
});
