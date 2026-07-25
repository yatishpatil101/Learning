/* Admin-only property operations that the shared mockApi.js does not cover.
   Ports the flag / edit / delete / document-verification / owner-messaging
   behaviour from admin-properties.html + admin-data.js. New module so it never
   conflicts with mockApi.js. Reviews are kept in db.propertyReviews keyed by
   listing id (self-contained seed — created on demand). */
import { rawDb, mutateDb, archiveRecord, restoreRecord } from '../mockApi.js';
import { keysForListing, listingActive } from './propertyIdentity.js';
import { photoSetsMatch } from './imageHash.js';

export function digits(m) {
  return String(m == null ? '' : m).replace(/\D/g, '');
}

// ---------------- Listing mutations ----------------
export function flagListing(id, reason) {
  return mutateDb((db) => {
    const l = db.listings.find((x) => x.id === id);
    if (l) {
      l.status = 'flagged';
      l.flagReason = reason || 'Flagged';
    }
    return l;
  });
}

export function clearFlag(id) {
  return mutateDb((db) => {
    const l = db.listings.find((x) => x.id === id);
    if (l) {
      l.status = 'approved';
      l.flagReason = '';
    }
    return l;
  });
}

export function deleteListing(id) {
  // Legacy hard-delete — kept only for backwards compat; prefer archiveListing.
  return archiveListing(id, 'Removed (legacy delete)');
}

export function archiveListing(id, reason) {
  return archiveRecord('listings', id, reason || 'Archived by admin');
}

export function restoreListing(id) {
  return restoreRecord('listings', id, 'pending');
}

export function updateListingFields(id, patch) {
  return mutateDb((db) => {
    const l = db.listings.find((x) => x.id === id);
    if (l) Object.assign(l, patch);
    return l;
  });
}

// ---------------- Duplicate clusters & merge ----------------
// Two active listings belong to the same physical property when their identity
// keys intersect (electricity meter / tax id / society+unit+pincode) OR their
// photos perceptually match (broker copy-paste with a tweaked address). We group
// the flagged supply so Ops can compare side-by-side and keep one.

function sameProperty(a, b) {
  const ka = keysForListing(a);
  const kb = keysForListing(b);
  if (ka.length && kb.length) {
    const set = new Set(ka);
    if (kb.some((k) => set.has(k))) return 'address';
  }
  if (Array.isArray(a.photoHashes) && Array.isArray(b.photoHashes) && photoSetsMatch(a.photoHashes, b.photoHashes)) {
    return 'image';
  }
  return '';
}

// Clusters of >=2 active listings that look like the same property. Union-find
// over pairwise matches so a 3-way collision surfaces as one cluster, not three
// pairs. Returns newest-first, each with the match reason that grouped it.
export function findDuplicateClusters() {
  const listings = (rawDb().listings || []).filter(listingActive);
  const parent = listings.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const matched = []; // {i, why} — reason resolved to its FINAL root after all unions
  for (let i = 0; i < listings.length; i += 1) {
    for (let j = i + 1; j < listings.length; j += 1) {
      const why = sameProperty(listings[i], listings[j]);
      if (!why) continue;
      const ri = find(i);
      const rj = find(j);
      if (ri !== rj) parent[rj] = ri;
      matched.push({ i, why });
    }
  }
  // Key reasons by the settled root so a set is never orphaned when the root
  // that first recorded it later becomes a child of another cluster.
  const reasons = {}; // clusterRoot -> Set of reasons
  matched.forEach(({ i, why }) => {
    const root = find(i);
    (reasons[root] = reasons[root] || new Set()).add(why);
  });
  const groups = {};
  listings.forEach((l, i) => {
    const root = find(i);
    (groups[root] = groups[root] || []).push(l);
  });
  return Object.keys(groups)
    .filter((root) => groups[root].length >= 2)
    .map((root) => ({
      id: 'dupe-' + groups[root].map((l) => l.id).join('-'),
      reason: [...(reasons[root] || [])].join('+') || 'address',
      listings: groups[root].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    }))
    .sort((a, b) => (b.listings[0].createdAt || 0) - (a.listings[0].createdAt || 0));
}

// Resolve a cluster by keeping one listing and archiving another as a merged
// duplicate. Clears the kept listing's auto duplicate-flag so it goes live clean.
export function resolveDuplicate(keepId, dropId) {
  if (!keepId || !dropId || keepId === dropId) return null;
  archiveRecord('listings', dropId, `Merged duplicate \u2014 kept ${keepId}`);
  return mutateDb((db) => {
    const keep = db.listings.find((x) => x.id === keepId);
    if (keep) {
      keep.duplicateFlag = false;
      keep.duplicateOf = '';
      if (/^Possible duplicate/.test(String(keep.flagReason || ''))) {
        keep.flagReason = '';
        if (keep.status === 'flagged') keep.status = 'approved';
      }
    }
    return keep;
  });
}

