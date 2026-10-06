/** Reviews of a property, society, locality or owner, split into two routes because only property reviews carry `context` and an eligibility gate.
 * `context` is server-derived and never sent; key entity reviews by `soc.slug`, the locality slug or the `/owner/:id` param. */
import { createProvider } from './config.js';

const provider = createProvider('review');

/** Reviews of one property, newest first. */
export const listPropertyReviews = async (propertyId, opts) =>
  (await provider()).listPropertyReviews(propertyId, opts);

/** Rating aggregate for one listing by UUID, a separate read so callers never page the review list; `avg` is null when unreviewed. */
export const getPropertyReviewSummary = async (propertyId) =>
  (await provider()).getPropertyReviewSummary(propertyId);

/** Eligibility is enforced server-side; the page's check only lets the button explain itself. */
export const createPropertyReview = async (propertyId, review) =>
  (await provider()).createPropertyReview(propertyId, review);

export const listEntityReviews = async (entityType, entityId, opts) =>
  (await provider()).listEntityReviews(entityType, entityId, opts);

/** The list is paged at 20, so averaging it would print page one as the rating. A rejection means
 * "rating unknown", not "no reviews": render it as unavailable. */
export const getEntityReviewSummary = async (entityType, entityId) =>
  (await provider()).getEntityReviewSummary(entityType, entityId);

/** Rate a society, locality or owner. Resolves to the created review. */
export const createEntityReview = async (entityType, entityId, review) =>
  (await provider()).createEntityReview(entityType, entityId, review);

/** A separate route: a public one that could return rejected rows is one missed auth check from leaking them. */
export const listReviewsForModeration = async (opts) =>
  (await provider()).listReviewsForModeration(opts);

/** No `archived` verdict: it would hide the review while the aggregate still counts it; rejecting does both.
 * `reason` is never shown to the author, only audited. */
export const setReviewStatus = async (id, status, reason) =>
  (await provider()).setReviewStatus(id, status, reason);
