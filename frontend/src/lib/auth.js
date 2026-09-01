/* Client-side session cache (localStorage / sessionStorage).
   The signed-in user is cached under 'draazyUser' and the access token under 'draazyTokens'.
   Neither is authoritative — the server resolves both — so nothing here is a security boundary;
   it exists so a reload repaints the correct UI before `/auth/me` has answered.
   The refresh token is deliberately absent: it is an HttpOnly cookie, unreadable from here.
   Roles: buyer | owner | admin | staff(+team). Guards are enforced via React route
   wrappers (ProtectedRoute / RoleRoute), not synchronous <head> scripts. */
const KEY = 'draazyUser';

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

/**
 * The cached signed-in user, or null.
 *
 * Returned verbatim. `permissions` on it is the set the **server** resolved — the role's baseline
 * already intersected with any per-account grant (`back_office_permissions`) — and it rides on
 * every token-bearing response because they all project through `SelfProfile`. Re-deriving it here
 * from the role would widen a deliberately narrowed back-office account back to its role ceiling,
 * which is the one direction an access-control field must never drift.
 */
export function readUser() {
  return readKeyed(KEY);
}

// Persist the current user. `remember` (default true) picks the storage tier:
// localStorage for "remember this device", sessionStorage for this tab only. We
// always clear the other tier so exactly one session exists. Passing a falsy user
// clears both (logout).
export function writeUser(user, remember = true) {
  writeKeyed(KEY, user, remember);
}

/* ── Tokens ────────────────────────────────────────────────────────────────
   Only the **access** token is kept here. Its other half, the refresh token, is
   an HttpOnly cookie the browser sends to `/api/auth` on its own — the client
   never sees it, which is the point: it is the long-lived half, and anything a
   client never needs to read should be out of reach of any script on the page.

   It still lives under its own key rather than inside the user object, because
   `user` is spread into component props and PATCHed back via updateMe — folding
   a credential into it would leak it into places that only ever wanted a name.

   The tier rule matches the user's: callers pass the same `remember` flag to
   both, so "remember this device" governs the whole session and a logout clears
   every trace of it from both tiers. The cookie's lifetime is set server-side
   from that same flag, so the two halves expire together rather than one
   outliving the other. */
const TOKENS_KEY = 'draazyTokens';

export function readTokens() {
  return readKeyed(TOKENS_KEY);
}

export function writeTokens(tokens, remember = true) {
  writeKeyed(TOKENS_KEY, tokens, remember);
}

export const readAccessToken = () => readTokens()?.accessToken || null;

// Which tier the current session lives in. Lets a token refresh re-persist into the same tier
// instead of silently demoting a "remember this device" session to a tab-scoped one.
//
// The error fallback is `false` on purpose: if localStorage is unreadable (private mode, blocked
// storage) it is almost certainly unwritable too, so claiming "remembered" would send the refreshed
// tokens to a store that throws — silently destroying a working session. sessionStorage still works
// in those environments, so downgrading keeps the user signed in for the tab, which is also the
// safer of the two failure modes.
//
// Since the refresh token became a cookie, this value also travels: `sessionRemembered` builds on
// it and `doRefresh` posts the result as `remember`, so the server sets a persistent or session
// cookie accordingly. That makes the fallback consequential in a way it was not when it only chose
// a local tier. In the case it was written for — storage genuinely blocked — a session cookie is
// the *right* answer, because a persistent cookie would outlive the sessionStorage tokens and
// strand a credential with nothing able to spend it. The gap is the transient case: one unlucky
// read demotes the session, the tokens move to sessionStorage, and this then reports `false`
// forever after, with no path back to the remembered tier short of a fresh sign-in. Fixing that
// properly means recording the user's stated choice at login rather than inferring it from storage
// health each time — worth doing, but it is a change to the token blob's shape and belongs with its
// own tests, not folded in here. (The *wiped*-storage case, which is not transient, is handled:
// see `sessionRemembered`.)
// No longer exported: `sessionRemembered` is the question callers actually have, and this answers
// only half of it. Leaving it public invited the exact bug that made it half an answer — a caller
// asking it directly gets "no" from a browser whose storage was merely wiped.
function tokensRemembered() {
  try {
    return localStorage.getItem(TOKENS_KEY) != null;
  } catch {
    return false;
  }
}

