import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, uniqueMobile, signedInAs, uploadedListingPhotos } from '../../../helpers/liveAuth.js';
import { approveListingWithFetch, rejectListingWithFetch } from '../../../helpers/moderation.js';

const created = new Set();

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) };
}

async function actor(name) {
  const mobile = uniqueMobile();
  const headers = await authHeaders(mobile);
  const res = await api('PATCH', '/auth/me', headers, { name });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { mobile, headers };
}

async function listing() {
  const owner = await actor('Zztest Landlord');
  const res = await api('POST', '/me/listings', owner.headers, {
    title: `Zztest tenancy-declaration ${Date.now()}`,
    deal: 'rent',
    propertyType: 'Flat',
    price: 21000,
    city: 'Pune',
    locality: 'Baner',
    bhk: 2,
    area: 900,
    images: await uploadedListingPhotos(owner.headers),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  created.add(res.body.id);

  const approved = await approveListingWithFetch(res.body.id, await authHeaders(ACTORS.admin));
  expect(approved.status).toBe(200);

  return { owner, id: res.body.id, ref: res.body.slug || res.body.id };
}

async function open(page, ref) {
  await page.goto(`/property/${ref}?tab=amenities`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.querySelectorAll('.reveal,.fade-up,.fade-in').forEach((el) => el.classList.add('visible')));
  await expect(page.getByRole('heading', { name: /ratings/i })).toBeVisible({ timeout: 20000 });
}

async function rateOpensComposer(page) {
  const dialog = page.getByRole('dialog', { name: 'Rate this property' });
  try {
    await page.getByRole('button', { name: 'Rate this property' }).click({ timeout: 5000 });
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    return true;
  } catch {
    return false;
  }
}

test.afterEach(async () => {
  if (!created.size) return;
  const headers = await authHeaders(ACTORS.admin);
  for (const id of created) {
    await rejectListingWithFetch(id, headers, {
      reason: 'Zztest cleanup \u2014 synthetic tenancy-declaration fixture',
    });
  }
  created.clear();
});

test('a stay only counts once the owner confirms it — and stops counting when they withdraw', async ({ page, browser }) => {
  const { owner, ref } = await listing();
  const resident = await actor('Zztest Resident');
  expect(resident.mobile, 'the two actors minted the same mobile').not.toBe(owner.mobile);

  const residentCtx = await browser.newContext();
  const residentPage = await residentCtx.newPage();
  try {
    await signedInAs(residentPage, resident.mobile);
    await open(residentPage, ref);

    const declare = residentPage.getByTestId('tenancy-declare');
    await expect(declare).toBeVisible();
    await Promise.all([
      residentPage.waitForResponse((r) => /\/api\/properties\/[^/]+\/tenancy-declarations$/.test(r.url())
        && r.request().method() === 'POST'),
      declare.getByRole('button', { name: 'I lived here' }).click(),
    ]);
    // 2. Claimed, unanswered, and therefore worth nothing. The anti-loophole assertion: if declaring
    //    alone opened the composer, the owner's confirmation would be decoration.
    await expect(residentPage.getByTestId('tenancy-declaration-pending')).toBeVisible();
    expect(await rateOpensComposer(residentPage), 'a pending claim opened the review composer').toBe(false);
    // The owner sees the claim on their own listing, with a name and no phone number.
    await signedInAs(page, owner.mobile);
    // 5. Withdrawal actually withdraws. A confirmation an owner cannot take back is not a decision,
    //    it is a trap — and this is the half a "does the button appear" test never reaches.
    await open(page, ref);
    const claims = page.getByTestId('tenancy-claims');
    await expect(claims).toBeVisible();
    await expect(claims).toContainText('Zztest Resident');
    await expect(claims).not.toContainText(resident.mobile);

    await claims.getByRole('button', { name: `Confirm` }).first().click();
    await expect(claims.getByText('Confirmed')).toBeVisible();

    await open(residentPage, ref);
    await expect(residentPage.getByTestId('tenancy-declare')).toHaveCount(0);
    expect(await rateOpensComposer(residentPage), 'a confirmed claim did not open the review composer').toBe(true);
    // Owner withdrawal matters; a non-revocable confirmation would trap residents.
    await open(page, ref);
    await page.getByTestId('tenancy-claims').getByRole('button', { name: 'Withdraw' }).first().click();
    await expect(page.getByTestId('tenancy-claims').getByText('Not confirmed')).toBeVisible();

    await open(residentPage, ref);
    await expect(residentPage.getByTestId('tenancy-declaration-revoked')).toBeVisible();
    expect(await rateOpensComposer(residentPage), 'a withdrawn claim still opened the review composer').toBe(false);
  } finally {
    await residentCtx.close();
  }
});

test('an owner is never offered a claim on their own listing', async ({ page }) => {
  // The owner is already barred from reviewing their own flat, so without this they would be shown
  // a button whose only possible outcome is a refusal from a rule they cannot do anything about.
  const { owner, ref } = await listing();
  await signedInAs(page, owner.mobile);
  await open(page, ref);
  await expect(page.getByTestId('tenancy-declare')).toHaveCount(0);
});
