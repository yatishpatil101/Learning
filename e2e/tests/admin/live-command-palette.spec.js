/* The admin Ctrl+K palette and the bell, against the live API.
 *
 * ## What this file used to assert, and why it had to be replaced rather than extended
 *
 * It asserted an *absence*: five of the palette's seven categories were gated off on a live build
 * because they read the browser's demo store, and this file checked that they stayed off and that
 * the palette said so in words. That was an honest console with a search box that could not find
 * anything on the deployment it was built for — a defensible stopgap and a bad feature.
 *
 * Listings and people now go over the seam (`propertyService.searchForModeration`,
 * `usersService.listUsers`), so every absence assertion here is false and the interesting claim has
 * inverted. Service requests, enquiries and deals were dropped instead of ported: neither
 * `GET /contacts` nor `GET /deals` takes a search term, and `GET /tickets` filters by team and
 * status only, so those three could only ever have been the browser filtering whatever page it had
 * — which is the defect, not the fix. No endpoint was added for any of this.
 *
 * ## The rows are created outside the browser, and that is the whole point
 *
 * A palette that finds a fixture the same tab wrote proves nothing about a seam. Both subjects here
 * are minted over HTTP before the browser is pointed at the console: a listing through the owner's
 * own `POST /me/listings`, a person through `POST /auth/login`'s auto-registration and a
 * `PATCH /auth/me` to give it a name worth searching for. If the palette finds them, the term
 * reached Postgres.
 *
 * Both are found by a token unique to this run, so `(1)` is an assertion about *that row* rather
 * than a count that would pass against any non-empty catalogue.
 *
 * ## The search shapes differ, and the terms are chosen accordingly
 *
 * `GET /users` matches an **anchored** `lower(name) LIKE 'term%' OR mobile LIKE 'term%'` — prefix,
 * not substring, because only `pgcrypto` is installed and a leading wildcard could not use V18's
 * `text_pattern_ops` indexes. `GET /admin/properties` is substring, over title, locality, owner
 * name, owner mobile and the id. So the person is searched by the start of a name and the listing
 * by a token buried in its title, which is what each side can actually serve. The mock provider is
 * wider than the server on both, which is why `command-palette.spec.js` uses prefix terms too — a
 * mid-word person term would pass there and fail here.
 *
 * ## Cleanup
 *
 * Listings are rejected, not deleted: there is no delete, and a pending row left behind is a row on
 * somebody's real verification queue rather than tidy-up debt. The minted accounts are left — they
 * are ordinary buyers with no state any other spec reads, and `signedInAsNew` mints them all over
 * this suite already.
 */
import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders, uniqueMobile } from '../../helpers/liveAuth.js';

const UNIQUE_PAGE_TERM = 'Referrals (Ops)';

