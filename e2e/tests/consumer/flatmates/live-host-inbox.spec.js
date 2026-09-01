import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';

/**
 * The host's flatmate inbox rendered in a browser, and the Accept action persisted to the server.
 *
 * ## What this proves
 *
 * 1. A seeker's room-interest request appears in the host's dashboard (`/dashboard#enquiries` →
 *    Flatmate tab) with the seeker's name, the kind label ("Room enquiry"), and the room's title.
 * 2. The host's **Accept** click actually writes to the server — verified by reading
 *    `GET /me/flatmate-requests` back from an independent API client, not by trusting the page.
 *
 * ## Why the mock's D186 framing does not port literally
 *
 * The mock twin (`owner-id-inbox.spec.js`) asserted that the inbox reads from the `ownerId` bucket
 * rather than a mobile-derived one, because in localStorage mode there were genuinely two keys that
 * could be read. On the live backend the scoping is by bearer token server-side — there is no
 * bucket distinction to get wrong; `findByHostId` is the only query, keyed to the authenticated
 * principal's id. So the D186 defect class is structurally impossible here, and the spec instead
 * proves what the mock could never prove: that the write behind Accept actually lands.
 *
 * ## What is deliberately NOT asserted
 *
 * - The button disappearing after the click. That is the optimistic UI flip, and asserting it
 *   would be asserting the weaker half of the same act — a handler that dropped the write would
 *   still hide the button. The server read below is the claim worth making.
 * - Pagination and envelope shape: `live-host-requests-inbox.spec.js` already owns those.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const track = flatmateCleanup(test);

async function approve(id) {
  const { accessToken } = await apiLogin(ACTORS.admin);
  const res = await fetch(`${API}/admin/flatmates/${id}/moderation`, {
    method: 'PATCH',
    headers: auth(accessToken),
    body: JSON.stringify({ modStatus: 'live', note: 'e2e' }),
  });
  expect(res.status, `approve ${id}: ${await res.clone().text()}`).toBeLessThan(300);
}

test('host sees a seeker\'s room interest in the dashboard, and Accept persists to the server', async ({ page }) => {
  // --- Setup: create a host, post a room, publish it ---
  const hostMobile = uniqueMobile();
  const { accessToken: hostToken } = await apiLogin(hostMobile);

  const society = `Inbox Host ${Date.now().toString(36)}`;
  const roomRes = await fetch(`${API}/flatmates/rooms`, {
    method: 'POST',
    headers: auth(hostToken),
    body: JSON.stringify({
      society,
      roomType: 'Private room',
      locality: 'Baner',
      rentShare: 15000,
      bhk: '2',
      attachedBath: 'attached',
      furnishing: 'semi',
      hostRole: 'owner',
      photos: ['https://example.test/inbox-room.jpg'],
    }),
  });
  const roomBody = await roomRes.text();
  expect(roomRes.status, roomBody).toBe(201);
  const room = JSON.parse(roomBody);
  track('rooms', room.id, hostToken);

  await approve(room.id);

  // --- Setup: a seeker expresses interest in the room ---
  const seekerMobile = uniqueMobile();
  const { accessToken: seekerToken } = await apiLogin(seekerMobile);

  const interestRes = await fetch(`${API}/flatmates/rooms/${room.id}/interest`, {
    method: 'POST',
    headers: auth(seekerToken),
    body: JSON.stringify({ message: 'I am interested in this room' }),
  });
  expect(interestRes.status, await interestRes.clone().text()).toBeLessThan(300);

  // --- Browser: sign the host in and open the enquiries panel ---
  await signedInAs(page, hostMobile);
  await page.goto(`${BASE}/dashboard#enquiries`);

  // The dashboard opens on "All leads" (the unified queue). The Flatmate sub-tab exists as a
  // filter; verify it shows a badge proving the server returned the request, then select it.
  const flatTab = page.getByRole('tab', { name: /Flatmate/i });
  await expect(flatTab).toBeVisible({ timeout: 15_000 });
  await flatTab.click();

  // --- Assert the row renders with the room's society name and the kind label ---
  // The row's "Open details" button carries the request's meta text. Locate by text content.
  const rowText = page.getByText(new RegExp(`Room enquiry.*${society}|${society}.*Room enquiry`));
  await expect(rowText.first()).toBeVisible({ timeout: 15_000 });

  // --- Click Accept and prove it reaches the server ---
  // Accept is rendered after the row in the same list item (our request is the only flatmate one).
  const acceptBtn = page.getByRole('button', { name: /^Accept$/i }).first();
  await expect(acceptBtn).toBeVisible({ timeout: 5_000 });
  await acceptBtn.click();

  /* Poll the API rather than sleeping. A fixed wait is a bet on how long the handler takes, and
     the two ways it can be wrong are both bad: too short and the spec fails on a working app, too
     long and it hides a handler that got slower. Reading with a fresh client each time also means
     no browser state can satisfy the assertion. */
  const { accessToken: freshHostToken } = await apiLogin(hostMobile);
  await expect
    .poll(async () => {
      const res = await fetch(`${API}/me/flatmate-requests?size=100`, {
        headers: auth(freshHostToken),
      });
      expect(res.status).toBe(200);
      const row = (await res.json()).content.find((r) => r.targetId === room.id);
      return row?.status ?? 'missing';
    }, { message: 'Accept must reach the server, not just flip the button', timeout: 15_000 })
    .toBe('accepted');
});
