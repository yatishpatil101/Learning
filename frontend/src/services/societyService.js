/**
 * Society Service — the review aggregate a society card renders, and the caller's follows.
 *
 * ## Why this domain exists at all, and why it is one operation wide
 *
 * The society *catalogue* is not behind the seam: `data/societies.js` is still the source of the
 * 348 rows the directory lists, and moving it is a much larger change than this one. What was
 * behind nothing at all was the **rating** on those rows. The directory used
 * `entityRating('society', slug)`, a reduce over the `pnEntityReviews` localStorage bucket, which
 * is dead against a live server: the reviews are in Postgres, nothing writes that bucket in live
 * mode, and so every card in the grid renders "Not rated yet" for a society that may have fifty
 * reviews. It does not error and it does not look broken — it looks like a quiet building.
 *
 * The fix is not to route the cards through `reviewService.getEntityReviewSummary`. That is one
 * request per card, 348 of them on the directory, to draw one number each. `GET /societies`
 * already carries `avgRating` and `reviewCount` per row — the server computes them in a single
 * grouped query per page (`RatingLookup.forSocieties`) for exactly this call site — so the whole
 * grid's ratings cost one paged read of a list endpoint that already exists.
 *
 * Hence the shape: **one operation, returning an index keyed by slug**, not a `getSociety(slug)`.
 * A per-society signature would put the caller back in a `.map()` issuing a request per row, which
 * is the thing this exists to avoid.
 *
 * ## Slug, not id
 *
 * The key is `soc.slug`. `soc.id` is a synthetic `S01` minted by `data/societies.js` that the
 * server has never seen; the server keys societies by UUID and accepts the slug as the public
 * alias. Every other society surface already joins on the slug.
 *
 * ## `avg` is null, not 0
 *
 * An unrated society has `{ avg: null, count: 0 }`, matching `GET /societies`, which sends
 * `avgRating: null` rather than `0` — and matching `getPropertyReviewSummary` / `getEntityReviewSummary`,
 * which make the same distinction for the same reason. No rating is not a rating of zero, and a 0
 * here would render as a one-star society. Callers must branch on `count`, never on the average
 * being falsy.
 *
 * A slug absent from the index is *not* the same as an unrated society: it means this reader has
 * no opinion about it (the server does not have that society, or the read has not resolved). The
 * caller decides what to say about that, and "nothing" is usually the honest answer.
 *
 * ## Follows (D227)
 *
 * The second thing on this domain is the follow set. It was `pnFollowedSocieties`, a localStorage
 * array, which meant following a society on a laptop did not follow it on a phone — and the
 * follower count on the hub, which the server computes from the join table, counted nobody at all
 * because nothing ever wrote a row.
 *
 * **Slugs, not rows.** `GET /me/societies/following` returns full society cards, which is the right
 * contract — a follow list is a list of societies and an endpoint that answered with bare strings
 * would be useless to any other client. This seam narrows it to slugs because that is the whole of
 * what the five follow surfaces ask for: four of them only need membership, and the one that
 * renders cards (`FollowedSocietiesPanel`) already resolves each slug through the local society
 * catalogue to get the synthetic `S01` id that `listingsInSociety` joins on. Handing it server rows
 * would replace that id with a UUID and it would silently match no listings.
 *
 * **These are not for components to call directly.** Membership is asked once per card on the
 * directory, so per-call reads are the N+1 this seam exists to prevent; `context/FollowContext.jsx`
 * holds the set and answers `has(slug)` from memory. Only that context should import these.
 */
import { createProvider } from './config.js';

const provider = createProvider('society');

/**
 * Every society's rating aggregate in one read, indexed by slug.
 *
 * @returns {Promise<Record<string, {avg: number|null, count: number}>>} `avg` is rounded to one
 *   decimal and is `null` when `count` is 0. Slugs the source knows nothing about are absent
 *   rather than present-and-zero.
 */
export const listSocietyRatings = async () => (await provider()).listSocietyRatings();

/**
 * The slugs of the societies the caller follows, most recently followed first.
 *
 * @returns {Promise<string[]>} newest first. Empty when signed out — the route is caller-scoped.
 */
export const listFollowedSocieties = async () => (await provider()).listFollowedSocieties();

/**
 * Follow one society. Idempotent: following one already followed is not an error.
 *
 * @param {string} slug the society's public key
 * @throws {ApiError} 404 when no society has this slug — which is the case for a society minted
 *   only in this browser, and the reason `FollowContext` keeps those follows local.
 */
export const followSociety = async (slug) => (await provider()).followSociety(slug);

/** Unfollow one society. Idempotent: unfollowing one not followed is not an error. */
export const unfollowSociety = async (slug) => (await provider()).unfollowSociety(slug);

