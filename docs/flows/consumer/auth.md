# Flow: Authentication (Sign In / Sign Up / Session)

> Mobile + OTP authentication for consumers, with a role stamped at sign-up, a
> localStorage-backed session, and UX-only route guards.
> **Status:** documented from React source - **Primary role(s):** buyer, owner (consumer door); staff/admin use a separate door

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
  `TeamRoute`, `ModuleRoute`, `FlagRoute`, `AppFlagRoute` gate back-office and flagged areas. All
  guards are UX-only. See auth + guards in
  [`../../system/cross-cutting.md`](../../system/cross-cutting.md) (section 1).

## 4. Entities touched
- [`users`](../../system/domain-model.md) - the session user object
  (`{ name, mobile, role, loginAt }`) written to storage; on sign-up also appended to the local
  account registry (`puneNestUsers`).
- [`aadhaar_verifications`](../../system/domain-model.md) - not written here, but Aadhaar/KYC is a
  separate gate that layers on top of auth for contacting owners and listing (see
  [contact-gate-leads.md](./contact-gate-leads.md)).
- [`referrals`](../../system/domain-model.md) - a `?ref=` code present at sign-up is stored via
  `setReferredBy(ref)`.

## 5. Business rules & logic  *(the meat)*

### OTP flow (mock)
- **SMS-only, any 6 digits pass.** `useOtpFlow.js` simulates send (700 ms), a 30-second resend
  cooldown, and never validates the code - the UI literally says "Demo mode - enter any 6 digits".
- Sign in: `submit()` requires a valid 10-digit mobile, then requires `otpSent`, then requires
  `otp.length === 6`, then fakes a 1400 ms verify before logging in.

### Sign in (`Signin.jsx`)
- **Mobile normalisation:** `useMobileInput` + `MobileField`; a valid number is exactly 10 digits.
- **Unknown-number handoff:** when sign-ups are enabled (`signupsEnabled` app flag) and
  `!userExists(mobile)`, `sendOtp()` redirects to `/signup?mobile=...&new=1` (carrying `next` and
  `reason`) instead of sending an OTP - so a new visitor finishes registration rather than hitting a
  dead end. With sign-ups off, it just sends the OTP (any number can sign in).
- **Restore identity:** on success, `findUser(mobile)` looks up the local registry to restore the
  member's real `name` and `role`; falls back to name `"PuneNest Member"` and role `buyer`.
- **Remember this device:** a checkbox (default on) chooses the storage tier (see Session below).
- **Redirect:** `login({...})` then `navigate(postAuthDest(params))` - honours `?next=`, else
  `/dashboard`.

### Sign up (`Signup.jsx`)
- **Validation (`validateBase`):** `name.trim().length >= 2`; email optional but if present must
  match `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`; mobile must be valid 10 digits; Terms checkbox must be
  checked. Errors are per-field booleans with inline messages.
- **Role:** always `buyer` (see Actors).
- **Referral capture:** on success, if `?ref=` present, `setReferredBy(ref)`.
- **Redirect:** same `postAuthDest(params)` (`?next=` else `/dashboard`).

### Contextual intent copy (`authIntent.js`)
- `resolveAuthIntent(params)` picks heading/sub from an explicit `?reason=` key, else infers a
  reason from the `?next=` path (`/saved` -> `save`, `/schedule-visit` -> `schedule`,
  `/list-property` -> `listproperty`, `/checkout` -> `checkout`, `/services` -> `services`, etc.),
  else falls back to the default "Welcome Back".
- `postAuthDest(params)` is the single shared post-auth destination for both screens: `?next=` or
  `/dashboard`.

### Session persistence (`src/lib/auth.js`)
- **Key:** `puneNestUser`. **Registry key:** `puneNestUsers` (array of completed sign-ups, keyed by
  10-digit mobile; idempotent re-registration via `registerUser`).
- **Two tiers, one session:** `writeUser(user, remember)` writes to `localStorage` when
  "remember this device" is on, else `sessionStorage` (tab-scoped). It always clears the other tier,
  so exactly one tier holds the session. `readUser()` prefers `localStorage`, then `sessionStorage`.
  Storage access is wrapped in try/catch so private mode degrades gracefully.
