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
  `TeamRoute`, `ModuleRoute`, `FlagRoute`, `AppFlagRoute` gate back-office and flagged areas. All
  guards are UX-only. See auth + guards in
  [`../../system/cross-cutting.md`](../../system/cross-cutting.md) (section 1).

## 4. Entities touched
- [`users`](../../system/data-model.md) - the session user object
  (`{ name, mobile, role, loginAt }`) written to storage; on sign-up also appended to the local
  account registry (`puneNestUsers`).
- [`aadhaar_verifications`](../../system/data-model.md) - not written here. The DigiLocker Verified
  badge (L2) is an **opt-in trust signal** that layers on top of auth — it is **not** a gate for
  posting or contacting (mobile-OTP sign-in / L1 is the only floor; see
  [contact-gate-leads.md](./contact-gate-leads.md) and ADR-019).
- [`referrals`](../../system/data-model.md) - a `?ref=` code present at sign-up is stored via
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
