import { test, expect } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAs, signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';

/* Scope: the membership read, the correction POST and the pending row read back. Server-side
   proposal rules and the catalogue-sourced pin belong to `live-society-proposals.spec.js`. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

/* Catalogue-and-seeded societies, so the Location tab renders and residency has a real row to
   attach to. One per test because the database resets per run, not per test. */
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

  /* Literal coordinates, not read back out of the page: a catalogue that drops `lat`/`lng` and
     falls back to a city centre would otherwise satisfy this by agreeing with itself. */
  await expect(dir).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=18\.5602,73\.7861/);
  await expect(dir).toHaveAttribute('target', '_blank');
  await expect(dir).toHaveAttribute('rel', /noopener/);
});

test('a verified resident is offered the correction, and the pending row is read back from the server', async ({ page, request }) => {
  const resident = await newMobile();
  await makeResident(request, resident, RESIDENT_SOC, 'A-101');
  await signedInAs(page, resident);

  /* The control appearing is itself a live assertion: `iAmResident` comes from
     `getSocietyMembership`, so the flat had to survive the round trip for it to render. */
  const section = await gotoLocation(page, RESIDENT_SOC);
  await expect(suggest(section)).toBeVisible({ timeout: 10_000 });
  await suggest(section).click();

  const dialog = page.getByRole('dialog', { name: /Suggest.*location/i });
  await expect(dialog).toBeVisible({ timeout: 8000 });

  /* Badge-not-gate (ADR-019): a verified flat with no identity badge still opens the form, and an
     identity wall would have taken this click. */
  await expect(page).not.toHaveURL(/\/verify-identity/);

  await dialog.getByLabel(/Latitude/i).fill(String(FIX.lat));
  await dialog.getByLabel(/Longitude/i).fill(String(FIX.lng));
  const [lodged] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/societies\/.+\/proposals/.test(r.url()), { timeout: 15_000 }),
    dialog.getByRole('button', { name: /Submit for review/i }).click(),
  ]);
  expect(lodged.status(), await lodged.text()).toBe(201);
  expect((await lodged.json()).status).toBe('pending');
  await expect(section.getByText(/Location fix under review/i)).toBeVisible({ timeout: 8000 });

  /* The chip above could be drawn from component state; after a reload it can only come from
     `getSocietyProposals`, so this fails if the POST is accepted and dropped. */
  await page.reload();
  const fresh = locationSection(page);
  await expect(fresh.getByText(/Location fix under review/i)).toBeVisible({ timeout: 15_000 });
});

test('a signed-in stranger is not offered the correction at all', async ({ page }) => {
  await signedInAsNew(page);

  /* Signed in and would clear any check weaker than residency. `Get directions` is the positive
     anchor `gotoLocation` waits on, so a Location tab that never rendered cannot pass this. */
  const section = await gotoLocation(page, STRANGER_SOC);
  await expect(suggest(section)).toHaveCount(0);
  await expect(section.getByText(/Location fix under review/i)).toHaveCount(0);
});
