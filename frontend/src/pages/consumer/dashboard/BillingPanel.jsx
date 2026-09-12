import { Link } from 'react-router';
import { fmtINR } from '../../../lib/format.js';
import { usePlan } from '../../../context/PlanContext.jsx';
import { BILLING_HISTORY } from './constants.js';
import { Card, SectionHead } from './components.jsx';

/** Badge copy + colour per subscription status. `active` is the only one that means entitled. */
const STATUS_BADGE = {
  active: ['Active', 'bg-teal-500/15 text-teal-300'],
  pending: ['Payment pending', 'bg-amber-500/15 text-amber-300'],
  cancelled: ['Cancelled', 'bg-gray-500/15 text-gray-400'],
  expired: ['Expired', 'bg-gray-500/15 text-gray-400'],
};

export default function BillingPanel({ isOwner }) {
  // Current plan comes from PlanContext (one fetch for the whole app), not an inference from
  // inventory — so it stays correct after an upgrade and agrees with the paywall.
  const { plan, planName: name, status, isPaidOwner: paidOwner, loading } = usePlan();
  const planName = name || (isOwner ? 'Owner plan' : 'Free');
  const planSub = paidOwner
    ? `Up to ${plan.listingLimit} properties · all owner services`
    : isOwner
      ? 'Free owner listing · upgrade for more reach'
      : '15 owner contacts every month';
  // No subscription row at all is still the free tier, and the free tier is genuinely active —
  // there is no payment outstanding on it. Only a real status can contradict that.
  const [badgeText, badgeClass] = STATUS_BADGE[status] ?? STATUS_BADGE.active;
  return (
    <div className="space-y-6">
      <Card className="p-6">
        <SectionHead icon="receipt-indian-rupee" title="Current plan" action={<Link to="/plans" className="text-teal-400 text-sm font-medium hover:text-teal-300">Change plan →</Link>} />
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-white text-xl font-extrabold">{planName}</p>
            <p className="text-gray-500 text-xs mt-0.5">{planSub}</p>
          </div>
          <span className={`text-[11px] px-2.5 py-1 rounded-full font-semibold ${badgeClass} ${loading ? 'opacity-50' : ''}`}>{badgeText}</span>
        </div>
      </Card>
      <Card className="p-6">
        <SectionHead icon="history" title="Payment history" />
        {/* Desktop: the full table. Mobile (< sm): stacked cards so five columns
            don't get squished into ~390px. Same data, one source, no h-scroll. */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500">
              <th className="py-2 pr-4 font-medium">Invoice</th><th className="py-2 pr-4 font-medium">Item</th><th className="py-2 pr-4 font-medium">Amount</th><th className="py-2 pr-4 font-medium">Date</th><th className="py-2 font-medium">Status</th>
            </tr></thead>
            <tbody>
              {BILLING_HISTORY.map((b) => (
                <tr key={b.id} className="border-t border-white/5">
                  <td className="py-3 pr-4 font-mono text-xs text-gray-400">{b.id}</td>
                  <td className="py-3 pr-4 text-white">{b.plan}</td>
                  <td className="py-3 pr-4 font-semibold">{fmtINR(b.amount)}</td>
                  <td className="py-3 pr-4 text-gray-400">{b.at}</td>
                  <td className="py-3"><span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 font-semibold">{b.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="sm:hidden space-y-2.5">
          {BILLING_HISTORY.map((b) => (
            <div key={b.id} className="rounded-xl bg-white/[0.03] p-3.5">
              <div className="flex items-start justify-between gap-3">
                <p className="text-white text-sm font-semibold leading-snug min-w-0">{b.plan}</p>
                <span className="text-white text-sm font-bold whitespace-nowrap flex-shrink-0">{fmtINR(b.amount)}</span>
              </div>
              <div className="flex items-center justify-between gap-3 mt-2">
                <p className="text-gray-500 text-xs truncate">
                  <span className="font-mono">{b.id}</span> · {b.at}
                </p>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 font-semibold flex-shrink-0">{b.status}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
