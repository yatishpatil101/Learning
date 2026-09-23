# Flow: Property Verification Queue (Maker-Checker)

> The canonical maker-checker flow: an owner submits a listing, an admin/manager reviews the
> documents and either approves (listing goes live) or rejects (owner fixes and resubmits).
> This is **listing moderation** (verifying the listing's ownership documents to publish it), and it
> also drives listing trust/ranking — it is **not** an identity gate on the owner. Under
> **badge-not-gate (ADR-019)** the owner posts at L1 with no identity check; the opt-in Verified badge is a
> separate trust signal (see [`../../system/platform-architecture.md`](../../system/platform-architecture.md) §6.4 / ADR-019).
> **Status:** documented from React source · re-synced to ADR-019 (badge-not-gate) - **Primary role(s):** admin / manager (checker), owner (maker)

---

## 1. Purpose & user problem
- **Persona:** a back-office reviewer (admin or manager, or a scoped "Properties - Verify" staff role)
  who protects buyers from fake, duplicate, or misrepresented listings; the owner is the counterparty
  who wants their property live.
- **Job-to-be-done:** "Check every new listing against its ownership documents and only publish the
  genuine ones." For the owner: "Get my property verified and live."
- **Why it matters:** listing verification is Draazy's core **supply-quality** gate. A listing is
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
- `identity_verifications` - **read** only as the owner's **optional** Verified badge (a ranking/trust
  signal), never as a posting prerequisite; posting is L1-only (ADR-019).

## 5. Business rules & logic  *(the meat)*

### 5.1 What enters the queue
- `rowsVerify` = listings whose `status` is `'pending'` **or** the legacy `'Under Review'`
  (`AdminProperties.jsx`). Archived listings are excluded.
- A listing lands in `pending` in three ways:
  1. **Owner posts** via the list-property wizard (see
     [`../consumer/list-property-wizard.md`](../consumer/list-property-wizard.md)). Creating a listing
     stamps `status: 'pending'`, `real: true`, and
     `pipelineStage: postedByAdmin ? 'listed' : 'info_collected'`.
  2. **Concierge / post-on-behalf** (`postedByAdmin`) - same `pending`, plus completion trackers
     (`claimLinkSent`, `photosUploaded: false`, `identityVerified: false`). The `identityVerified`
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
| Approve & publish | `reviewApprove` | review `decision.type='approved'`, listing `status='approved'`, `pipelineStage='live'` | clears `flagReason`, appends owner "approved" message, files the optional internal note as action "Approved", `logAudit`, listing becomes buyer-visible |
| Reject | `reviewReject` (two-step: arm, then confirm with reason) | review `decision.type='rejected'`, listing `status='rejected'` | reason appended to owner thread, internal note "Rejected", `logAudit`; owner may resubmit |
| Message owner | `reviewSend` -> `addReviewMessage(id,'admin',text)` | review `status='clarification'` (unless already decided) | two-way thread; owner sees it in their listing |
| Mark doc verified/rejected | `reviewSetDoc` -> `setDocStatus` | doc `status`, review `in_review` | updates verified count |
| Approve owner edits (P0) | `approveEdits` | listing `reReview=null`, `materialEditFlag=false` | clears re-review flag on a still-live listing, thread note, `logAudit` |
| Flag | `submitFlag` -> `flagListing` | listing `status='flagged'`, `flagReason` | removes from live; internal note "Flagged", `logAudit` |
| Clear flag | `doClearFlag` -> `clearFlag` + `setPipelineStage('live')` | listing `status='approved'`, `flagReason=''` | republishes; `logAudit` |
| Archive | `submitArchive` -> `archiveListing` | listing `archived=true`, `archivedAt`, `archiveReason` | soft-delete; internal note "Archived", `logAudit` |
| Restore | `doRestore` -> `restoreListing` | listing `archived=false`, `status='pending'` | re-enters the queue; `logAudit` |
| Toggle featured | `doFeature` -> `toggleFeatured` | listing `featured` | curation only; `logAudit` |

The four internal notes above go through `saveNoteIfAny` (`components/ui/InternalNote.jsx`), which
posts to `POST /admin/notes/property/{id}` **after** the decision has landed and reports failure
without unwinding it: the listing really was approved, and a toast that said otherwise because a
note did not save would be a worse lie than a missing note. The widget's history is a live read of
`GET /admin/notes/property/{id}`, so a note filed by one staffer is visible to the next — which is
the whole point, and something the previous localStorage store could not do. Notes also appear on
the review modal's **Communication log**, interleaved with the outreach ledger, since "what has
already been done about this listing" is one question and reading it in two panels made the
operator merge them by eye.

