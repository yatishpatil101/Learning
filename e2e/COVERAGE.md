# PuneNest E2E — Coverage Traceability Matrix

Audit of every app route / feature (`frontend/src/App.jsx` + `docs/flows/`) against the
Playwright specs in `tests/`. Status legend:

- ✅ **Covered** — a dedicated spec exercises the feature's key buttons/functions.
- 🟡 **Partial** — touched incidentally or only one surface; needs a dedicated/deeper spec.
- ❌ **Missing** — no spec; **coverage gap to close** (see backlog at the bottom).

Suite size: **178 spec files** — 20 `mobile-*`, 26 flatmates, 132 other.

---

## Viewport projects

The suite is prefix-routed across three Playwright projects (`playwright.config.js`),
because the mobile-first overhaul made several behaviours viewport-dependent and a
desktop-only run would silently pass against a broken phone layout.

| Project | Device | Runs |
|---|---|---|
| `chromium` | Desktop Chrome | everything **except** `mobile-*.spec.js` |
| `mobile` | Pixel 7 (412×915) | `mobile-*.spec.js` + the `CROSS_VIEWPORT` list |
| `mobile-small` | 360×640, `hasTouch` | `mobile-*.spec.js` only |

`CROSS_VIEWPORT` is the explicit opt-in for specs that assert something genuinely
viewport-dependent (`flatmates-discovery`, `flatmates-owner-split`, `flatmates-posting`,
`help-centre`, `help-i18n-urls`, `i18n`, `property-detail`, `referral-rewards`). Adding a
spec there is a deliberate act — it doubles that spec's runtime, and a spec that only
ever needed one viewport should not be on the list.

`mobile-small` is deliberately narrower than a feature sweep: it exists to stress the
bottom chrome, tap targets and label wrapping at the cramped width where they break
first, not to run the whole suite a third time.

**Two traps this layout has already caught, both worth remembering when writing a
cross-viewport spec:**

- *Collapsed chrome.* `Footer.jsx` renders each column as an accordion that starts
  **closed** below `sm`. A cross-viewport spec that clicks a footer link blind passes
  on desktop and fails on a phone against a footer that is behaving correctly — see
  `revealFooterLink()` in `help-i18n-urls.spec.js`.
- *Unpainted tap targets.* Controls carrying `.tap-extend` are drawn smaller than 44px
  on purpose and restore the touch floor with a transparent 44px `::before`
  (`index.css`). `boundingBox()` measures the painted box, so asserting on it demands a
  44px *pill* and fails a compliant control. `mobile-tap-targets.spec.js` exempts
  `.tap-extend` from its sweep for exactly this reason; measure the pseudo-element
  instead (see `mobile-home-taps.spec.js`).

---

## Consumer

