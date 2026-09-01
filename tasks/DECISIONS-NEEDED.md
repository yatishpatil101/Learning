# Decision ledger — mock retirement

Every question raised during the migration, and its answer. One line each.
This file records **decisions**, not narrative — the story of each build is `tasks/todo.md`,
the phase plan is `docs/migration/`, and the coverage claim is `e2e/COVERAGE.md`.

Rules for this file: a decision gets a row, never a section. When a row's work ships,
the row stays (it is the record of *why*) and nothing else is written anywhere else.
Do not restate a decision in `todo.md` or `docs/migration/` — link to the number.

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
| 35 | Map/geo policy never reached a visitor | Public `GET /geo`, fetched once at boot into a module cache; the 20 synchronous call sites unchanged, `syncGeoFromDisk` retired |
| 24 | Locality curation queue was one browser's localStorage | `/admin/localities` Pending re-pointed at listings whose `locality_slug` is null; approving one now warns — that ordering was the bug |
| 23 | Own-listing dedup compared against fixtures | Narrow "have I already listed this?" endpoint scoped to the caller's own listings; the staff duplicate probe deliberately left alone |
| 33 | Saved-search match count was capped at one page | Server-side `matchCount` on the saved-search shape, counted in SQL over the whole catalogue — not a filtered page |
| 34 | Society follows were per-browser | `GET /me/societies/following` built, then all five surfaces ported together behind `FollowContext`. Follows on browser-minted societies stay local and are retried on load — the server will not write a dangling FK, and the society does not exist on the other device either |
| 29 | Internal notes were a private diary in one browser | `internal_notes` table, four entity families, `notes:read`/`notes:write`, mutable with the author off the token and no delete route. The console keeps the word `listing`; the wire says `property` and refuses anything else, bridged in one mapper. Notes now also render on the review modal's Communication log and in a panel of their own on a person |
| 31b | Referral reward currency — the server paid ₹, the browser paid contacts | No rupee reward: a qualified referral grants **+15 owner contacts**, so the contract moved onto the browser's unit rather than the reverse. The quota moved server-side outright — `GET /me/entitlements` reports it, `POST /contacts/request` refuses with 422 `contact_quota_exhausted`, and both `used` (a row count) and the referral bonus (count × rate) are **derived per read**, so a clawback needs no reversal. `lib/store/contactQuota.js` retired to the mock provider. Listing-count enforcement deliberately out of scope — the allowance is reported, not gated |
| 19 | Society binding was a hash | `properties.society_slug` is now a fact on the wire — an `@Formula` on `Property` so a page of twenty listings still costs one statement, carried on both the detail and the card shape. `societyForListing` reads `societySlug` and returns **null** when there is none; `SocietySection` renders nothing at all rather than a heading over a generic "Building" with registration and conveyance tiles fed by `ownershipVerified`, which is a claim about the seller's title and not about the society. Both seeds bind a locality-matched subset and deliberately leave the rest unbound, so "absent when unknown" has a subject and cannot rot back into a fallback |
| 26 | The `services` CMS type was reachable from neither end | **Kept, and left deliberately dormant.** Every layer exists and is tested — table, entity, repository, public `GET /services`, write branches, the `content.services` permission, a `case` in both client providers — but no console tab writes it and no page reads it. Deleting it was rejected: an unused value in a `text` discriminator costs nothing at rest, and removing it would mean unpicking a permission, a public route and two providers to save nothing. Switching it on needs *both* ends in one go — a tab alone authors records nobody sees, a page alone is fed by a table nobody can edit. `ContentTypes`' javadoc now says three, not four, and records the decision rather than pointing at this ledger |
| 27 | Pipeline stages: two funnels, one column | **(A) Six columns, the last two derived from `status`.** The column was split rather than widened: `pipeline_stage` keeps the four the desk works (contacted → info collected → listed → docs submitted) and `V92` adds `handback_milestone` for the four the owner works (photos uploaded → Aadhaar verified → claim sent → claimed), with `properties_handback_needs_listing` refusing a hand-back on a listing that was never listed. The console's two extra values turned out to belong to **neither** axis — `under_review` and `live` are `status` under another name, `pending` and `approved` — so the board derives those two columns and stores nothing for them, and the server answers 400 for either. That made the client port a *deletion*: approving a listing already sets its status, so "and also move it to Live" was a second write of one fact that could fail on its own, and opening a review modal already means the listing is pending. Both writes are gone; the one that remains is the board's Select, now behind `propertyService.setPipelineStage`. The board also stopped losing rows — it used to invent a stage for a null one and then drop the listing entirely if the invented value was not a known column |

