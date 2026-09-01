/**
 * Mock flatmate provider — the localStorage counterpart to `providers/http/flatmateProvider.js`.
 *
 * ## What this tightens
 *
 * The mock stores are keyed by owner mobile and validate almost nothing. The server has a closed
 * vocabulary for nine fields and rejects anything outside it with a 400 that lists the allowed
 * values. Every difference below is the mock being made **stricter**, never the reverse — a mock
 * more permissive than the server passes tests the real thing would fail.
 *
 * | Rule | Mock before | Here (and on the server) |
 * |---|---|---|
 * | Enum fields (`gender`, `policy`, `roomType`, …) | anything | closed sets, 400 otherwise |
 * | A room with no photos | allowed | 400 (`@NotEmpty`) — it is the shape broker spam takes |
 * | A seeker post with no localities | allowed | 400 (`@NotEmpty`) |
 * | Reading a host's request inbox | any caller could name any host | the signed-in host only |
 * | Joining an open group | always `pending` | **`accepted` outright** — policy decides |
 *
 * That last one is the interesting inversion: the mock was *more* restrictive than the server, so a
 * call site written against it would show "waiting for approval" for a join that had already
 * succeeded.
 */
import { ApiError } from '../../http.js';
import { readUser } from '../../../lib/auth.js';
import { digits, myMobile } from '../../../lib/contact.js';
import { getRooms, updateRoom, deleteRoom as _storeDeleteRoom, getListings } from '../../../lib/store.js';
import {
  getFlatmatePosts,
  saveFlatmatePost as _storeWriteSeekerPost,
  updateFlatmatePost,
  deleteFlatmatePost as _storeDeletePost,
  getFlatmateGroups,
  saveFlatmateGroup,
  deleteFlatmateGroup as _storeDeleteGroup,
  addInterest,
  hasInterest,
  getMyInterests,
  getFlatmateRequests,
  addFlatmateRequest,
  decideFlatmateRequest,
  setOwnerConsent,
  getFlatmateReviewStatusMap,
} from '../../../lib/data/flatmates.js';
import {
  splitFlat,
  unsplitFlat,
  isFlatSplit,
  roomsForProperty,
  setRoomOccupants as _storeSetOccupants,
} from '../../../lib/data/flatSplit.js';
import {
  CONFLICT_ALREADY_INTERESTED,
  CONFLICT_GROUP_FULL,
  MOD_PENDING,
  VOCAB,
  initialsOf,
  isPubliclyVisible,
  perHeadOf,
  seatsLeftOf,
} from '../http/flatmateMapper.js';
import { SEEKERS, SEED_ROOMS, SEED_GROUPS } from '../../../pages/consumer/flatmates/constants.js';

/* The demo seed lives here rather than in the page.

   It used to be merged in the view (`[...getRooms(), ...SEED_ROOMS]`), which meant the board was
   assembled from two sources the seam knew nothing about. Switching the domain on would then have
   emptied the page of everything except the handful of rows a tester had typed in — not a crash, a
   board that looks broken. Behind the provider the seed is what it always was, a stand-in for a
   populated database, and it stays on the mock side of the seam where the live API replaces it. */

const me = () => digits(myMobile() || '');
/* `ApiError` takes an options **object** (`{ code, message, status, ... }`), not positional
   arguments. Constructing it positionally leaves `status` undefined, so every `err.status === 404`
   branch at a call site silently falls through to the generic path. */
const badRequest = (message) => new ApiError({ code: 'bad_request', status: 400, message });
const notFound = (what) => new ApiError({ code: 'not_found', status: 404, message: `${what} not found` });
const unauthorized = () => new ApiError({ code: 'unauthorized', status: 401, message: 'Sign in to continue' });
const forbidden = (message) => new ApiError({ code: 'forbidden', status: 403, message });
const requireUser = () => { const u = readUser(); if (!u) throw unauthorized(); return u; };

/**
 * A 409 with its sub-code on `code`.
 *
 * The server puts `error: "conflict"` on the wire for both of these and distinguishes them only
 * by a marker in the message; the http provider parses that marker back out onto `code`, so the
 * mock has to produce the same shape or the call site's two branches would be reachable in only
 * one of the two modes. The message carries the marker too, for the same reason.
 */
const conflict = (code, message) => new ApiError({ code, status: 409, message: `${message} (${code})` });
const alreadyInterested = () => conflict(CONFLICT_ALREADY_INTERESTED,
  'You have already sent this host a request — your earlier message is with them.');

/**
 * Reject a value outside the server's closed set, with the same message shape.
 *
 * `FlatmateVocabulary.require` throws `BadRequestException` listing the allowed values. Mirrored so
 * a call site that sends `"Female"` fails here too, rather than passing the mock and 400-ing live.
 */
function requireVocab(set, value, field) {
  if (value == null || value === '') return undefined;
  const v = String(value);
  if (!VOCAB[set].includes(v)) {
    throw badRequest(`Unknown ${field}: '${v}'. Expected one of ${[...VOCAB[set]].sort().join(', ')}.`);
  }
  return v;
}

function paginate(rows, page = 0, size = 24) {
  const all = rows || [];
  const start = page * size;
  return {
    items: all.slice(start, start + size),
    page,
    size,
    total: all.length,
    totalPages: Math.max(1, Math.ceil(all.length / size)),
  };
}

/** Public feeds never contain moderated-away rows. The server filters these server-side. */
const publicOnly = (rows) => (rows || []).filter((r) => isPubliclyVisible(r.modStatus));

