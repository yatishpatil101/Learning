# Frontend data seam (services → HTTP)

How the React app reaches the API, and the boundary that keeps a page from replacing a server-owned
record with browser storage. There is one data source: the live backend.

## The rule

> **Pages, components and hooks import from `src/services/*`. They must never import data functions
> from `src/lib/*` — `lib/store*`, `lib/data/*`, `lib/properties-admin.js` — for anything that has a
> backend endpoint.**

```
pages / components / hooks
        ↓  (only this direction)
src/services/<domain>Service.js        ← stable public API, never changes shape
        ↓  createProvider('<domain>')
src/services/providers/http/…          ← wire calls + mapper
        ↓  services/http.js
API_BASE  ( "/api", or an absolute VITE_API_BASE )
```

`services/config.js` resolves a domain to `providers/http/<domain>Provider.js` through a **lazy**
`import.meta.glob`. There is no allow-list, no per-domain switch and no fallback: an unknown domain
throws at the call site naming the domains that do exist, because with nothing to fall back to, the
alternative to a screen that fails loudly is a screen serving data from nowhere.

Two properties of that resolver are load-bearing:

- **The glob must stay lazy.** `{ eager: true }` reinstates the `http.js → config.js → providers →
  http.js` cycle and a blank-page bootstrap that no build or lint can see.
  `scripts/check-provider-cycle.mjs` asserts it.
- **The cache holds the promise, not the module**, so concurrent first calls share one import, and a
  rejection is evicted so a throw from a module body can be retried. A dynamic import that never
  arrives is re-thrown with `code = PROVIDER_LOAD_FAILED` — the seam can observe only that the
  module did not load, and the screen above it decides what to say about that.

## Why it matters

A direct `lib/` import sits **below** the seam. Nothing in the service layer has an opinion about
it, no configuration can redirect it, and it cannot be found by reading the service. One page
reading the API while twenty read localStorage is a half-real UI, and it presents as a mapping bug
rather than as a missing integration. **A seam with a bypass is not a seam.**

**Enforcement:** grep `pages/` and `components/` for direct `lib/` data imports before shipping.
Zero results = zero leaks. The deliberate exceptions are named below and each carries a SEAM NOTE at
its call site.

## Domain map

