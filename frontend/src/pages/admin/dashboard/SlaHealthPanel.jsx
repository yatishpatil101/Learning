import { Link } from 'react-router';
import { AlertTriangle } from 'lucide-react';

/** `null` is "not measured" and stays grey: a missing rate must not read as 0% or as 100%. */
function tone(rate) {
  if (rate == null) return 'text-gray-500';
  if (rate >= 90) return 'text-emerald-400';
  if (rate >= 75) return 'text-amber-400';
  return 'text-rose-400';
}

function bar(rate) {
  if (rate >= 90) return 'bg-emerald-500';
  if (rate >= 75) return 'bg-amber-500';
  return 'bg-rose-500';
}

const targetLabel = (h) => (h == null ? '—' : h >= 48 ? `${Math.round(h / 24)}d` : `${h}h`);

const track = (label, t) => (t == null ? null : {
  label, rate: t.slaRatePct, target: t.targetHours, late: t.outstandingBreachingCount,
});

/** The four tracks `GET /admin/analytics/sla` measures; a track the server omits is not drawn. */
function tracksOf(sla) {
  return [
    { label: 'Listing approval', rate: sla.slaRatePct, target: sla.targetHours, late: sla.pendingBreachingCount },
    track('Ticket pickup', sla.ticketPickup),
    track('Service delivery', sla.ticketDelivery),
    track('Concierge → Live', sla.conciergeToLive),
  ].filter(Boolean);
}

export default function SlaHealthPanel({ sla }) {
  if (!sla) return null;
  return (
    <section aria-labelledby="sla-health-heading" data-testid="sla-health">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="sla-health-heading" className="text-lg font-bold">SLA health</h2>
        <span className="text-sm text-gray-500">Share of work finished inside target, and what is late right now</span>
        {/* `tap-extend`: a text link on a heading baseline gets its 44px from a pseudo-element. */}
        <Link to="/admin/analytics?tab=sla" className="relative tap-extend ml-auto text-xs text-teal-400 hover:text-teal-300 transition-colors">View full analytics →</Link>
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tracksOf(sla).map((t) => (
          <div key={t.label} className="dz-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-200">{t.label}</span>
              <span className="text-[11px] text-gray-500">Target: &lt; {targetLabel(t.target)}</span>
            </div>
            <div className="relative mb-2 h-2.5 overflow-hidden rounded-full bg-white/10">
              {t.rate == null ? null : (
                <div className={`absolute inset-y-0 left-0 rounded-full ${bar(t.rate)}`} style={{ width: `${Math.min(t.rate, 100)}%` }} />
              )}
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className={`font-semibold ${tone(t.rate)}`}>{t.rate == null ? 'Not recorded' : `${t.rate}% within target`}</span>
              {t.late > 0 ? (
                <span className="inline-flex items-center gap-1 text-rose-400"><AlertTriangle className="h-3 w-3" aria-hidden="true" /> {t.late} late now</span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
