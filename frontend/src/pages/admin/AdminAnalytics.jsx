import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { listLocalities } from '../../services/localityService.js';
import { listCityWaitlist } from '../../services/cityService.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { QueueTabs } from '../../components/admin/WorkQueue.jsx';
import { supplyGap as fetchSupplyGap } from '../../services/demandService.js';
import {
  localityPricing,
  reviewSla,
  traffic as fetchTraffic,
  engagement as fetchEngagement,
  surfers as fetchAudience,
} from '../../services/analyticsService.js';
import TrafficTab from './analytics/TrafficTab.jsx';
import EngagementTab from './analytics/EngagementTab.jsx';
import GeographyTab from './analytics/GeographyTab.jsx';
import SupplyGapTab from './analytics/SupplyGapTab.jsx';
import PricingTab from './analytics/PricingTab.jsx';
import SlaTab from './analytics/SlaTab.jsx';

export default function AdminAnalytics() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const [days, setDays] = useState(90);

  /* No Seasonal tab: month-over-month demand needs years of history that do not exist yet. */

  // Server aggregate: a failure empties this tab, not the page.
  const [supplyGap, setSupplyGap] = useState([]);
  const [locs, setLocs] = useState([]);
  useEffect(() => {
    let alive = true;
    fetchSupplyGap()
      .then((rows) => { if (alive) setSupplyGap(rows); })
      .catch(() => { if (alive) setSupplyGap([]); });
    return () => { alive = false; };
  }, []);

  /*
   * The other half of the Supply Gap tab: which cities people want Draazy to launch in.
   *
   * A second request rather than a field on the supply-gap report, because they are answers to two
   * different questions against two unrelated tables — localities inside a city we serve, and cities
   * we do not. Fetched separately for the same reason Supply Gap is fetched apart from the rest of
   * the page: one report failing should empty one panel.
   *
   * Three states, like Pricing and SLA below and unlike `supplyGap` above, and the difference is
   * deliberate. `[]` in the catch renders "No city requests yet" — a claim that nobody has asked,
   * assembled out of a failed read. This panel exists because it spent its whole life making
   * exactly that claim wrongly; shipping it back with a catch that can re-make it would be a poor
   * joke.
   */
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

  useEffect(() => {
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
  }, []);

  /*
   * Pricing and SLA are measured, so they are fetched rather than generated.
   *
   * Each gets its own effect and its own catch, like Supply Gap above and for the same reason: a
   * failure should empty one tab, not the page. `null` is the pre-arrival state and the tabs render
   * nothing for it — distinct from a loaded report that happens to be empty, which they do render.
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
    reviewSla()
      .then((summary) => { if (alive) { setSlaSummary(summary); setSlaFailed(false); } })
      .catch(() => { if (alive) { setSlaSummary(null); setSlaFailed(true); } });
    return () => { alive = false; };
  }, []);

  /* `days` is set on the Traffic tab and shared with Engagement; `[]` in the catch would show zero traffic. */
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

  const tabs = [
    { key: 'traffic', label: 'Traffic', content: <TrafficTab report={trafficReport} failed={trafficFailed} audience={audienceReport} audienceFailed={audienceFailed} days={days} setDays={setDays} /> },
    { key: 'engagement', label: 'Engagement', content: <EngagementTab report={engagementReport} failed={engagementFailed} days={days} /> },
    { key: 'geography', label: 'Geography', content: <GeographyTab locs={locs} /> },
    { key: 'supply-gap', label: 'Supply Gap', content: <SupplyGapTab supplyGap={supplyGap} cityWaitlist={cityWaitlist} cityWaitlistFailed={cityWaitlistFailed} onRetryCityWaitlist={retryCityWaitlist} /> },
    { key: 'pricing', label: 'Pricing', content: <PricingTab rows={pricingRows} failed={pricingFailed} /> },
    { key: 'sla', label: 'SLA', content: <SlaTab sla={slaSummary} failed={slaFailed} /> },
  ];

  /* Resolve against existing tabs, not the raw URL: an unknown or switched-off tab would render an empty page. */
  const activeTab = tabs.some((t) => t.key === requestedTab) ? requestedTab : tabs[0]?.key;

  return (
    <div>
      <PageHeader title="Analytics" subtitle="Traffic, engagement & geographic insights" />
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
