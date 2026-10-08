/** Slug-not-id joins, null-vs-zero rating rule and follows: docs/flows/consumer/societies.md */
import { createProvider } from './config.js';
import { isBlacklisted } from '../lib/geoConfig.js';

const provider = createProvider('society');

/** Ranked type-ahead over the catalogue (at most 20 rows): locality match, then alphabetical, so a caller cannot rank differently per mode. */
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

/** `total` counts the whole filtered set, not this page; the console's "Societies" tile reads it. */
export const listSocietyDirectory = async (opts) => (await provider()).listSocietyDirectory(opts);

/** `null` means only "no such society"; other failures throw, since "missing" and "unreachable" differ. */
export const getSociety = async (slug) => (await provider()).getSociety(slug);

/** One page of the directory, filtered and ordered by the server; rows plus a slug-keyed rating index so unrated `null` stays distinct from zero. */
export const listSocietiesPage = async (opts) => (await provider()).listSocietiesPage(opts);

/** Listing-bearing societies for the strongest-first rail; rows carry the server's `listingCount` and omit ratings, which this rail does not render. */
export const listSocietiesWithListings = async () => (await provider()).listSocietiesWithListings();

/** The slugs of the societies the caller follows, newest first. Empty when signed out. */
export const listFollowedSocieties = async () => (await provider()).listFollowedSocieties();

/** A slug this reader cannot resolve is absent rather than a stub, so `length` may differ from the follow list. */
export const listFollowedSocietyRows = async () => (await provider()).listFollowedSocietyRows();

/** Throws 404 for a society minted only in this browser, which is why `FollowContext` keeps those local. */
export const followSociety = async (slug) => (await provider()).followSociety(slug);

/** Unfollow one society. Idempotent: unfollowing one not followed is not an error. */
export const unfollowSociety = async (slug) => (await provider()).unfollowSociety(slug);

/** Looks a Google place up before minting: `society` is the row already bound to that Place ID, else `candidates` are up to three nearby rows. Public. */
export const resolveSociety = async ({ placeId, name, lat, lng }) =>
  (await provider()).resolveSociety({ placeId, name, lat, lng });

/** Adds the society behind a Google Place ID (auth required); `created` is false when the place already had a row, which is not an error. */
export const mintSociety = async (body) => {
  if (!body?.placeId) throw new Error('mintSociety needs a Google placeId');
  return (await provider()).mintSociety(body);
};

/** Member-added societies, newest first, up to one server page — the counterpart of the mint. */
export const listSocietyCandidates = async (opts) => (await provider()).listSocietyCandidates(opts);

/** Societies a queued candidate may duplicate, strongest first: a hint, never an action, drawn from the catalogue so candidate-on-candidate duplicates are reported. */
export const listSocietyCandidateDuplicates = async (slug, opts) =>
  (await provider()).listSocietyCandidateDuplicates(slug, opts);

/** Pending-work counts for the society desk's tab badges. */
export const getSocietiesSummary = async () => (await provider()).getSocietiesSummary();

/** Society merges currently in force, newest first, as a record of decisions where the latest is the interesting one. */
export const listSocietyMerges = async (opts) => (await provider()).listSocietyMerges(opts);

/** A merge is a pointer, not a move: the duplicate keeps its data and reads union it onto the survivor, so it is undoable. */
export const mergeSocieties = async (from, into) => (await provider()).mergeSocieties(from, into);

/** Undoes a merge, addressed by the society that was merged away, since a survivor can have absorbed several duplicates. */
export const undoSocietyMerge = async (slug) => (await provider()).undoSocietyMerge(slug);

/** `adminNote` is kept off the public payload because it is moderator prose about a named building. */
export const getSocietyAdminView = async (slug) => (await provider()).getSocietyAdminView(slug);

/** Partial edit of one society; `adminNote` `''` clears while `undefined` leaves it, so do not coalesce. */
export const editSociety = async (slug, patch) => (await provider()).editSociety(slug, patch);
