/**
 * Flatmate Service — rooms, groups, seeker posts and the host's request inbox; 23 endpoints over
 * four resources. Tabs, public reads, join semantics, closed vocabularies: docs/flows/consumer/flatmates.md
 */
import { createProvider } from './config.js';

const provider = createProvider('flatmate');

/**
 * The two reasons an interest/join door answers 409. Not interchangeable: `already_interested` is
 * informational, `group_full` is a refusal. Both arrive as `conflict` and are lifted onto `code`.
 */
export { CONFLICT_ALREADY_INTERESTED, CONFLICT_GROUP_FULL } from './providers/http/flatmateMapper.js';

/* ─── Rooms ─────────────────────────────────────────────────────────────────────────────────── */

/** Rooms going in someone's flat. **Public.** Paged: `{ items, page, size, total, totalPages }`. */
export const listRooms = async (filters, page, size) => (await provider()).listRooms(filters, page, size);
/** Advertise a room. `photos` must not be empty — that is the shape broker spam takes. */
export const createRoom = async (room) => (await provider()).createRoom(room);
/** How many seats the host is still offering. Not derived from occupants — a separate fact. */
export const setRoomSeats = async (id, seatsOpen) => (await provider()).setRoomSeats(id, seatsOpen);
/** How many people actually live there. Distinct from seats: fact versus intention. */
export const setRoomOccupants = async (id, occupants) => (await provider()).setRoomOccupants(id, occupants);
/** Ask to take the room. Creates a `pending` request in the host's inbox. */
export const roomInterest = async (id, body) => (await provider()).roomInterest(id, body);
/** Re-request the rental-agreement evidence behind a room. */
export const reissueRoomAgreement = async (id) => (await provider()).reissueRoomAgreement(id);

/* ─── Groups ────────────────────────────────────────────────────────────────────────────────── */

/** Formed groups with seats to fill. **Public.** */
export const listGroups = async (filters, page, size) => (await provider()).listGroups(filters, page, size);
export const createGroup = async (group) => (await provider()).createGroup(group);
export const deleteGroup = async (id) => (await provider()).deleteGroup(id);
export const deleteRoom = async (id) => (await provider()).deleteRoom(id);
export const setGroupSeats = async (id, seatsOpen) => (await provider()).setGroupSeats(id, seatsOpen);

/**
 * Ask to join a group — or join it outright. **Returns a request whose `status` depends on the
 * group's policy**, so rendering "waiting for approval" unconditionally is wrong about half.
 */
export const joinGroup = async (id, body) => (await provider()).joinGroup(id, body);

/** The flat owner acknowledges a tenant's sublet — the anti-broker guardrail. */
export const recordOwnerConsent = async (id, body) => (await provider()).recordOwnerConsent(id, body);

/**
 * The same acknowledgement taken *before* the group exists: keyed on (owner mobile, tenant), so it
 * can be granted first and read back at submit. Called twice — without `otp`, then with it.
 */
export const requestOwnerConsent = async (body) => (await provider()).requestOwnerConsent(body);

/* ─── Seeker posts ──────────────────────────────────────────────────────────────────────────── */

/** People looking for a flat. **Public.** */
export const listPosts = async (filters, page, size) => (await provider()).listPosts(filters, page, size);
/** Advertise yourself as looking. `localities` must not be empty. */
export const createPost = async (body) => (await provider()).createPost(body);
/** Partial by design — send only the fields that changed. */
export const updatePost = async (id, patch) => (await provider()).updatePost(id, patch);
export const deletePost = async (id) => (await provider()).deletePost(id);
/** Reach out to a seeker. */
export const postInterest = async (id, body) => (await provider()).postInterest(id, body);

/* ─── Requests ──────────────────────────────────────────────────────────────────────────────── */

/**
 * The caller's inbox as **host**. Contains both `pending` rows awaiting a decision and joins that
 * were already accepted — filter on `awaitingDecision`, not on presence.
 */
export const myRequests = async (status) => (await provider()).myRequests(status);
/** The caller's sent-interest outbox. Keys the Flatmates CTA state across devices. */
export const myFlatmateInterests = async () => (await provider()).myFlatmateInterests();
/** Accept or decline. Host only. */
export const decideRequest = async (id, decision) => (await provider()).decideRequest(id, decision);

/* ─── Flat split ────────────────────────────────────────────────────────────────────────────── */

/*
 * All three take the listing's **uuid**, not its slug. Pass `p.uuid || p.id` — never `p.id` alone;
 * a slug 400s in Spring's converter before the handler runs (docs/flows/consumer/flatmates.md).
 */

/** The rooms a listing has been carved into. */
export const propertyRooms = async (propertyId) => (await provider()).propertyRooms(propertyId);
/**
 * Carve a live rent listing into per-room supply. The rooms inherit the listing's `propertyId`,
 * which is what makes them owner-verified without a second verification.
 */
export const splitProperty = async (propertyId, body) => (await provider()).splitProperty(propertyId, body);
export const unsplitProperty = async (propertyId) => (await provider()).unsplitProperty(propertyId);

/* ─── Feed ──────────────────────────────────────────────────────────────────────────────────── */

/** The interleaved tab feed, and the board's only search. `tab` is `move-in` | `team-up`. */
export const feed = async (tab, filters, page, size, opts) => (await provider()).feed(tab, filters, page, size, opts);

/* ─── Shortlist ─────────────────────────────────────────────────────────────────────────────── */

/*
 * The flatmate half of "Saved", apart from `savedService` because a flatmate save points at one of
 * three tables. A save is a key, not a card; `kind` is part of it — docs/flows/consumer/flatmates.md
 */

/** The shortlist as full cards, newest save first. Signed out reads empty rather than throwing. */
export const listFlatmateSaves = async (params) => (await provider()).listFlatmateSaves(params);
/**
 * The shortlist as `[{ kind, id }]`, unpaged — keys rather than cards, because the board asking
 * which bookmarks are filled in is already holding the cards.
 */
export const listFlatmateSaveKeys = async () => (await provider()).listFlatmateSaveKeys();
/** Idempotent. A second tap on an already-saved post is not an error. */
export const saveFlatmatePost = async (kind, id) => (await provider()).saveFlatmatePost(kind, id);
/** Idempotent. Succeeds whether or not a row was there. */
export const unsaveFlatmatePost = async (kind, id) => (await provider()).unsaveFlatmatePost(kind, id);

/* ─── Ops: verification, moderation, group applications ─────────────────────────────────────── */

/*
 * The staff half of the domain. Two axes that stay unmerged: *verification* outcomes are a badge,
 * *moderation* outcomes are visibility — docs/flows/consumer/flatmates.md.
 */

/** The host-verification queue. `{ status, flagged, page, size }`, all optional. Paged. */
export const listFlatmateReviews = async (params) => (await provider()).listFlatmateReviews(params);
/**
 * Approve or reject a host verification (`approved` | `rejected`). **A rejection needs a `note`** —
 * the server 400s without one, and a host told "no" without being told why cannot fix anything.
 */
export const decideFlatmateReview = async (id, decision, note) => (await provider()).decideFlatmateReview(id, decision, note);

/** The post-moderation backlog. **One `kind` per call** — `post` | `room` | `group`. */
export const listFlatmateModeration = async (params) => (await provider()).listFlatmateModeration(params);
/** Release or withhold one post. Returns nothing — refetch the queue. `note` is internal. */
export const moderateFlatmatePost = async (id, modStatus, note) => (await provider()).moderateFlatmatePost(id, modStatus, note);

/** The group-application board, newest first. Paged. */
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