// "Not a duplicate" — clear the auto duplicate flag on every listing in a cluster
// so it stops surfacing here. Never touches an admin's manual flag text.
export function dismissDuplicate(ids = []) {
  return mutateDb((db) => {
    (ids || []).forEach((id) => {
      const l = db.listings.find((x) => x.id === id);
      if (!l) return;
      l.duplicateFlag = false;
      l.duplicateOf = '';
      if (/^Possible duplicate/.test(String(l.flagReason || ''))) {
        l.flagReason = '';
        if (l.status === 'flagged') l.status = 'approved';
      }
    });
    return true;
  });
}

// ---------------- Verification reviews ----------------
function defaultDocs(listing) {
  const rent = listing && listing.deal === 'rent';
  const defs = rent
    ? [
        ['d_index2', 'Index II'],
        ['d_bill', 'Electricity bill'],
        ['d_aadhaar', 'Aadhaar card'],
      ]
    : [
        ['d_own', 'Ownership proof (Sale deed / Index II)'],
        ['d_tax', 'Property tax receipt'],
        ['d_id', 'Owner government ID (Aadhaar / PAN)'],
        ['d_noc', 'Society NOC / Maintenance receipt'],
        ['d_enc', 'Encumbrance certificate'],
        ['d_photo', 'Listing photos match the property'],
      ];
  return defs.map((d) => ({ id: d[0], name: d[1], status: 'pending', note: '' }));
}

export function getReview(id) {
  const db = rawDb();
  return (db.propertyReviews && db.propertyReviews[id]) || null;
}

export function ensureReview(listing) {
  return mutateDb((db) => {
    if (!db.propertyReviews) db.propertyReviews = {};
    const id = listing.id;
    if (!db.propertyReviews[id]) {
      db.propertyReviews[id] = {
        propId: id,
        title: listing.title,
        locality: listing.locality,
        price: listing.price,
        deal: listing.deal,
        status: 'in_review',
        docs: defaultDocs(listing),
        messages: [],
        decision: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }
    return db.propertyReviews[id];
  });
}

export function setDocStatus(id, docId, status, note) {
  return mutateDb((db) => {
    const t = db.propertyReviews && db.propertyReviews[id];
    if (!t) return null;
    t.docs.forEach((d) => {
      if (d.id === docId) {
        d.status = status;
        if (note != null) d.note = note;
      }
    });
    if (t.status === 'pending') t.status = 'in_review';
    t.updatedAt = Date.now();
    return t;
  });
}

export function setDocVerified(id, docId, bool) {
  return setDocStatus(id, docId, bool ? 'verified' : 'pending');
}

export function addReviewMessage(id, from, text) {
  const clean = String(text || '').trim();
  return mutateDb((db) => {
    const t = db.propertyReviews && db.propertyReviews[id];
    if (!t) return null;
    if (clean) {
      t.messages.push({
        id: 'm' + Date.now() + Math.floor(Math.random() * 1000),
        from,
        text: clean,
        at: Date.now(),
        read: false,
      });
      if (from === 'admin' && t.status !== 'approved' && t.status !== 'rejected') t.status = 'clarification';
      t.updatedAt = Date.now();
    }
    return t;
  });
}

export function markReviewRead(id, who) {
  return mutateDb((db) => {
    const t = db.propertyReviews && db.propertyReviews[id];
    if (!t) return null;
    const want = who === 'admin' ? 'owner' : 'admin';
    t.messages.forEach((m) => {
      if (m.from === want) m.read = true;
    });
    return t;
  });
}

export function reviewUnread(id, who) {
  const t = getReview(id);
  if (!t) return 0;
  const want = who === 'admin' ? 'owner' : 'admin';
  return t.messages.filter((m) => m.from === want && !m.read).length;
}

export function decideReview(id, type, reason) {
  return mutateDb((db) => {
    const t = db.propertyReviews && db.propertyReviews[id];
    if (!t) return null;
    t.status = type;
    t.decision = { type, reason: String(reason || ''), at: Date.now() };
    const msg =
      type === 'approved'
        ? '✅ Your property has been verified and approved.' + (reason ? ' ' + reason : ' It is now live on PuneNest.')
        : '⛔ Your property could not be approved.\nReason: ' +
          (reason || 'It did not meet our verification requirements.') +
          '\nPlease address this and reply here to resubmit.';
    t.messages.push({ id: 'd' + Date.now(), from: 'admin', text: msg, at: Date.now(), read: false });
    t.updatedAt = Date.now();
    return t;
  });
}
