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
- **Checker = admin.** `/admin` is administrator-only; an ops account's `properties:*` atoms widen
  what the API grants it, not which console it may open.
- **Route guards:**
  - The admin shell is `RoleRoute roles={['admin']}` (`src/App.jsx`). `manager` was retired with the
    custom roles that labelled it (D209).
  - The page is wrapped in `ModuleRoute moduleKey="properties"`, which tests `properties:read`
    against the caller's own resolved atoms from `GET /me`.
  - `verifyOnly` is now `!canWriteModule(user, 'properties')` - i.e. read without write. The old
    `properties:verify` sub-scope is gone: it was a console invention with no route behind it, and
    `live-rbac.spec.js` asserts it does not reappear in the server's catalogue.
- The guards shape the UI; the control is `@PreAuthorize` on each moderation route, over the same
  atoms.

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
- **Foundation fields** are the searchable facets a buyer can filter on, which is the shape a
  bait-and-switch takes: `price, bhk, propertyType, locality, deal, furnishing, possession`. Since
  Q14 (2026-08-11) they split into **two outcomes**, and the line is what the edit does to the
  *claim* rather than how much the value moved:
  - **Off search** — `locality, propertyType, bhk, deal` change *what the listing fundamentally is*,
    so a stale index entry is a wrong answer: a 2BHK appearing under 3BHK, or a rental under sale.
    These still revert to `pending` until a moderator re-approves.
  - **Stays live, re-checked** — `price, furnishing, possession` change *an attribute of a listing
    that is still the same property*, so the worst case is a briefly out-of-date number on a listing
    that is genuinely what it claims to be. The listing stays `approved` and searchable and a
    re-check is queued instead. Fraud risk is handled by the re-check either way; the difference is
    only whether the listing earns while it waits.
- The rule lives server-side in `ListingService.apply`, which returns an `EditImpact` record
  (`remoderationRequired` / `recheckOnly` / the field names re-checked), and `ListingService.update`,
  which calls `Property.revertToPending()` for the first and `Property.requestRecheck(fields)` for
  the second. Re-moderation supersedes a re-check when one PATCH trips both.
  `ListingFoundationTest` pins both sets to `PropertyController.search`'s facets. A **moderator** edit
  (`updateAsModerator`) deliberately does *neither* - the moderator is the change, and must not file
  themselves a ticket to check their own correction.
- **The re-check queue.** `properties.recheck_requested_at` + `recheck_reason` (V62, deliberately
  shaped like the existing `flag_reason` beside `status`) hold the work item; `flagged` could not be
  reused because it also removes the listing from search. The timestamp is set once and not refreshed
  by later edits, so queue age stays honest, while the reason string accumulates field names.
  `GET /admin/properties?recheck=true|false` is the tri-state filter (same shape as `archived`), and
  `PropertyResponse` carries `recheckPending` / `recheckReason` / `recheckRequestedAt`. Clearing it is
  `PATCH /properties/{id}/status` with `approved` on an already-approved listing — "checked it, all
  fine" — which is why there is no separate endpoint.
- **The Re-check Queue tab** (`/admin/properties?tab=recheck`) is where it gets drained, the third
  queue alongside Verification and Flagged. It fetches `?recheck=true` on its own rather than
  narrowing the page's shared listing fetch: the endpoint pages at 20 and a queued re-check is by
  definition an *approved, un-archived* listing, so a client-side narrowing would show only the
  re-checks that happened to fall in the newest 20 and present the rest as drained — for a queue,
  worse than showing nothing. Rows carry the changed fields and the waiting time, escalate
  sky→amber→rose at 24h/72h, and are ordered oldest-first with no re-sort offered, because letting a
  moderator re-order the queue is letting them work the easy end. The waiting age is also why the
  count rides in the tab label and a KPI card — a queue nobody is *told about* is a queue nobody
  drains. Sorting server-side is not available: `sort` is clamped to the catalogue's shared
  whitelist, and widening it for `recheckRequestedAt` would expose the column to the public search.
  Two moderator outcomes, both existing transitions: **Looks fine** (`approved`, listing stays live,
  re-check cleared) and **Reject** (`rejected` with a mandatory reason — a takedown with no recorded
  cause is unappealable). The same strip renders on every other tab too, because on `All Listings`
  an un-reviewed price change is otherwise indistinguishable from a verified one.
  Covered by `e2e/tests/admin/property-recheck-queue.spec.js`.
- The client carries two mirrors of that set, both pinned to the Java by
  `frontend/scripts/check-listing-foundation.mjs` (`npm run check:listing`):
  `LISTING_FOUNDATION_FIELDS` in `src/lib/store/listings.js` (store vocabulary, the union, no live
  consumer today) and `FOUNDATION_OFF_SEARCH_KEYS` / `FOUNDATION_STAYS_LIVE_KEYS` in
  `src/pages/consumer/list-property/editPolicy.js` (wizard vocabulary), which is what the
  owner-facing edit banner reads. The gate asserts the two server sets are disjoint and compares each
  half separately, because a field moving *between* them is the drift that costs something.
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
- **A staffer cannot decide their own listing.** `PropertyVerificationService.decide` compares the
  caller against `property.owner` and answers 403 *before* `requireCase`, because this is the one
  case where every other guard passes: a staffer listing their own flat is a participant in the
  thread *and* holds `properties:write`, so the listing would publish with nobody having read it.
  Pinned live in `e2e/tests/ops/live-verification-access.spec.js`, which also decides the same case
  as a second staffer — without that half, a route broken for everyone would satisfy the refusal.

### Who may read the case file, and what a refusal says

Two different shapes, for two different reasons.

| Route | Not a participant, not staff | Why |
|---|---|---|
| `GET/POST /properties/{id}/verification`, `/messages`, `/read` | **404** | The guard is a *relationship*. A 403 would confirm that a listing with that id exists and is under review — the fact a competitor walking ids would probe for. The refusal has to be indistinguishable from "no such case", **including the response body**: two distinguishable 404s restore the oracle the status code was chosen to remove. |
| `POST /verification/decision`, `PATCH /verification/checklist`, `GET /admin/property-reviews` | **403** | The guard is a *role*. `@PreAuthorize` refuses before the id is looked up, so the response cannot leak anything about the row — and these are routes a non-staff caller has no legitimate reason to have found. |

The owner is a participant in their own review, which is why the thread routes carry no `x-roles` in
the contract (spec fix S28) — role-gating them would have locked owners out of the conversation
about their own listing. The one thing an owner is *not* shown is a case file whose every message is
staff-only: that answers **404 rather than an empty thread**, because an empty thread still tells
them a file has been opened on them (D218).

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
