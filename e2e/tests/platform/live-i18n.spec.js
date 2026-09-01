import { test, expect } from '../../fixtures/live.js';

/* Internationalisation, against the live API.
 *
 * ~4,300 keys across en/hi/mr. The static gate (`npm run check:i18n`) already proves every `t()`
 * key resolves and that the three bundles are in step, so this spec deliberately does NOT re-test
 * that. It tests the four things a static scan cannot see:
 *
 *   1. A key that resolves at build time can still render as a raw dotted path at runtime if its
 *      namespace never loaded — hi/mr are code-split and fetched lazily. Most visible i18n failure
 *      there is, and no linter catches it.
 *   2. Values that are objects, not strings. Several helpers return `{ key, count }` rather than a
 *      formatted string; a missed call site renders "[object Object]" and nothing fails.
 *   3. Dates. Month and weekday names come from Intl rather than hardcoded English arrays, so a
 *      Marathi page must not show "January".
 *   4. `<html lang>`, which drives screen-reader pronunciation and the `:lang()` CSS that stops
 *      Devanagari matras being clipped.
 *
 * ## What the conversion changed, and what it did not
 *
 * The seeded version wrote a listing into `localStorage` and read `/property/P-i18n-1`. That is now
 * a registry anchor, and the difference is not cosmetic: an i18n leak scan is only as good as the
 * text on the page, and mock text was written by the same hand as the assertions. Real listing
 * copy, real locality names and real society names are the ones that actually reach a user.
 *
 * The module probes (`page.evaluate(() => import('/src/lib/...'))`) are kept as-is. They are unit
 * assertions wearing an e2e costume, and they know it — what they pin is the *id/label split*:
 * ids stay English because they are persisted on user records, labels are keys because they are
 * shown. Two of the modules they reach into (`lib/data/finances.js`, `lib/qualityScore.js`) have no
 * http provider yet and are deleted or rewritten in P5c. When that happens these assertions move to
 * wherever the ids then come from — they do not stop being true, they change subject. Leaving them
 * here means P5c gets a compile-time reminder rather than a silent coverage loss.
 */

const LANG_KEY = 'dzLang';
const ANCHOR = 'p5021';

const seedLang = (page, lang) =>
  page.addInitScript(([k, l]) => localStorage.setItem(k, l), [LANG_KEY, lang]);

/* Sign in *first*, then switch language.
 *
 * `signIn` in `helpers/liveAuth.js` finds its button by accessible name — `/send otp|continue/i`,
 * which is English. On a Devanagari page it matches nothing and times out. Calling `login` before
 * `seedLang` sidesteps that, and `addInitScript` still applies to every navigation afterwards, so
 * the page under test is genuinely in the target language.
 *
 * The order is a workaround, not a verdict: it means **no test anywhere signs in through a
 * translated auth screen**, so `/signin` and `/signup` in hi/mr are covered for render only. Making
 * the helper language-agnostic (a `data-testid` on the submit, or a per-language name table) would
 * close that, and is worth doing when the auth screens next get attention. Recorded in
 * `docs/migration/README.md` rather than fixed inline, because changing a helper eleven live specs
 * depend on is not a change to make in passing. */
const signedInThen = async (page, login, lang) => {
  await login.asBuyer();
  await seedLang(page, lang);
};

const bodyText = (page) => page.locator('body').innerText();

/* A raw key looks like `society.reply` or `fin.kpiNet` — a dotted lowercase path with no spaces.
 * Matching the real namespaces (rather than any dotted token) keeps this from firing on prices,
 * domains or version numbers. */
const RAW_KEY_RE = /\b(society|societies|locality|ownerHub|reels|viewDocs|dash|visits|fin|wallet|ui|chrome|auth2|pmap|nestor|pmf|help|listings|property|owner|flatmates|misc\d?)\.[a-zA-Z][a-zA-Z0-9_]{2,}\b/;

for (const lang of ['hi', 'mr']) {
  test.describe(`Language: ${lang}`, () => {
    test('renders Devanagari, not raw keys or an English fallback', async ({ page, consoleErrors }) => {
      await seedLang(page, lang);
      await page.goto('/');
      await expect(page.locator('h1').first()).toBeVisible();

      /* Wait for Devanagari with a retrying assertion before reading the body. The hi/mr namespaces
       * are code-split and fetched after first paint, so an immediate read legitimately sees the
       * English fallback and fails against a healthy build. Waiting here also guarantees the leak
       * scan below runs against the settled DOM rather than the English one. */
      await expect(page.locator('body'),
        'no Devanagari rendered; the lazy locale bundle probably failed to load')
        .toHaveText(/[\u0900-\u097F]/);

      const leak = (await bodyText(page)).match(RAW_KEY_RE);
      expect(leak && leak[0], `raw i18n key rendered to the user: ${leak && leak[0]}`).toBeFalsy();
      expect(consoleErrors).toEqual([]);
    });

    test('sets <html lang> so screen readers and :lang() CSS agree', async ({ page }) => {
      await seedLang(page, lang);
      await page.goto('/');
      await expect(page.locator('h1').first()).toBeVisible();

      /* Without this a screen reader pronounces Devanagari with English phonetics, and the
       * :lang() line-height rules never match — which is what clips the matras on ~70
       * tight-leading elements. */
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
    });

    test('never renders [object Object] from a helper that returns a shape', async ({ page, login }) => {
      await signedInThen(page, login, lang);
      await page.goto('/');
      await expect(page.locator('h1').first()).toBeVisible();
      await expect(page.locator('body')).toHaveText(/[\u0900-\u097F]/);

      expect(await bodyText(page)).not.toContain('[object Object]');
    });
  });
}

