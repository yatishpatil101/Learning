/* Shared Google Places (New) autocomplete primitives.
   Extracted so both the List-Property map search (AreaSearch) and the app-wide
   Locality pickers (LocalitySelect) use one tested implementation. Everything is
   fail-soft: if the Maps SDK isn't ready, a request is denied, or the key/quota is
   unavailable, helpers return [] / null and callers fall back to their static list.

   The SDK is bootstrapped elsewhere (the map picker loads it via APIProvider with
   VITE_GOOGLE_MAPS_API_KEY); here we just read window.google.maps when present.

   Where suggestions may appear is governed by ONE place — lib/geoConfig.js — which
   resolves the active city (navbar dropdown) to a bounding box and decides whether
   Places is hard-restricted to it (admin "city limit") or merely biased, and hides
   any blacklisted localities/societies. */

import { activeLocationConstraint, enforcedCityBounds, withinBounds, filterSuggestions, geoPolicySettled, PUNE_BOUNDS as GEO_PUNE_BOUNDS } from './geoConfig.js';

// Back-compat re-export (geocode.js imports PUNE_BOUNDS from here); the box itself
// now lives in geoConfig so the whole app shares one definition.
export const PUNE_BOUNDS = GEO_PUNE_BOUNDS;

// Locality-ish place types for the "pick an area" use case (New Autocomplete).
export const LOCALITY_TYPES = ['locality', 'sublocality', 'neighborhood'];

// Place types whose displayName is a real building/society/project worth pre-filling
// into the "Building / Society Name" field (e.g. "Aspiria"). Areas, roads and postal
// regions are NOT named places — their name is a locality/street, not a society.
const NAMED_PLACE_TYPES = [
  'premise', 'subpremise', 'apartment_complex', 'establishment', 'point_of_interest',
];

// Decide whether a resolved place's displayName is a society/building name (true) or
// just an area/road (false) — so we only auto-fill the society field for named places.
export function isNamedSocietyPlace(types) {
  const t = Array.isArray(types) ? types : [];
  if (!t.length) return false;
  if (t.some((x) => NAMED_PLACE_TYPES.includes(x))) return true;
  // A place tagged only as an area/road (or 'geocode') is not a society.
  return false;
}

// Load the Places library off the SDK the map already bootstrapped. Returns the
// library ({ Place, AutocompleteSuggestion, ... }) or null if unavailable.
export async function getPlacesLib() {
  const g = typeof window !== 'undefined' ? window.google : null;
  if (!g || !g.maps || !g.maps.importLibrary) return null;
  try {
    return await g.maps.importLibrary('places');
  } catch {
    return null;
  }
}

// Normalise address components from either source into a common { types, name } shape.
// Places (New) uses { types, longText }; the classic Geocoder uses { types, long_name }.
export function normalizeComponents(comps) {
  return (Array.isArray(comps) ? comps : []).map((c) => ({
    types: Array.isArray(c.types) ? c.types : [],
    name: c.longText != null ? c.longText : (c.long_name != null ? c.long_name : ''),
  }));
}

// Pull our address fields out of one normalised component list.
export function pickAddress(components) {
  const get = (type) => {
    const c = components.find((x) => x.types.includes(type));
    return c ? String(c.name || '') : '';
  };
  const rawPin = get('postal_code');
  const pincode = /^\d{6}$/.test(rawPin) ? rawPin : '';
  const street = get('route');
  // "locality-ish" labels spread across several types depending on the area — try
  // them most-specific first so we pick the tightest label (e.g. "Baner").
  const localityRaw =
    get('sublocality_level_1') || get('sublocality') || get('neighborhood') ||
    get('locality') || '';
  return { pincode, street: String(street).slice(0, 60), localityRaw };
}

// A per-typing-session token groups keystroke suggestions with the details fetch
// for the picked place into a single billable session. Returns null if unsupported.
export function newAutocompleteSession() {
  const g = typeof window !== 'undefined' ? window.google : null;
  try {
    if (g && g.maps && g.maps.places && g.maps.places.AutocompleteSessionToken) {
      return new g.maps.places.AutocompleteSessionToken();
    }
  } catch {
    /* ignore */
  }
  return null;
}

// placeId → { lat, lng } | null. Autocomplete predictions carry no coordinates, so we
// resolve each once (a cheap location-only Place fetch) to hard-fence out-of-city results
// that Google's `locationRestriction` only biases. Cached so repeat keystrokes (which
// re-return the same placeIds as the query grows) are free; capped to bound memory on
// long-lived sessions (oldest entry evicted first).
const _predLocation = new Map();
const _PRED_CACHE_MAX = 500;

