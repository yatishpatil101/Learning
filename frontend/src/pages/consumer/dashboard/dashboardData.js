// Group buyer document requests per buyer+property (one due-diligence request =
// one lead). Mirrors the previous inline useMemo body exactly.
/* Pure derivations for the consumer Dashboard. */
import { parseWhen } from '../../../lib/visitWhen.js';

const LEAD_KINDS = new Set(['contact', 'photo', 'doc', 'flatmate', 'app']);
const OWNER_ROLES = new Set(['owner', 'host', 'listing_owner', 'property_owner']);
const VISITOR_ROLES = new Set(['visitor', 'buyer', 'seeker', 'guest']);

const sameId = (a, b) => a != null && b != null && String(a) === String(b);

export function listingTitleFor(listings = [], id, fallback = '') {
  if (!id) return fallback;
  const row = listings.find((l) => sameId(l.uuid, id) || sameId(l.id, id) || sameId(l.propertyId, id));
  return row?.title || row?.name || fallback;
}

function titleResolver(titleOfOrListings) {
  if (typeof titleOfOrListings === 'function') return titleOfOrListings;
  return (id) => listingTitleFor(titleOfOrListings || [], id, id || '');
}

const addUnique = (arr, value) => {
  if (value && !arr.includes(value)) arr.push(value);
};

export function buildDocGroups(docReqs = [], titleOfOrListings) {
  const titleOf = titleResolver(titleOfOrListings);
  const map = new Map();
  for (const r of docReqs || []) {
    const propId = r.propId || r.propertyId || '';
    const requesterId = r.requesterId || r.buyerId || r.requester?.id || '';
    const key = requesterId ? `${requesterId}|${propId}` : `request:${r.id}`;
    const categories = (Array.isArray(r.categories) && r.categories.length ? r.categories : [r.docType]).filter(Boolean);
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        buyerName: r.buyerName || 'A buyer',
        buyerMobile: r.buyerMobile || '',
        propId,
        propLabel: titleOf(propId),
        docTypes: [],
        pendingDocTypes: [],
        pendingIds: [],
        grantedIds: [],
        declinedIds: [],
        grantedCategoryCount: 0,
        requestedAt: Infinity,
        legacyKey: `documents:${r.buyerMobile || ''}|${propId}`,
      };
      map.set(key, g);
    }
    categories.forEach((category) => addUnique(g.docTypes, category));
    if (r.status === 'pending') {
      g.pendingIds.push(r.id);
      categories.forEach((category) => addUnique(g.pendingDocTypes, category));
    } else if (r.status === 'granted') {
      g.grantedIds.push(r.id);
      g.grantedCategoryCount += categories.length;
    } else if (r.status === 'declined') {
      g.declinedIds.push(r.id);
    }
    const t = r.requestedAt || 0;
    if (t && t < g.requestedAt) g.requestedAt = t;
  }
  return [...map.values()].sort((a, b) => {
    const ap = a.pendingIds.length ? 1 : 0;
    const bp = b.pendingIds.length ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return (b.requestedAt || 0) - (a.requestedAt || 0);
  });
}

function partyWithRole(visit, roles) {
  return (visit?.parties || []).find((p) => roles.has(String(p.role || '').toLowerCase()));
}

export function isVisitHost(visit, userId) {
  if (!visit) return false;
  if (visit.hostedByMe) return true;
  if (userId == null) return false;
  const party = partyWithRole(visit, OWNER_ROLES);
  return sameId(visit.ownerId || visit.hostId || visit.listingOwnerId || party?.id, userId);
}

function isVisitVisitor(visit, userId) {
  if (!visit || userId == null || isVisitHost(visit, userId)) return false;
  const party = partyWithRole(visit, VISITOR_ROLES);
  return sameId(visit.visitorId || party?.id, userId);
}

export function countUpcomingVisits(visits = [], userId) {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return (visits || []).filter((visit) => {
    if (!['scheduled', 'confirmed'].includes(visit.status) || !isVisitVisitor(visit, userId)) return false;
    const date = parseWhen(visit.when).date || (visit.slot ? new Date(visit.slot) : null);
    return date && !Number.isNaN(date.getTime()) && date.getTime() >= start;
  }).length;
}

