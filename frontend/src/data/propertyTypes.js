/* Aligned with the authoring types in the post flow so everything posted is discoverable. `matches` are
   case-insensitive substrings of a listing's stored `type`; `null` means another signal decides it. */
export const SEARCH_TYPES = [
  { key: 'flat', label: 'Flat', icon: 'building', buy: true, rent: true, matches: ['flat', 'apartment', 'studio', 'penthouse'] },
  { key: 'house', label: 'Independent House', icon: 'home', buy: true, rent: true, matches: ['independent house', 'row house'] },
  { key: 'villa', label: 'Villa', icon: 'building-2', buy: true, rent: true, matches: ['villa'] },
  { key: 'flatmates', label: 'Shared Room', icon: 'door-open', buy: false, rent: true, matches: null },
  { key: 'commercial', label: 'Commercial', icon: 'briefcase', buy: true, rent: true, matches: ['office', 'shop', 'showroom', 'retail', 'commercial', 'warehouse', 'godown', 'industrial', 'co-working', 'coworking'] },
  { key: 'plot', label: 'Open Plot', icon: 'map', buy: true, rent: true, matches: ['open plot', 'plot'] },
  { key: 'farmland', label: 'Farm Land', icon: 'trees', buy: true, rent: true, matches: ['farm land', 'farmland'] },
];

const BY_KEY = Object.fromEntries(SEARCH_TYPES.map((t) => [t.key, t]));

/* [key, label] pairs consumed by the listings filter + chip labels. */
export const BUY_TYPES = SEARCH_TYPES.filter((t) => t.buy).map((t) => [t.key, t.label]);
export const RENT_TYPES = SEARCH_TYPES.filter((t) => t.rent).map((t) => [t.key, t.label]);

/* [key, label, icon] triples consumed by the home HeroSearch dropdowns. */
export const HOME_TYPE_OPTS = {
  buy: SEARCH_TYPES.filter((t) => t.buy).map((t) => [t.key, t.label, t.icon]),
  rent: SEARCH_TYPES.filter((t) => t.rent).map((t) => [t.key, t.label, t.icon]),
};

/* Valid filter keys, for URL/param sanitisation. */
export const isTypeKey = (k) => k in BY_KEY;

/* Legacy / display-label → canonical key. Keeps old deep-links working
   (e.g. ?ptype=Villa%20%2F%20House, ?ptype=Plot%20%2F%20Land, ?type=penthouse). */
const ALIASES = {
  'villa / house': 'house',
  'plot / land': 'plot',
  'plot / plot': 'plot',
  penthouse: 'flat',
  apartment: 'flat',
  studio: 'flat',
  'independent house': 'house',
  'row house': 'house',
  'open plot': 'plot',
  'farm land': 'farmland',
};

/* Normalise any incoming type token (URL param or label) to a canonical key,
   or '' when it maps to nothing. */
export const canonicalTypeKey = (raw) => {
  const s = (raw || '').trim().toLowerCase();
  if (!s || isTypeKey(s)) return s;
  return ALIASES[s] || '';
};

/* True when a listing's stored `type` string belongs to the given filter key.
   flatmates returns false here (it is matched via shareType upstream). */
export const matchTypeKey = (key, typeStr) => {
  const def = BY_KEY[key];
  if (!def || !def.matches) return false;
  const x = (typeStr || '').toLowerCase();
  return def.matches.some((m) => x.includes(m));
};

/* The subset of SEARCH_TYPES that is a home you can be walked through. Reels is scoped to these: a
   plot has no interior to tour, and commercial is searched by spec rather than browsed by feel. */
export const RESIDENTIAL_KEYS = ['flat', 'house', 'villa'];
export const isResidentialHome = (typeStr) => RESIDENTIAL_KEYS.some((k) => matchTypeKey(k, typeStr));

/* Mirrors the post flow's COMMERCIAL_SUBTYPES so a commercial listing is filterable by the same
   options it was authored with. */
export const COMMERCIAL_SUBTYPES = [
  { key: 'office', label: 'Office Space', matches: ['office'] },
  { key: 'shop', label: 'Shop / Showroom', matches: ['shop', 'showroom'] },
  { key: 'retail', label: 'Retail / Mall Unit', matches: ['retail', 'mall'] },
  { key: 'warehouse', label: 'Warehouse / Godown', matches: ['warehouse', 'godown'] },
  { key: 'industrial', label: 'Industrial / Factory', matches: ['industrial', 'factory'] },
  { key: 'coworking', label: 'Co-working Space', matches: ['co-working', 'coworking'] },
];

const COMM_BY_KEY = Object.fromEntries(COMMERCIAL_SUBTYPES.map((t) => [t.key, t]));

/* [key, label] pairs consumed by the listings "Commercial Type" sub-filter. */
export const COMMERCIAL_TYPES = COMMERCIAL_SUBTYPES.map((t) => [t.key, t.label]);

/* True when a listing's stored `type` string is the given commercial subtype. */
export const matchCommercialKey = (key, typeStr) => {
  const def = COMM_BY_KEY[key];
  if (!def) return false;
  const x = (typeStr || '').toLowerCase();
  return def.matches.some((m) => x.includes(m));
};

/* Plots are zoned, not measured in bedrooms. Mirrors the post flow's plotZoneOptions, and lives
   here rather than on the listings page because the home hero search offers it too. */
export const LAND_USE = [
  ['residential', 'Residential'],
  ['commercial', 'Commercial'],
  ['industrial', 'Industrial'],
  ['agricultural', 'Agricultural'],
  ['mixed', 'Mixed-Use'],
];
export const LANDUSE_LBL = Object.fromEntries(LAND_USE);
