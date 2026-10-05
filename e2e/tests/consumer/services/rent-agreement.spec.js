// @ts-check
import { test, expect } from '@playwright/test';
import { AADHAAR, MOBILE, active, clickNext, fillOwner, fillProperty, fillTenant, fillTenantPolice, fillTerms, fillWitnesses, inviteOwner, pickLocality, uploadAll } from '../../../helpers/rentAgreementWizard.js';
import { pickDate } from '../../../helpers/datePicker.helper.js';
const BASE = process.env.BASE_URL || 'http://localhost:5173';
const BUYER = { name: 'Anita Verma', mobile: '9811223344', email: '', role: 'buyer', joinedAt: Date.now() };
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

test.describe('Rent Agreement — revenue flow', () => {
  test('a mid-fill refresh restores every answer except PAN and Aadhaar and remembers which papers were attached', async ({ page }) => {
    await login(page, BUYER);
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await fillProperty(page);
    await fillOwner(page, { next: false });

    /* Poll for `"step":1`, not the name: the draft picks up the owner's name while `"step":0` is
       still on disk, so the reload would restore correct fields parked on the wrong panel. */
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem('dzDraft:rentAgreement') || ''))
      .toContain('owner-doc-3.jpg');
    const written = await page.evaluate(() => localStorage.getItem('dzDraft:rentAgreement') || '');
    expect(written).toContain('"step":1');
    expect(written).toContain('Anita Verma');
    expect(written).not.toContain('data:image');
    expect(written).not.toContain('ABCDE1234F');
    expect(written).not.toContain(AADHAAR.owner);

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByText('We saved your progress')).toBeVisible();
    const back = active(page);
    await expect(back.getByPlaceholder('As per PAN/Aadhaar')).toHaveValue('Anita Verma');
    await expect(back.getByPlaceholder('ABCDE1234F')).toHaveValue('');
    await expect(back.getByPlaceholder('12-digit Aadhaar')).toHaveValue('');
    await expect(page.getByText(/PAN and Aadhaar are never saved on this device/)).toBeVisible();
    await expect(back.getByText('Re-attach owner-doc-0.jpg')).toBeVisible();
    await expect(back.getByText('Re-attach owner-doc-3.jpg')).toBeVisible();

    await clickNext(page);
    await expect(page.locator('.step-dot').nth(1), 'a re-attach marker is not a paper').toHaveClass(/\bactive\b/);
    await expect(back.getByPlaceholder('ABCDE1234F').first(), 'the purged PAN is the first gap, and has focus').toBeFocused();

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
    expect(stored).toContain('Skyline Heights');

    await expect(active(page).getByPlaceholder('ABCDE1234F')).toHaveValue('');
    await expect(active(page).getByPlaceholder('12-digit Aadhaar')).toHaveValue('');
  });

  test('each step refuses incomplete answers, and the review carries identity, deed language and the biometric visit preference', async ({ page }) => {
    test.slow();
    await login(page, BUYER);
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await fillProperty(page);
    const owner = active(page);
    await owner.getByPlaceholder('As per PAN/Aadhaar').first().fill('Anita Verma');
    await clickNext(page);
    await expect(page.locator('.step-dot').nth(1)).toHaveClass(/\bactive\b/);
    await expect(owner.getByText("Enter mother's name.")).toBeVisible();
    await expect(owner.getByText('Choose a valid date of birth for an adult party.')).toBeVisible();

    await fillOwner(page, { next: false });
    await expect(owner.getByPlaceholder('e.g. 42').first()).toHaveValue('46');
    await clickNext(page, 2);
    await fillTenant(page, { next: false });
    await expect(active(page).getByPlaceholder('e.g. 29').first()).toHaveValue('31');
    await clickNext(page, 3);
    await fillTerms(page, { next: false });

    const t = active(page);
    await expect(t.getByRole('button', { name: 'English', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await t.getByRole('button', { name: 'Marathi (मराठी)' }).click();
    await t.getByRole('button', { name: 'Where', exact: true }).click();
    await page.getByRole('option', { name: "At the tenant's address" }).click();
    await t.getByRole('button', { name: 'Preferred time', exact: true }).click();
    await page.getByRole('option', { name: 'Evening (4 – 8 pm)' }).click();
    await clickNext(page, 4);

    const w = active(page);
    await expect(w.getByText('Optional')).toHaveCount(0);
    await expect(w.getByText(/must be present at the registration visit/)).toBeVisible();
    await clickNext(page);
    await expect(page.locator('.step-dot').nth(4), 'an empty witnesses step does not reach review').toHaveClass(/\bactive\b/);
    await expect(w.getByText("Enter the witness's full name as on their Aadhaar.").first()).toBeVisible();
    await fillWitnesses(page);

    const review = active(page);
    await expect(review.getByRole('button', { name: /Pay ₹[\d,]+ & Submit/ })).toBeVisible();
    await expect(review.getByText('Suresh Patil, Meera Joshi')).toBeVisible();
    await expect(review.getByText('Marathi (मराठी)')).toBeVisible();
    await expect(review.getByText("At the tenant's address · date to be agreed · Evening (4 – 8 pm)")).toBeVisible();
    await expect(review.getByText('Owner identity')).toBeVisible();
    await expect(review.getByText(/Mother's name: Shaila Verma/)).toBeVisible();
    await expect(review.getByText(/Date of birth: 1980-01-01/)).toBeVisible();
    await expect(review.getByText('Tenant identity')).toBeVisible();
    await expect(review.getByText(/Mother's name: Latha Nair/)).toBeVisible();
  });

  test('a tenant can start the agreement and invite the owner to fill only the owner half', async ({ page }) => {
    await login(page, BUYER);
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await fillProperty(page);

    const o = active(page);
    await o.getByText("I'm the tenant — invite the owner", { exact: true }).click();
    await expect(o.getByPlaceholder('As per PAN/Aadhaar'), 'the owner fields are the invitee\'s to fill').toHaveCount(0);
    await clickNext(page);
    await expect(o.getByText("Enter the owner's 10-digit mobile number.")).toBeVisible();
    await inviteOwner(page, MOBILE.coOwner, 'Rajesh Deshpande');
    await expect(page.locator('.step-dot').nth(1), 'the owner step waits on the invitee').toHaveClass(/\bpending\b/);

    const t = active(page);
    await expect(t.getByText('Invite the tenant', { exact: true }), 'one side is invited at a time').toHaveCount(0);
    await expect(t.getByPlaceholder('As per PAN/Aadhaar').first(), 'the first tenant is the signed-in requester').toHaveValue(BUYER.name);
    await expect(t.getByPlaceholder('10-digit mobile').first()).toHaveValue(BUYER.mobile);
    await t.getByPlaceholder('As per identity proof').first().fill('Latha Nair');
    await pickDate(page, '[data-err="t0dob"]', '1995-01-01');
    await t.getByPlaceholder('ABCDE1234F').first().fill('PQRSX6789K');
    await t.getByPlaceholder('12-digit Aadhaar').first().fill(AADHAAR.tenant);
    await t.getByPlaceholder('Full permanent address').first().fill('44, FC Road, Pune 411004');
    await fillTenantPolice(page);
    await uploadAll(t, 'tenant-doc');
    await clickNext(page, 3);
    await fillTerms(page);
    await fillWitnesses(page);

    const review = active(page);
    await expect(review.getByText('Invited: Rajesh Deshpande (pending)')).toBeVisible();
    await expect(review.getByText(BUYER.name, { exact: true })).toBeVisible();
  });

  test('a signed-out visitor may price the property, but the identity steps are padlocked even for a draft left on a later step', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('dzDraft:rentAgreement', JSON.stringify({
        step: 3,
        prop: { propType: 'Flat / Apartment', furnish: 'Unfurnished', flatNo: 'B-1204', society: 'Skyline Heights', locality: 'Baner', city: 'Pune', pincode: '411045', area: '' },
      }));
    });
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });

    const p = active(page);
    await expect(p.getByPlaceholder('e.g. B-1204')).toBeVisible();
    await expect(p.getByPlaceholder('e.g. Skyline Heights')).toHaveValue('Skyline Heights');
    await expect(page.locator('.step-dot').nth(0)).toHaveClass(/\bactive\b/);
    for (let i = 1; i <= 5; i++) {
      await expect(page.locator('.step-dot').nth(i), `step ${i + 1} should be padlocked`).toHaveClass(/\blocked\b/);
    }

    await expect(page.getByRole('button', { name: 'Sign in to continue' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);
    await expect(page.getByText(/Property details are open to everyone/)).toBeVisible();
  });

  test('crossing the line keeps every property answer, including the one typed last', async ({ page }) => {
    await page.clock.install({ time: new Date('2025-01-01T10:00:00Z') });
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });

    const p = active(page);
    await pickLocality(page);
    await p.getByRole('button', { name: 'Taluka', exact: true }).click();
    await page.getByRole('option', { name: 'Haveli', exact: true }).click();
    await p.getByPlaceholder('e.g. Baner, Pune').fill('Baner');
    await page.clock.pauseAt(new Date('2025-01-01T10:05:00Z'));
    await p.getByPlaceholder('e.g. B-1204').fill('B-1204');
    await p.getByPlaceholder('e.g. Skyline Heights').fill('Skyline Heights');
    await p.getByPlaceholder('e.g. Skyline Heights').press('Escape');
    await p.getByPlaceholder('e.g. 850').fill('850');
    await p.getByPlaceholder('411045').fill('411045');

    await page.getByRole('button', { name: 'Sign in to continue' }).click();

    await expect(page).toHaveURL(/\/signin/);
    const url = new URL(page.url());
    expect(url.searchParams.get('reason')).toBe('services'); // plural — AUTH_REASONS drops 'service'
    expect(url.searchParams.get('next')).toBe('/services/rent-agreement');
    /* The sign-up leg must carry `next` too, or `postAuthDest` sends a brand-new account to the
       dashboard. Asserted on the href, because completing a signup needs a server this lane lacks. */

    await expect(page.getByRole('link', { name: /sign up/i }))
      .toHaveAttribute('href', /next=%2Fservices%2Frent-agreement/);

    const written = await page.evaluate(() => localStorage.getItem('dzDraft:rentAgreement') || '');
    expect(written).toContain('Skyline Heights');
    expect(written).toContain('411045');

    await page.clock.resume();
    await login(page, BUYER);
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    const back = active(page);
    await expect(back.getByPlaceholder('e.g. B-1204')).toHaveValue('B-1204');
    await expect(back.getByPlaceholder('e.g. Skyline Heights')).toHaveValue('Skyline Heights');
    await expect(back.locator('[data-err="locality"]')).toContainText('Baner');
    await expect(back.getByPlaceholder('411045')).toHaveValue('411045');
    // …and the line is gone, so the same control now does what it says.
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
    await expect(page.locator('.step-dot').nth(1)).not.toHaveClass(/\blocked\b/);
  });
});