/* The Ops verification verdict, joined onto the row.
 *
 * Live it arrives on the row itself — the server reads `flatmate_reviews` alongside the feed — so
 * the page takes `reviewStatus` off whatever the seam hands back and no longer reaches past it for
 * this. Mock-side the verdicts are still a separate store, so the join happens here instead: the
 * provider's job is to answer in the shape the page expects, whichever side of the seam it is on.
 *
 * Passed in by the list callers rather than read per row: this is one `localStorage` parse, and a
 * five-hundred-row feed would otherwise do five hundred of them for an answer that cannot change
 * mid-map.
 */
const verdicts = () => getFlatmateReviewStatusMap();

/* ─── Rooms ─────────────────────────────────────────────────────────────────────────────────── */

const roomVm = (r, seen = verdicts()) => ({
  id: r.id,
  kind: 'room',
  propertyId: r.propertyId || null,
  roomKind: r.roomKind || 'bedroom',
  roomType: r.roomType || 'Private room',
  attachedBath: r.attachedBath || 'shared',
  furnishing: r.furnishing || '',
  bhk: r.bhk == null ? '' : String(r.bhk),
  flatType: r.flatType || '',
  homeTypeLabel: r.homeTypeLabel || '',
  gatedCommunity: !!r.gatedCommunity,
  budget: Number(r.budget ?? r.rent ?? r.rentShare) || 0,
  /* NOT defaulted to 'room'. `priceBasisOf` in the page model reads anything that is not exactly
     'room' as **per person**, and the two are opposites: a per-room listing shows no seat stepper
     (tenants decide occupancy) while a per-person one does. Defaulting here inverted that for every
     row the host never set, and the owner's backfill control silently disappeared. Absent means
     absent — let the one place that owns the default keep owning it. */
  priceBasis: r.priceBasis || null,
  deposit: Number(r.deposit) || 0,
  occupancy: r.occupancy || '',
  occupants: Number(r.occupants) || 0,
  maxOccupants: Number(r.maxOccupants) || 0,
  flatCommitted: Number(r.flatCommitted) || 0,
  flatMax: r.flatMax == null ? null : Number(r.flatMax),
  shareMax: Number(r.shareMax) || 0,
  seatsTotal: r.seatsTotal == null ? null : Number(r.seatsTotal),
  seatsOpen: r.seatsOpen == null ? null : Number(r.seatsOpen),
  society: r.society || '',
  societyId: r.societyId || null,
  flatNumber: r.flatNumber || '',
  locality: r.locality || '',
  localities: r.localities || [],
  lat: r.lat == null ? null : Number(r.lat),
  lng: r.lng == null ? null : Number(r.lng),
  hostRole: r.hostRole || 'tenant',
  verificationTier: r.verificationTier || null,
  verified: !!r.verified,
  reviewStatus: r.reviewStatus || seen[r.id] || null,
  agreementDeclared: !!r.agreementDeclared,
  owner: r.owner || r.ownerName || '',
  ownerMobile: digits(r.ownerMobile || ''),
  modStatus: r.modStatus || 'live',
  publiclyVisible: isPubliclyVisible(r.modStatus),
  flagForReview: !!r.flagForReview,
  addressFingerprint: r.addressFingerprint || '',
  gender: r.gender || 'any',
  food: r.food || 'any',
  moveIn: r.moveIn || '',
  availableFrom: r.availableFrom || null,
  tags: r.tags || r.lifestyle || [],
  note: r.note || '',
  photos: r.photos || [],
  status: r.status || 'active',
  createdAt: r.at || r.createdAt || Date.now(),
});

/** Rooms and seeker posts carry `localities[]`; groups carry one `locality`. Match either. */
const inLocality = (r, want) => !want || r.locality === want || (r.localities || []).includes(want);

export async function listRooms(filters = {}, page = 0, size = 24) {
  const seen = verdicts();
  let rows = publicOnly([...getRooms(), ...SEED_ROOMS]).map((r) => roomVm(r, seen));
  if (filters.locality) rows = rows.filter((r) => inLocality(r, filters.locality));
  const gender = requireVocab('gender', filters.gender, 'gender');
  if (gender && gender !== 'any') rows = rows.filter((r) => r.gender === gender || r.gender === 'any');
  const food = requireVocab('food', filters.food, 'food');
  if (food && food !== 'any') rows = rows.filter((r) => r.food === food || r.food === 'any');
  if (filters.maxBudget) rows = rows.filter((r) => r.budget <= Number(filters.maxBudget));
  if (filters.minBudget) rows = rows.filter((r) => r.budget >= Number(filters.minBudget));
  return paginate(rows, page, size);
}

export async function createRoom(room = {}) {
  requireUser();
  // `photos` is `@NotEmpty` on the server: a room with no pictures is what broker spam looks like.
  if (!(room.photos || []).length) throw badRequest('photos must not be empty');
  if (!room.locality) throw badRequest('locality must not be blank');
  if (!(Number(room.rent ?? room.rentShare) > 0)) throw badRequest('rentShare must be positive');
  requireVocab('bhk', room.bhk, 'bhk');
  requireVocab('attachedBath', room.attachedBath, 'attachedBath');
  requireVocab('furnishing', room.furnishing, 'furnishing');
  requireVocab('hostRole', room.hostRole, 'hostRole');
  requireVocab('gender', room.lookingFor, 'lookingFor');
  requireVocab('food', room.foodPref, 'foodPref');
  const rec = {
    id: 'fr' + Date.now(),
    ...room,
    budget: Number(room.rent ?? room.rentShare) || 0,
    ownerMobile: me(),
    modStatus: MOD_PENDING,
    at: Date.now(),
  };
  const arr = getRooms();
  arr.unshift(rec);
  try { localStorage.setItem('puneNestRoomListings', JSON.stringify(arr)); } catch { /* quota */ }
  return roomVm(rec);
}

