import { useState } from 'react';
import { AlertTriangle, ToggleRight } from 'lucide-react';
import { classNames } from '../../../lib/format.js';
import Switch from '../../../components/ui/Switch.jsx';

const ADMIN_FLAG_SECTIONS = [
  { section: 'dash', title: 'Dashboard', desc: 'Control which dashboard sections are visible', hasTabFlag: false, critical: true, options: [
    { key: 'smartAlerts', label: 'Smart alerts', desc: 'Auto-generated operational alerts', cost: 'medium' },
    { key: 'sla', label: 'SLA health', desc: 'Service level compliance panel', cost: 'medium' },
    { key: 'scorecard', label: 'Daily scorecard', desc: 'Staff performance snapshot', cost: 'medium' },
    { key: 'glanceRevenue', label: 'Revenue tile', desc: 'Revenue KPI in At a Glance', cost: 'low' },
    { key: 'glanceTraffic', label: 'Traffic tile', desc: 'Visits Today KPI in At a Glance', cost: 'low' },
  ] },
  { section: 'analytics', title: 'Analytics', desc: 'Full analytics dashboard with multiple sub-tabs', hasTabFlag: true, options: [
    { key: 'traffic', label: 'Traffic', desc: 'Website visits & pageviews', cost: 'low' },
    { key: 'engagement', label: 'Engagement', desc: 'Session duration & bounce rate', cost: 'low' },
    { key: 'anonymous', label: 'Anonymous surfers', desc: 'Non-registered visitor tracking', cost: 'low' },
    { key: 'geography', label: 'Geography', desc: 'Listings & demand by locality', cost: 'low' },
    { key: 'supplyGap', label: 'Supply-demand gap', desc: 'Market opportunity analysis', cost: 'high' },
    { key: 'pricing', label: 'Pricing intelligence', desc: 'Market rate comparisons', cost: 'high' },
    { key: 'sla', label: 'SLA compliance', desc: 'Service level tracking charts', cost: 'medium' },
  ] },
  { section: 'finance', title: 'Finance', desc: 'Revenue tracking & financial reporting', hasTabFlag: true, options: [
    { key: 'charts', label: 'Revenue charts', desc: 'Monthly stacked bar & MRR', cost: 'low' },
    { key: 'transactions', label: 'Transactions table', desc: 'Full transaction ledger', cost: 'medium' },
    { key: 'models', label: 'Financial models', desc: 'Subscription & payout calculations', cost: 'low' },
    { key: 'rentPay', label: 'Rent-pay tracking', desc: 'Rent payment fee revenue', cost: 'low' },
  ] },
  { section: 'properties', title: 'Properties', desc: 'Options within the properties management page', hasTabFlag: false, critical: true, options: [
    { key: 'bulkOps', label: 'Bulk operations', desc: 'Multi-select batch actions', cost: 'low' },
    { key: 'csvExport', label: 'CSV export', desc: 'Export property data to CSV', cost: 'low' },
    { key: 'commsLog', label: 'Communication timeline', desc: 'Owner communication history', cost: 'high' },
    { key: 'qualityScore', label: 'Quality score', desc: 'Listing completeness indicators', cost: 'low' },
  ] },
  { section: 'users', title: 'Users', desc: 'Options within user management', hasTabFlag: false, options: [
    { key: 'timeline', label: 'Activity timeline', desc: 'Full user activity history modal', cost: 'high' },
    { key: 'bulkOps', label: 'Bulk operations', desc: 'Multi-select batch actions', cost: 'low' },
    { key: 'csvExport', label: 'CSV export', desc: 'Export user data to CSV', cost: 'low' },
  ] },
  { section: 'services', title: 'Services', desc: 'Service ticket management options', hasTabFlag: true, options: [
    { key: 'priority', label: 'Priority levels', desc: 'High/medium/low ticket priority', cost: 'low' },
    { key: 'teamRouting', label: 'Team routing', desc: 'Route tickets to specific teams', cost: 'low' },
    { key: 'staffAssignment', label: 'Staff assignment', desc: 'Assign tickets to individual staff', cost: 'low' },
  ] },
  { section: 'enquiries', title: 'Enquiries', desc: 'Lead pipeline sub-tabs', hasTabFlag: false, critical: true, options: [
    { key: 'visits', label: 'Visits tab', desc: 'Scheduled site visits tracking', cost: 'low' },
    { key: 'deals', label: 'Deals tab', desc: 'Deal pipeline tracking', cost: 'low' },
    { key: 'funnelTime', label: 'Funnel time analysis', desc: 'Conversion time metrics', cost: 'low' },
  ] },
  { section: 'content', title: 'Content', desc: 'CMS and content management sub-tabs', hasTabFlag: false, options: [
    { key: 'cityDemand', label: 'City demand', desc: 'Multi-city demand overview', cost: 'low' },
    { key: 'banners', label: 'Banners', desc: 'Homepage promotional banners', cost: 'low' },
    { key: 'faqs', label: 'FAQs', desc: 'Frequently asked questions', cost: 'low' },
    { key: 'announcements', label: 'Announcements', desc: 'User-facing announcements', cost: 'low' },
    { key: 'reviews', label: 'Reviews', desc: 'User review moderation', cost: 'low' },
  ] },
  { section: 'staffActivity', title: 'Staff Activity', desc: 'Staff activity page options', hasTabFlag: false, options: [
    { key: 'kpis', label: 'KPI tiles', desc: 'Summary metrics at the top', cost: 'low' },
    { key: 'leaderboard', label: 'Leaderboard', desc: 'Staff ranking by activity', cost: 'low' },
  ] },
  { section: 'reports', title: 'Reports', desc: 'Abuse reports & content moderation', hasTabFlag: true, options: [
    { key: 'properties', label: 'Reported properties', desc: 'Property abuse reports', cost: 'low' },
    { key: 'users', label: 'Reported users', desc: 'User abuse reports', cost: 'low' },
    { key: 'posts', label: 'Reported posts', desc: 'Flatmate room, group and seeker posts', cost: 'low' },
  ] },
  { section: 'flatmates', title: 'Flatmates', desc: 'Flatmate community moderation', hasTabFlag: true, options: [
    { key: 'seekers', label: 'Seekers', desc: 'Flatmate seeker posts', cost: 'low' },
    { key: 'groups', label: 'Groups', desc: 'Flatmate groups', cost: 'low' },
    { key: 'applications', label: 'Applications', desc: 'Group applications to listings', cost: 'low' },
  ] },
  { section: 'support', title: 'Support', desc: 'Standalone support ticket view (overlaps with Services)', hasTabFlag: true, options: [] },
];

