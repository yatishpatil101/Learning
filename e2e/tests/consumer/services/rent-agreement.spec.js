// @ts-check
import { test, expect } from '@playwright/test';

/*
 * Rent Agreement — the revenue-critical service. Covers the full owner submit,
 * that real uploaded documents reach the Ops queue, the owner↔tenant co-fill
 * maker-checker WhatsApp invite delivery, and the customer draft-approval
 * (checker) path.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const BUYER = { name: 'Anita Verma', mobile: '9811223344', email: '', role: 'buyer', joinedAt: Date.now() };
const ADMIN = { name: 'Ops Admin', mobile: '9800000001', email: '', role: 'admin', teams: ['rental', 'legal', 'interior', 'packers', 'valuation'], joinedAt: Date.now() };

const pad = (n) => String(n).padStart(2, '0');
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMDAQCb8v8AAAAASUVORK5CYII=', 'base64');

async function login(page, user) {
  await page.addInitScript((u) => {
    localStorage.setItem('puneNestUser', JSON.stringify(u));
    localStorage.setItem('puneNestUsers', JSON.stringify([u]));
  }, user);
}

const active = (page) => page.locator('.step-panel.active');
const clickNext = (page) => page.getByRole('button', { name: 'Next' }).click();

async function fillProperty(page) {
  const p = active(page);
  await p.getByPlaceholder('e.g. B-1204').fill('B-1204');
  await p.getByPlaceholder('e.g. Skyline Heights').fill('Skyline Heights');
  await p.getByPlaceholder('e.g. Baner').fill('Baner');
  await p.getByPlaceholder('411045').fill('411045');
  await clickNext(page);
}

async function fillOwner(page, { withDoc } = {}) {
  const p = active(page);
  await p.getByPlaceholder('As per PAN/Aadhaar').fill('Anita Verma');
  await p.getByPlaceholder('ABCDE1234F').fill('ABCDE1234F');
  await p.getByPlaceholder('12-digit Aadhaar').fill('123412341234');
  await p.getByPlaceholder('10-digit mobile').fill('9811223344');
  await p.getByPlaceholder('Full permanent address').fill('12, MG Road, Pune 411001');
  if (withDoc) {
    await p.locator('input[type="file"]').first().setInputFiles({ name: 'owner-pan.png', mimeType: 'image/png', buffer: PNG });
    await expect(p.getByText('owner-pan.png')).toBeVisible();
  }
  await clickNext(page);
}

async function fillTenant(page) {
  const p = active(page);
  await p.getByPlaceholder('As per PAN/Aadhaar').fill('Rahul Nair');
  await p.getByPlaceholder('ABCDE1234F').fill('PQRSX6789K');
  await p.getByPlaceholder('12-digit Aadhaar').fill('999988887777');
  await p.getByPlaceholder('10-digit mobile').fill('9822334455');
  await p.getByPlaceholder('Full permanent address').fill('44, FC Road, Pune 411004');
  await clickNext(page);
}

async function fillTerms(page) {
  const p = active(page);
  await p.locator('.pn-datefield').click();
  await page.locator('.pn-cal').waitFor({ state: 'visible' });
  const day = page.getByRole('button', { name: todayIso(), exact: true }).first();
  await day.click();
  await page.locator('.pn-cal').waitFor({ state: 'detached' });
  await p.getByPlaceholder('e.g. 25000').fill('30000');
  await p.getByPlaceholder('e.g. 100000').fill('150000');
  await clickNext(page);
}

async function submitFromReview(page) {
  await clickNext(page); // witnesses -> review
  const review = active(page);
  await review.getByRole('checkbox').check();
  await review.getByRole('button', { name: /Generate Agreement & Proceed/ }).click();
}

test.describe('Rent Agreement — revenue flow', () => {
  test('owner submits full flow; uploaded documents reach the Ops queue', async ({ page }) => {
    /* The longest journey in the suite: four wizard steps with a file upload, a
       review submit, then a re-login as admin and a queue lookup. It runs in ~22s
       alone but exceeds the 30s default under parallel contention, so the timeout
       fires mid-flow and reads as a product bug. Triple it rather than trimming
       the flow — the cross-actor handoff is the point of the test. */
    test.slow();
    await login(page, BUYER);
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });

    await fillProperty(page);
    await fillOwner(page, { withDoc: true });
    await fillTenant(page);
    await fillTerms(page);
    await submitFromReview(page);

    await expect(page.getByText('Request submitted!')).toBeVisible();

    // Ops (admin) sees the request and the REAL uploaded document, not a placeholder.
    await login(page, ADMIN);
    await page.goto(`${BASE}/ops/rent-agreement`, { waitUntil: 'networkidle' });
    /* `Table` renders a desktop <table> AND a hidden `.pn-card` stack for phones,
       so `.first()` on an unscoped locator resolves to the hidden mobile card and
       never becomes visible. Scope to the table — this spec runs on desktop. */
    const queueRow = page.getByRole('table').locator('tr').filter({ hasText: 'Anita Verma' }).first();
    await expect(queueRow).toBeVisible({ timeout: 10000 });
    await queueRow.click();
    await expect(page.getByText('Owner — PAN Card')).toBeVisible();
    // The Ops→customer WhatsApp notify action is available.
    await expect(page.getByRole('button', { name: /WhatsApp/ })).toBeVisible();
  });

  test('co-fill invite is delivered to the tenant on WhatsApp with a deep link', async ({ page }) => {
    await login(page, BUYER);
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });

    await fillProperty(page);
    await fillOwner(page);

    // Step 3 — choose "Invite the tenant" and enter their mobile.
    await active(page).getByText('Invite the tenant', { exact: true }).click();
    await active(page).getByPlaceholder('10-digit mobile').fill('9822334455');
    await clickNext(page);

    await fillTerms(page);
    await submitFromReview(page);

    // The invited tenant now has a real delivery channel.
    const wa = page.getByRole('link', { name: /Send invite on WhatsApp/ });
    await expect(wa).toBeVisible();
    const href = await wa.getAttribute('href');
    expect(href).toContain('wa.me/91');
    expect(decodeURIComponent(href || '')).toContain('/services/rent-agreement?invite=');
    await expect(page.getByRole('button', { name: /Copy invite link/ })).toBeVisible();

    // The Tenant step stays PENDING (amber, not a green check) until the tenant fills it.
    const tenantDot = page.locator('.step-dot').nth(2);
    await expect(tenantDot).toHaveClass(/pending/);
    await expect(tenantDot).not.toHaveClass(/done/);
  });

  test('mandatory document fields carry the app-standard required marker', async ({ page }) => {
    await login(page, BUYER);
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await fillProperty(page);

    // Owner KYC + ownership docs are visibly required (red asterisk via .req).
    const p = active(page);
    for (const doc of ['PAN Card', 'Aadhaar Card', 'Passport Photo', 'Ownership Proof']) {
      await expect(p.locator('label span.req').filter({ hasText: doc })).toBeVisible();
    }
  });

  test('customer (checker) can approve the draft our team shares', async ({ page }) => {
    await login(page, BUYER);
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });

    await page.getByRole('button', { name: /Preview with a sample draft/ }).click();
    await page.getByRole('button', { name: /^Approve$/ }).click();
    await expect(page.getByText('Approved — awaiting registration')).toBeVisible({ timeout: 10000 });
  });

  test('mandatory docs are reused from — and saved back to — the dashboard Document vault', async ({ page }) => {
    const DATA_URL = 'data:image/png;base64,' + PNG.toString('base64');
    await login(page, BUYER);
    // Seed the personal Document vault with an existing PAN card, as if the owner had
    // already saved it under Dashboard → Documents → Personal.
    await page.addInitScript(({ mobile, dataUrl }) => {
      localStorage.setItem('puneNestDocs:' + mobile, JSON.stringify({
        personal: [{ id: 'd1', category: 'PAN Card', name: 'my-saved-pan.png', size: 100, mime: 'image/png', dataUrl, uploadedAt: Date.now() }],
      }));
    }, { mobile: BUYER.mobile, dataUrl: DATA_URL });

    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await fillProperty(page);

    const p = active(page);
    // PAN slot is prefilled from the vault and clearly marked as reused.
    await expect(p.getByText('my-saved-pan.png')).toBeVisible();
    await expect(p.getByText('From your Documents')).toBeVisible();

    // Uploading a fresh Aadhaar here saves it back to the vault (kept for reuse).
    await p.locator('input[type="file"]').nth(1).setInputFiles({ name: 'my-aadhaar.png', mimeType: 'image/png', buffer: PNG });
    await expect(p.getByText('my-aadhaar.png')).toBeVisible();
    await expect(p.getByText('Saved to your Documents')).toBeVisible();

    const saved = await page.evaluate((mobile) => JSON.parse(localStorage.getItem('puneNestDocs:' + mobile)).personal.map((d) => d.category), BUYER.mobile);
    expect(saved).toContain('Aadhaar Card');
    expect(saved).toContain('PAN Card');
  });

  test('platform service fee is driven by the admin Fees panel, not hardcoded', async ({ page }) => {    await login(page, BUYER);
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });

    // Admin edits "Rent Agreement Platform" in Settings → Fees (persisted to the admin DB).
    await page.evaluate(() => {
      const db = JSON.parse(localStorage.getItem('puneNestDB_v5'));
      db.settings.fees.rentAgreementPlatform = 777;
      localStorage.setItem('puneNestDB_v5', JSON.stringify(db));
    });
    await page.reload({ waitUntil: 'networkidle' });

    // Cost estimate must reflect the admin value: service ₹777 + statutory urban reg ₹1,000 = ₹1,777.
    // The desktop sidebar (visible at this viewport) renders after the mobile summary in the DOM.
    await expect(page.getByText('₹777').last()).toBeVisible();
    await expect(page.getByText('₹1,777').last()).toBeVisible();
  });

  test('partial answers survive a mid-fill refresh', async ({ page }) => {
    await login(page, BUYER);
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });

    const p = active(page);
    await p.getByPlaceholder('e.g. B-1204').fill('B-1204');
    await p.getByPlaceholder('e.g. Skyline Heights').fill('Skyline Heights');
    await p.getByPlaceholder('e.g. Baner').fill('Baner');
    await p.getByPlaceholder('411045').fill('411045');
    await clickNext(page); // -> owner step
    await expect(active(page).getByPlaceholder('As per PAN/Aadhaar')).toBeVisible();
    await page.waitForTimeout(700); // let the debounced draft save land

    await page.reload({ waitUntil: 'networkidle' });

    // The draft is restored: the banner shows and we're back on the OWNER step (step
    // was persisted), not reset to step 0.
    await expect(page.getByText('We saved your progress')).toBeVisible();
    await expect(active(page).getByPlaceholder('As per PAN/Aadhaar')).toBeVisible();

    // …and the earlier property answers are intact.
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(active(page).getByPlaceholder('e.g. Skyline Heights')).toHaveValue('Skyline Heights');
  });

  test('signed-out invitee is bounced to a prefilled sign-in', async ({ page }) => {
    // Seed a pending invite as if an owner had sent it to this tenant number.
    await page.addInitScript(() => {
      localStorage.setItem('puneNestRAInvite:9822334455', JSON.stringify([{
        inviteId: 'INVTESTXYZ', reqMobile: '9811223344', reqId: 'SR1',
        toMobile: '9822334455', toName: 'Rahul', toRole: 'tenant', status: 'pending',
        createdAt: Date.now(), fromName: 'Anita Verma', property: 'B-1204, Skyline Heights',
      }]));
    });
    await page.goto(`${BASE}/services/rent-agreement?invite=INVTESTXYZ`, { waitUntil: 'networkidle' });

    // Not signed in → we send them to sign in with the invited number, then back here.
    await expect(page).toHaveURL(/\/signin/);
    await expect(page).toHaveURL(/reason=invite/);
    await expect(page).toHaveURL(/mobile=9822334455/);
    await expect(page.getByText('Sign in to complete your Rent Agreement')).toBeVisible();
  });

  test('witnesses step is optional and flags biometric attendance', async ({ page }) => {
    await login(page, BUYER);
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await fillProperty(page);
    await fillOwner(page);
    await fillTenant(page);
    await fillTerms(page); // -> witnesses step

    const w = active(page);
    await expect(w.getByText('Optional')).toBeVisible();
    await expect(w.getByText(/physically present/)).toBeVisible();

    // Optional means the owner can reach Review & submit without entering witnesses.
    await clickNext(page);
    await expect(active(page).getByRole('button', { name: /Generate Agreement & Proceed/ })).toBeVisible();
  });

  test('invited tenant: request surfaces in My Rental first, and only the Tenant tab is editable', async ({ page }) => {
    // Another full wizard run plus a second-actor login — same 30s ceiling as the
    // Ops-queue test above; it only exceeds it under parallel contention.
    test.slow();
    await login(page, BUYER);
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await fillProperty(page);
    await fillOwner(page);
    await active(page).getByText('Invite the tenant', { exact: true }).click();
    await active(page).getByPlaceholder('10-digit mobile').fill('9822334455');
    await clickNext(page);
    await fillTerms(page);
    await submitFromReview(page);

    // The owner's invite link carries the bearer token we route the tenant through.
    const href = await page.getByRole('link', { name: /Send invite on WhatsApp/ }).getAttribute('href');
    const inviteId = decodeURIComponent(href || '').match(/invite=([^&\s]+)/)?.[1];
    expect(inviteId).toBeTruthy();

    // The invited tenant signs in (same browser context — the invite + request the
    // owner just created are already in localStorage).
    const TENANT = { name: 'Rahul Nair', mobile: '9822334455', email: '', role: 'buyer', joinedAt: Date.now() };
    await login(page, TENANT);

    // 1) The request appears in "My Rental" first, with a route into the fill page.
    await page.goto(`${BASE}/dashboard#rental`, { waitUntil: 'networkidle' });
    await expect(page.getByText('Action needed: complete your rent agreement')).toBeVisible();
    const fill = page.getByRole('link', { name: /Fill my details/ });
    await expect(fill).toBeVisible();
    await fill.click();

    // 2) …which routes to the rent-agreement page for exactly this invite.
    await expect(page).toHaveURL(new RegExp('invite=' + inviteId));

    // 3) The owner's Property step is view-only for the tenant (inputs disabled).
    await expect(page.getByText('Set up by the owner — view only')).toBeVisible();
    await expect(active(page).getByPlaceholder('e.g. Skyline Heights')).toBeDisabled();

    // 4) The Tenant step is the one section they can edit.
    await clickNext(page); // Property → Owner (still read-only)
    await clickNext(page); // Owner → Tenant
    await expect(page.getByText('Your details — please complete this step')).toBeVisible();
    await expect(active(page).getByPlaceholder('As per PAN/Aadhaar')).toBeEnabled();
  });

  test('after submitting, the owner sees a locked panel — not an editable wizard — and can start a new agreement', async ({ page }) => {
    await login(page, BUYER);
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });

    await fillProperty(page);
    await fillOwner(page);
    await fillTenant(page);
    await fillTerms(page);
    await submitFromReview(page);
    await expect(page.getByText('Request submitted!')).toBeVisible();

    // Revisiting the page must not re-open the editable wizard for an active request.
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await expect(page.getByText('Your request is already submitted')).toBeVisible();
    await expect(page.getByPlaceholder('e.g. Skyline Heights')).toHaveCount(0);

    // Starting a new agreement reveals a fresh, blank wizard for a different property.
    await page.getByRole('button', { name: /Start a new agreement/ }).click();
    const propInput = active(page).getByPlaceholder('e.g. Skyline Heights');
    await expect(propInput).toBeVisible();
    await expect(propInput).toHaveValue('');
  });

  test('sharing a draft raises a dashboard bell notification for the customer', async ({ page }) => {
    await login(page, BUYER);
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });

    // Loading the sample shares a draft with the customer (the maker→checker handoff).
    await page.getByRole('button', { name: /Preview with a sample draft/ }).click();
    await expect(page.getByText('Draft ready for your review')).toBeVisible({ timeout: 10000 });

    // The customer is actively pinged in-app so a shared draft never silently stalls.
    const notif = await page.evaluate((mobile) => {
      const list = JSON.parse(localStorage.getItem('pnNotifications:' + mobile) || '[]');
      return list.find((n) => n && typeof n.id === 'string' && n.id.startsWith('svc_draft_')) || null;
    }, BUYER.mobile);
    expect(notif).toBeTruthy();
    expect(notif.link).toContain('/services/rent-agreement');
    expect(notif.read).toBe(false);
  });

  test('request-changes uses an on-brand modal (not window.prompt) and records the note', async ({ page }) => {
    await login(page, BUYER);
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });

    await page.getByRole('button', { name: /Preview with a sample draft/ }).click();
    await page.getByRole('button', { name: /Request changes/ }).click();

    // An in-app dialog opens — no native prompt — and Send is gated on a real note.
    const dialog = page.getByRole('dialog', { name: 'Request changes' });
    await expect(dialog).toBeVisible();
    const send = dialog.getByRole('button', { name: /Send request/ });
    await expect(send).toBeDisabled();
    await dialog.getByRole('textbox').fill('Please correct the monthly rent to ₹32,000.');
    await expect(send).toBeEnabled();
    await send.click();

    // The request transitions to "Changes requested" and the note reaches the flow.
    await expect(page.getByText('Changes requested')).toBeVisible({ timeout: 10000 });
    const noted = await page.evaluate((mobile) => {
      const list = JSON.parse(localStorage.getItem('puneNestServiceReq:' + mobile) || '[]');
      return list.some((r) => (r.messages || []).some((x) => /monthly rent to ₹32,000/.test(x.text || '')));
    }, BUYER.mobile);
    expect(noted).toBe(true);
  });

  test('admin service ticket status follows the ops workflow (no phantom "new" backlog)', async ({ page }) => {
    await login(page, BUYER);
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });

    await fillProperty(page);
    await fillOwner(page, { withDoc: true });
    await fillTenant(page);
    await fillTerms(page);
    await submitFromReview(page);
    await expect(page.getByText('Request submitted!')).toBeVisible();

    // At submit the admin lead ticket exists and is linked to the flow request via `ref`.
    const created = await page.evaluate(() => {
      const db = JSON.parse(localStorage.getItem('puneNestDB_v5'));
      return (db.tickets || []).find((t) => t.ref && t.team === 'rental') || null;
    });
    expect(created).toBeTruthy();
    expect(created.status).toBe('new');

    // Ops verifies the documents — the linked admin ticket must move off "new".
    await login(page, ADMIN);
    await page.goto(`${BASE}/ops/rent-agreement`, { waitUntil: 'networkidle' });
    await page.locator('tr', { hasText: 'Anita Verma' }).first().click();
    await page.getByRole('button', { name: /Mark all verified/ }).click();
    await expect(page.getByText('Documents verified')).toBeVisible({ timeout: 10000 });

    await expect.poll(async () => page.evaluate((ref) => {
      const db = JSON.parse(localStorage.getItem('puneNestDB_v5'));
      return (db.tickets || []).find((t) => t.ref === ref)?.status;
    }, created.ref)).toBe('in_progress');
  });
});
