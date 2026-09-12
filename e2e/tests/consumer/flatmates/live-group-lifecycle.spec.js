import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';
import { postAsGroup } from '../../../helpers/app.js';

/** Live UI coverage verifies group persistence, owner controls, and deletion. */

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
 * Create a group through the form the way a host does, and return the row the server minted. The id
 * comes from the create response, not the card, which is what the tests below are proving.
 */
async function createGroupViaForm(page, token, title) {
  const posted = page.waitForResponse(
    (r) => /\/api\/flatmates\/groups(\?|$)/.test(r.url()) && r.request().method() === 'POST',
  );

  await postAsGroup(page);

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
 * Reload onto Team up so the card can only have come from the server. Required, not tidiness: the
 * feed refreshes before `approve` runs, and the public feed cannot see a `pending` group.
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

/** `signedInAsNew` answers the mobile, not the token; `apiLogin` is memoised, so this is not a second login. */
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

    /* Anchor the absence check below: on its own, "the id is not in this list" also passes for an
       empty list — a renamed envelope key, a 200 carrying nothing, the wrong token. */
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
