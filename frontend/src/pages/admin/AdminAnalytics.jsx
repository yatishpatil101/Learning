import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAdminFlags } from '../../context/AdminFlagsContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import {
  trafficSeries,
  localities as getLocalities,
  anonymousSurfers,
  pricingInsight,
  slaMetrics,
  seasonalAnalytics,
} from '../../lib/data/analytics-extra.js';
import { supplyGap as fetchSupplyGap } from '../../services/demandService.js';
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
  useEffect(() => {
    if (!showSupplyGap) { setSupplyGap([]); return undefined; }
    let alive = true;
    fetchSupplyGap()
      .then((rows) => { if (alive) setSupplyGap(rows); })
      .catch(() => { if (alive) setSupplyGap([]); });
    return () => { alive = false; };
  }, [showSupplyGap]);

  const traffic = useMemo(() => trafficSeries(days), [days]);
  const locs = useMemo(() => (optionEnabled('analytics.geography') ? getLocalities() : []), [optionEnabled]);
  const surfers = useMemo(() => (optionEnabled('analytics.anonymous') ? anonymousSurfers(days, traffic) : null), [days, traffic, optionEnabled]);
  const pricing = useMemo(() => (optionEnabled('analytics.pricing') ? pricingInsight() : null), [optionEnabled]);
  const sla = useMemo(() => (optionEnabled('analytics.sla') ? slaMetrics() : null), [optionEnabled]);
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
            optionEnabled('analytics.pricing') && { key: 'pricing', label: 'Pricing', content: <PricingTab pricing={pricing} /> },
            optionEnabled('analytics.sla') && { key: 'sla', label: 'SLA', content: <SlaTab sla={sla} /> },
            optionEnabled('analytics.seasonal') && { key: 'seasonal', label: 'Seasonal', content: <SeasonalTab seasonal={seasonal} /> },
          ].filter(Boolean)}
        />
      </div>
    </div>
  );
}