**The decision itself carries no side-effect.** `decideReview(id, type, reason)` only writes the
review `status`, `decision = { type, reason, at }`, and a system message. The listing `status` is
flipped separately by the handler (`setListingStatus`) so the two writes are paired in the UI - the
exact spot a server transaction must own atomically.

### 5.4 Visibility (the trust boundary)
- Only `status === 'approved'` listings are returned to buyers. `GET /properties` is hard-floored to
  approved + non-archived server-side, so `?status=pending` returns an empty page rather than a
  privileged one, and locality reads filter the same way.
- `pending`, `rejected`, `flagged`, and `archived` listings are never shown to buyers. Approval is
  literally what makes a listing exist for the public.
- `setPipelineStage(id,'live')` also self-heals the status to `approved` if it drifted.

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
- The rule lives server-side in `ListingEditRules.apply`, which returns an `EditImpact` record
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
  Covered by `e2e/tests/admin/live-property-recheck-queue.spec.js`, which seeds through the product
  (post → approve → edit the price) rather than writing the flag, so it also pins the rule that
  raises the row. Both moderator outcomes route through the same clear: **Looks fine** is
  `PATCH /properties/{id}/status`, **Reject** is `POST /properties/{id}/verification/decision`, and
  `PropertyVerificationService.decide` clears the re-check for the same reason
  `PropertyModerationService.setStatus` does — a checker has looked, which is all the work item
  asked for. It did not, once: a rejection left the row queued forever, over-reporting the backlog
  and offering a **Looks fine** button that would have put the rejected listing back on the public
  site.
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

### Backend implementation notes

*Home of the reasoning behind `PropertyVerificationService`, `PropertyReviewQueue`,
`PropertyReviewSummary` and `PropertyVerificationController`.*

- **The duplicate-probe oracle is closed twice, in opposite directions.** A case file is created by the
  duplicate probe, so its mere existence answers the question the probe asks. On the **read** routes,
  `ownerVisibleCase` 404s a case that holds nothing but staff-only notes and has not been picked up or
  decided — otherwise "submit a listing carrying a guessed meter number, then ask its case file for
  anything at all" is the same oracle, quieter. The emptiness check in that guard is load-bearing, not
  defensive: an owner may open their own case with `POST /verification` before anything is said in it,
  and `allMatch` over no messages is vacuously true, which would refuse them the case they just
  created. On the **write** routes (`addMessage`, `markRead`) the fix is the mirror image — they open
  the case rather than demanding one, and always succeed. Refusing both cases would have closed the
  oracle too, at the price of letting an attacker mute an honest owner's support thread by colliding
  with them on purpose; the version where the owner can still speak is the one worth having.
- **`markRead` marks only the other side's messages, and only ones the caller could have read.**
  Marking your own is meaningless and would silently clear the badge the other participant is waiting
  on. Internal notes carry a null sender, so the "not mine" test alone was true for them and an owner
  tapping the read receipt stamped `readAt` on notes they had never been shown — nothing leaked, but it
  marked a duplicate finding as seen by the one person it is kept from. It reuses `mayReadNotes` rather
  than re-testing the role, so the same predicate decides what you are shown and what you can mark as
  shown.
- **`mayReadNotes` tests the grant, not the role.** Every other operation on the case file is gated on
  role *and* a `properties:read`/`:write` grant at the controller; the thread routes cannot be, because
  they are participant-or-staff and an owner has no grants. A bare role test therefore let a staff
  account whose `properties:read` had been deliberately revoked read every internal note on every
  listing, through the one verification route with no permission annotation. Revoking a grant has to
  mean something. The single filter in `toResponse` is what keeps the duplicate finding away from the
  person it is about (V80) — one place to get it wrong, and it is there.
- **A decision writes to three places, and each answers what the other two cannot:** the case file
  records who decided and why, `properties.status` decides public visibility, and the thread gets the
  sentence telling the owner what happened. It also calls `clearRecheck()` — a checker has now looked at
  the listing, which is the whole of what a queued stays-live re-check asked for (Q14). Omitting that
  left a rejected listing in the re-check queue forever (the queue filters on `recheck_requested_at`
  alone): the row could not be drained because both its buttons lead back here, the tab's count
  permanently over-reported the backlog — the one number telling an admin whether the promise made to
  buyers is being kept — and "Looks fine" on that stale row is a PATCH to `approved`, a one-click
  reversal of a rejection offered by a screen that gives no hint that is what it does.
