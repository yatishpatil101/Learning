// @ts-check
import { test, expect } from '@playwright/test';
import { AADHAAR, INVALID_AADHAAR, MOBILE, PNG, active, clickNext, fillCoOwner, fillOwner, fillProperty, fillTenant, fillTenantPolice, fillTerms, fillWitnesses, uploadAll } from '../../../helpers/rentAgreementWizard.js';
import { pickDate } from '../../../helpers/datePicker.helper.js';
/* Mock-only: every rule here is enforced in the browser before anything is sent. The same rules are
   re-checked by the server; `rent-agreement-submit.spec.js` pins that half live. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const BUYER = { name: 'Anita Verma', mobile: MOBILE.owner, email: '', role: 'buyer', joinedAt: Date.now() };
const DRAFT = 'dzDraft:rentAgreement';
const DOC_REQUIRED = 'This document is required for registration.';

async function login(page, user = BUYER) {
  await page.route('**/api/auth/me', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) }));
  await page.route('**/api/auth/refresh', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accessToken: 'e2e-nobackend-token' }) }));
  await page.addInitScript((u) => {
    localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({ necessary: true, functional: false, analytics: false, marketing: false, version: 1, ts: Date.now() }));
    localStorage.setItem('draazyUser', JSON.stringify(u));
    localStorage.setItem('draazyTokens', JSON.stringify({ accessToken: 'e2e-nobackend-token' }));
  }, user);
}

const seedDraft = (page, draft) => page.addInitScript(([k, d]) => localStorage.setItem(k, JSON.stringify(d)), [DRAFT, draft]);

const PROP = { propType: 'Flat / Apartment', furnish: 'Unfurnished', flatNo: 'B-1204', society: 'Skyline Heights', locality: 'Baner', city: 'Pune', taluka: 'Haveli', villageCity: 'Baner', pincode: '411045', area: '' };

const stillOn = (page, step) => expect(page.locator('.step-dot').nth(step), `the wizard stays on step ${step + 1}`).toHaveClass(/\bactive\b/);

