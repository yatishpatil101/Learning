import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import PropertyImage from '../../components/ui/PropertyImage.jsx';
import { CARD_SIZES } from '../../lib/imgSrcSet.js';
import Loading from '../../components/ui/Loading.jsx';
import { ownerProfile, ownerListings } from '../../services/propertyService.js';
import { fmtINR, timeAgo, avatarFor } from '../../lib/format.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { maskPhone, fmtPhone, digits, isOwnerViewer } from '../../lib/contact.js';
import { useSignInGate } from '../../lib/useSignInGate.js';
/* The card is a fixed seven fields, not a spread user row; the
   rating is its own read since rows on hand are only page one. */
import { createEntityReview, getEntityReviewSummary, listEntityReviews } from '../../services/reviewService.js';
import { messagesLinkForProp } from '../../lib/chatFormat.js';
import { queuePendingChat } from '../../services/conversationService.js';
import ReportModal from '../../components/ReportModal.jsx';
import { OWNER_REPORT_REASONS } from '../../lib/reportReasons.js';

/* The relative label is derived at render: '2 days ago' is only
   true on the day it's computed, so a stored one goes stale. */
const toCard = (r) => ({
  id: r.id,
  n: r.user || 'User',
  a: avatarFor(r.user || 'U'),
  d: timeAgo(r.at),
  r: +r.rating || 0,
  t: r.text || '',
});

function Stars({ r, cls = 'w-3.5 h-3.5' }) {
  return (
    <>
      {[1, 2, 3, 4, 5].map((i) => (
        <Icon key={i} name="star" className={`${cls} ${i <= r ? 'text-amber-400 fill-amber-400' : 'text-gray-600'}`} />
      ))}
    </>
  );
}

function ReviewCard({ v }) {
  /* Rendered verbatim, never through t(): that would fall
     through to the raw string or resolve an unrelated key. / */
  return (
    <div className="border-b border-white/5 pb-4 last:border-0">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center text-white font-bold text-xs">{v.a}</div>
        <div className="flex-1"><p className="text-white text-sm font-medium">{v.n}</p><div className="flex gap-0.5"><Stars r={v.r} /></div></div>
        <span className="text-gray-500 text-xs">{v.d}</span>
      </div>
      <p className="text-gray-400 text-sm leading-relaxed">{v.t}</p>
    </div>
  );
}

