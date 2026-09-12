/** Public Flatmates discovery and caller-scoped Flatmates actions.
 * Public feeds omit authentication; write and `/me` operations require the caller session. */
import { del, get, patch, post, put, unwrapPage, unwrapFullPage } from '../../http.js';
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

/** Moves a trailing conflict marker into `error.code` and removes it from the user-facing message. */
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

/* Feed filters are normalized to server vocabulary; blank or invalid values are omitted.
  The board relies on server filtering and paging rather than filtering returned rows. */

/* ─── Rooms (the "Move in" tab) ─────────────────────────────────────────────────────────────── */

/**
 * `GET /flatmates/rooms` — rooms available in someone's flat. **Public.**
 * Every facet the API accepts is filtered and paged server-side.
 */
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
    verifiedOnly: filters.verifiedOnly ? true : undefined,
    page,
    size,
  }));
  const paged = unwrapPage(res, { page, size });
  return { ...paged, items: paged.items.map(toRoomViewModel) };
}

/**
 * `POST /flatmates/rooms` — advertise a room. `photos` is `@NotEmpty`: a pictureless room is the
 * shape broker spam takes, so the server refuses it and the validation error is surfaced as-is.
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
 * `PATCH /flatmates/rooms/{id}/occupants` — distinct from seats on purpose: occupants is a fact
 * about the flat, seats an intention about letting, and the two move independently.
 */
export async function setRoomOccupants(id, occupants) {
  return toRoomViewModel(await patch(`/flatmates/rooms/${encodeURIComponent(id)}/occupants`, {
    occupants: Math.max(0, Number(occupants) || 0),
  }));
}

/**
 * `POST /flatmates/rooms/{id}/interest` — creates a `pending` request in the host's inbox. `share`
 * (`solo`|`bring`|`match`) is load-bearing; a repeat press 409s as `already_interested`.
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
    /* The wire calls the host name `name`; form state supplies `ownerName` or the first member. */
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
 * `DELETE /flatmates/rooms/{id}` — a soft archive, not the same act as closing the last seat. 409
 * means the room belongs to a flat split and can only be taken down via `unsplitProperty`.
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
 * `POST /flatmates/groups/{id}/join` — read the returned `status`: an open group accepts outright,
 * a restricted one lands `pending`. Two 409s (`group_full`, `already_interested`) share one code.
 */
export async function joinGroup(id, { share = 'solo', message } = {}) {
  return toRequestViewModel(await withConflictCode(() => post(`/flatmates/groups/${encodeURIComponent(id)}/join`, clean({
    share: vocab('share', share) || 'solo',
    message,
  }))));
}

/** Owner-consent protocol: omit `otp` to send a code; supply it to record consent. */
export async function recordOwnerConsent(id, { ownerMobile, otp } = {}) {
  const res = await post(`/flatmates/groups/${encodeURIComponent(id)}/owner-consent`, clean({
    ownerMobile,
    otp,
  }));
  return { consentRecorded: !!res?.consentRecorded };
}

/**
 * `POST /flatmates/owner-consent` — the group-less twin, for consent taken while the group form is
 * still open. The server writes a null-`group_id` row that `POST /flatmates/groups` reads at submit.
 */
export async function requestOwnerConsent({ ownerMobile, otp } = {}) {
  const res = await post('/flatmates/owner-consent', clean({ ownerMobile, otp }));
  // Passed through, not defaulted: it is present only on the send call, and the countdown has to be
  // the gap this deployment will actually enforce.
  return {
    consentRecorded: !!res?.consentRecorded,
    resendAfterSeconds: res?.resendAfterSeconds,
  };
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
 * `GET /me/flatmate-requests` — host-scoped, so never somebody else's inbox. Asks for the full page
 * explicitly because `awaitingDecision` counts across the whole list (docs/flows/consumer/flatmates.md).
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
 * `POST /properties/{id}/split` — the rooms inherit the listing's `propertyId`, which is what makes
 * them **owner-verified** without a second verification: the flat was already proven.
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

/** `feed()` is the board's mixed, server-paged search and forwards all board facets.
 * `signal` cancels superseded reads; `verifiedTotal` is server-derived because a page cannot count it. */
export async function feed(tab = 'move-in', filters = {}, page = 0, size = 24, { signal } = {}) {
  const [minBudget, maxBudget] = budgetRange(filters.budget);
  const res = await get('/flatmates/feed', clean({
    tab: vocab('tab', tab) || 'move-in',
    q: filters.q,
    locality: filters.locality,
    ...nearParams(filters),
    minBudget,
    maxBudget,
    gender: vocab('gender', filters.gender),
    verifiedOnly: filters.verifiedOnly ? true : undefined,
    moveInDays: moveInDays(filters.moveIn),
    habits: filters.habits?.length ? filters.habits : undefined,
    attachedBath: filters.attachedBath ? 'attached' : undefined,
    sharing: filters.sharing ? Number(filters.sharing) : undefined,
    sort: filters.sort,
    ...meParams(filters.me),
    page,
    size,
  }), { auth: false, signal });
  const { items, ...rest } = unwrapPage(res, { page, size });
  return {
    items: items.map((r) => {
      if (r?.roomType || r?.roomKind) return toRoomViewModel(r);
      if (r?.members || r?.seatsTotal != null) return toGroupViewModel(r);
      return toSeekerPostViewModel(r);
    }),
    verifiedTotal: res?.verifiedElements ?? 0,
    pageCount: res?.totalPages ?? 0,
    ...rest,
  };
}

/** The board's widest budget; the upper thumb means no ceiling at this value. */
const BUDGET_MAX = 40000;

/** Drops unset budget bounds so the slider does not apply an unintended filter. */
function budgetRange(budget) {
  if (!Array.isArray(budget)) return [undefined, undefined];
  const [min, max] = budget;
  return [
    Number(min) > 0 ? Number(min) : undefined,
    Number(max) < BUDGET_MAX ? Number(max) : undefined,
  ];
}

/** Sends match facets only when the searcher has a post to match against. */
function meParams(me) {
  if (!me) return {};
  const localities = me.localities?.length ? me.localities : (me.locality ? [me.locality] : undefined);
  return clean({
    meLocalities: localities,
    meBudget: me.budget == null ? undefined : Number(me.budget),
    meGender: me.gender,
  });
}

/** Converts travel minutes to kilometres using the shared Pune city-speed assumption. */
const KM_PER_MINUTE = 0.4;

/** The radius the field shows when the user has dropped a pin but not touched the slider. */
const DEFAULT_RADIUS = 5;

/** Converts a valid `lat,lng` pin to server proximity parameters; invalid pins are omitted. */
function nearParams(filters) {
  const { near, nearRadius, nearMode } = filters;
  if (!near) return {};
  const [lat, lng] = String(near).split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return {};
  const radius = Number(nearRadius) || DEFAULT_RADIUS;
  return {
    nearLat: lat,
    nearLng: lng,
    nearRadiusKm: nearMode === 'min' ? radius * KM_PER_MINUTE : radius,
  };
}

/** Invalid values are omitted so malformed filters do not falsely empty the board.
 * Local midnights keep calendar-day distance exact. */
function moveInDays(moveIn) {
  if (!moveIn) return undefined;
  if (moveIn === 'now') return 0;
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(moveIn);
  if (!parts) return undefined;
  const target = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  if (Number.isNaN(target.getTime())) return undefined;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((target - today) / 86_400_000));
}

