import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAdminFlags } from '../../context/AdminFlagsContext.jsx';
import { listLocalities } from '../../services/localityService.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import {
  pricingInsight,
  slaMetrics,
  seasonalAnalytics,
} from '../../lib/data/analytics-extra.js';
import { supplyGap as fetchSupplyGap } from '../../services/demandService.js';
import {
  localityPricing,
  reviewSla,
  traffic as fetchTraffic,
  engagement as fetchEngagement,
  surfers as fetchSurfers,
} from '../../services/analyticsService.js';
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
   * for a chart whose two neighbours were already hardcoded. That constant is gone: the Traffic
   * tab's source mix is a real referrer rollup now, so the doughnut is measured rather than drawn.
   *
   * Three tabs — Traffic, Engagement and Anonymous surfers — read the page-view aggregates below.
   * Supply Gap is a server aggregate, Pricing and SLA are server reports. What is left on
   * `lib/data/analytics-extra.js` is Seasonal, which stays illustrative and says so on the tab.
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

  /*
   * Traffic, Engagement and Anonymous surfers are measured now.
   *
   * All three read the same `days` window, and the picker that sets it lives on the Traffic tab.
   * That is one window for one page rather than three independent ones, but it does mean a change
   * made on Traffic silently moves the other two — so both of them state the window they drew
   * rather than leaving the reader to remember where the control was.
   *
   * Same three-state shape as Pricing and SLA above, for the same reason. `[]` in the catch would
   * render "0 sessions, 0 anonymous, 0% bounce" — a confident report that nobody visited the site,
   * assembled out of a 500. The one figure a traffic console must never invent is zero traffic.
   */
  const [trafficReport, setTrafficReport] = useState(null);
  const [trafficFailed, setTrafficFailed] = useState(false);
  const showTraffic = optionEnabled('analytics.traffic');
  useEffect(() => {
    if (!showTraffic) { setTrafficReport(null); setTrafficFailed(false); return undefined; }
    let alive = true;
    fetchTraffic({ days })
      .then((r) => { if (alive) { setTrafficReport(r); setTrafficFailed(false); } })
      .catch(() => { if (alive) { setTrafficReport(null); setTrafficFailed(true); } });
    return () => { alive = false; };
  }, [showTraffic, days]);

  const [engagementReport, setEngagementReport] = useState(null);
  const [engagementFailed, setEngagementFailed] = useState(false);
  const showEngagement = optionEnabled('analytics.engagement');
  useEffect(() => {
    if (!showEngagement) { setEngagementReport(null); setEngagementFailed(false); return undefined; }
    let alive = true;
    fetchEngagement({ days })
      .then((r) => { if (alive) { setEngagementReport(r); setEngagementFailed(false); } })
      .catch(() => { if (alive) { setEngagementReport(null); setEngagementFailed(true); } });
    return () => { alive = false; };
  }, [showEngagement, days]);

  const [surfersReport, setSurfersReport] = useState(null);
  const [surfersFailed, setSurfersFailed] = useState(false);
  const showSurfers = optionEnabled('analytics.anonymous');
  useEffect(() => {
    if (!showSurfers) { setSurfersReport(null); setSurfersFailed(false); return undefined; }
    let alive = true;
    fetchSurfers({ days })
      .then((r) => { if (alive) { setSurfersReport(r); setSurfersFailed(false); } })
      .catch(() => { if (alive) { setSurfersReport(null); setSurfersFailed(true); } });
    return () => { alive = false; };
  }, [showSurfers, days]);

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
            optionEnabled('analytics.traffic') && { key: 'traffic', label: 'Traffic', content: <TrafficTab report={trafficReport} failed={trafficFailed} days={days} setDays={setDays} /> },
            optionEnabled('analytics.engagement') && { key: 'engagement', label: 'Engagement', content: <EngagementTab report={engagementReport} failed={engagementFailed} days={days} /> },
            optionEnabled('analytics.anonymous') && { key: 'surfers', label: 'Anonymous surfers', content: <SurfersTab report={surfersReport} failed={surfersFailed} days={days} /> },
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
