# PuneNest E2E — Coverage Traceability Matrix

Audit of every app route / feature (`frontend/src/App.jsx` + `docs/flows/`) against the
Playwright specs in `tests/`. Status legend:

- ✅ **Covered** — a dedicated spec exercises the feature's key buttons/functions.
- 🟡 **Partial** — touched incidentally or only one surface; needs a dedicated/deeper spec.
- ❌ **Missing** — no spec; **coverage gap to close**.

Suite size: **190 spec files**, grouped audience → feature area under `tests/`:

| Folder | Specs | | Folder | Specs |
|---|---:|---|---|---:|
| `consumer/flatmates` | 28 | | `consumer/property` | 14 |
| `mobile` | 24 | | `consumer/services` | 12 |
| `admin` | 21 | | `ops` | 8 |
| `consumer/account` | 19 | | `consumer/society` | 7 |
| `consumer/search` | 18 | | `consumer/home` | 6 |
| `consumer/list-property` | 17 | | `platform` (+`auth`, `help`) | 17 |

Spec citations below are paths under `tests/`, minus the `.spec.js`.
`scripts/check-coverage-citations.mjs` fails if one of them stops existing — a stale
citation reads as coverage that is not there.

---

## Viewport projects

The suite is **folder-routed** across three Playwright projects
(`playwright.config.js`), because the mobile-first overhaul made several behaviours
viewport-dependent and a desktop-only run would silently pass against a broken phone
layout. A spec's folder is therefore a functional choice, not just filing — it decides
which viewports ever exercise it.

| Project | Device | Runs |
|---|---|---|
| `chromium` | Desktop Chrome | everything **except** `tests/mobile/` |
| `mobile` | Pixel 7 (412×915) | `tests/mobile/` + the `CROSS_VIEWPORT` list |
| `mobile-small` | 360×640, `hasTouch` | `tests/mobile/` only |

`CROSS_VIEWPORT` is the explicit opt-in for specs that assert something genuinely
viewport-dependent (`consumer/flatmates/discovery`, `consumer/flatmates/owner-split`,
`consumer/flatmates/posting`, `consumer/property/detail`,
`consumer/services/referral-rewards`, `platform/help/centre`, `platform/help/i18n-urls`,
`platform/i18n`). Adding a spec there is a deliberate act — it doubles that spec's
runtime, and a spec that only ever needed one viewport should not be on the list.

`mobile-small` is deliberately narrower than a feature sweep: it exists to stress the
bottom chrome, tap targets and label wrapping at the cramped width where they break
first, not to run the whole suite a third time.

**Two traps this layout has already caught, both worth remembering when writing a
cross-viewport spec:**

- *Collapsed chrome.* `Footer.jsx` renders each column as an accordion that starts
  **closed** below `sm`. A cross-viewport spec that clicks a footer link blind passes
  on desktop and fails on a phone against a footer that is behaving correctly — see
  `revealFooterLink()` in `platform/help/i18n-urls.spec.js`.
- *Unpainted tap targets.* Controls carrying `.tap-extend` are drawn smaller than 44px
  on purpose and restore the touch floor with a transparent 44px `::before`
  (`index.css`). `boundingBox()` measures the painted box, so asserting on it demands a
  44px *pill* and fails a compliant control. `mobile/tap-targets.spec.js` exempts
  `.tap-extend` from its sweep for exactly this reason; measure the pseudo-element
  instead (see `mobile/home-taps.spec.js`).

---

## Consumer

