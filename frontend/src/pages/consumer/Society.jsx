import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import HScroll from '../../components/ui/HScroll.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { shareOrCopy } from '../../lib/share.js';
import { Stars } from './property/Stars.jsx';
import { useSocietyHub } from './society/useSocietyHub.js';
import { REVIEW_CATS, REVIEW_CAT_KEYS } from './society/constants.js';
import OverviewTab from './society/tabs/OverviewTab.jsx';
import HomesTab from './society/tabs/HomesTab.jsx';
import ReviewsTab from './society/tabs/ReviewsTab.jsx';
import CommunityTab from './society/tabs/CommunityTab.jsx';
import LocationTab from './society/tabs/LocationTab.jsx';
import SocietySidebar from './society/SocietySidebar.jsx';
import SocietyModals from './society/SocietyModals.jsx';

export default function Society() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const hub = useSocietyHub();
  const {
    rootRef, soc, locName, hero, onFollow, followed, setRateOpen,
    claimed, verified, iAmResident, rating, overall,
    rateOpen, pick, setPick, revText, setRevText, cats, setCat, inp, submitReview,
    sugRec, openSuggest, stats, tabs, current, selectTab,
  } = hub;

  /* A society page is the most forwarded thing on the site — "look at this
     building" is how a flat hunt actually gets discussed with family. The page
     URL is the whole payload, so there is no deep-link contract to invent here. */
  const shareSociety = async () => {
    const status = await shareOrCopy({ title: soc.name });
    if (status === 'copied') toast(t('property.shareCopied'), 'success');
    if (status === 'failed') toast(t('property.shareCopyFail'), 'error');
  };

  return (
    <div ref={rootRef} className="soc-page">
      <div className="pt-8 sm:pt-10 pb-24 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Breadcrumb links are their own tap targets, not a line of prose: each sits
            alone between chevrons, so WCAG 2.5.8's inline-text exemption does not
            apply and a 55x20 box is simply undersized. `tap-target` grows the hit
            area without changing the type or the row's look. */}
        <nav className="flex items-center gap-2 text-sm text-gray-400 mb-5 reveal" aria-label="Breadcrumb">
          <Link to="/societies" className="tap-target inline-flex items-center hover:text-white">{t('society.breadcrumb')}</Link><Icon name="chevron-right" className="w-3.5 h-3.5" />
          <Link to={`/locality/${soc.localitySlug}`} className="tap-target inline-flex items-center hover:text-white capitalize">{locName}</Link><Icon name="chevron-right" className="w-3.5 h-3.5" />
          <span className="text-white font-medium">{soc.name}</span>
        </nav>

        {/* Hero */}
        <section className="rounded-3xl overflow-hidden relative mb-6 glass reveal">
          <img src={hero} alt={soc.name} className="w-full h-56 sm:h-72 object-cover" />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg,rgba(15,13,26,.1),rgba(15,13,26,.88))' }} />
          {/* !h-11 below sm: these three float over the hero photo, so a taller pill
              reflows nothing, and the row is 256px of a 360px screen even at its
              widest — there is room. Back to 36px from sm up, where the hero is
              taller and the pills read as chips rather than buttons. */}
          <div className="absolute top-4 right-4 flex gap-2">
            <button onClick={onFollow} className={(followed ? 'btn-teal' : 'btn-outline') + ' !h-11 sm:!h-9 !px-3 text-sm'}><Icon name={followed ? 'check' : 'bell'} className="w-4 h-4 mr-1.5" /> {followed ? t('society.following') : t('society.follow')}</button>
            <button onClick={() => setRateOpen((v) => !v)} className="btn-outline !h-11 sm:!h-9 !px-3 text-sm"><Icon name="star" className="w-4 h-4 mr-1.5" /> {t('society.review')}</button>
            {/* Label collapses below sm: three labelled pills overflow a 360px hero.
                aria-label carries the name in the icon-only state — and because the
                label is gone, px-3 around a 16px glyph leaves the pill 42px wide, so
                it also needs an explicit min-width that the other two get from their
                text. */}
            <button onClick={shareSociety} aria-label={t('society.share')} className="btn-outline !h-11 sm:!h-9 !px-3 !min-w-[44px] sm:!min-w-0 justify-center text-sm"><Icon name="share-2" className="w-4 h-4 sm:mr-1.5" /> <span className="hidden sm:inline">{t('society.share')}</span></button>
          </div>
          <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-8">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              {claimed ? <span className="tag" style={{ background: 'rgba(37,99,235,.9)', color: '#fff', border: 'none' }}><Icon name="shield-check" className="w-3.5 h-3.5" /> {t('society.managedOnPuneNest')}</span> : null}
              {verified ? <span className="tag" style={{ background: 'rgba(13,148,136,.85)', color: '#fff', border: 'none' }}><Icon name="badge-check" className="w-3.5 h-3.5" /> {t('society.societyVerified')}</span> : null}
              {iAmResident ? <span className="tag" style={{ background: 'rgba(139,92,246,.85)', color: '#fff', border: 'none' }}><Icon name="home" className="w-3.5 h-3.5" /> {t('society.youLiveHere')}</span> : null}
              <span className="tag" style={{ background: 'rgba(16,185,129,.85)', color: '#fff', border: 'none' }}>{t('society.zeroBrokerageTag')}</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold">{soc.name}</h1>
            <p className="text-gray-300 mt-1 flex items-center gap-3 flex-wrap">
              {soc.builder ? <span className="flex items-center gap-1.5"><Icon name="hard-hat" className="w-4 h-4 text-teal-400" /> {soc.builder}</span> : null}
              <span className="flex items-center gap-1.5"><Icon name="map-pin" className="w-4 h-4 text-teal-400" /> {locName}, Pune</span>
              {/* Loading and failure are distinct from "nobody has rated it": the hero star strip is
                  the most quotable number on the page, so it stays blank until the summary read
                  settles rather than briefly asserting a number it may be about to contradict. */}
              {rating.loading ? (
                <span className="skeleton inline-block h-4 w-24 rounded" aria-hidden="true" />
              ) : rating.failed ? (
                <span className="flex items-center gap-1.5 text-amber-300/80 text-sm"><Icon name="alert-triangle" className="w-4 h-4" /> {t('society.ratingUnavailable')}</span>
              ) : !rating.count ? (
                <span className="flex items-center gap-1.5 text-gray-300 text-sm"><Icon name="sparkles" className="w-4 h-4 text-teal-400" /> {t('society.notRatedYet')}</span>
              ) : (
                <span className="flex items-center gap-1.5"><Stars value={overall} size={14} /> <span className="font-semibold text-white">{overall}</span> <span className="text-gray-400 text-sm">{`(${rating.count})`}</span></span>
              )}
            </p>
          </div>
        </section>

        {/* Inline review composer */}
        {rateOpen ? (
          <div className="glass rounded-2xl p-5 mb-6 reveal">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-sm font-medium text-gray-300">{t('society.yourRating')}</span>
              <span className="inline-flex items-center" style={{ gap: 2 }}>
                {[1, 2, 3, 4, 5].map((i) => <button key={i} onClick={() => setPick(i)} aria-label={t('society.starAria', { count: i })}><Icon name="star" style={{ width: 22, height: 22 }} className={i <= pick ? 'fill-amber-400 text-amber-400' : 'text-gray-600'} /></button>)}
              </span>
            </div>
            <textarea value={revText} onChange={(e) => setRevText(e.target.value)} rows={3} placeholder={t('society.reviewPlaceholder')} className={inp} />
            {/* Per-aspect rows, the ones the Reviews tab draws bars for. Optional and independent:
                an untouched row sends no key at all, so "did not rate Connectivity" reaches the
                column as absent rather than as a 1 that would drag the aspect's average down.
                Each button names its aspect so the five rows do not collide with the overall
                star strip above — or with each other — for a screen reader or a test. */}
            <div className="mt-3">
              <p className="text-sm font-medium text-gray-300 mb-2">{t('society.rateByCategory')}</p>
              <div className="space-y-2">
                {REVIEW_CATS.map((k) => (
                  <div key={k} className="flex items-center justify-between gap-3">
                    <span className="text-sm text-gray-400">{t(REVIEW_CAT_KEYS[k])}</span>
                    <span className="inline-flex items-center" style={{ gap: 2 }}>
                      {[1, 2, 3, 4, 5].map((i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setCat(k, i)}
                          aria-label={t('society.starAriaCat', { count: i, aspect: t(REVIEW_CAT_KEYS[k]) })}
                        >
                          <Icon name="star" style={{ width: 18, height: 18 }} className={i <= (cats[k] || 0) ? 'fill-amber-400 text-amber-400' : 'text-gray-600'} />
                        </button>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-3"><button onClick={() => setRateOpen(false)} className="btn-outline">{t('society.cancel')}</button><button onClick={submitReview} className="btn-teal">{t('society.postReview')}</button></div>
          </div>
        ) : null}

        {/* Stats / honest unverified state */}
        {soc._thin ? (
          <section className="glass rounded-2xl p-5 mb-8 reveal flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Icon name="info" className={`w-5 h-5 flex-shrink-0 mt-0.5 ${verified ? 'text-teal-400' : 'text-amber-400'}`} />
              <div>
                <p className="font-semibold text-white">{verified ? t('society.thinVerifiedTitle') : t('society.thinUnverifiedTitle')}</p>
                <p className="text-sm text-gray-400">{verified ? t('society.thinVerifiedBody') : t('society.thinUnverifiedBody')}</p>
              </div>
            </div>
            {sugRec && sugRec.status === 'pending' ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-amber-200 whitespace-nowrap flex-shrink-0"><Icon name="clock" className="w-4 h-4" /> {t('society.detailsPending')}</span>
            ) : (
              <button onClick={openSuggest} className="btn-teal !h-9 !px-4 text-sm whitespace-nowrap flex-shrink-0"><Icon name="badge-check" className="w-4 h-4 mr-1.5" /> {verified ? t('society.addDetails') : t('society.helpVerify')}</button>
            )}
          </section>
        ) : (
          <>
            {soc._community ? (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 reveal">
                <span className="text-xs text-gray-400 flex items-center gap-1.5"><Icon name="info" className="w-3.5 h-3.5 text-teal-400 flex-shrink-0" /> {t('society.communityNotice')}</span>
                <button onClick={openSuggest} className="text-xs font-medium text-brand-teal-3 hover:underline whitespace-nowrap">{t('society.suggestEdit')}</button>
              </div>
            ) : null}
            {stats.length ? (
              <section className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-8 reveal">
                {stats.map(([icon, labelKey, val]) => (
                  <div key={labelKey} className="rd-cell"><div className="flex items-center gap-1.5 rd-lbl"><Icon name={icon} className="w-3.5 h-3.5 text-teal-400" /> {t(labelKey)}</div><p className="rd-val mt-0.5">{typeof val === 'object' ? t(val.key, val.args) : val}</p></div>
                ))}
              </section>
            ) : null}
          </>
        )}

        <div className="pn-docks-under-nav sticky top-[var(--pn-nav-h)] z-30 mb-6">
          <HScroll role="tablist" aria-label={t('society.sectionsAria')} className="flex gap-1 sm:gap-2 border-b border-white/10 bg-ink/80 backdrop-blur-md">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={current === tab.id}
                onClick={() => selectTab(tab.id)}
                className={`pn-detail-tab ${current === tab.id ? 'is-active' : ''}`}
              >
                <Icon name={tab.icon} className="w-4 h-4" /> <span>{t(tab.labelKey)}</span>{tab.count ? <span className="ml-1 text-[11px] font-semibold text-slate-400">{tab.count}</span> : null}
              </button>
            ))}
          </HScroll>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            {current === 'overview' && <OverviewTab ctx={hub} />}

            {current === 'homes' && <HomesTab ctx={hub} />}

            {current === 'reviews' && <ReviewsTab ctx={hub} />}

            {current === 'community' && <CommunityTab ctx={hub} />}

            {current === 'location' && <LocationTab ctx={hub} />}
          </div>

          {/* Sidebar */}
          <SocietySidebar ctx={hub} />
        </div>
      </div>

      <SocietyModals ctx={hub} />
    </div>
  );
}
