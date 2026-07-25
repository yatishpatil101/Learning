import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, XCircle, ToggleRight, X } from 'lucide-react';

const ToastContext = createContext(null);
let nextId = 0;

const TOAST_CONFIG = {
  success: {
    icon: CheckCircle2,
    containerCls: 'border-emerald-500/25 bg-gradient-to-r from-emerald-500/[0.08] to-transparent',
    iconCls: 'text-emerald-400',
    textCls: 'text-emerald-100',
  },
  error: {
    icon: XCircle,
    containerCls: 'border-rose-500/25 bg-gradient-to-r from-rose-500/[0.08] to-transparent',
    iconCls: 'text-rose-400',
    textCls: 'text-rose-100',
  },
  warning: {
    icon: AlertCircle,
    containerCls: 'border-amber-500/25 bg-gradient-to-r from-amber-500/[0.08] to-transparent',
    iconCls: 'text-amber-400',
    textCls: 'text-amber-100',
  },
  info: {
    icon: Info,
    containerCls: 'border-sky-500/20 bg-gradient-to-r from-sky-500/[0.06] to-transparent',
    iconCls: 'text-sky-400',
    textCls: 'text-gray-100',
  },
  toggle: {
    icon: ToggleRight,
    containerCls: 'border-brand-teal/25 bg-gradient-to-r from-brand-teal/[0.08] to-transparent',
    iconCls: 'text-brand-teal',
    textCls: 'text-gray-100',
  },
};

function Toast({ toast: t, onDismiss }) {
  const config = TOAST_CONFIG[t.type] || TOAST_CONFIG.info;
  const Icon = config.icon;

  return (
    <div
      className={`
        flex items-center gap-3 rounded-2xl border px-4 py-3 shadow-2xl shadow-black/30
        backdrop-blur-xl bg-ink-2/90 min-w-[280px] max-w-[420px]
        animate-slideIn ${config.containerCls}
      `}
      role="alert"
    >
      <span className={`shrink-0 ${config.iconCls}`}>
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className={`flex-1 text-sm font-medium leading-snug ${config.textCls}`}>
        {t.message}
      </span>
      <button
        onClick={() => onDismiss(t.id)}
        className="shrink-0 rounded-lg p-1 text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-colors"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);
  const toast = useCallback(
    (message, type = 'info') => {
      const id = ++nextId;
      setToasts((t) => [...t, { id, message, type }]);
      timers.current.set(id, setTimeout(() => dismiss(id), 3500));
    },
    [dismiss],
  );

  // Clear any pending auto-dismiss timers on unmount so they don't fire after teardown.
  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Toast container. Sits in the top z-band (above the Nestor FAB at z-1300
          and the lightbox/modals at z-1500) so confirmations are never hidden,
          and is lifted to bottom-24 so the stack floats ABOVE the bottom-right
          Ask-Nestor button instead of behind/over it. */}
      <div className="fixed bottom-24 right-5 z-[1600] flex flex-col-reverse gap-2.5 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <Toast toast={t} onDismiss={dismiss} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
