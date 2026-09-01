/**
 * LIVE integration check for the last two service domains to reach the toggle: `fees` and `photo`.
 *
 * Excluded from the default run (`playwright.config.js` `testIgnore`); needs a backend on :8081
 * under the `dev,e2e` profiles and the `punenest_e2e` database. Run it explicitly:
 *
 *   cd e2e; npx playwright test tests/live-fees-and-photos.spec.js --config=playwright.live.config.js
 *
 * ## Why these two share a file
 *
 * Neither was a backend gap. `docs/migration/04-modules.md` had `fees` down as "likely backed by a
 * `lib/` fee calc … possibly a backend gap to close", and `photo` as "prove the http provider" —
 * and both providers turned out to be written, correct and simply never switched on. What was
 * actually missing was a test, which is the only thing that can turn "there is an http provider"
 * into "the http provider works". So the two are proved together rather than each carrying a file
 * that would say the same thing twice.
 *
 * ## What each half is guarding
 *
 * **`fees`** — the rent-agreement sidebar used to price the agreement in the browser: stamp duty
 * from the Art. 36A formula, registration from a ₹500/₹1,000 rule, the service fee from a mock
 * back-office panel. The server bills from its published `platform_fees('rent')` row. Two different
 * pieces of code, two different data sources, one number on screen and a different number charged —
 * agreeing only by luck. The figures below (`₹1,999` service fee, `₹360` GST) are the seeded row in
 * `R__seed_reference_data.sql`; they are asserted *as rendered* precisely because a regression that
 * quietly re-derived them locally would still render *something*, and only a figure traceable to
 * the database can tell the two apart.
 *
 * The second test is the more important one. `stamp_duty` and `registration` are NULL for the
 * `rent` row (V52 dropped their NOT NULL) because Maharashtra duty is 0.25% of a consideration
 * built from rent, term and deposit — a per-agreement number that one column cannot hold. A
 * provider that coerced NULL to 0 would show a customer "Stamp Duty ₹0" for a statutory charge they
 * are certainly going to pay. So the spec asserts the total is labelled an **estimate**, which is
 * the visible consequence of the wizard having had to derive those two itself, and would disappear
 * the moment someone "fixed" the nulls.
 *
 * **`photo`** — the create-listing wizard's uploader. `photoProvider.js` posts multipart to
 * `/me/photos` and expects `{ url }` back. The gallery renders whatever URL it is handed, so a
 * broken upload is not a blank screen but a broken image, which no mock-mode spec can see: in mock
 * mode the "upload" is a `FileReader` producing a `data:` URL that always renders. The assertion
 * that matters is therefore about the *shape* of the URL — it must come from the server, not from
 * this browser — plus the round trip actually serving the bytes back.
 *
 * Note the backend here runs with `STORAGE_ENABLED=false`, so `MockFileStorage` writes through
 * `DevObjectStore` and hands back a URL this backend serves itself. That is deliberate: this spec
 * is about the wizard reaching the server at all, and requiring R2 credentials to run it would make
 * a routine e2e run depend on a vendor account. The R2 half is proven separately and directly by
 * `MePhotosLiveTest` and `MePersonalDocumentsLiveTest` against the real sandbox.
 */
import { test, expect } from '@playwright/test';
import { signedInAs } from '../helpers/liveAuth.js';

/* The seeded owner the other live specs use — the wizard is behind auth, and `/me/photos` is scoped
   by the caller's token, so this has to be a real account. */
const OWNER = { mobile: '9470744469', name: 'Meera Deshpande' };

/** The seeded `platform_fees('rent')` row. Changing these means changing the seed, not the test. */
const RENT_FEES = { serviceFee: '₹1,999', gst: '₹360' };

