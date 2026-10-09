import { useMemo, useState, useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import { useScrollReveal } from '../../lib/useScrollReveal.js';
import { useSignInGate } from '../../lib/useSignInGate.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { createEntityReview, getEntityReviewSummary, listEntityReviews } from '../../services/reviewService.js';
import { useSavedSearches } from '../../context/SavedSearchContext.jsx';
import { getLocality } from '../../services/localityService.js';
import { listSocietiesPage } from '../../services/societyService.js';
import { listProperties } from '../../services/propertyService.js';
import { fmtINR, fmtNum } from '../../lib/format.js';
import { buildAlertRecord } from './listings/alertCriteria.js';
import { guides } from 'virtual:locality-guides';
import usePageHead from '../../lib/usePageHead.js';
import ArticleProse from '../../components/help/ArticleProse.jsx';
import InventoryBar from './locality/InventoryBar.jsx';
import AlertButton from './locality/AlertButton.jsx';
import MapCard from './locality/MapCard.jsx';
import SocietiesBlock from './locality/SocietiesBlock.jsx';
import ReviewsBlock from './locality/ReviewsBlock.jsx';
import '../../styles/routes/locality.css';

function GuideHead({ guide }) {
  usePageHead({ title: guide.seoTitle, description: guide.description, path: `/locality/${guide.slug}` });
  return null;
}

export default function Locality() {
  const { t } = useTranslation();
  const rootRef = useScrollReveal();
  const { isIn } = useAuth();
  const { create: createSavedSearch } = useSavedSearches();
  const { toast } = useToast();
  const sendToSignIn = useSignInGate();
  const { slug } = useParams();

  const [load, setLoad] = useState({ slug: '', status: 'loading', data: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!slug) return undefined;
    let alive = true;
    getLocality(slug)
      .then((data) => { if (alive) setLoad({ slug, status: 'ready', data }); })
      .catch((err) => { if (alive) setLoad({ slug, status: err?.status === 404 ? 'missing' : 'error', data: null }); });
    return () => { alive = false; };
  }, [slug, attempt]);
  const status = !slug ? 'missing' : load.slug === slug ? load.status : 'loading';
  const loc = status === 'ready' ? load.data : null;
  const guide = guides.find((g) => g.slug === slug);

  // A written guide is real content even before the area has listings, so it lifts the noindex.
  const noindex = !guide && (status === 'missing' || (!!loc && !loc.indexable));
  useEffect(() => {
    if (!noindex) return undefined;
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, [noindex]);

  const name = loc?.name || guide?.name || '';
  useEffect(() => {
    if (!name || guide) return undefined;
    const prev = document.title;
    document.title = `${name} · Draazy`;
    return () => { document.title = prev; };
  }, [name, guide]);

  const [props, setProps] = useState([]);
  const [societies, setSocieties] = useState([]);
  useEffect(() => {
    if (!loc) return undefined;
    let alive = true;
    setProps([]);
    setSocieties([]);
    listProperties({ locality: loc.slug, includeAllStatuses: false }, 'newest')
      .then((ps) => { if (alive) setProps(ps.filter((p) => p.status === 'approved')); })
      .catch(() => {});
    listSocietiesPage({ locality: loc.slug, size: 6, sort: 'homes' })
      .then((res) => { if (alive) setSocieties(res?.rows || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [loc]);
  const inv = useMemo(() => {
    if (!props.length) return null;
    const from = props.reduce((m, p) => (p.price && p.price < m ? p.price : m), Infinity);
    return { count: props.length, from };
  }, [props]);

  const [reviews, setReviews] = useState([]);
  /* `'error'` keeps a failed read from rendering as "no reviews yet", a false claim about the area. */
  const [summary, setSummary] = useState(null);
  const [revText, setRevText] = useState('');
  const [pick, setPick] = useState(5);
  const locSlug = loc?.slug;
  useEffect(() => {
    if (!locSlug) return undefined;
    let alive = true;
    setReviews([]);
    setSummary(null);
    listEntityReviews('locality', locSlug)
      .then((res) => { if (alive) setReviews(res.items); })
      .catch(() => { if (alive) setReviews([]); });
    getEntityReviewSummary('locality', locSlug)
      .then((s) => { if (alive) setSummary(s); })
      .catch(() => { if (alive) setSummary('error'); });
    return () => { alive = false; };
  }, [locSlug]);

  const postReview = (e) => {
    e.preventDefault();
    // `signInPath` reads `window.location` at call time, so capture it before any async hop.
    const back = window.location.pathname + window.location.search;
    if (!isIn) { sendToSignIn('review', back); return; }
    createEntityReview('locality', locSlug, { rating: pick, text: revText.trim() })
      .then((saved) => {
        if (saved === 'login') { sendToSignIn('review', back); return null; }
        return Promise.all([listEntityReviews('locality', locSlug), getEntityReviewSummary('locality', locSlug)]);
      })
      .then((res) => {
        if (!res) return;
        setReviews(res[0].items);
        setSummary(res[1]);
        setRevText(''); setPick(5); toast(t('locality.reviewThanks'));
      })
      .catch(() => toast(t('locality.reviewFailed'), 'error'));
  };

  const setLocalityAlert = () => {
    if (!isIn) { sendToSignIn('alerts'); return; }
    createSavedSearch(buildAlertRecord({ deal: 'rent', localities: [locSlug] }, { [locSlug]: name }));
    toast(t('locality.alertOn', { name }));
  };

  if (!loc && !guide) {
    return (
      <div ref={rootRef} className="loc-page">
        <div className="pt-8 pb-20 min-h-[100dvh] max-w-3xl mx-auto px-4 sm:px-6">
          {status === 'loading' ? (
            <div className="flex justify-center pt-24" role="status" aria-label={t('locality.loading')}><Icon name="loader" className="w-6 h-6 text-teal-400 animate-spin" /></div>
          ) : (
            <div className="glass-card rounded-2xl p-6 text-center mt-10" data-testid="locality-unavailable">
              <p className="text-white font-semibold">{status === 'missing' ? t('locality.notFound') : t('locality.loadFailed')}</p>
              <div className="flex justify-center gap-3 mt-4">
                {status === 'error' ? <button type="button" onClick={() => setAttempt((n) => n + 1)} className="px-5 py-3 rounded-xl text-gray-200 text-sm font-semibold border border-white/10 hover:bg-white/5">{t('locality.retry')}</button> : null}
                <Link to="/listings" className="btn-teal px-5 py-3 rounded-xl text-white text-sm font-semibold">{t('locality.browseAll')}</Link>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const stats = loc ? [
    loc.avgRent != null && { icon: 'key-round', value: fmtINR(loc.avgRent), label: t('locality.statRent') },
    loc.ratePerSqft != null && { icon: 'ruler', value: '₹' + fmtNum(loc.ratePerSqft), label: t('locality.statRate') },
  ].filter(Boolean) : [];
  const listingsSlug = loc?.slug || slug;

  return (
    <div ref={rootRef} className="loc-page">
      {guide && <GuideHead guide={guide} />}
      <div className="pt-8 lg:pt-10 pb-20 min-h-[100dvh]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          <div className="reveal">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-400 text-sm font-medium mb-4"><Icon name="map-pin" className="w-4 h-4" /> {t('locality.eyebrow', { city: loc?.city || 'Pune' })}</div>
            <h1 className="text-3xl sm:text-4xl font-bold text-white">{name}</h1>
            <p className="text-gray-400 text-sm mt-2">
              <Trans i18nKey="locality.intro" values={{ name }} components={{ 1: <span className="text-teal-400 font-semibold" /> }} />
            </p>
            <div className="flex flex-wrap items-center gap-3 mt-5">
              <Link to={`/listings?loc=${encodeURIComponent(listingsSlug)}`} className="btn-teal px-5 py-3 rounded-xl text-white text-sm font-semibold flex items-center gap-2"><Icon name="search" className="w-4 h-4" /> {t('locality.ctaView')}</Link>
              {loc && <AlertButton activeName={name} onClick={setLocalityAlert} />}
            </div>
          </div>

          {loc ? (
            <>
              <div className="reveal"><InventoryBar inv={inv} activeName={name} slug={loc.slug} /></div>
              {stats.length ? (
                <div className="grid grid-cols-2 gap-3 sm:gap-4" data-testid="locality-stats">
                  {stats.map((s) => (
                    <div key={s.label} className="kpi glass-card rounded-2xl p-4 sm:p-5 reveal">
                      <div className="w-10 h-10 rounded-xl bg-teal-400/15 flex items-center justify-center mb-3"><Icon name={s.icon} className="w-5 h-5 text-teal-400" /></div>
                      <p className="text-2xl font-bold text-white">{s.value}</p>
                      <p className="text-gray-500 text-xs mt-0.5">{s.label}</p>
                    </div>
                  ))}
                </div>
              ) : <p className="text-gray-500 text-xs reveal" data-testid="locality-stats-pending">{t('locality.statsPending', { name })}</p>}
            </>
          ) : status === 'loading' ? (
            <div className="flex justify-center py-4" role="status" aria-label={t('locality.loading')}><Icon name="loader" className="w-5 h-5 text-teal-400 animate-spin" /></div>
          ) : status === 'error' ? (
            <p className="text-gray-500 text-xs">
              {t('locality.loadFailed')}{' '}
              <button type="button" onClick={() => setAttempt((n) => n + 1)} className="cursor-pointer font-semibold text-teal-400 hover:underline">{t('locality.retry')}</button>
            </p>
          ) : null}

          {guide && (
            <section aria-label={`About ${name}`} className="glass-card rounded-2xl p-5 sm:p-8 [&>div>:first-child]:mt-0" data-testid="locality-guide">
              <ArticleProse html={guide.html} />
            </section>
          )}

          {loc && (
            <>
              <MapCard activeName={name} activeCoords={loc.lat != null && loc.lng != null ? [loc.lat, loc.lng] : null} locProps={props} />
              <SocietiesBlock localSocieties={societies} activeName={name} activeSlug={loc.slug} />
              <ReviewsBlock activeName={name} locReviews={reviews} summary={summary === 'error' ? null : summary} summaryFailed={summary === 'error'} onSubmit={postReview} revText={revText} setRevText={setRevText} pick={pick} setPick={setPick} />
            </>
          )}

          {guide && (
            <nav aria-label="Other Pune localities">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-bold text-white">Other Pune localities</h2>
                <Link to="/locality" className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-teal-400 hover:underline">
                  All localities <Icon name="arrow-right" aria-hidden="true" className="h-4 w-4" />
                </Link>
              </div>
              <ul className="flex flex-wrap gap-2">
                {guides.filter((g) => g.slug !== guide.slug).map((g) => (
                  <li key={g.slug}>
                    <Link to={`/locality/${g.slug}`} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-white/10 bg-ink-card px-4 text-sm font-semibold text-gray-300 transition-colors hover:border-teal-400/40 hover:text-white">
                      <Icon name="map-pin" aria-hidden="true" className="h-3.5 w-3.5 text-teal-400" /> {g.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}