| Domain | Service | Notes |
|---|---|---|
| `auth` | `authService.js` | login, staff-login, refresh, logout, `GET`/`PATCH /auth/me`. Tokens are read through `lib/auth.js` **at call time** and never captured: refresh **rotates**, so any holder of a copy — a second tab, a retry queue that kept headers — presents an already-rotated token, which is what theft looks like, and ADR-008 reuse detection revokes the family |
| `property` | `propertyService.js` | search, detail, featured, counts, by-id, `GET /me/listings`, archive/restore, the duplicate probe, and the whole moderation surface — `GET /admin/properties` plus approve/reject, feature, flag, clear-flag, pipeline stage. `listForModeration` is a **separate operation**, never a flag on `listProperties`: `GET /properties` takes no principal and is hard-floored to approved + non-archived, so `?status=pending` returns an empty page and a staff caller gets byte-identical results to an anonymous one. An authorization-relevant routing decision must be **named by the caller**, never inferred from an ambiguous flag. The four moderation writes resolve with **no body** (bare `200`/`204`) — derive the new state from the row already on screen, because a re-read through `GET /properties/{id}` 404s for pending, rejected, flagged and archived. `clearFlag` sets `approved` unconditionally. `denySelfDealing` answers **403** when the actor owns the listing, so partial failure in a bulk action is expected and every bulk path uses `Promise.allSettled`. Moderation routes are **UUID-only**. `ListingUpdate` deliberately omits `status` and `flagReason`, so a field edit and a status change are two calls. `spring.data.web.pageable.max-page-size=100` is the ceiling on every page size |
| `contact` | `contactService.js` | gate status, request, owner inbox (paged), respond, pending count. Keyed on `propertyId` — the grant is per listing. A signed-out visitor must not fire a status read. The quota refusal is a **422 `contact_quota_exhausted`** on `POST /contacts/request`, and that is where the decision belongs |
| `entitlement` | `entitlementService.js` | `GET /me/entitlements` → `{ contacts: { unlimited, used, allowance, remaining, referralBonus }, listings: { allowance, referralBonus } }`. **It reports; it gates nothing.** Reading `remaining` and skipping the request would put the decision back in the browser and be wrong as well as unsafe — another tab or device may have spent or earned since the fetch. Neither number is stored: `used` is `count(contact_requests where requester = me)`, made race-proof and idempotent by `uq_contact_requests_requester_property` (V9), and `referralBonus` is recomputed per read, which is what makes clawback whole — there is no grant to reverse |
| `saved` | `savedService.js` | `GET /me/saved` returns rows, not ids; `PUT`/`DELETE` are idempotent. Membership is answered from `SavedContext`, never one request per card |
| `savedSearch` | `savedSearchService.js` | list/create/patch/delete. The seam flattens the server's `filters` jsonb onto the record and derives `alerts` from `alertFrequency`. `matchCount` is a **field on the record, not an endpoint**: the facets are multi-valued (`localities[]`, `bhk[]`) and `/properties` takes one value each, so counting in the browser would cost \|localities\| × \|bhk\| requests per search, while answering it where the record is already read costs one `count(*)` on a list capped by `MAX_SAVED_SEARCHES`. Anonymous lead capture stays local |
| `visit` | `visitService.js` | `/visits` (mine) and `/me/visit-requests` (on my listings), create, status. The seam carries the human `when` string and `visitWhen` converts to and from the wire's ISO slot. **Reschedule has no endpoint** — the control is absent rather than left to fail, because a control that lies is worse than one that is missing |
| `notification` | `notificationService.js` | `GET /notifications` (paged), `POST /notifications/read`, and `GET`/`PUT /me/notification-preferences`; the writers honour quiet hours by **deferring** the row. There is **no delete endpoint**, so dismiss is a client tombstone (`dzDismissedNotifs`) held inside the provider: it does not sync across devices and clearing site data brings the row back. Saved-search and saved-property alerts have no server slot and are client-derived, merged per read. A client never writes into another user's inbox — the server raises `document.granted`, `service.draft-shared`, `service.party-invited`, and `ConversationService.send` raises `message.received`. Only the flatmate flows and conversations write rows today, so a non-flatmates inbox is legitimately sparse; the gap is in the writers, not the seam |
| `conversation` | `conversationService.js` | inbox (paged), start, detail, reply, mark-read. There is **no `state` field**: a thread cannot exist before an approved contact request, so accepting and declining belong to the contact gate one layer up. A thread carries **`staged`** — `false` for a thread the server has, `true` for one queued client-side under `dzPendingRequests` because the gate has not opened yet. Staging is what lets the property page keep one CTA instead of making it appear and disappear on state the user cannot see; the queue **re-reads the listing** when it drains rather than trusting anything captured at queue time, since the owner's mobile is masked until the gate opens. `ConversationDto.messages` is omitted from the *list* contract, so an inbox row arrives with `messages: []` and the transcript is a second read on open — `hydrate(id)` exists so there is exactly one place to forget it. `MessageCreate.attachments` is declared in the contract and not implemented |
| `review` | `reviewService.js` | property reviews and entity reviews, read and write. `GET /reviews/{entityType}/{entityId}` is one route over several target types; society and locality are keyed on the **slug**, which is what the hub, the follow writes and the URL already use. There is no owner-profile target on the wire, so owner reviews are not part of this domain. `title` is accepted on create and rendered nowhere — left unused rather than invented, since an empty heading on every card is not an improvement |
| `support` | `supportService.js` | list, create, detail, reply, mark-read — a bare list with the thread inline. **Priority and attachments have no field on the schema**, and an unknown property is ignored rather than rejected, so the page *hides* both controls: a form that kept sending `priority` would toast success for a ticket ops never sees as urgent, which is worse than an error because nobody learns anything. The raiser is the session; name and mobile are prefilled from it and do not travel |
| `report` | `reportService.js` | `POST /reports` is open to any signed-in caller; `GET /reports` and `PATCH /reports/{id}` are staff/admin — the two ends have different audiences, and the consumer modal and the ops queue never call each other's operations. A second **live** report of the same target by the same person is **409**, backed by a partial unique index rather than only a check, so two concurrent submissions get the same answer. `actioned` and `dismissed` are **terminal**: there is no reopen, because reopening erases the record that somebody judged it and is the obvious way for one moderator to quietly undo a colleague. There is no `resolved` — the queue's word for "reviewed, no action needed" is the server's `dismissed`, translated on the way out only |
| `plan` | `planService.js` | `GET /plans` (**public** — the pricing page has to render for the signed-out visitor it exists to convert), `GET`/`POST /me/subscription`. Held in `PlanContext` because the questions are asked during render rather than awaited, and six independent reads would be six chances to disagree the moment a purchase changes one. **`pending` is not `active`**: on a priced plan the server creates the row `pending` against a payment-gateway order and only the signature-verified webhook activates it, so entitlement is `status === 'active'`, never "the POST returned 200", and checkout has three end states rather than two. The catalogue price is authoritative — `SubscribeRequest` has no price field, so a number rendered from anywhere else is a claim *about* the charge, not the charge |
| `deal` | `dealService.js` | the transaction cluster — `/me/deals` (+reserve/close/reopen/parties), `/offers` (+respond/mine), `/me/offers`, `/finalization/*`, `/me/finalization-requests`. Every signature dropped its `ownerMobile`: **the token scopes the read**, and a parameter naming whose data to read is one any caller can point at anyone. Accept/decline is the listing **owner** only (403 otherwise) — so the buyer's response is "Agree at ₹X", a counter at the owner's own number, leaving the owner the party who closes. A second live offer on one listing is **409**; closing requires a positive price and a real 10-digit mobile, and refuses a mask. A buyer cannot learn a listing is sold: closed-ness lives in `deals.status`, which is owner-scoped, and `properties.status` has no `sold`. `GET /finalization/{propId}/status` resolves only `pending` rows, so a declined request reads the same as never having asked, and **404 is this domain's normal "nothing pending"** — which is why the finalize card is gated on `contactApproved` rather than asking a question whose answer could not change the screen |
| `rent` | `rentService.js` | `/me/tenancies` + `/tenancies`, `/me/tenant-profile`, `/tenant-profiles/{mobile}`, `/me/rent-agreements`, `/me/finances/{propId}/*`, `/me/rentals`. A tenancy is not created directly — closing a **rent** deal opens one in the same transaction, which is why this sits on top of the deal domain. **No rent moves through here**: `/me/rent-payments`, `/me/rent-ledger`, `/me/rent-mandate` and `/me/payout-account` were withdrawn with their tables in V127. `financeSummary`, `cashflowByMonth` and `getDues` are endpoints rather than client reductions, because the ledger is paged and a reduction over one page wears the label of a summary of everything. `/me/rentals` is one self-declared note a tenant writes about a home they rent elsewhere — `tenant_rentals` has no `property_id`, there is no month-by-month entry, and the server derives months, lifetime and financial-year totals from `leaseStart` |
| `flatmate` | `flatmateService.js` | `/flatmates/rooms` (+seats/occupants/interest/agreement), `/flatmates/groups` (+seats/join/owner-consent), `/flatmates/posts` (+interest), `/me/flatmate-requests`, `/flatmates/feed`, `/properties/{id}/rooms` + `/split`. Two tabs over **three** resources — move-in reads rooms, team-up reads posts *and* groups — so a tab is not an endpoint and the tab counts are not the resource counts. **`/flatmates/feed` is the board's only search** and answers the whole question: every facet (`q`, locality, budget range, gender, verified-only, move-in window, habits, attached bath, sharing, a lat/lng radius), every sort including *best match*, the row count, the verified count and the page. A client that filters must also count, sort and page, and it can do none of the three honestly. The three record types are searched as one `UNION ALL` and windowed together, so the tabs interleave by rank rather than by concatenation; the client keeps only what reads a row already fetched — map pins, card badges, the price a card prints. Seats come from the host's `seatsOpen`, never `members.length`: a group with three members can still have two open seats, because it is a flat and not a table. Joining an **open-policy** group returns `accepted` with `decidedAt` stamped; a closed one returns `pending`. Ids are the server's — a client that mints `'s' + Date.now()` has the value discarded and every reader matching on it broken |
| `serviceRequest` | `serviceRequestService.js` | the concierge flow — `GET /service-requests` (paged, type-filtered), `GET`/`POST /service-requests`, `POST /{id}/messages`, `POST /{id}/read`, `POST /{id}/draft/decision`, `DELETE /{id}/parties/{partyId}`, `PUT /{id}/identities`, plus the drafting desk's queue, claim and identity reads. `details` is a structured object that round-trips, so the tracker renders its summary from the server read instead of retaining a browser copy. A decision maps `accepted` → `approve` and anything else → `reject`; a rejection parks in its own `changes-requested` status and returns the request to ops rather than failing. The customer's note lands in the **message thread**, not on the request, so `draftDecision.note` is empty on a live read. Draft and final documents are `multipart/form-data` to the vault and the signed URLs do not resolve on a dev backend; the per-request document checklist and the staff transitions are desk concerns with no customer control, and a missing server representation is shown as unavailable rather than simulated |
| `verification` | `verificationService.js` | the opt-in "Verified" badge. `GET /me/verification/identity` is **always 200** — a never-tried caller reads `{status:'none'}`, because the absence of a badge is a state and not a missing resource — and multipart `POST /me/verification/identity` answers **202**: acceptance into the staff review queue, *not* a granted badge, so a submission reads back **pending** until a reviewer decides. Three submissions per rolling 24h; a dedup collision at approval is `409 identity_already_registered`. `POST …/simulate` is `@LocalOnly` and **404s without a filed case** — it decides one, it does not dispense a badge. Held once in `VerificationContext` (null-safe outside the provider) and read by eight surfaces, so one refresh lights all of them. **A badge, never a wall** (ADR-019): nothing is withheld for its want, and the one place identity has teeth is the server-side contact gate, which reads `users.verified` live. The document number does cross the wire inside `claims`, and the server keeps only `HMAC(docType:number)` and the last four — so the honest sentence is "we do not store it", not "it never leaves your device"; the image is on the same request either way |
| `propertyReview` | `propertyReviewService.js` | the property-verification case file — `GET`/`POST /properties/{id}/verification`, `POST …/messages`, `POST …/read`, `POST …/decision`, and the staff queue `GET /admin/property-reviews`. **Named for the collision it avoids twice over**: `verificationService` is the identity badge and `reviewService.listPropertyReviews` is consumer star ratings, hence `listPropertyReviewQueue` for the desk. `{id}` is the listing **UUID, never the slug**. The request verb is `approve`/`reject` and the resulting status is `approved`/`rejected`; an unrecognised verb is a **400 rather than a default**, because `startsWith('approve') ? … : 'reject'` makes every typo a rejection — the destructive, owner-visible, audit-logged side of the branch. Deciding writes **three** places server-side (the case file, `properties.status`, and an owner-facing sentence posted into the thread), so a console must not also call `setListingStatus`. The checklist is read-only `{item, pass}` with no write route, and the queue takes a `Pageable` and nothing else, so a "pending only" desk is filtering a page rather than the queue. `reviewer` is a raw user **UUID**, not a handle. Access is participant-or-staff and a stranger gets **404, not 403**, so it cannot be used to confirm a listing is under review. A message may be `internal`: internal messages are filtered out of the owner's copy entirely, so a case holding only internal notes answers the owner **404 rather than an empty thread** — an empty thread still tells them a file has been opened on them. `internal` is on the wire (and false in every owner-side response) because filtering alone left staff unable to tell a staff-only finding from something the owner was actually told; it renders in a separate amber lane with no `You (Draazy)` attribution. The read is gated on the `properties:read` **grant** rather than the bare staff role, because it is participant-or-staff and an owner holds no grants at all. Desk sort is `last_message_at desc, id desc` |
| `settings` | `settingsService.js` | `GET`/`PUT /admin/settings`, both `x-roles: [admin]`. No mapper, deliberately: the server stores one row per top-level key and folds them on read, so the key set is open by construction and a mapper would either enumerate it — dropping the next key someone adds — or pass it through. Writes **merge**: send only what you actually changed, because a block you did not read is still a block you are asserting. That is not pedantry — a whole-object write means a failed read followed by one toggle persists the all-`true` defaults over every flag the operator had set. Objects merge key by key; arrays and scalars replace whole (`geo.blacklist` is an ordered list). `getCustomRoles()` answers `[]`, which is the correct answer and not a stub: V61 deleted the key and `PUT` returns **422** for it. The optional `If-Match` precondition is **not sent** — honouring it is UI work (surface the 412, re-read, re-apply), and sending the header without that handling turns a rare silent overwrite into a frequent unexplained failure |
| `society` | `societyService.js` | the directory and everything hanging off a society — `GET /societies` (carrying `avgRating`/`reviewCount` per row, so a 348-card grid is one request and not 348), `GET /me/societies/following`, idempotent `PUT`/`DELETE /me/societies/{slug}/follow`, membership and residency, claims, Q&A, the board, contributions and the admin view. Keyed on the **slug** throughout: `soc.id` is the synthetic `S01` minted by `data/societies.js` and the server has never heard of it, which is why the follow seam narrows the server's rows down to slugs and `FollowedSocietiesPanel` resolves each slug through the local catalogue to get the id `listingsInSociety` joins on — a server UUID there would silently match nothing. A per-row `followedByMe` and the `GET /me/societies/following` list are **not substitutes for each other**: the first answers "is this one followed?" for a society already in hand, the second answers "which ones do I follow?" for the surfaces with no page of societies to hang the question on. Membership is answered from `FollowContext`, never per card; writes are optimistic with rollback and `toggle` returns the state it **settled** on, because a toast reporting the attempt rather than the outcome promises an alert the server never recorded. `avgRating` is **null, not 0**, for an unrated society — "unrated" and "rated zero" are different claims. A follow on a society this browser minted is kept in `dzLocalSocietyFollows` and retried on every load: the server refuses a slug it does not know, correctly, and syncing it would put a row on the next device pointing at nothing |
| `note` | `noteService.js` | what the back office knows about a case — `GET`/`POST /admin/notes/{entityType}/{entityId}`, `PATCH /admin/notes/{id}`, gated on `notes:read` / `notes:write` (both `ops(...)`, so an ordinary staffer holds them; there is no per-team wall, deliberately — a note nobody else can read is one the next person on the case rewrites from scratch). Notes are **mutable** — retained customer information that goes stale, not a signature — and an edit records the previous wording on the audit row while leaving the original author on the note. There is **no delete route**. The author is resolved server-side from the token and re-read from `users` at list time, so renaming a staffer renames them on their old notes too. The four listing writers go through `saveNoteIfAny`, which posts **after** the decision has landed and reports failure without unwinding it: the listing really was approved, and a toast that said otherwise because a note did not save is the worse lie. `GET` returns a **bare array**, not a page envelope — a case file with enough notes to paginate is a case, not a queue |
| `document` | `documentService.js` | **Owner side only.** The per-listing vault (`GET /me/documents/{propId}`, multipart `POST`, `DELETE`), the personal/KYC bucket (`/me/documents/personal`), the managed vault (`GET`/multipart `POST /me/documents/managed/{managedId}`, `DELETE …/{docId}`), and the owner's request inbox (`GET /me/documents/requests`, `PATCH …/{reqId}` to grant or decline, where anything not `granted` clamps to `declined` so a typo is a safe no-op rather than a leak). The managed vault is a **separate table** (V93) rather than a nullable foreign key, and three more exports rather than a boolean on the per-listing three: the papers on a flat you own but have not listed are not shareable with buyers, which is the invariant the separation buys, and live they are different routes against a different table. The **buyer's half** — ask, poll, open a shared bundle, token-mediated — has no status read on the wire, so there is nothing for a buyer's tracker to poll, and the vault's signed `url` does not resolve against a dev backend |
| `managed` | `managedService.js` | the owner's private property record — `GET`/`POST /me/managed-properties`, `GET`/`PATCH`/`DELETE /me/managed-properties/{id}`, `POST …/{id}/publish`. **Publish can be refused**: a managed record is captured loosely — free-text furnishing, a price that may still be zero — and the marketplace contract is stricter, so the server re-runs listing validation at that boundary and answers **422**. Every caller needs an error branch. The bridge runs both ways: publish is managed → listing, and for the owner who advertised first, `POST /me/managed-properties` takes an optional `publishedListingId` — the one lifecycle field a body may set, and only on create. A listing that is not the caller's is **404** (a 403 would confirm it exists, which is the probe an enumerator is running) and one already spoken for is **409**, because the caller can see it: it is theirs. The partial unique index in V93 says the same thing a layer down. `loadOwnerProperties` reads the managed set **once** and dedups client-side rather than firing a create per card |
| `enquiryBoard` | `enquiryBoardService.js` | the back-office demand desk — `GET /admin/{enquiries,visits,deals}` and `GET /admin/{enquiries,visits,deals}/{id}`. **The list masks and the detail reveals**: `98XXXXX210` on every row, and an administrator who needs the real number opens that one row — a separate request on a raised role (`hasRole('ADMIN')` over the same `enquiries:read` atom, exactly as `TIMELINE_READ` does; a new atom would be a new checkbox for something that is not a separate capability) which writes an `audit_log` entry *before* answering. `?reveal=true` on the list was rejected: a parameter makes bulk disclosure a single request and reduces the audit trail to "somebody looked at forty numbers". The audit row stores the **masked** value, so the log is not a second copy of the secret, and the deals route also records `source: off-platform | account`, because a counterparty mobile may have been typed by an owner closing privately and belong to nobody with an account here. **No writes** — the board is read-only, and "mark responded" adds an internal note on the listing through the `note` domain instead of flipping a status on a conversation the platform is not party to |
| `recentSearch` | `recentSearchService.js` | `GET`/`PUT /me/recent-searches` — the signed-in "resume your search" rail. **The one domain whose source is chosen by who is asking**: the *service* branches on the session, signed-in to the provider and anonymous to `lib/localPrefs.js`, because a trail nobody signed in to create has no account to belong to. That branch lives in the service, not in the three call sites and not in the provider, which stays a dumb wire mapper. **Dedupe is by normalised URL, never by label** — query parameters sorted, so `?deal=rent&loc=baner` and `?loc=baner&deal=rent` are one chip, while "3 BHK in Baner" with and without a budget filter stay two rows. The **cap of six is enforced on write** and `PUT` answers with the whole rail, so no client models the eviction. The stored URL is handed back as a link the account's own UI invites the user to click, which makes a permissive path rule a stored-redirect primitive: the server takes an **allowlist of exactly the two search routes**, so a third search page is added here deliberately. Backed by `engagement.history` rather than `engagement.search` — a saved search is a standing subscription, a recent search is a footprint, and folding them together would give footprints an alert frequency |

