# 02 — Seed data as a permanent fixture contract

**Owner requirement (verbatim):** *"make sure we have correct set of seed data to make sure our
app displays the data as it is currently doing like photos, localities etc. everything should be
permanently stored and seeded."*

**Good news:** the two things named — **photos** and **localities** — are *already* permanently
seeded and already render live for free. The work here is not "create seed data"; it is **promote
the existing demo seed into a documented, stable, named-fixture contract** the e2e suite can pin.

## What is already seeded (and displays as-is on the live API)

| Asset | Where | Form | Renders live today? |
|-------|-------|------|---------------------|
| Listing photos | `db/seed/R__zz_DML_dev_demo_data.sql`, `photos` JSONB + `hero_image` | External Unsplash URLs (`images.unsplash.com/...?auto=format&fit=crop&w=800&q=70`) | **Yes** — URLs, no storage needed |
| Localities (155) | `db/migration/R__DML_seed_reference_data.sql` | Generated from frontend by `backend/tools/gen-catalogue-seed.mjs` | **Yes** — runs for every profile incl. prod |
| Societies (348) | `db/migration/R__DML_seed_reference_data.sql` | Same generator | **Yes** |
| Listings (16) | `R__zz_DML_dev_demo_data.sql` | Full rows: slug, uuid, deal, type, bhk, price, area, locality, lat/lng, amenities JSONB, photos, status | **Yes** |
| Users (~78) | `R__zz_DML_dev_demo_data.sql` | Owners/buyers/tenants incl. pinned identities | **Yes** |

Load-bearing facts (do not break):

- The `zz_` prefix on `R__zz_DML_dev_demo_data.sql` orders it **after** other repeatable migrations in
  Flyway — sorting is by *description*, not filename, so `DML seed permission map` <
  `DML seed reference data` < `zz DML dev demo data`. **Never truncate it**, and rename only as a
  deliberate, swept change: the filename is quoted by name in specs, tooling and docs (the
  2026-09-01 `_DML_` rename touched 47 files), so a casual rename silently unorders the seeds.
- Reference data lives in `db/migration` (not `db/seed`) **on purpose** — it is schema meaning, not
  demo content, and `TestDatabaseIsolationTest` asserts `localities` is present while the demo seed
  is absent. Do not move it to `db/seed`.
- The demo seed is kept out of `draazy_test` by `spring.flyway.locations=classpath:db/migration`
  in `src/test/resources/application.properties`. That one line is doing real work.
- Several seed files carry a UTF-8 BOM (flagged by `SourceTreeHygieneTest`). Edit seed **only**
  with `replace_string_in_file` — never PowerShell `>` / `-replace` / `Set-Content` (BOM/UTF-16
  corruption).

## The fixture-contract concept

Right now the seed is "some demo rows." The e2e suite needs **named actors with documented,
stable invariants** it can assert against. One already exists and is the template to follow:

> `e2e/tests/live-property-integration.spec.js` pins **OWNER Meera Deshpande, mobile
> `9470744469`, owns 4 seeded listings, of which 3 are publicly visible** (`total:4
> publiclyVisible:3`).

Every domain the e2e suite touches needs an equivalent named baseline. The deliverable of Phase 1
is a **fixture registry** — a table of named actors and the invariants each guarantees — kept next
to the seed and referenced by specs.

### The fixture registry — **delivered**, see [`docs/system/fixture-registry.md`](../system/fixture-registry.md)

Written 2026-08-12. Meera stayed the anchor; three named actors were added around her (Rahul Mehta
`9700000001` demand-side, Priya Nair `9700000002` tenant, Arjun Rao `9700000003` reporter) and the
registry now guarantees one invariant per domain across `saved`, `savedSearch`, `notification`,
`review`, `report`, `support`, `deal` and `rent`. The rows live in a `NAMED FIXTURE CONTRACT` block
at the end of `R__zz_DML_dev_demo_data.sql`; every id starts `f1c7` so `grep f1c7` finds the contract.

The sketch below is kept only to show what was asked for versus what was built. Two rows moved:

- *"owner w/ pending listing"* was **not** created. Meera's 4th listing is already seeded `flagged`,
  which serves the moderation flows without inventing a second owner, so the open report was pointed
  at that listing instead — queue and listing status then agree rather than contradict.
