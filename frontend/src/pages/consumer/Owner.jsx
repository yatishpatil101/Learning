import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import PropertyImage from '../../components/ui/PropertyImage.jsx';
import Loading from '../../components/ui/Loading.jsx';
import { ownerProfile, ownerListings } from '../../services/propertyService.js';
import { fmtINR, timeAgo, avatarFor } from '../../lib/format.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { maskPhone, fmtPhone, digits, isOwnerViewer } from '../../lib/contact.js';
/* SEAM NOTE: the card, the listings and both halves of the reviews block come from the API.

   Four separate things read through the seam, for four different reasons.

   The *card* used to be `getOwner()`, which spread the entire user row — email, role, account
   status, aadhaar state — and the page rendered five fields out of it. Nothing wrong was shown, but
   everything was sent, and a page that receives a field eventually shows one. `ownerProfile(id)`
   returns a fixed seven: id, name, masked mobile, verified, city, member-since *year*, and a live
   listing count. An archived account now 404s instead of rendering, which is the difference between
   deleting somebody and hiding them.

   The *listings* used to be `db.listings.filter(ownerId)` with no status filter, so a stranger could
   see an owner's rejected and archived rows. They are now `GET /properties?owner=`, a facet on the
   ordinary public search, which means they inherit the same approved-and-unarchived floor, the same
   paging and the same card shape as every other catalogue surface rather than a second copy of that
   rule that nobody would remember to update.

   The *aggregate* rating is read on its own, for its own reason: `owner.reviewCount` and the 5-star
   bars were reduced in the browser from whatever rows were on hand, which on a paged source means
   page one of twenty presented as the owner's rating. `getEntityReviewSummary('owner', id)`
   aggregates over every published review, server-side, and is the only source for the average, the
   count and the distribution.

   The review *cards* are a second read (`listEntityReviews`) rather than the rows the summary was
   computed from, because the summary endpoint deliberately returns no rows — the alternative,
   deriving the average from the list, is the bug described above.

   All three reads key on the same `:id` the route carries, which is the owner identifier the rest
   of the platform uses: `p.ownerId` on a listing card links here, `GET /owners/{id}` resolves the
   profile from it, and the review routes bind it as the entity id. There is no second owner
   identity to translate between, and a page that translated one would be inventing the mapping. */
import { createEntityReview, getEntityReviewSummary, listEntityReviews } from '../../services/reviewService.js';
import { messagesLinkForProp } from '../../lib/chatFormat.js';
import { queuePendingChat } from '../../services/conversationService.js';
import ReportModal from '../../components/ReportModal.jsx';
import { OWNER_REPORT_REASONS } from '../../lib/reportReasons.js';

