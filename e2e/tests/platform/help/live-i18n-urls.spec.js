import { test, expect } from '../../../fixtures/live.js';
import { trackErrors } from '../../../helpers/console.js';

/* Language-prefixed help URLs.
 *
 * The rest of the app is a single-URL SPA — switching language re-renders in
 * place and the address bar never moves. The help centre is the exception,
 * because it is public and exists to be found in search: one URL serving three
 * languages means a crawler indexes whichever it happened to render, and the
 * Hindi and Marathi articles are invisible to the people most likely to search
 * for them.
 *
 * So: `/help/a/x` is English (canonical, unprefixed), `/hi/help/a/x` is Hindi,
 * `/mr/help/a/x` is Marathi. Two failures matter and neither is visible in a
 * build:
 *
 *   - A prefixed URL that renders English anyway. The reader is silently
 *     dropped back to a language they may not read.
 *   - A link inside a prefixed page that loses the prefix. Same outcome, one
 *     click later. `lib/helpUrl.js` exists precisely so no component
 *     concatenates the prefix by hand.
 */

const listen = (page) => {
  const errors = trackErrors(page);
  return errors;
};

async function openHelp(page, path) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });
}

/* Asserts that following a help link did not silently reset the reader's
   language.
 *
 * The naive version of this — click, then expect(html).toHaveAttribute('lang')
 * — cannot fail. HelpLangRoute applies the language in an effect, so for a beat
 * after navigation the DOM still carries the *previous* language; a retrying
 * matcher sees that stale value on its first poll and passes. The first draft of
 * this test did exactly that and went green against a build that had the bug.
 *
 * So wait for the URL first. The prefix is the root cause and it settles
 * synchronously with navigation, which makes it the one signal here with no
 * race. Only once the URL has settled are the language assertions meaningful. */
async function assertLanguageSurvived(page, lang) {
  await page.waitForURL(new RegExp(`/${lang}/help`), { timeout: 15_000 });
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });


  await expect(page.locator('html'), 'the link dropped the reader back to English')
    .toHaveAttribute('lang', lang);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('pnLang')),
      { message: 'the device-wide language preference was overwritten' })
    .toBe(lang);
}

/* Reveals a footer link, expanding its column first if the phone footer has it
   collapsed.
 *
 * The mobile-first work turned each footer column into an accordion that starts
 * closed below `sm` (Footer.jsx `FooterCol`: the panel is `hidden sm:block`).
 * This spec runs on the mobile project as well as chromium, so clicking the FAQ
 * link blind fails on a phone against a footer that is behaving correctly.
 *
 * Clicking the heading is safe at every width: above `sm` the panel is
 * `sm:block` regardless of the open state, so the toggle changes nothing. */
async function revealFooterLink(page, selector) {
  const link = page.locator(`footer ${selector}`).first();
  if (await link.isVisible()) return link;
  await page.locator('footer button', { hasText: /^Company$/ }).first().click();
  await expect(link).toBeVisible();
  return link;
}

const DEVANAGARI = /[\u0900-\u097F]/;

/* Articles that actually have hi/mr translations. An untranslated article
   legitimately falls back to English, so asserting Devanagari on one of those
   would be testing the wrong thing. */
const TRANSLATED_SLUG = 'what-is-punenest';

