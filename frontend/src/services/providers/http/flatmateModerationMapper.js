// Ops-only payloads, kept apart from `flatmateMapper.js` so "could a visitor see this?" is
// answerable by which file a field came out of. Leaf module: no imports, deliberately.

// Verification (`FlatmateReview`, "did the host prove it?" → a badge) and moderation (`modStatus`,
// "may this be published?" → visibility) are different axes and must never merge into one column.

/** Wire timestamps are ISO-8601; the UI works in epoch ms. Absent stays absent. */
const epoch = (iso) => (iso ? Date.parse(iso) : null);

/** Trim to null so `''` and absent render identically rather than as an empty element. */
const text = (v) => {
  const s = String(v ?? '').trim();
  return s || null;
};

const httpUrl = (v) => {
  const s = text(v);
  return s && /^(https?:\/\/|\/(?![/\\]))/i.test(s) ? s : null;
};

// `agreementDoc` is free-form JSONB holding the consumer's base64 file, or `{ tooLarge: true }`
// above 3 MB. Both shapes pass through untouched; `viewable` is the honest predicate.
export function toReviewViewModel(row) {
  const doc = row?.agreementDoc || null;
  return {
    id: row?.id || '',
    // `room` | `group` — which supply table the reviewed post lives in.
    kind: row?.kind || 'room',
    roomId: row?.roomId || null,
    groupId: row?.groupId || null,
    host: text(row?.host),
    hostMobile: text(row?.hostMobile),
    address: text(row?.address),
    // `identity` | `tenant` | `owner` — the trust tier the post is claiming.
    tier: row?.tier || 'identity',
    // True when a different host already claimed this address. Not a verdict, a reason to look.
    flagForReview: !!row?.flagForReview,
    ownerConsent: !!row?.ownerConsent,
    agreementDoc: doc,
    agreementViewable: !!doc?.dataUrl,
    agreementTooLarge: !!doc?.tooLarge,
    // The sub-registrar's particulars, which is what the desk can check against the IGR portal.
    // Not masked: a registration number is a public record.
    agreementValidTill: text(row?.agreementValidTill),
    // `pending` | `approved` | `rejected` (FlatmateVocabulary.REVIEW_STATUS).
    status: row?.status || 'pending',
    reason: text(row?.reason),
    createdAt: epoch(row?.createdAt),
    updatedAt: epoch(row?.updatedAt),
  };
}

/** A card on the verification desk. The agreement file and the host's number come with the popup's
 * detail read, so a row carries neither. */
export function toReviewRowViewModel(row) {
  return {
    id: row?.id || '',
    kind: row?.kind || 'room',
    roomId: row?.roomId || null,
    groupId: row?.groupId || null,
    host: text(row?.host),
    address: text(row?.address),
    tier: row?.tier || 'identity',
    flagForReview: !!row?.flagForReview,
    ownerConsent: !!row?.ownerConsent,
    createdAt: epoch(row?.createdAt),
  };
}

// `freeText` is the point of the screen: `title`, `note` and `locality` are unbounded, and a broker
// blocked from the contact field types the number into one of those. Never truncate it.
export function toModerationRowViewModel(row) {
  return {
    id: row?.id || '',
    // `post` | `room` | `group` — one shape over three tables, so the desk asks one question.
    kind: row?.kind || 'post',
    // `pending` | `live` | `approved` | `flagged` | `removed` | `rejected`.
    modStatus: row?.modStatus || 'pending',
    authorName: text(row?.authorName),
    headline: text(row?.headline),
    locality: text(row?.locality),
    freeText: text(row?.freeText),
    // A card counts a room's pictures; the popup's `item` lists them (`toModerationItemViewModel`).
    photoCount: Number(row?.photoCount) || 0,
    // Which fields were edited after approval, and when — null when nothing is awaiting a re-read.
    recheckReason: text(row?.recheckReason),
    recheckRequestedAt: epoch(row?.recheckRequestedAt),
    createdAt: epoch(row?.createdAt),
  };
}

/** The same row plus the pictures themselves, the half of a post that cannot be judged by reading it. */
export const toModerationItemViewModel = (item) => ({
  ...toModerationRowViewModel(item),
  photos: Array.isArray(item?.photos) ? item.photos.map(httpUrl).filter(Boolean) : [],
});

/** What each tab's label shows. */
export const toModerationSummaryViewModel = (res) => ({
  pending: Number(res?.pending) || 0,
  published: Number(res?.published) || 0,
  hidden: Number(res?.hidden) || 0,
});

// **Two statuses, and only one is ours**: `status` is the owner's accept/decline and this desk may
// never write it; `modStatus` is the admin axis `PATCH .../{id}` reaches. Both names are kept.

// `rent` and `perHead` are joined from the live listing on every read, so the board can never show
// a price that stopped being true when the owner edited.
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