/* One review, in the card's vocabulary. The relative label is derived at render time rather than
   carried on the record: "2 days ago" is only true on the day it is computed, so a stored label
   would be wrong for every visitor after the first. */
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
  /* The body and the date are rendered verbatim, never through the translator. A review is the
     author's own words about a stranger they dealt with; passing it through `t()` would either
     silently fall through to the raw string or, worse, resolve some other key that happened to
     match and put words in their mouth. */
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
  const [owner, setOwner] = useState(undefined);
  // Kept apart from `owner` because they are two reads now. `[]` rather than `null`: an owner with
  // nothing live is the common case, not a failure, and the empty state below is the right answer
  // to a rejection as well — a profile whose listing rail failed to load is still a profile.
  const [listings, setListings] = useState([]);
  // `null` until the cards land, and `reviewsFailed` kept apart from an empty array for the same
  // reason `summaryFailed` is kept apart from `count === 0`: an unreadable list rendered as "no
  // reviews yet" states a fact about the owner that nobody has established.
  const [reviews, setReviews] = useState(null);
  const [reviewsFailed, setReviewsFailed] = useState(false);
  // `null` until the summary read settles. `summaryFailed` is kept apart from `count === 0` so an
  // unreadable rating never renders as an owner nobody has reviewed.
  const [summary, setSummary] = useState(null);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [picked, setPicked] = useState(0);
  const [hover, setHover] = useState(0);
  const [revText, setRevText] = useState('');
  // Submitting is a round trip, so the control has to say so. Without it a second click lands
  // while the first write is still open — the star and text guards below have not been cleared
  // yet, so both submissions pass them and the owner collects two identical reviews.
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

  // A year, computed server-side and rendered as-is. It used to be `owner.joinedAt.slice(0, 4)`,
  // which meant the API had to send a timestamp for the page to throw most of away — and a signup
  // minute published on a public page is a correlation handle nobody gains anything from.
  const memberSince = owner.memberSince ?? '\u2014';
  /* "Verified Listings" was the literal string `100%`, under a label that names a measurable thing,
     for every seller on the site. Each card carries the server's own per-listing `verified` flag, so
     the figure is computable — but only while the page holds the whole set. `ownerListings` reads a
     single page of the public catalogue and `owner.listingCount` is counted server-side over all of
     it, so the two part company for an owner past the page size; they also part company when the
     rail read simply failed, because `listings` stays `[]`, which is indistinguishable from an owner
     who has none. A percentage over a subset is a different claim wearing the same label, so
     anything short of the full set renders an em-dash rather than a number nobody can source. */
  const verifiedPct = owner.listingCount > 0 && listings.length === owner.listingCount
    ? `${Math.round((listings.filter((l) => l.verified).length / listings.length) * 100)}%`
    : '\u2014';
  const masked = maskPhone(owner.mobile);
  /* The number is revealed here only to the owner themselves.

     This page used to reveal it to anyone holding an approved request against *any* of this
     owner's listings — which is a cross-listing grant, and the contact gate is deliberately
     per-listing: approval on a Baner 2BHK says nothing about the same owner's Kothrud shop. The
     profile is the one surface with no listing in context, so it has no gate to ask about, and
     there is no server endpoint for "approved for this owner in general" because that permission
     does not exist. Contact is therefore requested on a listing, where the grant it creates is
     the grant the user is actually being shown.

     `isOwnerViewer` is a local identity comparison, not a permission lookup — no round trip. */
  const revealed = isOwnerViewer(owner.mobile);

  const latestListing = listings.length ? [...listings].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] : null;
  const waText = t('owner.waIntro', { name: (owner.name || '').split(' ')[0] || t('owner.waFallbackName') });
  /**
   * Every figure below comes from the summary read — none from `reviews`.
   *
   * `revAvg` is `null`, not 0, when nobody has reviewed: the server sends null for the same reason,
   * and a five-star strip rendering 0.0 asserts that an owner was rated badly rather than not rated.
   * `dist` arrives ascending (index 0 = one star) and the bars below read downwards, hence the
   * reverse — getting that backwards silently mirrors the histogram, which still looks plausible.
   */
  const revLoading = !summary && !summaryFailed;
  const revCount = summary ? summary.count : 0;
  const revAvg = summary && Number.isFinite(summary.avg) ? summary.avg : null;
  const dist = summary ? [...summary.dist].reverse() : [0, 0, 0, 0, 0];
  const maxDist = Math.max(1, ...dist);

  const postReview = () => {
    if (!isIn) { navigate(`/signin?reason=contact&next=${encodeURIComponent(window.location.pathname + window.location.search)}`); return; }
    if (!picked) { toast(t('owner.errRating'), 'error'); return; }
    if (!revText.trim()) { toast(t('owner.errComment'), 'error'); return; }
    if (posting) return;
    setPosting(true);
    createEntityReview('owner', id, { rating: picked, text: revText.trim() })
      .then((saved) => {
        /* A signed-out write answers with the string `'login'` rather than throwing, because "we
           know who you are not" is an answer, not a failure. The check above is not enough on its
           own: a session can expire between the page loading and the review being submitted. */
        if (saved === 'login') { navigate(`/signin?reason=contact&next=${encodeURIComponent(window.location.pathname)}`); return; }
        /* Both figures are re-read, together, rather than the card being prepended locally and the
           count incremented: the aggregate is the server's to compute, and a browser that adds its
           own row to one and its own +1 to the other is how the headline and the list start
           disagreeing. Read as a pair so the page can never show a card the average excludes. */
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
    if (!isIn) { navigate(`/signin?reason=contact&next=${encodeURIComponent(window.location.pathname + window.location.search)}`); return; }
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
          <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 20% 30%,rgba(255,255,255,.3) 0,transparent 40%),radial-gradient(circle at 80% 60%,rgba(20,184,166,.4) 0,transparent 40%)' }} />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Profile header */}
          <div className="glass-card rounded-2xl p-6 -mt-16 relative">
            <button onClick={() => setReported(true)} type="button" aria-label={t('owner.reportAria')} className="sm:hidden absolute top-4 right-4 w-9 h-9 rounded-xl border border-white/10 text-gray-400 flex items-center justify-center hover:bg-rose-500/10 hover:text-rose-300 hover:border-rose-500/30 transition-all"><Icon name="flag" className="w-4 h-4" /></button>
            <div className="flex flex-col sm:flex-row sm:items-end gap-5">
              <div className="w-28 h-28 rounded-2xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center text-white text-4xl font-bold border-4 border-[#0f0d1a] -mt-16 sm:-mt-20 flex-shrink-0">{initials}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-bold text-white">{owner.name}</h1>
                  {/* Gated on the server's boolean. This pill used to render for everyone, so the
                      badge that is supposed to distinguish a verified seller from an unverified one
                      was shown to every anonymous visitor on every profile — including sellers the
                      platform had *not* verified, which is the only case it exists to mark. */}
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
                  /* No Call/WhatsApp here for visitors: the number is granted per listing, so the
                     honest affordance is to send them to one. Message is unaffected — in-app chat
                     is L1 and needs no number. */
                  <a href="#owner-listings" className="px-4 py-2.5 rounded-xl border border-white/10 text-gray-200 text-sm font-medium hover:bg-white/5 flex items-center gap-2"><Icon name="lock-keyhole" className="w-4 h-4 text-teal-400" /> {t('owner.contactViaListing')}</a>
                )}
                <button onClick={messageOwner} type="button" className="btn-teal px-4 py-2.5 rounded-xl text-white text-sm font-semibold flex items-center gap-2"><Icon name="send" className="w-4 h-4" /> {t('owner.message')}</button>
                <button onClick={() => setReported(true)} type="button" className="px-4 py-2.5 rounded-xl border border-white/10 text-gray-400 text-sm font-medium hover:bg-rose-500/10 hover:text-rose-300 hover:border-rose-500/30 flex items-center gap-2 transition-all"><Icon name="flag" className="w-4 h-4" /> {t('owner.report')}</button>
              </div>
            </div>
            {/* Three tiles, not four. The fourth was "Avg. Response Time: ~2 hrs", hard-coded — no
                response time is recorded anywhere on the server, so there was nothing to read and
                no honest value to fall back to. An em-dash would have claimed the platform measures
                this and happens not to know it for this seller, which is also untrue. */}
            {/* Two columns on a phone, three from `sm`. Three across at 360px leaves ~83px a tile,
                which English absorbs by wrapping but Devanagari cannot: `नोंदवलेल्या` and
                `पडताळलेल्या` are single unbreakable words and would overflow the tile. */}
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
                {/* The prose made the same claim as the pill, in a sentence: "{{name}} is a verified
                    property owner" — for every seller, in all three locales. Gating only the badges
                    would have left the assertion standing in text two lines below them. The
                    unverified variant keeps everything still true of the seller (direct, no broker,
                    no commission) and drops the one word the server does not support. */}
                <p className="text-gray-400 text-sm leading-relaxed">{t(owner.verified ? 'owner.aboutBody' : 'owner.aboutBodyUnverified', { name: owner.name })}</p>
                <div className="flex flex-wrap gap-2 mt-4">
                  {/* Second home of the header pill's claim, and it was printed unconditionally, so
                      gating the header alone changed nothing a visitor sees for exactly the sellers
                      the gate exists to protect — the emerald badge asserted "Verified Owner" in the
                      same viewport the teal one had just been withheld from. */}
                  {owner.verified ? <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs font-medium"><Icon name="user-check" className="w-3.5 h-3.5" /> {t('owner.badgeVerifiedOwner')}</span> : null}
                  {/* "Ownership Verified" is gone rather than gated. It is a stronger claim than the
                      one beside it — that the seller's title paperwork was checked — and there is no
                      owner-level field for it: the platform models it strictly per listing
                      (`PropertySummary.ownershipVerified`, whose own docblock calls it a separate
                      axis from `ownerVerified`, either true alone). Aggregating it to the person is
                      a claim the server does not make at any level, so there is nothing to read. */}
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
                        <div className="h-32 overflow-hidden"><PropertyImage src={p.image} className="w-full h-full object-cover" alt="" /></div>
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
                    {/* Three outcomes. Folding the failure into `noReviews` would make an outage
                        indistinguishable from an owner nobody has reviewed — and the second reads as
                        a fact about the owner. */}
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
                {/* The same three outcomes the headline distinguishes, for the same reason: an
                    owner with no reviews and an owner whose reviews could not be fetched are
                    different situations, and only one of them is a statement about the owner. */}
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
                  <a href="mailto:hello@draazy.com" className="flex items-center gap-3 py-3 px-4 rounded-xl border border-white/10 text-gray-200 text-sm hover:bg-white/5 transition-all"><Icon name="mail" className="w-4 h-4 text-teal-400" /> {t('owner.emailSupport')}</a>
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