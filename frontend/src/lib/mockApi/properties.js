// ---------------- Properties ----------------
import { rawLoad, rawSave, delay } from './core.js';
import { isDormant, createdMs } from '../freshness.js';
import { isFeaturedActive } from '../featured.js';

/* Rooms live in their own localStorage key (store.js `puneNestRoomListings`) and
   are read directly here — the same trick data/flatmates.js uses — because
   data/flatSplit.js needs the anti-broker guardrails from data/flatmates.js,
   which imports this module. Reading the key keeps that chain acyclic.

   A flat being let room by room stays advertised as a whole flat only until the
   first tenant commits: after that the whole flat genuinely isn't available, so
   continuing to show it would advertise something that no longer exists. */
const ROOMS_KEY = 'puneNestRoomListings';
const isSplitOccupied = (propertyId) => {
  if (!propertyId) return false;
  try {
    const arr = JSON.parse(localStorage.getItem(ROOMS_KEY)) || [];
    if (!Array.isArray(arr)) return false;
    return arr.some((r) => r && r.propertyId === propertyId && (Number(r.occupants) || 0) > 0);
  } catch { return false; }
};
import { logStaffActivity } from './staff.js';

const last10 = (m) => String(m || '').replace(/\D/g, '').slice(-10);
const FIRST_FEATURE_PERK_MS = 7 * 24 * 60 * 60 * 1000; // 7-day free Featured boost

/* Growth lever (ADR-019): earning the opt-in Verified badge must actually pay off, or the
   "verified listings rank higher" promise is hollow. On badge earn we (1) flip `ownerVerified`
   on every listing this user owns — lighting up the +250 ranking boost and the buyer-facing
   Verified badge — and (2) the FIRST time only, grant a free 7-day Featured slot on their newest
   approved listing (reuses the existing `featured` flag / +1000 boost, with an expiry so it lapses
   honestly). Idempotent: safe to call on every verification; the perk is guarded to fire once. */
export function applyVerifiedBadgeToListings(mobile) {
  const mine = last10(mobile);
  if (!mine) return null;
  const db = rawLoad();
  let changed = false;
  const owned = db.listings.filter((l) => last10(l.ownerMobile) === mine && !l.archived);
  owned.forEach((l) => { if (!l.ownerVerified) { l.ownerVerified = true; changed = true; } });

  let featuredTitle = null;
  const perkKey = 'puneNestFirstFeaturePerk:' + mine;
  const alreadyGranted = (() => { try { return !!localStorage.getItem(perkKey); } catch { return false; } })();
  if (!alreadyGranted) {
    const candidate = owned
      .filter((l) => l.status === 'approved' && !isFeaturedActive(l))
      .sort((a, b) => createdMs(b.createdAt) - createdMs(a.createdAt))[0];
    if (candidate) {
      candidate.featured = true;
      candidate.featuredUntil = Date.now() + FIRST_FEATURE_PERK_MS;
      candidate.featuredReason = 'first-verify';
      featuredTitle = candidate.title;
      changed = true;
    }
    try { localStorage.setItem(perkKey, String(Date.now())); } catch { /* ignore */ }
  }

  if (changed) rawSave(db);
  return { verifiedCount: owned.length, featuredTitle };
}

/* Social-proof stats (E1/E2, ADR-019). Mock-computed from the catalogue today; moves to a
   backend aggregate later. Counts only live (approved, non-archived) listings so the numbers
   are honest. `localitySlug` narrows to a locality for the "N verified homes in <area>" line.

   `verifiedOwners` counts distinct owner *ids* (D31). It used to key the Set on the owner's
   mobile, which conflates two different people who share a number -- a family landline, or the
   same broker's number typed against two accounts -- and undercounts. `ownerId` falls back to the
   mobile only for older seeded rows that predate the field, so the count degrades to the previous
   behaviour rather than dropping those listings on the floor. */
export function verifiedStats(localitySlug) {
  const db = rawLoad();
  const live = (db.listings || []).filter(
    (l) => l.status === 'approved' && !l.archived && (!localitySlug || l.localitySlug === localitySlug),
  );
  const verifiedListings = live.filter((l) => l.ownerVerified || l.ownershipVerified).length;
  const owners = new Set(
    live.filter((l) => l.ownerVerified).map((l) => l.ownerId || last10(l.ownerMobile)),
  );
  return { verifiedListings, totalListings: live.length, verifiedOwners: owners.size };
}

function matchesFilters(p, f = {}) {
  if (!f.includeArchived && p.archived) return false;
  if (f.deal && p.deal !== f.deal) return false;
  if (f.type && p.type.toLowerCase() !== f.type.toLowerCase()) return false;
  if (f.locality && p.localitySlug !== f.locality) return false;
  if (f.bhk && p.bhkNum !== Number(f.bhk)) return false;
  if (f.minPrice && p.price < Number(f.minPrice)) return false;
  if (f.maxPrice && p.price > Number(f.maxPrice)) return false;
  if (f.furnishing && p.furnishing !== f.furnishing) return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    if (!(p.title.toLowerCase().includes(q) || p.locality.toLowerCase().includes(q))) return false;
  }
  if (f.status) {
    if (p.status !== f.status) return false;
  } else if (!f.includeAllStatuses) {
    if (p.status !== 'approved') return false;
  }
  return true;
}

