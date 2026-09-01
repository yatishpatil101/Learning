/* The admin Ctrl+K command palette, and the notification bell beside it — mock mode.
 *
 * ## Why this file did not exist until now
 *
 * It did not, and that is the finding. `AdminTopbarTools.jsx` is the search field at the top of
 * every admin page plus the bell next to it, and a grep of `e2e/` for `Global search`,
 * `AdminTopbarTools` and `Ctrl+K` returned nothing at all. Seven search categories, a keyboard
 * shortcut, a filter strip and an unread badge, and not one assertion anywhere. That is how the
 * defect in register item 22 survived long enough to be written up: nothing was watching this
 * component, so nothing could notice that five of its seven categories were answering from a
 * fixture file on every deployment, live ones included.
 *
 * ## What changed underneath it, and why this file is now the cheap half rather than one of a pair
 *
 * The first repair gated those five on whether their domain was still mocked, which stopped the
 * lie and left the console with a search box that found nothing on the deployment it was built for.
 * Both halves are gone now. Listings and people go through `propertyService.searchForModeration`
 * and `usersService.listUsers` — the same seam every other admin screen uses — so the palette finds
 * what the console it sits on top of would find, in either build. Service requests, enquiries and
 * deals were dropped rather than ported: their list endpoints take no search term, and a category
 * that can only filter the twenty rows it happened to fetch is the browser-side lie this change is
 * about removing.
 *
 * So there is no longer a build where these categories are absent, and no absence left to pair
 * with. What remains is a division of labour: this file asserts the behaviour in seconds against
 * the mock providers, and `live-command-palette.spec.js` asserts the same behaviour against the
 * real API with a listing created **outside the browser**, which is the assertion that actually
 * counts and the expensive one to run.
 *
 * ## The bell is deliberately half-dark here, and that is an assertion, not a caveat
 *
 * The bell counts pending listings and open service requests. `ticket` is a live-only domain
 * (D184) — there is no mock provider and asking for one throws — so in this build the services half
 * genuinely cannot answer. The interesting thing is what it does about it: it names the queue it
 * could not count instead of falling back to "All caught up.", which is the sentence the old bell
 * printed once its fixture ran dry. A console that agrees with you is more dangerous than one that
 * errors (D231).
 *
 * ## The search terms are prefixes on purpose
 *
 * The two searches do not have the same shape on both sides of the seam. `GET /users` matches an
 * **anchored** `lower(name) LIKE 'term%' OR mobile LIKE 'term%'` — a prefix, deliberately, because
 * only `pgcrypto` is installed and a leading wildcard could not use the `text_pattern_ops` index —
 * while the mock provider does a plain substring over name, mobile and email. The mock is the wider
 * of the two, so a person term matching mid-word would pass here and fail live, which is precisely
 * the drift this seam keeps producing. `Siddharth` is a name prefix for that reason. Listings are
 * substring on both sides: the admin term is `%q%` over title, locality, owner name, owner mobile
 * and the id.
 *
 * ## Anchors that are not obvious
 *
 *   - The palette input is `aria-label="Global search"`; the bell is `aria-label="Notifications"`.
 *   - A filter chip and its matching results heading carry the **same text** ("Listings (1)"). The
 *     chip is a `button` and the heading is a `div`, so every chip assertion goes through
 *     `getByRole('button')` inside the palette container.
 *   - Both dropdowns carry a `data-testid`, and every locator below is scoped to one of them. The
 *     admin shell behind the palette has its own tab strips and its own "All" buttons; an unscoped
 *     `getByRole('button', { name: 'All' })` is a strict-mode violation waiting for the page under
 *     it to change.
 *   - The unread badge is a decorative dot with no text of any kind, hence its own testid.
 *   - The palette renders nothing until two characters are typed (`term.length < 2`), so there is
 *     no state where the chips are visible and the field is empty.
 *   - Listings and people now arrive after a 200ms debounce and a provider round trip, so every
 *     assertion about them has to be a *retrying* one. `toBeVisible()` on a locator that matches
 *     several rows aborts instantly on the strict-mode violation rather than waiting out the
 *     debounce, so rows are counted with `toHaveCount` and chips with `toHaveText`.
 *
 * Fixtures: the seeded `db.json` store — 80 listings (15 `pending`), 62 users, one
 * `Residential Open Plot in Wagholi`. Counts are asserted as `\d+` rather than as literals: the
 * claim is that the palette counted something real, not that the fixture is a particular size this
 * month.
 */
import { test, expect } from '../../fixtures/base.js';

/** Matches exactly one nav entry, by its label, and nothing in any other category. */
const UNIQUE_PAGE_TERM = 'Referrals (Ops)';

/** The single Wagholi row in `db.json`, matched through a listing's `locality`. */
const LISTING_TERM = 'Wagholi';

/** A seeded user, matched by the start of their name — see the prefix note above. */
const PERSON_TERM = 'Siddharth';

/** Every chip the palette offers, in the order it declares them. */
const ALL_CHIPS = ['All', 'Features', 'Listings', 'People'];

/** The three that read the browser store and were dropped. Their absence is the guard. */
const DROPPED_CHIPS = ['Services', 'Enquiries', 'Deals'];

const palette = (page) => page.getByTestId('admin-palette');
const bell = (page) => page.getByTestId('admin-notifications');

/** A chip, by label, with or without its count suffix. */
const chip = (page, label) =>
  palette(page).getByRole('button', { name: new RegExp(`^${label.replace(/[()]/g, '\\$&')}( \\(\\d+\\))?$`) });

