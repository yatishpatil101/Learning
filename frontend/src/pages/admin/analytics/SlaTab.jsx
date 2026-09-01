import { Link } from 'react-router';
import { LineChart } from '../../../components/charts/index.jsx';
import { C, AX, axis, Card, LoadFailedNotice } from './constants.jsx';

/** Elapsed hours, or an explicit statement that nobody recorded them. Never `0h`. */
const hours = (v) => (v == null ? 'not recorded' : `${Math.round(v * 10) / 10}h`);

/** Nullable percentage. A dash rather than `100%`, which would claim perfect compliance. */
const rate = (v) => (v == null ? '—' : `${v}%`);

/**
 * The SLA tab: measured listing-review turnaround, plus three illustrative panels.
 *
 * `sla` is the server report (`GET /admin/analytics/sla`), derived from `audit_log` — the record of
 * who changed a listing's status and when. `sample` is the seeded generator and feeds only what the
 * platform does not measure: the weekly compliance trend, service-ticket pickup and delivery, and
 * the concierge pipeline. Those three are a different domain with no equivalent audit trail, and
 * they carry a `Sample` chip.
 *
 * **Turnaround can be legitimately unknown, and says so.** Against mocks there is no audit log at
 * all, so `avgHoursToReview` and `slaRatePct` arrive null and render as "not recorded". Coercing
 * them to zero would read as instantaneous review and 0% compliance simultaneously — two false
 * claims from one `|| 0`. The backlog figures below them are never null: they come from `createdAt`
 * on listings still pending, which both mock and server hold, so they are always real.
 *
 * @param {{sla: (object|null), sample: (object|null), failed: boolean}} props `sla` of null renders
 *   nothing, which is the pre-arrival state; `failed` distinguishes that from a load that came back
 *   empty-handed, which would otherwise leave a permanently blank tab and no way to tell why.
 */