export function attentionFromItems(items = []) {
  return (items || []).reduce((acc, item) => {
    if (LEAD_KINDS.has(item.kind)) acc.leads += 1;
    else if (item.kind === 'visit') acc.visits += 1;
    else if (item.kind === 'clarify') acc.properties += 1;
    return acc;
  }, { leads: 0, visits: 0, properties: 0 });
}
// The single "what's waiting on ME" triage list. Every row is a real
// request/task; sorted stale-first so the oldest, most-at-risk items lead.

export function buildActionItems({
  isOwner,
  contactReqs = [],
  apps = [],
  photoReqs = [],
  pendingDocGroups = [],
  listings = [],
  reviewsByProp,
  scheduledVisits = [],
  flatmateReqs = [],
  userId,
  decideContact,
  decideApp,
  go,
  decideDocReqs,
  decidePhotoReq,
  decideFlatmateReq,
  mutateVisit,
  openReview,
  isBusy = () => false,
}) {
  const actionItems = [];
  const titleOf = (id, fallback) => listingTitleFor(listings, id, fallback);
  const busy = (key) => !!isBusy?.(key);

  if (isOwner) {
    contactReqs.filter((r) => r.status === 'pending').forEach((r) => {
      const key = `contact:${r.id}`;
      actionItems.push({
        id: key, kind: 'contact', tone: 'rose', icon: 'lock-keyhole',
        title: `${r.buyerName || 'A buyer'} wants to contact you`,
        sub: titleOf(r.propId, 'Contact request'),
        at: r.requestedAt || null,
        busy: busy(key),
        actions: [
          { label: 'Accept', icon: 'check', onClick: () => decideContact?.(r.id, 'approved'), disabled: busy(key) },
          { label: 'Decline', icon: 'x', variant: 'ghost', onClick: () => decideContact?.(r.id, 'declined'), disabled: busy(key) },
        ],
      });
    });
    flatmateReqs.filter((r) => r.status === 'pending').forEach((r) => {
      const key = `flatmate:${r.id}`;
      actionItems.push({
        id: key, kind: 'flatmate', tone: 'teal', icon: r.kind === 'room' ? 'bed-double' : 'users-round',
        title: `${r.requesterName || 'A seeker'} is interested`,
        sub: r.targetTitle || r.locality || 'Flatmate request',
        at: r.requestedAt || null,
        busy: busy(key),
        actions: [
          { label: 'Accept', icon: 'check', onClick: () => decideFlatmateReq?.(r.id, 'accepted'), disabled: busy(key) },
          { label: 'Decline', icon: 'x', variant: 'ghost', onClick: () => decideFlatmateReq?.(r.id, 'declined'), disabled: busy(key) },
        ],
      });
    });
    apps.filter((a) => a.status === 'pending').forEach((a) => {
      const key = `app:${a.id}`;
      actionItems.push({
        id: key, kind: 'app', tone: 'teal', icon: 'users-round',
        title: `Group wants to rent ${a.listingTitle || 'your flat'}`,
        sub: `${a.groupTitle || 'Flatmate group'} · ${a.members}/${a.seatsTotal} members`,
        at: a.at || null,
        busy: busy(key),
        actions: [
          { label: 'Accept', icon: 'check', onClick: () => decideApp?.(a.id, 'accepted'), disabled: busy(key) },
          { label: 'Decline', icon: 'x', variant: 'ghost', onClick: () => decideApp?.(a.id, 'declined'), disabled: busy(key) },
        ],
      });
    });
    photoReqs.filter((r) => (r.status || 'pending') === 'pending').forEach((r) => {
      const key = `photo:${r.id}`;
      const editId = r.propId || r.propertyId || '';
      actionItems.push({
        id: key, kind: 'photo', tone: 'amber', icon: 'image',
        title: `${r.buyerName || 'A buyer'} asked for more photos`,
        sub: titleOf(editId, r.propLabel || 'Photo request'),
        at: r.requestedAt || null,
        busy: busy(key),
        actions: [
          /* Both exits are offered here, not just "Mark done". */
          { label: 'Add photos', icon: 'image', to: editId ? `/list-property?edit=${editId}&step=photos` : undefined, onClick: editId ? undefined : () => go?.('leads'), disabled: busy(key) },
          ...(decidePhotoReq ? [{ label: 'Decline', icon: 'x', variant: 'ghost', onClick: () => decidePhotoReq(r.id, 'declined'), disabled: busy(key) }] : []),
        ],
      });
    });
    pendingDocGroups.forEach((g) => {
      const key = `doc:${g.key}`;
      const n = g.pendingDocTypes?.length || g.docTypes?.length || g.pendingIds.length;
      actionItems.push({
        id: key, kind: 'doc', tone: 'teal', icon: 'folder-check',
        title: `${g.buyerName} wants ${n} document${n === 1 ? '' : 's'}`,
        sub: g.propLabel || titleOf(g.propId, 'Document request'),
        at: g.requestedAt === Infinity ? null : g.requestedAt,
        busy: g.pendingIds.some((id) => busy(`doc:${id}`)),
        actions: [
          { label: 'Grant all', icon: 'check', onClick: () => decideDocReqs?.(g.pendingIds, 'granted'), disabled: g.pendingIds.some((id) => busy(`doc:${id}`)) },
          { label: 'Decline', icon: 'x', variant: 'ghost', onClick: () => decideDocReqs?.(g.pendingIds, 'declined'), disabled: g.pendingIds.some((id) => busy(`doc:${id}`)) },
        ],
      });
    });
    // "Ops is waiting on you" has no `clarification` status behind it — the honest signal is an
    // unread message from ops, read off the summaries the container already loaded.
    listings.filter((l) => !l.flatmate && (reviewsByProp?.[l.id]?.unread || reviewsByProp?.get?.(l.id)?.unread || 0) > 0).forEach((l) => {
      const rev = reviewsByProp?.[l.id] || reviewsByProp?.get?.(l.id);
      actionItems.push({
        id: `clarify:${l.id}`, kind: 'clarify', tone: 'rose', icon: 'alert-circle',
        title: `Needs info on "${l.title}"`,
        sub: 'Draazy verification needs more info',
        at: rev?.updatedAt || null,
        actions: [{ label: 'Respond', icon: 'arrow-right', onClick: () => (openReview ? openReview(l.uuid || l.id) : go?.('properties')) }],
      });
    });
  }
  // Shared: upcoming visits still awaiting confirmation (owner and seeker both act here).

  scheduledVisits.filter((v) => v.status === 'scheduled' && isVisitHost(v, userId)).forEach((v) => {
    const key = `visit:${v.id}`;
    actionItems.push({
      id: key, kind: 'visit', tone: 'indigo', icon: 'calendar-check',
      title: `Visit to confirm${v.listing ? ' — ' + v.listing : ''}`,
      sub: [v.visitorName || v.customer, v.when].filter(Boolean).join(' · ') || 'Scheduled visit',
      at: v.at || v.createdAt || null,
      busy: busy(key),
      actions: [
        { label: 'Confirm', icon: 'check', onClick: () => mutateVisit?.(v.id, { status: 'confirmed' }), disabled: busy(key) },
        { label: 'Review', icon: 'arrow-right', variant: 'ghost', onClick: () => go?.('visits'), disabled: busy(key) },
      ],
    });
  });
  /* No "Rent due soon" item: `rental` comes out of `managedProps`, which is itself what makes `isOwner` true, so
     `!isOwner && rental` can never fire. */

  const STALE_MS = 2 * 86400000;
  for (const item of actionItems) {
    const ms = typeof item.at === 'number' ? item.at : Date.parse(item.at ?? '');
    item.at = Number.isFinite(ms) && ms > 0 ? ms : null;
  }
  actionItems.sort((a, b) => {
    const aStale = a.at && Date.now() - a.at > STALE_MS ? 1 : 0;
    const bStale = b.at && Date.now() - b.at > STALE_MS ? 1 : 0;
    if (aStale !== bStale) return bStale - aStale;
    return (a.at || Infinity) - (b.at || Infinity);
  });
  return actionItems;
}