| Route / Feature | Flow doc | Spec(s) | Status |
|---|---|---|---|
| `/` Home (search, featured, popular, property-types, flatmates rail) | search-listings | consumer/home/entity-search, consumer/home/featured, consumer/home/popular-places, consumer/home/property-types, consumer/home/search-combobox, consumer/home/flatmates-rail | ✅ |
| `/help` help centre (+ `/hi/help`, `/mr/help`, `/docs`, `/help-center`) | — | platform/help/centre, platform/help/i18n-urls, platform/help/article-feedback | ✅ |
| `/listings` search + filters + map | search-listings | consumer/search/listings-locality-filter(-registry), consumer/search/type-aware-filters, consumer/search/search-property-types, consumer/search/commercial-type-filter, consumer/search/filter-slider-manual-entry, `consumer/search/near-a-place-*`, consumer/search/location-recovery, consumer/search/qa-location-search, consumer/search/map-popup, consumer/search/map-panel-contact, consumer/search/listings-responsive-controls | ✅ |
| `/property/:id` detail | consumer/property/detail | consumer/property/detail, consumer/property/detail-improvements, consumer/property/detail-sale, consumer/property/infotips, consumer/property/chat-owner, consumer/property/dedup, consumer/property/dup-modal | ✅ |
| Contact reveal + badge-not-gate | contact-gate-leads | contact-owner-gate, contact-badge-not-gate | ✅ |
| Contact grant is per listing, not per owner | contact-gate-leads | owner-profile ("routes contact through a listing") | ✅ |
| Free-contact quota + exhausted modal | contact-gate-leads | referral-rewards | ✅ |
| `/owner/:id` public owner profile | consumer/account/owner-hub | owner-profile | ✅ |
| `/compare` | (search-listings) | consumer/search/compare | ✅ |
| `/signin` `/signup` auth + OTP | auth | platform/auth/flow, platform/auth/improvements, mobile/auth-keyboard | ✅ |
| `/services` hub | services-calculators | consumer/services/hub, consumer/services/loans-team | ✅ |
| `/services/packers-movers` | services-calculators | consumer/services/packers | ✅ |
| `/services/property-legal` | services-calculators | consumer/services/legal | ✅ |
| `/home-loans` | services-calculators | consumer/services/home-loans, consumer/services/loans-team | ✅ |
| `/services/interior-renovation` | services-calculators | consumer/services/interior | ✅ |
| `/services/property-valuation` | services-calculators | consumer/services/valuation | ✅ |
| `/services/rent-agreement` | rent-agreement | rent-agreement | ✅ |
| `/emi-calculator` | services-calculators | emi-calculator | ✅ |
| `/contact` | support-tickets | support-tickets (public enquiry form) | ✅ |
| `/support` tickets + FAQ | support-tickets | support-tickets | ✅ |
| `/notifications` | saved-alerts | notifications, consumer/property/alerts | ✅ |
| `/saved` | saved-alerts | saved (desktop), mobile/inbox-saved (mobile) | ✅ |
| Shortlist is one shared set — heart, navbar badge and `/saved` agree | saved-alerts | saved, consumer/property/reels, consumer/account/dashboard | ✅ |
| Saved searches + alert toggle, one shared list | saved-alerts | consumer/property/alerts, consumer/flatmates/alerts, consumer/account/notifications | ✅ |
| Visits — book, confirm, reschedule, cancel; caller-scoped | consumer/property/detail | consumer/property/scheduled-visits | ✅ |
| `/plans` | plans-billing-refer | plans-billing-checkout | ✅ |
| `/checkout` | plans-billing-refer | plans-billing-checkout | ✅ |
| `/refer` | plans-billing-refer | refer, referral-rewards | ✅ |
| `/tenant-profile` | rent-tenancy | tenant-profile | ✅ |
| `/pay-rent` + tenancy | rent-tenancy | pay-rent, my-rental, consumer/account/tenant-finances | ✅ |
| `/schedule-visit` | schedule-visit | scheduled-visits | ✅ |
| `/societies` `/society/:slug` | societies | consumer/society/community(-v2), consumer/society/location, consumer/society/tabs, consumer/society/select, consumer/society/onboarding-p2, community-locality | ✅ |
| `/locality/:slug` | societies | consumer/search/locality-intel, consumer/search/locality-select, community-locality | ✅ |
| `/reels` | (consumer/property/detail) | reels | ✅ |
| City switcher: propagation, coming-soon waitlist, cancel = no-op, admin offline revert | — | platform/city-propagation | ✅ |
| `/messages` | contact-gate-leads | messages-inbox, mobile/inbox-saved | ✅ |
| `/flatmates` | flatmates | `consumer/flatmates/**` (28 specs), consumer/home/flatmates-rail | ✅ |
| Legal pages (privacy/terms/refund/disclaimer) | — | platform/legal-pages, platform/verification-disclaimer | ✅ |
| `/list-property` wizard | list-property-wizard | `consumer/list-property/**` (17 specs), mobile/wizard-sticky | ✅ |
| `/dashboard` hub | consumer/account/owner-hub | dashboard, consumer/account/action-center, consumer/account/doc-info, consumer/account/owner-finances, mobile/dashboard-hub | ✅ |
| `/dashboard#documents` vault **through the `document` seam** — owner upload / list / delete round-trip on the mock provider, asserting the async flip did not break the demo surface (D124) | consumer/account/owner-hub | consumer/account/documents-vault | ✅ |
| `/dashboard#enquiries` document-request inbox **through the `document` seam** — owner sees a buyer's pending request and grants it from the Leads inbox; the read and the grant route through `documentService` (not localStorage), so the dashboard shares the Documents tab's source of truth and a grant reaches the server in http mode (D125 item 2) | consumer/account/owner-hub | consumer/account/doc-requests-grant | ✅ |
| `/owner-hub` + `/owner-hub/property/:id` passport | consumer/account/owner-hub | owner-hub, consumer/property/passport | ✅ |
| `/view-documents` secure viewer | consumer/account/owner-hub | view-documents-flow, doc-viewer-scheme | ✅ |
| **Deals / Offers / Negotiation / Finalization** — incl. a declined finalize request surfacing "the owner hasn't confirmed — ask again" now the status read returns terminal rows, not pending only (D111) | deals-offers-finalization | deals-offers | ✅ |
| **Buyer deal visibility on the property page** — a buyer on a *closed* listing sees the terminal "no longer available / rented out" banner and the offer + finalize cards are hidden; a *reserved* listing shows the "Under Offer" banner but keeps the offer UI (still queueable); an untouched listing shows no banner and the normal negotiate card. Reads the property's public `dealStatus` mirror, not the owner-scoped deal (D110) | deals-offers-finalization | consumer/property/deal-visibility | ✅ |
| Language switching + hi/mr locale integrity | — | platform/i18n, platform/settings-preferences | ✅ |
| **Redirects** (`/map`, `/docs`, `/help-center`, `/share-flat`, `/owner-hub`, `/admin/support`) + the 404 catch-all | — | platform/route-redirects-404 | ✅ |

