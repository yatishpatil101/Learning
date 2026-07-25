import { test, expect } from '../fixtures/base.js';

/* Ops Rent Agreement desk — OpsServiceQueue type="rental" (App.jsx
   /ops/rent-agreement behind TeamRoute team="rental"). This is a DEEP spec that
   drives the maker-checker document chain, verified against OpsServiceQueue.jsx
   (SVC_CONFIG.rental), serviceFlow.js and docs/flows/ops/service-queues.md §6-7:

     awaiting_party → submitted → docs_review → draft_shared
                       → approved → registration → completed

   Here the STAFF is the maker (shareDraft), the CUSTOMER is the checker
   (decideDraft, consumer-side → approved). serviceFlow.seedDemo() seeds three
   rental requests:
     - Rahul Deshpande → "docs_review"
     - Aarti Joshi     → "submitted"
     - Karan Mehta     → "registration" (already past the customer decision)

   ops-requests.spec.js already covers the SHALLOW render + Rental→legal guard;
   this file goes into the workflow (verify → share draft → submit registration
   → upload final) with each button's toast + resulting status. */

// The global cookie-consent banner is also a dialog; seed consent so it never
// overlays the queue or collides with the request-detail dialog lookup.
async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'pn_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });
}

/* The customer-approval step happens on the consumer side, so no rental request
   is seeded in the "approved" state. Inject one directly into the same
   localStorage store the engine reads (puneNestServiceReq:<mobile>) so we can
   exercise the staff-only submitRegistration → uploadFinal transitions. seedDemo
   bails when any request key already exists, so this becomes the only row. */
async function seedApprovedRental(page) {
  await page.addInitScript(() => {
    const now = Date.now();
    const rec = [{
      id: 'SR_TEST_APPROVED_RENTAL',
      type: 'rental', service: 'Rent Agreement', status: 'approved',
      customer: { name: 'Approved Tester', mobile: '9800000009' },
      details: { property: 'B-1500, Test Residency, Baner, Pune', ownerName: 'Approved Tester', tenants: 'Test Tenant', rent: 30000, deposit: 150000, months: '11', startDate: '2026-09-01' },
      docs: [],
      draft: { fileName: 'Draft-RentAgreement-v1.pdf', dataUrl: '', sharedAt: now, version: 1 },
      draftDecision: { type: 'accepted', note: '', at: now },
      finalDoc: null, messages: [], timeline: [], ticketRef: null,
      assignedTo: null, createdAt: now, updatedAt: now,
    }];
    localStorage.setItem('puneNestServiceReq:9800000009', JSON.stringify(rec));
  });
}

// Drive the component's hidden <input type="file"> via the native chooser that
// pickFile() opens with inp.click().
async function shareFile(page, trigger, file) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    trigger.click(),
  ]);
  await chooser.setFiles(file);
}

const PDF = { name: 'draft.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% PuneNest test draft') };

