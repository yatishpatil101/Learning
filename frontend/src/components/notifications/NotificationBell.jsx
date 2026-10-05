import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import { useNotifications } from '../../context/NotificationContext.jsx';
import { listNotifications, markAllRead, markRead as markOneRead } from '../../services/notificationService.js';
import { useToast } from '../../context/ToastContext.jsx';
import NotificationRow from './NotificationRow.jsx';

const badgeText = (count) => (count > 99 ? '99+' : String(count));

export default function NotificationBell() {
  const { t } = useTranslation();
  const { unread, refresh } = useNotifications();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('loading');
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);

  const label = `Notifications, ${unread} unread`;

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const page = await listNotifications({ page: 0, size: 5 });
      setRows(page.items);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    load();
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => panelRef.current?.focus());
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [load, open]);

  const markAll = async () => {
    const prev = rows;
    setRows((cur) => cur.map((n) => ({ ...n, read: true })));
    try {
      await markAllRead();
    } catch {
      setRows(prev);
      toast("Couldn't update. Try again.", 'error');
    } finally {
      refresh();
    }
  };

  const openRow = async (item) => {
    if (item.read) {
      setOpen(false);
      return true;
    }
    const prev = rows;
    setRows((cur) => cur.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
    try {
      await markOneRead(item.id);
      setOpen(false);
      return true;
    } catch {
      setRows(prev);
      toast("Couldn't update. Try again.", 'error');
      return false;
    } finally {
      refresh();
    }
  };

  return (
    <span ref={rootRef} className="relative inline-flex">
      <Link to="/notifications" className="dz-topbar__action tap-target tap-extend relative inline-flex items-center justify-center rounded-xl p-2 transition-all duration-300 hover:bg-white/5 sm:hidden" title="Notifications" aria-label={label}>
        <Icon name="bell" className="h-5 w-5 text-gray-300 transition-colors" />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-gradient-to-br from-[#f97316] to-[#fb923c] px-1 text-[10px] font-bold text-white shadow-lg shadow-orange-500/30">{badgeText(unread)}</span>}
      </Link>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="dz-topbar__action tap-target tap-extend relative hidden items-center justify-center rounded-xl p-2 transition-all duration-300 hover:bg-white/5 sm:inline-flex"
        title="Notifications"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Icon name="bell" className="h-5 w-5 text-gray-300 transition-colors" />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-gradient-to-br from-[#f97316] to-[#fb923c] px-1 text-[10px] font-bold text-white shadow-lg shadow-orange-500/30">{badgeText(unread)}</span>}
      </button>
      {open && (
        <div
          ref={panelRef}
          tabIndex={-1}
          role="dialog"
          aria-label={t('notifications.title')}
          className="absolute right-0 top-full z-[70] mt-2 hidden w-96 max-w-[calc(100vw-2rem)] rounded-3xl border border-white/10 bg-[#15122a] p-3 shadow-2xl shadow-black/50 outline-none sm:block"
        >
          <div className="mb-2 flex items-center justify-between gap-3 px-1">
            <p className="text-sm font-semibold text-white">{t('notifications.title')}</p>
            {unread > 0 && <button type="button" onClick={markAll} className="min-h-[44px] rounded-xl px-2 text-xs font-semibold text-teal-300 hover:bg-white/5">{t('notifications.markAll')}</button>}
          </div>
          <div className="space-y-2">
            {status === 'loading' && [0, 1, 2].map((n) => <div key={n} className="h-16 animate-pulse rounded-2xl bg-white/[0.04]" />)}
            {status === 'error' && <p className="rounded-2xl bg-white/[0.04] px-3 py-4 text-sm text-gray-400">{t('notifications.loadError')}</p>}
            {status === 'ready' && rows.length === 0 && <p className="rounded-2xl bg-white/[0.04] px-3 py-4 text-sm text-gray-400">{t('notifications.emptyAll')}</p>}
            {status === 'ready' && rows.map((n, i) => (
              <NotificationRow key={n.id} item={{ ...n, ids: [n.id], count: 1 }} onOpen={openRow} swipeable={false} compact delay={i * 0.03} />
            ))}
          </div>
          <Link to="/notifications" onClick={() => setOpen(false)} className="mt-3 flex min-h-[44px] items-center justify-center rounded-2xl border border-white/10 text-sm font-semibold text-teal-300 hover:bg-white/5">
            {t('notifications.seeAll')}
          </Link>
        </div>
      )}
    </span>
  );
}
