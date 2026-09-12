/* Pure UI validation for the server-owned flat-splitting flow. Room persistence, occupancy and
   verification now travel exclusively through `flatmateService`. */

export const bedroomsOf = (bhk) => {
  const n = parseInt(String(bhk ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export const maxRoomsForBhk = (bhk) => (bedroomsOf(bhk) === 4 ? Infinity : (bedroomsOf(bhk) || 1) + 1);
export const ROOM_SHARE_MAX = 3;

export const canSplitIntoRooms = (listing) => !!(listing && listing.deal === 'rent' && listing.id);

export const capBoundsFor = (roomCount) => ({
  min: Math.max(1, roomCount),
  max: Math.max(1, roomCount) * ROOM_SHARE_MAX,
});

export const validateSplit = ({ bhk, rooms = [], maxOccupants }) => {
  if (!rooms.length) return { ok: false, reason: 'noRooms' };
  if (rooms.length > maxRoomsForBhk(bhk)) return { ok: false, reason: 'tooManyRooms' };
  if (rooms.some((room) => !(Number(room.rent) > 0))) return { ok: false, reason: 'missingRent' };
  const { min, max } = capBoundsFor(rooms.length);
  const cap = Number(maxOccupants) || 0;
  if (cap < min || cap > max) return { ok: false, reason: 'capOutOfRange' };
  return { ok: true };
};
