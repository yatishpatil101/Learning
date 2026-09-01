/* SEAM NOTE: this `lib/` module imports from `services/` — the one place that direction is taken.
   It is safe and deliberate: the provider registry reaches `lib/mockApi.js` and
   `lib/data/properties-admin.js`, neither of which imports this file, so there is no cycle (verified).
   The alternative was threading owner listings through two callers, a larger diff for no gain. */
import { listProperties, myListings } from '../../services/propertyService.js';
import { isHttpDomain } from '../../services/config.js';
import { getRooms, roomToListing, hasListings } from '../store.js';
import { getFlatmatePosts, getFlatmateGroups } from './flatmates.js';
import { digits } from '../contact.js';
import { myOwnerId, ownerIdForMobile } from './ownerIdentity.js';

const SHARE_REQ_IMG = 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=600&q=80';
const FLATMATE_GROUP_IMG = 'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=600&q=80';

/* Normalize a seeker "flatmate request" (posted via the Flatmates modal,
   stored in its own key) into the listing shape the dashboard renders. Flagged
   with flatmatePost:true so the panel can route edit/view/delete to Flatmates. */
export function flatmatePostToListing(r) {
  const locality = (r.localities && r.localities[0]) || 'Pune';
  return {
    id: r.id,
    title: 'Looking to share — ' + locality,
    locality,
    price: r.budget,
    deal: 'rent',
    status: 'approved',
    image: SHARE_REQ_IMG,
    img: SHARE_REQ_IMG,
    views: 0,
    ownerMobile: r.mobile || '',
    real: true,
    flatmate: true,
    flatmatePost: true,
    type: 'Flatmate',
    createdAt: r.createdAt,
  };
}

/* The current user's flatmate requests, matched tolerantly by the last 10
   mobile digits, falling back to name for legacy posts without a mobile. */
export function getMyFlatmatePosts(user) {
  const mine = myOwnerId() || ownerIdForMobile(user?.mobile);
  const nm = (user?.name || '').trim().toLowerCase();
  return getFlatmatePosts()
    .filter((r) => {
      const owner = ownerIdForMobile(r.mobile);
      if (owner && mine) return owner === mine;
      return nm && r.name && r.name.trim().toLowerCase() === nm;
    })
    .map(flatmatePostToListing);
}

/* Normalize a user-created flatmate group into the dashboard listing shape.
   Flagged flatmateGroup+flatmate so the panel skips property-only actions (freshness,
   quality, deals) and routes edit/view/delete to Flatmates. */
export function flatmateGroupToListing(g) {
  const perHead = g.seatsTotal ? Math.round(g.rent / g.seatsTotal) : g.rent;
  return {
    id: g.id,
    title: g.title,
    locality: g.locality || 'Pune',
    price: perHead,
    deal: 'rent',
    status: 'approved',
    image: FLATMATE_GROUP_IMG,
    img: FLATMATE_GROUP_IMG,
    views: 0,
    ownerMobile: g.ownerMobile || '',
    real: true,
    flatmate: true,
    flatmateGroup: true,
    type: 'Flatmate group',
    createdAt: g.createdAt,
  };
}

/* The current user's flatmate groups, matched the same tolerant way as requests. */
export function getMyFlatmateGroups(user) {
  const mine = myOwnerId() || ownerIdForMobile(user?.mobile);
  const nm = (user?.name || '').trim().toLowerCase();
  return getFlatmateGroups()
    .filter((g) => {
      const owner = ownerIdForMobile(g.ownerMobile);
      if (owner && mine) return owner === mine;
      return nm && g.ownerName && g.ownerName.trim().toLowerCase() === nm;
    })
    .map(flatmateGroupToListing);
}

/* The current user's flatmate/room posts, normalized to the listing shape the
   dashboard renders. Matching is tolerant of mobile-number formatting (compares
   the last 10 digits) and legacy rooms without an ownerMobile are treated as the
   current user's, so a freshly-posted room always surfaces for its owner. */
export function getMyRooms(user) {
  const mine = myOwnerId() || ownerIdForMobile(user?.mobile);
  return getRooms()
    .filter((r) => {
      const owner = ownerIdForMobile(r.ownerMobile);
      return !owner || !mine || owner === mine;
    })
    .map(roomToListing);
}

/* Combined "My Listings": the owner's property listings plus their flatmate
   posts. Falls back to a few demo listings only for pre-seeded owner accounts
   with nothing of their own yet. */
export async function loadMyListings(user) {
  /* Archived rows are dropped here rather than at the seam, because the seam is right to return
     them: `GET /me/listings` is the owner's complete file, statuses and all, and staff restore work
     reads the same list. This is the dashboard, and on the dashboard an archived listing is one the
     owner deliberately took down — leaving it in place would put a card that looks live under a
     heading that says My Properties, immediately after a confirmation that promised buyers would
     stop seeing it. The count beside it ("Active Listings") would disagree with the list too, since
     the server's quota already excludes archived rows. */
  const mine = (await myListings(user)).filter((l) => !l.archived);
  const rooms = getMyRooms(user);
  const flatmatePosts = getMyFlatmatePosts(user);
  const flatmateGroups = getMyFlatmateGroups(user);
  const hasAny = mine.length > 0 || rooms.length > 0 || flatmatePosts.length > 0 || flatmateGroups.length > 0;
  // Demo top-up exists so a seeded owner account never opens an empty dashboard in a walkthrough.
  // It is mock-only on purpose: against the live API these would be *other people's* listings shown
  // under "My Listings", which is worse than an honest empty state.
  const demo = user?.role === 'owner' && !hasListings() && !hasAny && !isHttpDomain('property')
    ? (await listProperties({}, 'newest')).slice(0, 3)
    : [];
  return [...flatmatePosts, ...flatmateGroups, ...rooms, ...(mine.length ? mine : demo)];
}
