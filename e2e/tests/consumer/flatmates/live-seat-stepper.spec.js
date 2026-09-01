import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';

/**
 * The seat stepper on a group card — the browser half of "backfill a seat".
 *
 * `live-backfill.spec.js` owns the server side of this feature and owns it thoroughly: nine tests
 * over `PATCH /flatmates/groups/{id}/seats`, including both refusals told apart exactly (below zero
 * is 422 from `@Min(0)`, above `seatsTotal` is 400 from the service, because the ceiling is a
 * property of the stored group rather than of the payload). None of them opens a page — every test
 * there destructures `{ page }` and never uses it.
 *
 * So the control that actually moves a seat had no test at all, and that turned out to matter. The
 * stepper is rendered behind `owned` and `setGroupSeats` opens with `if (!ownsGroup(g)) return;` —
 * and `ownsGroup` matched on `ownerMobile`, which the public group feed deliberately does not send
 * (D211 dropped it from the card projection: a stranger may know the flat's owner consented and may
 * not know how to ring them). Against a real server the predicate answered `false` for every row on
 * the board, so the stepper was never drawn, and on the rows where it was reachable the handler
 * returned before its first await. The feature was dead end to end while nine green tests reported
 * the route behind it working perfectly. That is the shape of a contract half without a browser
 * half: both sides can be right about themselves and still not meet.
 *
 * What this file adds is therefore not more coverage of the route. It is the claim that a tap
 * reaches it, that the number the host sees afterwards is the number the server kept, and that the
 * two controls stop where the group's own ceiling and floor are.
 *
 * ## Persistence is asked of the server, not of the screen
 *
 * The mock twin proved "persists across reload" by reloading the page. Under a mock provider that
 * is a statement about `JSON.parse`: the store and the card are the same object graph, so a reload
 * can only disagree with the click if serialisation is broken. Here each move is checked twice —
 * the card re-reads its count from the public feed after a reload, and `GET /me/flatmate-groups`
 * is asked separately what the server thinks. A stepper that repainted optimistically and dropped
 * the request would satisfy the first and fail the second.
 *
 * ## Two claims of the mock twin that are not carried over
 *
 * Its fourth test — reopening a seat keeps the group's Tenant-verified badge, so a re-list needs no
 * re-verification — seeded `puneNestFlatmateReviews` to get there. The badge is gated by
 * `showHostBadge`, which for tenant tier returns `reviewStatus === 'approved'`, and `reviewStatus`
 * comes from `getFlatmateReviewStatusMap()` in `lib/data/flatmates.js`: localStorage. There is no
 * live route that grants it, so a live version of that test could only pass by seeding the same key
 * and would then be a mock test wearing this file's name. The underlying rule is not unguarded —
 * `live-backfill.spec.js` pins that `verificationTier` survives both a close and a reopen at the
 * API — so what is missing is only the badge's rendering, and it stays missing here rather than
 * being faked.
 *
 * Its fifth test built a group with no `seatsOpen` at all, to exercise the mapper's arithmetic
 * fallback in `seatsLeftOf`. The server sends `seatsOpen` on every group read, so that row cannot
 * be constructed against a live backend by any route a user has. It is a mapper branch, and a unit
 * test on `seatsLeftOf` is where it belongs; asserting it here would require a fixture the product
 * cannot produce.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const track = flatmateCleanup(test);

/** Let a group out of moderation, the way Ops does. A new group is `pending`, so the public feed —
 *  which is what the board reads — cannot see it, and the host cannot see their own card either. */
async function approve(groupId) {
  const { accessToken } = await apiLogin(ACTORS.admin);
  const res = await fetch(`${API}/admin/flatmates/${groupId}/moderation`, {
    method: 'PATCH',
    headers: auth(accessToken),
    body: JSON.stringify({ modStatus: 'live', note: 'e2e' }),
  });
  expect(res.status).toBeLessThan(300);
}

/** A signed-in browser session and an API token for the same person. */
async function newHost(page) {
  const mobile = await signedInAsNew(page);
  const { accessToken } = await apiLogin(mobile);
  return { mobile, accessToken };
}

/* Titles are unique per test: the board is one shared list, and the DB is reset per run rather than
   per file, so a fixed title would let one test's group answer another test's locator. */
const uniqueTitle = (tag) => `Live seats ${tag} ${Date.now().toString(36)} in Baner`;

/** Create the group over the API. The form is `live-group-lifecycle.spec.js`'s claim; what this
 *  file is about starts once a card for an owned group is on screen. Note `seats`, not
 *  `seatsTotal` — the response renames it and the request does not accept the renamed form. */
async function hostsGroup(token, title, { seats = 3, seatsOpen = 1 } = {}) {
  const res = await fetch(`${API}/flatmates/groups`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({
      title, name: 'Seat Host', locality: 'Baner', rent: 45000, seats, seatsOpen,
      policy: 'any', role: 'tenant',
    }),
  });
  expect(res.status).toBe(201);
  const group = await res.json();
  track('groups', group.id, token);
  await approve(group.id);
  return group;
}

/** What the server kept — the half a reload cannot answer. */
async function serverSeatsOpen(token, groupId) {
  const res = await fetch(`${API}/me/flatmate-groups?size=100`, { headers: auth(token) });
  expect(res.status).toBe(200);
  const body = await res.json();
  const rows = body.items ?? body.content ?? body;
  const row = rows.find((g) => g.id === groupId);
  expect(row, 'the group should be on the host\'s own list').toBeTruthy();
  return row.seatsOpen;
}

