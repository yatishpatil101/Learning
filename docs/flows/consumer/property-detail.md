# Flow: Property Detail

> The single-listing page: gallery, key details, insights, trust, similar homes, and the
> entry point into the contact-reveal gate.
> **Status:** documented from React source · re-synced to ADR-019 (badge-not-gate) - **Primary role(s):** buyer / tenant (public view, with owner/admin preview of non-approved listings)

---

## 1. Purpose & user problem
- **Persona:** a buyer/tenant evaluating one property; also the owner previewing their own listing
  and admin/staff reviewing it.
- **Job-to-be-done:** "Show me everything about this home - photos, specs, price context, location,
  trust signals - and let me contact the owner or book a visit."
- **Why it matters:** the detail page is where intent converts to a lead. It is the launch point for
  the contact-reveal gate, schedule-visit, save, report, and document requests.

## 2. Entry points
- **Route:** `/property/:id` (`src/pages/consumer/Property.jsx`), plus `?tab=` (overview | amenities
  | location | pricing | trust) and return context in navigation `state` (`from`, `restore`).
- **Triggers:** result cards on `/listings`, map detail panel, similar-property cards, saved/recent
  lists, home "featured", dashboard tiles.
- **Source components:** `Property.jsx` (thin container) driven by
  `src/pages/consumer/property/useProperty.js` (all logic), and under
  `src/pages/consumer/property/`: `Gallery.jsx`, `PropertyHeader.jsx`, `PropertyTabs.jsx`,
  `PropertyModals.jsx`, `OwnerCard.jsx`, `ContactBox.jsx`, `ContactOwnerModal.jsx`,
  `SimilarProperties.jsx`, `PriceInsights.jsx`, `RentDetails.jsx`, `LocationInsights.jsx`,
  `locationIntel.js`, `VerificationSection.jsx`, `DocumentsSection.jsx`, `FloorPlan.jsx`,
  `SocietySection.jsx`, `ReviewsSection.jsx` (+ `ReviewModal.jsx`, `StarInput.jsx`, `Stars.jsx`,
  `reviews.js`), `CompareToggleBar.jsx`, `ScheduleVisitModal.jsx`,
  `ReportModal.jsx` (a thin property adapter over the shared `src/components/ReportModal.jsx`),
  `DealPanel.jsx`, `derivations.js`.
- **Mobile chrome:** below `lg` the page carries a fixed bottom action bar (`pn-sticky-cta`) holding
  the primary conversion actions, and the tab rail docks under the nav
  (`pn-docks-under-nav`, `top: var(--pn-nav-h)`). Actions the sticky bar already exposes are hidden
  from the in-page header on mobile rather than duplicated.

## 3. Actors & roles
- **Public:** anyone can open an `approved` listing.
- **Owner / admin preview:** a non-approved listing renders an "under review" state for everyone
  **except** the owner (`p.ownerMobile === user.mobile`) or an admin/staff viewer, who see it in
  full (`useProperty.js`: `isOwner`, `isAdmin`, `isApproved` -> `underReview`).
- **Contact actions** are gated by **sign-in (L1) + owner approval** — no Aadhaar gate; a
  `verification_required` step appears only if the owner accepts "verified contacts only". See
  [contact-gate-leads.md](./contact-gate-leads.md) and
  [`../../system/cross-cutting.md`](../../system/cross-cutting.md) (section 3).

## 4. Entities touched
- [`properties`](../../system/data-model.md) - read (single row by id).
- [`contact_requests`](../../system/data-model.md) - read (`contactStatus`) to decide reveal;
  created from here via the gate (details in [contact-gate-leads.md](./contact-gate-leads.md)).
- [`saved_properties`](../../system/data-model.md) - toggled (`isSavedProp`).
- Recently viewed (`pushRecentProp`) and a view log (`logPropertyView`) are written on open.
- Photo requests (`requestMorePhotos`), reviews, reports, visit requests are created from
  sub-sections/modals.

## 5. Business rules & logic  *(the meat)*

### Load & view logging
- `getProperty(id)` (from `lib/mockApi.js`). On success: `logPropertyView(locality, id)` and
  `pushRecentProp(id)`. `p === undefined` -> loading; `p === null` -> not found.

### Access gate
- `isApproved = p.status === 'approved'`. If not approved and the viewer is not the owner/admin,
  the page short-circuits to an "under review" panel (title/body from i18n) - no data leaks.