- *"tenant"* became a `buyer`. `users.role` is CHECK-constrained to `buyer | owner | staff | admin`;
  there is no tenant role, so Priya is a buyer who holds a tenancy.

<details><summary>Original sketch (superseded)</summary>

| Actor | Mobile | Role | Guaranteed invariant (what specs may assert) |
|-------|--------|------|----------------------------------------------|
| Meera Deshpande | 9470744469 | Owner | Owns 4 listings; 3 publicly visible (existing) |
| _(owner w/ pending listing)_ | … | Owner | ≥1 `pending` listing for moderation flows |
| _(buyer w/ saved + saved search)_ | … | Buyer | N saved listings, 1 saved search |
| _(tenant on active rent)_ | … | Tenant | 1 active rent agreement + ledger |
| _(owner+buyer in a deal)_ | … | both | 1 deal at a known stage for deal/offer flows |
| … | … | … | one per domain in [04-modules.md](04-modules.md) |

</details>

The invariants become the **contract**: a spec asserts against the invariant, not against a
global count that drifts.

## Two kinds of seed data — align them differently

1. **Catalogue / reference (photos-as-URLs, localities, societies).** Already correct and stable.
   Action: **freeze**. Regenerate only via `gen-catalogue-seed.mjs` if the frontend catalogue
   changes; never hand-edit.
2. **Transactional demo (listings, users, and everything created at runtime).** Most user-generated
   domains (deals, offers, contacts, reviews, conversations, support tickets, visits, saved,
   savedSearch) seed at **0 rows** today — they are created during use. For e2e we must seed a
   **minimal named baseline** for each so a fresh `draazy_e2e` has something to assert against
   before any spec mutates state.

## Decision: seed photos — keep-URL vs re-host to R2

| Option | Pros | Cons | Recommendation |
|--------|------|------|----------------|
| **Keep Unsplash URLs** (today) | Zero work, zero storage cost, renders now | Depends on Unsplash uptime; no offline demo | **Default** |
| **Re-host to R2 public bucket** | Offline-proof, self-owned assets, exercises `storePublic` on real data | One-time upload job + rewrite seed URLs to the CDN base | Only if offline demos are a stated need |

If re-hosting later: write a one-shot tool that downloads each seed image, `storePublic`s it under
`listings/seed/{n}.jpg`, and rewrites the seed `photos`/`hero_image` to the CDN URLs. Out of scope
for the first cut.

## Migration checklist

- [x] Inventory what every current mock screen displays (properties, localities on map, societies,
      owner dashboards, deals, rent ledger, etc.) — this is the sizing step; do it first.
      *Done: 224 specs (110 self-seeding, of which 37 write domain data), 26 mock collections, and
      all 85 live tables counted. Result: 12 of the 19 live domains had zero repo seed.*
- [x] Write the fixture registry (named actors + invariants), one row per domain in
      [04-modules.md](04-modules.md). → [`docs/system/fixture-registry.md`](../system/fixture-registry.md)
- [x] Grow `R__zz_DML_dev_demo_data.sql` to guarantee those invariants — **idempotent upserts**, so
      re-running against `draazy_e2e` is safe.
      *Idempotent, but INSERTs not upserts: the file uses bare `ON CONFLICT DO NOTHING` with no
      conflict target (scoping it to `(id)` breaks on `users_mobile_key`). Re-running is safe; it
      just never **updates** an existing row, so changing a fixture value needs a DELETE first.
      Verified by applying the file twice against `draazy` — `EXIT=0` both passes — then asserting
      all 10 registry invariants against the database.*
- [x] Keep the demo seed out of `draazy_test` (verify `TestDatabaseIsolationTest` still passes).
      *`TestDatabaseIsolationTest` + `SourceTreeHygieneTest`: 4 tests, 0 failures.*
- [x] Confirm localities/societies still generated from the frontend catalogue, not hand-edited.
      *Untouched — the fixture block adds no reference data.*
- [x] Defer photo re-hosting; keep URLs unless offline demo is required.

Still on mocks by choice: `flatmate`, `serviceRequest`, `verification`, `document`. Only one of the
24 flatmate specs writes domain state; the other 23 need a session, which the registry actors
already provide. Add fixtures when a spec actually needs to assert a count.
