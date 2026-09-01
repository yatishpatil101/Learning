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

/* The server's back-office permission catalogue, transcribed.
 *
 * `user.permissions` is the *only* thing the console reads to decide what a back-office account may
 * open; live it arrives already resolved on `/auth/me`. A stored mock session has no such field, and
 * `hasPermission` deliberately treats an absent array as holding nothing, so without this the mock
 * admin shell would render with nothing in it but the dashboard.
 *
 * Transcribed rather than derived from `adminModules.js`: three of these atoms (`tickets:read`,
 * `tickets:write`, `conversations:read`) open no admin-shell module at all, so the module registry
 * is not a superset of the catalogue. Deriving from it would grant a smaller set than the server
 * does, which is the class of divergence this whole change exists to remove. Dies with the mock.
 */
const ADMIN_ONLY_ATOMS = [
  'finance:read', 'users:write', 'conversations:read', 'audit:read',
  'settings:read', 'settings:write',
];
const STAFF_ATOMS = [
  'dashboard:read', 'users:read', 'content:read', 'content:write',
  'properties:read', 'properties:write', 'postOnBehalf:write', 'enquiries:read',
  'services:read', 'services:write', 'societies:read', 'societies:write',
  'localities:read', 'localities:write', 'tickets:read', 'tickets:write',
  'reports:read', 'reports:write', 'flatmates:read', 'flatmates:write',
];

/**
 * Attach the permission atoms a session holds, resolved from its role.
 *
 * Derived on every read and never written to storage. Live, this field is a projection the server
 * recomputes per request — an administrator who narrows someone's access expects the next page
 * load to reflect it — so persisting it here would freeze the answer at sign-in and let a revoked
 * permission survive until sign-out. That is the one failure mode an access-control field must not
 * have, and the mock should not be the place it is first tolerated.
 *
 * A consumer gets `[]` rather than `undefined`: "holds no back-office permissions" is a real
 * answer, and it is the one that keeps a buyer out of the admin shell. `manager` is not one of the
 * contract's roles — it is a console label this mock still uses for scoped back-office accounts —
 * so it resolves to the operations baseline, the same as `staff`.
 */
export function withPermissions(user) {
  if (!user) return user;
  const role = user.role;
  const permissions = role === 'admin' || role === 'superadmin'
    ? [...STAFF_ATOMS, ...ADMIN_ONLY_ATOMS]
    : role === 'staff' || role === 'manager'
      ? [...STAFF_ATOMS]
      : [];
  return { ...user, permissions };
}

export function readUser() {
  return withPermissions(readKeyed(KEY));
}

// Persist the current user. `remember` (default true) picks the storage tier:
// localStorage for "remember this device", sessionStorage for this tab only. We
// always clear the other tier so exactly one session exists. Passing a falsy user
// clears both (logout).
export function writeUser(user, remember = true) {
  writeKeyed(KEY, user, remember);
}

/* ── Tokens ────────────────────────────────────────────────────────────────
   Real API sessions carry an access/refresh pair. They are stored under their
   own key rather than inside the user object because `user` is spread into
   component props and PATCHed back via updateMe — folding credentials into it
   would leak them into places that only ever wanted a display name.

   Tokens deliberately reuse the same tier rule as the user: callers pass the
   same `remember` flag to both, so "remember this device" governs the whole
   session and a logout clears every trace of it from both tiers. */
const TOKENS_KEY = 'puneNestTokens';

export function readTokens() {
  return readKeyed(TOKENS_KEY);
}

export function writeTokens(tokens, remember = true) {
  writeKeyed(TOKENS_KEY, tokens, remember);
}

export const readAccessToken = () => readTokens()?.accessToken || null;
export const readRefreshToken = () => readTokens()?.refreshToken || null;

// Which tier the current session lives in. Lets a token refresh re-persist into the same tier
// instead of silently demoting a "remember this device" session to a tab-scoped one.
//
// The error fallback is `false` on purpose: if localStorage is unreadable (private mode, blocked
// storage) it is almost certainly unwritable too, so claiming "remembered" would send the refreshed
// tokens to a store that throws — silently destroying a working session. sessionStorage still works
// in those environments, so downgrading keeps the user signed in for the tab, which is also the
// safer of the two failure modes.
export function tokensRemembered() {
  try {
    return localStorage.getItem(TOKENS_KEY) != null;
  } catch {
    return false;
  }
}

// Shared storage-tier plumbing. Reads prefer the persistent (remembered) tier,
// then fall back to a tab-scoped one. Writes land in exactly one tier and purge
// the other so the two can never disagree; a falsy value clears both.
function readKeyed(key) {
  for (const s of stores()) {
    try {
      const v = s.getItem(key);
      if (v) return JSON.parse(v);
    } catch { /* ignore */ }
  }
  return null;
}

function writeKeyed(key, value, remember) {
  const primary = remember ? localStorage : sessionStorage;
  if (value) {
    try { primary.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
    stores().forEach((s) => { if (s !== primary) { try { s.removeItem(key); } catch { /* ignore */ } } });
  } else {
    stores().forEach((s) => { try { s.removeItem(key); } catch { /* ignore */ } });
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
  writeTokens(null);
}

export const roleLabel = (r) => (r === 'owner' ? 'Owner' : r === 'admin' ? 'Admin' : r === 'manager' ? 'Manager' : r === 'staff' ? 'Staff' : r === 'member' ? 'Member' : 'Buyer / Tenant');
export const firstName = (u) => ((u && u.name) || '').trim().split(/\s+/)[0] || 'Account';
export const initial = (u) => (firstName(u)[0] || 'A').toUpperCase();
export const isInternal = (u) => !!u && (u.role === 'admin' || u.role === 'manager' || u.role === 'staff');
