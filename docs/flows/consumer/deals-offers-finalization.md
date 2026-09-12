# Flow: Offers, Negotiation & Deal Finalization

> How a buyer makes and negotiates an offer, how a property is marked under-offer, and the
> maker-checker finalization that closes a deal (and creates a tenancy for rentals).
> **Status:** documented from React source - **Primary role(s):** buyer (maker), owner (checker)

---

## 1. Purpose & user problem
- **Persona:** a buyer/tenant ready to transact; an owner managing multiple interested parties and
  closing the deal on their terms.
- **Job-to-be-done (buyer):** "Make an offer, negotiate the price, and finalize the deal."
  **(owner):** "See offers, counter/accept, mark the property under-offer, and formally close it with
  the right buyer."
- **Why it matters:** this is the **bottom of the funnel** - the actual conversion. Finalization is
  the terminal state that takes a listing off the market, auto-declines competing requests, and (for
  rent) provisions the tenant's tenancy.

## 2. Entry points
- **Routes:** property detail page `/property/:id` (the `DealPanel`). Owner-side finalization also
  surfaces on the dashboard "My Listings" (`dashboard/myListings/FinalizeDealModal.jsx`).
- **Tiles / triggers:** "Make an offer" / "Update your offer", "Finalize deal" / "Request to
  finalize", "Mark under offer", owner offer actions (accept/counter/decline), owner finalization
  inbox on the deal panel.
- **Source components:** `src/pages/consumer/property/DealPanel.jsx` (buyer + owner deal UI),
  `src/pages/consumer/dashboard/myListings/FinalizeDealModal.jsx` (owner close form),
  `src/lib/store/deals.js` (all deal/offer/finalization logic),
  `src/services/dealService.js` + `src/services/providers/mock/dealProvider.js`.

## 3. Actors & roles
- **Offer maker = buyer**; **offer checker = owner** (accept / decline / counter).
- **Finalization maker = buyer** (requests finalize); **finalization checker = owner** (accepts /
  declines). An owner viewing their own listing (`isOwner`) can close the deal directly without a
  request.
