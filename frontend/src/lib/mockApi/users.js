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

  // 6. Internal notes are deliberately absent (D29).
  /* They used to be pushed on here as `type: 'note'`, and always as an empty list, because nothing
     wrote a `user:` key in `db.internalNotes`. Now that notes are rows with their own route, they
     have their own panel on the user drawer, for a reason worth recording: the live timeline is
     `GET /users/{id}/timeline`, which is **admin-only** and whose `kind` union has no `note`.
     Staff write these notes and staff must be able to read them back, so routing them through an
     admin-only endpoint would have hidden them from their own authors. */

  // Sort newest first
  timeline.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return timeline;
}

/* `addStaff(staff)` stood here — it pushed a `role: 'staff'` row straight into `db.users` with
   `verified: true` and no approval step. It has no callers: `git grep addStaff` across
   `services/`, `pages/` and `components/` returns nothing, because the app has never shipped a
   staff-creation screen.

   It is worth being explicit about why it is deleted rather than kept for the screen that will
   eventually exist. The server's equivalent is `UserAdminService.addStaff`, and it is not this: it
   creates the account with **no usable password**, issues a single-use time-limited invite to the
   colleague's own handset, and blocks every login path until that invite is redeemed — the
   two-administrator rule of D200/D206. A mock that mints a verified staff account synchronously
   from one call is not a simplified version of that; it is the exact scenario the invite flow
   exists to prevent, sitting in the codebase as a worked example. Whoever builds the console should
   start from `POST /auth/staff-invite/redeem`, which is why this is not left here to be found. */
