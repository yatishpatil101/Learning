import { useMemo, useState, useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import Icon from '../../components/Icon.jsx';
import { useScrollReveal } from '../../lib/useScrollReveal.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { getEntityReviews, addEntityReview, addSavedSearch } from '../../lib/store.js';
import { localityBySlug, localityByName } from '../../data/localities.js';
import { allSocieties } from '../../data/societies.js';
import { LOC } from '../../data/localityIntel.js';
import { listProperties } from '../../lib/mockApi.js';
import { buildAlertRecord } from './listings/alertCriteria.js';
import Tabs from '../../components/ui/Tabs.jsx';
import Select from '../../components/ui/Select.jsx';
import {
  NAMES, DEMAND_W, fmtRs, scoreOf, rentOf, yieldOf, puneAvgPrice, puneAvgYoy,
  buildTrend, metricVal, metricFmt, trendGradient, slugifyLoc, haversineKm,
  INTEL_GEO, bestForTags,
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

export default function Locality() {
  const rootRef = useScrollReveal();
  const { isIn } = useAuth();
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

  // Live inventory for the funnel bridge: load the public catalogue once and index
  // it by locality slug (count + cheapest price + buy/rent split).
  useEffect(() => {
    let alive = true;
    listProperties({ includeAllStatuses: false }, 'newest').then((ps) => {
      if (alive) setProps(ps.filter((p) => p.status === 'approved'));
    });
    return () => { alive = false; };
  }, []);
  const invMap = useMemo(() => {
    const m = {};
    props.forEach((p) => {
      const s = p.localitySlug;
      if (!s) return;
      const e = m[s] || (m[s] = { count: 0, from: Infinity, buy: 0, rent: 0 });
      e.count++;
      if (p.deal === 'rent') e.rent++; else e.buy++;
      if (p.price && p.price < e.from) e.from = p.price;
    });
    return m;
  }, [props]);
  const inv = invMap[activeSlug] || null;
  const locProps = useMemo(() => props.filter((p) => p.localitySlug === activeSlug), [props, activeSlug]);

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
    const t = buildTrend(L.price, L.yoy, range), p = buildTrend(puneAvgPrice, puneAvgYoy, range);
    return {
      labels: t.labels,
      datasets: [
        { label: current, data: t.actual, borderColor: '#14b8a6', backgroundColor: trendGradient, fill: true, tension: 0.4, borderWidth: 3, pointRadius: 0, pointHoverRadius: 5, spanGaps: false },
        { label: 'Forecast', data: t.fc, borderColor: '#f59e0b', borderDash: [6, 5], fill: false, tension: 0.4, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5 },
        { label: 'Pune avg', data: p.actual, borderColor: '#6366f1', fill: false, tension: 0.4, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, borderDash: [2, 3] },
      ],
    };
  }, [current, range, L]);

  const scoreLabel = sc >= 8.5 ? 'Excellent' : sc >= 8 ? 'Very Good' : sc >= 7.5 ? 'Good' : 'Average';

  const cmpNames = [...cmp];
  const cmpFmt = metricFmt(cmpMetric);
  const cmpData = { labels: cmpNames, datasets: [{ data: cmpNames.map((n) => metricVal(n, cmpMetric)), backgroundColor: cmpNames.map((n) => (n === current ? '#14b8a6' : '#0d9488')), borderRadius: 8, maxBarThickness: 46 }] };
  const cmpOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => cmpFmt(c.parsed.y) } } }, scales: { x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 11 } } }, y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b', font: { size: 10 }, callback: cmpFmt } } } };

  const lbRows = useMemo(() => {
    const rows = NAMES.map((n) => ({ name: n, price: LOC[n].price, yoy: LOC[n].yoy, yield: yieldOf(n, 2), liv: scoreOf(n), demand: DEMAND_W[LOC[n].demand], demandTxt: LOC[n].demand }));
    rows.sort((a, b) => (sort.key === 'name' ? sort.dir * a.name.localeCompare(b.name) : sort.dir * (a[sort.key] - b[sort.key])));
    return rows;
  }, [sort]);

  const pulse = [['Demand', L.demand, 'flame', L.demand === 'Very High' ? 'text-rose-400' : L.demand === 'High' ? 'text-amber-400' : 'text-teal-400'], ['New launches (1 yr)', L.launches + ' projects', 'building-2', 'text-teal-400'], ['Avg. property age', '~' + L.age + ' yrs', 'calendar-clock', 'text-teal-300'], ['Buyer interest', L.buyer + '/100', 'users', 'text-emerald-400']];

  const locId = activeName.toLowerCase();
  useEffect(() => {
    setReviews((r) => (r[locId] ? r : { ...r, [locId]: getEntityReviews('locality', locId) }));
  }, [locId]);
  const locReviews = reviews[locId] || [];
  const postReview = (e) => {
    e.preventDefault();
    if (!isIn) { toast('Please sign in to post a review.', 'error'); return; }
    if (addEntityReview('locality', locId, { rating: pick, text: revText.trim() }) === 'login') { toast('Please sign in to post a review.', 'error'); return; }
    setReviews((r) => ({ ...r, [locId]: getEntityReviews('locality', locId) }));
    setRevText(''); setPick(5); toast('Thanks for your review!');
  };

  // Locality alert — reuses the same saved-search/alert layer as the listings
  // "Create a property alert" flow, so it lands in the dashboard Alerts panel and
  // fires on new matches. Sign-in gated, mirroring the review gate above.
  const setLocalityAlert = () => {
    if (!isIn) { toast('Please sign in to set up an alert.', 'error'); return; }
    const rec = buildAlertRecord({ deal: 'rent', localities: [activeSlug] }, { [activeSlug]: activeName });
    addSavedSearch(rec);
    toast(`Alert on — we'll ping you about new homes in ${activeName}.`);
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
    { key: 'overview', label: 'Overview', icon: 'bar-chart-3', content: (
      <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-5 sm:gap-6">{trendBlock}{livabilityBlock}</div>
    ) },
    { key: 'compare', label: 'Compare', icon: 'scale', content: (
      <div className="space-y-5 sm:space-y-6">{compareBlock}{leaderboardBlock}</div>
    ) },
    { key: 'area', label: 'Area', icon: 'map-pin', content: (
      <div className="space-y-5 sm:space-y-6">{mapCard}<div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6">{pulseBlock}{connBlock}</div></div>
    ) },
    societiesBlock ? { key: 'societies', label: 'Societies', icon: 'building-2', content: societiesBlock } : null,
    { key: 'reviews', label: 'Reviews', icon: 'star', content: reviewsBlock },
  ].filter(Boolean);

  return (
    <div ref={rootRef} className="loc-page">
      <main className="pt-8 lg:pt-10 pb-20 min-h-[100dvh]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5 mb-7 reveal">
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-400 text-sm font-medium mb-4"><Icon name="bar-chart-3" className="w-4 h-4" /> Live Market Insights · Pune</div>
              <h1 className="text-3xl sm:text-4xl font-bold text-white">Locality insights &amp; <span className="gradient-text">price trends</span></h1>
              <p className="text-gray-400 text-sm mt-2">Explore prices, appreciation, livability and forecasts for <span className="text-teal-400 font-semibold">{current}</span>.</p>
              {bestFor.length ? (
                <div className="flex flex-wrap gap-2 mt-3">
                  {bestFor.map(([label, ic]) => (
                    <span key={label} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-300"><Icon name={ic} className="w-3.5 h-3.5" /> {label}</span>
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
                  placeholder="Search a locality…"
                  ariaLabel="Search a locality"
                  className="w-full"
                />
              </div>
              <div className="seg flex rounded-xl p-1 bg-white/5 border border-white/10 shrink-0">
                {[1, 2, 3].map((b) => <button key={b} onClick={() => setBhk(b)} className={'px-2.5 sm:px-3 py-2 rounded-lg text-xs font-semibold ' + (bhk === b ? 'active' : 'text-gray-400')}>{b} BHK</button>)}
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
              <p className="text-2xl font-bold text-white">{fmtRs(L.price)}</p><p className="text-gray-500 text-xs mt-0.5">Avg. price / sq.ft.</p>
            </div>
            <div className="kpi glass-card rounded-2xl p-4 sm:p-5 reveal">
              <div className="w-10 h-10 rounded-xl bg-emerald-400/15 flex items-center justify-center mb-3"><Icon name="trending-up" className="w-5 h-5 text-emerald-400" /></div>
              <p className="text-2xl font-bold text-emerald-400">+{L.yoy.toFixed(1)}%</p><p className="text-gray-500 text-xs mt-0.5">YoY appreciation</p>
            </div>
            <div className="kpi glass-card rounded-2xl p-4 sm:p-5 reveal">
              <div className="w-10 h-10 rounded-xl bg-teal-400/15 flex items-center justify-center mb-3"><Icon name="key-round" className="w-5 h-5 text-teal-400" /></div>
              <p className="text-2xl font-bold text-white">{fmtRs(rentOf(current, bhk))}</p><p className="text-gray-500 text-xs mt-0.5">Avg. {bhk} BHK rent / mo</p>
            </div>
            <div className="kpi glass-card rounded-2xl p-4 sm:p-5 reveal">
              <div className="w-10 h-10 rounded-xl bg-amber-400/15 flex items-center justify-center mb-3"><Icon name="percent" className="w-5 h-5 text-amber-400" /></div>
              <p className="text-2xl font-bold text-white">{yieldOf(current, bhk).toFixed(1)}%</p><p className="text-gray-500 text-xs mt-0.5">Rental yield</p>
            </div>
          </div>

          {/* Tabbed insight detail — keeps the page compact on mobile & web */}
          <Tabs items={tabs} initial="overview" variant="underline" />

          {/* CTA */}
          <div className="mt-6 glass-card rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4 reveal">
            <div><p className="text-white font-semibold">Like <span className="text-teal-400">{current}</span>?</p><p className="text-gray-400 text-sm">Browse verified, broker-free properties in this locality.</p></div>
            <div className="flex flex-wrap items-center gap-3">
              {alertBtn}
              <Link to={`/listings?q=${encodeURIComponent(current)}`} className="btn-teal px-5 py-3 rounded-xl text-white text-sm font-semibold flex items-center gap-2"><Icon name="search" className="w-4 h-4" /> View Properties</Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
