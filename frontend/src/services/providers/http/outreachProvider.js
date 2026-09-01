/**
 * HTTP outreach provider — the live counterpart to `providers/mock/outreachProvider.js`.
 *
 *   GET  /admin/message-templates?channel=…   → `MessageTemplateDto[]`
 *   POST /properties/{id}/outreach            → `MessageSender.Prepared`
 *   GET  /properties/{id}/outreach            → `OwnerOutreachEntry[]`
 *
 * All three are bare JSON arrays or objects — none is a `PageResponse` — so there is nothing to
 * unwrap. Verified against `engagement/messaging/MessageTemplateDto.java`,
 * `common/trust/MessageSender.java` and `moderation/property/OwnerOutreachService.java`.
 *
 * ## Where the server's vocabulary differs from the mock's, and what each difference costs
 *
 * | mock                              | server                          | consequence                    |
 * |-----------------------------------|---------------------------------|--------------------------------|
 * | `{ message }`                     | `{ body }`                      | renamed here, once             |
 * | `{ waUrl }`                       | `{ handoffLink }`               | renamed here, once             |
 * | *(no id)*                         | `id` — the ledger row           | an audit entry can point at it |
 * | *(no status)*                     | `status` — always `prepared`    | see below                      |
 * | `{ listing, template }` echoed    | absent                          | the caller already has both    |
 * | template has no `channel`         | template has `channel`          | the picker can be filtered     |
 * | history: none                     | `preparedBy` is a **user id**   | see below                      |
 *
 * **`status` is `prepared` on every row, and the UI must say "written", not "sent".** The transport
 * is WhatsApp click-to-chat; the server composes and hands off, and never witnesses a delivery.
 *
 * **`preparedBy` is a UUID, not a name.** The history route returns the staff member's id and no
 * display name, so a Follow-up tab that wants "chased by Priya" needs a second lookup or must show
 * nothing. It shows nothing rather than a raw UUID: an opaque id in a human-facing log is worse
 * than an absent field, because it reads as a bug and invites somebody to paste it somewhere.
 * Deliberately **not** invented from the current session — the whole value of the log is that the
 * previous chaser was somebody else.
 *
 * **Two template placeholders the mock invented, and what became of them.** `{market_rate}` was the
 * string `9,500` for every locality in Pune, and `{claim_link}` pointed at `/claim/{id}`, a route
 * this application has never had. The server supplies a real `claim_link` (the sign-in page) at
 * send time, and now supplies a real `market_rate` too — the listing's own locality rate, from
 * `localities.rate_per_sqft`, omitted where that locality has no published rate so the placeholder
 * stands rather than a number being made up. Neither is filled in here — see
 * `outreachService.interpolateOutreachTemplate` for why an unknown key is left standing.
 */
import { get, post } from '../../http.js';

/** One template row as the picker reads it. */
const toTemplate = (row) => ({
  id: String(row?.id || ''),
  channel: row?.channel || 'whatsapp',
  category: row?.category || null,
  name: row?.name || '',
  body: row?.body || '',
});

/**
 * One composed chaser.
 *
 * `status` falls back to `prepared` rather than to `null` or `''`, because every branch that reads
 * it is deciding what to tell a staff member about a message, and an empty status renders as either
 * nothing or "unknown" — both of which are less true than the one thing this server always knows.
 */
const toPrepared = (row) => ({
  id: row?.id ? String(row.id) : null,
  body: row?.body || '',
  status: row?.status || 'prepared',
  handoffLink: row?.handoffLink || null,
});

/** One row of the chaser history. */
const toOutreachEntry = (row) => ({
  id: row?.id ? String(row.id) : null,
  templateId: row?.templateId || null,
  channel: row?.channel || 'whatsapp',
  body: row?.body || '',
  status: row?.status || 'prepared',
  preparedById: row?.preparedBy ? String(row.preparedBy) : null,
  preparedAt: row?.preparedAt || null,
});

/** The active templates for one channel. Staff/admin — role alone, no permission atom. */
export async function listOutreachTemplates(channel = 'whatsapp') {
  const rows = await get(`/admin/message-templates?channel=${encodeURIComponent(channel)}`);
  return (Array.isArray(rows) ? rows : []).map(toTemplate);
}

/** Compose a chaser and record it. `postOnBehalf:write`. 409 if the owner has no mobile. */
export async function chaseOwner(propertyId, templateId) {
  return toPrepared(await post(`/properties/${encodeURIComponent(propertyId)}/outreach`, { templateId }));
}

/** The chaser history for one listing, newest first. `properties:read`. */
export async function listOwnerOutreach(propertyId) {
  const rows = await get(`/properties/${encodeURIComponent(propertyId)}/outreach`);
  return (Array.isArray(rows) ? rows : []).map(toOutreachEntry);
}
