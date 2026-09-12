import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import MobileCollapse from '../../../components/ui/MobileCollapse.jsx';
import { digits } from '../../../lib/contact.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { listPropertyReviews, createPropertyReview, getPropertyReviewSummary } from '../../../services/reviewService.js';
import {
  myTenancies,
  listTenancyDeclarations,
  declareTenancy,
  confirmTenancyDeclaration,
  revokeTenancyDeclaration,
} from '../../../services/rentService.js';
import { listVisits } from '../../../services/visitService.js';
import { Stars } from './Stars.jsx';
import { ReviewModal } from './ReviewModal.jsx';

function initials(name) {
  const parts = String(name || 'U').trim().split(/\s+/);
  return ((parts[0]?.[0] || 'U') + (parts[1]?.[0] || '')).toUpperCase();
}

export const RV_CATS = [['locality', 'Locality'], ['condition', 'Condition'], ['value', 'Value'], ['owner', 'Owner'], ['accuracy', 'Accuracy']];

export function ReviewsSection({ p, isIn, onReport, toast }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  /* Three states per read, not two. `null` is "not read yet", an object (or array) is "read", and
     the `*Failed` flag is "asked, and did not get an answer" — which is a different fact from
     "asked, and the answer was none".

     This block used to have only the first two, and rendered a failed read as `{ count: 0 }`. That
     is the exact shape that hid a total outage once already: `listPropertyReviews` requested a
     route that did not exist, every read 404'd, and every listing on the platform displayed as
     unreviewed for a long time — because "no reviews yet" is a completely plausible thing for a
     page to say, so nobody reported it. The same three-state model is now used by the society,
     owner and locality surfaces; a failure gets its own sentence and never borrows the empty one. */
  const [reviews, setReviews] = useState(null);
  const [reviewsFailed, setReviewsFailed] = useState(false);
  const [summary, setSummary] = useState(null);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState(false);

  /* The review routes bind `{propId}` as a UUID; the seam's `p.id` is the listing's *slug*
     (`p5015`), because the property routes accept slug-or-id and a slug makes a prettier URL.
     `p.uuid` is the same row's real key, and the fallback covers mock listings, which have none. */
  const propId = String(p.uuid || p.id || '');

  /**
   * Two reads, because they answer two questions and only one of them scales.
   *
   * The four numbers above the reviews — average, count, star distribution, per-aspect averages —
   * used to be a `reduce` over this very list, which is why `GET .../reviews` may not be paged:
   * page it and the stars would keep rendering, now describing page one. They come from
   * `.../reviews/summary` now (D79), computed in SQL over every published review. The list is still
   * fetched because the cards below are the list; what is gone is the *dependency* between them.
   *
   * Reset to null on an id change rather than left to the `alive` guard: without it the previous
   * listing's average sits on screen, looking settled, until the new one lands.
   */
  useEffect(() => {
    // Settle both states rather than returning early: leaving them null keeps `loading` true, and
    // three skeletons that never resolve are indistinguishable from a hung request. Settled as a
    // *failure*, not as an empty listing — a property whose identity we cannot name is one we
    // cannot ask about, and "nobody has reviewed this" is a claim we have no basis for.
    if (!propId) { setReviews(null); setSummary(null); setReviewsFailed(true); setSummaryFailed(true); return undefined; }
    let alive = true;
    setReviews(null);
    setReviewsFailed(false);
    setSummary(null);
    setSummaryFailed(false);
    listPropertyReviews(propId)
      .then((res) => { if (alive) setReviews(res.items); })
      // Not `[]`. An empty list and an unreachable one render as different sentences below; a
      // retry loop on a page the user is reading still costs more than the missing cards, so the
      // section says so once and offers nothing further.
      .catch(() => { if (alive) setReviewsFailed(true); });
    getPropertyReviewSummary(propId)
      .then((s) => { if (alive) setSummary(s); })
      // Deliberately not recomputed from the list as a fallback. That reduce is the thing this
      // replaced, and keeping a copy of it would mean a broken summary endpoint never shows.
      .catch(() => { if (alive) setSummaryFailed(true); });
    return () => { alive = false; };
  }, [propId]);

  const list = reviews || [];
  /* Loading is "still outstanding", so a settled failure ends it — otherwise a 404 leaves three
     skeletons spinning forever, which is its own kind of lie. */
  const loading = (reviews === null && !reviewsFailed) || (summary === null && !summaryFailed);

  /* The two reads can disagree, and the disagreement has to render as something sensible.
     Splitting "are there reviews to show" from "is there an aggregate to draw" is what keeps a
     failed summary read from hiding a list that loaded perfectly well: before this, `!summary.count`
     alone chose the empty panel, and every review card lived in the other branch — so a listing with
     forty reviews on screen-worth of data was told the visitor it had none. `avg` is checked and not
     just `count` because the stars branch dereferences it twice; the server's own invariant is that
     they move together, but a render crash is not the right way to find out it stopped holding. */
  const hasAggregate = !loading && !!summary && summary.count > 0 && Number.isFinite(summary.avg);

  /* "No reviews yet" is a claim about the listing, and it may only be made when both reads
     actually answered. Any failure disqualifies it — that is the whole fix. */
  const readFailed = reviewsFailed || summaryFailed;
  const isEmpty = !loading && !readFailed && !hasAggregate && !list.length;
  /* Nothing to show and a reason why: the section says the reviews could not be loaded rather
     than describing the property. When one read succeeded the block still renders — a list with
     an unreadable aggregate is worth showing, with the missing average named in place. */
  const isUnreadable = !loading && readFailed && !hasAggregate && !list.length;

  /* Stays client-side: "% would recommend" has no server aggregate, and the list it needs is
     already on screen. Tri-state — `recommend` is null for an author who did not answer, and
     counting those as "would not" would drag the headline percentage down. */
  const recommend = useMemo(() => {
    const answered = (reviews || []).filter((r) => r.recommend != null);
    if (!answered.length) return null;
    return Math.round((answered.filter((r) => r.recommend).length / answered.length) * 100);
  }, [reviews]);

  const shown = list.filter((r) => filter === 'all' || r.context === filter);

  const owner = String(p.ownerMobile || '');
  /* Ownership decides whether this section offers to take a review or shows the landlord side of
     the declarations queue, so it is read from the session — the one answer the rest of the page
     and the API already agree on — rather than from a mobile that storage may still be holding for
     a session that has ended.

     `!!mine` is load-bearing rather than defensive tidiness. `digits(undefined)` and `digits('')`
     are both the empty string, so without it a listing that names no owner would match any visitor
     whose number is unknown, and the "you cannot review your own property" branch would fire for
     someone with no connection to it at all. The opposite mistake — deciding "not yours" before the
     session is known — cannot happen and so is not guarded against the context's `loading` flag:
     the cached session hydrates synchronously, so a signed-in visitor's mobile is present on the
     first render, and gating on `loading` would only withhold the rate button from every reader
     while the session is revalidated.

     The paragraph above was right about where to read the *left* side and wrong about the right
     one, which is worth leaving on the record because it is the same mistake one layer over. The
     comparison was `mine === digits(p.ownerMobile)`, and `ownerMobile` is masked by the server —
     `94XXXXX812` — for every reader including the owner, since ADR-019 makes revealing it a
     deliberate act and there is no reason to make an exception for the person it belongs to.
     `digits()` of that is `94812`, which no real number equals, so `isOwner` was **false for
     everybody** against the API. It passed in mock because the mock hands back the unmasked number.

     What that cost: the owner was offered "I lived here" on their own listing, and — the part that
     matters — never saw the claims panel, so a declaration could be made but not confirmed. The
     tenancy path terminated in a queue nobody could reach, which is the same shape as the dead
     `getTenanciesFor` read described below and had the same cause, a check whose two halves came
     from the same mock.

     So ids, which are not masked and are the thing the server actually joins on. The mobile
     comparison stays as the fallback for when either id is missing rather than being deleted: mock
     records seeded without one still have to work, and the failure mode of the fallback (a mobile
     that cannot match) is a refusal, not a false claim of ownership. */
  const mine = digits(user?.mobile);
  const idsKnown = !!user?.id && !!p.ownerId;
  const isOwner = isIn && (idsKnown
    ? String(user.id) === String(p.ownerId)
    : (!!mine && mine === digits(owner)));

  /* ── The tenancy half of eligibility, which used to be dead against the API ──────────────────
     This term was `getTenanciesFor(myMobile()).some(t => t.propId === p.id)` — a read of a
     localStorage bucket nothing on the live path ever writes. Against the real API it was
     unconditionally false, so the write path was closed for the one person most entitled to use
     it: an actual resident. It passed every test because in mock mode that store is the source of
     truth for both halves at once, so the check agreed with itself and with nothing else.

     A stay is now proved two ways, and the server agrees with both (`PropertyExperience`):

       1. a BROKERED TENANCY — a rent deal closed here, so `/me/tenancies` has the row; and
       2. an OWNER-CONFIRMED DECLARATION — the resident says they lived here and the *landlord*
          agrees. Most Indian leases are signed off-platform, so without this second door the
          honest majority of residents stay locked out.

     Both are read from the seam, so both work in either mode.

     Matched on `propId`, never `p.id`. That single resolution (`p.uuid || p.id`) is the listing's
     UUID against the live API and its slug under the mock, and both providers key a tenancy by the
     same identifier the review routes bind — so the comparison is true on each. Comparing `p.id`
     instead would match nothing live, which is exactly how the visit half was broken once already. */
  const [brokeredTenancy, setBrokeredTenancy] = useState(false);
  useEffect(() => {
    // Cleared on every id change, not just on sign-out. The `alive` guard stops a late response
    // from landing on the wrong listing, but it cannot clear what is already in state — so between
    // one property and the next, standing earned on the first would still be granting the composer
    // on the second for as long as the new read takes.
    setBrokeredTenancy(false);
    if (!isIn || !propId) return undefined;
    let alive = true;
    myTenancies()
      // Fails closed: an unreadable tenancy list means "not proven", which shows the prompt to ask
      // the owner. Failing open would let an unreachable endpoint hand out reviewer standing.
      .then((all) => { if (alive) setBrokeredTenancy(all.some((tn) => String(tn.propId) === propId)); })
      .catch(() => { if (alive) setBrokeredTenancy(false); });
    return () => { alive = false; };
  }, [isIn, propId]);

  /* Declarations the caller may see for this listing. The server decides the row set — every claim
     when the caller owns the listing, their own otherwise — so this holds two different things
     depending on who is asking, and the two branches below say which. Deliberately not filtered
     here: a client-side filter over rows the server was willing to hand out is a rendering
     preference, not a rule. */
  const [declarations, setDeclarations] = useState([]);
  useEffect(() => {
    setDeclarations([]); // same reason as above — carried claims would follow the reader across listings
    if (!isIn || !propId) return undefined;
    let alive = true;
    listTenancyDeclarations(propId)
      .then((rows) => { if (alive) setDeclarations(rows); })
      .catch(() => { if (alive) setDeclarations([]); });
    return () => { alive = false; };
  }, [isIn, propId]);

  /* A non-owner's list is their own row and only ever their own, so the first entry is theirs. */
  const myDeclaration = isOwner ? null : (declarations[0] || null);
  /* `status`, never the row's existence. A pending claim is an assertion nobody has agreed with —
     treating it as proof would turn "declare" into a self-service eligibility button and make the
     owner's confirmation decorative. The server refuses it too (422), so a client that got this
     wrong would open a composer that could not submit. */
  const hasTenancy = brokeredTenancy || myDeclaration?.status === 'confirmed';

  /* The anti-fake-review gate: only someone who actually visited (or lived there) may rate.

     This used to read the owner's localStorage bucket directly, keyed on the owner's mobile — which
     a visitor cannot reliably address once the number is masked. The seam asks the same question of
     the caller's own visits instead, so it works off the identity the session already proves.

     Matched on `propId`, not `p.id`: a visit's `propertyId` is the listing's UUID (the server writes
     it from a uuid column), while `p.id` is the slug the pretty URL uses. Comparing the two matched
     nothing for every curated listing, so `myVisit` stayed null, nobody was ever eligible, and the
     Rate button told visitors with a completed visit to go book one.

     Failing closed on error: an unreachable visit list means "not eligible", which shows the
     book-a-visit prompt. Failing open would let anyone rate any property. */
  const [myVisit, setMyVisit] = useState(null);
  useEffect(() => {
    if (!isIn || !propId) { setMyVisit(null); return undefined; }
    let alive = true;
    listVisits()
      .then((all) => {
        if (!alive) return;
        const mine = all.filter((v) => v.propertyId === propId);
        if (mine.some((v) => v.status === 'completed')) setMyVisit('completed');
        else if (mine.some((v) => v.status === 'scheduled' || v.status === 'confirmed')) setMyVisit('scheduled');
        else setMyVisit(null);
      })
      .catch(() => { if (alive) setMyVisit(null); });
    return () => { alive = false; };
  }, [isIn, propId]);

  const eligible = isIn && !isOwner && (myVisit === 'completed' || hasTenancy);

  const openRate = () => {
    if (!isIn) { toast(t('property.signInRate'), 'info'); return; }
    if (isOwner) { toast(t('property.cantReviewOwn'), 'info'); return; }
    if (!eligible) {
      if (myVisit === 'scheduled') toast(t('property.visitBookedReview'), 'info');
      // A resident who never booked a visit is not told to go and book one — that sentence was
      // simply wrong for them, and it was the only thing the dead tenancy check left them with.
      else if (myDeclaration) toast(t('property.declarationPending'), 'info');
      else toast(t('property.bookVisitFirst'), 'info');
      return;
    }
    setModal(true);
  };

  /* ── Declaring a past stay, and the owner answering ────────────────────────────────────────── */

  const [deciding, setDeciding] = useState(false);
  /* The banner that replaces whichever control was just used. Both actions unmount the button the
     user activated, which drops focus to `<body>` a long way up the page; moving it here keeps a
     keyboard reader where they were, and `role="status"` is what makes the outcome audible at all
     (the toast is not, and the toast is otherwise the only announcement). */
  const outcomeRef = useRef(null);
  const restoreFocus = () => { requestAnimationFrame(() => outcomeRef.current?.focus()); };

  const declare = () => {
    // Guarded twice, because the flag is only true after a re-render: a double-tap inside that gap
    // sends a second POST, which the server correctly refuses as a duplicate — and the user is then
    // shown a failure toast for an operation that worked, with the pending banner contradicting it
    // underneath.
    if (deciding) return;
    setDeciding(true);
    declareTenancy(propId)
      // Replaces rather than prepends: a non-owner's list is exactly their own row, and the server
      // permits only one, so anything else here would be a second copy of the same claim.
      .then((row) => { setDeclarations([row]); toast(t('property.declarationSent'), 'success'); restoreFocus(); })
      .catch(() => toast(t('property.declarationFailed'), 'error'))
      .finally(() => setDeciding(false));
  };

  /* The owner's answer. Applies the row the server returned rather than a locally-assumed status:
     the decision is the server's, and guessing it here would let the list disagree with the
     eligibility the same server is about to enforce. */
  const decide = (id, action) => {
    if (deciding) return;
    setDeciding(true);
    action(id)
      .then((row) => setDeclarations((prev) => prev.map((d) => (d.id === row.id ? row : d))))
      .catch(() => toast(t('property.declarationFailed'), 'error'))
      .finally(() => setDeciding(false));
  };

  /* Offered only to somebody who has no other route in. A completed visit already makes them
     eligible, and a brokered tenancy is already on record — asking either of them to make a claim
     the owner then has to answer is work for both parties that changes nothing. */
  const canDeclare = isIn && !!propId && !isOwner && !eligible && myVisit !== 'completed' && !myDeclaration;

  const submit = (review) => {
    // Re-read rather than push the local object in: the server decides the id, the timestamp and
    // the `context` badge, and the badge in particular is the one field the client must not
    // invent. Optimistically prepending our own version would render a "Visited" chip we made up.
    //
    // The summary is re-read alongside it, and has to be: it is no longer derived from this list,
    // so refreshing only the list would leave the new review visible under an average that has not
    // moved — the exact contradiction the aggregate endpoint was supposed to remove.
    createPropertyReview(propId, review)
      .then(() => Promise.all([listPropertyReviews(propId), getPropertyReviewSummary(propId)]))
      .then(([res, s]) => {
        setReviews(res.items);
        setReviewsFailed(false);
        setSummary(s);
        setSummaryFailed(false);
        setModal(false);
        toast(t('property.reviewPosted'), 'success');
      })
      .catch(() => toast(t('property.reviewFailed'), 'error'));
  };

  return (
    <section className="fade-in section-mb">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2"><Icon name="star" className="w-5 h-5 text-amber-400" /> {t('property.ratingsReviews')}</h2>
        <div className="flex items-center gap-2 sm:gap-3">
          <button onClick={onReport} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-400 hover:text-red-400 transition-smooth"><Icon name="flag" className="w-4 h-4" /> {t('property.reportListing')}</button>
          {!isOwner ? <button type="button" onClick={openRate} className="btn-teal inline-flex items-center gap-2 text-sm py-2.5 px-4"><Icon name="star" className="w-4 h-4" /> {t('property.rateProperty')}</button> : null}
        </div>
      </div>

      {/* ── The tenancy door (D194) ──────────────────────────────────────────────────────────────
          Two audiences, never both at once. A former resident is offered a way in that does not
          involve pretending to be a buyer and booking a viewing of the flat they used to live in;
          the owner is asked to answer, because their agreement is the only thing that makes the
          claim mean anything. */}
      {canDeclare ? (
        <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 mb-6 flex items-center gap-3 flex-wrap" data-testid="tenancy-declare">
          <Icon name="home" className="w-5 h-5 text-brand-teal-3 flex-shrink-0" />
          <p className="text-slate-300 text-sm flex-1 min-w-[12rem]">{t('property.livedHerePrompt')}</p>
          <button type="button" onClick={declare} disabled={deciding} className="btn-teal inline-flex items-center gap-2 text-sm min-h-[44px] sm:min-h-0 py-2.5 px-4 disabled:opacity-60">{t('property.declareTenancy')}</button>
        </div>
      ) : null}

      {myDeclaration && myDeclaration.status !== 'confirmed' ? (
        /* Pending and revoked get their own sentence rather than sharing one. "Waiting" and "the
           owner did not agree" are different facts, and collapsing them would leave a rejected
           claimant waiting forever for an answer that has already been given. */
        <div ref={outcomeRef} tabIndex={-1} role="status" className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 mb-6 flex items-center gap-3" data-testid={'tenancy-declaration-' + myDeclaration.status}>
          <Icon name={myDeclaration.status === 'revoked' ? 'alert-triangle' : 'clock'} className="w-5 h-5 text-slate-400 flex-shrink-0" />
          <p className="text-slate-300 text-sm">{t(myDeclaration.status === 'revoked' ? 'property.declarationRevoked' : 'property.declarationPending')}</p>
        </div>
      ) : null}

      {isOwner && declarations.length ? (
        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 mb-6" data-testid="tenancy-claims">
          <h3 className="text-white font-semibold text-sm mb-1">{t('property.tenancyClaims')}</h3>
          {/* The warning is the feature. Confirming is not an acknowledgement that somebody wrote
              in — it hands them the right to publish a rating on this listing, and an owner who
              taps it to clear a notification has given that away without being told. */}
          <p className="text-slate-400 text-xs mb-3">{t('property.tenancyClaimsHint')}</p>
          {declarations.map((d) => {
            // Every row's buttons read "Confirm" / "Reject", so an owner navigating by button list
            // hears the same word repeated with no way to tell which stranger they are about to
            // hand publish rights to. The name is in a sibling span, which is not part of any
            // accessible name — so it is put into one.
            const who = d.declarantName || t('property.someone');
            return (
              <div key={d.id} className="flex items-center gap-3 flex-wrap py-2 border-t border-white/8 first:border-t-0">
                <span className="text-white text-sm font-medium flex-1 min-w-[8rem]">{who}</span>
                {d.livedFrom || d.livedTo ? <span className="text-slate-500 text-xs">{[d.livedFrom, d.livedTo].filter(Boolean).join(' – ')}</span> : null}
                {d.status === 'confirmed' ? (
                  <>
                    <span role="status" className="text-emerald-400 text-xs inline-flex items-center gap-1"><Icon name="badge-check" className="w-3 h-3" /> {t('property.claimConfirmed')}</span>
                    <button type="button" disabled={deciding} aria-label={t('property.claimWithdrawFor', { name: who })} onClick={() => decide(d.id, revokeTenancyDeclaration)} className="text-xs font-medium text-slate-400 hover:text-red-400 min-h-[44px] sm:min-h-0 px-2 disabled:opacity-60">{t('property.claimWithdraw')}</button>
                  </>
                ) : d.status === 'revoked' ? (
                  <span role="status" className="text-slate-500 text-xs">{t('property.claimRevoked')}</span>
                ) : (
                  <>
                    <button type="button" disabled={deciding} aria-label={t('property.claimConfirmFor', { name: who })} onClick={() => decide(d.id, confirmTenancyDeclaration)} className="btn-teal text-xs min-h-[44px] sm:min-h-0 py-2 px-3 disabled:opacity-60">{t('property.claimConfirmAction')}</button>
                    <button type="button" disabled={deciding} aria-label={t('property.claimRejectFor', { name: who })} onClick={() => decide(d.id, revokeTenancyDeclaration)} className="text-xs font-medium text-slate-400 hover:text-red-400 min-h-[44px] sm:min-h-0 px-2 disabled:opacity-60">{t('property.claimRejectAction')}</button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      {loading ? (
        /* Placeholders rather than the empty-state panel. "No reviews yet" is a claim about the
           listing, and rendering it while the read is still out states it about every property for
           as long as the request takes — then swaps it for four stars. */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6" aria-hidden="true" data-testid="reviews-summary-skeleton">
          <div className="h-44 skeleton rounded-2xl" />
          <div className="h-44 skeleton rounded-2xl" />
          <div className="h-44 skeleton rounded-2xl" />
        </div>
      ) : isUnreadable ? (
        /* The failure sentence, and never the empty one. This is the branch whose absence let a
           dead endpoint read as an unreviewed platform. */
        <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 flex items-center gap-3" data-testid="property-reviews-unavailable">
          <Icon name="alert-triangle" className="w-5 h-5 text-amber-400 flex-shrink-0" />
          <p className="text-amber-200/90 text-sm">{t('property.reviewsUnavailable')}</p>
        </div>
      ) : isEmpty ? (
        <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 flex items-center gap-3">
          <Icon name="star" className="w-5 h-5 text-amber-400 flex-shrink-0" />
          <p className="text-slate-300 text-sm">{t('property.noReviewsYet')}</p>
        </div>
      ) : (
        /* On phones the reviews block is ~900px of summary grid + filters + cards
           sitting under the amenities list. Collapse it behind its own rating
           summary; the header row is `lg:hidden`, so desktop is unchanged. */
        <MobileCollapse
          headerClassName="lg:hidden mb-4"
          label={t('property.ratingsReviews')}
          header={(
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-white">
              {hasAggregate ? <><Stars value={summary.avg} size={14} /> {summary.avg.toFixed(1)} · </> : null}
              {/* No stars and no invented average when the aggregate could not be read — the count
                  that remains is honestly the number of cards below, not the platform's total. */}
              {t('property.reviews', { count: hasAggregate ? summary.count : list.length })}
            </span>
          )}
        >
          {/* The aggregate grid is the part that needs the summary read; the cards below need only
              the list. Kept as one collapse rather than two so the phone layout does not change. */}
          {!hasAggregate && summaryFailed ? (
            /* A list that loaded under an aggregate that did not. Saying so is the point: silently
               dropping the grid would read as "this property has reviews but no rating", which is
               not a state the server can produce. */
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 mb-4 flex items-center gap-3" data-testid="property-rating-unavailable">
              <Icon name="alert-triangle" className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <p className="text-amber-200/90 text-sm">{t('property.ratingUnavailable')}</p>
            </div>
          ) : null}
          {hasAggregate ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6" data-testid="reviews-aggregate">
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-5 flex flex-col items-center justify-center text-center">
              <div className="text-4xl font-extrabold text-white mb-1" data-testid="reviews-average">{summary.avg.toFixed(1)}</div>
              <div className="mb-1"><Stars value={summary.avg} size={18} /></div>
              <p className="text-slate-400 text-xs">{t('property.reviews', { count: summary.count })}</p>
              {recommend != null ? <p className="text-emerald-400 text-xs mt-2 inline-flex items-center gap-1" data-testid="reviews-recommend"><Icon name="badge-check" className="w-3 h-3" /> {t('property.recommendPct', { pct: recommend })}</p> : null}
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-5">
              {[5, 4, 3, 2, 1].map((s) => {
                const c = summary.dist[s - 1];
                const max = Math.max(...summary.dist) || 1;
                return (
                  <div key={s} className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] text-slate-400 w-3">{s}</span>
                    <Icon name="star" className="w-3 h-3 fill-amber-400 text-amber-400" />
                    <div className="flex-1 h-2 rounded-full bg-white/8 overflow-hidden"><div className="h-full bg-amber-400" style={{ width: Math.round((c / max) * 100) + '%' }} /></div>
                    {/* Testid per bar: the bucket-to-bar mapping is the one wrong answer here that
                        still renders a perfectly plausible chart, so it has to be assertable by
                        position rather than by scraping the card's text. */}
                    <span className="text-[11px] text-slate-500 w-5 text-right" data-testid={'reviews-bar-' + s}>{c}</span>
                  </div>
                );
              })}
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-5" data-testid="reviews-cat-averages">
              {Object.keys(summary.catAvg).length ? Object.keys(summary.catAvg).map((k) => (
                <div key={k} className="flex items-center justify-between gap-3 py-1">
                  <span className="text-sm text-slate-300">{t('property.reviewCats.' + k)}</span>
                  <span className="inline-flex items-center gap-1"><Stars value={summary.catAvg[k]} size={13} /><span className="text-[11px] text-slate-400 w-6 text-right">{summary.catAvg[k].toFixed(1)}</span></span>
                </div>
              )) : <p className="text-slate-500 text-sm">{t('property.noCategoryRatings')}</p>}
            </div>
          </div>
          ) : null}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {[['all', t('property.filterAll')], ['visit', t('property.filterVisited')], ['tenant', t('property.filterResidents')]].map(([id, lbl]) => {
              const n = id === 'all' ? (hasAggregate ? summary.count : list.length) : list.filter((r) => r.context === id).length;
              return <button key={id} type="button" onClick={() => setFilter(id)} className={'inline-flex items-center min-h-[44px] sm:min-h-0 px-3 py-1.5 rounded-lg text-xs font-medium ' + (filter === id ? 'bg-brand-teal-1/20 text-brand-teal-3 border border-brand-teal-2/30' : 'text-slate-400 border border-white/8 hover:text-white')}>{lbl} ({n})</button>;
            })}
          </div>
          <div>
            {shown.length ? shown.map((r) => (
              <div key={r.id} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 mb-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-teal-1 to-brand-indigo-4 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">{initials(r.user)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-white font-semibold text-sm">{r.user}</span>
                      {/* Only when the server actually granted a badge. This used to render
                          unconditionally, so a review with no `context` fell through to the else
                          branch and displayed "Visited" — inventing standing for an author who had
                          none. The badge is the whole reason a stranger's rating is worth reading;
                          showing it by default is worse than never showing it. */}
                      {r.context ? (
                        <span className={'inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ' + (r.context === 'tenant' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25' : 'bg-teal-500/15 text-teal-300 border-teal-500/25')}><Icon name={r.context === 'tenant' ? 'home' : 'calendar-check'} className="w-2.5 h-2.5" /> {r.context === 'tenant' ? t('property.verifiedResident') : t('property.visited')}</span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2 mb-2"><Stars value={r.rating} size={14} /><span className="text-[11px] text-slate-500">{r.at}</span></div>
                    {r.text ? <p className="text-slate-300 text-sm leading-relaxed mb-2">{r.text}</p> : null}
                    {r.categories && Object.keys(r.categories).length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {Object.keys(r.categories).map((k) => (
                          <span key={k} className="inline-flex items-center gap-1 text-[11px] text-slate-300 bg-white/5 border border-white/8 rounded-lg px-2 py-1">{t('property.reviewCats.' + k)} <Stars value={r.categories[k]} size={11} /></span>
                        ))}
                      </div>
                    ) : null}
                    {r.recommend != null ? <p className={'text-[11px] mt-2 ' + (r.recommend ? 'text-emerald-400' : 'text-slate-400')}><Icon name={r.recommend ? 'thumbs-up' : 'thumbs-down'} className="w-3 h-3 inline" /> {r.recommend ? t('property.wouldRecommend') : t('property.wouldNotRecommend')}</p> : null}
                  </div>
                </div>
              </div>
            )) : reviewsFailed ? (
              /* The aggregate read, but the cards did not. "No reviews match this filter" would be
                 a statement about the reviews, and we do not have them. */
              <p className="text-amber-200/90 text-sm py-4 inline-flex items-center gap-2" data-testid="property-review-list-unavailable"><Icon name="alert-triangle" className="w-4 h-4 flex-shrink-0" /> {t('property.reviewsUnavailable')}</p>
            ) : <p className="text-slate-500 text-sm py-4">{t('property.noReviewsFilter')}</p>}
          </div>
        </MobileCollapse>
      )}

      {modal ? <ReviewModal onClose={() => setModal(false)} onSubmit={submit} /> : null}
    </section>
  );
}