export async function setRoomSeats(id, seatsOpen) {
  requireUser();
  const next = Math.max(0, Number(seatsOpen) || 0);
  updateRoom(id, { seatsOpen: next });
  const row = getRooms().find((r) => String(r.id) === String(id));
  if (!row) throw notFound('Room');
  return roomVm(row);
}

export async function setRoomOccupants(id, occupants) {
  requireUser();
  _storeSetOccupants(id, Math.max(0, Number(occupants) || 0));
  const row = getRooms().find((r) => String(r.id) === String(id));
  if (!row) throw notFound('Room');
  return roomVm(row);
}

/**
 * `POST /flatmates/rooms/{id}/interest`.
 *
 * Searches the seed as well as the store: the board is mostly seed rows, so a lookup that only
 * consulted `getRooms()` would 404 on almost every card a tester can actually click.
 */
export async function roomInterest(id, { share = 'solo', message } = {}) {
  const u = requireUser();
  requireVocab('share', share, 'share');
  const row = [...getRooms(), ...SEED_ROOMS].find((r) => String(r.id) === String(id));
  if (!row) throw notFound('Room');
  if (digits(row.ownerMobile) && digits(row.ownerMobile) === me()) {
    throw forbidden('You cannot enquire about your own room.');
  }
  // The mock's stand-in for V27's unique index. Ahead of the write, as on the server, so a repeat
  // press is refused rather than quietly rewriting the first message.
  if (hasInterest(me(), 'room', id)) throw alreadyInterested();
  addInterest(me(), 'room', id);
  addFlatmateRequest(digits(row.ownerMobile), {
    kind: 'room', targetId: id, targetTitle: row.society || row.locality || 'Room',
    locality: row.locality, requesterName: u.name || 'Seeker', requesterMobile: me(),
    action: 'request', share, message, status: 'pending',
  });
}

export async function reissueRoomAgreement(id) {
  requireUser();
  updateRoom(id, { agreementReissuedAt: Date.now() });
}

/* ─── Groups ────────────────────────────────────────────────────────────────────────────────── */

const groupVm = (g, seen = verdicts()) => ({
  id: g.id,
  kind: 'group',
  title: g.title || '',
  locality: g.locality || '',
  policy: g.policy || 'any',
  rent: Number(g.rent) || 0,
  perHead: perHeadOf(g),
  seatsTotal: Number(g.seatsTotal) || 0,
  seatsOpen: Number(g.seatsOpen ?? seatsLeftOf(g)) || 0,
  seatsLeft: seatsLeftOf(g),
  members: (g.members || []).map((m) => (typeof m === 'string'
    ? { name: m, initials: initialsOf(m), verified: false }
    : { name: m.name || '', initials: m.initials || initialsOf(m.name), verified: !!m.verified })),
  propertyId: g.propertyId || null,
  hostRole: g.hostRole || g.role || 'tenant',
  verificationTier: g.verificationTier || null,
  reviewStatus: g.reviewStatus || seen[g.id] || null,
  agreementDeclared: !!(g.agreementDeclared ?? g.agreement),
  ownerConsent: !!g.ownerConsent,
  ownerConsentMobile: digits(g.ownerConsentMobile || g.consentMobile || ''),
  addressFingerprint: g.addressFingerprint || '',
  flagForReview: !!g.flagForReview,
  modStatus: g.modStatus || 'live',
  publiclyVisible: isPubliclyVisible(g.modStatus),
  tags: g.tags || [],
  note: g.note || '',
  ownerName: g.ownerName || g.name || '',
  ownerMobile: digits(g.ownerMobile || ''),
  createdAt: g.at || g.createdAt || Date.now(),
});

export async function listGroups(filters = {}, page = 0, size = 24) {
  const seen = verdicts();
  let rows = publicOnly([...getFlatmateGroups(), ...SEED_GROUPS]).map((g) => groupVm(g, seen));
  if (filters.locality) rows = rows.filter((g) => inLocality(g, filters.locality));
  const policy = requireVocab('policy', filters.policy, 'policy');
  if (policy && policy !== 'any') rows = rows.filter((g) => g.policy === policy || g.policy === 'any');
  if (filters.maxRent) rows = rows.filter((g) => g.rent <= Number(filters.maxRent));
  if (filters.minRent) rows = rows.filter((g) => g.rent >= Number(filters.minRent));
  return paginate(rows, page, size);
}

export async function createGroup(group = {}) {
  const u = requireUser();
  if (!group.title || String(group.title).trim().length < 3) throw badRequest('title must be at least 3 characters');
  if (!(Number(group.rent) > 0)) throw badRequest('rent must be positive');
  requireVocab('policy', group.policy, 'policy');
  requireVocab('hostRole', group.hostRole ?? group.role, 'role');
  // See `createPost`: the id and timestamp belong to the server, so the mock mints them, and the
  // store helper returns the array rather than the row.
  const rec = {
    id: 'mg' + Date.now(),
    createdAt: Date.now(),
    ...group,
    ownerMobile: me(),
    ownerName: group.name || u.name || '',
    modStatus: MOD_PENDING,
  };
  saveFlatmateGroup(rec);
  return groupVm(rec);
}

