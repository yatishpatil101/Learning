// Locality entities — canonical registry, Pune-first. THE system of record for
// locality identity: search, filters, SEO, rate benchmarks and alerts key off
// these rows, never off raw Google Places strings.
//
// Google Places is only an input/discovery aid: every pick is matched back to a
// canonical locality here (matchLocalityToCanonical), or minted as a community
// locality by store.js (Phase B). This mirrors the society graph (societies.js).
//
// Dependency-free (like societies.js): store.js imports THIS, so this file must
// NEVER import store.js — that would create a circular dependency.

// Curated Pune localities. Coordinates are approximate area centres — enough for
// the offline coords-match and instant map centring; a live Google pick refines
// the exact pin. `tier` mirrors societies.js: 'curated' vs (Phase B) 'community'.
export const LOCALITIES = [
  { slug: 'baner', name: 'Baner', lat: 18.559, lng: 73.776, tier: 'curated' },
  { slug: 'wakad', name: 'Wakad', lat: 18.598, lng: 73.762, tier: 'curated' },
  { slug: 'hinjawadi', name: 'Hinjawadi', lat: 18.591, lng: 73.738, tier: 'curated' },
  { slug: 'kharadi', name: 'Kharadi', lat: 18.551, lng: 73.941, tier: 'curated' },
  { slug: 'viman-nagar', name: 'Viman Nagar', lat: 18.567, lng: 73.915, tier: 'curated' },
  { slug: 'koregaon-park', name: 'Koregaon Park', lat: 18.536, lng: 73.893, tier: 'curated' },
  { slug: 'kothrud', name: 'Kothrud', lat: 18.507, lng: 73.807, tier: 'curated' },
  { slug: 'hadapsar', name: 'Hadapsar', lat: 18.500, lng: 73.926, tier: 'curated' },
  { slug: 'aundh', name: 'Aundh', lat: 18.558, lng: 73.807, tier: 'curated' },
  { slug: 'magarpatta', name: 'Magarpatta', lat: 18.516, lng: 73.928, tier: 'curated' },
  { slug: 'pimple-saudagar', name: 'Pimple Saudagar', lat: 18.598, lng: 73.805, tier: 'curated' },
  { slug: 'bavdhan', name: 'Bavdhan', lat: 18.514, lng: 73.772, tier: 'curated' },
  { slug: 'balewadi', name: 'Balewadi', lat: 18.575, lng: 73.772, tier: 'curated' },
  { slug: 'undri', name: 'Undri', lat: 18.464, lng: 73.917, tier: 'curated' },
  { slug: 'nibm-road', name: 'NIBM Road', lat: 18.470, lng: 73.901, tier: 'curated' },
  { slug: 'kalyani-nagar', name: 'Kalyani Nagar', lat: 18.548, lng: 73.902, tier: 'curated' },
  { slug: 'shivaji-nagar', name: 'Shivaji Nagar', lat: 18.530, lng: 73.852, tier: 'curated' },
  { slug: 'deccan', name: 'Deccan', lat: 18.516, lng: 73.841, tier: 'curated' },
  { slug: 'boat-club-road', name: 'Boat Club Road', lat: 18.531, lng: 73.879, tier: 'curated' },
  { slug: 'wagholi', name: 'Wagholi', lat: 18.580, lng: 73.978, tier: 'curated' },
  { slug: 'pashan', name: 'Pashan', lat: 18.538, lng: 73.789, tier: 'curated' },
  { slug: 'sus', name: 'Sus', lat: 18.552, lng: 73.755, tier: 'curated' },
  { slug: 'tathawade', name: 'Tathawade', lat: 18.622, lng: 73.751, tier: 'curated' },
  { slug: 'punawale', name: 'Punawale', lat: 18.636, lng: 73.751, tier: 'curated' },
  { slug: 'marunji', name: 'Marunji', lat: 18.604, lng: 73.712, tier: 'curated' },
  { slug: 'maan', name: 'Maan', lat: 18.594, lng: 73.700, tier: 'curated' },
  { slug: 'pimple-nilakh', name: 'Pimple Nilakh', lat: 18.586, lng: 73.797, tier: 'curated' },
  { slug: 'karve-nagar', name: 'Karve Nagar', lat: 18.492, lng: 73.822, tier: 'curated' },
  { slug: 'erandwane', name: 'Erandwane', lat: 18.505, lng: 73.828, tier: 'curated' },
  { slug: 'warje', name: 'Warje', lat: 18.478, lng: 73.803, tier: 'curated' },
  { slug: 'mundhwa', name: 'Mundhwa', lat: 18.535, lng: 73.925, tier: 'curated' },
  { slug: 'yerawada', name: 'Yerawada', lat: 18.556, lng: 73.884, tier: 'curated' },
  { slug: 'lohegaon', name: 'Lohegaon', lat: 18.596, lng: 73.918, tier: 'curated' },
  { slug: 'amanora', name: 'Amanora', lat: 18.517, lng: 73.933, tier: 'curated' },
  { slug: 'wadgaon-sheri', name: 'Wadgaon Sheri', lat: 18.553, lng: 73.923, tier: 'curated' },
  { slug: 'manjari', name: 'Manjari', lat: 18.514, lng: 73.965, tier: 'curated' },
  { slug: 'chandan-nagar', name: 'Chandan Nagar', lat: 18.560, lng: 73.936, tier: 'curated' },

  // ── PCMC — primary hubs (Pimpri-Chinchwad Municipal Corporation) ────────────
  { slug: 'chinchwad', name: 'Chinchwad', lat: 18.636, lng: 73.795, tier: 'curated' },
  { slug: 'pimpri', name: 'Pimpri', lat: 18.627, lng: 73.805, tier: 'curated' },
  { slug: 'bhosari', name: 'Bhosari', lat: 18.639, lng: 73.848, tier: 'curated' },
  { slug: 'nigdi', name: 'Nigdi', lat: 18.651, lng: 73.768, tier: 'curated' },
  { slug: 'akurdi', name: 'Akurdi', lat: 18.648, lng: 73.766, tier: 'curated' },
  { slug: 'chikhali', name: 'Chikhali', lat: 18.674, lng: 73.827, tier: 'curated' },
  { slug: 'moshi', name: 'Moshi', lat: 18.665, lng: 73.855, tier: 'curated' },
  { slug: 'dighi', name: 'Dighi', lat: 18.615, lng: 73.868, tier: 'curated' },
  { slug: 'sangvi', name: 'Sangvi', lat: 18.574, lng: 73.813, tier: 'curated' },
  { slug: 'kalewadi', name: 'Kalewadi', lat: 18.616, lng: 73.803, tier: 'curated' },
  { slug: 'rahatani', name: 'Rahatani', lat: 18.606, lng: 73.797, tier: 'curated' },
  { slug: 'thergaon', name: 'Thergaon', lat: 18.610, lng: 73.780, tier: 'curated' },
  { slug: 'ravet', name: 'Ravet', lat: 18.650, lng: 73.746, tier: 'curated' },
  { slug: 'dapodi', name: 'Dapodi', lat: 18.585, lng: 73.838, tier: 'curated' },
  { slug: 'kasarwadi', name: 'Kasarwadi', lat: 18.601, lng: 73.828, tier: 'curated' },
  { slug: 'phugewadi', name: 'Phugewadi', lat: 18.594, lng: 73.831, tier: 'curated' },
  { slug: 'khadki', name: 'Khadki', lat: 18.562, lng: 73.848, tier: 'curated' },
  { slug: 'talawade', name: 'Talawade', lat: 18.681, lng: 73.782, tier: 'curated' },
  { slug: 'kudalwadi', name: 'Kudalwadi', lat: 18.671, lng: 73.818, tier: 'curated' },
  { slug: 'charholi-budruk', name: 'Charholi Budruk', lat: 18.640, lng: 73.895, tier: 'curated' },
  { slug: 'dudulgaon', name: 'Dudulgaon', lat: 18.655, lng: 73.882, tier: 'curated' },
  { slug: 'alandi', name: 'Alandi', lat: 18.677, lng: 73.897, tier: 'curated' },
  { slug: 'kiwale', name: 'Kiwale', lat: 18.657, lng: 73.735, tier: 'curated' },
  { slug: 'mamurdi', name: 'Mamurdi', lat: 18.655, lng: 73.728, tier: 'curated' },

  // ── PCMC — Pradhikaran sectors, colonies, nagars & vastis ───────────────────
  { slug: 'nigdi-pradhikaran', name: 'Nigdi Pradhikaran', lat: 18.651, lng: 73.762, tier: 'curated' },
  { slug: 'pimple-gurav', name: 'Pimple Gurav', lat: 18.585, lng: 73.822, tier: 'curated' },
  { slug: 'indrayani-nagar', name: 'Indrayani Nagar', lat: 18.626, lng: 73.845, tier: 'curated' },
  { slug: 'yamuna-nagar', name: 'Yamuna Nagar', lat: 18.645, lng: 73.772, tier: 'curated' },
  { slug: 'sambhaji-nagar', name: 'Sambhaji Nagar', lat: 18.637, lng: 73.799, tier: 'curated' },
  { slug: 'masulkar-colony', name: 'Masulkar Colony', lat: 18.628, lng: 73.803, tier: 'curated' },
  { slug: 'shahunagar', name: 'Shahunagar', lat: 18.632, lng: 73.802, tier: 'curated' },
  { slug: 'morewadi', name: 'Morewadi', lat: 18.622, lng: 73.812, tier: 'curated' },
  { slug: 'sant-tukaram-nagar', name: 'Sant Tukaram Nagar', lat: 18.625, lng: 73.818, tier: 'curated' },
  { slug: 'nevale-vasti', name: 'Nevale Vasti', lat: 18.648, lng: 73.746, tier: 'curated' },
  { slug: 'mohan-nagar', name: 'Mohan Nagar', lat: 18.629, lng: 73.812, tier: 'curated' },
  { slug: 'kalbhor-nagar', name: 'Kalbhor Nagar', lat: 18.640, lng: 73.808, tier: 'curated' },
  { slug: 'ram-nagar', name: 'Ram Nagar', lat: 18.641, lng: 73.796, tier: 'curated' },
  { slug: 'anand-nagar-chinchwad', name: 'Anand Nagar (Chinchwad)', lat: 18.628, lng: 73.797, tier: 'curated' },
  { slug: 'rupee-nagar', name: 'Rupee Nagar', lat: 18.668, lng: 73.790, tier: 'curated' },
  { slug: 'walhekar-wadi', name: 'Walhekar Wadi', lat: 18.642, lng: 73.755, tier: 'curated' },
  { slug: 'shinde-vasti-ravet', name: 'Shinde Vasti (Ravet)', lat: 18.653, lng: 73.748, tier: 'curated' },
  { slug: 'borhadewadi-moshi', name: 'Borhadewadi (Moshi)', lat: 18.668, lng: 73.845, tier: 'curated' },
  { slug: 'jadhavwadi', name: 'Jadhavwadi', lat: 18.678, lng: 73.822, tier: 'curated' },
  { slug: 'bankar-vasti-moshi', name: 'Bankar Vasti (Moshi)', lat: 18.672, lng: 73.850, tier: 'curated' },
  { slug: 'dhavde-vasti-bhosari', name: 'Dhavde Vasti (Bhosari)', lat: 18.643, lng: 73.852, tier: 'curated' },
  { slug: 'landewadi-bhosari', name: 'Landewadi (Bhosari)', lat: 18.638, lng: 73.842, tier: 'curated' },
  { slug: 'bhagat-vasti', name: 'Bhagat Vasti', lat: 18.660, lng: 73.840, tier: 'curated' },
  { slug: 'gulve-vasti', name: 'Gulve Vasti', lat: 18.635, lng: 73.865, tier: 'curated' },
  { slug: 'khande-vasti', name: 'Khande Vasti', lat: 18.630, lng: 73.858, tier: 'curated' },
  { slug: 'gavali-matha', name: 'Gavali Matha', lat: 18.632, lng: 73.852, tier: 'curated' },
  { slug: 'tuljai-vasti', name: 'Tuljai Vasti', lat: 18.670, lng: 73.830, tier: 'curated' },
  { slug: 'gavhanevasti', name: 'Gavhanevasti', lat: 18.660, lng: 73.860, tier: 'curated' },
  { slug: 'chakrapani-vasahat', name: 'Chakrapani Vasahat', lat: 18.650, lng: 73.760, tier: 'curated' },
  { slug: 'alhatwadi', name: 'Alhatwadi', lat: 18.665, lng: 73.882, tier: 'curated' },

  // ── Hinjawadi IT belt — phase-level micro-markets ───────────────────────────
  { slug: 'hinjawadi-phase-1', name: 'Hinjawadi Phase 1', lat: 18.595, lng: 73.735, tier: 'curated' },
  { slug: 'hinjawadi-phase-2', name: 'Hinjawadi Phase 2', lat: 18.585, lng: 73.720, tier: 'curated' },
  { slug: 'hinjawadi-phase-3', name: 'Hinjawadi Phase 3', lat: 18.598, lng: 73.690, tier: 'curated' },

  // ── PMC — central Pune, Peth core & flagship roads ──────────────────────────
  { slug: 'model-colony', name: 'Model Colony', lat: 18.531, lng: 73.836, tier: 'curated' },
  { slug: 'senapati-bapat-road', name: 'Senapati Bapat Road', lat: 18.532, lng: 73.833, tier: 'curated' },
  { slug: 'camp', name: 'Camp', lat: 18.514, lng: 73.878, tier: 'curated' },
  { slug: 'wanowrie', name: 'Wanowrie', lat: 18.484, lng: 73.899, tier: 'curated' },
  { slug: 'shaniwar-peth', name: 'Shaniwar Peth', lat: 18.516, lng: 73.853, tier: 'curated' },
  { slug: 'narayan-peth', name: 'Narayan Peth', lat: 18.512, lng: 73.853, tier: 'curated' },
  { slug: 'sadashiv-peth', name: 'Sadashiv Peth', lat: 18.509, lng: 73.851, tier: 'curated' },
  { slug: 'budhwar-peth', name: 'Budhwar Peth', lat: 18.517, lng: 73.858, tier: 'curated' },
  { slug: 'raviwar-peth', name: 'Raviwar Peth', lat: 18.517, lng: 73.861, tier: 'curated' },
  { slug: 'somwar-peth', name: 'Somwar Peth', lat: 18.522, lng: 73.868, tier: 'curated' },
  { slug: 'mangalwar-peth', name: 'Mangalwar Peth', lat: 18.525, lng: 73.872, tier: 'curated' },
  { slug: 'guruwar-peth', name: 'Guruwar Peth', lat: 18.510, lng: 73.857, tier: 'curated' },
  { slug: 'shukrawar-peth', name: 'Shukrawar Peth', lat: 18.508, lng: 73.855, tier: 'curated' },
  { slug: 'ganesh-peth', name: 'Ganesh Peth', lat: 18.518, lng: 73.865, tier: 'curated' },
  { slug: 'nana-peth', name: 'Nana Peth', lat: 18.516, lng: 73.869, tier: 'curated' },
  { slug: 'bhavani-peth', name: 'Bhavani Peth', lat: 18.510, lng: 73.867, tier: 'curated' },
  { slug: 'kasba-peth', name: 'Kasba Peth', lat: 18.520, lng: 73.858, tier: 'curated' },
  { slug: 'rasta-peth', name: 'Rasta Peth', lat: 18.516, lng: 73.867, tier: 'curated' },
  { slug: 'saras-baug', name: 'Saras Baug', lat: 18.503, lng: 73.855, tier: 'curated' },
  { slug: 'parvati', name: 'Parvati', lat: 18.494, lng: 73.851, tier: 'curated' },

  // ── PMC — south corridor (Katraj / Sinhagad Rd / Kondhwa / NIBM belt) ───────
  { slug: 'katraj', name: 'Katraj', lat: 18.448, lng: 73.858, tier: 'curated' },
  { slug: 'dhankawadi', name: 'Dhankawadi', lat: 18.462, lng: 73.853, tier: 'curated' },
  { slug: 'bibwewadi', name: 'Bibwewadi', lat: 18.475, lng: 73.865, tier: 'curated' },
  { slug: 'dhayari', name: 'Dhayari', lat: 18.456, lng: 73.808, tier: 'curated' },
  { slug: 'sinhagad-road', name: 'Sinhagad Road', lat: 18.470, lng: 73.826, tier: 'curated' },
  { slug: 'ambegaon-budruk', name: 'Ambegaon Budruk', lat: 18.463, lng: 73.837, tier: 'curated' },
  { slug: 'ambegaon-khurd', name: 'Ambegaon Khurd', lat: 18.455, lng: 73.828, tier: 'curated' },
  { slug: 'kondhwa', name: 'Kondhwa', lat: 18.464, lng: 73.888, tier: 'curated' },
  { slug: 'pisoli', name: 'Pisoli', lat: 18.448, lng: 73.905, tier: 'curated' },
  { slug: 'mahammadwadi', name: 'Mahammadwadi', lat: 18.470, lng: 73.918, tier: 'curated' },
  { slug: 'lulla-nagar', name: 'Lulla Nagar', lat: 18.491, lng: 73.892, tier: 'curated' },
  { slug: 'salunkhe-vihar', name: 'Salunkhe Vihar', lat: 18.485, lng: 73.905, tier: 'curated' },
  { slug: 'ghorpadi', name: 'Ghorpadi', lat: 18.512, lng: 73.902, tier: 'curated' },
  { slug: 'ganga-dham', name: 'Ganga Dham', lat: 18.487, lng: 73.883, tier: 'curated' },
  { slug: 'narhe', name: 'Narhe', lat: 18.457, lng: 73.797, tier: 'curated' },
  { slug: 'nanded-city', name: 'Nanded City', lat: 18.451, lng: 73.792, tier: 'curated' },
  { slug: 'kirkatwadi', name: 'Kirkatwadi', lat: 18.443, lng: 73.783, tier: 'curated' },
  { slug: 'khadakwasla', name: 'Khadakwasla', lat: 18.442, lng: 73.768, tier: 'curated' },
  { slug: 'yewalewadi', name: 'Yewalewadi', lat: 18.440, lng: 73.888, tier: 'curated' },
  { slug: 'kolewadi', name: 'Kolewadi', lat: 18.445, lng: 73.868, tier: 'curated' },
  { slug: 'handewadi', name: 'Handewadi', lat: 18.462, lng: 73.925, tier: 'curated' },
  { slug: 'autadwadi', name: 'Autadwadi', lat: 18.463, lng: 73.938, tier: 'curated' },
  { slug: 'wadachi-wadi', name: 'Wadachi Wadi', lat: 18.452, lng: 73.925, tier: 'curated' },
  { slug: 'khadi-machine-chowk', name: 'Khadi Machine Chowk', lat: 18.457, lng: 73.895, tier: 'curated' },

  // ── PMC — east / airport corridor & riverside ──────────────────────────────
  { slug: 'dhanori', name: 'Dhanori', lat: 18.586, lng: 73.892, tier: 'curated' },
  { slug: 'kalas', name: 'Kalas', lat: 18.596, lng: 73.887, tier: 'curated' },
  { slug: 'uruli-devachi', name: 'Uruli Devachi', lat: 18.435, lng: 73.955, tier: 'curated' },
  { slug: 'fursungi', name: 'Fursungi', lat: 18.470, lng: 73.960, tier: 'curated' },
  { slug: 'shewalewadi', name: 'Shewalewadi', lat: 18.480, lng: 73.972, tier: 'curated' },
  { slug: 'keshav-nagar', name: 'Keshav Nagar', lat: 18.542, lng: 73.930, tier: 'curated' },

  // ── West periphery villages (Paud Rd / NDA belt — emerging) ─────────────────
  { slug: 'sutarwadi', name: 'Sutarwadi', lat: 18.548, lng: 73.780, tier: 'curated' },
  { slug: 'mhalunge', name: 'Mhalunge', lat: 18.577, lng: 73.755, tier: 'curated' },
  { slug: 'nande', name: 'Nande', lat: 18.567, lng: 73.723, tier: 'curated' },
  { slug: 'chande', name: 'Chande', lat: 18.575, lng: 73.710, tier: 'curated' },
  { slug: 'pirangut', name: 'Pirangut', lat: 18.520, lng: 73.673, tier: 'curated' },
  { slug: 'bhugaon', name: 'Bhugaon', lat: 18.500, lng: 73.752, tier: 'curated' },
  { slug: 'bhukum', name: 'Bhukum', lat: 18.535, lng: 73.718, tier: 'curated' },

  // ── Outer periphery hotspots beyond PMC/PCMC (own research) ─────────────────
  { slug: 'chakan', name: 'Chakan', lat: 18.760, lng: 73.862, tier: 'curated' },
  { slug: 'talegaon-dabhade', name: 'Talegaon Dabhade', lat: 18.735, lng: 73.675, tier: 'curated' },
  { slug: 'dehu-road', name: 'Dehu Road', lat: 18.712, lng: 73.748, tier: 'curated' },
  { slug: 'lonikand', name: 'Lonikand', lat: 18.616, lng: 73.998, tier: 'curated' },
];

