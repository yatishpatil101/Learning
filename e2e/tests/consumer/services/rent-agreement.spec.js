// @ts-check
import { test, expect } from '@playwright/test';
import { appReady } from '../../../helpers/app.js';

/*
 * Rent Agreement — the revenue-critical service. Covers the full owner submit,
 * that real uploaded documents reach the Ops queue, the owner↔tenant co-fill
 * maker-checker WhatsApp invite delivery, and the customer draft-approval
 * (checker) path.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

/* No ADMIN actor here any more: both tests that re-logged as one did so only to open
   `/ops/rent-agreement`, a desk that no longer exists. A consumer spec should not need
   a second role to prove a consumer flow. */
const BUYER = { name: 'Anita Verma', mobile: '9811223344', email: '', role: 'buyer', joinedAt: Date.now() };

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

/* Click Next, and prove the wizard actually moved.
 *
 * A Next that does not advance — validation refused it, or a full page reload rewound the
 * form to the last debounced autosave — leaves the wizard on the step it was already on.
 * Nothing here notices, because the Property, Owner and Tenant panels share every
 * placeholder (`As per PAN/Aadhaar`, `ABCDE1234F`, `10-digit mobile`, …): the next helper
 * happily types tenant answers into the owner panel, and the run only falls over several
 * steps later on `.pn-datefield`, a locator with nothing to do with the cause. That
 * misdirection is how this spec's timeout came to be filed as a review-step scroll/animation
 * bug against `submitFromReview`.
 *
 * `expectStep` is the 0-based index of the step we must land on. This is an assertion, not a
 * retry or a wait-and-hope: a Next that genuinely refuses to advance is a product defect and
 * still fails the test — it just fails here, saying so, instead of three helpers downstream. */
const clickNext = async (page, expectStep) => {
  await page.getByRole('button', { name: 'Next' }).click();
  if (expectStep == null) return;
  await expect(
    page.locator('.step-dot').nth(expectStep),
    `wizard did not advance to step ${expectStep + 1}`,
  ).toHaveClass(/\bactive\b/);
};

async function fillProperty(page) {
  const p = active(page);
  await p.getByPlaceholder('e.g. B-1204').fill('B-1204');
  await p.getByPlaceholder('e.g. Skyline Heights').fill('Skyline Heights');
  await p.getByPlaceholder('e.g. Baner').fill('Baner');
  await p.getByPlaceholder('411045').fill('411045');
  await clickNext(page, 1);
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
  await clickNext(page, 2);
}

async function fillTenant(page) {
  const p = active(page);
  await p.getByPlaceholder('As per PAN/Aadhaar').fill('Rahul Nair');
  await p.getByPlaceholder('ABCDE1234F').fill('PQRSX6789K');
  await p.getByPlaceholder('12-digit Aadhaar').fill('999988887777');
  await p.getByPlaceholder('10-digit mobile').fill('9822334455');
  await p.getByPlaceholder('Full permanent address').fill('44, FC Road, Pune 411004');
  await clickNext(page, 3);
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
  await clickNext(page, 4);
}

/* Submit from the review step, and prove the request was actually created.
 *
 * Same reasoning as `clickNext`: clicking Generate and returning means a submit that
 * silently did not take — the click landed while the page was being torn down, say — is
 * only noticed by whatever the caller happens to look at next. For the invited-tenant test
 * that is the WhatsApp invite link ten seconds later, a locator with nothing to do with the
 * cause. Asserting the submit's own success condition here fails at the submit instead. */
async function submitFromReview(page) {
  await clickNext(page, 5); // witnesses -> review
  const review = active(page);
  await review.getByRole('checkbox').check();
  await review.getByRole('button', { name: /Generate Agreement & Proceed/ }).click();
  // Either wording of the done panel — the owner filled the tenant step, or invited them to.
  await expect(page.getByText(/Request submitted!|Request sent to the tenant!/)).toBeVisible();
}

