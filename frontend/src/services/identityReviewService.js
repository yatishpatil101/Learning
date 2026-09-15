import { createProvider } from './config.js';

const provider = createProvider('identityReview');

export const listIdentityReviews = async (params) => (await provider()).listIdentityReviews(params);
export const getIdentityReview = async (id) => (await provider()).getIdentityReview(id);
export const approveIdentityReview = async (id, payload) => (await provider()).approveIdentityReview(id, payload);
export const rejectIdentityReview = async (id, payload) => (await provider()).rejectIdentityReview(id, payload);