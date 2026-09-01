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
   re-verification (anti bait-and-switch). These MUST mirror the server's revert set,
   which is exactly the searchable facets a buyer can filter on — the shape a
   bait-and-switch takes. The server derives the set by reflection off
   PropertyController.search's @RequestParam facets and enforces it in
   ListingEditRules.apply; ListingFoundationTest#everySearchFacetIsClassified pins the
   seven facets: price, bhk, propertyType(wire `type`), locality, deal, furnishing,
   possession. Mapped to this store's field names, `propertyType`→`type` and the
   possession facet is carried by the seed's `construction` field (see tileMeta.js).
   `address` (D219) is the one member that is not a search facet at all: it is the
   duplicate key's input, so editing it is how a listing moves onto somebody else's
   flat. It is re-checked and stays live, like price.
   Excludes derived projections (localitySlug/bhkNum) and non-facet fields
   (title/area/facing/floor/age) the server leaves as ordinary, non-reverting edits.
   Pinned to the server by `frontend/scripts/check-listing-foundation.mjs` (npm run
   check:listing), which also pins the live copy of this rule — FOUNDATION_FORM_KEYS in
   pages/consumer/list-property/editPolicy.js, the one the owner-facing banner reads.

   No runtime caller remains: the mock store never re-ran the foundation check itself, and the
   live rule the UI enforces is editPolicy.js's copy. The only consumer of THIS export is the
   gate script above, which regex-parses the array out of this file to hold all three copies in
   sync — so the constant stays exported even though nothing imports it. */
export const LISTING_FOUNDATION_FIELDS = ['deal', 'locality', 'bhk', 'type', 'price', 'furnishing', 'construction', 'address'];
export const isListingApproved = (id) => {
  const l = getListing(id);
  return !!(l && /approved|verified|live/i.test(String(l.status || '')));
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

