# Worklog

> **A finished slice gets one index line here, not a narrative.** Git history is the archive; this
> file is the index into it. Open work gets a bullet, and the bullet is deleted the moment it is
> fixed or moves into a numbered ledger row. Do not restate a decision here — link to its number in
> [tasks/DECISIONS-NEEDED.md](DECISIONS-NEEDED.md). Compressed 5,294 → 527 → 1,828 → 4,348 → this.

Where things live:

| Topic | File |
|---|---|
| Open decisions and the damage-ordered work queue | [tasks/DECISIONS-NEEDED.md](DECISIONS-NEEDED.md) |
| Durable rules learned the hard way, and house style | [tasks/lessons.md](lessons.md) |
| Tech debt | [docs/system/tech-debt.md](../docs/system/tech-debt.md) |
| Unanswered product questions | [docs/system/open-questions.md](../docs/system/open-questions.md) |
| The frontend data seam | [docs/system/frontend-data-seam.md](../docs/system/frontend-data-seam.md) |
| Migration plan and phase status | [docs/migration/README.md](../docs/migration/README.md) |
| e2e coverage matrix (hard gate) | [e2e/COVERAGE.md](../e2e/COVERAGE.md) |

---

## In flight

### Live seam verification — page-by-page sweep

First hands-on session against live APIs (2026-08-30) surfaced widespread UI/API breakage that the
green 1,935-test suite does not see, because most of it was written against the mock and is blind
to client/server vocabulary drift by construction. Method, failure signatures and the 71-route
ledger: [docs/migration/07-seam-verification.md](../docs/migration/07-seam-verification.md).
Confirmed defects land in **Needs attention** below, not in that file.

- [ ] Preconditions (stale-JVM check, lane, 88-user baseline, `GET /flags`, pre-existing red recorded)
- [ ] Mapper-vs-DTO contract audit — 21 `http/*Mapper.js` against their DTOs, no browser needed
- [ ] Wave 1 — money and trust (auth, property detail + contact gate, list-property, checkout, plans, pay-rent, documents)
- [ ] Wave 2 — public discovery (home, listings/map, owner, society, locality, flatmates, reels, saved, services, help)
- [ ] Wave 3 — signed-in self-service (dashboard, owner hub, profile, notifications, messages, refer, support, vault)
- [ ] Wave 4 — back office (15 admin + 6 ops desks)
- [ ] Redirects confirmed (12)

**Home page network audit (2026-08-31), the first Wave 2 observation.** Ten distinct requests on a
cold load, seven of them issued twice. The duplication splits cleanly along one line and no other:
every doubled request comes from a `useEffect` (`/pricing`, `/flags`, `/me`, `/me/verification/aadhaar`,
`/saved-searches`, `/faqs`, `/recent-searches`) and every single one comes from module scope
(`/geo` and `/cities` via `loadGeoPolicy()` in `main.jsx`, `/page-views` via the batched beacon).
That is React StrictMode double-invoking effects in development, and nothing else — a genuine
duplicate call site or a twice-mounted tree would have doubled the module-scope three as well. Not a
defect, and the asymmetry is what rules out the alternatives rather than merely being consistent
with the diagnosis. `/geo` and `/cities` likewise do not re-fire on client-side navigation: their
only other trigger is `punenest-settings-change`, dispatched by two admin writers.

The one real finding was `/pricing`, now fixed — see **Shipped**.


### Account mock retirement — live APIs only (pay-rent excluded)

- [x] Move dashboard recent-search history behind a server-owned API, then replace and delete
  `consumer/account/dashboard.spec.js`. **Done 2026-08-25 (D248)** — `GET`/`PUT /me/recent-searches`
  (`engagement.history`, V121) own the cap, the timestamp and dedupe-by-normalised-URL; the browser
  key stays only for anonymous visitors, behind `services/recentSearchService.js`. `RecentSearchTest`
  13 ✅, `live-recent-searches.spec.js` 4 ✅ — the write on the wire, an API readback, a **second
  browser context** reading both the Home rail and the dashboard resume card, and the boundary that
  an anonymous search issues no request at all.
- [ ] Add live listing-freshness coverage for confirmation and retire
  `consumer/account/listing-freshness.spec.js`.
- [ ] Replace and delete `consumer/account/owner-finances.spec.js` using the property-finance API.
- [x] Move owner rent-receipt tracking off browser storage, replace the Owner Hub mock coverage,
  and delete `consumer/account/owner-hub.spec.js`. **Done 2026-08-25 (D248)** — `GET`/`POST
  /me/managed-properties/{id}/rent-receipts` (V120) mint an immutable snapshot with a durable id, so
  a raised rent no longer rewrites last year's receipts and the tenant's copy keeps one reference.
  `ManagedRentReceiptTest` 12 ✅, `live-rent-receipts.spec.js` 2 ✅ (cross-context readback, and the
  deterministic `409` on a second attempt at the same month). Pay Rent untouched.
- [ ] Keep `consumer/account/pay-rent.spec.js` unchanged by explicit user direction.

### Phase 5 finish plan

- [x] **Lock the remaining Phase-5 decisions** — done 2026-08-22. Geo/cities is server-owned end to
      end (register 38); the audit tab stays read-only (39); post-on-behalf stays visible on Staff
      Activity (40); Sonar is the Phase-5 target and the Checkmarx-vs-CodeQL choice is explicitly
      deferred past functional close (41).
- [x] **Finish the real admin migration debt** — done 2026-08-26. Every live-worthy admin spec is
      converted and only deliberate mock-side keepers are left; see the wave note below for the
      file-by-file end state.
- [ ] **Clear the last cross-cutting live runtime pins to mock code** — consumer/service entry
      points, city propagation/runtime geo, staff login, admin dashboard/topbar helpers, and the app
      boot path (`main.jsx`) so a live build no longer needs the mock store to exist.
  - **M3 complete:** the rent-agreement wizard, property duplicate evidence, flatmate dashboard
    adapters, and legacy chat/service helpers no longer import the mock API or store. The wizard's
    browser-local `TR…` admin ticket was removed: it looked like an operations hand-off but was
    visible only in the submitter's browser. **Backend gap:** create the rental-desk ticket from the
    confirmed payment webhook; until then the paid service request is the authoritative record.
    Review fixes: abandoned invite URLs cannot accept a party after cleanup; shared links are now
    absolute; co-fill creation records the owner's identity; and picker-selected listings retain
    their server UUID until their address identity is edited.
  - **M4 complete:** `main.jsx` no longer waits for browser-store seeding and `services/boot.js` is
    deleted. The old mock-only properties spec had already been retired with the provider lane, so
    its historical boot-seed assertion cannot be re-run; lint and all static frontend gates pass.
  - **M5 complete:** the Vite mock-persistence endpoint, routed dev seed page, mock API/store,
    and browser-store flat-split workflow are deleted. The remaining flat-split module contains only
    pure form validation shared by live screens. The mock seed catalogue and its `npm run seed`
    entry point, one-off seed maintenance scripts, and seed-data writes in the floor-plan generator
    are also deleted, as are four unreachable mock analytics modules; static gates and a production
    bundle build pass. The consumer maintenance gate now reads `GET /flags` through
    `AppFlagsContext`, not either legacy browser database.
  - **M6 complete:** four non-live specs remain by design: contact identity masking, connectivity,
    rent agreement, and city propagation. They are classified against existing live equivalents;
    no spec was deleted only to make the suite green. All 19 tests passed against the live-only app.
    - `contact-identity-masking.spec.js` is an obsolete direct test of local contact buckets;
      live owner/profile and contact-gate specs now prove server masking. Leave it while the legacy
      suite is quarantined rather than deleting coverage by fiat.
    - `consumer/connectivity.spec.js` remains valid: it fault-injects live HTTP requests and proves
      browser offline/unreachable presentation, independent of mock data. Its fault harness now
      aborts concurrent API hydration calls for unreachable scenarios, so the test proves an
      unavailable API rather than a timing accident between a failed listing request and an
      unrelated successful one. The 500 scenario likewise isolates ancillary calls as 500s, so a
      later unrelated success cannot hide a regression that misclassifies a received server error.
    - `rent-agreement.spec.js` is mock-only browser-storage coverage. Its real service and co-fill
      claims are covered by the three live rent-agreement specs; it remains reported, not deleted.
    - `platform/city-propagation.spec.js` retains only pure default/coming-soon client assertions;
      server roster mutation and propagation belong to `live-city-roster.spec.js`.
  - **M7 complete (2026-08-26): browser-storage writes whose API already shipped.** A sweep for the
    inverse of the earlier milestones — not mock *modules* but mock-shaped *data paths* still living
    in `localStorage` next to a working endpoint. Four found, all silent, none failing:
    - **City waitlist was never sent anywhere.** `POST /cities/waitlist` and `city_waitlist` had
      shipped; `CityContext.requestCity` pushed the ask onto `pnCityRequests` in the shopper's own
      browser and toasted "You're on the Mumbai waitlist 🎉". Every ask since launch was recorded
      where nobody at PuneNest could read it. Now `cityProvider.joinCityWaitlist` (`auth: false` —
      the route is `security: []`, and the point of a waitlist is that the person is not a user
      yet), awaited through the modal so the toast follows the 201 and a rejection keeps the shopper
      on their filled-in form. The form's `name` is gone entirely — not just dropped from the
      payload. It was a **required** field guarding a value `requestCity` discarded one function
      later: `CityWaitlistCreateRequest` has no such property and `city_waitlist` has no column, so
      the modal blocked a shopper on something nothing could ever read. Nor does the new admin read
      justify adding a column, being aggregate-only by design. A waitlist needs a way to reach you
      when the city opens and nothing else, so it now asks for exactly that.
    - **Admin "City Expansion Requests" panel rebuilt on the server's numbers** (`SupplyGapTab`).
      It had aggregated the same `pnCityRequests` key, so it showed the reading operator the asks
      *they themselves* had made while browsing — always none on a fresh profile. It was first
      deleted for want of a read endpoint; that was the wrong call, because the panel was the only
      demand signal ops had for deciding where to launch next, so deleting it removed the question
      rather than the wrong answer. The endpoint was built instead: `GET /admin/cities/waitlist`
      → `CityWaitlistRepository.demandByCity()`, grouped by `lower(city)` (matching
      `uq_city_waitlist_mobile_city`) and ordered by count desc then recency, returning
      `CityWaitlistDemandRow{ city, requests, lastRequestedAt }`.
      **Aggregate-only by construction, not by convention:** `city_waitlist` rows are unverified
      public mobiles and emails, and the grouping happens in SQL, so no contact detail is ever
      loaded into the JVM — there is no object on the server that could leak one. `requests` counts
      people rather than rows only because the unique index makes those identical; the displayed
      spelling is `min(city)`, a real one somebody typed. No `?days=` window: wanting a city does
      not decay. Guarded by `DASHBOARD_READ` (staff **or** admin), deliberately looser than the
      sibling `PATCH /admin/cities/{slug}` — reading where people are asking from is not the same
      authority as switching a city on.
      The panel holds the waitlist as `null`-until-loaded rather than `[]`, so a failed read says
      "Couldn't load city requests" and never "No city requests yet" — the one lie here that would
      quietly close the expansion queue on the strength of an outage. That state is also
      **recoverable**: the effect keys off the tab being enabled, which never changes on its own, so
      a "Try again" bumps an attempt counter in the deps — otherwise the panel would warn the
      operator not to read the outage as "nobody asked" and then offer no way to find out what it
      really was. The provider **throws** on a non-array 200 rather than coercing to `[]`, because a
      resolved `[]` is indistinguishable from an empty waitlist and would defeat that design from
      below. (`listCities` still coerces, defensibly: an empty roster degrades to the client's Pune
      default, not to a false claim.)
      `CityAdminEndpointTest` 10 ✅ including `theReportCarriesNoContactDetail` (raw body contains
      the city, not the mobile, and not the string `mobile`) and the anonymous-401/buyer-403/staff-200
      guard. `live-analytics-page` 20 ✅ with two new tests; both mutation-proven with asymmetric
      red — rendering `c.requests + 1` reddens only the count test, and letting the catch collapse
      to `[]` reddens only the routed-500 test. The failed-read test then lifts the route fault and
      clicks Try again, proving recovery by the warning clearing rather than by the button
      existing — a button that renders without re-fetching would satisfy the weaker assertion.
      **`react-reviewer` sweep:** no CRITICAL. One HIGH (the provider coercion above) and three
      MEDIUM fixed — the terminal failed state, the panel announcing nothing to a screen reader
      (`role="alert"` / `role="status"`), and `CityChrome` validating *and transmitting* an email in
      the "Request your city" branch that has no email field: `form.email` is seeded from the
      signed-in account, so a stored address failing the format test refused the submit while
      pointing at a field that was not on screen. Now `isWaitlist ? form.email.trim() : ''`, read
      once and used by both the guard and the payload. One LOW fixed (`askedOn(null)` printed a
      confident "1 Jan 1970" — `new Date(null)` is a *valid* Date at the epoch, so the NaN guard
      never saw it).
      **`code-simplifier` sweep (strict no-behaviour-change):** one finding applied — the retry's
      `useCallback` had no consumer (`SupplyGapTab` is unmemoized and never puts the prop in a dep
      array), so it was indirection that nothing could observe. Two candidates examined and
      deliberately kept: `setCityWaitlist(null)` in the catch is provably a no-op today but its
      proof is a whole-file reachability argument the next edit invalidates silently, and it keeps
      the five sibling effects in the file byte-identical; and `CityChrome`'s `if (busy) return` is
      the submit-side half of a documented "every way out is sealed while the POST is in flight"
      invariant. Backend: nothing — `DASHBOARD_READ` duplicating `SUPPLY_GAP_READ` is the
      established per-controller convention across ~18 controllers, not copy-paste.
    - **`puneNestNotifications` was write-only.** Two call sites minted rows the live inbox
      (`GET /notifications`) has never read, so the bell badge and Notifications page could not show
      them. `pushNotification` and both writes are gone.
    - **`pnConversations` was read but never written.** `hasLocalThread` consulted it to suppress a
      duplicate ask; the live conversation provider queues to `pnPendingRequests` only, which is now
      the whole check. `pnPendingRequests` and `puneNestCity` are legitimate client state and stay.

    Two live specs asserted the removed behaviour and were corrected rather than deleted:
    `live-analytics-page` (the panel heading — which had only ever passed on its empty state, and
    which now asserts a count instead) and `live-interest-doors` (the "announced in the bell"
    read-back). New coverage:
    `platform/live-city-waitlist.spec.js` 2 ✅ — the POST on the wire carrying the `city` the form
    never asks for, and a routed 500 proving the form survives a refusal. `npm run check` and a
    production build pass.

    Review-driven hardening of the newly-async path: **every** dismissal affordance (Cancel, X,
    backdrop, Escape) is now gated on `busy`, not just the submit button — the continuation closes
    over `CityChrome`, which does not unmount with the modal, so a mid-POST Escape used to relocate
    the shopper and toast success anyway. Liveness is re-read after the await rather than closed
    over. The error is `role="alert"` because it now arrives seconds after the click with focus on a
    silenced button. `maxLength={120}` and a loose email check mirror the server's bounds, since the
    only message this modal can render for a 400 is a generic "try again" — untrue and an
    unwinnable loop. `requestCity` throws on a blank city instead of resolving silently.
    **Known gap recorded in `hasLocalThread`:**
    `drainPendingChats` empties `pnPendingRequests`, after which a repeat `already_interested` 409
    re-stages an ask beside the real server thread; closing it needs an inbox lookup, not another
    browser key.
  - **Security follow-up (existing live endpoint):** a co-fill creation response distinguishes a
    registered invitee from a pending mobile. The UI no longer places that mobile in the sign-up
    return URL. Confirm whether the response must retain that distinction; if not, make it neutral
    server-side. The global write-rate filter already limits request volume, contrary to the review
    report's claim that the endpoint is unthrottled.
  - **Co-fill backend gaps:** the document endpoint rejects an unlinked service request, so a direct
    rent-agreement co-fill submission cannot persist the documents it requires; link a property or
    add authorised request-scoped document storage. An opened deferred Cashfree session is not
    returned by later reads and there is no resume/cancel endpoint, so the browser must not offer a
    checkout it cannot safely recover after reload.
  - **Security blocker:** request documents currently project bearer download URLs to every accepted
    co-fill party. Co-fill submissions therefore reject document attachment until the backend adds
    per-party document ownership/visibility and an integration test that one party cannot obtain
    the other party's KYC URL. The participant identity-write and completed-paperwork checkout gates
    belong in that same server slice.
  - **Existing dependency finding:** `pdfjs-dist` 6.1.200 is vulnerable when opening a malicious
    PDF. Upgrade it to at least 6.2.108 and verify normal document rendering and malicious-PDF
    rejection before release.
- [x] **Burn down the remaining consumer legacy suite by dependency cluster** — done, by arriving at
      the end of it rather than by a final push. Three specs never converted because conversion
      would have destroyed their subject, and they are keepers, not residue:
      `consumer/connectivity` (fault-injects HTTP and asserts the offline/retry transitions — a
      reachable API removes the thing under test), `contact-identity-masking` and
      `consumer/services/rent-agreement` (client-side identity and draft rules that never cross the
      wire). 17 tests, green, now the whole of `playwright.nobackend.config.js`.
