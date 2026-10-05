import { createProvider } from './config.js';

const provider = createProvider('flatmate');

export { CONFLICT_ALREADY_INTERESTED, CONFLICT_GROUP_FULL, CONFLICT_GROUP_LIMIT } from './providers/http/flatmateMapper.js';

/* ─── Rooms ─────────────────────────────────────────────────────────────────────────────────── */

/** Advertise a room. `photos` must not be empty — that is the shape broker spam takes. */
export const createRoom = async (room) => (await provider()).createRoom(room);
export const updateRoom = async (id, room) => (await provider()).updateRoom(id, room);
/** How many seats the host is still offering. Not derived from occupants — a separate fact. */
export const setRoomSeats = async (id, seatsOpen) => (await provider()).setRoomSeats(id, seatsOpen);
/** How many people actually live there. Distinct from seats: fact versus intention. */
export const setRoomOccupants = async (id, occupants) => (await provider()).setRoomOccupants(id, occupants);
/** Ask to take the room. Creates a `pending` request in the host's inbox. */
export const roomInterest = async (id, body) => (await provider()).roomInterest(id, body);
/** Re-request the rental-agreement evidence behind a room. */
export const reissueRoomAgreement = async (id) => (await provider()).reissueRoomAgreement(id);

/* ─── Groups ────────────────────────────────────────────────────────────────────────────────── */

export const createGroup = async (group) => (await provider()).createGroup(group);
/** Takes the create shape. A tenant group that omits its agreement evidence drops to identity tier. */
export const updateGroup = async (id, group) => (await provider()).updateGroup(id, group);
/** One ad, `kind` = `group` | `room` | `post`: `{ kind, owned, item }`. 404 when not visible to the caller. */
export const getFlatmateDetail = async (kind, id) => (await provider()).getFlatmateDetail(kind, id);
export const deleteGroup = async (id) => (await provider()).deleteGroup(id);
export const deleteRoom = async (id) => (await provider()).deleteRoom(id);
/** Puts an expired post back on the board for another 30 days. */
export const renewFlatmate = async (kind, id) => (await provider()).renewFlatmate(kind, id);
export const setGroupSeats = async (id, seatsOpen) => (await provider()).setGroupSeats(id, seatsOpen);

export const joinGroup = async (id, body) => (await provider()).joinGroup(id, body);
/** Leave a group I'm in. The host can't — they delete it instead. */
export const leaveGroup = async (id) => (await provider()).leaveGroup(id);
/** The host removes a member; that person can't ask again. */
export const removeGroupMember = async (id, memberId) => (await provider()).removeGroupMember(id, memberId);
/** Take back a pending request. `kind` = `group` | `room` | `flatmate`. */
export const withdrawInterest = async (kind, id) => (await provider()).withdrawInterest(kind, id);

/** The flat owner acknowledges a tenant's sublet — the anti-broker guardrail. */
export const recordOwnerConsent = async (id, body) => (await provider()).recordOwnerConsent(id, body);

/** The same acknowledgement taken *before* the group exists: keyed on (owner mobile, tenant), so it can be granted
 * first and read back at submit. Called twice — without `otp`, then with it. */
export const requestOwnerConsent = async (body) => (await provider()).requestOwnerConsent(body);

/* ─── Seeker posts ──────────────────────────────────────────────────────────────────────────── */

/** Advertise yourself as looking. `localities` must not be empty. */
export const createPost = async (body) => (await provider()).createPost(body);
/** Partial by design — only dirty fields cross the seam. */
export const updatePost = async (id, patch) => (await provider()).updatePost(id, patch);
export const deletePost = async (id) => (await provider()).deletePost(id);
/** Reach out to a seeker. */
export const postInterest = async (id, body) => (await provider()).postInterest(id, body);

/* ─── Requests ──────────────────────────────────────────────────────────────────────────────── */

export const myRequests = async (status) => (await provider()).myRequests(status);
/** The caller's sent-interest outbox. Keys the Flatmates CTA state across devices. */
export const myFlatmateInterests = async () => (await provider()).myFlatmateInterests();
/** Accept or decline. Host only. */
export const decideRequest = async (id, decision) => (await provider()).decideRequest(id, decision);

