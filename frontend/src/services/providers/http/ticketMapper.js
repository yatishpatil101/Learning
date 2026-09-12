/**
 * Wire `Ticket` ⇄ the ops board's view model.
 *
 * The board is `OpsQueue`, rendered by `/ops/requests`. Its vocabulary predates the server by
 * months, and three of its words turned out to be wrong rather than merely different — which is
 * the reason this file exists at all instead of the provider passing `TicketDto` straight through.
 *
 * ## `assignedTo` is a name on the way in and an id on the way out
 *
 * `TicketDto.assignee` is already resolved to a **display name** server-side (`TicketMapper` looks
 * the user up), so the read needs no work. The write is the asymmetric half: `TicketUpdate` takes
 * an `assigneeId`, and `TicketService.update` answers an id that does not resolve to an ops user
 * with a 404 — "assigning work to somebody who does not exist is a mistake, not a preference".
 * The board's old `updateTicket(id, { assignedTo: user.name })` therefore cannot be ported at all;
 * a name is not an id and no amount of mapping makes it one. `toClaim` takes the caller's own id
 * and nothing else.
 *
 * ## The status vocabulary is the server's, and it is bigger
 *
 * The mock knew three words (`new`, `in_progress`, `done`). `TicketStatuses` knows five (`open`,
 * `in-progress`, `waiting`, `resolved`, `closed`). There is no honest translation: `waiting` and
 * `closed` have no mock equivalent to map onto, and collapsing them would make a ticket parked on
 * a customer look identical to one nobody has picked up. So the board adopted the server's five
 * and this mapper does **not** translate — the same call D184 made for the drafting desk, for the
 * same reason. The one thing it does is normalise `in_progress` to `in-progress` on the way out,
 * because that underscore is spelled into old fixtures and query strings and a silent 400 is a
 * poor way to find out.
 *
 * ## Notes are not a field you write
 *
 * `TicketDto.notes` is readable and `TicketUpdate` has no `notes` member, because appending is a
 * `POST /{id}/notes`. The board used to read-modify-write the whole array, which is how two people
 * taking notes on the same ticket lose one of them. Not mapped, not writable, and `toNote` exists
 * only to give the append response the shape the list is already rendering.
 */

/** Wire timestamps are ISO; the board sorts and formats on epoch millis. */
const epoch = (iso) => (iso ? Date.parse(iso) || 0 : 0);

/** Old spelling in, canonical spelling out. Everything else is passed through and validated server-side. */
export const toWireStatus = (status) => (status === 'in_progress' ? 'in-progress' : status || undefined);

/** One internal note. `at` stays ISO — it is displayed, never compared. */
function toNoteRow(n) {
  if (!n) return null;
  return { by: n.by || 'Ops', text: n.text || '', at: n.at || null };
}

/** The append response (`TicketDto.Note`), for pushing onto a list already on screen. */
export const toNote = (dto) => toNoteRow(dto);

/**
 * `TicketDto` → one board row.
 *
 * `assignedTo` keeps the board's name for the field because forty-odd call sites read it, but it
 * now holds what the server resolved rather than whatever string the last claim wrote.
 * `value` is a rupee amount or `null`; `notes` is always an array, so the drawer can map it
 * without first proving the ticket had any.
 */
export function toViewModel(dto) {
  if (!dto) return null;
  return {
    id: dto.id,
    subject: dto.subject || '',
    team: dto.team || null,
    priority: dto.priority || 'medium',
    status: dto.status || 'open',
    propertyId: dto.propertyId || null,
    assignedTo: dto.assignee || null,
    service: dto.service || null,
    customer: dto.customer || '',
    mobile: dto.mobile || '',
    value: dto.value ?? null,
    quotedValue: dto.quotedValue ?? null,
    detail: dto.detail || '',
    notes: (Array.isArray(dto.notes) ? dto.notes : []).map(toNoteRow).filter(Boolean),
    createdAt: epoch(dto.createdAt),
  };
}

/**
 * The `PageResponse` envelope → `{ items, total, page, size }`.
 *
 * `total` comes off the envelope rather than `items.length`, which is the whole point of paging:
 * the board's "48 open" must be true on page 1 of 3, and a count taken from the rows in hand is
 * only ever true when there is exactly one page.
 */
export function toViewModelPage(res, fallback = {}) {
  const rows = Array.isArray(res?.content) ? res.content : [];
  return {
    items: rows.map(toViewModel).filter(Boolean),
    total: res?.totalElements ?? rows.length,
    page: res?.page ?? fallback.page ?? 0,
    size: res?.size ?? fallback.size ?? rows.length,
  };
}

/**
 * The caller's own id → `TicketUpdate`.
 *
 * Deliberately not `{ assigneeId, status }`. Claiming and moving a ticket are two decisions and the
 * board makes them separately, so a claim that also advanced the status would be doing something
 * the person did not ask for — and `open → in-progress` is a transition the server is entitled to
 * refuse on its own terms.
 */
export const toClaim = (userId) => ({ assigneeId: String(userId || '') });

/**
 * A board form → `TicketCreate`. Blank optional fields are omitted, not sent empty.
 *
 * `quotedValue` is sent only when it is a real number, and `0` is deliberately allowed through:
 * a `if (data.quotedValue)` guard would drop a genuinely free quote, and "quoted, no charge" is a
 * different fact from "nobody quoted anything" — which is what the server reads `null` as. The
 * null/empty check comes first because `Number(null)` and `Number('')` are both `0`, so a bare
 * `Number.isFinite(Number(x))` would turn "no quote" into "quoted zero" — the same conflation this
 * field exists to prevent, arriving through the guard meant to protect it.
 */
export function toCreate(data) {
  const body = { subject: String(data?.subject || '').trim() };
  if (data?.team) body.team = data.team;
  if (data?.priority) body.priority = data.priority;
  if (data?.propertyId) body.propertyId = data.propertyId;
  if (data?.body) body.body = String(data.body).trim();
  const quoted = data?.quotedValue;
  if (quoted !== null && quoted !== undefined && quoted !== '' && Number.isFinite(Number(quoted))) {
    body.quotedValue = Number(quoted);
  }
  return body;
}
