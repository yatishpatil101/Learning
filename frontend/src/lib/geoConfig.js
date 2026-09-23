/* Single source of truth for the app's Google-Places geo policy. Framework-agnostic and
   synchronous: `loadGeoPolicy()` fetches once at boot and caches here, because turning "is this
   place blacklisted" into a promise would push an await into every keystroke handler. The
   built-in defaults below serve the window before that resolves. Reads its cache lazily inside
   functions to stay init-order safe. */

import { listCities as fetchCities } from '../services/cityService.js';
import { getGeo } from '../services/settingsService.js';

// `live` here is only the fail-soft fallback used when the city catalogue cannot be reached;
// the authoritative launch status is a column on the roster served by `GET /cities`.
export const CITY_GEO = {
  Pune: {
    center: { lat: 18.553, lng: 73.86 },
    bounds: { north: 18.72, south: 18.38, east: 74.02, west: 73.68 },
    live: true,
    // Cities without `hasData` are launched-but-empty: city-aware copy and search, no listings.
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
    return localStorage.getItem('draazyCity') || DEFAULT_CITY;
  } catch {
    return DEFAULT_CITY;
  }
}

// Admin overrides ({ enforceCityLimit, cities, blacklist }) from settings.geo, as last fetched.
// `{}` means the same thing to every consumer below: no overrides, use the built-ins.
let geoPolicy = {};

// The curated city roster and its live bit. Served by `GET /cities`; the built-ins stand in only
// until that first fetch lands, or for as long as it keeps failing.
let cityRoster = defaultCityRoster();

function defaultCityRoster() {
  return Object.keys(CITY_GEO).map((name) => ({ name, live: !!CITY_GEO[name]?.live }));
}

/* An empty array is passed through rather than replaced with the built-ins: substituting a live
   Pune would turn a backend bug into a plausible-looking launch state. */
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

// A plain Set rather than a `window` event: this module is framework-agnostic and imported by
// non-components, and `draazy-settings-change` would also wake AppFlagsContext into a re-fetch.
const listeners = new Set();

// `published` lets a late subscriber catch up; `started` is the sequence number that stops an
// older response from landing on top of a newer one when two saves are in flight at once.
let published = 0;
let started = 0;

/* Fires immediately if a policy has already landed: `loadGeoPolicy()` starts before the first
   render, so a subscriber wiring up in an effect would otherwise miss the notification. */
export function onGeoChange(fn) {
  listeners.add(fn);
  if (published) fn();
  return () => listeners.delete(fn);
}

/* For the one reader that must not answer from the built-ins — the blacklist, whose empty default
   fails *open*. Resolves immediately when nothing has asked, or it hangs outside a booted app. */
export function geoPolicySettled() {
  return started ? readyPromise : Promise.resolve();
}

let settleReady;
const readyPromise = new Promise((resolve) => { settleReady = resolve; });

/* **Never rejects.** A failed read leaves the previous policy in place rather than clearing it: a
   transient 502 must not un-blacklist a society that was blacklisted a second ago. */
export async function loadGeoPolicy() {
  const mine = ++started;
  try {
    // `allSettled`, emphatically not `all`: the blacklist's default fails *open*, so coupling it
    // to a 502 on `/cities` would silently un-hide every place the operator suppressed.
    const [geoResult, citiesResult] = await Promise.allSettled([getGeo(), fetchCities()]);
    // Drop a response from a request that has since been superseded: without this an admin who
    // saves twice quickly can have the first save's policy overwrite the second's.
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

// Built-in default with any admin override merged on top. `enforce` = hard "city limit"
// restriction (default ON).
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

// Whether a city is "live" (launched). Pure so the admin panel and the cached readers below
// share one rule.
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

// Does this city have real inventory + a locality registry? A city can be toggled live but stay
// launched-empty, and must then never show Pune content.
export function cityHasData(name) {
  return !!(CITY_GEO[name] && CITY_GEO[name].hasData);
}

// Copied on the way out so a caller cannot mutate the cache the rest of the module reads.
export function getCities() {
  return cityRoster.map((city) => ({ ...city }));
}

// Reads the listing's own city when present, else the active navbar city — replacing the
// hardcoded ", Pune" on cards and popups.
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

// Google Autocomplete's `locationRestriction` only BIASES predictions — a strong text match (e.g.
// "Shirur") still surfaces from outside the box — so callers re-check coordinates against this.
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

// The operator's free-text reason for each entry is deliberately not served to this client: the
// matcher below has never read it, and the admin console gets the whole entry from settings.
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
