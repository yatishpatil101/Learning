/** Locality copy stays client-owned; pointing it at server data would be a content decision. */
import { createProvider } from './config.js';

const provider = createProvider('locality');

/* Locality pages are public landing pages: no token and no session short-circuit. */
export const listLocalities = async () => (await provider()).listLocalities();

/** The back office's locality table: slim rows (pin, retired flag, live count). Staff with `localities:read`. */
export const listAdminLocalities = async () => (await provider()).listAdminLocalities();

/** Closes an area to new listings; its live listings and page stay. Staff with `localities:write`. */
export const retireLocality = async (slug) => (await provider()).retireLocality(slug);

export const restoreLocality = async (slug) => (await provider()).restoreLocality(slug);

/** One locality (`GET /localities/{slug}`); throws on 404. */
export const getLocality = async (slug) => (await provider()).getLocality(slug);

/** A Google place becomes a locality row (found, adopted or minted server-side); 422 for a non-locality place. */
export const resolveLocality = async (place) => (await provider()).resolveLocality(place);

/** Active localities matching `q`; the picker's fallback when Google has nothing. */
export const searchLocalities = async (q) => (await provider()).searchLocalities(q);