## Mobile chrome & ergonomics

Mobile-only behaviour has no desktop equivalent to piggy-back on, so it gets its own
table rather than a column in the route matrix above.

| Behaviour | Spec(s) | Status |
|---|---|---|
| Bottom tab bar: mount, destinations, raised Post slot | mobile/bottom-nav | ✅ |
| Bottom inset reservation (`.has-bottom-nav` / `--pn-bottom-inset`) | mobile/bottom-inset | ✅ |
| Safe-area insets, `theme-color`, manifest link | mobile/safe-area | ✅ |
| PWA manifest + icon set | mobile/pwa | ✅ |
| Home-screen install nudge: engagement gate, escalating silence, platform split | mobile/install-prompt | ✅ |
| Chrome policy per route (`lib/chrome.js`) — footer/bottom-nav/assistant | mobile/bottom-nav, mobile/inbox-saved, platform/feature-flags | ✅ |
| **No mobile chrome leaks onto desktop** | platform/desktop-noleak-guardrails | ✅ |
| 44px tap-target sweep across consumer routes | mobile/tap-targets | ✅ |
| Sliders, carousel dots, admin header icons (the controls the sweep missed) | mobile/touch-targets-p3 | ✅ |
| Property gallery dot rail ≥ 24px (shipped at 22 despite its own comment) | mobile/touch-targets-p3 | ✅ |
| Native share: cancelling the OS sheet is not an error | mobile/native-affordances | ✅ |
| Haptics: fires on save, suppressed by app **and** OS reduce-motion | mobile/native-affordances | ✅ |
| Toolbar controls stay on screen (`/societies`) | mobile/content-budget | ✅ |
| Trust-badge legibility floor (`/flatmates` VERIFIED) | mobile/content-budget | ✅ |
| Home tap targets + touch affordances | mobile/home-taps | ✅ |
| Home: featured before the fold, proof chips | mobile/home-featured-first | ✅ |
| Home Flatmates tile: trust features on one line, CTAs full-width, no h-overflow | mobile/home-flatmates-tile | ✅ |
| Sheets, swipe-to-dismiss, sticky actions | mobile/sheets-and-actions | ✅ |
| Sticky wizard footer on `/list-property` | mobile/wizard-sticky | ✅ |
| Sticky contact bar on `/property/:id` | mobile/property-contact | ✅ |
| **Content budget: primary content is reachable, not buried under chrome** | mobile/content-budget | ✅ |
| Assistant coach-mark: never covers the price, budgeted to 2 sightings | mobile/content-budget | ✅ |
| Top-bar scroll behaviour | mobile/topbar-scroll | ✅ |
| Context-aware navbar left slot / account pill | mobile/navbar-context | ✅ |
| On-screen keyboard handling in auth | mobile/auth-keyboard | ✅ |
| Landscape orientation | mobile/landscape | ✅ |
| Space/density optimisation | mobile/space-optimization | ✅ |
| Ops console on a field phone | mobile/ops-field | ✅ |
| Dashboard hub navigation on a phone | mobile/dashboard-hub | ✅ |
| Phase-3 sweep | mobile/phase3 | ✅ |
| **Date/time pickers dock as bottom sheets below 640px** | mobile/date-time-fields | ✅ |

