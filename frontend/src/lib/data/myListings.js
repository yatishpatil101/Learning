/* SEAM NOTE: this `lib/` module imports from `services/` — the one place that direction is taken.
   It is safe and deliberate: nothing the provider registry reaches imports this file, so there is
   no cycle (verified). The alternative was threading owner listings through two callers, a larger
   diff for no gain. */
import { myListings } from '../../services/propertyService.js';
import { myFlatmateGroups, myFlatmatePosts, myFlatmateRooms } from '../../services/flatmateService.js';

const SHARE_REQ_IMG = 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=600&q=80';
const FLATMATE_GROUP_IMG = 'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=600&q=80';
const ROOM_FALLBACK_IMG = 'https://images.unsplash.com/photo-1505691938895-1758d7feb511?w=600&q=80';

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

/** The caller's own seeker posts, scoped by the provider rather than by browser data. */
export async function getMyFlatmatePosts() {
  const page = await myFlatmatePosts({ size: 100 });
  return page.items.map(flatmatePostToListing);
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

/** The caller's own groups, including moderation-hidden rows. */
export async function getMyFlatmateGroups() {
  const page = await myFlatmateGroups({ size: 100 });
  return page.items.map(flatmateGroupToListing);
}

/* A room is already a live view model. This small adapter only gives the dashboard its shared
   card shape; it never reads or writes browser storage. */
export function roomToListing(room) {
  const image = room.image || room.img || room.photos?.[0] || ROOM_FALLBACK_IMG;
  const locality = room.locality || room.localities?.[0] || 'Pune';
  return {
    id: room.id,
    title: room.title || ('Flatmate — ' + (room.flatType ? room.flatType + ' ' : '') + (room.society || locality)),
    locality,
    price: room.price ?? room.budget ?? 0,
    deal: 'rent',
    status: room.status || 'pending',
    image,
    img: image,
    views: room.views || 0,
    ownerMobile: room.ownerMobile || '',
    real: true,
    flatmate: true,
    type: 'Flatmate',
    createdAt: room.createdAt,
  };
}

/** The caller's own rooms, including moderation-hidden rows. */
export async function getMyRooms() {
  const page = await myFlatmateRooms({ size: 100 });
  return page.items.map(roomToListing);
}

/* Combined "My Listings": the owner's property listings plus their flatmate posts. */
export async function loadMyListings(user) {
  /* Archived rows are dropped here rather than at the seam, because the seam is right to return
     them: `GET /me/listings` is the owner's complete file, statuses and all, and staff restore work
     reads the same list. This is the dashboard, and on the dashboard an archived listing is one the
     owner deliberately took down — leaving it in place would put a card that looks live under a
     heading that says My Properties, immediately after a confirmation that promised buyers would
     stop seeing it. The count beside it ("Active Listings") would disagree with the list too, since
     the server's quota already excludes archived rows. */
  const mine = (await myListings(user)).filter((l) => !l.archived);
  const [rooms, flatmatePosts, flatmateGroups] = await Promise.all([
    getMyRooms(),
    getMyFlatmatePosts(),
    getMyFlatmateGroups(),
  ]);
  /* A "demo top-up" stood here: a seeded owner with nothing of their own was given the three
     newest listings in the catalogue so a walkthrough never opened an empty dashboard. It was
     mock-only on purpose — against the real catalogue those are *other people's* listings shown
     under My Properties, which is worse than an honest empty state. */
  return [...flatmatePosts, ...flatmateGroups, ...rooms, ...mine];
}
