/** Slug-not-id joins, null-vs-zero rating rule and follows: docs/flows/consumer/societies.md */
import { createProvider } from './config.js';
import { isBlacklisted } from '../lib/geoConfig.js';

const provider = createProvider('society');

/** Ranked type-ahead (max 20 rows): locality match, then alphabetical, so callers cannot rank per mode. */
export const searchSocieties = async (query, localityLabel = '') => {
  const rows = await (await provider()).searchSocieties(query, localityLabel);
  const locSlug = localityLabel ? localityLabel.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') : '';
  const locHead = locSlug.split('-')[0];
  const locMatch = (s) =>
    (locHead && s.localitySlug && (s.localitySlug === locSlug || s.localitySlug.startsWith(locHead))) ? 1 : 0;
  return (Array.isArray(rows) ? rows : [])
    .filter((s) => !isBlacklisted({ name: s.name }))
    .sort((a, b) => (locMatch(b) - locMatch(a)) || a.name.localeCompare(b.name))
    .slice(0, 20);
};

export const listSocietyDirectory = async (opts) => (await provider()).listSocietyDirectory(opts);

/** `null` means only "no such society"; other failures throw, since "missing" and "unreachable" differ. */
export const getSociety = async (slug) => (await provider()).getSociety(slug);

/** Name, specs and `rating` for a listing page or a search chip; `null` when no such society. */
export const getSocietyBrief = async (slug) => (await provider()).getSocietyBrief(slug);

/** Rows plus a slug-keyed rating index, so an unrated `null` stays distinct from a zero rating. */
export const listSocietiesPage = async (opts) => (await provider()).listSocietiesPage(opts);

/** The home rail's eight society cards, ranked by the server. */
export const topSocieties = async () => (await provider()).topSocieties();

/** The caller's follows, newest first, as `{slug, name, localitySlug, listingCount}`. */
export const listFollowedSocieties = async () => (await provider()).listFollowedSocieties();

/** Throws 404 for a society minted only in this browser, which is why `FollowContext` keeps those local. */
export const followSociety = async (slug) => (await provider()).followSociety(slug);

/** Unfollow one society. Idempotent: unfollowing one not followed is not an error. */
export const unfollowSociety = async (slug) => (await provider()).unfollowSociety(slug);

/** Public; `society` is the row already bound to the Place ID, else `candidates` are up to three nearby rows. */
export const resolveSociety = async ({ placeId, name, lat, lng }) =>
  (await provider()).resolveSociety({ placeId, name, lat, lng });

/** Auth required; `created` is false when the place already had a row, which is not an error. */
export const mintSociety = async (body) => {
  if (!body?.placeId) throw new Error('mintSociety needs a Google placeId');
  return (await provider()).mintSociety(body);
};

export const listSocietyCandidates = async (opts) => (await provider()).listSocietyCandidates(opts);

/** A hint, never an action; drawn from the catalogue so candidate-on-candidate duplicates are reported. */
export const listSocietyCandidateDuplicates = async (slug, opts) =>
  (await provider()).listSocietyCandidateDuplicates(slug, opts);

/** Pending-work counts for the society desk's tab badges. */
export const getSocietiesSummary = async () => (await provider()).getSocietiesSummary();

export const listSocietyMerges = async (opts) => (await provider()).listSocietyMerges(opts);

/** A merge is a pointer, not a move: reads union the duplicate onto the survivor, so it is undoable. */
export const mergeSocieties = async (from, into) => (await provider()).mergeSocieties(from, into);

/** Addressed by the merged-away society, since one survivor can have absorbed several duplicates. */
export const undoSocietyMerge = async (slug) => (await provider()).undoSocietyMerge(slug);

/** `adminNote` is kept off the public payload because it is moderator prose about a named building. */
export const getSocietyAdminView = async (slug) => (await provider()).getSocietyAdminView(slug);

/** Partial edit of one society; `adminNote` `''` clears while `undefined` leaves it, so do not coalesce. */
export const editSociety = async (slug, patch) => (await provider()).editSociety(slug, patch);