function sortProps(list, sort) {
  const arr = list.slice();
  switch (sort) {
    case 'price-asc':
      return arr.sort((a, b) => a.price - b.price);
    case 'price-desc':
      return arr.sort((a, b) => b.price - a.price);
    case 'area-desc':
      return arr.sort((a, b) => b.area - a.area);
    case 'newest':
    default:
      return arr.sort((a, b) => createdMs(b.createdAt) - createdMs(a.createdAt));
  }
}

export function listProperties(filters = {}, sort = 'newest') {
  const db = rawLoad();
  let list = db.listings.filter((p) => matchesFilters(p, filters));
  // Public search hides "dormant" listings (owner went dark and never confirmed) to
  // protect buyer trust — but only for genuine user posts (`real`). Demo/seed catalog
  // data has no live owner to nudge, so it always stays visible. Owner/admin views pass
  // includeAllStatuses or an explicit status and still see everything.
  if (!filters.includeAllStatuses && !filters.status) {
    list = list.filter((p) => !(p.real && isDormant(p)));
    // The owner still sees a split-and-occupied flat in My Listings, labelled
    // as hidden — it disappears from public search only.
    list = list.filter((p) => !isSplitOccupied(p.id));
  }
  const out = sortProps(list, sort);
  return delay(out);
}

export function getProperty(id) {
  const db = rawLoad();
  return delay(db.listings.find((p) => p.id === id) || null);
}

export function featuredProperties(limit = 6) {
  const db = rawLoad();
  const live = db.listings.filter((p) => p.status === 'approved' && !p.archived && !(p.real && isDormant(p)) && !isSplitOccupied(p.id));
  const feat = live.filter((p) => isFeaturedActive(p));
  const rest = live.filter((p) => !isFeaturedActive(p));
  return delay([...feat, ...rest].slice(0, limit));
}

/**
 * Approve / reject / return to pending.
 *
 * Approving **clears any moderation flag**, mirroring the server
 * (`PropertyModerationService.setStatus` nulls `flag_reason` only on approve). Without this the
 * admin page had to follow every approval with a second `updateListingFields(id, {flagReason: ''})`
 * call — which was a no-op against the API, because `ListingUpdate` has no `flagReason` field and
 * the patch serialised to an empty body. Rejecting deliberately keeps the reason: it is why the
 * listing was taken down.
 */
export function setListingStatus(id, status) {
  const db = rawLoad();
  const it = db.listings.find((p) => p.id === id);
  if (it) {
    it.status = status;
    if (status === 'approved') it.flagReason = '';
    rawSave(db);
  }
  return delay(it);
}

export function toggleFeatured(id) {
  const db = rawLoad();
  const it = db.listings.find((p) => p.id === id);
  if (it) {
    it.featured = !it.featured;
    rawSave(db);
  }
  return delay(it);
}

/* Owner (or ops) confirms a listing is genuinely still available. Stamps freshenedAt to
   "now", which resets the derived freshness state to Active and — if it had gone dormant —
   makes it visible to buyers again. This is the anti-staleness heartbeat. */
export function confirmListingFresh(id) {
  const db = rawLoad();
  const it = db.listings.find((p) => p.id === id);
  if (it) {
    it.freshenedAt = new Date().toISOString().slice(0, 10);
    rawSave(db);
  }
  return delay(it);
}

export function addListing(listing) {
  const db = rawLoad();
  const today = new Date().toISOString().slice(0, 10);
  const rec = {
    id: 'PR' + Date.now(),
    status: 'pending', featured: false, views: 0, enquiries: 0,
    createdAt: today, freshenedAt: today, real: true,
    pipelineStage: listing.postedByAdmin ? 'listed' : 'info_collected',
    // Owner completion tracking (for concierge-posted listings)
    claimLinkSent: !!listing.postedByAdmin,
    claimLinkOpened: false,
    photosUploaded: false,
    aadhaarVerified: false,
    reminderCount: 0,
    lastReminderAt: null,
    amenities: [], gallery: [], ...listing,
  };
  db.listings.unshift(rec);
  rawSave(db);
  return delay(rec);
}

export function setPipelineStage(id, stage) {
  const db = rawLoad();
  const it = db.listings.find((p) => p.id === id);
  if (it) {
    it.pipelineStage = stage;
    if (stage === 'live' && it.status !== 'approved') it.status = 'approved';
    rawSave(db);
  }
  return delay(it);
}

export function sendOwnerReminder(id) {
  const db = rawLoad();
  const it = db.listings.find((p) => p.id === id);
  if (it) {
    it.reminderCount = (it.reminderCount || 0) + 1;
    it.lastReminderAt = new Date().toISOString();
    rawSave(db);
  }
  logStaffActivity({
    action: 'owner-reminder',
    category: 'listing',
    detail: `Sent reminder #${it?.reminderCount || 1} to ${it?.owner || 'owner'} for "${it?.title || id}"`,
    meta: { listingId: id },
  });
  return delay(it);
}
