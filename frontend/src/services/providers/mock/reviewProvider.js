/**
 * Mock review provider — the localStorage counterpart to `providers/http/reviewProvider.js`.
 *
 * Two stores, because the app grew two and the seam's job is to hide that, not to migrate it:
 *
 *   - property reviews → `puneNestPropReviews`, keyed by property id (`pages/consumer/property/reviews.js`)
 *   - entity reviews   → `pnEntityReviews`, keyed `"<type>:<id>"` (`lib/store/reviews.js`)
 *
 * Both are read through here so the pages see one vocabulary. The http provider sees one server
 * table behind two routes, which is the mirror image — and the reason the service exposes four
 * operations rather than a single `listReviews(type, id)`.
 *
 * ## The mock is the permissive one, deliberately
 *
 * It has no eligibility gate (anyone may rate anything), no moderation status (everything written
 * is immediately visible) and it will store a `context` badge the caller supplies. All three are
 * asymmetries in the safe direction: a flow that works against the API also works here. The
 * opposite would be a demo that passes and a production that 403s.
 *
 * The one thing this deliberately does *not* copy is the old write path's `context: 'visit'`
 * literal. See `createPropertyReview`.
 */
import { readUser } from '../../../lib/auth.js';
import {
  getEntityReviews as _getEntity,
  addEntityReview as _addEntity,
} from '../../../lib/store/reviews.js';
import { loadReviews as _loadProp, saveReview as _saveProp } from '../../../pages/consumer/property/reviews.js';

/** `YYYY-MM-DD`, which is what the card renders raw and what the old write path stored. */
const today = () => new Date().toISOString().slice(0, 10);

/** Unpaged stores answer the paged contract by reporting the whole list as one page. */
const page = (items) => ({ items, total: items.length, page: 0, size: items.length });

export async function listPropertyReviews(propertyId) {
  return page(_loadProp(propertyId));
}

export async function createPropertyReview(propertyId, review) {
  const u = readUser();
  if (!u) return 'login';
  const saved = {
    id: 'RV' + Date.now(),
    user: u.name || 'PuneNest User',
    rating: review?.rating || 0,
    text: review?.text || '',
    categories: review?.categories || {},
    recommend: review?.recommend ?? null,
    /**
     * Left unset on purpose.
     *
     * The modal used to submit `context: 'visit'` as a literal on every review, and the store kept
     * it, so the "Visited" badge was a claim the browser made about itself. The server derives this
     * from visit and tenancy history and refuses the field on write. Fabricating it here would mean
     * the badge is trustworthy live and meaningless on mocks — and mocks are what the screenshots
     * and the demo are taken from.
     */
    at: today(),
  };
  _saveProp(propertyId, saved);
  return saved;
}

export async function listEntityReviews(entityType, entityId) {
  // The stored `at` is an epoch from `addEntityReview`; the card wants the same display date the
  // property store holds, so normalise here rather than teaching two pages two formats.
  const items = _getEntity(entityType, entityId).map((r) => ({
    id: r.id,
    user: r.user || 'User',
    rating: +r.rating || 0,
    text: r.text || '',
    categories: r.categories || {},
    recommend: r.recommend ?? null,
    context: r.context ?? null,
    at: typeof r.at === 'number' ? new Date(r.at).toISOString().slice(0, 10) : (r.at || ''),
  }));
  return page(items);
}

export async function createEntityReview(entityType, entityId, review) {
  const saved = _addEntity(entityType, entityId, {
    rating: review?.rating || 0,
    text: review?.text || '',
  });
  // `addEntityReview` returns the string 'login' when nobody is signed in. Passed through rather
  // than thrown so both providers fail the same way and the caller keeps one branch.
  if (saved === 'login') return 'login';
  return {
    id: saved.id,
    user: saved.user,
    rating: +saved.rating || 0,
    text: saved.text || '',
    categories: {},
    recommend: null,
    context: null,
    at: new Date(saved.at).toISOString().slice(0, 10),
  };
}
