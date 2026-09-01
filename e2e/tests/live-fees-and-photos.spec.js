/**
 * LIVE integration check for the last two service domains to reach the toggle: `fees` and `photo`.
 *
 * Excluded from the default run (`playwright.config.js` `testIgnore`); needs a backend on :8081
 * under the `dev,e2e` profiles and the `draazy_e2e` database. Run it explicitly:
 *
 *   cd e2e; npx playwright test tests/live-fees-and-photos.spec.js --config=playwright.config.js
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
 * `R__DML_seed_reference_data.sql`; they are asserted *as rendered* precisely because a regression that
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
import { appReady } from '../helpers/app.js';
import { signedInAs, signedInAsNew } from '../helpers/liveAuth.js';

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

    const sidebar = page.locator('aside, [class*="sticky"]').filter({ hasText: /Draazy Service Fee/i }).first();
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

    const sidebar = page.locator('aside, [class*="sticky"]').filter({ hasText: /Draazy Service Fee/i }).first();
    await expect(sidebar).toBeVisible({ timeout: 20_000 });

    // "Estimated Total" is the visible trace of the wizard having derived stamp duty and
    // registration itself, which it must, because the published row says NULL for both. If someone
    // backfills those columns with a flat figure this flips to "Total Payable" and the test fails —
    // which is the point: it would mean quoting a per-agreement statutory charge as a fixed price.
    await expect(sidebar).toContainText(/estimated total/i);
    await expect(sidebar).not.toContainText(/total payable/i);
  });

  /**
   * The two marketing surfaces that quote this fee before the visitor ever opens the wizard.
   *
   * They were both wrong, and wrong in the direction that matters: `FEE_DEFAULTS
   * .rentAgreementPlatform` is 500, the seeded `platform_fees('rent')` row is 1999, so the pricing
   * page and the referral pitch each advertised ₹500 for a charge the wizard would put at ₹1,999.
   * `Plans.jsx`'s own header already described exactly this failure for the *plan* prices — "the
   * customer was shown ₹999 and billed ₹2,499" — and then listed the rent-agreement fee among the
   * charges the back-office panel "genuinely owns", which it never did.
   *
   * `/plans` is public, which is also the state the visitor it exists to convince is in, and the
   * state in which being quoted a wrong price does the most damage. `/refer` is behind
   * `ProtectedRoute` (`App.jsx:190`) — the first draft of this test navigated to it signed out and
   * got the home page with the sign-in modal over it, which is worth recording because the body
   * text it collected contained neither figure and so would have "passed" the negative assertion
   * on its own.
   */
  test('the pricing page quotes the published fee, not the local default', async ({ page }) => {
    await page.goto('/plans');

    // The panel that names the charge in body copy, and FAQ 4, which repeats it. Asserting the page
    // rather than one node because the figure is interpolated into a translated string in one place
    // and a bare span in the other — the shared fact is the number, not where it sits.
    const body = page.locator('body');
    await expect(body).toContainText(RENT_FEES.serviceFee, { timeout: 20_000 });

    // The stale figure must be gone, not merely joined. A page that showed both would still be
    // quoting a price it does not charge, and a test that only looked for the right number would
    // pass on it.
    await expect(body).not.toContainText('₹500');
  });

  test('the referral pitch quotes the published fee for the agreement it gives away', async ({ page }) => {
    // Signed in, because `/refer` is protected — and because the reward it advertises is a free
    // rent agreement, so the figure has to be the one the wizard would have charged this account.
    await signedInAs(page, OWNER.mobile);
    await page.goto('/refer');

    const body = page.locator('body');
    await expect(body).toContainText(RENT_FEES.serviceFee, { timeout: 20_000 });
    await expect(body).not.toContainText('₹500');

    // Proof the assertion above ran against the referral page and not a redirect to sign-in, which
    // is the failure mode that produced the first draft's misleading green on the negative half.
    await expect(body).toContainText(/refer/i);
  });
});

