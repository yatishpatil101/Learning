/**
 * Mock outreach provider — the demo-mode counterpart to `providers/http/outreachProvider.js`.
 *
 * Same method names, same arguments, same **shapes**, and — the part a mock most often gets wrong —
 * the same **access rules**. The server guards sending with `postOnBehalf:write` and reading with
 * `properties:read`, both of which are staff-or-admin; a mock that answers anybody would let a
 * signed-out visitor in a demo build compose a message in the platform's name to a real owner's
 * phone number, which is the one operation on this platform that reaches a member of the public
 * unprompted.
 *
 * ## It keeps a ledger, because the alternative is an unfalsifiable screen
 *
 * The mock store had no outbound-message table: `sendWhatsappTemplate` bumped a counter on the
 * listing and opened WhatsApp, so "who has already chased this owner" had no answer and a Follow-up
 * tab rendered against it would be permanently, healthily empty. This writes `db.outboundMessages`
 * with the same five fields the server's ledger returns, so the tab can be exercised without a
 * backend and a regression that stops recording is visible rather than merely quiet.
 *
 * Nothing here is invented: `id`, `templateId`, `channel`, `body`, `status`, `preparedBy` and
 * `preparedAt` are exactly the columns `OutboundMessage` has.
 *
 * ## Two placeholders the old mock filled in and this one deliberately does not
 *
 * `market_rate` was the literal string `9,500` — the same figure for every locality in Pune, quoted
 * to an owner deciding what to charge. `claim_link` pointed at `punenest.com/claim/{id}`, a route
 * this application has never had. The server supplies neither the first nor that form of the
 * second, so filling them here would make demo mode render a message the live system cannot send.
 * `{market_rate}` is left standing as literal text — which is the server's rule for an unknown key,
 * and the reason for it — and `claim_link` resolves to the sign-in page, because the account is
 * provisioned against the owner's own mobile and signing in *is* the claim.
 */
import { rawLoad, rawSave, delay, currentStaffInfo } from '../../../lib/mockApi/core.js';
import { getWhatsappTemplates } from '../../../lib/mockApi.js';
import { readUser, isInternal } from '../../../lib/auth.js';
import { ApiError } from '../../http.js';
import { interpolateOutreachTemplate } from '../../../lib/outreachTemplate.js';

/* `ApiError` takes an options **object**, not positional arguments. */
const notFound = (message) => new ApiError({ code: 'not_found', status: 404, message });
const conflict = (message) => new ApiError({ code: 'conflict', status: 409, message });
const forbidden = (message) => new ApiError({ code: 'forbidden', status: 403, message });

/** Both routes and the template library are staff-or-admin on the server. */
function staffOnly(what) {
  if (!isInternal(readUser())) throw forbidden(`Only staff can ${what}`);
}

const findListing = (db, propertyId) =>
  (db.listings || []).find((l) => String(l.id) === String(propertyId)) || null;

/**
 * The template library, in the server's shape.
 *
 * The stored rows carry no `channel` — the mock library is WhatsApp-only — so the filter is applied
 * against the constant the server would have stored rather than dropped. Asking for `sms` returns
 * nothing, which is the truth in both stores.
 */
export async function listOutreachTemplates(channel = 'whatsapp') {
  staffOnly('read the outreach template library');
  const rows = (getWhatsappTemplates() || []).map((t) => ({
    id: String(t.id),
    channel: 'whatsapp',
    category: t.category || null,
    name: t.name || '',
    body: t.body || '',
  }));
  return delay(rows.filter((t) => t.channel === channel));
}

/**
 * Compose a chaser, record it, and return the same four fields the server returns.
 *
 * The listing's `reminderCount`/`lastReminderAt` are still bumped, because the demo console reads
 * them; live, the same number is derived from the ledger and attached to `adminPipeline`, so no
 * screen should be keeping its own.
 */
export async function chaseOwner(propertyId, templateId) {
  staffOnly('send owner outreach');
  const db = rawLoad();
  const listing = findListing(db, propertyId);
  if (!listing) throw notFound('Listing not found');

  const template = (getWhatsappTemplates() || []).find((t) => String(t.id) === String(templateId));
  if (!template) throw notFound('Template not found');

  const mobile = String(listing.ownerMobile || '').replace(/\D/g, '');
  if (!mobile) throw conflict('This listing has no owner mobile to reach.');

  const staff = currentStaffInfo();
  const body = interpolateOutreachTemplate(template.body, {
    owner_name: listing.owner || 'there',
    owner_mobile: listing.ownerMobile,
    title: listing.title,
    locality: listing.locality,
    price: listing.price == null ? null : String(listing.price),
    listing_id: String(listing.id),
    staff_name: staff.name || 'PuneNest',
    claim_link: `${window.location.origin}/signin`,
  });

  const row = {
    id: `om-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    templateId: String(template.id),
    channel: 'whatsapp',
    subjectType: 'property',
    subjectId: String(listing.id),
    body,
    status: 'prepared',
    preparedBy: staff.name || 'PuneNest',
    preparedAt: new Date().toISOString(),
  };
  db.outboundMessages = [row, ...(db.outboundMessages || [])];
  listing.reminderCount = (listing.reminderCount || 0) + 1;
  listing.lastReminderAt = row.preparedAt;
  rawSave(db);

  return delay({
    id: row.id,
    body,
    status: 'prepared',
    handoffLink: `https://wa.me/91${mobile}?text=${encodeURIComponent(body)}`,
  });
}

/**
 * The chaser history for one listing, newest first.
 *
 * `preparedById` carries the staff **name** here where the server sends a user id, because the mock
 * store has no user ids for staff. Nothing renders it in either store — the http provider's doc
 * records why an opaque id is worse than an absent field — so the two disagree only where neither
 * is read, and the alternative was a mock field that is always `null`.
 */
export async function listOwnerOutreach(propertyId) {
  staffOnly('read the outreach history');
  const db = rawLoad();
  const rows = (db.outboundMessages || [])
    .filter((m) => m.subjectType === 'property' && String(m.subjectId) === String(propertyId))
    .map((m) => ({
      id: m.id,
      templateId: m.templateId || null,
      channel: m.channel || 'whatsapp',
      body: m.body || '',
      status: m.status || 'prepared',
      preparedById: m.preparedBy || null,
      preparedAt: m.preparedAt || null,
    }));
  return delay(rows);
}
