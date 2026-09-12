/* Admin module registry — the single source of truth for every admin-portal tab.
   Consumed by:
   - AdminLayout (to render the sidebar nav),
   - ModuleRoute (to gate routes),
   - AdminTeam (to label the atoms the server's permission catalogue returns).

   Each entry: { key, label, path, icon, end?, flagKey?, base?, adminOnly?, atom?, writeAtom? }
   - flagKey:   global AdminFlags tab toggle that also hides the module when off.
   - base:      always available to any internal admin-portal user (can't be revoked).
   - adminOnly: only an administrator can hold the atom that opens it.
   - atom:      the server permission that opens this module. See the note below.
   - writeAtom: the server permission the module's own actions require, where it has a second one.

   ### The `atom` field is the whole access model now (D209)

   This registry used to be read alongside `lib/permissions.js`, which resolved access in the
   browser by composing BASE ∪ custom-role bundle ∪ per-user overrides. That is a *union*, so every
   rule in it could only widen; the server's model is a document that may only *narrow* what the
   role's baseline allows. Two rules that disagree about direction cannot both be right, and the
   one that was wrong was the one the user could edit. So the console stopped resolving access and
   started reading `user.permissions` — the atoms the server already resolved for this caller and
   now returns on `/auth/me`.

   A module with no `atom` is open to anyone who can reach the admin shell at all. Only `dashboard`
   qualifies, and only because a back-office account with no landing page is an account that can
   sign in and see a redirect loop. */
import {
  BarChart3, Building2, FileText, LayoutDashboard, MessageSquare, Settings,
  ShieldCheck, Users, Wrench, Flag, IndianRupee, UserPlus, MapPin, UsersRound,
} from 'lucide-react';

export const ADMIN_MODULES = [
  { key: 'dashboard', label: 'Dashboard', path: '/admin', icon: LayoutDashboard, end: true, base: true },
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
  /* Gated on users:*write* rather than users:read, which is what it looks like it should be. The
     read atom opens the Users console — a list of consumers — and is an ordinary ops permission.
     This page edits who may open the back office, and the server refuses its PUT without
     users:write, an administrator-only atom. Gating the nav on the read would show operations
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
 * Does this caller hold a server permission atom?
 *
 * `user.permissions` is the *resolved effective* set — the role's baseline already narrowed by any
 * per-account document — computed server-side and returned on `/auth/me`. The console never
 * recomputes it, which is the point: there is now one implementation of the rule, and it is the
 * one that also decides whether the request succeeds.
 *
 * A user with no `permissions` array holds nothing. That is deliberately strict: the alternative,
 * treating "absent" as "unrestricted", makes every bug that drops the field silently open the
 * whole back office.
 */
export const hasPermission = (user, atom) =>
  !!atom && Array.isArray(user?.permissions) && user.permissions.includes(atom);

/**
 * Can this caller open an admin module?
 *
 * Base modules (just the dashboard) are open to anyone the router has already let into the admin
 * shell — `RoleRoute` has established they are staff or an administrator by then.
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
 * A human label for a server permission atom, e.g. `properties:write` → "Properties · Edit".
 *
 * The catalogue arrives from the server as `{ name, module, action, adminOnly }` and is rendered in
 * that order; this only supplies the wording. Two atoms name back-office capabilities that are not
 * admin-shell modules — `tickets:*` is the separate ops portal and `conversations:read` is the
 * moderated-chat read — so the module lookup falls back to the raw module name rather than hiding
 * them. An atom an administrator can grant must be an atom they can read.
 */
const ATOM_MODULE_LABELS = {
  dashboard: 'Dashboard & Analytics',
  postOnBehalf: 'Post on Behalf',
  audit: 'Staff Activity',
  tickets: 'Support Tickets',
  conversations: 'Private Conversations',
  users: 'Users',
};

export function permissionLabel({ module, action }) {
  const noun = ATOM_MODULE_LABELS[module]
    || MODULE_BY_KEY[module]?.label
    || module.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
  return `${noun} · ${action === 'write' ? 'Edit' : 'View'}`;
}
