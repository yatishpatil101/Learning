/* Imports the listings slice directly rather than the store barrel: the barrel
   also pulls in billing.js, which imports mockApi, and this module has no need
   for the rest of the store surface. */
import { getRooms, addRoom, deleteRoom, updateRoom, isListingApproved } from '../store/listings.js';
import { evaluateHostEligibility, enqueueFlatmateReview } from './flatmates.js';
import { digits as digitsOf } from './identityNorm.js';

/* Flat splitting — an owner letting one flat room by room.

   The entry rule is deliberately narrow: rooms may only be carved out of a flat
   the owner ALREADY listed for rent. That constraint does two jobs — a sale
   listing can never be sliced, and the whole-flat listing keeps existing, so the
   share market never cannibalises core rental inventory.

   Being attached to a listing is NOT itself proof of ownership: a new listing is
   unverified until Ops approves it, so rooms split from one start unbadged and
   are promoted only when that approval lands.

   The owner declares WHICH ROOMS exist, the rent for each, and how many people
   may live in the flat (the society's rule). They never declare how many people
   belong in a given room — tenants decide that for themselves, so per-room
   occupancy is emergent and only the flat cap binds. */

/* Lettable rooms are the bedrooms plus the hall; the kitchen is never let. The
   listing form's "4" pill means "4+", so its room count can't be bounded and the
   flat cap is left to do the work alone. */
export const maxRoomsForBhk = (bhk) => (String(bhk) === '4' ? Infinity : (Number(bhk) || 1) + 1);
/* Sanity ceiling per room. Tenants choose how they share, but this stops a hall
   becoming a dormitory — the line between a flat share and an unlicensed PG. */
export const ROOM_SHARE_MAX = 3;

export const canSplitIntoRooms = (listing) => !!(listing && listing.deal === 'rent' && listing.id);

/* Every room needs at least one person, and no room may exceed the share
   ceiling, so a valid flat cap sits between those two bounds. */
export const capBoundsFor = (roomCount) => ({ min: Math.max(1, roomCount), max: Math.max(1, roomCount) * ROOM_SHARE_MAX });
export const validateSplit = ({ bhk, rooms = [], maxOccupants }) => {
  if (!rooms.length) return { ok: false, reason: 'noRooms' };
  if (rooms.length > maxRoomsForBhk(bhk)) return { ok: false, reason: 'tooManyRooms' };
  if (rooms.some((r) => !(Number(r.rent) > 0))) return { ok: false, reason: 'missingRent' };
  const { min, max } = capBoundsFor(rooms.length);
  const cap = Number(maxOccupants) || 0;
  if (cap < min || cap > max) return { ok: false, reason: 'capOutOfRange' };
  return { ok: true };
};

/* ─── Storage ─── */
export const roomsForProperty = (propertyId) => (propertyId ? getRooms().filter((r) => r.propertyId === propertyId) : []);
export const isFlatSplit = (propertyId) => roomsForProperty(propertyId).length > 0;
/* How many people have actually moved into the flat, across every room. This is
   the number that decides whether the whole-flat listing is still honest. */
export const splitOccupants = (propertyId) => roomsForProperty(propertyId)
  .reduce((n, r) => n + (Number(r.occupants) || 0), 0);
export const isSplitOccupied = (propertyId) => splitOccupants(propertyId) > 0;

/* Create one room record per declared room. Descriptive fields are inherited
   from the parent listing so the owner never retypes an address they already
   gave us, and every room carries the same propertyId — the key that ties them
   into one flat for the occupancy ledger and the joint agreement.

   Trust rules, in order:
     1. only the signed-in owner of the listing may split it;
     2. the flat can only be split once;
     3. the anti-broker guardrails (live-share cap + address dedupe) apply here
        exactly as they do to every other supply path;
     4. the Owner-verified badge is EARNED from the parent listing's Ops
        approval — never asserted by the act of splitting. */
