import { test, expect } from '../../fixtures/base.js';

/* Rent Agreement ops on a phone — review §H Q7, answered: this team works in the
   field, standing in front of the customer.

   The rest of the back-office is desktop-first by design (§B.8) and stays that
   way. What is in scope here is the one flow that genuinely happens away from a
   desk: pull up a request and verify the customer's documents. Those controls
   were 26px icon buttons whose only labels were `title=` tooltips — which never
   fire on touch — so the action was both mis-tappable and unnamed.

   Runs under `mobile` (412x915) and `mobile-small` (360x640). */

const MIN_TAP = 44;

/* boundingBox() returns a float, and under full-suite load Chromium has handed back
   43.99993896484375 (= 44 - 2^-14) for a control whose CSS floor is exactly 44px --
   a measurement artifact, not a layout regression. The same half-pixel slack is
   already used in phase3.spec.js. It cannot mask the regression this file guards,
   which is 26px icon buttons. */
const TAP_EPSILON = 0.5;

/* seedDemo() bails once any request key exists, so injecting our own row makes it
   the only one and keeps the assertions deterministic. Mirrors the helper in
   ops-rent-agreement.spec.js. */
async function seedDocsRental(page) {
  await page.addInitScript(() => {
    const now = Date.now();
    const rec = [{
      id: 'SR_TEST_MOBILE_DOCS',
      type: 'rental', service: 'Rent Agreement', status: 'docs_review',
      customer: { name: 'Field Tester', mobile: '9800000009' },
      details: { property: 'B-1500, Test Residency, Baner, Pune', ownerName: 'Field Tester', tenants: 'Test Tenant', rent: 30000, deposit: 150000, months: '11', startDate: '2026-09-01' },
      docs: [
        { id: 'd1', name: 'Owner Aadhaar', status: 'submitted', file: { fileName: 'aadhaar.jpg', mime: 'image/jpeg', dataUrl: '' } },
        { id: 'd2', name: 'Tenant Aadhaar', status: 'submitted', file: { fileName: 'tenant.jpg', mime: 'image/jpeg', dataUrl: '' } },
      ],
      draft: null, finalDoc: null, messages: [], timeline: [], ticketRef: null,
      assignedTo: null, createdAt: now, updatedAt: now,
    }];
    localStorage.setItem('puneNestServiceReq:9800000009', JSON.stringify(rec));
  });
}

test.describe('Rent Agreement ops in the field', () => {
  test('the queue falls back to stacked cards instead of a cut-off table', async ({ page, login }) => {
    await seedDocsRental(page);
    await login.asStaff('Rental');
    await expect(page).toHaveURL(/\/ops\/rent-agreement/);

    // Table.jsx renders the mobileCard branch below `sm` and hides the grid; a
    // queue with no card renderer would be a horizontally-clipped table here.
    await expect(page.locator('.sm\\:hidden').filter({ hasText: 'Field Tester' }).first()).toBeVisible();
    await expect(page.getByRole('table')).toBeHidden();
  });

  test('Open on a queue card clears the touch minimum', async ({ page, login }) => {
    await seedDocsRental(page);
    await login.asStaff('Rental');

    const open = page.getByRole('button', { name: /^Open$/ }).first();
    await expect(open).toBeVisible();
    const box = await open.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(MIN_TAP - TAP_EPSILON);
  });

  test('every document action is a real target, not a 26px icon', async ({ page, login }) => {
    // The regression this guards: verify/reject/view/note were `p-1.5` around a
    // 14px glyph. Rejecting a document by mis-tap is expensive — it bounces the
    // request back to the customer.
    await seedDocsRental(page);
    await login.asStaff('Rental');

    await page.getByRole('button', { name: /^Open$/ }).first().click();
    const verify = page.getByRole('button', { name: /^Verify Owner Aadhaar$/ });
    await verify.waitFor({ timeout: 10000 });

    for (const name of [/^View Owner Aadhaar$/, /^Verify Owner Aadhaar$/, /^Reject Owner Aadhaar$/, /^Add a note to Owner Aadhaar$/]) {
      const btn = page.getByRole('button', { name });
      const box = await btn.boundingBox();
      expect(box, `${name} is laid out`).not.toBeNull();
      expect(box.height, `${name} height`).toBeGreaterThanOrEqual(MIN_TAP - TAP_EPSILON);
      expect(box.width, `${name} width`).toBeGreaterThanOrEqual(MIN_TAP - TAP_EPSILON);
    }
  });

  test('document actions are named for a device that cannot hover', async ({ page, login }) => {
    // `title=` tooltips never fire on touch, so they were the only label on a
    // control with no visible text — i.e. an unlabelled button (§D.7).
    await seedDocsRental(page);
    await login.asStaff('Rental');
    await page.getByRole('button', { name: /^Open$/ }).first().click();
    await page.getByRole('button', { name: /^Verify Owner Aadhaar$/ }).waitFor({ timeout: 10000 });

    // Named per document, so the second row's controls are distinguishable from
    // the first's — otherwise a screen-reader user hears "Verify" four times.
    await expect(page.getByRole('button', { name: /^Verify Tenant Aadhaar$/ })).toBeVisible();
  });

  test('verifying a document from the phone actually sticks', async ({ page, login }) => {
    await seedDocsRental(page);
    await login.asStaff('Rental');
    await page.getByRole('button', { name: /^Open$/ }).first().click();

    const verify = page.getByRole('button', { name: /^Verify Owner Aadhaar$/ });
    await verify.waitFor({ timeout: 10000 });
    await verify.click();

    // The row's status pill flips, so the staffer gets confirmation without
    // having to reopen the record.
    await expect(page.getByText('Verified').first()).toBeVisible();
  });

  test('the detail sheet logs no console errors on a phone', async ({ page, login, consoleErrors }) => {
    await seedDocsRental(page);
    await login.asStaff('Rental');
    await page.getByRole('button', { name: /^Open$/ }).first().click();
    await page.getByRole('button', { name: /^Verify Owner Aadhaar$/ }).waitFor({ timeout: 10000 });
    expect(consoleErrors).toEqual([]);
  });
});
