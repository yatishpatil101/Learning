/* Single source of truth for the app's Google-Places geo policy.
   Framework-agnostic (no React) — like places.js — so the core autocomplete, the
   List-Property geocoder and the map display components all read ONE policy:

     • which city is active (the navbar dropdown, persisted as `puneNestCity`),
     • that city's map centre + bounding box,
     • whether Places is HARD-restricted to those bounds (city limit) or merely biased,
     • a blacklist of localities / societies / places to hide from suggestions,
     • which cities are live, from the curated roster.

   Two sources, one cache. Map coverage and the blacklist are admin edits under `settings.geo`
   (Settings ▸ Maps), merged over the built-in defaults below. City **launch state** is not: it is a
   column on the city roster, served by `GET /cities` and written by `PATCH /admin/cities/{slug}`,
   because a value that decides what a logged-out visitor sees cannot have an admin-only reader.
   Every reader here is synchronous and reads at call-time, so a city switch applies to the very
   next keystroke with no React wiring.

   FETCHED ONCE, CACHED HERE. The overrides used to be read out of the local mock DB on
   every call, which meant the admin console's write reached the server and every reader
   went on consulting its own browser. `loadGeoPolicy()` is fired once at boot (see
   main.jsx) and again when the console saves; the twenty call sites below stayed
   synchronous, because turning "is this place blacklisted" into a promise would have
   pushed an await into every keystroke handler in the product.

   The window between boot and that fetch resolving is served by the built-in defaults —
   Pune live, city limit on, nothing blacklisted — which is also what an unreachable
   server gets. That is deliberate for nineteen of the twenty readers: the defaults are a
   working policy, not a blank one. The exception is the blacklist, whose default is empty
   and therefore fails *open* — so the one caller that filters on it awaits
   `geoPolicySettled()` first. See its doc comment below.

   IMPORTANT: this module must never be imported by mockApi.js. It reads its cache lazily
   inside functions to stay init-order safe. */

import { listCities as fetchCities } from '../services/cityService.js';
import { getGeo } from '../services/settingsService.js';

// Built-in per-city geo. Pune matches the old hardcoded constants; the others carry
// rough metro boxes so the feature is ready the moment a city goes live.
// `live` = the built-in default launch status used only as a fail-soft fallback when the
// city catalogue cannot be reached. Only Pune ships live; the rest are "coming soon".
export const CITY_GEO = {
  Pune: {
    center: { lat: 18.553, lng: 73.86 },
    bounds: { north: 18.72, south: 18.38, east: 74.02, west: 73.68 },
    live: true,
    // We have real inventory + a locality registry for Pune. Cities without `hasData`
    // are launched-but-empty: the app shows city-aware copy/search but no Pune content.
    hasData: true,
  },
  Mumbai: {
    center: { lat: 19.076, lng: 72.877 },
    bounds: { north: 19.30, south: 18.89, east: 73.03, west: 72.77 },
    live: false,
  },
  Bengaluru: {
    center: { lat: 12.9716, lng: 77.5946 },
    bounds: { north: 13.14, south: 12.83, east: 77.74, west: 77.46 },
    live: false,
  },
  'Delhi NCR': {
    center: { lat: 28.6139, lng: 77.209 },
    bounds: { north: 28.88, south: 28.40, east: 77.35, west: 76.84 },
    live: false,
  },
  Hyderabad: {
    center: { lat: 17.385, lng: 78.4867 },
    bounds: { north: 17.56, south: 17.29, east: 78.60, west: 78.32 },
    live: false,
  },
};

export const DEFAULT_CITY = 'Pune';

// Back-compat exports so existing importers keep one source of truth.
export const PUNE_CENTER = CITY_GEO.Pune.center;
export const PUNE_BOUNDS = CITY_GEO.Pune.bounds;

// Active city from the navbar dropdown (CityContext persists it here). Never throws.
export function getActiveCity() {
  try {
    return localStorage.getItem('puneNestCity') || DEFAULT_CITY;
  } catch {
    return DEFAULT_CITY;
  }
}

// Admin overrides ({ enforceCityLimit, cities, blacklist }) from settings.geo, as last
// fetched. `{}` until `loadGeoPolicy()` resolves — and after it, if the read failed or
// nobody has ever opened the Maps panel. All three readings mean the same thing to every
// consumer below: no overrides, use the built-ins.
let geoPolicy = {};

// The curated city roster and its live bit. Served by `GET /cities`; the built-ins stand in only
// until that first fetch lands, or for as long as it keeps failing.
let cityRoster = defaultCityRoster();

function defaultCityRoster() {
  return Object.keys(CITY_GEO).map((name) => ({ name, live: !!CITY_GEO[name]?.live }));
}

