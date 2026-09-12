// @ts-check
import { test, expect } from '@playwright/test';

/** Mock-only coverage protects browser drafts and identity-field purging. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

/** Consumer-only tests use the buyer fixture. */
const BUYER = { name: 'Anita Verma', mobile: '9811223344', email: '', role: 'buyer', joinedAt: Date.now() };

const pad = (n) => String(n).padStart(2, '0');
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };


/** Stub identity endpoints because this mock-only suite runs without backend access. */
async function login(page, user) {
  await page.route('**/api/auth/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(user),
  }));
  // Answered too, because a 401 here is what calls `logoutUser()`; renewing keeps boot-prefetch
  // 401s as ordinary failed reads rather than a sign-out.
  await page.route('**/api/auth/refresh', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ accessToken: 'e2e-nobackend-token' }),
  }));
  await page.addInitScript((u) => {
    localStorage.setItem('draazyUser', JSON.stringify(u));
    // Present so the boot path revalidates rather than taking the cold-boot logout branch; its
    // value is never checked, because the endpoint that would check it is answered above.
    localStorage.setItem('draazyTokens', JSON.stringify({ accessToken: 'e2e-nobackend-token' }));
  }, user);
}

const active = (page) => page.locator('.step-panel.active');

/* Assert the wizard moved: the Property, Owner and Tenant panels share every placeholder, so a Next
   that silently did not advance types the next answers into the wrong panel and fails steps later. */
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
  await p.locator('.dz-datefield').click();
  await page.locator('.dz-cal').waitFor({ state: 'visible' });
  const day = page.getByRole('button', { name: todayIso(), exact: true }).first();
  await day.click();
  await page.locator('.dz-cal').waitFor({ state: 'detached' });
  await p.getByPlaceholder('e.g. 25000').fill('30000');
  await p.getByPlaceholder('e.g. 100000').fill('150000');
  await clickNext(page, 4);
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

  test('a mid-fill refresh restores every answer except PAN and Aadhaar, which are never persisted', async ({ page }) => {
    // `dzDraft:rentAgreement` is plain JSON on localStorage, so PAN + Aadhaar are stripped before
    // the write; everything else must still come back or the autosave is pointless.
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
    /* Poll for `"step":1`, not the name: the draft picks up the owner's name while `"step":0` is
       still on disk, so the reload would restore correct fields parked on the wrong panel. */
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem('dzDraft:rentAgreement') || ''))
      .toContain('"step":1');
    expect(await page.evaluate(() => localStorage.getItem('dzDraft:rentAgreement') || '')).toContain('Anita Verma');

    // The numbers never reach the disk in the first place.
    const written = await page.evaluate(() => localStorage.getItem('dzDraft:rentAgreement') || '');
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
    // Every browser that used the wizard earlier still holds a PAN and an Aadhaar, and nothing else
    // revisits this key — so opening the wizard must clean them off disk, not just off screen.
    await login(page, BUYER);
    await page.addInitScript(() => {
      localStorage.setItem('dzDraft:rentAgreement', JSON.stringify({
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

    const stored = await page.evaluate(() => localStorage.getItem('dzDraft:rentAgreement') || '');
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

    /** Signed-out coverage keeps identity steps inaccessible before authentication. */
  test('a signed-out visitor may price the property, but the identity steps are padlocked', async ({ page }) => {
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });

    // Step 0 is open and usable: it asks about a building, not about a person.
    const p = active(page);
    await expect(p.getByPlaceholder('e.g. B-1204')).toBeVisible();
    await expect(page.locator('.step-dot').nth(0)).toHaveClass(/\bactive\b/);

    // Owner, Tenant, Terms, Witnesses, Review — all behind the line.
    for (let i = 1; i <= 5; i++) {
      await expect(page.locator('.step-dot').nth(i), `step ${i + 1} should be padlocked`).toHaveClass(/\blocked\b/);
    }

    // The way forward says what it will actually do. A button labelled "Next" that turns out to be
    // a sign-in wall is the thing this test exists to stop coming back.
    await expect(page.getByRole('button', { name: 'Sign in to continue' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);
    await expect(page.getByText(/Property details are open to everyone/)).toBeVisible();
  });

  test('crossing the line keeps every property answer, including the one typed last', async ({ page }) => {
    /* Fake timers make the flush window unbounded: the autosave is debounced by 400ms and every
       `fill` is a CDP round trip, so a real-time version of this test passes with the flush deleted.
       `pauseAt` stops `setTimeout` entirely, so anything on disk afterwards got there synchronously.
       React schedules on MessageChannel, so rendering is unaffected. */
    await page.clock.install({ time: new Date('2025-01-01T10:00:00Z') });
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await page.clock.pauseAt(new Date('2025-01-01T10:00:05Z'));

    const p = active(page);
    await p.getByPlaceholder('e.g. B-1204').fill('B-1204');
    await p.getByPlaceholder('e.g. Skyline Heights').fill('Skyline Heights');
    await p.getByPlaceholder('e.g. Baner').fill('Baner');
    await p.getByPlaceholder('411045').fill('411045');

    await page.getByRole('button', { name: 'Sign in to continue' }).click();

    // Sent to sign in, told why, and pointed back here rather than at the dashboard.
    await expect(page).toHaveURL(/\/signin/);
    const url = new URL(page.url());
    expect(url.searchParams.get('reason')).toBe('services'); // plural — AUTH_REASONS drops 'service'
    expect(url.searchParams.get('next')).toBe('/services/rent-agreement');

    /* The sign-up leg must carry `next` too, or `postAuthDest` sends a brand-new account to the
       dashboard. Asserted on the href, because completing a signup needs a server this lane lacks. */
    await expect(page.getByRole('link', { name: /sign up/i }))
      .toHaveAttribute('href', /next=%2Fservices%2Frent-agreement/);

    // The draft made it to disk before the page went away — pincode included.
    const written = await page.evaluate(() => localStorage.getItem('dzDraft:rentAgreement') || '');
    expect(written).toContain('Skyline Heights');
    expect(written).toContain('411045');

    // Sign in and come back: the answers are on screen, not merely on disk.
    /* Resume first — a paused clock starves the next page load of every `setTimeout` it needs to
       boot, which reads as the restore losing the answers. */
    await page.clock.resume();
    await login(page, BUYER);
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    const back = active(page);
    await expect(back.getByPlaceholder('e.g. B-1204')).toHaveValue('B-1204');
    await expect(back.getByPlaceholder('e.g. Skyline Heights')).toHaveValue('Skyline Heights');
    await expect(back.getByPlaceholder('e.g. Baner')).toHaveValue('Baner');
    await expect(back.getByPlaceholder('411045')).toHaveValue('411045');

    // …and the line is gone, so the same control now does what it says.
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
    await expect(page.locator('.step-dot').nth(1)).not.toHaveClass(/\blocked\b/);
  });

  test('a draft that was left on a later step cannot restore a signed-out visitor into it', async ({ page }) => {
    /* The draft persists `step`, so a restore drops a signed-out visitor straight onto a panel full
       of PAN and Aadhaar inputs without ever pressing the button the gate lives on. */
    await page.addInitScript(() => {
      localStorage.setItem('dzDraft:rentAgreement', JSON.stringify({
        step: 3,
        prop: { propType: 'Flat / Apartment', furnish: 'Unfurnished', flatNo: 'B-1204', society: 'Skyline Heights', locality: 'Baner', city: 'Pune', pincode: '411045', area: '' },
      }));
    });
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });

    // Clamped back to the public step, with the rest of the draft intact.
    await expect(page.locator('.step-dot').nth(0)).toHaveClass(/\bactive\b/);
    await expect(page.locator('.step-dot').nth(3)).toHaveClass(/\blocked\b/);
    await expect(active(page).getByPlaceholder('e.g. Skyline Heights')).toHaveValue('Skyline Heights');
  });
});
