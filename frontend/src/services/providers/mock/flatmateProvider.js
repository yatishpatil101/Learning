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
import { getRooms, updateRoom } from '../../../lib/store.js';
import {
  getFlatmatePosts,
  saveFlatmatePost,
  updateFlatmatePost,
  deleteFlatmatePost as _storeDeletePost,
  getFlatmateGroups,
  saveFlatmateGroup,
  deleteFlatmateGroup as _storeDeleteGroup,
  addInterest,
  getFlatmateRequests,
  addFlatmateRequest,
  decideFlatmateRequest,
  setOwnerConsent,
} from '../../../lib/data/flatmates.js';
import {
  splitFlat,
  unsplitFlat,
  roomsForProperty,
  setRoomOccupants as _storeSetOccupants,
} from '../../../lib/data/flatSplit.js';
import { MOD_PENDING, VOCAB, initialsOf, isPubliclyVisible, perHeadOf, seatsLeftOf } from '../http/flatmateMapper.js';
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
const requireUser = () => { const u = readUser(); if (!u) throw unauthorized(); return u; };

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

/* ─── Rooms ─────────────────────────────────────────────────────────────────────────────────── */

const roomVm = (r) => ({
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
  let rows = publicOnly([...getRooms(), ...SEED_ROOMS]).map(roomVm);
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

export async function roomInterest(id, { share = 'solo', message } = {}) {
  const u = requireUser();
  requireVocab('share', share, 'share');
  const row = getRooms().find((r) => String(r.id) === String(id));
  if (!row) throw notFound('Room');
  addInterest(id);
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

const groupVm = (g) => ({
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
  let rows = publicOnly([...getFlatmateGroups(), ...SEED_GROUPS]).map(groupVm);
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
  const g = getFlatmateGroups().find((x) => String(x.id) === String(id));
  if (!g) throw notFound('Group');
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

export async function recordOwnerConsent(id, body = {}) {
  requireUser();
  const mobile = digits(body.mobile || '');
  if (mobile.length !== 10) throw badRequest('mobile must be a 10-digit mobile number');
  setOwnerConsent(id, mobile, body.consent !== false);
  return { consentRecorded: body.consent !== false };
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
  // `saveFlatmatePost` returns the whole ARRAY (it ends `return set(key, arr)`), not the row it
  // just added — so the record has to be built first and returned directly. Mapping its return
  // value would hand the caller a view model built from an array.
  saveFlatmatePost(rec);
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
  const p = getFlatmatePosts().find((x) => String(x.id) === String(id));
  if (!p) throw notFound('Post');
  addInterest(id);
  addFlatmateRequest(digits(p.mobile), {
    kind: 'post', targetId: id, targetTitle: p.name, locality: (p.localities || [])[0] || '',
    requesterName: u.name || 'Seeker', requesterMobile: me(),
    action: 'request', share, message, status: 'pending',
  });
}

/* ─── Requests ──────────────────────────────────────────────────────────────────────────────── */

const requestVm = (r) => {
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
  let rows = (getFlatmateRequests(mine) || []).map(requestVm);
  if (status) rows = rows.filter((r) => r.status === status);
  return rows;
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
  return (roomsForProperty(propertyId) || []).map(roomVm);
}

export async function splitProperty(propertyId, { maxOccupants, rooms } = {}) {
  const u = requireUser();
  if (!(rooms || []).length) throw badRequest('rooms must not be empty');
  (rooms || []).forEach((r) => requireVocab('roomKind', r.roomKind, 'roomKind'));
  const res = splitFlat({ id: propertyId, deal: 'rent' }, {
    maxOccupants: Number(maxOccupants) || 1,
    rooms,
    ownerMobile: me(),
    ownerName: u.name || '',
  });
  return { rooms: (res?.rooms || roomsForProperty(propertyId) || []).map(roomVm), propertyId };
}

export async function unsplitProperty(propertyId) {
  requireUser();
  unsplitFlat(propertyId);
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
