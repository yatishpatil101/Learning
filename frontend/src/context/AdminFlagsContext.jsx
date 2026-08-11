import { createContext, useCallback, useContext, useEffect, useState, useMemo } from 'react';
import { getSettings, updateSettings, getCustomRoles, logAudit } from '../lib/mockApi.js';
import { canAccessModule } from '../lib/permissions.js';

const AdminFlagsContext = createContext(null);

const DEFAULT_ADMIN_FLAGS = {
  tab: { analytics: true, finance: true, reports: true, support: true, flatmates: true, services: true },
  dash: { smartAlerts: true, sla: true, scorecard: true, glanceRevenue: true, glanceTraffic: true },
  analytics: { traffic: true, engagement: true, anonymous: true, conversion: true, geography: true, supplyGap: true, pricing: true, sla: true, seasonal: true },
  finance: { charts: true, transactions: true, models: true, rentPay: true },
  properties: { bulkOps: true, csvExport: true, commsLog: true, qualityScore: true },
  users: { enabled: true, timeline: true, bulkOps: true, csvExport: true },
  services: { enabled: true, priority: true, teamRouting: true, staffAssignment: true },
  enquiries: { visits: true, deals: true, funnelTime: true },
  content: { enabled: true, cityDemand: true, banners: true, faqs: true, announcements: true, reviews: true },
  reports: { properties: true, users: true },
  flatmates: { seekers: true, groups: true, applications: true },
  staffActivity: { enabled: true, kpis: true, leaderboard: true },
};

export function AdminFlagsProvider({ children }) {
  const [adminFlags, setAdminFlags] = useState(DEFAULT_ADMIN_FLAGS);
  const [customRoles, setCustomRoles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () => getSettings().then((s) => {
      if (!alive) return;
      if (s?.adminFlags) setAdminFlags((prev) => deepMerge(prev, s.adminFlags));
      // Custom roles are NOT part of the settings document — the server refuses that key with 422
      // (D67). They are a console-local collection, so they are read separately.
      setCustomRoles(getCustomRoles());
      setLoading(false);
    });
    load();
    // Keep custom roles (and flags) fresh after edits in the Team & Access page.
    const onChange = () => load();
    window.addEventListener('punenest-settings-change', onChange);
    return () => { alive = false; window.removeEventListener('punenest-settings-change', onChange); };
  }, []);

  const setFlag = useCallback(async (section, key, value) => {
    let next;
    setAdminFlags((prev) => {
      next = { ...prev, [section]: { ...prev[section], [key]: value } };
      return next;
    });
    await updateSettings({ adminFlags: next });
    logAudit('Admin flag', `${section}.${key} ${value ? 'enabled' : 'disabled'}`);
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

  const canModule = useCallback(
    (user, key) => canAccessModule(user, key, customRoles),
    [customRoles],
  );

  const value = useMemo(
    () => ({ adminFlags, tabEnabled, optionEnabled, setFlag, loading, customRoles, canModule }),
    [adminFlags, tabEnabled, optionEnabled, setFlag, loading, customRoles, canModule],
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

// Deep-merge helper: merges source into target (one level of nesting)
function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
      result[key] = { ...(target[key] || {}), ...source[key] };
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
