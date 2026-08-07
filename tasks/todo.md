# Tasks

> **This file is a chronological *index* of shipped work, plus whatever is currently in flight.**
> It is deliberately short. Everything durable lives elsewhere and is linked from here:
>
> | What | Where |
> |---|---|
> | What we still owe (deferred, with owner + trigger) | [`docs/system/tech-debt.md`](../docs/system/tech-debt.md) |
> | What someone must decide | [`docs/system/open-questions.md`](../docs/system/open-questions.md) |
> | How the frontend reaches data, and why | [`docs/system/frontend-data-seam.md`](../docs/system/frontend-data-seam.md) |
> | Architecture, data model, API standards | [`docs/system/`](../docs/system/) |
> | Test coverage per route/feature | [`e2e/COVERAGE.md`](../e2e/COVERAGE.md) |
>
> **Rule: a finished slice gets one index line here, not a narrative.** The reasoning that is worth
> keeping goes into the docs above or into a comment next to the code it explains — those are read
> when the code is read; a worklog entry is not.
>
> Compressed 2026-08-06 from 5,294 lines. Every one of the 86 open checkboxes was checked against
> the tree before removal — 62 had shipped, 3 were fixed on the spot, and the rest moved to the
> register. Details in the last entry.

---

## In flight

Nothing.

## Next up

**Documents** — the 10th seam domain. 7 endpoints, 12–13 frontend files. The only multipart surface
in the seam, and every consumer is built on base64 `dataUrl` while the server returns short-lived
signed URLs. Needs two backend additions first: a buyer cannot list their own outgoing requests, and
dev `MockFileStorage` mints `https://mock.storage.local/…`, which does not resolve — so the vault
would migrate and then be unopenable locally.

**Societies** — smaller, and now unblocked. `GET /societies` carries `avgRating`/`reviewCount` as of
the reviews slice, which is what the three society-card call sites need; they hold SEAM NOTEs
pointing here.

---

## Shipped

Newest first. Each line: what changed, and the one thing worth remembering.

### Frontend ↔ API integration (the seam)

| Date | Slice | Note |
|---|---|---|
| 2026-08-07 | **Abuse reports** — seam domain 11 | See below |
| 2026-08-07 | **Support tickets** — seam domain 10 | See below |
| 2026-08-07 | **Reviews** — seam domain 9 | See below |
| 2026-08-06 | **Conversations** — seam domain 8 | See below |
| 2026-08-06 | **Worklog compression + OpenAPI 3.1 nullable fix** | See below |
| 2026-08-06 | **Notifications** — seam domain 7 | Server/UI type vocabularies had *zero* overlap; untranslated, every filter chip would silently empty the page. `dismiss` is a client tombstone (no endpoint) |
| 2026-08-06 | **Listing moderation** — `GET /admin/properties` + the 4 decisions | The four writes had shipped months earlier with **no read that could find a listing to act on**. Inferring the route from filter flags 403'd every owner's dashboard — authorization-relevant routing must be named by the caller |
| 2026-08-05 | **Visits** — seam domain 6 | Reschedule has no endpoint (D87); the seam carries the human `when` string and converts to the wire's ISO slot |
| 2026-08-05 | **Saved searches + alerts** — seam domain 5 | Anonymous lead capture stays local (D85) — `POST /me/saved-searches` would 401 for exactly the signed-out visitor the card exists to capture |
| 2026-08-04 | **Saved shortlist** — seam domain 4 | Membership answered from `SavedContext`, never per card — the naive conversion was 30 requests to draw 30 hearts |
| 2026-08-04 | **Contact gate** — seam domain 3 | Keyed on `propertyId`: the grant is per listing, not per owner |
| 2026-08-03 | **Owner number-hiding, city on profile, paged contact inbox** | Backend prep for the contact slice |
| 2026-07-30 | **Property** — seam domain 2, incl. `localitySlug` hardening | `construction`/`possession` was the one divergence that *broke* a feature rather than degrading it — fixed in the contract, not papered over in the client |
| 2026-07-29 | **Auth** — seam domain 1, Phase 0 + 1 | Established the provider pattern and the parity-harness habit |
| 2026-07-28 | **Phase 2a** — route property consumers through `services/` | 21 files imported `lib/` directly; a seam with a bypass is not a seam |

