/* FAQ translations against the live API (D2).
 *
 * The help page has always been able to render an FAQ in Marathi. What it could not do was get one
 * from the server: `lib/contentLang.js` read suffixed fields off the record (`q_mr`, `a_hi`) and
 * `faqs` had no column for them, so repointing the page at `GET /faqs` would have passed every
 * existing test — nothing in the seed was translated — and silently dropped the translation the
 * first time an editor wrote one. V84 adds a nested `translations` object to all four content
 * tables; this is the proof that it survives end to end.
 *
 * Three states, and the fixture is chosen so all three are present at once:
 *
 *   f001  fully translated   — question, answer and category all in Marathi
 *   f002  partly translated  — Marathi question, English answer
 *   the other seven          — not translated at all
 *
 * The middle one is the case worth having. A fallback that worked per *record* would render f002
 * entirely in English, throwing away a translation somebody wrote; the client falls back per
 * *field*, so the row must arrive with the Marathi question present and the Marathi answer absent
 * rather than blank or backfilled. An `en`-only assertion cannot tell those apart, which is why the
 * page half of this spec reads the same row in both languages.
 *
 * Provenance is established by waiting on `GET /api/faqs` before the assertion, armed before the
 * navigation, for the reason `live-faqs.spec.js` states: the copy is deliberately identical on both
 * sides, so no assertion about text can prove which side produced it.
 *
 * Fixtures: `R__zz_dev_demo_data.sql`, which seeds nine FAQs and translates two of them.
 */
import { test, expect } from '../../../fixtures/live.js';
import { API } from '../../../helpers/liveAuth.js';

/** The fully-translated row. English is what an untranslated reader sees. */
const F1_EN_Q = 'Is PuneNest really zero brokerage?';
const F1_MR_Q = 'पुणेनेस्ट खरंच शून्य दलाली आहे का?';
const F1_MR_CAT = 'सर्वसाधारण';

/** The partly-translated row: question only. Its answer has no Marathi and must fall back. */
const F2_EN_Q = 'How are owners and listings verified?';
const F2_MR_Q = 'मालक आणि जाहिराती कशा पडताळल्या जातात?';

/** A row with nothing translated, to prove the untranslated majority still renders. */
const F3_EN_Q = 'How do I contact an owner or schedule a visit?';

test('every FAQ carries a translations object, and it says which fields are actually translated', async () => {
  const res = await fetch(`${API}/faqs`);
  expect(res.status).toBe(200);
  const faqs = await res.json();

  /* Present on every row, including the untranslated ones. A client that had to tell `undefined`
     from `{}` would be telling "nothing is translated" from "this server predates translations",
     and it would get that wrong exactly once, in production, in a language nobody on the team
     reads. */
  expect(faqs.every((f) => f.translations && typeof f.translations === 'object')).toBe(true);

  const full = faqs.find((f) => f.question === F1_EN_Q);
  expect(full.translations.mr.question).toBe(F1_MR_Q);
  expect(full.translations.mr.category).toBe(F1_MR_CAT);
  expect(full.translations.mr.answer).toBeTruthy();

  /* The partly-translated row. `answer` must be *absent*, not empty and not a copy of the English:
     an empty string would render as a blank answer under a real question, and a copy would make the
     row indistinguishable from a translated one. */
  const partial = faqs.find((f) => f.question === F2_EN_Q);
  expect(partial.translations.mr.question).toBe(F2_MR_Q);
  expect(Object.keys(partial.translations.mr)).toEqual(['question']);

  /* The untranslated majority. Seven of nine, and they are the normal case — a shape that only
     worked for translated rows would have broken the whole page. */
  const untranslated = faqs.filter((f) => Object.keys(f.translations).length === 0);
  expect(untranslated.length).toBe(faqs.length - 2);
  expect(untranslated.some((f) => f.question === F3_EN_Q)).toBe(true);
});

test('the help page reads Marathi off the server and falls back a field at a time', async ({ page }) => {
  /* Signed out on purpose. The FAQ page is public, and somebody reading it in Marathi because they
     cannot read the English one is not more likely to have an account. */
  const faqsRequest = page.waitForResponse(
    (r) => new URL(r.url()).pathname.endsWith('/api/faqs') && r.status() === 200,
  );
  await page.goto('/mr/help/faq');
  await faqsRequest;

  await expect(page.locator('html')).toHaveAttribute('lang', 'mr');

  // Fully translated: the Marathi question, and its English original nowhere on the page.
  await expect(page.getByRole('button', { name: F1_MR_Q })).toBeVisible();
  await expect(page.getByRole('button', { name: F1_EN_Q })).toHaveCount(0);

  // Partly translated: Marathi question. The answer is checked below, after opening it.
  const partial = page.getByRole('button', { name: F2_MR_Q });
  await expect(partial).toBeVisible();
  await expect(page.getByRole('button', { name: F2_EN_Q })).toHaveCount(0);

  /* Untranslated rows render their English question rather than disappearing. This is the positive
     anchor for the two `toHaveCount(0)` assertions above — without it they would both pass on a
     page that failed to load a single FAQ. */
  await expect(page.getByRole('button', { name: F3_EN_Q })).toBeVisible();

  /* The per-field fallback, which is the whole point. f002 has a Marathi question and no Marathi
     answer, so opening it must show the English answer under the Marathi question. A per-record
     fallback would have shown an English question too, and would have passed every other assertion
     in this test. */
  await partial.click();
  await expect(page.getByText('Aadhaar', { exact: false }).first()).toBeVisible();
  await expect(partial).toBeVisible();
});

test('the same rows read in English are untouched by any of it', async ({ page }) => {
  /* The regression this guards is the cheap fix somebody reaches for when a translation does not
     appear: resolve translations on the way out of the provider and overwrite the base field. That
     works in Marathi and quietly replaces the English site. */
  const faqsRequest = page.waitForResponse(
    (r) => new URL(r.url()).pathname.endsWith('/api/faqs') && r.status() === 200,
  );
  await page.goto('/help/faq');
  await faqsRequest;

  await expect(page.getByRole('button', { name: F1_EN_Q })).toBeVisible();
  await expect(page.getByRole('button', { name: F2_EN_Q })).toBeVisible();
  await expect(page.getByRole('button', { name: F1_MR_Q })).toHaveCount(0);
});