### Gallery / image handling (`Gallery.jsx`, `useProperty.js`)
- `gallery = p.gallery?.length ? p.gallery : [p.image]` - always at least the cover image.
- Lightbox + optional 3D tour modal; Escape closes, ArrowLeft/Right cycle
  (`(i - 1 + len) % len` / `(i + 1) % len`), body scroll locked while open.
- "Request more photos" (`requestPhotos`): sign-in required, blocked on your own listing, dedup via
  `requestMorePhotos` returning `'duplicate'`; otherwise persists a photo request the owner sees.

### Derived / displayed data (type-aware)
- **Title:** `${bhkNum ? bhkNum+' BHK ' : ''}${type} for ${Rent|Sale} in ${locality}`.
- **Price string:** rent -> `Rs<price>/month`; buy -> `fmtINR(price)`.
- **EMI teaser:** `Math.round((price * 0.0072)/100)*100` (a rounded indicative monthly figure).
- **Per-unit:** price/sqft or rent/sqft (`Math.round(price/area)`).
- **Key details differ by kind** (`propertyKind`): land shows plot area/zone/facing/possession/
  title; commercial shows area/furnishing/floor/facing/parking/(available|age); residential shows
  bedrooms/bathrooms/area/furnishing/floor/facing/parking/(available|age). Missing values render as
  a dash. Floor/facing/age are derived deterministically (`deriveFloor`, `deriveFacing`,
  `deriveAge`) when not stored.
- **Baths fallback:** `p.bath || max(1, bhkNum - 1)`.
- **Highlights / tags:** only surfaced when backed by data (parking, furnishing (rent),
  possession (buy), RERA, verified owner, ownership verified, zone/clear-title for land, security/
  power for residential). Sale shows possession; rent shows furnishing (possession is a buy concept).
- **Live-activity signals** are derived from real popularity so they vary per listing and stay
  stable: `viewingNow = 3 + (views % 15)`, `visitsScheduled = 1 + (enquiries % 5)`,
  `enquiriesThisWeek = enquiries ? max(1, round(enquiries/6)) : 0` (a weekly slice, not the lifetime
  total - avoids fake urgency).
- **Read-more blurb** is kind-specific (land / commercial / residential framing).

### Tabs
- `tabs` = overview, amenities (shown when amenities exist OR residential OR reviews on),
  location, pricing (rent details vs price insights), trust. `?tab=` selects; invalid -> overview.

### Contact entry point (the gate lives elsewhere)
- **Number reveal** (`ContactBox.jsx` inside `OwnerCard`): reads `contactStatus(ownerMobile, id)`.
  `revealed = status === 'owner' || (status === 'approved' && !ownerHidesNumber)`. Masked otherwise;
  `requestContact` returns `'login' | 'verification_required' | 'pending' | 'approved' | 'declined'`,
  and `'verification_required'` (only when the owner accepts verified contacts only) opens the opt-in
  Verified-badge `AadhaarVerifyModal`.
- **Contact / chat CTA** (`useProperty.handleContact`): sign-in (L1) required; when `inAppMessaging`
  is on it queues an owner chat request and opens Messages (no Aadhaar); when off it opens
  `ContactOwnerModal` (enquiry). `contactApproved` (approved/owner) swaps the sticky mobile CTA to a
  chat/WhatsApp action. Full rules: [contact-gate-leads.md](./contact-gate-leads.md).

### Flat-share teaser (`PropertyHeader.jsx`)
Any **residential rent** listing with `bhkNum >= 2` and a positive price shows a "sharing this flat"
card: three per-head price tiles (alone / 2 sharing / 3 sharing, computed as `price / n`), plus a
**Find flatmates** CTA that deep-links to
`/flatmates?startGroup=1&title=<title>&rent=<price>&loc=<locality>` - it pre-seeds a *Team up* group
from this exact flat rather than dropping the user on a blank Flatmates page. The gate is
deliberately by shape, not by a hardcoded type list (flats, apartments, row houses, penthouses and
villas all qualify); a studio or 1 BHK is not practical to split, so 2+ BHK is the floor. See
[`flatmates.md`](./flatmates.md).

