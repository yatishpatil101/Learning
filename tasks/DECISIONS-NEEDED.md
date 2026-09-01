# Decision ledger — mock retirement

Every question raised during the migration, and its answer. One line each.
This file records **decisions**, not narrative — the story of each build is `tasks/todo.md`,
the phase plan is `docs/migration/`, and the coverage claim is `e2e/COVERAGE.md`.

Rules for this file: a decision gets a row, never a section. When a row's work ships,
the row stays (it is the record of *why*) and nothing else is written anywhere else.
Do not restate a decision in `todo.md`, `HANDOFF.md` or `docs/migration/` — link to the number.

---

## Closed — decided and shipped

| # | Question | Answer |
|---|----------|--------|
| 1 | Reels: where do feed photos come from? | Reuse listing photos; no separate reel media |
| 2 | Admin-editable content: where do translations live? | (b) `translations jsonb` on the content row — `V84` |
| 3 | Is an accepted quote the same number as the deal value? | (b) No — `V83` adds write-once `tickets.quoted_value` in rupees |
| 4 | How does an anonymous waitlist signup reach the server? | Public `POST /service-waitlist` taking `{ service, name?, mobile }` |
| 5 | Do interior/valuation forms still raise a board ticket? | Yes — the lead *is* the product on those landings |
| 6 | Two counters needing small endpoints | Shipped as D6b |
| 7 | Consumer dashboard Enquiries panel reads an unmodelled view | (a) Retire — the buyer already has the information |
| 8 | Homepage trust counters have no server to read | (a) Server-computed; not derived in the browser |
| 9 | Move-in Pack prices read from browser storage | (a), built as its own public route `GET /move-pack` |
| 10 | "Tell me when something matches" has no server home | (a) Build it — the largest item of that round |
| 11 | `tickets.value` has no write path | (b) The value belongs to the deal, not the ticket |
| 12 | Listing-freshness confirmation is browser-local | (a) Server-side — the badge must mean the owner, not the browser |
| 13 | Enquiries projection | Retire — fixtures and the panel branch deleted |
| 14 | Demand alerts | Notify first, then the demand signal |
| 15 | Audit seam | Build the seam, wire the writer, leave the reader flagged |
| 16 | Autonomy on deletions | Granted |
| 17 | Scope: is there a five-hour box? | No hard stop |
| 18 | Audit seam, corrected | Build nothing — the calls die on their own |
| 22 | Admin command palette searched fixtures on live | (2) Gate each data category on `isHttpDomain` — `a281858` |
| 28 | Owner WhatsApps themselves a chaser from the platform | (1) Delete the control — `368ad4f` |
| 30 | Review moderation queue moderated the browser copy | Both halves built — `48386b2` |
| 31a | Referral code and redemption | (1) Ported — `26129a2` |

---

## Decided, not yet built

Ordered by damage — what is silently wrong for a real user comes first
*(sequencing answered 2026-08-17: "fix what is silently wrong for real users first")*.

### 1 — 35. Map/geo policy never reaches a visitor

Admin writes the city limit, live cities and locality blacklist to `PUT /admin/settings`; all
20 consumer readers take it from `rawDb()?.settings?.geo` in their own browser. The control
reports success and changes nothing for anyone else.

**Do:** add public `GET /geo`, fetch once at boot into a module cache, leave the 20 synchronous
call sites unchanged. Retire `syncGeoFromDisk` and its three listeners (dev-only; a no-op in
production and under Playwright, so it worked only where nobody was affected).
Not `/flags` — that contract is map-of-boolean and drops non-booleans on purpose.

### 2 — 24. Locality curation queue is one browser's localStorage

When an owner's locality matches nothing the server correctly declines to coin a slug and leaves
the listing for a human. The queue that human opens is their own `localStorage`, so the listing is
approved with `locality_slug` null and becomes invisible to search facets, `/locality/{slug}`,
saved-search alerts and the society join.

**Do:** re-point `/admin/localities` Pending at *listings whose `locality_slug` is null*, using the
existing admin locality POST/PATCH routes. No new table; the community-locality tier goes.
Approving a null-locality listing must warn or block — that ordering is the whole bug.

### 3 — 23. Own-listing dedup compares against fixtures

`evaluateListingDedup` iterates `rawDb().listings` (38 fixtures) on live, so it can block a real
owner and offer a link to a listing id the server has never had.

