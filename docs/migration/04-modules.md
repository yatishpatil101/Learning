# 04 — Per-module migration matrix

The 22 frontend service domains. Every page/hook imports **only**
`src/services/<domain>Service.js` → `createProvider()` → mock or `http` provider, chosen per-domain
by `VITE_API_DOMAINS` in `src/services/config.js`. Migration = make the `http` path the **only**
path, backed by seed fixtures and a green e2e spec.

## Legend

- **Live toggle** — listed in `playwright.live.config.js` `VITE_API_DOMAINS` (has a proven `http`
  provider exercised against the real API).
- **Storage** — touches R2 ([01](01-storage-r2.md)): 🖼️ public bucket (photos), 📄 private bucket (docs).
- **Seed pattern** — how the domain's e2e specs get data today: `self-seed` (localStorage via
  `addInitScript` — **must be rewritten**), `runtime` (created during the test — low seed need),
  `catalogue` (already permanently seeded).

> ⚠️ Statuses marked _verify_ are from prior context and must be confirmed against the code before
> acting. The three domains **not** in the live toggle list (`photo`, `fees`, `team`) need their
> `http` path proven before Phase 4 can cover them.

## Matrix

### Catalogue & discovery (already seeded — lowest risk)

| Domain | Live toggle | Storage | Seed pattern | Migration action |
|--------|:-----------:|:-------:|--------------|------------------|
| `property` | ✅ | 🖼️ (uploads) | catalogue + fixtures | Pin named-owner fixtures (Meera template). Rewrite self-seeding property specs to seed-reliant. |
| `society` | ✅ | — | catalogue (348) | Freeze; assert against generated catalogue. |
| `savedSearch` | ✅ | — | runtime | Create-via-API in spec; assert scoped to the fixture buyer. |
| `saved` | ✅ | — | runtime | Same — seed 1 buyer with N saved for a stable read. |

### Identity & access

| Domain | Live toggle | Storage | Seed pattern | Migration action |
|--------|:-----------:|:-------:|--------------|------------------|
| `auth` | ✅ | — | self-seed → **real users** | Biggest change. Replace `localStorage` self-seed with create-or-reuse real users + e2e OTP affordance ([03](03-e2e-database-and-users.md)). |
| `team` | ❌ **not in toggle** | — | real `/staff-login` | Prove `http` provider; admin/staff/manager already use real staff-login — extend to full RBAC reads. |

### Owner listing lifecycle

| Domain | Live toggle | Storage | Seed pattern | Migration action |
|--------|:-----------:|:-------:|--------------|------------------|
| `photo` | ❌ **not in toggle** | 🖼️ | runtime upload | Prove `http` provider; wire to R2 `storePublic`; verify CDN URL persists on listing. |
| `visit` | ✅ | — | runtime | Create-via-API; seed 1 scheduled visit for a stable read. |
| `deal` | ✅ | — | runtime/self-seed _verify_ | Seed 1 owner+buyer deal at a known stage; rewrite deal specs to that fixture. |

### Buyer intent, comms & trust

| Domain | Live toggle | Storage | Seed pattern | Migration action |
|--------|:-----------:|:-------:|--------------|------------------|
| `contact` | ✅ | — | runtime | Contact-gate is user-data — route through `security-reviewer` on any change. Seed a gated + ungated pair. |
| `conversation` | ✅ | — | runtime | Seed 1 conversation between fixture owner+buyer. |
| `review` | ✅ | — | runtime | Seed 1 review; assert scoped. |
| `report` | ✅ | — | runtime | Create-via-API. |
| `support` | ✅ | — | runtime | Seed 1 ticket. |
| `notification` | ✅ | — | runtime | Notifications are emitted by other flows — assert as side effects, not standalone seed. |
| `verification` | ✅ | 📄 _verify_ | runtime + docs | Trust model; may touch private bucket. Confirm doc keys; route through `security-reviewer`. |
| `document` | ✅ | 📄 | mixed — **partial** | Owner half live; **buyer half still on `lib/` (D123)**; managed-property vault on mock store (D124/D125). Finish buyer half + wire vault to R2 private bucket. Highest storage complexity. |

### Money & tenancy