/** A 1×1 PNG. Small enough to be inline, real enough that the server's content sniffing accepts it. */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('Fees — the rent-agreement sidebar prices from the server (live)', () => {
  test('shows the published service fee and GST, not a locally derived pair', async ({ page }) => {
    // `GET /fees` is public (`security: []`), so this runs signed out — which is also the state the
    // visitor it exists to convince is actually in.
    await page.goto('/services/rent-agreement');

    const sidebar = page.locator('aside, [class*="sticky"]').filter({ hasText: /PuneNest Service Fee/i }).first();
    await expect(sidebar).toBeVisible({ timeout: 20_000 });

    // The two figures the server owns outright. Neither is derived anywhere in the browser any
    // more, so either one being wrong means the read is not reaching `platform_fees`.
    await expect(sidebar).toContainText(RENT_FEES.serviceFee);
    await expect(sidebar).toContainText(RENT_FEES.gst);

    // And the panel is not in its "charges unavailable" state — which would otherwise let a
    // completely failed read pass a test that only looked for the absence of a wrong number.
    await expect(sidebar).not.toContainText(/couldn't load our current charges/i);
  });

  test('calls the total an estimate, because the statutory pair is NULL by design', async ({ page }) => {
    await page.goto('/services/rent-agreement');

    const sidebar = page.locator('aside, [class*="sticky"]').filter({ hasText: /PuneNest Service Fee/i }).first();
    await expect(sidebar).toBeVisible({ timeout: 20_000 });

    // "Estimated Total" is the visible trace of the wizard having derived stamp duty and
    // registration itself, which it must, because the published row says NULL for both. If someone
    // backfills those columns with a flat figure this flips to "Total Payable" and the test fails —
    // which is the point: it would mean quoting a per-agreement statutory charge as a fixed price.
    await expect(sidebar).toContainText(/estimated total/i);
    await expect(sidebar).not.toContainText(/total payable/i);
  });
});

test.describe('Photos — the listing wizard uploads to the server (live)', () => {
  test('stores the file through /me/photos and renders the URL the server returned', async ({ page }) => {
    await signedInAs(page, OWNER.mobile);

    /* The photo input lives on step 3 of the wizard, and `uploadPhoto` has exactly one caller in the
       app (`useListingMedia.js`), so there is no cheaper screen to reach it from.

       Step 1 is seeded through the draft the wizard already restores from (`pnDraft:list-property`,
       the same key `geocode.spec.js` seeds), because those answers are radio buttons and chips that
       would take a dozen clicks to say nothing interesting.

       Step 2 is mostly typed, because the step as a whole cannot be seeded: `useFormDraft` restores
       `form` but not `locationSet`, and `useListProperty` fails step 2 with `err.location` until the
       pin has been placed in *this* session. That is the map gate, and the cheap way through it is
       the area search — `runMapSearch` matches a known Pune locality against its own coordinate
       table before it ever calls Google ("instant, works offline"), so 'Baner' places the pin with
       no network at all. The address fields are typed *after* the search on purpose: the pin move
       kicks off a reverse-geocode that fills whatever is still blank, and typing afterwards both
       wins and marks the fields as owner-edited so a late-landing lookup leaves them alone. The
       values are asserted before Next so a clobber fails here rather than as a mystery on step 2. */
    await page.addInitScript(() => {
      localStorage.setItem('pnDraft:list-property', JSON.stringify({
        propertyType: 'flat', bhk: '2 BHK', bathrooms: '2', carpetArea: '850', deal: 'rent',
        // Step 2's one unseedable-by-typing field: `availableFrom` is a `DateField`, a button that
        // opens a calendar dialog rather than a text input. It is a plain form value like any
        // other, so the draft carries it; only `locationSet` resists this treatment.
        availableFrom: '2026-09-01',
      }));
    });
    await page.goto('/list-property');

    /* Wait for the draft to have actually landed before touching Next.
       `useFormDraft` restores from localStorage in an effect, so the first paint is the empty form
       and the restore is a second render a tick later. Clicking straight away raced that re-render:
       Playwright resolved the Next button, then spent fifteen seconds watching it move as the
       restored fields changed the height of everything above it, and failed with "element is not
       stable" rather than anything that named the cause.
       Asserting a restored value is the honest wait -- it is true exactly when the restore is done,
       and it also catches a draft that silently failed to load, which would otherwise surface much
       later as a confusing validation error on step 2. */
    await expect(page.locator('input[data-err="carpetArea"]')).toHaveValue('850');

    const next = page.getByRole('button', { name: /Next Step/i });
    await next.click();

    await page.getByRole('combobox', { name: /Search a locality/i }).fill('Baner');
    await page.getByRole('button', { name: 'Search location' }).click();

    const step2 = {
      flatNumber: 'A-701',
      society: 'Live Spec Residency',
      pincode: '411045',
      monthlyRent: '32000',
      deposit: '100000',
    };
    for (const [field, value] of Object.entries(step2)) {
      await page.locator(`input[data-err="${field}"]`).fill(value);
    }
    // The money fields render themselves grouped (`32,000`), so compare on digits alone.
    for (const [field, value] of Object.entries(step2)) {
      const actual = await page.locator(`input[data-err="${field}"]`).inputValue();
      expect(actual.replace(/,/g, ''), `step 2 field ${field} was overwritten`).toBe(value);
    }

    await next.click();

    // The wizard's photo input. `accept` is a hint only, so the input is found by type rather than
    // by any label that a redesign would rename.
    const input = page.locator('input[type="file"][accept*="image"]').first();
    await expect(input).toBeAttached({ timeout: 20_000 });

    const upload = page.waitForResponse(
      (r) => r.url().includes('/me/photos') && r.request().method() === 'POST',
    );
    await input.setInputFiles({ name: 'living-room.png', mimeType: 'image/png', buffer: PNG_1PX });

    const res = await upload;
    expect(res.status()).toBe(201);
    const { url } = await res.json();

    // The decisive assertion. In mock mode `uploadPhoto` hands back a `data:` URL built by a
    // `FileReader` in this tab — which renders perfectly and proves nothing. A URL the server
    // minted cannot be a data URL, and that difference is the whole of what this test is for.
    expect(url).toBeTruthy();
    expect(url.startsWith('data:')).toBe(false);
    expect(url).toMatch(/^https?:\/\//);

    /* What this test deliberately does NOT do is fetch the URL back and compare bytes. Under the
       dev storage bean the object really is written, but `MockFileStorage.storePublic` mints it on
       `https://mock.storage.local/`, a host that does not resolve — and that is on purpose, not an
       oversight: listing photos are persisted on the listing row, so the fake host is the shape
       already sitting in the database. The bytes-come-back claim belongs to the storage provider
       and is made against the real bucket in `R2FileStorageLiveTest`; asserting it here would only
       be asserting which bean happened to be wired. */

    // The gallery shows the server's URL rather than a local preview kept alongside it. Attached,
    // not visible: the image cannot actually load from the fake host, so a broken <img> may lay out
    // at zero size — the claim being made is about the `src` the app chose, which is what fails if
    // it ever falls back to a data URL.
    await expect(page.locator(`img[src="${url}"]`).first()).toBeAttached();
  });
});