test.describe('Photos — the listing wizard uploads to the server (live)', () => {
  test('stores the file through /me/photos and renders the URL the server returned', async ({ page }) => {
    /* A fresh account, not the seeded owner, and the reason is the whole point of this describe.
       `OWNER` holds four listings against a free-tier allowance of one, which is deliberate — a
       whole spec (`live-listing-quota.spec.js`) is built on that fixture to prove the paywall — and
       the paywall replaces the wizard entirely. This test is about `/me/photos`, not about who may
       post, so it needs an owner who can get to step 3 rather than one who is being sold a plan.
       Signing in as the seeded owner used to work only because the quota was never enforced on the
       server; when it started being enforced this failed with "no step-1 inputs", which named the
       symptom and not the cause. */
    await signedInAsNew(page);

    /* The photo input lives on step 3 of the wizard, and `uploadPhoto` has exactly one caller in the
       app (`useListingMedia.js`), so there is no cheaper screen to reach it from.

       Step 1 is seeded through the draft the wizard already restores from (`dzDraft:list-property`,
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
      localStorage.setItem('dzDraft:list-property', JSON.stringify({
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
     expect(url).toMatch(/^\/api\/dev\/storage\/public\//);

     // The gallery shows the server's URL rather than a local preview kept alongside it, and the
     // same-origin dev public store now resolves it through the Vite proxy. `toBeVisible`, rather
     // than just attached, catches a regression back to a host the browser cannot load (D246).
     await expect(page.locator(`img[src="${url}"]`).first()).toBeVisible();
  });
});

/**
 * `pricing` — the platform's own price list, and the third domain to belong in this file.
 *
 * Same shape of bug as `fees` above, one layer further up. The rent-agreement sidebar priced the
 * agreement in the browser; this priced the *product*. Every plan card, paywall, checkout line and
 * referral target read `fee()` out of `lib/store/billing.js`, which consulted a browser-local admin
 * document and fell back to a `FEE_DEFAULTS` constant compiled into the bundle. No signed-out
 * visitor has that document, so live, every price Draazy quoted came from the constant — and an
 * operator who changed a price in the back office was told it saved, and it did save, and nothing
 * read it.
 *
 * The reason this needs a live spec rather than the five backend tests on `GET /pricing` is that the
 * failure is **designed to be invisible**. `PricingProvider` seeds its state with `PRICING_DEFAULTS`
 * so the first paint is never blank, which is right for a checkout and fatal for a test: a browser
 * that never issues the request renders exactly the same numbers as one whose request succeeded.
 * Asserting a figure therefore proves nothing on its own. Both tests below are built around that —
 * the first waits on the response so a silent failure times out instead of passing, and the second
 * compares what is on screen against what that very response carried, rather than against a literal.
 *
 * Signed out throughout: `GET /pricing` is `permitAll`, and a visitor deciding whether to pay is the
 * reader the endpoint exists for.
 */
test.describe('Pricing — the product quotes the database, not the bundle (live)', () => {
  test('an anonymous visitor gets the published price list', async ({ request }) => {
    const res = await request.get('http://localhost:8081/api/pricing');
    expect(res.status(), 'no token, no session').toBe(200);
    const prices = await res.json();

    /* Every key the provider hands to `fee()`. Asserted as a set rather than one at a time because
       a missing key is not a missing price on screen — `fee()` coerces `undefined` to 0 and renders
       "₹0", which on a plan card reads as free rather than as broken. */
    expect(Object.keys(prices).sort()).toEqual([
      'featuredListing', 'gstPercent', 'ownerPlanYearly', 'ownerProYearly',
      'rentAgreementPlatform', 'seekerPlusTopup',
    ]);
    for (const [key, value] of Object.entries(prices)) {
      expect(typeof value, `${key} is a number`).toBe('number');
      expect(value, `${key} is positive`).toBeGreaterThan(0);
    }
  });

  test('the plans page renders the figures that request returned, not the bundled fallback', async ({ page }) => {
    /* Armed before the navigation. This is the whole test: if the browser never asks — the exact
       state the product shipped in — this times out. Asserting on rendered text alone could not
       tell that state apart from a working one, because the fallback constant and the seeded row
       currently agree, and are meant to. */
    const asked = page.waitForResponse(
      (r) => r.url().includes('/api/pricing') && r.request().method() === 'GET',
      { timeout: 20000 },
    );
    await page.goto('/plans');
    const res = await asked;
    expect(res.status()).toBe(200);
    const prices = await res.json();

    /* Read off the response rather than hardcoded, so this test cannot rot into a second copy of
       the price list — which is the duplication that caused the original bug. Indian grouping is
       not every-three-digits (2499 → "2,499"), so format the same way the provider does. */
    const rupees = (n) => '₹' + Number(n).toLocaleString('en-IN');

    /* The FAQ, not a plan card. A card's price is overridden by the `plans` catalogue when that
       table has the row, so it is the wrong witness — it can be right while `usePricing()` is
       broken. FAQ 5 interpolates `fee('ownerPlanYearly')` and `fee('ownerProYearly')` directly and
       nothing else feeds it. It lives in a collapsed <details>, so open it before asserting
       visibility rather than asserting on hidden text. */
    const faq = page.locator('details').filter({ hasText: /per year/i }).first();
    await expect(faq).toBeVisible({ timeout: 20000 });
    await faq.locator('summary').click();

    await expect(faq).toContainText(rupees(prices.ownerPlanYearly));
    await expect(faq).toContainText(rupees(prices.ownerProYearly));
  });

  /**
   * The other half of the contract: a page that quotes no price must not ask for the price list.
   *
   * `PricingProvider` lives in `ConsumerLayout`, so it is mounted on every consumer route, but the
   * only five screens that render a figure from it are route-level. It used to fetch on mount,
   * which spent a request on the home page, on search and on every property detail — none of which
   * can display the answer. `usePricing()` now raises `active` instead, so the read happens on the
   * first route that has a use for it.
   *
   * **Both halves assert a count, not a boolean.** "The home page did not fetch" and "the home page
   * fetched twice" are equally consistent with any assertion that merely waits for an event, and
   * `/plans` fetching *once* is the claim worth defending — the provider, not the hook, is what
   * dedupes, so a regression that loses `activate`'s referential stability or lets a second priced
   * component force a re-run would slip past `toBeGreaterThan(0)`.
   *
   * The `/plans` half is not decoration either. A zero on the home page is equally consistent with
   * the fetch having been **deleted** rather than deferred, and a deleted fetch is the original bug
   * above — every price quoted from the bundle — coming back wearing this optimisation as a
   * disguise.
   *
   * Reached by a second `goto` rather than by clicking. The transition this change actually
   * altered is the client-side one — provider mounted and inactive, user clicks through — and a
   * fresh document load does not exercise it. But the only link to `/plans` lives inside the
   * navbar's collapsible drawer, so clicking through would couple a pricing spec to nav chrome and
   * buy a flaky test for a distinction the two counts below already make: a full load still proves
   * the read was deferred rather than deleted, and still proves it happens once. What is left
   * uncovered is the first-paint window on an in-app navigation, which is a rendering question
   * rather than a request-count one — see the note on it in `PricingContext`.
   */
  test('the home page never asks for the price list; /plans then asks exactly once', async ({ page }) => {
    let asks = 0;
    page.on('request', (r) => {
      if (r.method() === 'GET' && r.url().includes('/api/pricing')) asks += 1;
    });

    await page.goto('/');
    /* `appReady()` and not `networkidle`: this app's own helper documents that Vite's module graph
       finishes downloading about a second *before* `main.jsx` evaluates, so `networkidle` resolves
       against an empty document and would prove nothing. The flag is set on the last statement
       before `createRoot().render()`. The combobox on top of it, because a mounted root is still
       not a flushed effect — and an effect is what the count below is about. */
    await appReady(page);
    await expect(page.locator('input[role="combobox"]').first()).toBeVisible({ timeout: 20000 });
    expect(asks, 'home renders no price, so it must not fetch the price list').toBe(0);

    /* Armed before the navigation. The request is several hops behind the paint — consumer effect →
       `setActive` → provider re-render → provider effect → an `await` on the provider resolver
       before anything reaches the wire — so a locator wait can win the race and assert on a count
       that is about to become 1. A spec that goes intermittently red on a correct product is worse
       than no spec at all here. */
    const asked = page.waitForRequest(
      (r) => r.method() === 'GET' && r.url().includes('/api/pricing'),
      { timeout: 20000 },
    );
    await page.goto('/plans');
    await asked;
    await expect(page.locator('details').filter({ hasText: /per year/i }).first())
      .toBeVisible({ timeout: 20000 });
    expect(asks, 'the read is deferred, not deleted — and it happens once').toBe(1);
  });
});
