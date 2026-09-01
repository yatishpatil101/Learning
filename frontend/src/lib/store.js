/* store.js — BARREL. This module used to hold the entire localStorage-backed
   data-store; it is now split into cohesive domain slices under ./store/*.
   store.js re-exports the EXACT same public API so every existing
   `import { ... } from '../lib/store.js'` keeps working unchanged. */

export { digits, myMobile } from './contact.js';
export { getOwnerPrefs, setOwnerPrefs, getOwnerPrefsFor, ownerHidesNumber } from './contact.js';
export { parseAmount, setLastSearch, getLastSearch, clearLastSearch } from './store/internals.js';

export * from './store/listings.js';
export * from './store/deals.js';
export {
  getEntityReviews,
  addEntityReview,
} from './store/reviews.js';
export {
  getFollowedSocieties,
  isSocietyFollowed,
  toggleFollowSociety,
  getSocietyQA,
  addSocietyQuestion,
  addSocietyAnswer,
  getSocietyContributions,
  getSocietyContributionCounts,
  addSocietyContribution,
  toggleContributionHelpful,
  removeSocietyContribution,
  addContributionReply,
  removeContributionReply,
  getSocietyBoard,
  addBoardItem,
  removeBoardItem,
} from './store/society.js';
export * from './store/societyMod.js';
export * from './store/referrals.js';
export * from './store/notifications.js';
export * from './store/account.js';
export * from './store/search.js';
export * from './store/billing.js';
/* `./store/contactQuota.js` used to be re-exported here. It is now
   `services/providers/mock/contactQuota.js` — the mock server's state, not the app's. The owner
   contact quota is read through `services/entitlementService.js` and enforced by
   `POST /contacts/request` on both builds (D31b). Nothing in `src/pages` or `src/components` may
   import it: a component that can consult the quota synchronously is a component that can decide
   the answer without asking. */
export * from './store/rent.js';
export * from './store/visits.js';
/* `searchSocieties` used to be re-exported here too. It is now reachable only through
   `services/societyService.js` (whose mock provider calls the `store/community.js` original), and
   that is the point: a screen that can search societies synchronously is a screen that searches
   *this browser's* copy, so a society somebody else added a minute ago is invisible to it however
   long it waits. The three pickers — SocietySelect, SocietyFinder, AdminSocieties' merge dialog —
   now go through `lib/useSocietySearch.js`. `store/societyAdmin.js` still calls the original
   directly; that is below the seam and stays. */
export {
  getSocietyLeads,
  addSocietyLead,
  getCommunitySocieties,
  addCommunitySociety,
} from './store/community.js';
export * from './store/societyAdmin.js';
