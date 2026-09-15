/**
 * Each test redeems its own referral through the public path with its own referrer and referee, so
 * per-referee uniqueness and the velocity signal cannot make results depend on run order.
 */
import { ACTORS, expect, test } from '../../fixtures/live.js';
import { API, apiLogin } from '../../helpers/liveAuth.js';

/**
 * One referrer and one referee per test. Referees are chosen for their identity badge, because that
 * is what `ReferralService.approve` gates on since wave 2c.
 */
const PAIRS = {
  masked: {
    referrer: { mobile: '9108512606', name: 'Tanvi Mehta' },
    referee: { mobile: '9122040348', name: 'Tanvi Deshpande' },
  },
  approve: {
    referrer: { mobile: '9124855617', name: 'Sneha Shah' },
    referee: { mobile: '9152892152', name: 'Diya Deshpande' },
  },
  // Deliberately an account with no identity badge.
  blocked: {
    referrer: { mobile: '9133973978', name: 'Nikhil Nair' },
    referee: { mobile: '9394055866', name: 'Sneha Jain' },
  },
  clawback: {
    referrer: { mobile: '9470744469', name: 'Meera Deshpande' },
    // Active, identity-verified, no listings - the same shape as every other referee here, and not
    // one of the seeded `suspended` accounts, which login refuses.
    referee: { mobile: '9318202961', name: 'Vikram Rao' },
  },
  risk: {
    referrer: { mobile: '9708919481', name: 'Omkar Kulkarni' },
    referee: { mobile: '9207292146', name: 'Omkar Gupta' },
  },
};

const STAFF = '9733798115';

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

/** Redeem one referral through the consumer path, and hand back the referee's masked row. */
async function seedReferral({ referrer, referee }) {
  const { accessToken: referrerToken } = await apiLogin(referrer.mobile);
  const summary = await fetch(`${API}/me/referrals`, { headers: auth(referrerToken) }).then((r) => r.json());
  if (!summary?.code) throw new Error(`seedReferral: no code for ${referrer.mobile}`);

  const { accessToken: refereeToken } = await apiLogin(referee.mobile);
  const res = await fetch(`${API}/referrals/redeem`, {
    method: 'POST',
    headers: auth(refereeToken),
    body: JSON.stringify({ code: summary.code }),
  });
  if (!res.ok) throw new Error(`seedReferral: redeem ${res.status} ${await res.text()}`);
  return summary.code;
}

/** The desk's own view of a referral, read as staff — the only place its id is on the wire. */
async function readAsStaff(refereeName) {
  const { accessToken } = await apiLogin(STAFF);
  const page = await fetch(`${API}/referrals?size=100`, { headers: auth(accessToken) }).then((r) => r.json());
  const row = (page.content || []).find((r) => r.referred === refereeName);
  if (!row) throw new Error(`readAsStaff: no referral for ${refereeName}`);
  return { row, accessToken };
}

/** A decision posted straight at the API, bypassing the desk's buttons entirely. */
async function decide(id, verb, accessToken) {
  return fetch(`${API}/referrals/${id}/${verb}`, { method: 'POST', headers: auth(accessToken) });
}

const rowFor = (page, name) => page.getByRole('row').filter({ hasText: name }).first();

/**
 * `Badge` is a translation layer, not a passthrough, so the mapping is stated once here and the
 * wire vocabulary is checked against the endpoint in `ReferralEndpointsTest`.
 */
const LABEL = {
  pending: 'Under Review',
  rewarded: 'rewarded',
  rejected: 'rejected',
  'clawed-back': 'clawed back',
};

/** Exact, so a status word cannot collide with a button carrying the same letters. */
const statusOf = (page, name, status) => rowFor(page, name).getByText(LABEL[status], { exact: true });

/**
 * The desk opens on Pending and a decision takes the referral out of that tab, so every assertion
 * about a decision's result has to follow the row to where it went.
 */
const openTab = (page, label) => page.getByRole('button', { name: new RegExp(`^${label}`) }).click();

async function openDesk(page, login) {
  await login.asStaff('rental');
  await page.goto('/ops/referrals');
  await expect(page.getByRole('heading', { name: 'Referral Verification' })).toBeVisible();
  // If this fires, the desk fell back to its offline panel and nothing below means anything.
  await expect(page.getByText(/needs the live API/i)).toHaveCount(0);
}