test.describe('Rent Agreement — revenue flow', () => {
  test('owner submits the full flow and the uploaded documents reach the request', async ({ page }) => {
    /* The longest journey in the suite: four wizard steps with a file upload and a
       review submit. It runs in ~22s alone but exceeds the 30s default under parallel
       contention, so the timeout fires mid-flow and reads as a product bug. Triple it
       rather than trimming the flow.

       This test used to carry on into `/ops/rent-agreement`, re-logging as admin to
       assert the desk showed the REAL uploaded document rather than a placeholder.
       That desk is gone — it read `localStorage` while the work had moved to Postgres
       — and its replacement is `ops/live-drafting-desk.spec.js`, which proves the
       server-side half against a real queue. What is left here is the customer half,
       which is what a consumer spec should have been asserting all along. */
    test.slow();
    await login(page, BUYER);
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });

    await fillProperty(page);
    await fillOwner(page, { withDoc: true });
    await fillTenant(page);
    await fillTerms(page);
    await submitFromReview(page);

    /* The upload survives the submit: the request carries the owner's REAL file, not the
       placeholder `defaultDocs()` entry. This is the half of the old cross-actor assertion
       that does not need a desk — it used to be read back as "Owner — PAN Card" in the ops
       queue, and it is the upload, not the queue, that this consumer flow is responsible for. */
    const uploaded = await page.evaluate((mobile) => {
      const list = JSON.parse(localStorage.getItem('puneNestServiceReq:' + mobile) || '[]');
      return list.flatMap((r) => r.docs || []).map((d) => d.file && d.file.fileName).filter(Boolean);
    }, BUYER.mobile);
    expect(uploaded.join(',')).toMatch(/owner-pan/);
  });

  test('co-fill invite is delivered to the tenant on WhatsApp with a deep link', async ({ page }) => {
    await login(page, BUYER);
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });

    await fillProperty(page);
    await fillOwner(page);

    // Step 3 — choose "Invite the tenant" and enter their mobile.
    await active(page).getByText('Invite the tenant', { exact: true }).click();
    await active(page).getByPlaceholder('10-digit mobile').fill('9822334455');
    await clickNext(page, 3);

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
    await appReady(page);

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

  test('a mid-fill refresh restores every answer except PAN and Aadhaar, which are never persisted', async ({ page }) => {
    // The rule, not the mechanics: the autosave is deliberately incomplete. A PAN plus an Aadhaar
    // plus a name and a permanent address is a complete identity set, and `pnDraft:rentAgreement`
    // is plain JSON on localStorage — readable by any XSS on this origin and inherited by the next
    // person on a shared device. So those two fields are stripped before the draft is written and
    // the owner retypes them; everything else must still come back, or the autosave is pointless.
    await login(page, BUYER);
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });

    const p = active(page);
    await p.getByPlaceholder('e.g. B-1204').fill('B-1204');
    await p.getByPlaceholder('e.g. Skyline Heights').fill('Skyline Heights');
    await p.getByPlaceholder('e.g. Baner').fill('Baner');
    await p.getByPlaceholder('411045').fill('411045');
    await clickNext(page, 1); // -> owner step
    const o = active(page);
    await expect(o.getByPlaceholder('As per PAN/Aadhaar')).toBeVisible();
    await o.getByPlaceholder('As per PAN/Aadhaar').fill('Anita Verma');
    await o.getByPlaceholder('ABCDE1234F').fill('ABCDE1234F');
    await o.getByPlaceholder('12-digit Aadhaar').fill('123412341234');
    /* The draft save is debounced and the read below goes through `page.evaluate`, which does not
       retry -- this wait is load-bearing.

       Poll for the STEP, not for the name. The first attempt polled for 'Anita Verma' and broke the
       test, which is worth recording because the reason is not obvious: the draft picks up the
       owner's name before it picks up the fact that the wizard has left the property step. Waiting
       on the name therefore returns while `"step":0` is still on disk, and the reload below then
       restores a form that is correct in every field but parked on the wrong panel -- so the owner
       name assertion fails looking for a field that is not on screen.

       `"step":1` is the last thing this sequence writes, so waiting for it subsumes the name and
       makes the far more interesting claim underneath -- that the PAN and Aadhaar never reach the
       disk -- about what the app refused to write rather than about a save still in flight. */
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem('pnDraft:rentAgreement') || ''))
      .toContain('"step":1');
    expect(await page.evaluate(() => localStorage.getItem('pnDraft:rentAgreement') || '')).toContain('Anita Verma');

    // The numbers never reach the disk in the first place.
    const written = await page.evaluate(() => localStorage.getItem('pnDraft:rentAgreement') || '');
    expect(written).not.toContain('ABCDE1234F');
    expect(written).not.toContain('123412341234');

    await page.reload({ waitUntil: 'networkidle' });

    // The draft is restored: the banner shows and we're back on the OWNER step (step
    // was persisted), not reset to step 0.
    await expect(page.getByText('We saved your progress')).toBeVisible();
    const back = active(page);
    await expect(back.getByPlaceholder('As per PAN/Aadhaar')).toHaveValue('Anita Verma');

    // …but the two identity fields come back blank, and the banner says so rather than
    // claiming everything was restored.
    await expect(back.getByPlaceholder('ABCDE1234F')).toHaveValue('');
    await expect(back.getByPlaceholder('12-digit Aadhaar')).toHaveValue('');
    await expect(page.getByText(/PAN and Aadhaar are never saved on this device/)).toBeVisible();

    // …and the earlier property answers are intact.
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(active(page).getByPlaceholder('e.g. Skyline Heights')).toHaveValue('Skyline Heights');
  });

  test('a draft written before the fix has its identity numbers purged on the next visit', async ({ page }) => {
    // Stopping new writes is not enough: every browser that used the wizard earlier is still
    // holding a PAN and an Aadhaar, and nothing else ever revisits this key. Opening the wizard has
    // to clean what is already there — and clean it on disk, not merely decline to display it.
    await login(page, BUYER);
    await page.addInitScript(() => {
      localStorage.setItem('pnDraft:rentAgreement', JSON.stringify({
        step: 1,
        aType: 'Residential',
        prop: { propType: 'Flat / Apartment', furnish: 'Unfurnished', flatNo: 'B-1204', society: 'Skyline Heights', locality: 'Baner', city: 'Pune', pincode: '411045', area: '' },
        owner: { oName: 'Anita Verma', oAge: '34', oGender: 'Male', oPan: 'ABCDE1234F', oAadhaar: '123412341234', oMobile: '9811223344', oEmail: '', oAddr: '12, MG Road, Pune 411001' },
        tenants: [{ name: 'Rahul Nair', age: '29', gender: 'Male', occupation: '', relation: '', pan: 'PQRSX6789K', aadhaar: '999988887777', mobile: '9822334455', email: '', addr: '44, FC Road, Pune 411004' }],
        tenantMode: 'fill',
      }));
    });
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await expect(page.getByText('We saved your progress')).toBeVisible();

    const stored = await page.evaluate(() => localStorage.getItem('pnDraft:rentAgreement') || '');
    expect(stored).not.toContain('ABCDE1234F');
    expect(stored).not.toContain('123412341234');
    expect(stored).not.toContain('PQRSX6789K');
    expect(stored).not.toContain('999988887777');
    // The rest of the draft survives the purge — this is a redaction, not a wipe.
    expect(stored).toContain('Skyline Heights');

    // And the purged values are not put back on screen by the restore either.
    await expect(active(page).getByPlaceholder('ABCDE1234F')).toHaveValue('');
    await expect(active(page).getByPlaceholder('12-digit Aadhaar')).toHaveValue('');
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
    await clickNext(page, 5);
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
    await clickNext(page, 3);
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
    await clickNext(page, 1); // Property → Owner (still read-only)
    await clickNext(page, 2); // Owner → Tenant
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

  test('submitting opens an admin lead ticket linked to the flow request', async ({ page }) => {
    await login(page, BUYER);
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });

    await fillProperty(page);
    await fillOwner(page, { withDoc: true });
    await fillTenant(page);
    await fillTerms(page);
    await submitFromReview(page);

    // At submit the admin lead ticket exists and is linked to the flow request via `ref`.
    const created = await page.evaluate(() => {
      const db = JSON.parse(localStorage.getItem('puneNestDB_v5'));
      return (db.tickets || []).find((t) => t.ref && t.team === 'rental') || null;
    });
    expect(created).toBeTruthy();
    expect(created.status).toBe('new');

    /* This test used to carry on into `/ops/rent-agreement` and click "Mark all verified",
       asserting the linked ticket moved `new -> in_progress`. That operation is not coming
       back: the server derives the document checklist on read, so there is nothing to mark
       (D120 — "nothing about a checklist is stored, so there is no second source of truth
       to fall out of step with the vault"), and `docs_review` was one of three statuses the
       React prototype invented that `ServiceRequestStatus` refuses by name. What survives
       is the half that is still true: submitting opens the lead ticket, and it starts new. */
  });
});
