/* ---------- canonical searchable property-type taxonomy ----------
   Single source of truth for how properties are *browsed and searched*
   (home search + listings filter + matchers). It is deliberately aligned
   with the six authoring types in the "Post a property" flow
   (`list-property/constants.js` PROPERTY_TYPES and the admin post-on-behalf
   wizard) so every posted property is discoverable under the same options.

   Each entry:
     key     – stable slug used in URLs (?ptype=) and filter state.
     label   – human label shown in dropdowns / filter checkboxes.
     icon    – Icon.jsx name for the home search dropdown.
     buy     – offered on the Buy tab / filter.
     rent    – offered on the Rent tab / filter.
     matches – substrings tested (case-insensitive) against a listing's
               stored `type` string. `null` means the key is matched by a
               different signal (pg/flatmates use `shareType`, not `type`),
               so string matching is skipped.

   Stored `type` strings this must recognise (from submit.js / admin +
   seed data): Flat, Studio, Penthouse, Independent House, Row House, Villa,
   Commercial + subtypes (Office Space, Shop / Showroom, Retail / Mall Unit,
   Warehouse / Godown, Industrial / Factory, Co-working Space), Open Plot,
   Plot (legacy), Farm Land. */
export const SEARCH_TYPES = [
  { key: 'flat', label: 'Flat', icon: 'building', buy: true, rent: true, matches: ['flat', 'studio', 'penthouse'] },
  { key: 'house', label: 'Independent House', icon: 'home', buy: true, rent: true, matches: ['independent house', 'row house'] },
  { key: 'villa', label: 'Villa', icon: 'building-2', buy: true, rent: true, matches: ['villa'] },
  { key: 'pg', label: 'PG / Hostel', icon: 'bed-double', buy: true, rent: true, matches: null },
  { key: 'flatmates', label: 'Shared Room', icon: 'door-open', buy: false, rent: true, matches: null },
  { key: 'commercial', label: 'Commercial', icon: 'briefcase', buy: true, rent: true, matches: ['office', 'shop', 'showroom', 'retail', 'commercial', 'warehouse', 'godown', 'industrial', 'co-working', 'coworking'] },
  { key: 'plot', label: 'Open Plot', icon: 'map', buy: true, rent: true, matches: ['open plot', 'plot'] },
  { key: 'farmland', label: 'Farm Land', icon: 'trees', buy: true, rent: true, matches: ['farm land', 'farmland'] },
];

const BY_KEY = Object.fromEntries(SEARCH_TYPES.map((t) => [t.key, t]));

/* ---------- PG / Hostel sharing (occupancy) ----------
   Single source of truth for how a PG/Hostel room's occupancy is authored
   (Post a property + admin post-on-behalf) and searched (home + listings filter).
   Standard Indian PG market model (single → dormitory). Deliberately separate
   from Share-a-Flat's Private/Shared roommate concept. `[key, label]` pairs. */
export const PG_SHARING = [
  ['single', 'Single (No Sharing)'],
  ['double', 'Double Sharing'],
  ['triple', 'Triple Sharing'],
  ['four', 'Four Sharing'],
  ['five', 'Five Sharing'],
  ['dorm', 'Dormitory (6+)'],
];
export const SHARING_LBL = Object.fromEntries(PG_SHARING);
export const isSharingKey = (k) => k in SHARING_LBL;
/* Helper note shown under the "Sharing Types *" label wherever an owner authors a
   PG (consumer listing flow + admin post-on-behalf wizard): a PG usually offers
   several occupancies and each carries its own rent, so the owner picks them all. */
export const PG_SHARING_HELP = "Select every room-sharing option your PG offers — you'll set a separate rent for each on the pricing step.";
/* [{value,label}] shape for MultiSelect / Select dropdowns (post + admin flows). */
export const PG_SHARING_OPTS = PG_SHARING.map(([value, label]) => ({ value, label }));

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
  'pg / hostel': 'pg',
  'pg / co-living': 'pg',
};

/* Normalise any incoming type token (URL param or label) to a canonical key,
   or '' when it maps to nothing. */
export const canonicalTypeKey = (raw) => {
  const s = (raw || '').trim().toLowerCase();
  if (!s || isTypeKey(s)) return s;
  return ALIASES[s] || '';
};

/* True when a listing's stored `type` string belongs to the given filter key.
   pg/flatmates return false here (they are matched via shareType upstream). */
export const matchTypeKey = (key, typeStr) => {
  const def = BY_KEY[key];
  if (!def || !def.matches) return false;
  const x = (typeStr || '').toLowerCase();
  return def.matches.some((m) => x.includes(m));
};

/* ---------- commercial subtypes ----------
   Mirrors the "Post a property" COMMERCIAL_SUBTYPES so a commercial listing is
   filterable by the same options it was authored with. `matches` are substrings
   tested against a listing's stored `type` string (e.g. "Office Space",
   "Shop / Showroom", "Retail / Mall Unit", "Warehouse / Godown",
   "Industrial / Factory", "Co-working Space"). */
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
