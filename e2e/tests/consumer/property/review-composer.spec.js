import { test, expect } from '../../../fixtures/base.js';
import { seedStorage, USERS } from '../../../helpers/seed.js';

/* The property review composer's rating controls — accessible names (D198).
 *
 * `StarInput` renders a `<button>` whose only child is an SVG. An SVG contributes nothing to a
 * button's accessible name, so before this every star in the dialog was announced as bare "button".
 * `ReviewModal` mounts six strips — one overall, five per-aspect — so that is thirty
 * indistinguishable buttons: a screen-reader user could not tell one star from five, or Value from
 * Condition, and no reading order recovers it. Unlike a missing label on a lone icon button, there
 * is no surrounding text to infer from.
 *
 * The assertions below are deliberately name-based rather than count-based. A count proves labels
 * exist; only the names prove they say the right thing, which is the half that was actually wrong —
 * six strips all answering to "3 star" would satisfy any count.
 *
 * Eligibility, not decoration: `openRate` only opens the dialog for a signed-in non-owner with a
 * completed visit **or** a tenancy on the property. The tenancy is the cheaper of the two to seed —
 * a `pnTenancies:<mobile>` row is what the mock rent provider answers `/me/tenancies` from, so one
 * fixture write stands in for a closed rent deal without driving the visit flow. Without it this
 * test silently asserts against a dialog that never opened.
 *
 * That read used to be synchronous and mock-only (`getTenanciesFor(myMobile())` straight out of
 * `localStorage`), which is why it was dead against the live API — D194. It now goes through the
 * seam, so the same fixture proves the *brokered* half of eligibility on a code path production
 * also uses. The owner-confirmed half is `tenancy-declaration.spec.js`.
 */

const PROP = 'P5013';
const ASPECTS = ['Locality', 'Condition', 'Value', 'Owner', 'Accuracy'];

test('every star in the property review composer names its value and its aspect', async ({ page, login }) => {
  await login.asBuyer();
  await seedStorage(page, {
    [`pnTenancies:${USERS.buyer.mobile}`]: [{ propId: PROP, at: Date.now() }],
  });

  /* `?tab=amenities`: the reviews block is mounted by PropertyTabs only while that tab is current,
     so on the default Overview tab the "Rate this property" button does not exist at all. */
  await page.goto(`/property/${PROP}?tab=amenities`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.querySelectorAll('.reveal,.fade-up,.fade-in').forEach((el) => el.classList.add('visible')));

  await page.getByRole('button', { name: 'Rate this property' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rate this property' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });

  /* `exact` on the overall strip. `getByRole`'s name match is a substring one, so a plain "3 star"
     also resolves to the five "3 star for …" rows — the same trap the society composer's specs
     document, and the reason the aspect suffix exists rather than a numeric index. */
  await expect(dialog.getByRole('button', { name: '3 star', exact: true })).toHaveCount(1);

  for (const aspect of ASPECTS) {
    await expect(dialog.getByRole('button', { name: `3 star for ${aspect}` })).toHaveCount(1);
  }

  // Six strips × five stars, every one of them named: nothing left announcing itself as "button".
  await expect(dialog.getByRole('button', { name: /star/ })).toHaveCount(30);
});
