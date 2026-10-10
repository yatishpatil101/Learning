/** Routes are scoped to the bearer token, so there is no owner argument; a record not yours is a 404. */
import { PAGE_LOAD_TTL, get, post, patch, del } from '../../http.js';
import {
  toManaged, toManagedList, toCreateRequest, toUpdateRequest, toRentReceiptList, toRentReceipt,
} from './managedMapper.js';

/** The caller's managed records, newest first (the server orders them). */
export async function listManaged() {
  const res = await get('/me/managed-properties', undefined, { ttl: PAGE_LOAD_TTL });
  return toManagedList(res?.content ?? (Array.isArray(res) ? res : []));
}

/** Returns null on 404 because callers branch on null; any other status still throws. */
export async function getManaged(id) {
  try {
    return toManaged(await get(`/me/managed-properties/${encodeURIComponent(id)}`));
  } catch (e) {
    if (e?.status === 404) return null;
    throw e;
  }
}

/** Register a new private record. */
export async function registerManaged(data) {
  return toManaged(await post('/me/managed-properties', toCreateRequest(data)));
}

/** Partial update. Only keys present on `patch` are sent — see `toUpdateRequest`. */
export async function updateManaged(id, changes) {
  return toManaged(await patch(`/me/managed-properties/${encodeURIComponent(id)}`, toUpdateRequest(changes)));
}

/** Hard delete. The listing it may have spawned is untouched, server-side and here. */
export async function deleteManaged(id) {
  await del(`/me/managed-properties/${encodeURIComponent(id)}`);
}

const receiptsPath = (id) => `/me/managed-properties/${encodeURIComponent(id)}/rent-receipts`;

/** The months already recorded on this property, newest first. Server-ordered, server-windowed. */
export async function listRentReceipts(id, months = 6) {
  return toRentReceiptList(await get(receiptsPath(id), { months }));
}

/** Only the month is sent; amounts and parties are composed server-side so a browser can't mint a receipt.
 * A repeat month's 409 is not swallowed: the caller must re-read. */
export async function recordRentReceipt(id, rentMonth) {
  // Fail loudly on an empty body: a null row would render a settled month as outstanding in the ledger.
  const receipt = toRentReceipt(await post(receiptsPath(id), { rentMonth }));
  if (!receipt) throw new Error('the server accepted the receipt but returned nothing to show');
  return receipt;
}

/** The server sends no `already` marker on an idempotent publish, so the caller says whether the record it holds was
 * already published. */
export async function publishManaged(id, { published = false } = {}) {
  const after = toManaged(await post(`/me/managed-properties/${encodeURIComponent(id)}/publish`, {}));
  return { id: after?.publishedListingId || '', already: published, record: after };
}

/** Deduped by the caller beforehand; the server's 409 is only the race, which the caller handles by re-reading. */
export async function ensureManagedForListing(listing) {
  if (!listing || !listing.id) return null;
  if (listing.flatmate || listing.flatmatePost || listing.flatmateGroup) return null;
  const body = toCreateRequest({
    title: listing.title,
    deal: listing.deal === 'buy' || listing.deal === 'sale' ? 'sale' : 'rent',
    type: listing.type,
    bhk: listing.bhkNum || listing.bhk,
    price: listing.price,
    locality: listing.locality,
    localitySlug: listing.localitySlug,
    societyId: listing.societyId,
    area: listing.area,
    areaUnit: listing.areaUnit,
    furnishing: listing.furnishing,
  });
  body.publishedListingId = listing.id;
  try {
    return toManaged(await post('/me/managed-properties', body));
  } catch (e) {
    // 409 is a lost race and 404 an unowned listing; either way the card renders without the tools.
    if (e?.status === 409 || e?.status === 404) return null;
    throw e;
  }
}
