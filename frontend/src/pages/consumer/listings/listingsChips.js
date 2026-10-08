import { fmtINR } from '../../../lib/format.js';
import { fmtRent, fmtAreaSqft } from './format.js';
import {
  BUY_TYPES,
  RENT_TYPES,
  BHK_BUY,
  BHK_RENT,
  TENANTS,
  ROOM_TYPES,
  AVAIL_FROM,
  CONSTR_STATUS,
  AMEN_LBL,
  FURN_LBL,
  LANDUSE_LBL,
} from './constants.js';
import { FACING, BATHS, SHELL, NA_STATUS, FOOD } from './filtersPanel/facetOptions.js';
import { COMMERCIAL_TYPES } from '../../../data/propertyTypes.js';
import { sectionVisible, VERIF_SECTIONS } from '../../../lib/listings/filterRelevance.js';
import { areaProfileForTypes, defaultAreaRangeSqft, formatAreaRange, isDefaultAreaRange } from '../../../lib/listings/areaUnits.js';

// Removable "active filter" chips, each carrying a `remove()` that unsets exactly its own filter.
// Pure over `(f, helpers)`, so the same filter state always produces the same chips.
export function buildActiveChips(f, { tr, locNameBySlug, socNameBySlug, setF, set, freeText, clearFreeText }) {
  const rent = f.deal === 'rent';
  const relc = (s) => sectionVisible(s, f.types);
  const TYPE_LBL = Object.fromEntries(rent ? RENT_TYPES : BUY_TYPES);
  const BHK_LBL = Object.fromEntries(rent ? BHK_RENT : BHK_BUY);
  const TENANT_LBL = Object.fromEntries(TENANTS);
  const ROOM_LBL = Object.fromEntries(ROOM_TYPES);
  const AVAILF_LBL = Object.fromEntries(AVAIL_FROM);
  const VERIF_LBL = { owner: tr('listings.verifOwner'), ownership: tr('property.ownershipVerified'), rera: tr('listings.verifRera') };
  const CTYPE_LBL = Object.fromEntries(COMMERCIAL_TYPES);
  const FACING_LBL = Object.fromEntries(FACING.map(([v, key]) => [v, tr(key)]));
  const BATHS_LBL = Object.fromEntries(BATHS.map(([v, key]) => [v, tr(key)]));
  const SHELL_LBL = Object.fromEntries(SHELL.map(([v, key]) => [v, tr(key)]));
  const NA_STATUS_LBL = Object.fromEntries(NA_STATUS.map(([v, key]) => [v, tr(key)]));
  const delFrom = (key, v) => setF((prev) => { const s = new Set(prev[key]); s.delete(v); return { ...prev, [key]: s }; });
  const delType = (v) => setF((prev) => {
    const types = new Set(prev.types);
    types.delete(v);
    const nextProfile = areaProfileForTypes(types, prev.areaUnit);
    const next = { ...prev, types, area: defaultAreaRangeSqft(nextProfile), areaUnit: nextProfile.unit };
    if (!types.has('commercial')) next.commercialTypes = new Set();
    return next;
  });
  const setVerif = (k) => setF((prev) => ({ ...prev, verified: { ...prev.verified, [k]: false } }));
  const chips = [];
  /* First, because it is the coarsest cut. */
  if (freeText) chips.push({ id: 'q', label: tr('listings.chipFreeText', { text: freeText }), remove: clearFreeText });
  [...f.types].forEach((v) => chips.push({ id: 'type-' + v, label: TYPE_LBL[v] || v, remove: () => delType(v) }));
  if (f.types.has('commercial')) [...f.commercialTypes].forEach((v) => chips.push({ id: 'ctype-' + v, label: CTYPE_LBL[v] || v, remove: () => delFrom('commercialTypes', v) }));
  if (relc('landUse')) [...f.landUse].forEach((v) => chips.push({ id: 'landuse-' + v, label: LANDUSE_LBL[v] || v, remove: () => delFrom('landUse', v) }));
  if (relc('na')) [...f.na].forEach((v) => chips.push({ id: 'na-' + v, label: NA_STATUS_LBL[v] || v, remove: () => delFrom('na', v) }));
  if (relc('bhk')) [...f.bhk].forEach((v) => chips.push({ id: 'bhk-' + v, label: BHK_LBL[v] || v, remove: () => delFrom('bhk', v) }));
  if (relc('facing')) [...f.facing].forEach((v) => chips.push({ id: 'facing-' + v, label: FACING_LBL[v] || v, remove: () => delFrom('facing', v) }));
  if (relc('baths') && f.minBaths) chips.push({ id: 'baths', label: BATHS_LBL[f.minBaths] || f.minBaths, remove: () => set({ minBaths: '' }) });
  [...f.localities].forEach((v) => chips.push({ id: 'loc-' + v, label: locNameBySlug[v] || v, remove: () => delFrom('localities', v) }));
  [...f.societies].forEach((v) => chips.push({ id: 'soc-' + v, label: socNameBySlug[v] || v, remove: () => delFrom('societies', v) }));
  if (relc('furnishing')) [...f.furnishing].forEach((v) => chips.push({ id: 'furn-' + v, label: FURN_LBL[v] || v, remove: () => delFrom('furnishing', v) }));
  if (relc('shell')) [...f.shell].forEach((v) => chips.push({ id: 'shell-' + v, label: SHELL_LBL[v] || v, remove: () => delFrom('shell', v) }));
  if (relc('amenities')) [...f.amenities].forEach((v) => chips.push({ id: 'amen-' + v, label: AMEN_LBL[v] || v, remove: () => delFrom('amenities', v) }));
  Object.keys(f.verified).forEach((k) => { if (f.verified[k] && (!VERIF_SECTIONS[k] || relc(VERIF_SECTIONS[k]))) chips.push({ id: 'v-' + k, label: VERIF_LBL[k] || k, remove: () => setVerif(k) }); });
  if (f.near) {
    chips.push({ id: 'near', label: tr('listings.chipNear', { label: f.nearLabel || tr('listings.place'), radius: f.nearRadius, unit: f.nearMode === 'km' ? tr('listings.unitKm') : tr('listings.unitMin') }), remove: () => set({ near: '', nearLabel: '', nearRadius: 5 }) });
  }
  const areaProfile = areaProfileForTypes(f.types, f.areaUnit);
  if (!isDefaultAreaRange(f.area, areaProfile) && relc('area')) chips.push({ id: 'area', label: areaProfile.kind === 'built' ? fmtAreaSqft(f.area[0]) + ' – ' + fmtAreaSqft(f.area[1]) : formatAreaRange(f.area, areaProfile), remove: () => set({ area: defaultAreaRangeSqft(areaProfile), areaUnit: areaProfile.unit }) });
  if (rent) {
    if (relc('tenants')) [...f.tenants].forEach((v) => chips.push({ id: 'ten-' + v, label: TENANT_LBL[v] || v, remove: () => delFrom('tenants', v) }));
    if (relc('room')) [...f.room].forEach((v) => chips.push({ id: 'room-' + v, label: ROOM_LBL[v] || v, remove: () => delFrom('room', v) }));
    if (f.availFrom && relc('availFrom')) chips.push({ id: 'availf-' + f.availFrom, label: AVAILF_LBL[f.availFrom] || f.availFrom, remove: () => set({ availFrom: '' }) });
    if (f.pets && relc('amenities')) chips.push({ id: 'pets', label: tr('listings.petFriendly'), remove: () => set({ pets: false }) });
    if (f.food && relc('food')) chips.push({ id: 'food', label: tr((FOOD.find(([v]) => v === f.food) || [])[1] || 'listings.nonVegOk'), remove: () => set({ food: '' }) });
    if (f.rent[0] !== 0 || f.rent[1] !== 100000) chips.push({ id: 'rent', label: fmtRent(f.rent[0]) + ' – ' + fmtRent(f.rent[1]), remove: () => set({ rent: [0, 100000] }) });
    if (f.deposit[0] !== 0 || f.deposit[1] !== 1000000) chips.push({ id: 'deposit', label: tr('listings.chipDeposit', { from: fmtRent(f.deposit[0]), to: fmtRent(f.deposit[1]) }), remove: () => set({ deposit: [0, 1000000] }) });
    if ((f.age[0] !== 0 || f.age[1] !== 25) && relc('age')) chips.push({ id: 'age', label: tr('listings.chipAge', { from: f.age[0], to: f.age[1] }), remove: () => set({ age: [0, 25] }) });
    if ((f.floor[0] !== 0 || f.floor[1] !== 40) && relc('floor')) chips.push({ id: 'floor', label: tr('listings.chipFloor', { from: f.floor[0], to: f.floor[1] }), remove: () => set({ floor: [0, 40] }) });
  } else {
    if (relc('construction')) [...f.constr].forEach((v) => {
      const lbl = CONSTR_STATUS.find(([k]) => k === v);
      if (lbl) chips.push({ id: 'constr-' + v, label: lbl[1], remove: () => delFrom('constr', v) });
    });
    if (f.preLeased && relc('preLeased')) chips.push({ id: 'preLeased', label: tr('listings.preLeased'), remove: () => set({ preLeased: false }) });
    if (f.budget[0] !== 0 || f.budget[1] !== 50000000) chips.push({ id: 'budget', label: fmtINR(f.budget[0]) + ' – ' + fmtINR(f.budget[1]), remove: () => set({ budget: [0, 50000000] }) });
    if ((f.age[0] !== 0 || f.age[1] !== 25) && relc('age')) chips.push({ id: 'age', label: tr('listings.chipAge', { from: f.age[0], to: f.age[1] }), remove: () => set({ age: [0, 25] }) });
    if ((f.floor[0] !== 0 || f.floor[1] !== 40) && relc('floor')) chips.push({ id: 'floor', label: tr('listings.chipFloor', { from: f.floor[0], to: f.floor[1] }), remove: () => set({ floor: [0, 40] }) });
  }
  return chips;
}