- [x] **Finish the last platform holdout and flip the default config** — both halves landed.
      - **The holdout.** `platform/city-propagation` reached its second live city by writing
        `live: true` into the mock's `puneNestDB_v5` roster. Once `providers/mock/cityProvider.js`
        was deleted that write had no reader, so the file went **green while asserting about a city
        that never launched** — the failure mode the whole migration exists to remove. Ported to
        `platform/live-city-propagation.spec.js` (5 tests), which takes Mumbai live through
        `PATCH /admin/cities/{slug}` and asserts what `live-geo-policy` stops short of: a newly-live
        city serves an **empty** home and `/listings`, not a relabelled Pune. Two of those are
        `toHaveCount(0)` leak assertions, so each carries a **positive control in the same test** —
        without one, a listings route broken for every city would satisfy them perfectly. The
        `cities` fixture moved to `fixtures/live.js` rather than being copied: two copies would be
        two writers of one shared row with two independent teardowns.
      - **The flip.** `git mv` swapped the two configs; 234 citations across 42 files rewritten in
        one Node pass (PowerShell's cp1252 round-trip would have mangled the em-dashes), verified
        at 0 mojibake. Removing the no-backend config's `mobile` project was not tidying: its
        `CROSS_VIEWPORT` list had emptied itself as each spec converted and **moved** its entry, per
        the rule — leaving `testMatch: []`, which matches nothing, so that project had been
        **reporting a clean result for zero specs**. Obeying the rule produced exactly the silent
        loss the rule was written to prevent.
      - **CI narrowed on purpose.** The runner has no Postgres and no Spring Boot, so the e2e job
        now runs `npm run test:nobackend` (one project) instead of a three-way viewport matrix
        against a default config it cannot satisfy. That is a real reduction in signal, recorded
        here rather than papered over; standing the live lane up in CI is in hardening below.
      - **The footgun is now the default.** `global-setup.live.js` resets `E2E_DB_NAME || punenest_e2e`
        at the start of every run, so a bare `npm test` wipes whichever database a concurrent
        session is using. Tolerable while the config was opt-in; named loudly in the config header
        and `e2e/README.md` now that it is what you get by typing the obvious command. The lane
        scripts remain the safe entry points.
      - Verified: default config collects **1935 tests in 283 files**; no-backend collects **17 in
        3 files** and runs **17 passed**; `npm run check:coverage` green (231 cited, all resolve).
- [x] **Delete the mock in one controlled cut (P5c)** — the headline deletion had already happened:
      `services/providers/mock/*`, `lib/mockApi*`, the `lib/data/**` stand-ins and the Vite
      mock-persistence route all went with the store, and `config.js` kept no switch. What this pass
      removed is what a deletion of that size leaves behind, and one piece of it was live:
      - **Dead code, in `e2e/helpers`.** `publishListing`, `approveListing` and `setFlags` each began
        `JSON.parse(localStorage.getItem('puneNestDB_v5'))` and dereferenced the result on the next
        line, so every one of them would now throw on `null` rather than fail a readable assertion.
        None had a caller: `live-consumer-fixes.spec.js` defines its own `publishListing`, which
        POSTs `/me/listings` and PATCHes `/properties/{id}/status` as real actors and is a local
        function on purpose, because it sits below `propertyMapper` and must speak the wire
        vocabulary. `readRooms`, `readReviews` and `readReferralStats` went with them (0 callers),
        as did `STORAGE_KEYS.db` (0 references). `readContactsUsed` stays — 1 caller, live key.
      - **Prose that had become false**, which is the part worth naming. 44 files still described a
        world with two providers: 39 provider headers pointed at `providers/mock/xProvider.js`, and
        five docblocks stated in the present tense that a screen "gates on `isHttpDomain(...)`" —
        `OpsQueue`, `OpsReferrals`, `OpsDraftingDesk`, `/ops/flatmate-review`. The gates are gone
        and those desks are live, so the comments described a shut screen that is open. Rewritten to
        past tense, keeping the *reason* each gate existed (D184: a hand-maintained second
        vocabulary drifts), because that reason still explains why these desks never had a twin.
      - `appReady`'s docblock justified `data-pn-boot` by a seeding race that no longer exists; the
        flag stays because the `networkidle` problem it also solves does.
      - Verified: check/lint/build/size/canary all green, both helper modules import, and no spec
        references a removed export. Bundle unchanged at 426.9 KB — every frontend edit was a
        comment.
      - **Service requests triaged 2026-08-28:** the `serviceFlow.js` localStorage workflow was
        dead code — 442 lines, one consumer importing only five pure status/URL helpers. Those
        helpers moved to `serviceRequestStatus.js`; the browser store and its mock-only party-bucket
        merge were deleted. The tracker has one server list, so an accepted co-fill request is
        represented once rather than being merged with a second browser bucket. The initial pass
        almost deleted a real capability: the mapper had hardcoded every message as read, which
        made the unread badge unreachable even though `POST /service-requests/{id}/read` and
        `readAt` already existed on the server. Restored the live receipt path and added a browser
        regression: staff reply → one badge → opening Messages posts 204 → badge clears. Also
        corrected the service-request section in `docs/system/frontend-data-seam.md` from the old
        partial-migration state.
      - **Left open, deliberately:** the remaining docblocks that promise mock-only *capabilities*
        — including `verificationProvider.js`'s growth perk and `myListings.js` — are not stale
        cross-references but claims that a feature has no server implementation. Each is either a
        real gap to file or a dead affordance to delete, and answering that is product work, not a
        rename. Not folded into a deletion pass.
      - **Two more classifications (2026-08-28):** `myListings.js` is already fully server-fed:
        `GET /me/listings` plus the caller's rooms, flatmate posts and groups. Its “demo top-up” is
        a deleted historical branch, not an absent API. The Aadhaar growth perk is a **dead
        affordance**, not a server gap: the real start contract deliberately returns a pending
        DigiLocker handle with `perk: null`; an immediate `{ verified: true, perk }` result existed
        only in the deleted provider. The remaining immediate-success callbacks can be removed in a
        focused UI cleanup; do not request a server feature to reproduce a fake ranking boost.

- [ ] **Hardening / close-out** — backend tests in CI, Sonar wired, scanner decision recorded,
      bundle measured before/after the deletions, and docs/coverage brought to the true live end-state.

**Admin wave (P5b) — done 2026-08-26.** `tests/ops` needed no wave at all (see below). Every file
that was ever counted as admin conversion debt is now either converted or carries a written reason
to stay mock-side; the checkbox above is ticked on that basis. The first pass that sized this wave
over-counted it badly — `notes`, for one, is a mock spec **as well as** a live one by design,
because it catches the same validation rules in a seconds-fast suite while `live-notes` proves the
seam reaches Postgres and survives a second account.

- ✅ **`analytics` (21 tests) → `admin/live-analytics-page.spec.js`.** Its header claimed Geography
  and Seasonal both computed in the browser and the file would follow "when they follow"; Geography
  has been live since register 36 and Seasonal is illustrative **by decision**, so there was no
  event to wait for. The sibling `live-analytics.spec.js` keeps the endpoint contracts and the two
  UI discriminators that prove the page is not silently on the mock. 34/34 live, coverage gate
  clean. The conversion earned its keep immediately: a page-wide "no `0h`" assertion failed,
  because `0h` is legitimately on the SLA tab from the generated Service Fulfillment and Concierge
  panels — invisible under the mock, and now scoped to the `Avg time to review` tile.
  **Superseded by D252** (below): those panels are measured now, Seasonal is deleted, and the
  page-wide sweep is back and green.

- ✅ **D252 — the two half-mock admin pages, 2026-08-26.** `AdminAnalytics` and `AdminSocieties`
  were each reading a live service and a browser generator into the same screen. Both are closed.
  **Analytics:** `/admin/analytics/sla` gained three `Track`s derived from `audit_log` — ticket
  pickup (4h), service delivery (72h), concierge → live (168h) — replacing figures `slaMetrics()`
  invented; every average, median and rate is nullable, because a desk that has closed nothing has
  no compliance record and `0h` would read as instantaneous service. What had no measurable source
  at all was **deleted rather than labelled**: the Seasonal tab, the six-month price trend, the
  per-listing price position table, the weekly compliance line, and with them `Card`'s `chip` prop
  and `SampleTabNotice`. A chart nobody can source does not become sourceable by being labelled,
  and the label was what made keeping it feel defensible. Deep links to `?tab=seasonal` fall back
  to Traffic — the page took the URL's tab key as read, so any unknown value (including a tab an
  operator had switched off in Settings) rendered the strip above an empty panel. **Societies:** a
  server-side duplicate scan over the real catalogue, and the society's name on the wire for
  `details` proposals. The scan found a scoring bug the browser version had hidden: dividing shared
  tokens by `min(len)` scores "Willow Towers" at 1.0 against every "Willow …" in the catalogue, and
  because RERA rows are verified they sorted above the actual duplicate and pushed it off the list.
  Jaccard instead. Verified: 75/75 backend (`AdminSlaAnalyticsTest` 23, `SocietyMintTest` 33,
  `SocietyProposalTest` 19), 54/54 admin analytics + societies live specs, lint at the 0-error
  baseline.

  **Review pass, same day.** `react-reviewer`, `code-reviewer` and `security-reviewer` over the
  landed diff, then a strict no-behaviour-change simplification. Security found nothing: the SLA
  query's `%s` slots take only private constants, both new routes carry the same `@PreAuthorize` as
  their siblings, and `duplicateScan` already excludes merged-away rows. Three real defects came out
  of the other two and are fixed: the duplicate column had **three** states for **four** things that
  can be true, so a failed request recorded `[]` and printed "No obvious match" — the sentence that
  gets a second copy verified — with only a `console.warn` behind it; `duplicates()` clamped its
  `limit` with `Math.max(1, …)` instead of refusing out-of-range like `?days=` does two files away;
  and `SocietyProposalService.decide` tolerated a missing society with `orElse(null)` on the one path
  where `apply()` has already written to that id, handing the operator "approved" for a change that
  reached nothing. `queue()`'s null tolerance is deliberate and stays — a page of a hundred rows
  losing one to a race should degrade, not 500. The `dupes` map is now pruned to the rows on screen,
  and the compliance-rate ternary and the average-vs-target colour ladder each existed twice.
  Re-verified: 76/76 backend, 56/56 admin live specs, lint unchanged.

  > **Scaling note, deliberate and open.** `duplicateScan` reads the whole society table and scores
  > it in Java on every request — ~350 rows today, behind a staff-only route, so it is a few
  > milliseconds and the `limit` bound is a contract not a guard. It is worth revisiting at roughly
  > 10k societies, and the shape of the answer is a trigram index (`pg_trgm`) with the scoring pushed
  > into SQL rather than a cache, since the input is the catalogue itself.

- ✅ **`content` (7 tests) → `admin/live-content-desk.spec.js`.** This desk had live data paths on
  both halves already — `adminContentService` for banners / FAQs / announcements, and `reviewService`
  for the Reviews tab — so the mock file was a real gap rather than a deliberate hold-back. The
  existing `tests/live-admin-content.spec.js` already owned the seam and the two Reviews-tab console
  decisions, so the conversion split cleanly: the sibling keeps the contract and moderation queue,
  the new file owns the four-tab shell, the banners counter, the FAQs tab, the create form and the
  route guards. The run earned its keep immediately: the mock spec's happy-path create filled only a
  headline and passed, while the live API answered `422 A banners item needs 'image'`; the desk now
  pins that refusal, names the offending field, and keeps the dialog open. Verified: 17/17 green
  across both live content specs together.

- ✅ **`properties` / `enquiries` / `listing-freshness` — the five convertible claims, 2026-08-25.**
  An audit of every remaining mock admin spec found exactly five tests making a claim no live spec
  made. All five are now live: an enquiry marked responded writing a note onto the case file the
  moderator opens (`live-enquiries`); the **Unconfirmed (stale)** sub-filter narrowing the queue on
  the server rather than in the page (`live-properties-console`); the follow-up board's one-click
  chaser choosing its template from the tier the *server* reports (`live-outreach-console`); and the
  edit modal's two exits (`live-properties-moderation`). `admin/listing-freshness.spec.js` is
  deleted; the `enquiries` and `properties` twins are retired in place with pointers. Two audit
  items dissolved on inspection rather than converting: **`?review=<id>`** was already covered live
  by `live-notes` with a real uuid, and the edit modal's *prefill* by the existing BHK-correction
  test — so the only genuinely uncovered leg was **Cancel**, which the mock could never have proved
  (its provider is `Object.assign` over `localStorage`, so the store that would report the unwanted
  write is the same object the test reads its "before" from; a modal that saved on Cancel would have
  passed). Live it is a fresh read from the API.

- ⚠️ **A regression I introduced, and mis-certified as pre-existing.** `c1e46ff` moved the console
  search from a synchronous client-side filter to a 250ms debounce plus a round trip, and deleted
  the downstream filters. Three tests in `live-outreach-console` began failing. I checked them by
  stashing and reported them as pre-existing — **wrong, and wrong in a way worth writing down**: the
  stash removed my *spec* edits while the committed page change stayed in the tree, so it could not
  have exonerated the commit. A verification that does not vary the suspected cause proves nothing.
  Restoring the source blob (`git checkout c1e46ff^ -- AdminProperties.jsx`) flipped the file from
  3-fail/1-pass to 3-pass/1-fail, which is decisive in both directions at once. The mechanism: for a
  moment after `fill` the unfiltered queue is still on screen, and `expect(one).toBeVisible()` on a
  locator matching fifteen rows is a **strict mode violation, which aborts instead of retrying** —
  the 20s budget was never spent (it died at 8s) and the message read as "this listing is no longer
  pending", sending me to probe the seed and the API, both of which were fine. `toHaveCount` retries.
  Fixed and green 4/4. The sibling `.first()` call sites were audited and are *not* affected: the
  console already renders a stale queue inert, which `live-properties-console` L1424 pins.

- ✅ **Two long-standing admin-lane failures, both mis-readable as product defects, D253.**
  The full live admin gate had been running six red. Three passed in isolation (ordinary cross-test
  state, left alone deliberately — "fixing" a spec that passes on its own edits the wrong thing).
  The other two were real and neither was a bug in the console:
  - `live-outreach:144` expected the WhatsApp chaser's link to carry Playwright's `BASE_URL`, but
    the server builds it from `punenest.app.base-url`, which `application-e2e.properties:72` defaults
    to `:5173` because **`E2E_APP_BASE_URL` was set nowhere in the repo**. So the assertion held only
    on a lane that happens to serve on the default port, and every chaser this lane composed pointed
    an owner at a port with nothing behind it. That is the failure the spec was written to catch —
    it was catching it, at the lane rather than at the template. `backend/run-lane-admin.ps1` now
    exports it beside `E2E_DB_URL`, where the other lane settings already live. 9/9.
  - `live-consolidation:212` asserted a KPI tile labelled `Open leads`. `63bc0c7` had renamed it to
    **`Awaiting owner`** on purpose: the tile counts `pending`, which per `ContactRequestStatuses`
    means awaiting the *owner's* decision, and the only moves out of it are the owner's — calling it
    an open lead pointed the desk at work it cannot do. The spec's last commit is an ancestor of the
    rename, so it had been asserting a word that no longer exists rather than anything the page got
    wrong. Attribution by `git merge-base --is-ancestor <spec> <source>`, which is decisive where a
    `git stash` is not. 11/11.

**The end state, file by file.** That list read `properties` (39), `consolidation` (14), `finance`
(14), `post-on-behalf` (12), `post-on-behalf-fixes` (10), `localities` (9), `property-recheck-queue`
(9), `enquiries` (9), `settings` (7), `finance-disclosure` (7), `societies` (6), `maps-geo` (4),
`duplicates` (1) — and five of those files no longer exist. Re-derived from disk on 2026-08-26; the
fourteen mock files left in `tests/admin` are all keepers, in three kinds:

- **Deleted outright**, their claims converted: `analytics`, `content`, `settings`, `societies`,
  `consolidation`, `property-recheck-queue`, `duplicates`, `listing-freshness`.
- **Retired in place** — the conversion took the server claims and the file kept the browser ones,
  with a block comment naming where each moved test went: `properties` (20), `enquiries` (2),
  `post-on-behalf` (5), `post-on-behalf-fixes` (5), `localities` (2), `maps-geo` (1).
- **Never conversion work**, and each says why in its own docblock: `finance` (14) and
  `finance-disclosure` (6) under D251 — the first is entirely claims about the browser, the second's
  load-bearing claim is *configurability*, which live cannot demonstrate because the flags are
  server config there; `societies-queues` (6) and `command-palette` (7), which need `page.route`
  fault injection and a mock-provider build respectively, so they are the halves their `live-` twins
  structurally cannot hold; `services-moderation` (3), whose subject is the empty state of a
  live-only domain plus two `RoleRoute` guards; `flatmates` (3), the guards on a retired route's
  redirect; `flatmate-moderation-reach` (4), a mock-fidelity defect; and `notes` (2), the deliberate
  dual described above. Eighty tests in all, and none of them a claim about a server.

Nothing here is waiting on an endpoint. The next admin-shaped work is in the cross-cutting item
above — the runtime pins to mock code that a live build still needs, `admin dashboard/topbar
helpers` among them — not in `tests/admin`.

**Mock retirement.** All 18 seam domains have live consumers. Phases 0–4 are done; Phase 5 (retiring
`lib/mockApi.js` and the `lib/data/**` stores) is in progress. Remaining work is enumerated as
numbered rows in the ledger, in damage order. The consumer-first slice just closed is rent-agreement
co-fill: deferred checkout, an invite addressable to an **unregistered** mobile, and party-side
details submission. Written end to end; the live e2e run is the outstanding step.

Two things that are true and are not going to change soon:

- **The Cashfree sandbox-verify gap has no possible e2e.** The mock provider returns no
  `paymentSessionId`, so no automated run can reach the hosted checkout. It stays manual.
- **`PUNENEST_DEV_MACHINE` is mandatory for the `dev` profile.** The backend refuses to boot without
  it. It is set per machine, not in the repo.

### Consumer wave — `account` (18 files / 94 tests) and `flatmates` (27 files / 118 tests)

Sized 2026-08-23 by reading every file rather than by grepping `localStorage.setItem`, which the
migration README already records as a lower bound. Two corrections to the raw file counts came out
of that and both *reduce* the queue, so they are stated before the lists:

- **Four `flatmates` files were already converted and were not debt — now deleted.** `filters`,
  `map-gate`, `map-popup` and `smart-search` were **byte-identical** (SHA-256) to their `live-`
  twins, created as copies by `aee968b`. The mock config runs the legacy name
  (`testIgnore: /live-.*/`), the live config runs the `live-` name (`testMatch: /live-.*/`), so each
  body ran once per suite. They were **P5c deletion residue**, not conversion work: 31 files → 27,
  140 tests → 118. Cleared 2026-08-23 under the same-commit ruling below — hashes re-verified, all
  four live twins run green (**22/22 ✅**), none of the four seeds anything (no `setItem`, no
  `seed()`), so the live copy was already the identical body against the API, and none was a
  `CROSS_VIEWPORT` entry, so no config moved.
- **This is a tree-wide pattern, not a flatmates one.** The same sweep found **16 byte-identical
  legacy/live pairs — 66 duplicated test bodies** across `flatmates` (4), `home` (5), `search` (5),
  `society` (1) and `services` (1). The flatmates four are gone, leaving **12 pairs / 44 bodies** in
  `home`, `search`, `society` and `services`. Recorded here so P5c deletes them as one known set
  instead of rediscovering them folder by folder.

  > **Closed 2026-08-24 — the set is empty, and P5c must not act on the paragraph above.**
  > Re-hashed every remaining legacy/live name-pair in the tree: **17 pairs, 0 byte-identical.**
  > The `home` and `search` duplicates went out with their own waves rather than as a batch, and
  > the rest have since diverged — the surviving legacy file is now a genuinely different body from
  > its `live-` twin, which is exactly what a converted pair should look like. The paragraph is left
  > standing because the *finding* was real and the reasoning is worth keeping, but acting on it now
  > would delete 17 files that carry real coverage on the belief they are copies. **Re-hash before
  > deleting any pair; never delete on the strength of a matching filename.**
- **`account/owner-profile.spec.js` (5) is a strict subset of `consumer/live-owner-profile.spec.js`
  (11)** — the live twin covers the same header/grid/not-found ground *and* masking, the seven-field
  wire contract, provenance and the reviews-read failure state. It is a **delete**, not a convert.

  > **Wrong, corrected the same day on reading both files.** The live twin is almost entirely
  > *contract*: seven of its eleven tests never open a browser, and it carried **no console-error
  > guard** and no assertion about the rendered header, the trust badges, the listing rail or the
  > not-found *screen*. Deleting the legacy file would have dropped all of that. It was a
  > **conversion**, done below.

#### `account` — cheapest first

- [x] `owner-profile` (5) — **converted**, absorbed into `consumer/live-owner-profile` (11 → 16 ✅).
      Found a dead assertion in the process: the retired spec asserted
      `getByRole('button', { name: 'Call' }).toHaveCount(0)`, but `Owner.jsx` renders Call and
      WhatsApp as `tel:` / `wa.me` **anchors**. There is no branch in which Call is a button, so the
      one guard the file existed for was green against the exact markup it forbade. Now asked by
      role `link`. Commit `f8a84e6`.
- [x] `support-tickets` (6) — **converted** to `consumer/account/live-support-tickets` (6 ✅). The
      customer half of a domain whose desk half was already live (`ops/live-support-queue`). Three
      mock-shaped premises had to go: the id was asserted as `/SUP-\d+/`, a format only the mock
      mints (the server sends a UUID and both the list and the thread render `{t.id}` raw, so the
      spec now fetches the id and compares); the empty state leaned on a seeded actor staying
      ticket-free, when the seed in fact gives *Priya* a ticket; and creation mutated whoever it
      signed in as, which outlives the file because the DB resets per run. Both now use throwaway
      accounts. The conversion also caught that **the name field is empty and required for a real
      new account** — the retired spec's "name + mobile are prefilled" was true only of the mock's
      seeded user, and a genuinely new writer meets a required empty field.
- [x] `messages-inbox` (12) — **converted** to `live-messages-inbox` (3 ✅). The seed now has a
  named Rahul↔Meera row, but the live test mints a unique buyer thread against Meera's seeded
  Baner listing so message writes never poison shared fixture state. It owns quick/typed sends,
  readback after reload, contact visibility, the report modal, and the dashboard hand-off.
  Staged chat coverage remains in `consumer/property/live-chat-owner`; auto-replies are mock
  theatre, and the location card is not live-reachable because the HTTP mapper has no location.
- [x] `tenant-profile` (6) — **converted** to `live-tenant-profile` (3 ✅). The server-backed
  profile save/reload, blank-name no-write guard, and score checklist replaced browser-store
  premises. The DigiLocker completion and changed-mobile cases are owned by the live verification
  funnel or lack a deterministic provider callback.
- [x] `contact-request-verified-badge` (1) — **converted** to
  `live-contact-request-verified-badge` (1 ✅), with isolated verified/unverified buyers and
  the server-projected `requester.verified` bit before approval.
- [ ] `photo-requests` (2) — **intentionally mock-only**: requests still live exclusively in
  `puneNestPhotoReq:<ownerMobile>`; no backend model, endpoint, provider, or cross-device read
  exists yet.
- [x] **`documents-vault` (1) — deleted, not converted.** Its own header already said the live
      counterpart was `live-property-integration.spec.js`, and reading that file confirmed it:
      `:295` drives the same upload → slot-flips → remove → slot-empty round-trip *and* asserts
      `POST /me/documents/{propId}` 201 and the `DELETE` on the wire, under a describe block whose
      `afterEach` carries the console guard. Strictly stronger; nothing was lost.
- [x] **`doc-requests-grant` (1) — converted** to `live-doc-requests-grant` (1 ✅). Kept rather than
      folded into `live-buyer-document-access`, because that sibling grants by calling `PATCH
      /me/documents/requests/{reqId}` directly and therefore cannot fail for the bug this spec
      exists for — a dashboard that decided the request in the browser's own copy of the inbox and
      told the server nothing. The PATCH is now asserted on the wire and the row re-read outside the
      browser.
