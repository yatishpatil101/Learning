import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import useSwipeDismiss from '../../lib/useSwipeDismiss.js';
import {
  notificationTitle,
  relativeNotificationTime,
  safeNotificationLink,
  TYPE_META,
} from './notificationModel.js';

const LONG_PRESS_MS = 520;

export default function NotificationRow({
  item,
  onOpen,
  onDismiss,
  onSwipeClear,
  onMarkRead,
  swipeable = false,
  compact = false,
  delay = 0,
}) {
  const { t } = useTranslation();
  const [sheetOpen, setSheetOpen] = useState(false);
  const timer = useRef(null);
  const href = safeNotificationLink(item.link);
  const meta = TYPE_META[item.type] || TYPE_META.system;
  const title = notificationTitle(item);
  const context = item.desc || '';
  const swipe = useSwipeDismiss(() => onSwipeClear?.(item), { axis: 'x' });

  useEffect(() => () => clearTimeout(timer.current), []);

  const clearLongPress = () => {
    clearTimeout(timer.current);
    timer.current = null;
  };

  const pressHandlers = swipeable ? {
    onPointerDown: (e) => {
      if (e.target?.closest?.('button')) return;
      swipe.onPointerDown(e);
      if (e.pointerType === 'mouse') return;
      clearLongPress();
      timer.current = setTimeout(() => setSheetOpen(true), LONG_PRESS_MS);
    },
    onPointerMove: (e) => {
      clearLongPress();
      swipe.onPointerMove(e);
    },
    onPointerUp: (e) => {
      clearLongPress();
      swipe.onPointerUp(e);
    },
    onPointerCancel: (e) => {
      clearLongPress();
      swipe.onPointerCancel(e);
    },
  } : {};

  const open = () => {
    void onOpen?.(item);
  };

  const markRead = () => {
    setSheetOpen(false);
    onMarkRead?.(item);
  };

  const dismiss = () => {
    setSheetOpen(false);
    onDismiss?.(item);
  };

  return (
    <>
      <div
        {...pressHandlers}
        data-id={item.id}
        className={`notif rounded-2xl flex items-stretch reveal${item.read ? '' : ' unread'}`}
        style={{ animationDelay: `${delay}s`, touchAction: swipeable ? 'pan-y' : undefined }}
      >
        <Link to={href} onClick={open} className={`min-w-0 flex-1 flex items-center gap-3 ${compact ? 'px-3 py-2.5' : 'px-3.5 py-3'}`}>
          <span className={`grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl ${meta.bgCls}`}>
            <Icon name={meta.icon} className={`h-5 w-5 ${meta.iconCls}`} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className={`truncate text-sm ${item.read ? 'font-medium text-gray-200' : 'font-semibold text-white'}`}>{title}</span>
              {!item.read && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-teal-400" aria-hidden="true" />}
            </span>
            <span className="flex min-w-0 gap-1.5 text-xs text-gray-400">
              {context ? <span className="truncate" aria-label={context}>{context}</span> : null}
              <span className="flex-shrink-0 text-gray-500">{context ? '· ' : ''}{relativeNotificationTime(item.at, t)}</span>
            </span>
          </span>
        </Link>
        {onDismiss && (
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            title="Dismiss"
            className="grid min-h-[44px] w-11 flex-shrink-0 place-items-center rounded-r-2xl text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        )}
      </div>
      {sheetOpen && (
        <div className="fixed inset-0 z-[1700] flex items-end px-4 pb-[calc(1rem+var(--dz-safe-b))] pt-20 sm:hidden">
          <button type="button" aria-label="Close notification actions" className="absolute inset-0 bg-black/40" onClick={() => setSheetOpen(false)} />
          <div className="dz-action-sheet relative mx-auto mt-auto max-w-sm rounded-3xl border border-white/10 bg-[#15122a] p-2 shadow-2xl shadow-black/50">
            {!item.read && (
              <button type="button" onClick={markRead} className="flex min-h-[44px] w-full items-center gap-3 rounded-2xl px-4 text-left text-sm font-semibold text-gray-100 hover:bg-white/5">
                <Icon name="check-check" className="h-4 w-4 text-teal-300" /> {t('notifications.markRead')}
              </button>
            )}
            {onDismiss && (
              <button type="button" onClick={dismiss} className="flex min-h-[44px] w-full items-center gap-3 rounded-2xl px-4 text-left text-sm font-semibold text-rose-200 hover:bg-white/5">
                <Icon name="trash-2" className="h-4 w-4" /> {t('notifications.clear')}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
