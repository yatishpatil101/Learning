import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { getMyWork } from '../../../services/staffActivityService.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { DESK_BY_VALUE, canOpenPath, deskFromFunction, portalPath } from '../../../lib/adminModules.js';
import { classNames, fmtNum, timeAgo } from '../../../lib/format.js';
import PageHeader from '../../../components/ui/PageHeader.jsx';

const WINDOWS = [7, 30];

// Staff cannot read the function catalogue (manager/admin only), so labels and landing pages live here.
const FUNCTIONS = {
  kyc: { label: 'KYC review', path: '/admin/kyc-review' },
  propertyVerification: { label: 'Property verification', path: '/admin/properties' },
  listingModeration: { label: 'Listing moderation', path: '/admin/properties' },
  postOnBehalf: { label: 'Post on behalf', path: '/admin/post-on-behalf' },
  support: { label: 'Support', path: '/admin/support' },
  content: { label: 'Content', path: '/admin/content' },
  reports: { label: 'Reports', path: '/admin/reports' },
  analytics: { label: 'Analytics', path: '/admin/analytics' },
};

function describe(fn) {
  const desk = deskFromFunction(fn);
  if (desk) {
    return { label: DESK_BY_VALUE[desk]?.label || desk, path: DESK_BY_VALUE[desk]?.path || '/admin' };
  }
  return FUNCTIONS[fn] || { label: fn, path: null };
}

export default function StaffWorkDashboard() {
  const { user } = useAuth();
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setData(null);
    setError('');
    getMyWork(days)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setError('Could not load your work summary.'); });
    return () => { alive = false; };
  }, [days]);

  const me = data?.staff?.[0];
  const functions = me?.functions || [];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={user?.name ? `Your work, ${user.name}` : 'Your work'}
        actions={(
          <div role="group" aria-label="Window" className="flex rounded-xl border border-white/10 p-0.5">
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
        )}
      />

      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>
      )}
      {!data && !error && <p className="text-sm text-gray-400">Loading…</p>}

      {data && functions.length === 0 && (
        <p className="dz-card p-5 text-sm text-gray-300" data-testid="no-functions">
          No work is assigned to you yet. Ask your manager to grant you a function.
        </p>
      )}

      {data && functions.length > 0 && (
        <>
          <h2 className="mb-3 text-sm font-semibold text-gray-300">Waiting for you</h2>
          {data.queues.length === 0 ? (
            <p className="mb-8 text-sm text-gray-500">Your functions have no queue to work.</p>
          ) : (
            <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="my-queues">
              {data.queues.map((q) => {
                const { label, path } = describe(q.function);
                const body = (
                  <>
                    <div className="truncate text-xs text-gray-400">{label}</div>
                    <div className={classNames('text-2xl font-bold', q.open ? 'text-amber-400' : 'text-white')}>{fmtNum(q.open)}</div>
                    <div className="mt-1 text-xs text-gray-500">
                      {q.oldestWaitingSince ? `Oldest ${timeAgo(q.oldestWaitingSince)}` : 'All clear'}
                    </div>
                  </>
                );
                const tile = 'block rounded-xl border border-white/10 bg-white/[0.02] p-4';
                return path && canOpenPath(user, path)
                  ? <Link key={q.function} to={portalPath(user, path)} className={`${tile} hover:border-white/20`}>{body}</Link>
                  : <div key={q.function} className={tile}>{body}</div>;
              })}
            </div>
          )}

          <h2 className="mb-3 text-sm font-semibold text-gray-300">
            You handled {fmtNum(me.handled)} in the last {data.windowDays} days
          </h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="my-functions">
            {functions.map((fn) => (
              <li key={fn} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
                <span className="truncate text-sm text-gray-200">{describe(fn).label}</span>
                <span className="shrink-0 text-sm font-semibold text-white">{fmtNum(me.byFunction?.[fn] || 0)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
