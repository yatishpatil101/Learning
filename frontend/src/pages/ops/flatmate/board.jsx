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

/* A failed read must never render as an empty queue: "nothing to do" and "the read did not work"
   look the same and only one of them means the desk can go home. */
export function QueueState({ state, onRetry, empty }) {
  if (state.status === 'loading') return <Loading />;
  if (state.status === 'error') {
    return (
      <div className="flex items-start gap-3 p-6 text-sm text-gray-300">
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
    return <p className="p-10 text-center text-sm text-gray-400">{empty}</p>;
  }
  return null;
}
