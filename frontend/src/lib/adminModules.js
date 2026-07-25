/* Admin module registry — the single source of truth for every admin-portal tab.
   Consumed by:
   - AdminLayout (to render the sidebar nav),
   - AdminTeam (to render the per-user access checkbox grid + custom-role builder),
   - permissions.js / ModuleRoute (to gate routes).

   Each entry: { key, label, path, icon, end?, flagKey?, base?, adminOnly? }
   - flagKey:  global AdminFlags tab toggle that also hides the module when off.
   - base:     always available to any internal admin-portal user (can't be revoked).
   - adminOnly: only a super-admin can see/grant it (access & settings control). */
import {
  BarChart3, Building2, FileText, LayoutDashboard, MessageSquare, Settings,
  ShieldCheck, Users, Wrench, Flag, IndianRupee, UserPlus, MapPin, BadgeCheck, UsersRound,
} from 'lucide-react';

export const ADMIN_MODULES = [
  { key: 'dashboard', label: 'Dashboard', path: '/admin', icon: LayoutDashboard, end: true, base: true },
  { key: 'analytics', label: 'Analytics', path: '/admin/analytics', icon: BarChart3, flagKey: 'analytics' },
  { key: 'postOnBehalf', label: 'Post on Behalf', path: '/admin/post-on-behalf', icon: UserPlus },
  { key: 'staffActivity', label: 'Staff Activity', path: '/admin/staff-activity', icon: ShieldCheck },
  { key: 'properties', label: 'Properties', path: '/admin/properties', icon: Building2 },
  { key: 'users', label: 'Users', path: '/admin/users', icon: Users },
  { key: 'services', label: 'Services', path: '/admin/services', icon: Wrench, flagKey: 'services' },
  { key: 'enquiries', label: 'Enquiries', path: '/admin/enquiries', icon: MessageSquare },
  { key: 'finance', label: 'Finance', path: '/admin/finance', icon: IndianRupee, flagKey: 'finance' },
  { key: 'content', label: 'Content', path: '/admin/content', icon: FileText },
  { key: 'reports', label: 'Reports', path: '/admin/reports', icon: Flag, flagKey: 'reports' },
  { key: 'flatmates', label: 'Flatmates', path: '/admin/flatmates', icon: Users, flagKey: 'flatmates' },
  { key: 'societies', label: 'Societies', path: '/admin/societies', icon: Building2 },
  { key: 'localities', label: 'Localities', path: '/admin/localities', icon: MapPin },
  { key: 'team', label: 'Team & Access', path: '/admin/team', icon: UsersRound, adminOnly: true },
  { key: 'settings', label: 'Settings', path: '/admin/settings', icon: Settings, adminOnly: true },
];

// Fast lookups
export const MODULE_BY_KEY = Object.fromEntries(ADMIN_MODULES.map((m) => [m.key, m]));
export const MODULE_BY_PATH = Object.fromEntries(ADMIN_MODULES.map((m) => [m.path, m]));

// Keys that every admin-portal user always keeps (landing page).
export const BASE_MODULE_KEYS = ADMIN_MODULES.filter((m) => m.base).map((m) => m.key);

// Modules a scoped (non-super-admin) user may be granted via the access grid.
export const GRANTABLE_MODULES = ADMIN_MODULES.filter((m) => !m.base && !m.adminOnly);

// The Properties "verify-only" sub-scope. Granting this opens the Properties
// module limited to the Verification Queue (approve/reject only) — so a user can
// own listing verification without the full Properties console (curation,
// duplicates, archiving). It is a grantable permission key, not a nav module.
export const PROPERTIES_VERIFY_KEY = 'properties:verify';

// Grantable permissions shown in the Team & Access grid: every grantable module,
// with the Properties row followed by its verify-only sub-scope.
export const GRANTABLE_PERMISSIONS = GRANTABLE_MODULES.flatMap((m) =>
  m.key === 'properties'
    ? [m, { key: PROPERTIES_VERIFY_KEY, label: 'Properties · Verify only', icon: BadgeCheck, scopeOf: 'properties' }]
    : [m],
);

// Ops service teams — shared by StaffLogin, TeamRoute and the access editor.
export const OPS_TEAMS = [
  { value: 'rental', label: 'Rent Agreement' },
  { value: 'legal', label: 'Property & Legal' },
  { value: 'loans', label: 'Home Loans' },
  { value: 'interior', label: 'Interior & Renovation' },
  { value: 'packers', label: 'Packers & Movers' },
  { value: 'valuation', label: 'Property Valuation' },
];

export const moduleLabel = (key) =>
  key === PROPERTIES_VERIFY_KEY ? 'Properties · Verify only' : (MODULE_BY_KEY[key]?.label || key);
