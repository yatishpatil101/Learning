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
 *   apps     POST /flatmates/groups/{id}/apply · GET/PATCH /me/group-applications
 * ```
 *
 * The three list reads are **public** — the Flatmates page has to render for the signed-out visitor
 * it exists to convert. Everything that names *me* (`/me/flatmate-requests`) or acts as me
 * (create, interest, join) is caller-scoped and short-circuits without a session.
 */
import { del, get, patch, post, put, unwrapPage, unwrapFullPage } from '../../http.js';
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
import {
  toGroupApplicationViewModel,
  toModerationRowViewModel,
  toReviewViewModel,
  toViewModelPage,
} from './flatmateModerationMapper.js';

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
 * ## Facets are the server's job, as far as the server goes (D116)
 *
 * Each feed forwards every facet the API actually accepts — locality, gender, food, room type,
 * furnishing, BHK, budget range, policy, flat/room preference, verified-only — and pages over the
 * filtered set, so `total` is the real count *for those facets*. This provider's only job is to
 * normalise each facet to the server's vocabulary and drop the ones the caller left blank; `clean`
 * removes `undefined`/`''` so an untouched filter is simply absent from the query string rather
 * than sent as the literal `"undefined"`. A value outside the vocabulary becomes `undefined` and is
 * dropped, so a stray casing widens the search rather than silently excluding everything.
 *
 * The server reads a requested `any` as "no preference" (it matches every row, including the rows
 * that themselves stated `any`), so passing it through is harmless — but there is no reason to.
 *
 * ### What this does *not* mean
 *
 * This docblock used to claim every facet *the page offers* is filtered server-side. It is not, and
 * the claim hid a real ceiling. The flatmates board calls these feeds with **no filters at all**
 * (`useFlatmates.jsx`: `listRooms({}, 0, 200)`) and filters the whole 200-row page in the browser,
 * because the facets it offers and the facets the API accepts are two overlapping sets, not one:
 * free text, move-in date, habits, attached bath, seats-per-flat and near-a-place radius have no
 * server parameter, while food, room type, furnishing, BHK and flat/room preference have no board
 * control. So `total` is the count *before* the board's own filtering, and row 201 is unreachable
 * whatever is typed. Filed rather than papered over — see `tasks/DECISIONS-NEEDED.md`.
 */

/* ─── Rooms (the "Move in" tab) ─────────────────────────────────────────────────────────────── */

/**
 * `GET /flatmates/rooms` — rooms available in someone's flat. **Public.**
 *
 * Every facet the API accepts is filtered and paged server-side; see the note above for the ones
 * it does not.
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
    /* The *host's* display name, which the wire calls `name` and the page does not. `submitGroup`
       builds its group with the host under `ownerName`, repeated as `members[0].name`, and there is
       no `name` key on it at all — so reading `group.name` alone sent nothing, `clean` dropped the
       key, and every create through the form came back 422 `name: must not be blank`. The mock
       provider stored the object whole and read the host back out of `members`, so it never needed
       the wire's name and no mock spec could see this. Prefer `||` over `??`: a read-side group
       carries `ownerName: ''` when the server omits it, and an empty string is not a name. */
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
 * `DELETE /flatmates/rooms/{id}` — the host withdraws it.
 *
 * A soft archive server-side, and deliberately not the same act as closing the last seat: a room
 * with no seats open is taken, a withdrawn room was never really on offer. `409` is not a failure
 * to retry — it means the room is part of a flat split, whose sibling rooms share one occupancy
 * ledger and one joint agreement, so it can only be taken down through `unsplitProperty`.
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
 *
 * **Two calls, one route.** Omit `otp` and the server sends a code to the owner, answering
 * `{ consentRecorded: false }`; send the code back and it records the consent, answering `true`.
 * That is the server's protocol (`FlatmateSupplyService.ownerConsent`), and it is what these
 * argument names now spell.
 *
 * > This function used to post `{ mobile, consent }`. The server's body is
 * > `OwnerConsentRequest(@NotBlank @IndianMobile String ownerMobile, String otp)`, so `ownerMobile`
 * > arrived null and **every call would have been refused at validation** — and `consent`, a
 * > client-asserted boolean, is not a field the server has or would accept. Nothing detected it
 * > because nothing calls this: `OwnerConsentModal` writes `setOwnerConsent()` straight to
 * > localStorage and never goes through the seam, so the http half has never once run. See the
 * > owner-consent entry in `tasks/todo.md`.
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
 * still open. Same two-call shape; the server writes the row with a null `group_id` and
 * `POST /flatmates/groups` reads it back at submit time.
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

/* ─── Shortlist ─────────────────────────────────────────────────────────────────────────────── */
/*
 * `GET /me/flatmate-saves` answers full cards rather than keys, so the Saved page renders what the
 * feed would render for the same row today. That is the whole point of the surface: the shortlist
 * used to live in `puneNestFlatmateSaved`, which cached the title, rent and photo at the moment of
 * the tap and went on showing them after the host changed or withdrew the post.
 *
 * Two reads because the two callers are asking different questions at different sizes. The Saved
 * page needs the cards; the flatmates board is already holding the cards and only needs to know
 * which bookmarks are filled in, so it reads `/keys`.
 */

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
 * Six staff-only routes under `/admin/**`, guarded by `hasAnyRole('STAFF','ADMIN')` **and** a
 * per-account atom: `flatmates:read` for the three queues, `flatmates:write` for the three
 * decisions. The split matters on a queue somebody is being trained on — watching the work is not
 * the same permission as doing it — so a 403 here can mean "wrong role" or "read-only account", and
 * the desk renders the server's own message rather than guessing which.
 *
 * These have **no mock counterpart**: `providers/mock/flatmateProvider.js` exports six throwing
 * stubs instead. There was never a mock ops moderation surface to preserve, and inventing one would
 * mean inventing the queue's whole behaviour twice.
 */

