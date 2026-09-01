/**
 * Mock society provider — the localStorage counterpart to `providers/http/societyProvider.js`.
 *
 * The rating aggregate is derived from `pnEntityReviews` (`lib/store/reviews.js`), the same bucket
 * the society hub's composer writes through the review seam. Derived rather than stored, for the
 * reason the mock review provider gives at length: a stored aggregate is a second copy of the
 * truth that drifts the first time something writes a review without updating it.
 *
 * Two details exist purely to keep the mock from being kinder than the server:
 *
 *   - **`avg` is null at zero reviews**, not 0. The card only reads it past a `count > 0` gate, so
 *     a 0 would never render — it would just remove the reason the gate exists, and the day
 *     something drops the gate the mock would keep looking fine while live rendered a one-star
 *     society. This is also where the old `entityRating` differed: it returned `{ avg: 0 }`.
 *   - **`toFixed(1)`, not `Math.round(n * 10) / 10`.** The server rounds a `BigDecimal` HALF_UP via
 *     its decimal string and the multiply-round form disagrees with that at binary-float ties: 81/20
 *     is 4.05, whose `* 10` is 40.499999999999993, so it rounds down to 4.0 where the server says
 *     4.1. `entityRating` used the multiply-round form.
 *
 * Only societies with at least one review appear in the index — absent, not zero — because that is
 * what the http provider cannot help doing (the server omits unrated societies from the grouped
 * aggregate) and the seam's job is to make the two indistinguishable to the caller.
 */
import { allEntityReviews } from '../../../lib/store/reviews.js';
import { getDocsForProp } from '../../../lib/data/documents.js';
import { myMobile } from '../../../lib/contact.js';
import {
  addBoardItem,
  addContributionReply as addContributionReplyToStore,
  addSocietyAnswer,
  addSocietyContribution as addSocietyContributionToStore,
  addSocietyQuestion,
  getFollowedSocieties,
  getSocietyBoard,
  getSocietyContributions,
  getSocietyQA,
  isSocietyFollowed,
  removeBoardItem as removeBoardItemFromStore,
  removeContributionReply as removeContributionReplyFromStore,
  removeSocietyContribution as removeSocietyContributionFromStore,
  toggleContributionHelpful,
  toggleFollowSociety,
} from '../../../lib/store/society.js';
import {
  applySocietySuggestion,
  dismissSocietySuggestion,
  getPendingSocietySuggestions,
  getResidentReqs,
  getSocietyCandidates,
  getSocietyClaim,
  getSocietyClaims,
  getSocietyMergeMeta,
  getSocietyMerges,
  getSocietyOverlay,
  getSocietySuggestion,
  isSocietyAdmin,
  isVerifiedResident,
  mergeSocieties as mergeSocietiesLocal,
  requestResidentVerification,
  requestSocietyClaim,
  residentStatus,
  resolveSociety,
  setResidentStatus,
  setSocietyClaimStatus,
  setSocietyOverlay,
  suggestDuplicates,
  suggestSocietyDetails,
  undoSocietyMerge as undoSocietyMergeLocal,
  verifyCommunitySociety,
} from '../../../lib/store/societyAdmin.js';
import { addCommunitySociety, searchSocieties as searchSocietiesLocal } from '../../../lib/store/community.js';
import { allSocieties, ensureSocietyCatalogue, slugifySociety, societyBySlug } from '../../../data/societies.js';
import {
  getSocietyLocationFix,
  getSocietyWhatsappJoin,
  getSocietyWhatsappRaw,
  hasSocietyWhatsapp,
  moderateSocietyLocation,
  moderateSocietyWhatsapp,
  pendingSocietyLocationFixes,
  pendingSocietyWhatsapps,
  proposeSocietyLocation,
  proposeSocietyWhatsapp,
} from '../../../lib/store/societyMod.js';

/** One decimal, rounded the way the server's `BigDecimal.setScale(1, HALF_UP)` rounds. */
const round1 = (n) => Number(n.toFixed(1));

const PREFIX = 'society:';

export async function listSocietyRatings() {
  const index = {};
  for (const [key, reviews] of Object.entries(allEntityReviews())) {
    if (!key.startsWith(PREFIX) || !Array.isArray(reviews) || !reviews.length) continue;
    const sum = reviews.reduce((a, r) => a + (Number(r?.rating) || 0), 0);
    index[key.slice(PREFIX.length)] = {
      avg: round1(sum / reviews.length),
      count: reviews.length,
    };
  }
  return index;
}

/**
 * Ranked type-ahead candidates, from the bundled catalogue plus this browser's community rows.
 *
 * Returns `lib/store`'s existing result unchanged — already name-filtered, already ranked, already
 * capped. The service re-applies its own ranking and moderation filter on top, which costs nothing
 * here because both passes are idempotent, and buys the guarantee that a picker cannot order its
 * suggestions differently depending on which provider answered.
 */
export async function searchSocieties(query, localityLabel = '') {
  return searchSocietiesLocal(query, localityLabel);
}

/**
 * One page of the society directory, sliced by hand so the console pages identically in both modes.
 *
 * The slicing is real rather than "return everything and let the table cut it up". A mock that
 * hands back all 348 rows would make the pager work while hiding the only thing paging changes —
 * that page two is a second request — and the first live load would be the first time anyone
 * discovered the page component had assumed otherwise.
 *
 * `resolveSociety` is layered on for the same reason the console used to do it inline: this
 * provider's edits live in a localStorage overlay, and a row read straight from the bundled
 * catalogue would show the pre-edit values. The http provider needs no equivalent because there
 * the edit is a real column.
 *
 * The `q` filter matches name and builder, mirroring `SocietySpecs.browse`'s `LIKE` over those two
 * columns rather than the ranked type-ahead `searchSocieties` uses — the directory is a filter, not
 * a suggester, and ranking a filtered table would reorder it under the operator.
 *
 * `ensureSocietyCatalogue()` is awaited here rather than gated by the caller. `allSocieties()` is
 * synchronous and answers with the 28 curated rows until the 182 KB MahaRERA chunk lands, so
 * reading it straight would report a 348-society platform as having 28 — and, worse, would report
 * it *once*, with nothing to re-render against. Callers used to hold `useSocietyCatalogue()` for
 * exactly this, which meant every consumer of a paged read had to know that one provider has a
 * lazy chunk and the other does not. The seam owns it: this function is already async, so waiting
 * costs the caller nothing it was not already paying.
 */
