# Fixture registry

The named rows that live e2e specs are allowed to assert against.

Everything listed here is created by the `NAMED FIXTURE CONTRACT` block at the end of
[`backend/src/main/resources/db/seed/R__zz_dev_demo_data.sql`](../../backend/src/main/resources/db/seed/R__zz_dev_demo_data.sql).
Every id in that block starts `f1c7`, so `grep -r f1c7 backend/` returns the whole contract.

## Why a registry exists at all

The demo seed is a `pg_dump` of one developer's database. That makes it excellent at *"the app
looks populated"* and useless at *"this number should be 3"* — nobody chose those 78 users, so no
spec can safely depend on any of them. A live spec that asserts against unnamed bulk data is
asserting against an accident, and it breaks the first time somebody regenerates the dump.

So the rule is: **a live spec may only assert against a row named in this table.** Everything else
in the seed is scenery. If a spec needs an invariant that is not listed below, add the row to the
seed *and* the row to this table in the same change — a fixture with no registry entry is
indistinguishable from scenery six months later, and will be deleted by someone tidying up.

## Why these rows are hand-written and not dumped

Taking the transactional rows from the dev database the same way the demo block was taken looked
like the cheap option. It was measured on 2026-08-12 and rejected:

| | in the committed seed | drifted (local only) |
|---|---|---|
| properties | 38 | 12 |
| users | 78 | 94 |
| deals, offers, support_tickets, service_requests, subscriptions, tenancies, reports, reviews | **0** | all of them |

All 11 local deals referenced properties that were **not** in the seed. The transactional data was
a self-contained island grown by manual clicking on locally created listings, so importing any of
it would have pulled 12 unnamed listings and 94 unnamed users along for the foreign keys — more
bulk, and bulk that still could not be named. The rows below instead hang off listings the seed
already contained, which keeps the fixture set closed over itself.

## Actors

`password_hash` is NULL on all of them, as it is for every user in the seed. They are reachable
only through the dev OTP flow; none of this is a credential.

| Actor | Mobile | Role | id | Purpose |
|---|---|---|---|---|
| **Meera Deshpande** | `9470744469` | owner | `3ad0171b-…f4e1b44c` | The owner side of every fixture below. Already in the seed — not created by the fixture block. |
| **Rahul Mehta** | `9700000001` | buyer | `f1c70000-…000000001` | The demand side: saves, alerts, a review, an offer, a deal. |
| **Priya Nair** | `9700000002` | buyer | `f1c70000-…000000002` | The tenant: active tenancy and rent ledger, plus the support ticket. |
| **Arjun Rao** | `9700000003` | buyer | `f1c70000-…000000003` | The reporter. Deliberately `verified = false`, so "unverified user" paths have a subject. |
| **Omkar Kulkarni** | `9708919481` | owner | `f619aa88-…712afa9d` | The **unverified** owner. `aadhaar_verified = false` with a live listing, so the absence of the trust badge has a subject — without one, "the badge renders for a verified owner" is a claim no test can falsify. |
| **Sanjay Pathak** | `9700000010` | owner | `f1c70000-…000000010` | The **commercial** landlord: all twelve commercial units, and nothing else. One owner rather than twelve so the trust counters move by a known amount — `verifiedOwners` by one while owner-badged listings move by twelve, which is what keeps `verifiedOwners < ownerBadged` strict rather than accidentally true. |

`role` is CHECK-constrained to `buyer | owner | staff | admin`, so there is no `tenant` role —
Priya is a `buyer` who happens to hold a tenancy.

### Omkar is load-bearing in one way and borrowed in three others

He is the only seeded account carrying both a live listing and `aadhaar_verified = false`, which is
what makes `p5007` the control for every trust-badge assertion. Three other live specs sign in as
him for reasons that have nothing to do with that, simply because they needed *a* seeded consumer:

| Spec | Role there | Writes |
|---|---|---|
| `live-property-integration` | `CHATTER` — the counterparty on a conversation | messages |
| `live-society-rating` | `REVIEWER` — reviewing an entity has no eligibility gate, so any signed-in account does | a society review |
| `ops/live-referrals` | `risk.referrer` | a referral redemption |
| `ops/live-drafting-desk` | `CUSTOMER` — **not used**, kept as a worked example of what a seeded consumer looks like; the spec provisions a throwaway instead | nothing |