| 32 | Managed properties lived in one browser | **The whole domain crossed the seam**, not a subset: `managedService.js` plus both providers, and `lib/data/managedProperty.js` now has exactly one importer, the mock provider. The two open questions in the entry below were answered rather than deferred. **Publish's extra writes:** of the client's four, two had server equivalents and two did not — the `puneNestListings:` copy is dropped (the server's listing *is* the record) and the notification is left as a mock-only affordance rather than invented server-side. Publish can also be **refused**, which the synchronous client function never allowed for: a managed record is captured loosely enough to be a legal private draft and illegal as an advertisement, the server re-runs listing validation at that boundary and answers 422, and every one of the four call sites now has an error branch. **The auto-create on render:** dedup is client-side off the list the dashboard already loads (option C) plus a partial unique index in V93, so `loadOwnerProperties` reads the managed set once and creates only for listings not already claimed — the sequential loop is deliberate, because a `Promise.all` over the same empty set would race itself into duplicates the index would then reject. **The bridge runs both ways (option A).** Publish is managed → listing; an owner who advertised first and opened the passport later needs the reverse, and the client cannot infer which listing a new record means, so `POST /me/managed-properties` takes an optional `publishedListingId` — the one lifecycle field a body may set, and only on create. A listing that is not the caller's is **404**, not 403: a 403 confirms the id names something real, which is the probe an enumerator is running. One already spoken for is **409**, because the caller can see it — it's theirs. The passport's document vault moved too: `managed_property_documents` is a separate table rather than a nullable FK on `documents`, because the papers on a flat you own but have not listed are not shareable with buyers, and that invariant is what the separation buys |

| 25 | The Admin Enquiries desk read one browser's database | **Half of it already existed.** `EnquiryBoardController` and its three paged reads shipped in `eb825b6` — untested, so the claim they were built around ("no raw mobiles, at any status, under any parameter") was a Javadoc. Nine route tests came first, and they assert masking **twice** on every path, once against the exact expected value and once against the shape, because either assertion alone has a trivial false pass — a widened mask passes the shape test, a hardcoded constant passes the value test. **The written decision was then reversed.** The queue entry this row replaces asked for "contact detail masked by default and a per-row reveal, audited"; the shipped Javadocs said masked, full stop, with no way to unmask. The original reasoning was correct about the *list* and incomplete as a *rule*: an operator handed a case with no way to reach the person in it either cannot act or goes around the console, and the second is worse than a logged reveal because it leaves no record at all. So `GET /admin/{enquiries,visits,deals}/{id}` (D25) — a **detail read per row, never `?reveal=true` on the list**, because a parameter turns bulk export into one request and reduces the audit trail to "somebody looked at forty numbers"; **admin-only on the existing `enquiries:read` atom**, raising the role term exactly as `UserAdminController`'s `TIMELINE_READ` does, because a grid that grows a row per shade of the same permission stops being read; and the **audit write happens before the response is built**, storing the *masked* number, so the log is not a second copy of the secret. The deals row also records `source: off-platform \| account`, because a counterparty mobile may have been typed by an owner closing privately and belong to nobody with an account here — a log that cannot tell a stranger's number from a member's answers the only question anyone will later ask of it. **The console's writes went, with one exception.** The board is read-only on the server; "mark responded" now writes an **internal note on the listing** through the `note` domain (the user's call, over deleting the button), because a sentence a colleague reads next week beats a status flip on a conversation the platform is not party to. "Close", visit completion and reschedule are hidden when the domain is live rather than left to fail quietly. Two pre-existing defects went out with the port: the detail modal was an `Object.entries` dump that printed every field the row carried under headings derived from property names, and the funnel derived locality by splitting the listing **title** on the word " in ", which filed every real listing under "Unknown". The enquiry `kind` filter (`contact`/`chat`/`call`) was deleted rather than mapped: only `contact` was ever a row in a table |
| 37 | Where should the `document.granted` notification point? | **`/view-documents/{requestId}` — the grant, not the listing.** The server said `/property/{propertyId}` and the mock said `/view-documents/{requestId}`; before D123 the mock's target was *unbuildable* server-side, because the viewer route keyed on the owner's mobile, so the divergence was forced rather than chosen. The id-only route removed the reason. Safe to store because the request id is an identifier and not a capability — the endpoint behind it also requires the JWT's user id to equal the row's requester id, so a leaked notification row opens nothing. **Accepted cost, and it is real:** a notification outlives the grant it announces, so past `GRANT_TTL` this link 404s where the listing page would still have rendered. Mitigated rather than ignored — the viewer already maps that 404 to an empty state with a way out, and it gained its own copy for this door (`errLapsed*`): the existing text says "this share link is no longer active", which is true for a forwarded token and false for a buyer who never used a link, and would send them hunting for one. The old link also forced the notification body to say "open the listing" and leave the buyer to find the documents section themselves |

