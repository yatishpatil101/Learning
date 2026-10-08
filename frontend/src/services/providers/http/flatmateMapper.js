
/** Moderation states a row is public in. Mirrors `FlatmateVocabulary.MOD_PUBLIC`. */
export const MOD_PUBLIC = ['live', 'approved'];

/** The state every newly written post, room and group starts in. */
export const MOD_PENDING = 'pending';

/** True when a row is visible to people other than its author. */
export const isPubliclyVisible = (modStatus) => MOD_PUBLIC.includes(modStatus || 'live');

/** Both providers normalise it onto `ApiError.code` so a call site can branch without parsing prose. */
export const CONFLICT_ALREADY_INTERESTED = 'already_interested';
export const CONFLICT_GROUP_FULL = 'group_full';
export const CONFLICT_GROUP_LIMIT = 'group_limit';

/** Exported so the providers can strip it from the message after lifting it onto `code` — one pattern, so the matcher
 * and the eraser cannot drift apart. */
export const CONFLICT_MARKER = /\s*\(([a-z_]+)\)\s*$/;

/** The sub-code a 409 carries, or `null`. End-anchored on the trailing `(marker)` because the prose around it is
 * copy. */
export function conflictSubCode(err) {
  if (err?.status !== 409) return null;
  const hit = CONFLICT_MARKER.exec(err.message || '');
  return hit ? hit[1] : null;
}

/** Seats are set by the host and must never be inferred from `members.length` — a group can be growing or full at any
 * size. */
export function seatsLeftOf(row) {
  if (row?.seatsOpen != null) return Math.max(0, Number(row.seatsOpen));
  const total = Number(row?.seatsTotal) || 0;
  const taken = Array.isArray(row?.members) ? row.members.length : Number(row?.occupants) || 0;
  return Math.max(0, total - taken);
}

/** Per-head rent for a shared flat. `perHead` is server-computed when present; this is the fallback. */
export function perHeadOf(row) {
  if (row?.perHead != null) return Number(row.perHead);
  const rent = Number(row?.rent) || 0;
  const seats = Number(row?.seatsTotal) || 0;
  return seats > 0 ? Math.round(rent / seats) : rent;
}