All three writes are additive and none of them touches `users.verified`, so the anchor holds today.
It did not always: `live-property-integration`'s Aadhaar-simulate test signed in as `CHATTER` and
`VerificationService` back-filled the badge onto every listing the account held, so `p5007` arrived
at `live-verify-payoff` already verified. Both files passed alone. That test now uses
`signedInAsNew`, and the rule it broke is written down beside that helper.

**The rule this leaves behind: a spec may borrow Omkar to *do* things, and may not change what he
*is*.** Anything that writes to `users` — verification, suspension, role, a profile edit — needs a
throwaway account, and if a borrowing ever genuinely needs to mutate him, the answer is a second
seeded consumer rather than a compromise on the anchor. Splitting him now would move the seeded
`users` count off 81, which several invariants below are stated against, for a hazard that is
currently latent; the cost is worth paying when something forces it and not before.

## Anchor listings

The first four belong to Meera and were already in the seed.

| Slug | id | Deal | Status | Price |
|---|---|---|---|---|
| `p5015` | `1078d711-…4dbdc5f377` | rent | approved | 38 000 |
| `p5021` | `615287b3-…53e8682b` | buy | approved | 91 09 100 |
| `p5034` | `291e5cb6-…e27761bf` | rent | approved | 34 000 |
| `p5002` | `51897b51-…47ff4dee` | buy | **flagged** | 1 47 61 600 |
| `p5007` | `0dcd8871-…f53aa579e` | rent | approved | 59 000 |

<sub>Abbreviated to the last 8 hex digits; the full uuids are in the seed file.</sub>

`p5007` is **Omkar's**, not Meera's, and that is the whole reason it is here: it is the only
registered listing whose owner holds no identity badge. A spec asserting the verified-owner badge
needs a row where the badge is legitimately absent, or it cannot tell "renders correctly" from
"renders always".

## Guaranteed invariants

One row per domain. These are the statements a spec is allowed to depend on.

