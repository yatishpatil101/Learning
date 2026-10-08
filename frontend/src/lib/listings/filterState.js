/* Single source of truth for the filter shape, the Set<->array serialisation used by return-to-search
   snapshots, and the two-way URL mapping that makes a search shareable and back-button-safe. */
import { canonicalTypeKey, BUY_TYPES, RENT_TYPES } from '../../data/propertyTypes.js';
import { BHK_KEYS, expandBhkToken, normBhk } from './bhkOptions.js';
import { clampNearRadius, nearMaxFor, nearToParams } from '../nearParams.js';
import { BUILT_AREA_RANGE, areaProfileForTypes, areaRangeToUrl, defaultAreaRangeSqft, isDefaultAreaRange, parseAreaRange } from './areaUnits.js';
import { sectionVisible } from './filterRelevance.js';

/* Default range values — a filter at its default is omitted from the URL so the
   address bar only ever carries what the user actually narrowed. */
export const RANGE = {
  budget: [0, 50000000],
  rent: [0, 100000],
  area: BUILT_AREA_RANGE,
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
  facing: new Set(),
  minBaths: '',
  localities: new Set(),
  societies: new Set(),
  area: [...RANGE.area],
  areaUnit: 'sqft',
  amenities: new Set(),
  verified: {},
  locQuery: '',
  room: new Set(),
  tenants: new Set(),
  availFrom: '',
  pets: false,
  food: '',
  age: [...RANGE.age],
  floor: [...RANGE.floor],
  deposit: [...RANGE.deposit],
  constr: new Set(),
  landUse: new Set(),
  shell: new Set(),
  preLeased: false,
  na: new Set(),
  near: '',
  nearLabel: '',
  nearRadius: 5,
  nearMode: 'km',
});

export const FOOD_KEYS = ['veg', 'jain', 'nonveg'];
// `true` is how snapshots stored before Veg/Jain existed spelled "Non-veg OK".
const normalizeFood = (v) => (v === true ? 'nonveg' : FOOD_KEYS.includes(v) ? v : '');

// Filter state carries Set instances that JSON can't represent, so return-to-search
// snapshots round-trip these keys through arrays.
export const SET_KEYS = ['types', 'commercialTypes', 'bhk', 'furnishing', 'facing', 'localities', 'societies', 'amenities', 'room', 'tenants', 'constr', 'landUse', 'shell', 'na'];
export const serializeF = (f) => { const o = { ...f }; SET_KEYS.forEach((k) => { o[k] = [...f[k]]; }); return o; };
// A snapshot can cross deploys; starting from INITIAL keeps missing newer keys safe.
export const deserializeF = (o) => {
  const f = { ...INITIAL(o?.deal), ...o };
  SET_KEYS.forEach((k) => { f[k] = new Set(o?.[k] || []); });
  f.minBaths = MIN_BATH_KEYS.has(String(f.minBaths)) ? String(f.minBaths) : '';
  f.food = normalizeFood(f.food);
  delete f.ownerOnly;
  delete f.postedBy;
  if (f.deal === 'buy' && f.avail && !f.constr.size) f.constr = new Set(legacyAvailToConstruction(f.avail));
  delete f.avail;
  Object.assign(f, normalizeArea(f.area, f.types, f.areaUnit));
  return f;
};

/* Every URL param this module owns. The state->URL sync deletes all of these before writing the
   current filters, so clearing a filter reliably drops it from the address bar. */
export const FILTER_PARAM_KEYS = [
  'loc', 'soc', 'ptype', 'ctype', 'bhks', 'bhk', 'furn', 'facing', 'minBaths', 'amen', 'v',
  'postedBy', 'owneronly', 'postedByOwner', 'room', 'tenants', 'landuse', 'na', 'constr',
  'avail', 'availfrom', 'pets', 'food', 'shell', 'preLeased', 'budget', 'rent', 'area',
  'areaUnit', 'age', 'floor', 'deposit', 'near', 'nearlabel', 'nearr', 'nearmode',
];
/* Retired params that still arrive from bookmarks and shared links. Listed so the state->URL sync
   strips them; otherwise a withdrawn filter rides along for the whole session. */
const LEGACY_ALIASES = ['type', 'locality', 'sharing'];

