/* Geocoding for the List-Property map picker — powered by the Google Maps JS SDK
   the picker (LocationPicker) already loads via APIProvider, using the same
   VITE_GOOGLE_MAPS_API_KEY. Replaces the old free Nominatim/OpenStreetMap service,
   which was unreliable and couldn't resolve society/building names.

   The project's key currently has the Places API (New) enabled but NOT the classic
   Geocoding API (billing), so we prefer Places for both directions and keep the
   Geocoder only as a fallback for when the Geocoding API is enabled later:
   - `forwardGeocode`  → Places text-search (finds named societies/projects), then Geocoder.
   - `reverseGeocode`  → Places nearby-search on the pin (nearest place's address
                          components), then Geocoder reverse.
   Everything fails soft: if the SDK isn't ready, a lookup fails, or a field is
   missing, we return nothing for it and the owner fills it in by hand. */

import {
  getPlacesLib,
  normalizeComponents,
  pickAddress,
  isNamedSocietyPlace,
  newAutocompleteSession,
  fetchSuggestions,
  fetchLocalitySuggestions,
  fetchPlaceDetails,
} from '../../../lib/places.js';
import { getActiveCityGeo } from '../../../lib/geoConfig.js';

// Re-export the shared autocomplete primitives so existing importers of this module
// (AreaSearch, tests) keep working unchanged.
export { newAutocompleteSession, fetchSuggestions, fetchLocalitySuggestions, fetchPlaceDetails };

// Grab a classic Geocoder (fallback path). Returns null if maps isn't up / not enabled.
async function getGeocoder() {
  const g = typeof window !== 'undefined' ? window.google : null;
  if (!g || !g.maps) return null;
  if (g.maps.Geocoder) return new g.maps.Geocoder();
  if (g.maps.importLibrary) {
    try {
      const lib = await g.maps.importLibrary('geocoding');
      return new lib.Geocoder();
    } catch {
      return null;
    }
  }
  return null;
}

// Promisify the classic geocode via the callback form — works across every SDK version.
function runGeocode(geocoder, request) {
  return new Promise((resolve, reject) => {
    geocoder.geocode(request, (results, status) => {
      if (status === 'OK' && results && results.length) resolve(results);
      else reject(new Error(status || 'GEOCODE_FAILED'));
    });
  });
}

// Normalise address components from either source into a common { types, name } shape.
// Places (New) uses { types, longText }; the classic Geocoder uses { types, long_name }.
// (normalizeComponents + pickAddress live in ../../../lib/places.js and are imported above.)

// Merge several nearby results — take the first non-empty value for each field so a
// nearest place missing a route can still contribute its pincode/locality, etc.
function mergeAddress(componentLists) {
  let pincode = '';
  let street = '';
  let localityRaw = '';
  for (const comps of componentLists) {
    const a = pickAddress(comps);
    if (!pincode && a.pincode) pincode = a.pincode;
    if (!street && a.street) street = a.street;
    if (!localityRaw && a.localityRaw) localityRaw = a.localityRaw;
    if (pincode && street && localityRaw) break;
  }
  return { pincode, street, localityRaw };
}

// Reverse-geocode a pin to { pincode, street, localityRaw }. Any field we can't
// determine comes back as ''. Never throws.
export async function reverseGeocode(lat, lng) {
  const empty = { pincode: '', street: '', localityRaw: '' };
  if (lat == null || lng == null) return empty;
  const center = { lat: Number(lat), lng: Number(lng) };

  // 1) Places nearby-search — works without the classic Geocoding API. The nearest
  //    place(s) carry address_components for the pinned vicinity.
  const places = await getPlacesLib();
  if (places && places.Place && typeof places.Place.searchNearby === 'function') {
    try {
      const rank = (places.SearchNearbyRankPreference && places.SearchNearbyRankPreference.DISTANCE) || 'DISTANCE';
      const { places: found } = await places.Place.searchNearby({
        fields: ['addressComponents'],
        locationRestriction: { center, radius: 200 },
        maxResultCount: 5,
        rankPreference: rank,
      });
      if (found && found.length) {
        const res = mergeAddress(found.map((p) => normalizeComponents(p.addressComponents)));
        if (res.pincode || res.street || res.localityRaw) return res;
      }
    } catch {
      /* fall through to the Geocoder */
    }
  }

  // 2) Classic Geocoder reverse (used when the Geocoding API is enabled).
  const geocoder = await getGeocoder();
  if (geocoder) {
    try {
      const results = await runGeocode(geocoder, { location: center });
      const best = results.find((r) =>
        (r.address_components || []).some((c) => c.types && c.types.includes('postal_code')),
      ) || results[0];
      return pickAddress(normalizeComponents(best.address_components));
    } catch {
      /* fall through to empty */
    }
  }
  return empty;
}

// Forward-geocode a typed area/society to full details, or null. Never throws.
// Returns { lat, lng, pincode, street, localityRaw, name, isNamedPlace } so the
// Search button can pre-fill the address (incl. society name for a named place)
// exactly like picking an autocomplete suggestion does. Legacy callers that only
// read .lat/.lng keep working.
export async function forwardGeocode(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  const { name: cityName, bounds: cityBounds } = getActiveCityGeo();

  // 1) Places text-search — resolves named societies/projects/POIs (e.g. "Aspiria")
  //    and carries the address components + type so we can fill the whole address.
  const places = await getPlacesLib();
  if (places && places.Place && typeof places.Place.searchByText === 'function') {
    try {
      const { places: found } = await places.Place.searchByText({
        textQuery: `${q}, ${cityName}`,
        fields: ['location', 'addressComponents', 'displayName', 'types'],
        maxResultCount: 1,
        locationBias: cityBounds,
      });
      if (found && found.length && found[0].location) {
        const p = found[0];
        const a = pickAddress(normalizeComponents(p.addressComponents));
        return {
          lat: p.location.lat(),
          lng: p.location.lng(),
          pincode: a.pincode,
          street: a.street,
          localityRaw: a.localityRaw,
          name: p.displayName ? String(p.displayName) : '',
          isNamedPlace: isNamedSocietyPlace(p.types),
        };
      }
    } catch {
      /* fall through to the Geocoder */
    }
  }

  // 2) Classic Geocoder forward (used when the Geocoding API is enabled).
  const geocoder = await getGeocoder();
  if (geocoder) {
    try {
      const results = await runGeocode(geocoder, {
        address: `${q}, ${cityName}, India`,
        componentRestrictions: { country: 'IN' },
        bounds: cityBounds,
      });
      const best = results[0];
      const loc = best.geometry && best.geometry.location;
      if (loc) {
        const a = pickAddress(normalizeComponents(best.address_components));
        return {
          lat: loc.lat(),
          lng: loc.lng(),
          pincode: a.pincode,
          street: a.street,
          localityRaw: a.localityRaw,
          name: '',
          isNamedPlace: isNamedSocietyPlace(best.types),
        };
      }
    } catch {
      /* ignore — caller shows "couldn't find that area" */
    }
  }
  return null;
}

/* ---------------- Autocomplete (Places New) ----------------
   Live "as you type" predictions like google.com/maps, plus precise details on
   select, now live in ../../../lib/places.js and are re-exported at the top of this
   module (newAutocompleteSession, fetchSuggestions, fetchLocalitySuggestions,
   fetchPlaceDetails) so existing importers keep working unchanged. */