## Shared UI components

Components used across many routes get their own row rather than being implied by
whichever route happens to render them — that is exactly how the picker
stylesheet bug below survived a 178-file suite.

| Component | Spec(s) | Status |
|---|---|---|
| `DateField` / `TimeField` + their dialogs — styled, layered overlay on **every** route | platform/date-time-fields (desktop), mobile/date-time-fields (sheet) | ✅ |
| `DualRange` manual entry — Cr/L/K parsing, junk input, Escape, bound ordering | consumer/search/dual-range-parsing, consumer/search/filter-slider-manual-entry | ✅ |
| `ArticleFeedback` — positive/negative branches, persistence, per-article reset | platform/help/article-feedback | ✅ |


## Admin

| Route / Feature | Flow doc | Spec(s) | Status |
|---|---|---|---|
| `/admin` dashboard + RBAC nav | (all) | admin/consolidation, admin/rbac | ✅ |
| `/admin/properties` verification queue | property-verification | admin/properties, admin/duplicates | ✅ |
| `/admin/properties` **against the live API** — the moderation queue and its decisions | property-verification | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| `/notifications` **against the live API** — inbox read, seed suppression, mark-all-read | saved-alerts | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| `/messages` **against the live API** — inbox read, seed suppression, thread hydration on open, author attribution, reply round trip | contact-gate-leads | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| `/locality/:slug` reviews **against the live API** — slug-keyed read, no fabricated standing badge | trust-and-verification | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| `/support` **against the live API** — list, raise, reply, and the absence of the priority/attachment controls | cross-cutting | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| **Abuse reports against the live API** — file from a property page, duplicate refused, report reaches the staff-only ops queue, no Reopen on a decided report | trust-and-verification | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| **The contact gate against the live API** — a signed-out visitor on a public listing queries it not at all | contact-gate-leads | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| **Saved shortlist against the live API** — `/me/saved` provenance, `PageEnvelope.page` on the wire, heart round trip | saved-alerts | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| **Saved searches against the live API** — `/me/saved-searches` is the source, and answers with a bare array not an envelope | saved-alerts | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| **Visits against the live API** — both sides of the relationship read separately, and reschedule is not offered (D87) | contact-gate-leads | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| **Subscription plans against the live API** — `/plans` serves the pricing page for a signed-out visitor, and buying a priced plan leaves it `pending` with the entitlement it gates still shut | plans-billing-refer | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| **Deals, offers and finalization against the live API** — the owner's deal book is one `/me/deals` read not one per card, a signed-out visitor asks the deal API nothing, and a buyer reads `/offers/mine` but is never offered the owner-only Accept | deals-offers-finalization | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| **Rent, tenancies and finances against the live API** — Pay Rent asks the rent API nothing when signed out and is served by `/me/tenancies` + `/me/payout-account` when signed in; the owner Finances tab reads summary, cashflow and dues from the server rather than reducing the page it holds | rent-tenancy | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| **The flatmates board against the live API** — all three feeds are served publicly to a signed-out visitor and the board is not empty; a posted room is readable back off the public feed with its price intact; the filter bar narrows the board server-side across every facet (gender/food/roomType/furnishing/bhk/budget, policy, flatPref/roomPref), with `any`-valued preference facets falling back to a wildcard so a flexible post still surfaces | flatmates | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| **Service requests against the live API** — the tracker reads `/service-requests` (not the mock store), a request created through the service round-trips with a `submitted` status, structured `details` read back off the DTO (D119), an empty `docs`/`draft`, a `user`-authored reply read back off the thread, and no mock-only fields; the co-fill party list has no endpoint and returns `[]` (D119–D121) | cross-cutting | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| **The Aadhaar badge against the live API** — the badge is read from `GET /me/verification/aadhaar` (not a mock store) and the seeded contact-gate flag does not grant it; a `start` returns a **pending** DigiLocker consent handle (`ref`, `verificationUrl`), never a granted badge, the next read reports `pending`, and no growth perk is fabricated (D122) | trust-and-verification | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| **The document vault against the live API** — the owner's `#documents` tab uploads through `POST /me/documents/{propId}` and deletes through `DELETE /me/documents/{propId}/{docId}` on a seeded, owned listing, proving the vault reads and writes the real endpoints rather than localStorage (D124) | consumer/account/owner-hub | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| `/admin/analytics` | analytics | admin/analytics | ✅ |
| `/admin/users` + KYC | users-kyc | admin/users | ✅ |
| `/admin/finance` | finance | admin/finance | ✅ |
| `/admin/reports` trust & safety | trust-safety-reports | admin/reports, admin/reports-full | ✅ |
| `/admin/team` | settings-team-staff | admin/rbac (Team & Access) | ✅ |
| `/admin/post-on-behalf` | property-verification | admin/post-on-behalf(-fixes) | ✅ |
| `/admin/localities` + geo | content-localities-societies | admin/localities, admin/maps-geo | ✅ |
| `/admin/services` moderation (absorbs old `/admin/support`) | services-moderation | admin/services-moderation | ✅ |
| `/admin/enquiries` funnel | enquiries-funnel | admin/enquiries | ✅ |
| `/admin/content` CMS | content-localities-societies | admin/content | ✅ |
| `/admin/societies` | content-localities-societies | admin/societies | ✅ |
| `/admin/settings` | settings-team-staff | admin/settings, platform/settings-debug | ✅ |
| `/admin/flatmates` | flatmates | admin/flatmates, admin/flatmate-moderation-reach | ✅ |
| `/admin/staff-activity` | settings-team-staff | admin/staff-activity | ✅ |

