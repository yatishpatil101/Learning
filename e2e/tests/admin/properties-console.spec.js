import { expect, test, ACTORS, STAFF } from '../../fixtures/live.js';
import { API, authHeaders, uploadedListingPhotos, signIn, uniqueMobile } from '../../helpers/liveAuth.js';
import { appReady } from '../../helpers/app.js';
import { approveListing, rejectListing } from '../../helpers/moderation.js';

const PAGE_LIMIT = 10;
const TAB_ORDER = [
  /^To verify/,
  /^Re-checks/,
  /^Badge requests/,
  /^Follow-up/,
  /^Flagged/,
  /^Duplicates/,
  /^All listings/,
];

const BASE_LISTING = {
  deal: 'rent',
  propertyType: 'Flat',
  price: 24000,
  city: 'Pune',
  bhk: 2,
  area: 720,
  // A real entry in `GET /localities`, so the resolver files the listing rather than leaving
  // `locality_slug` null and dropping it into the curation queue `locality-queue` owns.
  locality: 'Baner',
};

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    // The tile's number is not asserted: on a shared catalogue it is whatever other sessions left behind.
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}

// Every uuid this file has put into the shared catalogue, drained by `afterEach`.
const created = new Set();

async function pendingListing(tag, overrides = {}) {
  const title = `Zztest console ${tag} ${Date.now().toString(36)}`;
  const headers = await authHeaders(uniqueMobile());
  const res = await api('POST', '/me/listings', headers, {
    ...BASE_LISTING,
    ...overrides,
    title,
    images: overrides.images ?? await uploadedListingPhotos(headers),
  });
  expect(res.status, res.text).toBe(201);
  created.add(res.body.id);
  return { id: res.body.id, label: res.body.slug || res.body.id, title, tag, headers };
}

  // postedByStaff comes from the caller token; the tab filter is the only
  // browser-controlled behavior under test.
async function conciergeListing(tag) {
  const title = `Zztest console ${tag} ${Date.now().toString(36)}`;
  const ownerMobile = uniqueMobile();
  const ownerName = `Zztest Concierge ${tag}`;
  const res = await api('POST', '/admin/properties', await authHeaders(ACTORS.admin), {
    ownerMobile,
    ownerName,
    listing: { ...BASE_LISTING, title },
  });
  expect(res.status, res.text).toBe(201);
  created.add(res.body.id);
  return { id: res.body.id, title, tag, ownerMobile, ownerName };
}

async function uploadOwnershipDocument(owner, id) {
  const form = new FormData();
  form.set('file', new Blob(['%PDF-1.4 index ii'], { type: 'application/pdf' }), 'index-ii.pdf');
  form.set('category', 'Index II');
  const res = await fetch(`${API}/me/documents/${id}`, { method: 'POST', headers: { authorization: owner.authorization }, body: form });
  expect(res.status, await res.text()).toBe(201);
}

async function badgeRequestListing(request, tag) {
  const listing = await pendingListing(`badge ${tag}`);
  expect((await approveListing(request, listing.id, await authHeaders(ACTORS.admin))).status()).toBe(200);
  await uploadOwnershipDocument(listing.headers, listing.id);
  const asked = await api('POST', `/properties/${listing.id}/verification/ownership/request`, listing.headers);
  expect(asked.status, asked.text).toBe(200);
  return listing;
}

async function recheckListing(request, tag) {
  const listing = await pendingListing(`recheck ${tag}`);
  expect((await approveListing(request, listing.id, await authHeaders(ACTORS.admin))).status()).toBe(200);
  const edited = await api('PATCH', `/me/listings/${listing.id}`, listing.headers, { price: BASE_LISTING.price + 5000 });
  expect(edited.status, edited.text).toBe(200);
  const mine = await api('GET', `/me/listings/${listing.id}`, listing.headers);
  expect(mine.body.recheckPending).toBe(true);
  expect(mine.body.recheckReason).toBe('price');
  return listing;
}

test.afterEach(async ({ request }) => {
  if (!created.size) return;
  const headers = await authHeaders(ACTORS.admin);
  for (const id of created) {
    await rejectListing(request, id, headers, {
      reasonCode: 'other',
      reason: 'Zztest cleanup — synthetic console fixture',
    });
  }
  created.clear();
});

