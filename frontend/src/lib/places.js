/* Fail-soft: if the SDK isn't ready or a request is denied,
   helpers return []/null and callers use their static list. */

import { activeLocationConstraint, enforcedCityBounds, withinBounds, filterSuggestions, geoPolicySettled, PUNE_BOUNDS as GEO_PUNE_BOUNDS, PUNE_REGION_BOUNDS } from './geoConfig.js';

// Back-compat re-export (geocode.js imports PUNE_BOUNDS from here); the box itself
// now lives in geoConfig so the whole app shares one definition.
export const PUNE_BOUNDS = GEO_PUNE_BOUNDS;

// Locality-ish place types for the "pick an area" use case (New Autocomplete).
export const LOCALITY_TYPES = ['locality', 'sublocality', 'neighborhood'];

// Only real building/society/project names are pre-filled;
// areas, roads and regions name a locality, not a society.
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

// Predictions carry no coordinates; cache each resolve (oldest
// evicted) so repeat keystrokes are free and memory bounded.
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

// Fail-open per item: an unresolvable location is kept so a transient lookup error never empties the dropdown.
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

// `_p` is the raw prediction, passed to fetchPlaceDetails to reuse
// its session token; a rejected type filter retries without it.
export async function fetchSuggestions(input, sessionToken, opts = {}) {
  const q = String(input || '').trim();
  if (q.length < 2) return [];
  const places = await getPlacesLib();
  if (!places || !places.AutocompleteSuggestion) return [];

  const base = {
    input: q,
    sessionToken: sessionToken || undefined,
    includedRegionCodes: ['in'],
    // A bias only RANKS results, so the city hard-fence below still applies even with an explicit locationBias.
    ...(opts.ignoreCityLimit || opts.crossCity
      ? {}
      : opts.servedArea ? { locationRestriction: PUNE_REGION_BOUNDS }
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
    // Admin coverage search spans all India (no blacklist or
    // fence); `crossCity` keeps the blacklist but skips the fence.
    if (opts.ignoreCityLimit) return mapped;
    // Wait for the policy: an unloaded blacklist reads as
    // 'suppress nothing' and would offer places the operator hid.
    await geoPolicySettled();
    const filtered = filterSuggestions(mapped);
    return opts.crossCity || opts.servedArea ? filtered : fenceToActiveCity(filtered);
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

// `crossCity` keeps the blacklist but drops the city hard-fence for legitimately intercity fields.
export function fetchLocalitySuggestions(input, sessionToken, opts = {}) {
  return fetchSuggestions(input, sessionToken, { includedPrimaryTypes: LOCALITY_TYPES, crossCity: !!opts.crossCity, servedArea: !opts.crossCity });
}

// The `geocode` collection keeps results address/area-shaped (no
// businesses); fetchSuggestions retries unrestricted if rejected.
export function fetchAreaSuggestions(input, sessionToken) {
  return fetchSuggestions(input, sessionToken, { includedPrimaryTypes: ['geocode'] });
}

// Admin coverage-editor search: any place across India (no active-city restriction,
// no blacklist filter) so an operator can find a city/locality to draw its boundary.
export function fetchAdminSuggestions(input, sessionToken) {
  return fetchSuggestions(input, sessionToken, { ignoreCityLimit: true });
}

// Lets the admin coverage editor fill a region's rectangle from the place's viewport.
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
// { placeId, lat, lng, pincode, street, localityRaw, formatted, name, isNamedPlace } — or null.
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
      placeId: place.id || suggestion.placeId || '',
      lat: place.location ? place.location.lat() : null,
      lng: place.location ? place.location.lng() : null,
      pincode: a.pincode,
      street: a.street,
      localityRaw: a.localityRaw,
      formatted: place.formattedAddress ? String(place.formattedAddress) : '',
      name: place.displayName ? String(place.displayName) : '',
      isNamedPlace: isNamedSocietyPlace(place.types),
      types: Array.isArray(place.types) ? place.types : [],
    };
  } catch {
    return null;
  }
}
