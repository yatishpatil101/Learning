/**
 * Society Service — society rows, the rating aggregate a card renders, and the caller's follows.
 * Slug-not-id joins, the null-vs-zero rating rule, follows: docs/flows/consumer/societies.md
 */
import { createProvider } from './config.js';
import { isBlacklisted } from '../lib/geoConfig.js';
// The one place the "locality label to slug" rule is written; a fourth copy of a slug rule is how a
// picker starts preferring the wrong locality. Its 182 KB of rows sit behind a dynamic `import()`.
import { slugifySociety } from '../data/societies.js';

const provider = createProvider('society');

/**
 * Ranked type-ahead over the catalogue (at most 20 rows): verified, then locality match, then
 * alphabetical. The service owns the ordering so a picker cannot rank differently per mode.
 */
export const searchSocieties = async (query, localityLabel = '') => {
  const rows = await (await provider()).searchSocieties(query, localityLabel);
  const locSlug = localityLabel ? slugifySociety(localityLabel) : '';
  const locHead = locSlug.split('-')[0];
  const locMatch = (s) =>
    (locHead && s.localitySlug && (s.localitySlug === locSlug || s.localitySlug.startsWith(locHead))) ? 1 : 0;
  return (Array.isArray(rows) ? rows : [])
    .filter((s) => !isBlacklisted({ name: s.name }))
    .sort((a, b) => (Number(b.verified) - Number(a.verified)) || (locMatch(b) - locMatch(a)) || a.name.localeCompare(b.name))
    .slice(0, 20);
};

/**
 * One page of the society directory for the back office. `total` counts the whole filtered set,
 * not this page — the console's "Societies" tile reads it.
 */
export const listSocietyDirectory = async (opts) => (await provider()).listSocietyDirectory(opts);

/**
 * One society, addressed by slug. `null` means "no such society" and only that; every other failure
 * throws, because "does not exist" and "could not reach the server" are different claims.
 */
export const getSociety = async (slug) => (await provider()).getSociety(slug);


/**
 * Directory rows plus a separate slug-keyed rating index, so unrated `null` stays distinct from
 * zero.
 */
export const listSocietyCatalogue = async () => (await provider()).listSocietyCatalogue();

/**
 * Listing-bearing societies for the strongest-first rail; rows carry the server's `listingCount`.
 * Omits ratings because this rail does not render them.
 */
export const listSocietiesWithListings = async () => (await provider()).listSocietiesWithListings();

/** The slugs of the societies the caller follows, newest first. Empty when signed out. */
export const listFollowedSocieties = async () => (await provider()).listFollowedSocieties();

/**
 * The same follows as whole rows, for callers that have to *draw* the list rather than test
 * membership. A slug this reader cannot resolve is absent rather than a stub, so `length` may differ.
 */
export const listFollowedSocietyRows = async () => (await provider()).listFollowedSocietyRows();

/**
 * Follow one society. Idempotent. Throws 404 for a society minted only in this browser, which is
 * why `FollowContext` keeps those follows local.
 */
export const followSociety = async (slug) => (await provider()).followSociety(slug);

/** Unfollow one society. Idempotent: unfollowing one not followed is not an error. */
export const unfollowSociety = async (slug) => (await provider()).unfollowSociety(slug);

/**
 * Where the caller stands in this society: one read for four facts, because the hub takes all four
 * rendering decisions at once. Safe signed out; the claim never carries the claimant's contact.
 */
export const getSocietyMembership = async (slug) => (await provider()).getSocietyMembership(slug);

/**
 * Ask to be recognised as a resident of one flat; calling again amends the standing request.
 * Throws 409 when the caller is already verified in a *different* flat — a move needs the committee.
 */
export const requestResidency = async (slug, body) =>
  (await provider()).requestResidency(slug, body);

/**
 * The society's residency queue. Rows carry the applicant's name and mobile deliberately — the
 * question is "does this person live in B/704". 403 for a resident who is not the committee.
 */
export const listSocietyResidents = async (slug, opts) =>
  (await provider()).listSocietyResidents(slug, opts);

/**
 * Verify or reject one residency request. 409 when another resident already holds that flat —
 * reject them first, because a handover is a decision rather than a race.
 */
