import { expect, test } from '../../../fixtures/live.js';
import { API, apiLogin, authHeaders, signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';

/* Replying to a neighbour's tip, and reporting one, in a browser against the live API.
 *
 * Split out of the retired `community-v2.spec.js`, which seeded `pnSocietyContributions` and read
 * its own writes back — a thread of one person talking to themselves.
 *
 * The server rules live where they are decided, over HTTP:
 *   - a reply belongs to its own author and not to the tip it sits under, so owning the tip does
 *     not let you delete somebody's reply to it — `live-society-contributions.spec.js`;
 *   - the reason vocabulary, the per-reporter duplicate guard and what a moderator may do about
 *     any of it — `live-society-reports.spec.js`;
 *   - and that the report dialog names the thing that was clicked rather than "this review", plus
 *     a hub report reaching the ops queue with its reason code — `live-society-hub.spec.js`.
 *
 * What is left here is the two things only a browser can answer: that the inline composer under a
 * card actually files against *that* card and the thread survives a reload, and that a member who
 * has verified nothing reaches both controls without meeting an Aadhaar wall (ADR-019).
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const SOC_REPLY = 'aster-residency-paranjape-hadapsar';
const SOC_GATE = 'aster-residency-paranjape-hinjawadi';

async function shareTip(mobile, slug, body) {
  const res = await fetch(`${API}/societies/${slug}/contributions`, {
    method: 'POST',
    headers: await authHeaders(mobile),
    body: JSON.stringify({ kind: 'tip', body }),
  });
  expect(res.status, `POST ${slug}/contributions: ${await res.clone().text()}`).toBe(201);
  return (await res.json()).id;
}

async function gotoCommunity(page, slug) {
  await page.goto(`${BASE}/society/${slug}?tab=community`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
  return page.locator('section', { has: page.getByRole('heading', { name: 'Community insights' }) });
}

const cardFor = (feed, text) => feed.locator('div.glass.rounded-xl', { hasText: text });

test('a reply filed under a neighbour\'s tip belongs to that tip, and is still there after a reload', async ({ page }) => {
  const neighbour = uniqueMobile();
  await apiLogin(neighbour, { api: API });

  const stamp = Date.now().toString(36);
  const theirs = `Water tanker fills the sump at 6am on Tuesdays ${stamp}`;
  const mine = `Sump valve is behind B-wing if yours is dry ${stamp}`;
  /* A second tip nobody replies to. Without it "the reply is under the right card" is not a claim
     at all — one card on the page makes any hasText filter resolve to it. */
  const decoy = `Society office is open till 7pm on weekdays ${stamp}`;
  await shareTip(neighbour, SOC_REPLY, theirs);
  await shareTip(neighbour, SOC_REPLY, decoy);

  const me = await signedInAsNew(page);
  expect(me).not.toBe(neighbour);

  const feed = await gotoCommunity(page, SOC_REPLY);
  const theirCard = cardFor(feed, theirs);
  await expect(theirCard).toBeVisible({ timeout: 20_000 });

  await theirCard.getByRole('button', { name: /^Reply/ }).click();
  await theirCard.getByPlaceholder(/Write a reply/i).fill(mine);
  await theirCard.getByRole('button', { name: 'Post', exact: true }).click();

  await expect(theirCard.getByText(mine)).toBeVisible({ timeout: 15_000 });

  /* Filed against the tip, not merely appended to a list on the page: a reload re-reads the thread
     from the server, and the decoy proves the reply did not simply land on whatever card the
     locator happened to reach. */
  await page.reload();
  const after = page.locator('section', { has: page.getByRole('heading', { name: 'Community insights' }) });
  await expect(cardFor(after, theirs).getByText(mine)).toBeVisible({ timeout: 20_000 });
  await expect(cardFor(after, decoy).getByText(mine)).toHaveCount(0);

  /* The reply carries no badge, because its author lives somewhere else and that is all the server
     states about them. A reply used to fall through to a teal "Verified" check-mark whenever
     `authorIsResident` was false — a trust mark awarded for the one thing known to be untrue of the
     author — so the absence asserted here is of *both* marks: a resident badge would present a
     stranger as a neighbour, and the old fallback presented them as vouched-for. Nothing named
     `verified` exists in this domain on either side of the seam. */
  await expect(cardFor(after, theirs).getByText('Verified', { exact: true })).toHaveCount(0);
  await expect(cardFor(after, theirs).getByText('Resident', { exact: true })).toHaveCount(0);

  /* And the reply count on the button is the thread's, read back off the server. */
  await expect(cardFor(after, theirs).getByRole('button', { name: 'Reply (1)' })).toBeVisible();
});

test('a member who has verified nothing reaches both the reply box and the report dialog', async ({ page }) => {
  const neighbour = uniqueMobile();
  await apiLogin(neighbour, { api: API });
  const stamp = Date.now().toString(36);
  const theirs = `Visitor parking is behind the clubhouse ${stamp}`;
  await shareTip(neighbour, SOC_GATE, theirs);

  await signedInAsNew(page);
  const feed = await gotoCommunity(page, SOC_GATE);
  const card = cardFor(feed, theirs);
  await expect(card).toBeVisible({ timeout: 20_000 });

  const gate = page.getByRole('dialog', { name: /Verify your identity with Aadhaar/i });

  /* Both halves are absence claims, so both are gated on the control they are about actually
     opening — an Aadhaar wall is trivially absent from a page where nothing happened. */
  await card.getByRole('button', { name: /^Reply/ }).click();
  await expect(card.getByPlaceholder(/Write a reply/i)).toBeVisible({ timeout: 15_000 });
  await expect(gate).toHaveCount(0);

  await card.getByRole('button', { name: 'Report contribution' }).click();
  /* Named for its action rather than the generic "Report content" the shared modal used to carry —
     `live-society-hub` proves the name tracks the *kind* of thing clicked. */
  await expect(page.getByRole('dialog', { name: 'Submit report' })).toBeVisible({ timeout: 15_000 });
  await expect(gate).toHaveCount(0);
});
