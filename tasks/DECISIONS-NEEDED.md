# Decision ledger

Every question raised while the platform was built, and its answer. One line each.
This file records **decisions**, not narrative — the story of each build is `tasks/todo.md`,
and the coverage claim is `e2e/COVERAGE.md`.

Rules for this file: a decision gets a row, never a section. When a row's work ships,
the row stays (it is the record of *why*) and nothing else is written anywhere else.
Do not restate a decision in `todo.md` — link to the number.

---

## Closed — decided and shipped

| # | Question | Answer |
|---|----------|--------|
| 1 | Reels: where do feed photos come from? | Reuse listing photos; no separate media |
| 2 | Admin-editable content: where do translations live? | (b) `translations jsonb` on the content row — `V84` |
| 3 | Is an accepted quote the same number as the deal value? | (b) No — `V83` adds write-once `tickets.quoted_value` in rupees |
| 4 | How does an anonymous waitlist signup reach the server? | Public `POST /service-waitlist` taking `{ service, name?, mobile }` |
| 5 | Do interior/valuation forms still raise a board ticket? | Yes — the lead *is* the product on those landings |
| 6 | Two counters needing small endpoints | Shipped as D6b |
| 7 | Dashboard Enquiries panel read an unmodelled view | (a) Retire — the buyer already has the information |
| 8 | Homepage trust counters had no server | (a) Server-computed; not derived in the browser |
| 9 | Move-in Pack prices read from browser storage | (a), built as its own public route `GET /move-pack` |
| 10 | "Tell me when something matches" has no server home | (a) Build it — the largest item of that round |
| 11 | `tickets.value` has no write path | (b) The value belongs to the deal, not the ticket |
| 12 | Listing-freshness confirmation is browser-local | (a) Server-side — the badge must mean the owner, not the browser |
| 13 | Enquiries projection | Retire — fixtures and the panel branch deleted |
| 14 | Demand alerts | Notify first, then the demand signal |
| 15 | Audit seam | Build the seam, wire the writer, leave the reader flagged |
| 16 | Autonomy on deletions | Granted |
| 17 | Is there a five-hour box? | No hard stop |
| 18 | Audit seam, corrected | Build nothing — the calls die on their own |
| 22 | Command palette searched fixtures on live | (2) Gate each data category on `isHttpDomain` — `a281858` |
| 28 | Owner WhatsApps themselves a chaser from the platform | (1) Delete the control — `368ad4f` |
| 30 | Review moderation queue moderated the browser copy | Both halves built — `48386b2` |
| 31a | Referral code and redemption | (1) Ported — `26129a2` |
| 35 | Map/geo policy never reached a visitor | Public `GET /geo`, fetched once at boot into a module cache; `syncGeoFromDisk` retired |
| 24 | Locality curation queue was one browser's localStorage | `/admin/localities` Pending now lists listings with null `locality_slug`; approving one warns |
| 23 | Own-listing dedup compared against fixtures | Narrow "have I already listed this?" endpoint scoped to the caller's own listings; staff duplicate probe left alone |
| 33 | Saved-search match count was capped at one page | Server-side `matchCount` on the saved-search shape, counted in SQL over the whole catalogue |
| 34 | Society follows were per-browser | `GET /me/societies/following` behind `FollowContext`; follows on browser-minted societies stay local and retry on load |
| 29 | Internal notes were a private diary in one browser | `internal_notes` table (four entity families, `notes:read`/`notes:write`, author from token, no delete route) |
| 31b | Referral reward currency — server paid ₹, browser paid contacts | No rupee reward: a qualified referral grants +15 owner contacts; quota server-side (`GET /me/entitlements`, 422 `contact_quota_exhausted`) |
| 19 | Society binding was a hash | `properties.society_slug` is a wire fact (`@Formula` on `Property`); unbound → `societyForListing` null and `SocietySection` renders nothing |
| 26 | The `services` CMS type was reachable from neither end | Kept dormant: table, write branches and `content.services` remain; public `GET /services` was removed (only `GET /faqs` is public); nothing writes or reads it |
| 27 | Pipeline stages: two funnels, one column | (A) Six columns: `pipeline_stage` (desk's four) + `V92` `handback_milestone` (owner's four); `under_review`/`live` derive from `status`, never stored |
| 32 | Managed properties lived in one browser | Whole domain moved server-side; publish can 422; V93 partial unique index; `POST /me/managed-properties` takes optional `publishedListingId` (foreign → 404, claimed → 409) |
| 25 | The Admin Enquiries desk read one browser's database | Lists stay masked; per-row detail `GET /admin/{enquiries,visits,deals}/{id}` (admin-only, `enquiries:read`) is audited, never `?reveal` on lists; "responded" writes a note |
| 37 | Where should the `document.granted` notification point? | `/view-documents/{requestId}` (the grant, not the listing); the id is not a capability. Past `GRANT_TTL` it 404s into an empty state |
| 45 | Should the Enquiries desk's status writes move to the server? | No — `contact_requests.status` is the owner's consent; the desk must not write it. Four controls deleted; "Responded" = `addNote` |
| 263 | Does the flatmates board filter server-side, and what does that cost in schema? | (b) One `GET /flatmates/feed` resolves every facet in SQL; `V15` adds `lat`/`lng`, generated `per_head`, six indexes; client predicates deleted |
| 264 | Are a pre-leased commercial listing's in-place rent and lease expiry public? | Public, no gate: asset terms (yield), not a person's reachability, and optional. Revisit if they stop being optional |
| 265 | Can a rent-agreement wizard opened *cold* ever file its KYC papers? | Yes — `V40` makes `documents.property_id` nullable (CHECK: property or request); `POST /service-requests/{id}/checkout` 409s on missing papers |
| 20 | Finance console drew a seeded PRNG | Built. `GET /admin/finance`, `/series`, `/transactions` (`AdminFinanceService`); residual in row 288 |
| 36 | Analytics tabs were a seeded LCG | Built. Seven of eight tabs read the database (`page_views` collector); Seasonal keeps `SampleTabNotice` |
| 38 | Geo/cities | Built. `cities` seeded in `R__DML_seed_reference_data.sql` (Pune live); `CityAdminService` writes `live`; `GET /cities` is the roster |
| 39 | Audit tab | **Built (D248).** Read-only over `GET /admin/audit-log`; the "Clear" button is deleted and its absence asserted. Actor names are row 39b |
| 40 | Post-on-behalf on Staff Activity | **Satisfied (D248).** `OnBehalfListingService` writes `property.create_on_behalf` / `user.provision_on_behalf` to `audit_log` (`GET /admin/staff-activity`) |
| 41 | Static-analysis order | **Sonar first — built.** `.github/workflows/ci.yml` runs `sonarqube-scan-action`; Checkmarx vs CodeQL stays open |
| 266 | Caching layer | **No cache until a profiler asks for one** (D133) |
| 267 | Should the Ctrl+K palette's `rawDb` import go? | **No.** Every data category is gated on `isHttpDomain` (`admin/command-palette.spec.js`); revisit only if a bundle measurement asks |
| 268 | Do flatmate saves belong to the account or the browser? | The account — built. `GET/POST/DELETE /me/flatmate-saves` (`FlatmateSaveController`) via `flatmateService.listFlatmateSaveKeys()` |
| 269 | Attach a vault paper to a service request without re-upload? | **(b) Built.** `POST /service-requests/{id}/docs/from-vault` files a `personal_documents` row by id |
| 270 | Duplicates tab server? | Yes — built. `GET /admin/properties/duplicates`, `POST …/duplicates/merge` and `…/dismiss` (`PropertyModerationController`) |
| 271 | Live build still seeds the mock store? | **No longer.** `ensureMockDb` has no caller left in `frontend/src` |
| 272 | Admin Needs Follow-up board: server-side freshness filter? | **Built** as the `unconfirmed` facet (`ModerationFacets`, `Freshness`) |
| 273 | Should a buyer see "Posted by Draazy"? | **No public badge**. The platform is owner-only; the concierge desk posts on the owner's behalf |
| 274 | Where does "Owner KYC Pending" come from? | **Nowhere — the tile stays dropped**. Nobody works an owner-KYC queue |
| 275 | `initialForm.homeTypeLabel` defaults to `'Flat'` | **Flat stays the default**. Revisit only when something filters on home type |
| 276 | Floor Plan accepts more than one photo | **First wins, not enforced**. Low value |
| 278 | Correcting a plan price restated booked revenue | **Built in `86cd03e1`.** `V37` adds write-once `subscriptions.amount`, written at purchase |
| 277 | Seeker Plus price disagreed between catalogue and fee schedule | Built. Seeded ₹199 one-time; `PlanPriceMatchesFeeScheduleTest` |
| 279 | ServiceLanding confirmed before the request was filed | Built. "Request received!" waits for the request; failure offers retry or a call |
| 280 | A half-declared flatmate agreement degraded silently | Built. A 422 names the missing components |
| 281 | Room cards headlined a different price from the sort key | Built. `RoomCard` headlines `bestPerPersonRent`, as `GroupCard` does |
| 282 | Purged identities had no way back | Built. Re-record panel when `identities.purged` is the latest identity event; customer is the only writer |
| 283 | `service_request_identities` stored plaintext identity | **Interim built:** AES-256-GCM `AttributeConverter`, env-var key validated at startup. KMS envelope encryption stays the target |
| 284 | OTP send errors quoted `err.message` | Built. Generic by default; self-number case throws a coded error mapped by `OwnerConsentModal` |
| 285 | `tenant_rentals.landlord_name` had no reader and no erasure path | Built. `V57` drops it; entity, DTOs, form and export scope follow |
| 286 | `referralRewards` copy overstated the switch | Built. `AppFlagsPanel` describes it as a marketing switch |
| 44 | `/admin/property-reviews` shape | Built. One verdict per property, `status` query param, reviewer name beside the id |
| 39b | Audit log actor names | Built. `AuditEntryResponse.actorName` resolved server-side; the id stays |
| 42 | Pending-approval queue maker | **Superseded.** Single-admin bootstrap removed the staff approval queue; staff activate via invites |
| 287 | Split rooms kept the tier stamped at creation | Built. Approving the parent flat re-derives split children's tier |
| 288 | Finance ledger filtered one page in the browser | Built. Filters and CSV export go to the server |
| 289 | Internal notes on a service request were not desk-scoped | Built. `InternalNoteController` checks the caller's desk |
| 290 | Guard for `VITE_API_DOMAINS` | **Superseded.** The per-domain switch was removed; `config.js` globs every http provider, so nothing can drift |
| 291 | Admin dashboard SLA Health, Smart Alerts, Daily Ops Scorecard | Built. `SlaHealthPanel` reads `GET /admin/analytics/sla`; other two deleted |
| 292 | Featured was given away on first verification | Built. `featured` derives from an active Owner Plus/Pro plan and lapses with it; toggle and route gone |
| 43 | The claim-link "Opened" chip had no source | Built. Claim link `/signin?claim=<id>`; after OTP the browser posts `/me/listings/{id}/opened`; `V58` stores `claim_link_opened_at` |
| 293 | The post-on-behalf surface had no fixture for early stages | Built. Seed rows added for `contacted` and `info_collected` |
| 294 | Is presence `lastSeenAt` shared by default? | **(a) Kept opt-out**. `shareActivityStatus` in settings turns it off |
| 297 | Light mode (already committed): keep or revert? | **Keep** |
| 299 | Admin/manager have no queue for RA/legal/valuation requests (`/me.desks` is staff-only) | **Keep: they use `/admin/services`** |
| 300 | RA: place of execution, address/work-proof PDFs and presenter/challan party are not collected | **Leave to ops on the IGR portal** |
| 301 | RA identity: PAN/Aadhaar numbers vs card copies only | **Keep the numbers encrypted, keep `IDENTITY_ENCRYPTION_KEY`** |
| 302 | Managers ignore `desk:*` narrowing (always see every desk) | **Keep** |
| 304 | The "Clear title" search facet needs a wizard field plus a document | **Drop the facet** |
| 305 | PG as a listing type with PG facets | **Drop it (flatmates covers shared living)** |
| 306 | RA SLA: wall-clock, no pause while a rejected paper is awaited, no notification | **Accept as is** |
| 307 | Gram Panchayat list is seed-only; assumes ₹300 DHC applies to rural areas | **Keep seed edits through `R__`** |
| 308 | Owner filing Pune police verification needs the tenant's ID | **Leave as is (tenant supplies it)** |
| 310 | Owner-consent OTP does not say which flat | **Keep it as moderator corroboration only** |
| 313 | Approval no longer demands current ownership evidence | **Keep** |
| 314 | Two approve routes stay separate (the record says which ran) | **Keep** |
| 315 | An owner's resubmission has no cooldown | **Keep** |
| 316 | Production test accounts (hidden plan, ₹1 price, refunds) | **Don't build; test on sandbox** |
| 317 | Admin → Users can hand-grant the Verified badge outside KYC Review | **Keep both (hand-grants are audited)** |
| 318 | Removed flatmate-group members lose the chat history | **Keep** |
| 319 | Flatmate group applications go live without pre-moderation | **Keep** |
| 320 | `backend/tools/cashfree-probe.ps1` is untracked | **Commit it with the rest** |
| 295 | Plans page and seed disagree (limits, rent-agreement wording, Verified-badge tier). Which is the truth? | The seed/backend is the truth: `Plans.jsx` copy rewritten to match, `plans.json` deleted |
| 296 | `LegalCostCalc` carries a women-buyer concession and 5%/4% non-PMC stamp-duty rates with no official source | Removed; PMC/PCMC 7% only |
| 312 | "Zero brokerage" shows on agent/builder listings | Moot: no poster type since V54; dead `postedByType` removed |
| 311 | Featured card hover lift is dead code | Accepted as done: duplicate `.property-card:hover` rule deleted, `property-card` class kept (Saved/Recent/Similar still lift) |
| 298 | `KycActionRail` `!canWrite` branch is unreachable (V90 has no view-only KYC function) | Built: dead branch deleted |
| 303 | CMS announcements/banners/services can be written by admin but nothing public reads them | Built: admin write side deleted; FAQ-only Content desk |
| 309 | Phone keyboard lifts the bottom nav, cookie banner, install prompt and assistant FAB | Built: hidden while the keyboard is open (`useKeyboardOpen`) |

---

## Decided, not yet built

A ruling lands here when it is taken and moves to Closed when it ships.

Nothing.

---

## Still genuinely undecided

Nothing.
