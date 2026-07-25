import { Link } from 'react-router';
import { LineChart } from '../../../components/charts/index.jsx';
import { C, AX, axis, Card } from './constants.jsx';

export default function SlaTab({ sla }) {
  if (!sla) return null;
  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        {[
          [sla.summary.overallSlaRate + '%', 'Overall SLA', sla.summary.overallSlaRate >= 90 ? 'text-emerald-400' : sla.summary.overallSlaRate >= 75 ? 'text-amber-400' : 'text-rose-400'],
          [sla.summary.avgApprovalTime + 'h', 'Avg approval time', sla.summary.avgApprovalTime <= sla.targets.listingApproval ? 'text-emerald-400' : 'text-rose-400'],
          [sla.summary.approvalSlaRate + '%', 'Approval SLA', sla.summary.approvalSlaRate >= 90 ? 'text-emerald-400' : 'text-amber-400'],
          [sla.summary.avgPickupTime + 'h', 'Avg ticket pickup', sla.summary.avgPickupTime <= sla.targets.servicePickup ? 'text-emerald-400' : 'text-rose-400'],
          [sla.summary.pickupSlaRate + '%', 'Pickup SLA', sla.summary.pickupSlaRate >= 90 ? 'text-emerald-400' : 'text-amber-400'],
          [sla.summary.avgDeliveryTime + 'h', 'Avg delivery time', sla.summary.avgDeliveryTime <= sla.targets.serviceDelivery ? 'text-emerald-400' : 'text-rose-400'],
          [sla.summary.deliverySlaRate + '%', 'Delivery SLA', sla.summary.deliverySlaRate >= 90 ? 'text-emerald-400' : 'text-amber-400'],
          [sla.summary.totalBreaches, 'Total breaches', sla.summary.totalBreaches === 0 ? 'text-emerald-400' : sla.summary.totalBreaches <= 5 ? 'text-amber-400' : 'text-rose-400'],
        ].map(([val, label, color]) => (
          <div key={label} className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-center">
            <div className={`text-2xl font-bold ${color}`}>{val}</div>
            <div className="text-xs text-gray-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      <Card title="Weekly SLA compliance trend" desc="4-week rolling compliance by category" height={280}>
        <LineChart labels={sla.weeklyTrend.map((w) => w.week)} datasets={[{ label: 'Listing approval', data: sla.weeklyTrend.map((w) => w.approval), color: C.teal, fill: false }, { label: 'Ticket pickup', data: sla.weeklyTrend.map((w) => w.pickup), color: C.indigo, fill: false }, { label: 'Service delivery', data: sla.weeklyTrend.map((w) => w.delivery), color: C.coral, fill: false }, { label: 'Concierge pipeline', data: sla.weeklyTrend.map((w) => w.concierge), color: C.emerald, fill: false }]} options={{ scales: { x: AX, y: axis({ min: 50, max: 100, ticks: { color: '#94a3b8', callback: (v) => `${v}%` } }) } }} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-1">Listing Approval</h3>
          <p className="text-xs text-gray-500 mb-4">Target: review within {sla.targets.listingApproval} hours</p>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div><div className="text-xl font-bold text-white">{sla.summary.avgApprovalTime}h</div><div className="text-[11px] text-gray-500">Avg time</div></div>
            <div><div className={`text-xl font-bold ${sla.summary.approvalSlaRate >= 90 ? 'text-emerald-400' : 'text-amber-400'}`}>{sla.summary.approvalSlaRate}%</div><div className="text-[11px] text-gray-500">Compliance</div></div>
            <div><div className={`text-xl font-bold ${sla.summary.currentlyBreaching > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{sla.summary.currentlyBreaching}</div><div className="text-[11px] text-gray-500">Currently overdue</div></div>
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-1">Service Fulfillment</h3>
          <p className="text-xs text-gray-500 mb-4">Target: pick up within {sla.targets.servicePickup}h, deliver within {sla.targets.serviceDelivery}h</p>
          <div className="grid grid-cols-4 gap-3 text-center">
            <div><div className="text-xl font-bold text-white">{sla.summary.avgPickupTime}h</div><div className="text-[11px] text-gray-500">Avg pickup</div></div>
            <div><div className="text-xl font-bold text-white">{sla.summary.avgDeliveryTime}h</div><div className="text-[11px] text-gray-500">Avg delivery</div></div>
            <div><div className={`text-xl font-bold ${sla.summary.unassignedCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{sla.summary.unassignedCount}</div><div className="text-[11px] text-gray-500">Unassigned</div></div>
            <div><div className="text-xl font-bold text-sky-400">{sla.summary.inProgressCount}</div><div className="text-[11px] text-gray-500">In progress</div></div>
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-1">Concierge Pipeline</h3>
          <p className="text-xs text-gray-500 mb-4">Target: staff-posted listing goes live within {sla.targets.conciergeToLive / 24} days</p>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div><div className="text-xl font-bold text-white">{sla.summary.avgConciergeTime}h</div><div className="text-[11px] text-gray-500">Avg time to live</div></div>
            <div><div className={`text-xl font-bold ${sla.summary.conciergeSlaRate >= 90 ? 'text-emerald-400' : 'text-amber-400'}`}>{sla.summary.conciergeSlaRate}%</div><div className="text-[11px] text-gray-500">Compliance</div></div>
            <div><div className={`text-xl font-bold ${sla.summary.pendingConcierge > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{sla.summary.pendingConcierge}</div><div className="text-[11px] text-gray-500">Still pending</div></div>
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">SLA Targets</h3>
          <div className="space-y-3">
            {[['Listing approval', `< ${sla.targets.listingApproval}h`, 'Review & approve/reject new listings'], ['Ticket pickup', `< ${sla.targets.servicePickup}h`, 'Assign incoming service requests'], ['Service delivery', `< ${sla.targets.serviceDelivery}h`, 'Complete rent agreement, legal, etc.'], ['Concierge → Live', `< ${sla.targets.conciergeToLive / 24}d`, 'Staff-posted property verified & live']].map(([name, target, desc]) => (
              <div key={name} className="flex items-center justify-between border-b border-white/5 pb-2.5 last:border-0 last:pb-0">
                <div><div className="text-sm font-medium text-gray-200">{name}</div><div className="text-[11px] text-gray-500">{desc}</div></div>
                <span className="rounded-full bg-teal-500/15 px-2.5 py-1 text-xs font-semibold text-teal-300">{target}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
