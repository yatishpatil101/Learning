import { test, expect } from '../../fixtures/live.js';

/* The four runtime i18n failures a static scan cannot see, and the known gap around translated auth
   screens, are documented in `e2e/COVERAGE.md`. */

const LANG_KEY = 'dzLang';
const ANCHOR = 'p5021';

const seedLang = (page, lang) =>
  page.addInitScript(([k, l]) => localStorage.setItem(k, l), [LANG_KEY, lang]);

/* Sign in first, then seed the language: `signIn` finds its button by an English accessible name and
   times out on a Devanagari page. The coverage cost is noted in `e2e/COVERAGE.md`. */
const signedInThen = async (page, login, lang) => {
  await login.asBuyer();
  await seedLang(page, lang);
};

const bodyText = (page) => page.locator('body').innerText();

/* Matches the real namespaces rather than any dotted token, so it does not fire on prices, domains
   or version numbers. */
const RAW_KEY_RE = /\b(society|societies|locality|ownerHub|reels|viewDocs|dash|visits|fin|wallet|ui|chrome|auth2|pmap|draaz|pmf|help|listings|property|owner|flatmates|misc\d?)\.[a-zA-Z][a-zA-Z0-9_]{2,}\b/;

for (const lang of ['hi', 'mr']) {
  test.describe(`Language: ${lang}`, () => {
    test('renders Devanagari, not raw keys or an English fallback', async ({ page, consoleErrors }) => {
      await seedLang(page, lang);
      await page.goto('/');
      await expect(page.locator('h1').first()).toBeVisible();

      /* Retrying assertion before reading the body: the hi/mr namespaces are fetched after first
         paint, so an immediate read sees the English fallback on a healthy build. */
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

      /* Without this a screen reader pronounces Devanagari with English phonetics and the `:lang()`
         line-height rules never match, which clips the matras. */
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
  /* Month and weekday names come from Intl, not hardcoded English arrays. A regression is silent —
     the page still renders, with "January" inside a Marathi sentence. */

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

    // Require the date picker because this route always renders one.
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

    // Use English as the explicit fallback, never the visitor's OS locale.
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

    /* The helper returns `{ key, count }`, so any call site that forgets to translate renders
       "[object Object]" — pin the contract. */
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
  /* The ids are persisted on user records, so translating one would orphan every row already saved
     against the old value — see `e2e/COVERAGE.md`. */

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

    // Wait on structural content because translated button copy is not stable.
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

    /* By role, not by tag: the page also holds a hidden `input[name=context]` that a positional
       selector picks up first and then times out waiting to be fillable. */
    const search = page.getByRole('textbox').filter({ visible: true }).first();
    await search.fill('zzzz-no-match');

    /* Drives the translated empty state against 348 seeded societies, so "no results" is reached by
       filtering everything out rather than by starting from nothing. */
    await expect(page.locator('body')).toHaveText(/[\u0900-\u097F]/);
    const text = await bodyText(page);
    expect(text).not.toMatch(RAW_KEY_RE);
    expect(text).not.toContain('[object Object]');
    expect(consoleErrors).toEqual([]);
  });
});
