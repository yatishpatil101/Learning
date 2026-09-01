import { readUser } from '../auth.js';
import { get, set } from './internals.js';

/* =========================================================================
   Entity reviews (society / locality / owner)
   ========================================================================= */
export const ENTITY_KEY = 'pnEntityReviews';
export const allEntityReviews = () => get(ENTITY_KEY, {});
export const getEntityReviews = (type, id) => allEntityReviews()[type + ':' + id] || [];
export const addEntityReview = (type, id, o) => {
  const u = readUser();
  if (!u) return 'login';
  const all = allEntityReviews();
  const key = type + ':' + id;
  all[key] = all[key] || [];
  all[key].unshift(Object.assign({ id: 'er' + Date.now(), user: u.name || 'User', rating: 5, at: Date.now() }, o || {}));
  set(ENTITY_KEY, all);
  return all[key][0];
};
/* D196 removed `entityRating(type, id)` here on 2026-08-11. It averaged this bucket for a card
   badge, and its last caller (the home page's society strip) only used it as a sort tie-break that
   nothing rendered. Against the real API the bucket is never written, so the average was a constant
   zero and the ordering it promised never happened. The live aggregate now comes from the server
   (`avgRating`/`reviewCount` on `GET /societies`, and `getEntityReviewSummary` for the property
   page's society block, D195) — so a local reduce over unsent drafts had no remaining honest use.
   `addEntityReview` and `getEntityReviews` stay: they are how a draft is written and read back. */

/* =========================================================================
   Property verification & two-way review thread — RETIRED (D218)
   =========================================================================
   Everything that used to live below this line is now a real server resource:
   `GET/POST /properties/{id}/verification`, reached through
   `services/propertyReviewService.js`. It was never a store so much as a rehearsal
   of one — the owner's copy of a case file was keyed by their own mobile number and
   the admin's by theirs, so the two halves of one conversation were held in different
   browsers and neither party could read what the other had written. The notes the
   platform "sent" were composed by the recipient's own machine.

   Removed here: getPropReviews, savePropReviews, getPropReview, propReviewStatus,
   ensureOwnerReview, addPropReviewReply, addPropReviewAdminNote, markPropReviewRead,
   propReviewUnread, propReviewUnreadTotal.

   Entity reviews above stay: those are drafts for a different resource, still local. */

