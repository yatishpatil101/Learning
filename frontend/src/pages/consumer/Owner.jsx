import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import Loading from '../../components/ui/Loading.jsx';
import { getOwner } from '../../lib/mockApi.js';
import { fmtINR, timeAgo, avatarFor } from '../../lib/format.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { maskPhone, fmtPhone, digits, isOwnerViewer } from '../../lib/contact.js';
/* SEAM NOTE: owner reviews are deliberately still on the mock store.

   Every other review surface moved to `services/reviewService.js` in the reviews slice. This one
   cannot yet, because the *target* is not live: `getOwner()` reads `lib/mockApi/users.js`, whose
   ids are mock user ids, while the server keys owner reviews on its own user UUIDs. Pointing this
   at the service would produce a perfectly well-formed request for an owner the server has never
   heard of, and the empty result would render as "no reviews yet" — a silent wrong answer, which is
   worse than an honest mock. It moves when the owner profile does. */
import { getEntityReviews, addEntityReview } from '../../lib/store.js';
import { messagesLinkForProp } from '../../lib/chat.js';
import { queuePendingChat } from '../../services/conversationService.js';
import ReportModal, { OWNER_REPORT_REASONS } from '../../components/ReportModal.jsx';

/* Demo reviews shown before any real one is posted. Names stay as written — they
   are people's names, not copy — but the review text and relative dates are keyed
   so a Marathi reader is not shown three English paragraphs under a Marathi
   heading. */
const SEED_REVIEWS = [
  { id: 'seed1', n: 'Priya Kulkarni', a: 'PK', dateKey: 'owner.seedDate1', r: 5, textKey: 'owner.seedReview1' },
  { id: 'seed2', n: 'Rohit More', a: 'RM', dateKey: 'owner.seedDate2', r: 5, textKey: 'owner.seedReview2' },
  { id: 'seed3', n: 'Sneha Deshpande', a: 'SD', dateKey: 'owner.seedDate3', r: 4, textKey: 'owner.seedReview3' },
];

const mapStored = (r) => ({ id: r.id, n: r.user || 'User', a: avatarFor(r.user || 'U'), d: timeAgo(r.at), r: +r.rating || 0, t: r.text || '' });

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
  const { t } = useTranslation();
  // Seeded rows carry keys; user-posted rows carry literal text they wrote
  // themselves, which must never be run through the translator.
  const body = v.textKey ? t(v.textKey) : v.t;
  const when = v.dateKey ? t(v.dateKey) : v.d;
  return (
    <div className="border-b border-white/5 pb-4 last:border-0">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center text-white font-bold text-xs">{v.a}</div>
        <div className="flex-1"><p className="text-white text-sm font-medium">{v.n}</p><div className="flex gap-0.5"><Stars r={v.r} /></div></div>
        <span className="text-gray-500 text-xs">{when}</span>
      </div>
      <p className="text-gray-400 text-sm leading-relaxed">{body}</p>
    </div>
  );
}

