# Flow: Owner Dashboard / Account Hub

> The signed-in user's home base at `/dashboard`: a tabbed hub that becomes an owner
> control panel (listings, leads, visits, finances) the moment the user has real
> inventory, and stays a seeker account hub (saved, activity, alerts) otherwise.
> **Status:** documented from React source · re-synced to ADR-019 (badge-not-gate) - **Primary role(s):** owner (control panel) + buyer/tenant (account hub)

---

## 1. Purpose & user problem
- **Persona:** an owner who has posted a listing / room / flatmate / managed property and
  needs one place to run it; a seeker/tenant who wants their saved homes, alerts, visits and
  documents in one account hub.
- **Job-to-be-done (owner):** "See what is waiting on me, triage leads, track views/enquiries, and
  manage my listings, money and documents." **(seeker):** "Resume my search, see my saved homes and
  alerts, and manage upcoming visits."
- **Why it matters:** this is the post-conversion retention surface. The Action Center and attention
  badges pull the owner back to respond before leads go stale; the retention loop (alert matches +
  profile completion) pulls the seeker back to keep searching. Every number shown is real per-user
  data - the code explicitly refuses to fabricate figures.

## 2. Entry points
- **Route:** `/dashboard` (`ProtectedRoute`; see [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 1).
- **Deep links:** the active tab resolves from either the URL hash (`#leads`) or a `?tab=` query
  param. Legacy hashes still work via `TAB_ALIAS` (e.g. `#owner-hub` and `#listings` -> `properties`,
  `#enquiries` -> `leads`, `#saved`/`#recent`/`#alerts` -> `activity` with a sub-section). The
  `/owner-hub` route redirects here but asserts the URL stays `#owner-hub`.
- **Tiles / triggers:** navbar avatar/menu, the header bell (unread count), and cross-app links such
  as notification `link` targets (`/dashboard#enquiries`, `/dashboard#profile`, `/dashboard#billing`).
- **Source components:** `src/pages/consumer/Dashboard.jsx` (container/orchestrator),
  `src/pages/consumer/dashboard/useDashboardData.js` (data layer),
  `src/pages/consumer/dashboard/dashboardData.js` (pure derivations),
  `src/pages/consumer/dashboard/OverviewPanel.jsx` + panel components,
  `src/pages/consumer/dashboard/constants.js` (tab registry), `.../retention.js`.

## 3. Actors & roles
- **Owner view vs seeker view is NOT decided by `user.role`.** `Dashboard.jsx` computes
  `isOwner = hasListings() || hasRooms || hasRequests || hasGroups || hasManaged` - the user must
  have ACTUAL inventory (a property listing, a flatmate room, a flatmate request/group, or a
  private managed property from Owner Hub / Rent-o-meter). This prevents a brand-new "owner" from
  landing on empty "My Listings / Requests / Finances" dead-ends.
- **`hasManaged` is asynchronous since D32.** The managed set now comes from `managedService.js`,
  so `Dashboard.jsx` holds it in state and starts empty. On the first paint a returning owner is
  briefly not an owner by this test - the same first-paint hole `listings` already had, and the
  reason the tab registry is recomputed rather than frozen at mount. A failed read falls back to
  an empty list rather than surfacing: the dashboard's job is to show what it can.
- **`showRental`** (My Rental tab) = `hasTenancy || !isOwner || hasRentalInvite` - buyers/tenants,
  anyone with a finalised tenancy, or anyone with a pending owner co-fill invite; a pure owner who
  rents nothing does not see it.
- **Tab gating:** `visibleTabs = TABS.filter(t => (!t.owner || isOwner) && (!t.tenant || showRental)
  && (!t.flag || flagEnabled(t.flag)))`. Owner-only tab: `leads` (Requests). Tenant tab: `rental`.
  Flag tab: `messages` (feature flag `inAppMessaging`, and it is a link-out to `/messages`, not an
  inline panel).
- Every panel receives `isOwner` and renders role-aware content (e.g. Finances = owner P&L vs tenant
  Rent Wallet; Documents = owner vault vs buyer-granted docs).

## 4. Entities touched
All read-heavy; mutations happen inside the sub-flows this hub links to. Links go to
[`../../system/data-model.md`](../../system/data-model.md).
- `properties` / listings - read (owner listings via `loadMyListings`, catalog via `listProperties`).
- `enquiries` - no longer read by the hub (the 8-item seed slice and its "Enquiries" tile are gone).
- `visits` - read + updated (`listVisits`, `updateVisit` via `mutateVisit`).
- `contact_requests` - read + updated (owner approve/decline via `decideContact`).
- `document_requests` - read + updated (grouped, granted/declined via `decideDocReqs`).
- photo requests, flatmates requests, group applications - read + updated.
- `property_review` - read (verification status per listing) + reply (`addPropReviewReply`).
- `saved_properties`, `saved_searches`, followed societies, recent props/searches - read (counts + nudges).
- `managed_property` (Owner Hub / Rent-o-meter) - read (rental nudge). Since D32 this is the
  `managed` seam domain (`/me/managed-properties`), not a browser store.
- `users` (profile), `identity_verification` - read (profile-completion meter + the opt-in Verified
  badge state; the badge is a trust signal, never a posting/contact gate — ADR-019).
- `dzPlan` / plan - read via Plan & Billing tab (see plans-billing-refer doc).

## 5. Business rules & logic  *(the meat)*

### Tab registry (`constants.js` `TABS`) and the 5 groups
The 11 section ids are unchanged (so every `#hash`, `?tab=` and `TAB_ALIAS` target still resolves):
`overview`, `properties`, `rental`, `activity`, `leads`, `finances`, `documents`, `visits`,
`messages` (link-out, flag), `billing`, `profile`. `TAB_ALIAS` maps legacy ids to `{ tab, sub }`.

Navigation shows at most **5 groups** (`buildDashboardGroups`) as a top strip, with a sub-strip of
the group's sections when it holds more than one. Every section is at most 2 taps away on mobile.
- **Owner:** Home (`overview`) · Requests (`leads`, `visits`) · My Properties (`properties`,
  `documents`, `finances`) · Rental (only when the owner also rents) · Account (`profile`,
  `billing`, `activity`, `messages`).
- **Seeker:** Home · Saved (`activity`) · Visits · Rental (tenants) · Account (`profile`,
  `billing`, `documents`, `finances`, `properties`, `messages`).
Group badges sum the attention counts of their sections. A user tap pushes a history entry (Back
returns to the previous section); a deep-link resolution replaces it.

While the core reads are still loading and nothing is known yet (`personaPending`), Overview renders
a neutral skeleton rather than the seeker hub, so a returning owner never flashes the seeker view.

### Owner Overview stat tiles (`buildOwnerStats`)
Four tiles in a 2×2 grid, each equal to the list it opens:
1. **Waiting on you** = lead rows in the Action Center (`attentionFromItems(items).leads`) -> Requests.
2. **Visits to confirm** = visit rows in the Action Center -> Visits.
3. **Live** = listings that are approved and not paused/archived/sold, excluding seeker posts -> My Properties.
4. **Views** = views summed across **live** listings only (still summed client-side; a server
   aggregate is a later step) -> My Properties.

### Seeker Overview stat tiles (`buildSeekerStats`)
1. **Saved** = saved-properties count -> Saved.
2. **Saved searches** = saved searches with alerts -> Saved › Alerts.
3. **Upcoming visits** = visits the caller booked as a visitor, scheduled/confirmed, today or later -> Visits.
4. **Following** = `useFollows().count` (one context over `GET /me/societies/following`, D227) -> Saved › Alerts.

### Action Center (`buildActionItems`) - "what's waiting on ME"
A single triage list pinned to the top of Overview (first 3 rows, then "See all"). A row exists only
when the caller must decide something; every row carries a `kind`:
- **Owner rows:** pending contact request ("wants to contact you", Accept/Decline); pending
  flatmate request (Accept/Decline); pending group application (Accept/Decline, `members/seatsTotal`);
  photo request (Add photos/Decline); pending document group ("wants N documents", Grant all/Decline);
  listing with an unread verification clarification ("Needs info", Respond).
- **Visit row:** a `scheduled` visit **the caller hosts** (`isVisitHost`: rows from
  `myVisitRequests()` are tagged `hostedByMe`). A visitor's own booking is never "waiting on me".
- **Never a row:** already-contactable enquiries, decided requests, expired contact requests, rent
  due (rent does not move through Draazy).
- **Sort:** stale-first. `STALE_MS = 2 days`; items older than that lead, then oldest first.
- Buttons on a row are disabled while its decision is in flight (`isBusy`), so a double tap on a
  slow network sends one request.

### Attention badges (`attentionFromItems`)
Derived from the Action Center items themselves, so a badge always equals the rows behind it:
`leads` = contact + flatmate + app + photo + doc rows; `visits` = visit rows; `properties` =
clarify rows; `messages` = `chatUnread`. Group badges on the nav sum their sections.

### Document-request grouping (`buildDocGroups`)
Buyer doc requests are stored one row per document; grouped per `requesterId|propId` (falling back to
`request:<id>` when the requester id is missing). Each group tracks `docTypes[]` (types only, never
document numbers), `pendingIds[]`, and the earliest `requestedAt`. Grant all / Decline resolves all
pending ids together through the same per-id endpoint as a single decision, then re-reads the inbox.

### Retention loop (`retention.js` + Overview)
- **Alert matches:** for each active saved search (`s.alerts !== false`), `countMatches(s, approved)`
  counts live approved listings matching deal + locality + BHK; only searches with `count > 0` show,
  capped at 3, each linking to `searchHref(s)` (see saved-alerts doc for `countMatches`).
- **Profile completion (`profileCompletion`):** 4 equal steps at 25% each - name, email, city, and
  the **opt-in Verified badge** (step label "Verify your identity"). This is a completion
  *nudge*, not a gate — the account works fully without it. `percent = round(done / 4 * 100)`; `next`
  = first unfinished step. Mobile is deliberately excluded (always present after login). The Overview
  meter renders only when `percent < 100`.
- **Opt-in Verified-badge nudge (`OverviewPanel.jsx`):** a dismissible card offering the reviewed
  Verified badge (badge-not-gate, ADR-019) — verified owners rank higher and get faster responses; it
  is never required to post or contact. Mirrored by `myListings/VerifyListingsBanner.jsx`.
- **Owner contact preferences (`components/dashboard/ProfileTab.jsx`, owner only):** "**Accept
  verified contacts only**" (`verifiedContactOnly`, **off by default**, saved on the account and
  enforced by the server gate) — only then is an unverified buyer prompted to earn the badge before
  contacting. `hideNumber` is the owner's post-approval privacy switch: approved buyers see the real
  number only when it is false.