- **The decision sentence is composed and persisted server-side.** It used to be built in the browser
  after the fact and never stored, so it existed only on the screen of the staffer who clicked: the
  owner saw `status` flip to `rejected` with no explanation attached. It is stored English rather than a
  translation key, which is a real cost — a persisted string is frozen in the language it was written
  in — but the alternative puts the platform's own words back in the browser, the arrangement that lost
  them in the first place. If that becomes a problem the fix is a locale column on the message, not a
  retreat to client-side composition. A blank note falls back to a generic line, because an approval
  with no note is routine while a rejection with no note still owes the owner a reason.
- **Checklist lines are addressed by their text, not an id.** Items are seeded from a fixed per-deal
  list and `item` is `updatable = false`, so the text is as stable as a surrogate key and survives a
  client that cached the case file. `PATCH` one line per call rather than a whole-list `PUT`: the
  console ticks as the reviewer works down the list, and a whole-list write would make every tick a
  last-write-wins race against a second reviewer on the same case. It carries `properties:write`, not
  the read atom, because a tick is a step towards publishing — and it refuses the listing's own owner
  for a sharper reason than `decide` does: the ticks are what the colleague who *can* approve reads
  before deciding, so letting an owner-reviewer mark their own documents inspected launders self-
  interest into the checker's record, which is worse than no checklist at all.
- **Explicit `saveAndFlush` on the write paths is load-bearing, not ceremony.** A new message is a
  transient child of a managed collection, so dirty checking alone defers its persist to commit — long
  after `toResponse` has read `getId()` off it and found null. `save()` merges, the merge cascades, and
  `@UuidGenerator`/`@CreationTimestamp` assign the two fields the client needs to render and
  de-duplicate the message there and then.
- **`initiate` is idempotent** — `property_reviews.property_id` is UNIQUE, so the alternative was a
  constraint violation on a double-click.
- **`PropertyReviewQueue` is a use-case split, not a layer split** (package-structure.md §4.1):
  triaging a queue and working a single case are two different things done by two different people,
  sharing no state — the queue side is read-only and never touches a thread, a decision or the audit
  log. It re-checks no roles: the desk queue is guarded by its controller, and the owner queue is
  scoped by `actor.userId()`, so a caller can only reach their own files and a user with no listings
  gets an empty page rather than a 403. Owner ids for a desk page are resolved in one bulk query to
  avoid a select per case file.
- **`unread` means different things to the two routes, and that is the point.** A message is unread to
  the side that did not send it: the desk sees owners waiting on a reply, the owner sees ops replies
  they have not opened. Deliberately *not* "messages I personally have not read" — the desk queue is
  shared, so scoping the badge to the reader would make a colleague's reply look like new owner mail.
  Internal notes count for nobody: not for the owner, who cannot see them, and not for ops, whose badge
  means "somebody is waiting on a reply".
- **`addVerificationMessage.attachments` is accepted and ignored.** The contract declares it, but there
  is no upload surface behind it and `review_messages` has no column for it. Accepting and silently
  dropping is the honest option only because it is written down; rejecting a documented field would
  break a client that follows the contract.

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

**Pipeline (D27) — two axes, not one.** The board and the server used to disagree about what a
"stage" was. They now hold two separate facts:

- **`pipelineStage`** — the acquisition funnel, "how far did we get towards having a listing":
  `contacted -> info_collected -> listed -> docs_submitted`.
- **`handbackMilestone`** — the hand-back, "how far did we get towards giving it to its owner":
  `photos_uploaded -> identity_verified -> claim_sent -> claimed`. Null until the paperwork is in;
  the database refuses a milestone on a row that has not reached `listed`.

A listing is at a point on both at once, which is why one column could not hold them: documents in
*and* photographs up is two facts, and whichever was written last erased the other.

`POST /properties/{id}/pipeline` accepts a point on either axis in its single `stage` field — the
vocabularies are disjoint, so the value says which column is meant. Moving onto a milestone pins
`pipelineStage` at `docs_submitted`; moving back onto the acquisition funnel clears the milestone.
Both directions are allowed, because evidence gets withdrawn.

**Where `under_review` and `live` went.** They were console-only stages and they are `status` under
different names, so they are stored nowhere. The board still shows six columns: the first four read
`pipelineStage`, and the last two are derived from `status` (`pending` -> Under Review,
`approved` -> Live). That is why approving a listing moves it to the Live column without anything
writing a stage.

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