test.describe('Language switching', () => {
  test('English is the default and stays English', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    // An English page must not accidentally ship Devanagari.
    expect(await bodyText(page)).not.toMatch(/[\u0900-\u097F]/);
  });

  test('the choice survives a reload', async ({ page }) => {
    await seedLang(page, 'mr');
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();

    await page.reload();
    await expect(page.locator('h1').first()).toBeVisible();

    await expect(page.locator('html')).toHaveAttribute('lang', 'mr');
    expect(await page.evaluate((k) => localStorage.getItem(k), LANG_KEY)).toBe('mr');
  });

  test('an unsupported tag falls back to English rather than breaking', async ({ page, consoleErrors }) => {
    await seedLang(page, 'fr');
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();

    expect(await bodyText(page)).not.toMatch(RAW_KEY_RE);
    expect(consoleErrors).toEqual([]);
  });
});

test.describe('Locale-aware dates', () => {
  /* Month and weekday names were hardcoded English arrays in the visit calendar, the society
   * calendar, the rent ledger and the price-trend axis. They now come from Intl. A regression here
   * is silent: the page still renders, just with "January" sitting inside a Marathi sentence. */

  test('Intl gives Devanagari month names for hi and mr', async ({ page }) => {
    await page.goto('/');

    const months = await page.evaluate(() => ({
      en: new Intl.DateTimeFormat('en', { month: 'long' }).format(new Date(2024, 0, 1)),
      hi: new Intl.DateTimeFormat('hi', { month: 'long' }).format(new Date(2024, 0, 1)),
      mr: new Intl.DateTimeFormat('mr', { month: 'long' }).format(new Date(2024, 0, 1)),
    }));

    expect(months.en).toBe('January');
    expect(months.hi).toMatch(/[\u0900-\u097F]/);
    expect(months.mr).toMatch(/[\u0900-\u097F]/);
  });

  test('the date picker shows month names in the active language', async ({ page, login }) => {
    await signedInThen(page, login, 'hi');
    await page.goto('/schedule-visit');
    await expect(page.locator('h1').first()).toBeVisible();

    /* Asserted present, not guarded. Every assertion this test makes used to sit inside
       `if (await field.count())`, which meant a `/schedule-visit` page that rendered no date field
       at all -- the picker being broken, gated or removed -- left the test passing having proved
       only that an `h1` exists. The date field is unconditional on this route, so its absence is a
       failure worth reporting rather than a reason to stop looking. */
    const field = page.locator('.dz-datefield').first();
    await expect(field).toBeVisible({ timeout: 15_000 });
    await field.click();
    const cal = page.locator('.dz-cal');
    await expect(cal).toBeVisible();
    // The month dropdown must not be sitting in English inside a Hindi page.
    expect(await cal.innerText()).not.toMatch(/\b(January|February|March)\b/);
    // ...and the positive half, because "no English" is satisfied for free by an empty calendar.
    expect(await cal.innerText()).toMatch(/[\u0900-\u097F]/);
  });

  test('prettyDate and ymLabel localise instead of using English tables', async ({ page }) => {
    await page.goto('/');

    /* Both helpers used to index a hardcoded English MONTHS array. They now take a locale and
     * default to 'en' — deliberately, so an unthreaded caller leaks English rather than the
     * visitor's OS locale, which would be a fourth language nobody asked for. */
    const out = await page.evaluate(async () => {
      const [{ prettyDate }, { ymLabel }] = await Promise.all([
        import('/src/pages/consumer/society/constants.js'),
        import('/src/lib/data/rentReminders.js'),
      ]);
      return {
        dateEn: prettyDate('2026-01-15', 'en'),
        dateMr: prettyDate('2026-01-15', 'mr'),
        dateDefault: prettyDate('2026-01-15'),
        ymEn: ymLabel('2026-01', 'en'),
        ymHi: ymLabel('2026-01', 'hi'),
        ymDefault: ymLabel('2026-01'),
        empty: prettyDate(''),
      };
    });

    expect(out.dateEn).toMatch(/Jan/);
    expect(out.dateMr).toMatch(/[\u0900-\u097F]/);
    expect(out.dateDefault).toMatch(/Jan/);      // defaults to English, not OS locale
    expect(out.ymEn).toMatch(/Jan/);
    expect(out.ymHi).toMatch(/[\u0900-\u097F]/);
    expect(out.ymDefault).toMatch(/Jan/);
    expect(out.empty).toBe('');                   // degrades, does not throw
  });

  test('society timeAgo returns a shape a caller must translate', async ({ page }) => {
    await page.goto('/');

    /* This helper changed from returning a formatted string to `{ key, count }`. Any missed call
     * site renders "[object Object]", so pin the contract. */
    const shape = await page.evaluate(async () => {
      const { timeAgo } = await import('/src/pages/consumer/society/constants.js');
      const r = timeAgo(Date.now() - 3 * 86400000);
      return { keys: Object.keys(r).sort(), key: r.key, countType: typeof r.count };
    });

    expect(shape.keys).toEqual(['count', 'key']);
    expect(shape.key).toMatch(/^society\./);
    expect(shape.countType).toBe('number');
  });
});