## Ops

| Route / Feature | Flow doc | Spec(s) | Status |
|---|---|---|---|
| `/ops/flatmate-review` | flatmates | ops/flatmate-review | ✅ |
| `/ops` dashboard | service-queues | ops/requests, mobile/ops-field | ✅ |
| `/ops/requests` | service-queues | ops/requests | ✅ |
| `/ops/rent-agreement` | rent-agreement / service-queues | ops/rent-agreement, ops/requests | ✅ |
| `/ops/legal` | service-queues | ops/legal, ops/requests | ✅ |
| `/ops/interior` | service-queues | ops/interior | ✅ |
| `/ops/packers` | service-queues | ops/packers | ✅ |
| `/ops/valuation` | service-queues | ops/valuation | ✅ |
| `/ops/referrals` fraud queue | referrals-fraud | ops/referrals | ✅ |

---

## Notes on recent migrations

**Share-a-flat → Flatmates rename.** Every `share-flat-*.spec.js` was replaced by its
`flatmates-*` equivalent, `shareflat-map-popup` → `consumer/flatmates/map-popup`, and
`home-share-flat` → `consumer/home/flatmates-rail`. `/share-flat` still redirects, and
`consumer/flatmates/discovery` asserts the legacy `?view=` deep links resolve. Three flatmates
specs run cross-viewport because the discovery/posting surfaces differ on a phone.

**KYC badge-not-gate migration (ADR-019).** The old Aadhaar *gate* specs were replaced
by badge-not-gate specs — `consumer/list-property/no-gate`, `consumer/property/contact-badge-not-gate`,
`consumer/flatmates/no-gate`, `consumer/flatmates/seeker-verify` (opt-in seeker badge) — plus
`platform/auth/kyc-growth-levers` covering the DigiLocker Verified-badge funnel on the dashboard,
and `platform/auth/verify-payoff` covering what the badge actually *buys* — `ownerVerified` flipped
on every listing, the one-time 7-day Featured slot, and the guard that stops it being farmed.

**Suite consolidation.** The duplicate `frontend/e2e/` suite is gone; this directory is
the single source. Shared fixtures live in `helpers/app.js` (`seed()`, `OWNER`,
`SEEKER`, `ADMIN`, listing factories).

**Flat `tests/` → audience → feature tree.** 191 specs moved out of a single folder
into the tree above, and the viewport routing moved with them: `playwright.config.js`
now selects on `tests/mobile/**` rather than a `mobile-*` filename prefix, so the
convention is visible in the file layout instead of being a rule people had to know.
Filenames dropped the prefix their folder now carries (`flatmates-discovery.spec.js`
→ `consumer/flatmates/discovery.spec.js`).