async function choose(page, scope, current, option) {
  await scope.locator('.dz-dropdown__trigger').filter({ hasText: current }).first().click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test.describe('Rent Agreement — what the Sub-Registrar will refuse is refused here first', () => {
  test.beforeEach(async ({ page }) => { await login(page); });

  test('the owner and tenant steps refuse missing papers, bad identity numbers and ages until each is fixed', async ({ page }) => {
    test.slow();
    const AGE_ERR = 'Enter an age between 18 and 120.';
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await fillProperty(page);
    await fillOwner(page, { docs: false, next: false, aadhaar: INVALID_AADHAAR });
    const p = active(page);
    for (const doc of ['PAN Card', 'Aadhaar Card', 'Passport Photo', 'Ownership Proof']) {
      await expect(p.locator('label span.req').filter({ hasText: doc }), `${doc} carries the required marker`).toBeVisible();
    }
    await expect(p.locator('.dz-dropdown__trigger', { hasText: 'Select' }).first(), 'no gender is assumed for the owner').toBeVisible();
    await p.getByPlaceholder('you@example.com').fill('anita@');
    const ownerAge = p.getByPlaceholder('e.g. 42').first();
    await ownerAge.fill('');

    await clickNext(page);
    await stillOn(page, 1);
    await expect(p.getByText(DOC_REQUIRED)).toHaveCount(4);
    await expect(p.getByText(/must pass the Aadhaar check digit/)).toBeVisible();
    await expect(p.getByText('Enter a valid email address.')).toBeVisible();
    await expect(p.getByText(AGE_ERR)).toBeVisible();

    await p.getByPlaceholder('12-digit Aadhaar').fill(AADHAAR.owner);
    await p.getByPlaceholder('you@example.com').fill('anita@example.com');
    await uploadAll(p, 'owner-doc');
    await expect(p.getByText(DOC_REQUIRED)).toHaveCount(0);
    await clickNext(page);
    await stillOn(page, 1);
    await ownerAge.fill('17');
    await clickNext(page);
    await stillOn(page, 1);
    await ownerAge.fill('46');
    await clickNext(page, 2);

    await fillTenant(page, { docs: false, next: false });
    const t = active(page);
    const tenantAge = t.getByPlaceholder('e.g. 29').first();
    await t.getByPlaceholder('12-digit Aadhaar').fill(AADHAAR.owner);
    await t.getByPlaceholder('10-digit mobile').fill(MOBILE.owner);
    await tenantAge.fill('');

    await clickNext(page);
    await stillOn(page, 2);
    await expect(t.getByText(/This Aadhaar is already entered for another party/)).toBeVisible();
    await expect(t.getByText(/This mobile is already used by another party/)).toBeVisible();
    await expect(t.getByText(DOC_REQUIRED)).toHaveCount(4);
    await expect(t.getByText(AGE_ERR)).toBeVisible();

    await t.getByPlaceholder('12-digit Aadhaar').fill(AADHAAR.tenant);
    await t.getByPlaceholder('10-digit mobile').fill(MOBILE.tenant);
    await uploadAll(t, 'tenant-doc');
    await clickNext(page);
    await stillOn(page, 2);
    await tenantAge.fill('31');
    await clickNext(page, 3);
  });

  test('company or firm parties are blocked into the legal desk quote flow', async ({ page }) => {
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await fillProperty(page);
    const p = active(page);

    await p.locator('.dz-dropdown__trigger').filter({ hasText: 'Individual' }).first().click();
    await page.getByRole('option', { name: 'Company or firm', exact: true }).click();
    await expect(p.getByText(/self-serve flow cannot handle/)).toBeVisible();
    await expect(p.getByRole('link', { name: 'Get a quote from the legal desk' })).toHaveAttribute('href', '/services/property-legal');

    await clickNext(page);
    await stillOn(page, 1);
    await expect(p.getByText('Company or firm parties need the legal desk quote flow.')).toBeVisible();
  });

  test('a foreign tenant uses passport and visa details, gets SRO-route copy and Form C notice', async ({ page }) => {
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await fillProperty(page);
    await fillOwner(page);
    const t = active(page);
    await t.locator('.dz-dropdown__trigger').filter({ hasText: 'Resident Indian with Aadhaar' }).first().click();
    await page.getByRole('option', { name: 'Foreign national', exact: true }).click();
    await expect(t.getByText(/cannot use Aadhaar e-registration/)).toBeVisible();
    await expect(t.getByPlaceholder('12-digit Aadhaar')).toHaveCount(0);
    await t.getByPlaceholder('As per PAN/Aadhaar').first().fill('Ria Sharma');
    await t.getByPlaceholder('As per identity proof').first().fill('Leena Sharma');
    await pickDate(page, '[data-err="t0dob"]', '1995-01-01');
    await t.getByPlaceholder('ABCDE1234F').first().fill('PQRSX6789K');
    await t.getByPlaceholder('e.g. Z1234567').fill('Z1234567');
    await t.getByPlaceholder('Visa, OCI or e-FRRO reference').fill('OCI-123');
    await t.getByPlaceholder('10-digit mobile').first().fill(MOBILE.tenant);
    await t.getByPlaceholder('Full permanent address').first().fill('44, FC Road, Pune 411004');
    await fillTenantPolice(page);
    await uploadAll(t, 'foreign-tenant-doc');
    await clickNext(page, 3);
    await fillTerms(page);
    await fillWitnesses(page);

    const review = active(page);
    await expect(review.getByText('SRO appointment — offline route')).toBeVisible();
    await expect(review.getByText(/owner must submit Form C to FRRO/)).toBeVisible();
  });

  test('terms are checked against each other and against the registrable window', async ({ page }) => {
    await seedDraft(page, {
      step: 3, prop: PROP, tenantMode: 'fill',
      terms: { startDate: '2000-01-01', months: '11', rent: '30000', deposit: '150000', nrDeposit: '', increment: '150', lockin: '20', notice: '12', dueDay: '0', payMode: 'Bank Transfer / NEFT' },
    });
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await stillOn(page, 3);
    const p = active(page);

    await clickNext(page);
    await stillOn(page, 3);
    await expect(p.getByText(/Choose a start date between \d{4}-\d{2}-\d{2} and \d{4}-\d{2}-\d{2}/)).toBeVisible();
    await expect(p.getByText('Lock-in must be between 0 and 11 months.')).toBeVisible();
    await expect(p.getByText('Notice must be between 0 and 11 months.')).toBeVisible();
    await expect(p.getByText('Enter a day between 1 and 28, so it falls in every month.')).toBeVisible();
    await expect(p.getByText('Enter an increase between 0 and 100%.')).toBeVisible();
  });

  test('a tenancy with no deposit passes, and cash or high rent draws the tax note on the spot', async ({ page }) => {
    await seedDraft(page, {
      step: 3, prop: PROP, tenantMode: 'fill',
      terms: { startDate: '', months: '11', rent: '30000', deposit: '', nrDeposit: '', increment: '5', lockin: '6', notice: '2', dueDay: '29', payMode: 'Bank Transfer / NEFT' },
    });
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await stillOn(page, 3);
    const p = active(page);
    const deposit = p.getByPlaceholder('e.g. 100000');

    await clickNext(page);
    await stillOn(page, 3);
    await expect(p.getByText('Enter the security deposit — 0 if there is none.')).toBeVisible();
    await expect(p.getByText('Enter a day between 1 and 28, so it falls in every month.')).toBeVisible();

    await deposit.fill('0');
    await p.getByText('Rent Due Day (of month)', { exact: true }).locator('xpath=..').locator('input').fill('28');
    await clickNext(page);
    await expect(p.getByText('Select the license start date.'), 'only the missing start date still holds the step').toBeVisible();
    await expect(p.getByText('Enter the security deposit — 0 if there is none.')).toHaveCount(0);
    await expect(p.getByText('Enter a day between 1 and 28, so it falls in every month.')).toHaveCount(0);

    await expect(p.getByText(/s\.269ST/)).toHaveCount(0);
    await choose(page, p, 'Bank Transfer / NEFT', 'Cash');
    await expect(p.getByText(/s\.269ST/), 'cash under ₹2 lakh is allowed').toHaveCount(0);
    await deposit.fill('200000');
    await expect(p.getByText(/s\.269ST/)).toBeVisible();

    await expect(p.getByText(/s\.194-IB/)).toHaveCount(0);
    await p.getByPlaceholder('e.g. 25000').fill('50001');
    await expect(p.getByText(/s\.194-IB/)).toBeVisible();
  });

  test('the furniture list and the furnishing on step 1 cannot tell the deed two different stories', async ({ page }) => {
    await seedDraft(page, { step: 3, prop: PROP, tenantMode: 'fill', furnItems: [{ name: 'Fan', qty: 3, custom: false }] });
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await stillOn(page, 3);
    const p = active(page);
    const mismatch = p.getByText(/Step 1 says the flat is Unfurnished/);
    const unlisted = p.getByText(/Step 1 says the flat is Semi-Furnished\. List what comes with it/);

    await expect(mismatch, 'fans come with an unfurnished flat').toHaveCount(0);
    await p.getByRole('button', { name: 'Sofa', exact: true }).click();
    await expect(mismatch).toBeVisible();

    await p.getByRole('button', { name: 'Mark it Semi-Furnished' }).click();
    await expect(mismatch).toHaveCount(0);
    await expect.poll(() => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}').prop?.furnish, DRAFT),
      'the property step now carries the corrected furnishing').toBe('Semi-Furnished');

    await expect(unlisted).toHaveCount(0);
    await p.getByRole('button', { name: 'Sofa', exact: true }).click();
    await p.getByRole('button', { name: 'Fan', exact: true }).click();
    await expect(unlisted, 'a furnished flat with nothing listed is prompted, not blocked').toBeVisible();
    await clickNext(page);
    await expect(p.getByText('Select the license start date.'), 'the note never holds the step on its own').toBeVisible();
  });

  test('the flat\'s area is required and says what it measures; the floor is optional but sane', async ({ page }) => {
    await seedDraft(page, { step: 0, prop: PROP });
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await stillOn(page, 0);
    const p = active(page);

    await clickNext(page);
    await expect(p.getByText("Enter the flat's area")).toBeVisible();
    await stillOn(page, 0);

    await expect(p.getByRole('button', { name: 'Measured as', exact: true }), 'carpet is the RERA default').toContainText('Carpet');
    await expect(p.getByRole('button', { name: 'Unit', exact: true })).toContainText('sq ft');
    await p.getByPlaceholder('e.g. 850').fill('78.5');
    await p.getByRole('button', { name: 'Unit', exact: true }).click();
    await page.getByRole('option', { name: 'sq m', exact: true }).click();
    await p.getByPlaceholder('0 = ground').fill('250');
    await clickNext(page);
    await expect(p.getByText('Enter a floor from 0 to 200.')).toBeVisible();
    await p.getByPlaceholder('0 = ground').fill('0');
    await p.getByRole('button', { name: 'Add attribute' }).click();
    await p.getByPlaceholder('e.g. 1234/5').fill('CTS 1234/5');
    await clickNext(page, 1);
    await expect.poll(() => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}').prop, DRAFT)).toMatchObject({ area: '78.5', areaUnit: 'sqm', areaBasis: 'carpet', floor: '0', propertyAttributes: [{ kind: 'CTS No.', number: 'CTS 1234/5' }] });
  });

  test('the deed\'s who-pays clauses come pre-answered, and a non-standard period can be typed', async ({ page }) => {
    await seedDraft(page, { step: 3, prop: PROP, tenantMode: 'fill', terms: { months: '9' } });
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await stillOn(page, 3);
    const p = active(page);
    const saved = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}').terms || {}, DRAFT);
    const pick = async (label, option) => {
      await p.getByRole('button', { name: label, exact: true }).click();
      await page.getByRole('option', { name: option, exact: true }).click();
    };

    await expect(p.getByRole('button', { name: 'Stamp duty & registration paid by', exact: true })).toContainText('Split equally');
    await expect(p.getByRole('button', { name: 'Property tax paid by', exact: true })).toContainText('Owner');
    await expect(p.getByText('Increase on Renewal (%)'), 'a licence of 11 months or less only rises on renewal').toBeVisible();

    await pick('Stamp duty & registration paid by', 'Tenant');
    await pick('Parking included', 'Car');
    await expect.poll(saved).toMatchObject({ costBy: 'Tenant', parking: 'car', utilitiesBy: 'Tenant', taxBy: 'Owner' });

    const period = p.getByRole('button', { name: 'License Period', exact: true });
    const months = p.getByPlaceholder('1 – 60');
    await expect(period, 'a restored 9-month draft shows as a custom period').toContainText('Other…');
    await expect(months).toHaveValue('9');

    await pick('License Period', '24 Months');
    await expect(months).toHaveCount(0);
    await expect(p.getByText('Rent Increase (%)')).toBeVisible();

    await pick('License Period', 'Other…');
    await months.fill('7');
    await expect.poll(async () => (await saved()).months).toBe('7');

    await p.getByPlaceholder('e.g. 3', { exact: true }).fill('0');
    await clickNext(page);
    await expect(p.getByText('Enter between 1 and 20 occupants.')).toBeVisible();
    await stillOn(page, 3);
  });

  test('money typed with Indian digit grouping is read as the number it is, not as zero', async ({ page }) => {
    await seedDraft(page, {
      step: 3, prop: PROP, tenantMode: 'fill',
      terms: { startDate: '', months: '11', rent: '30,000', deposit: '1,50,000', nrDeposit: '₹ 5,000', increment: '5', lockin: '6', notice: '2', dueDay: '5', payMode: 'Bank Transfer / NEFT' },
    });
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await stillOn(page, 3);
    const p = active(page);
    const deposit = p.getByPlaceholder('e.g. 100000');

    await expect(p.getByPlaceholder('e.g. 25000'), 'a restored draft is cleaned, not re-sent with commas').toHaveValue('30000');
    await expect(deposit).toHaveValue('150000');
    await expect(p.getByPlaceholder('0', { exact: true })).toHaveValue('5000');

    await deposit.fill('50,000');
    await expect(deposit).toHaveValue('50000');
    await expect(page.locator('div.flex.justify-between', { hasText: 'Deposit (refundable)' }).first()).toContainText('₹50,000');
  });

  test('the deposit is accounted for payment by payment, in the four modes the IGR portal takes', async ({ page }) => {
    await seedDraft(page, {
      step: 3, prop: PROP, tenantMode: 'fill',
      terms: { startDate: '', months: '11', rent: '30000', deposit: '100000', nrDeposit: '', increment: '5', lockin: '6', notice: '2', dueDay: '5', payMode: 'Bank Transfer / NEFT' },
    });
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await stillOn(page, 3);
    const pay = active(page).getByTestId('ra-deposit-payments');
    const labels = (row) => row.locator('label.lbl').allInnerTexts();

    await clickNext(page);
    await stillOn(page, 3);
    await expect(pay.getByText(/Add how the deposit was paid/)).toBeVisible();

    await pay.getByRole('button', { name: 'Add payment' }).click();
    const first = pay.getByTestId('ra-deposit-payment-0');
    await expect(first.getByText('Amount (₹)', { exact: true }).locator('xpath=..').locator('input'), 'the first payment starts at the whole deposit').toHaveValue('100000');
    expect(await labels(first)).toEqual(['Payment mode', 'UPI Ref. No. / UTR No.', 'Amount (₹)', 'Date']);
    for (const [from, to, want] of [
      ['UPI', 'Internet Banking', ['Payment mode', 'Bank Name', 'Branch Name', 'Transfer Ref. No.', 'Amount (₹)', 'Date']],
      ['Internet Banking', 'Demand Draft (DD) / Cheque', ['Payment mode', 'Bank Name', 'Branch Name', 'DD / Cheque Date', 'DD / Cheque Number', 'Amount (₹)']],
      ['Demand Draft (DD) / Cheque', 'Cash', ['Payment mode', 'Date', 'Amount (₹)']],
    ]) {
      await choose(page, first, from, to);
      expect(await labels(first), to).toEqual(want);
    }
    await first.getByText('Amount (₹)', { exact: true }).locator('xpath=..').locator('input').fill('250000');
    await expect(first.getByText(/s\.269ST/), 'cash of ₹2 lakh or more is flagged on the row').toBeVisible();
    await first.getByText('Amount (₹)', { exact: true }).locator('xpath=..').locator('input').fill('40000');

    await clickNext(page);
    await stillOn(page, 3);
    await expect(first.getByText('Required.')).toBeVisible();
    await expect(pay.getByText('Payments add up to ₹40,000; they must equal the deposit of ₹1,00,000.')).toBeVisible();

    await pay.getByRole('button', { name: 'Add payment' }).click();
    const second = pay.getByTestId('ra-deposit-payment-1');
    await expect(second.getByText('Amount (₹)', { exact: true }).locator('xpath=..').locator('input'), 'a new payment starts at what is left').toHaveValue('60000');
    await second.getByText('UPI Ref. No. / UTR No.', { exact: true }).locator('xpath=..').locator('input').fill('utr 6123-4567');
    await expect(second.getByText('UPI Ref. No. / UTR No.', { exact: true }).locator('xpath=..').locator('input'), 'a reference keeps letters and digits only').toHaveValue('UTR61234567');
    await expect(pay.getByText('Entered ₹1,00,000 of ₹1,00,000')).toBeVisible();

    await second.getByRole('button', { name: 'Remove payment' }).click();
    await expect(pay.getByTestId(/^ra-deposit-payment-/)).toHaveCount(1);
    await expect(pay.getByText('Entered ₹40,000 of ₹1,00,000')).toBeVisible();
  });

  test('a rent increase over a long term is taxed, and the owner says how often it applies', async ({ page }) => {
    await page.route('**/api/fees', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{ deal: 'rent', brokerage: 0, platformFee: 1999, stampDuty: null, registration: null, gst: 360, notes: null }]),
    }));
    await seedDraft(page, {
      step: 3, prop: PROP, tenantMode: 'fill',
      terms: { startDate: '', months: '11', rent: '20000', deposit: '150000', nrDeposit: '', increment: '5', lockin: '6', notice: '2', dueDay: '5', payMode: 'Bank Transfer / NEFT' },
    });
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await stillOn(page, 3);
    const p = active(page);
    const stamp = page.locator('div.flex.justify-between', { hasText: 'Stamp Duty (0.25%)' }).first();
    const every = p.getByText('Rent increases every', { exact: true });

    await expect(stamp, '₹587.50 bills ₹600').toContainText('₹600');
    await expect(every, 'an eleven-month term never reaches an increase').toHaveCount(0);

    await choose(page, p, '11 Months', '22 Months');
    await expect(every).toBeVisible();
    await expect(stamp, 'a draft saved before the interval existed defaults to every 11 months').toContainText('₹1,300');

    await every.locator('xpath=..').locator('.dz-dropdown__trigger').click();
    await page.getByRole('option', { name: '12 Months', exact: true }).click();
    await expect(stamp, 'a whole hundred is not rounded past itself').toContainText('₹1,200');
    await expect(page.locator('div.flex.justify-between', { hasText: 'Document Handling (DHC)' }).first()).toContainText('₹300');
  });

  test('the registration area is read from the locality, not chosen', async ({ page }) => {
    await page.route('**/api/fees', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{ deal: 'rent', brokerage: 0, platformFee: 1999, stampDuty: null, registration: null, gst: 360, notes: null }]),
    }));
    const terms = { startDate: '', months: '11', rent: '20000', deposit: '100000', nrDeposit: '', increment: '5', lockin: '6', notice: '2', dueDay: '5', payMode: 'Bank Transfer / NEFT' };
    const fee = page.locator('div.flex.justify-between', { hasText: 'Registration Fee' }).first();
    const area = page.getByTestId('ra-reg-area');

    await seedDraft(page, { step: 3, prop: { ...PROP, locality: 'Hinjawadi Phase 2' }, tenantMode: 'fill', terms });
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await stillOn(page, 3);
    await expect(area).toContainText('Gram Panchayat / Rural');
    await expect(fee).toContainText('₹500');
    await expect(active(page).getByRole('button', { name: 'Municipal / Urban' }), 'there is no toggle to flip').toHaveCount(0);

    await seedDraft(page, { step: 3, prop: PROP, tenantMode: 'fill', terms, regArea: 'rural' });
    await page.reload({ waitUntil: 'networkidle' });
    await stillOn(page, 3);
    await expect(area, 'a stale saved choice is ignored').toContainText('Municipal / Urban');
    await expect(fee).toContainText('₹1,000');
  });

  test('a paper that cannot be used says why on the spot, and a phone-camera original is compressed rather than dropped', async ({ page }) => {
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await fillProperty(page);
    const p = active(page);
    const slot = p.locator('input[type="file"]').first();

    await slot.setInputFiles({ name: 'aadhaar.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') });
    await expect(p.getByText(/aadhaar\.gif can't be used: Use PDF, JPEG\/JPG, PNG or WebP only/)).toBeVisible();
    await expect(p.locator('.upload-box.has-file'), 'a refused file is not shown as accepted').toHaveCount(0);

    const b64 = await page.evaluate(() => {
      const edge = 1800;
      const c = document.createElement('canvas'); c.width = edge; c.height = edge;
      const ctx = c.getContext('2d'); const img = ctx.createImageData(edge, edge);
      for (let i = 0; i < img.data.length; i += 4) {
        const px = i / 4, n = (Math.random() * 8) | 0;
        img.data[i] = ((px % edge) * 255 / edge + n) | 0; img.data[i + 1] = (((px / edge) | 0) * 255 / edge + n) | 0; img.data[i + 2] = 160 + n; img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      return c.toDataURL('image/png').split(',')[1];
    });
    const photo = Buffer.from(b64, 'base64');
    expect(photo.length, 'the original is over the old 2 MB cut-off').toBeGreaterThan(2 * 1024 * 1024);

    await slot.setInputFiles({ name: 'aadhaar-photo.png', mimeType: 'image/png', buffer: photo });
    await expect(p.getByText('aadhaar-photo.jpg')).toBeVisible({ timeout: 20000 });
    await expect(p.getByText(/can't be used/)).toHaveCount(0);
    await expect(p.locator('.upload-box.has-file')).toHaveCount(1);
    await expect(p.getByRole('img', { name: 'Preview' })).toBeVisible();
  });

  test('witnesses cannot share an Aadhaar or the invited tenant\'s mobile', async ({ page }) => {
    await seedDraft(page, {
      step: 4, prop: PROP, tenantMode: 'invite',
      invite: { invMobile: MOBILE.tenant, invName: 'Rahul', invMessage: '' },
    });
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await stillOn(page, 4);
    await fillWitnesses(page, { next: false });
    const w = active(page);
    await expect(w.getByText(/Aadhaar is used to verify them and appears only masked/)).toBeVisible();
    await w.getByTestId('witness-2').getByPlaceholder('12-digit Aadhaar').fill(AADHAAR.witness1);
    await w.getByTestId('witness-1').getByPlaceholder('10-digit mobile').fill(MOBILE.tenant);

    await clickNext(page);
    await stillOn(page, 4);
    await expect(w.getByTestId('witness-2').getByText(/This Aadhaar is already entered for another party/)).toBeVisible();
    await expect(w.getByTestId('witness-1').getByText(/This mobile is already used by another party/)).toBeVisible();
  });

  test('the page never says 11 months avoids registration, and the wizard is residential-only: commercial premises, or a draft saved for a shop, go to the legal desk', async ({ page }) => {
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Why is the agreement usually for 11 months?' }).click();
    await expect(page.getByText(/In Maharashtra it does not avoid registration/)).toBeVisible();
    await page.getByRole('button', { name: 'Is registration of a rent agreement mandatory in Maharashtra?' }).click();
    await expect(page.getByText(/Section 55 of the Maharashtra Rent Control Act, 1999/)).toBeVisible();
    await expect(page.getByText(/keeps registration simpler/)).toHaveCount(0);

    const p = active(page);
    await expect(p.getByRole('button', { name: 'Commercial', exact: true })).toHaveCount(0);
    await expect(p.getByRole('link', { name: /commercial agreement from our legal desk/ })).toHaveAttribute('href', '/services/property-legal');

    await p.locator('.dz-dropdown__trigger').filter({ hasText: 'Flat / Apartment' }).click();
    await expect(page.getByRole('option', { name: 'Shop' })).toHaveCount(0);
    await expect(page.getByRole('option', { name: 'Row House' })).toBeVisible();

    await seedDraft(page, { step: 0, prop: { ...PROP, propType: 'Shop' } });
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await clickNext(page);
    await stillOn(page, 0);
    await expect(active(page).getByText(/Commercial premises need a commercial agreement/)).toBeVisible();
  });

  test('the flat must be in Maharashtra: a pincode outside it, or Goa\'s 403, is stopped on the property step', async ({ page }) => {
    await seedDraft(page, { step: 0, prop: { ...PROP, pincode: '560001' } });
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    const p = active(page);
    const state = p.getByText(/We draft Maharashtra agreements only/);

    await clickNext(page);
    await stillOn(page, 0);
    await expect(state).toBeVisible();

    await p.getByPlaceholder('411045').fill('403001');
    await clickNext(page);
    await stillOn(page, 0);
    await expect(state).toBeVisible();

    await p.getByPlaceholder('411045').fill('411045');
    await expect(state).toHaveCount(0);
  });

  test('co-owners sign too: each needs KYC and papers, and the primary signs as a co-owner or under a registered POA', async ({ page }) => {
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await fillProperty(page);
    await fillOwner(page, { next: false });
    const p = active(page);

    await p.getByRole('button', { name: 'Add co-owner' }).click();
    const co = p.getByTestId('co-owner-0');
    await expect(co.getByText('Co-owner 1')).toBeVisible();
    await expect(p.locator('.dz-dropdown__trigger').filter({ hasText: 'Co-owner' }).first(), 'the primary is no longer a sole owner').toBeVisible();

    await choose(page, p, 'Co-owner', 'Power of Attorney holder');
    await clickNext(page);
    await stillOn(page, 1);
    await expect(p.getByText('Required when signing under a Power of Attorney.').first()).toBeVisible();
    await expect(p.getByText(/Enter the POA registration date/).first()).toBeVisible();
    await expect(co.getByText("Enter the co-owner's full name as on the title deed.")).toBeVisible();
    await expect(co.getByText(DOC_REQUIRED)).toHaveCount(3);
    /* The POA itself is one more required paper for the owner who signs under it. */
    await expect(p.getByText('Registered Power of Attorney', { exact: true })).toBeVisible();

    await choose(page, p, 'Power of Attorney holder', 'Co-owner');
    await fillCoOwner(page, co);
    await expect(co.getByPlaceholder('e.g. 42'), 'a co-owner\'s age is derived from the date of birth').toHaveValue('49');
    await expect(co.getByPlaceholder('If used in older papers')).toHaveValue('Vikram V');
    await clickNext(page, 2);

    await expect.poll(async () => page.evaluate((k) => localStorage.getItem(k) || '', DRAFT)).toContain('Vikram Verma');
    const written = await page.evaluate((k) => localStorage.getItem(k) || '', DRAFT);
    expect(written, 'a co-owner\'s Aadhaar is kept off disk like the owner\'s').not.toContain(AADHAAR.coOwner);
    expect(written).not.toContain('VWXYZ9876L');
  });

  test('a restored draft names the identity fields to re-enter without storing the numbers', async ({ page }) => {
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await fillProperty(page);
    const owner = active(page);
    await owner.getByPlaceholder('ABCDE1234F').fill('ABCDE1234F');
    await owner.getByPlaceholder('12-digit Aadhaar').fill(AADHAAR.owner);
    await expect.poll(async () => page.evaluate((k) => {
      const saved = JSON.parse(localStorage.getItem(k) || '{}');
      return `${saved.step}:${(saved.identityReminders || []).map((f) => `${f.role}:${f.index}:${f.field}`).join('|')}`;
    }, DRAFT)).toBe('1:licensor:0:pan|licensor:0:aadhaar');
    const written = await page.evaluate((k) => localStorage.getItem(k) || '', DRAFT);
    expect(written).not.toContain('ABCDE1234F');
    expect(written).not.toContain(AADHAAR.owner);

    await page.reload({ waitUntil: 'networkidle' });
    await stillOn(page, 1);
    await expect(active(page).getByTestId('ra-identity-reminder')).toContainText('Re-enter: Licensor 1 PAN, Licensor 1 Aadhaar');
    await expect(active(page).getByPlaceholder('ABCDE1234F')).toHaveValue('');
    await expect(active(page).getByPlaceholder('12-digit Aadhaar')).toHaveValue('');

    await active(page).getByPlaceholder('ABCDE1234F').fill('ABCDE1234F');
    await expect(active(page).getByTestId('ra-identity-reminder')).toContainText('Licensor 1 Aadhaar');
    await active(page).getByPlaceholder('12-digit Aadhaar').fill(AADHAAR.owner);
    await expect(active(page).getByTestId('ra-identity-reminder')).toHaveCount(0);
  });
});

test.describe('Rent Agreement — IGR property particulars', () => {
  const IGR_PROP = { ...PROP, area: '850', areaBasis: 'carpet', areaUnit: 'sqft' };
  test.beforeEach(async ({ page }) => { await login(page); });

  async function pick(page, label, option) {
    await active(page).getByRole('button', { name: label, exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  }

  test('taluka and village are required, then road, police station, attributes and gallery area persist to the draft', async ({ page }) => {
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    const p = active(page);
    await p.getByPlaceholder('e.g. B-1204').fill('B-1204');
    const society = p.getByPlaceholder('e.g. Skyline Heights');
    await society.fill('Skyline Heights');
    await society.press('Escape');
    await p.locator('[data-err="locality"]').click();
    await page.locator('.dz-dropdown__menu.is-portal-open .dz-dropdown__option', { hasText: /^Baner$/ }).first().click();
    await p.getByPlaceholder('411045').fill('411045');
    await p.getByPlaceholder('e.g. 850').fill('850');

    await clickNext(page);
    await expect(p.getByText('Choose the Pune taluka.')).toBeVisible();
    await expect(p.getByText('Enter the city or village from the Index II.')).toBeVisible();

    await pick(page, 'Taluka', 'Haveli');
    await p.getByPlaceholder('e.g. Baner, Pune').fill('Baner');
    await p.getByPlaceholder('e.g. Baner Road').fill('Baner Road');
    await p.getByPlaceholder('e.g. Chaturshringi').fill('Chaturshringi');
    await p.getByRole('button', { name: 'Add attribute' }).click();
    await p.getByPlaceholder('e.g. 1234/5').fill('1234/5A');
    await p.getByText('Gallery / balcony area (optional)', { exact: true }).locator('xpath=..').locator('input').fill('45.5');

    await clickNext(page, 1);
    await expect.poll(() => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}').prop, DRAFT)).toMatchObject({
      taluka: 'Haveli',
      villageCity: 'Baner',
      roadName: 'Baner Road',
      policeStation: 'Chaturshringi',
      propertyAttributes: [{ kind: 'CTS No.', number: '1234/5A' }],
      galleryArea: '45.5',
      galleryAreaUnit: 'sqft',
    });
  });

  test('parking area is shown only when parking is part of the licence', async ({ page }) => {
    await seedDraft(page, { step: 3, prop: IGR_PROP, tenantMode: 'fill' });
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    const p = active(page);

    await expect(p.getByText('Parking area (optional)')).toHaveCount(0);
    await pick(page, 'Parking included', 'Car');
    await p.getByText('Parking area (optional)', { exact: true }).locator('xpath=..').locator('input').fill('120');
    await expect.poll(() => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}').terms, DRAFT)).toMatchObject({ parking: 'car', parkingArea: '120', parkingAreaUnit: 'sqft' });

    await pick(page, 'Parking included', 'None');
    await expect(p.getByText('Parking area (optional)')).toHaveCount(0);
    await expect.poll(() => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}').terms?.parkingArea, DRAFT)).toBe('');
  });
});

test.describe('Rent Agreement — IGR tenant police record', () => {
  test.beforeEach(async ({ page }) => { await login(page); });

  test('each tenant stores police details, workplace proof and family co-occupants for review', async ({ page }) => {
    test.slow();
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await fillProperty(page);
    await fillOwner(page);
    await fillTenant(page, { docs: false, next: false });
    const tenant = active(page);
    const police = tenant.getByTestId('tenant-police-record-0');
    await police.getByPlaceholder('Company / office address').fill('');
    await police.getByPlaceholder('e.g. Employee ID, offer letter').fill('');

    await clickNext(page);
    await stillOn(page, 2);
    await expect(police.getByText(/Enter the workplace address/)).toBeVisible();
    await expect(police.getByText('Required.')).toBeVisible();

    await fillTenantPolice(page, { family: true, previous: true });
    await uploadAll(tenant, 'tenant-doc');
    await clickNext(page, 3);
    await fillTerms(page);
    await fillWitnesses(page);

    const review = active(page);
    await expect(review.getByText('Tenant police record')).toBeVisible();
    await expect(review.getByText(/Draazy Labs, Baner/)).toBeVisible();
    await expect(review.getByText(/Sneha Nair/)).toBeVisible();
    await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}').tenants?.[0]?.police, DRAFT))
      .toMatchObject({ previousAddressProofType: 'passport', previous: { village: 'Sadashiv Peth' }, workplaceAddress: 'Draazy Labs, Baner, Pune 411045', workIdProofType: 'Employee ID', occupants: [{ relation: 'spouse', fullName: 'Sneha Nair', mobile: '9876543210' }] });
  });

  test('passport address proof must be uploaded before leaving the tenant step', async ({ page }) => {
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    await fillProperty(page);
    await fillOwner(page);
    await fillTenant(page, { next: false });
    const tenant = active(page);
    const police = tenant.getByTestId('tenant-police-record-0');

    await police.getByRole('button', { name: 'Address proof type', exact: true }).click();
    await page.getByRole('option', { name: 'Passport', exact: true }).click();
    await expect(police.getByLabel('Address Proof', { exact: true })).toHaveCount(1);

    await clickNext(page);
    await stillOn(page, 2);
    await expect(police.getByText(DOC_REQUIRED)).toBeVisible();

    await police.getByLabel('Address Proof', { exact: true }).setInputFiles({ name: 'tenant-address-proof.png', mimeType: 'image/png', buffer: PNG });
    await expect(police.getByText('tenant-address-proof.jpg')).toBeVisible();
    await clickNext(page, 3);
    await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}').docRefs?.tenant?.['t0-5'], DRAFT))
      .toMatchObject({ fileName: 'tenant-address-proof.jpg', reattach: true });
  });
});