export async function deleteGroup(id) {
  requireUser();
  _storeDeleteGroup(id);
}

/**
 * `DELETE /flatmates/rooms/{id}`.
 *
 * The seeded rooms are not the caller's to withdraw and are not in the store at all, so a delete
 * that matches only a seed id is a 404 rather than a silent no-op — the same answer the server
 * gives for a room somebody else posted.
 */
export async function deleteRoom(id) {
  requireUser();
  const row = getRooms().find((r) => String(r.id) === String(id));
  if (!row) throw notFound('Room');
  _storeDeleteRoom(row.id);
}

export async function setGroupSeats(id, seatsOpen) {
  requireUser();
  const arr = getFlatmateGroups();
  const g = arr.find((x) => String(x.id) === String(id));
  if (!g) throw notFound('Group');
  g.seatsOpen = Math.max(0, Number(seatsOpen) || 0);
  saveFlatmateGroup(g);
  return groupVm(g);
}

/**
 * Join a group.
 *
 * **An open-policy group accepts outright.** `FlatmateRequest`'s constructor sets
 * `status = 'accepted'` and stamps `decidedAt` when the action is `join`; only a restricted group
 * leaves it pending. The mock used to always return `pending`, which is *stricter* than the server
 * — the one place that direction happened, and it would have shown "waiting for approval" for a
 * join that had already succeeded.
 */
export async function joinGroup(id, { share = 'solo', message } = {}) {
  const u = requireUser();
  requireVocab('share', share, 'share');
  const g = [...getFlatmateGroups(), ...SEED_GROUPS].find((x) => String(x.id) === String(id));
  if (!g) throw notFound('Group');
  if (digits(g.ownerMobile) && digits(g.ownerMobile) === me()) {
    throw forbidden('You cannot ask to join your own group.');
  }
  /* Seats first, exactly as `FlatmateSupplyService.join` orders it — and it is the order that
     carries the meaning. Someone who asked yesterday and comes back to a group that filled in the
     meantime should be told the group is full, not that they already asked: the second is true but
     useless, because it implies a seat is still waiting on the host. */
  if (seatsLeftOf(g) <= 0) throw conflict(CONFLICT_GROUP_FULL, 'This group is full.');
  if (hasInterest(me(), 'group', id)) throw alreadyInterested();
  addInterest(me(), 'group', id);
  const open = (g.policy || 'any') === 'any';
  const rec = addFlatmateRequest(digits(g.ownerMobile), {
    kind: 'group', targetId: id, targetTitle: g.title, locality: g.locality,
    requesterName: u.name || 'Seeker', requesterMobile: me(),
    action: 'join', share, message,
    status: open ? 'accepted' : 'pending',
    decidedAt: open ? Date.now() : null,
  });
  return requestVm(rec);
}

/**
 * Mirrors the server's two-step shape: no `otp` means "send one" and answers
 * `{ consentRecorded: false }`; an `otp` records the consent and answers `true`.
 *
 * There is no code to check here, so any non-empty `otp` is accepted — the mock's job is to make
 * the *sequence* reproducible, not to re-implement OtpService.
 *
 * > Two bugs lived in the previous version, both invisible because nothing calls this method.
 * > It read `body.mobile` where the wire says `ownerMobile`, and it called
 * > `setOwnerConsent(id, mobile, ...)` against a function whose signature is
 * > `(ownerMobile, byMobile)` — so the consent map was keyed by the digits of the *group id* and
 * > recorded the owner as the grantee, which is the record inverted. It is keyed by the owner's
 * > number now, which is what `lib/data/flatmates.js:250-253` says it is for.
 */
export async function recordOwnerConsent(id, { ownerMobile, otp } = {}) {
  requireUser();
  const mobile = digits(ownerMobile || '');
  if (mobile.length !== 10) throw badRequest('ownerMobile must be a 10-digit mobile number');
  if (!String(otp || '').trim()) return { consentRecorded: false };
  setOwnerConsent(mobile, me());
  return { consentRecorded: true };
}

/**
 * The group-less twin. The mock's storage was always keyed on (owner mobile, tenant) rather than on
 * a group, so there is nothing for it to do differently — which is the same shape V27 chose, and the
 * reason the server could adopt this flow without a new table.
 */
export async function requestOwnerConsent({ ownerMobile, otp } = {}) {
  requireUser();
  const mobile = digits(ownerMobile || '');
  if (mobile.length !== 10) throw badRequest('ownerMobile must be a 10-digit mobile number');
  if (mobile === digits(me() || '')) {
    throw badRequest('That is your own number. Consent has to come from the flat\'s owner.');
  }
  if (!String(otp || '').trim()) return { consentRecorded: false };
  setOwnerConsent(mobile, me());
  return { consentRecorded: true };
}

/* ─── Seeker posts ──────────────────────────────────────────────────────────────────────────── */

const postVm = (p) => ({
  id: p.id,
  kind: 'post',
  name: p.name || '',
  gender: p.gender || 'any',
  age: p.age == null ? null : Number(p.age),
  occupation: p.occupation || '',
  budget: Number(p.budget) || 0,
  localities: p.localities || [],
  moveIn: p.moveIn || '',
  flatPref: p.flatPref || 'any',
  roomPref: p.roomPref || 'any',
  tags: p.tags || [],
  note: p.note || '',
  verifiedContactOnly: !!p.verifiedContactOnly,
  verified: !!p.verified,
  modStatus: p.modStatus || 'live',
  publiclyVisible: isPubliclyVisible(p.modStatus),
  mobile: digits(p.mobile || ''),
  lat: p.lat == null ? null : Number(p.lat),
  lng: p.lng == null ? null : Number(p.lng),
  createdAt: p.at || p.createdAt || Date.now(),
});

