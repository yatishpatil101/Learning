/* Shared config for the Google Maps display components (PropertyMap, ShareMap).
   The key lives in .env (VITE_GOOGLE_MAPS_API_KEY), never hardcoded here. */

export const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

// Advanced (HTML) markers require a Map ID. DEMO_MAP_ID is Google's public test
// id; set VITE_GOOGLE_MAPS_MAP_ID to a cloud-styled id in production.
export const GOOGLE_MAPS_MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID';

// Data-driven styling for boundaries (the admin's real-area outline) needs a proper
// vector Map ID with those feature layers enabled in Cloud Console — the public
// DEMO_MAP_ID doesn't carry them. Callers use this to decide whether to attempt the
// boundary highlight (fail-soft when false).
export const GOOGLE_MAPS_HAS_DDS = !!GOOGLE_MAPS_MAP_ID && GOOGLE_MAPS_MAP_ID !== 'DEMO_MAP_ID';

// Pune fallback center, matching the old Leaflet BASE.
export const PUNE_CENTER = { lat: 18.553, lng: 73.86 };
