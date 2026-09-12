/**
 * Wire ↔ seam translation for the flatmates domain: rooms, groups, seeker posts and requests.
 *
 * The widest surface in the seam — four resources, 23 endpoints, and `FlatmateRoomDto` alone
 * carries ~45 fields. Most of it passes straight through. What follows is only the parts where the
 * two sides genuinely disagree, because that is the only thing worth writing down.
 *
 * ## 1. Two tabs, three resources
 *
 * The Flatmates page has two tabs and the server has a vocabulary for them
 * (`FlatmateVocabulary.TAB` = `move-in | team-up`), but they do not map one-to-one onto resources:
 *
 *   **Move in**  → `/flatmates/rooms`   (a room in someone's flat)
 *   **Team up**  → `/flatmates/posts`   (a person looking) **and** `/flatmates/groups` (a formed group)
 *
 * So "team up" is two reads, not one, and the page interleaves them. `resolveTab` on the server
 * exists to translate the *legacy* `view=rooms|flatmates|groups` query into the new tab names; the
 * seam sends `tab` directly and never the legacy form.
 *
 * ## 2. `modStatus` decides visibility, and the client must not second-guess it
 *
 * Every flatmate resource carries `modStatus`
 * (`pending | live | approved | flagged | removed | rejected`). A new post starts at `pending`
 * (D72) and the server filters public feeds down to `MOD_PUBLIC` = `live | approved` — so a
 * public list never contains anything else.
 *
 * But **the owner's own list does**, because somebody whose post is still in review, or was
 * removed, needs to know. The client therefore keeps `modStatus` and `isPubliclyVisible`, and
 * uses them only to *label* the owner's copy. Re-filtering a public feed on the client would be
 * duplicating a decision the server has already made, and the two would drift.
 *
 * The rule is expressed as a whitelist for the same reason it is on the server: an unrecognised
 * state must read as "not public", not as "public".
 */

/** Moderation states a row is public in. Mirrors `FlatmateVocabulary.MOD_PUBLIC`. */
export const MOD_PUBLIC = ['live', 'approved'];

/** The state every newly written post, room and group starts in (D72). */
export const MOD_PENDING = 'pending';

/** True when a row is visible to people other than its author. */
export const isPubliclyVisible = (modStatus) => MOD_PUBLIC.includes(modStatus || 'live');

/**
 * ## 2b. The three interest doors answer 409 for two different reasons
 *
 * `ConflictException` fixes `ErrorCodes.CONFLICT`, so **every** 409 in this domain arrives with
 * `error: "conflict"` on the wire. The reason lives in the message, as a trailing marker the
 * services write by hand — `(already_interested)`, `(group_full)`. Reading the envelope's `error`
 * therefore cannot tell the two apart, and they need opposite treatment:
 *
 *   `already_interested` — benign. The host already has the message. Informational.
 *   `group_full`         — the last seat went while the board was on screen. A real refusal.
 *
 * Both providers normalise that marker onto `ApiError.code` so a call site can branch on it
 * without parsing prose. The mock throws the sub-code directly.
 */
export const CONFLICT_ALREADY_INTERESTED = 'already_interested';
export const CONFLICT_GROUP_FULL = 'group_full';

/**
 * The trailing `(marker)` itself. Exported so the providers can strip it from the message after
 * lifting it onto `code` — one pattern, so the matcher and the eraser cannot drift apart.
 */
export const CONFLICT_MARKER = /\s*\(([a-z_]+)\)\s*$/;

/**
 * The sub-code a 409 carries, or `null` for anything else.
 *
 * Matched on the trailing `(marker)` the services append, not on the message body — the prose
 * either side of it is copy and will be rewritten.
 *
 * The other half of this contract is `FlatmateConflicts` in
 * `backend/src/main/java/com/draazy/api/engagement/flatmate/`: it owns the two spellings above
 * and does the appending itself, precisely so no service can put a full stop or a hint after the
 * marker and silently blind this regex — which is end-anchored on purpose, because a message that
 * merely *contains* `already_interested` is not the same claim. `FlatmateConflictsTest` reproduces
 * this pattern character for character against the real exceptions, so a change on either side
 * that breaks the other fails a test rather than a user's toast. If you edit the pattern here,
 * edit it there in the same commit (D182).
 */