**Do:** add a narrow "have I already listed this?" endpoint scoped to the caller's own listings.
Not the staff duplicate probe — that is deliberately advisory ("a collision is a suspicion, not a
finding") and staff-only.

### 4 — 33. Saved-search match count is capped at one page

The notifications screen filters one page (`PAGE_SIZE = 100`) in the browser. Right today only
because the catalogue is 38; quietly wrong at 101. `warnIfTruncated` cannot fire below that ceiling
and is a `console.warn`, which e2e drops.

**Do:** add a server-side match count — a route or a `matchCount` field on the saved-search list.
Cheap independent win: promote the warn to an error, or seed above the ceiling.

### 5 — 34. Society follows are per-browser

Following on a laptop does not follow on a phone. The server's idempotent PUT/DELETE routes and
per-row `followedByMe` are built and have never been called; the one thing the API cannot answer
is "which societies do I follow?", which is why four of five surfaces cannot port alone.

**Do:** add `GET /me/societies/following`, then port all five surfaces together.

### 6 — 29. No server-side internal notes

Five moderation actions write notes to `db.internalNotes` in localStorage while the decision beside
them is a real API call landing in the audit log.

**Decided 2026-08-17:** notes are **retained customer information**, not scratch. Staff may add
*and modify* them. Any staff or admin can read any note — deliberately inter-transparent.
Notes on a **person** are in scope.

**Do:** table + permission atom + endpoints for `listing`, `report`, `review` **and `user`**.
Mutable, real author id recorded on write, no per-team walls. Fix the two silent reads
(`lib/mockApi/ownerComms.js`, `lib/mockApi/users.js`) that return `[]` so the Communication Log
renders short instead of absent.

### 7 — 31b. Referral reward currency

**Decided 2026-08-17:** no rupee reward. A qualified referral adds **+15 owner-contact unlocks** to
the referrer's account, so their balance becomes existing + 15.

**Do:** move the quota grant server-side onto the account (it is `localStorage` today, so it does
not survive a device change). `rewardsEarned` / `rewardsPending` are not displayed;
drop the ₹ ledger from the consumer surface. Retire `creditReferrer`, `claimReferralCredits`,
`setReferredBy` and the local counters once the server grants the contacts.

### 8 — 19. Society binding is a hash

`societyForListing` picks a society by `fnvHash`, so a property page prints a real named building's
builder, unit count, tower count, year and occupancy for a listing that is not in it.
`properties.society_id` is null for all 38.

**Do:** both halves — add the society question to the listing wizard so the binding is real, **and**
render the Society section only when bound. Until listings are bound the section is absent, which
is correct.

### 9 — 27. Pipeline stages: two funnels, one column

Console offers contacted/info_collected/listed/docs_submitted/under_review/live; the server's check
constraint allows listed/docs_submitted/photos_uploaded/aadhaar_verified/claim_sent/claimed.
They agree on two of six.

**Do:** the server grows the console's two extra stages. Migration required; hand-back milestones
move to their own column. `setPipelineStage` is the last browser-store write on that screen.

### 10 — 32. Managed properties

Six server routes and `V33` exist with zero rows; the client mints a record in `localStorage` for
every listing you own.

**Decided 2026-08-17:** Rent-o-meter does nothing — leave it on the UI as-is. Migrate everything
else to the backend.

**Do:** port get / getOne / register / update / delete. Two things need answering as they are
reached: client `publish` also writes a listing row and a notification the server was never asked
for, and `ensureManagedForListing` auto-creates on render (one POST per listing per dashboard load).

### 11 — 26. The `services` CMS type

Built on the server, wired through both client providers, reachable from neither end — no console
tab writes it, no page reads it, `cms_services` seeds zero rows.

**Do:** keep it; correct the comment. `ContentTypes` claims "the four CMS lists ops manages" —
ops manages three.

### 12 — 25. Admin Enquiries desk

No server surface. Every matching route is caller-scoped by construction, so this is a standing
exemption from the contact gate.

**Do:** build `/admin/enquiries`, `/admin/visits`, `/admin/deals` with **contact detail masked by
default and a per-row reveal**. The reveal is an audited action.

### 13 — 20. Finance console

The revenue chart is a seeded PRNG, ledger rows take their status by rotating a hardcoded array,
and `rentFeeRevenue` sums a `db.rentFeeLedger` that does not exist. `GET /admin/finance` returns
four figures plus three disclosure booleans and has never been called.

**Decided 2026-08-17:** do not delete anything from the UI. Build the backend to support every
finance feature on screen, then replace the mock with real data.

**Do:** extend the server to serve what the console draws — a real monthly revenue series, a
payments/transaction ledger with real statuses, and the inputs behind MRR and ARPU — then point the
console at it. This needs the payments work that does not exist yet, so it is a programme, not a flip.

### 14 — 36. Analytics tabs

Seven of eight tabs are a seeded LCG (`rng(424242)`); only Supply Gap is live.
`GET /admin/analytics` serves four metrics no tab charts.

**Decided 2026-08-17:** serve analytics from the server; build endpoints that feed every tile.
Traffic collection comes later — for now build the tiles the database can already answer and leave
the traffic tiles on mock data until the platform is live and has real traffic.

**Do first, and independently — this is a trap:** `AdminAnalytics.jsx:35` calls `getAnalytics()`
from `mockApi.js` and `:59` gates the whole page on it, so deleting the mock hangs the page
*including the one working tab*. Drop the call, the `sources` prop and the `!analytics` gate before
anything else. Then add DB-backed endpoints per tile. Traffic tiles (page views, sessions, sources)
have no source — there is no sessions table, no page-views table and no client beacon — so they
stay on mock data and must be labelled as such until collection is built.

---

## Still genuinely undecided

| Question | Why it is open |
|----------|----------------|
| Checkmarx or CodeQL? | Neither is configured; Checkmarx is commercial. CodeQL is the free native equivalent. See `docs/migration/06-code-quality.md`. |
| Caching layer | None exists. Per D133: measure the real call count first — no cache until a profiler asks for one. |
| Does the "first verification" Featured perk survive? | Needs `featured_until` + a reason + a grant ledger, and a call on giving paid placement away. Recommendation: record as intentionally dropped. |
| Should a buyer see "Posted by PuneNest"? | `PropertyResponse` omits `adminPipeline` from consumer reads on purpose. If it is a trust signal, the contract needs a public boolean that is not the pipeline. |
| Who owns the concierge fixtures? | All 38 seeded properties have `posted_by_admin = false`, so the post-on-behalf surface is empty on live. Needs seed rows per pipeline stage against a known-green baseline. |
