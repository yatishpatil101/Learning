# Flow: Authentication (Sign In / Sign Up / Session)

> Mobile + OTP authentication for consumers, with a role stamped at sign-up, a
> localStorage-backed session, and UX-only route guards. Mobile-OTP sign-in is **L1** — the trust
> ladder's floor for posting and contacting (ADR-019); the DigiLocker Verified badge (L2) is opt-in.
> **Status:** documented from React source · re-synced to ADR-019 (badge-not-gate) - **Primary role(s):** buyer, owner (consumer door); staff/admin use a separate door

---

## 1. Purpose & user problem
- **Persona:** property seekers (`buyer` / tenant) and property owners (`owner`). Back-office users
  (`admin` / `manager` / `staff`) sign in through a separate door and are out of scope here.
- **Job-to-be-done:** "Let me into my account with just my phone number, remember me, and drop me
  back into whatever I was trying to do (save a home, contact an owner, book a visit)."
- **Why it matters:** auth is the top of every gated funnel. Saving, contacting owners, alerts,
  visits, listing a property and the dashboard all bounce a signed-out user here first, so the
  sign-in copy is made contextual to lift conversion (see `authIntent.js`).

## 2. Entry points
- **Routes:**
  - `/signin` - consumer sign in (`src/pages/consumer/Signin.jsx`).
  - `/signup` - consumer sign up (`src/pages/consumer/Signup.jsx`).
  - `/staff-login` - back-office door (`src/pages/consumer/StaffLogin.jsx`); separate flow.
- **Query params carried in:** `?next=<path>` (post-auth return), `?reason=<key>` (explicit intent
  copy), `?mobile=<digits>`, `?new=1` (sign-in bounced an unknown number to sign-up), `?ref=<code>`
  (referral, applied on sign-up).
- **Triggers:** `ProtectedRoute` redirects (`/signin?next=...`), the header account button, the
  "Sign In / Sign Up" nav links, and every in-page gate (contact owner, save, alerts, schedule
  visit, list property).
- **Source components:** `Signin.jsx`, `Signup.jsx`, shared auth kit under
  `src/components/auth/` (`useOtpFlow.js`, `OtpBoxes.jsx`, `AuthShell.jsx`, `MobileAuthIntro.jsx`),
  `MobileField.jsx`, `src/lib/authIntent.js`, `src/lib/auth.js`, `src/context/AuthContext.jsx`,
  `src/components/RouteGuards.jsx`.

## 3. Actors & roles
- **Anyone** can open `/signin` and `/signup` (public routes).
- **Role selection:** the consumer sign-up currently hardcodes `role = 'buyer'`
  (`const [role] = useState('buyer')` in `Signup.jsx`); there is no owner/buyer picker on the form.
  A returning member's role is restored from the local registry on sign-in (see below). Owner
  capabilities appear once a user posts a listing; the role label is cosmetic today.
