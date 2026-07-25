import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { getAnalytics } from '../../lib/mockApi.js';
import { useAdminFlags } from '../../context/AdminFlagsContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import Loading from '../../components/ui/Loading.jsx';
import {
  trafficSeries,
  localities as getLocalities,
  anonymousSurfers,
  supplyDemandGap,
  pricingInsight,
  slaMetrics,
  seasonalAnalytics,
} from '../../lib/data/analytics-extra.js';
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
  const [analytics, setAnalytics] = useState(null);
  const [days, setDays] = useState(90);
  const { optionEnabled } = useAdminFlags();

  useEffect(() => {
    let alive = true;
    getAnalytics().then((an) => { if (alive) setAnalytics({ sources: an?.sources ?? [] }); });
    return () => { alive = false; };
  }, []);

  const traffic = useMemo(() => trafficSeries(days), [days]);
  const locs = useMemo(() => (optionEnabled('analytics.geography') ? getLocalities() : []), [optionEnabled]);
  const surfers = useMemo(() => (optionEnabled('analytics.anonymous') ? anonymousSurfers(days, traffic) : null), [days, traffic, optionEnabled]);
  const supplyGap = useMemo(() => (optionEnabled('analytics.supplyGap') ? supplyDemandGap() : []), [optionEnabled]);
  const pricing = useMemo(() => (optionEnabled('analytics.pricing') ? pricingInsight() : null), [optionEnabled]);
  const sla = useMemo(() => (optionEnabled('analytics.sla') ? slaMetrics() : null), [optionEnabled]);
  const seasonal = useMemo(() => (optionEnabled('analytics.seasonal') ? seasonalAnalytics() : null), [optionEnabled]);

  if (!analytics) return <Loading />;

  return (
    <div>
      <PageHeader title="Analytics" subtitle="Traffic, engagement & geographic insights" />
      <div className="mt-6">
        <Tabs
          active={initialTab}
          onChange={(key) => setSearchParams({ tab: key }, { replace: true })}
          items={[
            optionEnabled('analytics.traffic') && { key: 'traffic', label: 'Traffic', content: <TrafficTab traffic={traffic} days={days} setDays={setDays} sources={analytics.sources} /> },
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
