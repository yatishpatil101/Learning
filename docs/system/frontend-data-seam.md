# Frontend data seam (mock ↔ http)

How the React app reaches data, and the rule that keeps the `mock → http` flip a one-line change
instead of a 20-file refactor.

## The rule

> **Pages, components and hooks import from `src/services/*`. They must never import from
> `src/lib/mockApi.js`, `src/lib/mockApi/*`, `src/lib/store*` or `src/lib/properties-admin.js`
> for anything that has (or will have) a backend endpoint.**

```
pages / components / hooks
        ↓  (only this direction)
src/services/<domain>Service.js      ← stable public API, never changes shape
        ↓  createProvider('<domain>')
src/services/providers/mock/…        ← localStorage implementation (always works, no backend)
src/services/providers/http/…        ← real API implementation (opt-in per domain)
```

`services/config.js` resolves the provider **per domain** from `VITE_API_DOMAINS`
(e.g. `VITE_API_DOMAINS=auth,property`). Anything not listed stays on mocks. This is what makes
integration incremental: one domain can go live while the rest of the app is fully demoable with the
backend switched off.

## Why it matters

Before Phase 2a, 21 files imported `listProperties` and friends **directly from `lib/`**. Flipping
the property domain to http would have changed the behaviour of the one file using the seam and
silently left the other 20 on localStorage — producing a half-real UI that looks like a mapping bug.
A seam only works if it has no bypass.

**Enforcement:** grep for direct `lib/mockApi` imports in `pages/` and `components/` before shipping
a domain flip. Zero results = zero leaks.

## Domain status

| Domain | Service | Provider(s) | Notes |
|---|---|---|---|
| `auth` | `authService.js` | mock + **http** | Live: login, staff-login, refresh, logout, `GET/PATCH /auth/me` |
| `property` | `propertyService.js` | mock + **http** | Live: search, detail, featured, counts, by-id, `/me/listings`, archive/restore, **and the full moderation surface** — `GET /admin/properties` plus approve/reject, feature, flag, clear-flag |
| `contact` | `contactService.js` | mock + **http** | Live: gate status, request, owner inbox (paged), respond, pending count. Keyed on `propertyId` — the grant is per listing |
| `saved` | `savedService.js` | mock + **http** | Live: `GET /me/saved` (rows, not ids), idempotent PUT/DELETE. Membership is answered from `SavedContext`, never per card |
| `savedSearch` | `savedSearchService.js` | mock + **http** | Live: list/create/patch/delete. Seam flattens the server's `filters` jsonb onto the record and derives `alerts` from `alertFrequency`. Anonymous lead capture stays local (D85) |
| `visit` | `visitService.js` | mock + **http** | Live: `/visits` (mine) and `/me/visit-requests` (on my listings), create, status. Seam carries the human `when` string; `visitWhen` converts to/from the wire's ISO slot. Reschedule has no endpoint (D87) |
| `notification` | `notificationService.js` | mock + **http** | Live: `GET /notifications` (paged), `POST /notifications/read`. Dismiss is a client tombstone — no endpoint. Client-derived alerts merge in. Preferences stay on `lib/` |
| `conversation` | `conversationService.js` | mock + **http** | Live: inbox (paged), start, detail, reply, mark-read. `pending` is a client staging queue; `incoming` + accept/decline are mock-only |
| `review` | `reviewService.js` | mock + **http** | Live: property reviews and entity (society/locality/owner) reviews, read + write. `context` is server-derived and never sent. Owner reviews stay on mocks — the *target* is not live |
| `support` | `supportService.js` | mock + **http** | Live: list, create, detail, reply, mark-read. Bare list with the thread inline. Priority and attachments are mock-only — no field on the schema, so the page hides both controls in http mode |
| `report` | `reportService.js` | mock + **http** | Live: file, queue (paged, **staff/admin**), triage. First domain whose two ends have different audiences. Duplicate → 409; terminal is terminal |
| others (document, content, admin, listing, …) | — | — | Backend controllers exist; no seam, and the pages import `lib/` directly |

Eleven domains, eleven services, eleven mock providers, eleven http providers — the counts match
exactly, and that is the invariant to keep. A provider without a service is unreachable; a service
without a provider throws.

**Having an http provider is not the same as using it.** Which domains are actually live is decided
by `VITE_API_DOMAINS`, and for a long time four of the eleven had a provider, a parity harness and a
row in this table while every browser run still served their mocks. The list that matters is in
`e2e/playwright.live.config.js`; if a domain is not in it, nothing here has been exercised in a
browser. See "The switch-on slice" below.

`dealService.js` and `financeService.js` were **deleted** in the saved slice. Both had zero importers
— only the barrel referenced them, and the barrel itself is imported nowhere — so they were seam
files that had never been wired to anything. Their mock providers went with them. A dead service is
worse than a missing one: it reads as coverage that does not exist.

Four more mock providers — `admin`, `content`, `document`, `listing` — were deleted afterwards for
the mirror-image reason: they had no service, so `createProvider` was never called with those names
and nothing could reach them. They were not inert, though. `config.js` resolves providers with
`import.meta.glob(..., { eager: true })`, so every file matching `providers/mock/*Provider.js` is
pulled into the main bundle whether or not a service exists for it; removing them took it from
1864 KB to 1848 KB. Each was a pure pass-through (`Promise.resolve(_fn())`) over `lib/` functions
the pages already import directly, so nothing changed behaviourally — the wrappers had simply been
built ahead of a seam that never arrived.

