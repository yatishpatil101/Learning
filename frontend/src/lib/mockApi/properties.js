// ---------------- Properties ----------------
import { rawLoad, rawSave, delay } from './core.js';
import { isDormant, createdMs } from '../freshness.js';
import { logStaffActivity } from './staff.js';

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
  const live = db.listings.filter((p) => p.status === 'approved' && !p.archived && !(p.real && isDormant(p)));
  const feat = live.filter((p) => p.featured);
  const rest = live.filter((p) => !p.featured);
  return delay([...feat, ...rest].slice(0, limit));
}

export function setListingStatus(id, status) {
  const db = rawLoad();
  const it = db.listings.find((p) => p.id === id);
  if (it) {
    it.status = status;
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
