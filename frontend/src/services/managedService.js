/**
 * Managed Property Service — the owner's private file on a property they hold.
 *
 * `GET|POST /me/managed-properties`, `GET|PATCH|DELETE /me/managed-properties/{id}`,
 * `POST /me/managed-properties/{id}/publish`,
 * `GET|POST /me/managed-properties/{id}/rent-receipts`.
 *
 * A managed property is a property an owner registers for their **own** benefit — valuation,
 * document passport, rent tracking — before, or without ever, advertising it. It is private by
 * default and enters the ordinary pending-review listing flow only when the owner publishes it.
 *
 * Every route is scoped to the bearer token, so nothing here takes an owner argument. A record
 * belonging to someone else answers 404 rather than 403: the server never confirms that another
 * person's record exists.
 *
 * ## The whole domain crosses the seam
 *
 * Unlike `documentService.js`, there is no honest-subset table to draw here — list, read, register,
 * update, delete, publish and the listing bridge all have real endpoints. What differs between the
 * providers is not *which* operations exist but the shape they speak in, and that is confined to
 * `providers/http/managedMapper.js`.
 *
 * ## Two disagreements the mapper settles, worth knowing at the call site
 *
 * - **`deal` is `sale` here, `buy` on the wire.** The owner hub has said `sale` since the prototype
 *   and says it in conditionals, not only in copy. Callers keep using `sale`; the mapper swaps it.
 *   Passing `buy` into `register` still works — it is normalised — but `sale` is the vocabulary.
 * - **Ids are opaque.** The mock mints `MP…`; the server mints a UUID. Nothing may parse or
 *   construct one, and in particular nothing may assume an id is stable across providers. The
 *   document vault is keyed by this id, which is why porting the vault and this domain in the same
 *   slice was not optional.
 *
 * ## Shape
 *
 * A managed record is
 * `{ id, visibility, status, title, type, bhk, bhkNum, locality, localitySlug, society, loc, area,
 * areaUnit, furnishing, deal, price, priceStr, img, image, gallery, owner, ownerMobile, rented,
 * tenantName, monthlyRent, dueDay, valuation, publishedListingId, createdAt, updatedAt }`.
 *
 * `priceStr`, `loc`, `bhk` (the label), `img`/`image`/`gallery`, `owner` and `ownerMobile` are
 * presentation, derived on read; the server stores none of them. `createdAt`/`updatedAt` are epoch
 * milliseconds on both providers.
 */
import { createProvider } from './config.js';

const provider = createProvider('managed');

/**
 * The signed-in owner's managed records, newest first.
 *
 * @returns {Promise<object[]>}
 */
export const listManaged = async () => (await provider()).listManaged();

/**
 * One record, or `null` when it does not exist or is not the caller's.
 *
 * Null rather than a throw, on both providers: several owner surfaces render an empty state for a
 * missing record and have no error branch to fall into.
 *
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export const getManaged = async (id) => (await provider()).getManaged(id);

/**
 * Register a new private record from the owner tools.
 *
 * Only the facts are sent. `visibility`, `status` and `publishedListingId` are server-decided and
 * refused from a create body; a record is born private/managed.
 *
 * @param {object} data `{ deal, type, bhk, price, locality, society?, area?, areaUnit?, furnishing?,
 *        rented?, tenantName?, monthlyRent?, dueDay?, valuation? }`
 * @returns {Promise<object>} the created record
 */
export const registerManaged = async (data) => (await provider()).registerManaged(data);

/**
 * Partial update. Only the keys present on `changes` are sent, so this cannot blank a field the
 * caller did not mention.
 *
 * @param {string} id
 * @param {object} changes
 * @returns {Promise<object|null>}
 */
export const updateManaged = async (id, changes) => (await provider()).updateManaged(id, changes);

/**
 * Hard-delete a record. The listing it may have spawned is deliberately untouched — unpublishing is
 * a separate act, and deleting the owner's private file should not withdraw a live advert.
 *
 * @param {string} id
 * @returns {Promise<void>}
 */
export const deleteManaged = async (id) => (await provider()).deleteManaged(id);

/**
 * Publish into the ordinary pending-review flow.
 *
 * Idempotent on both providers: a record that already has a listing does not spawn a second one.
 * Resolves to `{ id, already, record }` where `id` is the listing's id and `already` distinguishes
 * "submitted for review" from "this was already published" — the two messages the owner surfaces
 * show. Rejects when the record cannot legally become a listing (the server re-runs the listing's
 * own validation at this boundary), so callers **must** have an error branch.
 *
 * @param {string} id
 * @returns {Promise<{ id: string, already: boolean, record: object|null }|null>}
 */
export const publishManaged = async (id) => (await provider()).publishManaged(id);

/**
 * Attach a managed record to a listing the owner already posted, so it carries a passport, a vault
 * and a rent tracker like a Rent-o-meter save does.
 *
 * The publish path runs record-first; this is the other direction, and it is why
 * `ManagedPropertyCreate` accepts a `publishedListingId` at all (D32). **Callers must dedup first**
 * against the list they already hold — this is not free, and calling it per listing per render is
 * the bug the ledger flagged. Resolves to `null` when the listing is not eligible (a flatmate post)
 * or when the race was lost and a record already exists.
 *
 * @param {object} listing a listing the caller has verified they own
 * @returns {Promise<object|null>}
 */
export const ensureManagedForListing = async (listing) =>
  (await provider()).ensureManagedForListing(listing);

/**
 * The months already recorded as received on this property, newest first.
 *
 * A receipt is `{ id, ym, amount, tenantName, landlordName, propertyAddress, createdAt }`, and
 * every figure on it is a **snapshot taken when the month was recorded** — not the property as it
 * stands now. Render and print these values; do not re-derive them from the record you are holding,
 * or last March's receipt reprints at this March's rent after a tenant change.
 *
 * `id` is the durable receipt reference and belongs on the PDF. It replaced a `'RCPT' + Date.now()`
 * minted at print time, which gave the same month a different reference on every download.
 *
 * @param {string} propertyId
 * @param {number} [months] how many months back to return; the server clamps it to 1–24
 * @returns {Promise<object[]>}
 */
export const listRentReceipts = async (propertyId, months = 6) =>
  (await provider()).listRentReceipts(propertyId, months);

/**
 * Record a month as received, and get the receipt back.
 *
 * Only the month is sent. Amount, tenant, landlord and address are composed from the owned property
 * on the far side, so the browser cannot mint a receipt for a rent that was never agreed.
 *
 * **Callers must have an error branch.** Both providers reject with an error carrying `status`:
 * `422` when the property cannot issue a receipt (not rented, no rent, no tenant) — the message is
 * safe to show — and `409` when that month is already recorded, which means the caller's view is
 * stale and it should re-read rather than report a failure.
 *
 * @param {string} propertyId
 * @param {string} rentMonth `YYYY-MM`
 * @returns {Promise<object>} the created receipt
 */
export const recordRentReceipt = async (propertyId, rentMonth) =>
  (await provider()).recordRentReceipt(propertyId, rentMonth);
