/**
 * `Document` / `DocumentRequest` (wire) → the view models the owner document surfaces render.
 *
 * The seam here is drawn on the **owner's side of the vault only** — the operations a signed-in
 * owner can genuinely drive through the contract: listing/uploading/deleting their own files, and
 * reading/answering the buyer requests in their inbox. The *buyer's* side (asking for access,
 * polling a request's status, opening a shared bundle) is a client-only cross-user flow with no
 * faithful contract surface, and stays on `lib/data/documents.js` — see `documentService.js` for
 * the full boundary. Every reconciliation below has a wrong answer that looks right.
 *
 * ## 1. Vault file — signed URL, not a data URL
 *
 * The mock stores each file's bytes as a base64 `dataUrl` in `localStorage`; the contract returns a
 * short-lived signed `url` minted at read time (never stored, not stable between two reads). The
 * dev backend points that URL at `mock.storage.local`, which does not resolve in the browser, so
 * the *rendered file* degrades in dev exactly as the service-request draft does (D120). The view
 * model therefore carries **both** `dataUrl` (base64, mock) and `url` (signed, http) and leaves the
 * other null — a viewer opens whichever is present rather than assuming one storage model.
 *
 * ## 2. Request category — one string vs a list
 *
 * The mock models a request as a single `docType`; the contract carries a `categories[]` array (a
 * buyer can ask for several at once). The inbox view keys on `docType`, so the first category
 * becomes `docType` and the whole list is preserved as `categories` for a surface that wants it.
 * A multi-category server request thus renders under its first category — documented rather than
 * hidden, because inventing N view rows from one request would fabricate acknowledgements the buyer
 * only gave once.
 *
 * ## 3. Requester mobile is masked, always
 *
 * `DocumentRequest.requester.mobile` is masked on this surface by contract — the inbox never
 * reveals a number (the contact gate is the only place that does). It maps straight to `buyerMobile`
 * without any attempt to unmask; a granted request's identity still arrives masked.
 *
 * ## 4. Share token / expiry are read-only owner affordances
 *
 * On grant the server mints a `shareToken` (and an `expiresAt`); the mock computes `sharedDocIds`
 * client-side and writes the buyer a cross-user notification instead. The token and expiry are
 * surfaced so an owner can re-send the link they issued; the mock leaves them null (its grant
 * notification carries the link directly). Neither is the buyer's read path — that stays mock-only.
 *
 * ## 5. Time is epoch ms
 *
 * The mock timestamps are `Date.now()` numbers and the lists sort on them, so every ISO instant
 * (`uploadedAt`, `createdAt`) becomes epoch ms here — 0 for a missing date, so a sort never yields
 * NaN.
 */

/** ISO instant → epoch ms. 0 for a missing date, so a sort never produces NaN. */
function epoch(iso) {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * One wire `Document` → the vault view model the owner surfaces render.
 *
 * `dataUrl` is null in http mode (the bytes live behind the signed `url`, not inline); a viewer
 * that finds no `dataUrl` falls back to `url`. Keys mirror the mock's `addDocument` shape exactly so
 * a migrated consumer reads the same object from either provider.
 */
export function toDoc(dto) {
  if (!dto) return null;
  return {
    id: dto.id,
    category: dto.category || 'Other',
    name: dto.fileName || 'Document',
    size: dto.sizeBytes || 0,
    mime: dto.mimeType || 'application/octet-stream',
    dataUrl: null,
    url: dto.url || null,
    uploadedAt: epoch(dto.uploadedAt),
  };
}

export const toDocList = (rows) => (Array.isArray(rows) ? rows.map(toDoc).filter(Boolean) : []);

/**
 * One wire `DocumentRequest` → the inbox view model.
 *
 * `categories[]` collapses to a single `docType` (the first) for the inbox's per-document row, with
 * the full list kept alongside. `shareToken`/`expiresAt` are the owner's re-send affordance; both
 * are null until the request is granted.
 */
export function toRequest(dto) {
  if (!dto) return null;
  const categories = Array.isArray(dto.categories) ? dto.categories : [];
  const requester = dto.requester || {};
  return {
    id: dto.id,
    propId: dto.propertyId,
    buyerName: requester.name || 'Buyer',
    buyerMobile: requester.mobile || '',
    docType: categories[0] || 'Document',
    categories,
    status: dto.status || 'pending',
    requestedAt: epoch(dto.createdAt),
    acknowledgedDisclaimer: !!dto.acknowledgedDisclaimer,
    shareToken: dto.shareToken || null,
    expiresAt: epoch(dto.expiresAt) || null,
  };
}

export const toRequestList = (rows) => (Array.isArray(rows) ? rows.map(toRequest).filter(Boolean) : []);

/**
 * The tracker/inbox speaks `'granted'`/`'declined'`; so does the contract's `StatusUpdate`. The
 * decision is passed through as-is, guarded to the two the server accepts so a typo becomes a
 * client-side no-op rather than a 422 the owner cannot act on.
 */
export function toStatusUpdate(decision, note) {
  const status = decision === 'granted' ? 'granted' : 'declined';
  return { status, note: note || '' };
}
