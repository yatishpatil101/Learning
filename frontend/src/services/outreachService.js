// A chaser is `prepared` when written and `sent` only once staff attest they pressed send in
// WhatsApp; the platform never witnesses delivery.

// The count lives on the listing's `adminPipeline`; do not keep a local `reminderCount`. Ids are
// UUIDs — pass `listing.uuid || listing.id`, or the listings that have slugs are the ones that 404.
import { createProvider } from './config.js';

export { interpolateOutreachTemplate } from '../lib/outreachTemplate.js';

const provider = createProvider('outreach');

// Read-only, and there is no authoring screen on purpose: this copy is the platform speaking in its
// own name to people who did not ask to be contacted, so changing it is a reviewed migration.
export async function listOutreachTemplates(channel = 'whatsapp') {
  return (await provider()).listOutreachTemplates(channel);
}

// Returns `{ id, body, status, handoffLink }`. **Only the console may depend on `handoffLink`** —
// it disappears the day a real transport is wired in. 409 when the listing has no owner mobile.
export async function chaseOwner(propertyId, templateId) {
  return (await provider()).chaseOwner(propertyId, templateId);
}

/** Every chaser written to this listing's owner, newest first. */
export async function listOwnerOutreach(propertyId) {
  return (await provider()).listOwnerOutreach(propertyId);
}

export async function markOutreachSent(propertyId, messageId) {
  return (await provider()).markOutreachSent(propertyId, messageId);
}