const tab = (page, name) => page.getByRole('tab', { name });
const rows = (page) => page.getByTestId('queue-row');
const rowFor = (page, title) => rows(page).filter({ has: page.getByRole('heading', { name: title }) });
const searchBox = (page) => page.getByPlaceholder('Title, owner, mobile or ID');

function queueFetch(match = {}) {
  return (res) => {
    if (res.request().method() !== 'GET') return false;
    const url = new URL(res.url());
    if (url.pathname !== '/api/admin/properties') return false;
    return Object.entries(match).every(([key, value]) => url.searchParams.get(key) === String(value));
  };
}

async function adminJson(path) {
  const res = await fetch(`${API}${path}`, { headers: await authHeaders(ACTORS.admin) });
  const text = await res.text();
  expect(res.status, text).toBe(200);
  return text ? JSON.parse(text) : null;
}

async function openConsole(page, search = '', match = { status: 'pending', archived: 'false', page: '0', size: String(PAGE_LIMIT) }) {
  const queue = page.waitForResponse(queueFetch(match));
  const summary = page.waitForResponse((r) => r.url().includes('/api/admin/properties/summary') && r.request().method() === 'GET');
  await page.goto(`/admin/properties${search}`, { waitUntil: 'commit' });
  const [queueRes, summaryRes] = await Promise.all([queue, summary]);
  expect(queueRes.status()).toBe(200);
  expect(summaryRes.status()).toBe(200);
  const params = new URLSearchParams(match);
  const [queueBody, summaryBody] = await Promise.all([
    adminJson(`/admin/properties?${params.toString()}`),
    adminJson('/admin/properties/summary'),
  ]);
  await appReady(page);
  await expect(page.getByRole('heading', { name: 'Properties', exact: true })).toBeVisible();
  return { queue: queueBody, summary: summaryBody };
}

async function openTab(page, name, match) {
  const wait = match ? page.waitForResponse(queueFetch(match)) : null;
  await tab(page, name).click();
  if (wait) expect((await wait).status()).toBe(200);
  await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true');
}

async function search(page, term, match) {
  const wait = page.waitForResponse(queueFetch({ ...match, q: term, page: '0' }));
  await searchBox(page).fill(term);
  expect((await wait).status()).toBe(200);
}

async function pickChip(page, groupName, chipName) {
  await page.getByRole('group', { name: groupName }).getByRole('button', { name: chipName, exact: true }).click();
}

// Custom Select portals its listbox; aria-expanded waits make clicks deterministic.
async function pickOption(page, ariaLabel, optionText) {
  const trigger = page.getByRole('button', { name: ariaLabel });
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await page.locator('.dz-dropdown__option', { hasText: optionText }).first().click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
}

