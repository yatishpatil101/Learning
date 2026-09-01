import { createContext, useCallback, useContext, useEffect, useState, useMemo } from 'react';
import { getSettings, updateSettings, getCustomRoles } from '../services/settingsService.js';
import { logAudit } from '../lib/mockApi.js';
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

/**
 * @param {boolean} [read=true] whether to actually read the settings document.
 *
 * The ops shell mounts this provider too, because `AdminLayoutInner` calls `useAdminFlags()` for
 * both variants and would otherwise throw a blank screen. But `GET /admin/settings` is admin-only
 * in both directions — the same document carries fee configuration and the audit-log gate — so for
 * a staffer that read is a guaranteed 403 on every single ops page load, twice (the document and
 * its custom roles). It was invisible on the mock, where the store answered anyone.
 *
 * It is also pointless: the ops sidebar is a static list, and no `/ops` screen consults a tab flag
 * or a module gate. So the ops variant mounts the provider for its shape and skips the request.
 * The defaults it falls back to are the same ones a failed read produces, and every one of them is
 * `true` — "nothing was hidden" rather than "everything was".
 */
export function AdminFlagsProvider({ children, read = true }) {
  const [adminFlags, setAdminFlags] = useState(DEFAULT_ADMIN_FLAGS);
  const [customRoles, setCustomRoles] = useState([]);
  const [loading, setLoading] = useState(read);

  useEffect(() => {
    if (!read) return undefined;
    let alive = true;
    /* Both reads go through `services/settingsService.js` rather than `lib/mockApi.js`.

       That import used to be direct, which meant this provider — the source of every admin tab
       gate and every admin route guard — read `data/db.json` even with the whole app opted into
       the live API. A direct import has no switch to look at, so nothing reported the discrepancy:
       the console rendered flags nobody had set on the server and hid tabs nobody had disabled.

       `customRoles` is still read separately because it is genuinely not part of the document —
       the server refuses the key with 422 (D67/V61) — and the live provider answers `[]` for it.
       Live, `canModule` therefore resolves to role plus the always-on base modules; see
       `providers/http/settingsProvider.js` for why that is fail-closed rather than a hole. */
    const load = () => Promise.all([getSettings(), getCustomRoles()]).then(([s, roles]) => {
      if (!alive) return;
      if (s?.adminFlags) setAdminFlags((prev) => deepMerge(prev, s.adminFlags));
      setCustomRoles(Array.isArray(roles) ? roles : []);
      setLoading(false);
    }).catch(() => {
      // A settings read that fails must not leave the console stuck on its loading gate: the
      // route guard below blocks on `loading`, so a 401 or a dropped connection would present as
      // a permanently blank admin shell rather than as a failed request. Falling through to the
      // built-in defaults keeps the shell navigable, and every flag defaults to *enabled*, so the
      // failure mode is "nothing was hidden" rather than "everything was".
      if (alive) setLoading(false);
    });
    load();
    // Keep custom roles (and flags) fresh after edits in the Team & Access page.
    const onChange = () => load();
    window.addEventListener('punenest-settings-change', onChange);
    return () => { alive = false; window.removeEventListener('punenest-settings-change', onChange); };
  }, [read]);

  const setFlag = useCallback(async (section, key, value) => {
    setAdminFlags((prev) => ({ ...prev, [section]: { ...prev[section], [key]: value } }));
    /* Send only the flag that changed, never the merged block.

       Both ends deep-merge, so the narrow patch is sufficient — and it is the only safe shape. The
       whole-block form re-asserts every other flag in the section as a deliberate value, which is a
       claim this callback cannot make: after a failed load the state it would echo back is
       `DEFAULT_ADMIN_FLAGS`, where everything is `true`. One toggle would then persist "nothing is
       hidden" over whatever the operator had actually configured, for every admin, from a click
       that was about a single unrelated switch. A patch describes the edit; a block describes the
       editor's beliefs, and those can be stale. */
    await updateSettings({ adminFlags: { [section]: { [key]: value } } });
    // Local-only audit trail, still on `lib/mockApi` because the audit log is its own domain and
    // has not been seamed yet. Against the live API this row is redundant rather than wrong: the
    // PUT above already recorded a server-side `settings.update` row naming the keys it touched.
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
    // `Object.keys` on a `JSON.parse` result does include an own `__proto__` key, and assigning to
    // it would invoke the inherited setter and reparent `result` instead of adding a flag. The
    // source is an admin-only authenticated endpoint, so this is a cheap guard rather than a known
    // hole — but a merge over a server-supplied object should not be the thing that decides.
    if (key === '__proto__' || key === 'constructor') continue;
    if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
      result[key] = { ...(target[key] || {}), ...source[key] };
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
