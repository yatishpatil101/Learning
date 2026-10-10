import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import Breadcrumbs from '../../components/Breadcrumbs.jsx';
import LoadError from '../../components/LoadError.jsx';
import HScroll from '../../components/ui/HScroll.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { shareOrCopy } from '../../lib/share.js';
import { Stars } from './property/Stars.jsx';
import { useSocietyHub } from './society/useSocietyHub.js';
import { REVIEW_CATS, REVIEW_CAT_KEYS } from './society/constants.js';
import OverviewTab from './society/tabs/OverviewTab.jsx';
import HomesTab from './society/tabs/HomesTab.jsx';
import ReviewsTab from './society/tabs/ReviewsTab.jsx';
import LocationTab from './society/tabs/LocationTab.jsx';
import SocietySidebar from './society/SocietySidebar.jsx';
import SocietySkeleton from './society/SocietySkeleton.jsx';
import usePageHead from '../../lib/usePageHead.js';
import { societyHead } from '../../lib/listingSeo.js';

export default function Society() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const hub = useSocietyHub();
  const {
    rootRef, soc, socLoading, loadError, retryLoad, locName, hero, onFollow, followed, setRateOpen,
    rating, overall,
    rateOpen, pick, setPick, revText, setRevText, cats, setCat, inp, submitReview,
    stats, tabs, current, selectTab,
  } = hub;
  const head = socLoading || loadError ? {} : societyHead(soc);
  usePageHead({ title: head.title, description: head.description, path: `/society/${soc.slug}`, noindex: Boolean(soc._generic || head.thin) });

  /* The page URL is the whole share payload (family discussing
     a flat), so there is no deep-link contract to invent. */
  const shareSociety = async () => {
    const status = await shareOrCopy({ title: soc.name });
    if (status === 'copied') toast(t('property.shareCopied'), 'success');
    if (status === 'failed') toast(t('property.shareCopyFail'), 'error');
  };

  /* Same skeleton as the route's Suspense: until the seam read settles the page could only draw a generic
     not-found society, so the two waits are made to look like one. */
  if (socLoading) return <SocietySkeleton />;
  if (loadError) {
    return (
      <div className="pt-8 sm:pt-10 pb-24 max-w-md mx-auto px-4">
        <LoadError message={t('society.loadFailed')} error={loadError} onRetry={retryLoad} />
      </div>
    );
  }

  return (
    <div ref={rootRef} className="soc-page">
      <div className="pt-8 sm:pt-10 pb-24 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <Breadcrumbs
          className="mb-5 reveal"
          trail={[
            [t('nav.home'), '/'],
            [t('society.breadcrumb'), '/societies'],
            [locName, `/locality/${soc.localitySlug}`],
            [soc.name, null],
          ]}
        />

        {/* Hero */}
        <section className="theme-dark rounded-3xl overflow-hidden relative mb-6 glass reveal">
          <img src={hero} alt={soc.name} className="w-full h-56 sm:h-72 object-cover" />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg,rgb(var(--dz-c-ink) / .1),rgb(var(--dz-c-ink) / .88))' }} />
          {/* !h-11 below sm: these float over the hero photo so a taller pill
              reflows nothing; 36px from sm up, where pills read as chips. */}
          <div className="absolute top-4 right-4 flex gap-2">
            {soc._generic ? null : <button onClick={onFollow} className={(followed ? 'btn-teal' : 'btn-outline') + ' !h-11 sm:!h-9 !px-3 text-sm'}><Icon name={followed ? 'check' : 'bell'} className="w-4 h-4 mr-1.5" /> {followed ? t('society.following') : t('society.follow')}</button>}
            {soc._generic ? null : <button onClick={() => setRateOpen((v) => !v)} className="btn-outline !h-11 sm:!h-9 !px-3 text-sm"><Icon name="star" className="w-4 h-4 mr-1.5" /> {t('society.review')}</button>}
            {/* Label collapses below sm (three pills overflow 360px); aria-label
                names it, and min-width stands in for the missing text width. */}
            <button onClick={shareSociety} aria-label={t('society.share')} className="btn-outline !h-11 sm:!h-9 !px-3 !min-w-[44px] sm:!min-w-0 justify-center text-sm"><Icon name="share-2" className="w-4 h-4 sm:mr-1.5" /> <span className="hidden sm:inline">{t('society.share')}</span></button>
          </div>
          <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-8">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="tag" style={{ background: 'rgb(var(--dz-c-emerald-500) / .85)', color: 'rgb(var(--dz-c-pure-white))', border: 'none' }}>{t('society.zeroBrokerageTag')}</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold">{soc.name}</h1>
            <p className="text-gray-300 mt-1 flex items-center gap-3 flex-wrap">
              {soc.builder ? <span className="flex items-center gap-1.5"><Icon name="hard-hat" className="w-4 h-4 text-teal-400" /> {soc.builder}</span> : null}
              <span className="flex items-center gap-1.5"><Icon name="map-pin" className="w-4 h-4 text-teal-400" /> {locName}, Pune</span>
              {/* Stays blank until the summary read settles: the hero star strip is the most quotable number and
                  must not assert one it may contradict. */}
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
            {/* An untouched row sends no key, so 'did not rate' is absent rather than a 1 dragging the average
                down; each button names its aspect so the rows don't collide for a screen reader or test. */}
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
          <section className="glass rounded-2xl p-5 mb-8 reveal flex items-start gap-3">
            <Icon name="info" className="w-5 h-5 flex-shrink-0 mt-0.5 text-amber-400" />
            <div>
              <p className="font-semibold text-white">{t('society.thinUnverifiedTitle')}</p>
              <p className="text-sm text-gray-400">{t('society.thinUnverifiedBody')}</p>
            </div>
          </section>
        ) : stats.length ? (
          <section className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-8 reveal">
            {stats.map(([icon, labelKey, val]) => (
              <div key={labelKey} className="rd-cell"><div className="flex items-center gap-1.5 rd-lbl"><Icon name={icon} className="w-3.5 h-3.5 text-teal-400" /> {t(labelKey)}</div><p className="rd-val mt-0.5">{typeof val === 'object' ? t(val.key, val.args) : val}</p></div>
            ))}
          </section>
        ) : null}

        <div className="dz-docks-under-nav sticky top-[var(--dz-nav-h)] z-30 mb-6">
          <HScroll role="tablist" aria-label={t('society.sectionsAria')} className="flex gap-1 sm:gap-2 border-b border-white/10 bg-ink/80 backdrop-blur-md">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={current === tab.id}
                onClick={() => selectTab(tab.id)}
                className={`dz-detail-tab ${current === tab.id ? 'is-active' : ''}`}
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

            {current === 'location' && <LocationTab ctx={hub} />}
          </div>

          {/* Sidebar */}
          <SocietySidebar ctx={hub} />
        </div>
      </div>
    </div>
  );
}
