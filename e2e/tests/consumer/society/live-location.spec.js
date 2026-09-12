import { test, expect } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAs, signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';

/* Society Hub — location.
 *
 * This file used to carry one test and a long note explaining why it could not carry six: the
 * resident location-correction flow "has no backend". That note is now out of date. The flow
 * reaches the server as a `kind: 'location'` society proposal — `useSocietyHub.js` calls
 * `proposeSocietyChange`, the http provider POSTs `/societies/{slug}/proposals`, an approval writes
 * `lat`, `lng`, `placeId` and `locSource` onto the society, and `getSocietyProposals` reads the
 * pending row back. So the missing tests come back, but only three of the five, and none of them
 * the way the mock spec wrote them. Two reasons, and the second is the interesting one.
 *
 * FIRST: the server half is already proved, better, by `tests/live-society-proposals.spec.js` —
 * the resident gate and the anonymous refusal (its "a stranger cannot post the group link at all"
 * and "the queue is staff-only, and proposing needs an account"), the out-of-Pune pin ("a pin in
 * another city is refused"), the finality of a decision, and the approved write reaching
 * `locSource: 'community'` ("an approved pin moves the society and says a neighbour moved it").
 * Re-asserting those through a browser is the same claim by a slower route — and the mock spec
 * asserted three of them by importing `/src/lib/store.js` into the page, a door that answers
 * without the server being involved at all. Those are deleted, not ported.
 *
 * SECOND, and this is why the sixth test is missing rather than merely redundant: **the pin the
 * page draws is not the pin the server holds.** `useSocietyHub` builds `soc` from
 * `resolveSociety(slug)` — the bundled 348-row catalogue in `data/societies*.js` — and nothing
 * merges the society detail response over it. `soc.lat`, `soc.lng` and `soc.locSource`, which are
 * exactly the three fields an approved correction writes, are read from a JS module. An approved
 * pin therefore cannot change what a stranger is navigated to, or make the "Pin confirmed by a
 * verified resident" caption appear, until the catalogue itself migrates. A browser test asserting
 * it would be asserting the bundle. The claim lives at `live-society-proposals.spec.js:193` and
 * stays there; the mock-retirement note records the catalogue as the unmigrated half.
 *
 * What is genuinely live here, and is what the three tests below are about, is the *membership*
 * read that decides who is offered the correction, the POST the dialog makes, and the pending row
 * read back from the server afterwards.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

/* Three catalogue societies, one per test, all present both in the bundled catalogue (so the hub
   renders the Location tab rather than the `_generic` placeholder, which has no location at all)
   and in the seeded database (so residency can be established against a real row). A *minted*
   society is not in the catalogue and so has no Location tab — which is why nothing here mints.
   One each because the live database resets once per run rather than once per test, and a
   residency granted in one test is still granted in the next. */
const SEEDED = 'skyline-heights-baner';                       // read-only; pin 18.5602 / 73.7861
const RESIDENT_SOC = 'aster-heights-rachana-bavdhan';         // receives a pending correction
const STRANGER_SOC = 'aster-heights-rohan-kondhwa';           // never written to

/* Inside the Pune bounds the server enforces — the rejection case belongs to the API spec. */
const FIX = { lat: 18.5088, lng: 73.7651 };

/** The seeded platform admin — the account that holds `societies:write`. */
const OPS = '9000000000';

async function newMobile() {
  const mobile = uniqueMobile();
  await authHeaders(mobile); // login auto-registers, and caches the token for the calls below
  return mobile;
}

/** Verify `mobile` into a flat the long way round, through the ops queue — as the API spec does. */
async function makeResident(request, mobile, slug, flat) {
  const applied = await request.post(`${API}/societies/${slug}/residents`, {
    headers: await authHeaders(mobile),
    data: { flat, relation: 'owner' },
  });
  expect(applied.status(), await applied.text()).toBe(200);
  const { id } = await applied.json();
  const decided = await request.patch(`${API}/societies/${slug}/residents/${id}`, {
    headers: await authHeaders(OPS),
    data: { status: 'verified' },
  });
  expect(decided.status(), await decided.text()).toBe(200);
}

