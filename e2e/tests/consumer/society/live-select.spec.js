import { test, expect } from '@playwright/test';
import { API, signedInAs } from '../../../helpers/liveAuth.js';

// Society "select or create" typeahead on the list-property Location step.
// Verifies a listing binds to a real society ENTITY (verified pick) and that an
// unknown name mints a community society + shows the pending-verification hint.

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const MOBILE = '9876543211';

/**
 * `/list-property` is behind `ProtectedRoute`, and the mock copy of this spec got in by writing
 * `puneNestUser` to localStorage. That is not a session: with no token `AuthContext` starts at
 * `loading`, `GET /auth/me` answers 401, the user is nulled and the route redirects to
 * `/signin?next=/list-property`. `.lp-meter` — which `ListProperty.jsx` renders unconditionally —
 * then never appears, so the wait below timed out on every test in the file.
 *
 * `signedInAs` runs the real OTP sign-in. `POST /auth/login` auto-registers an unknown mobile as a
 * buyer, so this number needs no seed row of its own. The Aadhaar fixture the mock version wrote
 * alongside is dropped: nothing on this step gates on the badge (ADR-019).
 */
async function gotoForm(page) {
  await signedInAs(page, MOBILE);
  await page.goto(`${BASE}/list-property`);
  await page.waitForSelector('.lp-meter', { timeout: 10000 });
}

async function toStep2Flat(page) {
  await gotoForm(page);
  await page.locator('[data-err="propertyType"]').click();
  /* `Select` portals its menu and only flips `portalOpen` one requestAnimationFrame after the open
     (Select.jsx:178); until then it is `opacity: 0; pointer-events: none` (dropdown.css:198). */
  await expect(page.locator('.pn-dropdown__menu.is-portal-open')).toBeVisible();
  await page.locator('.pn-dropdown__option', { hasText: 'Flat / Apartment' }).first().click();
  await page.locator('input[data-err="carpetArea"]').fill('1200');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.getByText('Location & pricing').waitFor({ timeout: 10000 });
}

test('typing a known name lists the verified society and binds it on pick', async ({ page }) => {
  await toStep2Flat(page);
  const society = page.locator('input[data-err="society"]');
  await society.click();
  await society.fill('Skyline');
  const option = page.locator('.pn-dropdown__option', { hasText: 'Skyline Heights' }).first();
  await expect(option).toBeVisible();
  await expect(option.getByText('Verified')).toBeVisible();
  await option.click();
  await expect(society).toHaveValue('Skyline Heights');
  await expect(page.getByText(/Verified society/i)).toBeVisible();
});

/**
 * The mint reaches the shared catalogue, not the lister's own browser.
 *
 * This assertion used to read `localStorage.pnCommunitySocieties` and pass — which is exactly how
 * the defect survived a *live* spec. `SocietySelect.createSociety` called `store.addCommunitySociety`
 * unconditionally, so on a live deployment the owner was congratulated, the wizard bound `societyId`
 * to an id Postgres had never heard of, and the listing persisted pointing at nothing. Nobody else
 * could find the building and ops got no candidate to verify. A spec that inspects the same browser
 * that did the writing cannot tell that apart from working, so the read-back is deliberately made
 * by `request` — a different HTTP client, with no session and no access to the page's storage.
 *
 * `mintOrigin` is checked because it is the field that distinguishes this surface from the Society
 * Finder: `Admin ▸ Societies ▸ Candidates` renders "From a listing" and "Searcher demand"
 * differently, and until this change no caller sent it. Note that `listing` is also
 * `SocietyMintService`'s default for an absent value, so this assertion is a guard on the rendered
 * provenance rather than a proof that the client sent the field — the assertion that can only pass
 * if the client sends it is the `demand` one, over in `live-society-minting.spec.js`.
 */
test('an unknown name can be added inline and reaches the shared catalogue', async ({ page, request }) => {
  await toStep2Flat(page);
  const society = page.locator('input[data-err="society"]');
  // Unique per run: `POST /societies` is a mint-or-match, so a fixed name would be a 201 on the
  // first run of a fresh database and a 200 against a row some earlier run left behind — and the
  // `mintOrigin` assertion below would then be reading the *earlier* run's value.
  const NAME = `Zz Live Select ${Date.now().toString(36)}`;
  await society.click();
  await society.fill(NAME);
  const addRow = page.getByTestId('society-add-option');
  await expect(addRow).toBeVisible();
  await addRow.click();
  await expect(society).toHaveValue(NAME);
  await expect(page.getByText(/pending verification/i)).toBeVisible();

  // Outside the browser: an anonymous reader searching the catalogue finds the building.
  const found = await request.get(`${API}/societies`, { params: { q: NAME, size: 20 } });
  expect(found.status()).toBe(200);
  const row = (await found.json()).content.find((s) => s.name === NAME);
  expect(row, 'the minted society is absent from the catalogue — the write never left the browser').toBeTruthy();
  expect(row.source).toBe('community');
  expect(row.verifiedAt).toBeNull();
  expect(row.mintOrigin).toBe('listing');
});