The move surfaced three **empty** spec files that had been counted as coverage:
`mobile-zzdiag`, `desktop-mobile-guardrails` and `listings-mobile-only-controls` — the
last of which this matrix cited against `/listings`. All three are deleted; the
mobile-only deal-toggle assertions it claimed actually live in
`consumer/search/listings-responsive-controls`, so no coverage was lost. That is the
failure mode `scripts/check-coverage-citations.mjs` now guards against.

---

## Gap backlog

The Phase-2 gaps and the seven items that followed them are closed. There is no
open backlog; the table below records what closing the last batch found, because
each one is a trap the next spec author can fall into again.

| Closed item | What the new spec found |
|---|---|
| `/services` hub → `consumer/services/hub` | Nothing broken, but the hub's `.reveal` blocks sit at `opacity: 0` until scrolled into view. `scrollIntoViewIfNeeded()` deadlocks on them (scrolling requires visibility); force `.visible` instead, as `consumer/property/detail-improvements` does. |
| `/locality/:slug` → `consumer/search/locality-intel` | The intel cards are behind `Tabs`; only Overview renders on load. Also `NativeSelect` is a themed `.pn-dropdown`, so `selectOption()` never resolves — open the trigger and click a `[role="option"]` from the portaled menu. |
| `/pay-rent` → `pay-rent` | `puneNestDB_v5` cannot be seeded in an init script: mockApi migrates and merges it at module load, so a partial object leaves the app with no settings and a blank page. Load once, mutate the real DB, then navigate. |
| `/admin/localities` → `admin/localities` | `Table` renders a desktop `<table>` **and** a `.pn-card` list for phones, hiding one with CSS. Unscoped text assertions either trip strict mode or resolve to the hidden copy. |
| Help feedback → `platform/help/article-feedback` | Fine as shipped: a thumbs-down writes nothing until the comment form is submitted, and the widget resets per article slug. |
| `DualRange` parsing → `consumer/search/dual-range-parsing` | Fine as shipped: `Cr`/`L`/`Lakh`/`Lac`/`K`, `₹`, commas and spaces all parse; unparseable input is ignored rather than coerced to 0. |
| Responsive pickers → `platform/date-time-fields`, `mobile/date-time-fields` | **Two real bugs.** (1) `.pn-datefield` / `.pn-cal` / `.pn-timepicker` lived in `styles/routes/list-property.css`, which only `ListProperty.jsx` imports — so on the other ~19 surfaces the field rendered as a plain block and the calendar as a static, unlayered element that reflowed the page. Moved to `styles/components/date-time-fields.css`, imported by `DateField.jsx` and `TimeField.jsx`. (2) `.pn-timepicker { width: 250px }` sat after the bottom-sheet block at equal specificity, so on a phone the time picker docked as a 250px stub against the left edge while the calendar went full width. Now guarded by `@media (min-width: 640px)`. |

**Measuring a fixed overlay.** `boundingBox()` is document-relative, so on a
scrolled page it reports a docked sheet hundreds of pixels below the fold and
fails against correct CSS. Read `getBoundingClientRect()` in `evaluate()`, and
poll rather than sample once — the sheet animates up from `translateY(100%)`.

## Known-failing (pre-existing, product/spec drift)

Three assertions in `consumer/list-property/types` fail against the current wizard.
They pre-date the folder reorganisation (verified by running the spec before and
after) and are spec drift, not regressions — recorded here so the next run does not
re-investigate them:

| Test | Symptom | Likely cause |
|---|---|---|
| *Land ownership validation requires the 7/12 Extract* | `[data-err="documents"]` resolves to 0 | Nothing in `frontend/src` emits that attribute any more; the document-block error binding was renamed or dropped. |
| *Warehouse (industrial) Step 3 shows factory/pollution docs* | `MPCB (Pollution) Consent` not found | The labels exist in `list-property/constants.js` under the **industrial** subtype; selecting *Warehouse / Godown* no longer resolves to it. |
| *Commercial rent offers year-scale lease terms* | click on the Agreement Duration trigger times out | The control moved or lost the `.pn-dropdown__trigger` the spec reaches through its label's parent. |

Each ✅ spec asserts primary buttons/functions (happy path), the role/flag/team **guard**
(redirect when unauthorized), an **empty state**, and any **maker-checker** transition.

