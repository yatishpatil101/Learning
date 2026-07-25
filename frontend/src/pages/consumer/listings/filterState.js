/* Listings filter state — single source of truth for the filter shape, its
   defaults, the Set<->array serialisation used by return-to-search snapshots,
   and the two-way URL <-> filter mapping that makes a search shareable,
   refresh-safe and back-button-safe. */
import { canonicalTypeKey, isSharingKey } from '../../../data/propertyTypes.js';
import { BUY_TYPES, RENT_TYPES } from './constants.js';
import { nearToParams } from '../../../lib/nearParams.js';

/* Default range values — a filter at its default is omitted from the URL so the
   address bar only ever carries what the user actually narrowed. */
export const RANGE = {
  budget: [0, 50000000],
  rent: [0, 100000],
  area: [0, 6000],
  age: [0, 25],
  floor: [0, 40],
};

export const INITIAL = (deal) => ({
  deal,
  budget: [...RANGE.budget],
  rent: [...RANGE.rent],
  types: new Set(),
  commercialTypes: new Set(),
  bhk: new Set(),
  furnishing: new Set(),
  localities: new Set(),
  societies: new Set(),
  area: [...RANGE.area],
  amenities: new Set(),
  verified: {},
  locQuery: '',
  room: new Set(),
  sharing: new Set(),
  tenants: new Set(),
  availFrom: '',
  pets: false,
  avail: '',
  age: [...RANGE.age],
  floor: [...RANGE.floor],
  constr: new Set(),
  landUse: new Set(),
  near: '',
  nearLabel: '',
  nearRadius: 5,
  nearMode: 'km',
});

// Filter state carries Set instances that JSON can't represent, so return-to-search
// snapshots round-trip these keys through arrays.
export const SET_KEYS = ['types', 'commercialTypes', 'bhk', 'furnishing', 'localities', 'societies', 'amenities', 'room', 'sharing', 'tenants', 'constr', 'landUse'];
export const serializeF = (f) => { const o = { ...f }; SET_KEYS.forEach((k) => { o[k] = [...f[k]]; }); return o; };
export const deserializeF = (o) => { const f = { ...o }; SET_KEYS.forEach((k) => { f[k] = new Set(o[k] || []); }); return f; };

/* Every URL param this module owns. The state->URL sync deletes all of these
   (plus the legacy aliases) before writing the current filters, so clearing a
   filter reliably drops it from the address bar. */
export const FILTER_PARAM_KEYS = [
  'loc', 'soc', 'ptype', 'ctype', 'bhk', 'furn', 'amen', 'v', 'sharing', 'room',
  'tenants', 'landuse', 'constr', 'avail', 'availfrom', 'pets', 'budget',
  'rent', 'area', 'age', 'floor', 'near', 'nearlabel', 'nearr', 'nearmode',
];
const LEGACY_ALIASES = ['type', 'locality'];

const VERIF_KEYS = ['owner', 'ownership', 'rera', 'society', 'conveyance'];
const BHK_KEYS = { rent: ['0', '1', '2', '3', '3plus'], buy: ['1', '2', '3', '4', '5'] };

const joinSet = (s) => [...s].join(',');
const splitCsv = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
const rangeChanged = (v, def) => v[0] !== def[0] || v[1] !== def[1];

/* Cross-deal BHK normalisation: a token from another deal (or a home-search
   deep link) is coerced to the nearest bucket valid for the current deal. */
function normBhk(token, deal) {
  const keys = BHK_KEYS[deal];
  if (keys.includes(token)) return token;
  let key = token;
  if (key === '3plus') key = '3';          // Buy has no 3+ bucket -> nearest is 3 BHK
  else if (key === '0') key = '1';         // Buy has no RK/studio -> nearest is 1 BHK
  else {
    const n = Number(key);
    if (deal === 'rent' && n > 3) key = '3plus';
    else if (deal === 'buy' && n >= 5) key = '5';
    else key = String(n);
  }
  return keys.includes(key) ? key : null;
}

function parseRange(v, def) {
  if (!v) return [...def];
  const parts = v.split('-');
  if (parts.length !== 2) return [...def];
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  if (Number.isNaN(a) || Number.isNaN(b) || a > b) return [...def];
  return [a, b];
}

