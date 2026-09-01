/**
 * HTTP auth provider — the only auth provider. `authService.js` is the seam it plugs into, and
 * `AuthContext` talks to that rather than to this file directly.
 *
 * Its shape still reflects the two-provider era in one respect worth keeping: real login is
 * **two round-trips** (send OTP, then verify), so `sendOtp` is its own method rather than a
 * parameter of `login`.
 */
import { get, patch, persistTokens, post, unwrapPage } from '../../http.js';
import { logoutUser, writeUser } from '../../../lib/auth.js';

/**
 * Step 1: ask the server to dispatch a login code. Resolves to `{ otpSent: true }`.
 *
 * `turnstileToken` rides as a header rather than a body field, which is what keeps the
 * `/auth/login` request schema — and therefore the OpenAPI contract — unchanged (tech-debt D130).
 * Undefined when the challenge is switched off, in which case the header is omitted entirely and
 * the server passes the request through.
 *
 * This is the step worth protecting: it is the one that spends an SMS, so a script hammering it
 * costs real money whether or not it ever guesses a code.
 */
export const sendOtp = ({ mobile, turnstileToken }) => post(
  '/auth/login',
  { mobile },
  { auth: false, headers: turnstileToken ? { 'CF-Turnstile-Response': turnstileToken } : undefined },
);

/**
 * Step 2: verify the code and open a session. First-time mobiles are provisioned server-side as
 * `buyer`, so there is no separate sign-up call — which is why the mock's local user registry has
 * no counterpart here.
 *
 * `remember` is sent as well as applied locally: it decides the storage tier here, but only the
 * server can scope the refresh cookie, and a cookie outliving the tab the user asked to forget
 * would leave the longer-lived half of the session behind.
 */
export async function login({ mobile, otp, remember = true }) {
  const data = await post('/auth/login', { mobile, otp, remember }, { auth: false });
  return openSession(data, remember);
}

export async function register({ name, email, mobile, otp, remember = true }) {
  const user = await login({ mobile, otp, remember });
  // The server provisions a nameless buyer from the mobile alone — `/auth/login` has no field for a
  // display name — so the sign-up details are applied as a follow-up profile patch.
  const profile = {};
  if (name) profile.name = name;
  if (email) profile.email = email;
  return Object.keys(profile).length ? updateMe(profile) : user;
}

/**
 * Email + password sign-in for internal accounts (contract {@code POST /auth/staff-login}).
 *
 * The `/staff-login` screen does **not** come here: staff sign in on that screen through
 * `sendOtp` + `login`, because D206 removed the password from `POST /users/staff` and a staff
 * account therefore has no password until its holder redeems an emailed invite. This stays because
 * the endpoint is real and accounts that *have* redeemed one can use it — but a caller that reaches
 * it without credentials has almost certainly passed the OTP screen's user object by mistake, and
 * gets a message saying so rather than a bare 422 from the server.
 */
export async function staffLogin({ email, password, remember = true }) {
  if (!email || !password) {
    throw new Error(
      'Staff login needs email + password. The /staff-login screen signs staff in with mobile + ' +
        'OTP via /auth/login instead — call login() rather than staffLogin() from there.',
    );
  }
  const data = await post('/auth/staff-login', { email, password, remember }, { auth: false });
  return openSession(data, remember);
}

/**
 * End the session. The local session is cleared even if the server call fails — a user who clicks
 * "sign out" must end up signed out regardless of connectivity, and the server-side refresh family
 * expires on its own.
 *
 * The server call now does something the client cannot do for itself: revoke the family *and*
 * expire the `__Host-punenest_rt` cookie. `logoutUser()` clears `localStorage`, and an `HttpOnly`
 * cookie is by definition beyond its reach — so if the request fails, the browser keeps a live
 * refresh cookie behind a UI that says signed out. Two cases, and only one is real:
 *
 * - **Expired access token.** Not a problem: `request()` treats the 401 as the expected steady
 *   state, refreshes and replays, so the logout lands. It self-heals precisely because the cookie
 *   is still good, which is the same condition that made the worry.
 * - **Server unreachable.** The cookie survives, and nothing can be done about it from here — a
 *   public logout route would not help, because the request itself is what failed. Worth being
 *   clear-eyed about the residue: on a shared machine this leaves a spendable 30-day credential in
 *   the profile, and any script on the origin can spend it directly with `credentials: 'include'`.
 *   That is the same exposure an unclosed tab already carries, and it is bounded by the same thing:
 *   a session cookie when "remember" was off dies with the browser.
 *
 *   What *this* app does with it is no longer "nothing", and the difference matters. The cold-boot
 *   restore added for Safari's ITP eviction is precisely a path that refreshes without an access
 *   token, so if the session hint were left behind, the next launch would read it, spend the
 *   surviving cookie and sign the user back in — on a shared machine, into the account of whoever
 *   pressed sign-out. That is why `logoutUser()` expires the hint itself rather than relying on this
 *   request's `Set-Cookie`: the hint is the one part of the residue the client *can* reach, and
 *   removing it puts the app back in the position the paragraph above used to describe for free.
 */
export async function logout() {
  try {
    await post('/auth/logout');
  } catch {
    /* best-effort */
  }
  logoutUser();
  return null;
}

/** Re-read the profile from the server and refresh the cached copy that guards and headers read. */
export async function getMe() {
  const user = await get('/auth/me');
  writeUser(user);
  return user;
}

export async function updateMe(body) {
  const user = await patch('/auth/me', body);
  writeUser(user);
  return user;
}

/**
 * `GET /me/data-export` — the DPDP right of access, answered by the system of record.
 *
 * Returns the server's document as-is rather than reshaping it. Its own `schemaVersion`,
 * `redactionRule` and `excluded[]` fields are part of what the subject is entitled to receive: an
 * export that quietly dropped the list of what was left out would be a worse answer than one that
 * names it. A counterparty appears as an opaque `partyRef`, never as a name — the subject's right
 * of access is not a right of access to somebody else.
 */
export async function exportMyData() {
  return get('/me/data-export');
}

/**
 * `POST /me/erasure` — file a DPDP erasure request.
 *
 * A request, not a deletion. The account may be the counterparty on a live tenancy or a settled
 * payment, so the decision is a reviewed one and the response is the filed record, not a tombstone.
 */
export async function requestErasure({ reason } = {}) {
  return post('/me/erasure', { reason: reason || '' });
}

/**
 * `GET /me/erasure` — the caller's own erasure requests.
 *
 * The server returns only pending and rejected ones: an approved request has already taken the
 * account with it, so there is nobody left to read the list.
 */
export async function myErasureRequests() {
  return unwrapPage(await get('/me/erasure'));
}

/**
 * Persist a token-bearing `AuthResponse`. The access token and the user go into the same storage
 * tier so "remember this device" governs both, and neither can outlive the other.
 *
 * The refresh token is no longer among them — it is an `HttpOnly` cookie, so its lifetime is the
 * server's to set, not this function's. `remember` is passed to the login call for exactly that
 * reason: the server mints a persistent or a session cookie to match, keeping the cookie's tier in
 * step with the storage tier chosen here. They are aligned deliberately rather than structurally,
 * which is why the flag has to travel instead of being inferred at either end.
 */
function openSession(data, remember) {
  persistTokens(data, remember);
  writeUser(data.user, remember);
  return data.user;
}