export async function listSocietyDirectory({ q = '', locality = '', page = 0, size = 20 } = {}) {
  await ensureSocietyCatalogue();
  const needle = q.trim().toLowerCase();
  const rows = allSocieties()
    .map((s) => resolveSociety(s.slug) || s)
    .filter((s) => {
      if (locality && s.localitySlug !== locality) return false;
      if (!needle) return true;
      return `${s.name || ''} ${s.builder || ''}`.toLowerCase().includes(needle);
    })
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  const from = page * size;
  return { items: rows.slice(from, from + size), page, size, total: rows.length, totalPages: Math.ceil(rows.length / size) };
}

/**
 * The followed slugs, newest first (D227).
 *
 * `pnFollowedSocieties` stays the mock's backing store — that is what a mock provider is for. What
 * changed is who reads it: five surfaces used to call `getFollowedSocieties` directly and are now
 * behind this seam, so the live build can answer the same question from the server.
 *
 * `toggleFollowSociety` already unshifts, so the array is newest-first and matches the server's
 * `order by created_at desc` without sorting anything here.
 */
export async function listFollowedSocieties() {
  return getFollowedSocieties();
}

/**
 * Idempotent follow.
 *
 * The store offers a toggle, not a set, so following one already followed would unfollow it. The
 * guard is not defensive tidiness: the context retries a failed write and the finder follows a
 * society it may have just minted-and-followed, and either would silently undo the follow.
 */
export async function followSociety(slug) {
  if (!isSocietyFollowed(slug)) toggleFollowSociety(slug);
}

/** Idempotent unfollow — same reasoning as {@link followSociety}, in the other direction. */
export async function unfollowSociety(slug) {
  if (isSocietyFollowed(slug)) toggleFollowSociety(slug);
}

/* ------------------------------------------------------ residency and claims (D240) */

/**
 * The store's rows wear different names from the wire, so everything below translates.
 *
 * The store predates the endpoint and calls the same things `at`/`by`/`mobile`; the server sends
 * `createdAt`/`claimantMobile`/`unitKey`. Translating here rather than teaching the hub both
 * vocabularies is the whole point of the seam — the mock's job is to be indistinguishable, not to
 * be convenient.
 *
 * One deliberate difference is preserved rather than papered over: the store's `unitKeyOf` strips
 * only whitespace, while the server also strips `-` and `/`, so `B-704` and `B704` are one flat
 * live and two in the mock. Normalising here would hide that from the mock specs; it is recorded
 * instead, and the mock store is on its way out.
 */
const toResidentWire = (r, slug) => (r && typeof r === 'object' ? {
  id: r.id,
  societySlug: r.slug || slug,
  name: r.name || null,
  mobile: r.mobile || null,
  wing: r.wing || null,
  flat: r.flat || '',
  unitKey: r.unitKey || '',
  relation: r.relation || 'resident',
  status: r.status || 'pending',
  assignedTo: r.assignedTo || 'ops',
  flagged: r.flagged || null,
  note: r.note || null,
  createdAt: r.at ? new Date(r.at).toISOString() : null,
  decidedAt: r.decidedAt ? new Date(r.decidedAt).toISOString() : null,
} : null);

const toClaimWire = (c, society) => (c && typeof c === 'object' ? {
  id: c.id,
  societySlug: c.slug,
  societyName: society?.name || '',
  claimantName: c.name || '',
  claimantMobile: c.by || null,
  role: c.role || null,
  email: c.email || null,
  note: c.note || null,
  /* Both added by V109. `registrationNo` is what the claimant typed; `certificateDocumentId` points
     at a file in this environment's personal vault (`lib/data/documents.js` under the `personal`
     key), written there by the claim form before it files the claim. It is a `d<timestamp>` rather
     than a UUID for the same reason the claim's own id is — it only has to round-trip to
     `getSocietyClaimCertificate`, which is all the server's id has to do either. */
  registrationNo: c.registrationNo || null,
  certificateDocumentId: c.certificateDocumentId || null,
  status: c.status || 'pending',
  createdAt: c.at ? new Date(c.at).toISOString() : null,
  decidedAt: c.decidedAt ? new Date(c.decidedAt).toISOString() : null,
} : null);

/** The store answers a refused write with a string; the server answers with an HTTP status. */
const asApiFailure = (result, message, status) => {
  if (typeof result !== 'string') return null;
  return Object.assign(new Error(message), { status, code: result });
};

export async function getSocietyMembership(slug) {
  const society = resolveSociety(slug);
  const mob = myMobile();
  const claim = getSocietyClaim(slug);
  const live = claim && (claim.status === 'pending' || claim.status === 'approved') ? claim : null;
  return {
    societySlug: slug,
    resident: toResidentWire(residentStatus(slug, mob), slug),
    admin: !!mob && isSocietyAdmin(slug, mob),
    // The mobile and email are stripped for the same reason the server strips them: this read is
    // public, and a mock that is more generous than the server hides the leak until production.
    claim: live ? { ...toClaimWire(live, society), claimantMobile: null, email: null } : null,
    verifiedResidents: getResidentReqs()
      .filter((r) => r.slug === slug && r.status === 'verified').length,
  };
}

export async function requestResidency(slug, body = {}) {
  const result = requestResidentVerification(slug, body);
  const failure = asApiFailure(result, 'Sign in to verify your flat.', 401);
  if (failure) throw failure;
  return toResidentWire(result, slug);
}

export async function listSocietyResidents(slug, { status } = {}) {
  return getResidentReqs()
    .filter((r) => r.slug === slug && (!status || r.status === status))
    .map((r) => toResidentWire(r, slug));
}

