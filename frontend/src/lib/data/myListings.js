import { myListings } from '../../services/propertyService.js';
import { myFlatmateGroups, myFlatmatePosts, myFlatmateRooms } from '../../services/flatmateService.js';

const SHARE_REQ_IMG = 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=600&q=80';
const FLATMATE_GROUP_IMG = 'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=600&q=80';

export function flatmatePostToListing(r) {
  const locality = (r.localities && r.localities[0]) || 'Pune';
  return {
    id: r.id,
    title: 'Looking to share — ' + locality,
    locality,
    price: r.budget,
    deal: 'rent',
    status: r.modStatus === 'expired' ? 'expired' : 'approved',
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

export function flatmateGroupToListing(g) {
  const perHead = g.seatsTotal ? Math.round(g.rent / g.seatsTotal) : g.rent;
  return {
    id: g.id,
    title: g.title,
    locality: g.locality || 'Pune',
    price: perHead,
    deal: 'rent',
    status: g.modStatus === 'expired' ? 'expired' : 'approved',
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
  const image = room.image || room.img || room.photos?.[0] || null;
  const locality = room.locality || room.localities?.[0] || 'Pune';
  return {
    id: room.id,
    title: room.title || ('Flatmate — ' + (room.flatType ? room.flatType + ' ' : '') + (room.society || locality)),
    locality,
    price: room.price ?? room.budget ?? 0,
    deal: 'rent',
    status: room.modStatus === 'expired' ? 'expired' : (room.status || 'pending'),
    image,
    img: image,
    views: room.views || 0,
    ownerMobile: room.ownerMobile || '',
    real: true,
    flatmate: true,
    propertyId: room.propertyId || null,
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
  /* Drop archived rows for this combined panel; the seam must keep returning the owner's full file. */
  const mine = (await myListings(user)).filter((l) => !l.archived);
  const [rooms, flatmatePosts, flatmateGroups] = await Promise.all([
    getMyRooms(),
    getMyFlatmatePosts(),
    getMyFlatmateGroups(),
  ]);
  return [...flatmatePosts, ...flatmateGroups, ...rooms, ...mine];
}
