import { test, expect } from '../fixtures/base.js';

/* Ops Property & Legal desk — OpsServiceQueue type="legal" (App.jsx
   /ops/legal behind TeamRoute team="legal"). A DEEP spec driving the maker-checker
   document chain, verified against OpsServiceQueue.jsx (SVC_CONFIG.legal),
   serviceFlow.js and docs/flows/ops/service-queues.md §6-7:

     submitted → docs_review → draft_shared (Legal opinion, maker=staff)
                 → approved (checker=customer) → registration → completed

   serviceFlow.seedService('legal') seeds two requests:
     - Nikhil Patil → "docs_review"
     - Meera Iyer   → "submitted"

   ops-requests.spec.js already covers the SHALLOW Rental→legal team-guard block;
   this file goes into the workflow (verify → share opinion → submit registration
   → upload final) with each button's toast + resulting status. */

async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'pn_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });
}

/* Customer approval is consumer-side, so no legal request is seeded "approved".
   Inject one into the engine's localStorage store so we can exercise the
   staff-only submitRegistration → uploadFinal transitions. seedDemo bails when a
   request key already exists, so this becomes the only legal row. */
async function seedApprovedLegal(page) {
  await page.addInitScript(() => {
    const now = Date.now();
    const rec = [{
      id: 'SR_TEST_APPROVED_LEGAL',
      type: 'legal', service: 'Property & Legal', status: 'approved',
      customer: { name: 'Approved Advocate', mobile: '9800000008' },
      details: { service: 'Sale Deed Drafting & Registration', role: 'Seller', location: 'Kothrud, Pune', property: 'Flat 9, Legal Heights, Kothrud', buyer: 'Test Buyer', value: 8500000, area: '1400 sq.ft', purpose: 'Sale registration' },
      docs: [],
      draft: { fileName: 'Legal-Opinion-v1.pdf', dataUrl: '', sharedAt: now, version: 1 },
      draftDecision: { type: 'accepted', note: '', at: now },
      finalDoc: null, messages: [], timeline: [], ticketRef: null,
      assignedTo: null, createdAt: now, updatedAt: now,
    }];
    localStorage.setItem('puneNestServiceReq:9800000008', JSON.stringify(rec));
  });
}

async function shareFile(page, trigger, file) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    trigger.click(),
  ]);
  await chooser.setFiles(file);
}

const PDF = { name: 'legal-opinion.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% PuneNest test legal opinion') };

test('Property & Legal staff land on their desk with the queue tiles, search and seeded rows', async ({ page, login, consoleErrors }) => {
  await login.asStaff('Legal');              // quick login → /ops/legal
  await expect(page).toHaveURL(/\/ops\/legal/);

  // OpsServiceQueue type="legal" → SVC_CONFIG.legal.title/subtitle.
  await expect(page.getByRole('heading', { name: 'Property & Legal' })).toBeVisible();
  await expect(page.getByText('Title checks, due-diligence & registration support')).toBeVisible();
  await expect(page.getByRole('button', { name: /Needs action/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Completed/i })).toBeVisible();
  await expect(page.getByPlaceholder(/Search customer/i)).toBeVisible();
  /* Seeded demo rows are present. Scoped to the table because OpsServiceQueue now
     also renders an `sm:hidden` stacked card per row (field staff work this queue
     from a phone) — both copies sit in the DOM at every width. */
  const table = page.getByRole('table');
  await expect(table.getByText('Nikhil Patil')).toBeVisible();
  await expect(table.getByText('Meera Iyer')).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('the maker chain: verify documents then share a legal opinion moves a request to "draft shared"', async ({ page, login }) => {
  await seedConsent(page);
  await login.asStaff('Legal');
  await page.goto('/ops/legal');

  // Open Meera Iyer's request (seeded at "submitted").
  await page.getByRole('row').filter({ hasText: 'Meera Iyer' }).getByRole('button', { name: 'Open' }).click();
  const dialog = page.getByRole('dialog', { name: /Meera Iyer/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Request submitted').first()).toBeVisible();

  // Step 1 — "Mark all verified" (markDocsVerified): submitted → docs_review + toast.
  await dialog.getByRole('button', { name: /Mark all verified/i }).click();
  await expect(page.getByText('Documents verified', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Documents under review').first()).toBeVisible();

  // Step 2 — staff (maker) shares the legal opinion (shareDraft): → draft_shared + toast.
  await shareFile(page, dialog.getByRole('button', { name: /Upload.*share legal opinion/i }), PDF);
  await expect(page.getByText('Shared with customer', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Draft shared for your review').first()).toBeVisible();
});

test('an approved legal request is submitted for registration and completed with the final document', async ({ page, login }) => {
  // Customer (checker) already approved on the consumer side; staff drive the rest.
  await seedConsent(page);
  await seedApprovedLegal(page);
  await login.asStaff('Legal');
  await page.goto('/ops/legal');

  await page.getByRole('row').filter({ hasText: 'Approved Advocate' }).getByRole('button', { name: 'Open' }).click();
  const dialog = page.getByRole('dialog', { name: /Approved Advocate/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Draft approved/i).first()).toBeVisible();

  // submitRegistration: approved → registration + toast.
  await dialog.getByRole('button', { name: /Submit for registration/i }).click();
  await expect(page.getByRole('alert').getByText('Updated', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Submitted for government registration').first()).toBeVisible();

  // uploadFinal: registration → completed, attaches the registered document + toast.
  await shareFile(page, dialog.getByRole('button', { name: /Upload registered/i }), PDF);
  await expect(page.getByText('Final document uploaded — customer notified', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/Registered.*ready to download/i).first()).toBeVisible();
  await expect(dialog.getByText('Final document', { exact: true })).toBeVisible();
});

test('TeamRoute blocks a Packers staffer from the Property & Legal desk', async ({ page, login }) => {
  await login.asStaff('Packers');
  await page.goto('/ops/legal');

  // TeamRoute → /ops?denied=legal; the dashboard shows the denied banner.
  await expect(page).toHaveURL(/\/ops\?denied=legal/);
  const banner = page.getByRole('alert').filter({ hasText: /don't have access/i });
  await expect(banner).toBeVisible();
  await expect(banner.getByText('Property & Legal')).toBeVisible();
  // The legal queue heading must NOT have rendered.
  await expect(page.getByRole('heading', { name: 'Property & Legal', exact: true })).toHaveCount(0);
});

test('an unauthenticated visitor is redirected from /ops/legal to staff-login', async ({ page }) => {
  await page.goto('/ops/legal');

  // RoleRoute → Navigate to /staff-login (no ops content rendered).
  await expect(page).toHaveURL(/\/staff-login/);
  await expect(page.getByRole('button', { name: 'Legal', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Property & Legal', exact: true })).toHaveCount(0);
});

test('the queue shows an empty state when a search matches nothing', async ({ page, login }) => {
  await login.asStaff('Legal');
  await page.goto('/ops/legal');
  await expect(page.getByRole('heading', { name: 'Property & Legal' })).toBeVisible();

  await page.getByPlaceholder(/Search customer/i).fill('zzz-no-such-request');
  await expect(page.getByRole('table').getByText('No Property & Legal requests')).toBeVisible();
  // Unscoped on purpose: a filtered-out request must leave neither the table row
  // nor its card twin behind.
  await expect(page.getByText('Nikhil Patil')).toHaveCount(0);
});
