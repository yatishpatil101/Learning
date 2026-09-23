import { createContext, useCallback, useContext, useEffect, useState, useMemo } from 'react';
import { getSettings, updateSettings } from '../services/settingsService.js';

const AdminFlagsContext = createContext(null);

const DEFAULT_ADMIN_FLAGS = {
  tab: { analytics: true, finance: true, reports: true, support: true, flatmates: true, services: true },
  dash: { smartAlerts: true, sla: true, scorecard: true, glanceRevenue: true, glanceTraffic: true },
  analytics: { traffic: true, engagement: true, anonymous: true, conversion: true, geography: true, supplyGap: true, pricing: true, sla: true },
  finance: { charts: true, transactions: true, models: true },
  properties: { bulkOps: true, csvExport: true, commsLog: true, qualityScore: true },
  users: { enabled: true, timeline: true, bulkOps: true, csvExport: true },
  services: { enabled: true, priority: true, teamRouting: true, staffAssignment: true },
  enquiries: { visits: true, deals: true, funnelTime: true },
  content: { enabled: true, cityDemand: true, banners: true, faqs: true, announcements: true, reviews: true },
  reports: { properties: true, users: true, posts: true },
  flatmates: { seekers: true, groups: true, applications: true },
  staffActivity: { enabled: true, kpis: true, leaderboard: true },
};

/* `read=false` for the ops shell: `AdminLayoutInner` calls `useAdminFlags()` for both variants, but
   `GET /admin/settings` is admin-only, so for a staffer that read is a guaranteed 403 per page. */
export function AdminFlagsProvider({ children, read = true }) {
  const [adminFlags, setAdminFlags] = useState(DEFAULT_ADMIN_FLAGS);
  const [loading, setLoading] = useState(read);

  useEffect(() => {
    if (!read) return undefined;
    let alive = true;
    const load = () => getSettings().then((s) => {
      if (!alive) return;
      if (s?.adminFlags) setAdminFlags((prev) => deepMerge(prev, s.adminFlags));
      setLoading(false);
    }).catch(() => {
      // The route guard below blocks on `loading`, so a failed read must still clear it or the
      // admin shell is permanently blank. Defaults are all `true`: nothing hidden, not everything.
      if (alive) setLoading(false);
    });
    load();
    // Keep flags fresh after edits elsewhere in the console.
    const onChange = () => load();
    window.addEventListener('draazy-settings-change', onChange);
    return () => { alive = false; window.removeEventListener('draazy-settings-change', onChange); };
  }, [read]);

  const setFlag = useCallback(async (section, key, value) => {
    setAdminFlags((prev) => ({ ...prev, [section]: { ...prev[section], [key]: value } }));
    /* Send only the flag that changed, never the merged block: both ends deep-merge, and after a
       failed load the block form would persist `DEFAULT_ADMIN_FLAGS` over the real configuration. */
    await updateSettings({ adminFlags: { [section]: { [key]: value } } });
  }, []);

  const tabEnabled = useCallback(
    (tabKey) => adminFlags.tab?.[tabKey] !== false,
    [adminFlags.tab],
  );

  const optionEnabled = useCallback((dotPath) => {
    const [section, option] = dotPath.split('.');
    // Tab-level gate (for analytics, finance, reports, support, flatmates)
    if (section in (adminFlags.tab || {}) && !adminFlags.tab[section]) {
      return false;
    }
    // Module-level gate (for dash, properties, users, services, enquiries, content, staffActivity)
    const sectionFlags = adminFlags[section];
    if (sectionFlags && 'enabled' in sectionFlags && !sectionFlags.enabled) {
      return false;
    }
    return sectionFlags?.[option] !== false;
  }, [adminFlags]);

  const value = useMemo(
    () => ({ adminFlags, tabEnabled, optionEnabled, setFlag, loading }),
    [adminFlags, tabEnabled, optionEnabled, setFlag, loading],
  );

  return (
    <AdminFlagsContext.Provider value={value}>
      {children}
    </AdminFlagsContext.Provider>
  );
}

export function useAdminFlags() {
  const ctx = useContext(AdminFlagsContext);
  if (!ctx) throw new Error('useAdminFlags must be used within AdminFlagsProvider');
  return ctx;
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    // `Object.keys` on a `JSON.parse` result does include an own `__proto__` key, and assigning to
    // it would invoke the inherited setter and reparent `result` instead of adding a flag.
    if (key === '__proto__' || key === 'constructor') continue;
    if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
      result[key] = { ...(target[key] || {}), ...source[key] };
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