async function openAdmin(page, login) {
  await login.asAdmin();
  await page.goto('/admin');
  /* The palette lives in the admin shell's topbar, so its presence is also the proof that the shell
     rendered as admin. Without this gate every assertion below could be passing against a silent
     redirect to the sign-in screen, where all of them are trivially absent. */
  await expect(page.getByLabel('Global search')).toBeVisible();
}

async function search(page, term) {
  await page.getByLabel('Global search').fill(term);
  await expect(palette(page)).toBeVisible();
}

test('Ctrl+K focuses the palette from anywhere in the console', async ({ page, login }) => {
  await openAdmin(page, login);
  const input = page.getByLabel('Global search');
  // The shortcut is only a shortcut if the field was not already focused.
  await expect(input).not.toBeFocused();
  // The placeholder is a promise about what the box searches, and it was narrowed once already to
  // stop it promising rows the palette had stopped looking for. It now names all four.
  await expect(input).toHaveAttribute('placeholder', 'Search pages, features, listings and people...');

  await page.keyboard.press('Control+k');

  await expect(input).toBeFocused();
});

test('Escape closes the palette and clears the term', async ({ page, login }) => {
  await openAdmin(page, login);
  await search(page, UNIQUE_PAGE_TERM);

  await page.keyboard.press('Escape');

  /* Both halves. Asserting only that the dropdown closed would pass against a palette that reopens
     with the previous term the instant the field regains focus — which is what it did before the
     `setQ('')` in the same handler, and is the sort of thing that only shows up on the second
     search of a session. */
  await expect(palette(page)).toHaveCount(0);
  await expect(page.getByLabel('Global search')).toHaveValue('');
});

test('a page result navigates to the page it names', async ({ page, login }) => {
  await openAdmin(page, login);
  await search(page, UNIQUE_PAGE_TERM);

  /* Exactly one result across all four categories: the term is a nav label, and it matches no
     keyword, no listing and no user. Pinning the total before clicking is what makes the click
     unambiguous — on a fuzzier term a `.first()` would keep passing while clicking something else
     entirely. `toHaveText` retries, so it also outlasts the two searches answering: a count that
     only held before they returned would be an assertion about the loading state. */
  await expect(chip(page, 'All')).toHaveText('All (1)');
  await palette(page).getByRole('button', { name: /Referrals \(Ops\)/ }).click();

  await page.waitForURL('**/ops/referrals');
  /* The route resolving is the claim, not the URL changing: a nav index pointing at a path with no
     route would satisfy the URL alone and render the not-found page. `PageHeader` emits the `h1` in
     every branch of this page, including the one it shows when the desk is shut. */
  await expect(page.getByRole('heading', { name: 'Referral Verification' })).toBeVisible();
});

test('four categories are offered, and the three fixture-only ones are gone', async ({ page, login }) => {
  await openAdmin(page, login);
  await search(page, LISTING_TERM);

  for (const label of ALL_CHIPS) {
    await expect(chip(page, label), `${label} chip`).toHaveCount(1);
  }
  /* The guard against one of them quietly coming back. Each of the three was a category the palette
     could only answer by reading the browser's demo store, and re-adding one would restore the
     defect in register item 22 without restoring anything a live console could use. */
  for (const label of DROPPED_CHIPS) {
    await expect(chip(page, label), `${label} chip should be gone`).toHaveCount(0);
  }
});

test('a listing is found by its locality, and a real row comes back', async ({ page, login }) => {
  await openAdmin(page, login);
  await search(page, LISTING_TERM);

  // The chip carries the count and the row carries the record. Asserting only the chip would pass
  // against a palette that counted correctly and rendered nothing.
  await expect(chip(page, 'Listings')).toHaveText(/^Listings \(\d+\)$/);
  await expect(palette(page).getByRole('button', { name: /Residential Open Plot in Wagholi/ })).toHaveCount(1);

  // Neither desk refused, so the palette must not be hedging about a partial answer.
  await expect(page.getByTestId('palette-partial')).toHaveCount(0);
});

test('a person is found by the start of their name', async ({ page, login }) => {
  await openAdmin(page, login);
  await search(page, PERSON_TERM);

  /* The count is exact on purpose. `Siddharth` is the start of exactly two seeded names, so
     `People (2)` is a claim that the term reached the people desk and narrowed it. A `\d+` here
     would also be satisfied by a palette that dropped the term and returned the whole directory —
     which is precisely the mutation this test exists to catch. */
  await expect(chip(page, 'People')).toHaveText('People (2)');
  await expect(palette(page).getByRole('button', { name: /^Siddharth Gupta/ })).toHaveCount(1);
});

test('the bell counts pending listings and names the queue it cannot count', async ({ page, login }) => {
  await openAdmin(page, login);

  /* The dot first: it is the only part of the bell an operator sees without clicking, and it is the
     part that was asserting something false on live builds. */
  await expect(page.getByTestId('notif-unread-dot')).toBeVisible();
  await page.getByRole('button', { name: 'Notifications' }).click();

  await expect(bell(page).getByText(/^Pending verification \(\d+\)$/)).toHaveCount(1);

  /* `ticket` is live-only, so the services half cannot answer in this build. The claim is that it
     says which queue went uncounted rather than showing an empty section — and above all that it
     does not reach "All caught up.", which is a statement about the queues and would be false. */
  await expect(page.getByTestId('notif-blind')).toBeVisible();
  await expect(bell(page).getByText(/Half of this bell is dark here\./)).toBeVisible();
  await expect(bell(page).getByText(/Open service requests could not be counted/)).toBeVisible();
  await expect(bell(page).getByText('All caught up.')).toHaveCount(0);
});
