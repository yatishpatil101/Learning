import { test, expect, STAFF } from '../../../fixtures/live.js';
import { API, apiLogin, authHeaders, uniqueMobile } from '../../../helpers/liveAuth.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';
import { tenantRoomAgreement } from '../../../helpers/flatmateAgreement.js';
import { trackErrors } from '../../../helpers/console.js';
import { withSocietyId } from '../../../helpers/liveSociety.js';

const track = flatmateCleanup(test);
const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const COVER = 'https://cdn.example/zztest-cover-first.jpg';
const SECOND = 'https://cdn.example/zztest-cover-second.jpg';
const FALLBACK = /images\.unsplash\.com/;

test.describe('LIVE: room card cover', () => {
  test('a room card shows the host\'s first photo, not the stock fallback', async ({ page }) => {
    const { accessToken } = await apiLogin(uniqueMobile());
    const society = `Zztest Cover ${Date.now().toString(36)}`;
    const created = await fetch(`${API}/flatmates/rooms`, {
      method: 'POST',
      headers: auth(accessToken),
      body: JSON.stringify({
        ...(await withSocietyId(accessToken, { society })), roomType: 'Private room', locality: 'Baner', rentShare: 17333, bhk: '2',
        attachedBath: 'attached', furnishing: 'semi', lookingFor: 'any', foodPref: 'any',
        availableFrom: '2026-12-01', hostRole: 'tenant', photos: [COVER, SECOND],
        ...(await tenantRoomAgreement(accessToken)),
      }),
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const room = await created.json();
    track('rooms', room.id, accessToken);

    const published = await fetch(`${API}/admin/flatmates/${room.id}/moderation`, {
      method: 'PATCH',
      headers: await authHeaders(STAFF.rental),
      body: JSON.stringify({ modStatus: 'live', note: 'Zztest room-card cover fixture' }),
    });
    expect(published.status, await published.clone().text()).toBe(200);

    const feed = await fetch(`${API}/flatmates/feed?tab=move-in&minBudget=17000&maxBudget=17500&size=100`).then((r) => r.json());
    const row = (feed.content || []).find((r) => r.id === room.id);
    expect(row, 'the published room should be on the public feed').toBeTruthy();
    expect(row.cover, 'the feed projects the first photo as the cover').toBe(COVER);
    expect(row.photos, 'the gallery itself stays on the detail read').toBeUndefined();
    expect(row.availableFrom, "the card's Move-in column reads the room's date").toBe('2026-12-01');

    const errors = trackErrors(page);
    await page.goto('/flatmates');
    await expect(page.getByRole('button', { name: /Move in now/i }).first()).toBeVisible({ timeout: 30_000 });
    await page.getByPlaceholder(/^Try:/).fill(society);
    const card = page.locator(`[data-sf-id="r:${room.id}"]`);
    await expect(card).toBeVisible({ timeout: 15_000 });
    const img = card.locator('img').first();
    await expect(img).toHaveAttribute('src', COVER);
    await expect(img).not.toHaveAttribute('src', FALLBACK);
    await expect(card.getByText('From 1 Dec')).toBeVisible();
    expect(errors.filter((e) => !/cdn\.example/.test(e)), `console errors: ${errors.join('\n')}`).toHaveLength(0);
  });
});
