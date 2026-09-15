/**
 * HTTP flatmate provider: rooms, groups, seeker posts, requests, splits, feed, applications.
 * List reads are public so a signed-out visitor can browse; `/me` routes short-circuit unauthenticated.
 */
import { del, get, patch, post, put, unwrapPage, unwrapFullPage } from '../../http.js';
// Leaf module, deliberately not re-exported through `http.js`, so this import stays cycle-free.
import { MAX_PAGE_SIZE } from '../../apiLimits.js';
import { readAccessToken } from '../../../lib/auth.js';
import {
  conflictSubCode,
  CONFLICT_MARKER,
  toGroupViewModel,
  toRequestViewModel,
  toRoomViewModel,
  toSeekerPostViewModel,
  vocab,
} from './flatmateMapper.js';
import {
  toGroupApplicationViewModel,
  toModerationRowViewModel,
  toReviewViewModel,
  toViewModelPage,
} from './flatmateModerationMapper.js';

const signedIn = () => !!readAccessToken();
const toList = (rows, fn) => (Array.isArray(rows) ? rows : []).map(fn);

/**
 * Every conflict here arrives as `error: "conflict"`, so lift the reason marker onto `code` to let
 * call sites tell a benign repeat from a real refusal; strip it so the message stays user-readable.
 */
async function withConflictCode(run) {
  try {
    return await run();
  } catch (err) {
    const sub = conflictSubCode(err);
    if (sub) {
      err.code = sub;
      err.message = String(err.message || '').replace(CONFLICT_MARKER, '');
    }
    throw err;
  }
}

/** Drop `undefined` so an absent filter is not sent as the string "undefined". */
const clean = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== ''));

/*
 * Facets the API accepts are normalised and paged server-side; unknown values drop out so a stray
 * casing widens the search. Board-only facets filter in-browser — see `tasks/DECISIONS-NEEDED.md`.
 */

/* ─── Rooms (the "Move in" tab) ─────────────────────────────────────────────────────────────── */

/** `GET /flatmates/rooms` — rooms available in someone's flat. Public; server-side facets only. */
export async function listRooms(filters = {}, page = 0, size = 24) {
  const res = await get('/flatmates/rooms', clean({
    locality: filters.locality,
    gender: vocab('gender', filters.gender),
    food: vocab('food', filters.food),
    roomType: vocab('roomType', filters.roomType),
    furnishing: vocab('furnishing', filters.furnishing),
    bhk: vocab('bhk', filters.bhk),
    minBudget: filters.minBudget,
    maxBudget: filters.maxBudget,
    // `false` is not a filter — only send the flag when it is on, or every unfiltered read would
    // carry `verifiedOnly=false` and invite the server to grow a meaning for it.
    verifiedOnly: filters.verifiedOnly ? true : undefined,
    page,
    size,
  }));
  const paged = unwrapPage(res, { page, size });
  return { ...paged, items: paged.items.map(toRoomViewModel) };
}

/**
 * `POST /flatmates/rooms` — advertise a room. `photos` is `@NotEmpty` server-side (pictureless
 * rooms are the shape of broker spam), so that refusal surfaces as a validation error.
 */
export async function createRoom(room = {}) {
  return toRoomViewModel(await post('/flatmates/rooms', clean({
    bhk: vocab('bhk', room.bhk),
    roomType: room.roomType,
    attachedBath: vocab('attachedBath', room.attachedBath),
    furnishing: vocab('furnishing', room.furnishing),
    locality: room.locality,
    societyId: room.societyId,
    society: room.society,
    flatNumber: room.flatNumber,
    rentShare: Number(room.rent ?? room.rentShare) || 0,
    deposit: room.deposit == null ? undefined : Number(room.deposit),
    availableFrom: room.availableFrom,
    lookingFor: vocab('gender', room.lookingFor),
    foodPref: vocab('food', room.foodPref),
    lifestyle: room.lifestyle || room.tags,
    hostRole: vocab('hostRole', room.hostRole),
    agreementDeclared: room.agreementDeclared,
    agreementDoc: room.agreementDoc,
    ownerConsentMobile: room.ownerConsentMobile,
    photos: room.photos || [],
    note: room.note,
    lat: room.lat,
    lng: room.lng,
  })));
}

