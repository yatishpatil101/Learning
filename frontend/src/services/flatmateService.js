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
export const deleteRoom = async (id) => (await provider()).deleteRoom(id);
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
/** The caller's sent-interest outbox. Keys the Flatmates CTA state across devices. */
export const myFlatmateInterests = async () => (await provider()).myFlatmateInterests();
/** Accept or decline. Host only. */
export const decideRequest = async (id, decision) => (await provider()).decideRequest(id, decision);

/* ─── Flat split ────────────────────────────────────────────────────────────────────────────── */
/*
 * All three take the listing's **uuid**, not its slug. Pass `p.uuid || p.id` — never `p.id` alone.
 *
 * `propertyMapper` sets the seam's `id` to `slug || uuid` because the UI routes on `/property/:id`,
 * and stashes the real key on `uuid`. So the obvious argument is the wrong one. `FlatSplitController`
 * binds `@PathVariable UUID id`, which means a slug does not 404 — it 400s in Spring's converter
 * before the handler runs, and nothing on the page would say why.
 *
 * This is written here because these three have **no callers yet**. The identical mistake against
 * `PUT /me/saved/{propId}` produced a run of silent 400s behind an optimistic control, and the one
 * seam that got it right (`propertyReviewProvider`) was the one whose docblock said so. The note is
 * cheaper than the bug.
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

/** The interleaved tab feed. `tab` is `move-in` | `team-up`. */
export const feed = async (tab, filters, page, size) => (await provider()).feed(tab, filters, page, size);

/* ─── Shortlist ─────────────────────────────────────────────────────────────────────────────── */
/*
 * The flatmate half of "Saved" — the sibling of `savedService`, kept apart from it because a
 * flatmate save points at one of three tables and so cannot carry a `propertyId`.
 *
 * **A save is a key, not a card.** Until this seam existed the shortlist lived in
 * `puneNestFlatmateSaved` and stored the rendered card alongside it: the title, locality, rent and
 * photo were copied in at the moment of the tap. That made the Saved page cheap to draw and
 * permanently capable of lying — a room whose rent changed, or whose host withdrew it, went on
 * showing what it looked like when it was saved. Both providers now store the key alone and join
 * the card on read, so the shortlist can be wrong about what still exists but never about what it
 * says.
 *
 * `kind` is `room` | `group` | `post` and is part of the key: the three id spaces are separate
 * tables, so the same id may legitimately exist in two of them.
 */

/** The shortlist as full cards, newest save first. Signed out reads empty rather than throwing. */
export const listFlatmateSaves = async (params) => (await provider()).listFlatmateSaves(params);
/**
 * The shortlist as `[{ kind, id }]`, unpaged — what the flatmates board needs to decide which
 * bookmarks are filled in. Keys rather than cards because the board is already holding the cards.
 */
export const listFlatmateSaveKeys = async () => (await provider()).listFlatmateSaveKeys();
/** Idempotent. A second tap on an already-saved post is not an error. */
export const saveFlatmatePost = async (kind, id) => (await provider()).saveFlatmatePost(kind, id);
/** Idempotent. Succeeds whether or not a row was there. */
export const unsaveFlatmatePost = async (kind, id) => (await provider()).unsaveFlatmatePost(kind, id);

/* ─── Ops: verification, moderation, group applications ─────────────────────────────────────── */
/*
 * The staff half of the domain, and the only part of this seam that is **live-only** — the mock
 * provider's six counterparts throw. `/ops/flatmate-review` guards on `isHttpDomain('flatmate')`
 * and explains itself rather than calling into them.
 *
 * ## Two axes, deliberately not merged
 *
 *   **Verification** — *has this host proved what they claimed?* Outcome: a badge. A post that
 *   fails stays visible, because an unproven claim is not abuse.
 *
 *   **Moderation** — *may this post be published at all?* Outcome: visibility. A post that fails is
 *   hidden, which says nothing about whether the paperwork is real.
 *
 * They are separate routes on the server for this reason and they stay separate here.
 */

/** The host-verification queue. `{ status, flagged, page, size }`, all optional. Paged. */
export const listFlatmateReviews = async (params) => (await provider()).listFlatmateReviews(params);
/**
 * Approve or reject a host verification. `decision` is `approved` | `rejected`.
 *
 * **A rejection needs a `note`** — the server answers 400 without one, and so does the database.
 * A host told "no" without being told why cannot fix anything.
 */
export const decideFlatmateReview = async (id, decision, note) => (await provider()).decideFlatmateReview(id, decision, note);

/** The D72 post-moderation backlog. **One `kind` per call** — `post` | `room` | `group`. */
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
