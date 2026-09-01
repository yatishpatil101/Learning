import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getAppFlags } from '../services/settingsService.js';

const AppFlagsContext = createContext(null);

/**
 * Reactive access to the platform's feature toggles (`settings.flags`).
 *
 * ## Where these come from, and why it changed
 *
 * They used to be read straight out of `lib/mockApi`'s local-storage document. That made every
 * toggle on the admin's Settings screen a lie the moment the console went live: `PUT
 * /admin/settings` stored the value on the server, faithfully, and the only reader was a browser
 * copy that never heard about it. An operator could switch **maintenance mode** on, be told it
 * saved — it did save — and watch the site carry on serving. A kill switch that fails silently
 * fails at exactly the moment somebody is reaching for it.
 *
 * So the read now goes through the service seam to `GET /flags`, a public route publishing this one
 * block of the settings document. It has to be its own route rather than a slice of `GET
 * /admin/settings`: that endpoint is admin-only in both directions because the same document
 * carries the fee table and the permission map, and these flags gate what a *logged-out visitor*
 * sees.
 *
 * ## Absent means enabled
 *
 * `flagEnabled` tests `!== false`, so a flag nobody has decided about is on. That is what keeps
 * shipping a feature a code change instead of a code change plus a config row, and it is why the
 * initial state is `{}` rather than a loading gate: the first paint renders the product as built,
 * and the fetch only ever takes things *away*. The same rule is what makes a failed fetch
 * survivable — "no decisions recorded" lands every flag on its default instead of blanking the
 * site.
 */
export function AppFlagsProvider({ children }) {
  const [flags, setFlags] = useState({});

  useEffect(() => {
    /* Guards both against a superseded response overwriting a newer one and against a `setState`
       after unmount. A counter declared inside the effect rather than a `useRef` cleared in
       cleanup: under StrictMode the mount/cleanup/re-mount cycle leaves such a ref stuck at false
       for the life of the component, silently swallowing every result it ever gets. */
    let generation = 0;

    const sync = async () => {
      const mine = ++generation;
      try {
        const next = await getAppFlags();
        if (mine === generation) setFlags(next && typeof next === 'object' ? next : {});
      } catch {
        /* Deliberately silent, and deliberately not a reset. Clearing to `{}` says the same thing as
           "nothing is switched off", so re-asserting it on failure could only ever *undo* a good
           earlier read — turning maintenance mode back off because one poll happened to fail.
           Keeping the last known set is the conservative move. */
      }
    };

    sync();
    // Same-tab: raised by whichever settings provider handled the write, so an admin toggling a flag
    // sees the consumer UI re-gate without a reload.
    window.addEventListener('draazy-settings-change', sync);
    // Cross-tab: the browser's own signal that another tab wrote to local storage. Load-bearing only
    // on the mock path; harmless live, where it costs one extra read of a public endpoint.
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
