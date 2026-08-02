import { test, expect } from '@playwright/test';
import { OWNER, SEEKER, seed, publishListing, propertyListing } from '../helpers/app.js';

/* Internationalisation.
 *
 * ~4,300 keys across en/hi/mr. The static gates (`npm run check:i18n`) already
 * prove every `t()` key resolves and that the three bundles are in step, so
 * these specs deliberately do NOT re-test that. They test the things a static
 * scan cannot see:
 *
 *   1. A key that resolves at build time can still render as a raw dotted path
 *      at runtime if its namespace never loaded (hi/mr are code-split and
 *      fetched lazily). That is the single most visible i18n failure and the
 *      one no linter catches.
 *   2. Values that are objects, not strings. Several helpers were changed to
 *      return `{ key, count }` instead of a formatted string; a missed call site
 *      renders "[object Object]" and nothing fails.
 *   3. Dates. Month and weekday names now come from Intl rather than hardcoded
 *      English arrays, so a Marathi page must not show "January".
 *   4. `<html lang>`, which drives screen-reader pronunciation and the
 *      `:lang()` CSS that stops Devanagari matras being clipped. */

const LANG_KEY = 'pnLang';

/** Boot the app with a language already chosen, before React mounts. */
async function seedLang(page, lang) {
  await page.addInitScript(([k, l]) => localStorage.setItem(k, l), [LANG_KEY, lang]);
}

const listen = (page) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
};

/** Visible text of the page body, for leak scans. */
const bodyText = (page) => page.locator('body').innerText();

/* A raw key looks like `society.reply` or `fin.kpiNet` — a dotted lowercase
   path with no spaces. Matching the real namespaces (rather than any dotted
   token) keeps this from firing on prices, domains or version numbers. */
const RAW_KEY_RE = /\b(society|societies|locality|ownerHub|reels|viewDocs|dash|visits|fin|wallet|ui|chrome|auth2|pmap|nestor|pmf|help|listings|property|owner|flatmates|misc\d?)\.[a-zA-Z][a-zA-Z0-9_]{2,}\b/;

for (const lang of ['hi', 'mr']) {
  test.describe(`Language: ${lang}`, () => {
    test('renders Devanagari, not raw keys or English fallback', async ({ page }) => {
      const errors = listen(page);
      await seedLang(page, lang);
      await seed(page, {});
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });

      /* Wait for Devanagari with a retrying assertion before reading the body.
         The hi/mr namespaces are code-split and fetched after first paint, so
         an immediate read legitimately sees the English fallback and fails
         against a healthy build. Waiting here also guarantees the leak scan
         below runs against the settled DOM rather than the English one. */
      await expect(page.locator('body'),
        'no Devanagari rendered; the lazy locale bundle probably failed to load')
        .toHaveText(/[\u0900-\u097F]/, { timeout: 15_000 });

      const text = await bodyText(page);

      // No key leaked through as a literal path.
      const leak = text.match(RAW_KEY_RE);
      expect(leak && leak[0], `raw i18n key rendered to the user: ${leak && leak[0]}`).toBeFalsy();

      expect(errors).toEqual([]);
    });

    test('sets <html lang> so screen readers and :lang() CSS agree', async ({ page }) => {
      await seedLang(page, lang);
      await seed(page, {});
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });

      /* Without this, a screen reader pronounces Devanagari with English
         phonetics and the :lang() line-height rules never match — which is what
         clips the matras on ~70 tight-leading elements. */
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
    });

    test('never renders [object Object] from a helper that returns a shape', async ({ page }) => {
      await seedLang(page, lang);
      await seed(page, { user: SEEKER });
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });

      expect(await bodyText(page)).not.toContain('[object Object]');
    });
  });
}

test.describe('Language switching', () => {
  test('English is the default and stays English', async ({ page }) => {
    await seed(page, {});
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    // An English page must not accidentally ship Devanagari.
    expect(await bodyText(page)).not.toMatch(/[\u0900-\u097F]/);
  });

  test('the choice survives a reload', async ({ page }) => {
    await seedLang(page, 'mr');
    await seed(page, {});
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });

    await expect(page.locator('html')).toHaveAttribute('lang', 'mr');
    expect(await page.evaluate((k) => localStorage.getItem(k), LANG_KEY)).toBe('mr');
  });

  test('an unsupported tag falls back to English rather than breaking', async ({ page }) => {
    const errors = listen(page);
    await seedLang(page, 'fr');
    await seed(page, {});
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });

    expect(await bodyText(page)).not.toMatch(RAW_KEY_RE);
    expect(errors).toEqual([]);
  });
});