/** `PATCH /flatmates/rooms/{id}/seats` — how many seats the host is still offering. */
export async function setRoomSeats(id, seatsOpen) {
  return toRoomViewModel(await patch(`/flatmates/rooms/${encodeURIComponent(id)}/seats`, {
    seatsOpen: Math.max(0, Number(seatsOpen) || 0),
  }));
}

/**
 * `PATCH /flatmates/rooms/{id}/occupants` — how many people actually live there. Distinct from
 * seats: occupants is a fact about the flat, seats an intention about letting.
 */
export async function setRoomOccupants(id, occupants) {
  return toRoomViewModel(await patch(`/flatmates/rooms/${encodeURIComponent(id)}/occupants`, {
    occupants: Math.max(0, Number(occupants) || 0),
  }));
}

/**
 * `POST /flatmates/rooms/{id}/interest` — ask to take the room, creating a `pending` request.
 * `share` (solo | bring | match) changes the conversation; a repeat press is refused, not doubled.
 */
export async function roomInterest(id, { share = 'solo', message } = {}) {
  await withConflictCode(() => post(`/flatmates/rooms/${encodeURIComponent(id)}/interest`, clean({
    share: vocab('share', share) || 'solo',
    message,
  })));
}

/** `POST /flatmates/rooms/{id}/agreement/reissue` — re-request the rental agreement evidence. */
export async function reissueRoomAgreement(id) {
  await post(`/flatmates/rooms/${encodeURIComponent(id)}/agreement/reissue`, {});
}

/* ─── Groups (half the "Team up" tab) ───────────────────────────────────────────────────────── */

/** `GET /flatmates/groups` — formed groups with seats to fill. **Public.** Facets filter server-side. */
export async function listGroups(filters = {}, page = 0, size = 24) {
  const res = await get('/flatmates/groups', clean({
    locality: filters.locality,
    policy: vocab('policy', filters.policy),
    minRent: filters.minRent,
    maxRent: filters.maxRent,
    verifiedOnly: filters.verifiedOnly ? true : undefined,
    page,
    size,
  }));
  const paged = unwrapPage(res, { page, size });
  return { ...paged, items: paged.items.map(toGroupViewModel) };
}

/** `POST /flatmates/groups` — form a group. */
export async function createGroup(group = {}) {
  return toGroupViewModel(await post('/flatmates/groups', clean({
    title: group.title,
    locality: group.locality,
    policy: vocab('policy', group.policy),
    rent: Number(group.rent) || 0,
    seats: group.seatsTotal == null ? undefined : Number(group.seatsTotal),
    seatsOpen: group.seatsOpen == null ? undefined : Number(group.seatsOpen),
    /* The *host's* display name, which the wire calls `name` and the page does not — `submitGroup`
       carries the host as `ownerName`, so reading `group.name` alone sent nothing and every create
       came back 422 `name: must not be blank`. `||` not `??`: a read-side group carries
       `ownerName: ''` when the server omits it, and an empty string is not a name. */
    name: group.name || group.ownerName || group.members?.[0]?.name,
    role: vocab('hostRole', group.hostRole ?? group.role),
    propertyId: group.propertyId,
    agreement: group.agreementDeclared ?? group.agreement,
    agreementDoc: group.agreementDoc,
    consentMobile: group.ownerConsentMobile ?? group.consentMobile,
    tags: group.tags,
    note: group.note,
  })));
}

/** `DELETE /flatmates/groups/{id}` — the host withdraws it. */
export async function deleteGroup(id) {
  await del(`/flatmates/groups/${encodeURIComponent(id)}`);
}

/**
 * `DELETE /flatmates/rooms/{id}` — the host withdraws it (a soft archive, not "seats closed").
 * A `409` means the room belongs to a flat split and can only come down via `unsplitProperty`.
 */
