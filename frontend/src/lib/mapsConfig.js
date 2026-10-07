/* Shared config for the Google Maps display components (PropertyMap, FlatmateMap).
   The key lives in .env (VITE_GOOGLE_MAPS_API_KEY), never hardcoded here. */

export const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

// Advanced (HTML) markers require a Map ID. DEMO_MAP_ID is Google's public test
// id; set VITE_GOOGLE_MAPS_MAP_ID to a cloud-styled id in production.
export const GOOGLE_MAPS_MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID';

// The public DEMO_MAP_ID lacks boundary feature layers, so callers check this before attempting the highlight.
export const GOOGLE_MAPS_HAS_DDS = !!GOOGLE_MAPS_MAP_ID && GOOGLE_MAPS_MAP_ID !== 'DEMO_MAP_ID';

// Pune fallback center, matching the old Leaflet BASE.
export const PUNE_CENTER = { lat: 18.553, lng: 73.86 };

// A map takes its scheme when constructed; the switch lives in Settings, which renders no map.
export const mapColorScheme = () => (document.documentElement.classList.contains('light') ? 'LIGHT' : 'DARK');
