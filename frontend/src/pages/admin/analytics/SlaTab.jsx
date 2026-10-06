import { Link } from 'react-router';
import { LoadFailedNotice } from './constants.jsx';

/** Elapsed hours, or an explicit statement that nobody recorded them. Never `0h`. */
const hours = (v) => (v == null ? 'not recorded' : `${Math.round(v * 10) / 10}h`);

/** Nullable percentage. A dash rather than `100%`, which would claim perfect compliance. */
const rate = (v) => (v == null ? '—' : `${v}%`);

/** Target hours as the unit the desk talks in — days once a target runs past two of them. */
const targetLabel = (h) => (h == null ? '—' : h >= 48 ? `${Math.round(h / 24)}d` : `${h}h`);

/* Grey is 'no measurement', not a performance band, so the
   null check comes first; green/red are real comparisons. / */
const avgTone = (avgHours, targetHours) => (
  avgHours == null || targetHours == null ? 'text-gray-500'
    : avgHours <= targetHours ? 'text-emerald-400'
      : 'text-rose-400');

/** Derived figures are nullable and render as a dash or 'not recorded';
 * counts print zero, as 'nothing waiting' is a measurement. */
function Track({ title, desc, track, completedLabel, outstandingLabel }) {
  if (!track) return null;
  const compliant = track.slaRatePct == null ? null : track.slaRatePct >= 90;
  const breaching = track.outstandingBreachingCount;
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-1">{title}</h3>
      <p className="text-xs text-gray-500 mb-4">{desc}</p>
      <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-5">
        <div>
          <div className="text-xl font-bold text-white">{track.completedCount}</div>
          <div className="text-[11px] text-gray-500">{completedLabel}</div>
        </div>
        <div>
          <div className={`text-xl font-bold ${avgTone(track.avgHours, track.targetHours)}`}>{hours(track.avgHours)}</div>
          <div className="text-[11px] text-gray-500">Avg</div>
        </div>
        <div>
          <div className={`text-xl font-bold ${track.medianHours == null ? 'text-gray-500' : 'text-sky-400'}`}>{hours(track.medianHours)}</div>
          <div className="text-[11px] text-gray-500">Median</div>
        </div>
        <div>
          <div className={`text-xl font-bold ${compliant == null ? 'text-gray-500' : compliant ? 'text-emerald-400' : 'text-amber-400'}`}>{rate(track.slaRatePct)}</div>
          <div className="text-[11px] text-gray-500">Within {targetLabel(track.targetHours)}</div>
        </div>
        <div>
          <div className={`text-xl font-bold ${track.outstandingCount === 0 ? 'text-emerald-400' : 'text-sky-400'}`}>{track.outstandingCount}</div>
          <div className="text-[11px] text-gray-500">{outstandingLabel}</div>
        </div>
      </div>
      <p className="mt-3 text-xs text-gray-500">
        {track.outstandingCount === 0
          ? 'Nothing is outstanding.'
          : breaching == null
          ? `${track.outstandingCount} outstanding; how many are late cannot be measured here.`
          : breaching === 0
          ? `All ${track.outstandingCount} outstanding are still inside target.`
          : <><span className="font-semibold text-rose-300">{breaching}</span>{` of ${track.outstandingCount} outstanding ${breaching === 1 ? 'is' : 'are'} already past target.`}</>}
        {track.completedCount === 0 || track.avgHours != null
          ? ''
          : ' Turnaround is unrecorded in this environment, so the averages above are blank rather than zero.'}
      </p>
    </div>
  );
}

/** No weekly compliance line: it needs snapshots nothing writes. Null averages render 'not recorded', since
 * coercing to 0 would claim instant service and 0% compliance at once. */
export default function SlaTab({ sla, failed, days }) {
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
  /* The target is served, so it can be absent: a missing one read as
     0 would mark every listing late, so comparisons are suppressed. */
  const target = sla.targetHours;
  const withinTargetLabel = target == null ? 'Within target' : `Within ${target}h target`;

  return (
    <div className="space-y-6">
      {/* Measured: listing review turnaround and the live backlog. */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {[
          [sla.reviewedCount, `Listings reviewed (${days}d)`, 'text-white'],
          [hours(sla.avgHoursToReview), 'Avg time to review', avgTone(sla.avgHoursToReview, target)],
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
          // A scrollable region needs keyboard focus to be reachable without a mouse (WCAG 2.1.1).
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- named scroll region
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

      {/* Pickup is the first assignment in the audit log, not the
          current owner column, which forgets tickets handed back. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Track
          title="Ticket Pickup"
          desc="How long an incoming service request waits before somebody owns it."
          track={sla.ticketPickup}
          completedLabel="Picked up"
          outstandingLabel="Unassigned"
        />
        <Track
          title="Service Delivery"
          desc="Raised to finished — rent agreement, legal, interiors and the rest."
          track={sla.ticketDelivery}
          completedLabel="Delivered"
          outstandingLabel="In flight"
        />
      </div>
      <Track
        title="Concierge Pipeline"
        desc="A staff-posted listing from creation to going live. Owner-posted listings are counted under review above, not here."
        track={sla.conciergeToLive}
        completedLabel="Went live"
        outstandingLabel="Still pending"
      />

      {/* Targets are policy, not measurement — but every one of them is the number the server
          compared against, so the table cannot drift away from the panels above it. */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">SLA Targets</h3>
        <div className="space-y-3">
          {[
            ['Listing approval', target, 'Review & approve/reject new listings'],
            ['Ticket pickup', sla.ticketPickup?.targetHours, 'Assign incoming service requests'],
            ['Service delivery', sla.ticketDelivery?.targetHours, 'Complete rent agreement, legal, etc.'],
            ['Concierge → Live', sla.conciergeToLive?.targetHours, 'Staff-posted property verified & live'],
          ].map(([name, hoursTarget, desc]) => (
            <div key={name} className="flex items-center justify-between border-b border-white/5 pb-2.5 last:border-0 last:pb-0">
              <div>
                <div className="text-sm font-medium text-gray-200">{name}</div>
                <div className="text-[11px] text-gray-500">{desc}</div>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${hoursTarget == null ? 'bg-white/5 text-gray-400' : 'bg-teal-500/15 text-teal-300'}`}>
                {hoursTarget == null ? '—' : `< ${targetLabel(hoursTarget)}`}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