/* ── Session hint ──────────────────────────────────────────────────────────
   Values must match RefreshCookie.HINT_REMEMBERED / HINT_SESSION; the names must match
   RefreshCookie.hintName() in *both* of the spellings it can produce.

   The `__Host-` prefix is not decoration: browsers refuse to store a cookie so named unless it is
   Secure, host-only and `Path=/`, which is what stops a sibling subdomain planting a
   `Domain=.draazy.in` twin that neither the server's clear nor `clearSessionHint` below could
   ever delete. Because it *requires* Secure, the server drops the prefix on the plain-http dev
   profile — so there are two possible names, and the client must not try to predict which one it
   is looking at.

   Predicting it from `location.protocol` is the obvious move and it is wrong. The two sides would
   then decide one name from two different pieces of evidence, and they disagree in exactly the
   situation this feature exists for: an HTTPS tunnel in front of a dev-profile backend, which is
   how you would reproduce Safari's ITP behaviour on a real iPhone. The server, seeing
   `secure=false`, sets the bare name; the page, seeing `https:`, looks for the prefixed one; the
   marker is never found; the recovery is inert; and nothing anywhere reports a problem. Reading
   whichever name is actually present costs nothing and cannot drift.

   Preferring the prefixed name when both are present is deliberate: only a host-only, Secure cookie
   can carry it, so it is the one a sibling host cannot have written, and a stale bare cookie left
   over from before the rename must not outrank the real one. */
const HINT_COOKIE = '__Host-draazy_session';
const HINT_COOKIE_INSECURE = 'draazy_session';
const HINT_REMEMBERED = '1';
const HINT_SESSION = '0';

/**
 * The value of the session-hint cookie, or `null` when it is absent or untrustworthy.
 *
 * @returns {string|null} `'1'` for a remembered session, `'0'` for a tab-scoped one, `null` for none
 */