| Domain | Live toggle | Storage | Seed pattern | Migration action |
|--------|:-----------:|:-------:|--------------|------------------|
| `rent` | ✅ | — | runtime | `rentPay.js` is a computational stand-in → move logic server-side or confirm API covers it before deleting `lib/rentPay.js`. Seed 1 active agreement + ledger. |
| `plan` | ✅ | — | runtime | Subscription/plan reads; seed the fixture owner on a known plan. |
| `fees` | ❌ **not in toggle** | — | computational _verify_ | Likely backed by a `lib/` fee calc. Confirm an API exists; if not, this is a backend gap to close before retiring the mock. |
| `serviceRequest` | ✅ | 📄 _verify_ | runtime + docs | May carry draft/final agreements (private bucket). Confirm doc keys. |

### Flatmates

| Domain | Live toggle | Storage | Seed pattern | Migration action |
|--------|:-----------:|:-------:|--------------|------------------|
| `flatmate` | ✅ | 🖼️ _verify_ | runtime | Seed 1 flatmate listing + 1 seeker; rewrite self-seeding specs. |

## Computational stand-ins in `frontend/src/lib/` (delete last)

These are mock-era client-side computations that must be **replaced by API data**, then deleted in
Phase 5 — never before the live suite is green:

| File | Concern | Migration note |
|------|---------|----------------|
| `qualityScore.js` | Listing quality score | Confirm the API returns the score; then delete. |
| `rentPay.js` | Rent payment math | Tie to `rent` domain; server-side or API-covered. |
| `featured.js` | Featured-listing selection | Confirm API ordering; then delete. |
| `freshness.js` | Listing freshness | Confirm API field; then delete. |

> This is the short list of *sort/score* stand-ins. The **full** `frontend/src/lib/` inventory —
> ~50 files classified move-to-backend / stays-client-side / delete-with-the-mock — lives in
> [05-logic-to-backend.md](05-logic-to-backend.md), which is the authoritative list.
>
> **Correction:** an earlier draft of this table listed `seriousBuyer.js`. **That file does not
> exist** in the codebase — it was carried over from stale notes. A serious-buyer signal would be a
> *new feature*, not a migration.

## Per-domain migration recipe (apply down the matrix)

For each domain, in this order:

1. **Confirm the `http` provider + mapper** conform to the OpenAPI contract (`propertyMapper.js`
   style). Fix mapper drift, not the contract.
2. **Add the domain's fixture** to the baseline seed (idempotent upsert) with a documented
   invariant ([02](02-seed-and-fixtures.md)).
3. **Move this domain's business logic to the backend** ([05](05-logic-to-backend.md)). First check
   whether the API **already returns** the value — if so, bind the field and `git rm` the client
   calculation. Only if absent: add the field to the existing DTO + service, update
   `punenest-api.yaml`, then delete. No new endpoint, no new abstraction.
4. **Rewrite the spec**: remove `addInitScript` `localStorage` seeding; either rely on the seeded
   fixture or create data via the API; assert **scoped**, not global. Assert the **server-computed**
   field so the client copy cannot be silently resurrected.
5. **Add/rename** to a live spec and update `e2e/COVERAGE.md` (grep the domain's row — do not read
   the whole 272-row matrix).
6. **Review the comments** in every file touched ([06](06-code-quality.md)). A comment that is now
   false is a defect. Keep rationale; delete stale mock-era narration.
7. **Run** the relevant spec against `punenest_e2e`; green before moving on. Then `npm run check`
   and `npm run check:size` — each `lib/` deletion should buy bundle headroom back.
8. **Post-change verification** (AGENTS.md): `react-reviewer` → `code-reviewer` →
   `security-reviewer` for any user-data domain (`contact`, `auth`, `document`, `verification`).
9. **Re-index the graph** only if files were added/renamed/deleted:
   `.\scripts\graphify.ps1 update`.

## Suggested domain order (low-risk → high-risk)

**Before the list:** `permissions.js` and `contact.js` move server-side first, out of order — they
are authorisation decisions currently made in the browser ([05](05-logic-to-backend.md), Phase 3.5).

1. `property`, `society`, `saved`, `savedSearch` (catalogue-backed, easiest wins)
2. `auth` + `team` (unblocks every authenticated spec)
3. `visit`, `contact`, `conversation`, `review`, `report`, `support`, `notification` (runtime CRUD)
4. `deal`, `plan`, `rent`, `flatmate` (state machines / money)
5. `photo`, `document`, `verification`, `serviceRequest` (storage-touching — needs R2 from Phase 2)
6. `fees` (confirm backend coverage exists at all)
