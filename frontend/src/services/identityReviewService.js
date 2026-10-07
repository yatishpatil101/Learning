import { createProvider } from './config.js';

const provider = createProvider('identityReview');

export const listIdentityReviews = async (params) => (await provider()).listIdentityReviews(params);
export const identityReviewSummary = async () => (await provider()).identityReviewSummary();
export const getIdentityReview = async (id) => (await provider()).getIdentityReview(id);
export const claimIdentityReview = async (id) => (await provider()).claimIdentityReview(id);
export const releaseIdentityReview = async (id, options) => (await provider()).releaseIdentityReview(id, options);
export const approveIdentityReview = async (id, payload) => (await provider()).approveIdentityReview(id, payload);
export const rejectIdentityReview = async (id, payload) => (await provider()).rejectIdentityReview(id, payload);
export const revokeIdentityReview = async (id, reason) => (await provider()).revokeIdentityReview(id, reason);
export const qaIdentityReview = async (id, payload) => (await provider()).qaIdentityReview(id, payload);
/** Correct the applicant's account name/email from their case. Blank fields are left unchanged. */
export const updateKycProfile = async (userId, profile) => (await provider()).updateKycProfile(userId, profile);