export async function listPosts(filters = {}, page = 0, size = 24) {
  let rows = publicOnly([...getFlatmatePosts(), ...SEEKERS]).map(postVm);
  const gender = requireVocab('gender', filters.gender, 'gender');
  if (gender && gender !== 'any') rows = rows.filter((p) => p.gender === gender);
  const flatPref = requireVocab('flatPref', filters.flatPref, 'flatPref');
  if (flatPref && flatPref !== 'any') rows = rows.filter((p) => p.flatPref === flatPref || p.flatPref === 'any');
  const roomPref = requireVocab('roomPref', filters.roomPref, 'roomPref');
  if (roomPref) rows = rows.filter((p) => p.roomPref === roomPref);
  if (filters.locality) rows = rows.filter((p) => inLocality(p, filters.locality));
  if (filters.maxBudget) rows = rows.filter((p) => p.budget <= Number(filters.maxBudget));
  if (filters.minBudget) rows = rows.filter((p) => p.budget >= Number(filters.minBudget));
  return paginate(rows, page, size);
}

export async function createPost(body = {}) {
  requireUser();
  if (!body.name || String(body.name).trim().length < 2) throw badRequest('name must be at least 2 characters');
  if (!(Number(body.budget) > 0)) throw badRequest('budget must be positive');
  // `localities` is `@NotEmpty`: a seeker who will live anywhere is not a match for anyone.
  if (!(body.localities || []).length) throw badRequest('localities must not be empty');
  requireVocab('gender', body.gender, 'gender');
  requireVocab('flatPref', body.flatPref, 'flatPref');
  requireVocab('roomPref', body.roomPref, 'roomPref');
  // The id and the created timestamp are the SERVER's to assign, so the mock assigns them too.
  // They used to be minted at the call site (`data.id = 's' + Date.now()`), which is the one thing
  // a client must never do: two devices inside the same millisecond mint the same id, and against
  // the real API the value is discarded anyway. Moving it here is what let the call sites stop
  // caring — but a mock that then returns a row with `id: undefined` breaks every reader that
  // matches on it, which is exactly what "edit your live request" does.
  const rec = {
    id: 's' + Date.now(),
    createdAt: Date.now(),
    ...body,
    mobile: me(),
    modStatus: MOD_PENDING,
  };
  // `_storeWriteSeekerPost` (`store.saveFlatmatePost`) returns the whole ARRAY (it ends `return set(key, arr)`), not the row it
  // just added — so the record has to be built first and returned directly. Mapping its return
  // value would hand the caller a view model built from an array.
  _storeWriteSeekerPost(rec);
  return postVm(rec);
}

export async function updatePost(id, patchBody = {}) {
  requireUser();
  requireVocab('gender', patchBody.gender, 'gender');
  requireVocab('flatPref', patchBody.flatPref, 'flatPref');
  requireVocab('roomPref', patchBody.roomPref, 'roomPref');
  const rec = updateFlatmatePost(id, patchBody);
  if (!rec) throw notFound('Post');
  return postVm(rec);
}

export async function deletePost(id) {
  requireUser();
  _storeDeletePost(id);
}

export async function postInterest(id, { share = 'solo', message } = {}) {
  const u = requireUser();
  requireVocab('share', share, 'share');
  const p = [...getFlatmatePosts(), ...SEEKERS].find((x) => String(x.id) === String(id));
  if (!p) throw notFound('Post');
  if (digits(p.mobile) && digits(p.mobile) === me()) {
    throw forbidden('You cannot express interest in your own post.');
  }
  if (hasInterest(me(), 'flatmate', id)) throw alreadyInterested();
  addInterest(me(), 'flatmate', id);
  addFlatmateRequest(digits(p.mobile), {
    kind: 'post', targetId: id, targetTitle: p.name, locality: (p.localities || [])[0] || '',
    requesterName: u.name || 'Seeker', requesterMobile: me(),
    action: 'request', share, message, status: 'pending',
  });
}

/* ─── Requests ──────────────────────────────────────────────────────────────────────────────── */

const requestVm = (r) => {
  /* `addFlatmateRequest` overloads its return: a record, or the strings `'anon'` (no host mobile to
     file under) / `'duplicate'`. Mapped naively every `r?.x` yields undefined and this returns a
     shape-valid but empty view model — an ask that looks filed and is not. Say null instead. */
  if (!r || typeof r === 'string') return null;
  const status = r?.status || 'pending';
  return {
    id: r?.id || '',
    kind: r?.kind || 'room',
    action: r?.action || 'request',
    share: r?.share || 'solo',
    targetId: r?.targetId || '',
    targetTitle: r?.targetTitle || '',
    locality: r?.locality || '',
    requesterName: r?.requesterName || '',
    requesterMobile: digits(r?.requesterMobile || ''),
    message: r?.message || '',
    status,
    awaitingDecision: status === 'pending',
    requestedAt: r?.requestedAt || r?.at || Date.now(),
    decidedAt: r?.decidedAt || null,
  };
};

/** Host-scoped: the signed-in user's inbox, never one named by the caller. */
export async function myRequests(status) {
  const mine = me();
  if (!mine) return [];
  let rows = (getFlatmateRequests(mine) || []).map(requestVm).filter(Boolean);
  if (status) rows = rows.filter((r) => r.status === status);
  return rows;
}

