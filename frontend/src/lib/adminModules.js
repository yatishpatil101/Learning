/* Single source of truth for every admin-portal tab. `atom` is the whole access model: the console
   reads the atoms the server resolved onto `user.permissions` rather than composing its own union,
   since a union can only widen while the server's document may only narrow. A module with no `atom`
   is open to anyone who reaches the shell — only `dashboard`, which would otherwise redirect-loop. */
import {
  BarChart3, Building2, FileText, LayoutDashboard, MessageSquare, Settings,
  ShieldCheck, Users, Wrench, Flag, IndianRupee, UserPlus, MapPin, UsersRound,
} from 'lucide-react';

export const ADMIN_MODULES = [
  { key: 'dashboard', label: 'Dashboard', path: '/admin', icon: LayoutDashboard, end: true, base: true },
  { key: 'kycReview', label: 'KYC Review', path: '/admin/kyc-review', icon: UserPlus, atom: 'identity:read' },
  { key: 'analytics', label: 'Analytics', path: '/admin/analytics', icon: BarChart3, flagKey: 'analytics', atom: 'dashboard:read' },
  { key: 'postOnBehalf', label: 'Post on Behalf', path: '/admin/post-on-behalf', icon: UserPlus, atom: 'postOnBehalf:write' },
  { key: 'staffActivity', label: 'Staff Activity', path: '/admin/staff-activity', icon: ShieldCheck, adminOnly: true, atom: 'audit:read' },
  { key: 'properties', label: 'Properties', path: '/admin/properties', icon: Building2, atom: 'properties:read', writeAtom: 'properties:write' },
  { key: 'users', label: 'Users', path: '/admin/users', icon: Users, atom: 'users:read' },
  { key: 'services', label: 'Services', path: '/admin/services', icon: Wrench, flagKey: 'services', atom: 'services:read', writeAtom: 'services:write' },
  { key: 'enquiries', label: 'Enquiries', path: '/admin/enquiries', icon: MessageSquare, atom: 'enquiries:read' },
  { key: 'finance', label: 'Finance', path: '/admin/finance', icon: IndianRupee, flagKey: 'finance', adminOnly: true, atom: 'finance:read' },
  { key: 'content', label: 'Content', path: '/admin/content', icon: FileText, atom: 'content:read', writeAtom: 'content:write' },
  { key: 'reports', label: 'Reports', path: '/admin/reports', icon: Flag, flagKey: 'reports', atom: 'reports:read', writeAtom: 'reports:write' },
  { key: 'flatmates', label: 'Flatmates', path: '/admin/flatmates', icon: Users, flagKey: 'flatmates', atom: 'flatmates:read', writeAtom: 'flatmates:write' },
  { key: 'societies', label: 'Societies', path: '/admin/societies', icon: Building2, atom: 'societies:read', writeAtom: 'societies:write' },
  { key: 'localities', label: 'Localities', path: '/admin/localities', icon: MapPin, atom: 'localities:read', writeAtom: 'localities:write' },
  /* Gated on users:*write*, not users:read: this page edits who may open the back office, and the
     server refuses its PUT without the administrator-only atom. Gating on the read would show ops
     staff a page whose every save 403s. */
  { key: 'team', label: 'Team & Access', path: '/admin/team', icon: UsersRound, adminOnly: true, atom: 'users:write' },
  { key: 'settings', label: 'Settings', path: '/admin/settings', icon: Settings, adminOnly: true, atom: 'settings:read', writeAtom: 'settings:write' },
];

// Fast lookups
export const MODULE_BY_KEY = Object.fromEntries(ADMIN_MODULES.map((m) => [m.key, m]));
export const MODULE_BY_PATH = Object.fromEntries(ADMIN_MODULES.map((m) => [m.path, m]));

// Keys that every admin-portal user always keeps (landing page).
export const BASE_MODULE_KEYS = ADMIN_MODULES.filter((m) => m.base).map((m) => m.key);

/**
 * Does this caller hold a server permission atom? `user.permissions` is the resolved effective set
 * from `/auth/me` — never recomputed here — and an absent array holds nothing, deliberately.
 */
export const hasPermission = (user, atom) =>
  !!atom && Array.isArray(user?.permissions) && user.permissions.includes(atom);

/**
 * Can this caller open an admin module? Base modules are open to anyone `RoleRoute` has already
 * admitted to the admin shell, so staffness is established by then.
 */
export function canAccessModule(user, key) {
  const mod = MODULE_BY_KEY[key];
  if (!mod) return false;
  if (mod.base) return true;
  return hasPermission(user, mod.atom);
}

/** Can this caller act inside a module, as opposed to only reading it? */
export const canWriteModule = (user, key) =>
  hasPermission(user, MODULE_BY_KEY[key]?.writeAtom);

// Ops service teams — shared by StaffLogin, the drafting desk's desk picker and the access editor.
export const OPS_TEAMS = [
  { value: 'rental', label: 'Rent Agreement' },
  { value: 'legal', label: 'Property & Legal' },
  { value: 'loans', label: 'Home Loans' },
  { value: 'interior', label: 'Interior & Renovation' },
  { value: 'packers', label: 'Packers & Movers' },
  { value: 'valuation', label: 'Property Valuation' },
];

export const moduleLabel = (key) => MODULE_BY_KEY[key]?.label || key;

/**
 * A human label for a permission atom, e.g. `properties:write` → "Properties · Edit". Atoms outside
 * the admin shell fall back to the raw module name: a grantable atom must be a readable one.
 */
const ATOM_MODULE_LABELS = {
  dashboard: 'Dashboard & Analytics',
  postOnBehalf: 'Post on Behalf',
  audit: 'Staff Activity',
  tickets: 'Support Tickets',
  conversations: 'Private Conversations',
  users: 'Users',
  identity: 'Identity Verification',
};

export function permissionLabel({ module, action }) {
  const noun = ATOM_MODULE_LABELS[module]
    || MODULE_BY_KEY[module]?.label
    || module.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
  return `${noun} · ${action === 'write' ? 'Edit' : 'View'}`;
}
