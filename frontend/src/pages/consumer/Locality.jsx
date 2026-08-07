import { useMemo, useState, useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import { useScrollReveal } from '../../lib/useScrollReveal.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { createEntityReview, listEntityReviews } from '../../services/reviewService.js';
import { useSavedSearches } from '../../context/SavedSearchContext.jsx';
import { localityBySlug, localityByName } from '../../data/localities.js';
import { allSocieties } from '../../data/societies.js';
import { LOC } from '../../data/localityIntel.js';
import { listProperties } from '../../services/propertyService.js';
import { buildAlertRecord } from './listings/alertCriteria.js';
import Tabs from '../../components/ui/Tabs.jsx';
import Select from '../../components/ui/Select.jsx';
import {
  NAMES, DEMAND_W, fmtRs, scoreOf, rentOf, yieldOf, puneAvgPrice, puneAvgYoy,
  buildTrend, metricVal, metricFmt, trendGradient, slugifyLoc, haversineKm,
  INTEL_GEO, bestForTags, DEMAND_KEYS,
} from './locality/helpers.js';
import InventoryBar from './locality/InventoryBar.jsx';
import AlertButton from './locality/AlertButton.jsx';
import MapCard from './locality/MapCard.jsx';
import SocietiesBlock from './locality/SocietiesBlock.jsx';
import ReviewsBlock from './locality/ReviewsBlock.jsx';
import PriceTrendCard from './locality/PriceTrendCard.jsx';
import LivabilityCard from './locality/LivabilityCard.jsx';
import CompareCard from './locality/CompareCard.jsx';
import MarketPulseCard from './locality/MarketPulseCard.jsx';
import ConnectivityCard from './locality/ConnectivityCard.jsx';
import LeaderboardCard from './locality/LeaderboardCard.jsx';
import EmergingPanel from './locality/EmergingPanel.jsx';
import '../../styles/routes/locality.css';

export default function Locality() {
  const { t, i18n } = useTranslation();
  const rootRef = useScrollReveal();
  const { isIn } = useAuth();
  const { create: createSavedSearch } = useSavedSearches();
  const { toast } = useToast();
  const [params] = useSearchParams();
  const { slug } = useParams();
  const ql = params.get('locality') || (slug ? slug.replace(/-/g, ' ') : '');
  const intelMatch = ql ? NAMES.find((n) => n.toLowerCase() === ql.toLowerCase()) : null;
  const initial = intelMatch || 'Baner';
  // A real registry/community locality that has no intel dashboard renders an
  // honest "emerging locality" panel instead of silently mislabeling Baner's data.
  const reg = !intelMatch ? (localityBySlug(slug) || localityByName(ql)) : null;
  const emerging = !!reg;
  const emergingName = reg ? reg.name : '';

  const [current, setCurrent] = useState(initial);
  const [bhk, setBhk] = useState(2);
  const [range, setRange] = useState('1Y');
  const [vsLoc, setVsLoc] = useState('');
  const [cmp, setCmp] = useState(new Set(['Baner', 'Wakad', 'Hinjawadi', 'Kharadi']));
  const [cmpMetric, setCmpMetric] = useState('price');
  const [sort, setSort] = useState({ key: 'price', dir: -1 });
  const [pick, setPick] = useState(5);
  const [revText, setRevText] = useState('');
  const [reviews, setReviews] = useState({});
  const [props, setProps] = useState([]);

  const L = LOC[current];
  const sc = scoreOf(current);
  const livRank = 1 + NAMES.filter((n) => scoreOf(n) > sc).length;

  // The locality currently in focus works for both the full dashboard (a covered
  // locality) and the emerging panel (a registry-only locality), so inventory,
  // map, societies and reviews all key off one identity.
  const activeName = emerging ? emergingName : current;
  const activeSlug = emerging ? reg.slug : (localityByName(current)?.slug || slugifyLoc(current));
  const activeCoords = useMemo(() => {
    if (emerging) return [reg.lat, reg.lng];
    const r = localityByName(current);
    return r ? [r.lat, r.lng] : null;
  }, [emerging, reg, current]);

  // Live inventory for the funnel bridge: the count, cheapest price and buy/rent split for the
  // locality being viewed. Scoped server-side — the previous version indexed the entire catalogue
  // by slug and then read exactly one entry out of that map.
  useEffect(() => {
    let alive = true;
    if (!activeSlug) { setProps([]); return () => { alive = false; }; }
    listProperties({ locality: activeSlug, includeAllStatuses: false }, 'newest').then((ps) => {
      if (alive) setProps(ps.filter((p) => p.status === 'approved'));
    });
    return () => { alive = false; };
  }, [activeSlug]);
  const inv = useMemo(() => {
    if (!props.length) return null;
    const e = { count: 0, from: Infinity, buy: 0, rent: 0 };
    props.forEach((p) => {
      e.count++;
      if (p.deal === 'rent') e.rent++; else e.buy++;
      if (p.price && p.price < e.from) e.from = p.price;
    });
    return e;
  }, [props]);
  const locProps = props;

  // Nearest covered localities — an honest benchmark proxy for an emerging area
  // whose own dashboard isn't ready yet.
  const nearestIntel = useMemo(() => {
    if (!emerging || !activeCoords) return [];
    return INTEL_GEO
      .map((g) => ({ ...g, km: haversineKm(activeCoords[0], activeCoords[1], g.lat, g.lng) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, 3);
  }, [emerging, activeCoords]);

  // Societies in the active locality — a society-first discovery bridge into the
  // Society Hub, drawn from the full catalogue (curated + RERA + community).
  const localSocieties = useMemo(
    () => allSocieties().filter((s) => s.localitySlug === activeSlug).slice(0, 6),
    [activeSlug],
  );

  const load = (name) => {
    if (!LOC[name]) return;
    setCurrent(name);
    setCmp((s) => { if (s.has(name)) return s; const n = new Set(s); if (n.size >= 6) n.delete([...n][0]); n.add(name); return n; });
    if (vsLoc === name) setVsLoc('');
  };
  const toggleCmp = (n) => setCmp((s) => { const next = new Set(s); if (next.has(n)) { if (next.size > 1) next.delete(n); } else if (next.size < 6) next.add(n); return next; });
  const onSort = (k) => setSort((s) => ({ key: k, dir: s.key === k ? -s.dir : k === 'name' ? 1 : -1 }));

  // ----- charts -----
  const trend = useMemo(() => {
    const tr = buildTrend(L.price, L.yoy, range, i18n.language), p = buildTrend(puneAvgPrice, puneAvgYoy, range, i18n.language);
    return {
      labels: tr.labels,
      datasets: [
        { label: current, data: tr.actual, borderColor: '#14b8a6', backgroundColor: trendGradient, fill: true, tension: 0.4, borderWidth: 3, pointRadius: 0, pointHoverRadius: 5, spanGaps: false },
        { label: t('locality.trendForecast'), data: tr.fc, borderColor: '#f59e0b', borderDash: [6, 5], fill: false, tension: 0.4, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5 },
        { label: t('locality.trendPuneAvgShort'), data: p.actual, borderColor: '#6366f1', fill: false, tension: 0.4, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, borderDash: [2, 3] },
      ],
    };
  }, [current, range, L, t, i18n.language]);

  const scoreLabel = sc >= 8.5 ? 'locality.scoreExcellent' : sc >= 8 ? 'locality.scoreVeryGood' : sc >= 7.5 ? 'locality.scoreGood' : 'locality.scoreAverage';

  const cmpNames = [...cmp];
  const cmpFmt = metricFmt(cmpMetric);
  const cmpData = { labels: cmpNames, datasets: [{ data: cmpNames.map((n) => metricVal(n, cmpMetric)), backgroundColor: cmpNames.map((n) => (n === current ? '#14b8a6' : '#0d9488')), borderRadius: 8, maxBarThickness: 46 }] };
  const cmpOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => cmpFmt(c.parsed.y) } } }, scales: { x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 11 } } }, y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b', font: { size: 10 }, callback: cmpFmt } } } };

  const lbRows = useMemo(() => {
    const rows = NAMES.map((n) => ({ name: n, price: LOC[n].price, yoy: LOC[n].yoy, yield: yieldOf(n, 2), liv: scoreOf(n), demand: DEMAND_W[LOC[n].demand], demandTxt: LOC[n].demand }));
    rows.sort((a, b) => (sort.key === 'name' ? sort.dir * a.name.localeCompare(b.name) : sort.dir * (a[sort.key] - b[sort.key])));
    return rows;
  }, [sort]);

  /* Each pulse entry is [labelKey, valueKeyOrTemplate, icon, colour]; composed
     values carry their own args so the card can render them in any language. */
  const pulse = [
    ['locality.pulseDemand', DEMAND_KEYS[L.demand] || L.demand, 'flame', L.demand === 'Very High' ? 'text-rose-400' : L.demand === 'High' ? 'text-amber-400' : 'text-teal-400'],
    ['locality.pulseLaunches', { key: 'locality.pulseProjects', args: { count: L.launches } }, 'building-2', 'text-teal-400'],
    ['locality.pulseAge', { key: 'locality.pulseAgeVal', args: { count: L.age } }, 'calendar-clock', 'text-teal-300'],
    ['locality.pulseBuyer', { key: 'locality.pulseBuyerVal', args: { score: L.buyer } }, 'users', 'text-emerald-400'],
  ];

  /**
   * Reviews key on `activeSlug`, like everything else on this page.
   *
   * They used to key on `activeName.toLowerCase()`, which is the *display name* lowercased. For a
   * single-word locality the two happen to agree, which is why this survived; for "Viman Nagar" the
   * review bucket was `viman nagar` while the listings query, the societies filter and the URL all
   * used `viman-nagar`. The server keys localities on the slug — it is their primary key — so the
   * old key would simply have addressed a locality that does not exist.
   */
  useEffect(() => {
    if (!activeSlug || reviews[activeSlug]) return undefined;
    let alive = true;
    listEntityReviews('locality', activeSlug)
      .then((res) => { if (alive) setReviews((r) => ({ ...r, [activeSlug]: res.items })); })
      .catch(() => { if (alive) setReviews((r) => ({ ...r, [activeSlug]: [] })); });
    return () => { alive = false; };
  }, [activeSlug, reviews]);
  const locReviews = reviews[activeSlug] || [];
  const postReview = (e) => {
    e.preventDefault();
    if (!isIn) { toast(t('locality.signInReview'), 'error'); return; }
    createEntityReview('locality', activeSlug, { rating: pick, text: revText.trim() })
      .then((saved) => {
        if (saved === 'login') { toast(t('locality.signInReview'), 'error'); return null; }
        return listEntityReviews('locality', activeSlug);
      })
      .then((res) => {
        if (!res) return;
        setReviews((r) => ({ ...r, [activeSlug]: res.items }));
        setRevText(''); setPick(5); toast(t('locality.reviewThanks'));
      })
      .catch(() => toast(t('locality.signInReview'), 'error'));
  };

  // Locality alert — reuses the same saved-search/alert layer as the listings
  // "Create a property alert" flow, so it lands in the dashboard Alerts panel and
  // fires on new matches. Sign-in gated, mirroring the review gate above.
  const setLocalityAlert = () => {
    if (!isIn) { toast(t('locality.signInAlert'), 'error'); return; }
    const rec = buildAlertRecord({ deal: 'rent', localities: [activeSlug] }, { [activeSlug]: activeName });
    createSavedSearch(rec);
    toast(t('locality.alertOn', { name: activeName }));
  };

  // Shared UI fragments used by both the full dashboard and the emerging panel.
  const invBar = <InventoryBar inv={inv} activeName={activeName} />;
  const alertBtn = <AlertButton activeName={activeName} onClick={setLocalityAlert} />;
  const mapCard = <MapCard activeName={activeName} activeCoords={activeCoords} locProps={locProps} />;
  const societiesBlock = localSocieties.length ? <SocietiesBlock localSocieties={localSocieties} activeName={activeName} activeSlug={activeSlug} /> : null;
  const reviewsBlock = <ReviewsBlock activeName={activeName} locReviews={locReviews} onSubmit={postReview} revText={revText} setRevText={setRevText} pick={pick} setPick={setPick} />;

  if (emerging) {
    return (
      <EmergingPanel
        rootRef={rootRef}
        emergingName={emergingName}
        nearestIntel={nearestIntel}
        invBar={invBar}
        alertBtn={alertBtn}
        mapCard={mapCard}
        societiesBlock={societiesBlock}
        reviewsBlock={reviewsBlock}
      />
    );
  }

  const bestFor = bestForTags(current, yieldOf(current, bhk));

  // Detail sections, grouped into tabs to keep the page compact on mobile & web.
  const trendBlock = <PriceTrendCard current={current} range={range} setRange={setRange} data={trend} />;
  const livabilityBlock = <LivabilityCard current={current} vsLoc={vsLoc} setVsLoc={setVsLoc} sc={sc} scoreLabel={scoreLabel} livRank={livRank} L={L} />;
  const compareBlock = <CompareCard cmpMetric={cmpMetric} setCmpMetric={setCmpMetric} cmp={cmp} toggleCmp={toggleCmp} cmpData={cmpData} cmpOpts={cmpOpts} />;
  const pulseBlock = <MarketPulseCard pulse={pulse} />;
  const connBlock = <ConnectivityCard conn={L.conn} />;
  const leaderboardBlock = <LeaderboardCard rows={lbRows} current={current} onSort={onSort} onLoad={load} />;

  const tabs = [
    { key: 'overview', label: t('locality.tabOverview'), icon: 'bar-chart-3', content: (
      <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-5 sm:gap-6">{trendBlock}{livabilityBlock}</div>
    ) },
    { key: 'compare', label: t('locality.tabCompare'), icon: 'scale', content: (
      <div className="space-y-5 sm:space-y-6">{compareBlock}{leaderboardBlock}</div>
    ) },
    { key: 'area', label: t('locality.tabArea'), icon: 'map-pin', content: (
      <div className="space-y-5 sm:space-y-6">{mapCard}<div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6">{pulseBlock}{connBlock}</div></div>
    ) },
    societiesBlock ? { key: 'societies', label: t('locality.tabSocieties'), icon: 'building-2', content: societiesBlock } : null,
    { key: 'reviews', label: t('locality.tabReviews'), icon: 'star', content: reviewsBlock },
  ].filter(Boolean);

  return (
    <div ref={rootRef} className="loc-page">
      <div className="pt-8 lg:pt-10 pb-20 min-h-[100dvh]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5 mb-7 reveal">
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-400 text-sm font-medium mb-4"><Icon name="bar-chart-3" className="w-4 h-4" /> {t('locality.eyebrow')}</div>
              <h1 className="text-3xl sm:text-4xl font-bold text-white"><Trans i18nKey="locality.title" components={{ 1: <span className="gradient-text" /> }} /></h1>
              <p className="text-gray-400 text-sm mt-2"><Trans i18nKey="locality.intro" values={{ name: current }} components={{ 1: <span className="text-teal-400 font-semibold" /> }} /></p>
              {bestFor.length ? (
                <div className="flex flex-wrap gap-2 mt-3">
                  {bestFor.map(([labelKey, ic]) => (
                    <span key={labelKey} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-300"><Icon name={ic} className="w-3.5 h-3.5" /> {t(labelKey)}</span>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex flex-row items-center gap-2 sm:gap-3 w-full lg:w-auto">
              <div className="flex-1 min-w-0 sm:flex-none sm:w-60">
                <Select
                  value={current}
                  onChange={load}
                  options={NAMES}
                  searchable
                  placeholder={t('locality.searchPlaceholder')}
                  ariaLabel={t('locality.searchAria')}
                  className="w-full"
                />
              </div>
              <div className="seg flex rounded-xl p-1 bg-white/5 border border-white/10 shrink-0">
                {[1, 2, 3].map((b) => <button key={b} onClick={() => setBhk(b)} className={'px-2.5 sm:px-3 py-2 rounded-lg text-xs font-semibold ' + (bhk === b ? 'active' : 'text-gray-400')}>{t('locality.bhk', { count: b })}</button>)}
              </div>
            </div>
          </div>

          {/* Popular chips — redundant with the search dropdown on mobile, so shown only ≥sm */}
          <div className="hidden sm:flex flex-wrap gap-2 mb-5 reveal">
            {NAMES.map((n) => <button key={n} onClick={() => load(n)} className={'chip text-xs font-medium px-3.5 py-1.5 rounded-full text-gray-300 ' + (n === current ? 'on' : '')}>{n}</button>)}
          </div>

          {/* Live inventory bridge into the search funnel */}
          <div className="mb-5 reveal">{invBar}</div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
            <div className="kpi glass-card rounded-2xl p-4 sm:p-5 reveal">
              <div className="flex items-center justify-between mb-3"><div className="w-10 h-10 rounded-xl bg-teal-400/15 flex items-center justify-center"><Icon name="ruler" className="w-5 h-5 text-teal-400" /></div><span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">▲ {L.yoy.toFixed(1)}%</span></div>
              <p className="text-2xl font-bold text-white">{fmtRs(L.price)}</p><p className="text-gray-500 text-xs mt-0.5">{t('locality.kpiAvgPrice')}</p>
            </div>
            <div className="kpi glass-card rounded-2xl p-4 sm:p-5 reveal">
              <div className="w-10 h-10 rounded-xl bg-emerald-400/15 flex items-center justify-center mb-3"><Icon name="trending-up" className="w-5 h-5 text-emerald-400" /></div>
              <p className="text-2xl font-bold text-emerald-400">+{L.yoy.toFixed(1)}%</p><p className="text-gray-500 text-xs mt-0.5">{t('locality.kpiYoy')}</p>
            </div>
            <div className="kpi glass-card rounded-2xl p-4 sm:p-5 reveal">
              <div className="w-10 h-10 rounded-xl bg-teal-400/15 flex items-center justify-center mb-3"><Icon name="key-round" className="w-5 h-5 text-teal-400" /></div>
              <p className="text-2xl font-bold text-white">{fmtRs(rentOf(current, bhk))}</p><p className="text-gray-500 text-xs mt-0.5">{t('locality.kpiRent', { count: bhk })}</p>
            </div>
            <div className="kpi glass-card rounded-2xl p-4 sm:p-5 reveal">
              <div className="w-10 h-10 rounded-xl bg-amber-400/15 flex items-center justify-center mb-3"><Icon name="percent" className="w-5 h-5 text-amber-400" /></div>
              <p className="text-2xl font-bold text-white">{yieldOf(current, bhk).toFixed(1)}%</p><p className="text-gray-500 text-xs mt-0.5">{t('locality.kpiYield')}</p>
            </div>
          </div>

          {/* Tabbed insight detail — keeps the page compact on mobile & web */}
          <Tabs items={tabs} initial="overview" variant="underline" />

          {/* CTA */}
          <div className="mt-6 glass-card rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4 reveal">
            <div><p className="text-white font-semibold"><Trans i18nKey="locality.ctaLike" values={{ name: current }} components={{ 1: <span className="text-teal-400" /> }} /></p><p className="text-gray-400 text-sm">{t('locality.ctaSub')}</p></div>
            <div className="flex flex-wrap items-center gap-3">
              {alertBtn}
              <Link to={`/listings?q=${encodeURIComponent(current)}`} className="btn-teal px-5 py-3 rounded-xl text-white text-sm font-semibold flex items-center gap-2"><Icon name="search" className="w-4 h-4" /> {t('locality.ctaView')}</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
