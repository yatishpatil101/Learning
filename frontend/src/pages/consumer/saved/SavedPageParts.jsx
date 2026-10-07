import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import useSwipeDismiss from '../../../lib/useSwipeDismiss.js';

const LONG_PRESS_MOVE_TOLERANCE = 10;

export function SwipeCard({ card, onRemove, onAction, className, children }) {
  const swipe = useSwipeDismiss(onRemove, { axis: 'x' });
  const longPress = useRef(null);
  const longPressStart = useRef(null);
  const clearLongPress = () => {
    clearTimeout(longPress.current);
    longPress.current = null;
    longPressStart.current = null;
  };
  const onPointerDown = (e) => {
    swipe.onPointerDown(e);
    if (e.pointerType !== 'mouse') {
      longPressStart.current = { x: e.clientX, y: e.clientY };
      longPress.current = setTimeout(() => onAction(card), 550);
    }
  };
  const onPointerMove = (e) => {
    if (longPress.current && longPressStart.current) {
      const moved = Math.hypot(e.clientX - longPressStart.current.x, e.clientY - longPressStart.current.y);
      if (moved > LONG_PRESS_MOVE_TOLERANCE) clearLongPress();
    }
    swipe.onPointerMove(e);
  };
  const onPointerEnd = (e) => {
    clearLongPress();
    swipe.onPointerUp(e);
  };
  return (
    <div
      data-testid="saved-card"
      className={className}
      style={{ touchAction: 'pan-y' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onContextMenu={(e) => { e.preventDefault(); onAction(card); }}
    >
      {children}
    </div>
  );
}

export function UndoRow({ label, undoLabel, undoAria, onUndo }) {
  const btn = useRef(null);
  useEffect(() => { btn.current?.focus(); }, []);
  return (
    <div role="status" className="property-card sticky top-24 z-20 scroll-mt-24 rounded-2xl overflow-hidden flex items-center justify-between gap-3 p-4">
      <span className="flex items-center gap-2 min-w-0 text-sm text-gray-300">
        <Icon name="trash-2" className="w-4 h-4 flex-shrink-0 text-gray-500" />
        <span className="truncate">{label}</span>
      </span>
      <button
        ref={btn}
        onClick={onUndo}
        aria-label={undoAria}
        className="shrink-0 scroll-mt-24 min-h-[44px] px-4 rounded-xl border border-white/10 text-teal-300 text-sm font-semibold transition-colors"
      >
        {undoLabel}
      </button>
    </div>
  );
}

export function SkeletonRows() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 lg:gap-8" aria-label="Loading saved homes">
      {[0, 1, 2].map((n) => (
        <div key={n} className="property-card flex h-24 animate-pulse gap-3 rounded-2xl p-2 md:block md:h-auto md:p-0">
          <div className="h-20 w-20 rounded-xl bg-white/10 md:h-48 md:w-full md:rounded-none" />
          <div className="flex flex-1 flex-col justify-center gap-2 md:p-5">
            <span className="h-4 w-28 rounded bg-white/10" />
            <span className="h-3 w-40 rounded bg-white/5" />
            <span className="h-3 w-20 rounded bg-white/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function AlertsRow({ searches, status, isIn }) {
  const active = searches.filter((s) => s.alerts !== false).length;
  const fresh = searches.reduce((sum, s) => sum + (Number(s.newCount) || 0), 0);
  if (!isIn && searches.length === 0) return null;
  const sub = status === 'loading'
    ? 'Loading'
    : `${active} active${fresh ? ` · ${fresh} new` : ''}`;
  return (
    <Link to="/dashboard#alerts" className="mb-5 flex min-h-[52px] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 text-left transition">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-500/10 text-amber-300"><Icon name="bell" className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-white">Alerts</span>
        <span className="block text-xs text-gray-400">{status === 'error' ? "Couldn't load alerts" : sub}</span>
      </span>
      <Icon name="chevron-right" className="h-4 w-4 text-gray-500" />
    </Link>
  );
}

export function ActionSheet({ card, onClose, onAlert, onRemove, alerting, createAlertLabel, removeLabel, closeLabel }) {
  if (!card) return null;
  const canAlert = card.cat !== 'flatmates';
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center px-4 pb-[calc(1rem+var(--dz-safe-b))] sm:items-center">
      <button type="button" aria-label={closeLabel} className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="dz-action-sheet relative w-full max-w-sm rounded-3xl border border-white/10 bg-ink-card p-2 shadow-2xl">
        {canAlert && (
          <button type="button" disabled={alerting} onClick={() => onAlert(card)} className="flex min-h-[48px] w-full items-center gap-3 rounded-2xl px-4 text-left text-sm font-semibold text-white disabled:opacity-60">
            <Icon name={alerting ? 'loader-2' : 'bell-plus'} className={'h-4 w-4 text-teal-300' + (alerting ? ' animate-spin' : '')} />
            {createAlertLabel}
          </button>
        )}
        <button type="button" onClick={() => onRemove(card)} className="flex min-h-[48px] w-full items-center gap-3 rounded-2xl px-4 text-left text-sm font-semibold text-rose-200">
          <Icon name="trash-2" className="h-4 w-4" /> {removeLabel}
        </button>
      </div>
    </div>
  );
}