/**
 * Shape a `GET /cities` payload into the roster the readers below expect.
 *
 * An empty array is passed through rather than replaced with the built-ins. "The server says there
 * are no cities" and "the server is unreachable" are different facts, and only the second one is a
 * reason to invent a roster — `loadGeoPolicy` now keeps them apart, so this no longer has to guess.
 * Substituting a live Pune for an empty answer would turn a backend bug into a plausible-looking
 * launch state, which is the harder failure to notice of the two.
 */
function normaliseCityRoster(rows) {
  if (!Array.isArray(rows)) return defaultCityRoster();
  return rows
    .filter((row) => row && typeof row.name === 'string')
    .map((row) => ({
      slug: typeof row.slug === 'string' ? row.slug : undefined,
      name: row.name,
      live: row.live === true,
      listingCount: Number.isFinite(row.listingCount) ? row.listingCount : undefined,
    }));
}

// Called when the cache changes, so a view that already rendered from the built-ins can
// re-read. A plain Set rather than an event on `window`: the one thing that needs to know
// is the city roster, and `punenest-settings-change` would also wake AppFlagsContext into
// re-fetching a route that has nothing to do with this. Framework-agnostic on purpose —
// this module has no React in it and is imported by things that are not components.
const listeners = new Set();

// How many fetches have published, and how many have started. `published` lets a late
// subscriber catch up (below); `started` is the sequence number that stops an older
// response from landing on top of a newer one — the admin console fires
// `punenest-settings-change` on every save, so two saves in quick succession put two
// requests in flight and the network decides which returns first.
let published = 0;
let started = 0;

/**
 * Subscribe to cache updates. Returns an unsubscribe function, so a React effect can
 * return it directly.
 *
 * Fires immediately if a policy has already landed. Without that, a subscriber is in a
 * race it cannot see: `loadGeoPolicy()` starts before the first render, and a component
 * that seeds its state from `getCities()` and then subscribes in an effect will miss the
 * notification entirely if the fetch resolves in between — leaving it on the built-in
 * roster until some unrelated event happens to wake it.
 */
export function onGeoChange(fn) {
  listeners.add(fn);
  if (published) fn();
  return () => listeners.delete(fn);
}

/**
 * Resolves once the first `loadGeoPolicy()` has settled, successfully or not.
 *
 * For the one reader that must not answer from the built-ins: the blacklist. Every other
 * default here is a real policy — Pune is live, its bounds are its bounds — so answering
 * early is answering correctly. An empty blacklist is not: it means "suppress nothing",
 * and a suggestion box that renders during the boot window would offer the visitor
 * exactly the places the operator went out of their way to hide. Failing open on a
 * moderation control is worse than waiting a few hundred milliseconds for it.
 *
 * Resolves rather than rejects on failure, because a failed fetch still settles the
 * question — the policy is whatever we have — and a rejection here would take down the
 * suggestion box with it.
 *
 * Resolves immediately when nothing has ever asked for the policy. The alternative — a
 * promise that only settles once `loadGeoPolicy` runs — hangs forever in any context that
 * imports this module without booting the app, and "the suggestion box never returns" is
 * a far worse failure than the one being prevented.
 */
export function geoPolicySettled() {
  return started ? readyPromise : Promise.resolve();
}

let settleReady;
const readyPromise = new Promise((resolve) => { settleReady = resolve; });

/**
 * Fetch the operator's geo overrides and publish them to every reader below.
 *
 * Called once at boot and again whenever the admin console saves, so the operator who
 * changed a setting sees it in the tab they changed it in. Other tabs pick it up on their
 * next load; a live push for a config document that changes a few times a year is not
 * worth a socket.
 *
 * **Never rejects.** A failed read leaves the previous policy in place rather than
 * clearing it — a transient 502 on a refresh must not un-blacklist a society that was
 * blacklisted a second ago. Silent for the same reason `AppFlagsContext` is: there is
 * nothing a visitor could do about it, and the fallback is a working policy.
 */
export async function loadGeoPolicy() {
  const mine = ++started;
  try {
    // `allSettled`, emphatically not `all`. These are two independent routes, and a rejection from
    // one must not discard a healthy answer from the other. The blacklist is the reason: its default
    // is empty and therefore fails *open* (see `geoPolicySettled` above), so coupling it to a 502 on
    // `/cities` would mean an unrelated endpoint going down silently un-hides every place the
    // operator went out of their way to suppress.
    const [geoResult, citiesResult] = await Promise.allSettled([getGeo(), fetchCities()]);
    // A response from a request that has since been superseded is stale by definition,
    // however healthy it looked. Dropping it is the whole guard: without this an admin
    // who saves twice quickly can have the first save's policy overwrite the second's,
    // and the console then disagrees with the site it just configured.
    if (mine === started) {
      const geo = geoResult.status === 'fulfilled' ? geoResult.value : null;
      if (geo && typeof geo === 'object') geoPolicy = geo;
      if (citiesResult.status === 'fulfilled') {
        cityRoster = normaliseCityRoster(citiesResult.value);
      }
      published += 1;
      listeners.forEach((fn) => fn());
    }
  } catch {
    /* keep whatever we had; the built-ins are a working policy */
  } finally {
    settleReady();
  }
}