test.describe('Ops → referral fraud desk (live)', () => {
  test('a redeemed referral reaches the desk with both numbers masked', async ({ page, login }) => {
    const { referrer, referee } = PAIRS.masked;
    await seedReferral(PAIRS.masked);
    await openDesk(page, login);

    const row = rowFor(page, referee.name);
    await expect(row).toContainText(referrer.name);
    await expect(statusOf(page, referee.name, 'pending')).toBeVisible();

    /* The masking is the point, not a detail. A privileged list is masked platform-wide and there
       is no unmasked single-record read for referrals to fall back on, so a checker decides on the
       signals rather than on the parties' phone numbers. The mock handed both over in full. */
    await expect(page.getByText(referee.mobile)).toHaveCount(0);
    await expect(page.getByText(referrer.mobile)).toHaveCount(0);

    // The signals are what the desk gets instead, and they are computed server-side.
    await expect(row).toContainText('Identity verified');
    await expect(row).toContainText('Same IP');
  });

  test('approving grants owner contacts the referrer can actually spend', async ({ page, login }) => {
    const { referrer, referee } = PAIRS.approve;
    await seedReferral(PAIRS.approve);
    await openDesk(page, login);

    await rowFor(page, referee.name).getByRole('button', { name: 'Approve' }).click();

    // The row leaves Pending the moment it is decided, which is the whole point of a queue.
    await expect(rowFor(page, referee.name)).toHaveCount(0);
    await openTab(page, 'Rewarded');
    await expect(statusOf(page, referee.name, 'rewarded')).toBeVisible();

    /* The only assertions proving the approval reached the referrer rather than just recolouring a
       chip — and the second pair proves it reached the entitlement, which is the thing a referrer
       can actually spend, not the summary. */
    const { accessToken } = await apiLogin(referrer.mobile);
    const summary = await fetch(`${API}/me/referrals`, { headers: auth(accessToken) }).then((r) => r.json());
    expect(summary.converted).toBe(1);
    expect(summary.contactsEarned).toBeGreaterThan(0);
    expect(summary.contactsPending).toBe(0);

    const ent = await fetch(`${API}/me/entitlements`, { headers: auth(accessToken) }).then((r) => r.json());
    expect(ent.contacts.referralBonus).toBe(summary.contactsEarned);
    expect(ent.contacts.allowance).toBeGreaterThan(ent.contacts.referralBonus);
  });

  test('the identity rule is the server’s now, and the greyed-out button only mirrors it', async ({ page, login }) => {
    const { referee } = PAIRS.blocked;
    await seedReferral(PAIRS.blocked);
    await openDesk(page, login);

    const row = rowFor(page, referee.name);
    await expect(row).toContainText('Blocked');
    await expect(row.getByRole('button', { name: 'Approve' })).toHaveCount(0);

    /* Until wave 2c this button *was* the rule: the endpoint released the money to anyone who
       called it directly, under a banner calling the check mandatory. Going round the UI is the
       only way to prove that is no longer true. */
    const { row: dto, accessToken } = await readAsStaff(referee.name);
    const refused = await decide(dto.id, 'approve', accessToken);
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain('not identity-verified');

    // Rejecting stays available - a desk must be able to close a referral it will never pay.
    await row.getByRole('button', { name: 'Reject' }).click();
    await openTab(page, 'All');
    await expect(statusOf(page, referee.name, 'rejected')).toBeVisible();
  });

  test('a clawback reads clawed-back, which is not the same as rejected', async ({ page, login }) => {
    const { referee } = PAIRS.clawback;
    await seedReferral(PAIRS.clawback);

    const { row: dto, accessToken } = await readAsStaff(referee.name);
    expect((await decide(dto.id, 'approve', accessToken)).status).toBe(200);

    await openDesk(page, login);
    // Approved above, so it has left Pending - Clawback lives with the paid referrals.
    await openTab(page, 'Rewarded');
    await rowFor(page, referee.name).getByRole('button', { name: 'Clawback' }).click();

    /* The mock wrote `rejected` for both, losing the one distinction a fraud desk needs: a reward
       that was never paid, versus one that was paid and recovered. S52 separated them. */
    await openTab(page, 'All');
    await expect(statusOf(page, referee.name, 'clawed-back')).toBeVisible();
    await expect(statusOf(page, referee.name, 'rejected')).toHaveCount(0);
  });

  test('High risk is a risk filter, not the mock\u2019s missing status', async ({ page, login }) => {
    const { referee } = PAIRS.risk;
    await seedReferral(PAIRS.risk);
    await openDesk(page, login);

    // Medium: referrer and referee correlate on network, which raises the band without refusing.
    await expect(rowFor(page, referee.name)).toContainText('medium');

    await page.getByRole('button', { name: /^High risk/ }).click();
    await expect(rowFor(page, referee.name)).toHaveCount(0);

    await openTab(page, 'Pending');
    await expect(rowFor(page, referee.name)).toBeVisible();

    /* There is no `flagged` status on the server, so a tab filtering on one would have sat
       permanently empty - a fraud desk being told there is nothing suspicious. */
    await expect(page.getByRole('button', { name: /^Flagged/ })).toHaveCount(0);
  });

  /**
   * All three refusals, since a redirect is the weakest: the router turns away no session and a
   * signed-in buyer, and the API refuses that buyer's token, which is what the money rests on.
   */
  test('the desk is staff-only at the router and at the API, and a signed-in buyer is not staff', async ({ page, login }) => {
    await page.goto('/ops/referrals');
    await expect(page).toHaveURL(/\/staff-login/);

    await login.asBuyer();
    await page.goto('/ops/referrals');
    await expect(page).toHaveURL(/\/staff-login/);
    await expect(page.getByRole('heading', { name: 'Referral Verification' })).toHaveCount(0);

    // The refusal the redirect is only a courtesy for. A buyer holds a valid token; what he does
    // not hold is `referrals:read`, and that is the server's business, not the router's.
    const { accessToken: buyerToken } = await apiLogin(ACTORS.buyer);
    const refused = await fetch(`${API}/referrals?size=1`, { headers: auth(buyerToken) });
    expect(refused.status, await refused.text()).toBe(403);

    // The positive anchor: the same request, from the desk's own staffer, is answered.
    const { accessToken: staffToken } = await apiLogin(STAFF);
    const allowed = await fetch(`${API}/referrals?size=1`, { headers: auth(staffToken) });
    expect(allowed.status, await allowed.text()).toBe(200);
  });
});
