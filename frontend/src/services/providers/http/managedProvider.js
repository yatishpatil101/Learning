/**
 * HTTP managed-property provider — the live counterpart to `providers/mock/managedProvider.js`.
 *
 * Method names, argument order and return shapes mirror the mock exactly; `managedService.js` is
 * the only contract between them. Shape translation lives in `managedMapper.js`, which is where the
 * `sale`/`buy` and label/number disagreements are paid for.
 *
 * | Operation          | Endpoint                                    |
 * |--------------------|---------------------------------------------|
 * | list               | `GET /me/managed-properties`                |
 * | get one            | `GET /me/managed-properties/{id}`           |
 * | register           | `POST /me/managed-properties`               |
 * | update             | `PATCH /me/managed-properties/{id}`         |
 * | delete             | `DELETE /me/managed-properties/{id}`        |
 * | publish            | `POST /me/managed-properties/{id}/publish`  |
 * | adopt a listing    | `POST /me/managed-properties` + `publishedListingId` |
 * | rent receipts      | `GET|POST /me/managed-properties/{id}/rent-receipts` |
 *
 * Every route is scoped to the bearer token, so there is no owner argument anywhere: a record the
 * caller does not own is a 404, not a 403, and the client never has to decide who is asking.
 */
import { get, post, patch, del } from '../../http.js';
import {
  toManaged, toManagedList, toCreateRequest, toUpdateRequest, toRentReceiptList, toRentReceipt,
} from './managedMapper.js';

/** The caller's managed records, newest first (the server orders them). */
export async function listManaged() {
  const res = await get('/me/managed-properties');
  return toManagedList(res?.content ?? (Array.isArray(res) ? res : []));
}

/**
 * One record, or null when it is not the caller's.
 *
 * The mock returns null for a missing id and several callers branch on that rather than catching,
 * so a 404 is translated back into null here instead of surfacing as a throw the owner hub has no
 * handler for. Any other status still throws — a 500 is not "no such property".
 */
export async function getManaged(id) {
  try {
    return toManaged(await get(`/me/managed-properties/${encodeURIComponent(id)}`));
  } catch (e) {
    if (e?.status === 404) return null;
    throw e;
  }
}

/** Register a new private record. Resolves to the created record, as the mock does. */
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

/**
 * Record a month as received.
 *
 * Only the month crosses the wire. Amount, tenant, landlord and address are composed server-side
 * from the owned property, so a browser cannot mint a receipt for a rent that was never agreed —
 * which is exactly what the `localStorage` ledger this replaced allowed.
 *
 * A repeat month answers 409 and that is deliberately **not** swallowed here: the caller has a
 * second receipt on screen that it should not have, and the honest response is to re-read rather
 * than to pretend the write happened.
 */
export async function recordRentReceipt(id, rentMonth) {
  // The list mapper drops unmappable rows; this one cannot, because its single row *is* the answer
  // and the panel unshifts it straight into the ledger. An empty body would land there as `null`
  // and read back as a month with no `ym` — a settled month rendered as outstanding. Fail loudly
  // instead: the panel already has a branch for "that didn't work".
  const receipt = toRentReceipt(await post(receiptsPath(id), { rentMonth }));
  if (!receipt) throw new Error('the server accepted the receipt but returned nothing to show');
  return receipt;
}

/**
 * Publish into the ordinary pending-review flow.
 *
 * The server is idempotent — a record already carrying a `publishedListingId` comes back unchanged
 * with no second listing spawned — but it says so only by returning the same record, with no
 * `already` marker on the wire. The mock's callers branch on `already` to decide between "submitted
 * for review" and "already published", so the flag is reconstructed here from what the record
 * looked like before the call. That read is the reason this is not a one-liner.
 */
export async function publishManaged(id) {
  const before = await getManaged(id);
  const already = !!before?.publishedListingId;
  const after = toManaged(await post(`/me/managed-properties/${encodeURIComponent(id)}/publish`, {}));
  return { id: after?.publishedListingId || '', already, record: after };
}

/**
 * Attach a managed record to a listing the caller already owns, so the owner hub can show it a
 * passport, a vault and a rent tracker.
 *
 * Deduped by the caller against the list it has already loaded (D32 decision C) — this is only
 * reached when no record claims the listing. The server checks again and answers 409 if one does,
 * which is the race, not the common path; the caller treats that as "somebody else already made
 * it" and re-reads.
 */
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
    society: listing.society,
    area: listing.area,
    areaUnit: listing.areaUnit,
    furnishing: listing.furnishing,
  });
  body.publishedListingId = listing.id;
  try {
    return toManaged(await post('/me/managed-properties', body));
  } catch (e) {
    // 409 means a record already exists for this listing — a lost race, not a failure the owner
    // needs to see. 404 means the listing is not theirs, which the caller's ownership gate should
    // already have prevented; either way the card simply renders without the tools.
    if (e?.status === 409 || e?.status === 404) return null;
    throw e;
  }
}
