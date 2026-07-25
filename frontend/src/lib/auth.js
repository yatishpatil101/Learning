/* Mock auth/session (localStorage). Prototype only — NOT real security.
   Mirrors the prototype's auth.js: current user under 'puneNestUser'.
   Roles: buyer | owner | admin | staff(+team). Guards are enforced via React route
   wrappers (ProtectedRoute / RoleRoute), not synchronous <head> scripts. */
const KEY = 'puneNestUser';
// Registry of accounts that have completed sign-up, keyed by mobile number.
// Lets Sign In tell a returning member apart from a brand-new visitor (mock only).
const USERS_KEY = 'puneNestUsers';

const normMobile = (m) => String(m || '').replace(/\D/g, '').slice(-10);

// Session-scoped store used when the visitor unchecks "Remember this device":
// the session is kept only for the life of the tab (sessionStorage) instead of
// persisting across browser restarts (localStorage). Wrapped in try/catch so
// private-mode / disabled storage degrades gracefully.
function stores() {
  const out = [];
  try { if (typeof localStorage !== 'undefined') out.push(localStorage); } catch { /* ignore */ }
  try { if (typeof sessionStorage !== 'undefined') out.push(sessionStorage); } catch { /* ignore */ }
  return out;
}

export function readUsers() {
  try {
    const v = JSON.parse(localStorage.getItem(USERS_KEY));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function userExists(mobile) {
  const m = normMobile(mobile);
  return !!m && readUsers().some((u) => normMobile(u.mobile) === m);
}

// Look up a registered account by mobile so Sign In can restore the member's
// real name/role instead of a generic placeholder. Returns null if unknown.
export function findUser(mobile) {
  const m = normMobile(mobile);
  if (!m) return null;
  return readUsers().find((u) => normMobile(u.mobile) === m) || null;
}

// Record a completed sign-up. Idempotent — re-registering the same mobile
// refreshes the profile without duplicating the account.
export function registerUser({ name, mobile, email = '', role = 'buyer' }) {
  const m = normMobile(mobile);
  const list = readUsers();
  const existing = list.find((u) => normMobile(u.mobile) === m);
  const account = { name: name || 'PuneNest User', mobile: m, email, role, joinedAt: existing?.joinedAt || Date.now() };
  const next = existing ? list.map((u) => (normMobile(u.mobile) === m ? account : u)) : [...list, account];
  localStorage.setItem(USERS_KEY, JSON.stringify(next));
  return account;
}

export function readUser() {
  // Prefer the persistent (remembered) session, then fall back to a tab-scoped one.
  try {
    const v = localStorage.getItem(KEY);
    if (v) return JSON.parse(v);
  } catch { /* ignore */ }
  try {
    const v = sessionStorage.getItem(KEY);
    if (v) return JSON.parse(v);
  } catch { /* ignore */ }
  return null;
}

// Persist the current user. `remember` (default true) picks the storage tier:
// localStorage for "remember this device", sessionStorage for this tab only. We
// always clear the other tier so exactly one session exists. Passing a falsy user
// clears both (logout).
export function writeUser(user, remember = true) {
  const primary = remember ? localStorage : sessionStorage;
  if (user) {
    try { primary.setItem(KEY, JSON.stringify(user)); } catch { /* ignore */ }
    // Drop any copy in the other tier so the two never disagree.
    stores().forEach((s) => { if (s !== primary) { try { s.removeItem(KEY); } catch { /* ignore */ } } });
  } else {
    stores().forEach((s) => { try { s.removeItem(KEY); } catch { /* ignore */ } });
  }
}

export function loginUser({ name, mobile, role = 'buyer', remember = true }) {
  const user = { name: name || 'PuneNest User', mobile: mobile || '', role, loginAt: Date.now() };
  writeUser(user, remember);
  return user;
}

export function staffLoginUser({ name, mobile, role = 'staff', team, teams, roleId = null, moduleAccess = [] }) {
  const resolvedTeams = teams || (team ? [team] : []);
  const user = {
    name: name || 'Staff',
    mobile: mobile || '',
    role,
    team: role === 'admin' ? null : (resolvedTeams[0] || null),
    teams: resolvedTeams,
    roleId: roleId || null,
    moduleAccess: Array.isArray(moduleAccess) ? moduleAccess : [],
    loginAt: Date.now(),
  };
  writeUser(user);
  return user;
}

export function logoutUser() {
  writeUser(null);
}

export const roleLabel = (r) => (r === 'owner' ? 'Owner' : r === 'admin' ? 'Admin' : r === 'manager' ? 'Manager' : r === 'staff' ? 'Staff' : r === 'member' ? 'Member' : 'Buyer / Tenant');
export const firstName = (u) => ((u && u.name) || '').trim().split(/\s+/)[0] || 'Account';
export const initial = (u) => (firstName(u)[0] || 'A').toUpperCase();
export const isInternal = (u) => !!u && (u.role === 'admin' || u.role === 'manager' || u.role === 'staff');