/** The cached overrides. Synchronous, never throws, never null. */
function readGeoSettings() {
  return geoPolicy;
}

// Resolve the active city's effective geo: built-in default with any admin override
// merged on top. `enforce` = hard "city limit" restriction (default ON).
export function getActiveCityGeo() {
  const name = getActiveCity();
  const geo = readGeoSettings();
  const base = CITY_GEO[name] || CITY_GEO[DEFAULT_CITY];
  const override = (geo.cities && geo.cities[name]) || {};
  return {
    name,
    center: override.center || base.center,
    bounds: override.bounds || base.bounds,
    enforce: geo.enforceCityLimit !== false,
  };
}

// Whether a city is "live" (launched) given a roster row collection. Pure so the admin panel and
// the cached-reader helpers below share one rule.
export function cityLiveFrom(cities, name) {
  const city = (Array.isArray(cities) ? cities : []).find(
    (row) => String(row?.name || '').toLowerCase() === String(name || '').toLowerCase(),
  );
  if (city && typeof city.live === 'boolean') return city.live;
  return !!(CITY_GEO[name] && CITY_GEO[name].live);
}

// Is the named city live right now? Reads the cached server roster; never throws.
export function getCityLive(name) {
  return cityLiveFrom(cityRoster, name);
}

// Does this city have real inventory + a locality registry? Today only Pune does; other
// cities can be toggled live but are launched-empty until we seed data for them. Drives
// the honest city-aware presentation (popular localities, listings, marketing sections)
// so a data-less city never shows Pune content. Reads the static CITY_GEO fact.
export function cityHasData(name) {
  return !!(CITY_GEO[name] && CITY_GEO[name].hasData);
}

// The full city roster with current live status — used by the navbar dropdown and the
// consumer waitlist chrome so an admin live toggle flows through with no code change.
// Copied on the way out so a caller cannot mutate the cache the rest of the module reads.
export function getCities() {
  return cityRoster.map((city) => ({ ...city }));
}

// Display label for a listing's city — reads the listing's own city when present, else
// falls back to the active navbar city. Replaces the hardcoded ", Pune" scattered across
// cards/popups so a second live city renders correctly. Today all inventory is Pune, so
// this returns "Pune" unchanged; it only diverges once multi-city data lands.
export function cityLabelFor(listing) {
  const c = listing && (listing.city || listing.cityName);
  return c ? String(c) : getActiveCity();
}

// The Places (New) location constraint for the active city: a HARD `locationRestriction`
// when the city limit is enforced, else a soft `locationBias`. Spread into a request.
export function activeLocationConstraint() {
  const { bounds, enforce } = getActiveCityGeo();
  if (!bounds) return {};
  return enforce ? { locationRestriction: bounds } : { locationBias: bounds };
}

// Google Autocomplete's `locationRestriction` only BIASES predictions — a strong text
// match (e.g. "Shirur") still surfaces even when its location sits outside the box. So we
// additionally verify each suggestion's real coordinates against this hard fence. Returns
// the active city's bounds when the city limit is enforced, else null (no fence).
export function enforcedCityBounds() {
  const { bounds, enforce } = getActiveCityGeo();
  return enforce && bounds ? bounds : null;
}

// Is a point inside a bounds box? Missing inputs return true (fail-open) so a failed
// coordinate lookup never wrongly hides an otherwise valid suggestion.
export function withinBounds(lat, lng, b) {
  if (!b || lat == null || lng == null) return true;
  return lat <= b.north && lat >= b.south && lng <= b.east && lng >= b.west;
}

// The current blacklist entries ([{ id, placeId, term }]). The operator's free-text reason
// for each entry is deliberately not served to this client — it is moderator prose about a
// named building, the matcher below has never read it, and the admin console gets the whole
// entry from the settings document instead.
export function getBlacklist() {
  const list = readGeoSettings().blacklist;
  return Array.isArray(list) ? list : [];
}

// Is a place blocked? Matches by placeId (exact) or a case-insensitive term contained
// in the suggestion's main/secondary text (so "Camp" hides "Camp, Pune", etc.).
export function isBlacklisted(place) {
  if (!place) return false;
  const list = getBlacklist();
  if (!list.length) return false;
  const hay = `${place.mainText || place.name || ''} ${place.secondaryText || ''}`.toLowerCase();
  const id = place.placeId || place.id || '';
  return list.some((b) => {
    if (b.placeId && id && b.placeId === id) return true;
    const term = String(b.term || '').trim().toLowerCase();
    return term.length >= 2 && hay.includes(term);
  });
}

// Drop blacklisted suggestions from a predictions list.
export function filterSuggestions(list) {
  if (!Array.isArray(list) || !list.length) return list || [];
  const blk = getBlacklist();
  return blk.length ? list.filter((s) => !isBlacklisted(s)) : list;
}
