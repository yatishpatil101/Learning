/**
 * Wire → view-model mappers for the **ops half** of the flatmates domain.
 *
 * Separate from `flatmateMapper.js` because these four payloads are never rendered by a consumer.
 * They are only ever served to staff on `/admin/**` routes, and they carry facts — an author's
 * unvalidated free text, an uploaded rent agreement — that the consumer mappers are careful never
 * to expose. Keeping them apart makes "could a visitor see this?" answerable by looking at which
 * file a field came out of.
 *
 * ## The two axes are not the same question (and must not be merged)
 *
 * `FlatmateModerationService`'s javadoc is emphatic about this and the mappers preserve it:
 *
 *   **Verification** (`FlatmateReview`) — *has this host proved what they claimed?* Its outcome is
 *   a badge. A post that fails stays visible, because an unproven claim is not abuse.
 *
 *   **Moderation** (`modStatus`) — *may this post be published at all?* Its outcome is visibility.
 *   A post that fails is hidden, and that says nothing about whether the host's paperwork is real.
 *
 * A single "status" column over both would be a screen that cannot tell "we could not verify your
 * agreement" from "we took your post down", which are different things to be told.
 *
 * ## Leaf module
 *
 * No imports, deliberately — see `flatmateMapper.js`'s header and D208. Anything these mappers
 * need is computed here or passed in.
 */

/** Wire timestamps are ISO-8601; the UI works in epoch ms. Absent stays absent. */
const epoch = (iso) => (iso ? Date.parse(iso) : null);

/** Trim to null so `''` and absent render identically rather than as an empty element. */
const text = (v) => {
  const s = String(v ?? '').trim();
  return s || null;
};

/**
 * One row of the host-verification queue (`GET /admin/flatmate-reviews`).
 *
 * ### `hostMobile` is unmasked on the wire and we mask it here
 *
 * `FlatmateReviewDto`'s javadoc calls this out as a deliberate exception: the route is staff-only
 * and the argument was that ops cannot check a rent agreement without being able to ring the person
 * who uploaded it. The desk does not take that offer. Nothing on this screen rings anybody — the
 * decision is made against the document — so a full number on every row of a paged queue would be a
 * bulk contact list earned for nothing. The mask is applied here rather than in the page so it
 * cannot be forgotten by the next surface that reads this queue.
 *
 * The sibling queue agrees, from the other direction: `FlatmateModerationQueueDto` omits the
 * author's mobile entirely, for exactly this reason.
 *
 * ### `agreementDoc` is whatever the consumer posted
 *
 * It is a free-form JSONB column, and the consumer's `readAgreementDoc` fills it with
 * `{ name, size, mime, dataUrl }` — the whole file, base64'd, up to 3 MB. Over that cap it arrives
 * as `{ name, size, mime, dataUrl: null, tooLarge: true }` and the desk can only see that a
 * document exists. Both shapes are passed through untouched; `viewable` is the honest predicate for
 * "there is something to open".
 */
export function toReviewViewModel(row) {
  const doc = row?.agreementDoc || null;
  return {
    id: row?.id || '',
    // `room` | `group` — which supply table the reviewed post lives in.
    kind: row?.kind || 'room',
    roomId: row?.roomId || null,
    groupId: row?.groupId || null,
    host: text(row?.host),
    hostMobile: maskMobile(row?.hostMobile),
    address: text(row?.address),
    // `identity` | `tenant` | `owner` — the trust tier the post is claiming.
    tier: row?.tier || 'identity',
    // True when a different host already claimed this address. Not a verdict, a reason to look.
    flagForReview: !!row?.flagForReview,
    ownerConsent: !!row?.ownerConsent,
    agreementDoc: doc,
    agreementViewable: !!doc?.dataUrl,
    agreementTooLarge: !!doc?.tooLarge,
    // `pending` | `approved` | `rejected` (FlatmateVocabulary.REVIEW_STATUS).
    status: row?.status || 'pending',
    reason: text(row?.reason),
    createdAt: epoch(row?.createdAt),
    updatedAt: epoch(row?.updatedAt),
  };
}

/**
 * Last four digits only, in the platform's house format.
 *
 * Deliberately not reversible and not toggleable: there is no server-side disclosure endpoint
 * behind this queue, so a "Reveal" button could only un-hide something the client already holds,
 * which is theatre with an audit-shaped hole where the audit row should be.
 */
function maskMobile(digits) {
  const s = String(digits || '');
  return s.length >= 4 ? `••••• ${s.slice(-4)}` : null;
}

/**
 * One row of the D72 post-moderation backlog (`GET /admin/flatmates/moderation`).
 *
 * `freeText` is the point of the screen, not a detail of it. D72 exists because `title`, `note` and
 * `locality` are unbounded strings, and a broker who cannot publish a phone number in the contact
 * field will type it into one of those instead. A row that showed only a headline and a locality
 * would pass through exactly the abuse the queue was built to catch, so the page renders `freeText`
 * in full and never truncates it.
 */
export function toModerationRowViewModel(row) {
  return {
    id: row?.id || '',
    // `post` | `room` | `group` — one shape over three tables, so the desk asks one question.
    kind: row?.kind || 'post',
    // `pending` | `live` | `approved` | `flagged` | `removed` | `rejected`.
    modStatus: row?.modStatus || 'pending',
    authorId: row?.authorId || null,
    authorName: text(row?.authorName),
    headline: text(row?.headline),
    locality: text(row?.locality),
    freeText: text(row?.freeText),
    createdAt: epoch(row?.createdAt),
  };
}

/**
 * One row of the group-application board (`GET /admin/group-applications`).
 *
 * **Two statuses, and only one of them is ours.** `status` is the *owner's* accept/decline and this
 * desk may never write it; `modStatus` is the admin's axis. `PATCH .../{id}` reaches only the
 * second — `FlatmateGroupApplication#moderate` cannot touch the first at all — because "we took
 * this down" and "the owner said no" are different facts and taking one down must not forge the
 * other. The view model keeps both fields and both names for that reason.
 *
 * `rent` and `perHead` are joined from the live listing on every read rather than stored, so the
 * board can never show a price that stopped being true when the owner edited their listing.
 */
export function toGroupApplicationViewModel(row) {
  return {
    id: row?.id || '',
    listingId: row?.listingId || null,
    listingTitle: text(row?.listingTitle),
    locality: text(row?.locality),
    rent: row?.rent ?? null,
    perHead: row?.perHead ?? null,
    groupTitle: text(row?.groupTitle),
    applicantName: text(row?.applicantName),
    members: Number(row?.members) || 0,
    seatsTotal: Number(row?.seatsTotal) || 0,
    // The OWNER's decision: `pending` | `accepted` | `declined`. Read-only here.
    status: row?.status || 'pending',
    // The ADMIN's decision — the only field this desk writes.
    modStatus: row?.modStatus || 'pending',
    at: epoch(row?.at),
  };
}

/** Map a `PageResponse` through `fn`, keeping the envelope the pages page on. */
export const toViewModelPage = (unwrapped, fn) => ({
  ...unwrapped,
  items: (unwrapped?.items || []).map(fn),
});