export const decideResidency = async (slug, residentId, body) =>
  (await provider()).decideResidency(slug, residentId, body);

/**
 * Claim a society on behalf of its committee. There is no committee-members table, so the approved
 * claimant *is* the society admin. 409 when somebody else already has a live claim.
 */
export const claimSociety = async (slug, body) => (await provider()).claimSociety(slug, body);

/**
 * Questions about this society, newest first, answers attached. Readable without an account.
 * `authorIsResident` is recomputed on every read, so a rejected resident's answers lose the badge.
 */
export const listSocietyQuestions = async (slug) => (await provider()).listSocietyQuestions(slug);

/** Ask a question. Any signed-in caller — not gated on residency. Up to 600 characters. */
export const askSocietyQuestion = async (slug, body) =>
  (await provider()).askSocietyQuestion(slug, body);

/**
 * Answer a question. 404 when it does not belong to this society: an answer posted through the
 * wrong society's URL would be invisible, so it is refused rather than orphaned.
 */
export const answerSocietyQuestion = async (slug, questionId, body) =>
  (await provider()).answerSocietyQuestion(slug, questionId, body);

/**
 * The noticeboard: dated events by when they happen, then undated notices newest first — one
 * ordering would bury next week's AGM. Public; `canRemove` is per-viewer and computed server-side.
 */
export const listSocietyBoard = async (slug, opts) =>
  (await provider()).listSocietyBoard(slug, opts);

/**
 * Post an event or a notice. Verified residents, the committee and staff only. `eventDate` is
 * required for an event and dropped from a notice — a dated notice sorts into the calendar.
 */
export const postBoardItem = async (slug, item) => (await provider()).postBoardItem(slug, item);

/**
 * Take a board item down. The author, the committee, or staff — 403 for anyone else, because
 * residency buys posting, not moderation.
 */
export const removeBoardItem = async (slug, itemId) =>
  (await provider()).removeBoardItem(slug, itemId);

/**
 * The community tab — every contribution, because the tab draws a count chip per kind and two reads
 * could disagree. Filter in the caller. `referralContact` is null for a signed-out reader.
 */
export const listSocietyContributions = async (slug) =>
  (await provider()).listSocietyContributions(slug);

/**
 * Share a tip, a trusted pick or a photo. Each kind has its own minimum and fields belonging to
 * another kind are dropped; `photoUrl` is a URL from the upload, never a data URI.
 */
export const addSocietyContribution = async (slug, contribution) =>
  (await provider()).addSocietyContribution(slug, contribution);

/**
 * Remove a contribution. The author, the committee or staff — its replies and votes go with it,
 * because a thread under something invisible answers a question nobody can see.
 */
export const removeSocietyContribution = async (slug, contributionId) =>
  (await provider()).removeSocietyContribution(slug, contributionId);

/**
 * Mark or unmark a contribution as helpful. Takes the state you want, not a toggle — a toggle
 * retried after a dropped connection undoes the vote it just cast. Answers with the new count.
 */
export const setContributionHelpful = async (slug, contributionId, helpful) =>
  (await provider()).setContributionHelpful(slug, contributionId, helpful);

/** Reply in the thread under a contribution. Any signed-in caller. */
export const addContributionReply = async (slug, contributionId, body) =>
  (await provider()).addContributionReply(slug, contributionId, body);

/**
 * Remove a reply. Its own author, the committee, or staff — deliberately not the author of the
 * contribution it sits under: owning a tip does not make you the moderator of the conversation.
 */
export const removeContributionReply = async (slug, contributionId, replyId) =>
  (await provider()).removeContributionReply(slug, contributionId, replyId);

/**
 * Every pending community proposal for this society plus whether a resident group exists — one read,
 * so the page cannot render half a state. `whatsappJoinUrl` is null without a verified flat here.
 */
export const getSocietyProposals = async (slug) => (await provider()).getSocietyProposals(slug);

/**
 * Propose a detail, the resident WhatsApp link, or a corrected map pin — one lifecycle wearing three
 * names. Details are open to any signed-in caller; the invite and the pin need a verified resident.
 */
export const proposeSocietyChange = async (slug, body) =>
  (await provider()).proposeSocietyChange(slug, body);

