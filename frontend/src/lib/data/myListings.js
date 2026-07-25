import { listProperties } from '../mockApi.js';
import { getRooms, roomToListing, hasListings } from '../store.js';
import { getShareRequests, getShareGroups } from './shareFlat.js';
import { digits } from '../contact.js';

const SHARE_REQ_IMG = 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=600&q=80';
const SHARE_GROUP_IMG = 'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=600&q=80';

/* Normalize a seeker "flat-share request" (posted via the Share a Flat modal,
   stored in its own key) into the listing shape the dashboard renders. Flagged
   with shareRequest:true so the panel can route edit/view/delete to Share a Flat. */
export function shareRequestToListing(r) {
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
    shareRequest: true,
    type: 'Flatmate',
    createdAt: r.createdAt,
  };
}

/* The current user's flat-share requests, matched tolerantly by the last 10
   mobile digits, falling back to name for legacy posts without a mobile. */
export function getMyShareRequests(user) {
  const mine = digits(user?.mobile).slice(-10);
  const nm = (user?.name || '').trim().toLowerCase();
  return getShareRequests()
    .filter((r) => {
      const owner = digits(r.mobile).slice(-10);
      if (owner && mine) return owner === mine;
      return nm && r.name && r.name.trim().toLowerCase() === nm;
    })
    .map(shareRequestToListing);
}

/* Normalize a user-created flat-share group into the dashboard listing shape.
   Flagged shareGroup+flatmate so the panel skips property-only actions (freshness,
   quality, deals) and routes edit/view/delete to Share a Flat. */
export function shareGroupToListing(g) {
  const perHead = g.seatsTotal ? Math.round(g.rent / g.seatsTotal) : g.rent;
  return {
    id: g.id,
    title: g.title,
    locality: g.locality || 'Pune',
    price: perHead,
    deal: 'rent',
    status: 'approved',
    image: SHARE_GROUP_IMG,
    img: SHARE_GROUP_IMG,
    views: 0,
    ownerMobile: g.ownerMobile || '',
    real: true,
    flatmate: true,
    shareGroup: true,
    type: 'Flat-share group',
    createdAt: g.createdAt,
  };
}

/* The current user's flat-share groups, matched the same tolerant way as requests. */
export function getMyShareGroups(user) {
  const mine = digits(user?.mobile).slice(-10);
  const nm = (user?.name || '').trim().toLowerCase();
  return getShareGroups()
    .filter((g) => {
      const owner = digits(g.ownerMobile).slice(-10);
      if (owner && mine) return owner === mine;
      return nm && g.ownerName && g.ownerName.trim().toLowerCase() === nm;
    })
    .map(shareGroupToListing);
}

/* The current user's flatmate/room posts, normalized to the listing shape the
   dashboard renders. Matching is tolerant of mobile-number formatting (compares
   the last 10 digits) and legacy rooms without an ownerMobile are treated as the
   current user's, so a freshly-posted room always surfaces for its owner. */
export function getMyRooms(user) {
  const mine = digits(user?.mobile).slice(-10);
  return getRooms()
    .filter((r) => {
      const owner = digits(r.ownerMobile).slice(-10);
      return !owner || !mine || owner === mine;
    })
    .map(roomToListing);
}

/* Combined "My Listings": the owner's property listings plus their flatmate
   posts. Falls back to a few demo listings only for pre-seeded owner accounts
   with nothing of their own yet. */
export async function loadMyListings(user) {
  const props = await listProperties({ includeAllStatuses: true }, 'newest');
  const mine10 = digits(user?.mobile).slice(-10);
  const mine = props.filter((p) => {
    if (!p.real) return false;
    const owner = digits(p.ownerMobile).slice(-10);
    return !owner || !mine10 || owner === mine10;
  });
  const rooms = getMyRooms(user);
  const shareReqs = getMyShareRequests(user);
  const shareGroups = getMyShareGroups(user);
  const hasAny = mine.length > 0 || rooms.length > 0 || shareReqs.length > 0 || shareGroups.length > 0;
  const demo = user?.role === 'owner' && !hasListings() && !hasAny ? props.slice(0, 3) : [];
  return [...shareReqs, ...shareGroups, ...rooms, ...(mine.length ? mine : demo)];
}