/**
 * `GET /admin/flatmate-reviews` — the host-verification queue. Paged, oldest first.
 *
 * `status` is `pending` | `approved` | `rejected`; `flagged` narrows to contested addresses, i.e.
 * an address a different host has already claimed. Both are the server's filters, not the client's:
 * a desk that fetched everything and filtered in the browser would report a total that is true of
 * the window and false of the queue.
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
 * `PATCH /admin/flatmate-reviews/{id}` — approve or reject a host verification.
 *
 * **A rejection without a reason is a 400**, and the database enforces it too, so the rule holds
 * whatever the write path. That is not a validation quirk to route around: a host told "no" without
 * being told why cannot fix anything. The blank check below is a courtesy that saves a round trip,
 * not the rule — the rule is the server's.
 *
 * Approving is the only path by which a tenant-tier post ever earns its badge.
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
 * `GET /admin/flatmates/moderation` — the D72 backlog. Paged, oldest first.
 *
 * **One `kind` per call**, and that is the server's design rather than a limitation to paper over:
 * posts, rooms and groups are three tables, and a merged board would have to either load every
 * pending row to sort it in memory or report a `totalElements` that is true of one table and false
 * of the screen. The desk asks for one board at a time and says which.
 *
 * Oldest first, because a moderation queue served newest-first starves the person who has been
 * waiting longest — the one outcome that turns "we moderate posts" into "we lose posts".
 */
export async function listFlatmateModeration({ kind = 'post', modStatus, page = 0, size = 20 } = {}) {
  const res = await get('/admin/flatmates/moderation', clean({ kind, modStatus, page, size }));
  return toViewModelPage(unwrapPage(res, { page, size }), toModerationRowViewModel);
}

