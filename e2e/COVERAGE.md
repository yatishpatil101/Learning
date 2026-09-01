# PuneNest E2E — Coverage Traceability Matrix

Audit of every app route / feature (`frontend/src/App.jsx` + `docs/flows/`) against the
Playwright specs in `tests/`. Status legend:

- ✅ **Covered** — a dedicated spec exercises the feature's key buttons/functions.
- 🟡 **Partial** — touched incidentally or only one surface; needs a dedicated/deeper spec.
- ❌ **Missing** — no spec; **coverage gap to close**.

Suite size: **228 spec files**, grouped audience → feature area under `tests/`:

| Folder | Specs | | Folder | Specs |
|---|---:|---|---|---:|
| `consumer/flatmates` | 32 | | `consumer/property` | 18 |
| `mobile` | 28 | | `consumer/list-property` | 18 |
| `admin` | 26 | | `consumer/services` | 13 |
| `consumer/account` | 22 | | `ops` | 12 |
| `platform` (+`auth`, `help`) | 20 | | `consumer/society` | 9 |
| `consumer/search` | 19 | | `consumer/home` | 6 |

The five loose specs at `tests/` and `tests/consumer/` are cross-cutting and belong to no
one area. Counts are re-derived from the tree, not maintained by hand.

Spec citations below are paths under `tests/`, minus the `.spec.js`.
`scripts/check-coverage-citations.mjs` fails if one of them stops existing — a stale
citation reads as coverage that is not there.

---

## Viewport projects

The suite is **folder-routed** across viewport projects in *both* configs, because the
mobile-first overhaul made several behaviours viewport-dependent and a desktop-only run
would silently pass against a broken phone layout. A spec's folder is therefore a
functional choice, not just filing — it decides which viewports ever exercise it.

`tests/mobile/**` moved wholesale to the **live** suite in P5b wave 3, so the three
projects that matter now live in `playwright.live.config.js`:

| Project (live config) | Device | Runs |
|---|---|---|
| `chromium` | Desktop Chrome | every `live-*` spec **except** `tests/mobile/` |
| `mobile` | Pixel 7 (412×915) | `tests/mobile/` + the converted cross-viewport specs |
| `mobile-small` | 360×640, `hasTouch` | `tests/mobile/` only |

The mock config (`playwright.config.js`) keeps a `chromium` and a `mobile` project. Its
`mobile` project now carries only `CROSS_VIEWPORT`; its `mobile-small` project was
removed in the same wave, because with the folder gone it matched zero specs — and a
project that matches nothing reports nothing.

`CROSS_VIEWPORT` is the explicit opt-in for specs that assert something genuinely
viewport-dependent (`consumer/flatmates/discovery`, `consumer/flatmates/owner-split`,
`consumer/flatmates/posting`, `consumer/property/detail`,
`consumer/services/referral-rewards`). Adding a spec there is a
deliberate act — it doubles that spec's runtime, and a spec that only ever needed one
viewport should not be on the list. Converting a cross-viewport spec means **moving**
its entry to the live config's `mobile` project, never dropping it: a stale path matches
nothing and reports nothing, so halved coverage is silent.

`mobile-small` is deliberately narrower than a feature sweep: it exists to stress the
bottom chrome, tap targets and label wrapping at the cramped width where they break
first, not to run the whole suite a third time.

**Two traps this layout has already caught, both worth remembering when writing a
cross-viewport spec:**

- *Collapsed chrome.* `Footer.jsx` renders each column as an accordion that starts
  **closed** below `sm`. A cross-viewport spec that clicks a footer link blind passes
  on desktop and fails on a phone against a footer that is behaving correctly — see
  `revealFooterLink()` in `platform/help/live-i18n-urls.spec.js`.
- *Unpainted tap targets.* Controls carrying `.tap-extend` are drawn smaller than 44px
  on purpose and restore the touch floor with a transparent 44px `::before`
  (`index.css`). `boundingBox()` measures the painted box, so asserting on it demands a
  44px *pill* and fails a compliant control. `mobile/live-tap-targets.spec.js` used to
  exempt `.tap-extend` wholesale; it now **unions the element box with its
  `::before`/`::after` geometry** instead, which is strictly stronger — deleting the
  pseudo-element from `index.css` fails the sweep, where the class name alone used to
  buy a pass. A single-element spec can still take the cheap route (see
  `mobile/live-home-taps.spec.js`), but never assert on `boundingBox()` alone.
- *Sweeps that measure a blank page.* Until D19x, `tap-targets.spec.js` swept at
  `networkidle`, which on this app fires ~350ms **before** React paints — six of seven
  routes were being measured with `innerText.length === 0` and passing vacuously. The
  sweep now gates on `appReady()` plus a `MIN_CANDIDATES` floor that is asserted again
  at measurement time. Any new sweep-style spec must do the same: a sweep that can
  silently measure an empty document is worse than no sweep.

---

## Consumer

