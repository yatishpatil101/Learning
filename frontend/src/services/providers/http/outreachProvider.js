// All three routes answer bare JSON — none is a `PageResponse`, so there is nothing to unwrap.
// `{market_rate}` and `{claim_link}` are filled server-side, not here.
import { get, post } from '../../http.js';

const toTemplate = (row) => ({
  id: String(row?.id || ''),
  channel: row?.channel || 'whatsapp',
  category: row?.category || null,
  name: row?.name || '',
  body: row?.body || '',
});

// `status` is `prepared` on every row — the transport is WhatsApp click-to-chat, so the server
// composes and hands off and never witnesses a delivery. The UI must say "written", not "sent".
const toPrepared = (row) => ({
  id: row?.id ? String(row.id) : null,
  body: row?.body || '',
  status: row?.status || 'prepared',
  handoffLink: row?.handoffLink || null,
});

// `preparedBy` is a UUID with no display name on the wire, so the log shows nothing rather than a
// raw id — and never the current session, whose whole value is that the last chaser was somebody else.
const toOutreachEntry = (row) => ({
  id: row?.id ? String(row.id) : null,
  templateId: row?.templateId || null,
  channel: row?.channel || 'whatsapp',
  body: row?.body || '',
  status: row?.status || 'prepared',
  preparedById: row?.preparedBy ? String(row.preparedBy) : null,
  preparedAt: row?.preparedAt || null,
});

/** Staff/admin — role alone, no permission atom. */
export async function listOutreachTemplates(channel = 'whatsapp') {
  const rows = await get(`/admin/message-templates?channel=${encodeURIComponent(channel)}`);
  return (Array.isArray(rows) ? rows : []).map(toTemplate);
}

/** `postOnBehalf:write`. 409 if the owner has no mobile. */
export async function chaseOwner(propertyId, templateId) {
  return toPrepared(await post(`/properties/${encodeURIComponent(propertyId)}/outreach`, { templateId }));
}

/** Newest first. `properties:read`. */
export async function listOwnerOutreach(propertyId) {
  const rows = await get(`/properties/${encodeURIComponent(propertyId)}/outreach`);
  return (Array.isArray(rows) ? rows : []).map(toOutreachEntry);
}
