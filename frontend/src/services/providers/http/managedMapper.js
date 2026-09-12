/**
 * Managed-property shape translation — wire ⇄ owner-hub card.
 *
 * The two shapes were written years apart by people solving different problems, and this is where
 * the disagreement is paid for once instead of at every call site. `ManagedPropertyDto` is the
 * *source data*: the facts an owner typed in. The browser store was written to render, so it also
 * carries a formatted price, a composed "society, locality, Pune" line, a gallery, a BHK label and
 * the owner's own name and mobile — none of which the server keeps, because none of them are facts
 * about the property.
 *
 * Four of those translations are load-bearing rather than cosmetic:
 *
 * 1. **`deal`.** The catalogue says `buy`; the owner hub has always said `sale`, and it says it in
 *    conditionals, not just in copy. Sending `sale` to the server is a hard 422 on every sale
 *    record, so the swap happens here, in both directions, and nowhere else.
 * 2. **`bhk`.** The server keeps one number. The browser kept a number *and* the label rendered
 *    from it, which could disagree. The label is derived on read, so it cannot.
 * 3. **Timestamps.** The store wrote `Date.now()`; the wire is ISO-8601. Anything that sorts or
 *    compares these needs one representation, and epoch ms is the one the existing cards sort on.
 * 4. **`monthlyRent` and `publishedListingId`.** The store used `0` and `''` for "not set"; the
 *    server uses null. `0` is a legitimate rent to *store* and a falsy value to *test*, so the
 *    round trip normalises to the store's convention on read and back to null on write.
 *
 * Presentation-only fields the server has no column for (`img`, `gallery`, `owner`, `ownerMobile`)
 * are synthesized on read from the placeholder gallery and the signed-in user. They were never
 * durable data — a second device would have produced different values from the same record.
 */
import { readUser } from '../../../lib/auth.js';

/** Same three placeholders the browser store minted, kept so a ported card looks unchanged. */
const PLACEHOLDER_GALLERY = [
  'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70',
  'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=70',
  'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?auto=format&fit=crop&w=800&q=70',
];

const fmtIndian = (n) => Number(n || 0).toLocaleString('en-IN');

/** ISO-8601 → epoch ms, because that is what the owner cards already sort on. Null stays null. */
const toMillis = (iso) => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

/** `4+ BHK` above three, `2 BHK` below, empty when the owner never said. */
export const bhkLabel = (n) => {
  const num = Number(n) || 0;
  if (!num) return '';
  return num >= 4 ? '4+ BHK' : `${num} BHK`;
};

/**
 * Wire deal → owner-hub deal. The catalogue only knows `buy` and `rent`; anything that is not
 * `rent` is a sale, which keeps a future third intent from silently rendering as a rental.
 */
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
  const img = PLACEHOLDER_GALLERY[0];

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
    img,
    image: img,
    gallery: PLACEHOLDER_GALLERY,
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

/**
 * A manual rent receipt, wire → panel row.
 *
 * Every figure on it is the server's snapshot of the property at the moment the owner recorded the
 * month — not the property as it is now. The Rent Panel must render and print these values rather
 * than re-deriving them from the record it happens to be holding, or last March's receipt silently
 * reprints at this March's rent after a tenant change.
 *
 * `id` is the durable receipt reference. It replaced a `'RCPT' + Date.now()` minted at print time,
 * which meant the same month produced a different reference on every download and on every device.
 */
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

/**
 * Card → create request.
 *
 * Only the fields the server owns a column for survive; `visibility`, `status`, `owner` and
 * `publishedListingId` are refused by the contract on purpose — they are server-decided, and
 * sending them would be asking to be overruled.
 */
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
    society: data.society || null,
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

/**
 * Card patch → update request.
 *
 * The update contract is all-nullable and the server treats null as "leave alone", so only keys the
 * caller actually passed are forwarded. Spreading the whole card here would blank every field the
 * caller did not mean to touch.
 */
export function toUpdateRequest(patch = {}) {
  const body = {};
  if ('deal' in patch) body.deal = toWireDeal(patch.deal);
  if ('type' in patch) body.propertyType = patch.type;
  if ('propertyType' in patch) body.propertyType = patch.propertyType;
  if ('title' in patch) body.title = patch.title;
  if ('bhk' in patch) body.bhk = Number(patch.bhk) || null;
  if ('price' in patch) body.price = Number(patch.price) || 0;
  if ('locality' in patch) body.locality = patch.locality;
  if ('society' in patch) body.society = patch.society;
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