test.describe('Help URL language prefix', () => {
  for (const lang of ['hi', 'mr']) {
    test(`/${lang}/help renders in ${lang}`, async ({ page }) => {
      const errors = listen(page);
      await openHelp(page, `/${lang}/help`);

      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      /* Retrying assertion, not a bare innerText() read. HelpLangRoute applies
         the language in an effect and the hi/mr namespaces are code-split, so
         the first paint is legitimately English — a one-shot read races that
         and fails intermittently against a perfectly good build. */
      await expect(page.locator('body'), 'prefixed URL never rendered Devanagari')
        .toHaveText(DEVANAGARI, { timeout: 15_000 });
      expect(errors).toEqual([]);
    });

    test(`/${lang}/help/a/${TRANSLATED_SLUG} serves the translated article`, async ({ page }) => {
      await openHelp(page, `/${lang}/help/a/${TRANSLATED_SLUG}`);

      const prose = page.locator('.doc-prose').first();
      await expect(prose).toBeVisible();
      await expect(prose, 'prefixed URL served the English body')
        .toHaveText(DEVANAGARI, { timeout: 15_000 });
    });

    test(`links inside /${lang}/help keep the prefix`, async ({ page }) => {
      await openHelp(page, `/${lang}/help`);

      /* Wait for the language to settle before sampling. HelpLangRoute applies
         the URL's language in an effect, so the very first paint builds links
         with whatever language was previously active — they are briefly
         unprefixed and then corrected. Sampling before that settles makes this
         spec flaky and tests a frame nobody interacts with. */
      await expect(page.locator('html')).toHaveAttribute('lang', lang);

      /* Every internal help link must carry the prefix — including the ones in
         the global footer, which renders on help pages too and used to hardcode
         `/help/faq` and `/help/changelog`. */
      const bad = await page.locator('a[href^="/help"]').evaluateAll(
        (els) => els.map((e) => e.getAttribute('href')),
      );
      expect(bad, `unprefixed help links on a /${lang}/ page: ${bad.join(', ')}`).toEqual([]);
    });

    test(`a footer help link from /${lang}/ does not reset the language`, async ({ page }) => {
      /* Regression test for a real defect, and the reason the href check above
         matters. HelpLangRoute treats the URL as authoritative: landing on an
         unprefixed help route calls changeLanguage('en'), and i18n persists that
         to `pnLang` device-wide. So one footer click used to silently switch the
         entire app to English — not just that page. */
      await openHelp(page, `/${lang}/help`);
      await expect(page.locator('html')).toHaveAttribute('lang', lang);

      const faq = await revealFooterLink(page, 'a[href$="/help/faq"]');
      await faq.click();
      await assertLanguageSurvived(page, lang);
    });

    test(`the navbar help link from /${lang}/ does not reset the language`, async ({ page, login }) => {
      /* The same defect as above, in the second of the two places that link into
         help. Fixing only the footer would have left the account menu — the entry
         point a signed-in reader is most likely to use — still resetting them. */
      await login.asBuyer();
      await openHelp(page, `/${lang}/help`);
      await expect(page.locator('html')).toHaveAttribute('lang', lang);

      await page.getByRole('button', { name: 'Account menu' }).first().click();
      await page.getByRole('link', { name: /help centre/i, exact: false })
        .filter({ has: page.locator('svg') }).first().click();
      await assertLanguageSurvived(page, lang);
    });

    test(`a category page under /${lang}/ resolves`, async ({ page }) => {
      const errors = listen(page);
      await openHelp(page, `/${lang}/help/c/getting-started`);

      expect(await page.locator('a[href*="/help/a/"]').count()).toBeGreaterThan(0);
      expect(errors).toEqual([]);
    });
  }

  test('English stays unprefixed and canonical', async ({ page }) => {
    await openHelp(page, '/help');

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(new URL(page.url()).pathname).toBe('/help');
  });

  test('an untranslated article falls back to English rather than 404ing', async ({ page }) => {
    const errors = listen(page);
    // Only 7 of 31 articles are translated; the rest must degrade, not break.
    await openHelp(page, '/hi/help/a/zero-brokerage');

    await expect(page.locator('.doc-prose').first()).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('Help SEO tags', () => {
  test('an article declares a canonical and hreflang alternates', async ({ page }) => {
    await openHelp(page, `/help/a/${TRANSLATED_SLUG}`);

    // Written client-side by useHelpSeo; without them a crawler indexes one
    // language and treats the other two as duplicates.
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);

    const alternates = await page.locator('link[rel="alternate"][hreflang]').evaluateAll(
      (els) => els.map((e) => e.getAttribute('hreflang')),
    );
    expect(alternates).toEqual(expect.arrayContaining(['en', 'hi', 'mr']));
  });

  test('each language self-canonicalises and points at the others', async ({ page }) => {
    await openHelp(page, `/hi/help/a/${TRANSLATED_SLUG}`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi');

    /* A translated page canonicalises to ITSELF, not to English. Cross-
       canonicalising the hi/mr pages onto /help/... would tell the crawler they
       are duplicates and drop them from the index entirely — the exact outcome
       the prefix scheme exists to avoid. The hreflang cluster, not the
       canonical, is what ties the three together.

       Polled, because `useHelpSeo` writes these tags from an effect keyed on the
       active language: on first paint i18n has not resolved `hi` yet, so the tag
       is briefly the English URL and then corrected. Reading it once caught that
       window about a third of the time. What is being asserted is the settled
       value — the transient one is inherent to client-side head management in an
       SPA, which `useHelpSeo` itself notes is the seam where SSR would plug in. */
    await expect
      .poll(async () => {
        const href = await page.locator('link[rel="canonical"]').getAttribute('href');
        return href && new URL(href, 'http://localhost').pathname;
      }, { message: 'canonical never settled on the Hindi URL' })
      .toBe(`/hi/help/a/${TRANSLATED_SLUG}`);

    // x-default sends an unpublished language to the English version.
    const xDefault = await page.locator('link[rel="alternate"][hreflang="x-default"]').getAttribute('href');
    expect(new URL(xDefault, 'http://localhost').pathname).toBe(`/help/a/${TRANSLATED_SLUG}`);
  });

  test('staff runbooks are marked noindex', async ({ page, login }) => {
    /* Signed in as staff, because the tag is written by the article page and a
       filtered-out article never renders one. A crawler has no staff session, so
       it sees the not-found state — but anyone who does reach the page (and any
       crawler that somehow follows a shared link) must get noindex. */
    await login.asAdmin();
    await openHelp(page, '/help/a/verification-sla');

    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    expect(robots || '').toMatch(/noindex/);
  });
});

test.describe('helpPath is the single source of the prefix rule', () => {
  test('builds and splits prefixes consistently', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const out = await page.evaluate(async () => {
      const { helpPath, splitLangPrefix, normalizeHelpLang, alternateUrls } =
        await import('/src/lib/helpUrl.js');
      return {
        en: helpPath('/help/a/x', 'en'),
        hi: helpPath('/help/a/x', 'hi'),
        mr: helpPath('/help/a/x', 'mr'),
        // A regional tag from the browser must resolve to a supported language.
        regional: helpPath('/help', 'mr-IN'),
        unknown: helpPath('/help', 'fr'),
        splitHi: splitLangPrefix('/hi/help/a/x'),
        splitEn: splitLangPrefix('/help/a/x'),
        // A locality slug that merely starts with "hi" must not be eaten.
        splitFalsePositive: splitLangPrefix('/hinjawadi'),
        norm: normalizeHelpLang('HI'),
        alts: alternateUrls('/help/a/x', 'https://punenest.com').map((a) => a.href),
      };
    });

    expect(out.en).toBe('/help/a/x');
    expect(out.hi).toBe('/hi/help/a/x');
    expect(out.mr).toBe('/mr/help/a/x');
    expect(out.regional).toBe('/mr/help');
    expect(out.unknown).toBe('/help');            // unsupported → canonical
    expect(out.splitHi).toEqual({ lang: 'hi', rest: '/help/a/x' });
    expect(out.splitEn).toEqual({ lang: 'en', rest: '/help/a/x' });
    // `/hinjawadi` is a locality route, not Hindi — the prefix match is anchored
    // to a path boundary precisely so this cannot be mistaken for one.
    expect(out.splitFalsePositive).toEqual({ lang: 'en', rest: '/hinjawadi' });
    expect(out.norm).toBe('hi');
    expect(out.alts).toEqual([
      'https://punenest.com/help/a/x',
      'https://punenest.com/hi/help/a/x',
      'https://punenest.com/mr/help/a/x',
    ]);
  });
});