export default function Owner() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const sendToSignIn = useSignInGate();
  const [owner, setOwner] = useState(undefined);
  // A separate read from `owner`, and `[]` rather than `null`: an owner with nothing live is the
  // common case, and the empty state is also the right answer to a failed read.
  const [listings, setListings] = useState([]);
  // `null` until the cards land; `reviewsFailed` stays apart from an empty array so an unreadable
  // list never renders as "no reviews yet", which states a fact nobody has established.
  const [reviews, setReviews] = useState(null);
  const [reviewsFailed, setReviewsFailed] = useState(false);
  // `null` until the summary read settles. `summaryFailed` is kept apart from `count === 0` so an
  // unreadable rating never renders as an owner nobody has reviewed.
  const [summary, setSummary] = useState(null);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [picked, setPicked] = useState(0);
  const [hover, setHover] = useState(0);
  const [revText, setRevText] = useState('');
  // Submitting is a round trip, so the control has to say so: without it a second click passes the
  // star and text guards while the first write is still open and files a duplicate review.
  const [posting, setPosting] = useState(false);
  const [reported, setReported] = useState(false);
  const { isIn } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    let alive = true;
    setOwner(undefined);
    setListings([]);
    // `null` from the seam covers unknown, malformed and archived alike — all three are "no such
    // owner" from a visitor's side, and the page's not-found state is the honest render of each.
    ownerProfile(id)
      .then((r) => { if (alive) setOwner(r); })
      .catch(() => { if (alive) setOwner(null); });
    ownerListings(id)
      .then((rows) => { if (alive) setListings(rows || []); })
      .catch(() => { /* the card stands without the rail */ });
    return () => { alive = false; };
  }, [id]);

  useEffect(() => {
    let alive = true;
    setReviews(null);
    setReviewsFailed(false);
    listEntityReviews('owner', id)
      .then((res) => { if (alive) setReviews((res?.items || []).map(toCard)); })
      .catch(() => { if (alive) setReviewsFailed(true); });
    return () => { alive = false; };
  }, [id]);

  useEffect(() => {
    let alive = true;
    setSummary(null);
    setSummaryFailed(false);
    getEntityReviewSummary('owner', id)
      .then((s) => { if (alive) setSummary(s); })
      .catch(() => { if (alive) setSummaryFailed(true); });
    return () => { alive = false; };
  }, [id]);

  const initials = useMemo(() => (owner ? (owner.name || 'A').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() : ''), [owner]);

  if (owner === undefined) return <Loading />;
  if (!owner) return (
    <div className="mx-auto max-w-3xl px-4 py-32 text-center">
      <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-4"><Icon name="user-search" className="w-6 h-6 text-gray-500" /></div>
      <h1 className="text-xl font-bold text-white">{t('owner.notFound')}</h1>
      <p className="text-gray-400 text-sm mt-1.5">{t('owner.notFoundBody')}</p>
      <Link to="/listings" className="btn-teal inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-semibold mt-5"><Icon name="search" className="w-4 h-4" /> {t('owner.browseListings')}</Link>
    </div>
  );

  // A year, computed server-side: a signup minute published on a public page is a correlation
  // handle nobody gains anything from.
  const memberSince = owner.memberSince ?? '\u2014';
  /* A percentage over a subset is a different claim: ownerListings
     is one page and a failed rail read is [], so show an em-dash. */
  const verifiedPct = owner.listingCount > 0 && listings.length === owner.listingCount
    ? `${Math.round((listings.filter((l) => l.verified).length / listings.length) * 100)}%`
    : '\u2014';
  const masked = maskPhone(owner.mobile);
  /* Owner-only: the contact gate is per listing and this surface has
     no listing in context; isOwnerViewer is a local comparison. */
  const revealed = isOwnerViewer(owner.mobile);

  const latestListing = listings.length ? [...listings].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] : null;
  const waText = t('owner.waIntro', { name: (owner.name || '').split(' ')[0] || t('owner.waFallbackName') });
  /* Figures come from the summary read, never `reviews`; `revAvg` stays null so an unrated owner isn't shown as
     rated badly; `dist` arrives ascending but the bars read downwards. */
  const revLoading = !summary && !summaryFailed;
  const revCount = summary ? summary.count : 0;
  const revAvg = summary && Number.isFinite(summary.avg) ? summary.avg : null;
  const dist = summary ? [...summary.dist].reverse() : [0, 0, 0, 0, 0];
  const maxDist = Math.max(1, ...dist);

  const postReview = () => {
    if (!isIn) { sendToSignIn('review'); return; }
    if (!picked) { toast(t('owner.errRating'), 'error'); return; }
    if (!revText.trim()) { toast(t('owner.errComment'), 'error'); return; }
    if (posting) return;
    setPosting(true);
    createEntityReview('owner', id, { rating: picked, text: revText.trim() })
      .then((saved) => {
        /* A signed-out write answers 'login' rather than throwing; the
           check above isn't enough as a session can expire mid-page. */
        if (saved === 'login') { sendToSignIn('review'); return; }
        /* Re-read both figures as a pair: the aggregate is the server's
           to compute, so the headline and list can't disagree. */
        return Promise.all([
          listEntityReviews('owner', id).catch(() => null),
          getEntityReviewSummary('owner', id).catch(() => 'error'),
        ]).then(([list, sum]) => {
          if (list) { setReviews((list.items || []).map(toCard)); setReviewsFailed(false); }
          if (sum === 'error') setSummaryFailed(true); else { setSummary(sum); setSummaryFailed(false); }
          setRevText('');
          setPicked(0);
          toast(t('owner.reviewPosted'), 'success');
        });
      })
      .catch(() => toast(t('common.somethingWentWrong'), 'error'))
      .finally(() => setPosting(false));
  };

  const messageOwner = () => {
    if (!isIn) { sendToSignIn('contact'); return; }
    if (latestListing) {
        queuePendingChat(latestListing, { firstMessage: waText });
      navigate(messagesLinkForProp(latestListing));
    } else {
      navigate('/contact');
    }
  };

  const scheduleHref = () => {
    const qp = new URLSearchParams();
    if (owner.mobile) qp.set('o', digits(owner.mobile));
    if (latestListing) { qp.set('listing', latestListing.id); if (latestListing.title) qp.set('title', latestListing.title); }
    const qs = qp.toString();
    return '/schedule-visit' + (qs ? `?${qs}` : '');
  };

  return (
    <div>
      <div className="pb-24 lg:pb-20 min-h-[100dvh]">
        <div className="cover h-44 sm:h-52 relative">
          <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 20% 30%,rgb(var(--dz-c-pure-white) / .3) 0,transparent 40%),radial-gradient(circle at 80% 60%,rgb(var(--dz-c-teal-500) / .4) 0,transparent 40%)' }} />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Profile header */}
          <div className="glass-card rounded-2xl p-6 -mt-16 relative">
            <button onClick={() => setReported(true)} type="button" aria-label={t('owner.reportAria')} className="sm:hidden absolute top-4 right-4 w-9 h-9 rounded-xl border border-white/10 text-gray-400 flex items-center justify-center hover:bg-rose-500/10 hover:text-rose-300 hover:border-rose-500/30 transition-all"><Icon name="flag" className="w-4 h-4" /></button>
            <div className="flex flex-col sm:flex-row sm:items-end gap-5">
              <div className="w-28 h-28 rounded-2xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center text-white text-4xl font-bold shadow-xl shadow-teal-500/25 -mt-16 sm:-mt-20 flex-shrink-0">{initials}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-bold text-white">{owner.name}</h1>
                  {/* Gated on the server's boolean: the badge must only
                      mark sellers the platform has verified. /} */}
                  {owner.verified ? <span data-testid="owner-verified-pill" className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-teal-500/15 border border-teal-500/25 text-teal-300 text-xs font-medium"><Icon name="badge-check" className="w-3.5 h-3.5" /> {t('owner.verifiedOwner')}</span> : null}
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 text-xs font-medium"><Icon name="hand-coins" className="w-3.5 h-3.5" /> {t('owner.zeroBrokerage')}</span>
                </div>
                <p className="text-gray-400 text-sm mt-1">{t('owner.roleLine')}</p>
                <div className="flex items-center gap-4 mt-2 text-sm">
                  <span className="flex items-center gap-1 text-amber-400"><Icon name="star" className="w-4 h-4 fill-amber-400" /> {revLoading ? <span className="skeleton inline-block h-3.5 w-20 rounded" aria-hidden="true" /> : summaryFailed ? <span className="text-amber-300/80 text-xs">{t('owner.ratingUnavailable')}</span> : <>{revAvg == null ? '—' : revAvg.toFixed(1)} <span className="text-gray-500">{t('owner.reviewCount', { count: revCount })}</span></>}</span>
                  <span className="flex items-center gap-1 text-gray-400"><Icon name="map-pin" className="w-4 h-4 text-teal-400" /> {owner.city || 'Pune'}</span>
                </div>
              </div>
              <div className="hidden sm:flex gap-2.5 flex-wrap">
                {revealed ? (
                  <>
                    <a href={`tel:+91${digits(owner.mobile)}`} className="px-4 py-2.5 rounded-xl border border-white/10 text-gray-200 text-sm font-medium hover:bg-white/5 flex items-center gap-2"><Icon name="phone" className="w-4 h-4 text-teal-400" /> {t('owner.call')}</a>
                    <a href={`https://wa.me/91${digits(owner.mobile)}?text=${encodeURIComponent(waText)}`} target="_blank" rel="noopener noreferrer" className="px-4 py-2.5 rounded-xl border border-emerald-500/20 text-emerald-400 text-sm font-medium hover:bg-emerald-500/10 flex items-center gap-2"><Icon name="message-circle" className="w-4 h-4" /> {t('owner.whatsapp')}</a>
                  </>
                ) : (
                  /* No Call/WhatsApp for visitors: the number is granted per
                     listing, so send them to one; in-app Message needs no number. */
                  <a href="#owner-listings" className="px-4 py-2.5 rounded-xl border border-white/10 text-gray-200 text-sm font-medium hover:bg-white/5 flex items-center gap-2"><Icon name="lock-keyhole" className="w-4 h-4 text-teal-400" /> {t('owner.contactViaListing')}</a>
                )}
                <button onClick={messageOwner} type="button" className="btn-teal px-4 py-2.5 rounded-xl text-white text-sm font-semibold flex items-center gap-2"><Icon name="send" className="w-4 h-4" /> {t('owner.message')}</button>
                <button onClick={() => setReported(true)} type="button" className="px-4 py-2.5 rounded-xl border border-white/10 text-gray-400 text-sm font-medium hover:bg-rose-500/10 hover:text-rose-300 hover:border-rose-500/30 flex items-center gap-2 transition-all"><Icon name="flag" className="w-4 h-4" /> {t('owner.report')}</button>
              </div>
            </div>
            {/* No response-time tile: the server records none, and an
                em-dash would falsely imply it is measured but unknown. */}
            {/* Two columns below `sm`: at 360px three tiles leave ~83px,
                and unbreakable Devanagari words would overflow. */}
            <div id="owner-header-stats" className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-6 pt-6 border-t border-white/10">
              <div><p className="text-2xl font-bold gradient-text">{owner.listingCount ?? listings.length}</p><p className="text-gray-500 text-xs">{t('owner.statListed')}</p></div>
              <div><p className="text-2xl font-bold gradient-text">{memberSince}</p><p className="text-gray-500 text-xs">{t('owner.statMemberSince')}</p></div>
              <div><p className="text-2xl font-bold gradient-text">{verifiedPct}</p><p className="text-gray-500 text-xs">{t('owner.statVerified')}</p></div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 mt-6">
            <div className="space-y-6">
              {/* About */}
              <div className="glass-card rounded-2xl p-6">
                <h2 className="text-lg font-bold text-white mb-3">{t('owner.aboutTitle')}</h2>
                {/* The unverified variant keeps what's still true (direct, no broker, no commission) and drops the
                    'verified' claim the server cannot support. */}
                <p className="text-gray-400 text-sm leading-relaxed">{t(owner.verified ? 'owner.aboutBody' : 'owner.aboutBodyUnverified', { name: owner.name })}</p>
                <div className="flex flex-wrap gap-2 mt-4">
                  {/* Gated like the header pill, or the emerald badge would
                      assert 'Verified Owner' where the teal one was withheld. */}
                  {owner.verified ? <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs font-medium"><Icon name="user-check" className="w-3.5 h-3.5" /> {t('owner.badgeVerifiedOwner')}</span> : null}
                  {/* No 'Ownership Verified' pill: that is modelled per listing
                      (PropertySummary.ownershipVerified), with no owner-level claim to read. */}
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/15 text-gray-300 text-xs font-medium"><Icon name="phone-off" className="w-3.5 h-3.5" /> {t('owner.badgeNumberProtected')}</span>
                </div>
              </div>

              {/* Listings */}
              <div id="owner-listings" className="glass-card rounded-2xl p-6 scroll-mt-28">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-lg font-bold text-white">{t('owner.listingsTitle')}</h2>
                  <Link to="/listings" className="text-teal-400 text-sm hover:text-teal-300">{t('owner.viewAll')}</Link>
                </div>
                {listings.length ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {listings.map((p) => (
                      <Link key={p.id} to={`/property/${p.id}`} className="prop-row rounded-xl overflow-hidden block group">
                        <div className="h-32 overflow-hidden"><PropertyImage src={p.image} sizes={CARD_SIZES} className="w-full h-full object-cover" alt="" /></div>
                        <div className="p-3">
                          <p className="text-white font-bold text-sm">{p.deal === 'rent' ? '₹' + (p.price || 0).toLocaleString('en-IN') + t('owner.perMonth') : fmtINR(p.price)}</p>
                          <p className="text-gray-400 text-xs group-hover:text-teal-400 transition-colors">{p.bhkNum ? p.bhkNum + ' BHK ' : ''}{p.type}</p>
                          <p className="text-gray-500 text-[11px] flex items-center gap-1 mt-0.5"><Icon name="map-pin" className="w-3 h-3 text-teal-400" />{p.locality}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-400 text-sm">{t('owner.noListings')}</p>
                )}
              </div>

              {/* Reviews */}
              <div className="glass-card rounded-2xl p-6">
                <h2 className="text-lg font-bold text-white mb-1">{t('owner.reviewsTitle')}</h2>
                <p className="text-gray-500 text-xs mb-5">{t('owner.reviewsSub')}</p>
                <div className="flex flex-col sm:flex-row gap-6 mb-6">
                  <div className="text-center sm:border-r border-white/10 sm:pr-6">
                    {revLoading ? (
                      <div className="skeleton h-12 w-20 rounded mx-auto" data-testid="owner-rating-skeleton" />
                    ) : (
                      <p className="text-5xl font-extrabold gradient-text">{revAvg == null ? '—' : revAvg.toFixed(1)}</p>
                    )}
                    <div className="flex justify-center gap-0.5 my-2"><Stars r={Math.round(revAvg || 0)} cls="w-4 h-4" /></div>
                    {/* Three outcomes: folding failure into `noReviews` would
                        make an outage read as a fact about the owner. */}
                    <p className="text-gray-500 text-xs">
                      {revLoading ? <span className="skeleton inline-block h-3 w-24 rounded" aria-hidden="true" />
                        : summaryFailed ? <span className="text-amber-300/80" data-testid="owner-rating-unavailable">{t('owner.ratingUnavailable')}</span>
                          : revCount ? t('owner.reviewsSummary', { count: revCount }) : t('owner.noReviews')}
                    </p>
                  </div>
                  <div className="flex-1 space-y-1.5">
                    {[5, 4, 3, 2, 1].map((s, i) => (
                      <div key={s} className="flex items-center gap-2 text-xs">
                        <span className="text-gray-400 w-3">{s}</span><Icon name="star" className="w-3 h-3 text-amber-400 fill-amber-400" />
                        <div className="flex-1 h-1.5 rounded-full bg-white/10"><div className="h-1.5 rounded-full bg-amber-400" style={{ width: `${(dist[i] / maxDist) * 100}%` }} /></div>
                        <span className="text-gray-500 w-6 text-right">{dist[i]}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-white/[0.04] border border-white/10 rounded-xl p-4 mb-5">
                  <p className="text-sm font-medium text-white mb-2">{t('owner.rateExperience')}</p>
                  <div className="star-pick flex gap-1 mb-3" onMouseLeave={() => setHover(0)}>
                    {[1, 2, 3, 4, 5].map((i) => (
                      <button key={i} type="button" onMouseEnter={() => setHover(i)} onClick={() => setPicked(i)} aria-label={t('owner.starAria', { count: i })}>
                        <Icon name="star" className={'w-6 h-6 ' + (i <= (hover || picked) ? 'text-amber-400 fill-amber-400' : 'text-gray-600')} />
                      </button>
                    ))}
                  </div>
                  <textarea rows={2} value={revText} onChange={(e) => setRevText(e.target.value)} placeholder={t('owner.reviewPlaceholder')} className="field w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-500 resize-none mb-3" />
                  <button onClick={postReview} disabled={posting} className="btn-teal px-5 py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-60">{t('owner.postReview')}</button>
                </div>
                {/* Same three outcomes as the headline: an unfetched review
                    list must not read as a statement about the owner. */}
                <div className="space-y-4">
                  {reviewsFailed ? (
                    <p className="text-amber-300/80 text-sm" data-testid="owner-reviews-unavailable">{t('common.somethingWentWrong')}</p>
                  ) : reviews === null ? (
                    <div className="space-y-3" data-testid="owner-reviews-skeleton" aria-hidden="true">
                      <div className="skeleton h-4 w-40 rounded" />
                      <div className="skeleton h-3 w-full rounded" />
                      <div className="skeleton h-3 w-3/4 rounded" />
                    </div>
                  ) : reviews.length ? (
                    reviews.map((v) => <ReviewCard key={v.id} v={v} />)
                  ) : (
                    <p className="text-gray-500 text-sm" data-testid="owner-reviews-empty">{t('owner.noReviews')}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-4">
              <div className="glass-card rounded-2xl p-6 sticky top-24">
                <div className="flex items-center gap-2 px-3 py-2 mb-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <Icon name="hand-coins" className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs text-emerald-300 font-medium">{t('owner.noBrokerageNote')}</span>
                </div>
                <h3 className="text-white font-bold mb-4">{t('owner.contactTitle')}</h3>
                <div className="space-y-2.5">
                  {revealed ? (
                    <>
                      <a href={`tel:+91${digits(owner.mobile)}`} className="flex items-center gap-3 py-3 px-4 rounded-xl border border-white/10 text-gray-200 text-sm hover:bg-white/5 transition-all"><Icon name="phone" className="w-4 h-4 text-teal-400" /> {fmtPhone(owner.mobile)}</a>
                      <a href={`https://wa.me/91${digits(owner.mobile)}`} target="_blank" rel="noopener noreferrer" className="hidden lg:flex items-center gap-3 py-3 px-4 mt-2.5 rounded-xl border border-emerald-500/20 text-emerald-400 text-sm hover:bg-emerald-500/10 transition-all"><Icon name="message-circle" className="w-4 h-4" /> {t('owner.chatWhatsapp')}</a>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-3 py-3 px-4 rounded-xl border border-white/10 text-gray-300 text-sm"><Icon name="phone-off" className="w-4 h-4 text-gray-500" /> <span className="tracking-wider">{masked}</span></div>
                      {/* No request button here either — the number is granted per listing, so the
                          only honest next step from a profile is to open one. */}
                      <p className="text-gray-500 text-xs mt-2 mb-2.5">{t('owner.numberHidden')}</p>
                      <a href="#owner-listings" className="btn-teal inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-white text-sm font-semibold"><Icon name="lock-keyhole" className="w-4 h-4" /> {t('owner.contactViaListing')}</a>
                    </>
                  )}
                  <a href="mailto:support@draazy.com" className="flex items-center gap-3 py-3 px-4 rounded-xl border border-white/10 text-gray-200 text-sm hover:bg-white/5 transition-all"><Icon name="mail" className="w-4 h-4 text-teal-400" /> {t('owner.emailSupport')}</a>
                  <div className={(revealed ? '' : 'hidden lg:block ') + 'mt-1'}><Link to={scheduleHref()} className="btn-teal flex items-center justify-center gap-2 py-3 rounded-xl text-white text-sm font-semibold"><Icon name="calendar-check" className="w-4 h-4" /> {t('owner.scheduleVisit')}</Link></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="dz-sticky-cta lg:hidden">
        {revealed ? (
          <>
            <a href={`tel:+91${digits(owner.mobile)}`} className="btn-teal flex-1 min-h-[44px] flex items-center justify-center gap-1.5 text-sm font-semibold py-3 px-4"><Icon name="phone" className="w-4 h-4" /> {t('owner.call')}</a>
            <a href={`https://wa.me/91${digits(owner.mobile)}?text=${encodeURIComponent(waText)}`} target="_blank" rel="noopener noreferrer" className="flex-1 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold py-3 px-4"><Icon name="message-circle" className="w-4 h-4" /> {t('owner.whatsapp')}</a>
          </>
        ) : (
          <>
            <button onClick={messageOwner} type="button" className="btn-teal flex-1 min-h-[44px] flex items-center justify-center gap-1.5 text-sm font-semibold py-3 px-4"><Icon name="send" className="w-4 h-4" /> {t('owner.message')}</button>
            <Link to={scheduleHref()} className="flex-1 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl border border-white/15 text-slate-200 text-sm font-semibold py-3 px-4"><Icon name="calendar-check" className="w-4 h-4" /> {t('owner.visit')}</Link>
          </>
        )}
      </div>

      {reported && (
        <ReportModal
          target={{ id: '', title: owner.name, ownerName: owner.name, ownerMobile: owner.mobile }}
          kind="user"
          reasons={OWNER_REPORT_REASONS}
          title={t('owner.reportTitle')}
          subtitle={t('owner.reportSubtitle')}
          success={t('owner.reportSuccess')}
          onClose={() => setReported(false)}
          toast={toast}
        />
      )}
    </div>
  );
}