import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import MobileCollapse from '../../../components/ui/MobileCollapse.jsx';
import { digits } from '../../../lib/contact.js';
import { myMobile, getTenanciesFor } from '../../../lib/store.js';
import { listPropertyReviews, createPropertyReview, getPropertyReviewSummary } from '../../../services/reviewService.js';
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
  const isOwner = isIn && digits(myMobile()) === digits(owner);
  /* Mock-only, and named as such rather than left looking load-bearing: `getTenanciesFor` reads a
     localStorage bucket that nothing on the live path ever writes, so this term is always false
     against the real API. It stays because it is the mock suite's route to an eligible reviewer;
     the live equivalent needs a tenancy read on the seam. Keyed on `p.id` deliberately — the
     bucket is written with the same slug. */
  const hasTenancy = getTenanciesFor(myMobile()).some((t) => t.propId === p.id);

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
      else toast(t('property.bookVisitFirst'), 'info');
      return;
    }
    setModal(true);
  };

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
