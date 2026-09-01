/**
 * What a flatmate host's own card says about their verification — the **consumer** half.
 *
 * This file used to drive the ops desk to produce those three states: seed a `pending` review into
 * `localStorage`, click Approve or Reject on the desk, then walk to `/flatmates` and read the card.
 * That worked only while the desk was a `localStorage` screen. It is now backed by
 * `flatmateService`, which in mock mode refuses the ops queues outright — there is no mock behind
 * them, and a mock that answered would be modelling a third of the desk while claiming to model all
 * of it.
 *
 * So the tests were cut at the seam rather than deleted. The cue on the card is a consumer
 * behaviour and belongs in a consumer test; it is asserted here against a review row seeded in the
 * state under test, without pretending a desk did it. The desk's own behaviour — that approving
 * moves the badge and not the post, that a rejection must carry a reason — is proved against the
 * real server in `live-flatmate-moderation.spec.js`, which is the only place it can be proved.
 *
 * The fourth test is the load-bearing one: it asserts the desk says so, rather than rendering an
 * empty queue. A queue that always looked empty would be indistinguishable from a cleared backlog.
 */
import { expect, test } from '../../fixtures/base.js';

const STAFF = '9900000009';

function group(id, title) {
  return { id, title, locality: 'Baner', policy: 'any', rent: 45000, seatsTotal: 3, seatsOpen: 1, members: [{ name: 'Queue Host', initials: 'QH', verified: true }], tags: [], note: '', time: 'Just now', createdAt: Date.now(), ownerMobile: '9811111111', ownerName: 'Queue Host', hostRole: 'tenant', verificationTier: 'tenant', agreementDeclared: true };
}

function review(id, groupId, title, extra = {}) {
  return { id, groupId, kind: 'group', host: 'Queue Host', hostMobile: '9811111111', address: `${title} · Baner`, tier: 'tenant', flagForReview: false, ownerConsent: false, status: 'pending', reason: '', createdAt: Date.now(), updatedAt: Date.now(), ...extra };
}

/** Seed one group and its review in a given verification state, as a signed-out visitor. */
async function seedCard(page, groups, reviews) {
  await page.addInitScript((args) => {
    const [g, r] = args;
    localStorage.setItem('puneNestFlatmateGroups', JSON.stringify(g));
    localStorage.setItem('puneNestFlatmateReviews', JSON.stringify(r));
  }, [groups, reviews]);
}

/** The card for one group on the Team up board. */
async function cardFor(page, title) {
  await page.goto('/flatmates?view=groups');
  const card = page.locator('.sf-card', { hasText: title }).first();
  await card.waitFor({ timeout: 10000 });
  return card;
}

test('an approved review shows Ops-verified on the group card', async ({ page }) => {
  const title = 'Queue approve in Baner';
  await seedCard(page, [group('mgQ1', title)], [review('revQ1', 'mgQ1', title, { status: 'approved' })]);
  await expect((await cardFor(page, title)).getByText(/Ops-verified/i)).toBeVisible();
});

test('a rejected review shows Review failed on the group card', async ({ page }) => {
  const title = 'Queue reject in Baner';
  await seedCard(page, [group('mgQ2', title)], [review('revQ2', 'mgQ2', title, { status: 'rejected', reason: 'Agreement not registered' })]);
  await expect((await cardFor(page, title)).getByText(/Review failed/i)).toBeVisible();
});

test('a pending tenant post shows Pending Ops review on the consumer card', async ({ page }) => {
  const title = 'Queue pending in Baner';
  await seedCard(page, [group('mgQ3', title)], [review('revQ3', 'mgQ3', title)]);
  await expect((await cardFor(page, title)).getByText(/Pending Ops review/i)).toBeVisible();
});

test('the ops desk says it needs the live API rather than showing an empty queue', async ({ page }) => {
  await page.addInitScript((m) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Ops Staff', mobile: m, role: 'staff', loginAt: Date.now() }));
  }, STAFF);
  await page.goto('/ops/flatmate-review');

  await expect(page.getByRole('heading', { name: 'Flatmate Moderation' })).toBeVisible();
  await expect(page.getByText(/needs the live API/i)).toBeVisible();
  await expect(page.getByText(/could only model a third of the desk/i)).toBeVisible();

  // No queue, and nothing to press. Both matter: a disabled desk that still rendered a table would
  // invite a moderator to believe the backlog was clear.
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(page.getByRole('table')).toHaveCount(0);
});
