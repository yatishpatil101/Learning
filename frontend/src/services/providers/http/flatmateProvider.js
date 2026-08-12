/**
 * HTTP flatmate provider — the live counterpart to `providers/mock/flatmateProvider.js`.
 *
 * Twenty-three endpoints over four resources:
 *
 * ```
 *   rooms    GET/POST /flatmates/rooms · PATCH .../{id}/seats · PATCH .../{id}/occupants
 *            POST .../{id}/interest · POST .../{id}/agreement/reissue
 *   groups   GET/POST /flatmates/groups · DELETE .../{id} · PATCH .../{id}/seats
 *            POST .../{id}/join · POST .../{id}/owner-consent
 *   posts    GET/POST /flatmates/posts · PATCH/DELETE .../{id} · POST .../{id}/interest
 *   requests GET /me/flatmate-requests · PATCH .../{id}
 *   split    GET /properties/{id}/rooms · POST/DELETE /properties/{id}/split
 *   feed     GET /flatmates/feed
 * ```
 *
 * The three list reads are **public** — the Flatmates page has to render for the signed-out visitor
 * it exists to convert. Everything that names *me* (`/me/flatmate-requests`) or acts as me
 * (create, interest, join) is caller-scoped and short-circuits without a session.
 */
import { del, get, patch, post, unwrapPage, unwrapFullPage } from '../../http.js';
// Leaf module, no imports of its own — see its header, and D208. Deliberately not from `http.js`.
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

const signedIn = () => !!readAccessToken();
const toList = (rows, fn) => (Array.isArray(rows) ? rows : []).map(fn);

/**
 * Run an interest/join call, moving a 409's reason from the message onto `code`.
 *
 * Every `ConflictException` in this domain arrives as `error: "conflict"`, so the envelope alone
 * cannot distinguish "you already asked" (benign, informational) from "the last seat just went"
 * (a real refusal). The reason is a marker the service appends to the message; lifting it onto
 * `code` here is what lets a call site branch on it, and it is the same field the mock provider
 * sets, so both modes present one shape.
 *
 * The marker is also stripped from the message once lifted. It is an internal routing token, and
 * `conflictSubCode` matches *any* trailing `(word)` — so a marker this client does not yet know
 * about falls through to the generic branch, which renders `err.message` verbatim. Without the
 * strip the user reads "...no longer accepting interest (post_closed)."
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

/**
 * ## Facets are the server's job (D116)
 *
 * All three feeds filter server-side on every facet the page offers — locality, gender, food, room
 * type, furnishing, BHK, budget range, policy, flat/room preference — and page over the filtered
 * set, so `total` is the real count the caller can reach. This provider's only job is to normalise
 * each facet to the server's vocabulary and drop the ones the caller left blank; `clean` removes
 * `undefined`/`''` so an untouched filter is simply absent from the query string rather than sent as
 * the literal `"undefined"`. A value outside the vocabulary becomes `undefined` and is dropped, so a
 * stray casing widens the search rather than silently excluding everything.
 *
 * The server reads a requested `any` as "no preference" (it matches every row, including the rows
 * that themselves stated `any`), so passing it through is harmless — but there is no reason to.
 */

/* ─── Rooms (the "Move in" tab) ─────────────────────────────────────────────────────────────── */

/**
 * `GET /flatmates/rooms` — rooms available in someone's flat. **Public.**
 *
 * Every facet is filtered and paged server-side; see the note above.
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
    page,
    size,
  }));
  const paged = unwrapPage(res, { page, size });
  return { ...paged, items: paged.items.map(toRoomViewModel) };
}

/**
 * `POST /flatmates/rooms` — advertise a room.
 *
 * `photos` is `@NotEmpty`: a room with no pictures is the shape a broker spam post takes, so the
 * server refuses it outright. Surfaced as a validation error rather than smoothed over.
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
 * `PATCH /flatmates/rooms/{id}/occupants` — how many people actually live there.
 *
 * Distinct from seats, and deliberately so: occupants is a fact about the flat, seats is an
 * intention about letting. A flat can be full with seats open (someone is leaving) or half empty
 * with none (the host has stopped looking).
 */
export async function setRoomOccupants(id, occupants) {
  return toRoomViewModel(await patch(`/flatmates/rooms/${encodeURIComponent(id)}/occupants`, {
    occupants: Math.max(0, Number(occupants) || 0),
  }));
}

