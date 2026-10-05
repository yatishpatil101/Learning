import { RefreshCw, ShieldAlert } from 'lucide-react';
import { classNames } from '../../../lib/format.js';
import Loading from '../../../components/ui/Loading.jsx';

export const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('en-IN') : '—');

export function Block({ icon: Icon, title, children, className, aside }) {
  return (
    <section className={classNames('rounded-2xl border border-white/10 bg-white/[0.03] p-4', className)}>
      <div className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-200">
        <Icon className="h-4 w-4 text-brand-teal" /> {title}
        {aside ? <span className="ml-auto">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** Labels only in the accessible names — no live counts that go stale between two decisions. */
export function Tabs({ tabs, active, onChange, label }) {
  return (
    <div role="group" aria-label={label} className="mb-4 flex w-full flex-wrap gap-1 rounded-xl border border-white/10 bg-white/5 p-1 sm:w-max">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={active === t.id}
          onClick={() => onChange(t.id)}
          className={classNames(
            'rounded-lg px-3 py-1.5 text-sm font-medium transition',
            active === t.id ? 'bg-brand-teal text-ink' : 'text-gray-300 hover:bg-white/5',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* A failed read must never render as an empty queue: "nothing to do" and "the read did not work"
   look the same and only one of them means the desk can go home. */
export function QueueState({ state, onRetry, empty }) {
  if (state.status === 'loading') return <Loading />;
  if (state.status === 'error') {
    return (
      <div className="dz-card flex items-start gap-3 p-6 text-sm text-gray-300">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
        <div>
          <div className="font-semibold text-gray-100">This queue could not be read.</div>
          <p className="mt-1 max-w-2xl text-gray-400">{state.error}</p>
          <button type="button" onClick={onRetry} className="dz-btn dz-btn-ghost mt-3">
            <RefreshCw className="h-4 w-4" />Try again
          </button>
        </div>
      </div>
    );
  }
  if (!state.items.length) {
    return <div className="dz-card p-10 text-center text-sm text-gray-500">{empty}</div>;
  }
  return null;
}
