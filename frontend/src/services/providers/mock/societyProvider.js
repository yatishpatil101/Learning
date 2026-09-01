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
  getSocietySuggestion,
  isSocietyAdmin,
  isVerifiedResident,
  requestResidentVerification,
  requestSocietyClaim,
  residentStatus,
  resolveSociety,
  setResidentStatus,
  setSocietyClaimStatus,
  suggestSocietyDetails,
  verifyCommunitySociety,
} from '../../../lib/store/societyAdmin.js';
import { addCommunitySociety } from '../../../lib/store/community.js';
import { slugifySociety } from '../../../data/societies.js';
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
 * Three differences from the live queue, none of them hideable, all of them a consequence of the
 * store keeping **one claim per society keyed by slug** where the server keeps every claim ever
 * filed:
 *
 * - *History does not exist here.* Re-claiming a society after a rejection overwrites the rejected
 *   record rather than adding a second row, so this queue can never show the same society twice.
 * - *`regNo` and `cert` are dropped.* The old browser-only claim form collected a registration
 *   number and a scanned certificate and parked them in localStorage; `SocietyClaimRequest`
 *   declares neither, so there is no field on the wire to carry them and forwarding them here
 *   would keep a column alive that is permanently blank against the real API.
 * - *`id` is the store's `sc<timestamp>`, not a UUID.* It only has to round-trip to
 *   `decideSocietyClaim`, which is exactly what the server's id has to do.
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
  verifiedAt: s.verifiedAt
    ? new Date(s.verifiedAt).toISOString()
    : (s.tier === 'verified' ? new Date().toISOString() : null),
  claimStatus: s.claimStatus || 'unclaimed',
  listingCount: s.listingCount ?? 0,
  followerCount: s.followerCount ?? 0,
  followedByMe: isSocietyFollowed(s.slug),
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
