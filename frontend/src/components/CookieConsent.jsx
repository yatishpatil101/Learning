import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import Icon from './Icon.jsx';
import Switch from './ui/Switch.jsx';

/* DPDPA-aligned cookie consent.
   Strictly-necessary cookies need no consent; functional, analytics, and marketing
   are opt-in and only recorded here. Choices persist in localStorage and can be
   reopened at any time (consent is as easy to withdraw as to give) by dispatching
   the `pn:open-cookie-preferences` event — the footer link does exactly that. */

const KEY = 'pn_cookie_consent_v1';
const VERSION = 1;

export function getCookieConsent() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    if (v && v.version === VERSION) return v;
  } catch { /* ignore */ }
  return null;
}

const CATEGORIES = [
  ['functional', 'Functional', 'Remembers preferences like language, recently viewed properties, and saved searches.'],
  ['analytics', 'Analytics', 'Aggregated, non-identifying usage stats that help us improve the platform.'],
  ['marketing', 'Marketing', 'Used for retargeting and measuring the effectiveness of our campaigns.'],
];

export default function CookieConsent() {
  const [mode, setMode] = useState('hidden'); // hidden | banner | customize
  const [prefs, setPrefs] = useState({ functional: false, analytics: false, marketing: false });
  const panelRef = useRef(null);

  useEffect(() => {
    if (!getCookieConsent()) setMode('banner');
    const open = () => {
      const c = getCookieConsent();
      if (c) setPrefs({ functional: !!c.functional, analytics: !!c.analytics, marketing: !!c.marketing });
      setMode('customize');
    };
    window.addEventListener('pn:open-cookie-preferences', open);
    return () => window.removeEventListener('pn:open-cookie-preferences', open);
  }, []);

  // Let other bottom-anchored widgets (e.g. the Nestor FAB) step aside while the
  // consent UI is on screen, so nothing overlaps the choose-cookies actions.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('pn:cookie-banner', { detail: { visible: mode !== 'hidden' } }));
  }, [mode]);

  useEffect(() => {
    const root = document.documentElement;
    if (mode === 'hidden' || !panelRef.current) {
      root.style.setProperty('--pn-cookie-banner-h', '0px');
      return undefined;
    }

    const syncHeight = () => {
      const box = panelRef.current?.getBoundingClientRect();
      root.style.setProperty('--pn-cookie-banner-h', `${Math.ceil(box?.height || 0)}px`);
    };

    syncHeight();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(syncHeight) : null;
    observer?.observe(panelRef.current);
    window.addEventListener('resize', syncHeight);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', syncHeight);
      root.style.setProperty('--pn-cookie-banner-h', '0px');
    };
  }, [mode]);

  const persist = (value) => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ necessary: true, ...value, version: VERSION, ts: Date.now() }));
    } catch { /* ignore */ }
    setMode('hidden');
  };

  const acceptAll = () => persist({ functional: true, analytics: true, marketing: true });
  const rejectNonEssential = () => persist({ functional: false, analytics: false, marketing: false });
  const savePrefs = () => persist(prefs);

  if (mode === 'hidden') return null;

  return (
    <div className="pn-safe-x fixed inset-x-0 bottom-[var(--pn-bottom-inset)] z-[1400] flex justify-center p-3 sm:p-4 pointer-events-none">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-label="Cookie preferences"
        className="pointer-events-auto w-full max-w-4xl rounded-2xl border border-white/10 bg-[#15122a]/95 backdrop-blur-xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.7)] overflow-hidden"
      >
        {mode === 'banner' ? (
          /* ── Sleek landscape bar: message left, actions right ── */
          <div className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:gap-5 sm:py-3 sm:pl-4 sm:pr-3">
            <div className="flex items-center gap-3 min-w-0 sm:flex-1">
              <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center shrink-0">
                <Icon name="shield-check" className="w-4 h-4 text-teal-400" />
              </div>
              <p className="text-[13px] leading-snug text-gray-300 min-w-0">
                <span className="font-semibold text-white">Your privacy choices — </span>
                we use essential cookies to run PuneNest and, with your consent, functional, analytics &amp; marketing
                cookies to improve it.{' '}
                <Link to="/privacy" className="text-teal-400 hover:underline whitespace-nowrap">Privacy Policy</Link>
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center shrink-0">
              <button
                type="button"
                onClick={rejectNonEssential}
                className="order-3 sm:order-1 rounded-lg px-3.5 py-2 text-[13px] font-semibold text-gray-300 hover:text-white hover:bg-white/5 transition-colors whitespace-nowrap"
              >
                Reject non-essential
              </button>
              <button
                type="button"
                onClick={() => setMode('customize')}
                className="order-2 sm:order-2 rounded-lg border border-white/15 px-3.5 py-2 text-[13px] font-semibold text-gray-200 hover:bg-white/5 transition-colors whitespace-nowrap"
              >
                Customize
              </button>
              <button
                type="button"
                onClick={acceptAll}
                className="order-1 col-span-2 sm:order-3 sm:col-span-1 rounded-lg bg-teal-500 px-4 py-2 text-[13px] font-semibold text-white hover:bg-teal-400 transition-colors whitespace-nowrap"
              >
                Accept all
              </button>
            </div>
          </div>
        ) : (
          /* ── Customize: compact toggle grid, still landscape ── */
          <div className="p-4 sm:p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center shrink-0">
                <Icon name="shield-check" className="w-4 h-4 text-teal-400" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-white leading-tight">Your privacy choices</h2>
                <p className="text-xs text-gray-400 leading-snug">
                  Choose which cookies we may use. See our{' '}
                  <Link to="/privacy" className="text-teal-400 hover:underline">Privacy Policy</Link>.
                </p>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 mb-4">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-white">Strictly necessary</p>
                  <p className="text-[11px] text-gray-500 leading-snug">Security &amp; core features. Always on.</p>
                </div>
                <Switch checked disabled onChange={() => {}} label="Strictly necessary cookies (always on)" />
              </div>
              {CATEGORIES.map(([key, label, desc]) => (
                <div key={key} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-white">{label}</p>
                    <p className="text-[11px] text-gray-500 leading-snug">{desc}</p>
                  </div>
                  <Switch
                    checked={prefs[key]}
                    onChange={(v) => setPrefs((p) => ({ ...p, [key]: v }))}
                    label={`${label} cookies`}
                  />
                </div>
              ))}
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={rejectNonEssential}
                className="rounded-lg px-3.5 py-2 text-[13px] font-semibold text-gray-300 hover:text-white hover:bg-white/5 transition-colors whitespace-nowrap sm:mr-auto"
              >
                Reject non-essential
              </button>
              <button
                type="button"
                onClick={acceptAll}
                className="rounded-lg border border-white/15 px-3.5 py-2 text-[13px] font-semibold text-gray-200 hover:bg-white/5 transition-colors whitespace-nowrap"
              >
                Accept all
              </button>
              <button
                type="button"
                onClick={savePrefs}
                className="rounded-lg bg-teal-500 px-4 py-2 text-[13px] font-semibold text-white hover:bg-teal-400 transition-colors whitespace-nowrap"
              >
                Save preferences
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