/** Caller-scoped sent-interest outbox, mirroring `GET /me/flatmate-interests`. */
export async function myFlatmateInterests() {
  const mine = me();
  return mine ? getMyInterests(mine) : [];
}

export async function decideRequest(id, decision) {
  const mine = me();
  requireUser();
  if (!['accepted', 'declined'].includes(decision)) {
    throw badRequest(`Unknown decision: '${decision}'. Expected one of accepted, declined.`);
  }
  const rec = decideFlatmateRequest(mine, id, decision);
  if (!rec) throw notFound('Request');
  return requestVm(rec);
}

/* ─── Flat split ────────────────────────────────────────────────────────────────────────────── */

export async function propertyRooms(propertyId) {
  const seen = verdicts();
  return (roomsForProperty(propertyId) || []).map((r) => roomVm(r, seen));
}

/**
 * `POST /properties/{id}/split`.
 *
 * Every refusal the server states is stated here too, with the server's own status and code. That
 * matters more than it looks: this used to hand `splitFlat` a stub listing (`{ id, deal: 'rent' }`)
 * and return `roomsForProperty` regardless of the outcome, so a refused split answered 200 with a
 * plausible-looking body. The screens that now call this decide what to tell the owner from the
 * error, and one that never arrives is one they cannot report.
 *
 * The real listing is looked up rather than stubbed for the same reason: `splitFlat` derives the
 * rooms' bhk, society, locality and furnishing from the parent, and decides the owner badge from
 * whether Ops has approved it. A stub parent produced rooms with no address and no badge, always.
 */
export async function splitProperty(propertyId, { maxOccupants, rooms } = {}) {
  const u = requireUser();
  if (!(rooms || []).length) throw badRequest('rooms must not be empty');
  (rooms || []).forEach((r) => requireVocab('roomKind', r.roomKind, 'roomKind'));

  const parent = (getListings() || []).find((l) => String(l.id) === String(propertyId));
  if (!parent) throw notFound('Property');

  const res = splitFlat(parent, {
    maxOccupants: Number(maxOccupants) || 1,
    rooms,
    ownerMobile: me(),
    ownerName: u.name || '',
  });
  if (!res.ok) throw splitRefusal(res);

  const seen = verdicts();
  return {
    rooms: (roomsForProperty(propertyId) || []).map((r) => roomVm(r, seen)),
    propertyId,
  };
}

/** Map `splitFlat`'s refusal reasons onto the statuses `FlatSplitService` answers with. */
function splitRefusal(res) {
  switch (res.reason) {
    case 'notOwner':
      return forbidden("Only the listing's owner can let it room by room. (not_owner)");
    case 'notSplittable':
      return conflict('not_splittable', 'Only a rent listing can be let room by room.');
    case 'alreadySplit':
      return conflict('already_split', 'This flat is already let room by room.');
    case 'guard':
      return forbidden(res.message || 'This host cannot list more supply right now.');
    default:
      // tooManyRooms / capOutOfRange / missingRent / noRooms — all 400s server-side.
      return badRequest(res.message || `This room set does not fit the flat. (${res.reason})`);
  }
}

/**
 * `DELETE /properties/{id}/split`.
 *
 * Refused once anyone has moved in: those rooms hold a live tenancy, and withdrawing them would
 * erase it. The 409 is the product rule, so it is raised rather than swallowed.
 */
export async function unsplitProperty(propertyId) {
  requireUser();
  if (!isFlatSplit(propertyId)) throw notFound('Split');
  const res = unsplitFlat(propertyId);
  if (res && res.ok === false) {
    throw conflict('occupied',
      'Someone has already moved in, so this flat cannot stop being let room by room.');
  }
}

/* ─── Feed ──────────────────────────────────────────────────────────────────────────────────── */

/** The interleaved feed: rooms for "move in", posts + groups for "team up". */
export async function feed(tab = 'move-in', filters = {}, page = 0, size = 24) {
  requireVocab('tab', tab, 'tab');
  if (tab === 'team-up') {
    const [posts, groups] = await Promise.all([
      listPosts(filters, 0, 500),
      listGroups(filters, 0, 500),
    ]);
    const merged = [...posts.items, ...groups.items].sort((a, b) => b.createdAt - a.createdAt);
    return paginate(merged, page, size);
  }
  const rooms = await listRooms(filters, 0, 500);
  return paginate(rooms.items, page, size);
}

/* ─── Ops: verification, moderation, group applications ─────────────────────────────────────── */
/*
 * Six stubs, and they throw rather than pretend.
 *
 * The ops flatmate desk is **live-only**. There was never a mock behind it worth keeping: the old
 * page read a localStorage review store the consumer flow wrote into, which could model the
 * verification queue's happy path and nothing else — no moderation axis at all, no group
 * applications, no `flatmates:read`/`flatmates:write` split, and no way to be wrong in the ways
 * that matter. Reproducing the real queues here would mean writing their behaviour twice and
 * discovering the disagreements in production.
 *
 * Returning empty pages instead would be worse than throwing. An empty queue is a *meaningful*
 * answer on a moderation desk — it means the backlog is clear — so a mock that always said it would
 * be indistinguishable from a working desk with nothing to do, which is precisely the state D72
 * warns about ("moderated before public" quietly becoming "never public").
 *
 * The page therefore checks `isHttpDomain('flatmate')` and renders an explanatory panel, so in
 * practice these are never reached. They exist so that a caller which forgets the check fails
 * loudly and legibly rather than with a bare `undefined is not a function`.
 */