- **Guards:** consumer pages use `ProtectedRoute` (requires any signed-in user). `RoleRoute`,
  `ModuleRoute`, `FlagRoute`, `AppFlagRoute` gate back-office and flagged areas. All
  guards are UX-only. (`TeamRoute` was deleted with the five per-team ops desks — team scoping is
  the server's job now; see `../ops/service-queues.md`.) See auth + guards in
  [`../../system/cross-cutting.md`](../../system/cross-cutting.md) (section 1).

## 4. Entities touched
- [`users`](../../system/data-model.md) - the session user object
  (`{ name, mobile, role, loginAt }`) written to storage; on sign-up also appended to the local
  account registry (`draazyUsers`).
- [`aadhaar_verifications`](../../system/data-model.md) - not written here. The DigiLocker Verified
  badge (L2) is an **opt-in trust signal** that layers on top of auth — it is **not** a gate for
  posting or contacting (mobile-OTP sign-in / L1 is the only floor; see
  [contact-gate-leads.md](./contact-gate-leads.md) and ADR-019).
- [`referrals`](../../system/data-model.md) - a `?ref=` code present at sign-up is stored via
  `setReferredBy(ref)` **and** posted to the server with `redeemReferral(ref, 'link')`. The second
  half was missing until D233, which meant the code being shared was one the browser had minted and
  `POST /referrals/redeem` could not resolve.

## 5. Business rules & logic  *(the meat)*

### OTP flow
- **The server validates the code.** `useOtpFlow.js` owns only the *send* step and the 30-second
  resend cooldown; the code itself is checked by `POST /auth/login`, which stores it hashed,
  single-use and expiring, and counts attempts (`OtpService`). A wrong code is refused.
  This section previously read "any 6 digits pass — never validates the code", which was true of
  the deleted mock and is worth keeping visible as a correction: a reader threat-modelling from
  the old text would have concluded the OTP was decorative.
- The hook still defaults to a simulated 700 ms dispatch for the **non-auth** verification flows
  that remain mocked (owner consent, society hub, flatmates). Auth pages pass the real service.
- Sign in: `submit()` requires a valid 10-digit mobile, then requires `otpSent`, then requires
  `otp.length === 6` before posting mobile + code to the server.

### Sign in (`Signin.jsx`)
- **Mobile normalisation:** `useMobileInput` + `MobileField`; a valid number is exactly 10 digits.
- **No unknown-number handoff.** A branch here once asked `!userExists(mobile)` against the browser
  registry and detoured to `/signup?new=1`. It is gone and will not return in that form: a public
  "does this mobile have an account?" check is a user-enumeration oracle. The server provisions an
  account on the first verified login, so a known and an unknown number take the identical path.
- **Identity comes from the server.** A verified login returns the profile (`SelfProfile`); `name`
  and `role` are sent as hints and ignored. There is no local registry to restore from.
- **Remember this device:** a checkbox (default on) chooses the storage tier (see Session below).
- **Redirect:** `login({...})` then `navigate(postAuthDest(params))` - honours `?next=`, else
  `/dashboard`.

### Sign up (`Signup.jsx`)
- **Validation (`validateBase`):** `name.trim().length >= 2`; email optional but if present must
  match `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`; mobile must be valid 10 digits; Terms checkbox must be
  checked. Errors are per-field booleans with inline messages.
- **Role:** always `buyer` (see Actors).
- **Referral capture:** on success, if `?ref=` present, `setReferredBy(ref)` **and**
  `redeemReferral(ref, 'link')` → `POST /referrals/redeem`. This line used to read "on success, if
  `?ref=` present, `setReferredBy(ref)`" and nothing else, which was the whole of attribution: the
  server's redeem endpoint had shipped and nothing had ever called it, so no referral outside the
  seed data had ever reached the fraud desk (D233). The redeem call is deliberately un-awaited and
  its failure swallowed — a 409 means the code was unknown, self-referred or already redeemed, and
  the person who just signed up chose none of those and can fix none of them.
- **Redirect:** same `postAuthDest(params)` (`?next=` else `/dashboard`).

### Contextual intent copy (`authIntent.js`)
- `resolveAuthIntent(params)` picks heading/sub from an explicit `?reason=` key, else infers a
  reason from the `?next=` path (`/saved` -> `save`, `/schedule-visit` -> `schedule`,
  `/list-property` -> `listproperty`, `/checkout` -> `checkout`, `/services` -> `services`, etc.),
  else falls back to the default "Welcome Back".
- `postAuthDest(params)` is the single shared post-auth destination for both screens: `?next=` or
  `/dashboard`.

### Session persistence (`src/lib/auth.js`)
- **Keys:** `draazyUser` (the cached profile) and `draazyTokens` (the 15-minute access token).
  A third key, `draazyUsers`, held the mock's array of completed sign-ups and is gone with it —
  registration is server-side now, on first verified login.
- **The refresh token is not here.** It is set by the server as an `HttpOnly; Secure; SameSite=Lax`
  cookie named `__Host-draazy_rt` at `Path=/`, so no script on the page can read it. The `__Host-`
  prefix is load-bearing: it is what makes the browser *enforce* host-only scoping, so no other host
  under the registrable domain can plant a same-named cookie and choose which session we see. The
  client asks for the cookie implicitly — every `fetch` in
  `services/http.js` runs with `credentials: 'include'` — and never sees the value.
- **Two tiers, one session:** `writeUser(user, remember)` writes to `localStorage` when
  "remember this device" is on, else `sessionStorage` (tab-scoped). It always clears the other tier,
  so exactly one tier holds the session. `readUser()` prefers `localStorage`, then `sessionStorage`.
  Storage access is wrapped in try/catch so private mode degrades gracefully. `remember` is sent to
  the server as well, because only the server can scope the cookie: on `false` it issues a session
  cookie, so the long-lived half cannot outlive the tab the user asked to forget.
- **Nothing here is authoritative.** The cache exists so a reload repaints the right UI before
  `/auth/me` answers; every read and write is re-authorised server-side. In particular `permissions`
  is returned **verbatim** as the server resolved it (role ceiling ∩ `back_office_permissions`).
  It is deliberately not re-derived from the role: that could only ever widen a narrowed account.
- **Session object:** whatever `SelfProfile` returned — `{ id, name, mobile, role, ... }`, plus
  `permissions` for back-office roles only (the key is omitted entirely for buyers and owners).
- `logoutUser()` clears both keys from both tiers, **and** expires the session-hint cookie. The
  refresh token itself is cleared only by the server, which is the only party that can — it is
  `HttpOnly`, and `POST /auth/logout` answers 204 with a `Set-Cookie` that expires it. The hint is
  the deliberate exception: it is readable precisely so the page can delete it, because
  `authProvider.logout` posts best-effort and swallows a `NetworkError`. Without the client-side
  clear, a sign-out on a flaky connection would leave the marker in the jar beside an unrevoked
  refresh cookie, and the next cold boot would spend it and sign the user back in — on a shared
  machine, into the previous user's account.
- **The session hint** (`__Host-draazy_session`, or `draazy_session` on plain-http dev) is a
  server-set, deliberately readable cookie carrying `1` or `0` — remembered or tab-scoped — and no
  identity. It exists for Safari's ITP, which wipes script-writable storage after seven days without
  first-party interaction while leaving server-set cookies alone: without it, an empty `localStorage`
  is indistinguishable from "signed out", and a remembered session would silently mean seven days
  instead of thirty. `sessionHinted()` is what lets the cold-boot path spend a refresh for the users
  who have a session to recover and spend nothing for the anonymous majority; `sessionRemembered()`
  reads its *value* so the recovery restates the right lifetime instead of demoting the cookie it
  just rescued. `localStorageWritable()` is a separate question asked at the write — see
  `docs/system/cross-cutting.md` for why those two must not be merged.
- Helpers: `roleLabel`, `firstName`, `initial`, `isInternal` (admin/staff).

> **The browser holds a cache, not a session.** The credential is a rotating refresh token
> (hashed server-side in `refresh_tokens`, 30d) plus a 15-minute access JWT; the OTP is real,
> and identity, roles and permissions are all resolved by the server.
> What sits in `localStorage` is a plain, user-editable JSON blob and the short-lived access token.
> The long-lived half is out of reach of any script on the page, so an XSS that reads storage steals
> at most fifteen minutes rather than a month.

## 6. Maker-checker / approval
- **Not applicable.** Sign in / sign up have no proposer-approver step. (The opt-in Verified-badge
  flow and the owner contact-approval that sit downstream of auth follow the maker-checker pattern -
  see [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 2 and
  [contact-gate-leads.md](./contact-gate-leads.md).)

## 7. State machine
```
signed out
   |  open /signin
   v
enter mobile --(unknown number & signups on)--> redirect /signup?new=1
   |  valid 10 digits
   v
OTP sent (30s resend timer) --(any 6 digits)--> verifying (1.4s) --> signed in
   |                                                                    |
   |                                                                    v
   |                                                        writeUser -> localStorage (remember)
   |                                                                 or sessionStorage (tab only)
   v                                                                    |
logout <---------------------------------------------------------------+
```
- **Terminal states:** `signed in` (until logout or storage cleared) and `signed out`.
- Sign-up adds a `register()` step (registry write) before the same signed-in state.

## 8. Edge cases, validation & error states
- **Invalid mobile:** inline "Please enter a valid 10-digit mobile number"; blocks OTP send/submit.
- **Incomplete OTP:** `otp.length < 6` shows "Please enter the complete 6-digit OTP".
- **Unknown number on sign-in:** redirected to sign-up with `new=1` and a "we couldn't find an
  account" banner (only when sign-ups are enabled).
- **Sign-ups disabled (`signupsEnabled` off):** no Sign Up link; sign-in accepts any number and
  self-provisions ("Just enter your number above - we'll set you up").
- **Terms not accepted (sign-up):** "Please accept the terms to continue".
- **Private/blocked storage:** `stores()` and read/write are try/catch-guarded; the session simply
  won't persist rather than throwing.
- **Tab vs device scope:** unchecking "remember" scopes the session to the tab (sessionStorage); a
  new tab starts signed out.
- **No concurrency control:** two tabs can write different users; `writeUser` clearing the other
  tier keeps a single tier authoritative but does not reconcile cross-tab edits.