/* The third tile counts the same leads the Leads panel lists, which is why the caller passes one `leadCount` rather
   than the arrays: the tile and the panel must not be able to disagree. */
function isLiveListing(listing) {
  const status = String(listing.status || listing.state || '').toLowerCase();
  if (!['approved', 'live', 'verified'].includes(status)) return false;
  if (listing.paused || listing.archived || listing.sold) return false;
  if (['paused', 'archived', 'sold', 'rejected'].includes(status)) return false;
  if (listing.flatmate && (listing.kind === 'post' || listing.flatmateKind === 'post' || listing.shareType === 'seeker')) return false;
  return true;
}

export function buildOwnerStats({ listings = [], items = [], go }) {
  const attention = attentionFromItems(items);
  const live = listings.filter(isLiveListing);
  const views = live.reduce((sum, listing) => sum + (Number(listing.views ?? listing.viewCount ?? listing.stats?.views) || 0), 0);
  return [
    { icon: 'bell', bg: 'bg-amber-400/15', fg: 'text-amber-400', value: String(attention.leads), label: 'Waiting on you', trend: { dir: attention.leads ? 'up' : 'flat', text: attention.leads ? 'Needs a reply' : 'All handled' }, onClick: () => go('leads'), ariaLabel: 'View requests waiting on you' },
    { icon: 'calendar-check', bg: 'bg-indigo-400/15', fg: 'text-indigo-300', value: String(attention.visits), label: 'Visits to confirm', trend: { dir: attention.visits ? 'up' : 'flat', text: attention.visits ? 'Needs confirmation' : 'All handled' }, onClick: () => go('visits'), ariaLabel: 'View visits to confirm' },
    { icon: 'building-2', bg: 'bg-teal-400/15', fg: 'text-teal-400', value: String(live.length), label: 'Live', trend: { dir: 'flat', text: live.length ? `${live.length} listing${live.length === 1 ? '' : 's'}` : 'None live' }, onClick: () => go('properties'), ariaLabel: 'View live properties' },
    { icon: 'eye', bg: 'bg-teal-400/15', fg: 'text-teal-400', value: views.toLocaleString('en-IN'), label: 'Views', trend: { dir: 'flat', text: live.length ? `across ${live.length} live` : 'No live listings' }, onClick: () => go('properties'), ariaLabel: 'View property views' },
  ];
}

