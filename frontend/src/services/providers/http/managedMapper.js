/* This mapper absorbs ManagedPropertyDto quirks once instead of at every call site. */
import { readUser } from '../../../lib/auth.js';

const fmtIndian = (n) => Number(n || 0).toLocaleString('en-IN');

/** ISO-8601 → epoch ms, because that is what the owner cards already sort on. Null stays null. */
const toMillis = (iso) => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

export const bhkLabel = (n) => {
  const num = Number(n) || 0;
  if (!num) return '';
  return num >= 5 ? '5+ BHK' : `${num} BHK`;
};

/** The catalogue only knows `buy` and `rent`; anything that is not `rent` is a sale, which keeps a future third
 * intent from silently rendering as a rental. */
export const toClientDeal = (deal) => (deal === 'rent' ? 'rent' : 'sale');

/** Owner-hub deal → wire deal. The inverse, and the one that stops a 422. */
export const toWireDeal = (deal) => (deal === 'rent' ? 'rent' : 'buy');

/** One managed record, wire → card. */
export function toManaged(dto) {
  if (!dto) return null;
  const u = readUser() || {};
  const deal = toClientDeal(dto.deal);
  const price = Number(dto.price) || 0;
  const bhkNum = Number(dto.bhk) || 0;
  const locality = dto.locality || '';

  return {
    id: dto.id,
    visibility: dto.visibility || 'private',
    status: dto.status || 'managed',
    title: dto.title || '',
    type: dto.propertyType || '',
    bhk: bhkLabel(bhkNum),
    bhkNum,
    locality,
    localitySlug: dto.localitySlug || '',
    society: dto.society || '',
    loc: [dto.society, locality, 'Pune'].filter(Boolean).join(', '),
    area: Number(dto.area) || 0,
    areaUnit: dto.areaUnit || 'sqft',
    furnishing: dto.furnishing || '',
    deal,
    price,
    priceStr: deal === 'rent' ? `₹${fmtIndian(price)}/mo` : `₹${fmtIndian(price)}`,
    img: null,
    image: null,
    gallery: [],
    // Never durable: the record belongs to the caller by construction — the server scopes every
    // read to the token — so the owner is whoever is holding it.
    owner: u.name || '',
    ownerMobile: u.mobile || '',
    rented: !!dto.rented,
    tenantName: dto.tenantName || '',
    monthlyRent: Number(dto.monthlyRent) || 0,
    dueDay: Number(dto.dueDay) || 5,
    valuation: dto.valuation || null,
    publishedListingId: dto.publishedListingId || '',
    createdAt: toMillis(dto.createdAt),
    updatedAt: toMillis(dto.updatedAt),
  };
}

/** A page (or bare array) of managed records, wire → cards. */
export const toManagedList = (rows) => (Array.isArray(rows) ? rows.map(toManaged).filter(Boolean) : []);

/** The Rent Panel must render and print these values rather than re-deriving them from the record it happens to be
 * holding, or last March's receipt silently reprints at this March's rent after a tenant change. */
export function toRentReceipt(dto) {
  if (!dto) return null;
  return {
    id: dto.id || '',
    ym: dto.rentMonth || '',
    amount: Number(dto.amount) || 0,
    tenantName: dto.tenantName || '',
    landlordName: dto.landlordName || '',
    propertyAddress: dto.propertyAddress || '',
    createdAt: toMillis(dto.createdAt),
  };
}

/** The receipt list, wire → panel rows. Newest month first; the server orders them. */
export const toRentReceiptList = (rows) =>
  (Array.isArray(rows) ? rows.map(toRentReceipt).filter(Boolean) : []);

/** Only the fields the server owns a column for survive; `visibility`, `status`, `owner` and `publishedListingId` are
 * refused by the contract on purpose. */
export function toCreateRequest(data = {}) {
  const deal = toWireDeal(data.deal);
  const price = Number(data.price) || 0;
  return {
    title: data.title || null,
    deal,
    propertyType: data.type || data.propertyType || 'Flat',
    bhk: data.bhk == null || data.bhk === '' ? null : Number(data.bhk) || null,
    price,
    locality: data.locality || 'Pune',
    localitySlug: data.localitySlug || undefined,
    societyId: data.societyId || null,
    area: data.area == null || data.area === '' ? null : Number(data.area) || null,
    areaUnit: data.areaUnit || null,
    furnishing: data.furnishing || null,
    rented: !!data.rented,
    tenantName: data.tenantName || null,
    // `deal === 'rent'` mirrors the browser store's rule: for a rental the price *is* the rent, and
    // the tracker should not start out disagreeing with the headline.
    monthlyRent: deal === 'rent' ? price : (Number(data.monthlyRent) || null),
    dueDay: data.dueDay == null ? null : Number(data.dueDay) || null,
    valuation: data.valuation || null,
  };
}

/** The update contract is all-nullable and the server treats null as "leave alone", so only keys the caller actually
 * passed are forwarded. */
export function toUpdateRequest(patch = {}) {
  const body = {};
  if ('deal' in patch) body.deal = toWireDeal(patch.deal);
  if ('type' in patch) body.propertyType = patch.type;
  if ('propertyType' in patch) body.propertyType = patch.propertyType;
  if ('title' in patch) body.title = patch.title;
  if ('bhk' in patch) body.bhk = Number(patch.bhk) || null;
  if ('price' in patch) body.price = Number(patch.price) || 0;
  if ('locality' in patch) body.locality = patch.locality;
  if ('localitySlug' in patch) body.localitySlug = patch.localitySlug;
  if ('societyId' in patch) body.societyId = patch.societyId;
  if ('area' in patch) body.area = Number(patch.area) || null;
  if ('areaUnit' in patch) body.areaUnit = patch.areaUnit;
  if ('furnishing' in patch) body.furnishing = patch.furnishing;
  if ('rented' in patch) body.rented = !!patch.rented;
  if ('tenantName' in patch) body.tenantName = patch.tenantName;
  if ('monthlyRent' in patch) body.monthlyRent = Number(patch.monthlyRent) || null;
  if ('dueDay' in patch) body.dueDay = Number(patch.dueDay) || null;
  if ('valuation' in patch) body.valuation = patch.valuation;
  return body;
}