/**
 * `PATCH /admin/flatmates/{id}/moderation` — release or withhold one post.
 *
 * The id may name a seeker post, a room or a group; the server tries each in turn rather than
 * making the caller declare a taxonomy it may not have. Returns 200 with **no body** — the contract
 * declares no response schema, so the caller refetches the queue it is working through rather than
 * re-rendering a row from an echo. `note` is internal and lands in the audit row, never on a
 * consumer surface.
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
 * `PATCH /admin/group-applications/{id}` — moderate one application.
 *
 * Writes `modStatus` **only**. The owner's `status` is theirs: removing a spam application must not
 * thereby decline it on the owner's behalf. The server cannot reach `status` from this route at
 * all, so this client could not break the rule if it tried — but sending only what we mean to
 * change keeps the intent legible at the call site too.
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
 * `GET /me/flatmate-groups` — the groups the caller started. Paged.
 *
 * Not derivable from `listGroups`. That read is public and its card projection carries no host
 * identity at all, so matching "mine" against a mobile there compares against a field the server
 * never sends — a test whose answer is fixed at `false` before it is asked.
 */
export async function myFlatmateGroups({ page = 0, size = 20 } = {}) {
  const res = await get('/me/flatmate-groups', clean({ page, size }));
  const paged = unwrapPage(res, { page, size });
  return { ...paged, items: paged.items.map(toGroupViewModel) };
}

/**
 * `GET /me/flatmate-rooms` — the rooms the caller posted, moderation state and all.
 *
 * The room twin of `myFlatmateGroups`, and not derivable from `listRooms` for the same reason: that
 * read is public and hard-floored to approved posts, so a host's pending or rejected room is not in
 * it at all. A host who cannot see their own rejected room simply posts it again.
 *
 * Returns the host-facing shape, so `ownerMobile` is populated here where every public read masks
 * it — it is the caller's own number.
 */
export async function myFlatmateRooms({ page = 0, size = 20 } = {}) {
  const res = await get('/me/flatmate-rooms', clean({ page, size }));
  const paged = unwrapPage(res, { page, size });
  return { ...paged, items: paged.items.map(toRoomViewModel) };
}

/* ─── Group applications: the consumer ends ─────────────────────────────────────────────────── *//*
 * The other half of the board above, and the half that makes it able to have rows at all.
 *
 * Three routes for two people. The group's host commits their members to a flat; the flat's owner
 * reads their inbox and answers. Both write the OWNER axis (`status`) and never `modStatus` — the
 * server keeps them on separate routes precisely so no request can be ambiguous about which column
 * it means, and these three functions inherit that separation for free.
 */

/**
 * `POST /flatmates/groups/{id}/apply` — the group's host applies to a whole-flat rent listing.
 *
 * 409 when the group already applied, which the caller should surface verbatim: the server's
 * sentence ("the owner has it") is more useful than "already applied", because the thing the host
 * wants to know is whether their application landed, not whether it was a duplicate.
 */
export async function applyGroupToListing(groupId, listingId) {
  return toGroupApplicationViewModel(
    await post(`/flatmates/groups/${encodeURIComponent(groupId)}/apply`, { listingId }),
  );
}

/**
 * `GET /me/group-applications` — applications on the caller's own listings. Paged.
 *
 * Owner-scoped by the session, so it takes no owner argument — an owner with four flats gets one
 * queue rather than four reads. Moderation-removed rows are filtered server-side, so nothing here
 * needs to know the moderation vocabulary.
 */
export async function listMyGroupApplications({ page = 0, size = 20 } = {}) {
  const res = await get('/me/group-applications', clean({ page, size }));
  return toViewModelPage(unwrapPage(res, { page, size }), toGroupApplicationViewModel);
}

/**
 * `PATCH /me/group-applications/{id}` — the owner accepts or declines.
 *
 * Irreversible, and the server enforces it (409 on a second call) rather than trusting the button
 * to have been hidden. Returns the decided row so the caller can re-render from the server's answer
 * instead of from what it hoped happened.
 */
export async function decideGroupApplication(id, status) {
  return toGroupApplicationViewModel(
    await patch(`/me/group-applications/${encodeURIComponent(id)}`, { status }),
  );
}