/**
 * Where the caller stands in this society (D240).
 *
 * One read for four facts — the caller's own residency request, whether they are the committee,
 * the society's live claim, and how many residents are verified — because the hub takes all four
 * rendering decisions at once. Three separate reads would flicker controls into and out of
 * existence as they landed, which is the bug the browser-local version had.
 *
 * Safe to call signed out: `resident` is null and `admin` false, and the society's own facts still
 * arrive, so the "claim this society" invitation renders on first paint.
 *
 * @param {string} slug
 * @returns {Promise<{societySlug: string, resident: object|null, admin: boolean,
 *   claim: object|null, verifiedResidents: number}>} the claim never carries the claimant's mobile
 *   or email — this surface is public, and who claimed a society must not be a way to lift a
 *   committee member's number off a page anybody can load.
 */
export const getSocietyMembership = async (slug) => (await provider()).getSocietyMembership(slug);

/**
 * Ask to be recognised as a resident of one flat.
 *
 * Calling this again amends the standing request rather than queueing a second, so a caller may
 * treat it as "save my flat" and render whatever comes back.
 *
 * @param {string} slug
 * @param {{wing?: string, flat: string, relation?: 'owner'|'tenant'|'family'|'resident', note?: string}} body
 * @throws {ApiError} 409 when the caller is already verified in a *different* flat — that is a
 *   move, and it needs the committee rather than a self-service edit.
 */
export const requestResidency = async (slug, body) =>
  (await provider()).requestResidency(slug, body);

/**
 * The society's residency queue — the committee's inbox, and ops' view of an unclaimed society.
 *
 * @param {string} slug
 * @param {{status?: 'pending'|'verified'|'rejected'}} [opts] omit for every row
 * @returns {Promise<object[]>} rows carry the applicant's name and mobile, deliberately: the
 *   question being answered is "does this person live in B/704".
 * @throws {ApiError} 403 for a resident who is not the committee. Living somewhere is not a
 *   licence to read every neighbour's number.
 */
export const listSocietyResidents = async (slug, opts) =>
  (await provider()).listSocietyResidents(slug, opts);

/**
 * Verify or reject one residency request.
 *
 * @param {string} slug
 * @param {string} residentId the queue row's id
 * @param {{status: 'verified'|'rejected', note?: string}} body
 * @throws {ApiError} 409 when another resident already holds that flat. Reject them first — a
 *   handover is a decision, not a race.
 */
export const decideResidency = async (slug, residentId, body) =>
  (await provider()).decideResidency(slug, residentId, body);

/**
 * Claim a society on behalf of its committee.
 *
 * Approval is what makes the claimant this society's reviewer; there is no separate
 * committee-members table, so the approved claimant *is* the society admin.
 *
 * @param {string} slug
 * @param {{name: string, role?: string, email?: string, note?: string}} body `role` is free text —
 *   committee titles here are not a closed set.
 * @throws {ApiError} 409 when somebody else already has a live claim. Amending your own pending
 *   claim is a correction and succeeds.
 */
export const claimSociety = async (slug, body) => (await provider()).claimSociety(slug, body);

/**
 * Questions asked about this society, newest first, every answer attached.
 *
 * Readable without an account, deliberately: the person with the most to ask about a building has
 * not moved into it yet, and a Q&A only residents can read cannot help the person it exists for.
 *
 * Each author carries `authorIsResident`, recomputed on every read rather than stored. It says
 * whether that person is a verified resident of this society *now* — the browser-local version
 * froze the flag at posting time, so a rejected resident's old answers went on wearing the badge.
 *
 * @param {string} slug
 * @returns {Promise<Array<{id: string, body: string, authorName: string, authorIsResident: boolean,
 *   createdAt: string, answers: Array<object>}>>}
 */
export const listSocietyQuestions = async (slug) => (await provider()).listSocietyQuestions(slug);

/**
 * Ask a question. Any signed-in caller — not gated on residency.
 *
 * @param {string} slug
 * @param {string} body Up to 600 characters; blank is refused rather than posted empty.
 * @throws {ApiError} 401 when signed out, 422 when blank.
 */
export const askSocietyQuestion = async (slug, body) =>
  (await provider()).askSocietyQuestion(slug, body);

/**
 * Answer a question.
 *
 * @param {string} slug
 * @param {string} questionId
 * @param {string} body
 * @throws {ApiError} 404 when the question does not belong to this society — an answer posted
 *   through the wrong society's URL would be invisible, so it is refused rather than orphaned.
 */
export const answerSocietyQuestion = async (slug, questionId, body) =>
  (await provider()).answerSocietyQuestion(slug, questionId, body);