## Moderation controller

Rationale relocated from `PropertyModerationController` Javadoc.

- **Guards.** The moderator-only routes carry `@PreAuthorize`; `archive`/`restore` do not,
  because they are dual-audience (owner *or* staff) and `@PreAuthorize` can express "is staff"
  but not "is staff or owns this row" - their guard lives in the service.
- **Empty 200s.** The status routes declare a bare `'200'` with no schema in the contract; the
  console re-reads the listing after acting. `adminUpdateProperty` is the exception because it is
  the only one whose effect the caller cannot predict from the request they sent.
- **One copy of the field mapping.** `adminUpdateProperty` maps on this controller but delegates
  to `catalog.listing.ListingService`; owner edits and moderator edits share one private `apply`
  and differ only afterwards - an owner's edit re-opens moderation, a moderator's does not.
- **Why the queue exists.** `GET /properties` pins `status='approved' AND archived=false` and
  takes no principal, and `GET /me/listings` is scoped to the caller's own `owner_id`. Without
  this read no moderator could produce the id of an unapproved listing.
- **Facets.** `status` and the five `ModerationFacets` axes are what the public search cannot
  express; all five are tri-state (`null` = both). `recheck=true` is a third axis rather than a
  status value because every status except `approved` is off search. `featured`,
  `postedByAdmin` and `unconfirmed` moved server-side because the console evaluated them in the
  browser over one fetched page, rendering queues as empty while the summary tiles said otherwise -
  a predicate the database cannot see cannot page.
- **Contact numbers are revealed to this desk.** Its job is to phone owners whose listings are
  stuck; masking only moved the lookup somewhere unaudited. This is the *only* reason to reveal -
  the seeker-facing gate is unaffected by any back-office role, and what governs here is the
  per-account `properties:read` atom.
- **`owner-standing` is guarded by the write atom.** It is the one read that discloses a named
  individual's plan, its only audience is the desk about to post past that plan, and a
  `postOnBehalf:read` row would exist solely to be ticked alongside the write row.
- **`outreach` is guarded by `postOnBehalf:write`.** It puts an unprompted message on a member
  of the public's personal phone in the platform's name - the same power as manufacturing a listing
  under a stranger's number, and more than moderating supply that already exists.

## Ownership gate

Rationale relocated from `OwnershipVerificationService` Javadoc.

- **Why it exists.** `properties.ownership_verified` used to be written by the demo seed and
  nothing else - the strongest trust signal the product sells on could be asserted but not earned.
  It is now earned by recording evidence and clearing a gate of the facts the deal needs
  (`OwnershipEvidenceTypes#requiredKinds`), each established by a document that is still current.
- **Why it lives in `moderation`, not `catalog`.** Accepting evidence is an ops decision with a
  maker and a checker; `PropertyVerificationService` next door already owns the owner/ops half of
  the same workflow. It also reads the documents vault, which `catalog` ranks below and may not
  import.
- **Why the announcement goes through a port.** The referral credit in `billing` is downstream,
  and `VerificationAnnouncer` is how it is told. A direct call would compile, but the port keeps
  the announcement independent of where verification is written and is what the credit's contract is
  expressed in. It fires inside the transaction, so a rollback takes the credit with it.
- **Nobody verifies their own listing.** Roles are additive - a staff member is also somebody's
  landlord - so the staff role alone is not enough to write on a listing. Maker and checker must be
  different people or the badge is self-service.
- **Reads answer 404, not 403**, matching `PropertyVerificationService`: a 403 would confirm to a
  stranger that a listing with that id exists.
- **The vault read is the most sensitive in the feature.** It is reviewer-only (re-derived from the
  principal as well as declared on the route) and audited, because it mints signed URLs to Aadhaar
  and PAN scans. A signed URL outlives the request and is fetched straight from the object store, so
  the audit row is the only thing that can attribute the disclosure to the reviewer who asked.
- **`issuedOn` is supplied by the caller**, as a date rather than an instant: only the caller can
  read it off the document, deriving it from the clock would let a decade-old receipt mint a fresh
  badge, and every check is a calendar-day comparison in `PlatformTime.IST`. It may not post-date
  the upload, or an old bill could be re-cited each quarter to renew the expiry window indefinitely.
- **`subjectName` is required for identity documents** - a row that does not say whose identity
  was sighted cannot be contradicted, and an assertion nobody can contradict is not evidence - but
  it is deliberately kept out of the audit log, which has no retention window and which
  `ErasureRetention` promises holds entity ids, not names.