const COST_DOT = {
  low: 'bg-emerald-400',
  medium: 'bg-amber-400',
  high: 'bg-rose-400',
};

const COST_LABEL = {
  low: { cls: 'text-emerald-400/80', label: 'Low' },
  medium: { cls: 'text-amber-400/80', label: 'Med' },
  high: { cls: 'text-rose-400/80', label: 'High' },
};

function getSectionEnabled(config, adminFlags) {
  if (config.critical) return true;
  if (config.hasTabFlag) return adminFlags.tab?.[config.section] !== false;
  return adminFlags[config.section]?.enabled !== false;
}

export default function AdminFlagsPanel({ adminFlags, onToggle }) {
  const [selected, setSelected] = useState(ADMIN_FLAG_SECTIONS[0].section);
  const active = ADMIN_FLAG_SECTIONS.find((s) => s.section === selected);
  const activeModuleOn = active ? getSectionEnabled(active, adminFlags) : true;

  return (
    <div className="flex flex-col lg:flex-row rounded-3xl border border-white/[0.08] overflow-hidden lg:h-[calc(100vh-220px)] lg:min-h-[480px] lg:max-h-[720px] shadow-xl shadow-black/20">

      {/* ─── Left Column: Section Navigator ─── */}
      <div className="w-full lg:w-[345px] shrink-0 border-b lg:border-b-0 lg:border-r border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent overflow-y-auto">
        <div className="px-5 py-4">
          <div className="flex items-center gap-2">
            <ToggleRight className="h-4 w-4 text-brand-teal" />
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Module Controls</span>
          </div>
        </div>

        <div className="px-3 pb-3 space-y-1">
          {ADMIN_FLAG_SECTIONS.map((config) => {
            const isActive = config.section === selected;
            const sectionOn = getSectionEnabled(config, adminFlags);
            const enabledCount = config.options.filter((o) => adminFlags[config.section]?.[o.key] !== false).length;

            return (
              <div
                key={config.section}
                className={classNames(
                  'group rounded-2xl transition-all duration-200',
                  isActive
                    ? 'bg-brand-teal/[0.08] ring-1 ring-brand-teal/20'
                    : 'hover:bg-white/[0.03]',
                )}
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  {/* Clickable label area */}
                  <button
                    onClick={() => setSelected(config.section)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className={classNames(
                        'text-[13px] font-semibold truncate transition-colors',
                        isActive ? 'text-white' : 'text-gray-300 group-hover:text-white',
                      )}>
                        {config.title}
                      </span>
                      {config.options.length > 0 && (
                        <span className={classNames(
                          'rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums',
                          enabledCount === config.options.length
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : enabledCount === 0
                              ? 'bg-white/5 text-gray-500'
                              : 'bg-amber-500/10 text-amber-400',
                        )}>
                          {enabledCount}/{config.options.length}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-gray-500 leading-tight line-clamp-1 mt-0.5">{config.desc}</span>
                  </button>

                  {/* On/Off switch for entire module (hidden for critical modules) */}
                  {!config.critical && (
                    <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={sectionOn}
                        onChange={(v) => {
                          if (config.hasTabFlag) {
                            onToggle('tab', config.section, v, config.title);
                          } else {
                            onToggle(config.section, 'enabled', v, config.title);
                          }
                        }}
                        label={`Toggle ${config.title}`}
                      />
                    </div>
                  )}
                  {config.critical && (
                    <span className="rounded-full bg-brand-teal/10 px-2 py-0.5 text-[9px] font-bold text-brand-teal uppercase tracking-wide shrink-0">Core</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Right Column: Options Detail ─── */}
      <div className="flex-1 overflow-y-auto min-w-0 bg-gradient-to-br from-white/[0.01] to-transparent">
        {active && (
          <>
            {/* Header */}
            <div className="sticky top-0 z-10 backdrop-blur-xl bg-ink/80 border-b border-white/[0.06] px-7 py-5">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-bold text-white">{active.title}</h3>
                <span className={classNames(
                  'rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                  activeModuleOn ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/10 text-rose-400',
                )}>
                  {activeModuleOn ? 'Active' : 'Disabled'}
                </span>
              </div>
              <p className="text-sm text-gray-400 mt-1">{active.desc}</p>

              {!activeModuleOn && (
                <div className="mt-3 flex items-center gap-2 rounded-xl bg-amber-500/[0.06] border border-amber-500/15 px-4 py-2.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                  <span className="text-[12px] text-amber-300/90">Module disabled. Enable it from the left panel to activate options below.</span>
                </div>
              )}
            </div>

            {/* Options table */}
            {active.options.length > 0 ? (
              <div className={classNames(!activeModuleOn ? 'opacity-35 pointer-events-none select-none' : '')}>
                {/* Table heading row */}
                <div className="flex items-center gap-4 px-7 py-3 border-b border-white/[0.06] bg-white/[0.015]">
                  <span className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">Feature</span>
                  <span className="w-16 text-center text-[11px] font-semibold uppercase tracking-wider text-gray-500">Cost</span>
                  <span className="w-14 text-center text-[11px] font-semibold uppercase tracking-wider text-gray-500">Status</span>
                </div>

                {/* Option rows */}
                {active.options.map((opt, i) => {
                  const checked = adminFlags[active.section]?.[opt.key] !== false;
                  const costInfo = COST_LABEL[opt.cost];
                  return (
                    <div
                      key={opt.key}
                      className={classNames(
                        'flex items-center gap-4 px-7 py-4 transition-colors hover:bg-white/[0.02]',
                        i < active.options.length - 1 ? 'border-b border-white/[0.04]' : '',
                      )}
                    >
                      {/* Feature info */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={classNames('text-sm font-medium', checked ? 'text-gray-100' : 'text-gray-400')}>{opt.label}</span>
                          {opt.cost === 'high' && <AlertTriangle className="h-3 w-3 text-rose-400/70 shrink-0" />}
                        </div>
                        <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{opt.desc}</p>
                      </div>

                      {/* Cost indicator */}
                      <div className="w-16 flex items-center justify-center gap-1.5">
                        <span className={classNames('h-1.5 w-1.5 rounded-full', COST_DOT[opt.cost])} />
                        <span className={classNames('text-[11px] font-medium', costInfo.cls)}>{costInfo.label}</span>
                      </div>

                      {/* Toggle */}
                      <div className="w-14 flex justify-center">
                        <Switch
                          checked={checked}
                          onChange={(v) => onToggle(active.section, opt.key, v)}
                          label={`Toggle ${opt.label}`}
                          disabled={!activeModuleOn}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 px-6">
                <div className="h-12 w-12 rounded-2xl bg-white/5 grid place-items-center mb-3">
                  <ToggleRight className="h-5 w-5 text-gray-500" />
                </div>
                <p className="text-sm text-gray-400 text-center">No individual options.</p>
                <p className="text-xs text-gray-500 mt-1">This module is controlled entirely by the toggle on the left.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
