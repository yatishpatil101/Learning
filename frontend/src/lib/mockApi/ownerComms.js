// ---------------- Owner Communication Log ----------------
/* Aggregates all communication events for a listing into a single unified timeline.
   Combines: reminders, internal notes, pipeline changes, messages, status updates. */
import { rawLoad } from './core.js';

export function getOwnerCommsLog(listingId) {
  const db = rawLoad();
  const listing = db.listings.find((p) => p.id === listingId);
  if (!listing) return [];

  const log = [];

  // 1. Listing creation event
  if (listing.createdAt) {
    log.push({
      id: `CL-created-${listingId}`,
      type: 'status',
      action: listing.postedByAdmin ? 'Posted by staff' : 'Listed by owner',
      detail: `"${listing.title}" created as ${listing.deal} in ${listing.locality}`,
      by: listing.postedByStaff || listing.owner,
      at: new Date(listing.createdAt).toISOString(),
    });
  }

  // 2. Claim link events (concierge only)
  if (listing.postedByAdmin && listing.claimLinkSent) {
    const created = new Date(listing.createdAt).getTime();
    log.push({
      id: `CL-link-sent-${listingId}`,
      type: 'outreach',
      action: 'Claim link sent',
      detail: `Ownership claim link sent to ${listing.owner} (${listing.ownerMobile})`,
      by: listing.postedByStaff || 'System',
      at: new Date(created + 3600000).toISOString(), // 1 hour after creation
    });
    if (listing.claimLinkOpened) {
      log.push({
        id: `CL-link-opened-${listingId}`,
        type: 'owner-action',
        action: 'Link opened by owner',
        detail: `${listing.owner} opened the claim link`,
        by: listing.owner,
        at: new Date(created + 3600000 * 6).toISOString(), // ~6 hours after
      });
    }
  }

  // 3. Document uploads (concierge)
  if (listing.postedByAdmin && listing.photosUploaded) {
    const created = new Date(listing.createdAt).getTime();
    log.push({
      id: `CL-photos-${listingId}`,
      type: 'owner-action',
      action: 'Photos uploaded',
      detail: `${listing.owner} uploaded property photos`,
      by: listing.owner,
      at: new Date(created + 86400000 * 1.5).toISOString(),
    });
  }
  if (listing.postedByAdmin && listing.aadhaarVerified) {
    const created = new Date(listing.createdAt).getTime();
    log.push({
      id: `CL-aadhaar-${listingId}`,
      type: 'owner-action',
      action: 'Aadhaar verified',
      detail: `${listing.owner} completed identity verification`,
      by: listing.owner,
      at: new Date(created + 86400000 * 2).toISOString(),
    });
  }

  // 4. Reminders (from staffActivity log)
  const staffActivity = Array.isArray(db.staffActivity) ? db.staffActivity : [];
  staffActivity
    .filter((a) => a.action === 'owner-reminder' && a.meta?.listingId === listingId)
    .forEach((a, i) => {
      log.push({
        id: `CL-reminder-${listingId}-${i}`,
        type: 'outreach',
        action: `Reminder #${i + 1} sent`,
        detail: a.detail || `Reminder sent to ${listing.owner}`,
        by: a.staffName || 'Staff',
        at: a.at,
      });
    });

  // 5. Internal notes on this listing
  const notes = (db.internalNotes && db.internalNotes[`listing:${listingId}`]) || [];
  notes.forEach((n) => {
    log.push({
      id: `CL-note-${n.id}`,
      type: 'note',
      action: n.action || 'Internal note',
      detail: n.text,
      by: n.by,
      at: n.at,
    });
  });

  // 6. Messages (from listing messages if they exist)
  const messages = Array.isArray(listing.messages) ? listing.messages : [];
  messages.forEach((m, i) => {
    log.push({
      id: `CL-msg-${listingId}-${i}`,
      type: m.from === 'admin' ? 'outreach' : 'owner-action',
      action: m.from === 'admin' ? 'Message to owner' : 'Owner replied',
      detail: m.text,
      by: m.from === 'admin' ? (m.by || 'Admin') : listing.owner,
      at: m.at,
    });
  });

  // 7. Status changes (approval/rejection)
  if (listing.status === 'approved') {
    const created = new Date(listing.createdAt).getTime();
    log.push({
      id: `CL-approved-${listingId}`,
      type: 'status',
      action: 'Listing approved',
      detail: `Property approved and published on PuneNest`,
      by: 'Admin',
      at: new Date(created + 86400000 * 3).toISOString(),
    });
  } else if (listing.status === 'rejected') {
    log.push({
      id: `CL-rejected-${listingId}`,
      type: 'status',
      action: 'Listing rejected',
      detail: listing.flagReason || 'Does not meet listing requirements',
      by: 'Admin',
      at: new Date(new Date(listing.createdAt).getTime() + 86400000 * 2).toISOString(),
    });
  }

  // Sort by timestamp (newest first)
  log.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return log;
}