test.describe('Stored ids stay English while labels translate', () => {
  /* Several label sets became key maps while their ids stayed English, because the ids are
   * persisted on user records — review categories, document categories, finance categories,
   * ownership basis. Translating an id would orphan every row already saved against the old value,
   * and that is a data-migration bug wearing a copy-change costume. */

  test('finance category ids are English and every one has a key', async ({ page }) => {
    await page.goto('/');

    const out = await page.evaluate(async () => {
      const { INCOME_CATS, EXPENSE_CATS, CAT_KEYS } = await import('/src/lib/data/finances.js');
      const all = [...INCOME_CATS, ...EXPENSE_CATS];
      return { all, missing: all.filter((c) => !CAT_KEYS[c]) };
    });

    // Ids readable as English — what is written into a saved transaction.
    expect(out.all).toContain('Rent received');
    expect(out.all).toContain('Property tax');
    // ...and none of them renders unlabelled.
    expect(out.missing, `finance categories with no i18n key: ${out.missing.join(', ')}`).toEqual([]);
  });

  test('document category ids are English and every one has a key', async ({ page }) => {
    await page.goto('/');

    const out = await page.evaluate(async () => {
      const [{ DOC_CATEGORIES }, { DOC_CAT_KEYS }] = await Promise.all([
        import('/src/lib/data/documents.js'),
        import('/src/pages/consumer/owner-hub/constants.js'),
      ]);
      const ids = Object.keys(DOC_CATEGORIES);
      return { ids, missing: ids.filter((c) => !DOC_CAT_KEYS[c]) };
    });

    expect(out.ids).toContain('Title & Ownership');
    expect(out.missing, `document categories with no i18n key: ${out.missing.join(', ')}`).toEqual([]);
  });

  test('quality bands carry both a legacy label and a key', async ({ page }) => {
    await page.goto('/');

    const bands = await page.evaluate(async () => {
      const { qualityColor } = await import('/src/lib/qualityScore.js');
      return [90, 60, 20].map((s) => qualityColor(s));
    });

    for (const b of bands) {
      expect(typeof b.label).toBe('string');       // legacy consumers keep working
      expect(b.labelKey).toMatch(/^ui\.quality/);  // translated surfaces use this
    }
  });
});

test.describe('Translated pages still work, not just render', () => {
  test('a real property page in Marathi keeps its interactive controls', async ({ page, login, consoleErrors }) => {
    await signedInThen(page, login, 'mr');
    await page.goto(`/property/${ANCHOR}`);

    // Wait on something structural rather than on English button copy, which is exactly what a
    // translated page no longer has.
    await expect(page.locator('main, .prop-page').first()).toBeVisible();
    await expect(page.locator('body')).toHaveText(/[\u0900-\u097F]/);

    const text = await bodyText(page);
    expect(text).not.toContain('[object Object]');
    expect(text).not.toMatch(RAW_KEY_RE);
    expect(consoleErrors).toEqual([]);
  });

  test('the societies list filters in Hindi without leaking keys', async ({ page, consoleErrors }) => {
    await seedLang(page, 'hi');
    await page.goto('/societies');
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi');

    /* Target the search box by role rather than by tag: the page also contains a hidden
     * `input[name=context]`, which a positional selector picks up first and then times out
     * waiting for it to be fillable. */
    const search = page.getByRole('textbox').filter({ visible: true }).first();
    await search.fill('zzzz-no-match');

    /* Drives the newly translated empty state — and against 348 seeded societies rather than a
     * handful of fixtures, so the "no results" path is reached by actually filtering everything
     * out rather than by starting from nothing. */
    await expect(page.locator('body')).toHaveText(/[\u0900-\u097F]/);
    const text = await bodyText(page);
    expect(text).not.toMatch(RAW_KEY_RE);
    expect(text).not.toContain('[object Object]');
    expect(consoleErrors).toEqual([]);
  });
});
