/**
 * Owner outreach — chasing the person behind a listing, and the record that it happened.
 *
 * Three operations over two routes plus the template library:
 *
 *   GET  /admin/message-templates?channel=whatsapp   the template library (staff/admin)
 *   POST /properties/{id}/outreach                   compose a chaser  (`postOnBehalf:write`)
 *   GET  /properties/{id}/outreach                   the chaser history (`properties:read`)
 *
 * ## The two guards are deliberately different, and the wider one is the read
 *
 * Sending needs `postOnBehalf:write` — the same atom as manufacturing a listing under a stranger's
 * number, because this is the same power pointed at the same people: it puts a message on a member
 * of the public's personal phone, in the platform's name, unprompted. Reading needs only
 * `properties:read`, because the whole point of a shared log is that the colleague about to phone
 * this owner can check whether somebody already has; gating the history behind the permission to
 * add to it would leave exactly the person who should back off unable to find out.
 *
 * ## Nothing here claims a message was delivered
 *
 * `status` is `prepared` on every row this server can produce, and that is not a placeholder. What
 * ships is WhatsApp click-to-chat: the server renders the text and returns a `handoffLink`, the
 * staff member's own WhatsApp opens with it typed out, and they press send — or edit it first, or
 * close the tab. The platform knows a chaser was **written**. It cannot know one was **delivered**.
 *
 * Every surface that renders one of these is obliged to say so. "3 chasers written" is honest;
 * "3 messages sent" is a number nobody can trust, and the ledger exists precisely so that the
 * question "who keeps messaging this owner" has a real answer.
 *
 * ## What does not come back, and must not be re-invented locally
 *
 * The mock incremented `listing.reminderCount` and `listing.lastReminderAt` in the browser's own
 * copy of the data. The server derives the count from the ledger and attaches it to the listing's
 * `adminPipeline` on read, so a client-side counter would now be a second, quietly disagreeing
 * answer to a question the server already answers. Read the count off the listing; do not keep one.
 *
 * ## Ids are UUIDs
 *
 * `{id}` is parsed as a UUID and `propertyMapper` sets a listing's `id` to `slug || id`, with the
 * real key on `uuid`. Pass `listing.uuid || listing.id`, or the live listings — the ones with
 * slugs — are exactly the ones that 404.
 */
import { createProvider } from './config.js';

export { interpolateOutreachTemplate } from '../lib/outreachTemplate.js';

const provider = createProvider('outreach');

/**
 * The active templates for one channel, ordered by category then name.
 *
 * Read-only, and there is no authoring screen on purpose: this copy is the platform speaking in its
 * own name to people who did not ask to be contacted, so changing it is a migration — a change with
 * a reviewer and a history — rather than a text box any staff account can rewrite unreviewed.
 *
 * Not paged. There are ten and they are picked from a dropdown.
 */
export async function listOutreachTemplates(channel = 'whatsapp') {
  return (await provider()).listOutreachTemplates(channel);
}

/**
 * Compose a chaser to this listing's owner and record it.
 *
 * Returns `{ id, body, status, handoffLink }` — the ledger row, the fully rendered text, `prepared`,
 * and the `wa.me` URL the console opens to finish the job. **Only the console may depend on
 * `handoffLink`**; it disappears the day a real transport is wired in, and every other reader should
 * be looking at `body` and `status`.
 *
 * 409 when the listing has no owner mobile to reach — a real state, not a bug, and worth saying out
 * loud rather than rendering a generic failure.
 */
export async function chaseOwner(propertyId, templateId) {
  return (await provider()).chaseOwner(propertyId, templateId);
}

/** Every chaser written to this listing's owner, newest first. */
export async function listOwnerOutreach(propertyId) {
  return (await provider()).listOwnerOutreach(propertyId);
}
