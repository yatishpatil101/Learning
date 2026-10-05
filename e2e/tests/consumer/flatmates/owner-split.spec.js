import { test, expect } from '@playwright/test';
import { API, apiLogin, authHeaders, uploadedListingPhotos, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS, STAFF } from '../../../fixtures/live.js';
import { approveListingWithFetch, rejectListingWithFetch } from '../../../helpers/moderation.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

async function api(method, path, headers, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* a 204 has no body */ }
  return { status: response.status, text, json };
}

const created = [];

async function ownerWithFlat({ deal = 'rent', bhk = 3, price = 36000, approve = true, propertyType = 'Flat', owner } = {}) {
  const mobile = owner?.mobile ?? uniqueMobile();
  const { accessToken } = owner ?? await apiLogin(mobile);

  const listing = await api('POST', '/me/listings', auth(accessToken), {
    deal,
    propertyType,
    price,
    city: 'Pune',
    bhk,
    area: 1100,
    locality: 'Baner',
    title: `Zztest owner split ${Date.now().toString(36)}`,
    images: await uploadedListingPhotos(accessToken),
  });
  expect(listing.status, listing.text).toBe(201);

  if (approve) {
    const approved = await approveListingWithFetch(listing.json.id, await authHeaders(ACTORS.admin));
    expect(approved.status, approved.text).toBe(200);
  }

  const record = { mobile, accessToken, listingId: listing.json.id, split: false };
  created.push(record);
  return record;
}