The old `savedProvider.js` bundled five unrelated domains (saved properties, saved searches, plans,
boosts, service orders) behind one name. On the server those are five separate controllers, so the
bundle would have pinned five backend slices behind one provider. It was narrowed to saved
properties; the other four had no consumers.

`propertyService.js` exports 15 symbols: `listProperties`, `getProperty`, `featuredProperties`,
`countProperties`, `getPropertiesByIds`, `myListings`, `addListing`, `setListingStatus`,
`toggleFeatured`, `flagListing`, `clearFlag`, `deleteListing`, `updateListingFields`,
`archiveListing`, `restoreListing`.

### Why `countProperties` / `getPropertiesByIds` exist

Several pages used to load the **entire catalogue** and reduce it client-side — a locality count, a
saved-list lookup, a compare picker. That is invisible against a 38-row mock and simply *wrong*
against a paginated API: the answer silently becomes "…of the first page". Both operations push the
work to the server, and `countProperties` is exact because `totalElements` on a `size=1` request is a
count over the whole result set, not over a page. No new endpoint was needed for either.

`myListings` is a correctness fix rather than an optimisation: public `/properties` is hard-floored
to approved + non-archived server-side, so an owner's pending or rejected rows **cannot** be derived
from it at all. `GET /me/listings` is the only source that returns them.

## Documented exceptions (deliberate, not oversights)

These stay on `lib/` **because they have no backend counterpart**, and moving them would create a
service method that can never be implemented:

- `setPipelineStage`, `sendOwnerReminder`, `confirmListingFresh`, `applyVerifiedBadgeToListings`,
  `verifiedStats` — growth/ops features that are mock-only by design.
- `logAudit` on the admin pages stays mock-only **deliberately**, not pending. The server writes its
  own `audit_log` row inside `PropertyModerationService` for every status change, feature toggle,
  flag and clear; wiring the client's `logAudit` to the API would record the same action twice, from
  a source that can be neither trusted nor correlated. The client-side log is a mock affordance for
  the demo Audit page, and it stops at the seam.
- `decideReview` / `ensureReview` (maker-checker case files) remain on `lib/` for now — the endpoints
  exist per-listing (`/properties/{id}/verification`) but the queue cannot be enumerated
  (`PropertyReviewRepository` has only `findByPropertyId`), so a live Verification tab would be able
  to decide a case it cannot list. Recorded in tech-debt.

## The listing moderation slice

The four moderation writes had shipped on the server months before anything could call them, and the
http provider's stubs pointed at paths that were guessed rather than looked up
(`PATCH /admin/properties/{id}/status`; the real route is `PATCH /properties/{id}/status`). That was
the visible half. The invisible half mattered more.

**There was no way for a moderator to list properties at all.** `PropertySpecs.publicSearch` pins
`archived = false AND status = 'approved'` unconditionally, and `PropertyController.search` takes no
principal, so it cannot relax for staff — a staff caller got byte-identical results to an anonymous
one, and `?status=pending` returned an **empty page** because the param can only AND onto an
already-pinned `approved`. The only status-complete list was `GET /me/listings`, scoped to the
caller's own `owner_id`. So `AdminProperties` in http mode asked for `includeAllStatuses` +
`includeArchived`, had both silently dropped as "unsupported", and rendered the approved-only public
catalogue: a Verification Queue that could never contain anything, presented as an empty backlog.

`GET /admin/properties` (`PropertySpecs.adminSearch`, staff/admin) is the fix. Three decisions in it
are worth keeping:

- **A separate spec method, not an `includeAll` flag on `publicSearch`.** A flag would leave the
  anonymous search one mistyped argument away from serving unapproved listings. A second method can
  only be reached by a caller that named it, and every caller can be enumerated by grep.
- **A separate path, not a role branch inside `GET /properties`.** The public search is opened *by
  path* in `SecurityConfig`; a role check inside it would put the unapproved catalogue behind a
  runtime `if` on an endpoint whose matcher says `permitAll`.
- **`status` widens here and narrows there.** That asymmetry is the entire point, so both halves are
  asserted in `PropertyModerationQueueTest` — each test checks the queue returns a row *and* that
  public search does not. Asserting only the first would still pass if someone later merged the two
  specifications, which is the change this endpoint most needs protecting from.

### `listForModeration` is a separate seam operation — and that was learned the hard way