| Route / Feature | Flow doc | Spec(s) | Status |
|---|---|---|---|
| `/` Home (search, featured, popular, property-types, flatmates rail) | search-listings | home-entity-search, home-featured, home-popular-places, home-property-types, home-search-combobox, home-flatmates | ✅ |
| `/help` help centre (+ `/hi/help`, `/mr/help`, `/docs`, `/help-center`) | — | help-centre, help-i18n-urls | ✅ |
| `/listings` search + filters + map | search-listings | listings-locality-filter(-registry), type-aware-filters, search-property-types, commercial-type-filter, filter-slider-manual-entry, near-a-place-*, location-recovery, qa-location-search, map-popup, map-panel-contact, listings-responsive-controls, listings-mobile-only-controls | ✅ |
| `/property/:id` detail | property-detail | property-detail, property-detail-improvements, property-detail-sale, property-infotips, property-chat-owner, property-dedup, property-dup-modal | ✅ |
| Contact reveal + badge-not-gate | contact-gate-leads | contact-owner-gate, contact-badge-not-gate | ✅ |
| Free-contact quota + exhausted modal | contact-gate-leads | referral-rewards | ✅ |
| `/owner/:id` public owner profile | dashboard-owner-hub | owner-profile | ✅ |
| `/compare` | (search-listings) | compare | ✅ |
| `/signin` `/signup` auth + OTP | auth | auth-flow, auth-improvements, mobile-auth-keyboard | ✅ |
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
| `/refer` | plans-billing-refer | refer, referral-rewards | ✅ |
| `/tenant-profile` | rent-tenancy | tenant-profile | ✅ |
| `/pay-rent` + tenancy | rent-tenancy | my-rental, dashboard-tenant-finances (partial) | 🟡 |
| `/schedule-visit` | schedule-visit | scheduled-visits | ✅ |
| `/societies` `/society/:slug` | societies | society-community(-v2), society-location, society-tabs, society-select, society-onboarding-p2, community-locality | ✅ |
| `/locality/:slug` | societies | locality-select, community-locality (partial) | 🟡 |
| `/reels` | (property-detail) | reels | ✅ |
| `/messages` | contact-gate-leads | messages-inbox, mobile-inbox-saved | ✅ |
| `/flatmates` | flatmates | flatmates-* (23 specs), flatmate-*, pg-*, home-flatmates | ✅ |
| Legal pages (privacy/terms/refund/disclaimer) | — | legal-pages, verification-disclaimer | ✅ |
| `/list-property` wizard | list-property-wizard | list-property-* (18 specs), mobile-wizard-sticky | ✅ |
| `/dashboard` hub | dashboard-owner-hub | dashboard, dashboard-action-center, dashboard-doc-info, dashboard-owner-finances, mobile-dashboard-hub | ✅ |
| `/owner-hub` + `/owner-hub/property/:id` passport | dashboard-owner-hub | owner-hub, property-passport | ✅ |
| `/view-documents` secure viewer | dashboard-owner-hub | view-documents-flow, doc-viewer-scheme | ✅ |
| **Deals / Offers / Negotiation / Finalization** | deals-offers-finalization | deals-offers | ✅ |
| Language switching + hi/mr locale integrity | — | i18n, settings-preferences | ✅ |

## Mobile chrome & ergonomics

Mobile-only behaviour has no desktop equivalent to piggy-back on, so it gets its own
table rather than a column in the route matrix above.

| Behaviour | Spec(s) | Status |
|---|---|---|
| Bottom tab bar: mount, destinations, raised Post slot | mobile-bottom-nav | ✅ |
| Bottom inset reservation (`.has-bottom-nav` / `--pn-bottom-inset`) | mobile-bottom-inset | ✅ |
| Safe-area insets, `theme-color`, manifest link | mobile-safe-area | ✅ |
| PWA manifest + icon set | mobile-pwa | ✅ |
| Chrome policy per route (`lib/chrome.js`) — footer/bottom-nav/assistant | mobile-bottom-nav, mobile-inbox-saved, feature-flags | ✅ |
| **No mobile chrome leaks onto desktop** | desktop-noleak-guardrails | ✅ |
| 44px tap-target sweep across consumer routes | mobile-tap-targets | ✅ |
| Home tap targets + touch affordances | mobile-home-taps | ✅ |
| Home: featured before the fold, proof chips | mobile-home-featured-first | ✅ |
| Sheets, swipe-to-dismiss, sticky actions | mobile-sheets-and-actions | ✅ |
| Sticky wizard footer on `/list-property` | mobile-wizard-sticky | ✅ |
| Sticky contact bar on `/property/:id` | mobile-property-contact | ✅ |
| Top-bar scroll behaviour | mobile-topbar-scroll | ✅ |
| Context-aware navbar left slot / account pill | mobile-navbar-context | ✅ |
| On-screen keyboard handling in auth | mobile-auth-keyboard | ✅ |
| Landscape orientation | mobile-landscape | ✅ |
| Space/density optimisation | mobile-space-optimization | ✅ |
| Ops console on a field phone | mobile-ops-field | ✅ |
| Dashboard hub navigation on a phone | mobile-dashboard-hub | ✅ |
| Phase-3 sweep | mobile-phase3 | ✅ |

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
| `/admin/services` moderation (absorbs old `/admin/support`) | services-moderation | admin-services-moderation | ✅ |
| `/admin/enquiries` funnel | enquiries-funnel | admin-enquiries | ✅ |
| `/admin/content` CMS | content-localities-societies | admin-content | ✅ |
| `/admin/societies` | content-localities-societies | admin-societies | ✅ |
| `/admin/settings` | settings-team-staff | admin-settings, settings-debug | ✅ |
| `/admin/flatmates` | flatmates | admin-flatmates | ✅ |
| `/admin/staff-activity` | settings-team-staff | admin-staff-activity | ✅ |

