import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getAppFlags } from '../services/settingsService.js';

const AppFlagsContext = createContext(null);

/* These gate what a logged-out visitor sees, so they come from the public `GET /flags` rather than
   from the admin-only settings document or any browser-local copy. `flagEnabled` tests `!== false`,
   so an undecided flag is on and a failed fetch takes nothing away. */
export function AppFlagsProvider({ children }) {
  const [flags, setFlags] = useState({});

  useEffect(() => {
    /* A counter declared inside the effect rather than a `useRef` cleared in cleanup: under
       StrictMode such a ref stays false for the component's life, swallowing every result. */
    let generation = 0;

    const sync = async () => {
      const mine = ++generation;
      try {
        const next = await getAppFlags();
        if (mine === generation) setFlags(next && typeof next === 'object' ? next : {});
      } catch {
        /* Deliberately not a reset: clearing to `{}` means "nothing is switched off", so it could
           only ever undo a good earlier read — turning maintenance mode back off on one bad poll. */
      }
    };

    sync();
    // Same-tab: raised by whichever settings provider handled the write, so an admin toggling a flag
    // sees the consumer UI re-gate without a reload.
    window.addEventListener('draazy-settings-change', sync);
    // Cross-tab: the browser's own signal that another tab wrote to local storage.
    window.addEventListener('storage', sync);
    return () => {
      generation += 1;
      window.removeEventListener('draazy-settings-change', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const flagEnabled = useCallback((key) => flags[key] !== false, [flags]);

  const value = useMemo(() => ({ flagEnabled, flags }), [flagEnabled, flags]);

  return (
    <AppFlagsContext.Provider value={value}>
      {children}
    </AppFlagsContext.Provider>
  );
}

export function useAppFlags() {
  const ctx = useContext(AppFlagsContext);
  if (!ctx) throw new Error('useAppFlags must be used within AppFlagsProvider');
  return ctx;
}