/**
 * `POST /flatmates/rooms/{id}/interest` — ask to take the room.
 *
 * Creates a `pending` request in the host's inbox. `share` says whether the asker comes alone
 * (`solo`), brings someone (`bring`), or wants to be paired (`match`) — it is not a formality: a
 * two-person `bring` against a one-seat room is a different conversation.
 *
 * A second press is refused with `already_interested` rather than delivered twice (D175).
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
    name: group.name,
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

/** `PATCH /flatmates/groups/{id}/seats`. */
export async function setGroupSeats(id, seatsOpen) {
  return toGroupViewModel(await patch(`/flatmates/groups/${encodeURIComponent(id)}/seats`, {
    seatsOpen: Math.max(0, Number(seatsOpen) || 0),
  }));
}

/**
 * `POST /flatmates/groups/{id}/join` — ask to join, or join outright.
 *
 * **Returns a request, and its status depends on the group's policy.** An open-policy group accepts
 * immediately (`action: 'join'` → `status: 'accepted'`, `decidedAt` stamped); a restricted one
 * lands `pending` for the host. So the caller must read `status` rather than assume either — the
 * same "the call succeeded ≠ the thing happened" shape as the payment domains, without the money.
 *
 * **Two different 409s come out of this one door.** `group_full` means the last seat went while
 * the board was on screen; `already_interested` means this is a repeat ask. They are normalised
 * onto `code` because the envelope calls both of them `conflict`.
 */
export async function joinGroup(id, { share = 'solo', message } = {}) {
  return toRequestViewModel(await withConflictCode(() => post(`/flatmates/groups/${encodeURIComponent(id)}/join`, clean({
    share: vocab('share', share) || 'solo',
    message,
  }))));
}

/**
 * `POST /flatmates/groups/{id}/owner-consent` — the flat owner acknowledges a tenant's sublet.
 *
 * The anti-broker guardrail. Answers `{ consentRecorded }` rather than the group, because consent
 * is a fact recorded *about* the group by someone who does not own the listing.
 */
export async function recordOwnerConsent(id, body = {}) {
  const res = await post(`/flatmates/groups/${encodeURIComponent(id)}/owner-consent`, clean({
    mobile: body.mobile,
    consent: body.consent !== false,
  }));
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
 * `GET /me/flatmate-requests` — requests addressed to the caller as host. Paged (D77).
 *
 * Host-scoped: the query is `findByHostId`, so this is never somebody else's inbox. Contains both
 * `pending` rows awaiting a decision and already-`accepted` joins — see `awaitingDecision`, which
 * counts across the whole list and would undercount on a partial one. `size` is therefore asked
 * for explicitly rather than left to the server's default of twenty.
 */
export async function myRequests(status) {
  if (!signedIn()) return [];
  const res = await get('/me/flatmate-requests', clean({ status, size: MAX_PAGE_SIZE }));
  return unwrapFullPage(res, 'flatmate').map(toRequestViewModel);
}

/** `PATCH /me/flatmate-requests/{id}` — accept or decline. Host only. */
export async function decideRequest(id, decision) {
  return toRequestViewModel(
    await patch(`/me/flatmate-requests/${encodeURIComponent(id)}`, { decision }),
  );
}

/* ─── Flat split (a whole rent listing carved into rooms) ───────────────────────────────────── */

/** `GET /properties/{id}/rooms` — the rooms a listing has been split into. Public. */
export async function propertyRooms(propertyId) {
  return toList(await get(`/properties/${encodeURIComponent(propertyId)}/rooms`), toRoomViewModel);
}

/**
 * `POST /properties/{id}/split` — carve a live rent listing into per-room supply.
 *
 * The rooms inherit the listing's `propertyId`, which is what makes them **owner-verified** without
 * a second verification: the flat was already proven, so the rooms in it are too.
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
 * `GET /flatmates/feed` — the interleaved feed behind a tab.
 *
 * Returns a mixed page (`PageResponse<Object>`), so each row is discriminated by shape rather than
 * by a type field. `tab` is the current vocabulary; the legacy `view=rooms|flatmates|groups` form
 * is never sent — `FlatmateVocabulary.resolveTab` exists to translate old links, not new calls.
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
