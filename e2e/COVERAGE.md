# PuneNest E2E — Coverage Traceability Matrix

Audit of every app route / feature (`frontend/src/App.jsx` + `docs/flows/`) against the
Playwright specs in `tests/`. Status legend:

- ✅ **Covered** — a dedicated spec exercises the feature's key buttons/functions.
- 🟡 **Partial** — touched incidentally or only one surface; needs a dedicated/deeper spec.
- ❌ **Missing** — no spec; **coverage gap to close** (see backlog at the bottom).

Suite size at audit time: **121 spec files / 758 tests**. After Phase 2 authoring:
**150 spec files / 919 tests** (chromium; `mobile-*` run on the mobile project). All Phase 2
gap specs pass together (`159 passed` in the combined Phase-2 batch run).

**KYC badge-not-gate migration (ADR-019):** the old Aadhaar *gate* specs were replaced by
badge-not-gate specs — `list-property-no-gate`, `contact-badge-not-gate`, `share-flat-no-gate`,
`share-flat-seeker-verify` (opt-in seeker badge) — plus a new `kyc-growth-levers` spec covering the
DigiLocker Verified-badge funnel on the dashboard. Society community/location specs updated so a
signed-in (unverified) member contributes directly. Suite: **151 spec files**.

---

## Consumer

| Route / Feature | Flow doc | Spec(s) | Status |
|---|---|---|---|
| `/` Home (search, featured, popular, property-types, share-flat rail) | search-listings | home-entity-search, home-featured, home-popular-places, home-property-types, home-search-combobox, home-share-flat | ✅ |
| `/listings` search + filters + map | search-listings | listings-locality-filter(-registry), type-aware-filters, search-property-types, commercial-type-filter, filter-slider-manual-entry, near-a-place-*, location-recovery, qa-location-search, map-popup, map-panel-contact | ✅ |
| `/property/:id` detail | property-detail | property-detail-improvements, property-detail-sale, property-infotips, property-chat-owner, property-dedup, property-dup-modal | ✅ |
| Contact reveal + badge-not-gate | contact-gate-leads | contact-owner-gate, contact-badge-not-gate | ✅ |
| `/owner/:id` public owner profile | dashboard-owner-hub | owner-profile | ✅ |
| `/compare` | (search-listings) | compare | ✅ |
| `/signin` `/signup` auth + OTP | auth | auth-flow, auth-improvements | ✅ |
| `/services` hub | services-calculators | services-loans-team | 🟡 |
| `/services/packers-movers` | services-calculators | service-packers | ✅ |
| `/services/property-legal` | services-calculators | service-legal | ✅ |
| `/home-loans` | services-calculators | service-home-loans, services-loans-team | ✅ |
| `/services/interior-renovation` | services-calculators | service-interior | ✅ |
| `/services/property-valuation` | services-calculators | service-valuation | ✅ |
| `/services/rent-agreement` | rent-agreement | rent-agreement | ✅ |
| `/emi-calculator` | services-calculators | emi-calculator | ✅ |
| `/contact` | support-tickets | support-tickets (public enquiry form) | ✅ |
| `/support` tickets + FAQ | support-tickets | support-tickets | ✅ |
| `/notifications` | saved-alerts | notifications, property-alerts | ✅ |
| `/saved` | saved-alerts | saved (desktop), mobile-inbox-saved (mobile) | ✅ |
| `/plans` | plans-billing-refer | plans-billing-checkout | ✅ |
| `/checkout` | plans-billing-refer | plans-billing-checkout | ✅ |
| `/refer` | plans-billing-refer | refer | ✅ |
| `/tenant-profile` | rent-tenancy | tenant-profile | ✅ |
| `/pay-rent` + tenancy | rent-tenancy | my-rental, dashboard-tenant-finances (partial) | 🟡 |
| `/schedule-visit` | schedule-visit | scheduled-visits | ✅ |
| `/societies` `/society/:slug` | societies | society-community(-v2), society-location, society-tabs, society-select, society-onboarding-p2, community-locality | ✅ |
| `/locality/:slug` | societies | locality-select, community-locality (partial) | 🟡 |
| `/reels` | (property-detail) | reels | ✅ |
| `/messages` | contact-gate-leads | messages-inbox | ✅ |
| `/share-flat` | share-a-flat | share-flat-* (23 specs), flatmate-*, pg-* | ✅ |
| Legal pages (privacy/terms/refund/disclaimer) | — | legal-pages, verification-disclaimer | ✅ |
| `/list-property` wizard | list-property-wizard | list-property-* (18 specs) | ✅ |
| `/dashboard` hub | dashboard-owner-hub | dashboard, dashboard-action-center, dashboard-doc-info, dashboard-owner-finances | ✅ |
| `/owner-hub` + `/owner-hub/property/:id` passport | dashboard-owner-hub | owner-hub, property-passport | ✅ |
| `/view-documents` secure viewer | dashboard-owner-hub | view-documents-flow | ✅ |
| **Deals / Offers / Negotiation / Finalization** | deals-offers-finalization | deals-offers | ✅ |

