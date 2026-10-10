import { myListings } from '../../services/propertyService.js';
import { myFlatmateGroups, myFlatmatePosts, myFlatmateRooms } from '../../services/flatmateService.js';

const SHARE_REQ_IMG = 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=600&q=80';
const FLATMATE_GROUP_IMG = 'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=600&q=80';

// Flatmate moderation states (FlatmateVocabulary.MOD_STATUS) onto the listing card's status vocabulary.
const CARD_STATUS = { live: 'approved', approved: 'approved', pending: 'pending', flagged: 'pending', removed: 'rejected', rejected: 'rejected', expired: 'expired' };
const cardStatus = (modStatus) => CARD_STATUS[modStatus] || 'pending';

export function flatmatePostToListing(r) {
  const locality = (r.localities && r.localities[0]) || 'Pune';
  return {
    id: r.id,
    title: 'Looking to share — ' + locality,
    locality,
    price: r.budget,
    deal: 'rent',
    status: cardStatus(r.modStatus),
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
    status: cardStatus(g.modStatus),
    image: FLATMATE_GROUP_IMG,
    img: FLATMATE_GROUP_IMG,
    views: 0,
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
  const image = room.cover || null;
  const locality = room.locality || room.localities?.[0] || 'Pune';
  return {
    id: room.id,
    title: room.title || ('Flatmate — ' + (room.flatType ? room.flatType + ' ' : '') + (room.society || locality)),
    locality,
    price: room.budget ?? 0,
    deal: 'rent',
    status: cardStatus(room.modStatus),
    image,
    img: image,
    views: 0,
    real: true,
    flatmate: true,
    propertyId: room.propertyId || null,
    occupants: room.occupants || 0,
    type: 'Flatmate',
    createdAt: room.createdAt,
  };
}

/** The caller's own rooms, including moderation-hidden rows. */
export async function getMyRooms() {
  const page = await myFlatmateRooms({ size: 100 });
  return page.items.map(roomToListing);
}

/* The rows with the room rows swapped, in the order `loadMyListings` builds them. */
export function withRooms(rows, rooms) {
  return [...rows.filter((l) => l.flatmatePost), ...rows.filter((l) => l.flatmateGroup), ...rooms, ...rows.filter((l) => !l.flatmate)];
}

/* Combined "My Listings": the owner's property listings plus their flatmate posts. */
export async function loadMyListings(user) {
  const [mine, rooms, flatmatePosts, flatmateGroups] = await Promise.all([
    myListings(user),
    getMyRooms(),
    getMyFlatmatePosts(),
    getMyFlatmateGroups(),
  ]);
  /* Drop archived rows for this combined panel; the seam must keep returning the owner's full file. */
  return [...flatmatePosts, ...flatmateGroups, ...rooms, ...mine.filter((l) => !l.archived)];
}