async function publishRoom(id) {
  const published = await api('PATCH', `/admin/flatmates/${id}/moderation`,
    await authHeaders(STAFF.rental), { modStatus: 'approved' });
  expect(published.status, published.text).toBe(200);
}
// Empty occupied rooms first; unsplit refuses while anyone lives there.
test.afterAll(async () => {
  for (const flat of created) {
    if (flat.split) {
      const rooms = await api('GET', '/me/flatmate-rooms?size=100', auth(flat.accessToken));
      for (const room of rooms.json?.content || rooms.json?.items || []) {
        if (Number(room.occupants) > 0) {
          await api('PATCH', `/flatmates/rooms/${room.id}/occupants`,
            auth(flat.accessToken), { occupants: 0 });
        }
      }
      await api('DELETE', `/properties/${flat.listingId}/split`, auth(flat.accessToken));
    }
    await rejectListingWithFetch(flat.listingId, await authHeaders(ACTORS.admin), {
      reason: 'Zztest cleanup — synthetic owner-split fixture',
    });
  }
});
/* ─── Browser helpers ───────────────────────────────────────────────────────────────────────── */
async function openMyProperties(page, title) {
  await page.goto(`${BASE}/dashboard#properties`);
  await expect(page.getByText(title, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
}

async function splitInto(page, want) {
  const roomAction = page.getByRole('button', { name: 'Let room by room', exact: true });
  await expect(roomAction).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take down', exact: true })).toBeVisible();
  await roomAction.click();

  const modal = page.getByRole('dialog', { name: 'Let this flat room by room' });
  await expect(modal).toBeVisible();
  const rentOf = (i) => modal.locator('input[inputmode="numeric"]').nth(i * 2);

  let shown = await modal.getByRole('button', { name: /Remove this room/ }).count();
  if (shown === 0) shown = 1; // a single room has no remove control
  while (shown > want) {
    await modal.getByRole('button', { name: /Remove this room/ }).last().click();
    shown -= 1;
  }
  while (shown < want) {
    await modal.getByRole('button', { name: /Add a room/ }).click();
    shown += 1;
  }
  for (let i = 0; i < want; i += 1) await rentOf(i).fill(String(15000 - i * 2000));

  const confirm = modal.getByRole('button', { name: /List \d+ rooms?/ });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(modal).toBeHidden();
}

test('sale listings are never offered the split', async ({ page }) => {
  const sale = await ownerWithFlat({ deal: 'buy', price: 9_000_000 });
  await signedInAs(page, sale.mobile);
  await openMyProperties(page, 'Zztest owner split');
  /* Splitting twice would put two room sets on one propertyId and corrupt the occupancy ledger, so
     the card swaps the action rather than offering one the server will refuse with 409. */

  await expect(page.getByText('Let room by room')).toHaveCount(0);
});

test('commercial listings are never offered the split', async ({ page }) => {
  const shop = await ownerWithFlat({ propertyType: 'Shop / Showroom' });
  await signedInAs(page, shop.mobile);
  await openMyProperties(page, 'Zztest owner split');

  await expect(page.getByText('Let room by room')).toHaveCount(0);
});
test('a pending rental keeps room management and withdrawal visible', async ({ page }) => {
  const flat = await ownerWithFlat({ approve: false });
  await signedInAs(page, flat.mobile);
  await openMyProperties(page, 'Zztest owner split');

  await expect(page.getByRole('button', { name: 'Let room by room', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Withdraw', exact: true })).toBeVisible();
});

test('splitting writes rooms the server can see, then the split flat is not offered a second split and can be withdrawn while empty', async ({ page }) => {
  test.slow();
  const flat = await ownerWithFlat();
  await signedInAs(page, flat.mobile);
  await openMyProperties(page, 'Zztest owner split');
  await splitInto(page, 2);
  flat.split = true;

  await test.step('splitting from the dashboard writes rooms the server can see, and the card says so', async () => {
    // The card is the owner's only report that the split happened at all.
    await expect(page.getByText(/2 rooms listed/).first()).toBeVisible({ timeout: 15_000 });
    // While the flat is empty it can still honestly be let whole, so the whole-flat listing stays.
    await expect(page.getByText('Whole-flat listing still live').first()).toBeVisible();
    /* Read on a connection the page is not holding: a card rendering from its own optimistic state would
       satisfy the assertions above and fail this one. */
    const mine = await api('GET', '/me/flatmate-rooms?size=100', auth(flat.accessToken));
    expect(mine.status, mine.text).toBe(200);
    const rows = (mine.json.content || mine.json.items || [])
      .filter((r) => String(r.propertyId) === String(flat.listingId));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.priceBasis === 'room')).toBe(true);
    expect(rows.every((r) => Number(r.occupants) === 0)).toBe(true);
    expect(rows.map((r) => r.budget).sort((a, b) => a - b)).toEqual([13000, 15000]);
  });

  await test.step('a split flat is not offered a second split, and can be withdrawn while empty', async () => {
    await expect(page.getByRole('button', { name: 'Let room by room', exact: true })).toHaveCount(0);
    const stop = page.getByRole('button', { name: 'Stop letting room by room' });
    await expect(stop).toBeVisible();

    await stop.click();
    await expect(page.getByText(/2 rooms listed/)).toHaveCount(0, { timeout: 15_000 });
    flat.split = false;
    const mine = await api('GET', '/me/flatmate-rooms?size=100', auth(flat.accessToken));
    const rows = (mine.json.content || mine.json.items || [])
      .filter((r) => String(r.propertyId) === String(flat.listingId));
    expect(rows).toHaveLength(0);
  });
});

test('the split modal is legible and behaves like a dialog', async ({ page }) => {
  const flat = await ownerWithFlat();
  await signedInAs(page, flat.mobile);
  await openMyProperties(page, 'Zztest owner split');
  await page.getByRole('button', { name: 'Let room by room', exact: true }).click();

  const modal = page.getByRole('dialog', { name: 'Let this flat room by room' });
  await expect(modal).toBeVisible();
  /* `.field` is styled only under `.sf-page`, and this modal opens from the dashboard — so preflight's
     `color: inherit` painted the typed rent white on white, which `toHaveValue()` passes against. */

  const rent = modal.locator('input[inputmode="numeric"]').first();
  await rent.fill('15000');
  await expect(rent).toHaveValue('15,000');
  const paint = await rent.evaluate((el) => {
    const s = getComputedStyle(el);
    return { color: s.color, background: s.backgroundColor };
  });
  expect(paint.color, 'the typed rent must not be painted in its own background colour')
    .not.toBe(paint.background);
  expect(paint.background, 'an unstyled field falls back to the UA white box')
    .not.toBe('rgb(255, 255, 255)');

  const digit = modal.getByRole('button', { name: '3', exact: true }).first();
  const offset = await digit.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const text = range.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return Math.abs((text.left + text.right) / 2 - (box.left + box.right) / 2);
  });
  expect(offset, 'the digit must sit in the middle of its box').toBeLessThan(2);

  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
});

test('a split room carries the owner badge publicly; once someone moves in the flat cannot be withdrawn', async ({ page }) => {
  test.slow();
  const flat = await ownerWithFlat();
  await signedInAs(page, flat.mobile);
  await openMyProperties(page, 'Zztest owner split');
  await splitInto(page, 1);
  flat.split = true;
  await expect(page.getByText(/1 room listed/).first()).toBeVisible({ timeout: 15_000 });

  const mine = await api('GET', '/me/flatmate-rooms?size=100', auth(flat.accessToken));
  const room = (mine.json.content || mine.json.items || [])
    .find((r) => String(r.propertyId) === String(flat.listingId));
  expect(room, 'the split must have produced a room').toBeTruthy();

  await test.step('rooms split from an approved flat carry the owner badge on the public board', async () => {
    /* The badge is the whole point of splitting rather than posting a room: the flat was already proven.
       Decided by the server from the parent's status — `verificationTier` is not a field any client sends. */
    expect(room.verificationTier).toBe('owner');
    expect(room.verified).toBe(true);

    await publishRoom(room.id);
    const seeker = await page.context().browser().newPage();
    await seeker.goto(`${BASE}/flatmates?view=rooms`);
    const card = seeker.locator(`[data-sf-id="r:${room.id}"]`);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByRole('img', { name: /Owner[- ]verified/i })).toBeVisible();
    await seeker.close();
  });

  await test.step('once someone moves in the flat cannot be withdrawn, and the card explains the disappearance', async () => {
    const moved = await api('PATCH', `/flatmates/rooms/${room.id}/occupants`,
      auth(flat.accessToken), { occupants: 1 });
    expect(moved.status, moved.text).toBe(200);

    await page.reload();
    await openMyProperties(page, 'Zztest owner split');
    /* A silent disappearance reads as a bug: the whole flat cannot be let while occupied, so it comes
       off public search and the card states the cause rather than leaving the owner to notice. */

    await expect(page.getByText(/1 moved in · whole-flat listing hidden/i).first())
      .toBeVisible({ timeout: 20_000 });

    // Deleting those rooms would erase a live tenancy, so the direct action is absent — not refused.
    await expect(page.getByRole('button', { name: 'Stop letting room by room' })).toHaveCount(0);
  });
});
