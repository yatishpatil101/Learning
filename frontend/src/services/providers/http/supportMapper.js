/**
 * `SupportTicket` / `Message` (wire) → the view models `Support.jsx` renders.
 *
 * Three separate vocabularies have to be reconciled here, and each one has a wrong answer that
 * looks right.
 *
 * ## 1. Status
 *
 * The page and the server now share one five-status vocabulary: `open`, `in-progress`, `waiting`,
 * `resolved`, `closed`. The mock opens a ticket `open` (as the server does) and moves it to
 * `in-progress` when support picks it up, so there is no longer a mock-only `new` to reconcile.
 *
 * Status is therefore **passed through unchanged**, not defaulted — an identity map. Unknown statuses
 * still fall through to `getStatusLabel`, which shows the raw key, so any future server status
 * without a label is visibly a gap rather than silently collapsed onto `open`, which would erase a
 * distinction ops actually made.
 *
 * ## 2. Author role
 *
 * `authorRole` is `buyer|owner|staff|admin`; the page's bubbles key on `by: 'customer'|'staff'`.
 * Anything that is not staff-side is the customer — including `owner`, because an owner raising a
 * support ticket is a customer of support. Getting this backwards renders the reader's own message
 * as if support had sent it.
 *
 * ## 3. Time
 *
 * `at` must be a **number**: the thread sorts on it and `fmtTime` does date arithmetic. An ISO
 * string sorts almost right, which is exactly why it survives casual testing.
 *
 * ## `updatedAt` is not on the wire
 *
 * The mock sorts the list by `updatedAt`; the server sorts by `createdAtDesc` and does not send an
 * updated time. So it is **derived from the last message**, which is the thing that actually changed
 * — a ticket answered this morning belongs above one opened last week. Falling back to `createdAt`
 * for a ticket with no messages keeps the sort total.
 */

/** ISO instant → epoch ms. 0 for a missing date, so a sort never produces NaN. */
function epoch(iso) {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** Staff-side roles. Everything else — buyer, owner, null — is the person who raised the ticket. */
const STAFF_ROLES = new Set(['staff', 'admin']);

/** One wire `Message` → one thread bubble. */
export function toMessage(m) {
  if (!m) return null;
  return {
    id: m.id,
    by: STAFF_ROLES.has(m.authorRole) ? 'staff' : 'customer',
    // `author` is null for a message whose author has since been removed. The bubble prints this,
    // so give it something rather than `undefined`.
    name: m.author || (STAFF_ROLES.has(m.authorRole) ? 'Support' : 'You'),
    text: m.body || '',
    // Attachments have no server representation. Empty array, never undefined: every consumer maps
    // over it without a guard.
    images: [],
    at: epoch(m.createdAt),
  };
}

/** One wire `SupportTicket` → one view model. */
export function toViewModel(t) {
  if (!t) return null;
  const messages = (Array.isArray(t.messages) ? t.messages : []).map(toMessage).filter(Boolean);
  const created = epoch(t.createdAt);
  return {
    id: t.id,
    subject: t.subject || '',
    category: t.category || 'other',
    // Passed through, never coerced — see the status table above.
    status: t.status || 'open',
    // Not on the wire at all. Empty string rather than a fabricated 'normal': the page uses it to
    // decide whether to render a priority chip, and a default would show a priority nobody set.
    priority: '',
    unread: !!t.unread,
    createdAt: created,
    // Derived: the server sorts by creation and sends no updated time, but a ticket answered today
    // belongs above one opened last week.
    updatedAt: messages.length ? Math.max(created, messages[messages.length - 1].at) : created,
    messages,
  };
}

/** A wire array → view models, newest activity first. */
export function toViewModelList(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(toViewModel)
    .filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * One wire `AdminSupportTicket` → one row of the ops queue (D51).
 *
 * A different schema from `SupportTicket`, and the difference is the point: this one carries **no
 * thread**, because the list is the whole platform's support traffic rather than one person's own
 * history, and an unbounded response is what `GET /support/tickets` was narrowed to avoid. It also
 * carries **no mobile** — the detail read reveals it to the same callers, and a list is the shape
 * that gets exported.
 *
 * `raiser` is a display name and the contract declares it nullable — a ticket raised by an account
 * that has since been removed has nobody to name. The fallback is owed by the UI and lives here
 * rather than in the page, so every consumer of the queue gets the same one instead of rendering
 * `null` as an empty cell that reads like a bug.
 *
 * Two booleans, two different meanings, and they are not opposites:
 *   - `awaitingReply` — a customer message nobody on the desk has read. This is the working queue.
 *   - `unread` — a staff reply the *customer* has not opened. "We answered and they have not
 *     looked" is not the same fact as "we have not answered", and a queue that collapses them
 *     tells the desk to chase people it has already answered.
 */
export function toQueueRow(t) {
  if (!t) return null;
  return {
    id: t.id,
    subject: t.subject || '',
    // Nullable on the wire; the page groups and labels on it, so give it the same 'other' bucket
    // the customer-side mapper uses rather than an empty string that sorts oddly.
    category: t.category || 'other',
    status: t.status || 'open',
    raiser: t.raiser || '',
    awaitingReply: !!t.awaitingReply,
    unread: !!t.unread,
    createdAt: epoch(t.createdAt),
  };
}

/**
 * A `PageResponse<AdminSupportTicket>` → the `{ items, total, page, size }` both providers return.
 *
 * The order is **not** re-sorted here. The server fixes it (`created_at desc`, backed by the V53
 * index) and the page is a window onto that order: re-sorting the 20 rows in hand would silently
 * make "newest first" mean "newest on this page first", which looks correct until page 2.
 */
export function toQueuePage(res, fallback = {}) {
  const rows = Array.isArray(res?.content) ? res.content : [];
  return {
    items: rows.map(toQueueRow).filter(Boolean),
    total: res?.totalElements ?? rows.length,
    page: res?.page ?? res?.number ?? fallback.page ?? 0,
    size: res?.size ?? fallback.size ?? rows.length,
  };
}

/**
 * The form → `SupportTicketCreate`.
 *
 * Note what is absent: `mobile`, `name`, `email`, `priority`, `images`, `status`. The first three
 * are the session's; the last three have no field on the schema. Sending them would not fail — an
 * unknown property is ignored — which is precisely the danger: the form would appear to work and
 * the priority would silently never exist.
 */
export function toTicketCreate(ticket) {
  return {
    subject: String(ticket?.subject || '').trim(),
    category: ticket?.category || 'other',
    body: String(ticket?.message || '').trim(),
  };
}