### Similar / related properties (`SimilarProperties.jsx`)
- Same deal only; up to `LIMIT = 3`, tiered:
  1. **Ideal:** within `RADIUS_KM = 6` km AND BHK within `BHK_TOL = 1` AND price in
     `[0.6x, 1.6x]`, sorted by distance then price closeness.
  2. **Top-up:** still within 6 km, config/budget relaxed, nearest first.
  3. **Last resort:** nearest listings by distance regardless (never random/far).
- Coordinates resolve to the listing's own pin, else its locality centre (`localityBySlug`), else
  `Infinity` distance. Distance via haversine.

## 6. Maker-checker / approval
- **Not initiated here, but visible here.** The listing had to pass the listing-verification
  maker-checker (owner submits -> admin approves) before it becomes publicly viewable; the trust tab
  surfaces the resulting verification badges (RERA, owner/ownership verified). The **contact-reveal**
  action started from this page is itself a maker-checker (buyer requests -> owner approves) -
  defined once in [`../../system/cross-cutting.md`](../../system/cross-cutting.md) (sections 2 & 3)
  and detailed in [contact-gate-leads.md](./contact-gate-leads.md).

## 7. State machine
The page reflects listing state rather than owning one:
```
loading (p === undefined)
   -> not found (p === null)
   -> under review (status != approved & viewer not owner/admin)
   -> viewable (approved, or owner/admin preview)
        contact sub-state: none -> pending -> approved | declined   (+ owner)
        save sub-state:    saved <-> unsaved
```

## 8. Edge cases, validation & error states
- **Not found:** centered "property not found" message.
- **Under review:** amber clock panel; owner/admin bypass.
- **No gallery:** falls back to the single cover image.
- **Missing specs:** dashes; floor/facing/age derived deterministically so the layout never breaks.
- **Own listing:** cannot request more photos of your own property (info toast); contact box shows
  the full number (`status === 'owner'`).
- **Owner privacy:** an approved request still shows a masked number if the owner set `hideNumber`,
  routing to chat instead (`approvedPrefersChat`).
- **Similar empty:** section renders nothing if no candidates.
- **Flag-gated CTAs:** schedule-visit, in-app messaging, reviews, 3D tour each depend on app flags.

## 9. Current mock implementation
- **Service:** `src/services/propertyService.js` (`getProperty`); page calls `getProperty` /
  `logPropertyView` via `src/lib/mockApi.js`.
- **Provider:** `src/services/providers/mock/propertyProvider.js`; core `getProperty` in
  `src/lib/mockApi/properties.js` (find by id, `delay()`).
- **Contact reveal:** `src/lib/contact.js` (`contactStatus`, `requestContact`, `maskPhone`,
  `ownerHidesNumber`) via `src/services/contactService.js` /
  `src/services/providers/mock/contactProvider.js`.
- **Data/seed:** `src/data/properties.json`; localities/societies for insights and similar.
- **Key components/functions:** `useProperty.js` (all derivations, gates, `handleContact`,
  `requestPhotos`, tabs, back-to-search), `Gallery.jsx`, `ContactBox.jsx`, `ContactOwnerModal.jsx`,
  `SimilarProperties.jsx`, `property/derivations.js`.

## 10. Target API endpoints
Map to the [OpenAPI spec](../../../backend/src/main/resources/static/openapi/punenest-api.yaml):
- `GET /properties/:id` -> full listing (section 2). Must return only `approved` to public callers;
  owner/admin get their own/any via authenticated `/me/listings/:id` or role-scoped access.
- `GET /contacts/status?ownerMobile=&propertyId=` -> current reveal status (section 7).
- `GET /properties/:id/similar` (implied) -> server-computed similar set with the same tiering/geo
  rules, so the client doesn't have to load the whole inventory to compute neighbours.
- View logging (`logPropertyView`) -> a server-side view/analytics event.
- Photo request -> a "request more photos" endpoint (owner-visible lead).

## 11. Backend responsibilities
- **Enforce the approval gate server-side:** never return a non-approved listing to a client that is
  not the owner or an admin. The current `underReview` check is client-side and bypassable.
- **Compute similar/related server-side** (geo distance, BHK/price tiers) rather than shipping the
  full catalog to the browser.
- **Derive/serve stable fields authoritatively** (floor/facing/age, activity signals, EMI teaser) so
  they don't vary by client or invite tampering.
- **Own the contact-status read** and never include the raw owner number in the payload unless the
  request is approved and the owner's privacy pref allows it (see the gate in
  [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 3).
- **Record views/photo-requests server-side**; the client must not be trusted to write analytics or
  lead records.