export async function deleteRoom(id) {
  await del(`/flatmates/rooms/${encodeURIComponent(id)}`);
}

/** `PATCH /flatmates/groups/{id}/seats`. */
export async function setGroupSeats(id, seatsOpen) {
  return toGroupViewModel(await patch(`/flatmates/groups/${encodeURIComponent(id)}/seats`, {
    seatsOpen: Math.max(0, Number(seatsOpen) || 0),
  }));
}

/**
 * `POST /flatmates/groups/{id}/join` — returns a request whose `status` depends on group policy,
 * so callers must read it. Two 409s (`group_full`, `already_interested`) are lifted onto `code`.
 */
export async function joinGroup(id, { share = 'solo', message } = {}) {
  return toRequestViewModel(await withConflictCode(() => post(`/flatmates/groups/${encodeURIComponent(id)}/join`, clean({
    share: vocab('share', share) || 'solo',
    message,
  }))));
}

/**
 * `POST /flatmates/groups/{id}/owner-consent` — the anti-broker guardrail. Two calls on one route:
 * omit `otp` to send the owner a code, resend it to record consent (`{ consentRecorded }`).
 */
export async function recordOwnerConsent(id, { ownerMobile, otp } = {}) {
  const res = await post(`/flatmates/groups/${encodeURIComponent(id)}/owner-consent`, clean({
    ownerMobile,
    otp,
  }));
  return { consentRecorded: !!res?.consentRecorded };
}

/**
 * `POST /flatmates/owner-consent` — the group-less twin, for consent taken while the group form is
 * still open; the row lands with a null `group_id` and is read back at submit time.
 */
export async function requestOwnerConsent({ ownerMobile, otp } = {}) {
  const res = await post('/flatmates/owner-consent', clean({ ownerMobile, otp }));
  return { consentRecorded: !!res?.consentRecorded };
}

/* ─── Seeker posts (the other half of "Team up") ────────────────────────────────────────────── */

/** `GET /flatmates/posts` — people looking for a flat. **Public.** Facets filter server-side. */
export async function listPosts(filters = {}, page = 0, size = 24) {
  const res = await get('/flatmates/posts', clean({
    locality: filters.locality,
    gender: vocab('gender', filters.gender),
    flatPref: vocab('flatPref', filters.flatPref),
    roomPref: vocab('roomPref', filters.roomPref),
    minBudget: filters.minBudget,
    maxBudget: filters.maxBudget,
    page,
    size,
  }));
  const paged = unwrapPage(res, { page, size });
  return { ...paged, items: paged.items.map(toSeekerPostViewModel) };
}

/** `POST /flatmates/posts` — advertise yourself as looking. `localities` is `@NotEmpty`. */
export async function createPost(postBody = {}) {
  return toSeekerPostViewModel(await post('/flatmates/posts', clean({
    name: postBody.name,
    gender: vocab('gender', postBody.gender),
    age: postBody.age == null ? undefined : Number(postBody.age),
    occupation: postBody.occupation,
    budget: Number(postBody.budget) || 0,
    localities: postBody.localities || [],
    moveIn: postBody.moveIn,
    flatPref: vocab('flatPref', postBody.flatPref),
    roomPref: vocab('roomPref', postBody.roomPref),
    tags: postBody.tags,
    note: postBody.note,
    verifiedContactOnly: postBody.verifiedContactOnly,
  })));
}