export const splitFlat = (listing, { maxOccupants, rooms = [], ownerMobile = '', ownerName = '' }) => {
  const check = validateSplit({ bhk: listing?.bhk, rooms, maxOccupants });
  if (!check.ok) return check;
  if (!canSplitIntoRooms(listing)) return { ok: false, reason: 'notSplittable' };

  // Only the listing's own owner may carve it up. The dashboard only ever shows
  // you your own listings, but the rule belongs where it's enforceable — this
  // store is localStorage, so the UI is not a security boundary. Compared on the
  // last 10 digits so a stored "+91 " prefix can't read as a different person.
  const me = digitsOf(ownerMobile).slice(-10);
  const owner = digitsOf(listing.ownerMobile).slice(-10);
  if (!me || (owner && owner !== me)) return { ok: false, reason: 'notOwner' };

  // Splitting twice would create two room sets on one propertyId and corrupt the
  // occupancy ledger, so a second attempt is refused rather than merged.
  if (isFlatSplit(listing.id)) return { ok: false, reason: 'alreadySplit' };

  /* The Owner-verified tier means "attached to a property Ops has approved". A
     brand-new listing is still pending, so its rooms start at identity tier with
     no badge and go to the Ops queue; reconcileSplitVerification promotes them
     once the parent listing is approved. Minting the badge here would let anyone
     with a mobile number publish "verified" supply for a flat they don't own. */
  const approved = isListingApproved(listing.id);
  const tier = approved ? 'owner' : 'identity';

  // Same guardrails every other supply path runs: cap live shares per identity
  // and detect two hosts claiming one flat. Owner tier is exempt from the count
  // (a real owner may legitimately let several rooms) but never from the dedupe.
  const guard = evaluateHostEligibility({
    mobile: ownerMobile,
    tier,
    address: { propertyId: listing.id, society: listing.society, locality: listing.locality },
  });
  if (guard.blocked) return { ok: false, reason: 'guard', message: guard.reason };

  const now = Date.now();
  const locality = listing?.locality || '';
  const created = [];
  rooms.forEach((r, i) => {
    const id = 'rmx' + now + '-' + i;
    created.push(id);
    addRoom({
      id,
      type: 'flatmate',
      propertyId: listing.id,
      priceBasis: 'room',
      occupancy: 'empty',
      occupants: 0,
      maxOccupants: Number(maxOccupants),
      roomKind: r.roomKind,
      // A master bedroom's private bathroom is implied by the room kind, so the
      // owner is never asked the same question twice.
      attachedBath: r.roomKind === 'master' ? 'attached' : 'shared',
      roomType: r.roomKind === 'living' ? 'Shared room' : 'Private room',
      budget: Number(r.rent),
      deposit: Number(r.deposit) || Number(r.rent) * 2,
      hostRole: 'owner',
      verificationTier: tier,
      owner: ownerName,
      ownerMobile,
      bhk: listing.bhk,
      flatType: listing.bhk ? listing.bhk + ' BHK' : '',
      society: listing.society || listing.title || '',
      flatNumber: listing.flatNumber || '',
      locality,
      localities: locality ? [locality] : [],
      furnishing: listing.furnishing || '',
      homeTypeLabel: listing.homeTypeLabel || 'Flat',
      img: listing.image || listing.img || '',
      moveIn: 'now',
      gender: 'any',
      food: 'any',
      tags: [],
      note: r.note || '',
      status: listing.status || 'pending',
      // The green Verified pill tracks the parent listing's approval, so it can
      // never appear on a flat nobody has checked.
      verified: approved,
      addressFingerprint: guard.fingerprint,
      flagForReview: guard.flagForReview,
      createdAt: now,
      time: 'Just now',
    });
  });

  /* Anything unproven goes to Ops: an unapproved parent listing, or an address a
     different host already claimed. One review per flat — reviewing four rooms
     of the same flat separately would just be the same check four times. */
  if (!approved || guard.flagForReview) {
    enqueueFlatmateReview({
      roomId: created[0],
      kind: 'room',
      host: ownerName,
      hostMobile: digitsOf(ownerMobile),
      address: (listing.society || listing.title || 'Flat') + ' · ' + (locality || 'Pune'),
      tier,
      flagForReview: guard.flagForReview,
      ownerConsent: false,
      note: approved ? '' : 'Whole-flat listing is still pending verification.',
    });
  }

  return { ok: true, count: rooms.length, tier, pending: !approved, flagged: guard.flagForReview };
};

/* Promote a flat's rooms to Owner-verified once Ops approves the parent listing.
   The badge is stored on each room (seekers can't read the owner's listing
   store), so it needs a reconciliation pass rather than a live lookup. Runs from
   the owner's own session, where the listing's status is readable. */
export const reconcileSplitVerification = () => {
  const byProperty = {};
  getRooms().forEach((r) => {
    if (!r || r.priceBasis !== 'room' || !r.propertyId) return;
    if (r.verificationTier === 'owner' && r.verified) return; // already promoted
    (byProperty[r.propertyId] = byProperty[r.propertyId] || []).push(r);
  });
  let promoted = 0;
  Object.entries(byProperty).forEach(([propertyId, list]) => {
    if (!isListingApproved(propertyId)) return;
    list.forEach((r) => { updateRoom(r.id, { verificationTier: 'owner', verified: true, status: 'approved' }); promoted += 1; });
  });
  return promoted;
};

/* Withdrawing the split is only safe while the flat is still empty — once
   someone has moved in, deleting their room would erase a live tenancy. */
export const canUnsplit = (propertyId) => isFlatSplit(propertyId) && !isSplitOccupied(propertyId);
export const unsplitFlat = (propertyId) => {
  if (!canUnsplit(propertyId)) return { ok: false, reason: 'occupied' };
  roomsForProperty(propertyId).forEach((r) => deleteRoom(r.id));
  return { ok: true };
};

/* Owner marks how many people are actually living in a room. Clamped to the
   per-room ceiling and to whatever the flat's cap has left, so the ledger can
   never exceed what the society allows. */
export const setRoomOccupants = (roomId, next) => {
  const room = getRooms().find((r) => r.id === roomId);
  if (!room) return { ok: false, reason: 'notFound' };
  const others = roomsForProperty(room.propertyId)
    .filter((r) => r.id !== roomId)
    .reduce((n, r) => n + (Number(r.occupants) || 0), 0);
  const cap = Number(room.maxOccupants) || ROOM_SHARE_MAX;
  const ceiling = Math.min(ROOM_SHARE_MAX, Math.max(0, cap - others));
  const value = Math.max(0, Math.min(ceiling, Number(next) || 0));
  updateRoom(roomId, { occupants: value });
  return { ok: true, occupants: value };
};
