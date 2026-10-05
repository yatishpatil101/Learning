import { classNames } from '../../lib/format.js';

const STEPS = {
  owner: [['submitted', 'Submitted'], ['in_review', 'In review'], ['live', 'Live']],
  staff: [['created', 'Created'], ['link_sent', 'Link sent'], ['owner_confirmed', 'Owner confirmed'], ['in_review', 'In review'], ['live', 'Live']],
};

const OWNER_VIEW_STAFF = [['owner_confirmed', 'Your confirmation'], ['in_review', 'In review'], ['live', 'Live']];

const ACCENT = {
  staff: { done: 'text-teal-300', dot: 'bg-teal-500 text-ink', arrow: 'text-teal-500' },
  owner: { done: 'text-violet-300', dot: 'bg-violet-500 text-white', arrow: 'text-violet-500' },
};

export default function ProgressTracker({ progress, ownerView = false, compact = false, className }) {
  const all = STEPS[progress?.track];
  if (!all) return null;
  const steps = ownerView && progress.track === 'staff' ? OWNER_VIEW_STAFF : all;
  const at = all.findIndex(([key]) => key === progress.step);
  const done = steps.map(([key]) => all.findIndex(([k]) => k === key) <= at);
  const reached = done.filter(Boolean).length;
  const cur = Math.max(reached - 1, 0);
  const blocked = progress.flags?.includes('needs_info');
  const current = blocked ? (ownerView ? 'Waiting on you' : 'Waiting on owner') : steps[cur][1];
  const accent = ACCENT[progress.track];
  const isBlocked = (i) => blocked && i === cur;

  return (
    <div data-testid="progress-tracker" data-track={progress.track} data-step={progress.step} data-blocked={blocked ? 'needs_info' : undefined} className={className}>
      <div className={classNames('flex items-center gap-2 text-[11px] text-gray-400', !compact && 'sm:hidden')}>
        <span className="flex gap-1" aria-hidden="true">
          {done.map((d, i) => (
            <span key={i} className={classNames('h-1.5 w-1.5 rounded-full', isBlocked(i) ? 'bg-amber-400' : d ? accent.dot : 'bg-gray-600')} />
          ))}
        </span>
        <span>Step {Math.max(reached, 1)} of {steps.length} · <span className={blocked ? 'text-amber-300' : accent.done}>{current}</span></span>
      </div>
      {compact ? null : (
      <div className="hidden items-center sm:flex">
        <ol className="flex flex-wrap items-center gap-y-1" aria-label={`Step ${Math.max(reached, 1)} of ${steps.length}: ${current}`}>
          {steps.map((step, i) => (
            <li key={step[0]} className="flex items-center">
              <span className={classNames('flex items-center gap-1 px-2 py-[3px] text-[10px] font-medium', isBlocked(i) ? 'text-amber-300' : done[i] ? accent.done : 'text-gray-500')}>
                <span className={classNames('flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full text-[8px] font-bold', isBlocked(i) ? 'bg-amber-400 text-ink' : done[i] ? accent.dot : 'border border-gray-600 text-gray-600')}>
                  {isBlocked(i) ? '!' : done[i] ? '✓' : i + 1}
                </span>
                {isBlocked(i) ? current : step[1]}
              </span>
              {i < steps.length - 1 && (
                <svg width="12" height="10" viewBox="0 0 12 10" aria-hidden="true" className={classNames('shrink-0', done[i] ? accent.arrow : 'text-gray-700')}>
                  <path d="M0 0 L8 0 L12 5 L8 10 L0 10 L4 5 Z" fill="currentColor" />
                </svg>
              )}
            </li>
          ))}
        </ol>
        <span className="ml-2 text-[10px] tabular-nums text-gray-500">{reached}/{steps.length}</span>
      </div>
      )}
    </div>
  );
}
