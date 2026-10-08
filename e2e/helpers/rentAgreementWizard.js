import { expect } from '@playwright/test';
import { pickDate } from './datePicker.helper.js';
import { pickSocietyNotOnMaps } from './places.js';
import { pickLocalityIn } from './locality.js';

// Verhoeff-valid and distinct because both wizard and server reject shared party IDs.
export const AADHAAR = {
  owner: '234567890124',
  tenant: '345678901238',
  witness1: '456789012341',
  witness2: '567890123458',
  coOwner: '678901234560',
  spare: '789012345674',
};
export const MOBILE = { owner: '9811223344', tenant: '9822334455', witness1: '9833445566', witness2: '9844556677', coOwner: '9855667788' };
export const INVALID_AADHAAR = '123412341234';

export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4AWJiYGD4D8IgBpBmYAAAAAD//7vS9wEAAAAGSURBVAMAGDACA6ybwrYAAAAASUVORK5CYII=', 'base64');
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD6pooooA//2Q==', 'base64');

const pad = (n) => String(n).padStart(2, '0');
export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

export const active = (page) => page.locator('.step-panel.active');

// Shared placeholders would hide a failed Next until a later unrelated locator.
export async function clickNext(page, expectStep) {
  await page.getByRole('button', { name: 'Next' }).click();
  if (expectStep == null) return;
  await expect(page.locator('.step-dot').nth(expectStep), `wizard did not advance to step ${expectStep + 1}`).toHaveClass(/\bactive\b/);
}

export async function uploadAll(scope, prefix) {
  const inputs = scope.locator('input[type="file"]');
  const n = await inputs.count();
  for (let i = 0; i < n; i++) {
    const name = `${prefix}-${i}.jpg`;
    await inputs.nth(i).setInputFiles({ name, mimeType: 'image/jpeg', buffer: JPG });
    await expect(scope.getByText(name).first()).toBeVisible({ timeout: 15000 });
  }
}

const SERVED_LOCALITIES = [
  { slug: 'baner', name: 'Baner', city: 'Pune', lat: 18.559, lng: 73.7868 },
  { slug: 'kharadi', name: 'Kharadi', city: 'Pune', lat: 18.5515, lng: 73.9348 },
  { slug: 'hinjawadi', name: 'Hinjawadi', city: 'Pune', lat: 18.5912, lng: 73.7389 },
];

// Without a server the locality search has nothing to answer, and Google must stay out of it so the
// picker offers exactly the rows served here.
async function serveLocalities(page) {
  await page.route(/places\.googleapis\.com|AutocompletePlaces/, (route) => route.abort());
  await page.route('**/api/localities/search**', (route) => {
    const q = (new URL(route.request().url()).searchParams.get('q') || '').toLowerCase();
    return route.fulfill({ json: SERVED_LOCALITIES.filter((l) => l.name.toLowerCase().includes(q)) });
  });
}

export async function pickLocality(page, name = 'Baner') {
  await serveLocalities(page);
  await pickLocalityIn(page, active(page).locator('[data-err="locality"]'), name, { domClick: true });
}

export const SOCIETY_PLACEHOLDER = 'Search your society on Google Maps';
export const BUILDING_PLACEHOLDER = 'Building name (as on agreement)';

// These specs run without a server, so the Google-backed picker has nothing to resolve against;
// "Not on Google Maps" plus the building text is the path that never crosses the wire.
export async function fillBuilding(page, name = 'Skyline Heights') {
  const p = active(page);
  await pickSocietyNotOnMaps(page, p.getByPlaceholder(SOCIETY_PLACEHOLDER));
  await p.getByPlaceholder(BUILDING_PLACEHOLDER).fill(name);
}