## Ops

| Route / Feature | Flow doc | Spec(s) | Status |
|---|---|---|---|
| `/ops/flatmate-review` | flatmates | flatmates-ops-review | ✅ |
| `/ops` dashboard | service-queues | ops-requests, mobile-ops-field | ✅ |
| `/ops/requests` | service-queues | ops-requests | ✅ |
| `/ops/rent-agreement` | rent-agreement / service-queues | ops-rent-agreement, ops-requests | ✅ |
| `/ops/legal` | service-queues | ops-legal, ops-requests | ✅ |
| `/ops/interior` | service-queues | ops-interior | ✅ |
| `/ops/packers` | service-queues | ops-packers | ✅ |
| `/ops/valuation` | service-queues | ops-valuation | ✅ |
| `/ops/referrals` fraud queue | referrals-fraud | ops-referrals | ✅ |

---

## Notes on recent migrations

**Share-a-flat → Flatmates rename.** Every `share-flat-*.spec.js` was replaced by its
`flatmates-*` equivalent, `shareflat-map-popup` → `flatmates-map-popup`, and
`home-share-flat` → `home-flatmates`. `/share-flat` still redirects, and
`flatmates-discovery` asserts the legacy `?view=` deep links resolve. Three flatmates
specs run cross-viewport because the discovery/posting surfaces differ on a phone.

**KYC badge-not-gate migration (ADR-019).** The old Aadhaar *gate* specs were replaced
by badge-not-gate specs — `list-property-no-gate`, `contact-badge-not-gate`,
`flatmates-no-gate`, `flatmates-seeker-verify` (opt-in seeker badge) — plus
`kyc-growth-levers` covering the DigiLocker Verified-badge funnel on the dashboard.

**Suite consolidation.** The duplicate `frontend/e2e/` suite is gone; this directory is
the single source. Shared fixtures live in `helpers/app.js` (`seed()`, `OWNER`,
`SEEKER`, `ADMIN`, listing factories).

---

## Gap backlog

Earlier Phase-2 gaps are closed. The remaining open items are below.

| Item | Why it is open | Priority |
|---|---|---|
| `/services` hub | Incidental coverage only via `services-loans-team`; no dedicated hub spec | 🟡 low |
| `/locality/:slug` | Covered incidentally by `locality-select` / `community-locality`; the intel cards (price trend, livability, connectivity, emerging) have no assertions | 🟡 medium |
| `/pay-rent` tenancy | `my-rental` + `dashboard-tenant-finances` touch it; the payment path itself is untested | 🟡 medium |
| `/admin/localities` geo | `maps-geo-admin` covers geocoding, not the locality CRUD around it | 🟡 low |
| Help article feedback widget | `components/help/ArticleFeedback.jsx` renders on every article; `help-centre` asserts prose and TOC but never submits feedback | 🟡 low |
| `DualRange` manual entry | `filter-slider-manual-entry` covers the happy path; the currency parser's `Cr` / `L` / `K` suffixes and malformed input are untested | 🟡 low |
| Responsive date/time pickers | `DateField` / `TimeField` swap to native controls on a phone; only the desktop dialog path is asserted | 🟡 low |

Each ✅ spec asserts primary buttons/functions (happy path), the role/flag/team **guard**
(redirect when unauthorized), an **empty state**, and any **maker-checker** transition.