/** The Location tab, waited for by its own heading rather than by the page's. */
function locationSection(page) {
  return page.locator('section', { has: page.getByRole('heading', { name: /Location & connectivity/i }) });
}

async function gotoLocation(page, slug) {
  await page.goto(`${BASE}/society/${slug}?tab=location`);
  const section = locationSection(page);
  await expect(section.getByRole('link', { name: /Get directions/i })).toBeVisible({ timeout: 15_000 });
  return section;
}

const suggest = (section) => section.getByRole('button', { name: /Suggest correct location/i });

test('society hub shows a Get-directions deep link to the society coordinates', async ({ page }) => {
  await page.goto(`${BASE}/society/${SEEDED}?tab=location`);
  await expect(page.getByRole('heading', { level: 1, name: /Skyline Heights/i })).toBeVisible({ timeout: 15_000 });

  const dir = locationSection(page).getByRole('link', { name: /Get directions/i });
  await expect(dir).toBeVisible({ timeout: 8000 });

  /* The coordinates are asserted literally rather than read back out of the page, so that a
     catalogue which silently drops `lat`/`lng` and lets the map fall back to a city centre cannot
     satisfy this by agreeing with itself. They match the seeded row exactly. */
  await expect(dir).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=18\.5602,73\.7861/);
  await expect(dir).toHaveAttribute('target', '_blank');
  await expect(dir).toHaveAttribute('rel', /noopener/);
});

test('a verified resident is offered the correction, and the pending row is read back from the server', async ({ page, request }) => {
  const resident = await newMobile();
  await makeResident(request, resident, RESIDENT_SOC, 'A-101');
  await signedInAs(page, resident);

  /* The control appearing is itself a live assertion: `iAmResident` comes from
     `getSocietyMembership`, so this account's flat had to survive the round trip for the button to
     render at all. The stranger test below is the row that makes it falsifiable. */
  const section = await gotoLocation(page, RESIDENT_SOC);
  await expect(suggest(section)).toBeVisible({ timeout: 10_000 });
  await suggest(section).click();

  const dialog = page.getByRole('dialog', { name: /Suggest.*location/i });
  await expect(dialog).toBeVisible({ timeout: 8000 });

  /* Badge-not-gate (ADR-019). This account has a verified *flat* and no Aadhaar badge, and the
     form opens anyway. The absence below is not vacuous: the dialog above is the positive anchor,
     and an identity wall would have taken this click instead of the form. */
  await expect(page.getByRole('dialog', { name: /Aadhaar/i })).toHaveCount(0);

  await dialog.getByLabel(/Latitude/i).fill(String(FIX.lat));
  await dialog.getByLabel(/Longitude/i).fill(String(FIX.lng));
  const [lodged] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/societies\/.+\/proposals/.test(r.url()), { timeout: 15_000 }),
    dialog.getByRole('button', { name: /Submit for review/i }).click(),
  ]);
  expect(lodged.status(), await lodged.text()).toBe(201);
  expect((await lodged.json()).status).toBe('pending');
  await expect(section.getByText(/Location fix under review/i)).toBeVisible({ timeout: 8000 });

  /* The load-bearing half, and the one the mock twin could not reach. The chip above could be
     drawn from the response still sitting in component state; after a full reload the only place
     it can come from is `getSocietyProposals`, i.e. the server. This is the assertion that fails
     if the POST is accepted and dropped. */
  await page.reload();
  const fresh = locationSection(page);
  await expect(fresh.getByText(/Location fix under review/i)).toBeVisible({ timeout: 15_000 });
});

test('a signed-in stranger is not offered the correction at all', async ({ page }) => {
  await signedInAsNew(page);

  /* The adversarial row: this account is signed in and would clear any check weaker than
     residency — the same shape of account as the one above, differing only in having no verified
     flat in this building. `Get directions` is the positive anchor `gotoLocation` waits on, so a
     Location tab that failed to render cannot pass this by rendering nothing. */
  const section = await gotoLocation(page, STRANGER_SOC);
  await expect(suggest(section)).toHaveCount(0);
  await expect(section.getByText(/Location fix under review/i)).toHaveCount(0);
});