function cachePredLocation(id, loc) {
  if (_predLocation.size >= _PRED_CACHE_MAX) {
    const oldest = _predLocation.keys().next().value;
    if (oldest !== undefined) _predLocation.delete(oldest);
  }
  _predLocation.set(id, loc);
}

async function resolvePredictionLocation(pred) {
  const id = pred?.placeId;
  if (!id) return null;
  if (_predLocation.has(id)) return _predLocation.get(id);
  let loc = null;
  try {
    let place = pred._p && typeof pred._p.toPlace === 'function' ? pred._p.toPlace() : null;
    if (!place) {
      const lib = await getPlacesLib();
      if (lib && lib.Place) place = new lib.Place({ id });
    }
    if (place) {
      await place.fetchFields({ fields: ['location'] });
      if (place.location) loc = { lat: place.location.lat(), lng: place.location.lng() };
    }
  } catch {
    loc = null;
  }
  cachePredLocation(id, loc);
  return loc;
}

// Drop suggestions whose real coordinates fall outside the active city's enforced bounds.
// No-op when the city limit is off (returns the list unchanged). Fail-open per item: a
// suggestion whose location can't be resolved is kept so a transient lookup error never
// empties the dropdown.
async function fenceToActiveCity(list) {
  const fence = enforcedCityBounds();
  if (!fence || !list.length) return list;
  const located = await Promise.all(list.map(async (s) => [s, await resolvePredictionLocation(s)]));
  const kept = located.filter(([, loc]) => withinBounds(loc?.lat, loc?.lng, fence)).map(([s]) => s);
  // Dev telemetry: a fence that empties a non-empty list usually means the admin's city
  // bounds are too tight (or wrong city) — surface it early instead of a silently blank box.
  if (import.meta.env?.DEV && list.length && !kept.length) {
    // eslint-disable-next-line no-console
    console.warn('[places] city fence dropped all suggestions — check Admin ▸ Settings ▸ Maps city bounds.');
  }
  return kept;
}

// Fetch predictions for the typed input. Returns [{ placeId, mainText, secondaryText, _p }].
// `_p` is the raw placePrediction — pass the chosen suggestion to `fetchPlaceDetails`
// so the details request reuses the same session token.
// `opts.includedPrimaryTypes` narrows results (e.g. localities); if that specific
// request is rejected we transparently retry once without the type filter so typing
// still yields suggestions.
export async function fetchSuggestions(input, sessionToken, opts = {}) {
  const q = String(input || '').trim();
  if (q.length < 2) return [];
  const places = await getPlacesLib();
  if (!places || !places.AutocompleteSuggestion) return [];

  const base = {
    input: q,
    sessionToken: sessionToken || undefined,
    includedRegionCodes: ['in'],
    // City limit / bias comes from the shared geo policy (active navbar city) — unless
    // the caller opts out (the admin coverage editor searches all of India, or a
    // deliberately cross-city field like a packers-movers destination) or passes an
    // explicit `locationBias` (e.g. the Near-a-Place field biasing toward the selected
    // locality). A bias only RANKS results, so the city hard-fence below still applies.
    ...(opts.ignoreCityLimit || opts.crossCity
      ? {}
      : (opts.locationBias ? { locationBias: opts.locationBias } : activeLocationConstraint())),
  };
  const withTypes = opts.includedPrimaryTypes?.length ? { ...base, includedPrimaryTypes: opts.includedPrimaryTypes } : base;

  const run = async (req) => {
    const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions(req);
    const mapped = (suggestions || [])
      .map((s) => {
        const p = s.placePrediction;
        if (!p) return null;
        const main = p.mainText ? p.mainText.toString() : (p.text ? p.text.toString() : '');
        const secondary = p.secondaryText?.toString() || '';
        return { placeId: p.placeId, mainText: main, secondaryText: secondary, _p: p };
      })
      .filter((x) => x?.placeId);
    // The admin coverage editor needs to find any place across India — no blacklist, no
    // city fence. A `crossCity` field (e.g. an intercity destination) keeps the blacklist
    // but skips the fence. Everywhere else: hide blacklisted places, then hard-fence
    // suggestions whose real coordinates fall outside the active city.
    if (opts.ignoreCityLimit) return mapped;
    // Wait for the operator's policy before filtering. The rest of `geoConfig` answers
    // correctly from its built-ins during the boot window — Pune is live, its bounds are
    // its bounds — but an unloaded blacklist reads as "suppress nothing", and a visitor
    // who types before the policy lands would be offered exactly the places the operator
    // hid. This costs nothing in practice: the request below has already been made and
    // the policy is fetched at boot, so by the time a keystroke reaches here it has long
    // since settled. Resolves immediately if nothing ever loaded a policy.
    await geoPolicySettled();
    const filtered = filterSuggestions(mapped);
    return opts.crossCity ? filtered : fenceToActiveCity(filtered);
  };

  try {
    return await run(withTypes);
  } catch {
    if (withTypes !== base) {
      // The type filter may be unsupported for this input — retry unrestricted.
      try {
        return await run(base);
      } catch {
        return [];
      }
    }
    return [];
  }
}