- **Recording evidence never grants the badge.** The gate is a judgement about a set of documents
  taken together; a system where uploading the third file silently promotes a listing is one where
  nobody decided anything.
- **Grant is idempotent-ish.** The announcement fires only on a transition *into* the verified
  state; a renewal extends the expiry but keeps the original `ownershipVerifiedAt`, because
  billing holds that instant against a referral credit and moving it would leave the two sides
  naming different moments for the same event.
- **Revocation is distinct from a lapse.** It is the path for forged or wrong-flat evidence; without
  it a badge granted in error could only be withdrawn with hand-written SQL. Evidence rows are left
  in place - they are what an investigation reads. A reason is required, the audit entry is written
  only when a verdict was actually withdrawn, and withdrawing a *lapsed* badge still writes and
  logs, because the after-the-expiry forgery case is the one the log most needs.
- **Vault references are resolved in the service**, not left to the foreign key: an id belonging to
  a different listing would otherwise be accepted, letting one flat's evidence cite another flat's
  title deed. The service-request filter matches the reviewer's own document list, so anything
  citable but absent from it could only have been guessed.
- **Reviewer capability is read per account.** `properties:write` is a `BackOfficePermissions`
  atom held per account; `PermissionMap` is keyed by desk and speaks the `Capabilities`
  vocabulary. Asking the map for this name can never be true, so the desk filter silently excluded
  every properly configured colleague. Every other reader of these atoms injects
  `AccountPermissions`.
- **The write path takes a row lock.** All three writes are check-then-act; two ops users granting
  the badge at the same moment would both read "not yet verified" and both announce, paying one
  referral credit twice. Taken on the shared loader so evidence writes serialise against a decision
  in flight as well.

## Ownership evidence vocabulary

Rationale relocated from `OwnershipEvidenceTypes` Javadoc.

- **Kinds, not one list.** Documents are grouped by the fact they establish and the gate asks for
  facts, not files, so ops sees which fact is missing rather than how many uploads exist. A rental
  needs only a current utility or tax record in the lister's name (`ADDRESS_PROOF`) - the
  tenant-turned-sublandlord is the fraud that matters; a sale additionally needs the registry's own
  extract (`TITLE_PROOF`), because the buyer is paying for the title. Identity, site photographs
  and the deed remain recordable as supporting evidence but do not gate the badge.
- **A sale deed does not establish title here.** It is the stronger document in law and the weaker
  one to a reviewer: a deed is a PDF whose contents cannot be checked against anything, whereas
  Index II is the IGR's own extract and can be read back from the registry by the document number
  printed on it. The gate states what the platform can *verify*, not what conveys ownership, so the
  deed is filed as `TITLE_SUPPORT`.
- **Why some documents expire.** A registration record or a government identity document records a
  fact that does not change. A tax receipt or electricity bill proves only that the person was
  paying at the time it was issued - which is why they are useful as recurring proof and why they go
  stale. Site photographs sit between. Every window is measured from the document's own issue date,
  never from the review, so reviewing an old receipt today cannot mint a badge good for years.
- **Unrecognised deal intent falls to the sale gate.** Defaulting the other way would make an
  unknown intent grantable on one electricity bill, which is the failure mode the gate exists to
  prevent.
- **Strings, not a Java enum**, matching the rest of the wire vocabulary: the value is persisted,
  appears in the contract, and is checked by a `CHECK` constraint, so a rename without a migration
  must show up as a data mismatch rather than compile cleanly.
- **The owner's own vault label is a second opinion.** A file the owner filed as an Electricity Bill
  must not close `title_proof` on a sale badge. It is treated as a contradiction, not an absence -
  most vault labels (society NOC, share certificate) name no evidence type, so an unrecognised one
  leaves the judgement with the reviewer who has opened the file.
- **`subjectName` is required for identity documents**, derived from the kind rather than listed
  again so a fourth identity document inherits the rule, and mirrored by the CHECK in V66.

## Owner outreach templates

Rationale relocated from `OwnerOutreachService` Javadoc.

- **Why its own service.** `OnBehalfListingService` is about attribution - naming somebody else as
  the owner of a listing - and outreach is about pursuit. They share a permission and a first
  caller, which is the coincidence that makes merging them tempting; outreach is already wanted for
  listings nobody posted on behalf of, such as a stale listing whose owner has gone quiet.
- **Unresolved placeholders are left standing.** A visible gap in the preview gets noticed; a
  silently truncated sentence does not.
