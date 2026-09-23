/* Single source of truth for the filter shape, the Set<->array serialisation used by return-to-search
   snapshots, and the two-way URL mapping that makes a search shareable and back-button-safe. */
import { canonicalTypeKey, BUY_TYPES, RENT_TYPES } from '../../data/propertyTypes.js';
import { clampNearRadius, nearMaxFor, nearToParams } from '../nearParams.js';

/* Default range values — a filter at its default is omitted from the URL so the
   address bar only ever carries what the user actually narrowed. */
export const RANGE = {
  budget: [0, 50000000],
  rent: [0, 100000],
  area: [0, 6000],
  age: [0, 25],
  floor: [0, 40],
  deposit: [0, 1000000],
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
  ownerOnly: false,
  locQuery: '',
  room: new Set(),
  tenants: new Set(),
  availFrom: '',
  pets: false,
  avail: '',
  age: [...RANGE.age],
  floor: [...RANGE.floor],
  deposit: [...RANGE.deposit],
  constr: new Set(),
  landUse: new Set(),
  near: '',
  nearLabel: '',
  nearRadius: 5,
  nearMode: 'km',
});

// Filter state carries Set instances that JSON can't represent, so return-to-search
// snapshots round-trip these keys through arrays.
export const SET_KEYS = ['types', 'commercialTypes', 'bhk', 'furnishing', 'localities', 'societies', 'amenities', 'room', 'tenants', 'constr', 'landUse'];
export const serializeF = (f) => { const o = { ...f }; SET_KEYS.forEach((k) => { o[k] = [...f[k]]; }); return o; };
// A snapshot is written by one deploy and read by the next, so a range key added since it was
// stored is simply absent; starting from INITIAL keeps the restored panel from dereferencing it.
export const deserializeF = (o) => { const f = { ...INITIAL(o?.deal), ...o }; SET_KEYS.forEach((k) => { f[k] = new Set(o[k] || []); }); return f; };

/* Every URL param this module owns. The state->URL sync deletes all of these before writing the
   current filters, so clearing a filter reliably drops it from the address bar. */
export const FILTER_PARAM_KEYS = [
  'loc', 'soc', 'ptype', 'ctype', 'bhk', 'furn', 'amen', 'v', 'owneronly', 'room',
  'tenants', 'landuse', 'constr', 'avail', 'availfrom', 'pets', 'budget',
  'rent', 'area', 'age', 'floor', 'deposit', 'near', 'nearlabel', 'nearr', 'nearmode',
];
/* Retired params that still arrive from bookmarks and shared links. Listed so the state->URL sync
   strips them; otherwise a withdrawn filter rides along for the whole session. */
const LEGACY_ALIASES = ['type', 'locality', 'sharing'];

/* Whether a URL narrows anything of its own, which is what separates a deal *toggle* from a deal
   *link*: "Buy plots" names a filter and must arrive clean, while a bare ?deal=buy is the same
   search asked of the other side and keeps what carries over. */
export const hasFilterParams = (params) => [...FILTER_PARAM_KEYS, ...LEGACY_ALIASES].some((k) => params.has(k));

const VERIF_KEYS = ['owner', 'ownership', 'rera', 'society', 'conveyance'];
const BHK_KEYS = { rent: ['0', '1', '2', '3', '3plus'], buy: ['1', '2', '3', '4'] };

const joinSet = (s) => [...s].join(',');
const splitCsv = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
const rangeChanged = (v, def) => v[0] !== def[0] || v[1] !== def[1];

/* Cross-deal BHK normalisation: a token from another deal (or a home-search
   deep link) is coerced to the nearest bucket valid for the current deal. */