/** One token per run, so every `(1)` below is about the row this test made. */
const tag = () => `zzp${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

const palette = (page) => page.getByTestId('admin-palette');
const bell = (page) => page.getByTestId('admin-notifications');

const chip = (page, label) =>
  palette(page).getByRole('button', { name: new RegExp(`^${label}( \\(.+\\))?$`) });

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const BASE_LISTING = {
  deal: 'rent',
  propertyType: 'Flat',
  price: 24000,
  city: 'Pune',
  bhk: 2,
  area: 720,
  // A real entry in `GET /localities`, so the resolver files the listing rather than leaving
  // `locality_slug` null and dropping it into the curation queue.
  locality: 'Baner',
};

/* Every uuid this file puts into the shared catalogue, drained by `afterEach`. A module-level set
   is safe because the live config runs `workers: 1`. */
const created = new Set();

/**
 * A pending listing whose title carries `token`, under an owner nobody else shares.
 *
 * Through the owner's own route rather than an admin write, so "pending" is the state the *server*
 * puts a submission in rather than one the fixture asserted into existence — which also makes it a
 * genuine row for the bell's verification queue to count.
 */
async function pendingListing(token) {
  const headers = await authHeaders(uniqueMobile());
  const res = await api('POST', '/me/listings', headers, {
    ...BASE_LISTING,
    title: `Zztest palette ${token}`,
  });
  expect(res.status, 'POST /me/listings').toBe(201);
  created.add(res.body.id);
  return res.body.id;
}

/** A brand-new buyer whose name starts with `token`. Returns the full name. */
async function namedPerson(token) {
  const headers = await authHeaders(uniqueMobile());
  const name = `${token} Palettetest`;
  const res = await api('PATCH', '/auth/me', headers, { name });
  expect(res.status, 'PATCH /auth/me').toBe(200);
  return name;
}

test.afterEach(async () => {
  if (!created.size) return;
  const headers = await authHeaders(ACTORS.admin);
  for (const id of created) {
    await api('PATCH', `/properties/${id}/status`, headers, {
      status: 'rejected',
      reason: 'Zztest cleanup \u2014 synthetic command-palette fixture',
    });
  }
  created.clear();
});

async function openAdmin(page, login) {
  await login.asAdmin();
  await page.goto('/admin');
  await expect(page.getByLabel('Global search')).toBeVisible();
}

async function search(page, term) {
  await page.getByLabel('Global search').fill(term);
  await expect(palette(page)).toBeVisible();
}

test('Ctrl+K still opens the palette and page results navigate on live builds', async ({ page, login, consoleErrors }) => {
  await openAdmin(page, login);

  const input = page.getByLabel('Global search');
  await expect(input).not.toBeFocused();
  await expect(input).toHaveAttribute('placeholder', 'Search pages, features, listings and people...');

  await page.keyboard.press('Control+k');
  await expect(input).toBeFocused();

  await search(page, UNIQUE_PAGE_TERM);
  await expect(chip(page, 'All')).toHaveText('All (1)');
  await expect(chip(page, 'Features')).toHaveCount(1);
  await palette(page).getByRole('button', { name: /Referrals \(Ops\)/ }).click();

  await page.waitForURL('**/ops/referrals');
  await expect(page.getByRole('heading', { name: 'Referral Verification' })).toBeVisible();
  expect(consoleErrors).toHaveLength(0);
});

test('a listing posted over the API is found by the palette, and opens on the desk', async ({ page, login, consoleErrors }) => {
  const token = tag();
  await pendingListing(token);

  await openAdmin(page, login);
  await search(page, token);

  /* One row, and it is that row. The token exists nowhere in the nav index, the feature index or
     any other account, so `(1)` is a claim about this listing rather than about the catalogue being
     non-empty — and it could only have got here through `GET /admin/properties`, because the
     browser has never seen this row. */
  await expect(chip(page, 'Listings')).toHaveText('Listings (1)');
  await expect(chip(page, 'All')).toHaveText('All (1)');
  await expect(page.getByTestId('palette-partial')).toHaveCount(0);

  const row = palette(page).getByRole('button', { name: new RegExp(`Zztest palette ${token}`) });
  await expect(row).toHaveCount(1);
  await row.click();

  /* The result is only useful if it lands on the row it named. `?review=<id>` is what the
     properties desk reads to open that listing rather than the queue's first page \u2014 and the id in
     it is the view model's, which is the slug when the server minted one, so the assertion is on
     the desk opening this listing rather than on the shape of the key. */
  await page.waitForURL(/\/admin\/properties\?review=/);
  await expect(page.getByText(new RegExp(`Zztest palette ${token}`)).first()).toBeVisible();
  expect(consoleErrors).toHaveLength(0);
});

test('a person registered over the API is found by the start of their name', async ({ page, login, consoleErrors }) => {
  const token = tag();
  const name = await namedPerson(token);

  await openAdmin(page, login);
  await search(page, token);

  // Prefix, because that is what `GET /users` matches — see the header. A term from the middle of
  // the name would find this account in a mock build and nothing at all here.
  await expect(chip(page, 'People')).toHaveText('People (1)');
  await expect(palette(page).getByRole('button', { name: new RegExp(name) })).toHaveCount(1);
  await expect(page.getByTestId('palette-partial')).toHaveCount(0);

  expect(consoleErrors).toHaveLength(0);
});

test('the bell counts a real pending listing, and is not blind on a live build', async ({ page, login, consoleErrors }) => {
  await pendingListing(tag());

  await openAdmin(page, login);

  await expect(page.getByTestId('notif-unread-dot')).toBeVisible();
  await page.getByRole('button', { name: 'Notifications' }).click();

  /* The count comes from `GET /admin/properties?status=pending`, and the row we just posted is in
     it. Asserting the heading exists rather than a literal count: this database is shared for the
     whole run and other specs put listings on the same queue. */
  await expect(bell(page).getByText(/^Pending verification \(\d+\)$/)).toHaveCount(1);

  /* The inversion against the mock twin. Both desks answer here — `ticket` is a live-only domain,
     so it is the *mock* build where half this bell legitimately goes dark — and a live console
     that renders the blind notice is one whose seam is refusing, which is worth failing over. */
  await expect(page.getByTestId('notif-blind')).toHaveCount(0);
  await expect(bell(page).getByText('All caught up.')).toHaveCount(0);

  expect(consoleErrors).toHaveLength(0);
});