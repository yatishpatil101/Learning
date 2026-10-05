import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import MobileCollapse from '../../../components/ui/MobileCollapse.jsx';
import { digits } from '../../../lib/contact.js';
import { useSignInGate } from '../../../lib/useSignInGate.js';
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
  const sendToSignIn = useSignInGate();
  const { user } = useAuth();
  /* Three states per read: `null` is "not read yet", a value is "read", and the `*Failed` flag is "asked and got no
     answer" — a different fact from "the answer was none". */
  const [reviews, setReviews] = useState(null);
  const [reviewsFailed, setReviewsFailed] = useState(false);
  const [summary, setSummary] = useState(null);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState(false);

  /* The review routes bind `{propId}` as a UUID; the seam's `p.id` is the listing's *slug* (`p5015`), because the
     property routes accept slug-or-id and a slug makes a prettier URL. */
  const propId = String(p.uuid || p.id || '');

  /* Two reads: the headline numbers come from `.../reviews/summary`, computed in SQL over every published review, so
     paging the list can never make the stars describe page one. */
  useEffect(() => {
    // Settle both states rather than returning early: leaving them null keeps `loading` true, and
    // skeletons that never resolve look like a hung request. Settled as a failure, not as empty.
    if (!propId) { setReviews(null); setSummary(null); setReviewsFailed(true); setSummaryFailed(true); return undefined; }
    let alive = true;
    setReviews(null);
    setReviewsFailed(false);
    setSummary(null);
    setSummaryFailed(false);
    listPropertyReviews(propId)
      .then((res) => { if (alive) setReviews(res.items); })
      // Not `[]`: an empty list and an unreachable one render as different sentences below, and a
      // retry loop on a page being read costs more than the missing cards.
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
   * skeletons spinning forever, which is its own kind of lie. */
  const loading = (reviews === null && !reviewsFailed) || (summary === null && !summaryFailed);

  /* "Are there reviews to show" and "is there an aggregate to draw" are split, so a failed
   * summary read cannot hide a list that loaded perfectly well. */
  const hasAggregate = !loading && !!summary && summary.count > 0 && Number.isFinite(summary.avg);

  /* "No reviews yet" is a claim about the listing, and it may only be made when both reads
   * actually answered. */
  const readFailed = reviewsFailed || summaryFailed;
  const isEmpty = !loading && !readFailed && !hasAggregate && !list.length;
  /* Nothing to show and a reason why: the section says the reviews could not be loaded rather than describing the
     property. */
  const isUnreadable = !loading && readFailed && !hasAggregate && !list.length;

  /* Stays client-side: "% would recommend" has no server aggregate, and the list it needs is already on screen. */
  const recommend = useMemo(() => {
    const answered = (reviews || []).filter((r) => r.recommend != null);
    if (!answered.length) return null;
    return Math.round((answered.filter((r) => r.recommend).length / answered.length) * 100);
  }, [reviews]);

  const shown = list.filter((r) => filter === 'all' || r.context === filter);

  const owner = String(p.ownerMobile || '');
  /* Compared on ids, which are not masked and are what the server joins on: a digits comparison on the masked
     `ownerMobile` makes `isOwner` false for everybody. */
  const mine = digits(user?.mobile);
  const idsKnown = !!user?.id && !!p.ownerId;
  const isOwner = isIn && (idsKnown
    ? String(user.id) === String(p.ownerId)
    : (!!mine && mine === digits(owner)));

  /* A stay is proved two ways, matching the server: a brokered tenancy from `/me/tenancies`, or
   * an owner-confirmed declaration — most Indian leases are signed off-platform. */
  const [brokeredTenancy, setBrokeredTenancy] = useState(false);
  useEffect(() => {
    // Cleared on every id change: the `alive` guard stops a late response landing on the wrong
    // listing but cannot clear state, so standing on one property would grant the composer on the next.
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

  /* The server decides the row set — every claim for an owner, their own otherwise — so this holds two different
     things depending on who asks, and the branches below say which. */
  const [declarations, setDeclarations] = useState([]);
  useEffect(() => {
    setDeclarations([]);
    if (!isIn || !propId) return undefined;
    let alive = true;
    listTenancyDeclarations(propId)
      .then((rows) => { if (alive) setDeclarations(rows); })
      .catch(() => { if (alive) setDeclarations([]); });
    return () => { alive = false; };
  }, [isIn, propId]);

  /* A non-owner's list is their own row and only ever their own, so the first entry is theirs. */
  const myDeclaration = isOwner ? null : (declarations[0] || null);
  /* `status`, never the row's existence. */
  const hasTenancy = brokeredTenancy || myDeclaration?.status === 'confirmed';

  /* The anti-fake-review gate: only someone who actually visited may rate, asked of the caller's own visits so it
     works off the identity the session already proves. */
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
    if (!isIn) { sendToSignIn('review'); return; }
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
  /* Both actions unmount the button the user activated, which drops focus to `<body>` a long way up the page. */
  const outcomeRef = useRef(null);
  const restoreFocus = () => { requestAnimationFrame(() => outcomeRef.current?.focus()); };

  const declare = () => {
    // Guarded twice: the flag only turns true after a re-render, so a double-tap inside that gap
    // sends a second POST the server refuses as a duplicate, toasting a failure for work that landed.
    if (deciding) return;
    setDeciding(true);
    declareTenancy(propId)
      // Replaces rather than prepends: a non-owner's list is exactly their own row, and the server
      // permits only one, so anything else here would be a second copy of the same claim.
      .then((row) => { setDeclarations([row]); toast(t('property.declarationSent'), 'success'); restoreFocus(); })
      .catch(() => toast(t('property.declarationFailed'), 'error'))
      .finally(() => setDeciding(false));
  };

  /* The owner's answer. */
  const decide = (id, action) => {
    if (deciding) return;
    setDeciding(true);
    action(id)
      .then((row) => setDeclarations((prev) => prev.map((d) => (d.id === row.id ? row : d))))
      .catch(() => toast(t('property.declarationFailed'), 'error'))
      .finally(() => setDeciding(false));
  };

  /* A completed visit already makes them eligible, and a brokered tenancy is already on record — asking either of
     them to make a claim the owner then has to answer is work for both parties that changes nothing. */
  const canDeclare = isIn && !!propId && !isOwner && !eligible && myVisit !== 'completed' && !myDeclaration;

  const submit = (review) => {
    // Re-read rather than prepend a local object: the server owns the id, timestamp and `context`
    // badge, and the summary is independent of this list so it has to be refreshed alongside it.
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

      {/* ── The tenancy door ────────────────────────────────────────────────────. */}
      {canDeclare ? (
        <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 mb-6 flex items-center gap-3 flex-wrap" data-testid="tenancy-declare">
          <Icon name="home" className="w-5 h-5 text-brand-teal-3 flex-shrink-0" />
          <p className="text-slate-300 text-sm flex-1 min-w-[12rem]">{t('property.livedHerePrompt')}</p>
          <button type="button" onClick={declare} disabled={deciding} className="btn-teal inline-flex items-center gap-2 text-sm min-h-[44px] sm:min-h-0 py-2.5 px-4 disabled:opacity-60">{t('property.declareTenancy')}</button>
        </div>
      ) : null}

      {myDeclaration && myDeclaration.status !== 'confirmed' ? (
        /* "Waiting" and "the owner did not agree" are different facts, and collapsing them would leave a rejected
           claimant waiting forever for an answer that has already been given. */
        <div ref={outcomeRef} tabIndex={-1} role="status" className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 mb-6 flex items-center gap-3" data-testid={'tenancy-declaration-' + myDeclaration.status}>
          <Icon name={myDeclaration.status === 'revoked' ? 'alert-triangle' : 'clock'} className="w-5 h-5 text-slate-400 flex-shrink-0" />
          <p className="text-slate-300 text-sm">{t(myDeclaration.status === 'revoked' ? 'property.declarationRevoked' : 'property.declarationPending')}</p>
        </div>
      ) : null}

      {isOwner && declarations.length ? (
        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 mb-6" data-testid="tenancy-claims">
          <h3 className="text-white font-semibold text-sm mb-1">{t('property.tenancyClaims')}</h3>

          <p className="text-slate-400 text-xs mb-3">{t('property.tenancyClaimsHint')}</p>
          {declarations.map((d) => {
            // Every row's buttons read "Confirm" / "Reject", so a screen-reader owner hears the same
            // word repeated; the name lives in a sibling span, which is not part of any accessible name.
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
        /* "No reviews yet" is a claim about the listing, and rendering it while the read is still out states it about
           every property for as long as the request takes — then swaps it for four stars. */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6" aria-hidden="true" data-testid="reviews-summary-skeleton">
          <div className="h-44 skeleton rounded-2xl" />
          <div className="h-44 skeleton rounded-2xl" />
          <div className="h-44 skeleton rounded-2xl" />
        </div>
      ) : isUnreadable ? (
        /* The failure sentence, and never the empty one. */
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
        /* Collapse it behind its own rating summary; the header row is `lg:hidden`, so desktop is unchanged. */
        <MobileCollapse

          label={t('property.ratingsReviews')}
          header={(
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-white">
              {hasAggregate ? <><Stars value={summary.avg} size={14} /> {summary.avg.toFixed(1)} · </> : null}

              {t('property.reviews', { count: hasAggregate ? summary.count : list.length })}
            </span>
          )}
        >

          {/* The aggregate grid is the part that needs the summary read; the cards below need only the list. */}
          {!hasAggregate && summaryFailed ? (
            /* Saying so is the point: silently dropping the grid would read as "this property has reviews but no
               rating", which is not a state the server can produce. */
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
              <p className="text-amber-200/90 text-sm py-4 inline-flex items-center gap-2" data-testid="property-review-list-unavailable"><Icon name="alert-triangle" className="w-4 h-4 flex-shrink-0" /> {t('property.reviewsUnavailable')}</p>
            ) : <p className="text-slate-500 text-sm py-4">{t('property.noReviewsFilter')}</p>}
          </div>
        </MobileCollapse>
      )}

      {modal ? <ReviewModal onClose={() => setModal(false)} onSubmit={submit} /> : null}
    </section>
  );
}