/* ─── Flat split ────────────────────────────────────────────────────────────────────────────── */

/** The rooms inherit the listing's `propertyId`, which is what makes them owner-verified without a second
 * verification. */
export const splitProperty = async (propertyId, body) => (await provider()).splitProperty(propertyId, body);
export const unsplitProperty = async (propertyId) => (await provider()).unsplitProperty(propertyId);

/* ─── Feed ──────────────────────────────────────────────────────────────────────────────────── */

/** The interleaved tab feed, and the board's only search. `tab` is `move-in` | `team-up`. */
export const feed = async (tab, filters, page, size, opts) => (await provider()).feed(tab, filters, page, size, opts);

/* ─── Shortlist ─────────────────────────────────────────────────────────────────────────────── */

/** The flatmate half of "Saved", apart from `savedService` because a flatmate save points at one of three tables. */
export const listFlatmateSaves = async (params) => (await provider()).listFlatmateSaves(params);
/* Shortlist keys stay unpaged because the board already holds the cards they decorate. */
export const listFlatmateSaveKeys = async () => (await provider()).listFlatmateSaveKeys();
/** Idempotent. A second tap on an already-saved post is not an error. */
export const saveFlatmatePost = async (kind, id) => (await provider()).saveFlatmatePost(kind, id);
/** Idempotent. Succeeds with or without an existing row. */
export const unsaveFlatmatePost = async (kind, id) => (await provider()).unsaveFlatmatePost(kind, id);

/* ─── Ops: verification, moderation, group applications ─────────────────────────────────────── */

/** The host-verification queue. `{ status, flagged, page, size }`, all optional. Paged. */
export const listFlatmateReviews = async (params) => (await provider()).listFlatmateReviews(params);
/** **A rejection needs a `note`** — the server 400s without one, and a host told "no" without being told why cannot
 * fix anything. */
export const decideFlatmateReview = async (id, decision, note) => (await provider()).decideFlatmateReview(id, decision, note);

/** The post-moderation backlog. **One `kind` per call** — `post` | `room` | `group`; `modStatus` may be a list. */
export const listFlatmateModeration = async (params) => (await provider()).listFlatmateModeration(params);
/** One post/room/group in full for the review popup: `{ item, room, group, post, review }`. */
export const getFlatmateModerationDetail = async (id) => (await provider()).getFlatmateModerationDetail(id);
/** Release or withhold one post. Returns nothing — refetch the queue. `note` is internal. */
export const moderateFlatmatePost = async (id, modStatus, note) => (await provider()).moderateFlatmatePost(id, modStatus, note);

/** The group-application board, newest first. `{ modStatus, page, size }`. Paged. */
export const listGroupApplications = async (params) => (await provider()).listGroupApplications(params);
/** Moderate one application. Writes `modStatus` only — the owner's `status` is theirs. */
export const moderateGroupApplication = async (id, modStatus, note) => (await provider()).moderateGroupApplication(id, modStatus, note);

/* ─── Group applications: the consumer ends ─────────────────────────────────────────────────── */

/** The groups I started — including any still awaiting moderation. Paged, caller-scoped. */
export const myFlatmateGroups = async (params) => (await provider()).myFlatmateGroups(params);
export const myFlatmateRooms = async (params) => (await provider()).myFlatmateRooms(params);
export const myFlatmatePosts = async (params) => (await provider()).myFlatmatePosts(params);
/** The group's host commits their members to a whole-flat rent listing. 409 if already applied. */
export const applyGroupToListing = async (groupId, listingId) => (await provider()).applyGroupToListing(groupId, listingId);
/** The owner inbox — applications on my own listings, newest first. Paged, caller-scoped. */
export const listMyGroupApplications = async (params) => (await provider()).listMyGroupApplications(params);
/** The owner accepts or declines. Writes `status` only, and only once (409 on a second call). */
export const decideGroupApplication = async (id, status) => (await provider()).decideGroupApplication(id, status);
