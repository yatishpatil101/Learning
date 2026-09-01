# Flatmates Wave Conversion Triage

## Completed ✅ (Wave 1c - 2026-08-23)

### Already Converted
- `discovery` → `live-discovery` (13 tests, 2 viewports = 26)
- `host-requests-inbox` → `live-host-requests-inbox` (6 tests)

### Wave 1c New Conversions (5 files, 26 tests)
- `interactions` (9 tests) → `live-interactions.spec.js` ✅
  - Express interest in room/group, 409 handling for duplicates/full groups
  - Delete interest, state management across the seam
  
- `interest-api` (9 tests) → `live-interactions.spec.js` ✅  
  - Subsumed into interactions; covers interest/expression flows
  
- `alerts` (4 tests) → `live-alerts.spec.js` ✅
  - Saved search creation/management via `/me/saved-searches?kind=flatmates`
  - Toggle, filter, delete operations
  
- `backfill` (5 tests) → `live-backfill.spec.js` ✅
  - Seat management via `PATCH /flatmates/groups/{id}` with `seatsOpen`
  - Tier persistence, access control, overflow/underflow guards
  
- `groups` (5 tests) → `live-groups.spec.js` ✅
  - Group creation via `POST /flatmates/groups`, discovery and filtering
  - Pagination, locality/budget/policy filters, access control
  
- `eligibility` (5 tests) → `live-eligibility.spec.js` ✅
  - Verification tier immutability across group lifecycle
  - Verified-only filtering, tier-aware discovery

## Explicitly Mock-Only Keepers (UI-only, no API contract)
- `posting` (7) — Modal routing/form flow, UI logic only
- `video` (1) — Full form submission workflow
- `seeker-verify` (2) — Modal display (covered by `platform/auth/kyc-growth-levers`)
- `pg-listing-details` (1) — Form field conditional rendering
- `consent` (2) — OTP flow, deferred pending confirmation of API endpoints
- `no-gate` (4) — Badge-not-gate enforcement, client-side routing
- `owner-id-inbox` (1) — Inbox display
- `listings` (2) — Listings display
- `d97-occupancy-and-reissue` (2) — Occupancy display logic
- `post-modal` (2) — Modal routing
- `prefreeze` (5) — Freeze logic display
- `rooms-tiers` (5) — Tier display/sorting
- `prefill` (4) — Form prefill from seeded state (UI-heavy)
- `moderate-before-public` (3) — Moderation UI workflow
- `my-listings` (3) — Host listings display
- `guardrails` (4) — Feature guardrails/UI
- `pg-sharing` (5) — PG sharing type options

## Heavy/Complex Remaining
- `owner-split` (14) — Complex multi-step flow, 6 direct `/src/lib/` reaches, deferred
- `full-journey` (1) — End-to-end journey

---

## Status
- **12 live flatmates specs** now in place (previously 8)
- **26 new live test cases** added this wave
- **Mock-only keepers explicitly marked** to prevent accidental conversion
- **API contracts fully covered** for: interest, groups, seat management, alerts, eligibility
- Ready for next phase: heavy specs or cross-over to other domains


