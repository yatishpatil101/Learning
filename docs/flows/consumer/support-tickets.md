# Flow: Consumer Support Tickets

> How a signed-in (or number-identified) user raises a help ticket, chats with support in a threaded
> conversation, and how that ticket feeds the staff support queue.
> **Status:** documented from React source - **Primary role(s):** buyer/owner/tenant (customer) + support staff (responder)

---

## 1. Purpose & user problem
- **Persona:** any user with a problem - a failed payment, a stuck listing, a KYC/verification issue,
  a booking/visit problem, a bug.
- **Job-to-be-done:** "Report my issue with context (category, priority, screenshots), get a ticket
  id, and go back and forth with support until it's resolved."
- **Why it matters:** it's the human safety net behind the self-serve product and the trust promise;
  every unresolved ticket is churn risk. It also feeds the ops support queue that staff work.

## 2. Entry points
- **Route:** `/support` (the public Support/Help page). Deep links: `?cat=<category>` preselects the
  category; `?open=SUP-10001` auto-opens an existing ticket thread.
- **Tiles / triggers:** footer/help links, in-context "contact support" links across the app, and the
  FAQ section on the same page (self-serve first).
- **Source components:** `src/pages/consumer/Support.jsx` (container),
  `src/pages/consumer/support/{TicketForm,TicketList,TicketThreadModal,Lightbox,ContactCard,FaqSection}.jsx`,
  `src/pages/consumer/support/constants.js` (status chips), and the service module
  `src/lib/data/support.js`.
- **Scope note:** this is the **customer support** ticket system (`SUP-` ids, `draazySupport`
  store). It is DISTINCT from the ops **service requests** queue (`src/data/tickets.json`, `T9###`
  ids, teams rental/legal/loans/interior/packers/valuation, statuses new/in_progress/done/cancelled,
  worked in `src/lib/data/tickets.js`) which fulfils paid home-services and is not this flow.

## 3. Actors & roles
- **Customer (maker):** creates the ticket and replies. Identified by mobile (normalised to 10
  digits, `^91` stripped); the form prefills name/mobile/email from the signed-in `user`.
- **Support staff (responder):** replies with `role: 'staff'`; assignment fields (`assignedTo`,
  `assignedId`) and `unreadStaff` exist for the staff queue. Staff work happens in the back-office
  (out of scope here); the consumer page only renders the customer side.
- No Aadhaar/contact gate applies; support is intentionally low-friction.

## 4. Entities touched
Links go to [`../../system/data-model.md`](../../system/data-model.md).
- `support_tickets` + `ticket_messages` (runtime `src/lib/data/support.js`, localStorage key
  `draazySupport = { tickets: [], seq: 10000 }`) - created, replied-to, read-tracked. Ids
  `SUP-<seq>` where `seq` increments from 10000.
- `faqs` (seed via `getFaqs()`) - read (self-serve FAQ section).
- `users` - read for prefill (name/mobile/email); the ticket stores a mobile string that maps to a
  user (mobile-keying note in the domain model).

## 5. Business rules & logic  *(the meat)*

### Ticket record shape (`createTicket`)
```
{ id: 'SUP-'+seq, mobile, name, email, category, subject(<=140), priority,
  status: 'new', assignedTo: null, assignedId: null,
  createdAt, updatedAt, unreadStaff: 1, unreadCustomer: 0,
  messages: [ { id, by: 'customer', name, text, images[], at } ] }
```
- New tickets are `unshift`ed (newest first) and start `status: 'new'` with `unreadStaff: 1` (waiting
  on staff), `unreadCustomer: 0`. The first message is the customer's description.

### Categories (`CATEGORIES`)
`payment` (Payments & Refunds), `rent` (Rent Payment / HRA), `listing` (Property Listing),
`verification` (Verification / KYC), `account` (Account & Login), `booking` (Visit / Booking),
`service` (Home Services), `technical` (Technical / Bug), `other` (Something else). Each has an icon;
labels are i18n-resolved (`getCatLabel`).

### Priorities (`PRIORITIES`)
`low`, `normal` (default), `high`, `urgent`.

