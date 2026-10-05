import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { listServiceRequestQueue } from '../../../services/serviceRequestService.js';
import { classNames, fmtNum } from '../../../lib/format.js';

// Mirrors the server's IN_PROGRESS_STATUSES, so a tab lists exactly what its queue-summary count tallies.
const DESK_TURN = 'assigned,in-progress,changes-requested,approved';

export const stageTabs = (noun) => [
  { key: 'pickup', label: 'To pick up', query: { status: 'new' }, count: (s) => s.toPickUp, empty: 'Nothing waiting to be picked up.' },
  { key: 'mine', label: `My ${noun}s`, query: { mine: true, status: `${DESK_TURN},draft-shared` }, count: (s) => s.mine, empty: `You hold no open ${noun}s.` },
  { key: 'progress', label: 'In progress', query: { status: DESK_TURN }, count: (s) => s.inProgress, empty: `No ${noun} is waiting on the desk.` },
  { key: 'customer', label: 'With customer', query: { status: 'draft-shared' }, count: (s) => s.withCustomer, empty: 'No draft is out with a customer.' },
  { key: 'closed', label: 'Closed', query: { status: 'completed,cancelled' }, count: (s) => s.closed, empty: `No closed ${noun}s yet.` },
];

// `stale` keeps the last page on screen but inert until the newer query answers.
export function useQueue(query, reloadToken) {
  const key = JSON.stringify(query);
  const [state, setState] = useState({ page: null, failed: false, key: null });
  const debounced = Boolean(query.q);
  useEffect(() => {
    let alive = true;
    const run = () => listServiceRequestQueue(JSON.parse(key))
      .then((res) => { if (alive) setState({ page: res, failed: false, key }); })
      .catch(() => { if (alive) setState({ page: null, failed: true, key }); });
    const t = setTimeout(run, debounced ? 300 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [key, reloadToken, debounced]);
  return { ...state, stale: state.key != null && state.key !== key };
}

export function OverdueToggle({ on, count, onToggle }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={classNames('inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors', on ? 'border-rose-400/40 bg-rose-500/15 text-rose-200' : 'border-white/10 text-gray-400 hover:text-white')}
    >
      <Clock className="h-3.5 w-3.5" aria-hidden="true" /> Overdue{count != null ? ` ${fmtNum(count)}` : ''}
    </button>
  );
}
