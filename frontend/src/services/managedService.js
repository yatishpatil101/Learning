/** Callers say `sale` for the deal while the wire says `buy`; `providers/http/managedMapper.js` swaps them.
 * A record belonging to someone else answers 404, not 403, so its existence is never confirmed. */
import { createProvider } from './config.js';

const provider = createProvider('managed');

export const listManaged = async () => (await provider()).listManaged();

/** One record, or `null` when missing or not the caller's: owner surfaces render an empty state, not an error. */
export const getManaged = async (id) => (await provider()).getManaged(id);

/** Only facts are sent: `visibility`, `status` and `publishedListingId` are server-decided, refused on create. */
export const registerManaged = async (data) => (await provider()).registerManaged(data);

/** Partial update: only keys present on `changes` are sent, so it cannot blank a field the caller omitted. */
export const updateManaged = async (id, changes) => (await provider()).updateManaged(id, changes);

/** The listing a record spawned is untouched: unpublishing is a separate act,
 * and deleting the private file must not withdraw a live advert. */
export const deleteManaged = async (id) => (await provider()).deleteManaged(id);

/** Idempotent: a record that already has a listing does not spawn a second. Rejects when the record cannot become
 * a listing (the server re-runs its validation), so callers must have an error branch. */
export const publishManaged = async (id, known) => (await provider()).publishManaged(id, known);

/** Callers must dedup against the list they hold first: this is not free, and calling it per render is a bug.
 * Resolves to `null` when the listing is not eligible (a flatmate post) or a record already exists. */
export const ensureManagedForListing = async (listing) =>
  (await provider()).ensureManagedForListing(listing);

/** Receipt figures are a snapshot taken when the month was recorded: print them, never re-derive from the current
 * record, or last March's receipt reprints at this March's rent. `id` is the durable PDF reference. */
export const listRentReceipts = async (propertyId, months = 6) =>
  (await provider()).listRentReceipts(propertyId, months);

/** Only the month is sent: the server composes the rest, so a browser cannot mint a receipt for an unagreed rent.
 * Callers need an error branch: 422 is safe to show; 409 means the view is stale, so re-read. */
export const recordRentReceipt = async (propertyId, rentMonth) =>
  (await provider()).recordRentReceipt(propertyId, rentMonth);
