import { useEffect, useState } from 'react';
import { getTeamPerformance } from '../../../services/staffActivityService.js';
import { getFunctionCatalogue } from '../../../services/permissionsService.js';
import { classNames, fmtNum, timeAgo } from '../../../lib/format.js';

const WINDOWS = [7, 30];

const fmtMinutes = (m) => {
  if (m == null) return '—';
  if (m < 60) return `${Math.round(m)}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
};

export default function PerformanceTab() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [labels, setLabels] = useState(new Map());
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    getFunctionCatalogue()
      .then((c) => { if (alive) setLabels(new Map((Array.isArray(c) ? c : []).map((f) => [f.name, f.label]))); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError('');
    getTeamPerformance(days)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setError('Could not load team performance.'); });
    return () => { alive = false; };
  }, [days]);

  const label = (fn) => labels.get(fn) || fn;

  return (
    <div>
      <div role="group" aria-label="Window" className="mb-4 flex w-fit rounded-xl border border-white/10 p-0.5">
        {WINDOWS.map((w) => (
          <button
            key={w}
            type="button"
            aria-pressed={days === w}
            onClick={() => setDays(w)}
            className={classNames('min-h-11 rounded-lg px-3 text-sm sm:min-h-0 sm:py-1.5', days === w ? 'bg-white/10 text-white' : 'text-gray-400')}
          >
            {w} days
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>
      )}

      {!data && !error && <p className="text-sm text-gray-400">Loading…</p>}

      {data && (
        <>
          <h2 className="mb-3 text-sm font-semibold text-gray-300">Queues</h2>
          <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="queues">
            {data.queues.map((q) => (
              <div key={q.function} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div className="truncate text-xs text-gray-400">{label(q.function)}</div>
                <div className={classNames('text-2xl font-bold', q.open ? 'text-amber-400' : 'text-white')}>{fmtNum(q.open)}</div>
                <div className="mt-1 text-xs text-gray-500">
                  {q.oldestWaitingSince ? `Oldest ${timeAgo(q.oldestWaitingSince)}` : 'Nothing waiting'}
                  {q.medianDecisionMinutes != null && ` · median ${fmtMinutes(q.medianDecisionMinutes)}`}
                </div>
              </div>
            ))}
          </div>

          <h2 className="mb-3 text-sm font-semibold text-gray-300">Staff · last {data.windowDays} days</h2>
          {data.staff.length === 0 ? (
            <p className="text-sm text-gray-400">No staff yet.</p>
          ) : (
            <ul className="space-y-2" data-testid="staff">
              {data.staff.map((s) => (
                <li key={s.id}>
                  <details className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                    <summary className="flex cursor-pointer items-center justify-between gap-3">
                      <span className="truncate font-medium text-white">{s.name}</span>
                      <span className="shrink-0 text-sm text-gray-300">{fmtNum(s.handled)} handled</span>
                    </summary>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {s.functions.length === 0 && <span className="text-xs text-gray-500">No functions</span>}
                      {s.functions.map((fn) => (
                        <span key={fn} className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-gray-300">
                          {label(fn)} · {fmtNum(s.byFunction?.[fn] || 0)}
                        </span>
                      ))}
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
