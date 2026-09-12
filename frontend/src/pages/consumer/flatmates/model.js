/* Flatmates domain model — the single source of truth for how a post is
   classified, priced and described.

   The page is split by ONE question a user can always answer instantly:

       "Is there an address yet?"

   Yes → MOVE_IN  ("Move in now")  — you browse PLACES. Priced, dated, visitable.
   No  → TEAM_UP  ("Team up")      — you browse PEOPLE. You form a household first.

   This replaces the old Flatmates/Rooms/Groups split, which was shaped by the
   supply record type rather than by seeker intent — a group with a flat and a
   room in a flat are the same decision, while a group still hunting is not. */
import { ROOM_SHARE_MAX } from '../../../lib/data/flatSplit.js';

export const TAB_MOVE_IN = 'move-in';
export const TAB_TEAM_UP = 'team-up';
export const TABS = [TAB_MOVE_IN, TAB_TEAM_UP];

/* Legacy `?view=` values kept as aliases so older deep links, saved alerts and
   notification links resolve instead of silently falling back to the default. */
const TAB_ALIAS = {
  rooms: TAB_MOVE_IN,
  flatmates: TAB_TEAM_UP,
  groups: TAB_TEAM_UP, // an address-less group is the common case; addressed ones re-sort themselves
};
export const normalizeTab = (v) => (TABS.includes(v) ? v : TAB_ALIAS[v] || TAB_MOVE_IN);

/* ─── Rooms ───
   Priced per ROOM, not per seat — that's how the Indian share market actually
   works: a master bedroom with its own bathroom commands a premium over a second
   bedroom, and a partitioned living room ("hall sharing") is the budget option.
   `attachedBath: true` on master is implied by the kind, so the owner never has
   to answer the same question twice. */
export const ROOM_KINDS = {
  master: { key: 'master', label: 'Master bedroom', attachedBath: true, icon: 'bed-double' },
  bedroom: { key: 'bedroom', label: 'Bedroom', attachedBath: false, icon: 'bed-single' },
  living: { key: 'living', label: 'Living room', attachedBath: false, icon: 'sofa' },
};
export const ROOM_KIND_ORDER = ['master', 'bedroom', 'living'];
export const roomKindMeta = (k) => ROOM_KINDS[k] || null;
/* Older rooms predate roomKind and only carry the attachedBath string, so infer a
   kind from it rather than showing nothing. */
export const roomKindOf = (r) => {
  if (!r) return null;
  if (r.roomKind && ROOM_KINDS[r.roomKind]) return r.roomKind;
  return r.attachedBath === 'attached' ? 'master' : 'bedroom';
};

/* ─── Occupancy ───
   Whether anyone already lives in the home. Orthogonal to WHO is allowed to let
   it (`hostRole`/`verificationTier`): occupancy answers the seeker's question
   ("will I have flatmates from day one?"), host role answers the trust question.

   An owner letting a vacant flat room-by-room starts at 'empty' and becomes a
   real household as rooms fill, so the state is derived, never stored stale. */
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
  // 'filling' is a DERIVED state and must never be trusted at rest: a stored
  // 'filling' is re-derived from the flat ledger exactly like 'empty', so it is
  // not silently collapsed to 'occupied'. Any other value ('occupied', or an
  // unknown/absent field) means a real household already lives there.
  if (item.occupancy !== OCCUPANCY_EMPTY && item.occupancy !== OCCUPANCY_FILLING) return OCCUPANCY_OCCUPIED;
  // A room reads its flat's ledger (people who moved in anywhere in the flat);
  // a group falls back to its own declared seats.
  const committed = item.flatCommitted != null ? item.flatCommitted : filledSeatsOf(item);
  return committed > 0 ? OCCUPANCY_FILLING : OCCUPANCY_EMPTY;
};

/* ─── Tab classification ───
   A room always has an address. A group only counts as a place once it is
   attached to one — otherwise it is a set of people still hunting, which is the
   same decision as a solo seeker. */