`providers/http/` holds one provider per domain, plus the mappers they share. The invariant is that
services and providers match: a provider with no service is unreachable, and a service whose
provider is missing throws at the call site with the list of domains that do exist. The rows above
are the domains carrying contract facts worth writing down; the rest — analytics, audit, city,
content, fees, locality, permissions, photos, referral, staff activity, teams, tickets, users —
follow the same shape and are documented at their service files.

### Why `countProperties` / `getPropertiesByIds` exist

Several pages used to load the **entire catalogue** and reduce it client-side — a locality count, a
saved-list lookup, a compare picker. Against a paginated API the answer silently becomes "…of the
first page". Both operations push the work to the server, and `countProperties` is exact because
`totalElements` on a `size=1` request counts the whole result set rather than a page. No new
endpoint was needed for either. `getPropertiesByIds` drops unknown ids rather than throwing or
leaving a hole, and preserves request order — the behaviour Saved and Compare depend on when a
listing is archived later.

`myListings` is a correctness fix rather than an optimisation: public `/properties` is hard-floored
to approved + non-archived server-side, so an owner's pending or rejected rows **cannot** be derived
from it at all. `GET /me/listings` is the only source that returns them. That is also why narrowing
by `isApproved` is sound over `myListings` and meaningless over a public search, where every row it
will ever see already passes.

