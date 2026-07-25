import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { rawDb } from '../lib/mockApi.js';

const AppFlagsContext = createContext(null);

function readFlags() {
  const db = rawDb();
  return db?.settings?.flags || {};
}

/**
 * Provides reactive access to application-level feature flags (settings.flags).
 * Re-reads flags when settings are updated (via custom event) or on cross-tab storage changes.
 */
export function AppFlagsProvider({ children }) {
  const [flags, setFlags] = useState(readFlags);

  useEffect(() => {
    const sync = () => setFlags(readFlags());
    // Same-tab: fired by updateSettings() in mockApi
    window.addEventListener('punenest-settings-change', sync);
    // Cross-tab: fired by browser when another tab writes to localStorage
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('punenest-settings-change', sync);
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
