// @ts-check
import { test, expect } from '@playwright/test';
import { appReady } from '../../../helpers/app.js';

/*
 * Rent Agreement — the *mock-only* remainder.
 *
 * This file used to own the whole service. Three of its tests have been retired onto
 * `live-rent-agreement.spec.js`, which drives the real server:
 *
 *   - "owner submits the full flow and the uploaded documents reach the request" — the mock
 *     read the uploads back out of `puneNestServiceReq:`, i.e. the browser confirming its own
 *     write. The live spec reads them back from `GET /service-requests/{id}` outside the
 *     browser, and in doing so exposed that they had never been sent at all.
 *   - "platform service fee is driven by the admin Fees panel" — a duplicate; the live fee
 *     schedule is owned elsewhere (see COVERAGE.md). It also only ever proved that a number
 *     the test itself had written into `puneNestDB_v5` came back out.
 *   - "after submitting, the owner sees a locked panel … and can start a new agreement" — the
 *     locked panel is now proved live. The second half is **behaviour that has since
 *     reversed**: rent-agreement is priced, so a submitted request is parked at
 *     `awaiting-payment` and the server answers a second unpaid create with 409. Porting it
 *     would have pinned a promise the product no longer makes.
 *
 * What is left is deliberately mock-shaped: draft autosave and the D159 identity purge are
 * claims *about browser storage*, and the admin lead ticket is a deliberate mock-side keeper
 * (see the test's own note). See the live specs' headers for the boundary lists.
 *
 * A further three have been retired onto `live-service-draft-review.spec.js` — the draft
 * maker→checker. All three opened with `Preview with a sample draft`, a **demo affordance**
 * that `ServiceTracker.jsx:138` hides the moment the app is live, with the comment "a customer
 * cannot share a draft to themselves". So the mock's maker was the customer's own browser:
 *
 *   - "customer (checker) can approve the draft our team shares" — our team had not shared
 *     anything; the browser had fabricated a draft one line earlier.
 *   - "sharing a draft raises a dashboard bell notification" — read back out of
 *     `pnNotifications:` in the same tab that wrote it. Converting it found the server raised
 *     **no notification at all**, so live the checker was never told a draft was waiting on
 *     them — on a flow that no one else is permitted to advance.
 *   - "request-changes uses an on-brand modal … and records the note" — the modal half was a
 *     real component claim and is preserved live; "records the note" read `puneNestServiceReq:`
 *     back out of localStorage.
 *
 * The live spec files a **valuation** rather than a rent agreement, deliberately: rent-agreement
 * is the one priced desk, so it opens at `awaiting-payment`, and `ServiceRequestStatus.ALLOWED`
 * lets that reach only `new` or `cancelled` — nothing a browser can do moves it on. The tracker
 * component is the same one either way.
 *
 * A further three have been retired onto `live-rent-agreement-cofill.spec.js`. Co-fill is a
 * two-actor flow, and the mock's own provider concedes it cannot test one — both actors shared a
 * single `localStorage`, so the "tenant" was reading the key the "owner" had written in the same
 * tab. Two of the three also asserted behaviour that has since **reversed**, and were retired
 * rather than ported:
 *
 *   - "co-fill invite is delivered to the tenant on WhatsApp with a deep link" — asserted the
 *     link carried `?invite=<token>`, a bearer credential openable by whoever received the
 *     forward. Live invitations are addressed to an account (`?party=&request=`) and resolve only
 *     after sign-in; holding the link is no longer authority.
 *   - "signed-out invitee is bounced to a prefilled sign-in" — asserted `mobile=9822334455` was
 *     put in the sign-in URL, prefilled from a record the test had seeded itself. That would
 *     disclose the invited tenant's number to anyone holding the link. Live sends only `reason`
 *     and `next`, and the live spec asserts the *absence*.
 *   - "invited tenant: request surfaces in My Rental first, and only the Tenant tab is editable"
 *     — the surviving half of a test whose premise was the shared browser. Converting it found
 *     that live the card never appeared at all: the dashboard was reading invitations from
 *     `localStorage` while the server held them.
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

  /* This test used to be called "submitting opens an admin lead ticket linked to the flow request",
     and asserted a `rental` row in `puneNestDB_v5.tickets`. That ticket is gone, and the absence is
     now the thing worth pinning.

     The wizard was minting a `TR…` ref and writing that ticket through `lib/mockApi` on *every*
     build, live included, where it reached nothing: `serviceRequestMapper.toCreate` refuses by name
     to forward a `TR…` ref, and the backend has no `ticketRef` field at any layer. So the rental
     desk was never told; only the owner's own tab believed it had been. The product answer is that
     the request *is* the record — `ServiceRequestService` parks a priced request at
     `awaiting-payment`, and `applyWebhookOutcome` moves it to `new` and onto the queue, carrying its
     own `details` rather than the ticket's one-line summary.

     The absence is asserted next to the presence on purpose. "No rental ticket" on its own would
     pass just as happily if the submit had silently not taken at all — the failure mode
     `submitFromReview` exists to catch — so the flow record it *should* have written is read in the
     same breath. The live half (the park, the amount, the single-use session) belongs to
     `consumer/services/live-rent-agreement.spec.js`; settlement stays with
     `ServiceRequestFlowTest.PaidGate`, because forging a webhook signature is the one thing a spec
     on this surface should not learn to do. */
  test('submitting records the request itself, and raises no browser-only admin ticket', async ({ page }) => {
    await login(page, BUYER);
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });

    /* The flow record is counted as a delta rather than an absolute, because
       `serviceFlow.seedDemo()` plants rental requests under three other demo mobiles.

       The ticket is matched on its `TR…` ref instead of on `team === 'rental'`, and that is not
       cosmetic: measured, eight seeded rental tickets arrive while this page is still booting, so a
       count of the team would have been reporting the seed's arrival rather than the wizard's write.
       A `TR…` ref is the wizard's own signature and nothing else in the product mints one. */
    const census = () => page.evaluate(() => {
      const flows = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('puneNestServiceReq:')) {
          try { flows.push(...(JSON.parse(localStorage.getItem(k)) || [])); } catch { /* ignore */ }
        }
      }
      const db = JSON.parse(localStorage.getItem('puneNestDB_v5') || '{}');
      return {
        rental: flows.filter((r) => r.type === 'rental').length,
        wizardTickets: (db.tickets || []).filter((t) => String(t.ref || '').startsWith('TR')).length,
        ours: flows.find((r) => (r.details?.property || '').includes('B-1204, Skyline Heights')) || null,
      };
    });

    const before = await census();

    await fillProperty(page);
    await fillOwner(page, { withDoc: true });
    await fillTenant(page);
    await fillTerms(page);
    await submitFromReview(page);

    const after = await census();

    expect(after.rental - before.rental, 'the submit wrote no request — the flow record is the system of record now').toBe(1);
    expect(after.ours, 'the request that was written is not the one this wizard filled in').toBeTruthy();
    expect(after.ours.status).toBe('submitted');
    expect(after.wizardTickets, 'a browser-only rental ticket is back; the desk is told by the request, not by a TR… ref').toBe(0);
  });
});