export const hasAddress = (item) => !!(item && (item.propertyId || item.society));
export const tabOf = (item) => {
  if (!item) return TAB_TEAM_UP;
  if (item.kind === 'room') return TAB_MOVE_IN;
  if (item.kind === 'group') return hasAddress(item) ? TAB_MOVE_IN : TAB_TEAM_UP;
  return TAB_TEAM_UP;
};

/* Tag a post with its record type once, at the merge boundary, so every consumer
   downstream branches on an explicit field instead of sniffing for properties. */
export const asKind = (kind) => (item) => ({ ...item, kind });

/* ─── Pricing basis ───
   Two kinds of price live in this list and they are NOT the same number:

     'person' — legacy/spare-room posts quote what one flatmate pays.
     'room'   — an owner splitting a flat prices each ROOM. Sharers split that
                rent equally, so the owner's total never changes and the
                per-person price falls as more people take the room.

   Mixing them silently would make a ₹9,000 shared bed look pricier than a
   ₹14,000 private room, so the basis is explicit and defaults to the legacy
   meaning for every post that predates the split flow. */
export const PRICE_ROOM = 'room';
export const PRICE_PERSON = 'person';
export const priceBasisOf = (r) => (r?.priceBasis === PRICE_ROOM ? PRICE_ROOM : PRICE_PERSON);
export const rentOf = (r) => Number(r?.budget) || 0;
export const perPersonRent = (r, people) => Math.round(rentOf(r) / Math.max(1, Number(people) || 1));

/* ─── Owner split rules ───
   The rules themselves live in lib/data/flatSplit.js next to the storage they
   guard; they're re-exported here so view code has one import for the whole
   flatmates domain. */
export { canSplitIntoRooms, maxRoomsForBhk, capBoundsFor } from '../../../lib/data/flatSplit.js';
export { ROOM_SHARE_MAX };

/* ─── Occupancy ───
   The owner declares how many people may live in the FLAT (the society's rule)
   and which rooms exist — never how many people belong in a given room. Tenants
   decide that for themselves, so room occupancy is emergent, not declared. */
export const DEFAULT_MAX_OCCUPANTS = 3;
export const maxOccupantsOf = (flat) => Number(flat?.maxOccupants) || DEFAULT_MAX_OCCUPANTS;
export const occupantsOf = (r) => Math.max(0, Number(r?.occupants) || 0);
/* Rooms in one flat share a single ceiling, so the cap can only be read across
   siblings — which means the key must identify a FLAT, never just a building.
   `flatKey` is the server's own opaque identity when it sends one; propertyId is
   exact (an owner split always has one) and society+flat number is a safe
   fallback; a bare society name is not, since two unrelated hosts in
   "Skyline Heights" would pool into one ledger and silently suppress each
   other's rooms. Those posts fall back to their own id and stand alone.

   The `flatKey` branch is first so that D213 becomes a server-only change: the
   anonymous room read publishes a precise door number today purely because this
   function needs *an* identity, and an opaque one groups exactly as well. Until
   the server mints it the branch is inert and the `addr:` fallback still runs. */
const flatKeyOf = (r) => {
  if (r?.flatKey) return 'flat:' + r.flatKey;
  if (r?.propertyId) return 'prop:' + r.propertyId;
  if (r?.society && r?.flatNumber) return 'addr:' + r.society + '|' + r.flatNumber;
  return 'room:' + (r?.id || '');
};

/* Annotate each room with what its flat has left, and with the most people who
   could still take it. Done once at the merge boundary so cards and filters read
   a plain field instead of re-deriving the ledger. */
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
    const headroom = e ? Math.max(0, e.max - e.committed) : 1;
    // A per-person price is already a per-head number, so splitting it again
    // would invent a discount that nobody offered.
    const shareMax = priceBasisOf(r) === PRICE_ROOM
      ? Math.max(1, Math.min(ROOM_SHARE_MAX - occupantsOf(r), headroom))
      : 1;
    return { ...r, flatCommitted: e ? e.committed : 0, flatMax: e ? e.max : null, shareMax };
  });
};
/* The cheapest this room can be per person, given how far it can actually be
   shared right now. Equals the room rent when sharing isn't possible. */
export const bestPerPersonRent = (r) => perPersonRent(r, r?.shareMax || 1);