/**
 * The ops proposal queue across every society, oldest first, as a flat array. `inviteUrl` is
 * populated here and nowhere else — an operator cannot screen a link the response redacts.
 */
export const listSocietyProposalQueue = async (opts) =>
  (await provider()).listSocietyProposalQueue(opts);

/**
 * Approve or reject one proposal; approving writes the value onto the society in the same
 * transaction, and a detail suggestion is coalesced rather than overwritten. 409 once decided.
 */
export const decideSocietyProposal = async (id, body) =>
  (await provider()).decideSocietyProposal(id, body);

/* --- society residents: the ops side ----------------------------------------------------------- */

/**
 * Residency requests across every society, oldest first. Rows carry `societyName` too, because
 * "B/704, pending" is not a decision anybody can make. Deciding stays on `decideResidency`.
 */
export const listSocietyResidentQueue = async (opts) =>
  (await provider()).listSocietyResidentQueue(opts);

/* --- society claims: the ops side ------------------------------------------------------------- */

/**
 * Committee claims awaiting a decision, oldest first. `claimantMobile` and `email` are populated
 * here and redacted from the public membership read, because deciding means phoning the filer.
 */
export const listSocietyClaimQueue = async (opts) =>
  (await provider()).listSocietyClaimQueue(opts);

/**
 * Approve or reject one claim, **keyed by the claim's id, not the society slug** — a society can
 * have several claims filed over time. 409 once decided; approving grants authority atomically.
 */
export const decideSocietyClaim = async (id, body) =>
  (await provider()).decideSocietyClaim(id, body);

/**
 * One short-lived link to a claim's registration certificate, minted when an operator clicks and
 * keyed by the claim rather than the document: docs/flows/consumer/societies.md
 */
export const getSocietyClaimCertificate = async (claimId) =>
  (await provider()).getSocietyClaimCertificate(claimId);

/* --- community minting ------------------------------------------------------------------------ */

/**
 * Add a society the catalogue does not have. Resolves `{ society, created }`; `created` is false
 * when the name already matched one, which is not an error — the screen just says so honestly.
 */
export const mintSociety = async (body) => (await provider()).mintSociety(body);

/** Member-added societies nobody has checked yet, oldest first — the counterpart of the mint. */
export const listSocietyCandidates = async (opts) => (await provider()).listSocietyCandidates(opts);

/**
 * Confirm a member-added society is real. Leaves `registration` and `conveyance` alone: those are
 * the building's legal paperwork, not our confidence in the record. 409 once somebody has verified.
 */
export const verifySocietyCandidate = async (slug) =>
  (await provider()).verifySocietyCandidate(slug);

/**
 * Societies a queued candidate may be a copy of, strongest first — a hint, never an action, drawn
 * from the server's catalogue so a candidate duplicating a candidate is not reported as clean.
 */
export const listSocietyCandidateDuplicates = async (slug, opts) =>
  (await provider()).listSocietyCandidateDuplicates(slug, opts);

/**
 * Society merges currently in force, newest first — the other way round from the queues beside it,
 * because this is a record of decisions taken and the interesting one is the one just made.
 */
export const listSocietyMerges = async (opts) => (await provider()).listSocietyMerges(opts);

/**
 * Record that one society is a duplicate of another. A merge is a pointer, not a move — the
 * duplicate keeps everything and the reads union it onto the survivor, which is what makes it undoable.
 */
export const mergeSocieties = async (from, into) => (await provider()).mergeSocieties(from, into);

/**
 * Undo a merge, addressed by the society that was **merged away**: a survivor can have absorbed
 * several duplicates, so "undo the merge on this society" would resolve to the wrong one.
 */
export const undoSocietyMerge = async (slug) => (await provider()).undoSocietyMerge(slug);

/**
 * One society as the back-office editor needs it. Its reason for existing is `adminNote`, kept off
 * the public payload because it is moderator prose about a named building.
 */
export const getSocietyAdminView = async (slug) => (await provider()).getSocietyAdminView(slug);

/**
 * Correct one society's own facts. Truly partial — the row carries columns this form never showed.
 * `adminNote` is the one field where `''` clears and `undefined` leaves; do not coalesce the two.
 */
export const editSociety = async (slug, patch) => (await provider()).editSociety(slug, patch);