export async function fillProperty(page, { next = true, gramPanchayat = false } = {}) {
  const p = active(page);
  await p.getByPlaceholder('e.g. B-1204').fill('B-1204');
  await fillBuilding(page);
  await pickLocality(page);
  if (gramPanchayat !== null) await p.getByTestId(gramPanchayat ? 'ra-gram-yes' : 'ra-gram-no').click();
  await p.getByRole('button', { name: 'Taluka', exact: true }).click();
  await page.getByRole('option', { name: 'Haveli', exact: true }).click();
  await p.getByPlaceholder('e.g. Baner, Pune').fill('Baner');
  await p.getByPlaceholder('411045').fill('411045');
  await p.getByPlaceholder('e.g. 850').fill('850');
  if (next) await clickNext(page, 1);
}

export async function fillOwner(page, { docs = true, next = true, aadhaar = AADHAAR.owner } = {}) {
  const p = active(page);
  await p.getByPlaceholder('As per PAN/Aadhaar').first().fill('Anita Verma');
  await p.getByPlaceholder('As per identity proof').first().fill('Shaila Verma');
  await pickDate(page, '[data-err="oDob"]', '1980-01-01');
  await p.getByPlaceholder('If used in older papers').first().fill('Anu');
  await p.getByPlaceholder('ABCDE1234F').first().fill('ABCDE1234F');
  await p.getByPlaceholder('12-digit Aadhaar').first().fill(aadhaar);
  await p.getByPlaceholder('10-digit mobile').first().fill(MOBILE.owner);
  await p.getByPlaceholder('Full permanent address').first().fill('12, MG Road, Pune 411001');
  if (docs) await uploadAll(p, 'owner-doc');
  if (next) await clickNext(page, 2);
}

export async function fillCoOwner(page, scope = active(page), { docs = true } = {}) {
  await scope.getByPlaceholder('As per PAN/Aadhaar').fill('Vikram Verma');
  await scope.getByPlaceholder('As per identity proof').fill('Meera Verma');
  await pickDate(page, '[data-err="c0dob"]', '1977-05-15');
  await scope.getByPlaceholder('If used in older papers').fill('Vikram V');
  await scope.getByPlaceholder('ABCDE1234F').fill('VWXYZ9876L');
  await scope.getByPlaceholder('12-digit Aadhaar').fill(AADHAAR.coOwner);
  await scope.getByPlaceholder('10-digit mobile').fill(MOBILE.coOwner);
  await scope.getByPlaceholder('Full permanent address').fill('12, MG Road, Pune 411001');
  if (docs) await uploadAll(scope, 'co-doc');
}

export async function fillTenant(page, { docs = true, next = true } = {}) {
  const p = active(page);
  await p.getByPlaceholder('As per PAN/Aadhaar').first().fill('Rahul Nair');
  await p.getByPlaceholder('As per identity proof').first().fill('Latha Nair');
  await pickDate(page, '[data-err="t0dob"]', '1995-01-01');
  await p.getByPlaceholder('If used in older papers').first().fill('Rahul');
  await p.getByPlaceholder('ABCDE1234F').first().fill('PQRSX6789K');
  await p.getByPlaceholder('12-digit Aadhaar').first().fill(AADHAAR.tenant);
  await p.getByPlaceholder('10-digit mobile').first().fill(MOBILE.tenant);
  await p.getByPlaceholder('Full permanent address').first().fill('44, FC Road, Pune 411004');
  await fillTenantPolice(page);
  if (docs) await uploadAll(p, 'tenant-doc');
  if (next) await clickNext(page, 3);
}

export async function fillTenantPolice(page, { tenantIndex = 0, family = false, previous = false } = {}) {
  const record = active(page).getByTestId(`tenant-police-record-${tenantIndex}`);
  await record.getByPlaceholder('Company / office address').fill('Draazy Labs, Baner, Pune 411045');
  await record.getByPlaceholder('e.g. Employee ID, offer letter').fill('Employee ID');
  if (previous) {
    await record.getByLabel('Previous address is the same as permanent address').uncheck();
    await record.getByPlaceholder('Flat, building, street, locality').fill('12 Old Market Road, Pune');
    await record.getByPlaceholder('411004').fill('411030');
    await record.getByPlaceholder('e.g. Shivajinagar').fill('Sadashiv Peth');
    await record.getByPlaceholder('e.g. Deccan Police Station').fill('Vishrambaug Police Station');
    await record.getByRole('button', { name: 'Previous address proof type', exact: true }).click();
    await page.getByRole('option', { name: 'Passport', exact: true }).click();
  }
  if (!family) return;
  await record.getByRole('button', { name: 'Add person' }).click();
  const row = record.getByTestId(`tenant-police-occupant-${tenantIndex}-0`);
  await row.getByText('Full name', { exact: true }).locator('xpath=..').locator('input').fill('Sneha Nair');
  await row.getByRole('button', { name: 'Relation', exact: true }).click();
  await page.getByRole('option', { name: 'Spouse', exact: true }).click();
  await row.getByPlaceholder('35').fill('29');
  await row.getByPlaceholder('10-digit mobile').fill('9876543210');
}