test.describe('Locale-aware dates', () => {
  /* Month and weekday names were hardcoded English arrays in the visit calendar,
     the society calendar, the rent ledger and the price-trend axis. They now come
     from Intl. A regression here is silent: the page still renders, just with
     "January" sitting inside a Marathi sentence. */

  test('Intl gives Devanagari month names for hi and mr', async ({ page }) => {
    await seed(page, {});
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const months = await page.evaluate(() => ({
      en: new Intl.DateTimeFormat('en', { month: 'long' }).format(new Date(2024, 0, 1)),
      hi: new Intl.DateTimeFormat('hi', { month: 'long' }).format(new Date(2024, 0, 1)),
      mr: new Intl.DateTimeFormat('mr', { month: 'long' }).format(new Date(2024, 0, 1)),
    }));

    expect(months.en).toBe('January');
    expect(months.hi).toMatch(/[\u0900-\u097F]/);
    expect(months.mr).toMatch(/[\u0900-\u097F]/);
  });

  test('the date picker shows month names in the active language', async ({ page }) => {
    await seedLang(page, 'hi');
    await seed(page, { user: SEEKER });
    await page.goto('/schedule-visit', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });

    const field = page.locator('.pn-datefield').first();
    if (await field.count()) {
      await field.click();
      const cal = page.locator('.pn-cal');
      await expect(cal).toBeVisible({ timeout: 10_000 });
      // The month dropdown must not be sitting in English inside a Hindi page.
      expect(await cal.innerText()).not.toMatch(/\b(January|February|March)\b/);
    }
  });

  test('prettyDate and ymLabel localise instead of using English tables', async ({ page }) => {
    await seed(page, {});
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    /* Both helpers used to index a hardcoded English MONTHS array. They now take
       a locale and default to 'en' — deliberately, so an unthreaded caller leaks
       English rather than the visitor's OS locale (a fourth language). */
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
    await seed(page, {});
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    /* This helper changed from returning a formatted string to `{ key, count }`.
       Any missed call site renders "[object Object]", so pin the contract. */
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
  /* Several label sets became key maps while their ids stayed English, because
     the ids are persisted on user records — review categories, document
     categories, finance categories, ownership basis. Translating an id would
     orphan every row already saved against the old value. */

  test('finance category ids are English and every one has a key', async ({ page }) => {
    await seed(page, {});
    await page.goto('/', { waitUntil: 'domcontentloaded' });

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
    await seed(page, {});
    await page.goto('/', { waitUntil: 'domcontentloaded' });

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
    await seed(page, {});
    await page.goto('/', { waitUntil: 'domcontentloaded' });

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
  test('a property page in Marathi keeps its interactive controls', async ({ page }) => {
    const errors = listen(page);
    await seedLang(page, 'mr');
    await seed(page, { user: SEEKER });
    await publishListing(page, propertyListing({ id: 'P-i18n-1', ownerMobile: OWNER.mobile }));
    await page.goto('/property/P-i18n-1', { waitUntil: 'domcontentloaded' });

    // Wait on something structural rather than on English button copy, which is
    // exactly what a translated page no longer has.
    await expect(page.locator('main, .prop-page').first()).toBeVisible({ timeout: 30_000 });

    const text = await bodyText(page);
    expect(text).toMatch(/[\u0900-\u097F]/);
    expect(text).not.toContain('[object Object]');
    expect(text).not.toMatch(RAW_KEY_RE);
    expect(errors).toEqual([]);
  });

  test('the societies list filters in Hindi without leaking keys', async ({ page }) => {
    const errors = listen(page);
    await seedLang(page, 'hi');
    await seed(page, {});
    await page.goto('/societies', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi');

    /* Target the search box by its accessible name rather than by tag: the page
       also contains a hidden `input[name=context]`, which a positional selector
       picks up first and then times out waiting for it to be fillable. */
    const search = page.getByRole('textbox').filter({ visible: true }).first();
    await search.fill('zzzz-no-match');
    await page.waitForTimeout(500);

    // Drives the newly translated empty state.
    const text = await bodyText(page);
    expect(text).toMatch(/[\u0900-\u097F]/);
    expect(text).not.toMatch(RAW_KEY_RE);
    expect(text).not.toContain('[object Object]');
    expect(errors).toEqual([]);
  });
});