## Wire contracts the mappers hold

- **`PageEnvelope.page`, not Spring's `number`.** The contract calls the current page `page`, and so
  does the server. A fallback to the *requested* page agrees right up until it disagrees — any clamp
  or redirect and the client reports a page the caller is not on. `total` comes from
  `totalElements`, which counts the whole result set. The rows are under `content`, not `items`;
  reading the wrong key produces silently empty pages rather than an error.
- **`at` is ISO-8601 on the wire and epoch millis in the browser.** Notifications, recent searches,
  support threads and document lists all sort on it and do date arithmetic with it. An ISO string
  sorts *lexicographically*, which for same-format timestamps is mostly the right order — so this
  survives casual testing — and makes every relative time `NaN`. The mappers `Date.parse` it.
- **`propertyMapper` sets `id = slug || id`** and stashes the real UUID on `uuid`, because the
  property routes accept slug-or-id and a slug makes a prettier URL. Deal, finance, moderation and
  property-verification routes parse with `Ids.parseUuid` and 404 on anything else, so those call
  sites pass `listing.uuid || listing.id`.
- **Property renames**: `type` → `propertyType`, `bhkNum` → `bhk`, `image` → `coverImage`,
  `gallery` → `images`.
- **`archived` is its own axis, not a sixth status.** Archiving preserves the moderation state it
  was archived from and restoring resets to `pending`, so the query param is tri-state — omitted
  means both, because "everything" and "only the live ones" are different questions a two-valued
  flag cannot ask. It is a real field on the wire; a mapper that hard-codes `archived: false` makes
  every archived listing look live and leaves the Archived filter permanently empty.
