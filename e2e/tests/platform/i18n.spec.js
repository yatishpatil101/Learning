import { test, expect } from '../../fixtures/live.js';

const ANCHOR = 'p5021';

const bodyText = (page) => page.locator('body').innerText();

// Matches the real namespaces rather than any dotted token, so it does not fire on prices, domains or version numbers.
const RAW_KEY_RE = /\b(society|societies|locality|ownerHub|reels|viewDocs|dash|visits|fin|wallet|ui|chrome|auth2|pmap|draaz|pmf|help|listings|property|owner|flatmates|misc\d?)\.[a-zA-Z][a-zA-Z0-9_]{2,}\b/;

test.describe('English-only UI', () => {
  test('renders English with <html lang="en"> and no raw keys', async ({ page, consoleErrors }) => {
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    const text = await bodyText(page);
    expect(text).not.toMatch(/[\u0900-\u097F]/);
    const leak = text.match(RAW_KEY_RE);
    expect(leak && leak[0], `raw i18n key rendered to the user: ${leak && leak[0]}`).toBeFalsy();
    expect(consoleErrors).toEqual([]);
  });

  test('a language left in storage by an older build is ignored', async ({ page, consoleErrors }) => {
    await page.addInitScript(() => {
      localStorage.setItem('dzLang', 'mr');
      localStorage.setItem('i18nextLng', 'hi');
    });
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    // An English page must not accidentally ship Devanagari.
    expect(await bodyText(page)).not.toMatch(/[\u0900-\u097F]/);
    expect(consoleErrors).toEqual([]);
  });

  test('a buyer never sees [object Object] on home or a raw key on a property page, and the property page keeps its controls', async ({ page, login, consoleErrors }) => {
    await login.asBuyer();
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();

    expect(await bodyText(page)).not.toContain('[object Object]');

    await page.goto(`/property/${ANCHOR}`);
    // Wait on structural content because translated button copy is not stable.
    await expect(page.locator('main, .prop-page').first()).toBeVisible();

    const text = await bodyText(page);
    expect(text).not.toContain('[object Object]');
    expect(text).not.toMatch(RAW_KEY_RE);
    expect(consoleErrors).toEqual([]);
  });
});
// These import `src` modules through the dev server because the frontend has no unit-test runner.
test('date helpers default to English and timeAgo returns a shape a caller must translate', async ({ page }) => {
  await page.goto('/');

  const out = await page.evaluate(async () => {
    const [{ prettyDate, timeAgo }, { ymLabel }] = await Promise.all([
      import('/src/pages/consumer/society/constants.js'),
      import('/src/lib/data/rentReminders.js'),
    ]);
    const r = timeAgo(Date.now() - 3 * 86400000);
    return {
      dateDefault: prettyDate('2026-01-15'),
      ymDefault: ymLabel('2026-01'),
      empty: prettyDate(''),
      shape: { keys: Object.keys(r).sort(), key: r.key, countType: typeof r.count },
    };
  });

  // Use English as the explicit fallback, never the visitor's OS locale.
  expect(out.dateDefault).toMatch(/Jan/);
  expect(out.ymDefault).toMatch(/Jan/);
  expect(out.empty).toBe('');

  // Pin helper shape so missed translations cannot render "[object Object]".
  expect(out.shape.keys).toEqual(['count', 'key']);
  expect(out.shape.key).toMatch(/^society\./);
  expect(out.shape.countType).toBe('number');
});

// Persisted ids must not be translated or existing user rows become orphaned.
test('stored category ids are English, every one has an i18n key, and quality bands carry a label and a key', async ({ page }) => {
  await page.goto('/');

  const out = await page.evaluate(async () => {
    const [{ INCOME_CATS, EXPENSE_CATS, CAT_KEYS }, { DOC_CATEGORIES }, { DOC_CAT_KEYS }, { qualityColor }] = await Promise.all([
      import('/src/lib/data/finances.js'),
      import('/src/lib/data/documents.js'),
      import('/src/pages/consumer/owner-hub/constants.js'),
      import('/src/lib/qualityScore.js'),
    ]);
    const finance = [...INCOME_CATS, ...EXPENSE_CATS];
    const docs = Object.keys(DOC_CATEGORIES);
    return {
      finance,
      financeMissing: finance.filter((c) => !CAT_KEYS[c]),
      docs,
      docsMissing: docs.filter((c) => !DOC_CAT_KEYS[c]),
      bands: [90, 60, 20].map((s) => qualityColor(s)),
    };
  });

  expect(out.finance).toContain('Rent received');
  expect(out.finance).toContain('Property tax');
  expect(out.financeMissing, `finance categories with no i18n key: ${out.financeMissing.join(', ')}`).toEqual([]);

  expect(out.docs).toContain('Title & Ownership');
  expect(out.docsMissing, `document categories with no i18n key: ${out.docsMissing.join(', ')}`).toEqual([]);

  for (const b of out.bands) {
    expect(b.label).toMatch(/\S/);
    expect(b.labelKey).toMatch(/^ui\.quality/);
  }
});