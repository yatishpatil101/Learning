// @ts-check
import { test, expect } from '@playwright/test';

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

async function fillOwner(page) {
  const p = active(page);
  await p.getByPlaceholder('As per PAN/Aadhaar').fill('Anita Verma');
  await p.getByPlaceholder('ABCDE1234F').fill('ABCDE1234F');
  await p.getByPlaceholder('12-digit Aadhaar').fill('123412341234');
  await p.getByPlaceholder('10-digit mobile').fill('9811223344');
  await p.getByPlaceholder('Full permanent address').fill('12, MG Road, Pune 411001');
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

/* `submitFromReview` and the `PNG` fixture were removed alongside the two tests retired at the
   foot of this file (D256) — they had no other callers. The reasoning they carried is worth
   keeping: a submit helper must assert its own success condition, because a click that silently
   did not take is otherwise only noticed by whatever the caller looks at next, several steps
   downstream and pointing at the wrong thing. `clickNext` still enforces that discipline for
   every step this file does drive. Whoever ports the submit half to the live lane should carry
   the same shape across rather than re-deriving it. */

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

  /* RETIRED (D256): "mandatory docs are reused from — and saved back to — the dashboard Document
     vault" seeded `puneNestDocs:<mobile>` directly and read it back, so it asserted against the
     browser-local vault the mock build kept. Document reuse now belongs to the document service
     and its live specs; re-pointing this at the server is a port, not a rescue, and is tracked
     rather than faked here. The four surviving tests in this file stay because they assert the
     wizard's own client-side behaviour — the required markers, the mid-fill restore, the
     PAN/Aadhaar purge and the optional witnesses step — none of which needs the mock store. */

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

  /* RETIRED (D256): "submitting records the request itself, and raises no browser-only admin
     ticket" asserted its delta by counting `puneNestServiceReq:*` and `puneNestDB_v5.tickets` in
     localStorage — the mock store, which went with `services/providers/mock`. Both halves of it
     already live against the real server: the park, the amount and the single-use session are
     covered by `consumer/services/live-rent-agreement.spec.js`, and settlement by
     `ServiceRequestFlowTest.PaidGate`. Nothing is uncovered by its removal, which is why it was
     deleted rather than ported. */
});
