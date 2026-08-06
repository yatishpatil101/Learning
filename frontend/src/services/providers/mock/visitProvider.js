/**
 * Mock visit provider — the localStorage counterpart to `providers/http/visitProvider.js`.
 *
 * ## What this collapses
 *
 * The mock kept two parallel records of the same event: a row in the global `visits` collection
 * (`mockApi`) and a row in the owner's `puneNestPropVisitReqs:<mobile>` bucket (`lib/store`).
 * Booking wrote both; the dashboard calendar read the first and the review gate read the second.
 * The server has one table (backend D3), so this provider does too:
 *
 *   - the **owner bucket** is the record of truth, because it is the one keyed per participant and
 *     the one the review gate already trusts;
 *   - the global collection is still written on create, because the admin pages read it directly
 *     and that slice has not shipped. It is never read back here.
 *
 * ## Scoping
 *
 * The old `listVisits` returned the *entire* collection, unfiltered — on a real dataset the
 * consumer dashboard would show strangers' visits. Both reads here are scoped to the signed-in
 * user, matching the server's caller-scoped endpoints.
 */
import { rawDb, saveDb, scheduleVisit as _collectionVisit } from '../../../lib/mockApi.js';
import { ApiError } from '../../http.js';
import { digits, myMobile } from '../../../lib/contact.js';
import { readUser } from '../../../lib/auth.js';
import {
  addVisitRequest,
  getListings,
  getVisitReqs,
  saveVisitReqs,
} from '../../../lib/store.js';
import { slotFromParts, slotFromWhen, whenFromSlot } from '../../../lib/visitWhen.js';

/**
 * The owner buckets the mock can see.
 *
 * The store is keyed by owner mobile, so there is no way to ask "every visit involving me" without
 * knowing which owners to look under. The listings catalogue supplies that set — which is exactly
 * the kind of client-side reassembly the server's caller-scoped endpoints exist to remove.
 *
 * The signed-in user is always included: they own their own bucket whether or not they appear in
 * the seeded catalogue, and leaving them out makes their own visits unfindable by id.
 */
function ownerMobiles() {
  const set = new Set();
  const mine = myMobile();
  if (mine) set.add(mine);
  try {
    (rawDb().listings || []).forEach((p) => {
      const d = digits(p.ownerMobile);
      if (d) set.add(d);
    });
  } catch { /* seeded catalogue unavailable */ }
  return [...set];
}

/**
 * Every listing the signed-in user owns, from both places a listing can live: the seeded catalogue
 * and the per-user `puneNestListings:<mobile>` store that the post-a-property flow writes to.
 */
function myListingIds() {
  const mine = myMobile();
  if (!mine) return new Set();
  const ids = new Set();
  try {
    (rawDb().listings || []).forEach((p) => { if (digits(p.ownerMobile) === mine) ids.add(p.id); });
  } catch { /* seeded catalogue unavailable */ }
  try {
    getListings().forEach((l) => { if (l?.id) ids.add(l.id); });
  } catch { /* no per-user listings */ }
  return ids;
}

/** Stored row → the seam's shape. */
function toViewModel(rec, ownerMobile) {
  const when = rec.when || (rec.date && rec.time ? `${rec.date}, ${rec.time}${rec.mode ? ` (${rec.mode})` : ''}` : '');
  return {
    id: rec.id,
    propertyId: rec.propId || '',
    // The dashboard calendar links on `listingId`; it is the same value, kept so those links and
    // the server's `propertyId` never have to be reconciled at the call site.
    listingId: rec.propId || '',
    listing: rec.propTitle || '',
    when,
    slot: slotFromWhen(when),
    mode: rec.mode || 'in-person',
    status: rec.status || 'scheduled',
    visitorName: rec.visitorName || 'Visitor',
    visitorMobile: rec.visitorMobile || '',
    ownerMobile,
    note: rec.note || '',
    createdAt: rec.createdAt || Date.now(),
  };
}

/**
 * Global-collection row → the seam's shape.
 *
 * The seeded demo catalogue lives here (23 rows in `db.json`) under a different vocabulary —
 * `listingId`/`customer`/`mobile` rather than `propId`/`visitorName`/`visitorMobile` — so it is
 * normalised rather than excluded. Dropping it would empty the demo dashboard.
 */
function collectionToViewModel(rec, ownerMobile) {
  const when = rec.when || '';
  return {
    id: rec.id,
    propertyId: rec.listingId || '',
    listingId: rec.listingId || '',
    listing: rec.listing || '',
    when,
    slot: slotFromWhen(when),
    mode: rec.mode || 'in-person',
    status: rec.status || 'scheduled',
    visitorName: rec.customer || 'Visitor',
    visitorMobile: digits(rec.mobile || ''),
    ownerMobile,
    note: rec.note || '',
    createdAt: rec.createdAt || 0,
  };
}

const newestFirst = (a, b) => (b.createdAt || 0) - (a.createdAt || 0);

/**
 * Rows from the global collection that the given predicate accepts.
 *
 * Both reads are *scoped*, unlike the `listVisits` this replaced — that returned the entire
 * collection unfiltered, so on real data a user would have seen strangers' visits.
 */
function fromCollection(match) {
  try {
    return (rawDb().visits || []).filter((v) => !v.archived && match(v));
  } catch {
    return [];
  }
}

/** Visits the signed-in user booked. */
export async function listVisits() {
  const mine = myMobile();
  if (!mine) return [];
  const fromBuckets = ownerMobiles().flatMap((owner) =>
    getVisitReqs(owner).filter((r) => r.visitorMobile === mine).map((r) => toViewModel(r, owner)));
  const seeded = fromCollection((v) => digits(v.mobile) === mine).map((v) => collectionToViewModel(v, ''));
  return dedupe([...fromBuckets, ...seeded]).sort(newestFirst);
}