/**
 * The society noticeboard: dated events first by when they happen, then undated notices newest
 * first. One ordering for both would bury next week's AGM under a notice about the lift.
 *
 * Public. An active noticeboard is the most honest signal a society hub can give somebody deciding
 * where to live — a page that says nothing is a society nobody runs.
 *
 * `canRemove` is per-viewer and computed server-side, so the hub draws a delete control only where
 * one would actually work.
 *
 * @param {string} slug
 * @param {{kind?: 'event'|'notice'}} [opts] Omit for both.
 */
export const listSocietyBoard = async (slug, opts) =>
  (await provider()).listSocietyBoard(slug, opts);

/**
 * Post an event or a notice. Verified residents, the committee, and platform staff only.
 *
 * @param {string} slug
 * @param {{kind: 'event'|'notice', title: string, body?: string, category?: string,
 *   eventDate?: string, eventTime?: string}} item `eventDate` is required for an event and dropped
 *   from a notice — a dated notice sorts into the calendar and claims to be something that happens.
 * @throws {ApiError} 403 with the server's sentence about verifying a flat, 400 for an undated event.
 */
export const postBoardItem = async (slug, item) => (await provider()).postBoardItem(slug, item);

/**
 * Take a board item down. The author, the committee, or platform staff.
 *
 * @param {string} slug
 * @param {string} itemId
 * @throws {ApiError} 403 for anyone else — residency buys posting, not moderation.
 */
export const removeBoardItem = async (slug, itemId) =>
  (await provider()).removeBoardItem(slug, itemId);

/**
 * The community tab — tips, trusted picks and photos, most helpful first (D240 slice 3).
 *
 * Returns every contribution rather than a filtered slice: the tab draws a count chip for each kind
 * including the ones you are not viewing, so a filtered read could not draw the page anyway, and
 * fetching a list and its counts separately is two answers free to disagree. Filter in the caller.
 *
 * `referralContact` is null for a signed-out reader — it is a third party's phone number.
 *
 * @param {string} slug
 * @returns {Promise<Array<{id: string, kind: 'tip'|'pick'|'photo', category: ?string, body: ?string,
 *   referralName: ?string, referralContact: ?string, photoUrl: ?string, authorName: string,
 *   authorIsResident: boolean, helpfulCount: number, helpfulByMe: boolean, canRemove: boolean,
 *   createdAt: ?string, replies: Array<object>}>>}
 */
export const listSocietyContributions = async (slug) =>
  (await provider()).listSocietyContributions(slug);

/**
 * Share a tip, a trusted pick or a photo. Any signed-in caller.
 *
 * Each kind has its own minimum — a tip needs `body`, a pick needs `referralName`, a photo needs
 * `photoUrl` — and fields belonging to another kind are dropped rather than refused. `photoUrl` is
 * a URL from the photo upload, never a data URI.
 *
 * @param {string} slug
 * @param {{kind: 'tip'|'pick'|'photo', category?: string, body?: string, referralName?: string,
 *   referralContact?: string, photoUrl?: string}} contribution
 * @throws {ApiError} 401 when signed out, 400 when the kind's minimum is missing.
 */
export const addSocietyContribution = async (slug, contribution) =>
  (await provider()).addSocietyContribution(slug, contribution);

/**
 * Remove a contribution. The author, the committee, or platform staff — its replies and votes go
 * with it, because a thread under something invisible answers a question nobody can see.
 *
 * @throws {ApiError} 403 for a neighbour: residency buys contributing, not moderating.
 */
export const removeSocietyContribution = async (slug, contributionId) =>
  (await provider()).removeSocietyContribution(slug, contributionId);

/**
 * Mark or unmark a contribution as helpful.
 *
 * Takes the state you want, not a toggle — a toggle retried after a dropped connection undoes the
 * vote it just cast. Answers with the new count, so the button can update without re-reading the
 * page.
 *
 * @param {string} slug
 * @param {string} contributionId
 * @param {boolean} helpful
 * @returns {Promise<{helpfulCount: number, helpfulByMe: boolean}>}
 */
export const setContributionHelpful = async (slug, contributionId, helpful) =>
  (await provider()).setContributionHelpful(slug, contributionId, helpful);

/**
 * Reply in the thread under a contribution. Any signed-in caller.
 *
 * @throws {ApiError} 401 when signed out, 400/422 for an empty body.
 */
export const addContributionReply = async (slug, contributionId, body) =>
  (await provider()).addContributionReply(slug, contributionId, body);

/**
 * Remove a reply. Its own author, the committee, or staff — deliberately not the author of the
 * contribution it sits under: owning a tip does not make you the moderator of the conversation.
 */
export const removeContributionReply = async (slug, contributionId, replyId) =>
  (await provider()).removeContributionReply(slug, contributionId, replyId);