/* ─── Shortlist ─────────────────────────────────────────────────────────────────────────────── */
/* Saved cards stay current; the board uses `/keys` when it already has card data. */

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

/*
 * Staff-only `/admin/**` routes: `flatmates:read` for the queues, `flatmates:write` for the
 * decisions, so a 403 is ambiguous and the desk renders the server's message — docs/flows/consumer/flatmates.md
 */

/**
 * `GET /admin/flatmate-reviews` — the host-verification queue, paged oldest first. `status` and
 * `flagged` are the server's filters: a browser-side narrowing would report a total of the window.
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
 * `PATCH /admin/flatmate-reviews/{id}` — **a rejection without a reason is a 400**, enforced by the
 * server and the schema; the blank check below only saves a round trip. Approving mints the badge.
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
 * `GET /admin/flatmates/moderation` — **one `kind` per call**: posts, rooms and groups are three
 * tables, so a merged board would report a total true of one of them. Oldest first, never newest.
 */
export async function listFlatmateModeration({ kind = 'post', modStatus, page = 0, size = 20 } = {}) {
  const res = await get('/admin/flatmates/moderation', clean({ kind, modStatus, page, size }));
  return toViewModelPage(unwrapPage(res, { page, size }), toModerationRowViewModel);
}

/**
 * `PATCH /admin/flatmates/{id}/moderation` — the id may name a post, room or group; the server
 * tries each. Returns 200 with **no body**, so refetch the queue rather than re-render from an echo.
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
 * `PATCH /admin/group-applications/{id}` — writes `modStatus` **only**: removing a spam application
 * must not decline it on the owner's behalf, and the owner's `status` is theirs.
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
 * `GET /me/flatmate-groups` — not derivable from `listGroups`, whose public card projection carries
 * no host identity at all, so a client-side "mine" test would be fixed at false.
 */
export async function myFlatmateGroups({ page = 0, size = 20 } = {}) {
  const res = await get('/me/flatmate-groups', clean({ page, size }));
  const paged = unwrapPage(res, { page, size });
  return { ...paged, items: paged.items.map(toGroupViewModel) };
}

/**
 * `GET /me/flatmate-rooms` — `listRooms` is hard-floored to approved posts, so a host's pending or
 * rejected room is only visible here. Host-facing shape, so `ownerMobile` is unmasked.
 */
export async function myFlatmateRooms({ page = 0, size = 20 } = {}) {
  const res = await get('/me/flatmate-rooms', clean({ page, size }));
  const paged = unwrapPage(res, { page, size });
  return { ...paged, items: paged.items.map(toRoomViewModel) };
}

/* ─── Group applications: the consumer ends ─────────────────────────────────────────────────── */

/*
 * Three routes for two people — the group's host and the flat's owner. All write the OWNER axis
 * (`status`) and never `modStatus`; the server keeps the two on separate routes for that reason.
 */

/**
 * `POST /flatmates/groups/{id}/apply` — 409 when the group already applied; surface the server's
 * sentence verbatim, since the host wants to know their application landed, not that it repeated.
 */
export async function applyGroupToListing(groupId, listingId) {
  return toGroupApplicationViewModel(
    await post(`/flatmates/groups/${encodeURIComponent(groupId)}/apply`, { listingId }),
  );
}

/**
 * `GET /me/group-applications` — owner-scoped by the session, so an owner with four flats gets one
 * queue. Moderation-removed rows are filtered server-side.
 */
export async function listMyGroupApplications({ page = 0, size = 20 } = {}) {
  const res = await get('/me/group-applications', clean({ page, size }));
  return toViewModelPage(unwrapPage(res, { page, size }), toGroupApplicationViewModel);
}

/**
 * `PATCH /me/group-applications/{id}` — irreversible, and the server enforces it (409 on a second
 * call) rather than trusting the button to have been hidden. Returns the decided row.
 */
export async function decideGroupApplication(id, status) {
  return toGroupApplicationViewModel(
    await patch(`/me/group-applications/${encodeURIComponent(id)}`, { status }),
  );
}