### Rental nudge
`rental = managedProps.find(p => p.rented && p.monthlyRent) || null` - a real rented managed
property only. Drives the Overview rental card; it is not an Action Center row.

### Recent vs recommended feed
`feed = recent.length ? recent : recommended`; title "Continue Exploring" (real MRU) vs "Recommended
for you" (neutral discovery fallback, `approved.slice(0,6)`). The code is explicit that recommended
is never mislabeled as recently viewed.

### Requests inbox (`EnquiriesPanel.jsx`)
One inbox, six filters: `all` (default), `numbers`, `photos`, `documents`, `flatmate`, `enquiries`.
Every request type is normalised into one lead descriptor, so the unified "All leads" queue, the
tappable row -> detail sheet (`LeadSheet.jsx`), and the sheet's actions all behave identically. Sort
is attention-first (`attention` = awaiting a decision from the owner), then longest-waiting; undated
leads sink. Flatmate rows are labelled by `kind`: **Room enquiry** (`room`), **Group join** /
**Group request** (`group`, by `action`), **Flatmate interest** (otherwise). The detail sheet also
carries owner-private annotations - notes and follow-up dates keyed by a stable lead id
(`getLeadAnnotations` / `setLeadAnnotation`) - which are never part of any consumer-visible payload.

### My Listings: type filter and letting a flat room by room
- **Type filter:** My Listings is a mixed inventory (properties, flatmate rooms, flatmate requests,
  flatmate groups). A `Select` filters by `catOf(l)` and only offers buckets with a non-zero count;
  it self-resets to `all` when its bucket empties (for example after a delete).