/**
 * Every pending community proposal for this society, plus whether a resident group exists.
 *
 * One read for what used to be three localStorage keys, so the page cannot render half a state —
 * a banner saying your pin correction is pending beside a map that has already been corrected.
 *
 * `whatsappJoinUrl` is null for anyone without a verified flat here, approved or not;
 * `whatsappAvailable` still reports that the group is there, which is what the "verify your flat"
 * nudge is drawn from.
 *
 * @param {string} slug
 * @returns {Promise<{pending: Array, whatsappAvailable: boolean, whatsappJoinUrl: string|null}>}
 */
export const getSocietyProposals = async (slug) => (await provider()).getSocietyProposals(slug);

/**
 * Propose a detail, the resident WhatsApp link, or a corrected map pin.
 *
 * One call for all three: they are one lifecycle wearing three names. A detail suggestion is open
 * to any signed-in caller — enriching a thin, bulk-imported society without first demanding
 * somebody verify a flat is how a community society becomes a verified one — while the invite and
 * the pin need a verified resident or the committee.
 *
 * Re-submitting corrects your own pending proposal rather than queueing a second one.
 *
 * @param {string} slug
 * @param {{kind: 'details'|'whatsapp'|'location', builder?: string, buildYear?: number,
 *   towers?: number, units?: number, maintenancePerSqft?: number, amenities?: string[],
 *   inviteUrl?: string, lat?: number, lng?: number, placeId?: string, label?: string}} body
 * @throws {ApiError} 401 signed out, 403 not a resident, 400 nothing to suggest / bad link /
 *   pin outside the city, 409 somebody else's proposal is already awaiting review.
 */
export const proposeSocietyChange = async (slug, body) =>
  (await provider()).proposeSocietyChange(slug, body);

/**
 * The ops queue across every society. Staff with `societies:read`.
 *
 * The queue whose absence made all three features theatre: it used to read the operator's own
 * browser, so it was permanently empty however many residents filled the form in on theirs.
 *
 * `inviteUrl` is populated here and nowhere else — screening a link for a scam is the point of the
 * review, and an operator cannot screen what the response redacts.
 *
 * @param {{status?: string, kind?: string, page?: number, size?: number}} [opts]
 */
export const listSocietyProposalQueue = async (opts) =>
  (await provider()).listSocietyProposalQueue(opts);

/**
 * Approve or reject one proposal. Staff with `societies:write`.
 *
 * Approving writes the value onto the society in the same transaction — there is no separate apply
 * step to fail in between. A detail suggestion is coalesced, not overwritten: correcting the
 * builder must not blank the tower count somebody else contributed.
 *
 * @throws {ApiError} 409 when the proposal has already been decided — the second decision would
 *   either double-apply it or silently revert the one the author has been told about.
 */
export const decideSocietyProposal = async (id, body) =>
  (await provider()).decideSocietyProposal(id, body);

/* --- community minting ------------------------------------------------------------------------ */

/**
 * Add a society the catalogue does not have. Any signed-in caller.
 *
 * Four screens invite somebody to do this — the lister who cannot find their building, the searcher
 * who wants alerting when a flat comes up in it. Every one of those mints used to land in the adding
 * browser's `localStorage`, so the society existed for exactly one person: nobody else could find
 * it, follow it or list a flat in it, and following it 404'd against a server that had never heard
 * of the slug.
 *
 * Resolves `{ society, created }`. `created` is false when the name already matched a society —
 * which is not an error, because the caller asked for a society by name and there is one. The
 * distinction is only there so the screen can say "Added" rather than telling somebody they have
 * just added a society that has existed for two years.
 *
 * @param {{name: string, localityLabel?: string, localitySlug?: string, lat?: number, lng?: number}} body
 * @returns {Promise<{society: object, created: boolean}>}
 */
export const mintSociety = async (body) => (await provider()).mintSociety(body);

/**
 * Member-added societies nobody has checked yet, oldest first. Staff with `societies:read`.
 *
 * The counterpart of the mint, and empty for the same reason it was: this queue read the operator's
 * own browser, so not one member-added society has ever been confirmed.
 *
 * @param {{page?: number, size?: number}} [opts]
 */
export const listSocietyCandidates = async (opts) => (await provider()).listSocietyCandidates(opts);

/**
 * Confirm a member-added society is real. Staff with `societies:write`.
 *
 * Records *who* confirmed it and when, and deliberately leaves `registration` and `conveyance`
 * alone: those describe the building's legal paperwork, not our confidence in the record, and
 * setting them here is how confirming that a society exists would quietly tell every buyer its
 * conveyance deed was done.
 *
 * @throws {ApiError} 409 when somebody has already verified it — the record of who did is the only
 *   thing that says who to ask about the society later, so it is never silently overwritten.
 * @throws {ApiError} 422 for a curated or MahaRERA society, which is not a candidate.
 */
export const verifySocietyCandidate = async (slug) =>
  (await provider()).verifySocietyCandidate(slug);
