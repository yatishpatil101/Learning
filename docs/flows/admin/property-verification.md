# Flow: Property Verification Queue (Maker-Checker)

> The canonical maker-checker flow: an owner submits a listing, a staff checker ticks three facts
> (real photos, not a duplicate, details right) and approves, asks for info, or
> rejects (final). Ownership documents are **optional** — they earn the *Verified owner* badge and
> never gate publishing. It is **not** an identity gate on the owner either. Under
> **badge-not-gate (ADR-019)** the owner posts at L1 with no identity check; the opt-in Verified badge is a
> separate trust signal (see [`../../system/platform-architecture.md`](../../system/platform-architecture.md) §6.4 / ADR-019).
> **Status:** re-synced to the verification MVP (2026-09-29) - **Primary role(s):** admin / scoped verify staff (checker), owner (maker)

---

## 1. Purpose & user problem
- **Persona:** a back-office reviewer (admin, or a scoped "Properties - Verify" staff role)
  who protects buyers from fake, duplicate, or misrepresented listings; the owner is the counterparty
  who wants their property live.
- **Job-to-be-done:** "Only publish listings that are real, owner-posted and not duplicates." For
  the owner: "Get my property live — and, optionally, the Verified owner badge."
- **Why it matters:** listing verification is Draazy's core **supply-quality** gate. A listing is
  invisible to buyers until a checker approves it, so this queue is the single choke point that
  decides platform supply quality. It gates the **listing**, not the owner's identity or documents —
  posting itself is L1-only (ADR-019); the Verified owner badge is a separate
  ranking/trust signal. It is the reference implementation of the shared maker-checker pattern
  (see [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 2).

## 2. Entry points
- **Routes:** `/admin/properties`, one tab per queue — `verify` (To verify, the default), `recheck`,
  `badge` (Badge requests), `followup`, `flagged`, `duplicates`, `all`. Deep links: `?tab=<key>`,
  `?page=<n>`, `?review=<listingId>` (opens the review modal directly).
- **Tiles / triggers:** the admin dashboard "Pending Verification" / "Flagged" tiles and the command
  palette; each queue row's "Review" action opens `PropertyReviewModal`.
- **Desk layout:** each tab fetches only its own server page of 10 (`PAGE_LIMIT`); the tab pill counts
  come from `GET /admin/properties/summary`. One filter row per tab (search, deal chips, plus Progress
  chips on To verify and Status / Source / Featured on All listings) with the page range and
  prev/next on the same row. Rows carry a per-queue waiting clock (To verify 24h/48h from submission,
  Re-checks and Badge requests 24h/72h from the request) marked "due soon" / "overdue" in text, not
  colour alone. Each row is a card (the shared `.list-card .lr` layout): photo with Rent/Sale ribbon
  on the left; the middle is three groups split by rules (title, status, hard signals, locality and
  id; a labelled Property / Owner / Activity grid with fixed columns, dash when missing; chips and
  the progress tracker); a fixed-width right column holds Review at the top, then price, then icon
  buttons (Remind, View, Edit, Flag, Archive) at the bottom, so every tile lines up. No row selection and no bulk actions: every decision goes
  through the review modal. Follow-up sorts by last confirmation, a never-confirmed listing first.
- **What a tab holds:** every queue tab lists open items only, and its note says when an item leaves
  (To verify: approved or rejected; Re-checks: passed or taken down; Badge requests: granted or
  declined; Follow-up: owner confirms; Flagged: flag cleared or archived). Closed items are found in
  All listings by status.
- **Review modal:** two panes on desktop. Left: summary (title, status, price, locality, owner and
  mobile) over section tabs Overview (photos, description), Details (facts; location as separate
  Address / Society / Flat / Locality / City / PIN entries, "Not given" when missing, and a Google Maps
  link for the pin), Changes (only for an owner edit; opens first), Verified badge (opens first for a
  badge-only request: verdict strip, then flat sections for the facts to compare, owner's documents,
  recorded checks, record a check, badge decision) and Messages (thread with its composer in one box,
  then WhatsApp chasers and comms log). Right rail: checklist, decision, second approval, internal
  note. One column on a phone.
- **Source components:**
  - `src/pages/admin/AdminProperties.jsx` - tabs, paging, CSV export.
  - `src/pages/admin/properties/QueueTable.jsx` / `QueueFilterBar.jsx` - queue rows and filter row.
  - `src/pages/admin/properties/PropertyReviewModal.jsx` - per-listing review (docs, thread, decision).
  - `src/pages/admin/properties/review-modal/*` - `DocPill`, `DocViewerModal`, `WhatsappTemplates`,
    `CommunicationLog`.
  - `src/pages/admin/properties/PropertyModals.jsx` - flag / archive / edit / re-check reject modals.

## 3. Actors & roles
- **Maker = owner** (or a concierge "post on behalf" staffer). Submits the listing; cannot approve it.
- **Checker = any back-office account with the function.** `/admin` is shared by staff, managers
  and the admin; the page requires `properties:read`. Verification checks and ownership need
  `properties:verify` (`propertyVerification`); approve/reject/flag need `properties:moderate`
  (`listingModeration`).
- **Route guards:**
  - The admin shell is `RoleRoute roles={['staff', 'manager', 'admin']}` (`src/App.jsx`).
  - The page is wrapped in `ModuleRoute moduleKey="properties"`, which tests `properties:read`
    against the caller's own resolved atoms from `GET /me`.
  - `verifyOnly` is now `!canWriteModule(user, 'properties')` - i.e. read without write. The old
    `properties:verify` sub-scope is gone: it was a console invention with no route behind it, and
    `rbac.spec.js` asserts it does not reappear in the server's catalogue.
- The guards shape the UI; the control is `@PreAuthorize` on each moderation route, over the same
  atoms.

## 4. Entities touched
- [`properties` / listings](../../system/data-model.md) - **read** (queue), **updated** (`status`,
  the progress facts in §7, `flagReason`, `featured`, edited fields), **soft-deleted** (`archived`).
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
     stamps `status: 'pending'`; its progress reads **Submitted**.
  2. **Concierge / post-on-behalf** (`postedByAdmin`) - same `pending`, progress **Created**. It
     cannot be published until the owner confirms it (§7). The owner's optional Verified badge is
     not a step.
  3. **Re-verification** - an approved listing whose owner edits a **foundation field** reverts to
     `pending` (see 5.5); a restored archived listing also returns to `pending`.

### 5.2 The review record (per-listing checklist + thread)
One `property_reviews` row per listing (UNIQUE `property_id`), with a thread and a checklist.
- **The checklist is three facts, the same for rent and sale** (`VerificationCases`):
  1. Photos are real and match the listing
  2. Not a duplicate of another listing
  3. Details and location look right

  Case files opened before this set keep their stored document-name items (items are addressed by
  text and `item` is `updatable = false`).
- **Ownership documents are not on the checklist.** They feed only the optional *Verified owner*
  badge (ADR-019, badge-not-gate; see "Ownership gate" below). A listing goes live with no document.
- **Approve is blocked** until every line is ticked (`ApprovalGate`, 409 `checklist_incomplete`),
  on every approve route — single decision, `PATCH /status`, and relisting a sold/rented row.
- **Re-entering pending unticks the checklist.** `PropertyLifecycle.reenterPending` is the one door
  back into review (off-search edit, stays-live re-check on a pending row, relist, restore,
  clear-flag, needs-info resubmit), so a checker re-checks rather than inheriting old ticks.
- **Signals** (staff-only, `moderation/signal`) sit beside the facts they inform: photo match and
  duplicate conflict beside facts 1–2, the rule-based broker signals beside fact 3. Hard:
  `photo_match_other_account`, `brokerage_reports` (≥ 2). Soft: `many_societies` (> 2 active),
  `broker_wording`, `copied_description`, `many_localities_30d` (≥ 3). `possibleBroker` = any hard or
  ≥ 2 soft. A hard signal needs a second approver (§6).

### 5.3 Reviewer actions and their side-effects
All decisions go through `POST /properties/{id}/verification/decision`
`{ decision, reasonCode?, note?, expectedStatus? }` or `PATCH /properties/{id}/status`
`{ status, reason?, reasonCode?, expectedStatus? }`; both share one gate. `expectedStatus` that no
longer matches answers 409 `stale_decision`, so a second reviewer cannot silently overwrite a first.

| Action | Rule | Effect |
|--------|------|--------|
| **Approve** | All 3 checks ticked (409 `checklist_incomplete`); no hard signal unless co-approved (409 `second_approver_required`); a staff-posted listing needs its owner's confirmation (409 `owner_not_confirmed`) | listing `approved` + published, re-check cleared, owner told, audited with a checklist snapshot |
| **Needs info** | `reasonCode` required (`other` also needs a note) | listing stays `pending`; review `needs_info`, `properties.info_requested_at` stamped; owner gets the reason sentence. Owner reply **or** edit resubmits through `reenterPending`. The SLA clock pauses |
| **Reject (final)** | `reasonCode` required | listing `rejected`. An owner message **no longer** resubmits; reversal needs the two-staff override |
| Tick a check | `PATCH /verification/checklist`, `properties:verify`, never the owner | one line per call |
| Flag | reason required; refuses the owner and the staffer who posted on their behalf | off search |
| Clear flag | `clearFlag` → `reenterPending` (back to review, **not** straight to approved) | checklist unticked |

Staff thread messages with `clarificationRequested:true` are treated as **Needs info** with
`reasonCode:"other"` and the message body as `reasonNote`.
| Archive / Restore | soft-delete; restore → `reenterPending` | audited |

Reason codes: `photos_not_real, duplicate, broker, wrong_details, locality_unclear,
document_unreadable, name_mismatch, other` (CHECK in V67). Each has an owner outreach template
`reason_<code>`.

Needs-info housekeeping (`NeedsInfoSweep`, hourly): reminders on day 3 and day 7 after
`info_requested_at`, auto-archive (`needs_info_timeout`, soft) on day 14 with no reply or edit (V69, V81).

The four internal notes above go through `saveNoteIfAny` (`components/ui/InternalNote.jsx`), which
posts to `POST /admin/notes/property/{id}` **after** the decision has landed and reports failure
without unwinding it: the listing really was approved, and a toast that said otherwise because a
note did not save would be a worse lie than a missing note. The widget's history is a live read of
`GET /admin/notes/property/{id}`, so a note filed by one staffer is visible to the next — which is
the whole point, and something the previous localStorage store could not do. Notes also appear on
the review modal's **Communication log**, interleaved with the outreach ledger, since "what has
already been done about this listing" is one question and reading it in two panels made the
operator merge them by eye.

**The decision is one server transaction.** `decide` writes the case file, `properties.status` and
the owner-facing sentence together under a `PESSIMISTIC_WRITE` lock on the listing.

### 5.4 Visibility (the trust boundary)
- Only `status === 'approved'` listings are returned to buyers. `GET /properties` is hard-floored to
  approved + non-archived server-side, so `?status=pending` returns an empty page rather than a
  privileged one, and locality reads filter the same way.
- `pending`, `rejected`, `flagged`, and `archived` listings are never shown to buyers. Approval is
  literally what makes a listing exist for the public.

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
- **The Re-checks tab** (`/admin/properties?tab=recheck`) is where it gets drained. It fetches
  `?recheck=true` sorted by `recheckRequestedAt`, a sort only the moderation queue accepts
  (`PropertySort.sanitizeModeration`; the public search keeps the shared whitelist). A badge-only
  entry (reason `Ownership documents`) is excluded from `recheck=true` and from the summary's
  `recheck` count: it lives on the **Badge requests** tab (`?badge=true`, sorted by
  `ownershipRequestedAt`, counted as `badgeRequests`). Rows carry the changed fields and the waiting
  time, and the count rides in the tab pill — a queue nobody is *told about* is a queue nobody drains.
  Two moderator outcomes, both existing transitions: **Looks fine** (`approved`, listing stays live,
  re-check cleared) and **Reject** (`rejected` with a mandatory reason — a takedown with no recorded
  cause is unappealable). A stays-live re-check keeps the case's checklist ticks, and **Looks fine**
  skips the hard-signal co-approval (the listing is already live) but still requires the checklist,
  a checker who is not the owner, and an audit row. The same strip renders on every other tab too, because on `All Listings`
  an un-reviewed price change is otherwise indistinguishable from a verified one.
  Covered by `e2e/tests/admin/property-recheck-queue.spec.js`, which seeds through the product
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
- Non-foundation edits that still change *which property this is* are stays-live re-checks too:
  `societyId`, `electricityMeterNo`, a `carpetArea` change of ≥ 20 %, and a pin moved > 500 m
  (reason `location`). `floor` and `pincode` apply without a re-check.
- **The Verified owner badge is revoked** when `address`, `societyId` or `electricityMeterNo`
  changes (as well as on a deal flip): the evidence proved a different address or meter.

## 6. Maker-checker / approval
- **Applicable: yes. This is the canonical example.** See
  [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 2.
- **Maker (proposes):** owner submits a listing -> `status: 'pending'` (no buyer visibility yet).
- **Checker (approves/rejects):** staff with `properties:read` + `properties:moderate` or `properties:verify` who is neither
  the owner nor the staffer who posted the listing on the owner's behalf (`requireChecker`).
- **On approve:** every check ticked, listing `approved` and published, owner notified, audit row
  with the checklist snapshot.
- **On needs info:** listing stays `pending`, owner told the reason; their reply or edit resubmits.
- **On reject:** final, with a reason code. No owner resubmission.
- **Two-staff override** (V68 `property_verification_override_requests`, modelled on V60
  `badge_grant_requests`): approving over a hard signal, or reopening a final reject, needs a maker
  (`POST /verification/override-requests {reason}`) and a *different* checker
  (`POST /verification/override-requests/{rid}/approve`). The maker, the owner and `postedByStaff`
  are refused; the checklist is still required; both steps are audited. The staff case file shows
  `overrideRequest` so the desk can see "Awaiting second approver".
- **A staffer cannot decide their own listing.** `PropertyVerificationService.decide` compares the
  caller against `property.owner` and answers 403 *before* `requireCase`, because this is the one
  case where every other guard passes: a staffer listing their own flat is a participant in the
  thread *and* holds the review atom, so the listing would publish with nobody having read it.
  Pinned live in `e2e/tests/ops/verification-access.spec.js`, which also decides the same case
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
  last-write-wins race against a second reviewer on the same case. It carries `properties:verify`, not
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
                   reenterPending (off-search edit, relist, restore, clear-flag,
                   needs-info reply/edit) — unticks the checklist
                 +--------------------------------------------------+
                 v                                                  |
submitted --> pending --(4 checks [+ 2nd approver if hard signal])--> approved(live)
                 |   \--(needs_info)--> pending[needs_info] --(14 d silent)--> archived
                 |                                                  |
                 +--(reject, final)--> rejected --(two-staff override)--> pending
approved --(flag)--> flagged --(clearFlag)--> pending
approved|pending|flagged --(archive)--> archived --(restore)--> pending
```
- **Terminal-ish:** `rejected` (reopened only by the two-staff override), `archived` (restore ->
  pending).
- **Live** requires `status='approved'`; only this state is buyer-visible.

**Review `status`:** `in_review -> needs_info -> in_review ... -> approved | rejected`.

**Listing progress - one derived value, at most five steps.** `progress` (`ListingProgress`) is
computed on every owner and staff read from timestamped facts on `properties`; nothing stores a
stage, so no two writers can disagree (V81 dropped `lifecycle_*`, `pipeline_stage`,
`handback_milestone` and `property_reviews.needs_info_at`).

| Track | Steps | Moves on |
|---|---|---|
| Owner-posted | Submitted -> In review -> Live | checker opens the review (`review_started_at`); approve |
| Staff-posted | Created -> Link sent -> Owner confirmed -> In review -> Live | claim link marked sent (`claim_link_sent_at`); owner taps "Yes, this is my property" (`POST /me/listings/{id}/confirm`, `owner_confirmed_at`); review opened; approve |

- **Detours are flags, not steps:** `needs_info` (`info_requested_at`), `rejected`, `flagged`,
  `no_photos`, `opened` (claim link opened, not yet confirmed), `recheck`. The owner sees only
  `needs_info` and `rejected`; a flagged listing reads as In review to them.
- **`needs_info` pauses the current step** instead of adding one, because it is a loop a listing may
  repeat, not a stage every listing passes through. The tracker marks that step amber with "Waiting on
  owner" (staff) or "Waiting on you" (owner). The owner's reply or edit clears it, and the step resumes.
- **Publishing a staff-posted listing needs the owner's confirmation** (409 `owner_not_confirmed`).
  Staff-posted listings already published before V81 were grandfathered as confirmed.
- **Re-entry** (`reenterPending`) clears `review_started_at` and `info_requested_at`; the owner's
  confirmation is kept.
- Paused, sold, rented and archived listings have no progress; their status chip says it all.
- There is no manual stage control (`POST /properties/{id}/pipeline` and `PATCH /properties/{id}/lifecycle`
  are gone); each row shows its step as a chevron tracker.
- **Filtering:** `GET /admin/properties?progress=` takes `awaiting_confirmation`, `ready`,
  `in_review` or `needs_info`. The four buckets split the pending queue the same way the tracker does.
  All listings' status picker offers them beside Live, Paused, Sold, Rented, Not approved, Flagged
  and Archived, and To verify has Progress chips with the four.

## 8. Edge cases, validation & error states
- **Empty queue:** "All caught up — nothing waiting here.", or "No listings match these filters." when
  a filter is set (with Clear in the filter row).
- **Approve with unticked checks:** 409 `checklist_incomplete`; the button stays disabled until all
  three are ticked.
- **Needs info / reject without a reason code:** 400 `reason_code_required`; `other` also needs a note.
- **Flag without a reason:** blocked - "Add a reason before flagging".
- **Edit validation** (`submitEdit`): title required, price a positive number, area non-negative,
  locality required.
- **SLA:** one 24 h target — amber at 12 h, red at 20 h, overdue at 24 h (`lib/moderationSla.js`),
  paused while `needs_info`. Staff-posted listings whose owner has not yet confirmed (step `created`
  or `link_sent`) are "awaiting owner" (Needs Follow-up tab).
- **Duplicates:** same owner is a hard block at create. Cross-owner clusters (meter, address key,
  perceptual photo hash) surface in the Duplicates tab with a Conflict chip; `resolveDuplicate`
  archives the loser, `dismissDuplicate` clears a false positive. A staff-only
  `same_society_bhk_area` hint (same society, BHK, carpet ±10 %) appears in the cluster view only —
  never in the create-time probe, where `society_id` is client-asserted.
- **Concurrency:** decisions lock the listing (`PESSIMISTIC_WRITE`) and carry `expectedStatus`; a
  decision made against a stale view answers 409 `stale_decision`.
- **Staff document access (DPDP):** staff may open an owner's vault document only while the case is
  open or within 30 days of the decision (403 `document_access_expired`). The owner's file is never
  deleted — the vault also serves buyer document requests.

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
  principal as well as declared on the route) and audited, because it mints signed URLs to title and
  address documents. Staff may make it only while the case is open or within 30 days of the decision
  (`OwnershipDocumentAccess`, 403 `document_access_expired`). A signed URL outlives the request and is fetched straight from the object store, so
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
- **A badge request is explicit, and rides the stays-live re-check, not a new queue.** Filing a paper
  in the vault asks for nothing. The owner presses **Request Verified badge** in the Dashboard
  Document Vault (`POST /properties/{id}/verification/ownership/request`, owner-only; 409
  `already_verified`, `listing_not_open`, `documents_missing`; idempotent). That stamps
  `ownershipRequestedAt`, clears any earlier decline and calls `Property.requestOwnershipReview`.
  On an approved (or paused) listing this queues the re-check item `Ownership documents` (§5.5).
  The listing stays live, lands in the Re-check Queue, and `resubmittedAt` is stamped. A pending
  listing is already in front of a reviewer, so only the request stamp is set. Granting the badge
  closes the request and drops only that item. Staff answer "no" with **Decline badge request**
  (`POST .../ownership/decline`, `{reason}`, required, max 300; 409 `no_open_request`). Decline
  leaves the listing status untouched; re-approving a paused listing would publish it. The owner
  gets a `listing.badge_declined` notification carrying the reason and linking back to the vault.
  The quick "Looks fine"/takedown buttons are hidden for a badge-only item: neither is a badge
  decision. The list-property wizard (posting and editing) carries no document upload at all.
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
- **Reviewer capability is read per account.** `properties:verify` / `properties:moderate` are `BackOfficePermissions`
  atoms held per account; `PermissionMap` is keyed by desk and speaks the `Capabilities`
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
  needs **any one** current document in the lister's name — an address proof (MSEDCL light bill, tax
  receipt) or a title proof — reported as missing `address_or_title_proof`. The light bill is the
  lead document: owners share it freely and its consumer number is also the strongest duplicate key.
  A sale needs **one** title document (`title_proof`: Index II, share certificate, 7/12, 8A,
  property card), because the buyer is paying for the title. Site photographs and the deed remain
  recordable as supporting evidence but do not gate the badge.
- **No new Aadhaar/PAN evidence rows** (422, "Identity comes from the account's identity
  verification"). Identity is reused from the account's KYC outcome — DPDP data minimisation.
  Legacy rows stay readable.
- **A sale deed does not establish title here.** It is the stronger document in law and the weaker
  one to a reviewer: a deed is a PDF whose contents cannot be checked against anything, whereas
  Index II is the IGR's own extract and can be read back from the registry by the document number
  printed on it. The gate states what the platform can *verify*, not what conveys ownership, so the
  deed is filed as `TITLE_SUPPORT`.
- **Maharashtra land records are title proof for plots and land.** A recent 7/12 extract, 8A extract
  or Property Card can satisfy `TITLE_PROOF`; all three expire after 90 days because mutation
  entries can change who currently holds the record.
- **Power of Attorney is authority proof, not title proof.** File it as supporting evidence, name the
  principal/owner in `subjectName`, and do not count it toward either the rent or sale gate.
- **A sale POA must be registered in Maharashtra.** For immovable-property sale authority,
  Registration Act s.17 as amended for Maharashtra requires registration; reviewers check the
  registration number and stamp before relying on it.
- **Why some documents expire.** A registration record or a government identity document records a
  fact that does not change. A tax receipt or electricity bill proves only that the person was
  paying at the time it was issued - which is why they are useful as recurring proof and why they go
  stale. A property-tax receipt is annual, so it holds until 31 March (IST) of the financial year it
  was issued in. Site photographs sit between. Every window is measured from the document's own issue date,
  never from the review, so reviewing an old receipt today cannot mint a badge good for years.
- **Unrecognised deal intent falls to the sale gate.** Defaulting the other way would make an
  unknown intent grantable on one electricity bill, which is the failure mode the gate exists to
  prevent.
- **Strings, not a Java enum**, matching the rest of the wire vocabulary: the value is persisted,
  appears in the contract, and is checked by a `CHECK` constraint, so a rename without a migration
  must show up as a data mismatch rather than compile cleanly.
- **The owner's own vault label is a second opinion.** A file the owner filed as an Electricity Bill
  must not close `title_proof` on a sale badge. It is treated as a contradiction, not an absence -
  most vault labels (society NOC) name no evidence type, so an unrecognised one
  leaves the judgement with the reviewer who has opened the file.
- **`subjectName` is required for identity and authority documents**, derived from the kind rather
  than listed again so a fourth identity document inherits the rule. The identity-subject CHECK is
  in V08, and the POA principal CHECK is in V63.

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
- **`market_rate` resolves from `localities.rate_per_sqft`**, so the owner is quoted neither an
  invented nor a secret number. Most seeded localities carry no rate; those resolve to nothing and the key survives
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