/** Open the board on the Team up tab. Groups live behind it, and a group created a moment ago is
 *  only on the public feed once `approve` has run — `submitGroup` refreshes the feed the instant
 *  the create resolves, which is before that. Reloading here is what makes the card appear. */
async function openTeamUp(page) {
  await page.goto(`${BASE}/flatmates`);
  await expect(page.getByRole('button', { name: /Move in now/i })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Team up/ }).first().click();
}

const cardFor = (page, title) => page.locator('.sf-card', { hasText: title }).first();

test.describe('Flatmate seat stepper (live)', () => {
  test('a group shows the seats it declared open, not the seats it has', async ({ page }) => {
    const { accessToken } = await newHost(page);
    const title = uniqueTitle('declared');
    await hostsGroup(accessToken, title, { seats: 3, seatsOpen: 1 });

    await openTeamUp(page);
    const card = cardFor(page, title);
    await expect(card).toBeVisible({ timeout: 15_000 });

    // One seat open out of three sharing. Both halves matter: a card that showed `seatsTotal` in
    // the seats badge would read as a group with room for three when only one place is going.
    await expect(card.getByText(/1 seat left/i)).toBeVisible();
    await expect(card.getByText(/3 sharing/i)).toBeVisible();
  });

  test('reopening a seat moves the count, and the server is the one that kept it', async ({ page }) => {
    const { accessToken } = await newHost(page);
    const title = uniqueTitle('reopen');
    const group = await hostsGroup(accessToken, title, { seats: 3, seatsOpen: 1 });

    await openTeamUp(page);
    const card = cardFor(page, title);
    await expect(card).toBeVisible({ timeout: 15_000 });

    /* The stepper is drawn only for a card the page recognises as the host's own, and recognising
       it is exactly what was broken. Asserting the control is present before using it means a
       regression there reports itself here rather than as a mysteriously unmoved number. */
    await expect(card.locator('.seat-reopen-btn')).toBeVisible();
    await card.locator('.seat-reopen-btn').click();

    await expect(card.getByText(/2 seats left/i)).toBeVisible({ timeout: 10_000 });
    expect(await serverSeatsOpen(accessToken, group.id)).toBe(2);

    // And it is still two after a reload, read back off the public feed rather than out of the
    // component that just rendered it.
    await openTeamUp(page);
    await expect(cardFor(page, title).getByText(/2 seats left/i)).toBeVisible({ timeout: 15_000 });
  });

  test('marking the last open seat filled turns the group Full and stops the stepper', async ({ page }) => {
    const { accessToken } = await newHost(page);
    const title = uniqueTitle('fill');
    const group = await hostsGroup(accessToken, title, { seats: 2, seatsOpen: 1 });

    await openTeamUp(page);
    const card = cardFor(page, title);
    await expect(card).toBeVisible({ timeout: 15_000 });

    await card.locator('.seat-close-btn').click();

    // "Full" is not a field the API carries; it is `seatsOpen === 0` as the card reads it.
    await expect(card.getByText(/^Full$/)).toBeVisible({ timeout: 10_000 });
    expect(await serverSeatsOpen(accessToken, group.id)).toBe(0);

    // The floor is held by the control itself, so a second tap cannot ask for -1. The server would
    // refuse that with a 422 (`live-backfill.spec.js` pins it); this is the half that means the
    // host never sees the error at all.
    await expect(card.locator('.seat-close-btn')).toBeDisabled();
  });

  test('the reopen control stops at the ceiling the group was created with', async ({ page }) => {
    const { accessToken } = await newHost(page);
    const title = uniqueTitle('ceiling');
    const group = await hostsGroup(accessToken, title, { seats: 2, seatsOpen: 1 });

    await openTeamUp(page);
    const card = cardFor(page, title);
    await expect(card).toBeVisible({ timeout: 15_000 });

    /* Enabled first, then disabled after one tap takes the count to `seatsTotal`. Asserting only
       the disabled end would pass just as well if the button were disabled the whole time — which
       is precisely how this looked while `ownsGroup` was answering false. */
    await expect(card.locator('.seat-reopen-btn')).toBeEnabled();
    await card.locator('.seat-reopen-btn').click();

    await expect(card.getByText(/2 seats left/i)).toBeVisible({ timeout: 10_000 });
    await expect(card.locator('.seat-reopen-btn')).toBeDisabled();
    expect(await serverSeatsOpen(accessToken, group.id)).toBe(2);
  });

  test("a seeker gets no stepper on somebody else's group", async ({ page }) => {
    /* The negative half of the ownership predicate. The bug made every card read as not-mine; the
       repair must not make every card read as mine, and only a card owned by someone else can tell
       those apart. */
    const strangerMobile = uniqueMobile();
    const { accessToken: strangerToken } = await apiLogin(strangerMobile);
    const title = uniqueTitle('stranger');
    await hostsGroup(strangerToken, title, { seats: 3, seatsOpen: 2 });

    await newHost(page);
    await openTeamUp(page);
    const card = cardFor(page, title);
    await expect(card).toBeVisible({ timeout: 15_000 });

    await expect(card.locator('.seat-reopen-btn')).toHaveCount(0);
    await expect(card.locator('.seat-close-btn')).toHaveCount(0);
    // The seats badge is still public — what is withheld is the ability to move it.
    await expect(card.getByText(/2 seats left/i)).toBeVisible();
  });
});
