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

export default function AdminAnalytics() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const [days, setDays] = useState(90);

  // A failure here empties this tab, not the page, and says so.
  const [supplyGap, setSupplyGap] = useState(null);
  const [supplyGapFailed, setSupplyGapFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchSupplyGap({ days })
      .then((rows) => { if (alive) { setSupplyGap(rows); setSupplyGapFailed(false); } })
      .catch(() => { if (alive) { setSupplyGap(null); setSupplyGapFailed(true); } });
    return () => { alive = false; };
  }, [days]);

  /* Separate request: different tables, and one failing report should empty one panel. `[]` in the catch
     would claim nobody asked. */
  const [cityWaitlist, setCityWaitlist] = useState(null);
  const [cityWaitlistFailed, setCityWaitlistFailed] = useState(false);
  /* Nothing re-runs the read, so without a retry the failed state needs a full page reload. */
  const [cityWaitlistAttempt, setCityWaitlistAttempt] = useState(0);
  const retryCityWaitlist = () => setCityWaitlistAttempt((n) => n + 1);
  useEffect(() => {
    let alive = true;
    listCityWaitlist()
      .then((rows) => { if (alive) { setCityWaitlist(rows); setCityWaitlistFailed(false); } })
      .catch(() => { if (alive) { setCityWaitlist(null); setCityWaitlistFailed(true); } });
    return () => { alive = false; };
  }, [cityWaitlistAttempt]);

  /* Three-state (`null`, value, `failed`): `[]` in the catch would render an all-clear out of a 500. */
  const [pricingRows, setPricingRows] = useState(null);
  const [pricingFailed, setPricingFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    localityPricing()
      .then((rows) => { if (alive) { setPricingRows(rows); setPricingFailed(false); } })
      .catch(() => { if (alive) { setPricingRows(null); setPricingFailed(true); } });
    return () => { alive = false; };
  }, []);

  const [slaSummary, setSlaSummary] = useState(null);
  const [slaFailed, setSlaFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    reviewSla({ days })
      .then((summary) => { if (alive) { setSlaSummary(summary); setSlaFailed(false); } })
      .catch(() => { if (alive) { setSlaSummary(null); setSlaFailed(true); } });
    return () => { alive = false; };
  }, [days]);

  const [trafficReport, setTrafficReport] = useState(null);
  const [trafficFailed, setTrafficFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchTraffic({ days })
      .then((r) => { if (alive) { setTrafficReport(r); setTrafficFailed(false); } })
      .catch(() => { if (alive) { setTrafficReport(null); setTrafficFailed(true); } });
    return () => { alive = false; };
  }, [days]);

  const [engagementReport, setEngagementReport] = useState(null);
  const [engagementFailed, setEngagementFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchEngagement({ days })
      .then((r) => { if (alive) { setEngagementReport(r); setEngagementFailed(false); } })
      .catch(() => { if (alive) { setEngagementReport(null); setEngagementFailed(true); } });
    return () => { alive = false; };
  }, [days]);

  const [audienceReport, setAudienceReport] = useState(null);
  const [audienceFailed, setAudienceFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchAudience({ days })
      .then((r) => { if (alive) { setAudienceReport(r); setAudienceFailed(false); } })
      .catch(() => { if (alive) { setAudienceReport(null); setAudienceFailed(true); } });
    return () => { alive = false; };
  }, [days]);

  const [funnelReport, setFunnelReport] = useState(null);
  const [funnelFailed, setFunnelFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchFunnel({ days })
      .then((r) => { if (alive) { setFunnelReport(r); setFunnelFailed(false); } })
      .catch(() => { if (alive) { setFunnelReport(null); setFunnelFailed(true); } });
    return () => { alive = false; };
  }, [days]);

  const tabs = [
    { key: 'traffic', label: 'Traffic', content: <TrafficTab report={trafficReport} failed={trafficFailed} audience={audienceReport} audienceFailed={audienceFailed} days={days} /> },
    { key: 'engagement', label: 'Engagement', content: <EngagementTab report={engagementReport} failed={engagementFailed} days={days} /> },
    { key: 'funnel', label: 'Funnel', content: <FunnelTab report={funnelReport} failed={funnelFailed} days={days} /> },
    { key: 'supply-gap', label: 'Supply Gap', content: <SupplyGapTab supplyGap={supplyGap} failed={supplyGapFailed} days={days} cityWaitlist={cityWaitlist} cityWaitlistFailed={cityWaitlistFailed} onRetryCityWaitlist={retryCityWaitlist} /> },
    { key: 'pricing', label: 'Pricing', content: <PricingTab rows={pricingRows} failed={pricingFailed} /> },
    { key: 'sla', label: 'SLA', content: <SlaTab sla={slaSummary} failed={slaFailed} days={days} /> },
  ];

  /* Resolve against existing tabs, not the raw URL: an unknown or switched-off tab would render an empty page. */
  const activeTab = tabs.some((t) => t.key === requestedTab) ? requestedTab : tabs[0]?.key;

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