### Statuses (`STATUS`)
`new` (New), `open` (In progress), `waiting` (Awaiting your reply), `resolved` (Resolved), `closed`
(Closed). Status chip colours in `support/constants.js` (`STATUS_CHIP`).

### Reply + status transitions (`replyToTicket`)
- Role is coerced: `o.role === 'staff' ? 'staff' : 'customer'`. Message appended; `updatedAt` bumped.
- **Staff reply:** `unreadCustomer++`; if status was `new` or `resolved`, set to `open`.
- **Customer reply:** `unreadStaff++`; if status was `resolved`, `closed`, or `waiting`, set to
  `open` (a customer reply re-opens a resolved/closed ticket).
- `markTicketRead(id, role)` zeroes the caller's unread counter (`unreadStaff` for staff,
  `unreadCustomer` for customer). Opening a thread on the consumer side marks it read as `customer`.

### Validation (`Support.submit`)
Enforced before `createTicket`:
- **Name** required (trimmed non-empty).
- **Mobile** must match `^[6-9]\d{9}$` (Indian 10-digit; input pre-normalised by stripping non-digits
  and a leading `91`).
- **Subject** length >= 4 (input `maxLength=120`; store also hard-caps `subject` to 140 chars).
- **Message** length >= 8.
Each failure toasts a specific error and aborts.

### Image attachments (`compressFiles` / `compressImage`)
- Up to `MAX_IMAGES = 4` images per message; non-image files are filtered out; extras beyond the
  remaining room are dropped with a toast.
- Each image is client-compressed: max dimension 1100px (aspect-preserving), re-encoded as JPEG at
  quality 0.62, stored as a data URL `{ name, type: 'image/jpeg', data }`. Falls back to the original
  data URL if canvas encoding fails.

### Listing + threading (`Support.jsx`, `TicketList`, `TicketThreadModal`)
- `ticketsForUser(mobile)` returns the user's tickets sorted by `updatedAt` desc; `allTickets()` is
  the global sort (staff view). The list shows id, subject, last-message preview (prefixed
  "Support:"/"You:"), category chip, relative `updatedAt` (`fmtTime`), status chip, and an unread dot
  when `unreadCustomer > 0`.
- After a successful create, the form clears subject/message, toasts the new id, reloads the list, and
  opens the thread.

## 6. Maker-checker / approval
- **Not a maker-checker.** Support is a two-party conversation, not a proposer/approver workflow. The
  nearest analogue is the unread + status handshake (customer waits on staff and vice-versa), but
  there is no approve/reject gate. (See [`../../system/cross-cutting.md`](../../system/cross-cutting.md)
  section 2 for the pattern this flow does NOT use.)

## 7. State machine
```
create -> new
  new       --staff reply--> open
  open      --customer reply--> open      (stays open)
  open      --staff resolves (back-office)--> resolved
  resolved  --customer reply--> open      (re-opened)
  resolved  --(staff) closes--> closed
  closed    --customer reply--> open      (re-opened)
  waiting   --customer reply--> open
```
- `waiting` ("Awaiting your reply") is a staff-set state that a customer reply moves back to `open`.
- **Terminal-ish:** `resolved` and `closed`, but both re-open on a customer reply, so nothing is
  hard-terminal from the customer side. (Setting `resolved`/`closed`/`waiting`/assignment is a
  staff/back-office action; the consumer app only ever writes `customer` replies and reads state.)

## 8. Edge cases, validation & error states
- **Invalid mobile / short subject / short message / empty name** -> specific toast, no ticket
  created.
- **localStorage save failure** (`save()` returns false) -> `createTicket`/`replyToTicket` return
  `null` and the UI toasts a save/send error.
- **Empty reply** (no text and no images) -> blocked with a toast.
- **No tickets yet** -> distinct empty state ("no tickets" hint), never a blank panel.
- **Attachment overflow** (> 4) -> toast and drop extras; non-images silently filtered.
- **Deep-link `?open=` to a foreign/missing ticket** -> guarded; only opens if it belongs to this
  user's mobile.
- **Identity by mobile:** tickets are filtered by normalised mobile, so a user must use the same
  number they filed under; a signed-out user can still file by typing a valid mobile.
- **Read tracking is per-role** so the two unread counters never clobber each other.
