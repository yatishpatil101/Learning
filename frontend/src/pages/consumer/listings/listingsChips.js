import { fmtINR } from '../../../lib/format.js';
import { fmtRent, fmtArea } from './format.js';
import {
  BUY_TYPES,
  RENT_TYPES,
  BHK_BUY,
  BHK_RENT,
  TENANTS,
  ROOM_TYPES,
  PG_SHARING,
  AVAIL_FROM,
  AVAIL_BUY,
  CONSTR_STATUS,
  AMEN_LBL,
  FURN_LBL,
  LANDUSE_LBL,
} from './constants.js';
import { COMMERCIAL_TYPES } from '../../../data/propertyTypes.js';
import { sectionVisible, VERIF_SECTIONS } from '../../../lib/listings/filterRelevance.js';

// Build the removable "active filter" chips shown above the results. Each chip carries a
// label plus a remove() that unsets exactly that filter. Pure over (f, helpers): the same
// filter state + label maps produce the same chip list.
export function buildActiveChips(f, { tr, locNameBySlug, socNameBySlug, setF, set }) {
  const rent = f.deal === 'rent';
  const relc = (s) => sectionVisible(s, f.types); // don't show chips for filters hidden by relevance
  const TYPE_LBL = Object.fromEntries(rent ? RENT_TYPES : BUY_TYPES);
  const BHK_LBL = Object.fromEntries(rent ? BHK_RENT : BHK_BUY);
  const TENANT_LBL = Object.fromEntries(TENANTS);
  const ROOM_LBL = Object.fromEntries(ROOM_TYPES);
  const SHARING_LBL = Object.fromEntries(PG_SHARING);
  const AVAILB_LBL = Object.fromEntries(AVAIL_BUY);
  const AVAILF_LBL = Object.fromEntries(AVAIL_FROM);
  const VERIF_LBL = { owner: tr('listings.verifOwner'), ownership: tr('listings.verifOwnership'), rera: tr('listings.verifRera'), society: tr('listings.verifSociety'), conveyance: tr('listings.verifConveyance') };
  const CTYPE_LBL = Object.fromEntries(COMMERCIAL_TYPES);
  const delFrom = (key, v) => setF((prev) => { const s = new Set(prev[key]); s.delete(v); return { ...prev, [key]: s }; });
  const setVerif = (k) => setF((prev) => ({ ...prev, verified: { ...prev.verified, [k]: false } }));
  const chips = [];
  [...f.types].forEach((v) => chips.push({ id: 'type-' + v, label: TYPE_LBL[v] || v, remove: () => delFrom('types', v) }));
  if (f.types.has('commercial')) [...f.commercialTypes].forEach((v) => chips.push({ id: 'ctype-' + v, label: CTYPE_LBL[v] || v, remove: () => delFrom('commercialTypes', v) }));
  if (relc('landUse')) [...f.landUse].forEach((v) => chips.push({ id: 'landuse-' + v, label: LANDUSE_LBL[v] || v, remove: () => delFrom('landUse', v) }));
  if (relc('bhk')) [...f.bhk].forEach((v) => chips.push({ id: 'bhk-' + v, label: BHK_LBL[v] || v, remove: () => delFrom('bhk', v) }));
  // Sharing (PG occupancy) applies on both deals, so its chip lives outside the
  // rent-only block — a PG building can be rented per bed or sold outright.
  if (relc('sharing')) [...f.sharing].forEach((v) => chips.push({ id: 'sharing-' + v, label: SHARING_LBL[v] || v, remove: () => delFrom('sharing', v) }));
  [...f.localities].forEach((v) => chips.push({ id: 'loc-' + v, label: locNameBySlug[v] || v, remove: () => delFrom('localities', v) }));
  [...f.societies].forEach((v) => chips.push({ id: 'soc-' + v, label: socNameBySlug[v] || v, remove: () => delFrom('societies', v) }));
  if (relc('furnishing')) [...f.furnishing].forEach((v) => chips.push({ id: 'furn-' + v, label: FURN_LBL[v] || v, remove: () => delFrom('furnishing', v) }));
  if (relc('amenities')) [...f.amenities].forEach((v) => chips.push({ id: 'amen-' + v, label: AMEN_LBL[v] || v, remove: () => delFrom('amenities', v) }));
  Object.keys(f.verified).forEach((k) => { if (f.verified[k] && (!VERIF_SECTIONS[k] || relc(VERIF_SECTIONS[k]))) chips.push({ id: 'v-' + k, label: VERIF_LBL[k] || k, remove: () => setVerif(k) }); });
  if (f.near) {
    chips.push({ id: 'near', label: tr('listings.chipNear', { label: f.nearLabel || tr('listings.place'), radius: f.nearRadius, unit: f.nearMode === 'km' ? tr('listings.unitKm') : tr('listings.unitMin') }), remove: () => set({ near: '', nearLabel: '', nearRadius: 5 }) });
  }
  if (rent) {
    if (relc('tenants')) [...f.tenants].forEach((v) => chips.push({ id: 'ten-' + v, label: TENANT_LBL[v] || v, remove: () => delFrom('tenants', v) }));
    if (relc('room')) [...f.room].forEach((v) => chips.push({ id: 'room-' + v, label: ROOM_LBL[v] || v, remove: () => delFrom('room', v) }));
    if (f.availFrom && relc('availFrom')) chips.push({ id: 'availf-' + f.availFrom, label: AVAILF_LBL[f.availFrom] || f.availFrom, remove: () => set({ availFrom: '' }) });
    if (f.pets && relc('amenities')) chips.push({ id: 'pets', label: tr('listings.petFriendly'), remove: () => set({ pets: false }) });
    if (f.rent[0] !== 0 || f.rent[1] !== 100000) chips.push({ id: 'rent', label: fmtRent(f.rent[0]) + ' – ' + fmtRent(f.rent[1]), remove: () => set({ rent: [0, 100000] }) });
    if ((f.age[0] !== 0 || f.age[1] !== 25) && relc('age')) chips.push({ id: 'age', label: tr('listings.chipAge', { from: f.age[0], to: f.age[1] }), remove: () => set({ age: [0, 25] }) });
    if ((f.floor[0] !== 0 || f.floor[1] !== 40) && relc('floor')) chips.push({ id: 'floor', label: tr('listings.chipFloor', { from: f.floor[0], to: f.floor[1] }), remove: () => set({ floor: [0, 40] }) });
  } else {
    if (f.avail && relc('availability')) chips.push({ id: 'avail-' + f.avail, label: AVAILB_LBL[f.avail] || f.avail, remove: () => set({ avail: '' }) });
    if (relc('construction')) [...f.constr].forEach((v) => {
      const lbl = CONSTR_STATUS.find(([k]) => k === v);
      if (lbl) chips.push({ id: 'constr-' + v, label: lbl[1], remove: () => delFrom('constr', v) });
    });
    if (f.budget[0] !== 0 || f.budget[1] !== 50000000) chips.push({ id: 'budget', label: fmtINR(f.budget[0]) + ' – ' + fmtINR(f.budget[1]), remove: () => set({ budget: [0, 50000000] }) });
    if (f.area[0] !== 0 || f.area[1] !== 6000) chips.push({ id: 'area', label: fmtArea(f.area[0]) + ' – ' + fmtArea(f.area[1]), remove: () => set({ area: [0, 6000] }) });
    if ((f.age[0] !== 0 || f.age[1] !== 25) && relc('age')) chips.push({ id: 'age', label: tr('listings.chipAge', { from: f.age[0], to: f.age[1] }), remove: () => set({ age: [0, 25] }) });
    if ((f.floor[0] !== 0 || f.floor[1] !== 40) && relc('floor')) chips.push({ id: 'floor', label: tr('listings.chipFloor', { from: f.floor[0], to: f.floor[1] }), remove: () => set({ floor: [0, 40] }) });
  }
  return chips;
}