## Admin

| Route / Feature | Flow doc | Spec(s) | Status |
|---|---|---|---|
| `/admin` dashboard + RBAC nav | (all) | admin-consolidation, admin-rbac | ✅ |
| `/admin/properties` verification queue | property-verification | admin-properties, admin-duplicates | ✅ |
| `/admin/analytics` | analytics | admin-analytics | ✅ |
| `/admin/users` + KYC | users-kyc | admin-users | ✅ |
| `/admin/finance` | finance | admin-finance | ✅ |
| `/admin/reports` trust & safety | trust-safety-reports | admin-reports, admin-reports-full | ✅ |
| `/admin/team` | settings-team-staff | admin-rbac (Team & Access) | ✅ |
| `/admin/post-on-behalf` | property-verification | admin-post-on-behalf(-fixes) | ✅ |
| `/admin/localities` + geo | content-localities-societies | maps-geo-admin | 🟡 |
| `/admin/services` moderation | services-moderation | admin-services-moderation | ✅ |
| `/admin/enquiries` funnel | enquiries-funnel | admin-enquiries | ✅ |
| `/admin/content` CMS | content-localities-societies | admin-content | ✅ |
| `/admin/societies` | content-localities-societies | admin-societies | ✅ |
| `/admin/settings` | settings-team-staff | admin-settings | ✅ |
| `/admin/flatmates` | share-a-flat | admin-flatmates | ✅ |
| `/admin/staff-activity` | settings-team-staff | admin-staff-activity | ✅ |

## Ops

| Route / Feature | Flow doc | Spec(s) | Status |
|---|---|---|---|
| `/ops/share-review` | share-a-flat | share-flat-ops-review | ✅ |
| `/ops` dashboard | service-queues | ops-requests | ✅ |
| `/ops/requests` | service-queues | ops-requests | ✅ |
| `/ops/rent-agreement` | rent-agreement / service-queues | ops-rent-agreement, ops-requests | ✅ |
| `/ops/legal` | service-queues | ops-legal, ops-requests | ✅ |
| `/ops/interior` | service-queues | ops-interior | ✅ |
| `/ops/packers` | service-queues | ops-packers | ✅ |
| `/ops/valuation` | service-queues | ops-valuation | ✅ |
| `/ops/referrals` fraud queue | referrals-fraud | ops-referrals | ✅ |

---

## Gap backlog (Phase 2) — ✅ CLOSED

Every ❌ gap and the deep-coverage 🟡 items from the audit have a dedicated spec. **24 new
spec files** authored this pass (all green individually and together — combined batch `159 passed`):

| Spec | Covers |
|---|---|
| `deals-offers.spec.js` | offer → counter → accept → maker-checker finalize (on `/property/:id` + `/dashboard`) |
| `plans-billing-checkout.spec.js` | plan select → `/checkout` → persisted subscription/order state |
| `admin-services-moderation.spec.js` | start/resolve/reassign service requests + status transitions |
| `ops-interior/packers/valuation.spec.js` | team desks: docs-verify maker-checker + TeamRoute guard |
| `ops-rent-agreement.spec.js`, `ops-legal.spec.js` | full doc chain: verify → share-draft → registration → final doc |
| `ops-referrals.spec.js` | referral fraud review approve/reject |
| `admin-content/societies/settings.spec.js` | CMS/reviews, societies moderation, site settings + audit log |
| `admin-staff-activity.spec.js`, `admin-flatmates.spec.js` | activity leaderboard/filters; flatmate moderation |
| `service-packers/legal/interior/valuation/home-loans.spec.js` | landing render + calculators/estimators + service sign-in gate |
| `compare.spec.js`, `owner-profile.spec.js`, `property-passport.spec.js` | comparison table; public owner profile; owner passport |
| `saved.spec.js`, `notifications.spec.js` | desktop saved lists/alerts; notification inbox actions |

Each spec asserts primary buttons/functions (happy path), the role/flag/team **guard**
(redirect when unauthorized), an **empty state**, and any **maker-checker** transition.

**Remaining 🟡 (partial, non-blocking — have incidental coverage, could be deepened later):**
`/services` hub, `/locality/:slug`, `/pay-rent` tenancy, `/admin/localities` geo.