// Seeker Overview stat cards — real figures from the user's saved/viewed stores.
export function buildSeekerStats({ savedCount = 0, alertCount = 0, followCount = 0, upcomingVisits = 0, go }) {
  return [
    { icon: 'heart', bg: 'bg-red-400/15', fg: 'text-red-400', value: String(savedCount), label: 'Saved', trend: { dir: 'flat', text: savedCount ? 'Saved homes' : 'None yet' }, onClick: () => go('saved'), ariaLabel: 'View saved properties' },
    { icon: 'bell-plus', bg: 'bg-teal-400/15', fg: 'text-teal-400', value: String(alertCount), label: 'Saved searches', trend: { dir: 'flat', text: alertCount ? 'Alerts active' : 'None yet' }, onClick: () => go('alerts'), ariaLabel: 'View saved searches and alerts' },
    { icon: 'calendar-check', bg: 'bg-indigo-400/15', fg: 'text-indigo-300', value: String(upcomingVisits), label: 'Upcoming visits', trend: { dir: 'flat', text: upcomingVisits ? 'On your calendar' : 'None booked' }, onClick: () => go('visits'), ariaLabel: 'View upcoming visits' },
    { icon: 'building-2', bg: 'bg-amber-400/15', fg: 'text-amber-400', value: String(followCount), label: 'Following', trend: { dir: 'flat', text: followCount ? 'Followed societies' : 'None yet' }, onClick: () => go('alerts'), ariaLabel: 'View followed societies' },
  ];
}
