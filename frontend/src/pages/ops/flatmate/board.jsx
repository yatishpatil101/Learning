/**
 * Scaffolding shared by the three flatmate ops boards.
 *
 * The boards are separate components because they are separate questions — see
 * `flatmateModerationMapper.js` — but they load, fail, empty and tab identically, and three copies
 * of that is three chances for one of them to render a failure as an empty queue. On a moderation
 * desk that is the expensive mistake: "nothing to do" and "the read did not work" look the same and
 * only one of them means you can go home.
 */
import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, ShieldAlert } from 'lucide-react';
import { classNames } from '../../../lib/format.js';
import Loading from '../../../components/ui/Loading.jsx';

/**
 * Rows per page on all three boards.
 *
 * Smaller than the 50-row window these boards shipped with, deliberately. A window is a number you
 * pick to be larger than the backlog you expect; the moment it is not, the queue silently stops at
 * its edge and the desk cannot tell. A page is a number you pick to be comfortable to read, because
 * `total` and the pager say what is behind it.
 */
export const PAGE_SIZE = 25;

/** Epoch ms → the platform's short date. Absent stays visibly absent. */
export const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('en-IN') : '—');

/**
 * Load one page of a queue, with an explicit `error` state.
 *
 * `load` must be a `useCallback` so this effect fires exactly when its inputs really changed —
 * a fresh closure every render would make it fire on every render instead. The `alive` flag is a
 * per-run local rather than a ref, so it cannot be left permanently false by StrictMode's
 * mount → unmount → remount, which is the failure mode that silently swallows every `setState`
 * after an `await`.
 *
 * @param {() => Promise<{items: any[], total: number}>} load
 */
export function useBoard(load) {
  const [state, setState] = useState({ status: 'loading', items: [], total: 0, error: '' });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, status: 'loading', error: '' }));
    load()
      .then((page) => {
        if (alive) setState({ status: 'ready', items: page.items, total: page.total, error: '' });
      })
      .catch((e) => {
        if (alive) {
          setState({
            status: 'error',
            items: [],
            total: 0,
            error: e.message || 'Could not read this queue.',
          });
        }
      });
    return () => { alive = false; };
  }, [load, nonce]);

  return { ...state, reload };
}

/**
 * `useBoard` plus the page number, which the boards should not each re-implement.
 *
 * Two behaviours are the reason this is shared rather than copied three times:
 *
 * 1. **Changing tab returns you to page 1**, and does so *during render* rather than in an effect.
 *    An effect would leave one render — and therefore one fetch — asking the new queue for the old
 *    page, which on a shorter queue answers with nothing and reads as an empty board.
 * 2. **A decision that empties a page steps back to the previous one.** Every action here moves a
 *    row out of the tab it was answered on, so clearing the last item on page 3 of 3 would
 *    otherwise leave a moderator staring at "nothing waiting" with two full pages behind them.
 *
 * @param {(page: number) => Promise<{items: any[], total: number}>} load  must be a `useCallback`
 * @param {string} resetKey  the current tab selection; any change sends the board back to page 1
 */
export function usePagedBoard(load, resetKey) {
  const [nav, setNav] = useState({ key: resetKey, page: 0 });
  const page = nav.key === resetKey ? nav.page : 0;
  const setPage = useCallback((next) => setNav({ key: resetKey, page: Math.max(0, next) }), [resetKey]);

  const paged = useCallback(() => load(page), [load, page]);
  const board = useBoard(paged);

  const { status, items } = board;
  useEffect(() => {
    if (status === 'ready' && page > 0 && !items.length) setPage(page - 1);
  }, [status, items.length, page, setPage]);

  return { ...board, page, setPage };
}

/**
 * Previous / next over a server-side page, with the range stated in words.
 *
 * Renders nothing when everything fits on one page — a pager under a five-row queue is noise that
 * implies there is more to see. The range is spelled out rather than shown as page numbers because
 * these queues shrink as they are worked: "page 3 of 7" is a claim that goes stale between two
 * decisions, whereas "26–50 of 61" is true of the rows on the screen when it was drawn.
 */
export function Pager({ page, size, total, onChange }) {
  if (total <= size) return null;
  const first = page * size + 1;
  const last = Math.min(total, (page + 1) * size);
  const isLast = last >= total;
  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-sm text-gray-400">
      <span role="status">{first}–{last} of {total}</span>
      <div className="flex gap-1">
        <button
          type="button"
          disabled={page === 0}
          onClick={() => onChange(page - 1)}
          className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-gray-300 hover:bg-white/5 disabled:opacity-40"
        >
          <ChevronLeft className="h-3.5 w-3.5" />Previous
        </button>
        <button
          type="button"
          disabled={isLast}
          onClick={() => onChange(page + 1)}
          className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-gray-300 hover:bg-white/5 disabled:opacity-40"
        >
          Next<ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/** A tab strip whose accessible names are the labels alone — no live counts baked into them. */
export function Tabs({ tabs, active, onChange, label }) {
  return (
    <div role="group" aria-label={label} className="mb-4 flex flex-wrap gap-1 rounded-xl border border-white/10 bg-white/5 p-1 w-full sm:w-max">
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

/**
 * Render whichever of loading / failed / empty applies, or `null` to say "draw your rows".
 *
 * Returning `null` rather than a boolean keeps the call site a single expression, and means a board
 * cannot accidentally render its table *and* a failure panel at once.
 */
export function BoardState({ state, onRetry, empty }) {
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

/**
 * The queue's own size, stated in words rather than as a tile.
 *
 * Every tab here filters **server-side**, so `total` is the size of the real queue rather than of
 * the window this page happens to hold. The counts the old page showed on four tiles could only be
 * restored by fetching four queues to draw one, and a number that costs three extra reads and is
 * stale the moment a colleague decides something is not worth it.
 */
export function BoardCount({ total, singular, plural }) {
  return (
    <p role="status" className="mb-3 text-sm text-gray-400">
      {total} {total === 1 ? singular : plural}
    </p>
  );
}

/**
 * The inline text box behind a decision that wants words.
 *
 * Two callers, two meanings, and the difference is `required`: a verification rejection is refused
 * by the server (and by the database) without a reason, because a host told "no" without being told
 * why cannot fix anything. A moderation note is optional and never leaves the audit row.
 */
export function InlineNote({ value, onChange, onConfirm, onCancel, placeholder, confirmLabel }) {
  return (
    <div className="flex w-56 flex-col gap-1.5">
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-gray-200"
      />
      <div className="flex gap-1">
        <button type="button" onClick={onConfirm} className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-2 py-1 text-xs text-rose-300">
          {confirmLabel}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-white/10 px-2 py-1 text-xs text-gray-300 hover:bg-white/5">
          Cancel
        </button>
      </div>
    </div>
  );
}
