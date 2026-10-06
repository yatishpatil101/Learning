import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ExternalLink } from 'lucide-react';
import { listCityWaitlist } from '../../services/cityService.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Select from '../../components/ui/Select.jsx';
import { QueueTabs } from '../../components/admin/WorkQueue.jsx';
import { supplyGap as fetchSupplyGap } from '../../services/demandService.js';
import {
  localityPricing,
  reviewSla,
  traffic as fetchTraffic,
  engagement as fetchEngagement,
  funnel as fetchFunnel,
  surfers as fetchAudience,
} from '../../services/analyticsService.js';
import TrafficTab from './analytics/TrafficTab.jsx';
import EngagementTab from './analytics/EngagementTab.jsx';
import SupplyGapTab from './analytics/SupplyGapTab.jsx';
import PricingTab from './analytics/PricingTab.jsx';
import SlaTab from './analytics/SlaTab.jsx';
import FunnelTab from './analytics/FunnelTab.jsx';
import { RANGE_OPTIONS } from './analytics/constants.jsx';

const POSTHOG_APP_URL = import.meta.env.VITE_POSTHOG_APP_URL || '';

// Pricing is a snapshot of the live catalogue, so it has no window to pick.
const WINDOWED_TABS = new Set(['funnel', 'traffic', 'engagement', 'supply-gap', 'sla']);
const TAB_KEYS = ['traffic', 'engagement', 'funnel', 'supply-gap', 'pricing', 'sla'];

/* Reads one report when its tab is first shown and again when `key` changes; three-state because a `[]` default would render an all-clear from a 500. */
function useTabReport(load, shown, key) {
  const [state, setState] = useState({ data: null, failed: false, key: undefined });
  const current = state.key === key;
  useEffect(() => {
    if (!shown || current) return undefined;
    let alive = true;
    load()
      .then((data) => { if (alive) setState({ data, failed: false, key }); })
      .catch(() => { if (alive) setState({ data: null, failed: true, key }); });
    return () => { alive = false; };
    // `key` stands for everything `load` closes over; `load` itself is a fresh closure every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, current, key]);
  return state;
}

export default function AdminAnalytics() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const [days, setDays] = useState(90);

  // An unknown `?tab=` falls back to the first tab, never to an empty page.
  const activeTab = TAB_KEYS.includes(requestedTab) ? requestedTab : TAB_KEYS[0];
  const on = (key) => activeTab === key;

  const supplyGap = useTabReport(() => fetchSupplyGap({ days }), on('supply-gap'), days);
  /* Which cities people want Draazy in: a separate read because a different table answers it, so one failing report empties one panel. */
  const [cityWaitlistAttempt, setCityWaitlistAttempt] = useState(0);
  const retryCityWaitlist = () => setCityWaitlistAttempt((n) => n + 1);
  const cityWaitlist = useTabReport(listCityWaitlist, on('supply-gap'), cityWaitlistAttempt);
  const pricing = useTabReport(localityPricing, on('pricing'), 0);
  const sla = useTabReport(() => reviewSla({ days }), on('sla'), days);
  const traffic = useTabReport(() => fetchTraffic({ days }), on('traffic'), days);
  const audience = useTabReport(() => fetchAudience({ days }), on('traffic'), days);
  const engagement = useTabReport(() => fetchEngagement({ days }), on('engagement'), days);
  const funnel = useTabReport(() => fetchFunnel({ days }), on('funnel'), days);

  const tabs = [
    { key: 'traffic', label: 'Traffic', content: <TrafficTab report={traffic.data} failed={traffic.failed} audience={audience.data} audienceFailed={audience.failed} days={days} /> },
    { key: 'engagement', label: 'Engagement', content: <EngagementTab report={engagement.data} failed={engagement.failed} days={days} /> },
    { key: 'funnel', label: 'Funnel', content: <FunnelTab report={funnel.data} failed={funnel.failed} days={days} /> },
    { key: 'supply-gap', label: 'Supply Gap', content: <SupplyGapTab supplyGap={supplyGap.data} failed={supplyGap.failed} days={days} cityWaitlist={cityWaitlist.data} cityWaitlistFailed={cityWaitlist.failed} onRetryCityWaitlist={retryCityWaitlist} /> },
    { key: 'pricing', label: 'Pricing', content: <PricingTab rows={pricing.data} failed={pricing.failed} /> },
    { key: 'sla', label: 'SLA', content: <SlaTab sla={sla.data} failed={sla.failed} days={days} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle="Traffic, funnel, demand, pricing & SLA"
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {WINDOWED_TABS.has(activeTab) ? (
              <div style={{ width: 170 }}>
                <Select value={String(days)} onChange={(v) => setDays(Number(v))} options={RANGE_OPTIONS} ariaLabel="Report window" />
              </div>
            ) : null}
            {POSTHOG_APP_URL ? (
              <a
                href={POSTHOG_APP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-sm font-semibold text-gray-300 hover:bg-white/5 hover:text-white transition"
              >
                Product analytics <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : null}
          </div>
        )}
      />
      <QueueTabs
        tabs={tabs.map(({ key, label }) => ({ key, label, count: null }))}
        active={activeTab}
        onChange={(key) => setSearchParams({ tab: key }, { replace: true })}
        label="Analytics reports"
        idPrefix="analytics"
      />
      <div id="analytics-panel" role="tabpanel" aria-labelledby={`analytics-tab-${activeTab}`}>
        {tabs.find((t) => t.key === activeTab)?.content}
      </div>
    </div>
  );
}
