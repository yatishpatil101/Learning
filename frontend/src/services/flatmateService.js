/**
 * Flatmate Service — rooms, groups, seeker posts and the host's request inbox.
 *
 * The widest surface in the seam: 23 endpoints over four resources.
 *
 *   `/flatmates/rooms` (+seats, occupants, interest, agreement/reissue)
 *   `/flatmates/groups` (+seats, join, owner-consent)
 *   `/flatmates/posts` (+interest)
 *   `/me/flatmate-requests` · `/flatmates/feed`
 *   `/properties/{id}/rooms` · `/properties/{id}/split`
 *
 * ## Two tabs, three resources
 *
 * The page has two tabs and they do not map one-to-one onto resources:
 *
 *   **Move in** → rooms
 *   **Team up** → seeker posts **and** groups, interleaved
 *
 * `feed(tab)` does the interleaving; `listRooms` / `listPosts` / `listGroups` are there for the
 * views that want one resource at a time.
 *
 * ## The three list reads are public
 *
 * Deliberately: the Flatmates page exists to convert a signed-out visitor, and a provider that
 * short-circuited on a missing session — the right thing for every caller-scoped read in this
 * seam — would blank the page for exactly that person. Only `myRequests` is session-gated.
 *
 * ## Joining an open group succeeds immediately
 *
 * `joinGroup` returns a **request**, and its status depends on the group's policy: an open-policy
 * group accepts outright, a restricted one leaves it `pending` for the host. Read `status`; do not
 * assume either. It is the "the call succeeded ≠ the thing happened" shape the payment domains
 * have, without the money.
 *
 * ## The vocabularies are closed
 *
 * Nine fields accept only a fixed set, and the server answers 400 listing the allowed values.
 * Unknown values are dropped before the request rather than spent on a round trip — a filter chip
 * sending `"Female"` for `"female"` would otherwise surface as "search is broken".
 */
import { createProvider } from './config.js';

const provider = createProvider('flatmate');

/**
 * The two reasons an interest/join door answers 409.
 *
 * Both arrive as `error: "conflict"` on the wire, so both providers lift the real reason onto
 * `ApiError.code` and a call site branches on these. They are not interchangeable:
 * `already_interested` is informational (the host has the message), `group_full` is a refusal.
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
export const setGroupSeats = async (id, seatsOpen) => (await provider()).setGroupSeats(id, seatsOpen);

/**
 * Ask to join a group — or join it outright.
 *
 * **Returns a request whose `status` depends on the group's policy.** Open groups accept
 * immediately; restricted ones go to the host. Rendering "waiting for approval" unconditionally
 * would be wrong about half of them.
 */
export const joinGroup = async (id, body) => (await provider()).joinGroup(id, body);

/** The flat owner acknowledges a tenant's sublet — the anti-broker guardrail. */
export const recordOwnerConsent = async (id, body) => (await provider()).recordOwnerConsent(id, body);

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
/** Accept or decline. Host only. */
export const decideRequest = async (id, decision) => (await provider()).decideRequest(id, decision);

/* ─── Flat split ────────────────────────────────────────────────────────────────────────────── */

/** The rooms a listing has been carved into. */
export const propertyRooms = async (propertyId) => (await provider()).propertyRooms(propertyId);
/**
 * Carve a live rent listing into per-room supply. The rooms inherit the listing's `propertyId`,
 * which is what makes them owner-verified without a second verification.
 */
export const splitProperty = async (propertyId, body) => (await provider()).splitProperty(propertyId, body);
export const unsplitProperty = async (propertyId) => (await provider()).unsplitProperty(propertyId);

/* ─── Feed ──────────────────────────────────────────────────────────────────────────────────── */

/** The interleaved tab feed. `tab` is `move-in` | `team-up`. */
export const feed = async (tab, filters, page, size) => (await provider()).feed(tab, filters, page, size);