- **`splitEligible`** = not a flatmate post, not closed, not reserved, and `canSplitIntoRooms(l)`
  (`deal === 'rent'`). **`split`** = `isFlatSplit(l.id)`.
- **"Let room by room"** (shown when eligible and not yet split) opens `SplitFlatModal`; confirming
  calls `splitFlat(...)` with the signed-in owner's mobile/name. The toast is honest about the badge:
  an unapproved parent listing reports *"they'll show as owner-verified once this property is
  approved"*.
- **"Stop letting room by room"** (shown only when `movedIn === 0`) calls `unsplitFlat(l.id)`; once
  anyone has moved in it is refused, because deleting the rooms would erase a live tenancy.
- **Split status on the card:** an "*N rooms listed*" chip, plus either "*M moved in - whole-flat
  listing hidden*" (the flat can no longer honestly be let whole) or "*Whole-flat listing still
  live*". Saying so is the difference between a feature and a silent disappearance.
- **Where occupancy is edited:** the dashboard shows the split *summary* only. Adjusting how many
  people actually live in each room - and reissuing the joint rent agreement when that changes -
  happens on the owner's own room cards in Flatmates
  ([`flatmates.md`](./flatmates.md) section 5).

Source: `MyListingsPanel.jsx` (`handleSplitConfirm`, `handleUnsplit`, the `SplitFlatModal` mount) and
`myListings/ListingCard.jsx` (`splitEligible` / `split` / `splitRooms` / `movedIn`, overflow items,
chips).