- **The ledger and the count answer different questions, deliberately.** Outreach may be written for
  any listing with an owner mobile, but the count that surfaces it is narrowed to staff-posted
  listings. Both rules are individually sound; together they mean a chaser sent on an owner-posted
  listing is recorded, audited, and never counted. Any surface showing "chased N times" has to read
  the ledger rather than the count, and the live outreach spec asserts exactly that so the
  disagreement cannot drift further.
- **`market_rate` resolves from `localities.rate_per_sqft`** - the same figure
  `GET /localities/{slug}` publishes to buyers, so the owner is quoted neither an invented nor a
  secret number. Most seeded localities carry no rate; those resolve to nothing and the key survives
  into the preview, which is the correct outcome - the staff member decides, having been shown there
  is no number. It is keyed on the FK-constrained `locality_slug` and on `active`, because a
  retired locality's rate is one the platform has stopped standing behind. `avg_buy_psf` /
  `avg_rent_psf` are deliberately not branched on: both columns are empty for every row, so the
  branch would be dead code. The number is not thousands-grouped because `{price}` beside it is
  emitted raw and WhatsApp formats neither - both should change together or neither.
- **`claim_link` resolves to the sign-in page.** The account is provisioned against the owner's
  own mobile, so signing in *is* the claim; there is no `/claim/{id}` route to build.
- **`listing_link` is built from the deployment's own `baseUrl`.** Templates that wrote the
  production host out by hand asked owners to confirm availability on production from a staging box,
  against a listing id that might not exist there.
- **The signature is read from the user row, not the token.** `AuthPrincipal` carries only
  identity and trust claims, so a renamed colleague would keep signing with the old name until their
  session expired. It falls back to the platform name rather than blank.
- **Counts are narrowed to staff-posted listings** before the `in` query, because only those
  render a count, and an empty selection short-circuits rather than emitting `in ()`.

## Case file advisory lock

Rationale relocated from `PropertyReviewRepository` Javadoc.

- **Why a lock at all.** `findByPropertyId(...).orElseGet(insert)` is idempotent when called twice
  in a row and racy when called twice at once: both transactions read no row, both insert, and the
  second dies on `property_reviews_property_id_key` - a moderator told "database rejected a write"
  for opening a listing somebody else opened in the same second. React's development double-mount
  fires the modal's open request twice concurrently, so this is not hypothetical.
- **Advisory, not a row lock, because there is no row to lock.** The contended resource is the
  *absence* of a row and `SELECT ... FOR UPDATE` cannot lock one. Locking the listing instead would
  serialise every writer of that listing against a case file being opened - a much larger promise.
  The key is derived from the property id, so two listings never wait on each other.
- **`pg_advisory_xact_lock`, not `pg_advisory_lock`**: released by commit or rollback, including
  the rollback nobody planned. A session-scoped lock leaked by a failed request would be held by a
  pooled connection, and the next listing whose id hashed the same way would hang rather than fail.
- **Correctness depends on READ COMMITTED** (Postgres's default and this application's): the re-read
  after acquiring the lock must see what the transaction ahead committed. Under REPEATABLE READ the
  snapshot would predate that commit and the insert would conflict anyway.
- **Wrapped in a subquery** because `pg_advisory_xact_lock` returns `void`, which is not a
  projectable type.
- **The desk queue sorts on `lastMessageAt`, not `updatedAt`.** `review_messages` owns the
  association, so posting a message inserts a child and leaves `property_reviews` clean - neither
  `@UpdateTimestamp` nor the `set_updated_at` trigger fires, and the case does not move. The
  column is total rather than coalesced, so the sort key means the same thing on every row, and
  `id` is a load-bearing tiebreak: without a unique final term Postgres may order equal instants
  differently per execution, and an unstable sort shows one case twice while skipping another.
  Sorting on `updatedAt` would put an assignment, an SLA stamp or a priority flag at the head of a
  queue meant to be ordered by who is waiting for a reply.
- **The owner-scoped page uses a subquery, not a join**, because `PropertyReview.propertyId` is a
  plain `UUID` column rather than a `@ManyToOne` - the case file owns nothing and there is no
  association to traverse. Cases holding only staff-only notes are excluded, matching the 404 the
  detail route gives: a card appearing the moment the duplicate probe fires would tell the owner the
  probe fired, which is the existence oracle the `internal` flag exists to close. The exclusion
  lapses once a moderator picks the case up, and never applies to a case with no messages at all.
