import { useState } from 'react';
import { ChevronRight, Globe, Shield, CreditCard, Search, Building2 } from 'lucide-react';
import { classNames } from '../../../lib/format.js';
import Switch from '../../../components/ui/Switch.jsx';

/* Only runtime kill switches and launch gates: each one must switch a live feature off when it
   misbehaves, costs too much or is abused. `off: true` marks the one flag whose absence means off. */
const APP_FLAG_SECTIONS = [
  {
    section: 'engagement',
    title: 'Discovery & Engagement',
    desc: 'Buyer and tenant features with a running cost or abuse risk',
    icon: Search,
    flags: [
      { key: 'mapSearch', label: 'Map search', desc: 'Google Maps view on the listings page' },
      { key: 'scheduleVisit', label: 'Schedule visit', desc: 'Booking property site visits with owners' },
      { key: 'reviewsEnabled', label: 'User reviews', desc: 'Property and locality reviews written by users' },
      { key: 'inAppMessaging', label: 'In-app messaging', desc: 'Chat between buyers, tenants and owners' },
      { key: 'assistant', label: 'Assistant', desc: 'The floating help assistant on consumer pages' },
    ],
  },
  {
    section: 'trust',
    title: 'Trust',
    desc: 'Flows that depend on review capacity or a staged launch',
    icon: Building2,
    flags: [
      { key: 'kycBadgeEnabled', label: 'Verified badge (identity review)', desc: 'The opt-in identity verification flow; a trust signal, not a posting or contact gate' },
    ],
  },
  {
    section: 'payments',
    title: 'Monetization & Payments',
    desc: 'Money-moving features to pause during a gateway or fraud incident',
    icon: CreditCard,
    flags: [
      { key: 'subscriptionPlans', label: 'Plan purchases', desc: 'Buying plans and top-ups at checkout. Off pauses new purchases; active plans keep working.' },
      { key: 'paidFeaturedListings', label: 'Paid featured listings', desc: 'Paid owners can feature a listing; free owners see the upsell' },
      { key: 'referralRewards', label: 'Referral rewards', desc: 'Show the refer-and-earn routes to free owner contacts and listing slots. Off hides them; bonuses already earned still count.' },
    ],
  },
  {
    section: 'platform',
    title: 'Platform & Access',
    desc: 'Incident controls the server enforces',
    icon: Shield,
    flags: [
      { key: 'signupsEnabled', label: 'Public signups', desc: 'Allow new user registration (close to freeze onboarding)' },
      { key: 'staffLoginEnabled', label: 'Staff login', desc: 'Allow staff and managers to sign in; administrators always can' },
      { key: 'maintenanceMode', label: 'Maintenance mode', desc: 'Block all consumer access and show the maintenance page', danger: true, off: true },
    ],
  },
];

const OFF_BY_DEFAULT = new Set(APP_FLAG_SECTIONS.flatMap((s) => s.flags.filter((f) => f.off).map((f) => f.key)));

/** What the site actually does with a stored flag: consumers read a missing flag as on. */
export const appFlagOn = (flags, key) => (OFF_BY_DEFAULT.has(key) ? flags?.[key] === true : flags?.[key] !== false);

export default function AppFlagsPanel({ flags, onToggle }) {
  const [selected, setSelected] = useState(APP_FLAG_SECTIONS[0].section);
  const active = APP_FLAG_SECTIONS.find((s) => s.section === selected);

  return (
    <div className="flex flex-col lg:flex-row rounded-3xl border border-white/[0.08] overflow-hidden lg:h-[calc(100vh-280px)] lg:min-h-[440px] lg:max-h-[680px] shadow-xl shadow-black/20">
      {/* Left column */}
      <div className="w-full lg:w-[280px] shrink-0 border-b lg:border-b-0 lg:border-r border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent overflow-y-auto">
        <div className="px-5 py-4">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-brand-teal" />
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Feature Groups</span>
          </div>
        </div>

        <div className="px-3 pb-3 space-y-1">
          {APP_FLAG_SECTIONS.map((config) => {
            const isActive = config.section === selected;
            const Icon = config.icon;
            const enabledCount = config.flags.filter((f) => appFlagOn(flags, f.key)).length;
            return (
              <button
                key={config.section}
                onClick={() => setSelected(config.section)}
                className={classNames(
                  'flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-all',
                  isActive ? 'bg-brand-teal/10 ring-1 ring-brand-teal/30' : 'hover:bg-white/[0.04]',
                )}
              >
                <span className={classNames('grid h-8 w-8 place-items-center rounded-lg shrink-0', isActive ? 'bg-brand-teal/20 text-brand-teal' : 'bg-white/5 text-gray-500')}>
                  <Icon className="h-4 w-4" />
                </span>
                <div className="flex-1 min-w-0">
                  <span className={classNames('text-sm font-medium truncate block', isActive ? 'text-white' : 'text-gray-300')}>{config.title}</span>
                  <span className="text-[11px] text-gray-500">{enabledCount}/{config.flags.length} active</span>
                </div>
                <ChevronRight className={classNames('h-3.5 w-3.5 shrink-0 transition-colors', isActive ? 'text-brand-teal' : 'text-gray-600')} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Right column */}
      <div className="flex-1 overflow-y-auto min-w-0">
        {active && <ActiveSection active={active} flags={flags} onToggle={onToggle} />}
      </div>
    </div>
  );
}

function ActiveSection({ active, flags, onToggle }) {
  const Icon = active.icon;
  return (
    <>
      <div className="sticky top-0 z-10 border-b border-white/[0.06] bg-ink-2/95 backdrop-blur px-6 py-4">
        <div className="flex items-center gap-3">
          <Icon className="h-5 w-5 text-brand-teal" />
          <div>
            <h3 className="text-base font-bold text-white">{active.title}</h3>
            <p className="text-xs text-gray-400 mt-0.5">{active.desc}</p>
          </div>
        </div>
      </div>

      <div>
        {active.flags.map((flag) => {
          const checked = appFlagOn(flags, flag.key);
          return (
            <div key={flag.key} className={classNames('flex items-center justify-between gap-4 px-6 py-4 border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors', flag.danger && checked && 'bg-rose-500/5')}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-200">{flag.label}</span>
                  {flag.danger && <span className="rounded-md border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-400">Caution</span>}
                </div>
                <p className="text-[11px] text-gray-500 mt-0.5">{flag.desc}</p>
              </div>
              <Switch checked={checked} onChange={() => onToggle(flag.key)} label={`Toggle ${flag.label}`} />
            </div>
          );
        })}
      </div>
    </>
  );
}
