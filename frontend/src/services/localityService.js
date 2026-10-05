/** Locality copy stays client-owned; pointing it at server data would be a content decision. */
import { createProvider } from './config.js';

const provider = createProvider('locality');

/* Locality pages are public landing pages: no token and no session short-circuit. */
export const listLocalities = async () => (await provider()).listLocalities();

/** `total` is separate from `listings.length` because the array is capped at 200 server-side. Render `total`, or a
 * console clearing 200 rows a day out of 900 shows a number that never moves. */
export const getLocalityQueue = async () => (await provider()).getLocalityQueue();

export const assignLocality = async (propertyId, slug) =>
  (await provider()).assignLocality(propertyId, slug);