## 6. Maker-checker / approval
- The hub itself is not a maker-checker, but it is the **checker's cockpit**. Every owner-side action
  row is the approve/decline side of a maker-checker defined elsewhere: contact reveal, document
  access, flatmates requests, group applications, and listing-verification clarification. See the
  shared pattern in [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 2 and the
  contact-gate flow doc. Handlers (`decideContact`, `decideDocReqs`, `decidePhotoReq`,
  `decideFlatmateReq`, `decideApp`, `mutateVisit`) guard against double-submit per request id,
  toast only after the write succeeds, and re-read (or roll back) on failure.
- **Server side:** only the owning user (listing owner / flatmate host / visit host) may decide.
  Every decision writes an `audit_log` row. Repeating the same decision is an idempotent 200 with no
  second audit row; a different decision on an already-decided request is `409` (photo requests keep
  first-decision-wins 200). Grant all uses the same per-request rule as a single grant.

### Per-request state machine
```
pending --owner accepts--> approved/granted/accepted/resolved   (audited, terminal)
pending --owner declines-> declined                             (audited, terminal)
pending --30 days, no decision--> expired (contact requests; derived, not counted, respond = 409)
terminal --same decision again--> no-op 200
terminal --different decision--> 409
```

## 7. State machine
The hub has no lifecycle of its own; it renders one active tab. Tab state:
```
derived: every render resolveTarget(hash || ?tab=) -> { tab, sub }; not a visible tab -> 'overview'
navigation: go(next) only pushes '#next' (+ scroll top); the tab follows the URL.
            A link-out target (messages) redirects to its page.
```
The tab is never copied into component state: React Router commits location inside a transition,
so a mirrored copy desynced when Android Back landed before the pending commit
(`mobile/dashboard-nav`).
Panels are rendered with stable component identity so a state change in the container (e.g. a
contact decision) does not remount and wipe the active panel; React remounts only when `tab` changes.

## 8. Edge cases, validation & error states
- **New owner with no inventory:** treated as seeker (`isOwner` false) - sees the account-hub tabs,
  not empty management tabs.
- **Deep link to a hidden tab:** if the resolved tab is not in `visibleTabs`, falls back to
  `overview`. A deep link to `#messages` redirects to `/messages` (never an inline divergent view).
- **Empty states everywhere:** every tile has an honest empty variant ("None yet", "Start browsing",
  "Create one", "All handled") rather than a fabricated number or a blank card.
- **Retention cards suppressed** when there is nothing honest to show (`alertMatches` empty and
  profile 100%).
- **Visit mutations:** update shared `visits` state immediately, then persist; on failure the row
  rolls back and no success toast is shown.
- **Failed inbox reads:** group applications that fail to load show an error with Retry in Requests
  rather than an empty "no requests" state.
- **Load race:** the load effect uses an `alive` flag to avoid setting state after unmount.
- **`hasListings`/inventory read from localStorage stores** - see the mobile-keying note in the
  domain model; these become proper FKs server-side.