### Backend slices (OpenAPI-first, 208 operations)

| Date | Slice | Note |
|---|---|---|
| 2026-08-07 | **Tech-debt pass** — D90, D82, D19, D22, D83, D86, D97(d), D95 closed; D33 rule amended | **The register's own numbers were the least reliable thing in it** — D19 said "7 files, cosmetic" (22 files, mangled ₹ in live prices); D96 said "50 specs" (9); D33 said 562 `@param` (673). A `@Transactional` test base class **cannot see a commit-time bug** — D90 survived 750 tests. And a mutation test caught a *bad assertion*: the D95 perk test passed with the guard disabled, because an unguarded grant moves to the next listing rather than re-extending the first |
| 2026-08-02 | **Tech-debt batches** — D1 Lombok, concurrency, register audit | Three passes; the register is now the SSOT for what is owed |
| 2026-08-01 | 15 — share-flat + admin listing correction (4 ops) | `adminUpdateProperty` shares one `apply` with the owner path — two copies would drift |
| 2026-08-01 | 14 — Admin & Analytics (13 ops) | Revenue blanked for staff; `/admin/finance` is admin-only |
| 2026-07-31 | 13 — Billing & Growth (14 ops) | |
| 2026-07-31 | 12 — conversations + support tickets | Thread creation requires an approved contact request — the constraint the conversations seam slice will have to design around |
| 2026-07-31 | 11 — service requests + staff ticket queue (13 ops) | |
| 2026-07-30 | 10 — Documents & agreements | Storage keys server-minted; content type derived from bytes, not the client header |
| 2026-07-30 | 9 — Moderation / Trust & Safety (20 ops) | Spec fix S28: `archive`/`restore` are dual-audience, so their guard lives in the service — `@PreAuthorize` can express "is staff" but not "is staff or owns this row" |
| 2026-07-29 | 8 — Reviews (S26/S27, migration V16) | `context` is readOnly — a settable one is the forgery vector |
| 2026-07-29 | 7 — Catalog & Search, + pagination and OTP rate-limiting pass | Every sort must be index-backed |
| 2026-07-28 | 5 — finance ledger + tenancy lifecycle | |
| 2026-07-28 | 4 — deals / offers / visits | |
| 2026-07-27 | 3 — contacts + gate + Aadhaar badge | |
| 2026-07-27 | 2 — properties + listings | Slug-or-id resolution: parses as UUID → by id, else by slug |
| 2026-07-26 | 1 — auth + users | |
| 2026-07-26 | **Package structure** — bounded-context layout | |

### Database

| Date | Change | Note |
|---|---|---|
| 2026-08-04 | **One populated local DB, schema by Flyway only** | Closed D81 the day it opened. Three permanent Flyway traps recorded in `R__zz_dev_demo_data.sql`'s header — repeatable migrations sort by description across *all* locations (hence the `zz_` prefix), `ON CONFLICT (id)` is too narrow for a seed, and data extracted from an old schema is not automatically valid under the current one |

### Mobile-first programme

