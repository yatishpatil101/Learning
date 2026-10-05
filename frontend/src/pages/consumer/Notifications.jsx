import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import NotificationRow from '../../components/notifications/NotificationRow.jsx';
import {
  collapseNotifications,
  FILTERS,
  hasUnreadInFilter,
  isToday,
  matchesNotificationFilter,
} from '../../components/notifications/notificationModel.js';
import { useScrollReveal } from '../../lib/useScrollReveal.js';
import usePullToRefresh from '../../lib/usePullToRefresh.js';
import { useNotifications } from '../../context/NotificationContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import {
  dismiss as dismissOne,
  listNotifications,
  markAllRead,
  markRead as markOneRead,
} from '../../services/notificationService.js';

const PAGE_SIZE = 50;
const UNDO_MS = 5000;

// Saved-search match counts are the seam's answer, carried on the record as `matchCount`.

// Only navigate to in-app relative paths; notification links can arrive from server data.
function SkeletonRows() {
  return (
    <div className="space-y-3">
      {[0, 1, 2, 3].map((n) => <div key={n} className="h-16 animate-pulse rounded-2xl bg-white/[0.04]" />)}
    </div>
  );
}

export default function Notifications() {
  /* The inbox is whatever the seam returns. */
  const { t } = useTranslation();
  const { toast } = useToast();
  const { unread, refresh: refreshBadge } = useNotifications();
  const [notifs, setNotifs] = useState([]);
  const [filter, setFilter] = useState('all');
  // Derived (client-side) notifications, computed from the user's own saved searches and saved properties. Held
  // separately from the list so a re-derivation cannot duplicate server rows.
  const [status, setStatus] = useState('loading');
  const [pageInfo, setPageInfo] = useState({ page: 0, total: 0, totalPages: 0 });
  const [undo, setUndo] = useState(null);
  const undoTimer = useRef(null);
  const undoRef = useRef(null);
  const dismissPendingRef = useRef(null);
  const rootRef = useScrollReveal([filter, notifs.length]);

    // An unreachable inbox renders empty rather than throwing the page away. The bell already
    // shows nothing in that case, so the two agree.
  /* Read the inbox: server rows merged with whatever has been derived. */
  const loadPage = useCallback(async (page = 0) => {
    setStatus('loading');
    try {
      const next = await listNotifications({ page, size: PAGE_SIZE });
      setNotifs((cur) => (page === 0
        ? next.items
        : [...new Map([...cur, ...next.items].map((n) => [n.id, n])).values()]));
      setPageInfo({ page: next.page, total: next.total, totalPages: next.totalPages });
      setStatus('ready');
      refreshBadge();
    } catch {
      setStatus('error');
    }
  }, [refreshBadge]);
  /* Re-runs whenever `derived` changes, which is how the two halves converge — the first pass shows the stored inbox,
     and the alert pass adds to it once the saved searches and shortlist land. */

  useEffect(() => {
    loadPage(0);
  }, [loadPage]);

  /* Pull down from the top of the inbox to re-read it. */
  dismissPendingRef.current = (entry) => {
    void Promise.all(entry.ids.map((id) => dismissOne(id))).finally(refreshBadge);
  };

    /* Respect the user's settings: the master "New match alerts" switch and quiet hours both suppress the
       non-critical live match/price notifications. */
  useEffect(() => () => {
    clearTimeout(undoTimer.current);
    if (undoRef.current) dismissPendingRef.current?.(undoRef.current);
  }, []);

  const ptr = usePullToRefresh(useCallback(() => loadPage(0), [loadPage]));

  const visible = useMemo(() => {
    const filtered = notifs.filter((n) => matchesNotificationFilter(n, filter));
    return collapseNotifications(filtered);
  }, [filter, notifs]);

        /* The match count comes off the saved search itself, counted by the server. */
  const groups = useMemo(() => {
    const today = visible.filter((n) => isToday(n.at));
    const earlier = visible.filter((n) => !isToday(n.at));
    return [['today', today], ['earlier', earlier]].filter(([, rows]) => rows.length);
  }, [visible]);

    // Both lists arrive asynchronously now, so this has to re-run once they land — on the first pass they are still
    // empty and the match/availability nudges would be skipped for everyone.
  const mutate = async (apply, request) => {
    const prev = notifs;
    setNotifs(apply);
    try {
      await request();
      return true;
    } catch {
      setNotifs(prev);
      toast("Couldn't update. Try again.", 'error');
      return false;
    } finally {
      refreshBadge();
    }
  };

  const idsFor = (item) => item.ids || [item.id];

  const markAll = () => mutate(
    (cur) => cur.map((n) => (n.read ? n : { ...n, read: true })),
    markAllRead,
  );

  /* Every mutation is optimistic, then reconciled. */
  const markRead = (item) => {
    const ids = idsFor(item);
    if (ids.every((id) => notifs.find((n) => n.id === id)?.read)) return Promise.resolve(true);
    return mutate(
      (cur) => cur.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)),
      () => markOneRead(ids),
    );
  };

  const dismissNow = (item) => {
    const ids = idsFor(item);
    return mutate(
      (cur) => cur.filter((n) => !ids.includes(n.id)),
      () => Promise.all(ids.map((id) => dismissOne(id))),
    );
  };

  // Localise a notification at render time. Known seeds resolve by id; live match/price items resolve from their
  // stored `key` + `vars`; anything else falls back to its stored (English) title/desc.
  const commitUndo = useCallback(async (entry) => {
    if (!entry) return;
    try {
      await Promise.all(entry.ids.map((id) => dismissOne(id)));
    } catch {
      setNotifs((cur) => [...entry.rows, ...cur].sort((a, b) => (b.at || 0) - (a.at || 0)));
      toast("Couldn't update. Try again.", 'error');
    } finally {
      refreshBadge();
      if (undoRef.current === entry) {
        undoRef.current = null;
        setUndo(null);
      }
    }
  }, [refreshBadge, toast]);

  const swipeClear = (item) => {
    clearTimeout(undoTimer.current);
    if (undoRef.current) commitUndo(undoRef.current);
    const ids = idsFor(item);
    const rows = notifs.filter((n) => ids.includes(n.id));
    const entry = { ids, rows };
    undoRef.current = entry;
    setNotifs((cur) => cur.filter((n) => !ids.includes(n.id)));
    setUndo(entry);
    undoTimer.current = setTimeout(() => commitUndo(entry), UNDO_MS);
  };

  const undoClear = () => {
    const entry = undoRef.current;
    clearTimeout(undoTimer.current);
    if (!entry) return;
    setNotifs((cur) => [...entry.rows, ...cur].sort((a, b) => (b.at || 0) - (a.at || 0)));
    undoRef.current = null;
    setUndo(null);
  };

  const hasMore = notifs.length < pageInfo.total;
  const emptyKey = filter === 'all' ? 'notifications.emptyAll' : filter === 'leads' ? 'notifications.emptyLeads' : 'notifications.emptyUpdates';

  let delay = 0;

  return (
    <div ref={ptr.ref} className="min-h-[100dvh] pb-20 pt-5 sm:pt-8 lg:pt-10">
      {(ptr.pullDistance > 0 || ptr.isRefreshing) && (
        <div
          aria-hidden="true"
          className="glass-strong pointer-events-none fixed left-1/2 z-40 grid h-9 w-9 -translate-x-1/2 place-items-center rounded-full"
          style={{ top: `calc(var(--dz-nav-h) + ${Math.round(ptr.pullDistance)}px)`, opacity: 0.4 + ptr.progress * 0.6 }}
        >
          <Icon
            name={ptr.isRefreshing ? 'loader-2' : 'chevron-down'}
            className={'h-4 w-4 text-teal-400' + (ptr.isRefreshing ? ' animate-spin' : '')}
            style={ptr.isRefreshing ? undefined : { transform: `rotate(${ptr.progress * 180}deg)` }}
          />
        </div>
      )}

      <div ref={rootRef} className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <div className="mb-5 flex items-center justify-between gap-4 reveal sm:mb-6">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-white sm:text-3xl">{t('notifications.title')}</h1>
            <p className="mt-1 text-sm text-gray-400"><span className="font-semibold text-teal-400">{unread}</span> {t('notifications.unread')}</p>
          </div>
          <div className="flex items-center gap-2">
            {unread > 0 && (
              <button type="button" onClick={markAll} className="min-h-[44px] rounded-xl px-2 text-sm font-semibold text-teal-300 hover:bg-white/5">
                {t('notifications.markAll')}
              </button>
            )}
            <Link to="/dashboard#profile" aria-label={t('notifications.manage')} className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 text-gray-400 hover:border-teal-400/30 hover:text-teal-300">
              <Icon name="user-cog" className="h-5 w-5" />
            </Link>
          </div>
        </div>

        <div className="mb-5 grid grid-cols-3 gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={'seg relative min-h-[44px] justify-center text-xs font-semibold text-gray-300' + (filter === f.key ? ' active' : '')}
            >
              {t(f.labelKey)}
              {hasUnreadInFilter(notifs, f.key) && <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-teal-400" aria-hidden="true" />}
            </button>
          ))}
        </div>

        {status === 'error' && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-rose-400/20 bg-rose-500/[0.06] px-4 py-3 text-sm text-rose-100">
            <span>{t('notifications.loadError')}</span>
            <button type="button" onClick={() => loadPage(0)} className="min-h-[44px] rounded-xl px-3 font-semibold text-white hover:bg-white/5">{t('notifications.retry')}</button>
          </div>
        )}

        {status === 'loading' && notifs.length === 0 ? <SkeletonRows /> : null}

        {groups.length ? groups.map(([gid, rows]) => (
          <section key={gid} className="mb-6">
            <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-gray-500 reveal">{gid === 'today' ? t('notifications.today') : t('notifications.earlier')}</h2>
            <div className="space-y-3">
              {rows.map((n) => {
                const rowDelay = delay;
                delay += 0.04;
                return (
                  <NotificationRow
                    key={`${n.type}-${n.link}-${n.id}`}
                    item={n}
                    onOpen={markRead}
                    onMarkRead={markRead}
                    onDismiss={dismissNow}
                    onSwipeClear={swipeClear}
                    swipeable
                    delay={rowDelay}
                  />
                );
              })}
            </div>
          </section>
        )) : null}

        {status === 'ready' && !groups.length && (
          <div className="py-16 text-center text-sm text-gray-500">
            {t(emptyKey)}
          </div>
        )}

        {/* Notification preferences link */}
        {hasMore && (
          <div className="mt-5 text-center">
            <button type="button" onClick={() => loadPage(pageInfo.page + 1)} className="min-h-[44px] rounded-xl border border-white/10 px-4 text-sm font-semibold text-teal-300 hover:bg-white/5">
              {t('notifications.showOlder')}
            </button>
          </div>
        )}
      </div>

      {undo && (
        <div role="status" className="fixed inset-x-4 bottom-[calc(1rem+var(--dz-safe-b))] z-[1600] mx-auto flex max-w-sm items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#15122a] px-4 py-3 shadow-2xl shadow-black/40">
          <span className="text-sm text-gray-200">{t('notifications.cleared')}</span>
          <button type="button" onClick={undoClear} className="min-h-[44px] rounded-xl px-3 text-sm font-semibold text-teal-300 hover:bg-white/5">{t('notifications.undo')}</button>
        </div>
      )}
    </div>
  );
}
