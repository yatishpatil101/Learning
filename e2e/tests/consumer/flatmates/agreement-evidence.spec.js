import { test, expect } from '@playwright/test';
import { approveFlatmates, postAsGroup, switchToTeamUp } from '../../../helpers/app.js';

/* Agreement evidence + Ops-gated badge (honest trust model). A tenant's
   "Tenant-verified" badge is EARNED, not self-claimed: it is withheld until the
   tenant uploads a registered rent agreement AND Ops approves that document.
   - Upload + post → card shows "Pending Ops review", no badge.
   - Declared without upload → identity tier, no review, no badge.

   ## Why the Ops half of this file is gone

   Two tests here used to drive `/ops/flatmate-review`: one approved the uploaded
   agreement and watched the badge appear, one seeded a review with no document and
   asserted the queue flagged it. Both seeded `puneNestFlatmateReviews` in
   localStorage and read `<tr>` rows out of the desk.

   That desk is now **live-only**. `OpsFlatmateReview.jsx:51` gates on
   `isHttpDomain('flatmate')` and, in a mock build, renders a notice instead of the
   boards. The localStorage store those tests wrote is not read by anything any more,
   so the rows they waited for cannot appear — the tests were not detecting a
   regression, they were asserting a page that was deliberately removed from this
   build.

   The assertions moved rather than being dropped: `live-flatmate-moderation.spec.js`
   covers the verification queue, the document view and the approve decision against
   the API, where all three are real. What remains here is the consumer half, which
   is where the actual product claim lives — the badge is withheld until somebody
   else grants it. That half never needed the desk to run, only to exist.

   Leaving two permanently-red tests in place would have been the worse option. A
   suite with standing failures teaches its readers to scroll past red, which is how
   the next genuine regression gets scrolled past too. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const TENANT = '9812345678';
const STAFF = '9900000009';

const PDF = { name: 'agreement.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 evidence test agreement') };

async function seedTenant(page) {
  await page.addInitScript((m) => {
    // Set once so a later becomeStaff() isn't overwritten when this init script
    // re-runs on subsequent navigations.
    if (!localStorage.getItem('puneNestUser')) localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Evidence Tenant', mobile: m, role: 'tenant', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + m, JSON.stringify({ verified: true, aadhaarMobile: m, at: Date.now() }));
  }, TENANT);
}

async function createTenantGroup(page, title, { upload = true } = {}) {
  await page.goto(`${BASE}/flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await postAsGroup(page);
  await page.getByPlaceholder(/2 girls/i).fill(title);
  await page.getByPlaceholder(/e\.g\. 34000/i).fill('42000');
  await page.getByPlaceholder(/Your name/i).fill('Evidence Tenant');
  await page.getByText(/registered rent agreement/i).click();
  if (upload) await page.getByLabel('Upload registered rent agreement for group').setInputFiles(PDF);
  await page.getByRole('button', { name: /Create group/i }).click();
  // The group is held for review (D72); this spec is about the badge, not the gate.
  await approveFlatmates(page, 'groups');
  await switchToTeamUp(page);
  await expect(page.locator('.sf-card', { hasText: title }).first()).toBeVisible({ timeout: 5000 });
}

// `becomeStaff` stood here: it swapped the stored user for a staff account so the
// Ops assertions could run. It went with them — nothing in this file drives the
// desk any more, and a helper kept "for when the test comes back" is a helper
// nobody notices has rotted.

test('tenant uploads → the badge is withheld pending Ops review, not granted on upload', async ({ page }) => {
  const title = 'Evidence approve flow in Baner';
  await seedTenant(page);
  await createTenantGroup(page, title, { upload: true });

  // The whole claim: uploading evidence is not the same as having it accepted.
  const pendingCard = page.locator('.sf-card', { hasText: title }).first();
  await expect(pendingCard.getByText(/Pending Ops review/i)).toBeVisible();
  await expect(pendingCard.getByText(/Tenant-verified/i)).toHaveCount(0);
});

test('tenant declares but uploads nothing → identity tier, no review, no badge', async ({ page }) => {
  const title = 'Evidence declare-only in Baner';
  await seedTenant(page);
  await createTenantGroup(page, title, { upload: false });
  const card = page.locator('.sf-card', { hasText: title }).first();
  await expect(card).toBeVisible({ timeout: 5000 });
  // No upload → identity tier: neither a badge nor a review chip.
  await expect(card.getByText(/Tenant-verified/i)).toHaveCount(0);
  await expect(card.getByText(/Pending Ops review/i)).toHaveCount(0);
});

/*
 * And the desk that would grant the badge says why it cannot, rather than showing
 * an empty queue.
 *
 * This is what keeps the two deletions above honest. "The Ops assertions moved to
 * the live suite" is a claim with nothing checking that the mock build behaves
 * defensibly in the meantime — and an always-empty queue is indistinguishable from
 * a cleared backlog, which is the exact failure `OpsFlatmateReview.jsx:65` names in
 * its own copy.
 */
test('the Ops flatmate desk says it needs the API rather than rendering an empty queue', async ({ page }) => {
  await page.addInitScript((m) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Ops Staff', mobile: m, role: 'staff', loginAt: Date.now() }));
  }, STAFF);
  await page.goto(`${BASE}/ops/flatmate-review`);
  await expect(page.getByText(/This desk needs the live API/i)).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.approve-review-btn')).toHaveCount(0);
});
