// ---------------- Properties ----------------
import { rawLoad, rawSave, delay } from './core.js';
import { isDormant, createdMs } from '../freshness.js';
import { isFeaturedActive } from '../featured.js';
import { withPosition } from '../listings/coords.js';

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
   honestly). Idempotent: safe to call on every verification; the perk is guarded to fire once.

   This writes a mock *fixture*, it does not decide trust (D26). Its only caller is the mock half of
   the verification seam; on `http` the badge arrives already decided on `PropertyResponse
   .ownerVerified` — only the DigiLocker webhook may set it server-side — and `propertyMapper` reads
   it. Every renderer of the Verified Owner pill reads that field and none of them computes it, so
   nothing here is a second opinion the live path could disagree with. */
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
  // Explicit tri-state `archived`, matching what `toModerationQuery` forwards and what
  // `PropertySpecs.adminSearch` does with it. Distinct from `includeArchived`, which only widens:
  // a moderation read forces the widening on, so `archived: false` is the only way a caller can
  // narrow back to live rows — and without this the mock would answer that question differently
  // from the server, which is the whole class of bug the seam exists to avoid.
  if (f.archived !== undefined && Boolean(p.archived) !== Boolean(f.archived)) return false;
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
  // The stays-live re-check queue (Q14), tri-state exactly like the server's `recheck` param:
  // undefined means both. Admin-only in practice — `toQuery` never forwards it, only
  // `toModerationQuery` does — which mirrors `PropertySpecs`, where it lives on `adminSearch`
  // and not on the public one.
  if (f.recheck !== undefined && Boolean(p.recheckPending) !== Boolean(f.recheck)) return false;
  return true;
}

/**
 * Mirror of `Property.requestRecheck` (Q14) for the mock store.
 *
 * Returns the three re-check fields to merge onto a listing record. Kept here, beside
 * `setListingStatus` which clears them, so the pair that owns this work item lives in one place.
 *
 * Two rules are copied deliberately, because a mock that is *more permissive* than the server
 * passes tests the real thing would fail:
 *  - the reason accumulates field names rather than replacing them (two edits before a moderator
 *    looks must leave the moderator both fields, not just the last one), and
 *  - `requestedAt` is set once and never refreshed, so queue age is honest and an owner editing
 *    their price daily cannot keep resetting their own place in the queue.
 */
export function requestRecheckFields(prev = {}, fields = []) {
  const merged = [...new Set([
    ...String(prev.recheckReason || '').split(/,\s*/).filter(Boolean),
    ...fields,
  ])];
  if (!merged.length) return {};
  return {
    recheckPending: true,
    recheckReason: merged.join(', '),
    recheckRequestedAt: prev.recheckRequestedAt || new Date().toISOString(),
  };
}

/** Mirror of `Property.clearRecheck` — a moderator has looked. Idempotent. */
export const clearedRecheckFields = () => ({
  recheckPending: false,
  recheckReason: '',
  recheckRequestedAt: '',
});

/**
 * Is a paid promotion window open right now? Mirrors the server's `Property.isBoosted()` (D59):
 * compared against the current time rather than swept, so an elapsed window stops counting on its
 * own and a stale row can never keep rank it no longer pays for.
 */
export const isBoostedNow = (p) => !!p.boostedUntil && new Date(p.boostedUntil).getTime() > Date.now();

/**
 * Attach the derived `boosted` flag the card reads.
 *
 * The store keeps the window (`boostedUntil`); the wire carries only the boolean, computed by the
 * server at request time. Deriving it here at the read boundary rather than storing it keeps the
 * two modes honest in the same way — there is no persisted flag that can survive its own window.
 */
const withBoosted = (p) => (p ? { ...p, boosted: isBoostedNow(p) } : p);

/**
 * The read boundary: everything a caller sees looks like a row the API returned.
 *
 * `withPosition` is here rather than in the page because `lat`/`lng` are *stored* on every live
 * property, and the seed catalogue predates the column. Filling them in at the edge — once, from a
 * function of the listing id — is what lets "Near a Place" mean the same thing in both modes: the
 * map used to invent a pin position at render time, which the radius filter could not see, so a
 * proximity search in mock mode matched nothing at all.
 */
const asRow = (p) => withPosition(withBoosted(p));

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
      // Paid placement applies to the default order only (D59) — an explicit price/area sort above
      // is honoured exactly, because ranking a paid listing above one the buyer asked to see first
      // is deception rather than promotion. Same rule as `PropertySpecs.boostedFirst` server-side.
      return arr.sort((a, b) =>
        (isBoostedNow(b) ? 1 : 0) - (isBoostedNow(a) ? 1 : 0)
        || createdMs(b.createdAt) - createdMs(a.createdAt));
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
  return delay(out.map(asRow));
}

export function getProperty(id) {
  const db = rawLoad();
  return delay(asRow(db.listings.find((p) => p.id === id) || null));
}

export function featuredProperties(limit = 6) {
  const db = rawLoad();
  const live = db.listings.filter((p) => p.status === 'approved' && !p.archived && !(p.real && isDormant(p)) && !isSplitOccupied(p.id));
  const feat = live.filter((p) => isFeaturedActive(p));
  const rest = live.filter((p) => !isFeaturedActive(p));
  return delay([...feat, ...rest].slice(0, limit).map(asRow));
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
 *
 * Setting **any** status also clears a pending stays-live re-check (Q14), mirroring
 * `PropertyModerationService.setStatus`. That is what makes re-approving an already-approved
 * listing the "checked it, all fine" action, and why draining the re-check queue needs no endpoint
 * of its own.
 */
export function setListingStatus(id, status) {
  const db = rawLoad();
  const it = db.listings.find((p) => p.id === id);
  if (it) {
    it.status = status;
    if (status === 'approved') it.flagReason = '';
    Object.assign(it, clearedRecheckFields());
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

/* The hand-back milestones. V92 moved these off `pipeline_stage` onto their own column, because
   the two funnels answer different questions and a single column made them overwrite each other:
   a listing that had reached `claim_sent` and was then moved back to `listed` lost the fact that
   the owner had been sent a claim link at all. Mirrored here so the mock and the server agree on
   which axis a value belongs to — see `PipelineStage.java`. */
const HANDBACK = ['photos_uploaded', 'aadhaar_verified', 'claim_sent', 'claimed'];

/**
 * Move a listing along whichever funnel the value belongs to.
 *
 * Mirrors `Property.moveToStage`: a hand-back milestone is recorded on `handbackMilestone` and
 * pins the acquisition stage at `docs_submitted` (a hand-back cannot be under way for a listing
 * that was never listed), and an acquisition stage clears the milestone, because moving a listing
 * back down the funnel un-does the hand-back with it.
 *
 * `under_review` and `live` are deliberately absent from both axes. They are not stages the desk
 * sets — they are `status` read sideways (`pending` and `approved`), which is why the board derives
 * those two columns rather than storing them. Writing them here used to flip `status` as a side
 * effect, which is how approving a listing and "moving it to Live" became two ways to do the same
 * thing that could disagree.
 */
export function setPipelineStage(id, stage) {
  const db = rawLoad();
  const it = db.listings.find((p) => p.id === id);
  if (it) {
    if (HANDBACK.includes(stage)) {
      it.handbackMilestone = stage;
      it.pipelineStage = 'docs_submitted';
    } else {
      it.pipelineStage = stage;
      it.handbackMilestone = null;
    }
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
