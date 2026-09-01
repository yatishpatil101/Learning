import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAdminFlags } from '../../context/AdminFlagsContext.jsx';
import { listLocalities } from '../../services/localityService.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import {
  trafficSeries,
  anonymousSurfers,
  pricingInsight,
  slaMetrics,
  seasonalAnalytics,
} from '../../lib/data/analytics-extra.js';
import { supplyGap as fetchSupplyGap } from '../../services/demandService.js';
import { localityPricing, reviewSla } from '../../services/analyticsService.js';
import TrafficTab from './analytics/TrafficTab.jsx';
import EngagementTab from './analytics/EngagementTab.jsx';
import GeographyTab from './analytics/GeographyTab.jsx';
import SurfersTab from './analytics/SurfersTab.jsx';
import SupplyGapTab from './analytics/SupplyGapTab.jsx';
import PricingTab from './analytics/PricingTab.jsx';
import SlaTab from './analytics/SlaTab.jsx';
import SeasonalTab from './analytics/SeasonalTab.jsx';

export default function AdminAnalytics() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'traffic';
  const [days, setDays] = useState(90);
  const { optionEnabled } = useAdminFlags();

  /*
   * A `getAnalytics()` call from `mockApi` stood here, and a `if (!analytics) return <Loading />;`
   * gate stood below. Everything it fetched was one five-row constant feeding one doughnut on the
   * Traffic tab, so the page held all eight tabs behind a spinner waiting on a localStorage read
   * for a chart whose two neighbours were already hardcoded. The constant now lives in
   * `analytics/constants.jsx` as TRAFFIC_SOURCES and the card carries a `Sample` chip like theirs.
   *
   * Nothing else on this page went through the mock: seven of the eight tabs derive from
   * `lib/data/analytics-extra.js` and Supply Gap is a real server aggregate. That made this import
   * the page's last tie to `mockApi.js`, which is the reason it is gone.
   */

  // The supply gap is a server aggregate now, so it is fetched rather than derived. Kept out of the
  // `analytics` gate above because it is one tab: an outage in the demand report should leave the
  // other seven tabs rendering, so a failure here empties this tab rather than the page.
  const [supplyGap, setSupplyGap] = useState([]);
  const showSupplyGap = optionEnabled('analytics.supplyGap');
  const [locs, setLocs] = useState([]);
  const showGeography = optionEnabled('analytics.geography');
  useEffect(() => {
    if (!showSupplyGap) { setSupplyGap([]); return undefined; }
    let alive = true;
    fetchSupplyGap()
      .then((rows) => { if (alive) setSupplyGap(rows); })
      .catch(() => { if (alive) setSupplyGap([]); });
    return () => { alive = false; };
  }, [showSupplyGap]);

  useEffect(() => {
    if (!showGeography) { setLocs([]); return undefined; }
    let alive = true;
    listLocalities()
      .then((rows) => {
        if (!alive) return;
        setLocs(rows.map((row) => ({
          name: row.name,
          listings: row.listingCount,
          demand: row.demand ?? 0,
          ratePerSqft: row.ratePerSqft ?? 0,
        })));
      })
      .catch(() => { if (alive) setLocs([]); });
    return () => { alive = false; };
  }, [showGeography]);

  /*
   * Pricing and SLA are measured now, so they are fetched rather than generated.
   *
   * Each gets its own effect and its own catch, like Supply Gap above and for the same reason: a
   * failure should empty one tab, not the page. `null` is the pre-arrival state and the tabs render
   * nothing for it — distinct from a loaded report that happens to be empty, which they do render.
   *
   * Both still take generated figures for the cards the platform stores no data for (six-month
   * price trends; the weekly compliance line; ticket and concierge turnaround). Those carry a
   * `Sample` chip. See `services/analyticsService.js` for why the seam is drawn there.
   */
  /*
   * Three states, not two, and the third is why this is not simply `useState(null)` with a `[]` in
   * the catch. `[]` means "the report loaded and found nothing", which renders a full KPI strip
   * reading 0 overpriced and 0 underpriced areas — a confident all-clear manufactured out of a 500.
   * That is the same class of lie the endpoints were written to retire, one layer up, so a failure
   * has to be able to say so.
   */
  const [pricingRows, setPricingRows] = useState(null);
  const [pricingFailed, setPricingFailed] = useState(false);
  const showPricing = optionEnabled('analytics.pricing');
  useEffect(() => {
    if (!showPricing) { setPricingRows(null); setPricingFailed(false); return undefined; }
    let alive = true;
    localityPricing()
      .then((rows) => { if (alive) { setPricingRows(rows); setPricingFailed(false); } })
      .catch(() => { if (alive) { setPricingRows(null); setPricingFailed(true); } });
    return () => { alive = false; };
  }, [showPricing]);

  const [slaSummary, setSlaSummary] = useState(null);
  const [slaFailed, setSlaFailed] = useState(false);
  const showSla = optionEnabled('analytics.sla');
  useEffect(() => {
    if (!showSla) { setSlaSummary(null); setSlaFailed(false); return undefined; }
    let alive = true;
    reviewSla()
      .then((summary) => { if (alive) { setSlaSummary(summary); setSlaFailed(false); } })
      .catch(() => { if (alive) { setSlaSummary(null); setSlaFailed(true); } });
    return () => { alive = false; };
  }, [showSla]);

  const traffic = useMemo(() => trafficSeries(days), [days]);
  const surfers = useMemo(() => (optionEnabled('analytics.anonymous') ? anonymousSurfers(days, traffic) : null), [days, traffic, optionEnabled]);
  // The illustrative halves only. `pricingInsight().priceTrends` and `slaMetrics().weeklyTrend` have
  // no server source and are labelled as samples where they are rendered.
  const pricingSample = useMemo(() => (showPricing ? pricingInsight() : null), [showPricing]);
  const slaSample = useMemo(() => (showSla ? slaMetrics() : null), [showSla]);
  const seasonal = useMemo(() => (optionEnabled('analytics.seasonal') ? seasonalAnalytics() : null), [optionEnabled]);

  return (
    <div>
      <PageHeader title="Analytics" subtitle="Traffic, engagement & geographic insights" />
      <div className="mt-6">
        <Tabs
          active={initialTab}
          onChange={(key) => setSearchParams({ tab: key }, { replace: true })}
          items={[
            optionEnabled('analytics.traffic') && { key: 'traffic', label: 'Traffic', content: <TrafficTab traffic={traffic} days={days} setDays={setDays} /> },
            optionEnabled('analytics.engagement') && { key: 'engagement', label: 'Engagement', content: <EngagementTab /> },
            optionEnabled('analytics.anonymous') && { key: 'surfers', label: 'Anonymous surfers', content: <SurfersTab surfers={surfers} days={days} /> },
            optionEnabled('analytics.geography') && { key: 'geography', label: 'Geography', content: <GeographyTab locs={locs} /> },
            optionEnabled('analytics.supplyGap') && { key: 'supply-gap', label: 'Supply Gap', content: <SupplyGapTab supplyGap={supplyGap} /> },
            optionEnabled('analytics.pricing') && { key: 'pricing', label: 'Pricing', content: <PricingTab rows={pricingRows} sample={pricingSample} failed={pricingFailed} /> },
            optionEnabled('analytics.sla') && { key: 'sla', label: 'SLA', content: <SlaTab sla={slaSummary} sample={slaSample} failed={slaFailed} /> },
            optionEnabled('analytics.seasonal') && { key: 'seasonal', label: 'Seasonal', content: <SeasonalTab seasonal={seasonal} /> },
          ].filter(Boolean)}
        />
      </div>
    </div>
  );
}