| Domain | Invariant | Tables |
|---|---|---|
| `property` | Meera owns **4** listings, of which **3** are publicly visible (the 4th is `flagged`). | `properties` |
| `saved` | Rahul has **exactly 2** saved listings, both `approved`. | `saved_properties` |
| `savedSearch` | Rahul has **1** listings alert, `daily` / `whatsapp`, `new_count = 0`. | `saved_searches` |
| `notification` | Rahul has **2** notifications, exactly **1 unread**. | `notifications` |
| `review` | p5021 carries **1 published** review, rating **4**, `context = visit`. | `reviews` |
| `report` | The queue carries **7** reports: **3 on p5002** (`open`/`fake`, `reviewing`/`pricing`, `dismissed`/`broker`), **2 on Rahul** (`open`/`brokerage`, `actioned`/`abuse`) and **2 on flatmate posts** — the Wakad shared room (`open`/`filled`) and the Kharadi group (`reviewing`/`broker`). All four statuses present; all three tabs non-empty; p5002's three trip the `3x` escalation badge. | `reports` |
| `support` | Priya has **1 open** ticket with **2** messages (user, then staff). `staff_unread = true`. | `support_tickets`, `support_ticket_messages` |
| `outreach` | The template library holds **at least 10** WhatsApp templates, ids matching the console's retired `DEFAULT_WA_TEMPLATES` (`wa-gentle`, `wa-dormant`, …). That floor is the invariant; the exact count is not, because adding a template is a copy change. Seeded by **`R__seed_reference_data.sql`**, not by `V78`, which created the table and seeded it in the same versioned migration — the reset truncates every table and replays only the `R__` seeds, so the library emptied itself on the first live run and stayed empty (`flyway_schema_history` survives the reset, so V78 never re-ran). If this row ever reads `[]` again, that is the shape of the bug. The **ledger has no invariant at all** — `admin/live-outreach` appends an `outbound_message` row for p5002 on every run, so any absolute count here rots on the second run. Assert a delta across the call that causes it. `admin/live-outreach-console` additionally depends on **`1 RK Flat in Pimple Saudagar`** (Sneha Shah, `9124855617`) being `pending` *and* its owner having a mobile — both conditions for the review modal's chase panel to render at all. It is named rather than discovered because the first draft took whichever card sorted first, passed, and failed on the very next run against a pending listing whose owner has no mobile. | `message_template`, `outbound_message` |
| `concierge` | Exactly **four** listings carry `posted_by_admin = true`, all `pending`, all with an owner who has a mobile. Since **D27** they are spread across *two* axes rather than one: **`p5030`** (`1 BHK Flat in Kharadi`, Nikhil Jain `9411618812`) at `pipeline_stage = listed`, no milestone; **`p5028`** (`1 BHK Plot in Viman Nagar`, Tanvi Mehta `9108512606`) at `docs_submitted`, no milestone; **`p5024`** (`2 BHK Row House in Kothrud`, Sakshi Rao `9596499088`) at `docs_submitted` + `handback_milestone = photos_uploaded`; **`p5037`** (`4 BHK Penthouse in Undri`, Tanvi Chavan `9592138848`) at `docs_submitted` + `handback_milestone = claim_sent`. The two milestones are set by an `UPDATE` at the foot of the seed rather than by the shared INSERT column list, which all 38 property rows use and only these two would need. All four record `postedByStaff` as the seeded Admin's id `e6621d3a-3e31-5022-a6c9-34a90c8f6e9b` — the id, never the name. Spreading them is not padding: the three funnel booleans are *derived* from the milestone by `PipelineStage.reached`, so the milestone is the only stored fact and this is the smallest set producing the distinct boolean combinations. The `contacted` / `info_collected` stages are deliberately **unseeded** — they describe a conversation with no paperwork behind it, and the write path exercises them rather than a fixture pretending a phone call happened. They are ordinary rows in `R__zz_dev_demo_data.sql` with a few columns changed, not a separate block, which is why the property count stays **38** — the fixture was built by converting existing owner-posted listings rather than adding new ones, precisely so that no spec asserting a total had to change. Do not convert **`3 BHK Penthouse in Kothrud`** (`p5002`, Meera): `admin/live-outreach` needs an owner-posted listing to keep pinning that a chaser there is written and never counted. Do not convert **`1 RK Flat in Pimple Saudagar`** either — it is `admin/live-outreach-console`'s fixture and gaining a chase panel would change what that spec opens. | `properties` |
| `deal` | p5021 has **1 active** buy deal with Rahul at 89 00 000, **1** party, and **1 pending** offer. | `deals`, `deal_parties`, `offers` |
| `rent` | Priya holds an **active** tenancy on p5015 (rent 38 000, deposit 76 000) with **3** instalments: **2 paid, 1 due**. | `tenancies`, `rent_payments` |
| `visit` | Omkar holds **exactly 1 live** visit (`scheduled`), on **p5034**. | `visits` |
| `flatmate` | The board carries **2 approved rooms**, **8 approved seeker posts** and **8 approved groups**. The seekers spread evenly across move-in: **2 each** at `now`, `15`, `30` and `60` — so every move-in chip narrows and none of them is a no-op. `Non-smoker` is carried by **4**, the largest tag bucket, and is the tag the filter spec reads. Groups exist **one per locality that any seeker names**, which is what makes the map's bubble preview provable; see the two invariants below. | `flatmate_rooms`, `flatmate_seeker_posts`, `flatmate_groups`, `users` |
| `flatmateMap` | **At most two seekers may name any one locality, and every named locality has exactly one group.** Both halves are load-bearing and neither is obvious from the table. A bubble indexes a seeker under **every** entry in `localities`, not just the first — so Pooja Shah listing `["Wakad", "Baner"]` counted against Baner as well as Wakad. The popup renders at most `MAX_ROWS = 3` rows, seekers first, and a fourth row is **dropped rather than scrolled to** — so a third seeker silently pushes the group off the end. That is exactly how `consumer/flatmates/live-map-popup` failed while the group existed, was `approved`, and was served correctly by `/api/flatmates/groups`: invisible in the only bubble the spec opens. `Aundh` and `Balewadi` therefore carry groups even though no seeker *lives* there — Rahul and Meera each name one as a second locality, and the spec clicks whichever area sorts first. | `flatmate_seeker_posts`, `flatmate_groups` |
| `society` | **Skyline Heights, Baner** (`skyline-heights-baner`) holds **exactly one** listing, `p5120`, and reports `listing_count = 1`. The society already had coordinates but no homes, and the Homes tab correctly hides itself when a society has none — so the absence read as a product regression rather than a thin fixture. The listing was **added** rather than re-pointed from an existing one, because moving a listing into this society would only empty whichever society it left. Note the shape of the INSERT: it is `INSERT … SELECT … FROM societies WHERE slug = 'skyline-heights-baner'`, taking `lat`, `lng` and `id` off that row. Societies are seeded by `R__seed_reference_data.sql` with **`gen_random_uuid()`**, so `societies.id` is regenerated on every reset — **the slug is the only stable identity**, and a society id copied out of a psql session is correct only until the next live run. | `societies`, `properties` |
| `ownerBadge` | `properties.owner_verified` **always** equals its owner's `users.aadhaar_verified`. Meera's listings carry the badge; Omkar's (incl. `p5007`) do not. | `properties`, `users` |
| `commercial` | Each of the **six** commercial subtypes exists **exactly once to buy and once to rent** — `p5101`–`p5112`, all `approved`, all Sanjay's, twelve different localities. Exactly once is the invariant, not merely at least once: `consumer/search/commercial-type-filter` asserts that filtering to a subtype leaves *no* card without that subtype's label in its title, so a second Office Space would have to be titled to match or it would fail the filter it was added to strengthen. Twelve localities for the same reason — two rows of the same subtype in the same locality would produce the same title. `bhk` is **NULL**, not `0`: an office has no bedroom count, and the mock agrees (`"bhk": ""`). Ignore the dumped `Plot` rows, which do carry a `bhk` — that is an artefact of a wizard that always asked. These are the only listings in the seed that were **added** rather than converted from the original 38, because converting six would have moved stock out of the residential counts that the locality and trust specs read in order to fix a different page. `posted_by_admin` is `false` on all twelve, which is what keeps the `concierge` invariant's "exactly four" true. | `properties`, `users` |
| `rentStock` | **p5121–p5124** are the residential rent/plot anchors, and every locality on them is load-bearing rather than incidental. Before D19 the seed held **no approved residential rent Flat at all** — the only two (`42ba0880` Kharadi, `75e78160` Pimple Saudagar) are `pending` on purpose, because they are the outreach-console and concierge fixtures and un-pending them would break the invariants above. So every rent-side assertion on the property page was unreachable. `frontend/src/data/localityIntel.js` benchmarks exactly ten localities, and the page prints a real comparison inside that set and a neutral note outside it: **p5121** (2 BHK, **Wakad**, 24 000) sits under Wakad's benchmark rent2 of 27 000 so "below the locality average" is unambiguous rather than borderline, and **p5123** (3 BHK, **Balewadi**) exists because Balewadi is deliberately **absent** from that file and is the only fixture covering the neutral-note branch — moving it to a prettier locality deletes the coverage it exists for. **p5122** is **1 BHK, Hinjawadi**: the flatmate-split prompt is asserted **absent** there and **present** on p5121, so the pair proves the threshold rather than the copy. **p5124** is an **Open Plot in Wagholi** with `bhk` **NULL** — `propertyKind()` in `pages/consumer/property/derivations.js` checks land before commercial, and `floorPlanFor()` returns null for land. Wagholi **is** benchmarked, and that is the point: the plot suppresses the rent comparison because of its *kind*, not because its locality lacks data, which is the only way to tell those two code paths apart. | `properties` |
| `commercialFitout` | The twelve commercial rows carry **sub-type-specific** amenities mirroring `COMMERCIAL_FIXTURES` in `pages/consumer/list-property/constants.js`, by profile: **workspace** (`p5101`, `p5106`, `p5107`, `p5112`), **retail** (`p5102`, `p5103`, `p5108`, `p5109`), **industrial** (`p5104`, `p5105`, `p5110`, `p5111`). They were seeded with a generic `["parking","power","security"]`, which meant the "Fit-out & fixtures" section rendered identically for a warehouse and a co-working desk — the seed could not tell a correct page from a broken one, even though varying with the subtype is the section's entire purpose. `parking`/`power`/`security` are kept at the front because they are true of all twelve and the generic amenity chips elsewhere still read them. The lists are copied **verbatim** from the product constant on purpose: a drift there should surface as a failing assertion, not as a quietly weaker test. | `properties` |
| `propertyReview` | **p5013** carries **3 published** reviews, ratings **5 / 4 / 3**, and every part of that shape is chosen. The average is exactly **4.0** and one review lands on each of the top three bars while 2★ and 1★ stay empty — the distribution arrives as string keys `"1"`–`"5"` and is drawn from a 0-based array, so an off-by-one puts the 5★ count on the 4★ bar and still renders a perfectly plausible chart; only an asymmetric seed catches it. Categories are **sparse**: `locality` rated by two authors (5 and 4), `condition` by one, `accuracy` and `owner` by nobody — so the aspect average must be **4.5** over the authors who answered rather than an average over all three reviews, and unrated aspects must be **absent** rather than shown at 0.0, since a zero is a claim no reviewer made. One author's `recommend` is **NULL**, not `false`: they skipped the question, so the headline reads **100 %** and not 67 %, and counting a skip as "would not recommend" is the specific bug this row exists to catch. Note this is a *second* review fixture and does not disturb the `review` invariant above, which is about p5021. `target_id` is resolved **`FROM properties WHERE slug = 'p5013'`** rather than hard-coded — it is a `text` column holding a property uuid, so a literal would silently detach the moment that row is reseeded. Until D19 the live spec seeded `puneNestPropReviews` in localStorage, a mock-provider store the live app never reads, so the server aggregate it exists to verify was going unasserted entirely. | `reviews`, `properties` |
| `societyReview` | Two societies carry **2 published** reviews each, ratings **5 and 4**, so both averages are **4.5** — a half so that a reader which truncates, rounds, or hands back the *count* where the average belongs still yields a believable number from the fixture and is caught anyway. **`golden-springs-panchshil-baner`** is the society of **p5013**, which makes it the property-page fixture; **`palm-court-panchshil-undri`** is the directory-card one. **`golden-nest-mahindra-baner`** (the society of **p5008**) is left **unreviewed on purpose** and is the counterpart: the "not rated" branch is the half that was actually broken, and it can only be reached through a society nobody has reviewed. Do not review it to make a page look fuller. **`green-meadows-baner`** is likewise left at zero because the round-trip spec posts a review to it through the UI. The two authors alternate (`f1c70000-…0001` / `…0002`) because `idx_reviews_author_target` forbids one author two reviews on one target. `target_id` is resolved **`FROM societies WHERE slug = …`**, never hard-coded: `societies.id` is `gen_random_uuid()`, so a literal detaches on the next reseed. Categories use the **capitalised society vocabulary** (`Safety`, `Maintenance`, `Management`, `Amenities`, `Connectivity`) — `ReviewCategories.validated` refuses a key from the property vocabulary rather than dropping it. Note the `societies.avg_rating` / `review_count` **columns are dead**; the aggregate is computed at read time by `SocietyRatingService` from these rows, which is why seeding the columns instead would prove nothing. Until D19 this spec seeded `pnEntityReviews` in localStorage, a mock-provider store the live app never reads. | `reviews`, `societies` |

