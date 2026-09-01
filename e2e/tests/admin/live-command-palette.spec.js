import { test, expect } from '../../fixtures/live.js';

const UNIQUE_PAGE_TERM = 'Referrals (Ops)';
const FIXTURE_LISTING_TERM = 'Wagholi';
const WITHHELD_NOTE = /Pages and features only here/;
const BLIND_NOTE = /This bell is not counting anything here\./;

const palette = (page) => page.getByTestId('admin-palette');
const bell = (page) => page.getByTestId('admin-notifications');

const chip = (page, label) =>
  palette(page).getByRole('button', { name: new RegExp(`^${label}( \\(.+\\))?$`) });

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
  await expect(input).toHaveAttribute('placeholder', 'Search pages and features...');

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

test('fixture-backed categories are withheld on live builds', async ({ page, login, consoleErrors }) => {
  await openAdmin(page, login);
  await search(page, FIXTURE_LISTING_TERM);

  await expect(chip(page, 'All')).toBeVisible();
  await expect(chip(page, 'Features')).toBeVisible();
  await expect(chip(page, 'Listings')).toHaveCount(0);
  await expect(chip(page, 'People')).toHaveCount(0);
  await expect(chip(page, 'Services')).toHaveCount(0);
  await expect(chip(page, 'Enquiries')).toHaveCount(0);
  await expect(chip(page, 'Deals')).toHaveCount(0);
  await expect(palette(page).getByText('No matches found')).toBeVisible();
  await expect(palette(page).getByText(WITHHELD_NOTE)).toBeVisible();
  await expect(palette(page).getByText(/Searching listings, people, service requests, enquiries and deals would need an admin search API/)).toBeVisible();
  await expect(palette(page).getByRole('button', { name: /Residential Open Plot in Wagholi/ })).toHaveCount(0);

  expect(consoleErrors).toHaveLength(0);
});

test('the bell explains that live counts are withheld instead of claiming the queue is empty', async ({ page, login, consoleErrors }) => {
  await openAdmin(page, login);

  await expect(page.getByTestId('notif-unread-dot')).toHaveCount(0);
  await page.getByRole('button', { name: 'Notifications' }).click();

  await expect(bell(page).getByText(BLIND_NOTE)).toBeVisible();
  await expect(bell(page).getByText(/Pending verifications and New service requests were counted from the browser.s demo data/)).toBeVisible();
  await expect(bell(page).getByText('All caught up.')).toHaveCount(0);
  await expect(bell(page).getByText(/^Pending verification \(\d+\)$/)).toHaveCount(0);
  await expect(bell(page).getByText(/^New service requests \(\d+\)$/)).toHaveCount(0);

  expect(consoleErrors).toHaveLength(0);
});