/* A cache so a reload repaints before `/auth/me` answers; the server resolves both, so no security boundary.
   The refresh token is absent on purpose: it is an HttpOnly cookie, unreadable from script. */
const KEY = 'draazyUser';

// Tab-scoped sessionStorage when "Remember this device" is unchecked;
// try/catch degrades gracefully when storage is blocked.
function stores() {
  const out = [];
  try { if (typeof localStorage !== 'undefined') out.push(localStorage); } catch { /* ignore */ }
  try { if (typeof sessionStorage !== 'undefined') out.push(sessionStorage); } catch { /* ignore */ }
  return out;
}

/** Returned verbatim: `permissions` is server-resolved, and re-deriving it from the role would widen a
 * deliberately narrowed back-office account back to its role ceiling. */
export function readUser() {
  return readKeyed(KEY);
}

// Writes land in one tier and the other is cleared so exactly one session exists; a falsy user clears both.
export function writeUser(user, remember = true) {
  writeKeyed(KEY, user, remember);
}

/* Only the access token is kept here; the refresh token is an HttpOnly cookie, out of reach of page scripts.
   It has its own key, not `user`, which is spread into props and PATCHed back via updateMe. */
const TOKENS_KEY = 'draazyTokens';

export function readTokens() {
  return readKeyed(TOKENS_KEY);
}

export function writeTokens(tokens, remember = true) {
  writeKeyed(TOKENS_KEY, tokens, remember);
}

export const readAccessToken = () => readTokens()?.accessToken || null;

// Lets a refresh re-persist into the same tier. Falls back to `false`: unreadable localStorage is almost certainly
// unwritable too, and a session cookie then avoids stranding a persistent credential no token can spend.
function tokensRemembered() {
  try {
    return localStorage.getItem(TOKENS_KEY) != null;
  } catch {
    return false;
  }
}

/* The `__Host-` prefix stops a sibling subdomain planting an undeletable `Domain=` twin, but the dev profile
   drops it, so read whichever name is present rather than predicting it from `location.protocol`. */
const HINT_COOKIE = '__Host-draazy_session';
const HINT_COOKIE_INSECURE = 'draazy_session';
const HINT_REMEMBERED = '1';
const HINT_SESSION = '0';

function readHint() {
  try {
    const jar = document.cookie.split(';').map((c) => c.trim());
    for (const name of [HINT_COOKIE, HINT_COOKIE_INSECURE]) {
      const hits = jar.filter((c) => c.startsWith(`${name}=`));
      // Duplicate names signal another host writing into our jar; refuse outright so a planted twin cannot
      // steer us to a spelling it also controls.
      if (hits.length > 1) return null;
      if (hits.length === 0) continue;
      const value = hits[0].slice(name.length + 1);
      // A blank or unrecognised value would force a doomed cold-boot refresh and demote a live 30-day cookie
      // on the next rotation; the server's `presented()` treats a blank cookie as absent too.
      return value === HINT_REMEMBERED || value === HINT_SESSION ? value : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Read from `document.cookie` (deliberately not HttpOnly): Safari ITP wipes script-writable storage while the
 * refresh cookie survives, so empty storage cannot tell "signed out" from "wiped". It carries no secret. */
export function sessionHinted() {
  // No `document` (SSR, worker, test) reads as "no hint": a wrong "yes" would cost every anonymous visitor a 401
  // on every cold boot.
  return readHint() !== null;
}

/** Hint first, tier only as fallback: the tier records where a write landed, not the user's choice, so one storage
 * failure would permanently demote a remembered session to a session cookie. */
export function sessionRemembered() {
  const hint = readHint();
  if (hint !== null) return hint === HINT_REMEMBERED;
  return tokensRemembered();
}

/** A real write round trip, since `getItem` passes in modes that reject writes; only success is cached because
 * a probe fires `storage` events in every other tab, while a failed `setItem` emits none. */
let localWriteOk = false;

export function localStorageWritable() {
  if (localWriteOk) return true;
  const probe = `${TOKENS_KEY}__probe`;
  try {
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    localWriteOk = true;
    return true;
  } catch {
    return false;
  }
}

// Reads prefer the persistent tier; writes land in one tier and purge the other so the two can never disagree.
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

/** The hint is cleared here too: logout is best-effort, and a surviving hint beside an unrevoked refresh cookie
 * would sign the next cold boot back in. Name, path and domain must match the server's `hintBase()`. */
export function logoutUser() {
  writeUser(null);
  writeTokens(null);
  clearSessionHint();
}

function clearSessionHint() {
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    for (const name of [HINT_COOKIE, HINT_COOKIE_INSECURE]) {
      document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${secure}`;
    }
  } catch { /* no document (SSR, worker, DOM-less test env) — the server's clear still applies */ }
}

export const roleLabel = (r) => (r === 'owner' ? 'Owner' : r === 'admin' ? 'Admin' : r === 'manager' ? 'Manager' : r === 'staff' ? 'Staff' : r === 'member' ? 'Member' : 'Buyer / Tenant');
// Must match UserUpdate's @Pattern on the server.
export const isValidName = (name) => name.length >= 2 && name.length <= 80 && /^\p{L}[\p{L}\p{M} .'-]*$/u.test(name);
export const firstName = (u) => ((u && u.name) || '').trim().split(/\s+/)[0] || 'Account';
export const initial = (u) => (firstName(u)[0] || 'A').toUpperCase();
export const isInternal = (u) => !!u && (u.role === 'admin' || u.role === 'manager' || u.role === 'staff');