export function normBhk(token, deal) {
  const keys = BHK_KEYS[deal];
  if (keys.includes(token)) return token;
  let key = token;
  if (key === '3plus') key = '3';          // Buy has no 3+ bucket -> nearest is 3 BHK
  else if (key === '0') key = '1';         // Buy has no RK/studio -> nearest is 1 BHK
  else {
    const n = Number(key);
    if (deal === 'rent' && n > 3) key = '3plus';
    else if (deal === 'buy' && n >= 4) key = '4';
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
  const vkeys = VERIF_KEYS.filter((k) => f.verified[k]);
  if (vkeys.length) p.v = vkeys.join(',');
  if (f.ownerOnly) p.owneronly = '1';
  if (rangeChanged(f.age, RANGE.age)) p.age = `${f.age[0]}-${f.age[1]}`;
  if (rangeChanged(f.floor, RANGE.floor)) p.floor = `${f.floor[0]}-${f.floor[1]}`;
  if (rangeChanged(f.area, RANGE.area)) p.area = `${f.area[0]}-${f.area[1]}`;
  if (isRent) {
    if (f.room.size) p.room = joinSet(f.room);
    if (f.tenants.size) p.tenants = joinSet(f.tenants);
    if (f.availFrom) p.availfrom = f.availFrom;
    if (f.pets) p.pets = '1';
    if (rangeChanged(f.rent, RANGE.rent)) p.rent = `${f.rent[0]}-${f.rent[1]}`;
    if (rangeChanged(f.deposit, RANGE.deposit)) p.deposit = `${f.deposit[0]}-${f.deposit[1]}`;
  } else {
    if (f.constr.size) p.constr = joinSet(f.constr);
    if (f.avail) p.avail = f.avail;
    if (rangeChanged(f.budget, RANGE.budget)) p.budget = `${f.budget[0]}-${f.budget[1]}`;
  }
  // Near-a-Place carries a human label so any point (a society/POI, not just a registry landmark)
  // shows its real name; built through the shared near contract so it can't drift from home search.
  Object.assign(p, nearToParams({ near: f.near, nearLabel: f.nearLabel, radius: f.nearRadius, mode: f.nearMode }));
  return p;
}

/* URLSearchParams -> full filter state for the given deal. Also understands the
   legacy home-search params (?type=, ?locality=, single ?bhk=). */
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

  const vkeys = splitCsv(get('v')).filter((k) => VERIF_KEYS.includes(k));
  if (vkeys.length) f.verified = Object.fromEntries(vkeys.map((k) => [k, true]));

  if (get('owneronly') === '1') f.ownerOnly = true;

  f.age = parseRange(get('age'), RANGE.age);
  f.floor = parseRange(get('floor'), RANGE.floor);
  f.area = parseRange(get('area'), RANGE.area);

  if (isRent) {
    if (get('room')) f.room = new Set(splitCsv(get('room')));
    if (get('tenants')) f.tenants = new Set(splitCsv(get('tenants')));
    if (get('availfrom')) f.availFrom = get('availfrom');
    if (get('pets') === '1') f.pets = true;
    f.rent = parseRange(get('rent'), RANGE.rent);
    f.deposit = parseRange(get('deposit'), RANGE.deposit);
  } else {
    if (get('constr')) f.constr = new Set(splitCsv(get('constr')));
    if (get('avail')) f.avail = get('avail');
    f.budget = parseRange(get('budget'), RANGE.budget);
  }

  const near = get('near');
  if (near) {
    f.near = near;
    const nl = get('nearlabel');
    if (nl) f.nearLabel = nl;
    const mode = get('nearmode');
    if (mode === 'min' || mode === 'km') f.nearMode = mode;
    const r = Number(get('nearr'));
    // Read after the mode, because the two axes have different ceilings.
    if (!Number.isNaN(r) && r > 0) f.nearRadius = clampNearRadius(r, nearMaxFor(f.nearMode));
  }

  return f;
}

/* Rent <-> buy is a change of journey, not a new search, so only what the new deal genuinely
   cannot express is dropped; types and BHK are carried through the same coercion a cross-deal deep
   link already gets, rather than discarded. */
export function switchDealFilters(prev, deal) {
  const f = INITIAL(deal);
  const allowedTypes = new Set((deal === 'rent' ? RENT_TYPES : BUY_TYPES).map(([k]) => k));
  f.types = new Set([...prev.types].filter((k) => allowedTypes.has(k)));
  if (f.types.has('commercial')) f.commercialTypes = new Set(prev.commercialTypes);
  f.bhk = new Set([...prev.bhk].map((tok) => normBhk(tok, deal)).filter(Boolean));
  f.localities = new Set(prev.localities);
  f.societies = new Set(prev.societies);
  f.amenities = new Set(prev.amenities);
  f.furnishing = new Set(prev.furnishing);
  f.landUse = new Set(prev.landUse);
  f.verified = { ...prev.verified };
  f.ownerOnly = prev.ownerOnly;
  f.locQuery = prev.locQuery;
  f.area = [...prev.area];
  f.age = [...prev.age];
  f.floor = [...prev.floor];
  f.near = prev.near;
  f.nearLabel = prev.nearLabel;
  f.nearRadius = prev.nearRadius;
  f.nearMode = prev.nearMode;
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
