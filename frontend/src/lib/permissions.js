/* Permission resolution for the admin portal (mock RBAC — UX only, not real security).

   Model:
   - role 'admin'   → super-admin: full access to every module (the "*" grant).
   - role 'manager' → scoped internal user: sees only the modules granted by their
                      custom role (roleId → settings.customRoles) UNION their per-user
                      moduleAccess overrides, plus the always-on BASE modules.
   - role 'staff'   → ops portal only (team-scoped elsewhere via TeamRoute); no admin shell.

   A user may carry both a `roleId` (reusable named bundle) and `moduleAccess` (manual
   per-tab overrides). Effective admin modules = base ∪ role bundle ∪ overrides. */
import { ADMIN_MODULES, BASE_MODULE_KEYS, MODULE_BY_KEY, PROPERTIES_VERIFY_KEY } from './adminModules.js';

const ALL_MODULE_KEYS = ADMIN_MODULES.map((m) => m.key);

export const SUPERADMIN_ROLES = ['admin', 'superadmin'];

export function isSuperAdmin(user) {
  if (!user) return false;
  if (SUPERADMIN_ROLES.includes(user.role)) return true;
  // Explicit wildcard grant (defensive — lets a custom "owner" role be all-access).
  return Array.isArray(user.moduleAccess) && user.moduleAccess.includes('*');
}

// Modules bundled into a custom role id (from settings.customRoles).
function roleBundleModules(roleId, customRoles) {
  if (!roleId || !Array.isArray(customRoles)) return [];
  const role = customRoles.find((r) => r.id === roleId);
  return Array.isArray(role?.modules) ? role.modules : [];
}

/* Raw union of keys a scoped user has been granted (base ∪ role bundle ∪
   per-user overrides). May include the properties:verify sub-scope key. */
function grantedKeys(user, customRoles) {
  const keys = new Set(BASE_MODULE_KEYS);
  roleBundleModules(user?.roleId, customRoles).forEach((k) => keys.add(k));
  if (Array.isArray(user?.moduleAccess)) user.moduleAccess.forEach((k) => keys.add(k));
  return keys;
}

/* The full set of admin-module keys a user can open. Super-admins get everything;
   scoped users get base + their role bundle + their manual overrides. The
   properties:verify sub-scope still unlocks the Properties module (nav + route). */
export function effectiveModuleKeys(user, customRoles = []) {
  if (isSuperAdmin(user)) return new Set(ALL_MODULE_KEYS);
  const keys = grantedKeys(user, customRoles);
  if (keys.has(PROPERTIES_VERIFY_KEY)) keys.add('properties');
  // A scoped user can never be granted admin-only control surfaces.
  return new Set([...keys].filter((k) => MODULE_BY_KEY[k] && !MODULE_BY_KEY[k].adminOnly));
}

/* Access level for the Properties module: 'full' | 'verify' | null.
   A full grant beats a verify grant; verify-only limits Properties to the
   Verification Queue. */
export function propertiesScope(user, customRoles = []) {
  if (isSuperAdmin(user)) return 'full';
  const keys = grantedKeys(user, customRoles);
  if (keys.has('properties')) return 'full';
  if (keys.has(PROPERTIES_VERIFY_KEY)) return 'verify';
  return null;
}

export function canAccessModule(user, key, customRoles = []) {
  if (isSuperAdmin(user)) return true;
  if (BASE_MODULE_KEYS.includes(key)) return true;
  return effectiveModuleKeys(user, customRoles).has(key);
}

// Ops service teams a user belongs to (admins implicitly belong to all — see TeamRoute).
export function userTeams(user) {
  if (!user) return [];
  return user.teams || (user.team ? [user.team] : []);
}
