import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from './Icon.jsx';
import LogoMark from './brand/LogoMark.jsx';
import { getCookieConsent } from './CookieConsent.jsx';

/* Chromium: stash beforeinstallprompt and call prompt() from a click (it throws outside a gesture). iOS/WebKit has
   no install API, so we can only point at Share → Add to Home Screen. */

const KEY = 'dz_install_prompt_v1';
const VERSION = 1;
const DAY = 24 * 60 * 60 * 1000;

/* Index is the dismissal count: two 'not now' answers settle it, so the last entry is terminal. */
const COOLDOWNS = [7 * DAY, 14 * DAY, Infinity];

/* Page views, not seconds: a timer measures patience, not interest, and the count persists across visits. */
const MIN_VIEWS = 3;

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    if (v && v.version === VERSION) return v;
  } catch { /* ignore */ }
  return { dismissals: 0, lastDismissAt: 0, installed: false, views: 0 };
}

function write(value) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...value, version: VERSION }));
  } catch { /* ignore */ }
}

/* `navigator.standalone` is the iOS spelling of standalone mode and predates the media query. */
function isInstalled(state) {
  if (state.installed) return true;
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

function isSilenced(state) {
  const wait = COOLDOWNS[Math.min(state.dismissals, COOLDOWNS.length) - 1];
  if (state.dismissals === 0) return false;
  return wait === Infinity || Date.now() - state.lastDismissAt < wait;
}

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

export default function InstallPrompt() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [deferred, setDeferred] = useState(null);
  const [engaged, setEngaged] = useState(false);
  const [gone, setGone] = useState(false);
  // The consent bar is legally required and owns the bottom of the screen while
  // it is up; two stacked bars would bury it. Same event the assistant listens to.
  const [cookieBar, setCookieBar] = useState(() => !getCookieConsent());

  useEffect(() => {
    const state = read();
    if (isInstalled(state) || isSilenced(state)) { setGone(true); return undefined; }

    const onBeforeInstall = (e) => {
      // Suppress Chrome's own mini-infobar so the user gets one ask, not two.
      e.preventDefault();
      setDeferred(e);
    };
    // Fires however the app was installed, including from the browser menu —
    // so the nudge disappears even when it wasn't the thing that converted.
    const onInstalled = () => { write({ ...read(), installed: true }); setGone(true); };
    const onCookieBar = (e) => setCookieBar(!!e.detail?.visible);

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener('pn:cookie-banner', onCookieBar);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener('pn:cookie-banner', onCookieBar);
    };
  }, []);

  /* The ref makes the per-path increment idempotent: StrictMode runs effects twice and would double-count. */
  const counted = useRef(null);
  useEffect(() => {
    if (counted.current === pathname) return;
    counted.current = pathname;
    const state = read();
    const views = (state.views || 0) + 1;
    write({ ...state, views });
    if (views >= MIN_VIEWS) setEngaged(true);
  }, [pathname]);

  const dismiss = () => {
    const state = read();
    write({ ...state, dismissals: state.dismissals + 1, lastDismissAt: Date.now() });
    setGone(true);
  };

  const install = async () => {
    if (!deferred) return;
    // Must be called synchronously from the click — awaiting first would lose
    // the user gesture and the call would be rejected.
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    // The event is single-use whatever the answer. A decline is a dismissal, so
    // the same escalating cooldown applies and we don't re-ask next session.
    setDeferred(null);
    if (outcome === 'accepted') write({ ...read(), installed: true });
    else dismiss();
    setGone(true);
  };

  const ios = typeof navigator !== 'undefined' && isIOS();
  if (gone || cookieBar || !engaged || (!deferred && !ios)) return null;

  return (
    <div className="dz-safe-x fixed inset-x-0 bottom-[var(--dz-bottom-inset)] z-[1350] flex justify-center p-3 lg:hidden pointer-events-none">
      <div
        role="dialog"
        aria-label={t('install.title')}
        className="pointer-events-auto w-full max-w-md rounded-2xl border border-white/10 bg-ink-card/95 backdrop-blur-xl shadow-[0_20px_60px_-15px_rgb(var(--dz-c-black)/0.7)] p-3.5"
      >
        <div className="flex items-start gap-3">
          {/* Tinted tile kept (unlike the navbar): this row previews the
              rounded-square home-screen icon the user is about to install. */}
          <div className="w-10 h-10 rounded-xl bg-teal-500/10 flex items-center justify-center shrink-0">
            <LogoMark className="w-6 h-6 text-teal-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-white leading-snug">{t('install.title')}</p>
            <p className="mt-1 text-[12.5px] leading-snug text-gray-300">
              {ios ? t('install.iosBody') : t('install.body')}
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label={t('install.dismiss')}
            className="tap-target inline-flex items-center justify-center -mt-1 -mr-1 text-gray-400 hover:text-white shrink-0"
          >
            <Icon name="x" className="w-4 h-4" />
          </button>
        </div>

        {/* iOS gets no button: there is nothing to call. The copy above is the
            whole instruction, so a CTA would be a dead control. */}
        {!ios && (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={install}
              className="tap-target flex-1 rounded-xl bg-teal-500 px-4 text-[13px] font-semibold text-ink hover:bg-teal-400 transition-colors"
            >
              {t('install.cta')}
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="tap-target rounded-xl border border-white/10 px-4 text-[13px] font-medium text-gray-300 hover:text-white hover:border-white/20 transition-colors"
            >
              {t('install.later')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
