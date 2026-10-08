// The admin Ctrl+K palette and the bell, against the live API.
import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders, uploadedListingPhotos, uniqueMobile } from '../../helpers/liveAuth.js';

const UNIQUE_PAGE_TERM = 'Referrals';

// One token per run, so every `(1)` below is about the row this test made.
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
  locality: 'Baner',
};

// Every uuid this file puts into the shared catalogue, drained by `afterEach`.
const created = new Set();

// A pending listing whose title carries `token`, under an owner nobody else shares.
async function pendingListing(token) {
  const headers = await authHeaders(uniqueMobile());
  const res = await api('POST', '/me/listings', headers, {
    ...BASE_LISTING,
    title: `Zztest palette ${token}`,
    images: await uploadedListingPhotos(headers),
  });
  expect(res.status, 'POST /me/listings').toBe(201);
  created.add(res.body.id);
  return res.body.id;
}

// A brand-new buyer whose name starts with `token`.
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
      reasonCode: 'other',
      reason: 'Zztest cleanup \u2014 synthetic command-palette fixture',
    });
  }
  created.clear();
});

async function openAdmin(page) {
  await page.goto('/admin');
  await expect(page.getByLabel('Global search')).toBeVisible();
}

async function search(page, term) {
  await page.getByLabel('Global search').fill(term);
  await expect(palette(page)).toBeVisible();
}

test('Ctrl+K opens the palette, page results navigate, Escape clears the term, and only the four categories are offered', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await test.step('Ctrl+K still opens the palette and page results navigate on live builds', async () => {
    await openAdmin(page);

    const input = page.getByLabel('Global search');
    await expect(input).not.toBeFocused();
    await expect(input).toHaveAttribute('placeholder', 'Search pages, features, listings and people...');

    await page.keyboard.press('Control+k');
    await expect(input).toBeFocused();

    // And it reopens clean rather than merely being empty while closed.
    await search(page, UNIQUE_PAGE_TERM);
    await expect(chip(page, 'All')).toHaveText('All (1)');
    await expect(chip(page, 'Features')).toHaveCount(1);
    await palette(page).getByRole('button', { name: /^Referrals\s*\/admin\/referrals/ }).click();

    await page.waitForURL('**/admin/referrals');
    await expect(page.getByRole('heading', { name: 'Referral Verification' })).toBeVisible();
    expect(consoleErrors).toHaveLength(0);
  });
  await test.step('Escape closes the palette and clears the term', async () => {
    await openAdmin(page);
    await search(page, UNIQUE_PAGE_TERM);

    await page.keyboard.press('Escape');

    // Closing alone does not clear the query; it would reappear on the next focus.
    await expect(palette(page)).toHaveCount(0);
    await expect(page.getByLabel('Global search')).toHaveValue('');

    await search(page, UNIQUE_PAGE_TERM);
    await expect(chip(page, 'All')).toHaveText('All (1)');

    expect(consoleErrors).toHaveLength(0);
  });
  await test.step('four categories are offered, and the three that could only ever filter a page are gone', async () => {
    await openAdmin(page);
    await search(page, UNIQUE_PAGE_TERM);

    for (const label of ALL_CHIPS) {
      await expect(chip(page, label), `${label} chip`).toHaveCount(1);
    }
    for (const label of DROPPED_CHIPS) {
      await expect(chip(page, label), `${label} chip should be gone`).toHaveCount(0);
    }

    expect(consoleErrors).toHaveLength(0);
  });
});

test('the palette finds a posted listing and a registered person, and the bell counts a real pending listing', async ({ page, login, consoleErrors }) => {
  await test.step('a listing posted over the API is found by the palette, and opens on the desk', async () => {
    const token = tag();
    await pendingListing(token);

    await login.asAdmin();
    await openAdmin(page);
    await search(page, token);

    // This token exists only in this listing, so `(1)` proves the properties endpoint fed it.
    await expect(chip(page, 'Listings')).toHaveText('Listings (1)');
    await expect(chip(page, 'All')).toHaveText('All (1)');
    await expect(page.getByTestId('palette-partial')).toHaveCount(0);

    const row = palette(page).getByRole('button', { name: new RegExp(`Zztest palette ${token}`) });
    await expect(row).toHaveCount(1);
    await row.click();

    // The result is only useful if it lands on the row it named.
    await page.waitForURL(/\/admin\/properties\?review=/);
    await expect(page.getByText(new RegExp(`Zztest palette ${token}`)).first()).toBeVisible();
    expect(consoleErrors).toHaveLength(0);
  });
  await test.step('a person registered over the API is found by the start of their name', async () => {
    const token = tag();
    const name = await namedPerson(token);

    await openAdmin(page);
    await search(page, token);

    // Prefix, because that is what `GET /users` matches — see the header. A term from the middle of
    // the name would find this account in a mock build and nothing at all here.
    await expect(chip(page, 'People')).toHaveText('People (1)');
    await expect(palette(page).getByRole('button', { name: new RegExp(name) })).toHaveCount(1);
    await expect(page.getByTestId('palette-partial')).toHaveCount(0);

    expect(consoleErrors).toHaveLength(0);
  });
  await test.step('the bell counts a real pending listing, and is not blind on a live build', async () => {
    await pendingListing(tag());

    await openAdmin(page);

    await expect(page.getByTestId('notif-unread-dot')).toBeVisible();
    await page.getByRole('button', { name: 'Notifications' }).click();

    // The count comes from `GET /admin/bell`, and the row we just posted is in it.
    await expect(bell(page).getByText(/^Pending verification \(\d+\)$/)).toHaveCount(1);

    // The inversion against the mock twin.
    await expect(page.getByTestId('notif-blind')).toHaveCount(0);
    await expect(bell(page).getByText('All caught up.')).toHaveCount(0);

    expect(consoleErrors).toHaveLength(0);
  });
});

// The two below came off `admin/command-palette.spec.js` when that file was retired.
const ALL_CHIPS = ['All', 'Features', 'Listings', 'People'];

// These endpoints cannot search, so filtering here would only filter the current page.
const DROPPED_CHIPS = ['Services', 'Enquiries', 'Deals'];
