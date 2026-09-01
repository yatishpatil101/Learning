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

`role` is CHECK-constrained to `buyer | owner | staff | admin`, so there is no `tenant` role —
Priya is a `buyer` who happens to hold a tenancy.

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
| `concierge` | Exactly **four** listings carry `posted_by_admin = true`, one at each of four `pipeline_stage` values, all `pending`, all with an owner who has a mobile: **`1 BHK Flat in Kharadi`** (`p5030`, Nikhil Jain `9411618812`) at `listed`; **`1 BHK Plot in Viman Nagar`** (`p5028`, Tanvi Mehta `9108512606`) at `docs_submitted`; **`2 BHK Row House in Kothrud`** (`p5024`, Sakshi Rao `9596499088`) at `photos_uploaded`; **`4 BHK Penthouse in Undri`** (`p5037`, Tanvi Chavan `9592138848`) at `claim_sent`. All four record `postedByStaff` as the seeded Admin's id `e6621d3a-3e31-5022-a6c9-34a90c8f6e9b` — the id, never the name. One per stage is not padding: the three funnel booleans are *derived* from the stage by `PipelineStage.reached`, so the stage is the only stored fact and four stages is the smallest set producing all four boolean combinations. They are ordinary rows in `R__zz_dev_demo_data.sql` with three columns changed, not a separate block, which is why the property count stays **38** — the fixture was built by converting existing owner-posted listings rather than adding new ones, precisely so that no spec asserting a total had to change. Do not convert **`3 BHK Penthouse in Kothrud`** (`p5002`, Meera): `admin/live-outreach` needs an owner-posted listing to keep pinning that a chaser there is written and never counted. Do not convert **`1 RK Flat in Pimple Saudagar`** either — it is `admin/live-outreach-console`'s fixture and gaining a chase panel would change what that spec opens. | `properties` |
| `deal` | p5021 has **1 active** buy deal with Rahul at 89 00 000, **1** party, and **1 pending** offer. | `deals`, `deal_parties`, `offers` |
| `rent` | Priya holds an **active** tenancy on p5015 (rent 38 000, deposit 76 000) with **3** instalments: **2 paid, 1 due**. | `tenancies`, `rent_payments` |
| `visit` | Omkar holds **exactly 1 live** visit (`scheduled`), on **p5034**. | `visits` |
| `flatmate` | The board carries **2 approved rooms**, **2 approved seeker posts** and **1 approved group** — every facet left at `any`. | `flatmate_rooms`, `flatmate_seeker_posts`, `flatmate_groups` |
| `ownerBadge` | `properties.owner_verified` **always** equals its owner's `users.aadhaar_verified`. Meera's listings carry the badge; Omkar's (incl. `p5007`) do not. | `properties`, `users` |

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
- **Every flatmate facet is left at its `any` default.** The filter spec asserts "every row a
  `female` search returns is `female` or `any`"; a seed row with a concrete gender would make the
  board's contents, rather than the query, decide whether that passes.

## Domains still on mocks

Seeded fixtures do not yet exist for `flatmate`, `serviceRequest`, `verification` or `document`.
That is deliberate for now, not an oversight: of the 24 flatmate specs only one writes domain
state (`consumer/flatmates/pg-sharing`), the other 23 only need a logged-in session, which the
actors above already provide. Add fixtures for these when a spec actually needs to assert a count,
and add the registry row in the same change.

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