| Date | Phase | Note |
|---|---|---|
| 2026-08-05 | Home "Flatmates" tile optimisation | |
| 2026-08-05 | Mobile review B5 / C5 / D1 + CI | B7 blocked on a product call (D98) |
| 2026-08-03 | Desktop e2e triage | |
| 2026-08-03 | Phase 6 — deferred-item sweep | |
| 2026-08-02 | Bundle — eager vendor chunks | **571 KB off first paint.** `financeProvider → lib/data/finances.js → jspdf` was statically imported *and* `modulepreload`ed, so every mobile visitor downloaded a PDF library to see a listing |
| 2026-08-02 | Phase 4 — §F items incl. PWA (#17) and landscape (#24) | |
| 2026-08-01 | Home Phase 3 — featured-first, search-on-demand | Featured moved above Categories on mobile via CSS `order`, leaving DOM order (and every desktop spec) untouched |
| 2026-08-01 | Phase 2 — mobile-design-review sweep, waves H–R | |
| 2026-07-31 | Phases 1, 3, 4, 5 — content, touch targets, native affordances | |
| 2026-07-31 | Rename "Share Flat" → "Flatmates" | Internal enum values stay `'share'` on purpose — renaming would orphan persisted localStorage |

### Trust model & KYC

| Date | Change | Note |
|---|---|---|
| 2026-07-28 | **Badge-not-gate migration**, 8 pages + consistency sweep | ADR-019. Verification is a badge that earns visibility, never a precondition to act |
| 2026-07-28 | KYC growth levers, native DigiLocker consent flow | |
| 2026-07-27 | Trust model pivot documented | Open product questions live as Q6–Q10 in `open-questions.md` |

### Docs & contract

| Date | Change |
|---|---|
| 2026-08-02 | Re-sync docs + OpenAPI to the flatmates redesign & mobile-first UI |
| 2026-07-27 | 3-way sync: `platform-architecture.md` (SOT) → OpenAPI → React |
| 2026-07-26 | OpenAPI established as the single source of truth; matured to cover all React needs |
| 2026-07-25 | Platform & solution architecture (MVP pass), ADR-009a KYC, ADR-014 payments, legal/compliance advisory |

---

## 2026-08-07 — Switching on the four domains that were live on paper only

`contact`, `saved`, `savedSearch` and `visit` shipped complete http providers and parity harnesses
in `e330cd3`, but were never added to `VITE_API_DOMAINS` — so no browser had ever run them, and
every live e2e run since had been quietly exercising their mocks. Added to the live config; the
seam is now 11 domains live, not 7.

The parity harnesses had passed the whole time, which is the point. A harness imports the provider
and calls it; it cannot see a React call site that never awaits, or a request fired for a visitor
with no session. Five things were wrong and none were visible from that angle:

- **`isHttpDomain('savedSearch')` could never match.** The allow-list is lower-cased when parsed,
  the lookup key was not. Worst-case failure mode: the "enabled but has no http provider" warning is
  itself gated on `isHttpDomain`, so the domain served mocks with **nothing in the console** — a live
  run would have passed while testing the mock (D105).
- **A signed-out visitor fired four `401 /contacts/status` per property page.** The gate asks where
  *this caller* stands; someone with no session has made no request, so the server can only say 401.
  Short-circuited on `readAccessToken()`; the 401 branch stays as a fast-path backstop.
- **`PageEnvelope.page`, read as Spring's `number`** in four providers, each behind a fallback that
  resolved to the *requested* page — right until the server clamps or redirects. Two parity
  harnesses had the same bug in their own unwrapping, which is why it cancelled out and went
  unreported (D106).
- **Both alert cards showed "first in line" without awaiting the create.** Now awaited, with an
  `alertFailed` toast in en/hi/mr and a disabled submit while in flight.
- **Reschedule fired at a provider that throws by design** (D87), from a handler that closes the
  modal and toasts success first — so the user would have seen "Rescheduled" *and* an error at once.
  Control hidden in http mode, same treatment as support's priority picker.

Also fixed: the four oldest parity harnesses could not run under Node ≥ 22 at all (bare `db.json`
import, `import.meta.env` outside a bundler), so "the harness passes" had been vacuously true —
migrated to the Vite SSR loader the newer three already used (D107). And `AdminReports`' detail
drawer still rendered the Reopen button removed from the rows a slice ago, referencing an import
that no longer existed: a lint error, and a control that would 409 on click.

---

## 2026-08-07 — Abuse reports: the 11th seam domain

`POST /reports` · `GET /reports` (staff/admin, paged) · `PATCH /reports/{id}`. `reportService.js` +
mock/http providers + mapper, `parity:report`, live e2e walking the whole loop across two sessions.
The **first domain whose two ends have different audiences** — anyone files, only ops reads.

**The bug: a reason set that contradicted its target type.** The server validates the reason
*against* the target type. `SHARE_REPORT_REASONS` is `FOR_POST` exactly — but `Flatmates.jsx` and
all three flatmate cards passed `kind='user'` or `'listing'`. **Every flatmate report would have
been a 400**, because `filled` is not something you can say about a person. It survived because the
mock stores whatever it is handed: the report landed, the user was thanked, and it appeared in the
ops queue under the wrong tab. Fixed at four call sites; the mapper now warns on an unknown kind.

**Three server rules with no mock equivalent, each of which changed a control:**

- **Duplicate → 409.** The modal closed and toasted success unconditionally, because a localStorage
  write cannot fail. Thanking somebody for a report nobody received is the outcome worth avoiding —
  they stop worrying about it.
- **Terminal is terminal.** "Reopen" would 409 on click, so it is gone. Re-opening erases the record
  that somebody judged it, and is how one moderator quietly undoes a colleague's decision.
- **`resolved` does not exist server-side.** Translated to `dismissed` on the way *out* only, so the
  queue never displays a status the server did not record.

**What the wire withholds, and why nothing was invented:** `reporterId` is omitted on purpose —
"naming the reporter to every member of ops is how a complaint becomes a reprisal". `targetTitle`
falls back to the bare id rather than being resolved, because a resolved title would be a **stale**
one: the listing may have been edited since it was reported, and judging yesterday's complaint
against today's copy is worse than opening a tab.

**Process:** the live test's "a consumer gets 403" probe was removed rather than kept — an in-browser
`fetch` carries no bearer token, so it asserted 401-unauthenticated, not 403-wrong-role. Same class
of mistake as last slice's vacuous badge assertion. The real 403 is asserted in the parity harness,
which signs in as an actual consumer. Mutation-verified: `share→user`, terminal-status and the 409
handler were each broken on purpose and each caught.

---

## 2026-08-07 — Support tickets: the 10th seam domain

`GET|POST /support/tickets`, `GET /support/tickets/{id}`, `POST .../messages`, `POST .../read`.
Five endpoints, one page, a one-to-one mapping onto the mock's five functions. `supportService.js`
+ mock/http providers + mapper, `parity:support`, live e2e. 6/6 mock e2e, parity PASS
(mutation-verified 4×), live test verified red-able.

**Three controls had nothing behind them**, and hiding them is the slice:

| Control | On the wire | Shipped |
|---|---|---|
| Priority (low→urgent) | absent from `SupportTicket` **and** `SupportTicketCreate` | hidden in http mode |
| Attachments (4 images) | `MessageCreate` is `{ body }` | hidden in http mode |
| Name / mobile | absent — the raiser is the session | left visible, D102 |

The first two had to be *hidden*, not merely not-sent: **an unknown property is ignored, not
rejected**, so a form that kept sending `priority` would show a success toast for a ticket ops never
sees as urgent. Worse than an error, because nobody learns anything.

**Three vocabularies to reconcile**, each with a wrong answer that looks right:

- **Status** — the server opens every ticket `open` (no `new`) and has an `in-progress` the page
  cannot label. Passed through unchanged rather than collapsed onto `open`: erasing a distinction
  ops made would tell the customer nothing was happening while somebody worked on it (D103).
- **Author role** — `buyer|owner|staff|admin` → `customer|staff`. `owner` is a *customer* of
  support. The first parity harness could not catch this because the probe signs in as a buyer; it
  now drives every role through the mapper directly. That gap was found by mutation, not by reading.
- **`updatedAt`** — not on the wire at all, and the list sorts by it. Derived from the last message;
  the server's `createdAtDesc` would put a ticket answered this morning below one opened last week.

**Scoping finding (D104):** I checked Societies first — it looked unblocked, since the reviews slice
had just added `avgRating`/`reviewCount` to `GET /societies` for exactly that purpose. It is not:
the frontend ships **348 societies and 155 localities**, the database has **28 and 16**. Migrating
would 404 on 92% of society hubs. The same check killed Localities. Catalogue reference data is
seeded thinly across the board, which is why this slice went to a *user-generated* domain instead —
those have no alignment problem, because the rows are created by the user at runtime.

---

## 2026-08-07 — Reviews: the 9th seam domain

`GET|POST /reviews/property/{id}` and `GET|POST /reviews/{entityType}/{entityId}`.
`reviewService.js` + mock/http providers + mapper, `parity:review`, live e2e. Backend: `avgRating`
and `reviewCount` added to the society **directory** row (they were already on the hub), computed
through the existing batched `RatingLookup`. 25/25 review endpoint tests, parity PASS
(mutation-verified twice), live suite green.

**The slice is that the wire is stricter than the mock, and the strictness is the product.**

`context` is the reviewer-standing badge — "Verified resident" / "Visited". It is derived
server-side from visit and tenancy history and is `readOnly` in the contract. Three call sites were
asserting it anyway:

- `ReviewModal.jsx` sent `context: 'visit'` hard-coded on **every** submission;
- `useSocietyHub.js` sent `resident: isVerifiedResident(slug)`, a client-side lookup;
- `ReviewsSection.jsx` rendered the chip **unconditionally**, so a null `context` fell through the
  ternary and displayed "Visited".

The first two were discarded live and believed on mocks — the worst split available, because the
demo and the screenshots come from mocks, so the badge earned its credibility exactly where it meant
nothing. The third is not a provider bug at all: the provider returned the correct null and the card
invented a badge from it. A badge a browser can assert about itself is not evidence, and evidence is
the only reason a stranger's rating is worth reading.

**Two key bugs, same shape, both invisible on mocks** — a localStorage map will key on any string
you hand it, so neither could fail until there was a server to disagree with:

- The society hub keyed reviews on `soc.id` (a synthetic `S01`) while follow, Q&A, resident status,
  board and WhatsApp all already used `soc.slug`. Reviews were the single holdout.
- The locality page keyed reviews on `activeName.toLowerCase()` — the *display name* — while its
  listings query, societies filter and URL used the slug. One-word localities agree, which is
  exactly why it survived; `viman nagar` vs `viman-nagar` is where it did not.

**What was deliberately not migrated, and why:**

- **Owner reviews** stay on the mock store. `getOwner()` still reads `lib/mockApi/users.js`, so the
  target id is a mock user id and the server keys on its own UUIDs. Migrating would issue a
  well-formed request for an owner the server has never heard of and render the empty result as "no
  reviews yet" — a silent wrong answer, worse than an honest mock.
- **The three society-card rating sites** call `entityRating()` inside a `.map()`. The fix is not to
  point them at the reviews service (one request per card) but at the aggregate the row now carries.
  Hence the backend addition; they hold SEAM NOTEs saying so.

`avgRating` is **null, not 0**, for an unrated society: a card rendering 0.0 for a society nobody has
reviewed states something false about it. The fields moved *up* from `SocietyDetail` to `Society`
rather than being duplicated, so the hub and the directory cannot drift into two different numbers.

---

## 2026-08-06 — Conversations: the 8th seam domain

`GET/POST /messages`, `GET /messages/{id}`, `POST /messages/{id}/reply`, `POST /messages/{id}/read`.
`conversationService.js` + mock/http providers + mapper, `ConversationContext` behind the navbar
badge, `Messages.jsx` and nine other `lib/chat.js` importers migrated, `parity:conversation`, live
e2e. Backend: `authorId` on `MessageDto`, and a notification written to the other side on every
reply. 750 backend tests green, 15/15 mock chat e2e, live suite green, parity PASS.

**The five shape gaps and the ruling on each** — these are the slice; the wiring was routine:

1. **`state: active|pending|incoming` does not exist server-side.** A thread only exists *after* an
   approved contact request (`ConversationService.related`), so every server thread is `active`.
   `pending` stays a **client-side staging queue** (`pnPendingRequests`) drained into `POST /messages`
   once approval lands. `incoming` — and the accept/decline buttons that act on it — are mock-only:
   on the server there is nothing left to accept, because the contact gate already did it.
2. **`youAre` is not on the wire.** Derived from `counterpartyRole`. An approximation, documented as
   one — a user who is both owner and buyer is classified per thread, which is what the page needs.
3. **`property.{price,loc,img}` are absent** — the wire carries `propertyId` + `propertyTitle` only.
   Degrade to title; resolving the rest would be N property reads per inbox render.
4. **`from: me|them` could not be derived safely.** `MessageDto` carried `author` (a *display name*)
   and no id, so the client would have had to match identity by string — works in dev, breaks the
   first time two users share a name. Added `authorId`; the test seeds two users called "Same Name".
5. **Share chips have no server representation.** The contract declares `MessageCreate.attachments`;
   the Java record does not implement it. Marked NOT IMPLEMENTED in the spec rather than invented.

**Three bugs the slice surfaced, all of which the mocks were hiding:**

- **Same-rank dependency.** `ConversationService` reaching into `engagement.notification` to write
  the notification is a cycle (leads=2, engagement=2) and `ArchitectureBoundaryTest` failed on it.
  Fixed with a `common.trust.Notifier` port — the pattern `ContactGate`/`RatingLookup` already set.
  That port is now the reusable mechanism for the rest of D92.
- **`property.img: ''`.** `<img src="">` makes the browser re-request *the current page* as the
  image. Mocks always had a URL, so it only appeared live, as a console error the e2e asserts on.
- **The inbox omits `messages`.** `ConversationDto.messages` is `NON_NULL` and the list contract
  drops it — a hundred previews would otherwise cost a hundred transcripts. The page worked
  perfectly on mocks (one store, whole objects) and opened an *empty thread* against the API. Fixed
  by hydrating on open. **A second-order bug fell out of the same async move:** the deep-link effect
  (`?c=<id>`) ran once at mount against a `convs` that was no longer populated synchronously, so it
  silently opened nothing — caught only because the mock e2e suite still deep-links. Both are the
  same lesson: *replacing a synchronous store with a fetched one changes when every reader runs.*

---

## 2026-08-06 — Worklog compression + OpenAPI 3.1 `nullable` fix

This file had reached 5,294 lines with 86 unticked boxes, and its own header already admitted the
boxes "are not a backlog". That is the failure mode worth naming: **a worklog that is never pruned
stops being read, and an unread list of open items is indistinguishable from having none.**

### What the 86 open boxes actually were

Each was checked against the tree rather than trusted.

- **62 had already shipped.** The 20 slice-2 property reconciliation and build-task items, the 14
  Home Phase 3 items, the 7 S26/S27 + migration-V16 items, the bundle bug, and the JDK-version
  blocker (`local JDK is 17, backend targets 21` — the toolchain is Zulu 25 and 747 tests pass).
  They were never ticked because they were *decision records* written in checkbox form.
- **3 were fixed here.** Both remaining ones were comments that contradicted their own code:
  `submit.js` claimed identity was "guaranteed by the Aadhaar gate" when the floor is L1 sign-in —
  a leftover from the pre-badge-not-gate model, and exactly the sort of stale comment that gets
  believed. `useFlatmateDiscovery.jsx` documented a "unified" `h-9`/`rounded-xl` scale on the line
  directly above one emitting `h-10`/`rounded-full`.
- **21 moved to the register** as D95–D99, or were already there (the SEC items, rate-limiting,
  Cashfree and the Wave L sheet all had entries).
- **2 were duplicates** of `open-questions.md` Q6–Q10.

**One was wrong in a way that mattered.** A "dead artefacts — no importers" note listed three files
to delete. `QuickFilters.jsx` was indeed already gone, but `FlatmateFields.jsx` is imported by
`Step1.jsx` and `REPORT_REASONS` has four importers. Acting on that note would have broken the
build. Recorded because it is the argument for verifying a stale note before acting on it, not just
before deleting it.

### The OpenAPI fix

The spec declares `openapi: 3.1.0` and used the 3.0-only `nullable: true` keyword **66 times**. In
3.1 that keyword does not exist and is ignored silently, so all 66 fields were documented as
non-nullable and a generated client would have typed them as required-non-null.

Converted to the 3.1 spelling — `type: [string, 'null']` — by a scripted pass over three shapes:
60 inline flow mappings, 5 own-line under a block mapping (one of which sat *below* a `format:`
line, so the transform walks back to the sibling `type:` rather than assuming the line above), and
one `allOf: [$ref] + nullable` that a type array cannot express at all and became an explicit
`anyOf: [$ref, {type: 'null'}]`.

`'null'` is quoted deliberately: inside a YAML flow sequence, bare `null` is the null *value*, not
the type name JSON Schema needs.

Verified: `validate_spec.py` → 166 paths / 147 schemas / 208 ops, no dangling refs; 66 type arrays
present, 0 `nullable:` keywords left; file still CRLF, no BOM, no mojibake.

### Deliberately not done

`e2e` console filtering (D96) — 50 of 67 specs assert "zero console errors" with no noise filter
while `helpers/console.js` exists for exactly that. It is a 50-file mechanical change, and burying
one inside a cleanup pass is how a cleanup pass stops being reviewable.
