import { useState } from 'react';
import { ChevronRight, Globe, Shield, CreditCard, Home, Search, Building2, MessageCircle } from 'lucide-react';
import { classNames } from '../../../lib/format.js';
import Switch from '../../../components/ui/Switch.jsx';

const APP_FLAG_SECTIONS = [
  {
    section: 'discovery',
    title: 'Discovery & Search',
    desc: 'How buyers and tenants find properties',
    icon: Search,
    flags: [
      { key: 'mapSearch', label: 'Map search', desc: 'Interactive map-based property search' },
      { key: 'compareProperties', label: 'Compare properties', desc: 'Side-by-side property comparison tool' },
      { key: 'savedListings', label: 'Saved listings', desc: 'Allow users to save/bookmark properties' },
      { key: 'newProjectListings', label: 'New project listings', desc: 'Dedicated section for new-launch projects' },
      { key: 'videoListings', label: 'Video listings', desc: 'Support video tours on property pages' },
    ],
  },
  {
    section: 'engagement',
    title: 'Engagement & Visits',
    desc: 'User interaction with listings',
    icon: Home,
    flags: [
      { key: 'scheduleVisit', label: 'Schedule visit', desc: 'Allow users to book property site visits' },
      { key: 'emiCalculator', label: 'EMI calculator', desc: 'Home loan EMI calculator tool' },
      { key: 'reviewsEnabled', label: 'User reviews', desc: 'Allow users to review properties & localities' },
      { key: 'reviewModeration', label: 'Review moderation', desc: 'Hold reviews for admin approval before publishing' },
    ],
  },
  {
    section: 'listings',
    title: 'Listing & Posting',
    desc: 'Owner-facing listing features',
    icon: Building2,
    flags: [
      { key: 'listingVerification', label: 'Listing verification', desc: 'Require admin approval before publishing new listings' },
      { key: 'kycBadgeEnabled', label: 'Verified badge (DigiLocker)', desc: 'Offer the opt-in DigiLocker Verified badge — a trust signal, not a posting or contact gate' },
      { key: 'ownerPhonePrivacy', label: 'Owner phone privacy', desc: 'Mask owner phone numbers from non-verified buyers' },
      { key: 'paidFeaturedListings', label: 'Paid featured listings', desc: 'Owners can pay to feature/boost their listing' },
      { key: 'zeroBrokerage', label: 'Zero brokerage', desc: 'Advertise zero-brokerage model on platform' },
    ],
  },
  {
    section: 'monetization',
    title: 'Monetization & Payments',
    desc: 'Revenue and payment features',
    icon: CreditCard,
    flags: [
      { key: 'subscriptionPlans', label: 'Subscription plans', desc: 'Tiered plans for owners (Basic, Pro, Premium)' },
      { key: 'onlineRentPayment', label: 'Online rent payment', desc: 'Tenant-to-owner rent payment processing' },
      { key: 'depositFinancing', label: 'Deposit financing', desc: 'Security deposit loan/EMI option for tenants' },
      { key: 'societySaaS', label: 'Society SaaS', desc: 'Society management module (maintenance, notices)' },
    ],
  },
  {
    section: 'communication',
    title: 'Communication',
    desc: 'Messaging and notification channels',
    icon: MessageCircle,
    flags: [
      { key: 'inAppMessaging', label: 'In-app messaging', desc: 'Real-time chat between buyer and owner' },
      { key: 'demoChatSeed', label: 'Demo chat seeds', desc: 'Pre-fill the inbox with sample conversations (off = real users start empty)' },
      { key: 'whatsappEnabled', label: 'WhatsApp integration', desc: 'Send notifications and templates via WhatsApp' },
      { key: 'emailNotifications', label: 'Email notifications', desc: 'Transactional and marketing emails' },
      { key: 'smsNotifications', label: 'SMS notifications', desc: 'OTP, alerts, and reminders via SMS' },
      { key: 'pushNotifications', label: 'Push notifications', desc: 'Browser and mobile push alerts' },
    ],
  },
  {
    section: 'platform',
    title: 'Platform & Access',
    desc: 'Core platform controls',
    icon: Shield,
    flags: [
      { key: 'signupsEnabled', label: 'Public signups', desc: 'Allow new user registration (close to freeze onboarding)' },
      { key: 'staffLoginEnabled', label: 'Staff login', desc: 'Allow staff/ops team to sign in' },
      { key: 'maintenanceMode', label: 'Maintenance mode', desc: 'Block all consumer access — show maintenance page', danger: true },
    ],
  },
];

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
            const enabledCount = config.flags.filter((f) => flags[f.key]).length;
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
          const checked = !!flags[flag.key];
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