/** Initials for an avatar chip, from a display name. */
export const initialsOf = (name) =>
  String(name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase();

export function toRoomViewModel(row) {
  const modStatus = row?.modStatus || 'live';
  return {
    id: row?.id || '',
    kind: 'room',
    title: row?.title || '',
    propertyId: row?.propertyId || null,
    roomKind: row?.roomKind || 'bedroom',
    roomType: row?.roomType || 'Private room',
    attachedBath: row?.attachedBath || 'shared',
    furnishing: row?.furnishing || '',
    facing: row?.facing ?? null,
    overlooking: row?.overlooking ?? null,
    bhk: row?.bhk || '',
    flatType: row?.flatType || '',
    homeTypeLabel: row?.homeTypeLabel || '',
    gatedCommunity: !!row?.gatedCommunity,
    // Kept as `budget`: rooms and seeker posts carry `budget` and only groups carry `rent`, which
    // is what `budgetOf` in the page helpers keys on. Renaming it would render ₹0 on every room.
    budget: Number(row?.budget) || 0,
    // `priceBasisOf` treats anything but 'room' as per person, so defaulting an absent value to
    // 'room' inverts the meaning and hides the owner's seat stepper. Pass it through untouched.
    priceBasis: row?.priceBasis || null,
    deposit: Number(row?.deposit) || 0,
    /* Null all the way through, because "the host did not say" is a real answer and rendering it
       as a stated zero would invent a term. Zero notice is a term; no notice period is silence. */
    noticePeriodDays: row?.noticePeriodDays == null ? null : Number(row.noticePeriodDays),
    lockInMonths: row?.lockInMonths == null ? null : Number(row.lockInMonths),
    maintenanceBilling: row?.maintenanceBilling || null,
    electricityBilling: row?.electricityBilling || null,
    // Occupancy is never derived: the host sets these.
    occupancy: row?.occupancy || '',
    occupants: Number(row?.occupants) || 0,
    maxOccupants: Number(row?.maxOccupants) || 0,
    flatCommitted: Number(row?.flatCommitted) || 0,
    flatMax: row?.flatMax == null ? null : Number(row.flatMax),
    shareMax: Number(row?.shareMax) || 0,
    seatsTotal: row?.seatsTotal == null ? null : Number(row.seatsTotal),
    seatsOpen: row?.seatsOpen == null ? null : Number(row.seatsOpen),
    society: row?.society || '',
    societyId: row?.societyId || null,
    // The flat's opaque identity, used only to group sibling rooms into one occupancy ledger
    // (`flatKeyOf`), ahead of `flatNumber` so the door number can leave the anonymous read later.
    flatKey: row?.flatKey || null,
    flatNumber: row?.flatNumber || '',
    locality: row?.locality || '',
    localitySlug: row?.localitySlug || '',
    localities: row?.localities || [],
    lat: row?.lat == null ? null : Number(row.lat),
    lng: row?.lng == null ? null : Number(row.lng),
    hostRole: row?.hostRole || 'tenant',
    verificationTier: row?.verificationTier || null,
    verified: !!row?.verified,
    /* Ops' verdict on the host's claim to the flat, and the whole content of the tier badge. Left
       null when nothing was submitted, so `showHostBadge` can tell "no claim" from "not yet seen". */
    reviewStatus: row?.reviewStatus || null,
    agreementDeclared: !!row?.agreementDeclared,
    owner: row?.owner || '',
    // Contact-gated server-side: arrives masked until the gate opens. Passed through as-is.
    ownerMobile: row?.ownerMobile || '',
    // Moderation — kept so the *author's* copy can be labelled, never to re-filter a feed.
    modStatus,
    publiclyVisible: isPubliclyVisible(modStatus),
    flagForReview: !!row?.flagForReview,
    // The anti-broker signal: the same flat advertised from two accounts shares a fingerprint.
    addressFingerprint: row?.addressFingerprint || '',
    gender: row?.gender || 'any',
    food: row?.food || 'any',
    moveIn: row?.moveIn || '',
    availableFrom: row?.availableFrom || null,
    tags: row?.tags || [],
    note: row?.note || '',
    cover: row?.cover || row?.photos?.[0] || null,
    photos: row?.photos || [],
    status: row?.status || 'active',
    createdAt: row?.createdAt ? Date.parse(row.createdAt) : Date.now(),
    // Only the host's own detail read carries it; the edit form prefills from it.
    host: row?.host || null,
  };
}

/** Wire `FlatmateSeekerPostDto` → the seam's shape. A *person looking*, not a place. */
export function toSeekerPostViewModel(row) {
  const modStatus = row?.modStatus || 'live';
  return {
    id: row?.id || '',
    kind: 'post',
    title: row?.title || '',
    name: row?.name || '',
    gender: row?.gender || 'any',
    age: row?.age == null ? null : Number(row.age),
    occupation: row?.occupation || '',
    // What they will pay — genuinely a budget here.
    budget: Number(row?.budget) || 0,
    // The top of the range, null when they quoted a single number rather than a span.
    budgetMax: row?.budgetMax == null ? null : Number(row.budgetMax),
    localities: row?.localities || [],
    moveIn: row?.moveIn || '',
    flatPref: row?.flatPref || 'any',
    roomPref: row?.roomPref || 'any',
    tags: row?.tags || [],
    note: row?.note || '',
    /* Required-contact verification and author verification are separate server decisions. */
    verifiedContactOnly: !!row?.verifiedContactOnly,
    verified: !!row?.verified,
    modStatus,
    publiclyVisible: isPubliclyVisible(modStatus),
    mobile: row?.mobile || '',
    lat: row?.lat == null ? null : Number(row.lat),
    lng: row?.lng == null ? null : Number(row.lng),
    createdAt: row?.createdAt ? Date.parse(row.createdAt) : Date.now(),
  };
}

/** Wire `FlatmateGroupDto` → the seam's shape. A formed group with seats to fill. */
export function toGroupViewModel(row) {
  const modStatus = row?.modStatus || 'live';
  const members = (row?.members || []).map((m) => ({
    id: m?.id || '',
    name: m?.name || '',
    initials: m?.initials || initialsOf(m?.name),
    verified: !!m?.verified,
    host: !!m?.host,
  }));
  return {
    id: row?.id || '',
    kind: 'group',
    title: row?.title || '',
    locality: row?.locality || '',
    localitySlug: row?.localitySlug || '',
    policy: row?.policy || 'any',
    rent: Number(row?.rent) || 0,
    deposit: Number(row?.deposit) || 0,
    noticePeriodDays: row?.noticePeriodDays == null ? null : Number(row.noticePeriodDays),
    lockInMonths: row?.lockInMonths == null ? null : Number(row.lockInMonths),
    maintenanceBilling: row?.maintenanceBilling || null,
    electricityBilling: row?.electricityBilling || null,
    perHead: perHeadOf(row),
    seatsTotal: Number(row?.seatsTotal) || 0,
    seatsOpen: Number(row?.seatsOpen) || 0,
    seatsLeft: seatsLeftOf(row),
    members,
    propertyId: row?.propertyId || null,
    hostRole: row?.hostRole || 'tenant',
    verificationTier: row?.verificationTier || null,
    // Ops' verdict on the host's claim to the flat — see `toRoomViewModel` for why it stays null.
    reviewStatus: row?.reviewStatus || null,
    agreementDeclared: !!row?.agreementDeclared,
    /** `ownerConsent` is whether it was given; `ownerConsentMobile` is who gave it. A group without it is not
     * blocked, it is flagged — the server decides, not this. */
    ownerConsent: !!row?.ownerConsent,
    ownerConsentMobile: row?.ownerConsentMobile || '',
    addressFingerprint: row?.addressFingerprint || '',
    flagForReview: !!row?.flagForReview,
    modStatus,
    publiclyVisible: isPubliclyVisible(modStatus),
    tags: row?.tags || [],
    note: row?.note || '',
    ownerName: row?.ownerName || '',
    ownerMobile: row?.ownerMobile || '',
    createdAt: row?.createdAt ? Date.parse(row.createdAt) : Date.now(),
    // Null unless the group is still looking for a flat — then `rent` is the top of its budget.
    preferences: toGroupPreferences(row?.preferences),
    hunting: !!row?.preferences,
    localities: row?.preferences?.localities?.length ? [...row.preferences.localities] : (row?.locality ? [row.locality] : []),
  };
}

const moneyOrNull = (v) => (v == null || v === '' ? null : Number(v));

function toGroupPreferences(p) {
  if (!p) return null;
  return {
    localities: p.localities || [],
    bhk: p.bhk || [],
    rentMin: moneyOrNull(p.rentMin),
    rentMax: moneyOrNull(p.rentMax),
    depositMin: moneyOrNull(p.depositMin),
    depositMax: moneyOrNull(p.depositMax),
    gatedOnly: !!p.gatedOnly,
    bachelors: !!p.bachelors,
    furnishing: p.furnishing || null,
    moveInBy: p.moveInBy || null,
  };
}

export function toRequestViewModel(row) {
  const status = row?.status || 'pending';
  return {
    id: row?.id || '',
    // `room` | `group` | `post` — which resource this is against.
    kind: row?.kind || 'room',
    action: row?.action || 'request',
    // `solo` | `bring` | `match` — whether they come alone, with someone, or want pairing.
    share: row?.share || 'solo',
    targetId: row?.targetId || '',
    targetTitle: row?.targetTitle || '',
    locality: row?.locality || '',
    requesterName: row?.requesterName || '',
    requesterMobile: row?.requesterMobile || '',
    message: row?.message || '',
    status,
    awaitingDecision: status === 'pending',
    requestedAt: row?.requestedAt ? Date.parse(row.requestedAt) : Date.now(),
    decidedAt: row?.decidedAt ? Date.parse(row.decidedAt) : null,
  };
}

/** Mirrors the server's closed vocabularies so an unknown value is dropped rather than spent on a 400 the user reads
 * as "search is broken". */
export const VOCAB = {
  gender: ['any', 'male', 'female'],
  food: ['any', 'veg', 'nonveg'],
  flatPref: ['any', 'women', 'men'],
  roomPref: ['any', 'private', 'shared'],
  policy: ['any', 'women', 'men'],
  roomKind: ['master', 'bedroom', 'living'],
  roomType: ['Private room', 'Shared room'],
  attachedBath: ['attached', 'shared'],
  priceBasis: ['room', 'person'],
  furnishing: ['unfurnished', 'semi', 'furnished'],
  bhk: ['1', '2', '3', '4'],
  homeType: ['Flat', 'Independent House', 'Villa', 'Row House'],
  hostRole: ['owner', 'tenant'],
  share: ['solo', 'bring', 'match'],
  tab: ['move-in', 'team-up'],
};

/** Pass a value through only if the server's vocabulary contains it; otherwise omit it. */
export const vocab = (set, value) =>
  (value != null && VOCAB[set]?.includes(String(value)) ? String(value) : undefined);
