/**
 * Referral programme constants — domain configuration shared between the
 * consumer UI and the mock store's derived computations.
 *
 * Both are pure numbers; neither depends on localStorage or the server. They
 * live here so components (Refer.jsx, ContactsExhaustedModal.jsx) can import
 * them without pulling in the mock-store barrel (lib/store.js), which makes
 * the remaining mock-import count meaningful.
 */

/** Referred owners who post a listing: one per how many unlocks an extra slot. */
export const referralListingsTarget = 3;

/** Referred seekers who join: each qualifying join earns this many owner contacts. */
export const referralContactsPerReward = 15;
