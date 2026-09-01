/**
 * Admin → Properties → **Re-check Queue** (Q14) against the live API.
 *
 * Excluded from the default run; needs a backend under the `dev,e2e` profiles and a seeded database:
 *
 *   cd e2e; npx playwright test tests/admin/live-property-recheck-queue.spec.js --config=playwright.config.js
 *
 * ## The bargain this queue exists to keep
 *
 * When an owner edits price, furnishing or possession on an **already-approved** listing, the
 * listing keeps earning and is queued for a human instead of dropping out of search. That is a
 * promise made to buyers — the price you are looking at has not been re-checked yet — and it is only
 * honest if somebody is actually shown the queue and can drain it.
 *
 * ## Why this replaces the mock spec rather than joining it
 *
 * `property-recheck-queue.spec.js` covered the same screen and is deleted. Its seed wrote
 * `recheckPending`, `recheckReason` and `recheckRequestedAt` straight into `puneNestDB_v5` and then
 * asserted the screen rendered them — which is a test of `AdminPropertyCard`'s JSX and nothing else.
 * Three things it could not reach, all of them the actual subject:
 *
 * 1. **That the product produces the row at all.** The queue is populated by
 *    `ListingEditRules` deciding an owner's PATCH is `recheckOnly`. A spec that writes the flag by
 *    hand passes unchanged after that rule stops firing, which is the failure that empties the queue
 *    silently. Here the seed *is* the product: post a listing, get it approved, change the price,
 *    and then assert the server queued it.
 * 2. **That the listing really does stay live.** The whole trade. `GET /properties/{id}`
 *    anonymously, while the row sits in the queue, is the only assertion that checks it, and browser
 *    storage has no opinion on what the public catalogue serves.
 * 3. **That draining the queue reaches the owner.** A takedown with no recorded cause is
 *    unappealable; the reason is asserted where the owner reads it, in the verification thread.
 *
 * ## What is deliberately not asserted
 *
 * The mock backdated its row 76 hours to exercise the overdue styling. `requestRecheck` stamps
 * `Instant.now()`, so that state cannot be produced through the product's own API — reaching it
 * would mean a direct UPDATE against the database, which is the same dishonesty in a different
 * store. The age assertion here is the one that has a real failure mode: `recheckRequestedAt` is
 * `NON_NULL` on `PropertyResponse`, so a payload that drops or renames it renders
 * "waiting — no timestamp", and the strip's whole point — distinguishing a queue being worked from
 * one nobody has opened — quietly goes. Only a live spec can see that; a seeded one writes the
 * field itself.
 *
 * ## Nothing here seeds storage
 *
 * No `addInitScript`, no `localStorage.setItem`. Every state is created over the API and read back
 * over the API, with the owner's token or the admin's as the claim requires.
 */
import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders, uniqueMobile } from '../../helpers/liveAuth.js';
import { appReady } from '../../helpers/app.js';

const admin = () => authHeaders(ACTORS.admin);

const BASE_LISTING = {
  deal: 'rent',
  propertyType: 'Flat',
  price: 26000,
  city: 'Pune',
  bhk: 2,
  area: 780,
  // A real row in `GET /localities`, so the listing is filed rather than dropped into the curation
  // queue that `live-locality-queue` owns.
  locality: 'Baner',
};

/** The raised price. Far enough from the original that no rounding rule could call it unchanged. */
const NEW_PRICE = 31000;
const REJECT_REASON = 'Re-check failed \u2014 the price does not match the documents';

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/* Every listing this file adds to the shared catalogue, drained by `afterEach`. A module-level set
   is safe because the live config runs `workers: 1`. */
const created = new Set();

/**
 * A listing sitting in the re-check queue **because the server put it there**.
 *
 * Three real transitions, in the order an owner and a moderator actually perform them, and the last
 * one is not ours to make: `PATCH /me/listings/{id}` changing the price is an ordinary owner edit,
 * and whether that earns a re-check is `ListingEditRules`' decision. The final assertion is
 * therefore a claim about the product, not a fixture check — if the rule stops classifying a price
 * change as `recheckOnly`, every test in this file fails here, loudly, instead of going green
 * against an empty screen.
 */
async function queuedRecheck(tag) {
  const title = `Zztest recheck ${tag} ${String(Date.now()).slice(-7)}`;
  const ownerMobile = uniqueMobile();
  const owner = await authHeaders(ownerMobile);

  const posted = await api('POST', '/me/listings', owner, { ...BASE_LISTING, title });
  expect(posted.status, 'the owner could not post a listing').toBe(201);
  const id = posted.body.id;
  created.add(id);

  /* Approved first, and it has to be a real approval: `requestRecheck` refuses on a listing that is
     not publicly visible, because "stays live" means nothing for one already off search. A fixture
     that skipped this step would produce no queue row and no error either. */
  const approved = await api('PATCH', `/properties/${id}/status`, await admin(), { status: 'approved' });
  expect(approved.status, 'the listing could not be approved').toBe(200);

  const edited = await api('PATCH', `/me/listings/${id}`, owner, { price: NEW_PRICE });
  expect(edited.status, 'the owner could not change the price').toBe(200);

  const mine = await api('GET', `/me/listings/${id}`, owner);
  expect(mine.body.recheckPending, 'the server did not queue a re-check for a price change').toBe(true);
  expect(mine.body.recheckReason).toBe('price');
  expect(mine.body.status, 'a re-check must not take the listing off search').toBe('approved');

  return { id, title, ownerMobile, owner };
}