const LIVE_ONLY = 'The flatmate ops queues are live-only — there is no mock behind them.';
const liveOnly = () => {
  throw new ApiError({ code: 'not_implemented', message: LIVE_ONLY, status: 501 });
};

export async function listFlatmateReviews() { return liveOnly(); }
export async function decideFlatmateReview() { return liveOnly(); }
export async function listFlatmateModeration() { return liveOnly(); }
export async function moderateFlatmatePost() { return liveOnly(); }
export async function listGroupApplications() { return liveOnly(); }
export async function moderateGroupApplication() { return liveOnly(); }

/* ─── Group applications: the consumer ends ─────────────────────────────────────────────────── */
/*
 * These three are NOT live-only, and the difference from the six above is the audience.
 *
 * The ops board is a desk nobody uses in mock mode. The owner inbox is a panel on the consumer
 * dashboard, next to four others that still work — throwing there would blank a screen the mock is
 * meant to demo, to make a point about a queue the demo user is not looking at.
 *
 * This is the old `lib/groupApplications.js` store moved behind the seam, unchanged in behaviour
 * and deliberately unimproved: no owner scoping (the mock has no notion of which listings are
 * yours), no moderation filter, no duplicate check. It dies with the rest of the mock at P5c.
 *
 * The one thing that did change is `at`. The old store held display strings ("4 hours ago"), which
 * the Action Center could not sort by and so special-cased with an `atText` field. Epoch
 * milliseconds match what the live mapper returns, which is what let that special case go.
 */

const APPS_KEY = 'puneNestGroupApplications';
const HOUR = 3600 * 1000;
const APPS_SEED = [
  {
    id: 'A-seed1', listingId: 'P-seed1', listingTitle: '2 BHK Flat in Baner', locality: 'Baner',
    rent: 34000, perHead: 17000, groupTitle: '2 girls → 1 more for a 2BHK in Baner',
    applicantName: 'Riya', members: 2, seatsTotal: 3, status: 'pending', modStatus: 'live',
    at: () => Date.now() - 4 * HOUR,
  },
  {
    id: 'A-seed2', listingId: 'P-seed2', listingTitle: '3 BHK Flat in Hinjawadi',
    locality: 'Hinjawadi', rent: 42000, perHead: 14000,
    groupTitle: '3 engineers for a 3BHK near IT park',
    applicantName: 'Aditya', members: 2, seatsTotal: 3, status: 'pending', modStatus: 'live',
    at: () => Date.now() - 24 * HOUR,
  },
];

function readApps() {
  let stored = [];
  try {
    stored = JSON.parse(localStorage.getItem(APPS_KEY)) || [];
  } catch {
    stored = [];
  }
  const ids = new Set(stored.map((a) => a.id));
  const seeds = APPS_SEED.filter((a) => !ids.has(a.id)).map((a) => ({ ...a, at: a.at() }));
  return stored.concat(seeds).sort((a, b) => (b.at || 0) - (a.at || 0));
}

function writeApp(row) {
  let stored = [];
  try {
    stored = JSON.parse(localStorage.getItem(APPS_KEY)) || [];
  } catch {
    stored = [];
  }
  const at = stored.findIndex((x) => x.id === row.id);
  if (at >= 0) stored[at] = row; else stored.unshift(row);
  localStorage.setItem(APPS_KEY, JSON.stringify(stored));
  return row;
}

/** The caller's own seeker posts, including rows not visible on the public feed. */
export async function myFlatmatePosts({ page = 0, size = 20 } = {}) {
  const mine = me();
  const rows = mine
    ? getFlatmatePosts().filter((post) => digits(post.mobile).slice(-10) === mine).map(postVm)
    : [];
  return paginate(rows, page, size);
}

/**
 * `GET /me/flatmate-groups` — the caller's own groups.
 *
 * The mock's groups do carry `ownerMobile` (the live feed's card projection does not), so here it
 * really is a filter over the public list.
 */
export async function myFlatmateGroups({ page = 0, size = 20 } = {}) {
  const mine = digits(myMobile()).slice(-10);
  const all = (await listGroups({}, 0, 500)).items;
  return paginate(mine ? all.filter((g) => digits(g.ownerMobile).slice(-10) === mine) : [], page, size);
}

/**
 * `GET /me/flatmate-rooms`.
 *
 * Reads the store directly rather than filtering `listRooms`, because that read applies the public
 * approved-only floor and this one must not: the whole point of the route is that a host can see
 * their own pending or rejected room. Seeded rooms are excluded — they are nobody's.
 */
export async function myFlatmateRooms({ page = 0, size = 20 } = {}) {
  const mine = digits(myMobile()).slice(-10);
  if (!mine) return paginate([], page, size);
  const seen = verdicts();
  const rows = getRooms()
    .filter((r) => digits(r.ownerMobile).slice(-10) === mine)
    .map((r) => roomVm(r, seen));
  return paginate(rows, page, size);
}

/* ─── Shortlist ─────────────────────────────────────────────────────────────────────────────── */
/*
 * `puneNestFlatmateSaved` is still the store, but it is no longer the *shape*. It used to hold the
 * rendered card — title, locality, price, photo — copied in at the moment of the tap, which is why
 * a saved room went on advertising a rent its host had since changed. Here the value is the key
 * alone and the card is looked up on read, so this mock answers the same thing the server does and
 * the two halves of the seam can be swapped without the Saved page noticing.
 *
 * The key format `r:|g:|s:` is kept because a browser that already has the old map should not lose
 * its shortlist on upgrade: the prefix carries the kind and the remainder carries the id, so a
 * legacy entry — whose value is a card rather than a key — still reads correctly.
 */