export function conflictSubCode(err) {
  if (err?.status !== 409) return null;
  const hit = CONFLICT_MARKER.exec(err.message || '');
  return hit ? hit[1] : null;
}

/**
 * ## 3. Seats are the one number that must never be inferred
 *
 * A room and a group both carry `seatsTotal` and `seatsOpen`. It is tempting to derive one from
 * `members.length`, and that is wrong in both directions: a group can have three members and two
 * open seats (it is looking to grow), or four members and zero (it is full). The host sets the
 * number; membership is a separate fact.
 *
 * `seatsLeft` therefore reads `seatsOpen` and only falls back to arithmetic when the server sent
 * nothing — which happens for legacy rows that predate the field.
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
 * Wire `FlatmateRoomDto` → the seam's room shape.
 *
 * ## 4. `budget` on the wire is the *asking rent*, and the UI calls it `rent`
 *
 * The DTO reuses one field (`budget`) across rooms and seeker posts, where it means opposite
 * things: on a room it is what the host charges, on a seeker post it is what the seeker will pay.
 * The seam names them for what they are — `rent` on a room, `budget` on a post — because a card
 * that renders "budget" beside a room is telling the reader the wrong story.
 *
 * `priceBasis` (`room | person`) is what makes the number meaningful, so it travels with it.
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
    bhk: row?.bhk || '',
    flatType: row?.flatType || '',
    homeTypeLabel: row?.homeTypeLabel || '',
    gatedCommunity: !!row?.gatedCommunity,
    // Money. Kept as `budget` — the wire calls it that, and so does every card, filter and map pin
    // on the page. An earlier draft renamed it to `rent` on the grounds that on a room this number
    // IS the asking rent (whereas on a seeker post the same wire field is a ceiling). That reads
    // better in isolation and is wrong in practice: the page's settled convention is that rooms and
    // seeker posts carry `budget` and only groups carry `rent`, which is exactly what `budgetOf`
    // in the page helpers keys on. A seam that renames a field the whole page already agrees on
    // buys nothing and costs every call site — this one would have rendered ₹0 on every room.
    budget: Number(row?.budget) || 0,
    // See the note in the mock provider: `priceBasisOf` treats anything other than 'room' as per
    // person, so defaulting an absent value to 'room' inverts the meaning and hides the owner's
    // seat stepper. Pass it through untouched.
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
    // (`flatKeyOf`). Passed through ahead of `flatNumber` so that when the server starts minting
    // it, the door number can leave the anonymous read with no further frontend change (D213).
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
    /* Ops' verdict on the host's claim to the flat, and the whole content of the tier badge:
       `pending` withholds it, `approved` grants it. Absent when nothing was ever submitted, which is
       why it is left null rather than defaulted — `showHostBadge` distinguishes "no claim" from
       "claim not yet looked at", and a default would collapse the two. Read out of localStorage
       until the feed DTOs started carrying it, which meant it existed only on the reviewer's own
       machine. */
    reviewStatus: row?.reviewStatus || null,
    agreementDeclared: !!row?.agreementDeclared,
    owner: row?.owner || '',
    // Contact-gated server-side: arrives masked until the gate opens. Passed through as-is.
    ownerMobile: row?.ownerMobile || '',
    // Moderation — kept so the *author's* copy can be labelled. Never used to re-filter a feed.
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
 * Wire `FlatmateRequestDto` → the seam's shape.
 *
 * ## 5. `join` is already accepted; `request` is not
 *
 * One table backs two flows, and they differ in a way the inbox has to respect. Joining an
 * **open-policy** group is accepted outright — `FlatmateRequest`'s constructor sets
 * `status = 'accepted'` and stamps `decidedAt` when `action === 'join'`. Asking to take a room is
 * `action = 'request'` and lands `pending` for the host to decide.
 *
 * So an inbox that shows every row as "awaiting your decision" would be wrong about half of them.
 * `awaitingDecision` is the honest predicate.
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
 * ## 6. The vocabularies are closed, and the server answers 400 on anything else
 *
 * `FlatmateVocabulary.require` rejects an unknown value with a message listing the allowed set.
 * That is good server behaviour and bad client behaviour to rely on: a filter chip that sends
 * `"Female"` instead of `"female"` becomes a 400 the user reads as "search is broken".
 *
 * These are the same sets, so the provider can drop an unknown value rather than spend a round trip
 * earning a validation error. They must stay in step with the Java file.
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
