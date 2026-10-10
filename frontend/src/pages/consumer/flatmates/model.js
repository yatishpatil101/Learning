import { ROOM_SHARE_MAX } from '../../../lib/data/flatSplit.js';

export const TAB_MOVE_IN = 'move-in';
export const TAB_TEAM_UP = 'team-up';
export const TABS = [TAB_MOVE_IN, TAB_TEAM_UP];

const TAB_ALIAS = {
  rooms: TAB_MOVE_IN,
  flatmates: TAB_TEAM_UP,
  groups: TAB_TEAM_UP,
};
export const normalizeTab = (v) => (TABS.includes(v) ? v : TAB_ALIAS[v] || TAB_MOVE_IN);

/* `attachedBath: true` on master is implied by the kind, so the owner never has to answer the
 * same question twice. */
export const ROOM_KINDS = {
  master: { key: 'master', label: 'Master bedroom', attachedBath: true, icon: 'bed-double' },
  bedroom: { key: 'bedroom', label: 'Bedroom', attachedBath: false, icon: 'bed-single' },
  living: { key: 'living', label: 'Living room', attachedBath: false, icon: 'sofa' },
};
export const ROOM_KIND_ORDER = ['master', 'bedroom', 'living'];
export const roomKindMeta = (k) => ROOM_KINDS[k] || null;
export const roomKindOf = (r) => {
  if (!r) return null;
  if (r.roomKind && ROOM_KINDS[r.roomKind]) return r.roomKind;
  return r.attachedBath === 'attached' ? 'master' : 'bedroom';
};

/* An owner letting a vacant flat room-by-room starts at 'empty' and becomes a real household as
 * rooms fill, so the state is derived, never stored stale. */
export const OCCUPANCY_EMPTY = 'empty';
export const OCCUPANCY_FILLING = 'filling';
export const OCCUPANCY_OCCUPIED = 'occupied';

export const seatsTotalOf = (item) => Number(item?.seatsTotal) || 1;
export const seatsOpenOf = (item) => {
  const total = seatsTotalOf(item);
  if (item?.seatsOpen != null) return Math.max(0, Math.min(total, Number(item.seatsOpen)));
  const members = Array.isArray(item?.members) ? item.members.length : 0;
  return Math.max(0, total - members);
};
export const filledSeatsOf = (item) => Math.max(0, seatsTotalOf(item) - seatsOpenOf(item));

export const occupancyOf = (item) => {
  if (!item) return OCCUPANCY_OCCUPIED;
  // 'filling' is a DERIVED state and must never be trusted at rest: a stored 'filling' is re-derived from the flat
  // ledger exactly like 'empty', so it is not silently collapsed to 'occupied'.
  if (item.occupancy !== OCCUPANCY_EMPTY && item.occupancy !== OCCUPANCY_FILLING) return OCCUPANCY_OCCUPIED;
  const committed = item.flatCommitted != null ? item.flatCommitted : filledSeatsOf(item);
  return committed > 0 ? OCCUPANCY_FILLING : OCCUPANCY_EMPTY;
};

/* A group only counts as a place once it is attached to one — otherwise it is a set of people still hunting, which is
   the same decision as a solo seeker. */
export const hasAddress = (item) => !!(item && (item.propertyId || item.society));
export const tabOf = (item) => {
  if (!item) return TAB_TEAM_UP;
  if (item.kind === 'room') return TAB_MOVE_IN;
  if (item.kind === 'group') return hasAddress(item) ? TAB_MOVE_IN : TAB_TEAM_UP;
  return TAB_TEAM_UP;
};

export const asKind = (kind) => (item) => ({ ...item, kind });

/* 'room' — an owner splitting a flat prices each ROOM. */
export const PRICE_ROOM = 'room';
export const PRICE_PERSON = 'person';
export const priceBasisOf = (r) => (r?.priceBasis === PRICE_ROOM ? PRICE_ROOM : PRICE_PERSON);
export const rentOf = (r) => Number(r?.budget) || 0;
export const perPersonRent = (r, people) => Math.round(rentOf(r) / Math.max(1, Number(people) || 1));

export { canSplitIntoRooms, maxRoomsForBhk, capBoundsFor } from '../../../lib/data/flatSplit.js';
export { ROOM_SHARE_MAX };

/* ─── Occupancy ─── The owner declares how many people may live in the FLAT (the society's
 * rule) and which rooms exist — never how many people belong in a given room. */
export const DEFAULT_MAX_OCCUPANTS = 3;
export const maxOccupantsOf = (flat) => Number(flat?.maxOccupants) || DEFAULT_MAX_OCCUPANTS;
export const occupantsOf = (r) => Math.max(0, Number(r?.occupants) || 0);
/* Rooms in one flat share a single ceiling, so the cap can only be read across siblings — which means the key must
   identify a FLAT, never just a building. */
const flatKeyOf = (r) => {
  if (r?.flatKey) return 'flat:' + r.flatKey;
  if (r?.propertyId) return 'prop:' + r.propertyId;
  return 'room:' + (r?.id || '');
};

/* ledger. */
export const decorateRooms = (rooms = []) => {
  const ledger = {};
  rooms.forEach((r) => {
    const key = flatKeyOf(r);
    if (!key) return;
    if (!ledger[key]) ledger[key] = { committed: 0, max: maxOccupantsOf(r) };
    ledger[key].committed += occupantsOf(r);
  });
  return rooms.map((r) => {
    const e = ledger[flatKeyOf(r)] || null;
    const committed = e ? Math.max(e.committed, Number(r.flatCommitted) || 0) : 0;
    const headroom = e ? Math.max(0, e.max - committed) : 1;
    const shareMax = priceBasisOf(r) !== PRICE_ROOM ? 1
      : r.seatsTotal != null ? roomPlacesOf(r)
        : Math.max(1, Math.min(ROOM_SHARE_MAX - occupantsOf(r), headroom));
    return { ...r, flatCommitted: committed, flatMax: e ? e.max : null, shareMax };
  });
};
export const bestPerPersonRent = (r) => perPersonRent(r, r?.shareMax || 1);

export const ROOM_DOUBLE = 'Shared room';
export const roomPlacesOf = (r) => Math.max(1, Number(r?.seatsTotal) || 1);
export const hasSharerAlready = (r) => {
  const open = Number(r?.seatsOpen);
  return r?.seatsOpen != null && open > 0 && open < roomPlacesOf(r);
};
/* A legacy room with no `seatsTotal` is priced "each, if shared" by `decorateRooms`, so calling it a
   single room would contradict its own price tag. */
export const roomTypeLabel = (r, t) => {
  if (!r?.roomType) return null;
  if (r.roomType === ROOM_DOUBLE) return t('flatmates.roomDouble');
  return r.seatsTotal == null && (r.shareMax || 1) > 1 ? null : t('flatmates.roomSingle');
};