- [x] `view-documents-flow` (3) — **converted** to `live-view-documents-flow` (2 ✅): category
  matching, notification deep-link provenance, view-only rendering, and the granted-without-file
  state now read the API. `doc-viewer-scheme` stays mock-only because live rows are storage URLs,
  never inline `data:` payloads; `doc-info` stays mock-only because no live agreement/info-dot
  fixture reaches that panel.
- [ ] `listing-freshness` (4) — mock-only until the seed exposes deterministic fresh/stale/dormant
  `last_confirmed_at` states; live confirmation itself is already covered elsewhere.
- [ ] `owner-hub` (8), `owner-finances` (4), `pay-rent` (5) — mock cases retained for manual receipt,
  financial-year clock, multiple/empty tenancy, and payout-removal states that the API cannot
  currently fixture or express. Their managed/rent live seam coverage already exists.

  > **Wrong on all three counts, corrected 2026-08-24 by reading the backend rather than the note.**
  > This entry is the reason these files sat still, so the correction is kept beside it.
  >
  > - **`owner-finances` — the "financial-year clock the API cannot express" does not exist as a
  >   gap.** `FinanceService` handles the 1 April Indian FY boundary explicitly, in a comment that
  >   names the two off-by-one bugs it exists to avoid, and `MeFinancesController` serves
  >   `SUMMARY`, `CASHFLOW`, `DUES`, `TRANSACTIONS` (+ `BASIS`). All four tests are convertible
  >   today with no backend work. **CONVERT.**
  > - **`owner-hub` — already live, and the mock spec is very likely vacuous.**
  >   `POST /me/managed-properties` has existed since V33, and `e2e/COVERAGE.md` states in words
  >   that `live-managed-properties.spec.js` was written because this file "still passes unchanged
  >   after the port". A spec that cannot notice the seam moving underneath it is not coverage.
  >   **VERIFY THE VACUITY, THEN DELETE** — do not convert it twice.
  > - **`pay-rent` — mock-only for a *product* reason, and that reason is now recorded.** Online
  >   rent payment is concept-only: `onlineRentPayment` stays off and the route really renders
  >   `PayRentComingSoon`. Ruled 2026-08-24, written up in
  >   `docs/flows/consumer/rent-tenancy.md` §5.8. The payout-removal gap is real
  >   (`PayoutAccountUpdateRequest` is `@NotBlank`, no `DELETE /me/payout-account`) and is
  >   **deliberately not being filled**. This spec retires *with* the mock at P5c; the surviving
  >   live claim is the coming-soon state. Do not port the fee-breakdown or receipt assertions.
  >
  > The general lesson, now three waves old: **"the API cannot express this" is a claim about the
  > backend and must be checked against the backend.** Twice now it has been recorded from the
  > shape of the mock spec instead.
- [ ] `action-center` (4), `deals-offers` (11), `dashboard` (14) — focused live additions now cover
  API-backed actions in `live-action-center` (2 ✅), `live-deals-offers` (2 ✅), and
  `live-dashboard` (2 ✅); the mock twins remain for local photo/recent-search and unavailable
  timestamp/owner-mobile flows.

#### `flatmates` — cheapest first

- [x] `discovery` (10) — **converted** to `live-discovery` (13 ✅ × 2 viewports = 26). Nine tests
       moved; the tenth is a live capability gap, below. Three of the nine changed subject rather
       than being ported: the vacant-flat disclosure, the "Master bedroom" chip and the split-price
       line all read `roomKind` / `priceBasis` / `shareMax`, none of which is on `FlatmateRoomCreate`
       — they are derived, deliberately, because a client that could name its own `priceBasis` could
       price a shared bed as a private room. The only writer is `POST /properties/{id}/split`, so the
       spec performs the act the product actually offers (post a rent listing → Ops approve → split
       into one master bedroom → moderator publishes) and every field those tests read is then
       server-derived. Two conversion traps worth remembering: the feeds are HTTP round trips, so
       reading the cards straight after a navigation counts `[]` and calls it an empty tab (it failed
       only in file order, not alone); and "Team up" names both the tab and the empty-state rescue
       CTA, so an unscoped `getByRole` fails strict mode only while the feed is in flight — which
       surfaced as a mobile-only failure. The `CROSS_VIEWPORT` entry moved to the live config's
       `mobile` project per the wave-1b rule.
