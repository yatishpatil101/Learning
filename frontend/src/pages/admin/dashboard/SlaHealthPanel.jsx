import { Link } from 'react-router';
import { AlertTriangle } from 'lucide-react';

function slaColor(rate) {
  if (rate >= 90) return 'text-emerald-400';
  if (rate >= 75) return 'text-amber-400';
  return 'text-rose-400';
}
function slaBg(rate) {
  if (rate >= 90) return 'bg-emerald-500';
  if (rate >= 75) return 'bg-amber-500';
  return 'bg-rose-500';
}

export default function SlaHealthPanel({ sla }) {
  if (!sla) return null;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-bold">SLA health</h2>
        <span className="text-sm text-gray-500">Internal ops speed — listing approval, service delivery &amp; concierge pipeline</span>
      </div>
      <div className="mb-6 dz-card p-5">
        {/* KPI row */}
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 mb-5">
          {[
            { val: sla.summary.overallSlaRate + '%', label: 'Overall SLA', color: slaColor(sla.summary.overallSlaRate) },
            { val: sla.summary.avgApprovalTime + 'h', label: 'Avg approval', color: sla.summary.avgApprovalTime <= sla.targets.listingApproval ? 'text-emerald-400' : 'text-rose-400' },
            { val: sla.summary.currentlyBreaching, label: 'Pending overdue', color: sla.summary.currentlyBreaching === 0 ? 'text-emerald-400' : 'text-rose-400' },
            { val: sla.summary.avgPickupTime + 'h', label: 'Avg pickup', color: sla.summary.avgPickupTime <= sla.targets.servicePickup ? 'text-emerald-400' : 'text-rose-400' },
            { val: sla.summary.unassignedCount, label: 'Unassigned tickets', color: sla.summary.unassignedCount === 0 ? 'text-emerald-400' : sla.summary.unassignedCount <= 3 ? 'text-amber-400' : 'text-rose-400' },
            { val: sla.summary.avgDeliveryTime + 'h', label: 'Avg service time', color: sla.summary.avgDeliveryTime <= sla.targets.serviceDelivery ? 'text-emerald-400' : 'text-rose-400' },
            { val: sla.summary.pendingConcierge, label: 'Pipeline pending', color: sla.summary.pendingConcierge === 0 ? 'text-emerald-400' : 'text-amber-400' },
            { val: sla.summary.totalBreaches, label: 'Total breaches', color: sla.summary.totalBreaches === 0 ? 'text-emerald-400' : sla.summary.totalBreaches <= 5 ? 'text-amber-400' : 'text-rose-400' },
          ].map((m) => (
            <div key={m.label} className="text-center">
              <div className={`text-2xl font-extrabold ${m.color}`}>{m.val}</div>
              <div className="text-xs text-gray-500 mt-0.5">{m.label}</div>
            </div>
          ))}
        </div>

        {/* Progress bars */}
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
          {[
            { label: 'Listing approval', target: `< ${sla.targets.listingApproval}h`, rate: sla.summary.approvalSlaRate, breaches: sla.summary.approvalBreaches },
            { label: 'Ticket pickup', target: `< ${sla.targets.servicePickup}h`, rate: sla.summary.pickupSlaRate, breaches: sla.summary.pickupBreaches },
            { label: 'Service delivery', target: `< ${sla.targets.serviceDelivery}h`, rate: sla.summary.deliverySlaRate, breaches: sla.summary.deliveryBreaches },
            { label: 'Concierge → Live', target: `< ${sla.targets.conciergeToLive / 24}d`, rate: sla.summary.conciergeSlaRate, breaches: sla.summary.conciergeBreaches },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-gray-200">{s.label}</span>
                <span className="text-[11px] text-gray-500">Target: {s.target}</span>
              </div>
              <div className="relative h-2.5 rounded-full bg-white/10 overflow-hidden mb-2">
                <div className={`absolute inset-y-0 left-0 rounded-full transition-all ${slaBg(s.rate)}`} style={{ width: `${Math.min(s.rate, 100)}%` }} />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className={`${slaColor(s.rate)} font-semibold`}>{s.rate}% compliant</span>
                {s.breaches > 0 && <span className="inline-flex items-center gap-1 text-rose-400"><AlertTriangle className="h-3 w-3" /> {s.breaches} breached</span>}
              </div>
            </div>
          ))}
        </div>

        {/* Weekly trend */}
        <div className="mt-4 pt-4 border-t border-white/10">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Weekly SLA trend</span>
            {/* `tap-extend` rather than `tap-target`: this is a text link sitting on the same
                baseline as the section label beside it, and a 44px min-height would push that row
                apart on every screen to fix a problem that only exists on a phone. The transparent
                centred pseudo-element gives the finger its 44px and leaves the type where it is,
                which is what the class is for. `relative` supplies the positioning context it
                needs. Found by the mobile tap-target sweep at 108x16 — it had been passing only
                because the sweep's readiness gate was measuring /admin before this panel rendered. */}
            <Link to="/admin/analytics?tab=sla" className="relative tap-extend text-xs text-teal-400 hover:text-teal-300 transition-colors">View full analytics →</Link>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {sla.weeklyTrend.map((w) => (
              <div key={w.week} className="rounded-lg border border-white/5 bg-white/[0.02] p-3 text-center">
                <div className="text-[11px] text-gray-500 mb-1">{w.week}</div>
                <div className="space-y-1">
                  {[['Approval', w.approval], ['Pickup', w.pickup], ['Delivery', w.delivery], ['Concierge', w.concierge]].map(([lbl, val]) => (
                    <div key={lbl} className="flex items-center justify-between text-[11px]">
                      <span className="text-gray-500">{lbl}</span>
                      <span className={`${slaColor(val)} font-semibold`}>{val}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