// Locality-focused suggestions (areas/neighbourhoods), for "pick any Pune locality".
// `opts.crossCity` keeps the blacklist but drops the active-city hard-fence, for fields
// that are legitimately cross-city (e.g. an intercity move's origin/destination).
export function fetchLocalitySuggestions(input, sessionToken, opts = {}) {
  return fetchSuggestions(input, sessionToken, { includedPrimaryTypes: LOCALITY_TYPES, crossCity: !!opts.crossCity });
}

// Broader "any place in the area" suggestions — surfaces streets and sub-areas as
// well as localities, for pickers that snap the pick UP to a parent locality. The
// `geocode` type collection keeps results address/area-shaped (no businesses); if
// that collection is rejected, fetchSuggestions retries unrestricted.
export function fetchAreaSuggestions(input, sessionToken) {
  return fetchSuggestions(input, sessionToken, { includedPrimaryTypes: ['geocode'] });
}

// Admin coverage-editor search: any place across India (no active-city restriction,
// no blacklist filter) so an operator can find a city/locality to draw its boundary.
export function fetchAdminSuggestions(input, sessionToken) {
  return fetchSuggestions(input, sessionToken, { ignoreCityLimit: true });
}

// Resolve a chosen suggestion to a map centre + bounding box (its Places viewport):
// { center: {lat,lng}|null, bounds: {north,south,east,west}|null } — or null. Used by
// the admin coverage editor so searching a place fills the rectangle for that region.
export async function fetchPlaceViewport(suggestion) {
  if (!suggestion) return null;
  const places = await getPlacesLib();
  try {
    let place = null;
    if (suggestion._p && typeof suggestion._p.toPlace === 'function') {
      place = suggestion._p.toPlace();
    } else if (places && places.Place && suggestion.placeId) {
      place = new places.Place({ id: suggestion.placeId });
    }
    if (!place) return null;
    await place.fetchFields({ fields: ['location', 'viewport'] });
    const loc = place.location;
    const center = loc ? { lat: loc.lat(), lng: loc.lng() } : null;
    let bounds = null;
    const vp = place.viewport;
    if (vp?.getNorthEast) {
      const ne = vp.getNorthEast();
      const sw = vp.getSouthWest();
      bounds = { north: ne.lat(), south: sw.lat(), east: ne.lng(), west: sw.lng() };
    }
    return { center, bounds };
  } catch {
    return null;
  }
}

// Resolve a chosen suggestion to full details:
// { lat, lng, pincode, street, localityRaw, formatted, name, isNamedPlace } — or null.
export async function fetchPlaceDetails(suggestion) {
  if (!suggestion) return null;
  const places = await getPlacesLib();
  try {
    let place = null;
    if (suggestion._p && typeof suggestion._p.toPlace === 'function') {
      place = suggestion._p.toPlace();
    } else if (places && places.Place && suggestion.placeId) {
      place = new places.Place({ id: suggestion.placeId });
    }
    if (!place) return null;
    await place.fetchFields({ fields: ['location', 'addressComponents', 'formattedAddress', 'displayName', 'types'] });
    const a = pickAddress(normalizeComponents(place.addressComponents));
    return {
      lat: place.location ? place.location.lat() : null,
      lng: place.location ? place.location.lng() : null,
      pincode: a.pincode,
      street: a.street,
      localityRaw: a.localityRaw,
      formatted: place.formattedAddress ? String(place.formattedAddress) : '',
      name: place.displayName ? String(place.displayName) : '',
      isNamedPlace: isNamedSocietyPlace(place.types),
    };
  } catch {
    return null;
  }
}