const SAVED_KEY = 'puneNestFlatmateSaved';
const KIND_BY_PREFIX = { r: 'room', g: 'group', s: 'post' };
const PREFIX_BY_KIND = { room: 'r', group: 'g', post: 's' };

const readSavedMap = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
};

const writeSavedMap = (map) => {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(map)); } catch { /* quota */ }
};

/* A stored key back into `{ kind, id }`. Returns null for anything that does not parse, so one bad
   entry costs its own row rather than the whole shortlist. */
const toSaveKey = (storageKey) => {
  const kind = KIND_BY_PREFIX[String(storageKey).slice(0, 1)];
  const id = String(storageKey).slice(2);
  return kind && id ? { kind, id } : null;
};

const requireKind = (kind) => {
  if (!PREFIX_BY_KIND[kind]) throw badRequest('kind must be one of room, group, post');
  return kind;
};

/* Newest save first, like the server's `order by created_at desc`. Legacy entries carry no `at`,
   so they sort last — they are by definition the oldest thing in the map. */
const savedKeysNewestFirst = () => Object.entries(readSavedMap())
  .map(([storageKey, value]) => {
    const key = toSaveKey(storageKey);
    return key ? { ...key, at: Number(value?.at) || 0 } : null;
  })
  .filter(Boolean)
  .sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1));

/** `GET /me/flatmate-saves/keys` — `[{ kind, id }]`. */
export async function listFlatmateSaveKeys() {
  if (!readUser()) return [];
  return savedKeysNewestFirst().map(({ kind, id }) => ({ kind, id }));
}

/**
 * `GET /me/flatmate-saves` — the shortlist as cards, joined on read.
 *
 * A save whose target has since gone drops out of `items` while `total` still counts it, which is
 * the contract the server states: a shortlist may be one card shorter than its count, and must
 * never be a card that renders nothing.
 */
export async function listFlatmateSaves({ page = 0, size = 500 } = {}) {
  if (!readUser()) return paginate([], page, size);
  const seen = verdicts();
  const rooms = [...getRooms(), ...SEED_ROOMS];
  const groups = [...getFlatmateGroups(), ...SEED_GROUPS];
  const posts = [...getFlatmatePosts(), ...SEEKERS];
  const find = (rows, id) => rows.find((row) => String(row.id) === String(id));

  const keys = savedKeysNewestFirst();
  const window = keys.slice(page * size, page * size + size);
  const items = window.map(({ kind, id }) => {
    if (kind === 'room') { const row = find(rooms, id); return row ? roomVm(row, seen) : null; }
    if (kind === 'group') { const row = find(groups, id); return row ? groupVm(row, seen) : null; }
    const row = find(posts, id);
    return row ? postVm(row) : null;
  }).filter(Boolean);

  return { items, page, size, total: keys.length };
}

/** `PUT /me/flatmate-saves/{kind}/{id}` — idempotent. */
export async function saveFlatmatePost(kind, id) {
  requireUser();
  const map = readSavedMap();
  map[PREFIX_BY_KIND[requireKind(kind)] + ':' + id] = { kind, id, at: Date.now() };
  writeSavedMap(map);
}

/** `DELETE /me/flatmate-saves/{kind}/{id}` — idempotent, no error when it was not there. */
export async function unsaveFlatmatePost(kind, id) {
  requireUser();
  const map = readSavedMap();
  delete map[PREFIX_BY_KIND[requireKind(kind)] + ':' + id];
  writeSavedMap(map);
}

/** `POST /flatmates/groups/{id}/apply`. */export async function applyGroupToListing(groupId, listingId) {
  const group = (await listGroups({}, 0, 500)).items.find((g) => g.id === groupId);
  if (!group) throw new ApiError({ code: 'not_found', message: 'Flatmate group not found.', status: 404 });
  if (readApps().some((a) => a.groupId === groupId && a.listingId === listingId)) {
    throw new ApiError({
      code: 'conflict',
      message: 'Your group has already applied to this flat — the owner has it.',
      status: 409,
    });
  }
  const seats = group.seatsTotal || 0;
  return writeApp({
    id: 'A-' + Date.now().toString(36),
    listingId,
    listingTitle: group.society || 'A flat',
    locality: group.locality || '',
    rent: group.rent || null,
    perHead: group.rent && seats > 0 ? Math.round(group.rent / seats) : group.rent || null,
    groupTitle: group.title || 'Flatmate group',
    groupId,
    applicantName: readUser()?.name || 'You',
    members: group.members?.length || 0,
    seatsTotal: seats,
    status: 'pending',
    modStatus: 'live',
    at: Date.now(),
  });
}

/** `GET /me/group-applications`. */
export async function listMyGroupApplications({ page = 0, size = 20 } = {}) {
  return paginate(readApps(), page, size);
}

/** `PATCH /me/group-applications/{id}`. */
export async function decideGroupApplication(id, status) {
  const row = readApps().find((a) => a.id === id);
  if (!row) throw new ApiError({ code: 'not_found', message: 'Group application not found.', status: 404 });
  if (row.status !== 'pending') {
    throw new ApiError({
      code: 'conflict', message: 'You have already answered this application.', status: 409,
    });
  }
  return writeApp({ ...row, status });
}
