/**
 * Recent searches — the "pick up where you left off" rail on Home and the Dashboard.
 *
 * ### Two stores, on purpose
 *
 * A **signed-in** visitor's rail lives on their account, so the search they ran on the bus is there
 * on the laptop that evening. A **signed-out** visitor's rail stays in this browser and never
 * leaves it. That split is enforced here, in one place, rather than at the three call sites — the
 * rule is "who is asking", not "which screen is asking", and a screen that forgot the branch would
 * either 401 for every visitor or quietly start a server-side browsing log for people who never
 * signed in.
 *
 * Anonymous history is not sent anywhere because there is nothing to send it *to*: no account to
 * attach it to, no second device to sync it with, and no screen elsewhere that reads it. The
 * argument that used to keep the signed-in rail local too does not survive contact with the key it
 * was stored under — `dzRecentSearches:<mobile>` already *promises* per-account continuity, and a
 * browser is the one place that cannot deliver it.
 *
 * ### Shape
 *
 * A row is `{ label, url, at }`: the label is what the rail prints, the url is where it goes, and
 * `at` is epoch milliseconds. Six rows, newest first. The server owns the cap, the dedupe key (the
 * normalised URL — never the label, or "3 BHK in Baner" typed twice with different filters would
 * collapse into one) and the timestamp; both providers answer a write with the resulting rail, so
 * nothing above this line models eviction.
 */
import { createProvider } from './config.js';
import { myMobile } from '../lib/contact.js';
import { getRecentSearches, pushRecentSearch } from '../lib/localPrefs.js';

const provider = createProvider('recentSearch');

/** True when this rail belongs to an account rather than to the browser. */
const signedIn = () => !!myMobile();

/*
 * A stale session — a cached user whose token the server no longer honours — takes the signed-in
 * branch, reads a 401 and shows no history at all until `AuthContext` finishes revalidating and
 * clears it. That is deliberate: falling back to the local rail on a failed read would start
 * writing one account's trail into the anonymous bucket, where the next person to use the browser
 * would find it. A rail that is briefly empty is a smaller harm than a rail that leaks, and the
 * window closes on its own within one revalidation.
 */

/**
 * The visitor's recent searches, newest first, at most six.
 *
 * Always a Promise, including on the anonymous path where the answer is already in hand — callers
 * render one pending state and one loaded state rather than branching on who is asking.
 *
 * @returns {Promise<{label:string,url:string,at:number|null}[]>}
 */
export const listRecentSearches = async () =>
  (signedIn() ? (await provider()).listRecentSearches() : getRecentSearches());

/**
 * Record a search, and resolve to the resulting rail.
 *
 * **Rejects on a live failure.** Callers record a search on the way to a results page, so they must
 * attach a handler and keep going: a lost history row is not worth blocking navigation over, and an
 * unhandled rejection is not an acceptable way to say so.
 *
 * @param {{label:string, url:string}} rec
 * @returns {Promise<{label:string,url:string,at:number|null}[]>}
 */
export const recordRecentSearch = async (rec) => {
  // Nothing to record and nothing to re-read: no caller uses the return value, so answering with a
  // round trip to the server would be a request issued to describe a write that never happened.
  if (!rec || !rec.label || !rec.url) return [];
  return signedIn() ? (await provider()).recordRecentSearch(rec) : pushRecentSearch(rec);
};
