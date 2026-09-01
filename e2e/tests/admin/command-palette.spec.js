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
 * ## This spec is one half of a pair
 *
 * Item 22 was resolved by gating each of the five data categories — listings, people, services,
 * enquiries, deals — on whether the domain that owns its rows (`property`, `users`, `ticket`,
 * `contact`, `deal`) is still served by its mock provider. That makes the palette **two different
 * components depending on the build**, so it needs two specs and they only mean something together:
 *
 *   - this one proves the five categories are searched, the chips are offered, and the bell counts,
 *     on a build where the browser store genuinely is the system of record;
 *   - `live-command-palette.spec.js` proves the same five are absent against the live API, that the
 *     palette says so in words, and that the bell does not print "All caught up." when it is simply
 *     not counting.
 *
 * The absence asserted over there would be free if the categories were broken everywhere — the
 * exact failure shape `consolidation.spec.js` warns about in its own header — so it is only
 * evidence because of the presence asserted here. This is "an assertion of rejection needs a
 * matching assertion of acceptance", applied across two files rather than two tests.
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
 *
 * Fixtures: the seeded `db.json` store — 80 listings (15 `pending`), 62 users, 34 tickets
 * (9 `new`), 60 enquiries, 16 deals. Counts are asserted as `\d+` rather than as literals: the
 * claim is that the palette counted something real, not that the fixture is a particular size this
 * month.
 */
import { test, expect } from '../../fixtures/base.js';

/** Matches exactly one nav entry, by its label, and nothing in any other category. */
const UNIQUE_PAGE_TERM = 'Referrals (Ops)';

/** The single Wagholi row in `db.json`, matched through a listing's `locality`. */
const LISTING_TERM = 'Wagholi';

/** Every chip the palette offers when nothing is withheld, in the order it declares them. */
const ALL_CHIPS = ['All', 'Features', 'Listings', 'People', 'Services', 'Enquiries', 'Deals'];

/** The footer a live build renders in place of the withheld categories. Must not appear here. */
const WITHHELD_NOTE = /Pages and features only here/;

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

  /* Exactly one result across all seven categories: the term is a nav label, and it matches no
     keyword, no listing, no user and no ticket. Pinning the total before clicking is what makes the
     click unambiguous — on a fuzzier term a `.first()` would keep passing while clicking something
     else entirely. */
  await expect(chip(page, 'All')).toHaveText('All (1)');
  await palette(page).getByRole('button', { name: /Referrals \(Ops\)/ }).click();

  await page.waitForURL('**/ops/referrals');
  /* The route resolving is the claim, not the URL changing: a nav index pointing at a path with no
     route would satisfy the URL alone and render the not-found page. `PageHeader` emits the `h1` in
     every branch of this page, including the one it shows when the desk is shut. */
  await expect(page.getByRole('heading', { name: 'Referral Verification' })).toBeVisible();
});

test('all seven categories are offered while every domain is mocked', async ({ page, login }) => {
  await openAdmin(page, login);
  await search(page, 'an');

  for (const label of ALL_CHIPS) {
    await expect(chip(page, label)).toBeVisible();
  }
  /* The five data chips are honest here only because the store is the system of record here. This
     is the assertion that inverts in the live twin. */
  await expect(palette(page).getByText(WITHHELD_NOTE)).toHaveCount(0);
});

test('a listing is found by its locality, and a real row comes back', async ({ page, login }) => {
  await openAdmin(page, login);
  await search(page, LISTING_TERM);

  // The chip carries the count and the row carries the record. Asserting only the chip would pass
  // against a palette that counted correctly and rendered nothing.
  await expect(chip(page, 'Listings')).toHaveText(/^Listings \(\d+\)$/);
  await expect(palette(page).getByRole('button', { name: /Residential Open Plot in Wagholi/ })).toBeVisible();
});

test('a person is found by name', async ({ page, login }) => {
  await openAdmin(page, login);
  await search(page, 'Siddharth');

  await expect(chip(page, 'People')).toHaveText(/^People \(\d+\)$/);
  await expect(palette(page).getByRole('button', { name: /^Siddharth Gupta/ })).toBeVisible();
});

test('the bell counts pending listings and new service requests', async ({ page, login }) => {
  await openAdmin(page, login);

  /* The dot first: it is the only part of the bell an operator sees without clicking, and it is the
     part that was asserting something false on live builds. */
  await expect(page.getByTestId('notif-unread-dot')).toBeVisible();
  await page.getByRole('button', { name: 'Notifications' }).click();

  await expect(bell(page).getByText(/^Pending verification \(\d+\)$/)).toBeVisible();
  await expect(bell(page).getByText(/^New service requests \(\d+\)$/)).toBeVisible();
  /* The sentence a live build shows instead. Its absence here is what makes its presence there a
     statement about the deployment rather than about the component. */
  await expect(bell(page).getByText(/is not counting anything here/)).toHaveCount(0);
});