// Step 3 in invite mode: name the counterparty instead of typing their details.
export async function inviteTenant(page, mobile) {
  const p = active(page);
  await p.getByText('Invite the tenant', { exact: true }).click();
  await p.getByPlaceholder('10-digit mobile').fill(mobile);
  await clickNext(page, 3);
}

export async function inviteOwner(page, mobile, name = '') {
  const p = active(page);
  await p.getByText("I'm the tenant — invite the owner", { exact: true }).click();
  await p.getByPlaceholder('10-digit mobile').fill(mobile);
  if (name) await p.getByPlaceholder('e.g. Rajesh Deshpande').fill(name);
  await clickNext(page, 2);
}

export async function pickStartDate(page, iso = todayIso()) {
  const p = active(page);
  await p.locator('.dz-datefield').first().click();
  await page.locator('.dz-cal').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: iso, exact: true }).first().click();
  await page.locator('.dz-cal').waitFor({ state: 'detached' });
}

export async function fillTerms(page, { next = true, deposit = '150000' } = {}) {
  const p = active(page);
  await pickStartDate(page);
  await p.getByPlaceholder('e.g. 25000').fill('30000');
  await p.getByPlaceholder('e.g. 100000').fill(deposit);
  await fillDepositPayment(page);
  if (next) await clickNext(page, 4);
}

// The added row starts as UPI for the whole outstanding deposit.
export async function fillDepositPayment(page, { utr = '612345678901' } = {}) {
  const pay = active(page).getByTestId('ra-deposit-payments');
  // A restored draft already carries its rows; adding another would overshoot the deposit.
  if (await pay.getByTestId(/^ra-deposit-payment-/).count()) return;
  await pay.getByRole('button', { name: 'Add payment' }).click();
  const row = pay.getByTestId(/^ra-deposit-payment-/).last();
  await row.getByText('UPI Ref. No. / UTR No.', { exact: true }).locator('xpath=..').locator('input').fill(utr);
  await row.locator('.dz-datefield').click();
  await page.locator('.dz-cal').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: todayIso(), exact: true }).first().click();
  await page.locator('.dz-cal').waitFor({ state: 'detached' });
}

export async function fillWitnesses(page, { next = true } = {}) {
  const rows = [
    { n: 1, name: 'Suresh Patil', aadhaar: AADHAAR.witness1, mobile: MOBILE.witness1, addr: '7, Karve Road, Pune 411004' },
    { n: 2, name: 'Meera Joshi', aadhaar: AADHAAR.witness2, mobile: MOBILE.witness2, addr: '9, JM Road, Pune 411005' },
  ];
  for (const w of rows) {
    const card = active(page).getByTestId(`witness-${w.n}`);
    await card.getByPlaceholder('As per PAN/Aadhaar').fill(w.name);
    await card.getByPlaceholder('e.g. 42').fill('40');
    await card.getByPlaceholder('10-digit mobile').fill(w.mobile);
    await card.getByPlaceholder('12-digit Aadhaar').fill(w.aadhaar);
    await card.getByPlaceholder('Full permanent address').fill(w.addr);
  }
  if (next) await clickNext(page, 5);
}

export async function payAndSubmit(page) {
  await active(page).getByRole('button', { name: /Pay .+ & Submit|Retry payment/ }).click();
}
