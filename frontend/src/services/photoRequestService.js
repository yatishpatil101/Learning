/** Sign-in is the whole gate: no Aadhaar badge, owner approval or quota. */
import { createProvider } from './config.js';

const provider = createProvider('photoRequest');

/* Repeat asks return the existing row, even after owner resolution, instead of stacking. */
export const requestPhotos = async (propertyIdOrSlug) => (await provider()).requestPhotos(propertyIdOrSlug);

/** The owner's inbox — requests against listings *they* own. Paged; read at the UI's bounded maximum by default. */
export const myPhotoRequests = async (opts) => (await provider()).myPhotoRequests(opts);

/** Owner-only, and enforced server-side — a foreign row is a 404 rather than a 403, because a 403 would confirm the
 * row exists. */
export const decidePhotoRequest = async (reqId, decision) =>
  (await provider()).decidePhotoRequest(reqId, decision);
