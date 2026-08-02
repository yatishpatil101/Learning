import { readUser } from '../auth.js';
import { get, parseAmount, set } from './internals.js';

/* =========================================================================
   Posted-property tracking (per current user)
   ========================================================================= */
const listKey = () => {
  const u = readUser();
  return 'puneNestListings:' + ((u && u.mobile) || 'anon');
};
export const getListings = () => get(listKey(), []);
export const hasListings = () => getListings().length > 0;
export const getListing = (id) => getListings().filter((l) => l.id === id)[0] || null;
export const addListing = (l) => {
  const a = getListings();
  a.unshift(l);
  return set(listKey(), a);
};
export const updateListing = (id, patch) => {
  const arr = getListings();
  for (const item of arr) {
    if (item.id === id) {
      Object.assign(item, patch);
      set(listKey(), arr);
      return item;
    }
  }
  return null;
};

/* Foundation fields: changing any of these on an approved listing reverts it for
   re-verification (anti bait-and-switch). Mirrors HTML Auth.LISTING_FOUNDATION_FIELDS. */
export const LISTING_FOUNDATION_FIELDS = ['deal', 'title', 'locality', 'localitySlug', 'bhk', 'bhkNum', 'area', 'type', 'facing', 'floor', 'age', 'construction'];
export const listingFoundationChanged = (oldL, patch) => {
  return LISTING_FOUNDATION_FIELDS.some((f) => (f in patch) && String(patch[f] ?? '') !== String((oldL && oldL[f]) ?? ''));
};
export const isListingApproved = (id) => {
  const l = getListing(id);
  return !!(l && /approved|verified|live/i.test(String(l.status || '')));
};
export const revertListingForReview = (id) => {
  updateListing(id, { status: 'pending', statusClass: 'pill-pending' });
};

/* =========================================================================
   Aadhaar (mock) identity verification — one-time gate for posting a property.
   Mirrors the static app's Auth.isAadhaarVerified/setAadhaarVerified.
   ========================================================================= */
const aadhaarKey = () => {
  const u = readUser();
  return 'puneNestAadhaar:' + ((u && u.mobile) || 'anon');
};
export const isAadhaarVerified = () => {
  const v = get(aadhaarKey(), null);
  return !!(v && v.verified);
};
export const getAadhaarVerification = () => get(aadhaarKey(), null);
/* Record the opt-in Verified badge (L2) earned via DigiLocker consent.
   Accepts a details object; still tolerates a bare mobile string for any
   legacy caller. `mobileMatch` is a soft signal only at MVP (ADR-009a). */
export const setAadhaarVerified = (details = {}) => {
  const d = typeof details === 'string' ? { aadhaarMobile: details } : (details || {});
  return set(aadhaarKey(), {
    verified: true,
    source: d.source || 'digilocker',
    aadhaarMobile: d.aadhaarMobile || '',
    name: d.name || '',
    dob: d.dob || '',
    gender: d.gender || '',
    maskedAadhaar: d.maskedAadhaar || '',
    mobileMatch: d.mobileMatch === undefined ? null : d.mobileMatch,
    at: Date.now(),
  });
};

/* =========================================================================
   Find-a-flatmate room listings. Uses the SAME key as the static app
   (`puneNestRoomListings`) so Flatmates surfaces freshly-posted rooms.
   ========================================================================= */
const ROOMS_KEY = 'puneNestRoomListings';
export const getRooms = () => {
  const v = get(ROOMS_KEY, []);
  return Array.isArray(v) ? v : [];
};
export const addRoom = (room) => {
  const arr = getRooms();
  arr.unshift(room);
  return set(ROOMS_KEY, arr);
};
export const deleteRoom = (id) => {
  const arr = getRooms().filter((r) => r.id !== id);
  return set(ROOMS_KEY, arr);
};
// Patch a stored room in place (mirrors updateFlatmateGroup). Used by the owner
// backfill stepper to adjust seatsOpen without a re-list / re-verification.
export const updateRoom = (id, patch) => {
  const arr = getRooms().map((r) => (r.id === id ? { ...r, ...patch } : r));
  return set(ROOMS_KEY, arr);
};

/* Normalize a flatmate/room record into the shape the dashboard "My Listings"
   panel renders. Rooms live in their own store (Flatmates) but the owner
   still expects to manage them alongside property listings. */
const ROOM_FALLBACK_IMG = 'https://images.unsplash.com/photo-1505691938895-1758d7feb511?w=600&q=80';
export const roomToListing = (room) => {
  const img = room.image || room.img || room.photos?.[0] || ROOM_FALLBACK_IMG;
  const locality = room.locality || room.localities?.[0] || 'Pune';
  const price = room.price ?? room.budget ?? parseAmount(room.rentShare);
  return {
    id: room.id,
    title: room.title || ('Flatmate — ' + (room.flatType ? room.flatType + ' ' : '') + (room.society || locality)),
    locality,
    price,
    deal: 'rent',
    status: room.status || 'pending',
    image: img,
    img,
    views: room.views || 0,
    ownerMobile: room.ownerMobile || '',
    real: true,
    flatmate: true,
    type: 'Flatmate',
    createdAt: room.createdAt,
  };
};

