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
  entityRating,
  getPropReviews,
  savePropReviews,
  getPropReview,
  propReviewStatus,
  ensureOwnerReview,
  addPropReviewReply,
  addPropReviewAdminNote,
  markPropReviewRead,
  propReviewUnread,
  propReviewUnreadTotal,
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
export * from './store/contactQuota.js';
export * from './store/rent.js';
export * from './store/visits.js';
export {
  getSocietyLeads,
  addSocietyLead,
  getCommunitySocieties,
  addCommunitySociety,
  getLocalityLeads,
  addLocalityLead,
  getCommunityLocalities,
  addCommunityLocality,
  pendingCommunityLocalities,
  verifyCommunityLocality,
  dismissCommunityLocality,
  searchSocieties,
} from './store/community.js';
export * from './store/societyAdmin.js';
