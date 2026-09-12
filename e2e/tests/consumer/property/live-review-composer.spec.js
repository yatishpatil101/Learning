import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, uniqueMobile, signedInAs } from '../../../helpers/liveAuth.js';

/* The property review composer's rating controls — accessible names (D198), on a real eligibility.
 *
 * ## The bug
 *
 * `StarInput` renders a `<button>` whose only child is an SVG. An SVG contributes nothing to a
 * button's accessible name, so before this every star in the dialog was announced as bare "button".
 * `ReviewModal` mounts six strips — one overall, five per-aspect — so that is thirty
 * indistinguishable buttons: a screen-reader user could not tell one star from five, or Value from
 * Condition, and no reading order recovers it. Unlike a missing label on a lone icon button, there
 * is no surrounding text to infer from.
 *
 * The assertions are deliberately name-based rather than count-based. A count proves labels exist;
 * only the names prove they say the right thing, which is the half that was actually wrong — six
 * strips all answering to "3 star" would satisfy any count.
 *
 * ## Why it moved to live
 *
 * Not because the claim is about the seam — an accessible name is the same string whichever provider
 * fed the page. Because the *precondition* was. The composer only opens for a signed-in non-owner
 * with a completed visit or a confirmed tenancy, and the mock version bought that eligibility by
 * writing a `dzTenancies:<mobile>` bucket into localStorage. Nothing on the live path writes that
 * bucket; it is the very bucket whose dead read was D194. So the spec asserted thirty labels inside
 * a dialog it opened through a door that does not exist in production, and it would have gone on
 * passing after that door was bricked up — the dialog would simply never open live, and a spec whose
 * every assertion is scoped to `dialog` reports nothing when the dialog is absent.
 *
 * Here the tenancy is a real row: the resident claims the stay, the owner confirms it, and the
 * composer opens because `TenancyService` says it may. The a11y assertions are unchanged. What
 * changed is that they now run behind the same gate a real reviewer passes through, so if that gate
 * closes this fails loudly instead of quietly asserting nothing.
 *
 * The eligibility walk itself — pending is not enough, withdrawal takes it back — belongs to
 * `live-tenancy-declaration.spec.js` and is not repeated. This file assumes it and looks inside.
 */

const PROP_ASPECTS = ['Locality', 'Condition', 'Value', 'Owner', 'Accuracy'];

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

/* A fresh approved listing with a resident whose stay the owner has confirmed.
 *
 * Built entirely over HTTP. The owner's half of this is two clicks in a panel that
 * `live-tenancy-declaration.spec.js` already drives and asserts; doing it again through a second
 * browser context would add a context, a sign-in and a page load per run to re-prove a covered
 * claim. What this file needs from the owner is a `confirmed` row, and `POST /confirm` is the same
 * call the panel makes.
 *
 * Fresh rather than seeded because it is written to: a confirmed tenancy left on P5013 would be
 * visible to the read-only specs that assert against the seeded catalogue. */
async function eligibleResident() {
  const owner = await actor('Zztest Composer Landlord');
  const made = await api('POST', '/me/listings', owner.headers, {
    title: `Zztest review-composer ${Date.now()}`,
    deal: 'rent',
    propertyType: 'Flat',
    price: 23000,
    city: 'Pune',
    locality: 'Baner',
    bhk: 2,
    area: 900,
  });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  const id = made.body.id;
  const ref = made.body.slug || id;
  created.add(id);

  const admin = await authHeaders(ACTORS.admin);
  const approved = await api('PATCH', `/properties/${id}/status`, admin, { status: 'approved' });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);

  const resident = await actor('Zztest Composer Resident');
  /* `uniqueMobile()` is `97` + the low 8 digits of `Date.now()`, so two calls in the same
     millisecond return the same number — and one person confirming their own tenancy would satisfy
     every assertion below. Unlikely given the awaits, so checked rather than assumed. */
  expect(resident.mobile, 'the two actors minted the same mobile').not.toBe(owner.mobile);

  const claim = await api('POST', `/properties/${id}/tenancy-declarations`, resident.headers, {
    livedFrom: '2024-01-01',
    livedTo: '2024-12-31',
  });
  expect(claim.status, JSON.stringify(claim.body)).toBe(201);
  expect(claim.body.status, 'a claim is worth nothing until the owner answers').toBe('pending');

  const ok = await api('POST', `/tenancy-declarations/${claim.body.id}/confirm`, owner.headers);
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  expect(ok.body.status).toBe('confirmed');

  return { resident, ref, id, declarationId: claim.body.id };
}

test.afterEach(async () => {
  if (!created.size) return;
  const headers = await authHeaders(ACTORS.admin);
  for (const id of created) {
    await api('PATCH', `/properties/${id}/status`, headers, {
      status: 'rejected',
      reason: 'Zztest cleanup \u2014 synthetic review-composer fixture',
    });
  }
  created.clear();
});

test('every star in the property review composer names its value and its aspect', async ({ page }) => {
  const { resident, ref, id, declarationId } = await eligibleResident();
  await signedInAs(page, resident.mobile);

  const declarationsRead = page.waitForResponse((response) => (
    response.request().method() === 'GET'
    && response.url().includes(`/properties/${id}/tenancy-declarations`)
  ));

  /* `?tab=amenities`: the reviews block is mounted by PropertyTabs only while that tab is current,
     so on the default Overview tab the "Rate this property" button does not exist at all. */
  await page.goto(`/property/${ref}?tab=amenities`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.querySelectorAll('.reveal,.fade-up,.fade-in').forEach((el) => el.classList.add('visible')));

  const declarationResponse = await declarationsRead;
  expect(declarationResponse.status(), 'the page read the resident’s declaration from the live API').toBe(200);
  const declarations = await declarationResponse.json();
  expect(declarations.content, 'the live declaration endpoint keeps its PageResponse content envelope').toEqual(
    expect.arrayContaining([expect.objectContaining({ id: declarationId, status: 'confirmed' })]),
  );

  const rateButton = page.getByRole('button', { name: 'Rate this property' });
  await expect(rateButton).toBeVisible();
  // The section has rendered and its live declaration read has completed. This absence is therefore
  // not a first-paint false green: a confirmed resident must not still be invited to declare again.
  await expect(page.getByTestId('tenancy-declare')).toHaveCount(0);
  await rateButton.click();
  const dialog = page.getByRole('dialog', { name: 'Rate this property' });
  // Not a formality. The dialog opening is the assertion that the confirmed tenancy actually bought
  // eligibility — every assertion after this one is scoped to `dialog` and would report nothing at
  // all if it never opened, which is exactly how the mock version managed to stay green.
  await expect(dialog, 'a confirmed tenancy did not open the review composer').toBeVisible({ timeout: 15_000 });

  /* `exact` on the overall strip. `getByRole`'s name match is a substring one, so a plain "3 star"
     also resolves to the five "3 star for …" rows — the same trap the society composer's specs
     document, and the reason the aspect suffix exists rather than a numeric index. */
  await expect(dialog.getByRole('button', { name: '3 star', exact: true })).toHaveCount(1);

  for (const aspect of PROP_ASPECTS) {
    await expect(dialog.getByRole('button', { name: `3 star for ${aspect}` })).toHaveCount(1);
  }

  // Six strips × five stars, every one of them named: nothing left announcing itself as "button".
  await expect(dialog.getByRole('button', { name: /star/ })).toHaveCount(30);
});