test.describe('LIVE: the properties console', () => {
  test('the redesigned desk opens cleanly on the To verify queue', async ({ page, login, consoleErrors }) => {
    // Deep links are how moderators share queues; this covers useTabParam's read side.
    await login.asAdmin();
    // The pending count belongs only to verification, not every tab.
    await openConsole(page);

    // The subtitle distinguishes the full console from the read-only cut-down screen.
    await expect(page.getByText('Manage, verify and curate every listing')).toBeVisible();
    await expect(page.getByRole('tab')).toHaveCount(TAB_ORDER.length);
    // Tab order is workflow order; moving one changes moderator muscle memory.
    const labels = await page.getByRole('tab').allInnerTexts();
    TAB_ORDER.forEach((pattern, i) => expect(labels[i].trim()).toMatch(pattern));
    await expect(tab(page, /^To verify/)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('verify-note')).toContainText('Oldest first');
    await expect(rows(page).first()).toBeVisible({ timeout: 20000 });
    expect(consoleErrors).toEqual([]);
  });

  test('tab selection, deep links and removed tab names resolve through the URL', async ({ page, login }) => {
    // The same term in two boxes on one console must give opposite answers.
    await login.asAdmin();
    await openConsole(page);

    await openTab(page, /^Re-checks/, { recheck: 'true', archived: 'false', page: '0', size: String(PAGE_LIMIT) });
    await expect(page).toHaveURL(/[?&]tab=recheck\b/);
    await expect(page.getByRole('tab', { selected: true })).toHaveCount(1);

    await openTab(page, /^All listings/, { archived: 'false', page: '0', size: String(PAGE_LIMIT) });
    await expect(page).toHaveURL(/[?&]tab=all\b/);

    for (const stale of ['staff', 'featured', 'pipeline']) {
      await openConsole(page, `?tab=${stale}`);
      await expect(tab(page, /^To verify/)).toHaveAttribute('aria-selected', 'true');
    }

    await page.goto('/admin/properties?tab=duplicates', { waitUntil: 'commit' });
    await appReady(page);
    await expect(tab(page, /^Duplicates/)).toHaveAttribute('aria-selected', 'true');
  });

  test('tab count pills are the moderation summary counts', async ({ page, login }) => {
    await login.asAdmin();
    const { summary } = await openConsole(page);
    const expected = {
      verify: summary.pending,
      recheck: summary.recheck,
      badge: summary.badgeRequests,
      followup: summary.unconfirmed,
      flagged: summary.flagged,
      all: summary.total,
    };

    for (const [key, value] of Object.entries(expected)) {
      await expect(page.getByTestId(`tab-count-${key}`)).toHaveText(Number(value).toLocaleString('en-IN'));
    }
  });

  test('paging is server-sized, capped to ten rows, and resets on tab switch', async ({ page, login }) => {
    const summary = await (await fetch(`${API}/admin/properties/summary`, { headers: await authHeaders(ACTORS.admin) })).json();
    for (let i = summary.pending; i <= PAGE_LIMIT; i += 1) {
      await pendingListing(`page ${i}`);
    }

    await login.asAdmin();
    const { queue } = await openConsole(page);
    expect(queue.totalElements).toBeGreaterThan(PAGE_LIMIT);
    await expect(rows(page)).toHaveCount(Math.min(PAGE_LIMIT, queue.content.length));
    await expect(page.getByTestId('queue-range').first()).toHaveText(`1–10 of ${queue.totalElements.toLocaleString('en-IN')}`);

    const secondPage = page.waitForResponse(queueFetch({ status: 'pending', archived: 'false', page: '1', size: String(PAGE_LIMIT) }));
    await page.getByRole('button', { name: 'Next page' }).first().click();
    expect((await secondPage).status()).toBe(200);
    await expect(page).toHaveURL(/[?&]page=2\b/);

    await openTab(page, /^All listings/, { archived: 'false', page: '0', size: String(PAGE_LIMIT) });
    await expect(page).not.toHaveURL(/[?&]page=/);
  });

  test('server search finds title, owner, mobile and id fragments, and reports empty results', async ({ page, login }) => {
    const listing = await conciergeListing('search');

    await login.asAdmin();
    await openConsole(page);
    await openTab(page, /^All listings/, { archived: 'false', page: '0', size: String(PAGE_LIMIT) });

    for (const term of [listing.title, listing.ownerName, listing.ownerMobile, listing.id.slice(-8)]) {
      await search(page, term, { archived: 'false', size: String(PAGE_LIMIT) });
      await expect(rowFor(page, listing.title)).toHaveCount(1);
    }

    await search(page, `zztest-nothing-${Date.now()}`, { archived: 'false', size: String(PAGE_LIMIT) });
    await expect(rows(page)).toHaveCount(0);
    await expect(page.getByText('No listings match these filters.')).toBeVisible();
    await expect(page.getByTestId('queue-range').first()).toHaveText('0–0 of 0');
  });

  test('deal, progress and status filters narrow against the server', async ({ page, login }) => {
    const listing = await pendingListing('filters');

    await login.asAdmin();
    await openConsole(page);
    await search(page, listing.title, { status: 'pending', archived: 'false', size: String(PAGE_LIMIT) });
    await expect(rowFor(page, listing.title)).toHaveCount(1);

    await pickChip(page, 'Deal', 'Buy');
    await expect(rows(page)).toHaveCount(0);
    await pickChip(page, 'Deal', 'Rent');
    await expect(rowFor(page, listing.title)).toHaveCount(1);

    await pickChip(page, 'Progress', 'In review');
    await expect(rows(page)).toHaveCount(0);
    await pickChip(page, 'Progress', 'Ready');
    await expect(rowFor(page, listing.title)).toHaveCount(1);

    await openTab(page, /^All listings/, { archived: 'false', page: '0', size: String(PAGE_LIMIT) });
    await search(page, listing.title, { archived: 'false', size: String(PAGE_LIMIT) });
    await pickOption(page, 'Filter by status', 'Live');
    await expect(rows(page)).toHaveCount(0);
    await pickOption(page, 'Filter by status', 'Ready for review');
    await expect(rowFor(page, listing.title)).toHaveCount(1);
  });

  test('the review modal has the two-pane case file, section tabs and decision rail, and flags a listing with no photos', async ({ page, login }) => {
    const listing = await pendingListing('review');

    await login.asAdmin();
    await page.goto(`/admin/properties?review=${listing.id}`);

    const dialog = page.getByRole('dialog', { name: 'Verify property' });
    await expect(dialog).toBeVisible({ timeout: 20000 });
    await expect(dialog.getByTestId('review-summary')).toContainText(listing.title);
    await expect(dialog.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    for (const id of ['overview', 'details', 'badge', 'messages']) {
      await expect(dialog.getByTestId(`review-section-${id}`)).toBeVisible();
    }
    await expect(dialog.getByRole('complementary', { name: 'Decision' })).toBeVisible();
    await expect(dialog.getByText('Verification checklist')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Needs info' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Reject' })).toBeVisible();
    await expect(dialog.getByText('Property details')).toHaveCount(0);
    await expect(dialog.getByText('Communicate with the owner')).toHaveCount(0);

    await dialog.getByTestId('review-section-details').click();
    await expect(dialog).toContainText(listing.label);
    await expect(dialog.getByRole('heading', { name: 'Location' })).toBeVisible();
    await dialog.getByTestId('review-section-badge').click();
    await expect(dialog.getByRole('region', { name: 'Ownership document checks' })).toBeVisible();
    await dialog.getByTestId('review-section-messages').click();
    const composer = dialog.getByPlaceholder(/Share a note/);
    await composer.click();
    await page.keyboard.type('needs a clearer photo');
    await expect(composer).toHaveValue('needs a clearer photo');

    const bare = await conciergeListing('no photo');
    await page.goto('/admin/properties', { waitUntil: 'commit' });
    await appReady(page);
    await searchBox(page).fill(bare.title);
    const card = rowFor(page, bare.title).first();
    await expect(card.getByText('No photos', { exact: true })).toBeVisible();
    await card.getByRole('button', { name: /review/i }).click();
    await expect(page.getByText('This listing has no photos \u2014 reject or request photos.')).toBeVisible();
  });

  test('owner edits open on Changes, while badge requests open on Verified badge and stay out of Re-checks', async ({ page, login, request }) => {
    const edited = await recheckListing(request, 'changes');
    const badge = await badgeRequestListing(request, 'only');

    await login.asAdmin();
    await page.goto(`/admin/properties?review=${edited.id}`);
    const editDialog = page.getByRole('dialog', { name: 'Verify property' });
    await expect(editDialog.getByTestId('review-section-changes')).toHaveAttribute('aria-selected', 'true', { timeout: 20000 });
    await expect(editDialog.getByRole('button', { name: 'Approve edits' })).toBeVisible();
    await editDialog.getByRole('button', { name: 'Close', exact: true }).click();

    await openConsole(page, '?tab=badge', { badge: 'true', archived: 'false', page: '0', size: String(PAGE_LIMIT) });
    const summary = await (await fetch(`${API}/admin/properties/summary`, { headers: await authHeaders(ACTORS.admin) })).json();
    await expect(page.getByTestId('tab-count-badge')).toHaveText(Number(summary.badgeRequests).toLocaleString('en-IN'));
    await search(page, badge.title, { badge: 'true', archived: 'false', size: String(PAGE_LIMIT) });
    await expect(rowFor(page, badge.title).getByTestId('recheck-strip')).toContainText('Badge request');

    await rowFor(page, badge.title).getByTestId('review-badge-request').click();
    const badgeDialog = page.getByRole('dialog', { name: 'Verify property' });
    await expect(badgeDialog.getByTestId('badge-request-banner')).toBeVisible();
    await expect(badgeDialog.getByTestId('review-section-badge')).toHaveAttribute('aria-selected', 'true');
    await badgeDialog.getByRole('button', { name: 'Close', exact: true }).click();

    await openTab(page, /^Re-checks/, { recheck: 'true', archived: 'false', page: '0', size: String(PAGE_LIMIT) });
    await search(page, badge.title, { recheck: 'true', archived: 'false', size: String(PAGE_LIMIT) });
    await expect(rowFor(page, badge.title)).toHaveCount(0);
  });

  test('flagging and clearing a flag round-trip through the server queue', async ({ page, login, request }) => {
    const listing = await pendingListing('flag');
    expect((await approveListing(request, listing.id, await authHeaders(ACTORS.admin))).status()).toBe(200);

    await login.asAdmin();
    await openConsole(page);
    await openTab(page, /^All listings/, { archived: 'false', page: '0', size: String(PAGE_LIMIT) });
    await search(page, listing.title, { archived: 'false', size: String(PAGE_LIMIT) });
    await rowFor(page, listing.title).getByRole('button', { name: 'Flag', exact: true }).click();

    const flag = page.getByRole('dialog', { name: 'Flag listing' });
    await flag.locator('textarea').first().fill('Zztest moderation flag');
    await flag.getByRole('button', { name: 'Flag listing', exact: true }).click();
    await expect(page.getByText('Listing flagged')).toBeVisible();

    const flagged = await api('GET', `/admin/properties?status=flagged&archived=false&q=${encodeURIComponent(listing.title)}&size=1`, await authHeaders(ACTORS.admin));
    expect(flagged.body.totalElements).toBe(1);

    await openTab(page, /^Flagged/, { status: 'flagged', archived: 'false', page: '0', size: String(PAGE_LIMIT) });
    await search(page, listing.title, { status: 'flagged', archived: 'false', size: String(PAGE_LIMIT) });
    // Playwright auto-dismisses confirms; accept it or Clear flag is a silent no-op.
    page.once('dialog', (d) => d.accept());
    await rowFor(page, listing.title).getByRole('button', { name: 'Clear flag' }).click();
    await expect(page.getByText('Flag cleared — back in the review queue')).toBeVisible();

    const pending = await api('GET', `/admin/properties?status=pending&archived=false&q=${encodeURIComponent(listing.title)}&size=1`, await authHeaders(ACTORS.admin));
    expect(pending.body.totalElements).toBe(1);
  });

  test('CSV export filenames follow the active queue', async ({ page, login }) => {
    await login.asAdmin();
    await openConsole(page);

    // Filenames identify exported populations once several CSVs are opened together.
    const expected = [
      [/^To verify/, 'draazy-verification-queue.csv'],
      [/^Re-checks/, 'draazy-recheck-queue.csv'],
      [/^Badge requests/, 'draazy-badge-requests.csv'],
      [/^Follow-up/, 'draazy-follow-up.csv'],
      [/^Flagged/, 'draazy-flagged.csv'],
      [/^All listings/, 'draazy-listings.csv'],
    ];

    for (const [name, filename] of expected) {
      if (name.source !== '^To verify') await openTab(page, name, name.source.includes('All') ? { archived: 'false', page: '0', size: String(PAGE_LIMIT) } : undefined);
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Export CSV' }).click(),
      ]);
      expect(download.suggestedFilename()).toBe(filename);
    }
  });

  test('the follow-up queue is unconfirmed live listings, not every approved listing', async ({ page, login, request }) => {
    const fresh = await pendingListing('fresh-followup');
    expect((await approveListing(request, fresh.id, await authHeaders(ACTORS.admin))).status()).toBe(200);
    const headers = await authHeaders(ACTORS.admin);
    const live = await api('GET', '/admin/properties?status=approved&archived=false&size=1', headers);
    const quiet = await api('GET', '/admin/properties?status=approved&archived=false&unconfirmed=true&size=1', headers);
    expect(quiet.body.totalElements).toBeLessThan(live.body.totalElements);

    await login.asAdmin();
    await openConsole(page);
    await openTab(page, /^All listings/, { archived: 'false', page: '0', size: String(PAGE_LIMIT) });
    await search(page, fresh.title, { archived: 'false', size: String(PAGE_LIMIT) });
    await expect(rowFor(page, fresh.title)).toHaveCount(1);

    await openTab(page, /^Follow-up/, { status: 'approved', archived: 'false', unconfirmed: 'true', page: '0', size: String(PAGE_LIMIT) });
    await search(page, fresh.title, { status: 'approved', archived: 'false', unconfirmed: 'true', size: String(PAGE_LIMIT) });
    await expect(rowFor(page, fresh.title)).toHaveCount(0);
  });

  test('staff-posted listings are found by Source on All, keep the staff track, and record claim-link opens', async ({ page, login, browser, baseURL }) => {
    const desk = await conciergeListing('staff-source');
    const owner = await pendingListing('owner-source');

    const ownerContext = await browser.newContext({ baseURL });
    try {
      const ownerPage = await ownerContext.newPage();
      await signIn(ownerPage, desk.ownerMobile, { search: `claim=${desk.id}` });
      await ownerPage.waitForURL(/\/dashboard/);
    } finally {
      await ownerContext.close();
    }

    await login.asAdmin();
    await openConsole(page);
    await openTab(page, /^All listings/, { archived: 'false', page: '0', size: String(PAGE_LIMIT) });
    await pickChip(page, 'Source', 'Staff posted');
    await search(page, desk.title, { archived: 'false', postedByAdmin: 'true', size: String(PAGE_LIMIT) });
    const staffRow = rowFor(page, desk.title);
    await expect(staffRow).toHaveCount(1);
    await expect(staffRow.getByTestId('progress-tracker')).toHaveAttribute('data-track', 'staff');
    await expect(staffRow.getByTestId('progress-tracker')).toHaveAttribute('data-step', 'created');
    await expect(staffRow.getByTestId('link-opened')).toBeVisible();

    await search(page, owner.title, { archived: 'false', postedByAdmin: 'true', size: String(PAGE_LIMIT) });
    await expect(rowFor(page, owner.title)).toHaveCount(0);
  });

  test('a staff-posted listing cannot publish until its owner confirms', async ({ page, login, request }) => {
    const desk = await conciergeListing('confirm');
    const checker = await authHeaders(STAFF.rental);

    const refused = await approveListing(request, desk.id, checker);
    expect(refused.status()).toBe(409);
    expect(await refused.text()).toContain('owner_not_confirmed');

    const ownerHeaders = await authHeaders(desk.ownerMobile);
    expect((await api('POST', `/me/listings/${desk.id}/confirm`, ownerHeaders)).status).toBe(204);

    await login.asAdmin();
    await openConsole(page);
    await openTab(page, /^All listings/, { archived: 'false', page: '0', size: String(PAGE_LIMIT) });
    await pickChip(page, 'Source', 'Staff posted');
    await search(page, desk.title, { archived: 'false', postedByAdmin: 'true', size: String(PAGE_LIMIT) });
    await expect(rowFor(page, desk.title).getByTestId('progress-tracker')).toHaveAttribute('data-step', 'in_review');
  });

  test('the public search cannot be turned into an owner directory', async () => {
    const admin = await authHeaders(ACTORS.admin);
    const publicList = await api('GET', '/properties?page=0&size=1&sort=newest');
    const listed = publicList.body.content[0];
    expect(listed).toBeTruthy();

    // The owner's real details, read from the side that is allowed to have them.
    const full = await api('GET', `/admin/properties?page=0&size=1&q=${encodeURIComponent(listed.id)}`, admin);
    const owner = full.body.content[0]?.owner;
    expect(owner?.name).toBeTruthy();
    expect(owner?.mobile).toBeTruthy();

    const publicTotal = async (term) => (await api('GET', `/properties?page=0&size=5&q=${encodeURIComponent(term)}`)).body.totalElements;
    const adminTotal = async (term) => (await api('GET', `/admin/properties?page=0&size=5&q=${encodeURIComponent(term)}`, admin)).body.totalElements;

    expect(await adminTotal(owner.mobile)).toBeGreaterThan(0);
    expect(await publicTotal(owner.mobile)).toBe(0);
    // Names are weaker evidence than numbers, because an owner's name can legitimately occur in a title or a locality.
    if (!`${listed.title} ${listed.locality || ''}`.toLowerCase().includes(owner.name.toLowerCase())) {
      expect(await adminTotal(owner.name)).toBeGreaterThan(0);
      expect(await publicTotal(owner.name)).toBe(0);
    }
  });

  test('a queue mid-search marks stale rows inert before they can be acted on', async ({ page, login }) => {
    const first = await pendingListing('race-first');
    const target = await pendingListing('race-target');

    await login.asAdmin();
    await openConsole(page);
    await search(page, first.title, { status: 'pending', archived: 'false', size: String(PAGE_LIMIT) });
    await expect(rowFor(page, first.title)).toHaveCount(1);

    await searchBox(page).fill(target.id);
    const stale = page.getByTestId('queue-updating');
    await expect(stale).toBeVisible();
    await expect(stale).toHaveCSS('pointer-events', 'none');
    await expect(rowFor(page, target.title)).toHaveCount(1);
    await expect(rowFor(page, first.title)).toHaveCount(0);
  });
});
