/* Single source of truth for the app's Google-Places geo policy.
   Framework-agnostic (no React) — like places.js — so the core autocomplete, the
   List-Property geocoder and the map display components all read ONE policy:

     • which city is active (the navbar dropdown, persisted as `puneNestCity`),
     • that city's map centre + bounding box,
     • whether Places is HARD-restricted to those bounds (city limit) or merely biased,
     • a blacklist of localities / societies / places to hide from suggestions.

   Admin edits live under `settings.geo` in the mock DB (Settings ▸ Maps) and are
   merged over the built-in defaults below. Everything is read at call-time, so a
   city switch or an admin change applies to the very next keystroke — no React wiring.

   IMPORTANT: this module must never be imported by mockApi.js (it imports mockApi),
   and it reads settings lazily inside functions to stay init-order safe. */

import { rawDb } from './mockApi.js';

// Built-in per-city geo. Pune matches the old hardcoded constants; the others carry
// rough metro boxes so the feature is ready the moment a city goes live.
// `live` = the built-in default launch status (admin can override per city in
// settings.geo.cities[name].live). Only Pune ships live; the rest are "coming soon".
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

// Admin overrides ({ enforceCityLimit, cities, blacklist }) from settings.geo. Never throws.
function readGeoSettings() {
  try {
    return rawDb()?.settings?.geo || {};
  } catch {
    return {};
  }
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

// Whether a city is "live" (launched) given a geo settings object — admin override
// on settings.geo.cities[name].live wins, else the built-in CITY_GEO default. Pure,
// so both the admin panel (with its in-progress `geo` prop) and the DB reader below
// share one rule.
export function cityLiveFrom(geo, name) {
  const ov = geo && geo.cities && geo.cities[name];
  if (ov && typeof ov.live === 'boolean') return ov.live;
  return !!(CITY_GEO[name] && CITY_GEO[name].live);
}

// Is the named city live right now (reads persisted admin settings)? Never throws.
export function getCityLive(name) {
  return cityLiveFrom(readGeoSettings(), name);
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
export function getCities() {
  const geo = readGeoSettings();
  return Object.keys(CITY_GEO).map((name) => ({ name, live: cityLiveFrom(geo, name) }));
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

// The current blacklist entries ([{ id, term, note, at }]).
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