/** Visits booked against the signed-in user's own listings. */
export async function myVisitRequests() {
  const mine = myMobile();
  if (!mine) return [];
  const fromBucket = getVisitReqs(mine).map((r) => toViewModel(r, mine));
  const owned = myListingIds();
  const seeded = fromCollection((v) => owned.has(v.listingId)).map((v) => collectionToViewModel(v, mine));
  return dedupe([...fromBucket, ...seeded]).sort(newestFirst);
}

/** Bucket rows win over collection rows: a booked visit writes both, and the bucket is richer. */
function dedupe(rows) {
  const byId = new Map();
  rows.forEach((r) => { if (!byId.has(r.id)) byId.set(r.id, r); });
  return [...byId.values()];
}

export async function scheduleVisit(req = {}) {
  const user = readUser();
  if (!user) {
    throw new ApiError({ code: 'unauthorized', status: 401, message: 'Sign in to book a visit' });
  }
  const propertyId = req.propertyId || '';
  const owner = digits(req.ownerMobile || ownerOf(propertyId));
  if (!owner) {
    throw new ApiError({ code: 'not_found', status: 404, message: 'Listing not found' });
  }

  // The server rejects a second live visit rather than moving the existing one. Mirror that here:
  // the mock's silent slot-move would let a caller relocate a visit the owner had already
  // confirmed, and a UI written against that behaviour would break the day it went live.
  const mine = digits(user.mobile);
  const live = getVisitReqs(owner).find(
    (r) => r.propId === propertyId && r.visitorMobile === mine && (r.status === 'scheduled' || r.status === 'confirmed'),
  );
  if (live) {
    throw new ApiError({
      code: 'visit_exists',
      status: 409,
      message: 'You already have a live visit on this property',
    });
  }

  const when = req.when || (req.dateIso ? whenFromSlot(slotFromParts(req.dateIso, req.time), req.mode) : '');
  const { date, time } = splitWhen(when);

  // The admin pages still read the global collection directly, so keep feeding it. It is write-only
  // from here — every read in this provider comes from the bucket.
  _collectionVisit({
    listingId: propertyId,
    listing: req.listing || '',
    customer: req.visitorName || user.name || 'Visitor',
    mobile: req.phone || user.mobile || '',
    when,
    note: req.note || '',
  });

  const rec = addVisitRequest(owner, {
    propId: propertyId,
    propTitle: req.listing || '',
    visitorName: req.visitorName || user.name || 'Visitor',
    phone: req.phone || '',
    date,
    time,
    mode: req.mode || 'in-person',
    note: req.note || '',
  });
  return rec ? toViewModel(rec, owner) : null;
}

export async function updateVisitStatus(id, status) {
  const row = findAnywhere(id);
  if (!row) throw new ApiError({ code: 'not_found', status: 404, message: 'Visit not found' });
  if (row.kind === 'collection') {
    row.rec.status = status;
    saveCollection(row.db);
    return collectionToViewModel(row.rec, '');
  }
  const { bucket, owner, rec } = row;
  rec.status = status;
  if (status === 'completed') rec.completedAt = Date.now();
  saveVisitReqs(owner, bucket);
  return toViewModel(rec, owner);
}

export async function rescheduleVisit(id, when) {
  const row = findAnywhere(id);
  if (!row) throw new ApiError({ code: 'not_found', status: 404, message: 'Visit not found' });
  if (row.kind === 'collection') {
    row.rec.when = when;
    // Back to `scheduled`: a moved slot is not one the other party has agreed to yet.
    row.rec.status = 'scheduled';
    saveCollection(row.db);
    return collectionToViewModel(row.rec, '');
  }
  const { bucket, owner, rec } = row;
  const { date, time } = splitWhen(when);
  rec.date = date;
  rec.time = time;
  rec.status = 'scheduled';
  saveVisitReqs(owner, bucket);
  return toViewModel(rec, owner);
}

// ─── Internals ────────────────────────────────────────────────────────────────────────────────

function ownerOf(propertyId) {
  try {
    return (rawDb().listings || []).find((p) => p.id === propertyId)?.ownerMobile || '';
  } catch {
    return '';
  }
}

/** Persist a mutated seeded-collection row. `saveDb` is the public primitive; `rawSave` is
 *  deliberately internal to the mockApi tree. */
function saveCollection(db) {
  try {
    saveDb(db);
  } catch { /* storage unavailable — the optimistic UI update still stands for this session */ }
}

/** The store splits a slot into `date` + `time`; the seam carries one `when`. */
function splitWhen(when) {
  const m = /^(.*?),\s*([^(]+?)(?:\s*\(.*\))?$/.exec(String(when || '').trim());
  return m ? { date: m[1].trim(), time: m[2].trim() } : { date: String(when || ''), time: '' };
}

/**
 * Locate a visit by id across both stores, since an id alone names neither its owner nor which
 * store it came from. Buckets are searched first: a visit that exists in both is richer there.
 */
function findAnywhere(id) {
  for (const owner of ownerMobiles()) {
    const bucket = getVisitReqs(owner);
    const rec = bucket.find((r) => r.id === id);
    if (rec) return { kind: 'bucket', bucket, owner, rec };
  }
  try {
    const db = rawDb();
    const rec = (db.visits || []).find((v) => v.id === id);
    if (rec) return { kind: 'collection', db, rec };
  } catch { /* seeded catalogue unavailable */ }
  return null;
}