const BY_SLUG = Object.fromEntries(LOCALITIES.map((l) => [l.slug, l]));
const BY_NAME = Object.fromEntries(LOCALITIES.map((l) => [l.name.toLowerCase(), l]));

// A `COMMUNITY` array and a `registerCommunityLocalities(list)` used to sit here. The listing flow
// minted a `community`-tier locality whenever a lister's Google pick matched no curated area, and
// this registered the slug at runtime so every lookup resolved it.
//
// Both are gone (register item 24). Free text coins a slug, so the tier turned "Undhera Wasti",
// "undhera wasti " and "Undhera-Wasti" into three localities, each with a landing page and a share
// of the search facet — and the queue that was supposed to reconcile them lived in one browser's
// localStorage, so no operator but the one who caused it could see the mess. The server has always
// declined to invent a slug for text it cannot resolve; the listing now simply carries none, and a
// human files it from Admin ▸ Localities.
//
// The consequence for this module is that its registry is a constant again: `allLocalities()`
// returns `LOCALITIES` and nothing at runtime can add to it. `tier: 'curated'` is left on every row
// because callers still read it, and because a field whose only other value has been deleted is
// cheaper to leave than to chase through fifty call sites.

// Turn a locality name into a stable, URL-safe slug (same rule as slugifySociety
// so "Koregaon Park" → "koregaon-park", never the first-word-only truncation the
// listing flow used before).
export const slugifyLocality = (name) =>
  (name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const localityBySlug = (slug) => (slug ? BY_SLUG[slug] || null : null);
export const localityByName = (name) => {
  const k = (name || '').toLowerCase().trim();
  return k ? BY_NAME[k] || null : null;
};

// The registry — used by dropdowns, coord maps and the match layer.
export const allLocalities = () => LOCALITIES;

// Canonical name list + coord map — the single source the three legacy constant
// files (list-property, flatmates, homeData) now derive from.
export const localityNames = () => allLocalities().map((l) => l.name);
export const localityCoordMap = () =>
  Object.fromEntries(allLocalities().filter((l) => l.lat != null && l.lng != null).map((l) => [l.name, [l.lat, l.lng]]));

const haversineKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// Bind a raw pick (typed name and/or Google coords) to a canonical locality.
// Name is authoritative: exact-slug first, then a whole-name fuzzy contain; only
// when the name resolves nothing do we fall back to the nearest area within
// ~2.5 km. Returns { slug, name } of the canonical row, or null when nothing
// matches (the caller then honestly full-slugifies the typed name, or Phase B
// mints a new community locality).
export function matchLocalityToCanonical(name, lat, lng) {
  const nm = (name || '').trim();
  if (nm) {
    const direct = localityBySlug(slugifyLocality(nm)) || localityByName(nm);
    if (direct) return { slug: direct.slug, name: direct.name };
    const low = nm.toLowerCase();
    const fuzzy = allLocalities().find((l) => {
      const ln = l.name.toLowerCase();
      // Guard partial contains to names >= 5 chars so short names (Sus, Maan)
      // don't over-match; exact names are already handled by the direct lookup.
      return ln.length >= 5 && (low.includes(ln) || ln.includes(low));
    });
    if (fuzzy) return { slug: fuzzy.slug, name: fuzzy.name };
  }
  if (lat != null && lng != null) {
    let best = null;
    let bestKm = Infinity;
    for (const l of allLocalities()) {
      if (l.lat == null || l.lng == null) continue;
      const km = haversineKm(lat, lng, l.lat, l.lng);
      if (km < bestKm) { bestKm = km; best = l; }
    }
    if (best && bestKm <= 2.5) return { slug: best.slug, name: best.name };
  }
  return null;
}

// Nearest canonical locality to a coordinate, with a caller-chosen max radius.
// Unlike matchLocalityToCanonical's fixed 2.5 km gate (shared with the listing-bind
// path), this lets a filter pick — a street or sub-area anywhere inside a locality —
// always snap UP to its parent locality. Returns { slug, name } or null (no coords,
// or nothing within maxKm).
export function nearestLocality(lat, lng, maxKm = Infinity) {
  if (lat == null || lng == null) return null;
  let best = null;
  let bestKm = Infinity;
  for (const l of allLocalities()) {
    if (l.lat == null || l.lng == null) continue;
    const km = haversineKm(lat, lng, l.lat, l.lng);
    if (km < bestKm) { bestKm = km; best = l; }
  }
  return best && bestKm <= maxKm ? { slug: best.slug, name: best.name } : null;
}

// Resolve a typed/picked locality to a canonical slug, never truncating a
// multi-word name to its first word. Prefers the canonical match; otherwise an
// honest full slug of the typed name.
export const resolveLocalitySlug = (name, lat, lng) => {
  const canon = matchLocalityToCanonical(name, lat, lng);
  return canon ? canon.slug : slugifyLocality(name);
};