/** `PATCH /flatmates/posts/{id}` — partial by design: send only what changed. */
export async function updatePost(id, patchBody = {}) {
  const body = {};
  ['name', 'occupation', 'moveIn', 'note'].forEach((k) => {
    if (patchBody[k] !== undefined) body[k] = patchBody[k];
  });
  if (patchBody.gender !== undefined) body.gender = vocab('gender', patchBody.gender);
  if (patchBody.flatPref !== undefined) body.flatPref = vocab('flatPref', patchBody.flatPref);
  if (patchBody.roomPref !== undefined) body.roomPref = vocab('roomPref', patchBody.roomPref);
  if (patchBody.budget !== undefined) body.budget = Number(patchBody.budget) || 0;
  if (patchBody.age !== undefined) body.age = Number(patchBody.age);
  if (patchBody.localities !== undefined) body.localities = patchBody.localities;
  if (patchBody.tags !== undefined) body.tags = patchBody.tags;
  if (patchBody.verifiedContactOnly !== undefined) body.verifiedContactOnly = patchBody.verifiedContactOnly;
  return toSeekerPostViewModel(await patch(`/flatmates/posts/${encodeURIComponent(id)}`, body));
}

/** `DELETE /flatmates/posts/{id}`. */
export async function deletePost(id) {
  await del(`/flatmates/posts/${encodeURIComponent(id)}`);
}

/** `POST /flatmates/posts/{id}/interest` — reach out to a seeker. Repeat asks 409. */
export async function postInterest(id, { share = 'solo', message } = {}) {
  await withConflictCode(() => post(`/flatmates/posts/${encodeURIComponent(id)}/interest`, clean({
    share: vocab('share', share) || 'solo',
    message,
  })));
}

/* ─── Requests (the host's inbox) ───────────────────────────────────────────────────────────── */

/**
 * `GET /me/flatmate-requests` — the caller's own host inbox, pending and accepted alike.
 * `size` is asked for explicitly because `awaitingDecision` counts across the whole list.
 */
export async function myRequests(status) {
  if (!signedIn()) return [];
  const res = await get('/me/flatmate-requests', clean({ status, size: MAX_PAGE_SIZE }));
  return unwrapFullPage(res, 'flatmate').map(toRequestViewModel);
}

/** `GET /me/flatmate-interests` — caller-scoped sent-interest outbox. */
export async function myFlatmateInterests() {
  if (!signedIn()) return [];
  const res = await get('/me/flatmate-interests', { size: MAX_PAGE_SIZE });
  return unwrapFullPage(res, 'flatmate');
}

/** `PATCH /me/flatmate-requests/{id}` — accept or decline. Host only. */
export async function decideRequest(id, decision) {
  return toRequestViewModel(
    await patch(`/me/flatmate-requests/${encodeURIComponent(id)}`, { decision }),
  );
}
/** `GET /me/flatmate-posts` — the caller's own seeker posts, moderation state included. */
export async function myFlatmatePosts({ page = 0, size = 20 } = {}) {
  const res = await get('/me/flatmate-posts', clean({ page, size }));
  const paged = unwrapPage(res, { page, size });
  return { ...paged, items: paged.items.map(toSeekerPostViewModel) };
}


/* ─── Flat split (a whole rent listing carved into rooms) ───────────────────────────────────── */

/** `GET /properties/{id}/rooms` — the rooms a listing has been split into. Public. */
export async function propertyRooms(propertyId) {
  return toList(await get(`/properties/${encodeURIComponent(propertyId)}/rooms`), toRoomViewModel);
}

/**
 * `POST /properties/{id}/split` — carve a live rent listing into per-room supply. The rooms inherit
 * the listing's `propertyId`, which makes them owner-verified without a second verification.
 */
export async function splitProperty(propertyId, { maxOccupants, rooms } = {}) {
  const res = await post(`/properties/${encodeURIComponent(propertyId)}/split`, {
    maxOccupants: Number(maxOccupants) || 1,
    rooms: (rooms || []).map((r) => clean({
      roomKind: vocab('roomKind', r.roomKind) || 'bedroom',
      rent: Number(r.rent) || 0,
      deposit: r.deposit == null ? undefined : Number(r.deposit),
      note: r.note,
    })),
  });
  return { rooms: toList(res?.rooms, toRoomViewModel), propertyId };
}

/** `DELETE /properties/{id}/split` — undo it, returning the flat to whole-flat supply. */
export async function unsplitProperty(propertyId) {
  await del(`/properties/${encodeURIComponent(propertyId)}/split`);
}

