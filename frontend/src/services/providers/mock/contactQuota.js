import { myMobile } from '../../../lib/contact.js';
import { get, set } from '../../../lib/store/internals.js';
import { getPlan, listingLimit } from '../../../lib/store/billing.js';
import { referralBonusContacts, referralBonusListings, referralFreeAgreements } from '../../../lib/store/referrals.js';

/* =========================================================================
   The mock server's owner-contact quota.

   ── Why this file moved (D31b) ─────────────────────────────────────────────
   This was `lib/store/contactQuota.js`, re-exported from `lib/store.js`, and
   any component could import `canRevealContact()` and decide there and then
   whether the user was allowed to ask for an owner's number. That is what made
   the quota a fiction: the browser held the counter, the browser added the
   referral bonus, and the browser enforced the limit. Clearing site data
   restored it in full.

   Nothing about the arithmetic below was wrong — it is the same 15 free
   contacts plus 15 per referral the product has always advertised. What was
   wrong was *where it lived*. So it lives here now, inside the mock provider
   directory, where it is understood to be the mock build's server-side state
   rather than the application's. The application asks for these numbers
   through `services/entitlementService.js` and is refused through
   `POST /contacts/request`, exactly as it is against the real backend.

   It is deliberately NOT exported from `lib/store.js` any more. If a component
   can import it, the seam is not a seam. The only legitimate importers are the
   two mock providers that need it: `entitlementProvider` (to report) and
   `contactProvider` (to enforce and to spend).

   Still localStorage, still not real security — but now it is the mock
   server's localStorage, and the difference is the whole point.
   ========================================================================= */

/** Mirrors `PlatformSettings.DEFAULT_FREE_CONTACT_LIMIT` / `settings.fees.freeContactLimit`. */
export const FREE_CONTACT_LIMIT = 15;

/* Plans that lift the contact ceiling entirely. The server's equivalent is the
   `plans.unlimited_contacts` column (V91), which is true for the three priced
   plans and false for Owner Free — the same set, expressed as data rather than
   as a list the client keeps. */
export const UNLIMITED_CONTACT_PLANS = ['seeker-plus', 'owner2', 'owner5'];
export const hasUnlimitedContacts = () => UNLIMITED_CONTACT_PLANS.includes(getPlan().id);

const usedKey = () => 'pnContactsUsed:' + (myMobile() || 'anon');
export const contactsUsed = () => Number(get(usedKey(), 0)) || 0;

/* Free base quota + whatever referrals have unlocked. */
export const contactAllowance = () => FREE_CONTACT_LIMIT + referralBonusContacts();
export const contactsRemaining = () => (hasUnlimitedContacts() ? null : Math.max(0, contactAllowance() - contactsUsed()));
export const canRevealContact = () => hasUnlimitedContacts() || contactsRemaining() > 0;

/* Spend one contact. Called ONLY by the mock contact provider, and only once a
   request row has genuinely been created — a duplicate request or a failed gate
   must never burn quota, which is the same rule the backend enforces by
   counting rows rather than presses. */
export const consumeContact = () => {
  if (hasUnlimitedContacts()) return contactsUsed();
  const n = contactsUsed() + 1;
  set(usedKey(), n);
  return n;
};

/** The whole entitlement picture, in the shape `GET /me/entitlements` returns. */
export const entitlements = () => {
  const unlimited = hasUnlimitedContacts();
  return {
    contacts: {
      unlimited,
      used: contactsUsed(),
      allowance: unlimited ? null : contactAllowance(),
      remaining: unlimited ? null : contactsRemaining(),
      referralBonus: referralBonusContacts(),
    },
    listings: {
      allowance: listingLimit(),
      referralBonus: referralBonusListings(),
    },
    /* Free rent agreements earned by referring. Deliberately outside
       `referralRewardsEnabled()`, unlike the two bonuses above: the
       rent-agreement track is part of the base referral program rather than the
       monetization flag's subject, and the server does not gate it either. */
    agreements: {
      free: referralFreeAgreements(),
    },
  };
};
