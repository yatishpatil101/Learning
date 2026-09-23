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

// A photo string is typed by the host, and the desk renders a rejected host's pictures as clickable
// links — `javascript:` would run under the admin origin's `'unsafe-inline'` script-src.
const httpUrl = (v) => {
  const s = text(v);
  return s && /^https?:\/\//i.test(s) ? s : null;
};

// `hostMobile` arrives already masked from the server, so it is passed straight through — re-masking
// a mask would render `••••• X210`. There is deliberately no "Reveal": no endpoint discloses the rest.

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
    agreementRegNo: text(row?.agreementRegNo),
    agreementRegisteredOn: text(row?.agreementRegisteredOn),
    agreementValidTill: text(row?.agreementValidTill),
    // `pending` | `approved` | `rejected` (FlatmateVocabulary.REVIEW_STATUS).
    status: row?.status || 'pending',
    reason: text(row?.reason),
    createdAt: epoch(row?.createdAt),
    updatedAt: epoch(row?.updatedAt),
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
    authorId: row?.authorId || null,
    authorName: text(row?.authorName),
    headline: text(row?.headline),
    locality: text(row?.locality),
    freeText: text(row?.freeText),
    // A room's own pictures — the half of a post that cannot be judged by reading it.
    photos: Array.isArray(row?.photos) ? row.photos.map(httpUrl).filter(Boolean) : [],
    // Which fields were edited after approval, and when — null when nothing is awaiting a re-read.
    recheckReason: text(row?.recheckReason),
    recheckRequestedAt: epoch(row?.recheckRequestedAt),
    createdAt: epoch(row?.createdAt),
  };
}

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