/* ─── Feed ──────────────────────────────────────────────────────────────────────────────────── */

/**
 * `GET /flatmates/feed` — a mixed page discriminated by row shape, not a type field.
 * `tab` is the current vocabulary; the legacy `view=` form is only translated, never sent.
 */
export async function feed(tab = 'move-in', filters = {}, page = 0, size = 24) {
  const res = await get('/flatmates/feed', clean({
    tab: vocab('tab', tab) || 'move-in',
    locality: filters.locality,
    page,
    size,
  }));
  // Rooms carry `roomType`, groups carry `members`, posts carry `budget` with no room fields.
  const { items, ...rest } = unwrapPage(res, { page, size });
  return {
    items: items.map((r) => {
      if (r?.roomType || r?.roomKind) return toRoomViewModel(r);
      if (r?.members || r?.seatsTotal != null) return toGroupViewModel(r);
      return toSeekerPostViewModel(r);
    }),
    ...rest,
  };
}

/* ─── Shortlist ─────────────────────────────────────────────────────────────────────────────── */
// Full cards so Saved renders today's row; the board already holds cards, so it reads `/keys`.

/** `GET /me/flatmate-saves` — the shortlist as cards, newest save first. Signed-out reads empty. */
export async function listFlatmateSaves({ page = 0, size = MAX_PAGE_SIZE } = {}) {
  if (!signedIn()) return { items: [], page: 0, size, total: 0 };
  const res = await get('/me/flatmate-saves', { page, size });
  // Heterogeneous, exactly like `/flatmates/feed` — discriminate by shape, not by a type field.
  const { items, ...rest } = unwrapPage(res, { page, size });
  return {
    items: items.map((r) => {
      if (r?.roomType || r?.roomKind) return toRoomViewModel(r);
      if (r?.members || r?.seatsTotal != null) return toGroupViewModel(r);
      return toSeekerPostViewModel(r);
    }),
    ...rest,
  };
}

/** `GET /me/flatmate-saves/keys` — `[{ kind, id }]`, unpaged. Signed-out reads empty. */
export async function listFlatmateSaveKeys() {
  if (!signedIn()) return [];
  const res = await get('/me/flatmate-saves/keys');
  return Array.isArray(res) ? res.filter((r) => r?.kind && r?.id) : [];
}

/** `PUT /me/flatmate-saves/{kind}/{id}` — idempotent. 204. */
export async function saveFlatmatePost(kind, id) {
  await put(`/me/flatmate-saves/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`);
}

/** `DELETE /me/flatmate-saves/{kind}/{id}` — idempotent, 204 whether or not a row was there. */
export async function unsaveFlatmatePost(kind, id) {
  await del(`/me/flatmate-saves/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`);
}

/* ─── Ops: verification, moderation, group applications ─────────────────────────────────────── */
// `flatmates:read` guards the queues and `flatmates:write` the decisions, so show the server's 403.

/**
 * `GET /admin/flatmate-reviews` — the host-verification queue, oldest first. `status` and `flagged`
 * are server filters: a desk filtering in-browser would report a total true only of its window.
 */
export async function listFlatmateReviews({ status, flagged, page = 0, size = 20 } = {}) {
  const res = await get('/admin/flatmate-reviews', clean({
    status,
    flagged: flagged === undefined ? undefined : String(!!flagged),
    page,
    size,
  }));
  return toViewModelPage(unwrapPage(res, { page, size }), toReviewViewModel);
}

/**
 * `PATCH /admin/flatmate-reviews/{id}` — a rejection without a reason is a 400 (and a DB constraint)
 * because a host told "no" without being told why cannot fix anything; the blank check saves a trip.
 */
export async function decideFlatmateReview(id, decision, note) {
  return toReviewViewModel(
    await patch(`/admin/flatmate-reviews/${encodeURIComponent(id)}`, clean({
      decision,
      note: String(note || '').trim() || undefined,
    })),
  );
}

