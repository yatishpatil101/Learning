# Flow: Schedule a Property Visit

> How a buyer/tenant books an in-person or video visit to a listing, and how the owner confirms,
> completes, reschedules or cancels it.
> **Status:** documented from React source - **Primary role(s):** buyer/tenant (maker), owner (checker)

---

## 1. Purpose & user problem
- **Persona:** a buyer/tenant who wants to see a property before committing; the owner who wants
  qualified viewings scheduled around their availability.
- **Job-to-be-done (buyer):** "Pick a date/time and request a visit to this property." **(owner):**
  "See incoming visit requests, confirm the slot, and mark whether the visit actually happened."
- **Why it matters:** the visit is the mid-funnel conversion between "interested" and "deal". A
  completed visit is also the anti-fake-review gate: only a buyer whose visit the owner confirmed as
  completed may leave a "Visited" review (see section 5).

## 2. Entry points
- **Routes:** `/schedule-visit` (full page, `ProtectedRoute` - sign-in required). Query params:
  `p` / `listing` (listing id), `o` (owner mobile), `title` (property title, sanitized of `<>`).
- **Tiles / triggers:**
  - Property detail page (`/property/:id`) - "Schedule Visit" opens either the full page or the
    inline modal (`property/ScheduleVisitModal.jsx`).
  - Owner dashboard "Scheduled Visits" calendar/list tab (`components/dashboard/VisitsTab.jsx`).
- **Source components:** `src/pages/consumer/ScheduleVisit.jsx` (booking page),
  `src/pages/consumer/property/ScheduleVisitModal.jsx` (inline modal),
  `src/components/dashboard/VisitsTab.jsx` (owner triage + calendar),
  `src/lib/visitWhen.js` (slot list + `when` string vocabulary).

## 3. Actors & roles
- **Maker = buyer/tenant** (signed in) picks mode/date/time and submits the request.
- **Checker = owner** confirms, completes (marks visited), cancels or reschedules from the dashboard.
- **Admin/staff** can view all visits (`GET /visits`) and reschedule via the same `updateVisit`.
- `/schedule-visit` is a `ProtectedRoute` (any signed-in user). The dashboard visit actions are
  owner-scoped (`isOwner` gate inside `VisitsTab`). Guards are UX-only today - see
  [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 1.

## 4. Entities touched
There are **two parallel visit stores** (a known duplication - see section 8):

- [`visits`](../../system/data-model.md) - the global visits collection (seed
  `src/data/visits.json`, ids `V8###`), read/written by `scheduleVisit` / `updateVisit` in
  `src/lib/mockApi/staff.js`. This feeds the owner dashboard calendar and the admin visits view.
  Statuses: `scheduled | confirmed | completed | cancelled | no-show`. **Created** on booking,
  **updated** on owner actions.
- `property_visit_requests` - owner-mobile-keyed store `puneNestPropVisitReqs:<ownerDigits>` in
  `src/lib/store/visits.js` (**deleted** with the mock provider lane; visits are now served by
  `services/visitService.js`). Statuses: `requested | completed` (plus whatever `setVisitStatus`
  writes). **Created** by `addVisitRequest`, read by the review-eligibility gate. This is what
  unlocks the "Visited" review.
- [`properties`](../../system/data-model.md) - read to render the property summary (title, price,
  owner, image) via `getProperty(listingId)`.

## 5. Business rules & logic  *(the meat)*

### Slot selection (`src/lib/visitWhen.js`)
- **Visit mode:** `in-person` (default) or `video` (live walkthrough). Stored inside the `when`
  string in parentheses.
- **Time slots:** `VISIT_SLOTS = ['9:00 AM', '10:30 AM', '12:00 PM', '1:30 PM', '3:00 PM', '4:30 PM',
  '6:00 PM', '7:00 PM']` (owner-friendly hours). Default is `10:30 AM`.
- **Date:** free date field, `min = todayIso()` (local yyyy-mm-dd) - visits are **forward-only**.
- **Canonical `when` string:** `formatWhen(dateIso, time, mode)` -> `"19 Jul 2026, 10:30 AM
  (in-person)"`. `parseWhen` reads back both this human form and the seed's ISO form
  (`"2026-07-07"`), so a booked slot and a rescheduled slot stay mutually parseable. This one
  vocabulary is the single source of truth across booking, dashboard reschedule and admin.

### Booking submit (`ScheduleVisit.confirm`)
1. Validate name (non-empty) and phone (`/^[6-9]\d{9}$/` after stripping non-digits and a leading
   `91`). Errors surface inline via `useFieldErrors` + toast.
2. Only if signed in (`isIn`):
   - `scheduleVisit({ listingId, listing: title, customer: name, mobile: phone, when, note })` ->
     appends a `{ id: 'V'+Date.now(), status: 'scheduled', ... }` row to `db.visits`.
   - If an `ownerMobile` is known, **also** `addVisitRequest(ownerMobile, { propId, propTitle,
     visitorName, phone, date, time, mode, note })` -> appends a `requested` row to
     `puneNestPropVisitReqs:<owner>`.
3. Clears the autosaved draft (`pnDraft:schedule-visit`), shows the booked confirmation, offers a
   pre-filled WhatsApp handoff to the owner and a "track on dashboard" link.

### `addVisitRequest` idempotency (`src/lib/store/visits.js`)
- Requires a signed-in user (`readUser()`); returns `null` otherwise.
- If the same visitor already has a `requested` visit for the same `propId`, it **updates** that
  record's date/time/mode/note instead of creating a duplicate (one live request per
  buyer+property). Otherwise it unshifts a new `requested` record with `createdAt` and
  `completedAt: 0`.

