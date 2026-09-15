/**
 * Wire ↔ seam translation for flatmates: rooms, groups, seeker posts and requests. Most fields pass
 * straight through; the notes below cover only where the two sides genuinely disagree.
 */

/** Moderation states a row is public in. Mirrors `FlatmateVocabulary.MOD_PUBLIC`. */
export const MOD_PUBLIC = ['live', 'approved'];

/** The state every newly written post, room and group starts in. */
export const MOD_PENDING = 'pending';

/** True when a row is visible to people other than its author. */
export const isPubliclyVisible = (modStatus) => MOD_PUBLIC.includes(modStatus || 'live');

/**
 * Every 409 here arrives as `error: "conflict"`, so the reason lives in a trailing message marker.
 * Both providers normalise it onto `ApiError.code` so a call site can branch without parsing prose.
 */
export const CONFLICT_ALREADY_INTERESTED = 'already_interested';
export const CONFLICT_GROUP_FULL = 'group_full';

/**
 * The trailing `(marker)` itself. Exported so the providers can strip it from the message after
 * lifting it onto `code` — one pattern, so the matcher and the eraser cannot drift apart.
 */
export const CONFLICT_MARKER = /\s*\(([a-z_]+)\)\s*$/;

/**
 * The sub-code a 409 carries, or `null`. End-anchored on the trailing `(marker)` because the prose
 * around it is copy. `FlatmateConflicts` owns the spellings — edit both sides in one commit.
 */
export function conflictSubCode(err) {
  if (err?.status !== 409) return null;
  const hit = CONFLICT_MARKER.exec(err.message || '');
  return hit ? hit[1] : null;
}

/**
 * Seats are set by the host and must never be inferred from `members.length` — a group can be
 * growing or full at any size. Arithmetic is only a fallback for legacy rows missing `seatsOpen`.
 */
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

/**
 * Wire `FlatmateRoomDto` → the seam's room shape. The wire's one `budget` field means asking rent
 * on a room and a ceiling on a seeker post, so `priceBasis` travels with it to disambiguate.
 */
export function toRoomViewModel(row) {
  const modStatus = row?.modStatus || 'live';
  return {
    id: row?.id || '',
    kind: 'room',
    propertyId: row?.propertyId || null,
    // The room itself
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
    // Occupancy. Never derived: the host sets these.
    occupancy: row?.occupancy || '',
    occupants: Number(row?.occupants) || 0,
    maxOccupants: Number(row?.maxOccupants) || 0,
    flatCommitted: Number(row?.flatCommitted) || 0,
    flatMax: row?.flatMax == null ? null : Number(row.flatMax),
    shareMax: Number(row?.shareMax) || 0,
    seatsTotal: row?.seatsTotal == null ? null : Number(row.seatsTotal),
    seatsOpen: row?.seatsOpen == null ? null : Number(row.seatsOpen),
    // Where
    society: row?.society || '',
    societyId: row?.societyId || null,
    // The flat's opaque identity, used only to group sibling rooms into one occupancy ledger
    // (`flatKeyOf`), ahead of `flatNumber` so the door number can leave the anonymous read later.
    flatKey: row?.flatKey || null,
    flatNumber: row?.flatNumber || '',
    locality: row?.locality || '',
    localities: row?.localities || [],
    lat: row?.lat == null ? null : Number(row.lat),
    lng: row?.lng == null ? null : Number(row.lng),
    // Who, and how far they are trusted
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
    // Preferences
    gender: row?.gender || 'any',
    food: row?.food || 'any',
    moveIn: row?.moveIn || '',
    availableFrom: row?.availableFrom || null,
    tags: row?.tags || [],
    note: row?.note || '',
    photos: row?.photos || [],
    status: row?.status || 'active',
    createdAt: row?.createdAt ? Date.parse(row.createdAt) : Date.now(),
  };
}

/** Wire `FlatmateSeekerPostDto` → the seam's shape. A *person looking*, not a place. */
export function toSeekerPostViewModel(row) {
  const modStatus = row?.modStatus || 'live';
  return {
    id: row?.id || '',
    kind: 'post',
    name: row?.name || '',
    gender: row?.gender || 'any',
    age: row?.age == null ? null : Number(row.age),
    occupation: row?.occupation || '',
    // What they will pay — genuinely a budget here.
    budget: Number(row?.budget) || 0,
    localities: row?.localities || [],
    moveIn: row?.moveIn || '',
    flatPref: row?.flatPref || 'any',
    roomPref: row?.roomPref || 'any',
    tags: row?.tags || [],
    note: row?.note || '',
    /* The seeker's own gate: "only verified people may contact me". Distinct from `verified`,
       which is whether *they* are verified. Conflating the two would let an unverified seeker
       demand verification of others while providing none, or hide a verified seeker's post. */
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
    name: m?.name || '',
    initials: m?.initials || initialsOf(m?.name),
    verified: !!m?.verified,
  }));
  return {
    id: row?.id || '',
    kind: 'group',
    title: row?.title || '',
    locality: row?.locality || '',
    policy: row?.policy || 'any',
    rent: Number(row?.rent) || 0,
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
    /* Owner consent is the anti-broker guardrail: a *tenant* subletting seats needs the flat
       owner's acknowledgement. `ownerConsent` is whether it was given; `ownerConsentMobile` is who
       gave it. A group without it is not blocked, it is flagged \u2014 the server decides, not this. */
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
  };
}

/**
 * Wire `FlatmateRequestDto` → the seam's shape. One table backs two flows: a `join` on an open-policy
 * group is already accepted, a room `request` is pending — hence the `awaitingDecision` predicate.
 */
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

/**
 * Mirrors the server's closed vocabularies so an unknown value is dropped rather than spent on a
 * 400 the user reads as "search is broken". Must stay in step with `FlatmateVocabulary`.
 */
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
  hostRole: ['owner', 'tenant'],
  share: ['solo', 'bring', 'match'],
  tab: ['move-in', 'team-up'],
};

/** Pass a value through only if the server's vocabulary contains it; otherwise omit it. */
export const vocab = (set, value) =>
  (value != null && VOCAB[set]?.includes(String(value)) ? String(value) : undefined);
