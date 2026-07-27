# Flow: Property Verification Queue (Maker-Checker)

> The canonical maker-checker flow: an owner submits a listing, an admin/manager reviews the
> documents and either approves (listing goes live) or rejects (owner fixes and resubmits).
> This is **listing moderation** (verifying the listing's ownership documents to publish it), and it
> also drives listing trust/ranking — it is **not** an identity gate on the owner. Under
> **badge-not-gate (ADR-019)** the owner posts at L1 with no Aadhaar; the opt-in Verified badge is a
> separate trust signal (see [`../../system/trust-and-verification-model.md`](../../system/trust-and-verification-model.md)).
> **Status:** documented from React source · re-synced to ADR-019 (badge-not-gate) - **Primary role(s):** admin / manager (checker), owner (maker)

---

## 1. Purpose & user problem
- **Persona:** a back-office reviewer (admin or manager, or a scoped "Properties - Verify" staff role)
  who protects buyers from fake, duplicate, or misrepresented listings; the owner is the counterparty
  who wants their property live.
- **Job-to-be-done:** "Check every new listing against its ownership documents and only publish the
  genuine ones." For the owner: "Get my property verified and live."
- **Why it matters:** listing verification is PuneNest's core **supply-quality** gate. A listing is
  invisible to buyers until a checker approves it, so this queue is the single choke point that
  decides platform supply quality. Note this gates the **listing** (its documents), not the owner's
  identity — posting itself is L1-only (ADR-019); the owner's opt-in Verified badge is a separate
  ranking/trust signal. It is the reference implementation of the shared maker-checker pattern
  (see [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 2).

## 2. Entry points
- **Routes:** `/admin/properties` (tab `verify` = "Verification Queue"). Deep links:
  `?tab=verify`, `?review=<listingId>` (opens the review modal directly).
- **Tiles / triggers:** the "Pending" KPI card on `/admin/properties` jumps to the verify tab; the
  admin dashboard "pending listings" tile; each queue row's "Review" action opens `PropertyReviewModal`.
- **Source components:**
  - `src/pages/admin/AdminProperties.jsx` - queue, filters, KPIs, bulk approve/reject.
  - `src/pages/admin/properties/PropertyReviewModal.jsx` - per-listing review (docs, thread, decision).
  - `src/pages/admin/properties/review-modal/*` - `DocPill`, `DocViewerModal`, `WhatsappTemplates`,
    `CommunicationLog`.
  - `src/pages/admin/properties/PropertyModals.jsx` - flag / archive / edit / bulk-reject modals.
  - `src/components/admin/AdminPropertyCard.jsx` - queue row.

## 3. Actors & roles
- **Maker = owner** (or a concierge "post on behalf" staffer). Submits the listing; cannot approve it.
- **Checker = admin / manager**, or a staff member whose custom role grants the Properties module.
- **Route guards** (UX-only today, see cross-cutting section 1):
  - The admin shell is `RoleRoute roles={['admin','manager']}` (`src/App.jsx`).
  - The page is wrapped in `ModuleRoute moduleKey="properties"`.
  - `propertiesScope(user, customRoles)` (`src/lib/permissions.js`) returns `'full'` or `'verify'`.
    A `'verify'` grant locks the whole page to the Verification Queue tab only (`verifyOnly` in
    `AdminProperties.jsx`), hiding curation, duplicates, and listing management.
- Guards shape the UI; they do not secure data (localStorage is editable). Authorization MUST move
  server-side.

## 4. Entities touched
- [`properties` / listings](../../system/data-model.md) - **read** (queue), **updated** (`status`,
  `pipelineStage`, `flagReason`, `featured`, edited fields), **soft-deleted** (`archived`).
- [`property_reviews` + `review_messages`](../../system/data-model.md) - **created** on demand
  (`ensureReview`), **updated** (doc checklist, thread, decision). Stored in
  `db.propertyReviews[listingId]`.
- [`internalNotes`](../../system/data-model.md) (`internalNotes["listing:<id>"]`) - **created**
  (reviewer notes; never deleted).
- [`audit_log`](../../system/data-model.md) - **created** on every mutation via `logAudit`.
- `aadhaar_verifications` - **read** only as the owner's **optional** Verified badge (a ranking/trust
  signal), never as a posting prerequisite; posting is L1-only (ADR-019).

## 5. Business rules & logic  *(the meat)*

### 5.1 What enters the queue
- `rowsVerify` = listings whose `status` is `'pending'` **or** the legacy `'Under Review'`
  (`AdminProperties.jsx`). Archived listings are excluded.
- A listing lands in `pending` in three ways:
  1. **Owner posts** via the list-property wizard (see
     [`../consumer/list-property-wizard.md`](../consumer/list-property-wizard.md)). `addListing`
     (`src/lib/mockApi/properties.js`) stamps `status: 'pending'`, `real: true`, and
     `pipelineStage: postedByAdmin ? 'listed' : 'info_collected'`.
  2. **Concierge / post-on-behalf** (`postedByAdmin`) - same `pending`, plus completion trackers
     (`claimLinkSent`, `photosUploaded: false`, `aadhaarVerified: false`). The `aadhaarVerified`
     tracker reflects the owner's **optional** Verified badge, not a posting prerequisite.
  3. **Re-verification** - an approved listing whose owner edits a **foundation field** reverts to
     `pending` (see 5.5); a restored archived listing also returns to `pending`.

### 5.2 The review record (per-listing checklist + thread)
`ensureReview(listing)` (`src/lib/data/properties-admin.js`) creates, once, a review keyed by the
listing id:
```
{ propId, title, locality, price, deal,
  status: 'in_review',
  docs: [ { id, name, status: 'pending', note: '' }, ... ],
  messages: [], decision: null, createdAt, updatedAt }
```
- **Document checklist depends on the deal** (`defaultDocs`):
  - `rent`: Index II, Electricity bill, Aadhaar card.
  - `buy`: Ownership proof (Sale deed / Index II), Property tax receipt, Owner government ID
    (Aadhaar / PAN), Society NOC / Maintenance receipt, Encumbrance certificate, Listing photos
    match the property.
- **Per-document verification:** `setDocStatus(id, docId, status, note)` marks a doc
  `verified` / `rejected` / `pending` and can attach a note. The first doc action flips the review
  from `pending` to `in_review`. `setDocVerified` is the boolean wrapper.
- **Verified count** is shown as `X / N verified`; approving with unverified docs prompts a confirm
  ("Approve and publish anyway?") but is not blocked (`reviewApprove` in `PropertyReviewModal.jsx`).

### 5.3 Reviewer actions and their side-effects
| Action | Handler | State written | Side-effects |
|--------|---------|---------------|--------------|
| Approve & publish | `reviewApprove` | review `decision.type='approved'`, listing `status='approved'`, `pipelineStage='live'` | clears `flagReason`, appends owner "approved" message, internal note "Approved", `logAudit`, listing becomes buyer-visible |
| Reject | `reviewReject` (two-step: arm, then confirm with reason) | review `decision.type='rejected'`, listing `status='rejected'` | reason appended to owner thread, internal note "Rejected", `logAudit`; owner may resubmit |
| Message owner | `reviewSend` -> `addReviewMessage(id,'admin',text)` | review `status='clarification'` (unless already decided) | two-way thread; owner sees it in their listing |
| Mark doc verified/rejected | `reviewSetDoc` -> `setDocStatus` | doc `status`, review `in_review` | updates verified count |
| Approve owner edits (P0) | `approveEdits` | listing `reReview=null`, `materialEditFlag=false` | clears re-review flag on a still-live listing, thread note, `logAudit` |
| Flag | `submitFlag` -> `flagListing` | listing `status='flagged'`, `flagReason` | removes from live; internal note, `logAudit` |
| Clear flag | `doClearFlag` -> `clearFlag` + `setPipelineStage('live')` | listing `status='approved'`, `flagReason=''` | republishes; `logAudit` |
| Archive | `submitArchive` -> `archiveListing` | listing `archived=true`, `archivedAt`, `archiveReason` | soft-delete; internal note, `logAudit` |
| Restore | `doRestore` -> `restoreListing` | listing `archived=false`, `status='pending'` | re-enters the queue; `logAudit` |
| Toggle featured | `doFeature` -> `toggleFeatured` | listing `featured` | curation only; `logAudit` |

**The decision itself carries no side-effect.** `decideReview(id, type, reason)` only writes the
review `status`, `decision = { type, reason, at }`, and a system message. The listing `status` is
flipped separately by the handler (`setListingStatus`) so the two writes are paired in the UI - the
exact spot a server transaction must own atomically.

### 5.4 Visibility (the trust boundary)
- Only `status === 'approved'` listings are returned to buyers. Public reads filter on it, e.g.
  `getLocality` returns `listings.filter(l => l.status === 'approved')`
  (`src/lib/mockApi/collections.js`), and the public property provider excludes non-approved / archived.
- `pending`, `rejected`, `flagged`, and `archived` listings are never shown to buyers. Approval is
  literally what makes a listing exist for the public.
- `setPipelineStage(id,'live')` also self-heals the status to `approved` if it drifted
  (`src/lib/mockApi/properties.js`).

### 5.5 Anti bait-and-switch (owner edits after approval)
- **Foundation fields** (`LISTING_FOUNDATION_FIELDS` in `src/lib/store/listings.js`):
  `deal, title, locality, localitySlug, bhk, bhkNum, area, type, facing, floor, age, construction`.
- If an owner edits any foundation field on an approved listing, `listingFoundationChanged` is true
  and `revertListingForReview` sets `status: 'pending'` - the listing re-enters this queue.
- Non-foundation edits keep the listing live but set `reReview` / `materialEditFlag`, surfacing a
  diff in the review modal that the reviewer clears with `approveEdits` (no takedown).

### 5.6 Bulk operations
- `bulkApprove`: for each selected id -> `ensureReview` + `decideReview('approved')` +
  `setListingStatus('approved')` + `updateListingFields({ flagReason: '' })`, then one `logAudit`.
- `submitBulkReject`: requires a shared reason; for each -> `ensureReview` +
  `decideReview('rejected', reason)` + `setListingStatus('rejected')`, then `logAudit`.
- `PAGE_LIMIT` caps rendered rows; a hint tells the reviewer to filter to narrow down.

### 5.7 Client-side computations that MUST move server-side
- The approve/reject decision + listing status flip (currently two client writes).
- Buyer-visibility filtering on `status === 'approved'`.
- Foundation-change detection and auto-revert to `pending`.
- Duplicate clustering (`findDuplicateClusters` - union-find over identity keys and perceptual photo
  hashes) and quality/freshness scoring.

## 6. Maker-checker / approval
- **Applicable: yes. This is the canonical example.** See
  [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 2.
- **Maker (proposes):** owner submits a listing -> `status: 'pending'` (no buyer visibility yet).
- **Checker (approves/rejects):** admin/manager reviews docs and decides.
- **On approve:** review `decision='approved'`, listing `status='approved'` + `pipelineStage='live'`,
  `flagReason` cleared, owner notified, audit written -> listing goes live.
- **On reject:** review `decision='rejected'` with a reason, listing `status='rejected'`, owner
  notified. The owner addresses the reason and resubmits, returning the record toward `pending` /
  `in_review` (reject-then-resubmit loop).
- **Intermediate states** `in_review` and `clarification` are refinements of "pending", not new
  top-level stages.

## 7. State machine

**Listing `status`:**
```
                 (owner edits foundation field / restore)
                 +---------------------------------------+
                 v                                       |
submitted --> pending --> approved(live) ----------------+
                 |            |
                 |            +--> flagged --(clearFlag)--> approved
                 +--> rejected --(owner resubmits)--> pending
approved|pending|flagged --(archive)--> archived --(restore)--> pending
```
- **Terminal-ish:** `rejected` (re-openable by owner resubmission), `archived` (re-openable by
  restore -> pending).
- **Live** requires `status='approved'`; only this state is buyer-visible.

**Review `status`:** `in_review -> clarification -> approved | rejected` (decision is terminal;
owner replies after a rejection re-open the thread).

**`pipelineStage`:** `listed | info_collected | docs_submitted -> under_review -> live`
(set to `under_review` when the modal opens, `live` on approval).

## 8. Edge cases, validation & error states
- **Empty queue:** "No listings match your filters" card.
- **Approve with unverified docs:** confirm dialog ("N document(s) are not marked verified yet.
  Approve and publish anyway?"); reviewer can override.
- **Reject without a reason:** blocked - "Add a clear reason before rejecting" (single) /
  "Add a reason before rejecting" (bulk). The reason is sent to the owner.
- **Flag without a reason:** blocked - "Add a reason before flagging".
- **Edit validation** (`submitEdit`): title required, price a positive number, area non-negative,
  locality required.
- **Stale / awaiting follow-up:** listings pending > 48h are "stale"; concierge listings missing
  photos or the Verified badge are "awaiting owner" (Needs Follow-up tab). Reminder / WhatsApp
  templates nudge the owner without deciding.
- **Duplicates:** clusters of >= 2 listings that share identity keys or matching photo hashes surface
  in the Duplicates tab; `resolveDuplicate(keepId, dropId)` archives the drop, `dismissDuplicate`
  clears a false positive.
- **Concurrency / stale data:** all reads are in-memory over one localStorage store; there is no
  optimistic locking. Two reviewers can decide the same listing; last write wins. The server must
  guard against double-decision.

## 9. Current mock implementation
- **Queue + handlers:** `src/pages/admin/AdminProperties.jsx`
  (`bulkApprove`, `submitBulkReject`, `openReview`, flag/archive/edit handlers).
- **Review logic:** `src/lib/data/properties-admin.js`
  (`ensureReview`, `defaultDocs`, `setDocStatus`/`setDocVerified`, `addReviewMessage`,
  `markReviewRead`/`reviewUnread`, `decideReview`, `flagListing`/`clearFlag`,
  `archiveListing`/`restoreListing`, `updateListingFields`, `findDuplicateClusters`/
  `resolveDuplicate`/`dismissDuplicate`).
- **Listing status / pipeline:** `src/lib/mockApi/properties.js`
  (`addListing`, `setListingStatus`, `setPipelineStage`, `toggleFeatured`, `sendOwnerReminder`).
- **Owner (maker) side:** `src/lib/store/listings.js`
  (`addListing`, `LISTING_FOUNDATION_FIELDS`, `listingFoundationChanged`, `revertListingForReview`,
  `isListingApproved`) exposed via `src/services/providers/mock/listingProvider.js`.
- **Audit / notes:** `src/lib/mockApi/audit.js` (`logAudit`, `addInternalNote`), surfaced by
  `src/components/ui/InternalNote.jsx` (`submitNote`) and the admin provider
  `src/services/providers/mock/adminProvider.js` (`logAudit`, `listAudit`, `clearAudit`).
- **Data/seed:** `src/data/properties.json` (listings; `status` in {`approved`,`pending`} seed);
  reviews are created on demand, not seeded.

## 10. Target API endpoints
Map to the [OpenAPI spec](../../../backend/src/main/resources/static/openapi/punenest-api.yaml) (tag: Moderation):
- `GET /properties?status=pending&archived=false&page=&size=` - the queue.
- `POST /properties/:id/verification` - initiate the review record (`ensureReview`).
- `GET /properties/:id/verification` - review thread + doc checklist.
- `POST /properties/:id/verification/messages` - `addReviewMessage`.
- `POST /properties/:id/verification/read` - `markReviewRead`.
- `POST /properties/:id/verification/decision` - `{ "decision": "approved"|"rejected", "reason" }`
  (`decideReview`). **The server must apply the paired listing `status` change transactionally.**
- `PATCH /properties/:id/status` - `{ "status": "approved" }` / `{ "status": "rejected", "reason" }`.
- `POST /properties/:id/flag` / `DELETE /properties/:id/flag` - flag / clear flag.
- `PATCH /properties/:id/archive` / `PATCH /properties/:id/restore` - soft-delete / restore
  (restore resets status to `pending`).
- `PATCH /properties/:id` - field edits (foundation-field edit reverts status to `pending`).
- `POST /admin/audit-log` - audit write.
- **Delta:** a per-document verification endpoint (e.g.
  `PATCH /properties/:id/verification/docs/:docId { status, note }`) is implied by `setDocStatus`
  but not yet in the contract.

## 11. Backend responsibilities
- **Authorize the checker:** only `admin`/`manager` (or a Properties-scoped role) may decide; verify
  server-side, never trust the client role.
- **Atomic decision + side-effect:** approve = review decision + listing `status='approved'` +
  visibility + `flagReason` clear + owner notification + audit, all in one transaction. Reject is the
  symmetric transaction. Prevent double-decision on an already-decided listing.
- **Enforce visibility:** never return non-`approved`/archived listings to public/buyer callers.
- **Own the listing doc checklist:** the listing's verification status and per-doc state are trust
  data; the client cannot self-mark verified. (The owner's Verified badge is a separate **opt-in**
  signal, not a posting gate.)
- **Enforce foundation-change re-verification:** detect foundation edits server-side and revert to
  `pending`; do not let the client keep a materially changed listing live.
- **Write audit + internal notes server-side** with a trusted actor identity (client-supplied `who`
  is not trustworthy) and keep them immutable.
- **Duplicate detection** (identity-key and photo-hash clustering) belongs on the server so buyers
  never see broker copy-paste supply.
