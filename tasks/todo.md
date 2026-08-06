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

**Documents** — the 9th seam domain. 7 endpoints, 12–13 frontend files. The only multipart surface
in the seam, and every consumer is built on base64 `dataUrl` while the server returns short-lived
signed URLs. Also needs a backend addition first: a buyer cannot list their own outgoing requests.

---

## Shipped

Newest first. Each line: what changed, and the one thing worth remembering.

### Frontend ↔ API integration (the seam)

| Date | Slice | Note |
|---|---|---|
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