### Owner actions (`VisitsTab.jsx` -> `useDashboardData.mutateVisit` -> `updateVisit`)
- **Confirm:** only when `status === 'scheduled'` and `isOwner` -> `updateVisit(id, {status:
  'confirmed'})`.
- **Mark visited (complete):** only when `status === 'confirmed'` **and the slot is in the past**
  (`isPast`) -> `status: 'completed'`.
- **Cancel:** available while active -> `status: 'cancelled'`.
- **Reschedule:** owner picks a new date/time; the mode is preserved; the visit is rewritten with a
  new `when` and reset to `status: 'scheduled'` so the other party re-confirms.
- Status labels (owner-facing): `scheduled` = "Awaiting confirmation", `confirmed` = "Confirmed",
  `completed` = "Visited", `cancelled` = "Cancelled", `no-show` = "No-show". Calendar colours:
  scheduled=amber, confirmed/completed=emerald, cancelled/no-show=rose.
- "Upcoming" list = visits with `status` in {`scheduled`, `confirmed`} sorted by parsed date.

### The review-eligibility gate (`src/pages/consumer/property/ReviewsSection.jsx`)
- A buyer may leave a review only if `hasCompletedVisit(owner, propId)` (a `completed` row exists in
  `puneNestPropVisitReqs` for their mobile) **or** they have a tenancy for the property.
- `myVisitStatus(owner, propId)` returns `completed` / `requested` / first status / `none`; a buyer
  who only has a `requested` visit is told "your visit is booked, review unlocks after it's done".
- This is why the second store exists: it records that the owner **confirmed the visit actually
  happened**, gating fake reviews.

### Revoking a confirmed stay is forward-only (D204) - do not "fix" this
- The other half of the same gate is the owner-confirmed tenancy declaration (D194): the owner agrees
  a person lived there, and that agreement authorises a `tenant` review. The owner can take the
  confirmation back afterwards.
- **Revocation does not retract the review it authorised.** A review already written stays published,
  keeps its `tenant` badge, and keeps counting towards the listing's rating. Revoking only stops the
  standing from authorising a **new** review from that point on.
- This looks like a gap and is a decision. Retraction would give the owner of the reviewed listing a
  one-tap silencer for criticism: confirm the stay, wait for the review, revoke on reading it. The
  declaration exists to evidence that the reviewer was really there - a fact about the past that
  revoking cannot change. Abuse of confirm -> review -> revoke is answered by the audit trail
  `TenancyDeclarationService.decide` writes and by review moderation, both held by someone other than
  the accused.
- Pinned by `TenancyRevocationIsForwardOnlyTest` (both halves: the old review survives byte-for-byte,
  the next one is refused 422) and restated at the revocation site in `TenancyDeclarationService`.

### `when` counts / badges
- `pendingVisitCount(owner)` = number of `requested` rows -> powers the owner's "waiting on you"
  badge. `hasCompletedVisit` / `myVisitStatus` drive the review gate above.

## 6. Maker-checker / approval
- **Yes - a lightweight maker-checker.** Maker = buyer (creates a `scheduled` / `requested` visit),
  checker = owner (confirms / completes / cancels). The side-effect of confirmation is purely the
  slot moving to `confirmed`; the meaningful side-effect of **completion** is unlocking the buyer's
  "Visited" review. Reschedule returns the record to `scheduled` (re-confirmation needed). See the
  visit row in the table in [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section
  2.4.

## 7. State machine
```
db.visits (dashboard/admin):
  (new) --book--> scheduled --owner confirm--> confirmed --owner mark visited (past only)--> completed
                     |  \                          |
                     |   \--owner cancel-------> cancelled (terminal)
                     |    \-reschedule-> scheduled (loops; re-confirm)
                     +--(admin) no-show ------> no-show (terminal)
  reschedule from confirmed -> back to scheduled

property_visit_requests (review gate):
  (new) --addVisitRequest--> requested --owner confirms it happened (setVisitStatus 'completed')--> completed
                                 |
                                 +-- re-request updates the same 'requested' record (no dupe)
```
- **Terminal:** `completed`, `cancelled`, `no-show`. `completed` in the second store is what the
  review gate reads. Reschedule re-opens a confirmed visit back to `scheduled`.

## 8. Edge cases, validation & error states
- **Not signed in:** the page is `ProtectedRoute`, so a guest is redirected to `/signin?next=`.
  The booking `confirm` also no-ops the persistence when `!isIn` (defensive).
- **Field validation:** name required; mobile must match `^[6-9]\d{9}$` (Indian 10-digit). Messages:
  `svErrName` / `svErrPhone` (page) or `property.enterName` / `property.validMobile` (modal).
- **Past dates blocked:** date field `min = todayIso()`.
- **Duplicate request:** `addVisitRequest` updates the existing `requested` record instead of
  creating a second one.
- **Mark-visited guard:** "Mark visited" only appears for a `confirmed` visit whose slot is already
  in the past - an owner can't complete a future visit.
- **Inline modal does NOT persist (inconsistency):** `property/ScheduleVisitModal.jsx` validates and
  shows a success toast but **never calls** `scheduleVisit` / `addVisitRequest`. Only the full
  `/schedule-visit` page persists. A backend must make the modal path write a real request too.
- **Two stores, no shared id (inconsistency):** `db.visits` (V8###) and `puneNestPropVisitReqs`
  ('v'+timestamp) are written separately with no cross-reference, so a visit can be `completed` in
  one and `requested` in the other. The backend should unify them into one `visit_requests` table.
- **Owner not resolvable:** if `ownerMobile` is empty (no `o` param and listing has no
  `ownerMobile`), only `db.visits` is written; the review-gate request is skipped.
- **Loading / empty:** the property summary panel shows a "browse listings" empty state until the
  listing resolves; the dashboard shows an empty calendar state when there are no visits.