/**
 * `GET /admin/flatmates/moderation` — one `kind` per call: posts, rooms and groups are three tables
 * and a merged board could not report an honest total. Oldest first, so nobody starves in the queue.
 */
export async function listFlatmateModeration({ kind = 'post', modStatus, page = 0, size = 20 } = {}) {
  const res = await get('/admin/flatmates/moderation', clean({ kind, modStatus, page, size }));
  return toViewModelPage(unwrapPage(res, { page, size }), toModerationRowViewModel);
}

/**
 * `PATCH /admin/flatmates/{id}/moderation` — the server resolves the id across post/room/group and
 * answers with no body, so callers refetch the queue. `note` is internal and stays off consumer UI.
 */
export async function moderateFlatmatePost(id, modStatus, note) {
  await patch(`/admin/flatmates/${encodeURIComponent(id)}/moderation`, clean({
    modStatus,
    note: String(note || '').trim() || undefined,
  }));
}

/** `GET /admin/group-applications` — the application board, newest first. Paged. */
export async function listGroupApplications({ page = 0, size = 20 } = {}) {
  const res = await get('/admin/group-applications', clean({ page, size }));
  return toViewModelPage(unwrapPage(res, { page, size }), toGroupApplicationViewModel);
}

/**
 * `PATCH /admin/group-applications/{id}` — writes `modStatus` only: removing a spam application
 * must not decline it on the owner's behalf, and `status` stays theirs.
 */
export async function moderateGroupApplication(id, modStatus, note) {
  return toGroupApplicationViewModel(
    await patch(`/admin/group-applications/${encodeURIComponent(id)}`, clean({
      modStatus,
      note: String(note || '').trim() || undefined,
    })),
  );
}

/**
 * `GET /me/flatmate-groups` — the groups the caller started. Not derivable from `listGroups`, whose
 * public card projection carries no host identity to match against.
 */
export async function myFlatmateGroups({ page = 0, size = 20 } = {}) {
  const res = await get('/me/flatmate-groups', clean({ page, size }));
  const paged = unwrapPage(res, { page, size });
  return { ...paged, items: paged.items.map(toGroupViewModel) };
}

/**
 * `GET /me/flatmate-rooms` — the caller's own rooms, moderation state and all; `listRooms` is public
 * and hard-floored to approved. `ownerMobile` is populated: it is the caller's own number.
 */
export async function myFlatmateRooms({ page = 0, size = 20 } = {}) {
  const res = await get('/me/flatmate-rooms', clean({ page, size }));
  const paged = unwrapPage(res, { page, size });
  return { ...paged, items: paged.items.map(toRoomViewModel) };
}

/* ─── Group applications: the consumer ends ─────────────────────────────────────────────────── */
// Host applies, owner answers; all three write the owner axis (`status`), never `modStatus`.

/**
 * `POST /flatmates/groups/{id}/apply` — the group's host applies to a whole-flat rent listing.
 * Surface the server's 409 verbatim: "the owner has it" answers the host's real question.
 */
export async function applyGroupToListing(groupId, listingId) {
  return toGroupApplicationViewModel(
    await post(`/flatmates/groups/${encodeURIComponent(groupId)}/apply`, { listingId }),
  );
}

/**
 * `GET /me/group-applications` — owner-scoped by the session, so four flats give one queue rather
 * than four reads. Moderation-removed rows are filtered server-side.
 */
export async function listMyGroupApplications({ page = 0, size = 20 } = {}) {
  const res = await get('/me/group-applications', clean({ page, size }));
  return toViewModelPage(unwrapPage(res, { page, size }), toGroupApplicationViewModel);
}

/**
 * `PATCH /me/group-applications/{id}` — irreversible, and the server enforces that with a 409
 * rather than trusting a hidden button. Returns the decided row so callers re-render from truth.
 */
export async function decideGroupApplication(id, status) {
  return toGroupApplicationViewModel(
    await patch(`/me/group-applications/${encodeURIComponent(id)}`, { status }),
  );
}
