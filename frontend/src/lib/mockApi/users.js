// ---------------- Users / staff ----------------
import { rawLoad, rawSave, delay } from './core.js';

export function listUsers(role, opts = {}) {
  const db = rawLoad();
  let list = opts.includeArchived ? db.users : db.users.filter((u) => !u.archived);
  return delay(role ? list.filter((u) => u.role === role) : list);
}

export function getOwner(id) {
  const db = rawLoad();
  const owner = db.users.find((u) => u.id === id) || null;
  const listings = owner ? db.listings.filter((l) => l.ownerId === id) : [];
  return delay(owner ? { ...owner, listings } : null);
}

export function updateUser(id, patch) {
  const db = rawLoad();
  const u = db.users.find((x) => x.id === id);
  if (u) {
    Object.assign(u, patch);
    rawSave(db);
  }
  return delay(u);
}

export function getUserTimeline(userId) {
  const db = rawLoad();
  const user = db.users.find((u) => u.id === userId);
  if (!user) return [];

  const mobile = user.mobile;
  const timeline = [];

  // 1. Account creation
  if (user.joinedAt) {
    timeline.push({
      id: `UT-joined-${userId}`,
      type: 'account',
      action: 'Joined PuneNest',
      detail: `Registered as ${user.role}`,
      at: new Date(user.joinedAt).toISOString(),
    });
  }

  // 2. Enquiries sent (match by mobile)
  const enquiries = db.enquiries || [];
  enquiries
    .filter((e) => e.mobile === mobile)
    .forEach((e) => {
      timeline.push({
        id: `UT-enq-${e.id}`,
        type: 'enquiry',
        action: e.kind === 'visit' ? 'Requested site visit' : e.kind === 'call' ? 'Requested callback' : 'Sent enquiry',
        detail: e.listing,
        at: new Date(e.at).toISOString(),
        meta: { listingId: e.listingId, status: e.status },
      });
    });

  // 3. Visits scheduled (match by mobile)
  const visits = db.visits || [];
  visits
    .filter((v) => v.mobile === mobile)
    .forEach((v) => {
      timeline.push({
        id: `UT-visit-${v.id}`,
        type: 'visit',
        action: v.status === 'completed' ? 'Completed site visit' : v.status === 'cancelled' ? 'Cancelled visit' : 'Visit scheduled',
        detail: v.listing,
        at: new Date(v.when).toISOString(),
        meta: { status: v.status },
      });
    });

  // 4. Service tickets booked (match by mobile)
  const tickets = db.tickets || [];
  tickets
    .filter((t) => t.mobile === mobile)
    .forEach((t) => {
      timeline.push({
        id: `UT-ticket-${t.id}`,
        type: 'service',
        action: `Booked: ${t.service}`,
        detail: t.detail || '',
        at: new Date(t.createdAt).toISOString(),
        meta: { status: t.status, team: t.team, value: t.value },
      });
    });

  // 5. Listings owned (for owners)
  if (user.role === 'owner') {
    const listings = db.listings || [];
    listings
      .filter((l) => l.ownerId === userId || l.ownerMobile === mobile)
      .forEach((l) => {
        timeline.push({
          id: `UT-listing-${l.id}`,
          type: 'listing',
          action: `Listed property`,
          detail: `${l.title} — ${l.status}`,
          at: new Date(l.createdAt).toISOString(),
          meta: { listingId: l.id, status: l.status, price: l.price },
        });
      });
  }

  // 6. Internal notes on this user
  const notes = (db.internalNotes && db.internalNotes[`user:${userId}`]) || [];
  notes.forEach((n) => {
    timeline.push({
      id: `UT-note-${n.id}`,
      type: 'note',
      action: n.action || 'Admin note',
      detail: n.text,
      at: n.at,
      meta: { by: n.by },
    });
  });

  // Sort newest first
  timeline.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return timeline;
}

export function addStaff(staff) {
  const db = rawLoad();
  const rec = { id: 'S' + Date.now(), role: 'staff', status: 'active', verified: true, city: 'Pune', joinedAt: new Date().toISOString().slice(0, 10), ...staff };
  db.users.push(rec);
  rawSave(db);
  return delay(rec);
}