- **Session object:** consumer login stamps `{ name, mobile, role, loginAt }`. Staff login
  additionally stamps `team`, `teams[]`, `roleId`, `moduleAccess[]` (admin gets `team: null`).
- `logoutUser()` clears both tiers.
- Helpers: `roleLabel`, `firstName`, `initial`, `isInternal` (admin/manager/staff).

> **Everything above runs in the browser.** No password, no server, no real OTP, no real identity.
> The session is a plain, user-editable JSON blob in `localStorage`.

## 6. Maker-checker / approval
- **Not applicable.** Sign in / sign up have no proposer-approver step. (The Aadhaar/KYC gate and
  owner contact-approval that sit downstream of auth follow the maker-checker pattern - see
  [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 2 and
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

## 9. Current mock implementation
- **Service:** `src/services/authService.js` -> `login`, `staffLogin`, `logout`, `getMe`,
  `updateMe` (all return Promises). NB: the auth *pages* call `AuthContext` / `lib/auth.js`
  directly today; the service seam wraps the same `lib/auth.js`.
- **Provider:** `src/services/providers/mock/authProvider.js` (wraps `lib/auth.js`; `updateMe`
  merges a patch and re-writes the user).
- **Core lib:** `src/lib/auth.js` (`readUser`, `writeUser`, `loginUser`, `staffLoginUser`,
  `registerUser`, `readUsers`, `findUser`, `userExists`, `logoutUser`).
- **React context:** `src/context/AuthContext.jsx` (`useAuth()` -> `{ user, isIn, role, team,
  login, register, staffLogin, logout, update }`; lazy-inits from `readUser()`).
- **Guards:** `src/components/RouteGuards.jsx`, wired in `src/App.jsx`.
- **Key components:** `Signin.jsx` (`sendOtp`, `submit`), `Signup.jsx` (`validateBase`, `submit`),
  `src/components/auth/useOtpFlow.js`, `src/lib/authIntent.js` (`resolveAuthIntent`, `postAuthDest`).

## 10. Target API endpoints
Map to [`../../system/api-contract.md`](../../system/api-contract.md) (section 1, Auth):
- `POST /auth/login` - OTP-verified mobile login -> `{ token, user }`. Replaces `loginUser` +
  the fake verify. Request should carry `{ mobile, otp, remember }`.
- `POST /auth/staff-login` - back-office door (separate).
- `POST /auth/logout` - invalidate session/JWT. Replaces `logoutUser`.
- `GET /auth/me` - resolve current user from the Bearer token (replaces `readUser`).
- `PATCH /auth/me` - profile update (replaces `updateMe` / `AuthContext.update`).
- Missing from the current contract but implied by the flow: an OTP *send* endpoint
  (`POST /auth/otp` or similar) and a registration endpoint (`POST /auth/register`) distinct from
  login. Today OTP-send and registration are client-only. Referral capture (`?ref=`) should be a
  field on register.

## 11. Backend responsibilities
- **Real OTP:** generate, deliver via SMS, rate-limit, and verify a real code - never accept "any 6
  digits". Enforce the 30s resend server-side.
- **Issue and validate JWTs.** The session must be a signed token, not an editable localStorage
  blob. Return `{ token, user }`; the client stores the token and calls `/auth/me`.
- **Own the user registry.** `userExists` / `findUser` / `registerUser` must become server queries;
  the client cannot be trusted to decide who is a returning member or what their role is.
- **Authoritative role.** Role must be assigned/stored server-side, not inferred from a local
  object; the client `role` is a display hint only.
- **Authorize every request** by role/team on the server (all route guards are cosmetic - see
  [`../../system/cross-cutting.md`](../../system/cross-cutting.md)).
- **Referral integrity:** validate `?ref=` codes and attribute referrals server-side.
- **`remember` semantics:** map to token lifetime / refresh policy on the server rather than a
  storage-tier choice in the browser.