| Route / Feature | Flow doc | Spec(s) | Status |
|---|---|---|---|
| `/` Home (search, featured, popular, property-types, flatmates rail) | search-listings | consumer/home/entity-search, consumer/home/featured, consumer/home/popular-places, consumer/home/property-types, consumer/home/search-combobox, consumer/home/flatmates-rail | ✅ |
| `/help` help centre (+ `/hi/help`, `/mr/help`, `/docs`, `/help-center`) | — | platform/help/live-centre, platform/help/live-i18n-urls, platform/help/live-article-feedback (all `--config=playwright.live.config.js`) | ✅ |
| Footer help links on a phone stay tappable and keep the `/hi`/`/mr` language prefix even with the cookie banner showing; the page reserves the banner's height instead of letting fixed bottom chrome cover the footer (D189) | — | platform/help/live-i18n-urls (`--config=playwright.live.config.js`, `--project=mobile`) | ✅ |
| `/listings` search + filters + map | search-listings | consumer/search/listings-locality-filter(-registry), consumer/search/type-aware-filters, consumer/search/search-property-types, consumer/search/commercial-type-filter, consumer/search/filter-slider-manual-entry, `consumer/search/near-a-place-*`, consumer/search/location-recovery, consumer/search/qa-location-search, consumer/search/map-popup, consumer/search/map-panel-contact, consumer/search/listings-responsive-controls | ✅ |
| Photoless property cards hit during the seeded search-property-types journey render **no `<img src="">` at all**, so `image: ''` rows stay visible without the browser re-requesting the whole page or logging React warnings (D188) | search-listings | consumer/search/search-property-types | ✅ |
| `/property/:id` detail | consumer/property/detail | consumer/property/detail, consumer/property/detail-improvements, consumer/property/detail-sale, consumer/property/infotips, consumer/property/chat-owner, consumer/property/dedup, consumer/property/dup-modal | ✅ |
| The rating block's average, review count, star distribution and per-aspect averages come from the seam's `getPropertyReviewSummary` (`GET /properties/{propId}/reviews/summary`, D79) rather than a `reduce` over the rendered list; `categoryAverages` stays sparse, per-aspect row order is the mapper's (the server sorts `order by c.key`, the mock inserts in product order), and "% would recommend" — which has no server aggregate — is still derived from the list | consumer/property/detail | consumer/property/reviews-summary | 🟡 |
| A failed summary read leaves the reviews themselves rendered — the section draws the aggregate grid only when the summary arrived, so losing one of the two reads shows cards without stars, and names the missing rating, instead of claiming the listing has no reviews. **Unreachable in mock mode**: both providers read the same localStorage rows, so neither read is a request and `page.route(...).abort()` intercepts nothing — so this is asserted live, aborting only `/reviews/summary` and checking the list read still returned 200 with rows in it before asserting the cards rendered, `reviews-aggregate` is absent, and `property-rating-unavailable` is shown | consumer/property/detail | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| Every star in the property review composer carries an accessible name — "3 star" on the overall strip, "3 star for Value" on each aspect row — so the six `StarInput` strips are not thirty identically-announced buttons in a dialog (D198) | consumer/property/detail | consumer/property/review-composer | ✅ |
| A former resident can earn reviewer standing without a booked visit, and **only** with the landlord's agreement (D194). The tenancy half of eligibility used to be a `localStorage` read nothing on the live path wrote, so it was unconditionally false against the API and residents were told to "book a visit first" for a flat they had lived in. Both halves now go through the seam: a brokered tenancy (`/me/tenancies`) and an owner-confirmed declaration. The load-bearing assertions are the negative ones — a **pending** claim does not open the composer, and a **withdrawn** confirmation closes it again — because making residents eligible is easy and doing it without minting a self-service review button is the actual problem. Server-side twin: `TenancyDeclarationFlowTest` (422 for pending, 404 for a non-owner confirming) | consumer/property/detail | consumer/property/tenancy-declaration | ✅ |
| The ownership-verified badge describes what was actually checked — documents sighted by the platform — and makes **no** land-registry claim (D190). The copy is the assertion here rather than the state: the badge is now earnable from `property_ownership_evidence`, and the previous wording promised a registry match the platform has never performed, which is the kind of overclaim a user relies on and cannot verify | consumer/property/detail | consumer/property/ownership-verified-copy | ✅ |
| Contact reveal + badge-not-gate | contact-gate-leads | contact-owner-gate, contact-badge-not-gate | ✅ |
| Owner number is never revealed to a buyer — the gate hides it regardless of the owner's `hide_number` pref; approval unlocks in-app chat, not digits (D5, global policy) | contact-gate-leads | contact-identity-masking ("hides the owner number for a buyer regardless of the owner pref") | ✅ |
| Contact grant is per listing, not per owner | contact-gate-leads | owner-profile ("routes contact through a listing") | ✅ |
| Free-contact quota + exhausted modal | contact-gate-leads | referral-rewards | ✅ |
| `/owner/:id` public owner profile | consumer/account/owner-hub | owner-profile | ✅ |
| `/compare` | (search-listings) | consumer/search/compare | ✅ |
| `/signin` `/signup` auth + OTP | auth | platform/auth/live-flow (`--config=playwright.live.config.js`), platform/auth/live-improvements (`--config=playwright.live.config.js`), mobile/live-auth-keyboard | ✅ |
| **Sign In discloses nothing about whether a number is registered** — an unregistered mobile and a freshly registered one both stay on `/signin` and reveal the same OTP entry, with no "new here?" hint. The live API has deliberately no existence endpoint, because answering it publicly is a user-enumeration oracle; `Signin.jsx` gates the mock's convenience bounce to `/signup` behind `!authIsLive`, and that branch dies in P5c. Asserted as a pair on purpose — "the unknown number went to OTP" is only evidence of non-disclosure if a known number does the same | auth | platform/auth/live-flow (`--config=playwright.live.config.js`) | ✅ |
| `/services` hub | services-calculators | consumer/services/hub, consumer/services/loans-team | ✅ |
| `/services/packers-movers` | services-calculators | consumer/services/packers | ✅ |
| `/services/property-legal` | services-calculators | consumer/services/legal | ✅ |
| `/home-loans` | services-calculators | consumer/services/home-loans, consumer/services/loans-team | ✅ |
| `/services/interior-renovation` | services-calculators | consumer/services/interior | ✅ |
| `/services/property-valuation` | services-calculators | consumer/services/valuation | ✅ |
| `/services/rent-agreement` | rent-agreement | rent-agreement | ✅ |
| Two of its tests used to re-log as an admin and carry on into `/ops/rent-agreement` — a consumer spec proving a consumer flow should not need a second role, and that desk is gone. Both were truncated to their consumer half and retitled: the owner's upload is asserted on the request itself (matching the real `owner-pan` file name, not merely a non-empty `docs[]` — `serviceFlow` gives *every* request a placeholder `defaultDocs()` array, so a length check would pass without any upload), and the lead ticket is asserted to open at `new`. The dropped half asserted "Mark all verified", which is not coming back: the checklist is derived on read (D120) so there is nothing to mark, and `docs_review` was one of three statuses the React prototype invented that `ServiceRequestStatus` refuses by name | rent-agreement / service-queues | rent-agreement | ✅ |
| Rent agreement is a **paid** desk: create prices it server-side, parks it at `awaiting-payment` (invisible to ops) and returns a `paymentSessionId`; only the signed webhook settles it | rent-agreement | *(backend `ServiceRequestFlowTest.PaidGate` — not reachable from e2e, see note)* | ⛔ by design |
| …which is also why `ops/live-drafting-desk.spec.js` files a **valuation** request rather than a rent agreement: `findForQueue` excludes `awaiting-payment` on purpose, so the rental desk is always empty from e2e. The disclosure guard it asserts is type-agnostic, so nothing is lost by moving desks | rent-agreement / ops-desks | ops/live-drafting-desk | ✅ |
| The rent-agreement draft autosave deliberately omits PAN and Aadhaar (D159): a mid-fill refresh restores every other answer with those two blank, they never reach `localStorage`, and a draft written before the rule is redacted in place on the next visit | rent-agreement | consumer/services/rent-agreement | ✅ |
| `/emi-calculator` | services-calculators | emi-calculator | ✅ |
| `/contact` | support-tickets | support-tickets (public enquiry form) | ✅ |
| `/support` tickets + FAQ | support-tickets | support-tickets | ✅ |
| `/notifications` | saved-alerts | notifications, consumer/property/alerts | ✅ |
| `/saved` | saved-alerts | saved (desktop), mobile/live-inbox-saved (mobile) | ✅ |
| Removing a saved card stages an undo for 5s rather than committing — swipe **and** the per-card remove button both open the window, undo restores real state (nothing is ever written), and the window commits when it lapses (D99) | saved-alerts | mobile/live-saved-swipe-undo, consumer/account/saved ("remove stages an undo first") | ✅ |
| The undo affordance is announced (`role="status"`), takes focus when the card that raised it unmounts, and names the card in its accessible name — a destructive gesture must not have a gesture-only escape hatch (D99) | saved-alerts | mobile/live-saved-swipe-undo ("announced, focused and names the card") | ✅ |
| Shortlist is one shared set — heart, navbar badge and `/saved` agree | saved-alerts | saved, consumer/property/reels, consumer/account/dashboard | ✅ |
| Saved searches + alert cadence picker (`off\|instant\|daily\|weekly`), one shared list — the dashboard writes `alertFrequency` directly, so a non-default cadence survives an off→on cycle (D84) | saved-alerts | consumer/property/alerts, consumer/flatmates/alerts, consumer/account/notifications | ✅ |
| Alert cards require sign-in to create a managed alert; anonymous submit still feeds the demand-gap then routes to `/signin?reason=alerts` (D85) | saved-alerts | consumer/property/alerts, consumer/flatmates/alerts | ✅ |
| Visits — book, confirm, reschedule (moves the slot in place and resets to scheduled, `PATCH /visits/{id}/slot`, D87), cancel; caller-scoped | consumer/property/detail | consumer/property/scheduled-visits | ✅ |
| A buyer viewing their booked visit gets no WhatsApp handoff to the owner — the owner→visitor `wa.me` link is owner-only, and masked numbers never form a link (D5, global policy) | consumer/property/detail | consumer/property/scheduled-visits ("a buyer viewing their booked visit gets no WhatsApp handoff to the owner") | ✅ |
| The owner *does* get the handoff the policy keeps: the visitor's name renders and the `wa.me` link carries their number — the tab reads the seam's `visitorName`/`visitorMobile`, not the never-populated `v.customer`/`v.mobile` | consumer/property/detail | consumer/property/scheduled-visits ("the owner sees the visitor by name and can WhatsApp them") | ✅ |
| Flatmate seeker post can be taken down ("Mark filled"/"Delete") to relieve the live-post cap, soft-archived via `DELETE /flatmates/posts/{id}` (D71) | flatmates | consumer/flatmates/guardrails | ✅ |
| Flatmate posts, rooms and groups start at `mod_status = pending` and are invisible to everyone but their author until a moderator approves; the author's banner says "in review" instead of "live", and public feeds filter on a whitelist so a new state fails closed (D72) | flatmates | consumer/flatmates/moderate-before-public | ✅ |
| All three interest doors (seeker post, room, group) go through the seam rather than a local flag, so the ask reaches the provider and is visible to the host (D181) | flatmates | consumer/flatmates/interest-api ("a first room enquiry reaches the provider and the card flips to sent") | ✅ |
| A repeat ask is the API's benign `already_interested` 409 and reads as information, never a red "something went wrong" — asserted on the toast's own variant class, because the words are what a future edit changes (D175, D181) | flatmates | consumer/flatmates/interest-api ("the same seeker on a second device is told the owner already holds the enquiry, not that a thread is waiting") | ✅ |
| That benign 409 also leaves the *device* where the success path would: the bell entry and the Messages hand-off are written on both paths, so a second device's "Interest sent" card is no longer sitting over an empty inbox (D183). The inbox assertion goes through the **Requests** tab — a fresh ask is `state: 'pending'`, and `Messages.inTab` keeps Chats for threads the other side has answered | flatmates | consumer/flatmates/interest-api ("a second device that never made the enquiry still ends up holding the thread behind its sent card", "a second device that never made the join request still ends up holding the thread") | ✅ |
| …and it is idempotent on `propertyId`, checked against both the hand-off queue and the conversations it is drained into, so the device that *did* ask never grows a second thread (D183). Both places are load-bearing: `lib/chat.js` *removes* `pnPendingRequests` the first time Messages mounts, so a queue-only guard would duplicate for anyone who had already opened their inbox | flatmates | consumer/flatmates/interest-api ("a repeat enquiry does not give the device that made it a second thread") | ✅ |
| `group_full` is a *different* 409 on the same door and gets its own refusal message + error tone; the client no longer pre-checks seats, so a group that fills while the board is on screen is answered rather than mis-labelled (D181) | flatmates | consumer/flatmates/interest-api ("a group that fills while the board is on screen answers group_full, not already-asked") | ✅ |
| That refusal also *corrects* the stale board it came from, so the card returns as Full rather than re-offering a Join button that can only be refused again (D181) | flatmates | consumer/flatmates/interest-api ("a group that fills while the board is on screen answers group_full, not already-asked") | ✅ |
| When both conflicts are true at once, seats are answered before duplicates — "you already asked" would imply a seat is still waiting on the host (D181) | flatmates | consumer/flatmates/interest-api ("a seeker who already asked is told the group is full, not that they already asked") | ✅ |
| An ordinary (non-409) failure rolls the optimistic flip back, so the card never claims a done-state for an ask that did not happen (D181) | flatmates | consumer/flatmates/interest-api ("an ordinary failure rolls the card back instead of leaving it claiming success") | ✅ |
| The done-state still survives a reload — the page remembers its own asks — but that memory never short-circuits the call, which is what made the 409s unreachable before (D181) | flatmates | consumer/flatmates/prefreeze ("the group done-state survives a reload (dedupe is persisted)"), consumer/flatmates/interest-api | ✅ |
| That memory is per-signed-in-user, so the next person on a shared browser neither sees the previous one's asks nor is left with no button to press (D181) | flatmates | consumer/flatmates/interest-api ("the next person to sign in on a shared browser does not inherit the first one's asks") | ✅ |
| `/plans` | plans-billing-refer | plans-billing-checkout | ✅ |
| `/checkout` | plans-billing-refer | plans-billing-checkout | ✅ |
| `/refer` | plans-billing-refer | refer, referral-rewards | ✅ |
| `/tenant-profile` | rent-tenancy | tenant-profile | ✅ |
| `/pay-rent` + tenancy | rent-tenancy | pay-rent, my-rental, consumer/account/tenant-finances | ✅ |
| `/schedule-visit` | schedule-visit | scheduled-visits | ✅ |
| `/societies` `/society/:slug` | societies | consumer/society/community(-v2), consumer/society/location, consumer/society/tabs, consumer/society/select, consumer/society/onboarding-p2, consumer/society/rera-catalogue, community-locality | ✅ |
| A `/society/:slug` in the RERA catalogue renders *that row's* real name, locality and specifications — the assertion that catches a silently-empty catalogue, because a fabricated page produces plausible values but never the right ones (D129) | societies | consumer/society/rera-catalogue ("a RERA society hub renders that row's real name, locality and specifications") | ✅ |
| A slug that is **not** in the catalogue renders an honest placeholder — no invented specs, no "Society Verified" badge, no community-estimate rating | societies | consumer/society/rera-catalogue ("an unknown slug renders an honest placeholder, not a confident society") | ✅ |
| Society reviews are keyed on the **slug** everywhere, so the directory card, the property-page society block and the hub agree on the same review bucket | societies | consumer/society/rera-catalogue ("the societies directory card reports reviews written against the society", "the property page society block reports reviews written against that society", "a review posted on the hub shows up on that society's directory card") | ✅ |
| A society with **no** reviews says so on its directory card and invents no number to say it with — no zero, no placeholder average, no parenthesised count. The guard against the D101 class of defect, where a fabricated value renders as a confident claim about a building nobody rated | societies | consumer/society/rera-catalogue ("a society with no reviews says so, and invents no number to say it with") | ✅ |
| The **property page's** society block says "Not rated yet" for an unreviewed society rather than drawing a hard-coded 4.2 star strip, and reads its aggregate from the review seam rather than a localStorage bucket a live session never writes (D195) | societies | consumer/society/rera-catalogue ("the property page society block invents no rating for a society nobody has reviewed") | ✅ |
| The societies directory rating **against the live API** — the card reports the `avgRating`/`reviewCount` the server aggregated in grouped SQL on `GET /societies`, not a reduction of the browser's own store (which a live session never writes, so the old path rendered every society unrated). The fixture is minted by the spec through the review composer, but only when the server's count is still 0, because `ReviewService` allows one review per author per target; the assertion is on the server's re-read, so a green tick cannot mean "the catalogue was empty and the card correctly said nothing" | societies | live-society-rating (`--config=playwright.live.config.js`) | ✅ |
| When the live rating read **fails**, the directory card says the rating is unavailable rather than claiming the society is unrated — a failed request and a building nobody reviewed are different facts and must not render as the same one | societies | live-society-rating (`--config=playwright.live.config.js`) | ✅ |
| The society review composer collects the **five aspects the hub draws bars for** — Safety, Maintenance, Management, Amenities, Connectivity — and none of the property vocabulary. The ids are stored keys shared by the composer, the bars and the server's `ReviewCategories.SOCIETY_KEYS`; a rename in any one of them orphans every rating written under the old id | societies | consumer/society/review-aspects ("the society composer offers the five aspects the hub draws bars for, and no others") | ✅ |
| Rating two aspects draws **exactly** those two bars, at the values rated, and no bar at all for the three skipped ones. Presence was what the defect already satisfied — every bar rendered a plausible number that was `baselineBars` alone, because the composer sent no categories and the server's vocabulary was the property one for every target — so this assertion could only become a presence one once D197 deleted the baseline. `toEqual` on the whole bar map is what catches an unrated aspect being folded in as a 0 | societies | consumer/society/review-aspects ("rating two aspects draws exactly those two bars, at the values rated") | ✅ |
| A review with **no** aspects rated draws no bars at all: aspects are optional, the review still counts toward the headline (asserted via `5/5`, so "no bars" cannot pass for a page that never updated), and a grid it contributed nothing to must stay empty. "Average over everyone" and "average over everyone who answered *this*" look identical until somebody skips a row (D197) | societies | consumer/society/review-aspects ("a review with no aspects rated draws no bars at all") | ✅ |
| Per-aspect society ratings **against the live API** — `categoryAverages` comes back keyed on the society vocabulary only (a property key surviving into a society's aggregate is the defect this replaced), and, when the spec wrote the fixture itself, the two rated aspects carry their values while the three skipped ones are **absent rather than 0**. The same two facts are then read off the **rendered** `society-bar-*` cells, because an API-only assertion cannot catch a client mapper: `http/reviewMapper.js` filtered `categoryAverages` through the property vocabulary for every target, so a correct payload still arrived at the page as `{}` — invisible while `baselineBars` drew five plausible bars over the hole, and invisible to the suite because the mock provider is target-aware (D197) | societies | live-society-rating (`--config=playwright.live.config.js`) | ✅ |
| `/locality/:slug` | societies | consumer/search/locality-intel, consumer/search/locality-select, community-locality | ✅ |
| `/reels` | (consumer/property/detail) | reels | ✅ |
| City switcher: propagation, coming-soon waitlist, cancel = no-op, admin offline revert | — | platform/city-propagation | ✅ |
| `/messages` — a thread is `staged` or it is not (D52); a staged one shows the waiting line, not a composer, and an owner-side thread with an unread message opens ready to reply with **no** accept/decline panel (that negotiation belongs to the contact gate, one layer up) | contact-gate-leads | messages-inbox, mobile/live-inbox-saved | ✅ |
| `/flatmates` | flatmates | `consumer/flatmates/**` (30 specs), consumer/home/flatmates-rail | ✅ |
| Legal pages (privacy/terms/refund/disclaimer) | — | platform/live-legal-pages (`--config=playwright.live.config.js`), platform/live-verification-disclaimer (`--config=playwright.live.config.js`) | ✅ |
| `/list-property` wizard | list-property-wizard | `consumer/list-property/**` (18 specs), mobile/live-wizard-sticky | ✅ |
| **The wizard writes through the property seam** (D219) — the payload handed to the provider carries a unit-bearing `address` line (the flat number ahead of the society, because a building-level AddressKey flags a whole tower and helps nobody), and the four fields whose names differ between the record and the contract survive the crossing: `electricityConsumerNo`, a numeric `floor` that is neither NaN nor a fabricated 0, `reraId` (the record calls it `rera`), and one `maintenance` folded out of the wizard's deal-split pair. A name mismatch on a write does not fail — it drops the value in silence, and the meter is the strongest duplicate signal the server has | list-property-wizard | consumer/list-property/seam-write | ✅ |
| **The wizard reaches `POST /me/listings` against the live API** (D219) — the server's duplicate probe runs inside that request, so before this slice the detector was reachable only from admin post-on-behalf while the abuse it exists to catch arrives through this form. Mock-mode specs cannot see the difference (the mock provider writes to the same localStorage the old code wrote to), so only the wire distinguishes "saved" from "posted": 201 with a server-minted id, and the row coming back from `GET /me/listings`. Runs as a freshly minted account, never the seeded owner whose exact listing count another test asserts | list-property-wizard | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| Editing a live listing tells the owner **which** of the two re-review outcomes they are buying: a BHK edit says "comes off search", a price edit says "stays live and searchable" and must not show the off-search copy. The pair is the assertion — the banner previously said "off search" for both, which is a broken promise when the listing quietly went dark and a deterrent against honest price cuts when it did not (Q14, D76). The classification itself is pinned separately, without a browser, by `frontend/scripts/check-listing-foundation.mjs` | list-property-wizard | consumer/list-property/edit-policy (`a Tier-A edit surfaces the re-check summary + status timeline`, `a price edit is re-checked but the banner promises the listing stays live`) | ✅ |
| `/dashboard` hub | consumer/account/owner-hub | dashboard, consumer/account/action-center, consumer/account/doc-info, consumer/account/owner-finances, mobile/live-dashboard-hub | ✅ |
| `/dashboard#documents` vault **through the `document` seam** — owner upload / list / delete round-trip on the mock provider, asserting the async flip did not break the demo surface (D124) | consumer/account/owner-hub | consumer/account/documents-vault | ✅ |
| `/dashboard#enquiries` document-request inbox **through the `document` seam** — owner sees a buyer's pending request and grants it from the Leads inbox; the read and the grant route through `documentService` (not localStorage), so the dashboard shares the Documents tab's source of truth and a grant reaches the server in http mode (D125 item 2) | consumer/account/owner-hub | consumer/account/doc-requests-grant | ✅ |
| `/dashboard#enquiries` shows **Serious Buyer** on a pending owner contact request from the row's own `requester.verified` bit, before approval and without asking rentService to infer it from a masked mobile (D185) | consumer/account/owner-hub | consumer/account/contact-request-verified-badge | ✅ |
| `/dashboard#enquiries` flatmate host inbox reads the `ownerId` bucket, not a mobile-derived one, so a request filed for the signed-in host is visible even when the old mobile-keyed store would have split it (D186) | consumer/account/owner-hub | consumer/flatmates/owner-id-inbox | ✅ |
| **Starting DigiLocker verification grants no badge** — the modal's two entry points open, `POST /me/verification/aadhaar` answers **202 with a hosted consent URL**, the browser is handed to it, and a fresh read of the profile is still unverified. A client that could talk itself into a trust badge is a security defect, and this is what would notice. Moving this spec live **changed its subject**: on mocks it asserted only the happy path (D21 — modal → DigiLocker mock → the green pill renders), because the mock grants the badge inline | trust-and-verification | platform/auth/live-verify-funnel (`--config=playwright.live.config.js`) | ✅ |
| The **rendered** "ID verified" pill on `/dashboard?tab=profile` once the badge is granted, and both funnel CTAs retiring together (D21). The grant is driven through `POST /me/verification/aadhaar/simulate` — the `@DevOnly` endpoint built for this in D122 — which runs the production `handleWebhook` path, so this stands on a real grant rather than a faked one. Paired with the row above on purpose: "starting grants nothing" would pass just as happily against a badge feature that never worked at all | trust-and-verification | platform/auth/live-verify-funnel (`--config=playwright.live.config.js`) | ✅ |
| `/owner-hub` + `/owner-hub/property/:id` passport | consumer/account/owner-hub | owner-hub, consumer/property/passport | ✅ |
| `/view-documents` secure viewer | consumer/account/owner-hub | view-documents-flow, doc-viewer-scheme | ✅ |
| **Deals / Offers / Negotiation / Finalization** — incl. a declined finalize request surfacing "the owner hasn't confirmed — ask again" now the status read returns terminal rows, not pending only (D111) | deals-offers-finalization | deals-offers | ✅ |
| **Buyer deal visibility on the property page** — a buyer on a *closed* listing sees the terminal "no longer available / rented out" banner and the offer + finalize cards are hidden; a *reserved* listing shows the "Under Offer" banner but keeps the offer UI (still queueable); an untouched listing shows no banner and the normal negotiate card. Reads the property's public `dealStatus` mirror, not the owner-scoped deal (D110) | deals-offers-finalization | consumer/property/deal-visibility | ✅ |
| Language switching + hi/mr locale integrity | — | platform/live-i18n (`--config=playwright.live.config.js`, chromium + mobile), platform/live-settings-preferences (`--config=playwright.live.config.js`) | ✅ |
| Dashboard ▸ Profile & Settings **behind a real session** — notification channels, reduce motion, the delete-account confirmation gate, the owner phone-privacy switch, and the app language. These preferences stay in localStorage after the mock retires (`pnNotifPrefs:`, `pnOwnerPrefs:`, `pnLang` are device settings with no provider in front of them), so what the conversion changes is that the *person* is real: a preference keyed by mobile only means anything if the mobile belongs to an account the server agrees exists. The owner card is the sharper case — `isOwner` is derived from real inventory, so the seeded version had to hand itself a fabricated listing to make the card appear at all, where Meera's four make it render for the same reason it renders in production | — | platform/live-settings-preferences (`--config=playwright.live.config.js`) | ✅ |
| **Redirects** (`/map`, `/docs`, `/help-center`, `/share-flat`, `/owner-hub`, `/admin/support`) + the 404 catch-all | — | platform/live-route-redirects-404 (`--config=playwright.live.config.js`) | ✅ |

## Mobile chrome & ergonomics

Mobile-only behaviour has no desktop equivalent to piggy-back on, so it gets its own
table rather than a column in the route matrix above.

| Behaviour | Spec(s) | Status |
|---|---|---|
| Bottom tab bar: mount, destinations, raised Post slot | mobile/live-bottom-nav | ✅ |
| Bottom inset reservation (`.has-bottom-nav` / `--pn-bottom-inset`) | mobile/live-bottom-inset | ✅ |
| Safe-area insets, `theme-color`, manifest link | mobile/live-safe-area | ✅ |
| PWA manifest + icon set | mobile/live-pwa | ✅ |
| Home-screen install nudge: engagement gate, escalating silence, platform split | mobile/live-install-prompt | ✅ |
| Chrome policy per route (`lib/chrome.js`) — footer/bottom-nav/assistant | mobile/live-bottom-nav, mobile/live-inbox-saved, platform/live-feature-flags (`--config=playwright.live.config.js`) | ✅ |
| **Consumer feature flags are honoured end to end against the server** — 10 switches (`mapSearch`, `compareProperties`, `scheduleVisit`, `emiCalculator`, `reviewsEnabled`, `videoListings`, `inAppMessaging`, `savedListings`, `onlineRentPayment`) each asserted both ways, plus the four route guards that must turn a disabled feature's URL away rather than merely hiding its link. The flag is written through `PUT /admin/settings` — the only writer — and read through whatever the browser makes of the public `GET /flags`, so nothing in the test touches what the page reads. That separation is the subject: before `GET /flags` existed the admin console wrote to the API while the browser read an unrelated copy from localStorage, maintenance mode reported success and served the site, and the seeded version of this spec passed throughout because it was writing to the same place the client read from | platform/live-feature-flags (`--config=playwright.live.config.js`) | ✅ |
| **The product survives losing every feature** — the listings and property pages still render with all 26 consumer flags off and zero `pageerror`s. The seeded ancestors of these two tests read `puneNestDB_v1`, a store key three versions stale; `JSON.parse(null)` returned null, the guard returned silently, and both spent their lives asserting that a page with **all flags enabled** renders cleanly, under a name claiming the opposite (`maintenanceMode` is excluded on purpose — switching it on blanks the app, so an all-off smoke test would assert the maintenance screen rather than the product) | platform/live-feature-flags (`--config=playwright.live.config.js`) | ✅ |
| **No mobile chrome leaks onto desktop** | platform/live-desktop-noleak-guardrails (`--config=playwright.live.config.js`) | ✅ |
| **The application actually boots** — four routes (`/`, `/listings`, `/dashboard` as owner, `/admin` as admin) render a non-empty body with zero `pageerror`s. This exists because `npm run check`, `npm run lint` and `npm run check:size` were all green on 2026-08-11 while the app served an empty `<body>` on every route: a Vite build resolves an import cycle happily and only a browser executes it, so no static gate can see the failure (D208) | platform/live-boot-canary (`--config=playwright.live.config.js`) | ✅ |
| 44px tap-target sweep across consumer routes | mobile/live-tap-targets | ✅ |
| 44px sweep behind a session (`/dashboard`, `/messages`) and on staff surfaces (`/admin`, `/ops`) | mobile/live-tap-targets | ✅ |
| The sweep cannot pass vacuously: it waits on `appReady()` rather than `networkidle`, refuses to report a pass on fewer than `MIN_CANDIDATES` interactive elements, follows the client-side navigation with `waitForURL` before measuring the property page, skips `pointer-events: none` subtrees (closed off-canvas drawers) and measures `::before`/`::after` hit areas rather than trusting the `.tap-extend` class name | mobile/live-tap-targets | ✅ |
| 12px computed-font-size floor across 14 routes, signed-out, signed-in and admin | mobile/live-text-legibility | ✅ |
| Pull-to-refresh: coarse-pointer gate, past/short-of threshold, sideways-drag carve-out, `data-no-ptr` opt-out, scrolled-away-from-top | mobile/live-pull-to-refresh | ✅ |
| Service-landing hero is a responsive `<img>` with `srcset`/`sizes`/`fetchpriority` (3 landings) | consumer/services/hero-image | ✅ |
| Sliders, carousel dots, admin header icons (the controls the sweep missed) | mobile/live-touch-targets-p3 | ✅ |
| Property gallery dot rail ≥ 24px (shipped at 22 despite its own comment) | mobile/live-touch-targets-p3 | ✅ |
| Native share: cancelling the OS sheet is not an error | mobile/live-native-affordances | ✅ |
| Haptics: fires on save, suppressed by app **and** OS reduce-motion | mobile/live-native-affordances | ✅ |
| Toolbar controls stay on screen (`/societies`) | mobile/live-content-budget | ✅ |
| Trust-badge legibility floor (`/flatmates` VERIFIED) | mobile/live-content-budget | ✅ |
| Home tap targets + touch affordances | mobile/live-home-taps | ✅ |
| Home: featured before the fold, proof chips | mobile/live-home-featured-first | ✅ |
| Home Flatmates tile: trust features on one line, CTAs full-width, no h-overflow | mobile/live-home-flatmates-tile | ✅ |
| Sheets, swipe-to-dismiss, sticky actions | mobile/live-sheets-and-actions | ✅ |
| Sticky wizard footer on `/list-property` | mobile/live-wizard-sticky | ✅ |
| Sticky contact bar on `/property/:id` | mobile/live-property-contact | ✅ |
| **Content budget: primary content is reachable, not buried under chrome** | mobile/live-content-budget | ✅ |
| Assistant coach-mark: never covers the price, budgeted to 2 sightings | mobile/live-content-budget | ✅ |
| Top-bar scroll behaviour | mobile/live-topbar-scroll | ✅ |
| Context-aware navbar left slot / account pill | mobile/live-navbar-context | ✅ |
| Signed-in phone top bar holds 6 visible targets at 360px, not 7 — Compare moves to the account drawer below `lg` and `/compare` stays reachable there (D98b) | mobile/live-navbar-context ("sheds Compare to the account drawer") | ✅ |
| On-screen keyboard handling in auth | mobile/live-auth-keyboard | ✅ |
| Landscape orientation | mobile/live-landscape | ✅ |
| Space/density optimisation | mobile/live-space-optimization | ✅ |
| Ops console on a field phone | mobile/live-ops-field | ✅ |
| Dashboard hub navigation on a phone | mobile/live-dashboard-hub | ✅ |
| Phase-3 sweep | mobile/live-phase3 | ✅ |
| **Date/time pickers dock as bottom sheets below 640px** | mobile/live-date-time-fields | ✅ |

## Shared UI components

Components used across many routes get their own row rather than being implied by
whichever route happens to render them — that is exactly how the picker
stylesheet bug below survived a 178-file suite.

| Component | Spec(s) | Status |
|---|---|---|
| `DateField` / `TimeField` + their dialogs — styled, layered overlay on **every** route | platform/live-date-time-fields (desktop, `--config=playwright.live.config.js`), mobile/live-date-time-fields (sheet) | ✅ |
| `DualRange` manual entry — Cr/L/K parsing, junk input, Escape, bound ordering | consumer/search/dual-range-parsing, consumer/search/filter-slider-manual-entry | ✅ |
| `ConnectivityBanner` + `useConnectivity` + `LoadError` — **offline vs unreachable**: `setOffline(true)` raises the confident "You're offline" and coming back announces recovery then clears; a `page.route` abort while `navigator.onLine` stays **true** raises only the hedged "Can't reach the server"; a 500 answers so **no** banner is painted; a failed load offers a Retry instead of an empty state and the retry succeeds once the route is un-aborted; the live region is mounted while empty and announcing does not move focus (D165) | consumer/connectivity | ✅ |
| Paid placement (D59) — a boost ranks first in the default order, is labelled `Promoted`, and is **not** pinned over an explicit price sort | consumer/search/boost-ranking | ✅ |
| `ArticleFeedback` — positive/negative branches, persistence, per-article reset | platform/help/live-article-feedback (`--config=playwright.live.config.js`) | ✅ |


## Admin

| Route / Feature | Flow doc | Spec(s) | Status |
|---|---|---|---|
| `/admin` dashboard + RBAC nav | (all) | admin/consolidation, admin/live-rbac | ✅ |
| **The live suite runs against its own persistent database, `punenest_e2e`** — not `punenest` (a run would wipe dev work) and not `punenest_test` (the Java suite asserts that one is empty). Rows **commit and survive a backend restart**, which is the point: a user registered by a spec is still there after the JVM is killed, proven directly (`9700009911` → `a768c4d0-…`, identical id across a restart). Drift is controlled by resetting to baseline at **run start** rather than teardown — a teardown only runs if the run reaches it, and it destroys the evidence in exactly the crash case you wanted it. `global-setup.live.js` truncates every table it discovers from `pg_tables` except `flyway_schema_history` (discovered, not hand-listed: a stale list fails silently) and re-applies the three seeds in Flyway order. Idempotent — consecutive runs both settle at 81 users / 38 properties | — | e2e/global-setup.live.js, e2e/scripts/reset-e2e-db.sql (`--config=playwright.live.config.js`) | ✅ |
| **Live sign-in is a real OTP round trip, not a log scrape** — the `e2e` profile pins the code so specs stop reading it out of the backend log, but issuance, hashing and `otp_codes` are untouched, so the flow is genuine and still fails the way it should. Proven in four steps: replaying a used code → 401 *"No active OTP"*, a fresh request → 200 `otpSent`, a wrong code → 401 *"Incorrect OTP"*, the fixed code → 200 authenticated. Three independent guards keep it out of production — the property defaults empty, `application-prod.properties` pins it empty, and `@PostConstruct` refuses to start the context if a non-empty code survives into a production profile | — | e2e/helpers/liveAuth.js, backend `OtpService` (`--config=playwright.live.config.js`) | ✅ |
| **Restoring an archived staff account whose email address has since been re-used is refused, and the refusal is not cosmetic** — a guard that answers 409 and restores anyway is the original defect wearing an error message, and it would pass every other assertion. Asserted through `GET /users?archived=true`, deliberately: `UserResponse` carries **no `archived` field**, and `archive()` never touches the separate `status` column, so an archived user reports `status: "active"` over the wire (**D216**) — the earlier version of this spec asserted on `status` and was therefore asserting on that bug. Also covers: an address with no live claimant still restores, and staff login for the contested address answers **401, not 500** — D206 removed the password parameter so no credential can succeed, but 401-vs-500 still separates "resolved to one row and rejected" from "matched two rows again" | — | admin/live-user-restore-email-collision (`--config=playwright.live.config.js`) | ✅ |
| `/admin/properties` verification queue | property-verification | admin/properties, admin/duplicates | ✅ |
| `/admin/properties` **re-check queue** — the stays-live half of Q14: which fields changed, how long the listing has been live-but-unreviewed, and the pass/reject actions that drain it | property-verification | admin/property-recheck-queue | ✅ |
| `/admin/properties` **against the live API** — the moderation queue and its decisions | property-verification | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| `/notifications` **against the live API** — inbox read, seed suppression, mark-all-read, dismiss (`DELETE /notifications/{id}` round-trip, D93) | saved-alerts | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| `/messages` **against the live API** — inbox read, seed suppression, thread hydration on open, author attribution, reply round trip | contact-gate-leads | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| `/locality/:slug` reviews **against the live API** — slug-keyed read, no fabricated standing badge | trust-and-verification | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| `/property/:id` reviews **against the live API** — a different controller from the locality one, and the reason `listPropertyReviews` shipped pointing at `/reviews/property/{id}` (not a route; `entityType` is `society\|locality\|owner`) and 404'd on every live read while the page's catch rendered "no reviews yet". Both reads are asserted to arrive at `GET /properties/{uuid}/reviews` and `.../reviews/summary` with a 200, navigating by the **slug** so a page reusing its URL token would 404; the rendered average, review count, five star buckets and sparse per-aspect rows are compared against the *summary* payload rather than a tally of the cards, and the card text against the *list* payload. The fixture — a completed visit, so the server grants `context: 'visit'` — is minted by the spec, since the seeded database has no property reviews at all | trust-and-verification | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| `/support` **against the live API** — list, raise, reply, and the absence of the priority/attachment controls | cross-cutting | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| **Abuse reports against the live API** — file from a property page, duplicate refused, report reaches the staff-only ops queue, no Reopen on a decided report | trust-and-verification | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| **The contact gate against the live API** — a signed-out visitor on a public listing queries it not at all | contact-gate-leads | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| **Saved shortlist against the live API** — `/me/saved` provenance, `PageEnvelope.page` on the wire, heart round trip | saved-alerts | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| **Saved searches against the live API** — `/me/saved-searches` is the source, and answers with a bare array not an envelope | saved-alerts | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| **Visits against the live API** — both sides of the relationship read separately, and reschedule moves the slot in place via `PATCH /visits/{id}/slot` (D87) | contact-gate-leads | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| **Subscription plans against the live API** — `/plans` serves the pricing page for a signed-out visitor, and buying a priced plan leaves it `pending` with the entitlement it gates still shut | plans-billing-refer | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| **Deals, offers and finalization against the live API** — the owner's deal book is one `/me/deals` read not one per card, a signed-out visitor asks the deal API nothing, and a buyer reads `/offers/mine` but is never offered the owner-only Accept | deals-offers-finalization | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| **Rent, tenancies and finances against the live API** — Pay Rent asks the rent API nothing when signed out and is served by `/me/tenancies` + `/me/payout-account` when signed in; the owner Finances tab reads summary, cashflow and dues from the server rather than reducing the page it holds | rent-tenancy | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| **The flatmates board against the live API** — all three feeds are served publicly to a signed-out visitor and the board is not empty; a posted room is **absent** from the public feed until a moderator approves it and readable back off that feed with its price intact once they have (V41/D72); the filter bar narrows the board server-side across every facet (gender/food/roomType/furnishing/bhk/budget, policy, flatPref/roomPref), with `any`-valued preference facets falling back to a wildcard so a flexible post still surfaces | flatmates | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| **Service requests against the live API** — the tracker reads `/service-requests` (not the mock store), a request created through the service round-trips with a `submitted` status, structured `details` read back off the DTO (D119), an empty `docs`/`draft`, a `user`-authored reply read back off the thread, and no mock-only fields; the co-fill party list has no endpoint and returns `[]` (D119–D121) | cross-cutting | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| **The Aadhaar badge against the live API** — the badge is read from `GET /me/verification/aadhaar` (not a mock store) and the seeded contact-gate flag does not grant it; a `start` returns a **pending** DigiLocker consent handle (`ref`, `verificationUrl`), never a granted badge, the next read reports `pending`, and no growth perk is fabricated; the **dev-only** `POST /me/verification/aadhaar/simulate` (non-prod `@Profile("!prod")`) then finishes the badge where no real webhook lands, so the earned-badge state is demonstrable in http/dev (D122) | trust-and-verification | live-property-integration (`--config=playwright.live.config.js`), backend `VerificationEndpointsTest` | ✅ |
| **The document vault against the live API** — the owner's `#documents` tab uploads through `POST /me/documents/{propId}` and deletes through `DELETE /me/documents/{propId}/{docId}` on a seeded, owned listing, proving the vault reads and writes the real endpoints rather than localStorage (D124) | consumer/account/owner-hub | live-property-integration (`--config=playwright.live.config.js`) | ✅ |
| **The published fee schedule against the live API** — the rent-agreement sidebar shows the seeded `platform_fees('rent')` service fee and GST, so the figure on screen and the figure the server bills are the same number by construction rather than by coincidence (D9, D150). The second half is the one that matters: `stamp_duty` and `registration` are **NULL by design** for that row (V52 — Art. 36A duty is a percentage of a per-agreement consideration, which one column cannot hold), so the total is labelled an *estimate*, and the spec fails if someone backfills them with a flat figure and turns a statutory estimate into a quoted price | services/rent-agreement | live-fees-and-photos (`--config=playwright.live.config.js`) | ✅ |
| **Listing photo upload against the live API** — the create-listing wizard posts multipart to `POST /me/photos`, and the returned URL is asserted **not** to be a `data:` URL, which is the only thing separating a real upload from mock mode's `FileReader` preview (that one always renders, so no mock spec can see a broken uploader). The object is then fetched back and compared byte-for-byte, and the gallery is asserted to render the server's URL rather than a local copy kept beside it. Runs with `STORAGE_ENABLED=false`, so `MockFileStorage`/`DevObjectStore` serve it — deliberately, so a routine e2e run does not depend on a vendor account; the R2 half is proven directly by `R2FileStorageLiveTest`, `MePhotosLiveTest` and `MePersonalDocumentsLiveTest` | list-property | live-fees-and-photos (`--config=playwright.live.config.js`) | ✅ |
| **`/staff-login` against the live API** — the screen used to read the team registry out of `lib/mockApi.js`, fabricate a user from a **browser-chosen** role and team, and sign it in without the OTP ever being checked against anything. Live it exchanges the code at `POST /auth/login` and takes role and team off the response, so the console a staffer lands on is a fact about their account rather than a radio button; an account that is neither `admin` nor `staff` is signed back out rather than merely not redirected. The picker and the demo shortcuts are gated to mock mode rather than disabled — a control that visibly does nothing is a worse lie than no control. (`POST /auth/staff-login` is email+password and cannot serve this screen: D206 removed the password from staff creation, so staff are passwordless until an emailed invite is redeemed) | (all back-office) | ops/live-drafting-desk (`--config=playwright.live.config.js`) | ✅ |
| `/admin/analytics` | analytics | admin/analytics | ✅ |
| `/admin/users` + KYC | users-kyc | admin/live-users (masked directory, server-side status filter, search, flag needs a reason, flag survives a reload, Aadhaar badge not withdrawable, real timeline, suspend ends sessions, staff refused) | ✅ |
| **Restoring an archived user cannot collide with a live account's email** — archive is a soft delete, so an address freed by archiving can be taken by a new account; restoring the first then produced two live rows and a 500 on sign-in for *both* people. Asserts the 409, that it names the address, that a case variant still collides, that a non-colliding restore still works, and that two **archived** rows may share an address (the index is deliberately partial). API-level rather than UI-level because `AdminUsers.jsx` still restores through `mockApi.restoreRecord`, a localStorage write — `user` is not in `VITE_API_DOMAINS`, so the improved message is not yet reachable from an operator's screen (D209) | users-kyc | admin/live-user-restore-email-collision (`--config=playwright.live.config.js`) | ✅ |
| `/admin/finance` | finance | admin/finance | ✅ |
| **Structural zeros on `/admin/finance` disclose themselves** — `payoutsCompleted` and `refunds` can never be non-zero (no payout or refund path exists) and service orders are excluded from revenue, so the screen names all three rather than presenting four figures the reader would trust equally. Asserts the default disclosure, that the marked rows keep their figures, that turning every flag on removes the disclosure without a code change, that flipping one leaves the other two standing, and that an absent flag is read as *not measured* (D63, D65) | finance | admin/finance-disclosure | ✅ |
| `/admin/finance` | finance | admin/finance | ✅ |
| **`/admin/reports` against the live API** — the queue reads `GET /reports`, so the reason a moderator sees is the code the reporter's own modal sent, resolved through the vocabulary that belongs to *that target type* (a `spam` complaint about a person is not "duplicate listing"). Covers: the seeded queue and per-target rows, the five KPI tiles agreeing with each other and with the rows on screen, the tab-scoped reason filter (which previously offered two codes the server recognises for nothing and omitted nine it does, `broker` among them), an inapplicable reason being derived away on a tab change, the `3x` escalation badge firing at three and **not** at two, the reporter shown as **Withheld** and never "Anonymous" (`ReportResponse` omits `reporterId` on purpose), `Decided` on a terminal row where the mock spec expected a Reopen the page cannot render, checkboxes on `open` only while triage buttons also admit `reviewing`, the `?open=<uuid>` deep link, and **a real triage** — a report filed over the API, dismissed from the drawer, and re-read from the server. Also covers the **flatmate posts tab**, which this file's tile arithmetic is what forced into existence: `targetType: 'post'` reports were being filed and stored correctly and rendered in no tab at all, because the queue split rows two ways over a wire that has always carried three. Replaces the two retired mock specs for this screen (55 tests, 17 of them guarded or ending in `expect(true).toBeTruthy()`) | trust-safety-reports | admin/live-reports (`--config=playwright.live.config.js`) | ✅ |
| `/admin/team` | settings-team-staff | admin/live-team-access (directory, maker-checker queue, no hard delete, Manager not creatable, permission grid from the catalogue, narrow + restore), admin/live-rbac (server-side enforcement, the admin-only ceiling, unknown atoms) | ✅ |
| `/admin/post-on-behalf` | property-verification | admin/post-on-behalf(-fixes) | ✅ |
| `/admin/localities` + geo | content-localities-societies | admin/localities, admin/maps-geo | ✅ |
| `/admin/services` moderation (absorbs old `/admin/support`) | services-moderation | admin/services-moderation | ✅ |
| `/admin/enquiries` funnel | enquiries-funnel | admin/enquiries | ✅ |
| `/admin/content` CMS | content-localities-societies | admin/content | ✅ |
| `/admin/societies` | content-localities-societies | admin/societies | ✅ |
| `/admin/settings` | settings-team-staff | admin/settings, platform/live-settings-debug (`--config=playwright.live.config.js`) | ✅ |
| `/admin/flatmates` — **retired**; the route redirects to `/ops/flatmate-review`. The admin desk moderated seekers, groups and group applications out of `db.json`, could not see rooms at all, and had no view of the D72 publication axis, so the three queues it offered were a subset of the live desk's three read against a store nothing else wrote. What is left is the redirect and its two guards: an unauthenticated visitor is still sent to `/staff-login` rather than through to the ops desk, and a buyer is still refused. | flatmates | admin/flatmates, admin/flatmate-moderation-reach | ✅ |
| `/admin/staff-activity` | settings-team-staff | admin/live-staff-activity (`--config=playwright.live.config.js`) | ✅ |

## Ops

| Route / Feature | Flow doc | Spec(s) | Status |
|---|---|---|---|
| `/ops/flatmate-review` — the flatmate desk, live-only. The mock modelled **one third** of it: `lib/data/flatmates.js` knew host verification and nothing at all about the D72 publication axis or about group applications, so two of the three boards had never been exercised by a test. Converting it also meant building something, not just wiring: the group-applications board read a table nothing in the product could write to, so `POST /flatmates/groups/{id}/apply` plus an owner inbox (`GET`/`PATCH /me/group-applications`) and `GET /me/flatmate-groups` were added — four routes the OpenAPI contract does not name, an intentional extension recorded in `docs/flows/ops/flatmate-moderation.md` section 10. Two rulings are visible on screen: the host's mobile is **masked in the mapper** even though `FlatmateReviewDto` sends it in full (a desk that can ring a host can be talked into ringing one on somebody else's behalf), and the moderation axis offers no `rejected` because on that axis it means what `removed` means. Live coverage (5 tests): a tenant declaration reaches Verification and approving moves the **badge and not the post** (the two axes must not reach each other); a rejection without a reason is refused; a brand-new seeker post is born Pending and is absent from the public feed until Publish, which is the whole claim D72 makes; Remove takes a note and the free text is rendered untruncated (it is where a phone number goes when the contact field will not take one); and the group-applications board shows a **real** row for the first time. All five fixtures are minted through the consumer path, because the seed's five flatmate rows are all already `approved` | flatmate-moderation | ops/live-flatmate-moderation (`--config=playwright.live.config.js`), ops/flatmate-review (the consumer cues + the shut panel) | ✅ |
| A group applies for a whole flat — the loop the mock never had. `lib/groupApplications.js` seeded two rows into `localStorage` and offered an owner two buttons; nothing could create an application, so the board it fed could never have a row. The card on the listing page appears only for a signed-in visitor who hosts a live group with an open seat, on somebody else's **rental** listing (a sale price is whole consideration, so per-head would be wrong by orders of magnitude). The owner answers from the dashboard Action Center, writing `status` — an axis the ops desk deliberately cannot reach, since it writes `modStatus`. Server rules are pinned in `FlatmateApplicationEndpointsTest` (13 tests), including that a stranger's `PATCH` gets **404 not 403**, to avoid an existence oracle | flatmate-moderation | consumer/flatmates/live-group-apply (`--config=playwright.live.config.js`) | ✅ |
| `/ops` dashboard — its tiles and doughnut now count real tickets from `GET /tickets`, and it no longer restates the server's team scoping (it passed `role === 'admin' ? undefined : team`, a second copy of a decision `TicketService.list` already makes — D44). In mock mode it shows the reason it is shut rather than a wall of zeros, because "0 open" and "nobody looked" are different sentences | service-queues | ops/requests (the shut panel), mobile/live-ops-field | ✅ |
| `/ops/requests` — the ops ticket board, live-only. Converting it off `lib/mockApi.js` was not wiring: the mock knew **three** statuses where `TicketStatuses` knows five, assigned by typing a display **name** where `TicketUpdate` takes a user **id** (and 404s an id that is no ops user), and read-modify-wrote the whole `notes` array where the server has a dedicated append — so two colleagues saving a note in the same minute erased each other. D184's refusal of a translation table applies unchanged, hence no mock provider. Live coverage (7 tests): a ticket a customer raised reaches the desk that owns it; the tiles carry the server's words and **not** the mock's `New`/`Done`; a claim writes the caller's own id and the name comes back resolved by `TicketMapper`; **a claim does not also advance the ticket** (putting your name on something and declaring it underway are two decisions); a note appends and a second does not erase the first; a note survives a reload; and a rental staffer cannot see a legal ticket that provably exists. The suite mints its own tickets via the deliberately unguarded `POST /tickets` (S43) because the seed ships none | service-queues | ops/live-ops-board (`--config=playwright.live.config.js`), ops/requests (guard + the shut panel) | ✅ |
| The verification case file (D218), live-only. Three things the mock cannot hold, because in mock mode none of them exist. **(1)** A second listing on one electricity meter is published, not refused — sometimes it is a broker relisting somebody's flat and sometimes a genuine re-let, and refusing outright punishes the honest case to catch the dishonest one — but it files a staff-only note naming the incumbent listing. The note deliberately does **not** quote the meter number, and that is asserted: `review_messages.body` is free text sitting outside the `PrivateFieldVisibility` projection and outside the erasure classification, so a note carrying the value would route a guarded field around its own guard where no mapper test would look (D219 review). The owner asking for their own case file gets **404, not an empty thread**: an empty thread still tells them a file was opened on them. **(2)** The stays-live re-check note is now composed **server-side**; until D218 `PropertyReviewModal` typed it in the browser, so an edit through any other client produced silence and the note claimed "approved" whether or not the write had landed. **(3)** A **pending** listing is not told it stays live and gets no case file manufactured for it — `requestRecheck` refuses on anything not publicly visible, so the note had been narrating work nobody was doing. Fixtures are minted on the wire through `POST /me/listings` rather than through the wizard, which keeps the fixture independent of the UI even now that the wizard reaches the same endpoint (D219). Server rules are pinned in `ListingNoticesTest` (19 tests) | property | ops/live-verification-thread (`--config=playwright.live.config.js`) | ✅ |
| Who may **read** and who may **decide** a verification case (D219), live-only and deliberately a separate file from the thread spec above: a broken workflow is a bug report, a broken refusal is a disclosure, and a red line should say which just happened. Four tests. A signed-in stranger gets **404** on every thread route — read, post, mark-read and open — because a 403 would confirm that a listing with that id exists and is under review, which is the fact a competitor walking ids would probe for; the owner and the desk are asserted to get 200 on the same case first, so the refusals cannot be explained away as "the case was never created". The **bodies** of the two 404s are compared as well as the codes, since "no such listing" and "not yours" as distinguishable replies would restore the oracle the status code was chosen to remove. The staff-only routes answer **403** instead, and that is not an inconsistency: their guard is a role rather than a relationship, `@PreAuthorize` refuses before the id is ever looked up, so nothing about the row can leak through a method that was never entered. Last, the maker-checker rule, which is the only refusal here that is about neither: a staffer listing their own flat is a participant **and** holds `properties:write`, so every other guard passes and the listing would publish with nobody having read it — a second staffer decides the same case without complaint, which is what separates "the rule works" from "the route is broken" | property | ops/live-verification-access (`--config=playwright.live.config.js`) | ✅ |
| `/ops/rent-agreement`, `/ops/legal`, `/ops/interior`, `/ops/packers`, `/ops/valuation` — **retired**. Five routes, one `OpsServiceQueue` over `localStorage`, while the work had moved to Postgres: in live mode every one of them was blind. They now redirect to `/ops/drafting-desk?type=<team>` (kept rather than 404'd — they are in bookmarks, in `TEAM_HOME` and in the flow docs), and `ops/requests` asserts the redirect. `TeamRoute` went with them; dropping it widened nothing, because `ServiceDeskAuthority.deskFilterFor` scopes a staff caller server-side and ignores a `team` they do not own (D44) | service-queues | ops/requests (redirect + guard-is-gone), ops/live-drafting-desk (the desk picker that replaced the guard's UX role) | ✅ |
| `/ops/referrals` — the fraud queue, live-only. The mock disagreed with the server about what a referral **is**, three times over: a `flagged` status `ReferralStatuses` does not have, both mobiles in full where the server masks them, and an Approve that granted a device-local perk where the server pays rupees. Converting it also moved a **rule**: the Aadhaar check was a greyed-out button in the browser, under a banner calling it mandatory, while `POST /referrals/{id}/approve` released the money to anyone who called it directly. `ReferralService.approve` now refuses with a 409 naming the reason — reading the referee's **current** badge, not the referral's `updatable = false` redeem-time snapshot, because redeem-then-verify is the ordinary order. The mock's perk grant could not be ported at all (it looked the referrer up by a number that is no longer on the wire, for a reward the contract declines to model) and is recorded as intentionally dropped. Live coverage (5 tests): a redeemed referral reaches the desk with **both** numbers masked and the signals in their place; approving credits rupees the referrer can see on `GET /me/referrals`, which is the only proof the decision reached them; the Aadhaar refusal arrives from the endpoint when the test goes round the greyed-out button; a clawback leaves `clawed-back` and **not** `rejected` (the one distinction a fraud desk needs — whether money ever left the building); and **High risk** is a `risk` filter with no Flagged tab beside it. The suite mints its own referrals through the consumer path — `GET /me/referrals` for a code, `POST /referrals/redeem` — because the seed ships none | referrals-fraud | ops/live-referrals (`--config=playwright.live.config.js`), ops/referrals (guard + the shut panel) | ✅ |
| `/ops/support` — the admin support queue, live-only. The mock could state the queue but not the thing the queue is *for*: one store and one flag meant "the desk read it" and "the customer read it" were the same bit, so the two-sided read model (D50/V53) — the whole reason `staff_unread` exists as a second column — was unfalsifiable against it. Live, opening a ticket clears the desk's side and is asserted to leave the customer's alone, read back through the raiser's own `GET /support/tickets/{id}`. The conversion also found a 500: `SupportTicketMapper` dereferenced a **nullable** `author_id` three lines below code that filters nulls out of the name lookup, so one message whose author had gone took the entire thread down for the person who raised it | service-queues | ops/live-support-queue (`--config=playwright.live.config.js`), ops/support-queue (routing only) | ✅ |
| `/ops/drafting-desk` **in mock mode** — the route guard, and that with no live API the desk shows the offline panel rather than an empty table. D184 retired the mock provider's three desk operations (the desk filters on the server's nine-value status vocabulary, which the mock store cannot speak; a translation table was rejected), so the screen now gates on `isHttpDomain('serviceRequest')`. An empty queue and a queue it cannot filter render identically, and only one of them is true — hence the panel | service-queues | ops/drafting-desk | ✅ |
| `/ops/drafting-desk` **against the live API** — 8 tests, the desk that replaced the five retired ones. Covers: the queue with its server-side filters; **a staffer is offered their own desk and no other, whichever desk they ask for** (the picker that replaced `TeamRoute`'s user-visible role — an empty queue and a forbidden queue must not look alike, D44); **a matter names the paperwork it is waiting for** (the read-only D120 checklist — "*n* of *m* received" plus every item including the missing ones, which are the point; no viewer and no "Mark all verified", because the fold is derived on read and the only thing that moves an item is an upload); and the identity-disclosure design (D151/D173) — the queue carries no identity number or mobile, an unassigned request is refused the reveal in the server's own words, taking it unlocks the reveal and Hide puts it away, a disclosure does not survive closing the matter and never reaches the URL, and the summary shows named fields only, never the raw `details` object | service-queues | ops/live-drafting-desk (`--config=playwright.live.config.js`) | ✅ |

---

## Notes on recent migrations

**A lazy-loading defect in a specification-backed read is unreachable from the Java suite.**
`GET /admin/properties` shipped a `LazyInitializationException` on `owner` — the moderation queue
returned 500 for every caller — while `PropertyModerationQueueTest` stayed green. It is not that the
Java test was thin: it already covers status widening, `archived`, `recheck`, `q`, the 403 for a
seeker and the 401 for an anonymous caller. It is that `AbstractApiTest` is `@Transactional`, so the
persistence context stays open for the whole test method and a lazy proxy can always resolve. An
assertion on `content[0].owner.mobile` would pass with *and* without the fix, which is worse than no
test at all. Reproducing it needs a non-transactional test that commits users and properties, and
`punenest_test` is required to stay empty of domain data. So the guard is the live spec — the
moderation-queue test in `live-property-integration` — and the thing it protects is the join fetch in
`PropertySpecs.adminSearch`, which is written the awkward way (`root.fetch` guarded on
`!Long.class.equals(query.getResultType())`) because Spring Data issues a separate COUNT query where
a join fetch is invalid SQL. Any future `JpaSpecificationExecutor` read that renders an association
is in the same blind spot and belongs here rather than in the Java suite.

**The paid rent-agreement path is deliberately outside this suite.** E2E runs mock-mode, and the
mock service-request provider returns no `paymentSessionId`, so the checkout branch is unreachable
here by construction — a spec for it could only assert against a stub of our own making. The gate
lives in `ServiceRequestFlowTest.PaidGate` on the backend, which drives the real state machine: a
priced request is created at `awaiting-payment`, the ops queue does not show it, a signature-verified
webhook moves it to `new` (or cancels it on failure), redelivery is inert, an unrecognised `type` is
a 400 rather than a free desk, a second unpaid request for the same desk is a 409, and identity
numbers in `details` are refused. What e2e still owns is everything either side of the payment: the
wizard's validation, the co-fill invite flow, the re-submission lock, and the tracker. End-to-end
confirmation that money moves needs the Cashfree sandbox, not Playwright.

**Share-a-flat → Flatmates rename.** Every `share-flat-*.spec.js` was replaced by its
`flatmates-*` equivalent, `shareflat-map-popup` → `consumer/flatmates/map-popup`, and
`home-share-flat` → `consumer/home/flatmates-rail`. `/share-flat` still redirects, and
`consumer/flatmates/discovery` asserts the legacy `?view=` deep links resolve. Three flatmates
specs run cross-viewport because the discovery/posting surfaces differ on a phone.

**KYC badge-not-gate migration (ADR-019).** The old Aadhaar *gate* specs were replaced
by badge-not-gate specs — `consumer/list-property/no-gate`, `consumer/property/contact-badge-not-gate`,
`consumer/flatmates/no-gate`, `consumer/flatmates/seeker-verify` (opt-in seeker badge) — plus
`platform/auth/live-kyc-growth-levers` covering the DigiLocker Verified-badge funnel on the dashboard,
and `platform/auth/live-verify-payoff` covering what the badge actually *buys*
(`--config=playwright.live.config.js`).

**The payoff moved half into the backend.** `verify-payoff` used to assert the badge flowing onto
the owner's listings by reading the mock catalogue back out of `localStorage`. Live, a browser cannot
earn a badge at all — the grant arrives on a signed webhook — so the write is proven by
`VerifiedOwnerListingsTest` (backend) and only the buyer-visible payoff stayed in Playwright. The
7-day Featured perk the mock granted on first verification was **not** ported: the backend has no
`featured_until` and no perk ledger, so it is an open product decision, recorded in
`docs/migration/README.md` rather than invented here.

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

Debt wave 10 shipped four user-visible frontend changes and **no e2e**, which is the
only open backlog. Each is covered by a backend test or a build-time gate — the gap is
specifically that nothing drives them through a browser, which is where each one would
actually be wrong.

| Open gap | Why it is a gap, not a nicety |
|---|---|
| **Progressive disclosure on `/property/:id`** (D141) — four sections now start collapsed on mobile | `mobile/live-property-contact` scrolls to a fixed y-offset on this page and passes because the sticky bar is fixed, not because the content below it is right. A collapse that fails open costs nothing; one that fails **shut** silently hides amenities, and no assertion would notice. Needs a spec that expands each of the four and asserts the content arrives. |
| **The Turnstile widget on `/signin` and `/signup`** (D130) | The widget renders only when a site key is configured, so in mock mode it renders nothing and every existing auth spec passes either way. The failure worth catching is the opposite one: a misconfigured key rendering a *blocking* widget on a form whose button is deliberately not gated. |
| **Report triage enforcement** (D68) — `actioned` + `hide_content` must take the listing down | Covered by `ReportService` tests server-side. What no test covers is the admin screen's half: that the enforcement control is *present*, that it is refused on a non-`actioned` decision, and that the dashboard's `openReports` tile agrees with the queue it links to. |
| **`buy.stamp_duty` renders as absent, not as ₹0** (D118 / V55) | `check:finance` proves the client's window matches the server's; it says nothing about what a null renders as. The whole point of the change was that a wrong number looked like a right one. |

### Closed, with what closing them found

The Phase-2 gaps and the seven items that followed them are closed. The table below
records what closing the last batch found, because each one is a trap the next spec
author can fall into again.

| Closed item | What the new spec found |
|---|---|
| `/services` hub → `consumer/services/hub` | Nothing broken, but the hub's `.reveal` blocks sit at `opacity: 0` until scrolled into view. `scrollIntoViewIfNeeded()` deadlocks on them (scrolling requires visibility); force `.visible` instead, as `consumer/property/detail-improvements` does. |
| `/locality/:slug` → `consumer/search/locality-intel` | The intel cards are behind `Tabs`; only Overview renders on load. Also `NativeSelect` is a themed `.pn-dropdown`, so `selectOption()` never resolves — open the trigger and click a `[role="option"]` from the portaled menu. |
| `/pay-rent` → `pay-rent` | `puneNestDB_v5` cannot be seeded in an init script: mockApi migrates and merges it at module load, so a partial object leaves the app with no settings and a blank page. Load once, mutate the real DB, then navigate. |
| `/admin/localities` → `admin/localities` | `Table` renders a desktop `<table>` **and** a `.pn-card` list for phones, hiding one with CSS. Unscoped text assertions either trip strict mode or resolve to the hidden copy. |
| Help feedback → `platform/help/live-article-feedback` | Fine as shipped: a thumbs-down writes nothing until the comment form is submitted, and the widget resets per article slug. |
| `DualRange` parsing → `consumer/search/dual-range-parsing` | Fine as shipped: `Cr`/`L`/`Lakh`/`Lac`/`K`, `₹`, commas and spaces all parse; unparseable input is ignored rather than coerced to 0. |
| Responsive pickers → `platform/live-date-time-fields`, `mobile/live-date-time-fields` | **Two real bugs.** (1) `.pn-datefield` / `.pn-cal` / `.pn-timepicker` lived in `styles/routes/list-property.css`, which only `ListProperty.jsx` imports — so on the other ~19 surfaces the field rendered as a plain block and the calendar as a static, unlayered element that reflowed the page. Moved to `styles/components/date-time-fields.css`, imported by `DateField.jsx` and `TimeField.jsx`. (2) `.pn-timepicker { width: 250px }` sat after the bottom-sheet block at equal specificity, so on a phone the time picker docked as a 250px stub against the left edge while the calendar went full width. Now guarded by `@media (min-width: 640px)`. |

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