- [x] **Live e2e test for `/me/flatmate-requests` (host's inbox)** — `consumer/flatmates/live-host-requests-inbox.spec.js`
       covers the host's flatmate requests inbox: endpoint accessibility, paging structure, status filtering,
       access control (404 for non-existent, 404 for another host's request). Baseline tests establish the
       contract before expanding to requester contact details and decision workflows.
- [x] **Live e2e tests for flatmate groups, interests, alerts, and seat backfill** — Wave 1c (2026-08-23):
       **COMPLETED: 5 files, 26 tests**
       - `live-groups` (9 tests) — group creation, discovery, filtering by locality/budget/policy, pagination, access control
       - `live-interactions` (5 tests) — express interest in room/group, 409 handling for duplicates and full groups, deletion
       - `live-alerts` (5 tests) — flatmate saved searches via `/me/saved-searches?kind=flatmates`, toggle/delete
       - `live-backfill` (7 tests) — seat management (`PATCH /flatmates/groups/{id}` with `seatsOpen`), tier persistence, access control
       - `live-eligibility` (5 tests) — verification tier immutability, verified-only filtering, tier-aware discovery
       **Ruling applied: 18 mock-side files marked deliberately mock-only keepers (UI routing, form validation):**
       - `posting` (7) — UI modal routing, kept mock
       - `video` (1) — full form workflow recording, kept mock
       - `seeker-verify` (2) — modal display (covered by platform KYC flow), kept mock
       - `no-gate` (4) — badge-not-gate enforcement, kept mock
       - `pg-listing-details` (1) — form field conditional rendering, kept mock
       - `consent` (2) — OTP UI flow, needs live endpoint first, deferred
- [x] **Gap closed, and the note outlived it by several waves.** This entry used to read "a live
       seeker cannot be shown their own request", on the grounds that `Routes.Flatmates` had no
       "my seeker posts" route and the public feed masks `mobile`. **All of it is now false.**
       `MY_POSTS` (`GET /me/flatmate-posts`) exists at `Routes.java:1304` with a controller
       (`FlatmateSeekerController:134`), both providers implement `myFlatmatePosts`, and
       `useFlatmates.jsx:109` reads it into `myPost` — so the banner renders and the own-post
       exclusion at `useFlatmateDiscovery:112` compares server ids on both sides. Proved live by
       `live-interactions-board.spec.js:142`, which is stronger than the mock it replaced: it
       requires other people's cards to render first, so the absence of the seeker's own card is a
       claim about the filter rather than about an empty board. `discovery.spec.js` deleted.
       **The lesson is the ledger's, not the code's:** this is the third stale "no endpoint" note
       this wave — after owner-consent and this one — and each cost an investigation. A note that
       records a gap needs re-reading against the route table before it is trusted.
- [x] **`e2e/package.json` offered a script that could not run.** `test:mobile-small` passed
      `--project=mobile-small` to the *mock* config, which has had no such project since wave 3;
      it exited 1 with "Project(s) ... not found". Deleted rather than repointed at the live
      config: that config resets the database named by `E2E_DB_NAME`, so a bare npm script is the
      exact footgun the lane runners exist to prevent, and `mobile-small` already runs as one of
      the live config's three projects in any full lane run. `README.md`'s script table and
      viewport section were describing the pre-wave-3 layout throughout and now describe both
      configs separately.

- [x] `d97-occupancy-and-reissue` (2) — converted: `live-d97-occupancy-and-reissue.spec.js`.
- [x] `moderate-before-public` (3) — converted: `live-moderate-before-public.spec.js`.
- [x] **The rest of the folder is converted, and the list that used to sit here was stale.** This
      entry named `my-listings`, `alerts`, `no-gate`, `guardrails`, `backfill`, `groups`,
      `pg-sharing`, `interactions`, `interest-api`, `posting`, `video`, `pg-listing-details`,
      `listings`, `seeker-verify` and `full-journey` as pending. **All fifteen files are gone** —
      retired across earlier waves without this ledger being updated. Verified by listing the
      directory rather than by reading this list, which is the only way to catch it.
- [x] `owner-split` (14) — **migrated, not a keeper.** The note above said "0/14 port, and it stays
      as a mock keeper", and the reason it gave was true and yet not a reason: the dashboard's split
      UI *was* mock-backed end to end (`MyListingsPanel.jsx:213` calling the mock `splitFlat()`,
      `ListingCard.jsx:74-77` reading split state from localStorage), and the seam did export
      `splitProperty`/`unsplitProperty` through both providers with no screen importing either. That
      described **a wiring gap in the product**, which is a thing to fix, not a property of the test.
      Wiring it exposed `Number("3 BHK") → NaN` in `SplitFlatModal`: **every 3-BHK owner was offered
      one room and could not confirm a split.** The mock `splitProperty`/`unsplitProperty` swallowed
      every refusal, so no mock test could ever have caught it. Now `live-owner-split.spec.js`, and
      moved to the live config's `mobile` project with the rest of its `CROSS_VIEWPORT` entry.

**Mock keepers remaining: none. `e2e/tests/consumer/flatmates/` is 100% live.**

The "recurring reason" this ledger recorded — that several consumer-facing labels read
`getFlatmateReviewStatusMap()` out of localStorage and so "have no browser-readable live source" —
was a description of a missing server capability, not of an impossibility. It was answered by
building the capability:

- **`reviewStatus` seam** — `flatmate_reviews` joined server-side into the feed queries and surfaced
  on the card. Retired `agreement-evidence` (3), `eligibility` (5) and the tier-badge half of
  `rooms-tiers` (5) into `live-review-status.spec.js` (6 tests).
- **flatmate saves** — `V124__flatmate_saves.sql` plus `POST/DELETE /flatmates/saves/{kind}/{id}`
  and `GET /flatmates/saves`. Retired `prefreeze` (1) into `live-flatmate-saves.spec.js` (5 tests).
  The shortlist stores **keys only** and joins the card at read time, which is what lets two of its
  assertions be ones localStorage could not make at all: the shortlist appears on a second browser
  context, and a room repriced after saving shows today's rent rather than the copy taken at tap
  time. Both failed against the old implementation by construction.
- `prefill` (4) and `post-modal` (1) converted directly. `post-modal` was hiding an accessibility
  defect: two `NativeSelect`s rendered with no accessible name, and the mock spec had worked around
  it with positional selectors rather than reporting it.

**The lesson, and it now has eleven instances:** in this repo a "cannot be migrated / no endpoint"
note has never once survived being checked against `Routes.java` and the component source. Every
one of them was a record of what had not been built yet, written in the grammar of a constraint.
Check the route table, not the ledger.

- [x] **Final sweep of the mock side — two tests retired as redundant, not as coverage.**
      - `discovery.spec.js` (1 test, whole file deleted). Its single claim — a seeker's own request is
        announced as theirs rather than offered back as a card — is `live-interactions-board.spec.js:142`
        live, and *stronger*: that test requires other people's cards to render first, so the absence
        is a claim about the filter rather than about an empty board.
      - `post-modal.spec.js` test 2 ("picking a locality via the dropdown and submitting posts the
        request"). `live-my-listings.spec.js:121` drives the identical dropdown→submit path against a
        real server, waits on `POST /flatmates/posts` and asserts **201**, then reads
        `GET /me/flatmate-posts` back on a connection the page is not holding; its second test owns the
        "in review" banner. The mock provider stores the client's own object and hands it back, so it
        could never have produced the failure the live twin catches. Test 1 stays — the two P0 matching
        selects and the Lifestyle dropdown are form-shape claims no route can testify about.
      - Mock suite after both: **220 passed, 4 skipped** (was 222 running + 4 skipped).

- [x] **`e2e/COVERAGE.md` dangling citations closed (flatmates half).** `check:coverage` was failing on
      eight paths; three were flatmates specs retired in earlier waves without their rows being
      repointed. Traced each to its retiring commit rather than guessing the twin:
      `interest-api` → `live-interest-doors` (`7442ae6`), `alerts` → `live-alerts-card` (`046da04`),
      `posting` → `live-posting` (`a8eeb69`, a prose example rather than a row).
      The ten `interest-api` rows could not simply be repointed: that commit **inverted** four of them.
      The mock's "second device" family was reachable only because sent-state came from a localStorage
      map of *this browser's* taps; live, `useFlatmates` restores the CTA from the server outbox
      (`GET /me/flatmate-interests`) on identity change, so a second device arrives already showing
      "Interest sent" and the duplicate is unreachable through the UI. The rows now say that, and the
      409 is cited where it still lives — `live-interactions`, reachable only by a non-UI client.
      Remaining five dangling paths (`admin/duplicates`, `admin/listing-freshness`,
      `consumer/account/{dashboard,owner-finances,owner-hub}`) belong to the **parallel admin session**
      and were deliberately left alone.

- [x] `owner-id-inbox` (1) → `live-host-inbox` — a seeker's interest reaches the host's
      `/dashboard#enquiries` Flatmate tab and **Accept is read back from `/me/flatmate-requests`
      with an independent client**, which is the half the mock could not prove. D186's "ownerId
      bucket, not the mobile bucket" does not port: live scoping is by bearer token, so the defect
      class is structurally impossible. Mock retired.
- [x] `consent` (2) → `live-owner-consent`. The "deferred pending confirmation of API endpoints"
      note in `tasks/flatmates-wave-triage.md` was **stale** — `POST /flatmates/groups/{id}/owner-consent`
      has existed all along. Mock retired. What the conversion found is below.

- [x] **Owner consent is unreachable from the browser on a live build, and the seam method that
      would reach it had never run.** Three findings, one dead code path. **Closed** — see the
      resolution note below the original write-up.

  > **The flow bypasses the seam entirely.** `OwnerConsentModal` runs `useOtpFlow()` against the
  > mock dispatch and writes `setOwnerConsent()` straight to `localStorage`; it never calls
  > `flatmateService`. `Flatmates.jsx:133` only flips `consentVerified` on the *form*, and
  > `useFlatmateSupply.jsx:233` turns that into an `ownerConsent: true` key on the create payload.
  > The server drops it — `FlatmateMapper.applyTo(FlatmateGroupCreateRequest, …)` is
  > `@BeanMapping(ignoreByDefault = true)` and names `ownerConsent` as deliberately not
  > client-settable, which is correct: a tenant who could assert their own landlord's consent would
  > make the record worthless. The only writer is `FlatmateSupplyService.ownerConsent`, behind a
  > purpose-scoped OTP (`OtpCode.PURPOSE_OWNER_CONSENT`) and a self-consent refusal. So live, the
  > tenant completes the OTP, is told "Owner consent recorded", and the group is created with
  > `ownerConsent = false`: no chip, no `flatmate_owner_consents` row, no audit entry. **Fails
  > closed, so a broken feature rather than a hole** — but the anti-broker guardrail does not exist
  > on the live build. Closing it means moving consent *after* group creation (the group id is the
  > route's path variable, and today consent is collected before the group exists) and putting the
  > modal on the seam. **Product/architecture call — not taken unilaterally.**

  > **Both providers had the wrong contract, which is what a method nobody calls decays into.**
  > Fixed, since these are unambiguous. `http/flatmateProvider.js` posted `{ mobile, consent }`
  > where the server's body is `OwnerConsentRequest(@NotBlank @IndianMobile String ownerMobile,
  > String otp)` — `ownerMobile` arrived null, so **every call would have been refused at
  > validation**, and `consent` is a client-asserted boolean the server has no field for. The mock
  > read `body.mobile` for the same reason and then called `setOwnerConsent(id, mobile, …)` against
  > a `(ownerMobile, byMobile)` signature, keying the consent map by the digits of the *group id*
  > and recording the owner as the grantee — the record inverted. Both now speak the server's
  > two-step shape: no `otp` means "send one", an `otp` records it.

  > The general lesson, and it is the fourth time this wave has produced it: **an export that no
  > screen calls is not covered by anything, in either provider.** The mock spec passed because the
  > modal wrote localStorage directly, so neither half of the seam was ever exercised.

  > **Resolved.** The "product/architecture call" above framed the fix as *moving consent after
  > group creation*, because the route's path variable is a group id. That framing was wrong, and
  > the schema said so already: V27 keys `flatmate_owner_consents` on `(owner_mobile, granted_by)`
  > with a **nullable** `group_id`. Consent is a fact about two people, not about one post — so it
  > can be taken while the form is still open, exactly where the UI already asks for it, and read
  > back at submit time. Nothing had to move; a second entry point had to exist.
  >
  > Added `POST /flatmates/owner-consent` (`Routes.Flatmates.OWNER_CONSENT`) and
  > `FlatmateOwnerConsentService`, which now owns normalise / send / record / has for both entry
  > points. `FlatmateSupplyService.createGroup` calls `consentService.has(...)` and sets the flag
  > server-side, so `ownerConsent` stays non-client-settable and the Ops review entry finally
  > reflects reality (`saved.isOwnerConsent()` feeds `publication.enqueueReviewIfNeeded`).
  > `OwnerConsentModal` calls the seam twice instead of `useOtpFlow` + `setOwnerConsent`, and
  > surfaces send/verify failures rather than succeeding on a timer — a wrong code is now a 401 the
  > user sees. `FlatmateSupplyService` shrank 880 → 871; the size-guard pin was ratcheted down.
  > Covered by `FlatmateOwnerConsentEndpointsTest` (6) and a third browser-driven test in
  > `live-owner-consent.spec.js` that proves the modal reaches the database.
  >
  > **This is the twelfth "cannot be done" note in this migration to be a description of something
  > nobody had built yet.** It was also the most convincing, because it named a real constraint
  > (the path variable) — the constraint was just on the wrong route.

- [x] **`uniqueMobile()` could return the same "unique" number twice.** Found by the consent work:
      the helper was `97 + Date.now().slice(-8)`, so two calls with no `await` between them
      collided. My spec named a tenant and an owner back to back, got one number, and the server
      correctly refused the tenant for consenting to themselves — a 400 that pointed nowhere near
      the helper. Elsewhere it would be worse and quieter: two supposedly-distinct actors would
      silently be one account. Now clamped to be strictly increasing, so a worker cannot reissue a
      number, with the format unchanged.

**Ruled 2026-08-23 by the product owner: a converted legacy twin is deleted in the same commit.**
The question was whether conversion deletes the mock-side file (what the notifications, owner-profile
and support-tickets slices did, and what waves 1b/1e did) or leaves it to die at P5c (what `aee968b`
did, producing the 16 byte-identical pairs above). The ruling is the first, stated as *"keep removing
whatever is done and working perfectly with APIs"* — so the legacy file goes as soon as its live twin
is green, and the 16 existing duplicate pairs become a backlog to clear rather than a pattern to
follow. The standing condition is unchanged and is what "working perfectly" means here: the live
twin must actually cover the behaviour, which is a question to answer by reading both files, not by
comparing test counts (`owner-profile` looked like a strict subset and was not).

- [x] **Dashboard split UI wired to the seam — done, and it hid a defect.**
  `MyListingsPanel.jsx` called `splitFlat()` from `lib/data/flatSplit.js` (mock) and
  `ListingCard.jsx:74-77` read split state from `getRooms()` → localStorage key
  `puneNestRoomListings`, so a split performed via the server API never reached the card. Both are
  now on the seam (`flatmateService.js` → `splitProperty`/`unsplitProperty`), which is what
  `live-owner-split.spec.js` drives.
  **The defect this was hiding:** `SplitFlatModal` derived the room ceiling with `Number(bhk)`, and
  `bhk` arrives as `"3 BHK"`, so `Number("3 BHK")` is `NaN` — **every 3-BHK owner was offered a
  single room and could not confirm a split at all.** It was invisible because the mock
  `splitProperty`/`unsplitProperty` swallowed every refusal and returned success regardless, so the
  one provider a test could reach could not express the failure. An unused seam is uncovered; a
  *lying* mock is worse, because it makes the coverage look real.

- [ ] **No server-side badge promotion after deferred approval.** `FlatSplitService.split()` (line
  96-97) sets `verified`/`verificationTier` at creation time based on the parent listing's current
  status. When a pending parent is later approved, there is no callback or event listener to promote
  the rooms. The mock has `reconcileSplitVerification()` (`flatSplit.js:177`) for client-side
  reconciliation — a workaround that has no server equivalent.
  **Deliberately left as a product gap, not a test gap.** The claim "promotes the rooms once the flat
  is approved later" describes behaviour the server does not have, so there is nothing to assert;
  `live-owner-split.spec.js` states this in its docblock rather than carrying a skipped test. Fixing
  it means an event on listing approval that re-derives tier for the split children.

### Closed recently

- **A host was being told "null is interested in your room in Baner".** The flatmate interest
  notification built its title by concatenating `users.name`, which is nullable — and null for
  exactly the person most likely to be sending one, someone who signed in by OTP to answer an ad
  and never filled in a profile. Java renders an absent reference as the four letters `null`.
  `FlatmateSupplyService` already knew the field was nullable: the group-join path a hundred lines
  above carries the null through untouched and explains why (D118 — the schema used to substitute
  the literal "Member", which showed the host a name the platform had invented). The title now
  falls back to "Someone", which is what `OfferService` and `ConversationService` already say in
  the same position: indefinite rather than made up. The body is untouched, because `users.mobile`
  is the login identity and NOT NULL — an unnamed seeker is still reachable, which is what makes an
  indefinite title tolerable rather than a dead end. Three tests in a new "The host's notification"
  nest in `FlatmateEditAndInterestEndpointsTest` read the row the host actually opens; every other
  test in that file seeds named users, which is how this survived. Found while converting the
  flatmate e2e specs.

- **`consumer/property` is live, and converting it found that both halves of the duplicate rule
  had never fired.** Eight mock specs retired for eight `live-` twins — `passport`,
  `deal-visibility`, `chat-owner`, `scheduled-visits`, `alerts`, `detail`, `dedup`, `dup-modal` —
  and the folder now runs **87 ✅** against the API. Two server defects came out of it, both in
  `ListingDuplicateProbe`, both invisible to a mock because a mock stores whatever the client sent
  and hands it straight back:

  > **The meter arm compared spellings, not meters (V115).** V79 added `electricity_meter_no` on the
  > reasoning that a meter number "has one spelling". True of the meter, false of the number: it is
  > copied off a bill that prints it in groups, so one MSEDCL consumer number arrives as
  > `170012345678`, `1700 1234 5678` and `170-0123-45678`, and both queries compared with `=`. The
  > cost landed on the arm that is meant to be the *certain* one — an owner who typed spaces in
  > March and none in April was never told they had already listed it, and two owners fighting over
  > one flat were never flagged — while the weaker address arm kept working, so the platform
  > reported no duplicates and everyone believed it. `electricity_meter_key` follows what V79 already
  > did for `address`: raw column for the human who checks it against a printed bill, derived key
  > for the comparison, written only by `MeterKey` on the server and never accepted from a client.
  > The six-digit floor is not tidiness — an optional field collects `0`, `NA`, `1234`, and under
  > exact equality every owner who typed the same placeholder collides with every other.

  > **The photo arm never left the browser (V116).** The wizard has hashed photos (8×8 average hash,
  > 64 bits) since it was written, and compared them against `localStorage` — which holds only *this*
  > browser's own listings, i.e. precisely the case the rule already declines to flag. So the signal
  > existed, ran on every upload, and could not by construction find the thing it was for.
  > `property_photo_hashes` stores the hash server-side with four 16-bit generated bands; band
  > equality is a pigeonhole pre-filter, exact at Hamming d ≤ 3 against a product threshold of 10, so
  > recall is deliberately partial. That is acceptable *only* because this arm files a case note for
  > ops and never blocks an owner; it would not be acceptable as a gate.

  Worth keeping from the conversion itself. `live-detail` refused to port two of the mock's cases
  rather than translating them: `type: undefined` and `createdAt: undefined` are unreachable live
  (`property_type` is `NOT NULL` per V3, `created_at` is `NOT NULL DEFAULT now()` per V1), so it
  targets the genuinely nullable `bhk` through seeded `p5124` (Open Plot, Wagholi) and asserts the
  exact heading *first*, before the four absences — an all-absence spec that renders nothing passes
  itself. `ConversationOpeningService` was split out of `ConversationService` for the chat-owner
  conversion, which is also the edit that made the next paragraph expensive.

  > **The wave was already finished and green when the previous session reported it as failing.**
  > The verification run went against a JVM booted at 16:43 against sources last edited at 18:34 —
  > including a class that did not exist when the process started. Nothing was wrong with the tree;
  > restarting the backend on the identical commit turned the same command green. `run-e2e-backend.ps1`
  > exists so that restart is one command rather than a paragraph in a config docblock.

- **The notification inbox now asserts across the boundary, and the type it really sends is
  mapped.** `consumer/account/notifications.spec.js` → `live-notifications.spec.js` (7 ✅): the page
  acts, then a *second* API client reads the inbox back outside the browser, so mark-all and dismiss
  are asserted at the wire rather than against the array the test itself wrote. The conversion found
  a live defect — `toUiType` had no entry for `match.saved-search`, the only spelling
  `SavedSearchService.alert()` ever emits, so the one notification the alerts product exists to
  deliver rendered as the grey *unrecognised* glyph and matched **no filter chip at all**, reported
  only by a `console.warn` the runner discards. The seed spells it differently again
  (`saved.search.match`, `R__zz_dev_demo_data.sql:467`); both are mapped, because a mapper taught
  only the seed's vocabulary is green in e2e and wrong in production. Proven RED with the two
  entries commented out and GREEN with them restored. Commit `20ff3dd`.

  > **Follow-up, deliberately not taken in that commit.** `live-property-integration.spec.js` covers
  > the same three behaviours against the *owner*, and two of its tests are guarded by a conditional
  > `test.skip` reading "only flatmate flows write server notifications". That is false — there are
  > **ten** `notifier.notify` call sites (offer, visit, document, contact, message, listing,
  > saved-search and three flatmate paths). Those two tests have been silently passing. Left alone
  > because the file is 2,692 lines and shared by many specs, and changing a shared locator
  > mid-conversion is how a suite-wide flake is introduced.

- **The ops folder needed no conversion wave, and one of its five specs was pinning a lie.** All
  five remaining legacy `tests/ops/*.spec.js` are deliberate mock-mode residue — route guards, which
  are properties of the router, and the "this desk needs the live API" panels, which are mock-mode
  truths that exist nowhere else. Each carries a header saying so and dies with the mock provider at
  P5c. What the read *did* find is that `/ops/referrals` justified shutting itself with a
  disagreement that no longer exists: "pays a perk where the server pays rupees" was reversed by
  **D31b**, which moved the server onto the browser's unit, so both pay owner contacts now. The
  claim survived in four places — the operator-facing panel, `http/referralProvider.js`'s header
  (which contradicted its own next paragraph), `ReferralDto.rewardAmount`'s `@param`, and the mock
  spec asserting the panel word-for-word, which is what held it in place. All four now state the
  half that survived: the mock grants a listing slot by looking the referrer up on a phone number
  the wire no longer carries. Verified: mock ops 14/14, live referrals 5/5, backend compile, lint
  0 errors, i18n OK.

- **The buyer's half of the document gate is on the server (D123 closed).** Uncommitted at the time
  of writing; verified below. `POST /documents/requests` now carries the buyer's *whole* category
  scope in one row, `GET /me/document-requests` is their status source, and the new
  `GET /me/document-requests/{reqId}/documents` is the signed-in read. The viewer route moved from
  `/view-documents?o=<owner mobile>&r=<id>` to `/view-documents/:requestId`, and
  `lib/data/viewDocuments.js` — which read another user's `localStorage` by owner mobile — is
  deleted.

  > **The bug this closes is a consequence of a masked field, not of a missing endpoint.** The old
  > path filed the request under `p.ownerMobile`, which on a live detail read is *masked* until the
  > contact gate is passed, while the owner's dashboard reads its inbox under the real number. Every
  > live document request was therefore filed where its owner could never see it — and the seeded
  > mock spec could not notice, because a mock has no reason to mask anything from itself.

  Three things worth knowing before touching it again. (1) **`shareToken` stays owner-facing.** The
  obvious fix — hand the buyer the token — would have made their own request list a bearer
  credential; the signed-in route gives them the read with nothing forwardable. (2)
  **`sharedDocumentCount` counts files, not categories**, because an owner can approve "Sale Deed"
  before uploading one, and the UI has to tell that honest zero from a usable grant; it is zeroed on
  the requester projection unless the row is granted. (3) **`expired` is derived at read time** from
  `expiresAt`, so the status the list shows and the refusal the document read gives cannot disagree.

  A security review (`security-reviewer`) returned no CRITICAL or HIGH and two worth acting on, both
  applied: `request()` answered a **buyer-facing** POST with the *owner's* projection — not
  exploitable, since only `grant()` writes a token and it moves the row out of `pending` in the same
  call, but it made the redaction a property of a status invariant two classes away instead of the
  by-name projection the mapper's own Javadoc claims; and `myAsks` counted the vault for every row
  before the mapper discarded the non-granted ones, so it now narrows to granted first. The
  reviewer's other three findings were verified and left: a nullable `documents.category` with no
  writer that can produce one, an ASCII-only case-folding difference between the Java count and the
  SQL read, and the mock provider's `localStorage` scan, which `config.js` cannot reach in http mode.

  **Verified:** backend `DocumentRequestFlowTest` 33/33 and `SpecCoverageTest` 3/3 (contract floor
  261 → 262); `document-parity.mjs` PASS; `npm run check:i18n` OK (4,484 keys × 3 locales);
  `npm run lint` at the 0-error baseline; mock e2e `doc-requests-grant` + `view-documents-flow` 4/4;
  live e2e 6/6 with `live-verification-disclaimer` (which shares the domain) and the
  `live-property-integration` vault round-trip re-run for fixture collision.

  **Deliberately not done:** the new endpoint is new, so there is no old code for its live spec to
  go red against — the regression proof is `SpecCoverageTest`'s floor moving, which fails if the
  route is removed. The **owner** inbox's `sharedDocumentCount` is deliberately *not* status-gated;
  every file it counts is in a vault that caller owns.

  The `document.granted` notification now points at `/view-documents/{requestId}` rather than at the
  listing (register 37). It could not before — the viewer route was keyed on the owner's mobile, so
  the divergence from the mock was forced rather than chosen. The accepted cost is that a
  notification outlives its grant, so past `GRANT_TTL` the link 404s; the viewer answers that with
  the neutral "Access not available" and a way out. That copy is deliberately the *same* for all
  four things the endpoint refuses — pending, lapsed, unknown, foreign — since a screen that tells
  them apart undoes the shared 404. An earlier draft read "Access has ended", which the stranger
  test caught: it confesses that something was once there.

  Two stale references were swept for and one was left on purpose. `gen-checklist-xlsx.mjs` now says
  `/view-documents/:requestId`, matching the `:slug` convention the rest of that table already uses.
  **`robots.txt` was left alone**: its line is `Disallow: /view-documents.html`, and so are all
  eleven others — `/dashboard.html`, `/saved.html`, `/signin.html` and the rest. The file is
  prototype-era in its entirety and there is no `frontend/public/`, so Vite does not ship it; it is a
  launch-time artifact needing one rewrite against the real SPA routes. Correcting a single line
  would leave it *more* misleading, by implying the other eleven had been checked.

- Ledger 20 (finance console) is shipped and verified (`023c311`).
- Ledger 35 (`GET /geo`) is shipped and closed in the decision register.
- Rent-agreement co-fill (V107) — backend at `b7bc2fa`, frontend seam, wizard and live e2e at
  `499732d`. Run and green: 5/5 in the live service-request block. The run earned its keep — it
  caught `http/serviceRequestMapper.toViewModel` dropping `parties` on the wire, which no mock spec
  could have seen, since the mock builds its own party list.
- **The three society gaps opened by `87f2d07` are closed on the server.** The cross-society
  residents queue is `GET /admin/society-residents` (read-only: deciding stays on the per-society
  route that already owns the one-verified-resident-per-flat rule). Claims carry `registrationNo`
  and `certificateDocumentId` again (V109). Mint provenance is `mint_origin` (V108), a separate axis
  from `source` rather than an extension of it, and null on every row minted before it existed —
  which the candidates chip now renders as nothing rather than guessing.
- **The society merge and the claim certificate have a server** (`da957af`). Merging is
  `/admin/society-merges` (V111) and is a pointer rather than a move, which is what makes the undo
  possible. The certificate is `GET /admin/society-claims/{id}/certificate`, keyed by the claim so
  that `societies:read` never becomes a key to arbitrary personal documents.
- **`SocietyMembershipService` is two services.** Adding the certificate read pushed it to 469
  lines and `ServiceSizeGuardTest` refused the build. It was split by use-case rather than by layer:
  residency stays in `SocietyMembershipService`, and claiming — `claim`, the ops queue, the
  certificate and the decision — moved to `SocietyClaimService`. The seam was already there, since
  "does this person live here" and "does this person speak for the building" are decided by
  different people on different evidence. The BASELINE escape hatch was deliberately not taken.

## Needs attention

Open items with no ledger row. Anything covered by a decision is cited, not restated.

**`PayRent` shows a convenience fee it computed from the bundle, for one round trip.** Surfaced by
the review of the `PricingProvider` deferral (2026-08-31), but pre-existing and not caused by it.
`PayRent.jsx` derives the displayed breakdown locally — `quoteRentFee(numv(amt), { rentPayPercent:
prices.rentPayPercent, gstPercent: prices.gstPercent })` — because there is no quote endpoint, and
the comment above it argues this is safe "because the two use identical arithmetic". Identical
arithmetic over *different inputs* is not identical: until `GET /pricing` lands, `prices` is
`PRICING_DEFAULTS`, so on an install whose operator has changed `rentPayPercent` or `gstPercent`
the tenant is shown a fee the server will not charge. The `expectedAmount` concurrency guard does
not cover it — that field carries the rent, not the fee. Always true on a refresh or a deep link
into `/pay-rent`; the deferral widened it to arriving by an in-app click as well. The fix is a
"a server read has landed" signal from the provider that `PayRent` alone waits on, **not** making
the provider eager again — eagerness only moves the same window back onto every page that cannot
display a price, which is the request the deferral removed. Needs a product call on whether the
breakdown may render from defaults at all, or should hold until the read completes.

**`live-fees-and-photos.spec.js` "the plans page renders the figures that request returned" is red,
and the product is right.** The test picks FAQ 5 as its witness on the stated grounds that it
"interpolates `fee('ownerPlanYearly')` and `fee('ownerProYearly')` directly and nothing else feeds
it", and explicitly rejects the plan card because "a card's price is overridden by the `plans`
catalogue when that table has the row". `Plans.jsx` introduced `priceOf()` — which reads the
catalogue first and falls through to `fee()` only when it is unreachable — and routed the FAQ
through it, precisely so a sentence about a plan cannot quote a different number than the card for
that plan. The reason the card was the wrong witness is now the reason the FAQ is. So the assertion
fails on `₹999` (`/pricing`) against a rendered `₹2,499` (`/plans` catalogue, and the price actually
charged), which is the correct number.

This is stale prose in a test, not a defect: the docblock states a fact about the component that
stopped being true, and nothing executable disagreed with it. Retargeting it is not free, though —
what it was built to prove is that a browser which never issues `GET /pricing` renders the same
figures as one whose request succeeded, and no `fee()`-only witness survives on `/plans` (FAQ 4's
`RENT_FEE` prefers `GET /fees` by the same design). That claim is already carried by the two tests
above it, on `/pricing` and on `/refer`, so the choice is between deleting the test and re-pointing
it at the catalogue — where it would duplicate `consumer/services/live-plans-checkout.spec.js`.
Needs a call before either.

**The deploy's `/api` proxy now exists, and two operational values still have to be decided before
it works.** Production had no path from the built bundle to the API. The topology every other piece
of the design assumes — `API_BASE = '/api'`, `connect-src 'self'`, `SameSite=Lax`, `CookieDeliveryCheck`
refusing any cross-site shape — is *one origin*, and nothing in the deploy config produced one:
`netlify.toml` declared only the SPA fallback, so `/api/*` resolved to `index.html` with a 200. The
one alternative left, an absolute `VITE_API_BASE`, is blocked by our own CSP and would kill every
session at the first token expiry. `scripts/gen-redirects.mjs` now writes `dist/_redirects` from
`API_ORIGIN` as part of `build`; `_redirects` is matched *before* `netlify.toml`, so the proxy is
always reached first and the toml keeps its fallback as the net for the script not running at all.

Still undecided, both on the backend side of the same topology:

- **`INTERNAL_PROXIES` has no answer on Netlify.** All traffic now arrives from the host's egress,
  and `WriteRateLimitFilter` keys anonymous callers on the client address, so the value has to match
  that egress or the entire internet lands in one bucket — and `POST /page-views` is `permitAll` and
  fires on ordinary browsing, so the 120/60s budget is reached by traffic, not by an attacker. A
  *permissive* regex is worse than none: the backend stays directly reachable at `API_ORIGIN`, so
  anyone matching it picks their own bucket via `X-Forwarded-For`. Netlify publishes no egress CIDR
  below Enterprise, so on Netlify there is no correct value to write. Two real exits, both requiring
  the host decision first: lock the backend at the network layer to the proxy and pin the range, or
  use Netlify **signed proxy redirects** (`signed = "ENV_VAR"`) so the proxy proves provenance with
  a JWT — note that is a `netlify.toml`-only feature, so taking it means hardcoding the backend host
  there and moving the `/api/*` rule out of the generator.
- **No spec covers it, and none can here.** Playwright drives Vite, whose own proxy makes the
  question moot — the same blind spot `CookieDeliveryCheck` exists to cover, and the reason that
  check is a boot-time assertion rather than a test. Note the check becomes a tautology in this
  topology (`WEB_ORIGINS` and `API_PUBLIC_ORIGIN` are both the UI origin, so it compares a value
  with itself); it is guarding the topology we did *not* choose. Verification is a deploy that
  boots, plus one authenticated request surviving a 15-minute expiry — which also settles the one
  thing neither Netlify's docs nor this repo can answer: whether the edge forwards `Cookie` to an
  external proxy target at all. The entire refresh design rests on it.

**Refresh-token grace forgiveness is now bounded per family (H1), and it has no e2e spec — by
construction, not by omission.** The grace window in `RefreshTokenService.rotate` forgives a replay
that lands within seconds of the rotation it lost to, so two tabs racing do not sign the user out.
That forgiveness was unbounded, and "the window is only seconds" is not the bound it sounds like: an
attacker holding a stolen token who keeps rotating keeps the family's head permanently fresh, so
every replay the victim makes lands inside a window the *attacker* is holding open, and vice versa.
Every exchange is one hop deep, so `MAX_GRACE_HOPS` never cuts it off either. Both parties ping-pong,
each one forgiven, for the full 30-day TTL — reuse-detection present, and never firing.

Fixed by `refresh_tokens.graced_count` (`V126`), which counts *consecutive* graces along a rotation
chain: a forgiven replay increments it, an uncontested rotation resets it to zero, and the family is
burned at `MAX_CONSECUTIVE_GRACES = 3`. Consecutive rather than lifetime is the load-bearing choice —
an honest client races once and then rotates cleanly, so it never accumulates, whereas the attack is
contested at every step and so never resets. V126 also indexes `rotated_from`, which the chain walk
has always queried and which carried no index at all.

**Why no Playwright spec, and why that is the honest answer rather than a gap to fill later:** the
attack requires two independent parties holding the *same* refresh token. A browser cannot express
that, because the token is an `HttpOnly` cookie the page is not allowed to read — the very property
`live-flow.spec.js` asserts. A spec could only fake it by reaching into the cookie jar, which would
be testing Playwright's privileges rather than the product's. `RefreshGraceWindowTest` drives the
service directly, which is the level at which "these two clients hold one token" is actually
sayable. Its `forgivenessIsBoundedPerChain` was mutation-checked (limit raised to 10 → the test
fails at the assertion that the fourth exchange is refused), so it is known to be load-bearing and
not merely green. The user-visible consequence — a burned family surfaces as a 401 and a sign-out —
is already covered by the existing reuse-detection specs.

**"Remember this device for 30 days" meant seven on Safari, and the surviving credential was
unreachable.** Safari's ITP evicts *script-writable* storage — `localStorage`, IndexedDB, and
cookies written through `document.cookie` — after seven days without first-party interaction, and
leaves server-set `Set-Cookie` cookies alone. So `punenest_rt` survived its full 30 days while
`puneNestUser` and `puneNestTokens` were wiped at seven; and nothing spent the cookie, because a
cold boot with no cached user did not revalidate, and `http.js`'s 401 recovery refuses to refresh
when there is no access token. That refusal is right for every ordinary request — an absent token
means signed out — so the fix could not be to loosen it, or every anonymous page view on an
SEO-driven marketplace would retry through `/auth/refresh`.

Fixed with a second cookie, `punenest_session`, set by the server beside the refresh token and
deliberately **not** `HttpOnly`: `Path=/`, no identity in it, same `Max-Age`/`Secure`/`SameSite`,
cleared by the same logout that clears its twin. Being server-set, ITP spares it; being readable,
`sessionHinted()` can consult it at cold boot; carrying nothing, making it readable costs nothing an
XSS could not already learn by calling `/auth/refresh` and reading the status. The boot path then
spends exactly one refresh for the users who have a session to recover, and nothing at all for
everyone else. Unlike H1 this *is* browser-observable, so `live-flow.spec.js` covers both halves
— storage wiped with the jar intact, and logout leaving nothing behind.

Its value is `1` or `0` rather than a bare presence flag, and that second bit was not foreseen — it
came out of the e2e run. `/auth/refresh` has to be told `remember` on every rotation, because the
browser tells the server nothing about the lifetime of the cookie it presents, and the client
derived that flag from *which storage tier held the tokens*. That derivation is exactly what the
wipe destroys: both tiers empty, the client answers "not remembered", and the refresh that rescues
the session trades its 30-day cookie for a session-scoped one and writes the tokens to
`sessionStorage`. The recovery would spend the promise it exists to keep — silently, and destroying
a credential that was still good. So `sessionRemembered()` prefers the tokens while they exist (they
are written last, and cannot claim a tier that does not work) and falls back to the marker only when
storage holds nothing, gated on a real `localStorage` write probe so the storage-*blocked* case
still degrades to a tab-scoped session rather than writing into a store that throws.

**The refresh cookie's delivery invariant is now enforced at boot instead of assumed (C1).**
`SameSite=Lax` means the browser only returns `punenest_rt` when the page and the API are the same
*site*. Two topologies satisfy that and both are now supported deliberately: a path proxy putting the
UI and `/api` on one origin, or sibling subdomains (`www.` → `api.`), which is cross-origin but
same-site — `CorsConfig` already sets `allowCredentials` with an env-driven exact origin list, so
that arrangement needs no code. What breaks it is a UI under its own registrable domain, and
`*.netlify.app` is exactly that: a Public Suffix List entry, so every Netlify subdomain is its own
site.

That failure is the dangerous kind — the browser withholds the cookie *silently*, so refresh 401s,
every session dies fifteen minutes after login, and the server log is indistinguishable from a
visitor who was never signed in. Nothing before production can catch it either, since dev and e2e go
through the Vite proxy where everything is same-origin by construction. `CookieDeliveryCheck` now
compares the registrable domain of `punenest.web.public-origin` (`API_PUBLIC_ORIGIN`, mandatory in
prod) against every configured UI origin and refuses to start, with a message naming both topologies
that would fix it. It skips when the public origin is unset (dev, tests) and when `SameSite=None` has
been chosen, logging in that case the CSRF debt that choice takes on — `None` buys cross-site
delivery by deleting the argument for `/auth/refresh` having no CSRF token.

**The cookies are now `__Host-` prefixed, and the `/api/auth` path scoping was given up to buy it.**
Found by the security review of the ITP work, and it is a finding created *by* that work rather than
one it merely uncovered. `Secure`, `HttpOnly` and `SameSite` all constrain what a *page* may do with
a cookie; none of them constrain what another *host* under the registrable domain may put in the
browser's jar. A `Domain=.punenest.in` cookie named `punenest_rt` is a distinct entry from our
host-only one, neither our clear nor the client's can remove it, and which one the server is handed
first is unspecified. Before the ITP restore that was a stubborn logout bug. After it, the cold boot
*acts* on a surviving session automatically, so the same shadowing became a fully automated session
fixation: plant a token and a marker from any sibling host, and the victim's next launch signs their
browser into the attacker's account with no interaction at all. The same trick on the marker alone
defeats the offline-logout fix below and silently demotes a remembered session.

Browsers refuse to store a `__Host-`-named cookie unless it is `Secure`, carries no `Domain`, and
sits at `Path=/` — which converts "we set no `Domain`" from an intention into an enforced property,
and is the only mechanism that does. The price is the `Path=/api/auth` scoping, and that is a good
trade on inspection rather than assumption: path scoping only ever defended against *our own* code
logging or forwarding a request carrying the cookie, and a grep for
`getHeaderNames|getCookies\(\)|HttpHeaders.COOKIE|CommonsRequestLoggingFilter` across the backend
returns nothing. A self-imposed hygiene rule was exchanged for a browser-enforced one.

Because a browser rejects the prefix without `Secure`, the names are derived at runtime from
`refresh-cookie.secure` — prefixed in prod, bare over plain-HTTP dev and e2e — and no test hardcodes
either spelling. `RefreshCookieNamingTest` pins **both** shapes with plain constructor calls, which
matters more than it looks: every `@SpringBootTest` runs on one profile and therefore exercises one
set of names, so without it the production shape would be the untested one. That is precisely the
profile-shaped blindness `CookieDeliveryCheck` exists to end, and it would have been careless to
reintroduce it in the same change. `presented()` and the client's `readHint()` both now refuse a
*duplicated* cookie rather than picking one, because two entries of one name is an attack signature
and honouring either is a coin flip on whose session the caller lands in.

**Deploy note (L2):** every already-signed-in user is signed out once on the release that renames the
cookie. Nothing is lost and the next sign-in is normal, but it belongs in the release note.

**A sign-out the server never heard about was reversed by the next cold boot.** The react review's
critical finding, and again a consequence of the restore rather than a pre-existing bug.
`POST /auth/logout` is best-effort by design — a user on a dying connection must not be trapped
inside a signed-in app — but with the marker surviving beside an unrevoked refresh cookie, the *next*
launch used exactly that pair to sign the user back in. On a shared device that is the previous
person's account reappearing after they visibly signed out. `logoutUser()` now expires the marker
itself, so the recovery path is shut even when the revocation never lands; a Playwright test aborts
the logout request at the network layer and asserts across a full navigation, since anything short of
a reload tests the in-memory context rather than the boot decision.

Three smaller findings from the same round: the "remember" *choice* and the question of whether
`localStorage` is *writable* were being answered by one function, so a transient `QuotaExceededError`
told the server `remember:false` and irreversibly downgraded a live 30-day cookie — they are two
questions now, asked in two places. A 429 or 5xx from the boot refresh was being treated as "no
session" and destroying the marker, which is reachable through the anonymous IP bucket behind
carrier-grade NAT; only an actual answer (401) counts now. And the boot effect ignored the session
generation counter, so a sign-out landing during revalidation was overwritten by the in-flight
`GET /auth/me`.

**Known and accepted, not fixed:** the sibling-subdomain topology cannot deliver the *readable*
marker at all — `document.cookie` is host-scoped and `__Host-` forbids the widening `Domain` — so the
ITP recovery is inert there. `CookieDeliveryCheck` warns by name at boot rather than failing, because
nothing is broken that was not broken before the marker existed, and refusing to start over a lost
optimisation would be disproportionate. The warning states the correct repair (path proxy) and the
tempting wrong one (`Domain=`, which reopens the shadowing above), because that is the first thing an
operator reading "unreadable cookie" will reach for.

**The code review found two HIGH issues in the above, both fixed in the same pass.** Recorded
because both are the same *kind* of mistake — a fact inferred from a proxy that used to be equivalent
and had just stopped being so — and neither was reachable by any test that existed.

1. **`sessionRemembered()` demoted a live 30-day session, permanently.** It answered from the storage
   tier whenever tokens existed, and the tier is *where the write landed*, not *what the user asked
   for*. `persistTokens` deliberately breaks that equivalence — it writes tab-scoped when
   `localStorage` is unwritable while keeping the 30-day cookie — so a single transient
   `QuotaExceededError` made the next rotation post `remember: false`, the server swapped the
   persistent cookie for a session one and rewrote the marker to `0`, and the record of the choice
   was then gone from both places with no path back short of a fresh sign-in. Two tabs at different
   tiers reach it too. Now the marker is consulted first and the tier only as a fallback for the
   sibling-subdomain topology where the marker is unreadable. Note the shape: adding the marker is
   what made the old code wrong, and the docblock arguing for the old order was written in the same
   commit that invalidated it.

2. **The e2e session cache began burning its own refresh token.** `signedInAs` replays a snapshot by
   restoring cookies, loading the page, *then* writing storage. Once the snapshot included the
   marker, that first load was — correctly — the ITP recovery case: marker present, storage empty,
   so the app refreshed and the server rotated the token behind the cache's back. The third replay
   of any mobile then presented a spent token, reuse detection burned the family, and an unrelated
   later test died at a locator. Invisible to `tests/platform/auth`, whose specs use unique mobiles
   and never take the replay branch. Fixed with `addInitScript`, so storage exists before the app
   boots. `SESSION_MAX_AGE_MS`'s docblock argued this was unreachable below `accessTtl`; that
   argument only ever covered the 401 route, and the marker opened a second one. Rewritten.

Also fixed from the same review: the boot path's `logoutUser()` was outside its `stale()` guard, so a
sign-in completing during an in-flight restore had its token, profile and marker deleted while React
kept saying "signed in" — unrecoverable without a manual sign-in, since `http.js`'s 401 recovery needs
a token to exist and the marker was gone too. The client derived the marker's name from
`location.protocol` while the server derives it from `refresh-cookie.secure`; those disagree under an
HTTPS tunnel in front of a dev backend, which is exactly the rig you would use to reproduce ITP on a
real iPhone — the client now reads whichever name is present, preferring the prefixed one. `readHint`
now rejects blank and unrecognised values as the server's `presented()` already did (they otherwise
read as "session exists" *and* "not remembered", the worse half of both). `presented()` logs the
duplicate-cookie refusal, which was previously indistinguishable from an ordinary expiry from every
side. Four `Sec-Fetch-Site` and hint-clear tests were added: the gate had **zero** coverage, and
because MockMvc sends no such header it takes the "treat as ours" branch, so the whole condition could
have been deleted without turning anything red.

**A local-only trap this created, now in `docs/LOCAL_DEV.md`:** on the `dev`/`e2e` profiles the cookie
keeps its unprefixed name, so the pre-change cookie at `Path=/api/auth` and the new one at `Path=/`
share a name at different paths. A browser will not replace one with the other, both are sent, and
`presented()` correctly refuses to guess — a permanent silent sign-out that a fresh sign-in does not
fix. Production is immune, because there the rename to `__Host-punenest_rt` means they cannot collide.

**A pre-existing red found while verifying the above, fixed: every saved-search alert the UI created
came back label-less.** `live-alert-match-count.spec.js` was 5-of-6 red before any of this work, and
attributing it mattered — it sits in the file list the code review flagged, so the easy reading was
"my e2e replay fix regressed it". It had not. The write side sends the human summary as `name`
(`toCreateRequest`, because `SavedSearchCreate` has no `label` field and the server leaves a listings
alert's stored `label` null); the read side was `label: row.label || ''`. So the round trip dropped
the one value the write path took care to send, and the dashboard retention strip titled every
UI-created alert "your saved search". Introduced by `d5fd18ac` (2026-08-28), which correctly deleted a
`filters.label` fallback — that route genuinely did not exist — and did not notice the `name` route
that did. Fixed as `row.label || row.name || ''`; the spec passes 6/6 and needed no change.

The shape is worth keeping: both halves of the seam were individually defensible, the field is spelled
`label` on one side and `name` on the other, and the symptom was a plausible-looking placeholder
rather than an error. Nothing failed except one e2e spec that had been quietly red for days.

### The rest of the review queue, closed

**Four LOW findings from the frontend review.** `localStorageWritable()` now memoises the
*successful* probe only. The probe is a `setItem` + `removeItem`, which fires two `storage` events in
every other tab, and five listeners in this app are still unfiltered by key — so the cost was real and
it was paid on every write. Only the success is cached, deliberately: a *failed* `setItem` writes
nothing and therefore emits no event, so re-asking is free, and "cannot write" is the transient answer
(a quota that clears, a private-mode tab) whereas "can write" is the sticky one. Caching the sticky
answer and re-asking the transient one is the way round that is correct; the reverse would have
latched a temporary failure forever. Caching `true` cannot go stale in a way that matters, because
`writeKeyed`'s real `setItem` runs immediately afterwards inside its own `try`.

`http.js` now annotates the errors that escape a failed token refresh. The refresh's own failure was
being handed to a caller that asked for something else entirely, so a saved-properties fetch reported
"Too many requests" for a limit the user never hit. The status is deliberately preserved — it is what
makes the failure legible as transient and retryable, which is the whole reason these are rethrown
rather than turned into a sign-out — so only the attribution was wrong, and only the attribution is
fixed: `duringRefresh = true` plus a prefixed message, annotated in place rather than copied, because
a copy loses the stack.

`AuthEndpointsTest` now asserts the hint's `Max-Age` against `JwtProperties.refreshTtl()` rather than
only against the sibling refresh cookie. The sibling is not an independent witness — both are built
from the same field a line apart — so the pair could agree perfectly while both being wrong. Asserted
as a duration rather than a literal `2592000` so a config change moves the test with it.

And `live-flow.spec.js` gained the pair to the ITP-rescue test: **the same rescue must not promote a
session the user declined to have remembered.** `remember` is restated from a single value on every
rotation, so asserting only the remembered case leaves "always send `true`" green and asserting only
the unremembered case leaves "always send `false`" green. Together they pin the flag to the user's
actual choice. The marker's value and the cookie's session scope are asserted *before* the wipe too,
so a failure reads as "login recorded the wrong thing" rather than as a broken recovery.

**Java review, H2 and M1: one advisory lock closes both.** `revokeAllForUser` read the family under a
plain `READ COMMITTED` snapshot, so a sibling tab rotating concurrently could commit a row the burn's
snapshot never saw — and the survivor of a family burn is precisely the credential the burn exists to
destroy. It failed silently, too: every row the burn *did* see was revoked, so the operation reported
success.

Adding `@Lock(PESSIMISTIC_WRITE)` to `findByUserId` fixes that and creates the second problem, which
is why they are one change. Every row lock in this service is taken on a row chosen by the *request* —
a token hash, a predecessor id — so two concurrent calls for the same user acquire the same rows in
whatever order their tokens happen to give them. Tab A rotates token 1 and trips the tripwire; tab B
rotates token 2 and trips it too; each now holds the row the other needs. Postgres aborts one, and the
aborted one is a family burn rolled back in a way `noRollbackFor` cannot rescue, because the abort
belongs to the database and not to the exception. Reuse-detection would fail open exactly when two
sessions contend — which is the shape of the attack it watches for.

So a single `pg_advisory_xact_lock`, keyed on the user, is taken before any row lock: one total order,
no cycle. `_xact_` because there is no unlock to forget on a throw and the reuse path throws by
design. The key is folded from the UUID in Java (`msb ^ lsb`) rather than by `hashtext` in SQL, which
is an internal function with no compatibility promise; collisions merely serialise two unrelated
families now and then, because the key selects a lock and never identifies a row. Postgres-only, which
is fine — every profile including the test database is Postgres.

`rotate` receives a raw token and does not learn the owner until it has looked the token up, so it now
reads `user_id` once without a lock purely to choose which lock to wait on, then re-reads the row
under both. Safe because nothing is decided on the unlocked read: `user_id` is written at insert and
never updated, so it cannot be stale, and an unknown token short-circuits before it queues behind
anyone's lock.

**Java review, M3: the grace window had no floor and no ceiling.** Three durations decide whether a
session exists, and they are read from a file an operator edits by hand — so a typo is the expected
failure, not an exotic one. What makes it worth a boot guard rather than a comment is that every
mistake here is *silent*. `refresh-grace=30d` forgives every replay for the life of the token, so
reuse-detection is off while every line implementing it stays exactly as written, and no test turns
red. `MAX_CONSECUTIVE_GRACES` does not save it either: a stolen token is served from the live head, so
the thief rotates cleanly from then on and never accumulates a second consecutive grace. A negative
value inverts the thing, putting the freshness floor in the future so the tripwire fires on the honest
races it was written to forgive. The compact constructor now rejects both, plus non-positive TTLs and
an access token configured to outlive its own refresh token.

**Java review, M4: profile order decided whether the refresh cookie was `Secure`.** Both properties
files are right — `prod` sets `true`, `dev` sets `false` — and that is the trap: Spring resolves from
the *last* profile that defines a property, so `prod,dev` yields `false` and `dev,prod` yields `true`
from two lists that read as the same list. Nobody writes `prod,dev` on purpose, but a deploy script
appending a profile to an existing variable produces it, and profile order is not something an
operator has any reason to treat as load-bearing. The cost is the whole point of the cookie: a
thirty-day credential sent over any plain-HTTP request to the site, with no symptom at all, and
`__Host-` host-binding silently dropped along with it since a browser rejects that prefix without
`Secure`. `DevProfileGuard` now refuses to boot on the *resolved* value — the only reading that
survives the ordering — reusing `deploymentEvidence` so "is this a deployment?" has exactly one
definition, and so the instance that never activates `prod` but sits behind a load balancer is caught
too. The message names the profile-order cause, because that is the fix nobody would guess.

**Java review, H3: the grace window forgives the loser but not the cookie, and the fix is not on this
side.** Two tabs race, the loser is graced — and both responses carry a `Set-Cookie`, so the jar keeps
whichever lands last. The graced tab's rotation revoked the token the winner's response is still
carrying, so if that response lands second the browser ends up holding a revoked token. Nothing fails
then; it fails fifteen minutes later, outside the window, as a family burn caused by the exact race
the window was added to survive.

Both server-side repairs the review offered were worked through and neither survives. *Not revoking
the heir on the graced path* fixes the reorder and breaks a commoner case: a single tab whose response
is dropped in flight retries with its spent token, is graced, and under that rule gets no new cookie
at all — so it is still holding a spent token when the window closes. The re-rotation is what rescues
that. *Grading against "an ancestor of the live head, revoked recently"* does not address the scenario
at all, because in the reorder case the ancestor was revoked fifteen minutes ago too; and dropping the
time bound to make it fit forgives a thief who lifts a token right after any rotation for as long as
the victim stays idle, which is not a bound. So the control is the client-side Web Lock, which was
already in place — the change is that both sides now say it is *load-bearing* rather than an
optimisation, with the hazard spelled out, so nobody simplifies it away on the grounds that the server
forgives the loser anyway. Residual, stated rather than claimed fixed: a single tab that loses its
response and retries outside the window still burns the family.

**Java review, M5: a sibling subdomain could sign every visitor out.** `SameSite=Lax` is the whole
CSRF argument for `POST /auth/refresh`, and it is sound — but it is a statement about *sites*. In the
sibling topology it is the only one Lax works in, so every other host under the registrable domain
clears it: a marketing microsite, a third-party-hosted status page, a stale DNS record someone else
can claim. Any of them can `fetch(..., {credentials:'include'})` and the browser attaches the refresh
cookie. CORS censors the *response*, which is why this looks harmless, but it does not cancel the
request — the rotation has already happened, the visitor's cookie is now spent, and their next refresh
minutes later trips reuse-detection and burns every session they have. One page visit, a global
sign-out, delivered through the machinery built to protect them.

`RefreshOriginGate` now runs as the first statement in `refresh()`. It allows `Sec-Fetch-Site:
same-origin` (which no sibling can produce, and which covers the Vite dev proxy and any API-under-the-
frontend-domain deployment), allows a request with no fetch metadata at all (curl, contract tests, a
future mobile client — the attack needs a browser to supply the cookie, so refusing those closes
nothing and breaks a lot), and otherwise requires the `Origin` to be one we serve. That last clause is
what keeps the sibling topology working, where the legitimate frontend genuinely *is* same-site and
the only thing distinguishing it is which origin it is. The allow-list is `CorsConfig`'s, shared as a
constant rather than re-typed, because "may this origin talk to us with credentials" is one question
and two `@Value` strings would eventually be two answers to it. Refusal is a 403 before the cookie is
read — the status because a 401 here would be indistinguishable from the steady background of expired
sessions and would waste the only signal a subdomain takeover produces; *before the cookie is read*
because the hint clear that rides on a 401 is itself a free write primitive. The test that matters is
the one asserting the refresh token is **still usable** after a refused same-site request: a gate that
returned 403 but rotated first would pass everything else and change nothing.

**Still open from the security review:** `remember` on `/auth/refresh` is client-supplied, so an XSS
can upgrade a tab-scoped session to a persistent one that now auto-resumes; the fix is to persist the
user's stated `remember` on the token family server-side, which would also retire the
`sessionRemembered()` inference chain entirely. And `siteOf()`'s hand-rolled public-suffix set fails
*permissive* on suffixes it does not know (`amplifyapp.com`, `workers.dev`, `ondigitalocean.app`,
`co.jp`, `ac.in`, …) — a missing entry lets a bad topology boot, which is no worse than having no
check, but it should not be mistaken for completeness.

**Still unresolved: `frontend/netlify.toml` has no `/api` proxy.** If Netlify stays the frontend
host, one must be added — the boot check will now refuse to start a backend configured to serve a
`*.netlify.app` origin directly, which is the loud version of a failure that used to be silent, but
it is still a decision someone has to make before the first deploy.

**`live-rent-agreement.spec.js:160` is red on a premise the application correctly refuses.** The
test signs in as a brand-new account (`signedInAsNew`) and then opens the wizard at
`?listing=<firstPropertyId()>` — the first row of the *public* catalogue, which that account does
not own. The wizard resolves the URL against `myProperties`, i.e. `GET /me/listings`, so the
listing never resolves, `propertyId` stays `undefined`, and `generate` stops at its own guard
("Choose one of your listed properties before submitting documents") because the test uploads an
owner document. No `POST /service-requests` is ever sent, and the spec dies waiting for it.

The guard is right — `POST /service-requests/{id}/docs` 409s without a `propertyId`, which the
spec's own comment records — so **the fix belongs in the spec**: give the new account a listing of
its own and open the wizard from that, rather than from a stranger's. Verified pre-existing, not
caused by the listings-count work: probed live, a fresh account's `/me/listings` is empty while
`/properties?size=1` returns `f1c7…5145`; the client-side guard arrived in `8077536b`
(2026-08-28) and the account-scoped load in `537b418f` (2026-08-20), both before that work. The
other 10 tests in the three rent-agreement files pass.

**~~`owner` is a role the application can never assign, and `users.listings_count` is a dead
column.~~ FIXED 2026-08-31 — shape (a).** Kept for the reasoning; the ledger row is the spec.

`setRole(` had no call site outside account creation and both signup paths hardcode
`new User(mobile, Roles.Wire.BUYER)` (`UserService:92`, `:124`), so a consumer who posted twenty
listings was still `buyer`. `users.listings_count` (declared `V2__identity_access.sql:22`) had
**zero writers** — no `setListingsCount` anywhere in Java, only `R__zz_dev_demo_data.sql`. Both
were invisible in dev and e2e because the demo seed hardcoded `role` *and* `listings_count`, so
seeded data modelled a state the running application could not reach. **That is the lesson worth
keeping**: the obvious cheap fix, `listingsCount > 0`, would have compiled, passed review and
shipped a permanent `false`, because the field it reads was filled only by fixtures.

What shipped:
- `User.recordListingPosted()` — an increment, deliberately not a setter, so the only expressible
  change is the true one. Called once from `ListingService.createOnBehalf` (which `create`
  delegates to, so self-serve and the concierge desk both count).
- `V125__backfill_user_listings_count.sql` for existing rows, and a recompute appended to the demo
  seed so fixtures stop asserting a state the product cannot produce.
- `ReferralService.channelOf:381` now reads the counter, so the "which side did they join on"
  metric can report `owner` for the first time.
- `AuthContext` exposes `hasEverListed`; `Plans.jsx:86`, `Plans.jsx:260`, `Refer.jsx:313` and
  `ProfileTab.jsx:347` read it instead of `role === 'owner'`.
- `useRentAgreement.js:662` lost its redundant role clause — `myProperties.length > 0` was already
  the predicate. Nothing on screen changed, and that is worth stating: `showPropertyPicker` is
  **write-only** (eslint: assigned, never read), because `StepProperty` decides the picker's
  visibility from `myProperties.length` alone. The dead clause was removed because a constant
  `false` reads as a live rule to the next person, not because it was suppressing anything.
- `platform/live-listings-count.spec.js` (3 tests) + a `COVERAGE.md` row, and
  `ListingCountTest` (4 tests) at the backend seam — see the review note below for why the e2e
  spec alone was not enough.
- `ReferralQualificationTest:307` had asserted `channel == "owner"` from a fixture built with
  `role = "owner"` — i.e. it was passing on exactly the coupling this change severs. A redeemed
  code fires seconds after signup, so a real account has posted nothing and `seeker` is the only
  honest answer; the assertion now says so. Found by the full suite *after* the fact, which is the
  process lesson: the change had been run against its own new tests only. The D60 guard the test
  exists for is untouched — a leaked share channel would read `whatsapp`, which `seeker` catches
  exactly as `owner` did.

`role = 'owner'` was ruled out as the fix (decision 2026-08-31): a stored role needs both a
promotion and a demotion hook, and `UserTimelineRepository:46` records this codebase already being
bitten once by gating on `role = 'owner'`. Shape (b) — serving the flag from `GET /me/listings` —
was the alternative; (a) won because `identity` is **layer 0, shared kernel only**
(`docs/system/package-structure.md:74`) so `SelfProfile` cannot import `PropertyRepository`, while
`catalog` → `identity` is legal, and because it repaired the admin directory and `channelOf` at
the same time.

**Left standing on purpose:** `listings_count` counts every listing ever posted, including the
rejected and the archived, and is *not* the live count `PropertyRepository:463` and
`OwnerProfileResponse:36` compute at the point of use. Both meanings are real and the two must not
converge — `Dashboard.jsx:93` keeps its own separate `isOwner` (live inventory), which is why the
context predicate is named `hasEverListed` rather than sharing that name. A future change that
decrements the counter would look like tidiness and would demote owners whose first listing was
rejected; the third test in the spec exists to turn that red.

**What three review passes changed, and the one that mattered.** Reviewed by `java-reviewer`,
`code-reviewer` and `react-reviewer`; no CRITICAL from any of them. Two findings were worth more
than the rest:

- **`User` now carries `@DynamicUpdate`, and it is load-bearing rather than a micro-optimisation.**
  Hibernate writes *every* mapped column on a dirty flush, from the snapshot taken when the row was
  loaded. Before this change `createOnBehalf` never dirtied `User` and so emitted no `users` UPDATE
  at all; it does now, for the length of a listing-post request. An admin suspending that same
  account inside the window would have had the suspension written back to `active` — silently, and
  in the permissive direction. That is a different animal from the lost-increment race documented on
  `recordListingPosted()` and knowingly accepted: losing a count is cosmetic, losing a moderation
  decision is not. `@Version` remains the wrong tool (it would fail every unrelated concurrent write
  to the row); confining the flush to changed columns is the right-sized fix.
- **`ListingCountTest` exists because the increment's only guarantee was a comment.** It persists via
  dirty-check on the managed `owner`, so a `@Modifying(clearAutomatically = true)` query added above
  it — an idiom this codebase uses about eight times — would clear the persistence context and drop
  the write with no error and nothing else failing. The test reads `listings_count` with raw SQL
  after an explicit `flush()` + `clear()`: `@Transactional` tests share the request's persistence
  context, so a repository read would return the mutated in-memory instance and report success even
  if no UPDATE were ever emitted. All three steps are needed or the test passes vacuously.

Smaller: `refreshUser` takes a session-generation guard (a `getMe` in flight during sign-out
resolved afterwards and re-signed the user in — and `authProvider.getMe` re-persists to storage on
the way through, so the cleared cache came back too); its swallowed failure now warns in DEV,
because a refresh that 500s was otherwise indistinguishable from the counter never incrementing,
i.e. from this very bug; `Plans.jsx` derives the persona instead of seeding `useState` with it,
since `/plans` is unguarded and paints off the cached user blob, which for every session cached
before this shipped has no `listingsCount` key at all — a `useState` initializer would have latched
that `false` and quietly reintroduced the permanently-wrong persona at the one call site that reads
it. The reviewer's claim that `COVERAGE.md` had no row for the new spec was checked and is wrong;
the row is at line 149.

**Still open — the `owner` role itself is now vestigial.** Nothing assigns it and nothing needs to,
but `Roles.java` still declares it, seven flatmate guards still say `hasAnyRole(BUYER, OWNER)`, and
`roleLabel()` still renders it. Either delete it from the vocabulary or give it a promotion hook;
leaving a role that only fixtures can hold is how this bug started. Needs a product call, same as
the `manager` entry below.

**`manager` is a role the frontend offers and the server cannot issue.** `AdminTeam.jsx:31` lists
`manager` ("scoped admin access") in the add-member role picker and branches on it at `:507`;
`lib/auth.js:110` counts it as internal and `lib/help.js:35` puts it in `STAFF_ROLES`. The wire
contract has only `buyer|owner|staff|admin` (`Roles.java:38-47`), and `SelfProfile.backOffice()`
matches only STAFF/ADMIN — so a `manager` would be granted no atoms and no shell. Left alone
during the mock-auth cleanup on purpose: deleting the `isInternal` branch while the picker still
offers the role would make the two sides disagree in a new way. Decide whether `manager` becomes
a real role or the picker loses it, then change both ends together.

**`live-kyc-growth-levers.spec.js:64` is order-dependent, not broken.** "the badge is optional"
failed once during the mock-auth cleanup verification with the OTP boxes never rendering
(`liveAuth.js:121`), then passed 4/4 when the file was re-run alone. Every actor in the file is a
freshly minted mobile, so it is not a per-mobile OTP throttle; the suspect is a shared limiter
seeing four sign-ups in quick succession behind the rest of `tests/platform/auth`. Worth one
targeted look at `WriteRateLimitFilter` before anyone spends time treating it as a UI bug — the
symptom (an input that never appears) points at the browser and the cause probably is not there.

**`e2e/helpers/app.js` still carries a dead localStorage-seeding apparatus.** Every importer of the
file takes only `appReady` (and `connectivity.spec.js` takes `open`). The `OWNER`/`SEEKER`/`OTHER`
actors, the `KEYS` map and the init-script seeder have no callers outside the file — live specs
establish a session through the real OTP flow instead. An `ADMIN` actor was deleted with the mock
auth cleanup because it was both unreferenced and unusable (it carried `moduleAccess`, a field no
guard reads; the console gates on server-resolved `permissions`). Removing the rest is mechanical
but wants its own pass, because `seed.js` overlaps it and the two should be judged together.

**Two `consumer/property` mock specs will not be converted, and should not sit in the queue as if
they will.** Both were read in full and the reason is the same in each case: there is no server
behaviour behind them to point a live spec at.

- **`dedup.spec.js`** opens a blank page and then `await import('/src/lib/data/propertyIdentity.js')`
  and `/src/lib/imageHash.js` inside `page.evaluate`. It is a unit test wearing a browser: no route
  is visited and no request is made, so "converting" it would mean inventing a page for it to run
  on. The server-side half of the same protection is already covered live by
  `platform/live-own-duplicate` (COVERAGE.md:264). Its correct home is Vitest, and moving it there
  is a separate piece of work from this migration.
- **`detail.spec.js`** exists to prove the detail route survives malformed records — it publishes
  `{ id: 'P-notype', type: undefined }` and `{ createdAt: undefined }` and checks the page still
  renders. A validating server cannot return either shape, so live the test would assert that a
  situation which cannot arise is handled, which is not a fact about the product. Its third test is
  a pure-function check on `lib/format.js` and belongs with the other two in Vitest.

Recorded here rather than left silent because "not yet converted" and "will not be converted" look
identical from the outside, and the difference is the whole value of the note.

**Society ops console — what the migration could not finish** (opened by `87f2d07`)

- **Society review reports are not in the society console.** A review is reported as a plain `review`
  and is indistinguishable on the wire from a property review, so the console filters to
  `contribution|reply|question|answer|board` and society reviews stay in Admin ▸ Reports. Splitting
  them needs a target-type the reporter does not currently send.
- **Outstanding on the two migration commits** (`3e53d87`, `87f2d07`): the reviewer-agent pass and
  the `/simplify` pass. The `live-*.spec.js` and its `e2e/COVERAGE.md` row are done
  (`admin/live-societies`, 9 tests). Verified so far: full lint at the 0-error baseline, and 20/20
  parity harnesses green.
- **~~Two~~ No readers on `/admin/societies` are still the client catalogue.** ~~Three~~ ~~Two~~ — the **merge
  picker** was the load-bearing one and is now fixed: `searchSocieties` moved to the
  `societyService` seam over `GET /societies?q=`, so an operator can merge one freshly-minted
  duplicate into another and `live-societies.spec.js` no longer bends around the gap. The **overlay
  editor** now has a server behind it — V112 gave `societies` an `admin_note` column and `PATCH
  /admin/societies/{slug}` writes it — and the editor is repointed onto that route, so the edit is
  real rather than a note this browser keeps to itself. The **Directory tab** pages off `GET
  /societies` (register 36's envelope) rather than enumerating the bundled 348 rows. And under D252
  the page stopped importing `lib/store.js` altogether: the last two readers were the **duplicate
  hints** and the **society name on a `details` proposal**, both of which asked the 28-society
  bundle about member-added societies it has never held. Duplicates are `GET
  /admin/society-candidates/{slug}/duplicates` now; the name travels on `SocietyProposalResponse`.
  `resolveSociety`/`suggestDuplicates` stay in `lib/store/societyAdmin.js` — the consumer society
  pages and the mock provider are legitimate callers.
- **`societies:write` is bypassable on the residents decision path.** `PATCH
  /societies/{slug}/residents/{id}` guards on *role* (`isStaff`) rather than on the permission atom,
  because the other legitimate reviewer is a committee member, who holds no staff permissions at
  all. The effect is that an ops account granted `societies:read` and deliberately not
  `societies:write` can still verify and reject residencies. Pre-existing, and a policy call rather
  than a bug: the fix is either a second atom the committee path can satisfy, or accepting that
  residency review is role-gated and saying so in `cross-cutting.md`.
- **`useSocietyHub.js` sends a preview object where a URL is expected.** The photo contribution
  passes `cForm.photo` — the whole `{name, size, mime, dataUrl}` shape `readEvidenceDoc` produces —
  as `photoUrl`, which the contribution contract declares as a URL string. Pre-existing and
  unrelated to the certificate work, but adjacent enough to be worth naming: it needs the same
  upload-then-reference treatment the certificate just got.
- **`EvidenceUpload`'s 2 MB inline cap does not match the vault's 10 MB.** A certificate between the
  two now uploads and is readable by ops, but shows the claimant no preview of what they attached.
  Two limits with different jobs (one is "how much base64 will we hold in memory", the other is
  "how large a document will we store") that happen to be visible on the same screen; they should
  either be reconciled or the gap should be explained in the picker's own words.
- **`PersonalDocument.sizeBytes` is a nullable `Long`.** Rows predate the column, and the certificate
  adapter coalesces null to `0` — which renders as "0 bytes" beside a document that is plainly not
  empty. Worth a backfill from the stored objects rather than a growing pile of coalesces.
- **Mock vault caps inline bytes at 3 MB.** A larger mock certificate has a null `dataUrl`, so the
  ops console says the document is stored but cannot be opened here. Honest, and the same answer dev
  gives when no signing provider is configured — recorded so the next person to see it knows it is
  the design and not a broken button.

**The 25 red mock-mode e2e specs: 25 fixed, 0 outstanding**

A wide `tests/admin` + `tests/consumer` run reported **29 failed / 821 passed**. A serial re-run of
just the red files reproduced 27, so they were not worker contention. A worktree at `cd1018c` — the
commit before the society-console work — running the *same* files produced a failure list identical
apart from `doc-viewer-scheme.spec.js`, which a targeted re-run showed to be a flake cluster (all
three of its tests fluctuate between runs). **None of it was a regression**, including the
`tenant-profile.spec.js:73` failure previously reported here as one: it fails at `cd1018c` too.

Almost all of them were one class — a spec whose localStorage seed predates a seam migration,
asserting against a screen that no longer reads the key it seeds. The repair is the same each time:
boot the app, wait for `appReady`, then write into the store the app has just seeded (an
`addInitScript` write is overwritten on first load), reading the existing store rather than starting
from `{}`.

| Seed key the spec wrote | Specs | Fixed in |
|---|---|---|
| `puneNestContactReq:<mobile>` | `consumer/account/action-center` (2), `consumer/account/contact-request-verified-badge`, `consumer/account/photo-requests` | `9a02fbd` |
| `pnTenantProfile:<mobile>` alone | `consumer/account/tenant-profile:73` | `1aceaea` |
| `puneNestDocs:<mobile>` | `consumer/account/doc-info` (4), `consumer/account/owner-finances` (2) | `9c2ab72` |
| `puneNestDocs:<mobile>` | `consumer/account/doc-requests-grant` | `bf757af` |
| `puneNestListings:<mobile>` | `consumer/flatmates/eligibility`, `owner-id-inbox`, `prefill` (3), `consumer/property/scheduled-visits` (6) | `51551a9` |
| `pnSocietyReports`, overlay shape | `consumer/society/community-v2:260`, `consumer/society/onboarding-p2` (2) | (this slice) |

Three of them were not stale seeds but real product defects the stale seeds had been hiding:

- **`toRentalCard` was never given the listing** (`e1a7ca6`). Its docblock says a caller holding the
  listing should pass it in rather than have the function invent one; all three call sites passed
  nothing, so every tenant's My Rental card, Rent Wallet and Document Vault described their home as
  "Rented home".
- **The flatmate tenancy picker could not name its options** (`22bfc94`). Same root, different
  surface, and worse: `prefillGroupFromTenancy` derives locality from the title, so with every
  option reading "My tenancy" the prefill filled in nothing.
- **"Remove content" did not remove the content** (`a72ab70`). `mock/triageReport` ignored
  `decision.enforcement`, so a moderator got "Content removed & report closed" while the spam stayed
  on the hub — and the report left the queue, so nobody would come back to it.

Two society specs were stale in the other direction — asserting behaviour that was deliberately
removed, so fixing them meant changing the assertion, not the product:

- `community-v2:260` asserted a snapshot of the reported text. `ModerationTab` stopped rendering one
  on purpose: a report carries a target id, and a snapshot taken at report time goes stale the
  moment the author edits. It now asserts on the target id, keeping both behavioural assertions.
- `onboarding-p2:52` asserted that verifying a candidate sets `registration` and `conveyance` true.
  `verifyCommunitySociety` deliberately stopped doing that — an operator confirming a building
  exists was silently telling every buyer its conveyance deed was done. It now asserts the
  verification stamp, which is also what the server records (V105).

Known flaky, not red: `doc-viewer-scheme.spec.js` (:56/:68/:86 fluctuate), `owner-hub.spec.js:79`.
Known red outside this set and untouched: `live-property-integration.spec.js:689`/`:720` (P6
deferral), `platform/desktop-noleak-guardrails.spec.js` (4), `mobile/landscape.spec.js:101`,
`mobile/phase3.spec.js:157`, `mobile/topbar-scroll.spec.js:61`.

**Data and schema**

- ~~`idx_properties_society_unit` (V79) indexes a column combination nothing queries. Both options —
  drop it, or `comment on index` explaining why it is kept — cost a new migration, because V79 is
  applied and editing it breaks its checksum.~~ **Closed 2026-08-22:** dropped by `V113__drop_unused_society_unit_duplicate_index.sql`; the active duplicate probe is meter or `(locality_slug, address_key)` only.
- `flatmate_rooms.society_id` had the FK-as-409 shape that D218 fixed for `properties`. **Fixed**
  in `FlatmateSupplyService.requireSociety`, which also closed the worse half nobody had noticed:
  the mapper's `uuidOrNull` silently turned a malformed id into `null`, so the room was created
  `201` attached to no society and the host was never told. Now 400 for unparseable, 404 for
  unknown — the 404 matching D218 deliberately. `FlatmateRoomSocietyTest` pins all three cases.
- No guard test asserts that a `V__` migration never inserts into a table the e2e reset truncates.
  The V78 `message_template` incident is fixed; the class of bug is not prevented.
- ~~`confirmListingFresh` writes `freshenedAt` to localStorage and the API has no such column.~~
  **Stale — this was already built and the entry described the mock.** `V86__properties_last_confirmed_at.sql`
  added the column; `Property.lastConfirmedAt` has no setter, so `confirmAvailable(Instant)` is the
  only way in; `MeListingsController.confirmAvailable` serves `POST /me/listings/{id}/confirm-available`
  (no `@PreAuthorize` by design — `/me/listings/**` authorises by ownership, 404 not 403);
  `propertyMapper.js:149` maps it to `freshenedAt`. Only the **mock** store writes localStorage,
  which is correct. The two real readers are `lib/freshness.js:31` and `AdminProperties.jsx:295`.

**Silent failures**

- `toListingUpdate` drops non-whitelisted keys without warning. `AdminProperties.jsx:428` passes
  `bhk`; the mapper reads `bhkNum`, so a BHK correction is discarded and the toast says it saved.
- `flagReason` is ungated on the public property detail response — moderator-facing prose served to
  anonymous callers.
- ~~There is no HTTP-level write throttle on any route. Rate limiting exists only on OTP.~~
  **RESOLVED — `backend/src/main/java/com/punenest/api/security/WriteRateLimitFilter.java` now
  throttles writes globally, so this entry described a gap that has since been closed.** It
  contradicted the "Needs attention" note further up this file, which already recorded that the
  global write-rate filter limits request volume; the two were written months apart and only the
  older one said "no throttle". Left struck through rather than deleted because the review report
  that raised it is still cited elsewhere, and a reader following that citation needs to find the
  claim and its retraction in the same place.
- `postInternalOnce` scans the whole thread in memory on every write.
- `PropertyResponse.adminPipeline` is not flattened by any http mapper, so six back-office readers
  are silently dark on live builds. Precondition for ledger 27.
- `PropertyReviewModal.jsx:391` returns `null` when either the review or the thread fails to load, so
  a failed case-file load is indistinguishable from a dismissed click.
- **The admin moderation console reads a partial catalogue, and the tripwire is now red.** The
  e2e catalogue crossed the page ceiling (102 listings against `spring.data.web.pageable.max-page-size=100`),
  so `warnIfTruncated` fires on both `/admin/properties` reads and `live-property-integration.spec.js`
  `:689` and `:720` fail in their shared `afterEach` — their own assertions pass. Confirmed
  pre-existing, not a Wave C regression. Consumer surfaces are unaffected *today*: the public
  approved catalogue is 47. Fixing it is a **P6 slice**, deferred there by decision on 2026-08-20:
  `listForModeration` returns a flat array and four screens aggregate over it client-side
  (`AdminProperties` tabbed table, per-tab counts and the recheck queue; `AdminDashboard` headline
  counts; `AdminPostOnBehalf` pending list), so a real fix is a page envelope plus server-side counts
  plus pushing the table's filters and sort onto `/admin/properties` so the server pages a *filtered*
  set. Raising `PAGE_SIZE` is not a fix and the server clamps it anyway — that is the mistake the
  tripwire's own docstring records.
- The review modal's open effect double-POSTs under StrictMode. Harmless since D221's advisory lock,
  but it is why a real server bug hid for weeks.

**Content and admin surfaces**

- The three editorial content endpoints shipped empty for three different reasons: `banners` cannot
  round-trip through the admin console, `announcements` and `services` have no admin write routes at
  all, and production answers `[]` for FAQs. Each needs its own decision.
- The live FAQ list has no `Sort`, so it is heap order; the mock's order was editorial.
- `MyListingsPanel.jsx:258` calls `sendWhatsappTemplate`, which 403s for owners. Either widen the
  guard or drop the control — pinned in place by `admin/live-outreach` test 6.
- `sendOwnerReminder` has zero callers and dies with the mock.
- The audit tab needs three small rulings before `logAudit`'s 44 call sites are deleted: whether the
  clear button survives, whether the uuid column is shown, and what the detail sentence reads.
- Flatmates gender filter (`FilterBar.jsx:130`) carries selection only in a CSS class; its four
  siblings all set `aria-pressed`. Accessibility finding, product change.
- Three surfaces still average reviews in the browser (`useSocietyHub`, `Owner.jsx`,
  `locality/ReviewsBlock`) — D79's aggregate endpoint is property-only.
- `hasTenancy` in `ReviewsSection` is mock-only, so the "Tenant" reviewer badge cannot render live.
- The mock `propertyReviewProvider` is missing two D218 behaviours (ordering column, staff-note lane).

**Seam drift — the 2026-08-30 source-diff audit**

A pure source diff of all 21 `http/*Mapper.js` against their DTOs and `punenest-api.yaml`, run because the
suite is green and the app is not. Findings are classed by the four signatures in
`docs/migration/07-seam-verification.md` §2: **A** confident zero · **B** vocabulary drift ·
**C** silently dropped write · **D** dark surface. The dominant shape is not a broken mapper — most
mappers are correct and *documented as correct*. It is a **reader one layer out** that was written
against the mock's richer object and never re-pointed. Reading only the mappers finds almost none of these.

*Money — the worst cluster, because every symptom is a rupee figure stated with confidence*

- **`paymentSessionId` is emitted by `rentMapper.js:108` and consumed by nothing.** The server opens a
  real Cashfree order for every rent payment and returns the single-use session; `PayRent.jsx:141` drops
  it and toasts "waiting for your bank to confirm". The three `openCashfreeCheckout` call sites are
  `lib/cashfree.js:57`, `Checkout.jsx:84` (plans) and `useRentAgreement.js:1002` (agreements) — PayRent
  is not among them. The row stays `due` forever and the owner is never paid. **Rent collection does not
  work in either direction**, and the next item hides it.
- **`PayRent.jsx:201` totals the ledger unfiltered by status**, so stranded `due`/`overdue`/`failed` rows
  are added into "₹X received via PuneNest". The tenant side filters correctly
  (`tenantFinance.js:44` `p.settled !== false`); the owner side does not. Class A on money.
- **3 of the 5 "Pay with" options cannot pay.** `PayRent.jsx:141` lowercases the label onto the wire;
  `PaymentMethods` accepts `upi|netbanking|card|autopay|cash`, so `credit card`, `debit card` and
  `upi autopay (recurring)` 422 at `RentService.java:671`. `upi` and `netbanking` matching is exactly what
  makes it look mapped. `Checkout.jsx:15-19` does the same trick correctly one file over.
- **`PUT /basis` is a full replace and `FinancesTab.jsx:280` sends three of five fields**, so every save on
  the basis modal wipes the owner's `loanOutstanding` and `emi`. Toast says "Basis saved".
- **`FinancesTab.jsx:100-104,127` catch every finance read into an empty success** (`0`/`[]`/`EMPTY_SUMMARY`).
  A property whose finance routes 500 renders a complete, confident ₹0 P&L with a green "Healthy" badge.
- **`fmtINR` (`lib/format.js:16`) is `Number(n) || 0`** — the defect `KpiCard` was fixed for, sitting in the
  money formatter itself. Every nullable Money on the wire renders an authoritative "₹0" instead of
  "not stated". `feesProvider.js:41-42` guards its two fields explicitly and is the only site that does.
- **`daysUntil` can never be negative** (`RecurringIntervals.nextOccurrenceOnOrAfter` returns
  on-or-after by construction), so the rose overdue list, the `overdueBy` copy and the red `healthOverdue`
  badge are all unreachable — money at risk is structurally invisible. `punenest-api.yaml:13196` documents
  it as "negative if overdue", i.e. the contract describes a state the implementation cannot emit.
- **`ActivityPanel.jsx:18` reads `tx.repeat`; `rentMapper.js:256,295` emits `recurring`.** The "· Recurring"
  tag never renders, so a standing EMI is indistinguishable from a one-off repair.
- **Both finance exports read a dead localStorage key.** `finances.js:246,264` read `getTransactions()`
  from `puneNestFin:<mobile>:<propId>`, whose only writer has zero importers. The CSV is a header row; the
  PDF — titled "Property Finance Statement", the artefact an owner files tax against — prints ₹0/₹0/₹0.
  Both toast success. `exportTransactionsCSV` also reads mock-shaped `t.repeat` while the live mapper emits
  `recurring`; its export button is live at `FinancesTab.jsx:263`. `getDues` has the same dead read and zero
  callers. Report-only from Cluster C — export is a separate finance repair, not an excuse to rewrite it in
  a document/status change.
- `PayRent`'s Pay form collects **rent month, landlord PAN and an autopay checkbox** that never reach the
  wire; `rentProvider.js:220` then derives the Idempotency-Key from `new Date()`, so a tenant settling last
  month's rent is keyed to this month. `downloadReceipt` reads `p.tenant`/`p.address`/`p.pan`, none of
  which exist — every HRA receipt names the tenant "Tenant" with a blank landlord PAN.
- `managedMapper.js:100` `Number(dto.dueDay) || 5` fabricates the 5th of the month;
  `lib/data/tenancy.js:31` documents this exact mistake being fixed on the tenancy side.
  `managedMapper.js:189,192,193` turn a deliberate `0` into `null`, which PATCH reads as "leave alone".
- The **boost domain has no client at all** — packs, priced purchases and Cashfree sessions exist
  server-side, `Card.jsx:122` renders the badge, and there is no `boostProvider.js`. A priced product
  with no purchase path.

*Fabricated facts — the browser inventing a number and printing it as stated*

- **`FloorPlan.jsx:16-17` computes `built = area*0.84` and `carpet = area*0.70`** and renders both in the
  same weight as the price. `carpetArea`, `builtUpArea` and `superBuiltUpArea` are all on
  `PropertyResponse` (yaml:11152-11154) and `toViewModel` reads none of them. Carpet area is the
  RERA-mandated comparison figure. Same shape as the fixed `landUse` hash, on a legal number.
  **FIXED (cluster A)** — the mapper now carries all three plus `floorPlan`, the rows drop when
  unstated, and `property.carpetEfficient` interpolates the ratio the listing actually has instead of
  asserting 70%. Covered by `consumer/property/live-area-breakdown`.
- **No owner can state a breakdown: the three area columns have no writer.** `ListingCreateRequest` and
  `ListingUpdateRequest` carry none of `carpetArea`/`builtUpArea`/`superBuiltUpArea`; only the seed
  populates them, and it sets `carpetArea` alone. The wizard collects one number, labels it "Carpet
  Area (sq.ft) *" (`WizardSteps.jsx:95`) and posts it as `area` from `carpetArea || builtUp`
  (`submit.js:165,232`) — so the wire cannot say *which* of the three it is, and `AdminPostOnBehalf.jsx:202`
  sends a `builtUpArea` the request DTO drops on the floor. Until there is a writer the detail page can
  only show the one figure under a neutral label. **Product decision, report-only.**
- **`live-property-integration.spec.js:707` ("the admin list is served by `/admin/properties`") is flaky
  at roughly one run in two.** Found incidentally while verifying cluster A; **not caused by it** — both
  sides of the failing assertion are `totalElements` read straight off two JSON responses, so nothing in
  a view-mapper can move either number. Running the file alone with `-g "admin list is served by"`
  passes; running it twice more with a second test also selected produced `Received: 15` and then
  `Received: 48` against `Expected: > 48` on identical input, so the captured `body` is not stable.
  The test's own docblock records the *previous* instance of this shape — the page issues two reads
  against `/api/admin/properties` on mount and `captureJson` caught whichever landed first, which they
  narrowed by excluding `recheck=`. That exclusion evidently does not make the capture unique; `15`
  looks like a filtered read and `48` like the public total arriving on the admin matcher. Wants the
  capture pinned to the exact query the queue issues (or the assertion moved onto a direct
  `page.request.get('/api/admin/properties')`) rather than a wider exclusion. **Report-only, outside
  the seam audit.**
- **`Owner.jsx:263` renders the "Verified Owner" pill unconditionally** and `:289` prints a hard-coded
  "100%" under the label "Verified". `OwnerProfileResponse.verified:44` sends the real boolean and the
  page reads it nowhere. Every seller is badged verified to every anonymous visitor.
  **FIXED (cluster B)** — the pill is gated on the boolean, and the share is computed from the cards'
  own `verified` flags, gated on `listings.length === owner.listingCount` so a partial page or a failed
  rail read renders an em-dash rather than a percentage over a subset. The fourth stat tile
  ("Avg. Response Time: ~2 hrs") is removed outright: a grep of all backend Java for
  `responseTime|avgResponse|response_time` returns nothing, so there was no value to read and an
  em-dash under that label would still claim the platform measures it.
  Two more homes for the same claim turned up in security review and are fixed with it: the About
  block printed its own unconditional emerald "Verified Owner" badge, and prose reading "{{name}} is
  a verified property owner" in all three locales — gating the header alone would have changed nothing
  a visitor sees. "Ownership Verified" beside them is **deleted, not gated**: it exists only per
  listing (`PropertySummary.ownershipVerified`, a separate axis from `ownerVerified`), so there is no
  owner-level field to aggregate. Covered by 4 new tests on a verified/unverified fixture cross-pair.
- **`CommunityTab.jsx:160` and `:180` render "Verified" on the *false* arm** of `authorIsResident` — so a
  signed-in stranger posting a "trusted pick" gets a teal check-mark that is a visual sibling of the
  resident badge. No field named `verified` exists in this domain on either side.
  `ReviewsSection.jsx:497` carries a docblock describing this exact bug being fixed one directory away.
  **FIXED (cluster B)** — the false arm is gone from both bylines; a non-resident author now wears no
  mark at all. Worth recording that `live-community.spec.js`'s own docblock had *defended* the badge,
  restating "Verified" as meaning only "not a resident of this society" — a codified defect, and the
  reason grepping for existing assertions on a string before deleting it is not optional. The same
  fallback was asserted `toBeVisible()` in `live-community-replies.spec.js`; both are now double
  absences. `ReviewsTab.jsx`'s `r.resident` badge went with them — a dead read (the view model has
  never carried that field), so removing it changes nothing observable and it is covered inside
  `live-society-rating`'s `seeded` guard, on a review that run wrote, rather than over an empty tab.
  Re-pointing at the server's `context` was rejected: `reviewMapper` documents it null on society
  reviews, so it would be the same dead affordance under a more convincing name.
- `ReportsPanel.jsx:18,20` render `basis.currentValue || purchasePrice * 1.12` and a hard-coded `+12%`,
  and `FinancesTab.jsx:281` writes `parseFloat(x) || 0` over the null the DTO javadoc says is the point —
  so an owner who never stated a valuation is shown a fabricated one and a fabricated appreciation.
- `locationIntel.js:32-51` computes the "Is this price fair?" verdict from a hard-coded table in
  `data/localityIntel.js` while `localityProvider` maps five real server averages that nothing reads;
  `:41` then gates `hasData` on membership of that static table, so a locality the server knows and the
  file does not renders a confident "no data".
- `AdminAnalytics.jsx:100-101` does `row.demand ?? 0` / `row.ratePerSqft ?? 0`, undoing the null-preservation
  `localityProvider.js:32-34` documents at length. An unsurveyed locality draws a demand bar at 0.

*Ops desks reading clean because the rows cannot reach them*

- **BLOCKED — Every customer document uploads under `category: 'service-request'`** (`serviceRequestProvider.js:184`,
  hardcoded), and `ServiceRequestChecklist.java:67-70` says in words that this default "is ignored here by
  construction". The drafting desk reads **"0 of 5 received"** over a rent agreement whose owner uploaded
  all four papers. Both the client and server comments claim to prevent exactly this outcome. Cluster D
  confirmed the missing bridge is not a safe one-line slug substitution: the form has separate PAN/Aadhaar
  slots but the checklist's single `owner-id` / `tenant-id` slug accepts one file as completion; one
  `passport-photos` file would likewise complete "all parties"; and the form has no `electricity-bill` slot
  although the five-item checklist requires one. Guessing categories would manufacture a complete case file.
  Decide the evidence model first (per-document/per-party slugs and a matching dynamic checklist, or an
  explicitly aggregate upload control), then map the caller's declared slug. **No client mapping was shipped.**
- **A reported review lands in no queue.** `kind: 'review'` is a first-class client kind with its own reason
  set and maps to the legal wire `ReportTargetTypes.REVIEW`, but `AdminReports.jsx:96` `TAB_KIND` has four
  tabs and none contains it, and `AdminSocieties.SOCIETY_REPORT_KINDS` excludes it by a correct argument.
  The stated destination — `AdminContent`'s reviews table — carries no report signal at all. Distinct from
  the known "society reviews are indistinguishable on the wire" row: this one is stored, counted, and
  unreachable by any moderator.
- **The review moderation queue truncates at 100 with no pager and no warning**
  (`AdminContent.jsx:70`, `size: 100`, page 0, once). `reviewProvider.warnIfTruncated` is wired to the
  entity route only, and the provider's own docblock asserts the opposite ("the console draws paging
  controls, so page 2 is reachable" — it does not). Separate surface from the known `/admin/properties`
  ceiling.
- **The Reported-posts Take-down button always 422s.** `AdminReports.jsx:299` sends
  `enforcement: 'hide_content'`; `ReportEnforcement.forTarget("post")` is `DECIDE_ONLY = {none}`. The other
  three tabs are correct, and the inline comment reasons carefully about `hide_content` vs
  `suspend_account` without asking whether `post` accepts either.
- **FIXED (cluster D): The Funnel tab's Buy/Rent pills zeroed the top two stages.** `FunnelView.jsx:16` applies
  `item.deal === funnelDeal` to enquiries and visits, neither of which carries `deal`
  (`AdminEnquiryDto`/`AdminVisitDto` have no such field; only `AdminDealDto` does). Total Enquiries → 0,
  Site Visits → 0, while Deals Closed keeps a real count. **The comment above line 16 says the pills "now
  simply do not narrow them"** — it describes the fix that was not applied, which is why reading the code
  is not enough to catch it.
- `ticketMapper.js:70` maps `TicketDto.service`, a column with **no writer anywhere in
  `backend/src/main`**. `AdminDashboard.jsx:448`, `AdminTopbarTools.jsx:491` and the `OpsQueue.jsx:232`
  CSV column render it with no fallback; `AdminServices.jsx:68` already fell back to `subject` and the
  other three did not get the fix.
- The drafting desk **filters in the server's status vocabulary and renders the client's**
  (`serviceRequestMapper.js:62-79`): picking "Assigned" or "In progress" shows one identical grey
  "docs review" chip, and six of the nine states fall through `Badge.MAP` to the grey that means
  unrecognised. The nine members match one-for-one — the drift is the collapse and the rename, not membership.
- `OpsDraftingDesk` `DETAIL_FIELDS` drops the packers **home size and move date** (writer names them
  `size`/`date`, reader expects `homeSize`/`moveDate`), the interior/valuation **callback name and mobile**,
  and the legal **free-text note** — the one field where the customer says what they want. Both contact
  writers carry a comment saying they ride in `details` precisely so the lead is actionable.

*Silently dropped writes*

- **Residency proof is collected, never uploaded, never sent.** `SocietyModals.jsx:90` offers a proof-type
  picker and an `EvidenceUpload`; `useSocietyHub.js:595` posts `{flat, wing, note, relation}` and
  `ResidentVerificationRequest` has no proof field. Unlike the claim certificate and the community photo,
  **nothing is uploaded at all** — the handler drops the raw `File` second argument the other two capture.
  The applicant is told "Residence verification submitted". `PROOF_LABELS` and `openDoc` in
  `admin/societies/helpers.jsx:7` now have zero callers.
- The society claim modal's **mobile is discarded** (`SocietyClaimRequest` has no field; the service uses
  `claimant.getMobile()`), and `useSocietyHub.js:563` sends `email: cl.email` where `cl` has no `email` key
  and the modal has no email input — so `ClaimsTab`'s Contact column is permanently `—`.
- The wizard collects **sharing / preferred tenants / pets / availableFrom / room** and `toListingCreate`
  sends none of them, because `ListingCreate` has no field for any of the five —
  yet `ListingFacets.java:97-102` filters on all five and `facetQuery.js:134-141` sends them. A PG owner
  states "2-sharing, girls only, no pets" and the listing is invisible to the exact five filters a PG
  seeker uses. Same for a plot's `landUse`. `availableFrom` is particularly mismatched: the property column
  accepts only `now|15|30`, while the wizard's `DateField` posts an ISO date as `available`; no mapper writes
  `available_from`. The reader now renders only known buckets as part of Cluster C, so every owner-created
  rental honestly says unstated instead of falsely "Immediately" — replacing the date control and extending
  the request DTO is a follow-up write-seam decision. Reads as an empty market, not a broken write.
- `buildAlertRecord` (`alertCriteria.js:58-73`) captures **9 of the ~25 axes** `facetQuery` sends, so an
  alert notifies about listings the user explicitly excluded. The alert fires, so nothing looks broken.
- `useFlatmateSupply.jsx:464` calls `updatePost(id, { verified: true })`; `verified` is not in
  `flatmateProvider.js:366`'s allowlist, so the PATCH body is `{}` — and the server sets `verified` once at
  create and never on update. DigiLocker verification never reaches the live post; the failure is swallowed
  by a `console.warn` and the success toast fires anyway.
- `InteriorRenovation.jsx:115` and `PropertyValuation.jsx:123` do `.catch(() => {})` then a synchronous
  `setDone(true)` — a 400, a 422 and an unreachable server all render the same "we'll call you back"
  confirmation. `Services.jsx:265` awaits and toasts the failure; these two did not get the correction.
- `BasisModal.jsx:23` offers Owned / Financed / Inherited; no column exists, nothing is sent, and
  `ReportsPanel.jsx:41` renders `basis.type` as `—` permanently.
- `supportProvider.js:70` accepts and discards `images`, though `SupportTicketsController#attach` is a live
  multipart route — so no surface can attach a file to a support reply. `supportMapper.js:60` hardcodes
  `images: []` with the comment "Attachments have no server representation", which is true of
  `services/request/MessageDto` and false of `services/support/MessageDto:34`.
- `rentProvider.js:299` `Number(txn.amount) || 0` — the amount input is a digits-only string, so `'0'`
  passes the client guard and 422s against `@NotNull @Positive`.

*Enum gaps that crash or mislabel*

- **FIXED (cluster C): `expired` was missing from the client's document-access vocabulary, on both sides of the seam.** The
  server's is `pending|granted|declined|expired` and `GRANT_TTL` is 7 days, so **every** granted request
  reaches it. `DocumentsSection.jsx:81` has four keys and no `expired`, and `:199`
  `ACCESS[statusOf(d.name)]` is dereferenced unguarded at `:211` → `TypeError` on any sale listing a buyer
  revisits after a week (`!isRent` spares rentals). In the owner's inbox the same status falls through
  `DocumentsTab.jsx:545-553`'s ladder to **"Declined"** — telling the owner they refused someone they
  helped. `ACCESS` is now total, unknown values understate as `none` and warn once, buyer expiry exposes a
  re-request path, and the owner gets a neutral expiry label. Three of four members were spelled identically,
  which is what made the fourth invisible. The register's filed owner path was stale; the live component is
  `components/dashboard/DocumentsTab.jsx`.
- Flatmate `kind` is two closed sets in one domain: a request's is `flatmate|room|group`
  (`FlatmateSeekerService.java:88`), a save's is `room|group|post` (`FlatmateSaveKeyDto`), and
  `flatmateMapper.js:297`'s docblock states the request vocabulary as the save one. No live break today —
  every consumer tests `room`/`group` — but the three surfaces cannot be compared.
- `lib/serviceRequestStatus.js:16,20,27,32` carries `awaiting_party` and `registration`, neither of which
  exists in `ServiceRequestStatus`; the yaml states at :13856 that there is *deliberately* no request-level
  `awaiting-party`. Two stepper branches that can never fire.

*Dark surfaces — mapped or served, read by nobody*

- Six readers ask for fields `propertyMapper.toViewModel` renames or omits: `l.age` (emits `ageYears` —
  `qualityScore.js:53,63`, `derivations.deriveAge`, `PriceInsights.jsx:54`); `p.available` (emits
  `availableFrom` — `useProperty.js:173,181,196`, so **every rental says "Available immediately"**);
  `l.description` (emits `desc` — `qualityScore.js:31,95` scores every listing 15 points low and tells an
  owner who wrote 400 words to "write a detailed description"); `p.possession` (emits translated
  `construction` — `PriceInsights.jsx:54` therefore adds 1-12% GST to every new-launch home);
  `l.featuredUntil` (never existed server-side — a paying owner's promotion always reads 0 days left);
  `society` (emits `societySlug` only — the duplicates desk shows an operator "Baner" twice where it should
  show two doorways).
- `qualityScore` and `freshness` are both **server-computed columns the mapper drops**, so the browser
  re-derives them from different weightings. `PropertySummary.java` documents the freshness tier as
  server-derived "so the client does not re-derive the second from the first — that is how the definition
  drifted onto the browser in the first place". The admin quality filter narrows on the browser number, and
  the comment justifying that (`AdminProperties.jsx:478`) is now false.
- `toViewModel` defaults `amenities`/`views`/`enquiries`/`deposit`/`docsCount`/`gallery` with `?? 0` / `?? []`
  without distinguishing "the card projection does not carry it" from "the value is zero". Search cards,
  `/me/saved`, `/properties/featured` and society homes are all `PropertySummary`. The mapper solved exactly
  this for `photoCount` (`imageCount ?? images.length`, with a docblock) and did not apply the reasoning to
  its six siblings in the same object.
- `Messages.jsx:283` reads `c.messages[last]` on a list where `ConversationDto.messages` is deliberately
  absent, so **every inbox row's preview is blank** — while `c.lastMessage`, populated from
  `Conversation.getLastMessage()` and mapped at `conversationMapper.js:107`, has zero readers. Same root:
  `Messages.jsx:230` "Share location" posts the literal `"Shared location: "` because `loc` is hardcoded
  `''`, and `:290`/`:329-334` render a dangling `·` and an empty map-pin line.
- `flatmateMapper.js:214` emits `photos`; `RoomCard.jsx:58` now uses `r.img || r.photos?.[0] || FLATMATE_IMG`,
  but `FlatmateRoomFeedDto`, the shape all three public reads return, omits **both** `photos` and the real-date
  `availableFrom`. Until that DTO exposes them, every public card uses the neutral image and the move-in filter
  cannot narrow the feed — a report-only server seam gap from Cluster C. `FlatSplitService.java:181` sets
  `societyId` and never `society`, so a split room's headline, alt text and share label are blank. `r.time`,
  `flatType`, `homeTypeLabel` and `gatedCommunity` are all seed-data fields (`constants.js:15`) that outlived
  their source.
- Emitted or served with **zero readers**: `paymentSessionId` (rent), `occupancyRate`, `contactLimit`,
  `counterpartyName/Mobile/Id`, `TicketDto.quotedValue` (the write is live end to end, the read has no
  consumer), `ServiceRequestPartyDto.requestType`, `draftDecision`, `Review.title`,
  `verificationMapper.perk`, `GET /admin/property-reviews` (fully implemented, ops desk mounted nowhere),
  `GET /admin/conversations/{id}` (a moderator acting on a chat report decides without the chat),
  `GET|PUT /me/owner-kyc` (so the rent-agreement wizard makes the owner retype PAN and Aadhaar each time),
  `POST /messages/{id}/attachments`. `MyListingsPanel.jsx:35-49` refetches the whole contact-request inbox
  on every listing change to feed `leadsFor`, which has zero call sites.
- `AdminReports.jsx:357,436` read `r.ownerMobile`/`r.reporterMobile`, absent from the mapper **and** from
  `ReportResponse`.

*FIXED (cluster E): Contract vs implementation — the yaml had six gaps*

- `Report.targetType` / `ReportCreate.targetType` declare `[property, user, review, post]`;
  `ReportTargetTypes` has nine and the society hub posts five `society_*` kinds in normal operation. The
  contract is narrower than **both** sides, so a generated client would refuse traffic the server accepts.
  (Supersedes the older "five values behind" note — it is five *society* kinds specifically.)
- `ListingCreate.photoHashes` and `TicketCreate.quotedValue` exist on the Java DTOs and are actively sent;
  neither is declared in the yaml. An extra request field is the direction the parity check does not catch.
- `FlatmateRoomCreate` omits `flatNumber`, `lat`, `lng` — a spec-generated client drops the map pin
  silently. Now declared. Its `required` list names `bhk`, `society` and `availableFrom`, none of which the
  Java record validates; `FlatmateGroupCreate.seatsOpen.minimum: 1` vs Java `@Min(0)`. The `seatsOpen` floor
  is corrected to the server's, but the three required room fields are **kept required and left unenforced
  server-side**: the wizard, `docs/flows/consumer/list-property-wizard.md` and the contract all say a room
  post carries them, so relaxing the contract to match the laxer validator would publish rooms with no BHK,
  no society and no move-in date. Adding the three `@NotNull`s is a server change with its own migration
  question for rows already stored without them — filed here rather than smuggled into a contract pass.
- `AgreementDoc` declares `url` and omits `dataUrl` — the key the ops desk actually reads
  (`flatmateModerationMapper.js:73`). It works only because Java holds the shape as an opaque `Map`, and the
  contract is the one artefact that would tell an R2 migration which key carries the legal document.
- `SocietyDetailResponse.placeId` and `locSource` are undeclared, though `useSocietyHub` builds the Google
  directions URL from `soc.placeId`; `Society.id` is documented `example: S01` where the server sends a UUID.
- `DueDto.daysUntil` is documented "negative if overdue" and provably never is (see the money cluster).
- **Still open, found during cluster E:** `FlatmateRoomCreate.furnishing` and `FlatmateRoom.furnishing`
  inline `[unfurnished, semi, furnished]` while the shared `Furnishing` schema says `semi-furnished`. Same
  one-member split `facetQuery.js:39-48` exists to bridge on the property side. Unenforced server-side (the
  Java field is a bare `String`), so it cannot 422 — which is exactly why it needs deciding rather than
  guessing: whichever word wins has to win on both sides at once.
- **Still open, found during cluster E:** `AgreementDoc.mime` enumerates only pdf/jpeg/png/webp, while
  `AgreementUpload.jsx` accepts `image/*` and its `AGREEMENT_MIME_RE` passes any `image/`. An iPhone's
  default `image/heic` therefore uploads cleanly, is stored in the free-form JSONB, and violates the
  declared contract. Decide whether to widen the enum or narrow the picker — the second changes what an
  owner can upload from a phone, so it is a product call, not a spec edit.

*Three surfaces, three rules, one "Verified" society badge* — `DirectoryTab.jsx:25` uses
`registration && conveyance`; `societyProvider.searchSocieties` uses `!community && (registration &&
conveyance)`; `useSocietyHub` uses `!!verifiedAt || (source !== 'community' && …)` with a docblock
explaining why the first form is wrong. The back office is the one surface that will call a
community-minted row Verified, and the one that will call an ops-verified community row Partial.

**Structure**

- `ListingService` is 17 lines from the 450-line guard. `updateAsModerator` extracts cleanly to
  `ListingModerationService`. Note that `frontend/scripts/check-listing-foundation.mjs` parses the
  file **as text**, by path and regex, so the split has to update the script in the same commit.

**Verification gaps**

- Property reviews have no live e2e; `review-parity.mjs` probes a locality instead.
- `consumer/society/live-society-rating`'s failure case cannot find the `div.glass` card filtered by
  `a[href="/society/aditya-shagun-kothrud"]`; it reproduces at the Cluster B baseline and is not caused by
  the seam fixes. The test must identify the rendered society card by a stable post-load anchor before it can
  claim a failed rating read is distinguished from an unrated society.
- The two D160 payment-cap 409s cannot be reached by e2e yet.
- `RentMapper`'s `@Mapping(ignore)` belongs to D167 and is untested.
- `backend/.env.local` secrets were surfaced on 2026-08-09. Rotate if there is any doubt.

**Flaky set** — re-measured 2026-08-13 over a full sweep (1,708 tests, 0 failed, 9 flaky). All are
viewport, scroll or animation timing. **Never relax an assertion to close one**, and never run a
build or `graphify` during an e2e run.

- `platform/desktop-noleak-guardrails.spec.js` :267 :282 :291 :328
- `mobile/landscape.spec.js:101`
- `mobile/phase3.spec.js:157` — both mobile projects
- `mobile/topbar-scroll.spec.js:61` — both mobile projects

**Decided elsewhere** — geo policy → ledger 35 · locality queue → 24 · own-listing dedup → 23 ·
saved-search count → 33 · society follows → 34 · internal notes → 29 · referral reward → 31b ·
society binding → 19 · pipeline stages → 27 · managed properties → 32 · `services` CMS type → 26 ·
admin enquiries → 25 · finance console → 20 · analytics tiles → 36 · "Posted by PuneNest" badge →
still undecided · `wa-pricing` → resolved.

**Cluster C product decision needed** — V20 permits a buyer to create a fresh request once an earlier one is
`declined` (the partial uniqueness constraint is only on `pending`). The UI now tells the truth — "The owner
declined this request" — but deliberately leaves the request button absent to avoid one-click repeat pressure
on an owner. Decide whether a re-request belongs after a cool-down, through support, or never; do not make the
decision accidentally while correcting the status copy.

**Cluster C verification note** — `react-reviewer` and the final `code-reviewer` pass were completed. The
final review corrected Pune's affordable-housing limit to 90 sqm (969 sq.ft); it also reported the separately
owned `AadhaarVerifyModal` scope error and reconfirmed the already logged `FlatmateRoomFeedDto` omission.
The focused live document suite passes. The strict no-behaviour-change simplification pass proposed no suitable
change.

## Next up

The ledger's damage order. Items 35, 24, 23, 33, 34, 29, 31b, 19, 27, 26, 32 and 25 are built; the
queue is now **20 (finance console) then 36 (analytics tabs)**. Clear item 36's analytics trap early:
`AdminAnalytics.jsx:35` calls `getAnalytics()` from `mockApi.js` and `:59` gates the whole page on
it, so deleting the mock hangs the page including its one working tab.

---

## Shipped

Newest first. One line per slice; the commit is the record.

- **`PricingProvider` waits for a screen that quotes a price.** It sits in `ConsumerLayout`, so it
  mounted everywhere and fetched `GET /pricing` on the home page, on search and on every property
  detail — none of which render a figure from it; all five that do are route-level. `usePricing()`
  now raises an `active` flag on mount and the fetch (and its two settings listeners) hang off that,
  so the read happens on the first route with a use for the answer. The new e2e assertion counts
  requests rather than waiting for one: "the home page did not fetch" and "the home page fetched
  twice" are indistinguishable to any weaker check, and the `/plans` half is load-bearing because a
  zero on the home page is equally consistent with the fetch having been *deleted* — which is the
  original bug (every price quoted from the bundle) wearing this optimisation as a disguise.

| Date | What shipped |
|---|---|
| 2026-08-24 | `consumer/property` onto the live API — 8 mock specs retired, 87 live tests green; V115 and V116 gave the duplicate probe the two arms that had never fired |
| 2026-08-17 | Every open migration decision closed; the 1,975-line register collapsed to a 205-line ledger |
| 2026-08-16 | Admin command palette stopped searching `db.json` fixtures on live builds |
| 2026-08-16 | D230–D234, and the closing summary of the autonomous window (`8cecfe5`..`45f9168`) |
| 2026-08-16 | D227–D229: the 36-row `mockApi.js` importer table, and its two corrections |
| 2026-08-16 | D226: the `ui-only` census bucket — routed screens that fetch nothing |
| 2026-08-16 | The route census (227 resolved / 35 unreached), now a committed script, and 195 dead exports |
| 2026-08-15 | D225: 105 sleeps and 122 `networkidle` calls triaged; the eight silent-skip guards |
| 2026-08-15 | D223/D224: the test-quality sweep and its corrections — what a green suite was hiding |
| 2026-08-15 | The `rawDb`/`mutateDb` cluster and the `fee()` survey, both closed |
| 2026-08-15 | Wave 4a: "Anonymous" → "Withheld", and the reason labels that had forked in five places |
| 2026-08-15 | D217: the propertyReview mock that copied the business rules and not the access rules |
| 2026-08-14 | D218: ordering column, duplicate detector, staff-only note lane — and four ways the green suite lied |
| 2026-08-14 | D219: the owner listing wizard onto the seam; six ways a never-run suite had rotted |
| 2026-08-14 | Wave 4: masked fields made read-only; `/admin` ruled administrator-only |
| 2026-08-13 | D216: outbound messages and templates, classified by the DPDP erasure guard |
| 2026-08-13 | Phase 5 pre-port audit — `permissions.js` and `contact.js` need no port, both already enforced server-side |
| 2026-08-13 | Debt wave 14: four e2e sweeps that died to infrastructure; the flaky set re-derived |
| 2026-08-13 | Phase 3: the referral retention sweep that had never once run; `punenest_test` reference data restored |
| 2026-08-13 | The prod profile became a tested contract; the container can be told its port |
| 2026-08-12 | Debt wave 10: seven write-disjoint lanes, ten register rows closed |
| 2026-08-12 | D133 closed won't-do; D158 re-verified still blocked — both measurement tasks, both registers wrong |
| 2026-08-11 | Debt wave 11 close-out: six register rows; debt wave 9: six lanes and the register's last High |
| 2026-08-11 | D193/D195/D198: a 404 that claimed to be a 500, an invented star rating, thirty unnamed buttons |
| 2026-08-11 | Society reviews get their own aspect vocabulary; Q14 answered — the foundation set splits |
| 2026-08-11 | D174, D175, D50/D51, D100, D42 and the e2e reliability pair (D28/D29) |
| 2026-08-10 | D79 wired up, plus the two defects hiding behind it; D163, D132, D47, D129 (partial) |
| 2026-08-09 | D77 paged inbound demand; D151 identity numbers reach one operator and stop existing |
| 2026-08-09 | Payment hardening (D169–D172); every payment family got the cap and the sweep (D160/D161) |
| 2026-08-09 | Paid Leave & License, and the thirteen register rows its review opened |
| 2026-08-09 | Eight decision-blocked register items closed; open-questions Q1–Q5 answered |
| 2026-08-08 | Encoding guard restored (D126); the contract's schemas enforced, not just its routes |
| 2026-08-08 | D144: nine shipped-but-undeclared endpoints declared; D145: catalog tests re-baselined against the seed |
| 2026-08-08 | D111/D112/D119/D109/D116/D97/D127/D113 — the flatmate and deals defect batch |
| 2026-08-06 | Worklog compression 5,294 → 527, and the OpenAPI 3.1 `nullable` fix (66 fields typed non-null) |

### The seam — 18 domains

| Date | Domain | The thing worth remembering |
|---|---|---|
| 2026-08-09 | Flatmate moderation | A visibility blacklist is a leak waiting for the next state |
| 2026-08-08 | Documents (17) | Multipart: a `FormData` body must not get a `Content-Type` header |
| 2026-08-08 | Identity verification (18) | `POST` is a 202 pending handle, not a granted badge — the webhook grants |
| 2026-08-08 | Service requests (16) | `details` was write-only until it became a real `jsonb` column |
| 2026-08-08 | Catalogue seed | 348 societies / 155 localities, generated from frontend data and FK-validated |
| 2026-08-07 | Flatmates (15) | Seats are set by the host, never inferred from `members.length` |
| 2026-08-07 | Rent and tenancies (14) | Paying rent yields `due`, not `paid`; the payout account returns a mask |
| 2026-08-07 | Deals and offers (13) | Every signature dropped its `ownerMobile` — that parameter was the caller naming whose data to read |
| 2026-08-07 | Subscription plans (12) | First domain read during render, so it is held in `PlanContext`. `pending ≠ active` |
| 2026-08-07 | contact/saved/savedSearch/visit | Shipped complete but absent from `VITE_API_DOMAINS`, so every live run had exercised their mocks |
| 2026-08-07 | Abuse reports (11) | Reason set is validated *against* target type; duplicate → 409 |
| 2026-08-07 | Support tickets (10) | Three controls had nothing behind them, so they are hidden in http — an unknown field is ignored, not rejected |
| 2026-08-07 | Reviews (9) | `context` is server-derived and readOnly; `avgRating` is null, not 0 |
| 2026-08-06 | Conversations (8) | Attributing by display name breaks the first time two users share a name |
| 2026-08-06 | Notifications (7) | Server and UI type vocabularies had zero overlap; every filter chip would have emptied the page |
| 2026-08-06 | Listing moderation | Four writes had shipped with no read that could find a listing to act on |
| 2026-08-05 | Visits (6) | The seam carries the human `when` string and converts to the wire's ISO slot |
| 2026-08-05 | Saved searches (5) | `POST /me/saved-searches` 401s for exactly the signed-out visitor the card exists to capture |
| 2026-08-04 | Saved shortlist (4) | Membership answered from `SavedContext`, never per card — 30 requests to draw 30 hearts |
| 2026-08-04 | Contact gate (3) | Keyed on `propertyId`: the grant is per listing, not per owner |
| 2026-07-30 | Property (2) | `construction`/`possession` broke a feature rather than degrading it — fixed in the contract |
| 2026-07-29 | Auth (1) | Established the provider pattern and the parity-harness habit |
| 2026-07-28 | Phase 2a | 21 files imported `lib/` directly; a seam with a bypass is not a seam |

### Backend slices — OpenAPI-first, 208 operations

| Date | Slice |
|---|---|
| 2026-08-07 | Tech-debt pass — D90, D82, D19, D22, D83, D86, D97(d), D95; the register's own numbers were the least reliable thing in it |
| 2026-08-02 | Tech-debt batches — Lombok, concurrency, register audit |
| 2026-08-01 | 15 share-flat + admin listing correction · 14 Admin & Analytics (revenue blanked for staff) |
| 2026-07-31 | 13 Billing & Growth · 12 conversations + support tickets · 11 service requests + staff queue |
| 2026-07-30 | 10 Documents (storage keys server-minted, content type derived from bytes) · 9 Moderation |
| 2026-07-29 | 8 Reviews · 7 Catalog & Search, pagination and OTP rate limiting — every sort index-backed |
| 2026-07-28 | 5 finance ledger + tenancy · 4 deals/offers/visits |
| 2026-07-27 | 3 contacts + gate + Aadhaar badge · 2 properties (slug-or-id resolution) |
| 2026-07-26 | 1 auth + users · bounded-context package layout |

### Database, mobile, trust, docs

| Date | Change |
|---|---|
| 2026-08-04 | One populated local DB, schema by Flyway only. Three permanent Flyway traps recorded in `R__zz_dev_demo_data.sql`'s header |
| 2026-08-05 | Mobile review B5/C5/D1 + CI; Home "Flatmates" tile |
| 2026-08-02 | Bundle: 571 KB off first paint — `financeProvider → finances.js → jspdf` was statically imported *and* preloaded |
| 2026-08-02 | Mobile Phase 4 incl. PWA and landscape; Phase 6 deferred-item sweep |
| 2026-08-01 | Home Phase 3 featured-first via CSS `order`, leaving DOM order untouched; Phase 2 waves H–R |
| 2026-07-31 | Mobile Phases 1/3/4/5; "Share Flat" → "Flatmates" (enum values stay `'share'` — renaming would orphan localStorage) |
| 2026-07-28 | Badge-not-gate migration, 8 pages (ADR-019); KYC growth levers; DigiLocker consent flow |
| 2026-07-27 | Trust model pivot documented; 3-way sync `platform-architecture.md` → OpenAPI → React |
| 2026-07-26 | OpenAPI established as the single source of truth |
| 2026-07-25 | Platform & solution architecture (MVP), ADR-009a KYC, ADR-014 payments, legal/compliance advisory |