const LISTING = {
  id: '6b1f3c2e-1d2a-4c55-9a0e-1f2e3d4c5b6a',
  slug: null,
  deal: 'rent',
  propertyType: 'Apartment',
  title: '2 BHK in Kumar Paradise',
  price: 32000,
  deposit: 128000,
  furnishing: 'semi-furnished',
  locality: 'Kharadi',
  pincode: '411014',
  builtUpArea: 950,
  status: 'approved',
  formDetails: { flatNumber: 'A-702', society: 'Kumar Paradise' },
};

async function serveMyListing(page) {
  await page.route(/\/api\/me\/listings(\?|$)/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ content: [LISTING], totalElements: 1, totalPages: 1, number: 0, size: 50 }),
  }));
  await page.route(new RegExp(`/api/me/listings/${LISTING.id}$`), (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(LISTING),
  }));
}

test.describe('Rent Agreement — what the platform already holds is not asked for twice', () => {
  test('choosing one of your listings fills the property step from it instead of blanking it', async ({ page }) => {
    await login(page, BUYER);
    await serveMyListing(page);
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });

    const p = active(page);
    await p.getByRole('button', { name: /2 BHK in Kumar Paradise/ }).click();
    await expect(p.getByPlaceholder('e.g. B-1204')).toHaveValue('A-702');
    await expect(p.getByPlaceholder('e.g. Skyline Heights')).toHaveValue('Kumar Paradise');
    await expect(p.locator('[data-err="locality"]')).toContainText('Kharadi');
    await expect(p.getByPlaceholder('411045')).toHaveValue('411014');
    await expect(p.getByPlaceholder('e.g. 850')).toHaveValue('950');
    await expect(p.getByRole('button', { name: 'Measured as', exact: true }), 'the listing only gives a built-up figure, so the deed says so').toContainText('Built-up');
  });

  test('a ?listing= link fills only the blanks of a restored draft for the same flat', async ({ page }) => {
    await login(page, BUYER);
    await serveMyListing(page);
    await page.addInitScript(() => {
      localStorage.setItem('dzDraft:rentAgreement', JSON.stringify({
        step: 0,
        prop: { propType: 'Flat / Apartment', furnish: 'Furnished', flatNo: 'A-702', society: 'Kumar Paradise', societyId: '', locality: '', city: 'Pune', pincode: '', area: '' },
        terms: { startDate: '', months: '11', rent: '30000', deposit: '', nrDeposit: '', increment: '5', lockin: '6', notice: '2', dueDay: '5', payMode: 'Bank Transfer / NEFT' },
      }));
    });
    await page.goto(`${BASE}/services/rent-agreement?listing=${LISTING.id}`, { waitUntil: 'networkidle' });

    const p = active(page);
    await expect(p.getByPlaceholder('e.g. 850'), 'a blank the listing can answer is filled').toHaveValue('950');
    await expect(p.getByPlaceholder('411045')).toHaveValue('411014');
    await expect(p.getByPlaceholder('e.g. B-1204')).toHaveValue('A-702');
    await expect(p.locator('.dz-dropdown__trigger').nth(1), 'furnishing is the restored answer, not the listing\'s').toHaveText('Furnished');
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem('dzDraft:rentAgreement') || ''))
      .toContain('"area":"950"');
    const draft = JSON.parse(await page.evaluate(() => localStorage.getItem('dzDraft:rentAgreement') || '{}'));
    expect(draft.terms.rent, 'the agreed rent survives the listing\'s asking rent').toBe('30000');
    expect(draft.terms.deposit, 'while an unanswered deposit is taken from the listing').toBe('128000');
  });

  test('a ?listing= link for another flat leaves a restored draft whole and does not bind to it', async ({ page }) => {
    await login(page, BUYER);
    await serveMyListing(page);
    await page.addInitScript(() => {
      localStorage.setItem('dzDraft:rentAgreement', JSON.stringify({
        step: 0,
        prop: { propType: 'Flat / Apartment', furnish: 'Furnished', flatNo: 'B-1204', society: 'Skyline Heights', societyId: '', locality: 'Baner', city: 'Pune', pincode: '411045', area: '' },
        terms: { startDate: '', months: '11', rent: '30000', deposit: '', nrDeposit: '', increment: '5', lockin: '6', notice: '2', dueDay: '5', payMode: 'Bank Transfer / NEFT' },
      }));
    });
    await page.goto(`${BASE}/services/rent-agreement?listing=${LISTING.id}`, { waitUntil: 'networkidle' });

    await expect(page.getByText('Your saved draft is for a different flat')).toBeVisible();
    const p = active(page);
    await expect(p.getByPlaceholder('e.g. B-1204')).toHaveValue('B-1204');
    await expect(p.getByPlaceholder('e.g. Skyline Heights')).toHaveValue('Skyline Heights');
    await expect(p.getByPlaceholder('e.g. 850'), 'the other flat\'s area is not borrowed').toHaveValue('');

    await p.getByRole('button', { name: /2 BHK in Kumar Paradise/ }).click();
    await expect(p.getByPlaceholder('e.g. B-1204'), 'an explicit pick still switches the flat').toHaveValue('A-702');
  });

  test('a refused Next brings the first missing answer into view, and re-checks as it is fixed', async ({ page }) => {
    await login(page, BUYER);
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });

    await clickNext(page);
    const p = active(page);
    await expect(p.getByPlaceholder('e.g. B-1204'), 'the first flagged control has focus').toBeFocused();
    await expect(p.getByText('Enter the flat / house number.')).toBeVisible();

    await p.getByPlaceholder('e.g. B-1204').fill('B-1204');
    await expect(p.getByText('Enter the flat / house number.'), 'a fixed answer clears without another Next').toHaveCount(0);
    await expect(p.getByText('Enter the building / society name.'), 'an untouched one stays flagged').toBeVisible();
  });
});
