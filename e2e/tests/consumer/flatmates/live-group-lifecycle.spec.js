import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';

/**
 * Group lifecycle — the screen, not the contract.
 *
 * `live-groups.spec.js` already owns the server side of a flatmate group: the create payload, the
 * seats ceiling, the moderation default, the join guards. This file is deliberately the other
 * half, and it exists because the three bugs the original mock spec was written for were all
 * bugs of the *card*, not of the route:
 *
 *   A — a created group vanished on reload (it lived only in component state);
 *   C — the host was offered "Join group" on their own group;
 *   C2 — deleting from the card left the row behind.
 *
 * ## Why the mock twin could not prove any of them
 *
 * It established its host by writing `localStorage.puneNestUser` and its group by writing
 * `puneNestFlatmateGroups`. Under those conditions "survives a reload" is a statement about
 * `JSON.parse`, and "the host sees Your group" is a statement about two strings matching in the
 * same tab. Both are true of a build with no server at all. Here the host is a real session, the
 * group is a real row, and the reload genuinely re-fetches — so A is now a claim about
 * persistence, and C is a claim about the server telling this browser which rows are its own.
 *
 * C2 additionally gets the assertion the mock could not make at all: after the card disappears,
 * the host's own `/me` listing is re-read over the API. A delete that only removed the card would
 * pass every on-screen assertion and still leave the group live for every seeker.
 *
 * ## Moderation is done the way a moderator does it
 *
 * Every group is born `pending` and the board filters on a whitelist, so a spec that creates one
 * through the form sees nothing until it is let out. The mock stood in for the moderator by
 * rewriting `modStatus` in storage; there is a real route for this, and using it keeps the fixture
 * honest — a group that reaches the board here reached it the way a real one does.
 *
 * ## What the mock claimed that this file does not
 *
 * Its test B — "a created group appears in dashboard My Listings and is deletable there" — has no
 * live counterpart yet, and could not be given one honestly. `MyListingsPanel.jsx` still deletes a
 * flatmate group through `deleteFlatmateGroup` in `lib/data/flatmates.js`, i.e. out of
 * localStorage; the property branch beside it was moved onto the seam and this one was not. A live
 * test there would either fail or, worse, pass by exercising the storage path while appearing to
 * cover the API. The claim is dropped here rather than faked, and the panel is the fix that would
 * earn it back.
 *
 * ## Two bugs this file found on its first run
 *
 * Both were invisible to the mock for the same underlying reason — the mock provider stores the
 * page's own object graph, so the page and the store cannot disagree about a field name, and the
 * wire is where they disagreed:
 *
 *   1. `createGroup` sent no `name`. The form puts the host under `ownerName`, the wire calls it
 *      `name`, and the server rejected every create with 422 `name: must not be blank`. Creating a
 *      group through the UI was impossible against a real backend.
 *   2. `ownsGroup` matched on `ownerMobile`, which the public feed deliberately withholds (D211).
 *      It therefore answered `false` for every row on the board: no Delete, "Join group" offered
 *      to the host on their own group — bug C, back again — and the seat stepper, gated on the
 *      same predicate, inert.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

const track = flatmateCleanup(test);

/** Let a group out of moderation, over the route the Ops console uses. */
async function approve(groupId) {
  const { accessToken } = await apiLogin(ACTORS.admin);
  const res = await fetch(`${API}/admin/flatmates/${groupId}/moderation`, {
    method: 'PATCH',
    headers: auth(accessToken),
    body: JSON.stringify({ modStatus: 'live', note: 'e2e' }),
  });
  expect(res.status).toBeLessThan(300);
}

/** The board's lazy chunk resolves well after `load`; "Move in now" is static, so it survives an empty feed. */
async function openBoard(page, query = '') {
  await page.goto(`${BASE}/flatmates${query}`);
  await expect(page.getByRole('button', { name: /Move in now/i })).toBeVisible({ timeout: 20_000 });
}

/**
 * Create a group through the form the way a host does, and return the row the server minted.
 *
 * The id is taken from the create response rather than from the card, because the card is what
 * two of the tests below are trying to prove something about — reading the id off it would make
 * the fixture depend on the thing under test. The matcher carries `/api/` so it cannot settle on
 * a client-side route of the same shape.
 */