test('Rent Agreement staff land on their desk with the queue tiles, search and seeded rows', async ({ page, login, consoleErrors }) => {
  await login.asStaff('Rental');             // quick login → /ops/rent-agreement
  await expect(page).toHaveURL(/\/ops\/rent-agreement/);

  // OpsServiceQueue type="rental" → SVC_CONFIG.rental.title/subtitle.
  await expect(page.getByRole('heading', { name: 'Rent Agreement queue' })).toBeVisible();
  await expect(page.getByText('Drafting, e-stamp and doorstep delivery requests.')).toBeVisible();
  // Status-tile filters + the queue search box.
  await expect(page.getByRole('button', { name: /Needs action/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Completed/i })).toBeVisible();
  await expect(page.getByPlaceholder(/Search customer/i)).toBeVisible();
  // Seeded demo rows across the lifecycle are present.
  await expect(page.getByText('Rahul Deshpande')).toBeVisible();
  await expect(page.getByText('Aarti Joshi')).toBeVisible();
  await expect(page.getByText('Karan Mehta')).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('the maker chain: verify documents then share a draft moves a request to "draft shared"', async ({ page, login }) => {
  await seedConsent(page);
  await login.asStaff('Rental');
  await page.goto('/ops/rent-agreement');

  // Open Aarti Joshi's request (seeded at "submitted").
  await page.getByRole('row').filter({ hasText: 'Aarti Joshi' }).getByRole('button', { name: 'Open' }).click();
  const dialog = page.getByRole('dialog', { name: /Aarti Joshi/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Request submitted').first()).toBeVisible();

  // Step 1 — "Mark all verified" (markDocsVerified): submitted → docs_review + toast.
  await dialog.getByRole('button', { name: /Mark all verified/i }).click();
  await expect(page.getByText('Documents verified', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Documents under review').first()).toBeVisible();

  // Step 2 — staff (maker) shares a draft (shareDraft): → draft_shared + toast.
  await shareFile(page, dialog.getByRole('button', { name: /Upload.*share draft/i }), PDF);
  await expect(page.getByText('Shared with customer', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Draft shared for your review').first()).toBeVisible();
});

test('an approved request is submitted for registration and completed with the final document', async ({ page, login }) => {
  // The customer (checker) has already approved on the consumer side (decideDraft
  // → approved); staff now drive the two remaining transitions.
  await seedConsent(page);
  await seedApprovedRental(page);
  await login.asStaff('Rental');
  await page.goto('/ops/rent-agreement');

  await page.getByRole('row').filter({ hasText: 'Approved Tester' }).getByRole('button', { name: 'Open' }).click();
  const dialog = page.getByRole('dialog', { name: /Approved Tester/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Draft approved/i).first()).toBeVisible();

  // submitRegistration: approved → registration + toast.
  await dialog.getByRole('button', { name: /Submit for registration/i }).click();
  await expect(page.getByRole('alert').getByText('Updated', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Submitted for government registration').first()).toBeVisible();

  // uploadFinal: registration → completed, attaches the final doc + toast.
  await shareFile(page, dialog.getByRole('button', { name: /Upload registered/i }), PDF);
  await expect(page.getByText('Final document uploaded — customer notified', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/Registered.*ready to download/i).first()).toBeVisible();
  await expect(dialog.getByText('Final document', { exact: true })).toBeVisible();
});

test('TeamRoute blocks a Legal staffer from the Rent Agreement desk', async ({ page, login }) => {
  await login.asStaff('Legal');
  await page.goto('/ops/rent-agreement');

  // TeamRoute → /ops?denied=rental; the dashboard shows the denied banner.
  await expect(page).toHaveURL(/\/ops\?denied=rental/);
  const banner = page.getByRole('alert').filter({ hasText: /don't have access/i });
  await expect(banner).toBeVisible();
  await expect(banner.getByText('Rent Agreement')).toBeVisible();
  // The rental queue heading must NOT have rendered.
  await expect(page.getByRole('heading', { name: 'Rent Agreement queue' })).toHaveCount(0);
});

test('an unauthenticated visitor is redirected from /ops/rent-agreement to staff-login', async ({ page }) => {
  await page.goto('/ops/rent-agreement');

  // RoleRoute → Navigate to /staff-login (no ops content rendered).
  await expect(page).toHaveURL(/\/staff-login/);
  await expect(page.getByRole('button', { name: 'Rental', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Rent Agreement queue' })).toHaveCount(0);
});

test('the queue shows an empty state when a search matches nothing', async ({ page, login }) => {
  await login.asStaff('Rental');
  await page.goto('/ops/rent-agreement');
  await expect(page.getByRole('heading', { name: 'Rent Agreement queue' })).toBeVisible();

  await page.getByPlaceholder(/Search customer/i).fill('zzz-no-such-request');
  await expect(page.getByText('No Rent Agreement queue requests')).toBeVisible();
  await expect(page.getByText('Aarti Joshi')).toHaveCount(0);
});
