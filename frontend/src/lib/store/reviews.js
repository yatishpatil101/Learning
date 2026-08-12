import { readUser } from '../auth.js';
import { myMobile } from '../contact.js';
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
   Property verification & two-way review thread (shared with admin)
   ========================================================================= */
const propReviewKey = () => 'puneNestPropReview:' + (myMobile() || 'anon');
export const getPropReviews = () => get(propReviewKey(), {});
export const savePropReviews = (obj) => set(propReviewKey(), obj);
export const getPropReview = (propId) => getPropReviews()[propId] || null;
export const propReviewStatus = (propId) => {
  const t = getPropReview(propId);
  return t ? t.status : null;
};
const defaultReviewDocs = (listing) => {
  const rent = !!(listing && (listing.deal === 'rent' || /\/mo|month|rent/i.test(((listing && listing.price) || '') + ' ' + ((listing && listing.tag) || ''))));
  const defs = rent
    ? [['d_index2', 'Index II'], ['d_bill', 'Electricity bill'], ['d_aadhaar', 'Aadhaar card']]
    : [
        ['d_own', 'Ownership proof (Sale deed / Index II)'],
        ['d_tax', 'Property tax receipt'],
        ['d_id', 'Owner government ID (Aadhaar / PAN)'],
        ['d_noc', 'Society NOC / Maintenance receipt'],
        ['d_enc', 'Encumbrance certificate'],
        ['d_photo', 'Listing photos match the property'],
      ];
  return defs.map((d) => ({ id: d[0], name: d[1], status: 'pending', note: '' }));
};
export const ensureOwnerReview = (listing) => {
  if (!listing || !listing.id) return null;
  const all = getPropReviews();
  if (!all[listing.id]) {
    all[listing.id] = {
      propId: listing.id,
      title: listing.title || 'Property',
      locality: listing.loc || '',
      price: listing.price || '',
      status: 'in_review',
      docs: defaultReviewDocs(listing),
      messages: [{ id: 'w' + Date.now(), from: 'admin', text: "Hi! Your property is in PuneNest's verification queue. Our team will review your documents and will message you here if we need any clarification.", at: Date.now(), read: false }],
      decision: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    savePropReviews(all);
  }
  return all[listing.id];
};
export const addPropReviewReply = (propId, text) => {
  text = String(text || '').trim();
  if (!text) return null;
  const all = getPropReviews();
  const t = all[propId];
  if (!t) return null;
  t.messages.push({ id: 'm' + Date.now(), from: 'owner', text, at: Date.now(), read: false });
  if (t.status === 'clarification') t.status = 'in_review';
  t.updatedAt = Date.now();
  savePropReviews(all);
  return t;
};
/* System/admin note on the owner's review thread — used when an edit to a live
   listing schedules a re-check, so the owner sees an "Update under review" chip. */
export const addPropReviewAdminNote = (propId, text) => {
  const all = getPropReviews();
  const t = all[propId];
  if (!t) return null;
  t.messages.push({ id: 'a' + Date.now(), from: 'admin', text: String(text || ''), at: Date.now(), read: false });
  t.status = 'in_review';
  t.updatedAt = Date.now();
  savePropReviews(all);
  return t;
};
export const markPropReviewRead = (propId) => {
  const all = getPropReviews();
  const t = all[propId];
  if (!t) return;
  t.messages.forEach((m) => { if (m.from === 'admin') m.read = true; });
  savePropReviews(all);
};
export const propReviewUnread = (propId) => {
  const t = getPropReview(propId);
  if (!t) return 0;
  return t.messages.filter((m) => m.from === 'admin' && !m.read).length;
};
export const propReviewUnreadTotal = () => {
  const all = getPropReviews();
  let n = 0;
  Object.keys(all).forEach((k) => (all[k].messages || []).forEach((m) => { if (m.from === 'admin' && !m.read) n++; }));
  return n;
};