/**
 * Take this file's listings back out of the working queue.
 *
 * Rejection rather than deletion, because there is no delete: the platform keeps a moderated
 * listing and records the decision. A rejected listing leaves the queue, leaves the public site, and
 * stops counting — which is the state a shared catalogue needs it in.
 */
test.afterEach(async () => {
  if (!created.size) return;
  const headers = await admin();
  for (const id of created) {
    await api('PATCH', `/properties/${id}/status`, headers, {
      status: 'rejected',
      reason: 'Zztest cleanup \u2014 synthetic re-check fixture',
    });
  }
  created.clear();
});

/* `listForModeration` fetches `size=100` and reports through `console.error` when the catalogue is
   larger than that. On a database that accumulates test listings that is a statement about the size
   of the database, not about this screen. Anchored to the exact wording so nothing else is swallowed. */
const CATALOGUE_TRUNCATED = /^\[property\] \d+ listings matched but only \d+ were fetched/;
const realErrors = (errors) => errors.filter((e) => !CATALOGUE_TRUNCATED.test(e));

const tab = (page, name) => page.getByRole('tab', { name });
const cardFor = (page, title) => page.locator('.list-card').filter({ hasText: title });

/**
 * Open the re-check tab and narrow it to one listing.
 *
 * The search is not decoration. Only the first fifteen rows of a filtered set are rendered, so on a
 * shared queue "my row is not here" and "my row is on page two" are the same pixels — and after the
 * pass/fail tests below, an unfiltered queue would still hold other rows, which would make the
 * disappearance of ours unassertable.
 */
async function openQueue(page, login, title) {
  await login.asAdmin();
  await page.goto('/admin/properties?tab=recheck');
  await appReady(page);
  await expect(tab(page, /Re-check Queue/)).toHaveAttribute('aria-selected', 'true');
  if (title) {
    await page.getByPlaceholder(/Search title, owner, locality/).first().fill(title);
    await expect(cardFor(page, title)).toBeVisible({ timeout: 20000 });
  }
}

// ─── The queue is reachable, populated, and says what it is for ───

test('the queue holds the row the product put there, and names what changed', async ({ page, login, consoleErrors }) => {
  const seeded = await queuedRecheck('visible');
  await openQueue(page, login, seeded.title);

  /* The banner states the trade out loud. Without it the tab is a list of ordinary approved
     listings and the promise being kept on their behalf is invisible. */
  await expect(page.getByTestId('recheck-banner')).toContainText('still live');

  const card = cardFor(page, seeded.title);
  await expect(card.getByTestId('recheck-fields')).toHaveText('price');

  /* The age, and the reason it is worth an assertion: `recheckRequestedAt` is NON_NULL on
     `PropertyResponse`, so a payload that drops or renames it renders the honest fallback below and
     the strip stops being able to tell a worked queue from an abandoned one. Both halves asserted —
     the exact wording, and the fallback's absence — because a locator that matched nothing would
     satisfy the second alone. */
  await expect(card.getByTestId('recheck-age')).toHaveText('waiting just now');
  await expect(card.getByTestId('recheck-age')).not.toHaveText('waiting \u2014 no timestamp');

  expect(realErrors(consoleErrors)).toHaveLength(0);
});

test('the tab count is the server\u2019s own count of the queue', async ({ page, login }) => {
  const seeded = await queuedRecheck('counted');

  /* Read the queue's size from the endpoint the tab is derived from, rather than pinning a number.
     A hardcoded expectation on a shared catalogue is a clock that goes off on a fixed date; a
     comparison against the source is a real cross-check, and the `>= 1` below is what stops it
     being satisfied by a screen and a server that agree on nothing. */
  const queue = await api('GET', '/admin/properties?recheck=true&size=1', await admin());
  expect(queue.status).toBe(200);
  expect(queue.body.totalElements, 'the seeded row is not in the server queue').toBeGreaterThanOrEqual(1);

  await openQueue(page, login, seeded.title);

  /* The count in the label is the announcement: an admin who never opens this tab still sees that
     something is waiting. A bare "Re-check Queue" hides a backlog behind a click. */
  const label = await tab(page, /Re-check Queue/).innerText();
  expect(label, 'the tab painted no count at all').toMatch(/Re-check Queue \((\d+)\)/);
  expect(Number(label.match(/\((\d+)\)/)[1])).toBe(queue.body.totalElements);
});

