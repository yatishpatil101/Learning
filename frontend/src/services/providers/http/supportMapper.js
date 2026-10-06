/** Status passes through unchanged so unknown ones show as visible gaps; `at` must be a number for sorting;
 * `updatedAt` is derived from the last message since the wire has none. */

/** ISO instant → epoch ms. 0 for a missing date, so a sort never produces NaN. */
function epoch(iso) {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** Staff-side roles. Everything else — buyer, owner, null — is the person who raised the ticket. */
const STAFF_ROLES = new Set(['staff', 'manager', 'admin']);

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

/** No thread and no mobile: the queue is platform-wide and lists get exported. `awaitingReply` (unanswered)
 * and `unread` (reply not opened) are different facts and must not be collapsed. */
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

/** Not re-sorted: the server's order spans pages; sorting rows in hand would mean "newest on this page". */
export function toQueuePage(res, fallback = {}) {
  const rows = Array.isArray(res?.content) ? res.content : [];
  return {
    items: rows.map(toQueueRow).filter(Boolean),
    total: res?.totalElements ?? rows.length,
    counts: res?.counts,
    page: res?.page ?? res?.number ?? fallback.page ?? 0,
    size: res?.size ?? fallback.size ?? rows.length,
  };
}

/** `priority`, `images` and `status` have no schema field and unknown properties are ignored,
 * so sending them would appear to work while silently doing nothing. */
export function toTicketCreate(ticket) {
  return {
    subject: String(ticket?.subject || '').trim(),
    category: ticket?.category || 'other',
    body: String(ticket?.message || '').trim(),
  };
}
