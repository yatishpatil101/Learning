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
- `enquiries` - read (seed, `listEnquiries().slice(0,8)`; see contact-gate doc for the seed-only gap).
- `visits` - read + updated (`listVisits`, `updateVisit` via `mutateVisit`).
- `contact_requests` - read + updated (owner approve/decline via `decideContact`).
- `document_requests` - read + updated (grouped, granted/declined via `decideDocReqs`).
- photo requests, flatmates requests, group applications - read + updated.
- `property_review` - read (verification status per listing) + reply (`addPropReviewReply`).
- `saved_properties`, `saved_searches`, followed societies, recent props/searches - read (counts + nudges).
- `managed_property` (Owner Hub / Rent-o-meter) - read (rental nudge). Since D32 this is the
  `managed` seam domain (`/me/managed-properties`), not a browser store.
- `users` (profile), `aadhaar_verification` - read (profile-completion meter + the opt-in Verified
  badge state; the badge is a trust signal, never a posting/contact gate — ADR-019).
- `pnPlan` / plan - read via Plan & Billing tab (see plans-billing-refer doc).

## 5. Business rules & logic  *(the meat)*

### Tab registry (`constants.js` `TABS`)
9 visible sections (consolidated from a historical 13): `overview`, `properties` (My Properties =
Property Tools/Owner Hub + My Listings), `rental` (My Rental, tenant), `activity` (Saved & Activity =
Saved + Recently Viewed + Alerts + followed societies), `leads` (Requests, owner), `finances`,
`documents`, `visits`, `messages` (link-out, flag), `billing` (Plan & Billing, universal),
`profile`. `TAB_ALIAS` maps legacy ids to `{ tab, sub }` for deep-link back-compat (render-only; the
URL is left untouched).

### Owner Overview stat tiles (`buildOwnerStats`)
Exactly four cards, all real:
1. **Active Listings** = `listings.length` (owner listings + flatmate/room posts).
2. **Total Views** = `listings.reduce((s, l) => s + (Number(l.views) || 0), 0)` - summed client-side
   from each listing's `views`. Rendered `toLocaleString('en-IN')`. **MUST move server-side.**
3. **Enquiries** = `enquiries.length` (from the 8-item seed slice; trend "up" if any).
4. **Number Requests** = `pendingContacts` = `contactReqs.filter(r => r.status === 'pending').length`;
   trend text "N pending" / "All handled".

### Seeker Overview stat tiles (`buildSeekerStats`)
1. **Saved Properties** = `getSavedProps().length`.
2. **Recently Viewed** = `recent.length` (real per-user MRU resolved against approved catalog, cap 6).
3. **Saved Searches** = `getSavedSearches().length`.
4. **Followed Societies** = `useFollows().count` (`context/FollowContext.jsx`). Was a render-body
   `getFollowedSocieties().length` until **D227** - a different reader from the followed-societies
   panel's, which is how the tile and the list it links to could disagree, and a browser-local one,
   which is how it disagreed with the same account on another device. Both now read one context over
   `GET /me/societies/following`.
Each tile's `onClick` deep-links via `go()` to the relevant tab.

### Action Center (`buildActionItems`) - "what's waiting on ME"
A single triage list pinned to the top of Overview. Rows are only added when they are a real task:
- **Owner rows:** each pending contact request ("wants your phone number", Share/Decline); each
  pending group application (Accept/Decline, shows `members/seatsTotal`); each photo request ("asked
  for more photos", Add photos); each pending document group ("wants N documents", Grant all/Decline);
  each listing whose review `status === 'clarification'` ("Action needed ... verification needs more
  info", Respond).
- **Shared row (owner + seeker):** each `scheduledVisits` item still awaiting confirmation
  ("Visit to confirm", Review).
- **Seeker/tenant row:** rent due on a tracked rental. The only action is "Coming soon" (to
  `/pay-rent`): rent does not move through PuneNest, so any button promising to pay it would be a
  promise the platform cannot keep.
- **Sort:** stale-first. `STALE_MS = 2 * 86400000` (2 days); items older than that lead, then by
  oldest `at` ascending.

### Attention badges (`attentionCounts`)
Shown on the sidebar/mobile-nav from every tab, not just Overview:
- `leads` = `pendingContacts + photoReqs.length + pendingFlatmateReqs + pendingDocGroups.length`
  (only items genuinely waiting on the owner; already-contactable enquiries are NOT counted).
- `visits` = `scheduledVisits.length`.
- `messages` = `chatUnread`.

### Document-request grouping (`buildDocGroups`)
Buyer doc requests are stored one row per document; grouped per `buyerMobile|propId` (one
due-diligence request = one lead). Each group tracks `docTypes[]`, `pendingIds[]`, and the earliest
`requestedAt`. `pendingDocGroups` = groups with `pendingIds.length > 0`. Grant/Decline resolves all
pending ids together, then re-reads shared state.

### Retention loop (`retention.js` + Overview)
- **Alert matches:** for each active saved search (`s.alerts !== false`), `countMatches(s, approved)`
  counts live approved listings matching deal + locality + BHK; only searches with `count > 0` show,
  capped at 3, each linking to `searchHref(s)` (see saved-alerts doc for `countMatches`).
- **Profile completion (`profileCompletion`):** 4 equal steps at 25% each - name, email, city, and
  the **opt-in Verified badge** (step label "Verify your identity with Aadhaar"). This is a completion
  *nudge*, not a gate — the account works fully without it. `percent = round(done / 4 * 100)`; `next`
  = first unfinished step. Mobile is deliberately excluded (always present after login). The Overview
  meter renders only when `percent < 100`.
- **Opt-in Verified-badge nudge (`OverviewPanel.jsx`):** a dismissible card offering the DigiLocker
  Verified badge (badge-not-gate, ADR-019) — verified owners rank higher and get faster responses; it
  is never required to post or contact. Mirrored by `myListings/VerifyListingsBanner.jsx`.
- **Owner contact preferences (`components/dashboard/ProfileTab.jsx`, owner only):** "**Accept
  verified contacts only**" (`verifiedContactOnly`, **off by default**) — only then is an unverified
  buyer prompted to earn the badge before contacting; and "**Keep my number private**" (`hideNumber`)
  — the number stays masked even after approval, routing approved buyers to in-app chat.

### Rental nudge
`rental = managedProps.find(p => p.rented && p.monthlyRent) || null` - a real rented managed
property only. Drives the seeker "Rent due soon" action row and Overview rental card.

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
  contact-gate flow doc. Handlers (`decideContact`, `decideDocReqs`, `decideFlatmateReq`,
  `setStatus`, `mutateVisit`) apply the decision optimistically and toast the outcome.

## 7. State machine
The hub has no lifecycle of its own; it renders one active tab. Tab state:
```
initial: resolveTarget(hash || ?tab=) -> { tab, sub }; fall back to 'overview' if not a visible tab
navigation: go(next) -> resolveTarget -> if link-out (messages) navigate to page,
            else setTab/setSub + push '#next' + scroll top (View Transition cross-fade if supported)
sync: on location.hash/search/isOwner/showRental/flag change, re-resolve; unknown -> 'overview'
```
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
- **Optimistic updates:** visit mutations update shared `visits` state immediately, then persist, so
  the calendar, leads badge and Action Center move together.
- **Load race:** the load effect uses an `alive` flag to avoid setting state after unmount.
- **`hasListings`/inventory read from localStorage stores** - see the mobile-keying note in the
  domain model; these become proper FKs server-side.
