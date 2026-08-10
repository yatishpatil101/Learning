import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from './Icon.jsx';
import { useConnectivity } from '../hooks/useConnectivity.js';

/** How long the "back online" confirmation stays up. Long enough to read, short enough that it
 *  never becomes chrome — a banner that appears and never leaves is worse than none. */
const RECOVERY_MS = 4000;

/* App-wide connectivity banner, mounted once per layout — ConsumerLayout and AdminLayout (D164).
 *
 * Three states, and the wording is the whole point:
 *   offline      the OS says no interface is up — a confident statement, because it is.
 *   unreachable  requests are not reaching the server while the OS says we are online. Hedged
 *                copy, because `navigator.onLine` cannot tell a captive portal from a good
 *                connection. It never claims the user is offline.
 *   restored     a transient confirmation, so a recovered connection is announced rather than
 *                leaving the user to guess whether it is safe to retry.
 * A server error (500/404/422) reaches none of these — see `hooks/useConnectivity.js`.
 *
 * Docked to the TOP, under the navbar, and that is a structural decision rather than a promise:
 * the bottom of a phone viewport already carries the floating tab bar with its raised centre FAB
 * plus four other fixed widgets (city pill 1200, assistant 1300, install prompt 1350, cookie
 * consent 1400), all anchored to --pn-bottom-inset. A sixth one there would sit on top of at least
 * one of them at 360px. From --pn-top-inset this banner is geometrically incapable of covering the
 * bottom nav or the FAB, and it rides the hide-on-scroll navbar for free (the token drops to 0
 * when the bar slides away), so it never strands content behind a fixed strip.
 *
 * The live region is always mounted and empty when there is nothing to say. Inserting the region
 * and its text in the same tick is how announcements get missed — several screen readers only
 * watch regions that were present when they built their model of the page.
 *
 * `zClass` exists for exactly one caller: the maintenance overlay, which is `z-[99999]` because it
 * must bury the whole app. A banner underneath it would be invisible on the one screen most likely
 * to be looked at during an incident, and the alternative — raising this to 100000 for everyone —
 * would float it over open modals (D164). */
export default function ConnectivityBanner({ zClass = 'z-[1450]' }) {
  const { t } = useTranslation();
  const { status } = useConnectivity();
  const [restored, setRestored] = useState(false);
  const prev = useRef(status);

  useEffect(() => {
    const was = prev.current;
    prev.current = status;
    // Dropping again inside the confirmation window retracts it — the last thing the user should
    // read while offline is "back online".
    if (status !== 'online') setRestored(false);
    else if (was !== 'online') setRestored(true);
  }, [status]);

  /* The dismissal timer is keyed on `restored`, not on the transition that set it. Owning it in the
     effect above would leak under StrictMode: the double-invoke clears the timer on the discarded
     pass and the second pass sees `prev.current` already updated, so it never sets a new one and
     the confirmation stays up for good. */
  useEffect(() => {
    if (!restored) return undefined;
    const id = setTimeout(() => setRestored(false), RECOVERY_MS);
    return () => clearTimeout(id);
  }, [restored]);

  const showing = status !== 'online' ? status : restored ? 'restored' : null;
  const copy = {
    offline: ['alert-triangle', 'text-amber-400', t('connectivity.offlineTitle'), t('connectivity.offlineBody')],
    unreachable: ['alert-triangle', 'text-amber-400', t('connectivity.unreachableTitle'), t('connectivity.unreachableBody')],
    restored: ['check-circle', 'text-teal-400', t('connectivity.restoredTitle'), t('connectivity.restoredBody')],
  }[showing] || [];
  const [icon, tone, title, body] = copy;

  return (
    <div
      className={`pn-safe-x fixed inset-x-0 top-[var(--pn-top-inset)] ${zClass} flex justify-center pointer-events-none`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {showing && (
        <div className="pn-connectivity-card pointer-events-auto mt-2 mx-3 flex items-center gap-2.5 rounded-xl border border-white/10 bg-[#15122a]/95 px-3.5 py-2 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.7)] backdrop-blur-xl">
          <Icon name={icon} className={`w-4 h-4 shrink-0 ${tone}`} />
          <p className="text-[13px] leading-snug text-gray-300 min-w-0">
            <span className="font-semibold text-white">{title}</span>{' '}{body}
          </p>
        </div>
      )}
    </div>
  );
}