export default function SlaTab({ sla, sample, failed }) {
  if (failed) {
    return (
      <LoadFailedNotice>
        The SLA endpoint did not answer, so neither turnaround nor the review backlog is shown. An
        empty backlog here would read as “nothing is awaiting review”.
      </LoadFailedNotice>
    );
  }
  if (!sla) return null;

  const compliant = sla.slaRatePct == null ? null : sla.slaRatePct >= 90;
  const overdue = sla.pendingBreachingCount;
  /*
   * The target is served rather than assumed, so it can be absent. Every comparison below keys on
   * it — whether an average is green, whether a pending row is stamped overdue — and a missing
   * target read as 0 would mark every listing late and colour every average red. Where it is null
   * the comparison is suppressed rather than guessed, and the label drops the number.
   */
  const target = sla.targetHours;
  const withinTargetLabel = target == null ? 'Within target' : `Within ${target}h target`;

  return (
    <div className="space-y-6">
      {/* Measured: listing review turnaround and the live backlog. */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {[
          [sla.reviewedCount, 'Listings reviewed', 'text-white'],
          [hours(sla.avgHoursToReview), 'Avg time to review', sla.avgHoursToReview == null || target == null ? 'text-gray-500' : sla.avgHoursToReview <= target ? 'text-emerald-400' : 'text-rose-400'],
          [hours(sla.medianHoursToReview), 'Median time to review', sla.medianHoursToReview == null ? 'text-gray-500' : 'text-sky-400'],
          [rate(sla.slaRatePct), withinTargetLabel, compliant == null ? 'text-gray-500' : compliant ? 'text-emerald-400' : 'text-amber-400'],
          [sla.pendingCount, 'Awaiting review', sla.pendingCount === 0 ? 'text-emerald-400' : 'text-sky-400'],
          [overdue, 'Overdue right now', overdue === 0 ? 'text-emerald-400' : 'text-rose-400'],
        ].map(([val, label, color]) => (
          <div key={label} className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-center">
            <div className={`text-2xl font-bold ${color}`}>{val}</div>
            <div className="text-xs text-gray-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {sla.avgHoursToReview == null && sla.reviewedCount > 0 ? (
        <p className="text-xs text-gray-500">
          {sla.reviewedCount} listings have been decided, but no decision timestamps are recorded in
          this environment, so turnaround cannot be measured. The backlog figures above are real.
        </p>
      ) : null}

      {/* Measured: the actual queue, longest wait first — the one panel here that is actionable. */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-1">Longest Waiting Listings</h3>
        <p className="text-xs text-gray-500 mb-4">Pending review, oldest first.{target == null ? '' : ` Target is ${target} hours.`}</p>
        {sla.worstPending.length === 0 ? (
          <p className="text-sm text-emerald-300">Nothing is waiting for review.</p>
        ) : (
          // A scrollable region needs keyboard focus to be reachable without a mouse (WCAG 2.1.1),
          // which is the documented exception to the rule disabled below.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- named scroll region, see above
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Longest waiting listings">
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-gray-500 border-b border-white/10"><th scope="col" className="text-left py-2 font-medium">Listing</th><th scope="col" className="text-right py-2 font-medium">Waiting</th><th scope="col" className="text-center py-2 font-medium">Status</th></tr></thead>
              <tbody>
                {sla.worstPending.map((p) => (
                  <tr key={p.id} className="border-b border-white/5 last:border-0">
                    <td className="py-2.5 text-white font-medium"><Link to={`/admin/properties?review=${p.id}`} className="hover:text-teal-300 transition-colors">{p.title}</Link></td>
                    <td className={`py-2.5 text-right tabular-nums font-semibold ${target != null && p.hoursWaiting > target ? 'text-rose-300' : 'text-gray-300'}`}>{hours(p.hoursWaiting)}</td>
                    <td className="py-2.5 text-center">
                      {target == null
                        ? <span className="text-[10px] text-gray-500">—</span>
                        : p.hoursWaiting > target
                        ? <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-300">Overdue</span>
                        : <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">On track</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/*
       * Everything below is illustrative. Service tickets and the concierge pipeline are a separate
       * domain with no audit trail to measure against, and a weekly compliance line needs a history
       * of weekly snapshots that nothing writes.
       */}
      {sample ? (
        <>
          <Card title="Weekly SLA compliance trend" desc="4-week rolling compliance by category" chip="Sample" height={280}>
            <LineChart labels={sample.weeklyTrend.map((w) => w.week)} datasets={[{ label: 'Listing approval', data: sample.weeklyTrend.map((w) => w.approval), color: C.teal, fill: false }, { label: 'Ticket pickup', data: sample.weeklyTrend.map((w) => w.pickup), color: C.indigo, fill: false }, { label: 'Service delivery', data: sample.weeklyTrend.map((w) => w.delivery), color: C.coral, fill: false }, { label: 'Concierge pipeline', data: sample.weeklyTrend.map((w) => w.concierge), color: C.emerald, fill: false }]} options={{ scales: { x: AX, y: axis({ min: 50, max: 100, ticks: { color: '#94a3b8', callback: (v) => `${v}%` } }) } }} />
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
              <div className="mb-1 flex items-start justify-between gap-3">
                <h3 className="text-sm font-semibold text-gray-300">Service Fulfillment</h3>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-gray-400" title="Illustrative sample data">Sample</span>
              </div>
              <p className="text-xs text-gray-500 mb-4">Target: pick up within {sample.targets.servicePickup}h, deliver within {sample.targets.serviceDelivery}h</p>
              <div className="grid grid-cols-4 gap-3 text-center">
                <div><div className="text-xl font-bold text-white">{sample.summary.avgPickupTime}h</div><div className="text-[11px] text-gray-500">Avg pickup</div></div>
                <div><div className="text-xl font-bold text-white">{sample.summary.avgDeliveryTime}h</div><div className="text-[11px] text-gray-500">Avg delivery</div></div>
                <div><div className={`text-xl font-bold ${sample.summary.unassignedCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{sample.summary.unassignedCount}</div><div className="text-[11px] text-gray-500">Unassigned</div></div>
                <div><div className="text-xl font-bold text-sky-400">{sample.summary.inProgressCount}</div><div className="text-[11px] text-gray-500">In progress</div></div>
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
              <div className="mb-1 flex items-start justify-between gap-3">
                <h3 className="text-sm font-semibold text-gray-300">Concierge Pipeline</h3>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-gray-400" title="Illustrative sample data">Sample</span>
              </div>
              <p className="text-xs text-gray-500 mb-4">Target: staff-posted listing goes live within {sample.targets.conciergeToLive / 24} days</p>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div><div className="text-xl font-bold text-white">{sample.summary.avgConciergeTime}h</div><div className="text-[11px] text-gray-500">Avg time to live</div></div>
                <div><div className={`text-xl font-bold ${sample.summary.conciergeSlaRate >= 90 ? 'text-emerald-400' : 'text-amber-400'}`}>{sample.summary.conciergeSlaRate}%</div><div className="text-[11px] text-gray-500">Compliance</div></div>
                <div><div className={`text-xl font-bold ${sample.summary.pendingConcierge > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{sample.summary.pendingConcierge}</div><div className="text-[11px] text-gray-500">Still pending</div></div>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {/* Targets are policy, not measurement. Listing approval comes from the server so the number
          the tab compares against is the same one the server compared against. */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">SLA Targets</h3>
        <div className="space-y-3">
          {[
            ['Listing approval', target == null ? '—' : `< ${target}h`, 'Review & approve/reject new listings', true],
            ...(sample ? [
              ['Ticket pickup', `< ${sample.targets.servicePickup}h`, 'Assign incoming service requests', false],
              ['Service delivery', `< ${sample.targets.serviceDelivery}h`, 'Complete rent agreement, legal, etc.', false],
              ['Concierge → Live', `< ${sample.targets.conciergeToLive / 24}d`, 'Staff-posted property verified & live', false],
            ] : []),
          ].map(([name, target, desc, tracked]) => (
            <div key={name} className="flex items-center justify-between border-b border-white/5 pb-2.5 last:border-0 last:pb-0">
              <div>
                <div className="text-sm font-medium text-gray-200">{name}</div>
                <div className="text-[11px] text-gray-500">{desc}{tracked ? '' : ' — not measured yet'}</div>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tracked ? 'bg-teal-500/15 text-teal-300' : 'bg-white/5 text-gray-400'}`}>{target}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