test('the listing really is still live while it waits', async ({ page, login }) => {
  const seeded = await queuedRecheck('stays-live');

  /* The bargain itself, and the one claim in this file that browser storage has no opinion about:
     anonymously, from outside, the listing is still in the public catalogue at its **new** price.
     Asserting the price too, because a queued listing that stayed live at the *old* number would be
     a worse outcome than dropping it from search — the buyer would be reading a figure the owner
     has already moved away from. */
  const publicView = await fetch(`${API}/properties/${seeded.id}`);
  expect(publicView.status, 'a re-checked listing must stay on the public site').toBe(200);
  expect((await publicView.json()).price).toBe(NEW_PRICE);

  /* And on the desk's own "All Listings" tab it looks like any other approved row, which is exactly
     why the strip has to travel with it: without it there is no way to tell an un-reviewed price
     change from a verified one. */
  await login.asAdmin();
  await page.goto('/admin/properties');
  await appReady(page);
  await page.getByPlaceholder(/Search title, owner, locality/).first().fill(seeded.title);
  await expect(cardFor(page, seeded.title)).toBeVisible({ timeout: 20000 });
  await expect(cardFor(page, seeded.title).getByTestId('recheck-strip')).toBeVisible();
});

// ─── Draining it ───

test('passing a re-check clears it on the server and leaves the listing earning', async ({ page, login }) => {
  page.on('dialog', (d) => d.accept());
  const seeded = await queuedRecheck('pass');
  await openQueue(page, login, seeded.title);

  await cardFor(page, seeded.title).getByTestId('recheck-pass').click();
  await expect(cardFor(page, seeded.title)).toHaveCount(0);
  // Filtered to this one title, so an empty result is this row leaving rather than a re-render.
  await expect(page.getByText('No listings match your filters')).toBeVisible();

  /* Read back over the *owner's* token, from a different process than the one that clicked. "Cleared"
     and "removed from search" look identical on a tab that shows neither, and they are opposite
     outcomes for the owner. */
  const mine = await api('GET', `/me/listings/${seeded.id}`, seeded.owner);
  expect(mine.body.status, 'checked-it-all-fine must not take the listing down').toBe('approved');
  expect(mine.body.recheckPending).toBe(false);
  expect((await fetch(`${API}/properties/${seeded.id}`)).status).toBe(200);
});

test('failing a re-check takes the listing down, and tells the owner why', async ({ page, login }) => {
  const seeded = await queuedRecheck('fail');
  await openQueue(page, login, seeded.title);

  await cardFor(page, seeded.title).getByTestId('recheck-fail').click();
  await expect(page.getByRole('heading', { name: /Re-check failed/i })).toBeVisible();
  await page.getByLabel('Reason for rejection').fill(REJECT_REASON);
  await page.getByRole('button', { name: /Reject listing/i }).click();
  await expect(cardFor(page, seeded.title)).toHaveCount(0);

  const mine = await api('GET', `/me/listings/${seeded.id}`, seeded.owner);
  expect(mine.body.status).toBe('rejected');
  expect(mine.body.recheckPending).toBe(false);
  // Off the public site — the other half of "taken down", and the half a status field cannot prove.
  expect((await fetch(`${API}/properties/${seeded.id}`)).status).not.toBe(200);

  /* The reason, where the owner reads it. A takedown they cannot see a cause for is one they can
     neither fix nor appeal, and the moderator typed the sentence into an admin screen — that it
     arrives in the owner's own thread is a claim about a server transaction, so it is asserted
     against the server. */
  const thread = await api('GET', `/properties/${seeded.id}/verification`, seeded.owner);
  expect(thread.status, 'the owner cannot open the thread the decision was written into').toBe(200);
  expect(JSON.stringify(thread.body)).toContain(REJECT_REASON);
});

test('a rejection with no reason is refused, and the listing survives it', async ({ page, login }) => {
  const seeded = await queuedRecheck('no-reason');
  await openQueue(page, login, seeded.title);

  await cardFor(page, seeded.title).getByTestId('recheck-fail').click();
  await expect(page.getByRole('heading', { name: /Re-check failed/i })).toBeVisible();
  await page.getByRole('button', { name: /Reject listing/i }).click();

  // The dialog stays open rather than closing on a decision it did not take.
  await expect(page.getByRole('heading', { name: /Re-check failed/i })).toBeVisible();

  /* And nothing moved on the server. Asserted there rather than on screen because the dangerous
     version of this bug is the one where the takedown *did* go through with an empty reason and the
     dialog simply failed to close — which looks, from the browser, exactly like a refusal. */
  const mine = await api('GET', `/me/listings/${seeded.id}`, seeded.owner);
  expect(mine.body.status).toBe('approved');
  expect(mine.body.recheckPending).toBe(true);
  expect((await fetch(`${API}/properties/${seeded.id}`)).status).toBe(200);
});