The obvious client shape was `listProperties({ includeAllStatuses: true, includeArchived: true })`,
with the http provider noticing those flags and routing to `/admin/properties`. The reasoning was
"a consumer page never sets them". **That was simply false.**
[useDashboardData.js](frontend/src/pages/consumer/dashboard/useDashboardData.js#L158) passes
`includeAllStatuses: true` — it wants a catalogue to resolve visit titles against — so every owner
opening their dashboard was routed to a staff-only endpoint and got a **403**. The live e2e caught
it; nothing else would have, because on mocks the flag is honoured and the page works.

The rule it produced is the same one the server applies a layer down: **an authorization-relevant
routing decision must be named by the caller, never inferred from an ambiguous flag.** So
`propertyService` exports `listForModeration` alongside `listProperties`, the mock provider
implements both, and reaching the queue requires asking for it.

A second bug hid behind the first. While the routing was inferred, an *absent* flag re-imposed the
public floor — which was the safe reading then, and wrong the moment the operation became explicit:
`listForModeration({})` returned exactly the approved rows public search already returns. The admin
table showed 16 of 38 listings and reported no error. **An unfiltered moderation read filters on
neither axis**, the inverse of `toQuery`'s default, and the parity harness asserts it.

### `archived` had to go on the wire

No response DTO exposed it, so `propertyMapper` hard-coded `archived: false`. Defensible while every
list was public — an archived row cannot appear in one — and fatal on an ops list, where it made
every archived listing look live and left the Archived filter permanently empty. It is now on
`Property`, which also fixes `GET /me/listings`, where an owner's archived listings had the same
problem.

`archived` is a **separate axis from `status`**, not a sixth status value: archiving preserves the
moderation state it was archived from, and restoring resets to `pending`. Hence the tri-state
`archived` query param — omitted means both, and "everything" and "only the live ones" are different
questions that a two-valued flag cannot distinguish.

### The four writes resolve with no value

The contract declares a bare `200`/`204` with no schema for all four, on the reasoning that a
moderator can predict the effect of the request they sent. The mock still returns the updated record;
**nothing may read it**, because a caller that does works on mocks and silently reads `undefined`
against the API. `AdminProperties.doFeature` did exactly that (`rec.featured`) and would have worded
every toast "Removed from featured". It now derives the new state from the row already on screen.

Echoing the row back was considered and rejected: the obvious re-read, `GET /properties/{id}`,
enforces the public floor and so 404s for pending, rejected, flagged and archived listings — the
result of every action on this page.

### Three server behaviours the seam passes through rather than hides

- **`clearFlag` sets `approved` unconditionally.** It does not restore the pre-flag status, so a
  `pending` listing that is flagged and then cleared reaches `approved` without ever passing the
  queue. The mock's "clear flag & publish" matches, by accident rather than design.
- **`denySelfDealing` returns 403** when the actor owns the listing. Partial failure in bulk actions
  is therefore an expected case, not a remote one — which is why every bulk path now uses
  `Promise.allSettled` and reports what actually happened.
- **Moderation routes are UUID-only.** Unlike the public read they do not resolve a slug, so an id
  taken from a public URL 404s.

### Call-site defects this exposed

The page's moderation calls were fire-and-forget `forEach` loops. Against mocks that is harmless;
against the API each is an unhandled rejection *and* a green success toast for the same click. All
are now awaited, bulk paths use `allSettled`, and toasts report the real outcome.

The edit modal's status dropdown was a silent no-op in http mode: it went through
`updateListingFields` → `ListingUpdate`, which **deliberately omits `status`** so a PATCH cannot
self-escalate, so the field simply vanished from the request body. Field edits and a status change
are two different operations against the API and the modal now makes two calls.

`bulkApprove` used to follow every approval with `updateListingFields(id, {flagReason: ''})` —
another silent no-op against the API, since `ListingUpdate` has no `flagReason` and the patch
serialised to `{}`. The mock's `setListingStatus` now clears the flag on approve, mirroring the
server (`PropertyModerationService` nulls `flag_reason` only on approve), and the extra call is gone.

### `PAGE_SIZE` was above the server's ceiling

The provider asked for `size=500`; `spring.data.web.pageable.max-page-size=100` clamped it. So every
list silently returned at most 100 rows while `warnIfTruncated` compared `totalElements` against 500
and stayed quiet for everything in between — the guard that existed to make the ceiling audible was
muted by the ceiling it was guarding. It is now 100, and the check compares against the rows actually
returned, which is correct regardless of what either constant says.

## The notifications slice

Two endpoints — `GET /notifications` (paged) and `POST /notifications/read` — so the wiring is the
smallest of any slice so far. What made it a design slice is that **most of what the page does has
no server home**, and each gap needed a different answer rather than one blanket policy.

| Behaviour | Lives | Why |
|---|---|---|
| list, mark read, mark all read | server | the two endpoints |
| `dismiss` | client tombstones (`pnDismissedNotifs`) | no `DELETE /notifications/{id}` |
| saved-search / saved-property alerts | client-derived, merged per read | computed from `countMatches`; the server has no slot |
| `pushNotificationFor` | mock only, **permanently** | writing into another user's inbox is a server-side effect, never a client call |
| preferences + quiet hours | `lib/` only | no endpoint at all; `ProfileTab` untouched |

### The vocabulary mismatch that would have been invisible

The server emits dotted namespaces — `flatmate.interest`, `flatmate.review.approved`,
`flatmate.request.accepted`, `flatmate.agreement.reissue`. The page's `ICONS` and `FILTERS` maps use
a flat set — `match | enquiry | price | visit | share | document | service | system`. **They do not
overlap at all.**

Because the page reads `ICONS[n.type] || ICONS.system`, nothing throws. It degrades two ways:

1. Every server notification renders as the grey "system" glyph — merely ugly.
2. **The filter chips match nothing.** Selecting "Matches", "Price" or any other chip empties the
   page. A user whose inbox is entirely server-fed would conclude the filters are broken.

`notificationMapper.js` translates by longest prefix; an unrecognised type falls back to `system`
**and warns once**, so the next type the backend invents is audible rather than silently grey. The
parity harness drives every type the backend actually writes today and asserts each lands inside the
UI vocabulary — mutation-verified by mapping one to a nonexistent chip and watching it fail.

### `at` must be a number, and the wire sends a string

`createdAt` is an ISO instant; the page sorts on `at`, groups Today/Earlier from it and computes
`Date.now() - at`. An ISO string sorts *lexicographically* — which for same-format timestamps is
mostly the right order, so this survives casual testing — and makes every relative time `NaN`. The
mapper `Date.parse`s it, and the harness asserts the type, also mutation-verified.

### Dismiss is a tombstone, and that is a deliberate trade

There is no delete endpoint. The options were: hide the X in http mode (removes a control that works
today), throw (a dead button), or record locally which rows the user has hidden. The tombstone wins
because it is honest about being a local preference — it does not sync across devices and clearing
site data brings the row back, both documented on the provider. Recorded as debt so a real endpoint
replaces it rather than joining it.

### The seed must not run against the API

`seedNotifsIfEmpty` writes eight fabricated rows to localStorage. On mocks that is the demo inbox;
in http mode the same call would merge invented notifications into a real one — indelible (not the
server's to delete), invisible from any other device, and indistinguishable from genuine platform
messages. The page gates the seed on `isHttpDomain('notification')`, and the live e2e asserts the
seeded ids never appear in storage.

### What "live" currently means here

Only the flatmate flows call `new Notification(...)` server-side — five call sites, all in
`FlatmateSeekerService`, `FlatmateSupplyService` and `FlatmateModerationService`. Nothing in
property, contact, visit, saved-search, offers, deals or documents writes a row. **A non-flatmates
user's live inbox is legitimately empty**, which is why the client-derived alerts are load-bearing
rather than a nicety: without them the flip would trade a populated demo for a truthful blank page.
The gap is in the writers, not the seam.

**Partly closed by the conversations slice** — `ConversationService.send` now writes a
`message.received` notification to the other participant, so the two features finally reinforce each
other. Everything else in D92 still stands.

## The conversations slice

Five endpoints (inbox, start, detail, reply, mark-read) and ten frontend files. The wiring was
routine; **the shape gap was the slice**, because the mock's conversation is a *richer document*
than the server's rather than a differently-named one.

### The `state` machine does not exist server-side

`ConversationService.related` requires an approved contact request in one direction or the other
before a thread can be created at all. So a live thread is always `active` — there is nothing left
to accept, because the contact gate did the accepting one layer up.

The mock's three states map like this:

| Mock state | Live | Why |
|---|---|---|
| `active` | every server thread | the only state that survives |
| `pending` | **client staging queue** | composed but not sendable: the gate has not opened |
| `incoming` | never | it means "they asked, I have not accepted", which is a contact-gate concept |

`accept` and `decline` render behind `state === 'incoming'`, so in http mode they simply never
appear — no gating needed, which is the nicer version of "mock-only".

### Staging, and why the button is not just disabled

"Message owner" is reachable from a property page *before* the gate opens, where `POST /messages`
answers 403. Three options, one honest:

- **Hide the button until contact is approved** — matches the server exactly, and makes the property
  page's primary CTA appear and disappear depending on state the user cannot see.
- **Let it throw** — a dead button with an error nobody can act on.
- **Stage it and send when the gate opens** — what shipped.

The staged row carries `state: 'pending'` and a `staged:` id, so nothing can mistake it for a server
thread or try to reply into it. `drainPendingChats` runs before every inbox read, and **re-reads the
listing** rather than trusting anything stored at queue time — the owner's mobile is masked until
the gate opens, so a number captured at queue time would be a masked string sent as if it were real.
An entry the server still refuses stays queued; silently dropping a message the user composed is the
worst outcome available.

### `authorId` was added to the contract

`MessageDto` carried `author` — a **display name** — and no id. The client has to decide which side
of the thread each bubble belongs on, so it would have had to compare names. That works until two
users share one, at which point a stranger's message renders on the reader's own side, styled as
theirs. Nothing throws and nothing logs; the thread just quietly misattributes who said what.

`authorId` is one field and it makes the question answerable. The mapper keys on it, the parity
harness drives a same-name counterparty to prove it, and `ConversationEndpointsTest` creates two
users called "Same Name" for the same reason. When identity is unknown the fallback is `them`:
misattributing a stranger's words *to* the reader is the worse of the two errors.

### What degrades, and how visibly

| Mock field | Live | Behaviour |
|---|---|---|
| `property.{price,loc,img}` | absent | title renders; the rest would be one property read per inbox row |
| `party.online` | absent | pinned `false` — there is no presence service, and `undefined` reads as "online" under a truthiness check |
| `youAre` | absent | derived from `counterpartyRole`; an approximation, documented as one |
| message `type: 'card'`, `icon` | absent | share chips send their text and lose the icon — the sentence carries the meaning |
| auto-reply, typing dots | — | mock-only. Against the API the other end is a person; fabricating a reply would put words in their mouth |

The contract declares `MessageCreate.attachments` and the Java record does not implement it. That
divergence is now marked in the spec rather than left to be discovered.

### The inbox does not carry the transcripts

`ConversationDto.messages` is `NON_NULL` and the *list* contract omits it — a hundred one-line
previews would otherwise cost a hundred full transcripts. So a live row arrives with `messages: []`
and the thread is read separately, on open, which is also the moment the user first needs it.

The mock has one store and returns whole objects, so opening a thread was free there. The page
therefore worked perfectly on mocks and opened an **empty thread** against the API. Two things fell
out of fixing it, and they are the same lesson:

- The list read and the detail read are now different operations, and every caller that shows a
  thread has to make the second one. `hydrate(id)` exists so there is exactly one place to forget.
- **Replacing a synchronous store with a fetched one changes *when* every reader runs.** `convs`
  used to be seeded from localStorage during `useState`, so a mount-time effect saw the whole
  inbox. Behind the seam it arrives from a request, and the `?c=<id>` deep-link effect — untouched
  by the migration — ran against `[]` and silently opened nothing. It now latches on the first
  non-empty list instead. Nothing in the http provider was wrong; the *timing contract* changed.

`lib/data/myListings.js` is the one `lib/ → services/` import in the codebase. The layering concern
was real but hypothetical; the correctness gain is concrete, and the absence of a cycle was verified
(the provider registry reaches `lib/mockApi.js` and `lib/data/properties-admin.js`, neither of which
imports `myListings.js`). It carries a SEAM NOTE recording that check.

## The reviews slice

Four operations over two routes, and the interesting part is that **the wire is stricter than the
mock, deliberately**. Everywhere else the seam has translated between two equally-permissive
vocabularies; here the server refuses fields the client used to supply, and refusing them is the
feature.

### `context` is not the client's to send

`context` is the reviewer-standing badge — "Verified resident" (`tenant`) or "Visited" (`visit`).
The contract marks it `readOnly`; `ReviewCreateRequest` has no such field; the server derives it
from the author's visit and tenancy history.

Three separate call sites were sending it anyway:

| Where | What it sent | Why that was wrong |
|---|---|---|
| `ReviewModal.jsx` | `context: 'visit'`, hard-coded on every submission | every review certified itself |
| `useSocietyHub.js` | `resident: isVerifiedResident(soc.slug)` | a client-side lookup, stored as evidence |
| `ReviewsSection.jsx` | rendered the chip **unconditionally** | a null `context` fell through to "Visited" |

The first two were ignored live and believed on mocks — the worst possible split, because mocks are
where the demo and the screenshots come from, so the badge acquired its credibility in exactly the
environment where it meant nothing. The third is not a provider bug at all: the provider returned
the correct null and the card invented a badge from it.

The mock provider now refuses to stamp a badge either, and the parity harness asserts that. A badge
a browser can assert about itself is not evidence, and evidence is the only thing that makes a
stranger's rating worth reading.

### An entity review is only as live as its target

`GET /reviews/{entityType}/{entityId}` is one route over three target types, and each one migrated
only if the frontend and the database already agreed on the key:

| Target | Frontend key | Server key | Outcome |
|---|---|---|---|
| `locality` | slug | slug | **live** — but see below |
| `society` | `soc.id` (`S01`) | UUID, slug accepted | **live**, after re-keying on `soc.slug` |
| `owner` | mock user id | user UUID | **not migrated** |

Owner reviews stay on `lib/store.js` and carry a SEAM NOTE saying so. `getOwner()` still reads
`lib/mockApi/users.js`, so pointing the page at the service would issue a perfectly well-formed
request for an owner the server has never heard of — and the empty result would render as "no
reviews yet". A silent wrong answer is worse than an honest mock, and this moves when the owner
profile does.

Two key bugs surfaced from the same cause, and both were invisible on mocks because the mock will
happily key on any string you hand it:

- **The society hub keyed reviews on `soc.id`.** Every other call on that page — follow, Q&A,
  resident status, board, WhatsApp — already used the slug; reviews were the single holdout.
- **The locality page keyed reviews on `activeName.toLowerCase()`** — the *display name* — while its
  listings query, societies filter and URL all used the slug. For a one-word locality the two agree,
  which is precisely why it survived; `viman nagar` vs `viman-nagar` is where it did not.

### The society cards are still on the mock aggregate, and there is a reason

`SocietiesSection`, `Societies.jsx` and `SocietySection.jsx` call `entityRating('society', soc.id)`
inside a `.map()`. They were left alone and given SEAM NOTEs, because the fix is not to migrate them
to the reviews service — that would be one request per card — but to read the aggregate the row
already carries. **`GET /societies` now returns `avgRating` and `reviewCount` per row**, added by
this slice for exactly that call site, computed through `RatingLookup.forSocieties` in one batched
query alongside the listing and follower counts.

`avgRating` is **null, not 0**, for an unrated society. A card that renders 0.0 for a society nobody
has reviewed is stating something false about it, and "unrated" and "rated zero" are different
claims. The `SocietyDetail` schema had these two fields already; they moved up to `Society` rather
than being duplicated, so the hub and the directory cannot drift into computing different numbers.

### What the server has that the UI does not use

`title` and `categories` exist on the wire and only `categories` is rendered; `ReviewCreate` accepts
a `title` nothing sends. Left unused rather than invented — an empty heading on every review card is
not an improvement.

## The support slice

Five endpoints, one page, and a one-to-one mapping onto the mock's five functions. The wiring took
an afternoon; the value is in what it made visible.

### Three controls with nothing behind them

| Control | On the wire | What shipped |
|---|---|---|
| **Priority** (low/normal/high/urgent) | absent from `SupportTicket` *and* `SupportTicketCreate` | hidden in http mode |
| **Attachments** (up to 4 images, base64) | `MessageCreate` is `{ body }` | hidden in http mode |
| **Name / mobile** | absent — the raiser is the session | left visible, documented |

The first two are hidden rather than disabled. A greyed-out control invites "why can't I?"; an
absent one asks nothing. And they had to be *hidden* rather than merely not-sent, because **an
unknown property is ignored, not rejected**: a form that kept sending `priority` would show a
success toast for a ticket ops never sees as urgent. That is the worst possible outcome — worse than
an error, because nobody learns anything.

Name and mobile are the weaker case and were deliberately not gated. They are prefilled from the
signed-in user on a `ProtectedRoute`, so the common path is right either way, and support still
reaches the person through the account and the thread. The gap — a user who *edits* the mobile to a
different callback number is telling us something the API cannot carry — is recorded rather than
papered over.

### Three vocabularies to reconcile

**Status.** The page labels five and the server has five, but they are not the same five: the
server opens every ticket `open` (there is no `new`), and it distinguishes `in-progress` — ops
picked it up — which the page has no label for. Unknown statuses are **passed through unchanged**.
`getStatusLabel` falls back to the raw key, so `in-progress` renders unstyled and visibly a gap.
Collapsing it onto `open` would have erased a distinction ops actually made and told the customer
nothing was happening while somebody was working on it.

**Author role.** `authorRole` is `buyer|owner|staff|admin`; the bubbles key on `customer|staff`.
Anything not staff-side is the customer, *including `owner`* — an owner raising a support ticket is
a customer of support. The first version of the parity harness could not catch this, because the
probe signs in as a buyer; it now drives every role through the mapper directly.

**Time.** `at` must be a number — the thread sorts on it and `fmtTime` does date arithmetic. An ISO
string sorts almost right, which is why it survives casual testing.

### `updatedAt` is derived, not fetched

The mock sorts the list by `updatedAt`. The server sorts by `createdAtDesc` and sends no updated
time at all, so the provider derives it from the last message — the thing that actually changed. A
ticket answered this morning belongs above one opened last week, and the server's own ordering would
have put it second.

## The reports slice

Three endpoints, and the first domain in the seam whose **two ends have different audiences**:
`POST /reports` is open to any signed-in caller, `GET /reports` and `PATCH /reports/{id}` are
staff/admin. That asymmetry is the shape of the module — the consumer modal and the ops queue share
a service and never call each other's operations.

### The bug: a reason set that contradicted its target type

The server validates the reason **against the target type**. `FOR_USER` is
`impersonation|fraud|brokerage|abuse|spam|fakelistings|other`; `FOR_POST` is
`fake|unavailable|filled|broker|inappropriate|spam|other`.

`Flatmates.jsx` and all three flatmate cards passed `kind='user'` (or `'listing'`) while shipping
`SHARE_REPORT_REASONS` — which *is* `FOR_POST`, exactly. So **every flatmate report would have been
a 400**: `filled` is not something you can say about a person.

It survived because the mock stores whatever it is handed. The report landed, the user was thanked,
and it appeared in the ops queue under the wrong tab. Fixed at all four call sites (`share` →
`post`), and the mapping table in `reportMapper.js` now warns on an unknown kind rather than
silently guessing.

| Modal reasons | Client `kind` | Wire `targetType` |
|---|---|---|
| `LISTING_REPORT_REASONS` | `listing` | `property` |
| `OWNER_REPORT_REASONS` | `user` | `user` |
| `SHARE_REPORT_REASONS` | `share` | **`post`** |

### Three server rules the mock has no equivalent for

**A duplicate is a 409.** A second *live* report of the same target by the same person is refused,
backed by a partial unique index and not only by a check — so two concurrent submissions get the
same answer. The modal used to close and toast success unconditionally, because a localStorage
write cannot fail. It now has a sentence for it: thanking somebody for a report nobody received is
the one outcome worth avoiding, because they stop worrying about it.

**Terminal is terminal.** `actioned` and `dismissed` cannot move. The queue's "Reopen" button would
409 on click, so it is gone — replaced by a "Decided" label. The server's reasoning is worth
keeping: re-opening "erases the record that somebody judged it, and it is the obvious way for one
moderator to quietly undo a colleague's decision".

**`resolved` does not exist.** It was the queue's word for "reviewed, no action needed", which is
what `dismissed` means. Translated on the way *out* only — the queue never *displays* a status the
server did not record.

### What the wire deliberately withholds

The mock froze a snapshot of the target at report time: `targetTitle`, `targetOwner`, `ownerMobile`,
`reportedBy`, `url`. The contract declares none of them, and `reporterId` is withheld on purpose —
"the queue tells a moderator what was complained about and why, not who complained: naming the
reporter to every member of ops is how a complaint becomes a reprisal".

So they degrade rather than being invented. `targetTitle` falls back to the bare `targetId`: a
moderator can click through, whereas a *resolved* title would be a **stale** title, because the
listing may have been edited since it was reported — and a moderator judging yesterday's complaint
against today's copy is worse than one who has to open a tab.

`reasonLabel` is the exception: presentation text the client already ships, resolved locally from
one flattened table both providers share.

## The switch-on slice: four providers that were live on paper only

`contact`, `saved`, `savedSearch` and `visit` shipped complete http providers, complete parity
harnesses and a row in the table above. What they never had was a place in
`VITE_API_DOMAINS` — so the live e2e config had never once loaded them, and every browser run since
had been quietly exercising their mocks.

The parity harnesses passed the whole time, and that is the point. A harness imports the provider
and calls it directly; it cannot see a React call site that never awaits, or a request fired for a
visitor who has no session. Four things were wrong, and all four were invisible from that angle:

| Found | Why the harness could not see it |
|---|---|
| `isHttpDomain('savedSearch')` could never match — the allow-list is lower-cased at parse time, the lookup key was not | The harness imports the provider directly and never consults the registry |
| Signed-out visitors fired **four** `401 /contacts/status` per property page | The harness is always signed in |
| Both alert cards showed "first in line" without awaiting the create | The harness calls the provider, not the form |
| Reschedule fired at a provider that throws by design (D87) | Same — the control is a React button, not a provider method |

The `savedSearch` casing bug deserves its own note, because it fails in the worst available
direction: the "enabled but has no http provider" warning is itself gated on `isHttpDomain`, so an
opted-in domain whose name did not match served mocks with **nothing in the console to say so**. A
live e2e run would have passed while testing the mock — the exact failure this whole config exists
to prevent.

### `PageEnvelope.page`, not Spring's `number`

Four providers (`contact`, `saved`, `review`, `report`) read `res.number` for the current page.
The contract calls that field `page`, and so does the server. Every one of them had a fallback —
`res?.number ?? page` — so the wrong read silently resolved to the *requested* page instead.

That agrees with the server right up until it disagrees: any clamp or redirect (a `page` past the
end, a size ceiling) and the client reports a page the caller is not on. Two of the parity harnesses
had the same bug in their own unwrapping, which is why it had gone unreported — harness and provider
were wrong in the same direction and cancelled out.

### The reschedule control

`saveReschedule` closes the modal and toasts success *before* the write settles. Against the mock
that is harmless; against the live API the write throws, so the user would have seen "Rescheduled"
and an error toast at once, with no way to tell which was true. The control is hidden in http mode
rather than left to fail — the same treatment support's priority picker gets, and for the same
reason: a control that lies is worse than a control that is absent.

## Backend gaps that block the last two aggregates

Two client-side aggregates could **not** be expressed with shipped endpoints, and are named here
rather than quietly left as whole-catalogue scans:

| Aggregate | Blocker | Needs |
|---|---|---|
| Societies "N homes" | No `society` facet on `/properties`; the society list itself is client-side mock data, so an exact count over fabricated societies is meaningless | a `society` facet, or a societies slice |
| Saved-search match counts (`listings/alertCriteria.js` `countMatches`) | Matches on **multi-valued** `localities[]`/`bhk[]`; server facets are single-valued, so it would take \|localities\| × \|bhks\| requests per saved search | a saved-search / alerts count endpoint |

## Shape gaps (resolved in Phase 2b)

The backend does **not** return a mock-compatible property. The http provider needs a mapper:

| Mock field | Backend field | Action |
|---|---|---|
| (bare array) | `PageResponse{content,page,size,…}` | unwrap in provider |
| `type` | `propertyType` | rename |
| `bhkNum` | `bhk` | rename |
| `image` | `coverImage` | rename |
| `gallery` | `images` | rename |
| `archived` (bool) | `status` (enum) | derive |
| `localitySlug` | `localitySlug` | ✅ **resolved** — now emitted by `PropertySummary`/`Property` |

### Verified by `npm run parity:property`

`frontend/scripts/property-parity.mjs` drives the **real** mock provider and the **real** http
provider (not the mapper alone, and not re-implementations) against a live backend and diffs the
resulting view models. It is deliberately **fail-closed**: every mock field must appear in
`REQUIRED`, `OPTIONAL` or `WAIVED`, because an unclassified field is a field nobody has judged. It
also compares the **union of keys across all rows**, not one sample — the first version compared a
single listing and missed seven fields that only some rows carry.

It additionally asserts:

- **Both providers expose the same operations.** `propertyService.js` forwards blindly, so a method
  added to one provider and forgotten on the other fails at runtime, on whichever page calls it, in
  whichever mode nobody tested. Comparing the exported surfaces catches that up front.
- **`countProperties` counts the result set, not a page** — checked against `totalElements`, both
  unfiltered and locality-filtered, plus a check that the filter actually narrowed the count.
  Mutation-verified: making it read `content.length` fails the harness.
- **`getPropertiesByIds` drops unknown ids** rather than throwing or leaving a hole, and preserves
  request order — the behaviour Saved and Compare depend on when a listing is archived later.
- **Vocabulary drift is audible**: an unrecognised possession value must map to `undefined` in both
  directions *and* emit a console warning. Degrading gracefully and degrading silently are different
  things, and the warning is itself covered so it cannot rot away.

Not covered: `myListings`, `archiveListing` and `restoreListing` are checked for presence but not
driven, because they need a real session and would write to the dev DB.

```powershell
npm run parity:property                                      # defaults to http://localhost:8080/api
node scripts/property-parity.mjs --base http://localhost:8081/api
```

**Point it at the backend you actually changed.** A server running older code fails these assertions
in the same shape as a real regression, so the harness prints `live API: <base>` before comparing —
check that line first when it fails.

Current verdict: **PASS**, with these deliberate divergences.

| Field(s) | Status | Why it's tolerable |
|---|---|---|
| `desc`, `owner`, `ownerId`, `ownerMobile` | detail-only on the wire | verified unread by `Card.jsx`; matches the contact-gate intent |
| `floorPlan` | absent | read as `p.floorPlan \|\| floorPlanFor(p) \|\| DEFAULT` — synthesised |
| `priceStr`, `commercialType`, `shellType`, `washrooms`, `powerBackup`, `fixtures`, `form` | absent | commercial/land enrichment, every read guarded by `?.`/`\|\|`/`Array.isArray` — thins the detail page, doesn't break it |

### ✅ `construction` / `possession` — resolved (V10)

This was the one divergence that broke a feature rather than degrading it, so it was fixed in the
contract rather than papered over in the client.

- **Was:** UI had `construction ∈ {ready, new, under}` driving the availability filter; the backend
  had `possession`, nullable free **text**, detail-only, not filterable, `NULL` in all 38 rows. With
  the property domain on http, "Ready to move" returned **zero results**.
- **Now:** `PropertyPossession` is a first-class enum — `ready-to-move | new-launch |
  under-construction` — on `PropertySummary` (so cards carry it), as a `possession` search facet, and
  validated on create/update. `V10__property_possession.sql` adds a `CHECK` constraint and backfills
  the seeded catalogue.

| Layer | Enforcement |
|---|---|
| OpenAPI | `PropertyPossession` schema + `possession` query param |
| API edge | `@Pattern(PropertyPossession.PATTERN)` on `ListingCreate`/`ListingUpdate` → 422 |
| Database | `properties_possession_check` — blocks values arriving via backfills or ops scripts |
| Client | `propertyMapper` translates `ready-to-move ⇄ ready` in both directions |

**Two decisions worth remembering.** `NULL` is legal and means *not stated* — deliberately distinct
from all three values, so an unrecorded listing never satisfies a "Ready to move" search (plots stay
here permanently). And the wire vocabulary is intentionally *not* the UI's `ready|new|under`
shorthand: `possession=new` is ambiguous in a long-lived public contract, and translating in the
mapper is a far smaller diff than renaming ~14 UI read sites and their i18n keys.

`npm run parity:property` asserts the whole path end-to-end: that `toQuery({construction:'ready'})`
emits `possession=ready-to-move`, that the facet returns rows, that every returned row is `ready`,
and that no unstated listing leaks in.

### Why `localitySlug` exists (settled — do not "simplify" it away)

`localities.slug` is the **primary key**, and `properties.locality_slug` / `societies.locality_slug`
are real FKs to it. `localities.name` has no uniqueness constraint at all. The slug is also the
public URL key (`/locality/{slug}`), so it is SEO-load-bearing and must survive a display rename.
The property search facet (`GET /properties?locality=…`) matches the **slug**, not the display name:

```
?locality=baner  -> 2 results
?locality=Baner  -> 0 results
```

Server-side resolution lives in `catalog.locality.LocalityResolver` (slug hit → case-insensitive
name → containment for sub-areas like "Hinjawadi Phase 1" → nearest curated locality within 2.5 km).
It mirrors the client's `resolveLocalitySlug` with one deliberate difference: the server returns
`null` rather than coining `slugify(name)`, because the column is FK-constrained and coining would
mean polluting the curated locality table (and the sitemap) with owner typos.

## Backend changes the http providers must account for (API polish pass)

The backend was reviewed and hardened before integration began. Five changes alter what a client
sees, so they are recorded here rather than only in the contract.

| Change | What breaks without it |
|---|---|
| **`/api` is now a real prefix** (`server.servlet.context-path`) and the Vite proxy no longer rewrites it | Nothing, in dev — which was the problem. The backend used to serve `/auth/login` while every layer claimed `/api/auth/login`, and it only worked because the proxy stripped the prefix. Pointing `VITE_API_BASE` at a deployed host would have 404'd every request. Health and Swagger move too: `/api/actuator/health`, `/api/docs` |
| **Four reads are now paged**: `GET /me/saved`, `GET /messages`, `GET /admin/flatmate-reviews`, `GET /admin/group-applications` | A provider reading `response.length` or iterating the body gets the envelope, not the rows. Unwrap `content`, and read `totalElements` for counts — `$.length()` on an envelope returns the *field count* (6), which is the confusing failure these produced in the backend's own tests |
| **Three endpoints added**: `PATCH /me/saved-searches/{id}`, `GET /me/properties/{propId}/boost`, `GET /admin/reviews` | Each was a feature whose UI could write but never read. `toggleSearchAlert` in the mock provider now has a real counterpart; the boost UI can render its own state; the review moderation queue is reachable |
| **`GET /properties/{id}/rooms` now exists** | It was declared in the contract and served by nothing — a generated client 404'd on a promise the document made |
| **`furnishing` and `possession` now revert a listing to `pending`** | The client's `LISTING_FOUNDATION_FIELDS` list disagrees with the server in *both* directions and must be reconciled before the listing domain goes live — see below |

### The foundation-field list is still wrong client-side

`lib/store/listings.js` lists twelve fields; the server's rule is the **searchable** set:
`price`, `bhk`, `propertyType`, `locality`, `deal`, `furnishing`, `possession`. The two disagree
both ways — the client warns on `title`/`area`/`facing`/`floor`/`age` (which do *not* revert) and
stays silent on `price` (which does). So the UI currently warns "this will send your listing back
for review" on edits that don't, and says nothing about the edit that does.

The server side is fixed and self-enforcing: `ListingFoundationTest` reads the facets off
`PropertyController.search` by reflection, so a new search facet fails the build until somebody
decides whether it is a foundation field. The client list still needs updating to match.

## Local run

See [`../LOCAL_DEV.md`](../LOCAL_DEV.md) for Postgres + backend + frontend, the Vite `/api` proxy,
and how to read the OTP out of the backend log in dev.