/* Filtered links reset cleanly; a bare deal switch keeps compatible state across journeys. */
export const hasFilterParams = (params) => [...FILTER_PARAM_KEYS, ...LEGACY_ALIASES].some((k) => params.has(k));

const VERIF_KEYS = ['owner', 'ownership', 'rera'];
const LEGACY_AVAIL_TO_CONSTRUCTION = Object.assign(Object.create(null), {
  ready: ['ready'],
  uc: ['under', 'new'],
});
const CONSTRUCTION_KEYS = new Set(['ready', 'under', 'new']);
const MIN_BATH_KEYS = new Set(['1', '2', '3', '4']);

export { normBhk };

const joinSet = (s) => [...s].join(',');
const splitCsv = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
export const rangeChanged = (v, def) => v[0] !== def[0] || v[1] !== def[1];
const validConstruction = (tokens) => tokens.filter((token) => CONSTRUCTION_KEYS.has(token));
const legacyAvailToConstruction = (token) => LEGACY_AVAIL_TO_CONSTRUCTION[token] || [];
const normalizeArea = (area, types, unit) => {
  const profile = areaProfileForTypes(types, unit);
  const current = Array.isArray(area) ? area : RANGE.area;
  const unsupportedUnit = unit && profile.unit !== unit;
  return {
    area: unsupportedUnit || (profile.kind !== 'built' && rangeChanged(current, RANGE.area) === false) ? defaultAreaRangeSqft(profile) : current,
    areaUnit: profile.unit,
  };
};

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
  const rel = (section) => sectionVisible(section, f.types);
  if (f.localities.size) p.loc = joinSet(f.localities);
  if (f.societies.size) p.soc = joinSet(f.societies);
  if (f.types.size) p.ptype = joinSet(f.types);
  if (f.types.has('commercial') && f.commercialTypes.size) p.ctype = joinSet(f.commercialTypes);
  if (f.bhk.size) p.bhks = joinSet(f.bhk);
  if (f.furnishing.size) p.furn = joinSet(f.furnishing);
  if (rel('facing') && f.facing.size) p.facing = joinSet(f.facing);
  if (rel('baths') && MIN_BATH_KEYS.has(f.minBaths)) p.minBaths = f.minBaths;
  if (f.amenities.size) p.amen = joinSet(f.amenities);
  if (rel('landUse') && f.landUse.size) p.landuse = joinSet(f.landUse);
  if (rel('shell') && f.shell.size) p.shell = joinSet(f.shell);
  if (rel('na') && f.na.size) p.na = joinSet(f.na);
  const vkeys = VERIF_KEYS.filter((k) => f.verified[k]);
  if (vkeys.length) p.v = vkeys.join(',');
  if (rangeChanged(f.age, RANGE.age)) p.age = `${f.age[0]}-${f.age[1]}`;
  if (rangeChanged(f.floor, RANGE.floor)) p.floor = `${f.floor[0]}-${f.floor[1]}`;
  const areaProfile = areaProfileForTypes(f.types, f.areaUnit);
  if (rel('area') && !isDefaultAreaRange(f.area, areaProfile)) {
    p.area = areaRangeToUrl(f.area, areaProfile);
    if (areaProfile.kind !== 'built') p.areaUnit = areaProfile.unit;
  }
  if (isRent) {
    if (f.room.size) p.room = joinSet(f.room);
    if (f.tenants.size) p.tenants = joinSet(f.tenants);
    if (f.availFrom) p.availfrom = f.availFrom;
    if (f.pets) p.pets = '1';
    if (f.food && rel('food')) p.food = f.food;
    if (rangeChanged(f.rent, RANGE.rent)) p.rent = `${f.rent[0]}-${f.rent[1]}`;
    if (rangeChanged(f.deposit, RANGE.deposit)) p.deposit = `${f.deposit[0]}-${f.deposit[1]}`;
  } else {
    if (f.constr.size) p.constr = joinSet(f.constr);
    if (f.preLeased && rel('preLeased')) p.preLeased = 'true';
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

  const bhkParam = get('bhks');
  const bhkKeys = splitCsv(bhkParam || get('bhk'))
    .flatMap((t) => expandBhkToken(t, deal, { source: bhkParam ? 'url' : 'legacy' }))
    .filter((key) => BHK_KEYS[deal].includes(key));
  if (bhkKeys.length) f.bhk = new Set(bhkKeys);

  if (get('furn')) f.furnishing = new Set(splitCsv(get('furn')));
  if (get('facing')) f.facing = new Set(splitCsv(get('facing')));
  if (MIN_BATH_KEYS.has(get('minBaths'))) f.minBaths = get('minBaths');
  if (get('amen')) f.amenities = new Set(splitCsv(get('amen')));
  if (get('landuse')) f.landUse = new Set(splitCsv(get('landuse')));
  if (get('na')) f.na = new Set(splitCsv(get('na')));
  if (get('shell')) f.shell = new Set(splitCsv(get('shell')));

  const vkeys = splitCsv(get('v')).filter((k) => VERIF_KEYS.includes(k));
  if (vkeys.length) f.verified = Object.fromEntries(vkeys.map((k) => [k, true]));

  f.age = parseRange(get('age'), RANGE.age);
  f.floor = parseRange(get('floor'), RANGE.floor);
  const areaUnit = get('areaUnit');
  const areaProfile = areaProfileForTypes(f.types, areaUnit);
  const areaDefault = defaultAreaRangeSqft(areaProfile);
  f.areaUnit = areaProfile.unit;
  f.area = areaUnit && areaProfile.unit !== areaUnit ? areaDefault : areaUnit ? parseAreaRange(get('area'), areaDefault, areaProfile.unit) : parseRange(get('area'), areaDefault);

  if (isRent) {
    if (get('room')) f.room = new Set(splitCsv(get('room')));
    if (get('tenants')) f.tenants = new Set(splitCsv(get('tenants')));
    if (get('availfrom')) f.availFrom = get('availfrom');
    if (get('pets') === '1') f.pets = true;
    f.food = normalizeFood(get('food'));
    f.rent = parseRange(get('rent'), RANGE.rent);
    f.deposit = parseRange(get('deposit'), RANGE.deposit);
  } else {
    const construction = validConstruction(splitCsv(get('constr')));
    const legacyAvail = legacyAvailToConstruction(get('avail'));
    if (construction.length || legacyAvail.length) f.constr = new Set(construction.length ? construction : legacyAvail);
    if (get('preLeased') === 'true') f.preLeased = true;
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

/* Deal switches keep compatible filters and drop only what the new journey cannot express. */
export function switchDealFilters(prev, deal) {
  const f = INITIAL(deal);
  const allowedTypes = new Set((deal === 'rent' ? RENT_TYPES : BUY_TYPES).map(([k]) => k));
  f.types = new Set([...prev.types].filter((k) => allowedTypes.has(k)));
  if (f.types.has('commercial')) f.commercialTypes = new Set(prev.commercialTypes);
  f.bhk = new Set([...prev.bhk].flatMap((tok) => expandBhkToken(tok, deal)).filter((key) => BHK_KEYS[deal].includes(key)));
  f.localities = new Set(prev.localities);
  f.societies = new Set(prev.societies);
  f.amenities = new Set(prev.amenities);
  f.furnishing = new Set(prev.furnishing);
  f.facing = new Set(prev.facing);
  f.minBaths = prev.minBaths;
  f.landUse = new Set(prev.landUse);
  f.shell = new Set(prev.shell);
  f.na = new Set(prev.na);
  f.verified = { ...prev.verified };
  f.locQuery = prev.locQuery;
  const prevAreaProfile = areaProfileForTypes(prev.types, prev.areaUnit);
  const nextAreaProfile = areaProfileForTypes(f.types, prev.areaUnit);
  if (prevAreaProfile.kind === nextAreaProfile.kind && !isDefaultAreaRange(prev.area, prevAreaProfile)) {
    f.area = [...prev.area];
    f.areaUnit = nextAreaProfile.unit;
  } else {
    f.area = defaultAreaRangeSqft(nextAreaProfile);
    f.areaUnit = nextAreaProfile.unit;
  }
  f.age = [...prev.age];
  f.floor = [...prev.floor];
  f.food = deal === 'rent' ? prev.food : '';
  f.preLeased = deal === 'buy' ? prev.preLeased : false;
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