export default function Owner() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const [owner, setOwner] = useState(undefined);
  const [reviews, setReviews] = useState(SEED_REVIEWS);
  const [picked, setPicked] = useState(0);
  const [hover, setHover] = useState(0);
  const [revText, setRevText] = useState('');
  const [reported, setReported] = useState(false);
  const { isIn } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    let alive = true;
    setOwner(undefined);
    getOwner(id).then((r) => alive && setOwner(r));
    return () => { alive = false; };
  }, [id]);

  useEffect(() => {
    setReviews([...getEntityReviews('owner', id).map(mapStored), ...SEED_REVIEWS]);
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

  const memberSince = (owner.joinedAt || '2024').slice(0, 4);
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

  const latestListing = owner.listings?.length ? [...owner.listings].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] : null;
  const waText = t('owner.waIntro', { name: (owner.name || '').split(' ')[0] || t('owner.waFallbackName') });
  const revCount = reviews.length;
  const revAvg = revCount ? Math.round((reviews.reduce((s, v) => s + v.r, 0) / revCount) * 10) / 10 : 0;
  const dist = [5, 4, 3, 2, 1].map((s) => reviews.filter((v) => v.r === s).length);
  const maxDist = Math.max(1, ...dist);

  const postReview = () => {
    if (!isIn) { navigate(`/signin?reason=contact&next=${encodeURIComponent(window.location.pathname + window.location.search)}`); return; }
    if (!picked) { toast(t('owner.errRating'), 'error'); return; }
    if (!revText.trim()) { toast(t('owner.errComment'), 'error'); return; }
    const saved = addEntityReview('owner', id, { rating: picked, text: revText.trim() });
    if (saved === 'login') { navigate(`/signin?reason=contact&next=${encodeURIComponent(window.location.pathname)}`); return; }
    setReviews((r) => [{ id: saved.id, n: saved.user, a: avatarFor(saved.user), d: t('owner.today'), r: picked, t: revText.trim() }, ...r]);
    setRevText('');
    setPicked(0);
    toast(t('owner.reviewPosted'), 'success');
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
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-teal-500/15 border border-teal-500/25 text-teal-300 text-xs font-medium"><Icon name="badge-check" className="w-3.5 h-3.5" /> {t('owner.verifiedOwner')}</span>
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 text-xs font-medium"><Icon name="hand-coins" className="w-3.5 h-3.5" /> {t('owner.zeroBrokerage')}</span>
                </div>
                <p className="text-gray-400 text-sm mt-1">{t('owner.roleLine')}</p>
                <div className="flex items-center gap-4 mt-2 text-sm">
                  <span className="flex items-center gap-1 text-amber-400"><Icon name="star" className="w-4 h-4 fill-amber-400" /> {revCount ? revAvg.toFixed(1) : '—'} <span className="text-gray-500">{t('owner.reviewCount', { count: revCount })}</span></span>
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-white/10">
              <div><p className="text-2xl font-bold gradient-text">{owner.listings?.length || 0}</p><p className="text-gray-500 text-xs">{t('owner.statListed')}</p></div>
              <div><p className="text-2xl font-bold gradient-text">{memberSince}</p><p className="text-gray-500 text-xs">{t('owner.statMemberSince')}</p></div>
              <div><p className="text-2xl font-bold gradient-text">100%</p><p className="text-gray-500 text-xs">{t('owner.statVerified')}</p></div>
              <div><p className="text-2xl font-bold gradient-text">~2 hrs</p><p className="text-gray-500 text-xs">{t('owner.statResponse')}</p></div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 mt-6">
            <div className="space-y-6">
              {/* About */}
              <div className="glass-card rounded-2xl p-6">
                <h2 className="text-lg font-bold text-white mb-3">{t('owner.aboutTitle')}</h2>
                <p className="text-gray-400 text-sm leading-relaxed">{t('owner.aboutBody', { name: owner.name })}</p>
                <div className="flex flex-wrap gap-2 mt-4">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs font-medium"><Icon name="user-check" className="w-3.5 h-3.5" /> {t('owner.badgeVerifiedOwner')}</span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs font-medium"><Icon name="scroll-text" className="w-3.5 h-3.5" /> {t('owner.badgeOwnershipVerified')}</span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/15 text-gray-300 text-xs font-medium"><Icon name="phone-off" className="w-3.5 h-3.5" /> {t('owner.badgeNumberProtected')}</span>
                </div>
              </div>

              {/* Listings */}
              <div id="owner-listings" className="glass-card rounded-2xl p-6 scroll-mt-28">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-lg font-bold text-white">{t('owner.listingsTitle')}</h2>
                  <Link to="/listings" className="text-teal-400 text-sm hover:text-teal-300">{t('owner.viewAll')}</Link>
                </div>
                {owner.listings?.length ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {owner.listings.map((p) => (
                      <Link key={p.id} to={`/property/${p.id}`} className="prop-row rounded-xl overflow-hidden block group">
                        <div className="h-32 overflow-hidden"><img src={p.image} className="w-full h-full object-cover" alt="" /></div>
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
                    <p className="text-5xl font-extrabold gradient-text">{revCount ? revAvg.toFixed(1) : '—'}</p>
                    <div className="flex justify-center gap-0.5 my-2"><Stars r={Math.round(revAvg)} cls="w-4 h-4" /></div>
                    <p className="text-gray-500 text-xs">{revCount ? t('owner.reviewsSummary', { count: revCount }) : t('owner.noReviews')}</p>
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
                  <button onClick={postReview} className="btn-teal px-5 py-2.5 rounded-xl text-white text-sm font-semibold">{t('owner.postReview')}</button>
                </div>
                <div className="space-y-4">
                  {reviews.map((v) => <ReviewCard key={v.id} v={v} />)}
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
                  <a href="mailto:hello@punenest.com" className="flex items-center gap-3 py-3 px-4 rounded-xl border border-white/10 text-gray-200 text-sm hover:bg-white/5 transition-all"><Icon name="mail" className="w-4 h-4 text-teal-400" /> {t('owner.emailSupport')}</a>
                  <div className={(revealed ? '' : 'hidden lg:block ') + 'mt-1'}><Link to={scheduleHref()} className="btn-teal flex items-center justify-center gap-2 py-3 rounded-xl text-white text-sm font-semibold"><Icon name="calendar-check" className="w-4 h-4" /> {t('owner.scheduleVisit')}</Link></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="pn-sticky-cta lg:hidden">
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