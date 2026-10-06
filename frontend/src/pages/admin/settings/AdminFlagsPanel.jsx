import { useState } from 'react';
import { AlertTriangle, ToggleRight } from 'lucide-react';
import { classNames } from '../../../lib/format.js';
import Switch from '../../../components/ui/Switch.jsx';

/* Whole-module kill switches plus the two bulk-data exports. Everything else in the console is
   always on: a switch nobody would flip in an incident is only another way to break a page. */
const ADMIN_FLAG_SECTIONS = [
  { section: 'properties', title: 'Properties', desc: 'Listing management', critical: true, options: [
    { key: 'csvExport', label: 'CSV export', desc: 'Download the listing table as a CSV file' },
  ] },
  { section: 'users', title: 'Users', desc: 'User management', critical: true, options: [
    { key: 'csvExport', label: 'CSV export', desc: 'Download the user table as a CSV file' },
  ] },
  { section: 'analytics', title: 'Analytics', desc: 'Traffic, demand and pricing dashboards', hasTabFlag: true, options: [] },
  { section: 'finance', title: 'Finance', desc: 'Revenue, transactions and payouts', hasTabFlag: true, options: [] },
  { section: 'reports', title: 'Reports', desc: 'Abuse reports and review moderation', hasTabFlag: true, options: [] },
  { section: 'flatmates', title: 'Flatmates', desc: 'Flatmate community moderation', hasTabFlag: true, options: [] },
  { section: 'support', title: 'Support', desc: 'Customer support ticket queue', hasTabFlag: true, options: [] },
  { section: 'services', title: 'Home Loans desk', desc: 'Home loan enquiry tickets', options: [] },
  { section: 'content', title: 'Content', desc: 'Banners, FAQs and announcements', options: [] },
  { section: 'staffActivity', title: 'Team Activity', desc: 'Staff performance and the activity log', options: [] },
];

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
                  <span className="w-14 text-center text-[11px] font-semibold uppercase tracking-wider text-gray-500">Status</span>
                </div>

                {/* Option rows */}
                {active.options.map((opt, i) => {
                  const checked = adminFlags[active.section]?.[opt.key] !== false;
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
                        </div>
                        <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{opt.desc}</p>
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