export async function decideResidency(slug, residentId, body = {}) {
  // The store keys decisions by mobile; the endpoint keys them by row id, which is the only stable
  // handle a queue row has. Resolving one to the other here keeps the caller on the server's shape.
  const row = getResidentReqs().find((r) => r.id === residentId && r.slug === slug);
  if (!row) throw Object.assign(new Error('Residency request not found'), { status: 404 });
  const result = setResidentStatus(slug, row.mobile, body.status, myMobile());
  const failure = asApiFailure(result, 'Another resident is already verified in this flat.', 409);
  if (failure) throw failure;
  return toResidentWire(result, slug);
}

/**
 * Residency requests across every society, oldest first — the ops queue.
 *
 * `societyName` is the one field this adds over the per-society read, and it is not decoration: a
 * cross-society row saying only "B/704, pending" is not a decision anybody can make. The server
 * joins it; here it is resolved from the catalogue, and falls back to the slug rather than to an
 * empty string so a society the catalogue has not loaded yet still names itself.
 *
 * Oldest first, matching the server: the person who has waited longest is the one somebody is
 * still waiting on. The store appends, so its natural order is already oldest-first, but the sort
 * is explicit because relying on insertion order is how the two environments quietly disagree.
 */
export async function listSocietyResidentQueue({ status } = {}) {
  return getResidentReqs()
    .filter((r) => !status || (r.status || 'pending') === status)
    .map((r) => {
      const row = toResidentWire(r, r.slug);
      return { ...row, societyName: resolveSociety(r.slug)?.name || r.slug || '' };
    })
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

export async function claimSociety(slug, body = {}) {
  const result = requestSocietyClaim({ ...body, slug });
  if (result === 'login') {
    throw Object.assign(new Error('Sign in to claim this society.'), { status: 401 });
  }
  const conflict = asApiFailure(result, 'This society has already been claimed.', 409);
  if (conflict) throw conflict;
  return toClaimWire(result, resolveSociety(slug));
}

/* ------------------------------------------- questions and the noticeboard (D240 C2) */

/**
 * The store stamps `user`, `at` and a frozen `resident` boolean; the wire sends `authorName`,
 * `createdAt` and an `authorIsResident` that is recomputed on every read.
 *
 * The frozen flag is the interesting difference. The store wrote "was this person a resident when
 * they typed" and never revisited it, so a rejected resident's old answers kept the badge forever.
 * The mock re-derives it here from `isVerifiedResident` instead of forwarding `c.resident`, because
 * the badge going stale is precisely the bug the server side fixes and a mock that reproduces the
 * bug would let a spec pass against the broken behaviour.
 */
const authorFields = (row, slug) => ({
  // `A resident` is the server's fallback for an author with no profile name, which is most
  // people on their first visit. The store defaults to `User`; matching the server here keeps a
  // mock spec from asserting a label the live build never produces.
  authorName: row?.user || 'A resident',
  authorIsResident: !!row?.mobile && isVerifiedResident(slug, row.mobile),
  createdAt: row?.at ? new Date(row.at).toISOString() : null,
});

const toAnswerWire = (a, slug, questionId) => ({
  id: a.id,
  questionId,
  body: a.text || '',
  ...authorFields(a, slug),
});

const toQuestionWire = (q, slug) => ({
  id: q.id,
  societySlug: slug,
  body: q.text || '',
  ...authorFields(q, slug),
  // Oldest answer first, matching the server: a reply read before the thing it replies to is
  // unintelligible. The store already appends, so the array is in order.
  answers: (q.answers || []).map((a) => toAnswerWire(a, slug, q.id)),
});

const toBoardWire = (b, slug, mob) => ({
  id: b.id,
  societySlug: slug,
  kind: b.kind || 'notice',
  title: b.title || '',
  body: b.body || null,
  category: b.category || null,
  eventDate: b.kind === 'event' ? (b.date || null) : null,
  eventTime: b.kind === 'event' ? (b.time || null) : null,
  ...authorFields(b, slug),
  // Computed here for the same reason the server computes it: a client deriving "may I delete
  // this" from a display name gets it wrong the moment two residents share one.
  canRemove: !!mob && (b.mobile === mob || isSocietyAdmin(slug, mob)),
});

export async function listSocietyQuestions(slug) {
  return getSocietyQA(slug).map((q) => toQuestionWire(q, slug));
}

export async function askSocietyQuestion(slug, body) {
  const result = addSocietyQuestion(slug, body);
  const failure = asApiFailure(result, 'Sign in to ask a question.', 401);
  if (failure) throw failure;
  if (!result) throw Object.assign(new Error('Write a question first.'), { status: 422 });
  return toQuestionWire(result, slug);
}

export async function answerSocietyQuestion(slug, questionId, body) {
  const result = addSocietyAnswer(slug, questionId, body);
  const failure = asApiFailure(result, 'Sign in to answer.', 401);
  if (failure) throw failure;
  if (!result) throw Object.assign(new Error('Question not found'), { status: 404 });
  // The store returns the whole question; the endpoint returns the answer it just made.
  const answers = result.answers || [];
  return toAnswerWire(answers[answers.length - 1], slug, questionId);
}

export async function listSocietyBoard(slug, { kind } = {}) {
  const mob = myMobile();
  return getSocietyBoard(slug)
    .filter((b) => !kind || b.kind === kind)
    .map((b) => toBoardWire(b, slug, mob));
}

export async function postBoardItem(slug, body = {}) {
  const result = addBoardItem(slug, {
    ...body,
    // The store's field names for the two halves of an event's timing.
    date: body.eventDate || '',
    time: body.eventTime || '',
  });
  const login = asApiFailure(result, 'Sign in to post on this board.', 401);
  if (login && result === 'login') throw login;
  if (result === 'forbidden') {
    throw Object.assign(new Error("Verify your flat to post on this society's board."), { status: 403 });
  }
  if (!result) {
    throw Object.assign(new Error('An event needs a title and a date.'), { status: 400 });
  }
  return toBoardWire(result, slug, myMobile());
}

export async function removeBoardItem(slug, itemId) {
  const result = removeBoardItemFromStore(slug, itemId);
  if (result === 'login') {
    throw Object.assign(new Error('Sign in first.'), { status: 401 });
  }
  if (result === 'forbidden') {
    throw Object.assign(new Error('Only the author, the committee or staff can remove this.'), { status: 403 });
  }
  if (!result) throw Object.assign(new Error('Board item not found'), { status: 404 });
}

/* ------------------------------------------------------ the community tab (D240 C3) */

/**
 * The store keeps a tip's prose in `text`, a pick's in `note` and a photo's in `caption`; the wire
 * has one `body`. They were always the same thing wearing three names — the author's own words —
 * and the structured part (`referralName`, `referralContact`, `photoUrl`) is what actually differs.
 *
 * `helpful` is an array of mobiles in the store and a count plus a per-reader boolean on the wire.
 * The array is the more honest representation and the server keeps it too, as one row per voter;
 * what the wire publishes is the two things the button renders.
 */
const bodyOf = (c) => {
  if (c?.kind === 'pick') return c.note || '';
  if (c?.kind === 'photo') return c.caption || '';
  return c?.text || '';
};

const toReplyWire = (r, slug, contributionId, mob) => ({
  id: r.id,
  contributionId,
  body: r.text || '',
  ...authorFields(r, slug),
  canRemove: !!mob && (r.mobile === mob || isSocietyAdmin(slug, mob)),
});

const toContributionWire = (c, slug, mob) => {
  const helpful = c.helpful || [];
  // The store kept photos as a data URI or a `{dataUrl}` object, which is why a shared photo was
  // only ever visible on the device that shared it. The wire carries a URL, so the mock hands back
  // whatever string it has and nothing else.
  const photo = typeof c.photo === 'string' ? c.photo : c.photo?.dataUrl || null;
  return {
    id: c.id,
    societySlug: slug,
    kind: c.kind || 'tip',
    category: c.category || null,
    body: bodyOf(c) || null,
    referralName: c.kind === 'pick' ? c.name || null : null,
    // Withheld from a reader with no account, exactly as the server withholds it: the number
    // belongs to a third party who never agreed to be on the open web.
    referralContact: c.kind === 'pick' && mob ? c.contact || null : null,
    photoUrl: c.kind === 'photo' ? photo : null,
    ...authorFields(c, slug),
    helpfulCount: helpful.length,
    helpfulByMe: !!mob && helpful.includes(mob),
    canRemove: !!mob && (c.mobile === mob || isSocietyAdmin(slug, mob)),
    replies: (c.replies || []).map((r) => toReplyWire(r, slug, c.id, mob)),
  };
};

export async function listSocietyContributions(slug) {
  const mob = myMobile();
  // The store already sorts most-helpful-then-newest, which is the server's ordering too.
  return getSocietyContributions(slug).map((c) => toContributionWire(c, slug, mob));
}

export async function addSocietyContribution(slug, body = {}) {
  const result = addSocietyContributionToStore(slug, {
    ...body,
    // The store's per-kind field names for what the wire calls one `body`.
    text: body.body || '',
    note: body.body || '',
    caption: body.body || '',
    name: body.referralName || '',
    contact: body.referralContact || '',
    photo: body.photoUrl || null,
  });
  const failure = asApiFailure(result, 'Sign in to share something.', 401);
  if (failure) throw failure;
  if (!result) {
    throw Object.assign(new Error('A tip needs words, a pick needs a name, a photo needs a photo.'), {
      status: 400,
    });
  }
  return toContributionWire(result, slug, myMobile());
}

export async function removeSocietyContribution(slug, contributionId) {
  const result = removeSocietyContributionFromStore(slug, contributionId);
  if (result === 'login') throw Object.assign(new Error('Sign in first.'), { status: 401 });
  if (result === 'forbidden') {
    throw Object.assign(new Error('You can only remove your own contribution.'), { status: 403 });
  }
  if (!result) throw Object.assign(new Error('Contribution not found.'), { status: 404 });
}

/**
 * The store has one toggle; the wire has two idempotent verbs.
 *
 * Translated rather than forwarded: the store flips whatever state it finds, so calling it with
 * `helpful: true` on an already-voted row would un-vote. Reading the current state first and
 * toggling only on a genuine difference is what makes the mock behave like the endpoint it stands
 * in for — which matters, because a retried request producing the wrong state is the exact bug the
 * two-verb design exists to prevent.
 */
export async function setContributionHelpful(slug, contributionId, helpful) {
  const mob = myMobile();
  const current = getSocietyContributions(slug).find((c) => c.id === contributionId);
  if (!current) throw Object.assign(new Error('Contribution not found.'), { status: 404 });
  const already = !!mob && (current.helpful || []).includes(mob);
  if (already !== !!helpful) {
    const result = toggleContributionHelpful(slug, contributionId);
    const failure = asApiFailure(result, 'Sign in to mark this helpful.', 401);
    if (failure) throw failure;
  } else if (!mob) {
    throw Object.assign(new Error('Sign in to mark this helpful.'), { status: 401 });
  }
  const after = getSocietyContributions(slug).find((c) => c.id === contributionId);
  return {
    helpfulCount: (after?.helpful || []).length,
    helpfulByMe: !!helpful,
  };
}

export async function addContributionReply(slug, contributionId, body) {
  const result = addContributionReplyToStore(slug, contributionId, body);
  const failure = asApiFailure(result, 'Sign in to reply.', 401);
  if (failure) throw failure;
  if (!result) throw Object.assign(new Error('Write something first.'), { status: 400 });
  return toReplyWire(result, slug, contributionId, myMobile());
}

export async function removeContributionReply(slug, contributionId, replyId) {
  const result = removeContributionReplyFromStore(slug, contributionId, replyId);
  if (result === 'login') throw Object.assign(new Error('Sign in first.'), { status: 401 });
  if (result === 'forbidden') {
    throw Object.assign(new Error('You can only remove your own reply.'), { status: 403 });
  }
  if (!result) throw Object.assign(new Error('Reply not found.'), { status: 404 });
}

/* ------------------------------------------- community proposals (D241 C4) */

/**
 * The store keeps three shapes in three keys; the wire is one flat proposal.
 *
 * `id` is synthesised from the slug and the kind because the store has no ids — it keys everything
 * by slug, one record per kind, which is the same "one pending per society per kind" rule the
 * server keeps with a partial unique index. Synthesising rather than inventing a random id matters:
 * the ops console patches by id, and an id that changes between two reads would make the second
 * decision 404.
 */
const proposalId = (slug, kind) => `${slug}::${kind}`;

const toProposalWire = (rec, slug, kind, extra = {}) => (rec ? {
  id: proposalId(slug, kind),
  societySlug: slug,
  /* The society restated on the proposal, matching the server. A proposal references a society and
     does not, strictly, need to repeat it — but the ops queue renders the name beside every row,
     and the console used to resolve it from the bundled catalogue, which has none of the
     member-added societies these proposals are most often filed against. */
  societyName: (resolveSociety(slug) || societyBySlug(slug))?.name || null,
  localitySlug: (resolveSociety(slug) || societyBySlug(slug))?.localitySlug || null,
  kind,
  status: rec.status || 'pending',
  builder: null,
  buildYear: null,
  towers: null,
  units: null,
  maintenancePerSqft: null,
  amenities: null,
  inviteUrl: null,
  lat: null,
  lng: null,
  placeId: null,
  label: null,
  authorName: rec.by || null,
  authorIsResident: !!rec.mobile && isVerifiedResident(slug, rec.mobile),
  decidedByName: rec.moderatedBy || rec.appliedBy || null,
  decidedAt: rec.moderatedAt || rec.appliedAt
    ? new Date(rec.moderatedAt || rec.appliedAt).toISOString()
    : null,
  createdAt: rec.at ? new Date(rec.at).toISOString() : null,
  ...extra,
} : null);

/** A details suggestion. The store nests the payload under `fields`; the wire is flat. */
const toDetailsWire = (rec, slug) => toProposalWire(rec, slug, 'details', {
  builder: rec?.fields?.builder ?? null,
  // The store's key is `year`, matching the society column; the wire says `buildYear`, because
  // `year` on a flat proposal reads as the year of the proposal.
  buildYear: rec?.fields?.year ?? null,
  towers: rec?.fields?.towers ?? null,
  units: rec?.fields?.units ?? null,
  maintenancePerSqft: rec?.fields?.maintenancePerSqft ?? null,
  amenities: rec?.fields?.amenities ?? null,
  // The store has no `by` name for a suggestion, only a mobile — and a mobile must never reach the
  // wire, so this reads as an anonymous neighbour rather than as a phone number.
  authorName: rec?.by ? 'A resident' : null,
  authorIsResident: !!rec?.by && isVerifiedResident(slug, rec.by),
});

const toWhatsappWire = (rec, slug, { reveal }) =>
  toProposalWire(rec, slug, 'whatsapp', { inviteUrl: reveal ? rec?.url ?? null : null });

const toLocationWire = (rec, slug) => toProposalWire(rec, slug, 'location', {
  lat: rec?.lat ?? null,
  lng: rec?.lng ?? null,
  placeId: rec?.placeId || null,
  label: rec?.label || null,
});

export async function getSocietyProposals(slug) {
  const mob = myMobile();
  const insider = !!mob && (isVerifiedResident(slug, mob) || isSocietyAdmin(slug, mob));

  const details = getSocietySuggestion(slug);
  const whatsapp = getSocietyWhatsappRaw(slug);
  const location = getSocietyLocationFix(slug);

  const pending = [];
  if (details && details.status === 'pending') pending.push(toDetailsWire(details, slug));
  if (whatsapp && whatsapp.status === 'pending') {
    pending.push(toWhatsappWire(whatsapp, slug, { reveal: insider }));
  }
  if (location && location.status === 'pending') pending.push(toLocationWire(location, slug));

  const join = getSocietyWhatsappJoin(slug);
  return {
    pending,
    // Existence is public; the invite is not. The store draws that line in two functions and the
    // server draws it in one response, so both halves are read here rather than derived from
    // whichever one happened to be handy.
    whatsappAvailable: hasSocietyWhatsapp(slug),
    whatsappJoinUrl: join ? join.url : null,
  };
}

export async function proposeSocietyChange(slug, body = {}) {
  const kind = body.kind;

  if (kind === 'details') {
    const result = suggestSocietyDetails(slug, {
      builder: body.builder,
      year: body.buildYear,
      towers: body.towers,
      units: body.units,
      maintenancePerSqft: body.maintenancePerSqft,
      amenities: body.amenities,
    }, myMobile());
    // The store answers null both for "nothing usable survived" and for "no slug". The server
    // distinguishes them (400 vs 404); here the caller always has a slug, so a null is the empty
    // suggestion the server refuses with 400.
    if (!result) throw Object.assign(new Error('Add at least one detail to suggest.'), { status: 400 });
    return toDetailsWire(result, slug);
  }

  if (kind === 'whatsapp') {
    const result = proposeSocietyWhatsapp(slug, body.inviteUrl);
    if (result === 'login') throw Object.assign(new Error('Sign in first.'), { status: 401 });
    if (result === 'forbidden') {
      throw Object.assign(
        new Error('Only verified residents or the committee can add the group link.'),
        { status: 403 },
      );
    }
    if (result === 'badurl') {
      throw Object.assign(new Error('Enter a valid WhatsApp invite link.'), { status: 400 });
    }
    // The author is shown their own link back: the gate exists to stop non-residents *learning*
    // it, and they just typed it.
    return toWhatsappWire(result, slug, { reveal: true });
  }

  if (kind === 'location') {
    const result = proposeSocietyLocation(slug, {
      lat: body.lat, lng: body.lng, placeId: body.placeId, label: body.label,
    });
    if (result === 'login') throw Object.assign(new Error('Sign in first.'), { status: 401 });
    if (result === 'forbidden') {
      throw Object.assign(
        new Error('Only verified residents or the committee can suggest the location.'),
        { status: 403 },
      );
    }
    if (result === 'bounds') {
      throw Object.assign(new Error('That pin looks outside the city.'), { status: 400 });
    }
    return toLocationWire(result, slug);
  }

  throw Object.assign(
    new Error("A proposal is about this society's details, its group link or its location."),
    { status: 400 },
  );
}

export async function listSocietyProposalQueue({ status, kind } = {}) {
  // Only pending rows are enumerable: the store's three queue readers all filter to pending, and a
  // decided row is only reachable by slug. Asking for a decided queue answers empty rather than
  // silently returning the pending one, which would tell an operator a rejected link is still live.
  const wantPending = !status || status === 'pending';
  if (!wantPending) return [];

  const rows = [];
  if (!kind || kind === 'details') {
    getPendingSocietySuggestions().forEach((s) => rows.push(toDetailsWire(s, s.slug)));
  }
  if (!kind || kind === 'whatsapp') {
    // Revealed here and nowhere else, matching the server: screening the link for a scam is the
    // whole point of the review.
    pendingSocietyWhatsapps().forEach((w) => rows.push(toWhatsappWire(w, w.slug, { reveal: true })));
  }
  if (!kind || kind === 'location') {
    pendingSocietyLocationFixes().forEach((l) => rows.push(toLocationWire(l, l.slug)));
  }

  // Oldest first, like the server: the proposal that has waited longest is the one somebody is
  // still waiting on.
  rows.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  // A flat array, because that is what `unwrapFullPage` hands back on the live side. This used to
  // answer `{ items, total }`: harmless while nothing consumed it, and a `.map is not a function`
  // on exactly one of the two providers the moment something did.
  return rows;
}

export async function decideSocietyProposal(id, body = {}) {
  const at = String(id).lastIndexOf('::');
  if (at < 0) throw Object.assign(new Error('Proposal not found.'), { status: 404 });
  const slug = String(id).slice(0, at);
  const kind = String(id).slice(at + 2);
  const approve = body.status === 'approved';
  if (!approve && body.status !== 'rejected') {
    throw Object.assign(new Error('A decision is either approved or rejected.'), { status: 400 });
  }

  if (kind === 'details') {
    const current = getSocietySuggestion(slug);
    if (!current) throw Object.assign(new Error('Proposal not found.'), { status: 404 });
    if (current.status !== 'pending') {
      throw Object.assign(new Error('This proposal has already been decided.'), { status: 409 });
    }
    // The store's own vocabulary is applied/dismissed; the wire's is approved/rejected. Applying
    // writes an overlay, which is this environment's stand-in for the server's write onto the
    // society row itself.
    if (approve) applySocietySuggestion(slug, myMobile());
    else dismissSocietySuggestion(slug);
    return toDetailsWire(
      { ...getSocietySuggestion(slug), status: approve ? 'approved' : 'rejected' },
      slug,
    );
  }

  if (kind === 'whatsapp' || kind === 'location') {
    const read = kind === 'whatsapp' ? getSocietyWhatsappRaw : getSocietyLocationFix;
    const current = read(slug);
    if (!current) throw Object.assign(new Error('Proposal not found.'), { status: 404 });
    if (current.status !== 'pending') {
      throw Object.assign(new Error('This proposal has already been decided.'), { status: 409 });
    }
    const moderate = kind === 'whatsapp' ? moderateSocietyWhatsapp : moderateSocietyLocation;
    const result = moderate(slug, approve ? 'approve' : 'reject');
    if (result === 'forbidden') {
      throw Object.assign(new Error('Only ops can decide this.'), { status: 403 });
    }
    if (!result) throw Object.assign(new Error('Proposal not found.'), { status: 404 });
    return kind === 'whatsapp'
      ? toWhatsappWire(result, slug, { reveal: true })
      : toLocationWire(result, slug);
  }

  throw Object.assign(new Error('Proposal not found.'), { status: 404 });
}

/* --- society claims: the ops side ------------------------------------------------------------- */

/**
 * The claim queue, oldest first.
 *
 * Two differences from the live queue, neither hideable, both a consequence of the store keeping
 * **one claim per society keyed by slug** where the server keeps every claim ever filed:
 *
 * - *History does not exist here.* Re-claiming a society after a rejection overwrites the rejected
 *   record rather than adding a second row, so this queue can never show the same society twice.
 * - *`id` is the store's `sc<timestamp>`, not a UUID.* It only has to round-trip to
 *   `decideSocietyClaim`, which is exactly what the server's id has to do.
 *
 * `regNo` used to be a third: the claim form collected it into localStorage and the wire had no
 * field for it. V109 gave it one, so it now travels. The scanned certificate travels too, as an id
 * the operator dereferences through `getSocietyClaimCertificate` — not as a link on the row, which
 * is the same shape the server refuses for the same reason.
 */
export async function listSocietyClaimQueue({ status } = {}) {
  return getSocietyClaims()
    .filter((c) => !status || (c.status || 'pending') === status)
    .map((c) => toClaimWire(c, resolveSociety(c.slug)))
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

/**
 * Approve or reject one claim, by id.
 *
 * The store decides by slug — `setSocietyClaimStatus(slug, status, by)` — because it holds one
 * claim per society and the slug was therefore unique enough. The endpoint decides by the claim's
 * own id, which stays unique when the server holds four. Resolving the id back to a slug here is
 * the same trick `decideResidency` plays for residency rows, and it keeps the caller writing
 * against the server's shape rather than against this environment's shortcut.
 *
 * `body.note` is accepted and dropped: the store has nowhere to put a reviewer's reason — its
 * `note` field is the claimant's own — and the server keeps it with the decision, not on the row
 * the queue reads back. Writing it into `note` here would show the operator their own words as if
 * the committee had typed them.
 */
export async function decideSocietyClaim(id, body = {}) {
  const row = getSocietyClaims().find((c) => c.id === id);
  if (!row) throw Object.assign(new Error('Claim not found.'), { status: 404 });
  if (body.status !== 'approved' && body.status !== 'rejected') {
    throw Object.assign(new Error('A decision is either approved or rejected.'), { status: 400 });
  }
  if (row.status && row.status !== 'pending') {
    throw Object.assign(new Error('This claim has already been decided.'), { status: 409 });
  }
  // `by` is the deciding operator. The store wants a mobile; the server takes it from the token.
  const result = setSocietyClaimStatus(row.slug, body.status, myMobile());
  if (!result) throw Object.assign(new Error('Claim not found.'), { status: 404 });
  return toClaimWire(result, resolveSociety(row.slug));
}

/**
 * The certificate attached to one claim, resolved the way the server resolves it.
 *
 * **The claim is the only input.** The store's `personal` vault holds whatever this browser has
 * uploaded — in the live build that is somebody's Aadhaar and salary slips — so a mock that took a
 * document id would be modelling a route the server deliberately does not expose, and any screen
 * built against it would be built against a shape that cannot ship. The document id is read off the
 * claim row and then checked against the claimant's own vault, which is the same two locks.
 *
 * `url` is the stored `dataUrl`, which is genuinely openable here. It is null for a file the store
 * kept only metadata for (over its 3 MB inline cap) — the honest answer, and the same one the live
 * build gives in dev, where signed URLs are not configured.
 */
export async function getSocietyClaimCertificate(claimId) {
  const claim = getSocietyClaims().find((c) => c.id === claimId);
  // One 404 for "no such claim", "no certificate" and "the pointer does not resolve". Telling them
  // apart would make this an oracle for which vault documents exist, which is the distinction the
  // server refuses to draw.
  const missing = () => Object.assign(new Error('Certificate not found.'), { status: 404 });
  if (!claim || !claim.certificateDocumentId) throw missing();
  const doc = getDocsForProp(claim.by, 'personal')
    .find((d) => d.id === claim.certificateDocumentId);
  if (!doc) throw missing();
  return {
    url: doc.dataUrl || null,
    fileName: doc.name || 'Certificate',
    mimeType: doc.mime || 'application/octet-stream',
    sizeBytes: doc.size || 0,
  };
}

/* --- community minting (D241 C5) -------------------------------------------------------------- */

/**
 * A store society as the wire draws it.
 *
 * The store's word for provenance is `tier` (`community` / `verified` / absent for the catalogue);
 * the server's is `source` plus a `verifiedAt` timestamp. Translating here rather than leaving the
 * store's vocabulary to leak is the whole point of a mock provider: a screen that reads `tier` in
 * this environment and `source` in the other is two screens.
 *
 * The store has no record of *when* a society was verified — it only flips `tier` — so `verifiedAt`
 * is synthesised from the overlay's own stamp where there is one and from "now" where there is not.
 * A `verified` row with a null `verifiedAt` would be a shape the server cannot produce, and the
 * component reading it would branch on a state that only exists in the mock.
 */
const toSocietyWire = (s) => (s ? {
  id: s.id,
  slug: s.slug,
  name: s.name,
  builder: s.builder || null,
  localitySlug: s.localitySlug || null,
  lat: s.lat ?? null,
  lng: s.lng ?? null,
  registration: !!s.registration,
  conveyance: !!s.conveyance,
  amenities: Array.isArray(s.amenities) ? s.amenities : [],
  source: s.tier === 'community' || s.tier === 'verified' ? 'community' : (s.source || 'curated'),
  /* Why this is not the `source` above. The store overloads one field for two questions: `source`
     answers "catalogue or member-added?" here and "searcher demand or a listing?" on a community
     row, and the line above resolves that collision by overwriting the second meaning with the
     first — so the provenance that tells an operator *why* a building appeared was being dropped on
     the way out. The server keeps them apart (`mint_origin`, V108), so the wire does too. Null is a
     real value and not a default: every society minted before V108 has no recorded provenance, and
     guessing one would put a confident wrong answer in front of the person verifying the row. */
  mintOrigin: s.source === 'demand' || s.source === 'listing' ? s.source : null,
  verifiedAt: s.verifiedAt
    ? new Date(s.verifiedAt).toISOString()
    : (s.tier === 'verified' ? new Date().toISOString() : null),
  claimStatus: s.claimStatus || 'unclaimed',
  listingCount: s.listingCount ?? 0,
  followerCount: s.followerCount ?? 0,
  followedByMe: isSocietyFollowed(s.slug),
  /* The store's word is `at`, and only a member-added row has one — the 348 catalogue societies
     were never "created", they were seeded. Null there rather than a fabricated date: the one
     screen that reads this is a backlog, where the whole value of the field is saying how long a
     row has been waiting, and a made-up timestamp would answer that question wrongly rather than
     not at all. */
  createdAt: s.at ? new Date(s.at).toISOString() : null,
} : null);

/**
 * Add a society the catalogue does not have.
 *
 * `addCommunitySociety` already carries the guard that matters — it hands back the canonical row
 * when the name or slug already exists rather than minting a second copy — so `created` is derived
 * by asking whether the row it returned is the one we asked for or one that was already there.
 */
export async function mintSociety(body = {}) {
  const name = String(body.name || '').trim();
  if (name.length < 2) {
    throw Object.assign(new Error('Give the society a name.'), { status: 422 });
  }
  const before = resolveSociety(slugifySociety(name, body.localityLabel));
  const rec = addCommunitySociety({
    name,
    localityLabel: body.localityLabel,
    localitySlug: body.localitySlug,
    lat: body.lat,
    lng: body.lng,
  });
  if (!rec) throw Object.assign(new Error('That name cannot be turned into a web address.'), { status: 422 });
  return { society: toSocietyWire(resolveSociety(rec.slug) || rec), created: !before };
}

/** Member-added societies nobody has checked yet. */
export async function listSocietyCandidates() {
  return getSocietyCandidates().map(toSocietyWire).filter(Boolean);
}

/** Confirm a member-added society is real. */
export async function verifySocietyCandidate(slug) {
  const society = resolveSociety(slug);
  if (!society) throw Object.assign(new Error('Society not found.'), { status: 404 });
  if (toSocietyWire(society)?.source !== 'community') {
    throw Object.assign(new Error('Only a member-added society needs verifying.'), { status: 422 });
  }
  if (society.tier === 'verified') {
    throw Object.assign(new Error('This society has already been verified.'), { status: 409 });
  }
  verifyCommunitySociety(slug, myMobile());
  return toSocietyWire(resolveSociety(slug));
}

/**
 * Societies a queued candidate may already be a copy of.
 *
 * Delegates to the store's `suggestDuplicates`, which is where this scan has always lived — the
 * point of moving it behind the provider seam is not to change the mock's answer but to stop the
 * *page* computing it, so that the live console can get a real one. Against the bundled catalogue
 * this still only sees the rows the browser has; that limitation is now the mock's, where it
 * belongs, instead of being baked into the screen.
 */
export async function listSocietyCandidateDuplicates(slug, { limit = 6 } = {}) {
  const society = resolveSociety(slug) || societyBySlug(slug);
  if (!society) throw Object.assign(new Error('Society not found.'), { status: 404 });
  return suggestDuplicates(society, limit);
}

/* --- merging duplicates ----------------------------------------------------------------------- */

/** One entry of the redirect map as the wire draws it, or null if either end no longer resolves. */
const toMergeWire = (fromSlug, intoSlug) => {
  const from = resolveSociety(fromSlug) || societyBySlug(fromSlug);
  const into = resolveSociety(intoSlug) || societyBySlug(intoSlug);
  if (!from || !into) return null;
  const meta = getSocietyMergeMeta()[fromSlug] || {};
  return {
    slug: fromSlug,
    name: from.name,
    intoSlug,
    intoName: into.name,
    // Synthesised where the merge predates the metadata sidecar. A merge the server can produce
    // always has both, so answering null here would hand the console a shape it cannot get from
    // the API — the same reasoning as `verifiedAt` above.
    mergedAt: new Date(meta.at || Date.now()).toISOString(),
    mergedBy: meta.by || 'ops',
  };
};

/** Merges in force, newest first — the order the server serves and the opposite of the queues. */
export async function listSocietyMerges() {
  const merges = getSocietyMerges();
  return Object.keys(merges)
    .map((from) => toMergeWire(from, merges[from]))
    .filter(Boolean)
    .sort((a, b) => new Date(b.mergedAt) - new Date(a.mergedAt));
}

/**
 * Record that `from` is a duplicate of `into`.
 *
 * The refusals are enforced here rather than delegated, because the store does not share them: its
 * `mergeSocieties` silently collapses any chain pointing at the newly merged society onto the new
 * target. That is the one behaviour the server refuses outright — collapsing a chain is what cannot
 * be undone, since once A is re-pointed from B to C nothing records that an operator chose B. A
 * mock that quietly did the irreversible thing would teach the console that chains are fine, and
 * the lesson would only be corrected in production.
 */
export async function mergeSocieties(from, into) {
  const fromSlug = String(from || '').trim();
  const intoSlug = String(into || '').trim();
  if (!fromSlug || !intoSlug) {
    throw Object.assign(new Error('Say which society is the duplicate and which survives.'), { status: 422 });
  }
  if (fromSlug === intoSlug) {
    throw Object.assign(new Error('A society cannot be merged into itself.'), { status: 422 });
  }
  const merges = getSocietyMerges();
  if (!resolveSociety(fromSlug) && !societyBySlug(fromSlug)) throw Object.assign(new Error('Society not found.'), { status: 404 });
  if (!resolveSociety(intoSlug) && !societyBySlug(intoSlug)) throw Object.assign(new Error('Society not found.'), { status: 404 });
  if (merges[fromSlug]) {
    throw Object.assign(new Error(`Already merged into “${merges[fromSlug]}”. Undo that first.`), { status: 409 });
  }
  if (merges[intoSlug]) {
    throw Object.assign(new Error(`“${intoSlug}” is itself merged into “${merges[intoSlug]}”. Merge into that one instead.`), { status: 409 });
  }
  if (Object.values(merges).includes(fromSlug)) {
    throw Object.assign(new Error(`Other societies have been merged into “${fromSlug}”. Undo those first.`), { status: 409 });
  }
  if (!mergeSocietiesLocal(fromSlug, intoSlug)) {
    throw Object.assign(new Error('Could not merge those two societies.'), { status: 422 });
  }
  return toMergeWire(fromSlug, intoSlug);
}

/** Undo a merge, addressed by the society that was merged away. */
export async function undoSocietyMerge(slug) {
  if (!undoSocietyMergeLocal(slug)) {
    throw Object.assign(new Error('That society is not merged into anything.'), { status: 404 });
  }
}

/**
 * One society as the back-office editor needs it, assembled from the catalogue row plus this
 * browser's overlay — which is the same pair the live route keeps in one table.
 */
export async function getSocietyAdminView(slug) {
  const soc = resolveSociety(slug);
  if (!soc) throw Object.assign(new Error('No such society.'), { status: 404 });
  const overlay = getSocietyOverlay(slug) || {};
  return {
    slug,
    name: soc.name,
    registration: !!soc.registration,
    conveyance: !!soc.conveyance,
    maintenancePerSqft: soc.maintenancePerSqft ?? null,
    claimStatus: soc.claimStatus || 'unclaimed',
    adminNote: overlay.adminNote || null,
  };
}

/**
 * Correct one society's facts, into the browser-side overlay.
 *
 * The overlay is exactly what the live route replaced, and it stays here because it is the only
 * place a mock society's edited facts can live — the catalogue rows are a static bundle. The
 * difference worth stating: this write is visible to nobody but this browser, which live is a bug
 * and here is the whole design.
 *
 * Two things are matched to the route rather than to the store. Absent means unchanged, so the
 * patch is assembled key by key instead of spread, or `undefined` would land in the overlay and
 * read back as a cleared field. And the maintenance bound is enforced here too: it is the check
 * that catches the monthly bill typed into a per-square-foot box, and a validation the mock does
 * not share is a validation the mock specs cannot cover.
 */
export async function editSociety(slug, body) {
  const soc = resolveSociety(slug);
  if (!soc) throw Object.assign(new Error('No such society.'), { status: 404 });

  const rate = body?.maintenancePerSqft;
  if (rate != null && (!Number.isFinite(rate) || rate < 0 || rate > 100)) {
    throw Object.assign(
      new Error('Maintenance is rupees per sq ft, not the monthly bill.'), { status: 422 },
    );
  }

  const patch = {};
  for (const key of ['registration', 'conveyance', 'maintenancePerSqft', 'claimStatus', 'adminNote']) {
    if (body?.[key] !== undefined) patch[key] = body[key];
  }
  setSocietyOverlay(slug, patch);

  const merged = resolveSociety(slug) || soc;
  const overlay = getSocietyOverlay(slug) || {};
  return {
    slug,
    name: merged.name,
    registration: !!merged.registration,
    conveyance: !!merged.conveyance,
    maintenancePerSqft: merged.maintenancePerSqft ?? null,
    claimStatus: merged.claimStatus || 'unclaimed',
    adminNote: overlay.adminNote || null,
  };
}