/* filters -> plain { param: string } map, carrying only what the user narrowed. */
export function filtersToParams(f) {
  const p = {};
  const isRent = f.deal === 'rent';
  if (f.localities.size) p.loc = joinSet(f.localities);
  if (f.societies.size) p.soc = joinSet(f.societies);
  if (f.types.size) p.ptype = joinSet(f.types);
  if (f.types.has('commercial') && f.commercialTypes.size) p.ctype = joinSet(f.commercialTypes);
  if (f.bhk.size) p.bhk = joinSet(f.bhk);
  if (f.furnishing.size) p.furn = joinSet(f.furnishing);
  if (f.amenities.size) p.amen = joinSet(f.amenities);
  if (f.landUse.size) p.landuse = joinSet(f.landUse);
  if (f.sharing.size) p.sharing = joinSet(f.sharing);
  const vkeys = VERIF_KEYS.filter((k) => f.verified[k]);
  if (vkeys.length) p.v = vkeys.join(',');
  if (rangeChanged(f.age, RANGE.age)) p.age = `${f.age[0]}-${f.age[1]}`;
  if (rangeChanged(f.floor, RANGE.floor)) p.floor = `${f.floor[0]}-${f.floor[1]}`;
  if (isRent) {
    if (f.room.size) p.room = joinSet(f.room);
    if (f.tenants.size) p.tenants = joinSet(f.tenants);
    if (f.availFrom) p.availfrom = f.availFrom;
    if (f.pets) p.pets = '1';
    if (rangeChanged(f.rent, RANGE.rent)) p.rent = `${f.rent[0]}-${f.rent[1]}`;
  } else {
    if (f.constr.size) p.constr = joinSet(f.constr);
    if (f.avail) p.avail = f.avail;
    if (rangeChanged(f.budget, RANGE.budget)) p.budget = `${f.budget[0]}-${f.budget[1]}`;
    if (rangeChanged(f.area, RANGE.area)) p.area = `${f.area[0]}-${f.area[1]}`;
  }
  // Near-a-Place carries a human label so any point (a society/POI, not just a
  // registry landmark) shows its real name in the filter + chip. Built through the
  // shared near contract so this path can't drift from the home-search path.
  Object.assign(p, nearToParams({ near: f.near, nearLabel: f.nearLabel, radius: f.nearRadius, mode: f.nearMode }));
  return p;
}

/* URLSearchParams -> full filter state for the given deal. Also understands the
   legacy home-search params (?type=, ?locality=, single ?bhk=/?sharing=). */
export function paramsToFilters(params, deal) {
  const f = INITIAL(deal);
  const isRent = deal === 'rent';
  const get = (k) => params.get(k) || '';

  const allowedTypes = new Set((isRent ? RENT_TYPES : BUY_TYPES).map(([k]) => k));
  const typeTokens = splitCsv(get('ptype') || get('type')).map(canonicalTypeKey).filter(Boolean);
  const pickedTypes = typeTokens.filter((k) => allowedTypes.has(k));
  if (pickedTypes.length) f.types = new Set(pickedTypes);

  if (f.types.has('commercial')) f.commercialTypes = new Set(splitCsv(get('ctype')));

  // Localities carried as slugs (or home-search names) -> slugify to match data.
  const locTokens = splitCsv(get('loc') || get('locality')).map((s) => s.toLowerCase().replace(/\s+/g, '-'));
  if (locTokens.length) f.localities = new Set(locTokens);

  // Societies carried as slugs (society hub / hero search) — kept verbatim.
  const socTokens = splitCsv(get('soc'));
  if (socTokens.length) f.societies = new Set(socTokens);

  const bhkKeys = splitCsv(get('bhk')).map((t) => normBhk(t, deal)).filter(Boolean);
  if (bhkKeys.length) f.bhk = new Set(bhkKeys);

  if (get('furn')) f.furnishing = new Set(splitCsv(get('furn')));
  if (get('amen')) f.amenities = new Set(splitCsv(get('amen')));
  if (get('landuse')) f.landUse = new Set(splitCsv(get('landuse')));

  const sharing = splitCsv(get('sharing')).filter(isSharingKey);
  if (sharing.length) f.sharing = new Set(sharing);

  const vkeys = splitCsv(get('v')).filter((k) => VERIF_KEYS.includes(k));
  if (vkeys.length) f.verified = Object.fromEntries(vkeys.map((k) => [k, true]));

  f.age = parseRange(get('age'), RANGE.age);
  f.floor = parseRange(get('floor'), RANGE.floor);

  if (isRent) {
    if (get('room')) f.room = new Set(splitCsv(get('room')));
    if (get('tenants')) f.tenants = new Set(splitCsv(get('tenants')));
    if (get('availfrom')) f.availFrom = get('availfrom');
    if (get('pets') === '1') f.pets = true;
    f.rent = parseRange(get('rent'), RANGE.rent);
  } else {
    if (get('constr')) f.constr = new Set(splitCsv(get('constr')));
    if (get('avail')) f.avail = get('avail');
    f.budget = parseRange(get('budget'), RANGE.budget);
    f.area = parseRange(get('area'), RANGE.area);
  }

  const near = get('near');
  if (near) {
    f.near = near;
    const nl = get('nearlabel');
    if (nl) f.nearLabel = nl;
    const r = Number(get('nearr'));
    if (!Number.isNaN(r) && r > 0) f.nearRadius = r;
    const mode = get('nearmode');
    if (mode === 'min' || mode === 'km') f.nearMode = mode;
  }

  return f;
}

/* Apply the current filters onto a URLSearchParams (mutates a copy): clears all
   managed keys + legacy aliases, then writes the non-default filters. */
export function applyFiltersToSearchParams(params, f) {
  const next = new URLSearchParams(params);
  [...FILTER_PARAM_KEYS, ...LEGACY_ALIASES].forEach((k) => next.delete(k));
  const p = filtersToParams(f);
  Object.entries(p).forEach(([k, v]) => next.set(k, v));
  return next;
}