- Owner-scoped stores are keyed by the owner's 10-digit mobile; the buyer is stored as the
  counterparty. Guards are UX-only (see
  [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 1).

## 4. Entities touched
- [`deals` (owner deal-state)](../../system/data-model.md) - `draazyDeals:<ownerDigits>`, one
  record per property: `{ status: active|reserved|closed, deal, at, parties[], closedWith }`.
- [`offers`](../../system/data-model.md) - `dzOffers:<ownerDigits>`: `{ id, propId, buyerName,
  buyerMobile, amount, status, from, at, updatedAt, history[] }`.
- [`finalization_requests`](../../system/data-model.md) - `draazyDealReq:<ownerDigits>`: `{ id,
  propId, deal, buyerName, buyerMobile, status, at }`.
- [`tenancies`](../../system/data-model.md) - `dzTenancies:<tenantMobile>`, **created** cross-actor
  when an owner accepts a **rent** finalization.
- [`deals` (analytics seed)](../../system/data-model.md) - `src/data/deals.json` (ids `D6###`),
  a separate closed/in-progress feed for admin analytics (not written by this flow).

## 5. Business rules & logic  *(the meat)*

### Deal state (`src/lib/store/deals.js`)
- Lifecycle: `active` (no entry) -> `reserved` (Under Offer) -> `closed`. `dealStatus` returns
  `closed`/`reserved`/`active`.
- `markUnderOffer(owner, propId, deal, parties)` -> `status: 'reserved'` (preserves the original
  `at` if already reserved). `getUnderOfferParties` / `addUnderOfferParty` / `removeUnderOfferParty`
  manage the interested-party list (`{ name, note, mobile, at }`); adding a party auto-reserves if
  not already.
- `closeDeal(owner, propId, deal, closedWith)` -> `status: 'closed'`, stamps `at` and the
  `closedWith` counterparty. `reopenDeal` deletes the record (back to `active`).

### Offers & negotiation (`getOffers` / `addOffer` / `respondOffer`)
- **Create (`addOffer`):** requires a signed-in user (`'login'` otherwise). Record: `{ id:
  'of'+ts, buyerName, buyerMobile, status: 'pending', from: 'buyer', at, history: [], ...o }` where
  `o = { propId, amount, moveIn, deal }`. `myOffer(owner, propId)` returns the buyer's own offer.
- **Buyer resubmit:** if the buyer already has an offer, `submitOffer` calls `respondOffer(...,
  'buyer_counter', amt)` instead of creating a second one (one offer per buyer+property).
- **`respondOffer(owner, id, action, amount)`** pushes the current amount onto `history` then:
  - `accept` -> `status: 'accepted'`.
  - `decline` -> `status: 'declined'`.
  - `counter` (owner) -> `amount = amount`, `from: 'owner'`, `status: 'countered'`.
  - `buyer_counter` -> `amount = amount`, `from: 'buyer'`, `status: 'countered_by_buyer'`.
  - stamps `updatedAt`.
- **Offer status set:** `pending | countered | countered_by_buyer | accepted | declined`.
- **Pending count:** `pendingOfferCount` counts `pending` **and** `countered_by_buyer` (both are
  "owner's turn"). Buyer accepts an owner counter via `respondOffer(id, 'accept')`
  (`buyerAcceptCounter` -> "Deal agreed").
- **Amount parsing:** the offer input strips non-digits (`parseInt(String(v).replace(/[^\d]/g,''))`);
  an empty/zero amount is rejected with an inline error + toast. Owner "counter" uses a
  `window.prompt` (a prototype affordance to replace).

### Finalization - the maker-checker (`requestFinalize` / `acceptFinalize` / `declineFinalize`)
- **Buyer requests (`doFinalize` when not owner):** `requestFinalize(owner, propId, deal)`. Requires
  login (`'login'`). Idempotent: if the buyer already has a `pending` request for that property it
  returns `'pending'` (no duplicate). Otherwise unshifts `{ id: 'f'+ts, propId, deal, buyerName,
  buyerMobile, status: 'pending', at }` and returns `'pending'`.
- **Owner shortcut:** an owner viewing their own listing who clicks "Finalize" calls `closeDeal`
  directly (no request needed).
- **Buyer cancels:** `cancelFinalize(owner, propId)` removes the buyer's own `pending` request.
- **`myFinalizeStatus(owner, propId)`** returns the buyer's latest request status (`none` if none).
- **Owner accepts (`acceptFinalize(owner, reqId, meta)`) - side-effects fire here:**
  1. Marks the target request `accepted`.
  2. **Auto-declines every other `pending` request for the same `propId`** (only one buyer wins).
  3. `closeDeal(owner, target.propId, dealKind, { name, mobile, rent, title, address })` - the deal
     goes to `closed`.
  4. **If `dealKind === 'rent'`:** `addTenancy(buyerMobile, { ownerMobile, ownerName, propId, title,
     address, rent, deal: 'rent' })` - provisions the tenant's tenancy record cross-actor.
- **Owner declines (`declineFinalize`):** marks that request `declined`; no side-effects, the buyer
  may resubmit (returns to `pending`).
- **Badges:** `pendingFinalizeFor(owner, propId)` lists pending requests for the panel;
  `pendingFinalizeCount(owner)` powers the owner's "waiting on you" badge.

### DealPanel gating (`property/DealPanel.jsx`)
- `isOwner = signed in && myMobile() === ownerMobile`. Buyers see "Make offer" + "Request to
  finalize"; owners see the offers inbox, the finalization inbox, "Mark under offer", "Close deal"
  and "Reopen".
- A `closed` deal shows "Sold"/"Rented Out"; `reserved` shows "Under Offer". Verified-tenant badge
  shown next to a buyer's finalize request when `isTenantVerifiedFor(buyerMobile)`.
- Declined offers are filtered out of the owner's visible offer list (`o.status !== 'declined'`).

## 6. Maker-checker / approval
- **Yes - two maker-checker loops.**
  - **Offer negotiation:** maker = buyer (submits offer), checker = owner (accept/decline/counter);
    a counter bounces the turn back and forth (`countered` / `countered_by_buyer`) until accepted or
    declined. An accepted offer feeds finalization but does **not** itself close the deal.
  - **Finalization:** maker = buyer (`requestFinalize`), checker = owner (`acceptFinalize` /
    `declineFinalize`). **Accept is the side-effect boundary:** it closes the deal, auto-declines
    competing pending requests, and (rent) creates the tenancy. Decline is no-op + resubmit-able.
- Both are refinements of the canonical pattern in
  [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 2 (see the deal-finalize
  and offer rows in table 2.4).

## 7. State machine
```
Deal state (per property, owner-keyed):
  active --markUnderOffer--> reserved --acceptFinalize/closeDeal--> closed
    ^                                                                 |
    +---------------------------- reopenDeal -------------------------+

Offer (per buyer+property):
  (new) --addOffer--> pending --owner counter--> countered --buyer counter--> countered_by_buyer
                         |  \--owner accept--> accepted (terminal)              |   (loops)
                         |   \--owner decline--> declined (terminal; buyer can start new)
                         +-- buyer accepts owner counter --> accepted

Finalization request (per buyer+property):
  none --requestFinalize--> pending --owner accept--> accepted --> [closeDeal + auto-decline others + (rent) tenancy]
                               |  \--owner decline--> declined (buyer may resubmit -> pending)
                               +--buyer cancelFinalize--> removed
```
- **Terminal:** deal `closed` (re-openable by owner), offer `accepted`/`declined`, finalization
  `accepted` (with side-effects) / `declined`.

## 8. Edge cases, validation & error states
- **Not signed in:** offer/finalize actions toast "sign in" and no request is created
  (`addOffer`/`requestFinalize` return `'login'`).
- **Duplicate finalize request:** idempotent - returns existing `pending` instead of a second row.
- **Duplicate offer:** buyer resubmits via `buyer_counter` on the existing offer, never a second.
- **Competing buyers:** accepting one finalization auto-declines all other pending requests for that
  property - only one winner.
- **Owner-as-buyer moot:** an owner on their own listing closes directly; no request round-trip.
- **Reopen:** `reopenDeal` clears the deal record entirely (loses the `closedWith` history) - a data
  loss the backend should turn into an auditable status change.
- **Zero/blank offer amount:** rejected with inline error + toast.
- **Rent vs buy in finalize meta:** `DealPanel.accept` passes `rent: isRent ? p.price : 0` and the
  title/address as `meta`; a rent finalize seeds the tenancy's rent from that. The
  `FinalizeDealModal` (dashboard) collects buyer name/mobile/final price/date explicitly.
- **Analytics seed mismatch:** `src/data/deals.json` (D6###, `value` + `at`) is a **different
  representation** from the owner deal-state store and is not written by this flow - reconcile
  server-side (see data-model inconsistency #4).