- **`possession` is the wire vocabulary; `construction` is the UI's.** `ready-to-move | new-launch |
  under-construction` ⇄ `ready | new | under`, translated by the mapper in both directions.
  `possession=new` would be ambiguous in a long-lived public contract, and translating is a far
  smaller diff than renaming every UI read site and its i18n keys. `NULL` is legal and means *not
  stated* — deliberately distinct from all three values, so an unrecorded listing never satisfies a
  "Ready to move" search (plots stay there permanently). An unrecognised value maps to `undefined`
  **and warns**: degrading gracefully and degrading silently are different things.
- **`localitySlug` exists deliberately — do not "simplify" it away.** `localities.slug` is the
  primary key and `properties.locality_slug` / `societies.locality_slug` are real FKs to it;
  `localities.name` has no uniqueness constraint at all. The slug is the public URL key
  (`/locality/{slug}`), so it is SEO-load-bearing and must survive a display rename, and the search
  facet matches the slug rather than the display name — `?locality=baner` returns 2 results,
  `?locality=Baner` returns 0. `catalog.locality.LocalityResolver` mirrors the client's
  `resolveLocalitySlug` with one deliberate difference: it returns `null` rather than coining
  `slugify(name)`, because the column is FK-constrained and coining would pollute the curated
  locality table, and the sitemap, with owner typos.
- **`recheckPending` is a primitive boolean so it always serializes**, beside `recheckReason` and
  `recheckRequestedAt` (both omitted when clean). Without the three, two edit outcomes are
  indistinguishable to any client: `locality`, `propertyType`, `bhk` and `deal` revert a listing to
  `pending` and take it off search, while `price`, `furnishing` and `possession` leave it approved
  and searchable and queue a background re-check — which looks exactly like no edit at all.
  `npm run check:listing` fails the build if the client's mirrors of that set drift from the
  server's, and `ListingFoundationTest` reads the facets off the controller by reflection, so a new
  search facet fails the build until somebody decides which of the two sets it belongs to.
- **Review `context` is server-derived and never sent by the client.** It is the reviewer-standing
  badge — "Verified resident" or "Visited" — marked `readOnly` in the contract, absent from
  `ReviewCreateRequest`, and computed from the author's visit and tenancy history. A null `context`
  must render **no chip**: a badge a browser can assert about itself is not evidence, and evidence is
  the only thing that makes a stranger's rating worth reading.
- **`managedMapper` holds four translations and none are cosmetic.** `deal` is `rent`/`sale` in the
  browser and `rent`/`buy` on the wire, so a missed conversion is a hard 422 on every sale record;
  `bhk` is one number on the server while the view model keeps the `2 BHK` label too, re-derived
  (`4+ BHK` above three); timestamps are epoch millis in the browser and ISO-8601 on the wire; and
  `monthlyRent`/`publishedListingId` are `0`/`''` in the view model where the server means null.
  `priceStr`, `loc`, `img`/`image`/`gallery` and `owner`/`ownerMobile` have no column and are
  derived on read — the first three because cards render them, the last from the session.
- **`noteMapper` is the one vocabulary bridge in the seam.** Every admin screen says `listing`; the
  wire says `property`, like every other route. `http/noteMapper.js` is the single place the two
  words meet, and the server answers **400** for `listing` rather than accepting a second spelling
  into one table.
- **`notificationMapper` translates by longest prefix.** The server emits dotted namespaces
  (`flatmate.interest`, `flatmate.review.approved`, `flatmate.request.accepted`) and the page's icon
  and filter maps use a flat set (`match | enquiry | price | visit | share | document | service |
  system`). They do not overlap at all, and because the page reads `ICONS[n.type] || ICONS.system`
  nothing throws: every row renders grey and **every filter chip matches nothing**, which reads as
  broken filters. An unrecognised type falls back to `system` **and warns once**, so the next type
  the backend invents is audible rather than silently grey.
- **`authorId`, not the display name, decides which side of a thread a bubble sits on.** Comparing
  names works until two users share one, at which point a stranger's message renders on the reader's
  own side, styled as theirs, with nothing thrown and nothing logged. When identity is unknown the
  fallback is `them`: misattributing a stranger's words *to* the reader is the worse of the two
  errors. `party.online` is absent from the wire and pinned `false`, because `undefined` reads as
  "online" under a truthiness check and there is no presence service.
- **`authorRole` is `buyer|owner|staff|admin` and the bubbles key on two.** Anything not staff-side
  is the customer, **including `owner`** — an owner raising a support or service request is a
  customer of that desk.
- **Unknown statuses pass through unchanged.** Support's `getStatusLabel` falls back to the raw key,
  so the server's `in-progress` renders unstyled and visibly a gap; collapsing it onto `open` would
  erase a distinction ops actually made and tell the customer nothing was happening while somebody
  was working on it. Support sends no updated time and sorts `createdAtDesc`, so `updatedAt` is
  derived from the last message — the thing that actually changed — or a ticket answered this
  morning sits below one opened last week.
- **Report reasons are validated against the target type.** `FOR_USER` is
  `impersonation|fraud|brokerage|abuse|spam|fakelistings|other`; `FOR_POST` is
  `fake|unavailable|filled|broker|inappropriate|spam|other`. `filled` is not something you can say
  about a person. The client `kind` → wire `targetType` mapping is `listing → property`,
  `user → user`, `share → post`, written down once in `reportMapper.js` — which warns on an unknown
  kind rather than silently guessing — and once as `TAB_KIND` in `AdminReports.jsx`, the same
  correspondence seen from the queue's three tabs. The same code means different things to different
  targets (`spam` on a listing is a duplicate posting; `spam` on a person is who they are), so
  `reasonLabel(reason, targetType)` indexes per target type, and the three lists live in
  `lib/reportReasons.js` because five modules need the same vocabulary. The wire carries no
  `targetTitle`, `targetOwner`, `ownerMobile`, `reportedBy` or `url`: `targetTitle` falls back to the
  bare id, because a resolved title would be a **stale** title and a moderator judging yesterday's
  complaint against today's copy is worse than one who has to open a tab. The withheld reporter reads
  **"Withheld"**, never "Anonymous", in all four places it surfaces including the CSV export — the
  reporter is known (`reports.reporter_id` is NOT NULL and backs the duplicate index), merely not
  disclosed, and an unattributable complaint is an easy one to wave away.
- **`allowance` and `remaining` are `null` when `unlimited` is true** — not `Infinity`, which JSON
  cannot carry, and not a large number. Callers branch on `unlimited`; `null > 0` is false, so a
  `remaining > 0` test tells an unlimited user they have run out.
- **Plan identity is a UUID on the wire and a slug in the app** (`/checkout?plan=owner2`), joined by
  plan **name** in `planMapper.js`. Mapping by name rather than by position matters: a fifth plan
  inserted in the middle would silently re-point every slug. An unknown name maps to `null` rather
  than guessing — a plan the app has no card for is one it cannot describe.
- **`OfferDto.from` is the author of the offer and never changes.** Who moved last is the final
  `history[].by`, which `lastActorOf` derives; reading `from` for it inverts "you countered" and
  "they countered" on every card.
- **`budget` keeps the wire's name on the flatmates board.** On a room it is the asking rent; on a
  seeker post the identical field is a ceiling. The page's settled convention is that rooms and
  seeker posts carry `budget` while only groups carry `rent`, which is what `budgetOf` keys on —
  renaming it returns a perfectly good 201 and then prints **₹0** on every card, filter and map pin.
- **An absent `priceBasis` must not default to `'room'`.** `priceBasisOf` reads anything that is not
  exactly `'room'` as **per person** — the opposite — and a per-room listing shows no seat stepper
  while a per-person one does, so the wrong default silently removes the owner's control with no
  error and no console line. When mapping an optional enum, check what the page does with *absent*
  before choosing a default.
- **Nine closed vocabularies on the flatmates board.** `vocab()` drops an out-of-set value rather
  than spending a round trip to be told 400: a chip sending `"Female"` for `"female"` should narrow
  nothing, not empty the page. `modStatus` is held only so an author can be told their own post was
  taken down — the server's queries already filter the moderated states out, and the client never
  re-filters a public feed with it.
- **`categories[]` collapses to a single `docType` on a document-request row**, with the full list
  preserved as `categories`. The requester mobile passes through **masked** and is never unmasked
  client-side; `shareToken` and `expiresAt` are the owner's re-send affordances and are null until a
  request is granted.
- **A `TenancyDto` names no property.** It carries the flat's id and nothing else, so renaming a
  property cannot leave the lease disagreeing with itself. `toRentalCards` resolves the whole set in
  one batched property read and keeps `id`, `rent`, `ownerMobile` and `status` as they came off the
  wire; without it every option reads "My tenancy" and a tenant with two cannot tell them apart.

## Coming-soon features are not integration targets

**A feature the product is not shipping does not get wired, however complete its backend is.**
Integration effort spent on a surface nobody can reach buys nothing, and it accrues the same
maintenance cost as live code — call sites that drift, contracts to keep honest.

| Surface | How it is gated | Status |
|---|---|---|
| **Pay Rent** (`/pay-rent`) | The route renders `PayRentComingSoon` unconditionally | **Not shipping.** The page is static: it calls no API and moves no money |
| **Rent Passport** | Locked / coming-soon | **Not shipping** until a real payment rail exists — see below |
| **Move-in Pack** (services) | `services.packComingSoon` copy | Not shipping |

Three clarifications on the rent domain, because it is the one place this line is subtle:

- Only the **payment** half is coming-soon. `/me/tenancies`, `/tenancies`, the tenant profile, the
  whole `/me/finances/{propId}/*` ledger and `/me/rentals` are live surfaces the dashboard renders
  today, and they are genuinely integrated. Nothing there is dormant.
- There is no flag left to turn on. The payment endpoints were once wired-but-dormant behind
  `onlineRentPayment`; a dormant money path costs more to keep honest than it earns, so V127 dropped
  the tables and the controller went with them. `/pay-rent` survives as a route because the
  dashboard's "rent due soon" row needs an honest destination — not because anything is waiting
  behind it.
- **The Rent Passport deliberately does not read the tenant's self-declared rental.** Its header
  says "Verified rent-payment record", and a document anyone can type is not evidence. Feeding
  `/me/rentals` into it would turn a credential shown to a prospective landlord into a forgery with
  the platform's name on it. It stays locked until a real rail returns.

Two rulings from the withdrawn rent rail outlived it, because they were never really about rent:

- **Any operation that opens a gateway order returns intent, not outcome.** Plan subscriptions and
  deal finalization still do exactly this.
- **A fee the client computes is a fee the client can change.** Every charge is computed once, on
  the server, from configuration the client never supplies. The client may display a figure; it may
  not be the figure that gets charged.

Before scoping any slice, check for a `ComingSoon` component, an `if (!flagEnabled(...)) return`
early exit, and `coming soon` in the i18n catalogue. A surface that fails any of those is out.

## Documented exceptions (deliberate, not oversights)

A few things legitimately sit outside the seam. Each is here because the server has **no
counterpart**, not because nobody got to it, and each carries a SEAM NOTE at its call site.

- **Client-side state the server does not model**: notification dismissals (`dzDismissedNotifs`),
  the conversation staging queue (`dzPendingRequests`), follows on a browser-minted society
  (`dzLocalSocietyFollows`), and the anonymous halves of recent searches, recently-viewed and
  last-search (`lib/localPrefs.js`). Each is held *inside* the provider or context that owns it
  rather than exposed as a second data source, and each is documented as a local preference: it does
  not sync across devices, and clearing site data clears it.
- **Presentation helpers with no data behind them** — `lib/data/documents.js`'s formatters,
  size and category helpers and checklist — are imported for their arithmetic, not for storage.
- **The society catalogue itself** is still `data/societies.js`: curated client-side data, and the
  source of the synthetic `S01` id the server has never heard of.
- **`setPipelineStage` used to be on this list and was wrong.** `POST /properties/{id}/pipeline` had
  existed for months; what was missing was a service method in front of it, so the console wrote
  straight to the browser store while the server route sat unused with a different vocabulary. The
  lesson worth keeping: **"no backend counterpart" is a claim about the server**, and it has to be
  checked against the server rather than inherited from the last person who wrote it down.
- **The client never writes an audit row.** `logAudit` is gone from every admin page, deliberately
  and not pending: the server writes its own `audit_log` row inside `PropertyModerationService` for
  every status change, feature toggle, flag and clear, and the owning service records the equivalent
  action for settings, societies, report triage and the demand desk's number reveal. Wiring a
  client-side log to the API would record the same action twice, from a source that can be neither
  trusted nor correlated — so each deleted call site carries a comment naming the server write that
  replaced it, rather than nothing.

## The HTTP client (`services/http.js`)

`send` is the only `fetch` in the service layer, so every transport-wide rule lives there. Native
`fetch` deliberately: the only things a client library would buy here are interceptors and error
normalisation, both ~40 lines against a single known backend.

### The two error shapes

`ApiError.code` is the backend's stable machine-readable string (e.g. `identity_already_registered`); branch on
it, never on `message`, which is human-facing and may be reworded at any time. `attemptsRemaining`
and `retryAfterSeconds` are read off the **envelope**, not off the headers beside them — the API
exposes no CORS response headers, so a browser on another origin can read the body and nothing else.
Both are `null` rather than `0` when absent, so a missing count cannot read as "locked out" or as
"retry immediately"; `retryAfterSeconds` is the *remaining* wait, which is why it is worth reading —
a screen that restarts its own countdown after a refusal makes the user wait longer than the server
would. `traceId` falls back to the `X-Trace-Id` header because 502s and other proxy-level failures
never reach the exception handler and carry no envelope at all. A non-JSON body (proxy, gateway,
HTML error page) is kept as a message rather than masked with a parse error.

`NetworkError` means the request never reached the server (offline, DNS, connection refused).

### An abort is not a failure

`isAbort(err)` tests `err.name === 'AbortError'`, matched on the name rather than
`instanceof DOMException` because Node's undici rejects with a plain `Error` and the e2e/unit
runners are Node.

An abort is the caller saying "I no longer want this answer" — a superseded search, an unmounted
screen — and it looks identical to a network failure at the `catch` unless something asks. Two
things go wrong if nothing does: the reachability observer latches "cannot reach the server" and the
offline banner appears on a working connection *because the user typed quickly*, and any caller with
an error branch renders a failure state for a request it cancelled itself. So `send` rethrows it
unchanged and reports it to nobody.

### `observeReachability(fn)`

One listener, called once per HTTP attempt with the `NetworkError` the attempt is about to throw, or
`null` when the server answered. "Answered" deliberately includes a 500 or a 422: the request
arrived, so it is not a connectivity fact and must never be captioned as one. Classifying it is
`hooks/useConnectivity.js`'s job — passing the error rather than a boolean keeps one definition of
"unreachable", so the banner and any list error can never disagree about what happened. A
401-recovered call reports twice (the original attempt and the replay), which is correct rather than
tolerated: both really were attempts, and the store they feed is a latch. It is an inversion rather
than an `import` because `services/` must not depend on `hooks/`, and a cycle between the two
modules would be resolved only by class-hoisting luck.

### Request construction

Caller headers merge **before** `Authorization`, so a stray `Authorization` in `opts.headers` cannot
displace the session token — the one header that must never be a per-call decision. A `FormData`
body is left untouched and its `Content-Type` deliberately unset, because the platform derives it
including the boundary token that a hand-set header would clobber.

`credentials: 'include'` is a no-op same-origin (the default `/api` deployment already sends cookies
under `credentials: 'same-origin'`), so it is not the thing that makes refresh work there. It earns
its place only in the cross-origin `VITE_API_BASE` deployment, which the server permits explicitly
via `Allow-Credentials` plus an origin allowlist (`CorsConfig`). The flip side is worth knowing:
with `include`, a misconfigured `VITE_API_BASE` would send cookies to whatever host it names. That
is bounded because `send` can only ever build `API_BASE + path` — there is no absolute-URL call
path, so no third-party host is reachable from that line.

Array query values repeat the key (`?amenity=lift&amenity=gym`), the format Spring binds to
`List<T>`; empty, `null` and `undefined` entries are dropped.

`withStatus: true` resolves `{ data, status }` for the handful of endpoints where the *code* is part
of the answer rather than a transport detail — `POST /societies` replies 201 for a society it minted
and 200 for one that already existed, and the screen has to say "Added" or "Already on Draazy"
accordingly. Errors still throw, so this never becomes a way to swallow a 4xx.

`postMultipart` is a thin sibling of `post` rather than a body-type branch woven through `request`,
so the JSON path stays the common case unpolluted by a multipart check on every call. It inherits
401 recovery and error normalisation for free, because `request` sees the `FormData` and `send`
leaves it untouched.

### Reading paged responses

`unwrapPage(res, requested)` reads the Java record `PageResponse(content, page, size,
totalElements, totalPages, sort)`. **Never fall back to the requested page**: any server-side clamp
or redirect and the caller is told it is on a page it is not on. `number` — Spring's raw `Page`
field, which this API does not send — is read *after* `page` and never instead of it. `total` comes
from `totalElements`, which counts the whole result set rather than this page: the difference every
"N results" label and unread badge depends on. A bare array is a legitimate response from the
deliberately unpaged endpoints (bounded reads, e.g. a property's reviews), so it is normalised
rather than treated as malformed; only there is `items.length` a correct total.

`unwrapFullPage(res, label)` is for a paged endpoint the UI consumes as a plain list. Several
collections are paged on the wire — the *server* must not be asked to serialise an unbounded result
set (api-standards.md §5.1) — while the screen reading them has no pager: the dashboard filters and
totals its deals client-side, the visits calendar groups by day. For those, `?size=100` is the
honest translation. It is not "paging turned off": the request is bounded, the server does one
indexed page-one scan, and the response cannot grow without limit. What it *is* is a ceiling, and a
ceiling nobody is told about is how a list quietly starts lying — so `totalElements` is compared
against the rows actually returned, detecting both the overflow and the silent clamp, and the
warning names the caller because "some list is truncated" is not something anyone can act on. A bare
array passes through unchanged: an endpoint that is deliberately unbounded server-side is not
truncated and must not warn. `providers/http/conversationProvider.js` carries its own copy of this
pattern because its mapper takes the envelope rather than the rows, so folding it in here would be a
mapper change rather than a call swap.

`MAX_PAGE_SIZE` is re-exported from `http.js` so existing importers keep working, but the value
lives in `services/apiLimits.js`. It lives there because `http.js` sits inside a latent import
cycle — `http.js` → `config.js` → every provider → `http.js` — so anything a provider reads at
module scope from `http.js` can land in a temporal dead zone and take the whole app down;
`apiLimits.js` imports nothing, so it is always fully evaluated first. New provider code must import
it from there, and `scripts/check-provider-cycle.mjs` enforces that.

## Local run

The app talks to `/api` and the Vite dev server proxies it, so requests stay same-origin: no CORS,
and the page's `connect-src 'self'` CSP is satisfied.

```powershell
cd backend;  .\run-local.ps1   # serves http://localhost:8080/api
cd frontend; npm run dev       # Vite, proxying /api to the backend
```

`VITE_API_BASE` defaults to `/api` and `VITE_PROXY_TARGET` defaults to `http://localhost:8080`. The
proxy forwards the prefix **verbatim**, because `/api` is a real `server.servlet.context-path` on
the backend and not a dev-proxy fiction: `/api/auth/login` is the same path in dev as in a deployed
build. Health is `/api/actuator/health`, and the contract is browsable at `/api/docs`.

An absolute, cross-origin `VITE_API_BASE` is legitimate once CORS and CSP match — the backend allows
it through an explicit origin allowlist — and `config.js` warns in dev whenever one is set, because
there it is almost always a mistake whose only clue would be a console entry behind a generic
"login failed".
