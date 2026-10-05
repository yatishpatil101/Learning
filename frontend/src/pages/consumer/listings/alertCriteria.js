import { fmtINR } from '../../../lib/format.js';
import { fmtRent } from './format.js';
import { BUY_TYPES, RENT_TYPES, COMMERCIAL_TYPES } from '../../../data/propertyTypes.js';
import { BHK_BUY, BHK_RENT, FURN_LBL, AMEN_LBL } from './constants.js';

const TYPE_LBL = Object.fromEntries([...BUY_TYPES, ...RENT_TYPES]);
const COMM_LBL = Object.fromEntries(COMMERCIAL_TYPES);

// Default range bounds (mirroring INITIAL() in Listings.jsx), so an "any price" range can be told
// apart from a real one and not shown as a noise chip.
const BUY_MAX = 50000000;
const RENT_MAX = 100000;

const asArr = (s) => (s instanceof Set ? [...s] : Array.isArray(s) ? s : []);
const cap = (s) => String(s || '').replace(/\b\w/g, (c) => c.toUpperCase()).replace(/-/g, ' ');

const bhkLabel = (deal, k) => {
  const arr = deal === 'rent' ? BHK_RENT : BHK_BUY;
  return (arr.find(([x]) => x === k) || [null, `${k} BHK`])[1];
};

const typeLabel = (k) => TYPE_LBL[k] || cap(k);

function priceChipText(deal, budget, rent) {
  if (deal === 'buy') {
    const [lo, hi] = Array.isArray(budget) ? budget : [0, BUY_MAX];
    if (lo <= 0 && hi >= BUY_MAX) return null;
    return `${fmtINR(lo)} – ${fmtINR(hi)}${hi >= BUY_MAX ? '+' : ''}`;
  }
  const [lo, hi] = Array.isArray(rent) ? rent : [0, RENT_MAX];
  if (lo <= 0 && hi >= RENT_MAX) return null;
  return `${fmtRent(lo)} – ${fmtRent(hi)}${hi >= RENT_MAX ? '+' : ''}/mo`;
}

export function alertLabel(rec, locNameBySlug = {}) {
  const types = asArr(rec.types);
  const bhk = asArr(rec.bhk);
  const localities = asArr(rec.localities);
  const parts = [];
  if (types.length) parts.push(types.map(typeLabel).join('/'));
  if (bhk.length) parts.push(bhk.map((k) => bhkLabel(rec.deal, k)).join('/'));
  parts.push(rec.deal === 'rent' ? 'Rent' : 'Buy');
  if (localities.length) parts.push(localities.map((s) => locNameBySlug[s] || cap(s)).join(', '));
  return parts.filter(Boolean).join(' · ') || `All ${rec.deal === 'rent' ? 'rentals' : 'homes'}`;
}

export function buildAlertRecord(f, locNameBySlug = {}) {
  const rec = {
    deal: f.deal,
    types: asArr(f.types),
    commercialTypes: asArr(f.commercialTypes),
    bhk: asArr(f.bhk),
    furnishing: asArr(f.furnishing),
    amenities: asArr(f.amenities),
    localities: asArr(f.localities),
    budget: Array.isArray(f.budget) ? f.budget : undefined,
    rent: Array.isArray(f.rent) ? f.rent : undefined,
    pets: !!f.pets,
  };
  rec.label = alertLabel(rec, locNameBySlug);
  return rec;
}

export function criteriaChips(rec, locNameBySlug = {}) {
  const deal = rec.deal;
  const chips = [{ icon: deal === 'rent' ? 'key-round' : 'home', text: deal === 'rent' ? 'For Rent' : 'For Sale' }];

  asArr(rec.types).forEach((k) => chips.push({ icon: 'building-2', text: typeLabel(k) }));
  asArr(rec.commercialTypes).forEach((k) => chips.push({ icon: 'briefcase', text: COMM_LBL[k] || cap(k) }));
  asArr(rec.bhk).forEach((k) => chips.push({ icon: 'bed-double', text: bhkLabel(deal, k) }));

  const price = priceChipText(deal, rec.budget, rec.rent);
  if (price) chips.push({ icon: 'wallet', text: price });

  asArr(rec.localities).forEach((s) => chips.push({ icon: 'map-pin', text: locNameBySlug[s] || cap(s) }));
  asArr(rec.furnishing).forEach((k) => chips.push({ icon: 'sofa', text: FURN_LBL[k] || cap(k) }));
  asArr(rec.amenities).forEach((k) => chips.push({ icon: 'sparkles', text: AMEN_LBL[k] || cap(k) }));
  if (rec.pets) chips.push({ icon: 'paw-print', text: 'Pet-friendly' });

  return chips;
}

export function countMatches(rec, props = []) {
  const locs = asArr(rec.localities).map((s) => String(s).toLowerCase());
  const bhks = asArr(rec.bhk).map(String);
  const types = asArr(rec.types).map((s) => String(s).toLowerCase());
  const furnishings = asArr(rec.furnishing).map((s) => String(s).toLowerCase());
  const amenities = asArr(rec.amenities).map((s) => String(s).toLowerCase());
  const [lo, hi] = rec.deal === 'rent'
    ? (Array.isArray(rec.rent) ? rec.rent : [0, RENT_MAX])
    : (Array.isArray(rec.budget) ? rec.budget : [0, BUY_MAX]);
  const wantsRent = rec.deal === 'rent';
  return props.filter((p) => {
    if (wantsRent ? p.deal !== 'rent' : p.deal === 'rent') return false;
    if (p.price < lo || p.price > hi) return false;
    if (locs.length) {
      const slug = String(p.localitySlug || '').toLowerCase();
      const name = String(p.locality || '').toLowerCase();
      if (!locs.includes(slug) && !locs.includes(name)) return false;
    }
    if (types.length && !types.includes(String(p.type || '').toLowerCase())) return false;
    if (bhks.length && !bhks.some((b) => b.endsWith('plus') ? Number(p.bhkNum) >= Number(b.replace('plus', '')) : b === String(p.bhkNum))) return false;
    if (furnishings.length && !furnishings.includes(String(p.furnishing || '').toLowerCase())) return false;
    if (amenities.length) {
      const listingAmenities = asArr(p.amenities).map((s) => String(s).toLowerCase());
      if (!amenities.every((a) => listingAmenities.includes(a))) return false;
    }
    if (rec.pets && p.pets !== true) return false;
    return true;
  }).length;
}

export function searchHref(rec) {
  const params = new URLSearchParams();
  params.set('deal', rec.deal === 'rent' ? 'rent' : 'buy');
  const loc = asArr(rec.localities)[0];
  if (loc) params.set('q', String(loc).toLowerCase());
  return '/listings?' + params.toString();
}