---

## Decided, not yet built


Ordered by damage — what is silently wrong for a real user comes first
*(sequencing answered 2026-08-17: "fix what is silently wrong for real users first")*.

### 1 — 20. Finance console

The revenue chart is a seeded PRNG, ledger rows take their status by rotating a hardcoded array,
and `rentFeeRevenue` sums a `db.rentFeeLedger` that does not exist. `GET /admin/finance` returns
four figures plus three disclosure booleans and has never been called.

**Decided 2026-08-17:** do not delete anything from the UI. Build the backend to support every
finance feature on screen, then replace the mock with real data.

**Do:** extend the server to serve what the console draws — a real monthly revenue series, a
payments/transaction ledger with real statuses, and the inputs behind MRR and ARPU — then point the
console at it. This needs the payments work that does not exist yet, so it is a programme, not a flip.

### ~~2 — 36. Analytics tabs~~ — CLOSED 2026-08-20

Seven of eight tabs were a seeded LCG (`rng(424242)`); only Supply Gap was live.
`GET /admin/analytics` served four metrics no tab charts.

**Decided 2026-08-17:** serve analytics from the server; build endpoints that feed every tile.
Traffic collection comes later — for now build the tiles the database can already answer and leave
the traffic tiles on mock data until the platform is live and has real traffic.

**Revised 2026-08-19:** the "traffic collection comes later" half was reversed. Deferring it meant
shipping three tabs of invented numbers behind a banner nobody reads, and the collection itself was
a week of work, not a programme. Built instead: `page_views` + a client collector, a retention sweep
and an erasure path, an hourly `PageViewRollup` into `page_view_daily{,_paths,_referrers}`, and three
read endpoints.

**Closed:** all eight tabs are now accounted for. Live off the database: Supply Gap, Geography,
Pricing, SLA, Traffic, Engagement, Anonymous surfers. The **one remaining exception is Seasonal**,
which is genuinely illustrative — it needs multiple years of history the platform has not lived
through — and it keeps the `SampleTabNotice` banner for exactly that reason. `e2e` asserts the
banner's presence on Seasonal *and its absence on Traffic and Surfers*, so the label cannot be left
behind on a tab that has since become real.

Two defects this work caught that no mock spec could have: the engagement DTO shipped
`avgSessionMinute` while every frontend caller read `avgSessionMinutes`, which would have left the
duration chart permanently blank on live builds (the mock provider returns `weeks: []`, so nothing
red); and `TrafficTab`'s "no sessions" empty state was dead code, because the sources list is always
the full five-channel vocabulary — an unvisited window drew five zero-slices, which reads as a
measurement rather than an absence.

---

## Still genuinely undecided

| Question | Why it is open |
|----------|----------------|
| Should a guard enforce `VITE_API_DOMAINS`? | Three domains have now shipped complete and been left off the hand-maintained list, so their live specs quietly exercised the mocks (D36's `analytics` is the latest; see `tasks/lessons.md`). A sibling of `frontend/scripts/check-provider-cycle.mjs` could fail the build when a `providers/http/*Provider.js` exists whose domain is absent. What blocks it is that absence is sometimes *deliberate* — `user` has an http provider and is intentionally mocked (see the user-restore row in `e2e/COVERAGE.md`) — so the guard needs a documented opt-out list, and an opt-out list that is itself hand-maintained may only move the problem. |
| Checkmarx or CodeQL? | Neither is configured; Checkmarx is commercial. CodeQL is the free native equivalent. See `docs/migration/06-code-quality.md`. |
| Caching layer | None exists. Per D133: measure the real call count first — no cache until a profiler asks for one. |
| Does the "first verification" Featured perk survive? | Needs `featured_until` + a reason + a grant ledger, and a call on giving paid placement away. Recommendation: record as intentionally dropped. |
| Should a buyer see "Posted by PuneNest"? | `PropertyResponse` omits `adminPipeline` from consumer reads on purpose. If it is a trust signal, the contract needs a public boolean that is not the pipeline. |
| Who owns the concierge fixtures? | All 38 seeded properties have `posted_by_admin = false`, so the post-on-behalf surface is empty on live. Needs seed rows per pipeline stage against a known-green baseline. |