| `postedTypes` | **p5130–p5133** are approved Buy listings in **Baner**, all `featured = true`. They exist because the search taxonomy offered six canonical Buy types while Postgres held stock for only three: there was **no `Independent House` and no `Farm Land` anywhere in the seed**, and the only plots used the legacy string `Plot`. A filter option that can never return a row is indistinguishable from a filter option that is broken, which is why `consumer/search/live-search-property-types` had been injecting its stock into `puneNestDB_v5` — the mock store the live app does not read — and passing without touching the server. `featured` has **no visual effect on a tile**; it only pins these to page 1 under the real relevance sort, which matters because the backend clamps `size` to 100, so "absent" and "on page 2" would otherwise be the same observation. **p5131 is `Open Plot`, not `Plot`, on purpose**: `SEARCH_TYPES` matches key `plot` on *both* substrings, so keeping one row of each proves the filter still recognises legacy stock the day someone tidies the taxonomy. **p5133 carries `images = '[]'` and `cover_image` NULL** and is the *only* zero-photo row in the seed — it is the D188 fixture, and `<img src="">` is not an image-less image: the browser resolves the empty string against the document URL and re-downloads the whole HTML page as a photo, once per card. Do not give it a picture to make the grid look tidier; the test that needs it has nowhere else to go. | `properties` |
| `landUse` | **p5131** is the only **approved, commercially zoned** plot in the seed (`land_use = 'commercial'`); **p5132** states `'agricultural'` and **p5124** `'residential'`. The stated value on p5132 is deliberate even though `landUseOf()` would *infer* agricultural from the `Farm Land` type — the inference is a display fallback, and pinning the assertion to the column is what stops the test passing again if the column is ignored. It was ignored: V95 added `properties.land_use` with a CHECK on the five legal zones under the comment *"search facets the browser used to invent"*, but only the server half was ever wired. `propertyMapper.toViewModel` dropped the field, so `landUseOf()` fell through to **`LANDUSE_ZONES[hashId(p.id) % 4]`** and every live land listing advertised a zone derived from **a hash of its slug** — p5124 is `residential` in Postgres and rendered as `mixed`. Zoning is a legal attribute of the land rather than a display detail, so a fabricated one misinforms a buyer; the mapper now reads it and `landUseOf` prefers it over both the `form.plotZone` declaration and the hash. Unrecognised values **fall through rather than coercing to `residential`**, so a zone added server-side surfaces as a gap instead of being silently mislabelled. Note the filter option locator is ambiguous by nature — `Commercial` is both a property **type** and a land **use** in `propertyTypes.js` — so specs must scope the option to the Land-use dropdown, and scoping by DOM ancestry does not work because `MultiSelect` portals its menu into `document.body`; use `getByRole('listbox', { name: 'Land use' })`. **Assert against p5124, not p5131.** The mapper was only *half* the fix: `land_use` reached `PropertyResponse` but not `PropertySummary`, which is the shape the listings grid actually consumes, so the card payload still had no zone to read. That was missed because the obvious test — filter to Commercial, expect p5131 — passes either way: `hashId('p5131') % 4` happens to land on `commercial` too. p5131 is a **coincidence**, not evidence. p5124 is the discriminator: Postgres says `residential`, the hash says `mixed`, and no approved plot hashes to residential, so filtering to Residential returns exactly `[p5124]` when the value is read and `[]` when it is invented. Verified by reverting the mapper and watching that one test go red. | `properties` |
| `listingAttributes` | **Batch G** states twelve card-level attributes on twelve existing rows — `age_years`, `floor`, `total_floors`, `facing`, `room`, `tenants`, `available_from`, `pets`, `sharing`, `society_verified`, `conveyance_done` — as `UPDATE`s, never `INSERT`s, so no exact-count assertion moves. They exist because `PropertySummary` carried none of them, so the listings grid **invented all twelve in the browser from `fnvHash(listing.id)`** and then filtered real homes by arithmetic on their slug. The fabrication was also **arithmetically broken**: `fnvHash` returns a uint32 but the derivations used a **signed `>>`**, so for any slug with the high bit set — **14 of 17 sampled rows** — `(h >> 16) % 26` went *negative*. Those listings advertised age −18 and floor −31, were silently dropped from every narrowed Age/Floor search (a negative can never clear a lower bound of 0), matched no availability option at all (`['now','15','30'][-2]` is `undefined`), and — because a negative remainder always satisfies `< 2` — were unconditionally badged **conveyance done** instead of the ~40% the comment promised. The author had diagnosed this exact hazard one line away, on `PG_SHARING` (*"a signed >> would go negative for hashes >= 2^31"*), and fixed it **there alone**. Every seeded value is therefore chosen to **contradict** what the hash claimed, because a filter test that only asserts "fewer rows than before" passes under both implementations — that is how the `land_use` defect survived. The discriminators: **society-verified `{p5120, p5133, p5023}`** (the hash called p5120 *false* and p5008/p5130/p5007/p5033 *true*); **conveyance `{p5120, p5008, p5023}`** (the hash said *true* for 13 of 14); **age 0–3 `{p5133, p5130, p5023}`** and **floor 8+ `{p5008, p5120}`** (the hash's negatives make both sets unreachable); **tenants-family `{p5121, p5123}`**; **available-now `{p5121, p5007}`** (the hash returned `undefined` for both, so the hash-era answer was the *empty* set); **pets `{p5033, p5122}`**; and the share split, where **p5033 and p5122 invert the old `h % 2` coin flip** — p5033 is a PG (`["double","triple"]`), p5122 a flatmate share (`room = 'single'`, no occupancy). p5033 offering **two** sharing keys is load-bearing: the hash produced a *single* key (`PG_SHARING[…][0]`), so no listing could appear under two options, and `sharing=triple` → `{p5007, p5033}` with `sharing=double` → `{p5033}` cannot both hold under it. **p5010 (villa/buy), p5000 (villa/rent) and p5130's floor are left unstated on purpose** — they are the counter-fixtures proving "unknown" is excluded from a narrowed search rather than coerced in, which is what the `?? 0` fallbacks in `listingsResultsPipeline` used to do (an unstated age became "brand new"); an independent house also sits in no building, so a floor for p5130 would be a fabrication of a different kind. Do not fill them in to make the grid look complete. `shareType` has **no column** — it is derived in the mapper from stated facts (occupancy ⇒ PG, room ⇒ flatmates, neither ⇒ ordinary rental). `society_verified`/`conveyance_done` render **no badge anywhere**; they are read only by two filters in `listingsResultsPipeline`, and the `Society.jsx` badge is the society registry, a different data path. Covered by `consumer/search/live-listing-attributes`. | `properties` |

### Choices worth not re-litigating

- **Both of Rahul's saved listings are `approved`.** If one were flagged, "2 saved" would silently
  become "1 saved" behind the public-visibility filter and the failure would look like a bug in
  saving rather than a bug in the fixture.
- **The report targets the listing that is already `flagged`.** The moderation queue and the
  listing's own status then tell the same story; pointing it at an `approved` listing would have
  produced a screen that contradicts itself.
- **Three reports on p5002, not two.** The queue renders its repeat-offender badge at
  `repeatCount >= 3`. At two rows the badge never renders and no spec can prove it fires; three is
  the smallest fixture that distinguishes "complained about once" from "complained about
  repeatedly", which is the only thing that badge is for.
- **Rahul is reported but never triaged.** He is a *target* in two rows and that is all. The users
  tab's "Suspend" button carries `enforcement='suspend_account'`, which archives the account for
  the rest of the run — so a spec exercising enforcement must file its own report against its own
  throwaway actor. Reaching for a registry row would suspend the fixture that four other
  invariants above depend on.
- **Reasons are per target type, and these were checked against `ReportReasons`.** `pricing` and
  `broker` are legal about a property, `brokerage` and `abuse` about a person. A cross-paired
  reason would seed a row the API itself answers with a 400 — a fixture in a state the product
  cannot produce.
- **Two post reports, and one of them uses `filled`.** `target_type='post'` is the flatmates tab,
  which for a long time had no tab at all: the queue split rows two ways over a wire that carries
  four target types, so these reports were being stored correctly and shown nowhere. `filled` is
  legal for a post and for nothing else, which makes it the reason that proves the filter is scoped
  to the tab rather than offering the union of all three vocabularies. Both point at real flatmate
  supply seeded below rather than invented ids — `reports.target_id` is plain `text` with no foreign
  key, because it spans four tables, so nothing but care keeps a queue row clickable.
- **The offer is left `pending`.** An accept/decline spec needs a transition it is allowed to make.
  A fixture parked in a terminal state can only be read, never exercised.
- **`owner_verified` is derived in the seed, not written by hand.** The dumped catalogue inherited
  the mock's randomised values and contradicted itself in both directions — Omkar held no badge
  while all three of his listings claimed he did, and Meera held one while `p5015` denied it. The
  first case is the dangerous one: a fixture that tells buyers an unverified owner is trustworthy is
  a fixture that would have made a spec assert the exact lie the badge exists to prevent. A trailing
  `UPDATE … SET owner_verified = u.aadhaar_verified` in `R__zz_dev_demo_data.sql` now enforces the
  invariant, so it cannot drift the next time the dump is regenerated.
- **The unpaid instalment is `status = 'due'` with a fixed past `due_date`**, not a future date.
  Dates in a committed seed age; the status column does not. Assert on status, never on "next month".
- **Rent mirrors the listing's own seeded price (38 000).** A tenancy that disagrees with the
  listing it belongs to is a fixture that teaches the reader something false.
- **Omkar's live visit is on p5034, not p5015.** The live spec's own review helper books and
  *completes* a visit on p5015 to mint reviewer standing, and `VisitService.schedule` answers 409 to
  a second live visit on the same property. Put on the same listing, the two fixtures would take
  turns breaking each other; on different listings neither can see the other.
- **The flatmate rows are `approved`, never `live`.** Both are public, but `approved` is the value a
  moderator can actually produce — `live` only exists for rows predating the V41 (D72) queue.
  Seeding a state the system can still reach keeps the fixture from grandfathering itself past the
  workflow it is meant to demonstrate.
- **The three original flatmate seekers keep every facet at `any`; the five added later do not.**
  The filter spec asserts "every row a `female` search returns is `female` or `any`", and for that to
  test the query rather than the board there has to be a population the query can actually narrow.
  Meera, Rahul and Priya remain the neutral rows that satisfy any facet; Aditi, Karan, Nikhil, Pooja
  and Sneha carry concrete `gender` / `flat_pref` / `room_pref` values so a filtered result is a
  smaller set than an unfiltered one. All `any` was the right fixture when there were two rows and
  the wrong one the moment a spec wanted to prove a filter did something.
- **A seeker's `move_in` is never left NULL.** `moveInDays` reads `if (!v || v === 'now') return 0`,
  so a missing move-in is not a blank the filter ignores — it is an active claim of *available
  immediately*. Eight NULL rows made the "Immediate" chip match everything and narrow nothing, which
  looked like a broken filter and was a fixture asserting something it never meant to say.
- **Each of the five added seekers has its own `users` row.**
  `uq_flatmate_seeker_posts_live_user` is a partial unique index on `user_id WHERE archived = false`
  — one live seeker post per person, a real product rule. Reusing the three existing seeker users
  did not error: `ON CONFLICT DO NOTHING` with no target turned the unique violation into a reported
  success, `psql` exited 0, and the table still held three rows. **Verify a seed block by counting
  rows, never by exit status.**

## Domains still on mocks

Seeded fixtures do not yet exist for `serviceRequest`, `verification` or `document`.
That is deliberate for now, not an oversight: add fixtures for these when a spec actually needs to
assert a count, and add the registry row in the same change.

## Rules for changing the seed

- **Never hand-edit `R__seed_reference_data.sql`.** It is generated by
  `backend/tools/gen-catalogue-seed.mjs`; localities, societies and plans come from there.
- **Never rename or truncate `R__zz_dev_demo_data.sql`.** The `zz_` prefix sorts it after the
  reference seed; without it, demo listings insert before their localities exist and Flyway dies on
  `properties_locality_slug_fkey`.
- **`ON CONFLICT DO NOTHING` with no conflict target**, matching the rest of the file. Scoping it to
  `(id)` breaks on `users_mobile_key`, because a seeded mobile can already exist under a different
  id. The consequence to keep in mind: **this file never updates an existing row.** Changing a
  fixture's value on a database that already has it requires deleting that row first.
- **Edit it only with an editor / file-edit tool.** Several seed files carry a UTF-8 BOM and are
  checked by `SourceTreeHygieneTest`; a PowerShell `>` or `-replace` round-trip corrupts them.
- `punenest_test` must stay empty — `TestDatabaseIsolationTest` asserts it, and 126 exact-count
  assertions depend on it. It is kept empty by `spring.flyway.locations=classpath:db/migration` in
  `backend/src/test/resources/application.properties`, which excludes `db/seed`. Do not "fix" that line.
