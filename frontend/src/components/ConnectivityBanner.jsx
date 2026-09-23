import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from './Icon.jsx';
import { useConnectivity } from '../hooks/useConnectivity.js';
import { dismissUpdate, useAppUpdate } from '../hooks/useAppUpdate.js';

/** How long the "back online" confirmation stays up. */
const RECOVERY_MS = 4000;

/* Connectivity outranks the update prompt — reloading while offline lands on a blank page. Docked
   top because --dz-bottom-inset is full; the live region stays mounted or some AT never watches it. */
export default function ConnectivityBanner({ zClass = 'z-[1450]' }) {
  const { t } = useTranslation();
  const { status } = useConnectivity();
  const { updateReady } = useAppUpdate();
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

  /* Keyed on `restored`, not on the transition that set it: owning the timer in the effect above
     leaks under StrictMode, leaving the confirmation up for good. */
  useEffect(() => {
    if (!restored) return undefined;
    const id = setTimeout(() => setRestored(false), RECOVERY_MS);
    return () => clearTimeout(id);
  }, [restored]);

  const showing = status !== 'online' ? status : restored ? 'restored' : updateReady ? 'update' : null;
  const copy = {
    offline: ['alert-triangle', 'text-amber-400', t('connectivity.offlineTitle'), t('connectivity.offlineBody')],
    unreachable: ['alert-triangle', 'text-amber-400', t('connectivity.unreachableTitle'), t('connectivity.unreachableBody')],
    restored: ['check-circle', 'text-teal-400', t('connectivity.restoredTitle'), t('connectivity.restoredBody')],
    update: ['refresh-cw', 'text-violet-300', t('connectivity.updateTitle'), t('connectivity.updateBody')],
  }[showing] || [];
  const [icon, tone, title, body] = copy;

  return (
    <div
      className={`dz-safe-x fixed inset-x-0 top-[var(--dz-top-inset)] ${zClass} flex justify-center pointer-events-none`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {showing && (
        <div className="dz-connectivity-card pointer-events-auto mt-2 mx-3 flex items-center gap-2.5 rounded-xl border border-white/10 bg-[#15122a]/95 px-3.5 py-2 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.7)] backdrop-blur-xl">
          <Icon name={icon} className={`w-4 h-4 shrink-0 ${tone}`} />
          <p className="text-[13px] leading-snug text-gray-300 min-w-0">
            <span className="font-semibold text-white">{title}</span>{' '}{body}
          </p>
          {/* Dismiss is padded to a 32px box rather than the 44px target: the banner is 36px tall
              and growing it would cover the content it is commenting on. */}
          {showing === 'update' && (
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                data-testid="app-update-reload"
                onClick={() => window.location.reload()}
                className="rounded-lg bg-violet-500/90 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-violet-500"
              >
                {t('connectivity.updateAction')}
              </button>
              <button
                type="button"
                data-testid="app-update-dismiss"
                onClick={dismissUpdate}
                aria-label={t('connectivity.updateDismiss')}
                className="rounded-lg p-2 text-gray-400 hover:text-white"
              >
                <Icon name="x" className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
