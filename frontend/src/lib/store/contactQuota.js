import { myMobile } from '../contact.js';
import { get, set } from './internals.js';
import { getPlan } from './billing.js';
import { referralBonusContacts } from './referrals.js';

/* =========================================================================
   Free owner-contact quota (seeker side)

   Every signed-in seeker gets FREE_CONTACT_LIMIT owner contacts. Once those
   are spent they have two honest ways forward:
     1. Refer a friend — each friend who joins credits +15 more, free.
     2. Buy Seeker Plus — unlimited contacts.
   Only the QUOTA is referral-unlockable. Priority visit slots, boosts and the
   rest of the Seeker Plus perks stay behind the paid plan.

   Prototype only — the counter lives in localStorage and is NOT real security.
   ========================================================================= */
export const FREE_CONTACT_LIMIT = 15;

/* Plans that lift the contact ceiling entirely. */
export const UNLIMITED_CONTACT_PLANS = ['seeker-plus', 'owner2', 'owner5'];
export const hasUnlimitedContacts = () => UNLIMITED_CONTACT_PLANS.includes(getPlan().id);

const usedKey = () => 'pnContactsUsed:' + (myMobile() || 'anon');
export const contactsUsed = () => Number(get(usedKey(), 0)) || 0;

/* Free base quota + whatever referrals have unlocked. */
export const contactAllowance = () => FREE_CONTACT_LIMIT + referralBonusContacts();
export const contactsRemaining = () => (hasUnlimitedContacts() ? Infinity : Math.max(0, contactAllowance() - contactsUsed()));
export const canRevealContact = () => contactsRemaining() > 0;

/* Spend one contact. Call ONLY after a request was genuinely created, so a
   duplicate request or a failed gate never burns quota. */
export const consumeContact = () => {
  if (hasUnlimitedContacts()) return contactsUsed();
  const n = contactsUsed() + 1;
  set(usedKey(), n);
  return n;
};
