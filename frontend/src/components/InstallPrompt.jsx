import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from './Icon.jsx';
import { getCookieConsent } from './CookieConsent.jsx';

/* "Add PuneNest to your home screen" — the in-app install nudge.
 *
 * Two mechanisms, because the platforms genuinely differ and no amount of code
 * hides that:
 *   · Chromium (Android Chrome / Samsung Internet / Edge) fires
 *     `beforeinstallprompt`. We stash it and call prompt() from a click, which
 *     opens the browser's own install dialog. That is as automatic as the web
 *     platform allows — prompt() throws outside a user gesture, by design, so a
 *     silent "install on page load" is impossible everywhere.
 *   · iOS/WebKit has no install API at all, in any browser. The only honest
 *     option is to point at Share → Add to Home Screen.
 * Anything else (Firefox Android, desktop) simply never sees this component.
 *
 * Mobile only: `lg:hidden` matches BottomNav's breakpoint, so the nudge lives
 * exactly where a home-screen icon is worth having.
 */

const KEY = 'pn_install_prompt_v1';
const VERSION = 1;
const DAY = 24 * 60 * 60 * 1000;

/* Escalating silence, then permanent. A user who said "not now" twice has
   answered the question; a third ask is nagging, not marketing. Index is the
   dismissal count, so the last entry is also the terminal state. */
const COOLDOWNS = [7 * DAY, 14 * DAY, Infinity];

/* Ask only once someone is actually *using* PuneNest, not on arrival.
   Counted in page views rather than seconds because a timer measures patience,
   not interest — 30s of a stranger reading the hero is not intent, while three
   pages in is someone who came here to look at homes. The count persists, so a
   returning visitor who browsed a page per visit still qualifies; it is the
   accumulated behaviour that earns the ask, not one long session. */
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

/* Already installed: either launched from the home screen (both spellings —
   `navigator.standalone` is the iOS one and predates the media query), or we
   recorded an install earlier in a browser tab. */
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

  /* One view per route. ConsumerLayout owns this component and stays mounted
     across navigations, so client-side route changes and full page loads both
     land here exactly once — except under StrictMode, which deliberately runs
     effects twice to surface exactly this kind of non-idempotent write. The ref
     makes the increment idempotent per path; without it dev counted every view
     twice and the gate opened at half the intended engagement. */
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
    <div className="pn-safe-x fixed inset-x-0 bottom-[var(--pn-bottom-inset)] z-[1350] flex justify-center p-3 lg:hidden pointer-events-none">
      <div
        role="dialog"
        aria-label={t('install.title')}
        className="pointer-events-auto w-full max-w-md rounded-2xl border border-white/10 bg-[#15122a]/95 backdrop-blur-xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.7)] p-3.5"
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500/10 flex items-center justify-center shrink-0">
            <Icon name="home" className="w-5 h-5 text-teal-400" />
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
              className="tap-target flex-1 rounded-xl bg-teal-500 px-4 text-[13px] font-semibold text-[#0f0d1a] hover:bg-teal-400 transition-colors"
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