function readHint() {
  try {
    const jar = document.cookie.split(';').map((c) => c.trim());
    for (const name of [HINT_COOKIE, HINT_COOKIE_INSECURE]) {
      const hits = jar.filter((c) => c.startsWith(`${name}=`));
      // Two cookies of one name are two cookies from two different scopes — the signature of
      // another host writing into our jar rather than anything we did. Which one comes first is
      // creation-ordered and unspecifiable, so trusting either is a coin flip; "no hint" costs a
      // sign-in and costs the attack the automatic cold-boot refresh it was aiming at. Refuse
      // outright rather than falling through to the other spelling: a planted duplicate must not be
      // able to demote us to a name it also controls.
      if (hits.length > 1) return null;
      if (hits.length === 0) continue;
      const value = hits[0].slice(name.length + 1);
      // Anything we did not write is not a hint. A blank or unrecognised value would otherwise read
      // as "a session exists" (costing a doomed cold-boot refresh) *and* as "not remembered"
      // (demoting a live 30-day cookie on the next rotation) — the worse half of both answers. The
      // server's own `presented()` treats a blank cookie as absent for the same reason.
      return value === HINT_REMEMBERED || value === HINT_SESSION ? value : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Whether the server says a session exists, according to the cookie it sets beside the refresh
 * token. Read from `document.cookie` because that cookie is deliberately not `HttpOnly`.
 *
 * **Why this cannot be answered from storage.** Safari's ITP wipes script-writable storage after
 * seven days without first-party interaction, so a remembered session loses its cached user and
 * access token while its 30-day refresh cookie — server-set, and so exempt — is still perfectly
 * good. An empty `localStorage` therefore means either "signed out" or "storage was cleared
 * underneath a live session", and the two are indistinguishable from here. This cookie is the one
 * signal that tells them apart, which is what lets the boot path spend a refresh for the users who
 * have a session to recover and spend nothing for the anonymous majority — the reason this is a
 * marker rather than an unconditional refresh on every cold boot.
 *
 * It carries no identity and no secret, so nothing is lost by it being readable; an XSS that reads
 * it learns only what a bare `POST /auth/refresh` would already tell it.
 */
export function sessionHinted() {
  // No `document` (SSR, a worker, a test env without a DOM) reads as "no hint": that costs an
  // ITP-wiped user one delayed sign-in, where guessing "yes" would cost every anonymous visitor a
  // 401 on every cold boot.
  return readHint() !== null;
}

/**
 * Whether the current session was meant to outlive the browser — the value `/auth/refresh` must be
 * told on every rotation, because the browser tells the server nothing about the lifetime of the
 * cookie it presents.
 *
 * The hint is consulted **first, whenever it is readable**, and the storage tier only as a fallback.
 * That ordering is the whole point and it was wrong on the first attempt. The tier answers "where
 * did the last write land", not "what did the user ask for", and {@link persistTokens} deliberately
 * breaks the equivalence between the two: it writes to the tab-scoped tier when the persistent one
 * is unwritable, *while keeping the 30-day cookie*, because a persistent cookie beside vanished
 * `localStorage` tokens is a stranded credential. Read the tier back as the choice and one unlucky
 * `QuotaExceededError` becomes permanent: the next rotation reports `remember: false`, the server
 * swaps the 30-day cookie for a session one and rewrites the marker to `'0'`, and the record of the
 * choice is now gone from both places with no path back short of a fresh sign-in. The same demotion
 * arrives from two tabs at different tiers, where the tab-scoped one speaks for the remembered one.
 *
 * The marker does not have those failure modes. It is the server's own record of what it was told,
 * it is written by the same response that set the cookie whose lifetime is in question, and being
 * server-set it survives the ITP wipe that destroys the tier evidence entirely. The fallback is
 * kept for the one topology where the marker is genuinely unreadable — a UI on a sibling subdomain,
 * which `CookieDeliveryCheck` warns about at boot — and there it degrades to the old behaviour
 * rather than to a guess.
 *
 * **This answers the user's choice only, never "where can I write".** Those are two questions, and
 * ANDing them is the bug described above. The storage question is asked separately, at the write,
 * by {@link localStorageWritable}.
 */
export function sessionRemembered() {
  const hint = readHint();
  if (hint !== null) return hint === HINT_REMEMBERED;
  return tokensRemembered();
}

/**
 * Whether the persistent tier can actually be written to — a real round trip, because
 * `typeof localStorage` and even a successful `getItem` all pass in the modes that reject writes
 * (Safari private browsing, blocked storage).
 *
 * Asked at the *write*, never folded into `sessionRemembered`. `writeKeyed` picks `localStorage`
 * when told to remember, swallows the failed `setItem`, and then purges `sessionStorage` — so
 * writing a remembered token into a store that throws lands it nowhere at all, and every page load
 * would churn a fresh rotation. Answering "no" here demotes only the local tier and leaves the
 * server's 30-day cookie, and the hint that records the choice, intact.
 *
 * A *successful* probe is remembered for the life of the document, and that asymmetry is the whole
 * point of the cache. `setItem` followed by `removeItem` fires two `storage` events in every OTHER
 * tab on this origin, and five listeners in this app are still unfiltered by key — so an
 * unmemoised probe made each token rotation (every fifteen minutes, per tab) wake work in tabs that
 * had no interest in it. A *failed* probe is not cached and is simply re-run, because a throwing
 * `setItem` writes nothing and therefore emits no event: re-asking is free. That is also the
 * direction where caching would actually hurt. "Cannot write" is the answer that demotes the
 * session to the tab-scoped tier, and it is the one that can be transient — a quota that another
 * tab has since freed, a permission the user has since granted. Caching the cheap-to-recheck,
 * self-correcting answer and pinning the expensive, sticky one would have been exactly backwards.
 *
 * Caching `true` cannot go stale in a way that matters, because this function is not the authority
 * on anything: the real `setItem` in `writeKeyed` runs immediately afterwards, inside its own
 * `try`. If writability disappears between the probe and the write, that write throws and is
 * handled there. This is a hint used to choose a tier, not a guarantee.
 */
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

/**
 * Erase every trace of the session this browser can reach.
 *
 * The hint cookie is cleared here, not only by the server's `Set-Cookie` on logout, because
 * `authProvider.logout` posts `/auth/logout` best-effort and swallows a `NetworkError`. Without
 * this line a sign-out on a flaky connection clears storage, tells the user they are signed out —
 * and leaves `draazy_session` in the jar beside an unrevoked refresh cookie. The next cold boot
 * reads the hint, spends the cookie and **signs them back in**; on a shared machine, into the
 * previous user's account. That was impossible before the hint existed, because nothing could
 * refresh without an access token. This is also why deliberately not making the cookie `HttpOnly`
 * is load-bearing in both directions: the client has to be able to delete it.
 *
 * The name, path and domain must match the server's `hintBase()`, because those three are a
 * cookie's identity — a "clear" built with a different path leaves the original sitting there.
 * `Secure` matters for a different and stronger reason: a browser rejects *any* `Set-Cookie` whose
 * name begins with `__Host-` and lacks `Secure`, so on HTTPS the clear would not merely miss, it
 * would be discarded unread. Both spellings are cleared because the page cannot know which one the
 * server chose (see `HINT_COOKIE` above); the one that does not exist is a no-op, and the
 * unprefixed clear is skipped on HTTPS only in the sense that it cannot affect a `__Host-` cookie.
 */
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
export const firstName = (u) => ((u && u.name) || '').trim().split(/\s+/)[0] || 'Account';
export const initial = (u) => (firstName(u)[0] || 'A').toUpperCase();
export const isInternal = (u) => !!u && (u.role === 'admin' || u.role === 'manager' || u.role === 'staff');