async function createGroupViaForm(page, token, title) {
  const posted = page.waitForResponse(
    (r) => /\/api\/flatmates\/groups(\?|$)/.test(r.url()) && r.request().method() === 'POST',
  );

  await page.getByRole('button', { name: /^Post$/ }).first().click();
  await page.locator('.sf-modal').getByRole('button', { name: /I'm still looking for a place/i }).click();
  await page.locator('.sf-modal').getByRole('button', { name: /We're already a group/i }).click();

  await page.getByPlaceholder(/2 girls/i).fill(title);
  await page.getByPlaceholder(/e\.g\. 34000/i).fill('40000');
  await page.getByPlaceholder(/Your name/i).fill('Group Owner');
  await page.getByRole('button', { name: /Create group/i }).click();

  const res = await posted;
  expect(res.status(), 'the form should have created a group').toBe(201);
  const group = await res.json();
  track('groups', group.id, token);

  await approve(group.id);
  return group;
}

/** A group somebody else hosts, already public — the fixture the non-owner test needs. */
async function otherHostsGroup(title) {
  const { accessToken } = await apiLogin(uniqueMobile());
  const res = await fetch(`${API}/flatmates/groups`, {
    method: 'POST',
    headers: auth(accessToken),
    body: JSON.stringify({
      title, name: 'Somebody Else', locality: 'Baner', rent: 40000,
      seats: 3, seatsOpen: 1, policy: 'any', role: 'tenant',
    }),
  });
  expect(res.status).toBe(201);
  const group = await res.json();
  track('groups', group.id, accessToken);
  await approve(group.id);
  return group;
}

/* A group has no address, so it sorts into Team up — but creation returns the host to the default
   Move in now tab, where the card genuinely is not. */
async function switchToTeamUp(page) {
  await page.getByRole('button', { name: /Team up/ }).first().click();
}

/**
 * Reload onto the Team up tab, so what the card shows came from the server and nothing else.
 *
 * Not just tidiness — without it these tests do not pass at all. `submitGroup` refreshes the feed
 * the moment the create resolves, which is *before* {@link approve} runs, and the board reads the
 * public feed, which cannot see a `pending` group. So a host who has just posted does not find
 * their own group on the board until moderation clears it. That is live behaviour worth knowing,
 * and it is `live-groups.spec.js` that owns the claim (a new group is `pending`, therefore
 * invisible); repeating it here would be two specs pinning one rule. This file is about what the
 * card offers once the group is public, so it gets past the gate and then looks.
 */
async function reopenOnTeamUp(page) {
  await page.reload();
  await expect(page.getByRole('button', { name: /Move in now/i })).toBeVisible({ timeout: 20_000 });
  await switchToTeamUp(page);
}

/** Titles are unique per test: the board is one shared list and the DB is reset per run, not per file. */
const uniqueTitle = (tag) => `Live group ${tag} ${Date.now().toString(36)} in Baner`;

/** The ids on the host's own list — the read the public feed is not allowed to answer. */
async function myGroupIds(token) {
  const res = await fetch(`${API}/me/flatmate-groups?size=100`, { headers: auth(token) });
  expect(res.status).toBe(200);
  const body = await res.json();
  return (body.items ?? body.content ?? body).map((g) => g.id);
}

/**
 * Sign a brand-new host into the browser and hold their token too.
 *
 * `signedInAsNew` answers the mobile, not the token; `apiLogin` is memoised per mobile, so asking
 * for it again is the cached session rather than a second login.
 */
async function newHost(page) {
  const mobile = await signedInAsNew(page);
  const { accessToken } = await apiLogin(mobile);
  return { mobile, accessToken };
}

test.describe('Flatmate group lifecycle (live)', () => {
  test('a group created through the form is still there after a reload', async ({ page }) => {
    const { accessToken } = await newHost(page);
    await openBoard(page);
    const title = uniqueTitle('reload');
    await createGroupViaForm(page, accessToken, title);

    await reopenOnTeamUp(page);

    // The reload dropped every byte of client state, so the card can only come from the server.
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 15_000 });
  });

  test('the host is offered Your group and Delete, never a join action', async ({ page }) => {
    const { accessToken } = await newHost(page);
    await openBoard(page);
    const title = uniqueTitle('own');
    await createGroupViaForm(page, accessToken, title);
    await reopenOnTeamUp(page);

    const card = page.locator('.sf-card', { hasText: title }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText(/Your group/i)).toBeVisible();
    await expect(card.locator('.delete-group-btn')).toBeVisible();
    // The absence is the point of the test, and it is anchored: the card above is visible, so an
    // empty board cannot make this pass.
    await expect(card.locator('.join-btn, .request-btn')).toHaveCount(0);
  });

  test('deleting from the card takes the group off the server, not just off the screen', async ({ page }) => {
    const { accessToken } = await newHost(page);
    await openBoard(page);
    const title = uniqueTitle('delete');
    const group = await createGroupViaForm(page, accessToken, title);
    await reopenOnTeamUp(page);

    const card = page.locator('.sf-card', { hasText: title }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });

    /* Anchor the absence check below before spending it. On its own, "the id is not in this list"
       also passes when the list is empty for reasons that have nothing to do with deleting —
       a renamed envelope key, a 200 carrying nothing, a token that reads as somebody else. Asking
       the same question either side of the click is what makes the second answer mean something. */
    expect(await myGroupIds(accessToken), 'the group should be on the host\'s own list to begin with').toContain(group.id);

    await card.locator('.delete-group-btn').click();
    await expect(page.getByText(title)).toHaveCount(0, { timeout: 10_000 });

    // The half the mock could not reach. A delete that only removed the card would satisfy every
    // assertion above and still leave the group live for every seeker on the board.
    expect(await myGroupIds(accessToken)).not.toContain(group.id);
  });

  test("somebody else's group still offers a way in", async ({ page }) => {
    const title = uniqueTitle('other');
    await otherHostsGroup(title);

    await signedInAsNew(page);
    await openBoard(page);
    await switchToTeamUp(page);

    const card = page.locator('.sf-card', { hasText: title }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    // Same two controls as the test above, opposite session, opposite outcome — which is what
    // makes either assertion evidence about ownership rather than about the markup.
    await expect(card.locator('.join-btn, .request-btn')).toHaveCount(1);
    await expect(card.locator('.delete-group-btn')).toHaveCount(0);
  });
});
