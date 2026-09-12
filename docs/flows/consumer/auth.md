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
- **The server validates the code.** `useOtpFlow.js` owns only the *send* step and the countdown to
  the next resend; the code itself is checked by `POST /auth/login`, which stores it hashed,
  single-use and expiring, and counts attempts (`OtpService`). A wrong code is refused.
  This section previously read "any 6 digits pass — never validates the code", which was true of
  the deleted mock and is worth keeping visible as a correction: a reader threat-modelling from
  the old text would have concluded the OTP was decorative.
- **The countdown is the server's number, not the browser's.** The send response carries
  `resendAfterSeconds` — `OtpSendBudget`'s configured cooldown, 60s in a deployment and 0 where a
  mock sender rings no phone — and the hook counts exactly that down. It was a hardcoded 30s, half
  the deployed gap, so the button came back while the server still refused and a caller who waited
  for it was answered with a rate-limit error instead of a code. No constant could have been right
  in every environment, which is why the number travels with the acknowledgement.
- The hook still defaults to a simulated 700 ms dispatch for the **non-auth** verification flows
  that remain mocked (owner consent, society hub, flatmates). Auth pages pass the real service.
- **The countdown is measured against the wall clock, not against interval ticks.** This is the one
  flow that guarantees the user leaves the page — they switch to their SMS app to read the code —
  and a hidden tab's timers are throttled to a crawl or suspended outright on iOS. A tick-counting
  timer therefore under-counts exactly when it is being used properly, stranding a person behind a
  disabled button long after the server would have allowed the resend. The hook holds a deadline and
  re-reads the clock on `visibilitychange`, which is the only thing that makes the number correct at
  all on a platform that suspended the interval.
- **A refusal that carries `retryAfterSeconds` restarts the countdown.** Without it the button is
  live the instant the error renders (`canResend` only asks whether the timer ran out), so the only
  response the screen offers is the one that just failed and a frustrated person collects one
  rate-limit error per press. The server's figure is the wait *remaining*, so re-using it never
  over-charges the user.
- Sign in: `submit()` requires a valid 10-digit mobile, then requires `otpSent`, then requires
  `otp.length === 6` before posting mobile + code to the server.

### Backend: OTP budgets, attempt cap and boot guards

*Home of the reasoning behind `OtpService`, `OtpSendBudget`, `OtpCodeRepository` and `AuthResponse`.*

- **Three send limits, two keys.** The per-mobile cooldown (`SEND_COOLDOWN`, 60s) and the per-mobile
  window ceiling (`MAX_SENDS_PER_WINDOW`, 5 per `SEND_WINDOW`) are keyed on the recipient, because the
  number is what gets harassed and billed and is the one thing an attacker cannot rotate while still
  attacking a chosen victim. `MAX_PLATFORM_SENDS_PER_WINDOW` (500/hour) is keyed on nothing, for the
  attacker who does not care whose phone rings: a script that rotates the recipient never spends a
  second slot against any single number, and the per-IP `WriteRateLimitFilter` is defeated by the same
  rotation. That one is a spend ceiling rather than a correctness limit, and is meant to be raised as
  the platform grows — what it buys is a bounded bill in the worst case.
- **The budget is the `otp_codes` rows, not a counter.** One row per send, so the rate limiter needs no
  counter table and stays correct across restarts and nodes. `OtpCodeRepository#findByMobileAndPurpose…`
  deliberately ignores `consumed` and `expiresAt` — it counts *sends*, and filtering them out would let
  an attacker reset the budget by verifying. The page is capped at the budget so one query answers both
  per-recipient questions: the newest row gives the cooldown, a full page means the window is spent, and
  its oldest row says when a slot reopens.
- **`noRollbackFor` is load-bearing on every transactional caller of a send.** Because the budget is
  derived from rows, a rollback refunds the attempt: no cooldown, no window slot, no trace. So
  `RateLimitedException` and `OtpSender.DeliveryFailedException` are named on `OtpService.sendCode`,
  `sendLoginCode`, `AuthService.login` and `FlatmateSupplyService.ownerConsent`. `noRollbackFor` is
  per-advice — it only stops *that* advice marking a shared transaction rollback-only, so a
  participating inner advice cannot enforce the rule for its callers. **A new transactional caller that
  omits it silently restores the refund:** nothing throws, no test goes red. The alternatives were
  worse: a `REQUIRES_NEW` inner commit lets the OTP row escape the rollback every `@Transactional` test
  relies on, and an after-commit hook does not fire under a test transaction at all.
- **The per-recipient check is taken under a lock held until the send commits.** Read-then-insert is not
  a budget under concurrency: two requests naming the same number both read the page before either
  writes, both find room, and both cause an SMS. `RateLimitLock#holdUntilCommit` is keyed on
  (mobile, purpose) so the two purposes do not queue behind each other. The platform ceiling is read
  *first* (once it is reached no per-number answer can let the send through) and without an additional
  lock: it is a ceiling in the hundreds, so concurrency can only cost an overshoot bounded by the sends
  in flight, and the alternative is a global mutex serialising every unrelated user's sign-in.
- **Why `OtpSendBudget` is a separate bean, and not `@Transactional`.** Issuing a code and deciding
  whether it is allowed share only a table. It must run inside the caller's transaction, because the
  lock has to hold until the *send* commits, and a new transaction would break that.
- **Refusals carry a truthful `Retry-After`**, rounded up so a client that obeys it exactly does not get
  a second 429, and the platform-ceiling message says nothing about the platform's state — it is
  returned to an unauthenticated caller who may be the attacker, and "you have exhausted our budget" is
  a completion signal.
- **Per-code attempt cap (default 3 of a 10^6 space).** Chosen for the honest typist, not the attacker:
  it is what a person can spend on a mistyped digit before the code dies. The boot refuses a cap outside
  1–20 — zero burns every code on first use (an outage that looks like a rate limit), unbounded hands an
  attacker the whole space against one delivered code. The remaining count is told to the caller so the
  screen can count down; it reveals nothing, since only the holder of the delivered code is in that
  branch and an attacker learns the same number by subtracting their own failures.
- **Codes are scoped by (mobile, purpose), and that is a security boundary.** The flatmates
  owner-consent flow sends to a landlord who usually has no account; sharing the `login` purpose would
  make "request consent" a way to mint *login* codes for any number a caller can name. Separate purposes
  also stop either flow exhausting the other's budget. The throttle itself is shared deliberately — two
  copies of a rate limiter is one copy that gets forgotten when the rule changes.
- **Two predictable-code keys, both fenced at boot.** `draazy.otp.fixed-code` is the e2e affordance (so
  a browser suite can type the code rather than scrape a shared log, which cannot tell two concurrent
  logins apart); `draazy.otp.sandbox-code` is sandbox's stand-in for a delivery channel it does not
  have. Only the choice of digits is weakened — still hashed, single-use, TTL'd, budgeted and
  attempt-capped, and verification is never special-cased. Two keys rather than an exemption, because an
  exemption is invisible in the prod properties file and no environment variable that means something in
  prod can set the sandbox one. `rejectFixedCodeInProduction` and `rejectSandboxCodeOutsideSandbox` kill
  the boot before the connector accepts traffic, keyed on
  `LocalProfileGuard.DEPLOYMENT_PROFILES` rather than a local `"prod"` literal, so a mistyped or
  unrecognised profile lands on the safe side and a superset activation such as `prod,sandbox` fails
  too. The runtime guards are not redundant with the properties pins: a classpath config-data file is
  the *lowest*-precedence source Spring consults, so `DRAAZY_OTP_FIXED_CODE` exported into a
  deployment's environment silently outranks both pins and only the boot check is left.The sandbox cost is real and accepted: a committed `000000`, seeded staff mobiles in the repo,
  and login that resolves a user by mobile — the guard keeps the blast radius to that one environment.
- **`AuthResponse` carries two shapes in one record** because the contract models login as a single
  dual-mode operation: the send step returns `{otpSent, resendAfterSeconds}` and no tokens, a completed
  verify/staff-login/refresh returns the token pair plus `user`. `NON_NULL` keeps each shape clean.
  `refreshToken` rides the record but is `@JsonIgnore`d — it leaves the server in an `HttpOnly` cookie,
  never in the body — and stays only because `AuthController` needs the raw value to build that cookie.
  The send acknowledgement publishes the *server's* cooldown so the "resend in Ns" counter matches what
  this environment will actually refuse on; a client-side constant can only be right in whichever
  environment it was copied from.
- **Every token response embeds `SelfProfile`, not the bare user mapper**, because the client caches
  the embedded user as its session identity — a sign-in that omitted the back-office atoms would leave
  the console with an empty sidebar until something called `GET /auth/me`.

### Backend: what stops an account obtaining a session

*Home of the reasoning behind `AuthService`.*

- **Three independent refusals, checked in a fixed order** (`refuseIfCannotYetAuthenticate`):
  suspension (V77), maker-checker approval (V67), then invite activation (V71). Suspension first
  because the other two name something the holder can chase, while a suspension is a decision taken
  about them — telling a suspended person to chase an approval sends them to bother an administrator
  who already knows. Its message names no reason and no moderator: the reason is in `audit_log`, and
  repeating it here hands the account exactly what is most useful for arguing with or evading the
  decision. Approval before activation so a colleague who is both unapproved and un-redeemed is told
  the thing an administrator can act on. An account with no approval/invite row is not subject to
  that gate — both queries are phrased as "is there an open row" so absence answers `false`.
- **Activation is a second gate, not a restatement of approval.** Neither administrator supplies a
  password, so a freshly minted account is passwordless — and passwordless is not unreachable, because
  `POST /auth/login` needs no password at all. A maker who typed their own number into the create form
  would hold the account the moment the checker approved it, and the checker saw only a name, an email
  and a role. Refusing until the invite is redeemed is what makes the co-signature attest to a person.
- **403, and only after the credential has been checked.** `staffLogin` verifies the password and
  `login` verifies the OTP before this runs, so a caller who reaches the message has already proved
  they hold the credential and learns nothing. A 401 would be honest about the outcome and useless to
  the blocked colleague, who would spend the morning retyping a correct password. The same ordering is
  why `staffLoginEnabled` is read *after* the password: a caller who could tell "staff sign-in is off"
  from "invalid credentials" holds an oracle sorting arbitrary emails into staff and not-staff.
- **`refresh` re-checks the same gate** rather than trusting "a refresh token can only exist if
  `issueFor` minted one". That is true by accident of today's write paths and nothing enforces it; the
  moment anyone holds an account that already exists — the obvious incident-response use of the
  approvals table — every live session would keep refreshing for the whole refresh TTL. Its
  `noRollbackFor(Unauthorized)` keeps the two revocations on that path (reuse-detection family burn,
  and revoke-all for an archived user), which are security actions taken *because* the request is being
  refused. `ForbiddenException` is deliberately absent, so a refused rotation rolls back and the
  caller's old token survives — harmless, because every attempt to spend it lands here again.
- **`signupsEnabled` is enforced in `findOrProvision`'s `orElseGet`**, the only branch that brings a
  consumer account into existence, and deliberately not at the send step: refusing before an OTP is
  checked would answer "is this mobile registered?" to an unauthenticated caller, the enumeration
  oracle `Signin` deleted its `userExists` probe to avoid. The corollary is that this flag is not an
  SMS-spend control — a frozen platform still delivers a code to every unknown number that asks. It
  throws 403 rather than 401 because the code has already been verified and burnt, so it must also be
  on `login`'s `noRollbackFor` list or one delivered code could be replayed for its whole TTL against a
  platform refusing new members. Staff-driven provisioning (`UserService.provisionForStaff`) is not
  gated: freezing public onboarding is about who may walk in, not whether the office may still take a
  listing over the phone. The gate sits at the caller rather than at the insert, so it holds only
  while `UserService.provisionBuyer` has exactly one caller — `AccountProvisioningGuardTest` pins
  that over the source text, and its failure message says what to do with a second one.
- **Staff login equalises work on an unknown email** with a dummy BCrypt hash, and never reveals which
  half failed; a null hash (a passwordless account) must also 401.

### Sign in (`Signin.jsx`)
- **Mobile normalisation:** `useMobileInput` + `MobileField`; a valid number is exactly 10 digits.
- **No unknown-number handoff.** A branch here once asked `!userExists(mobile)` against the browser
  registry and detoured to `/signup?new=1`. It is gone and will not return in that form: a public
  "does this mobile have an account?" check is a user-enumeration oracle. The server provisions an
  account on the first verified login, so a known and an unknown number take the identical path.
- **Identity comes from the server.** A verified login returns the profile (`SelfProfile`). The
  request carries the mobile and the code and nothing else — it used to also send `name` and `role`,
  which the server ignored, and this line used to describe them as "hints". They were removed: a
  field the server discards still reads, to anyone auditing the call, like something the client can
  influence about its own account. There is no local registry to restore from.
- **A first-time account is asked for its name here**, on a third step after the code is verified,
  because provisioning is nameless. Steps 1 and 2 are byte-identical for everyone, so the step is
  not an enumeration oracle: it is reached only *after* a code has been verified, by which point the
  caller has already proven the number is theirs. The trigger is the profile the server returned
  having no name — not "this row was just inserted" — so an older nameless account is asked too.
- **Profile validation:** the name is trimmed at the API boundary and must contain 2–80 characters;
  email remains optional and must be a valid address when present.
- **Remember this device:** a checkbox (default on) chooses the storage tier (see Session below).
- **Turnstile token lives in a ref, not state.** It changes whenever the widget solves or expires a
  challenge, and re-rendering the sign-in form on that can discard a solved challenge and make the
  user sit through another. The widget renders only when `VITE_TURNSTILE_SITE_KEY` is set, and the
  send button is deliberately *not* gated on a token — the server decides whether the challenge is
  required, so gating here would block sign-in on any deployment that has the widget but not the
  server flag.
- **A spent code is a sticky blocker.** Typing clears an ordinary error, but not this one: only a
  fresh code can help, so hiding the message on the next keystroke would walk the user straight back
  into a refusal. Only a refusal a fresh code cannot fix blocks the form — a busy limiter or a
  dropped connection leaves the guess intact and stays retryable.
- **Both success paths hold the confirmation on screen for a second before leaving.** `/signin` has
  no guest-only guard, so nothing force-unmounts the page; the navbar stays live for that second and
  a click made there would be stomped by a `replace: true` navigate that also destroys the history
  entry Back would have needed.
- **The "create an account" link carries the whole query string**, `next` and `reason` alike, because
  Signup calls the same `postAuthDest(params)` and a bare `/signup` link silently drops the
  destination the sender chose. This matters most for the rent-agreement gate, whose visitors are by
  its own premise the ones without an account.
- **The name step omits a blank email rather than sending one:** PATCH treats a present field as an
  overwrite, so `email: ''` would erase an address on the retry path.
- **Redirect:** `login({...})` then `navigate(postAuthDest(params))` - honours `?next=`, else
  `/dashboard` - except for an account provisioned moments ago, which gets `/listings`: every card
  on the hub is derived from real activity and a brand-new account has none, so it would open as a
  page of zeros at the moment of highest intent.

### Sign up (`Signup.jsx`)
- **Validation (`validateBase`):** `name.trim().length` must be 2–80; email optional but if present must
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
- **Redirect:** same `postAuthDest(params)` — `?next=`, else `/listings` **only if the account had
  no name before this authentication**, else `/dashboard`. This is not "sign-up always means new":
  there is no registration endpoint behind this screen, so `register()` is a sign-in plus a profile
  patch and a mobile that already has an account passes straight through it. Landing that person on
  the listings while `/signin` lands them on their dashboard would split one authentication across
  two destinations. Both doors therefore ask the same question, and `register()` returns `wasNew`
  because only it sees the profile *before* the patch — afterwards every account has a name.

### Staff login (`/staff-login`, `StaffLogin.jsx`)
- **Which half is real.** Against the live API the console signs in through the ordinary
  `/auth/login` mobile-OTP route — the same one consumers use — because that is the only staff
  sign-in the server offers a browser. `POST /auth/staff-login` is email+password, and a staff
  account has no password until its holder redeems an emailed invite, so a console demanding one
  could not sign in the very people it was built for.
- **Role and team are not a choice made in the browser.** The server returns the authenticated
  account's own role and team and this screen obeys them: the token it holds was minted for that
  account, and every API call behind the console is authorised server-side regardless of what the
  page believes. A picker here could only show an operator a console their token cannot load — which
  is why the old "I am signing in as" radio pair and the demo sign-in-as chips are gone rather than
  rendered inert.
- **Only administrators open the admin console.** `manager` went with the custom-role bundles it
  labelled; an ops staffer's permission atoms widen what the API grants them *inside* the service
  portal rather than promoting them to a different shell.
- **Safe `next` asks two separate questions:** is it a usable in-app path (`safeInAppPath`, shared
  with the consumer screens so the two doors cannot drift, and where the `/staff-login` self-redirect
  dead end is rejected), and does it match this role's access. Asking only the second let
  `?next=//evil.com` through, since it starts with neither `/admin` nor `/ops`.
- **A consumer who signs in here is signed back out.** The code was valid, so leaving the session
  open would sign a buyer in through the staff entrance and merely decline to redirect them — a
  console every route guard refuses reads as a broken product rather than a closed door.
- **The server's error sentence is kept verbatim**, because this console is internal and
  English-only. The remaining-guesses count is kept too: this screen posts to the same `/auth/login`
  and spends the same per-code budget, so without it a mistyped digit burns the code silently.

### Contextual intent copy (`authIntent.js`)
- `resolveAuthIntent(params)` picks heading/sub from an explicit `?reason=` key, else infers a
  reason from the `?next=` path (`/saved` -> `save`, `/schedule-visit` -> `schedule`,
  `/list-property` -> `listproperty`, `/checkout` -> `checkout`, `/services` -> `services`, etc.),
  else falls back to the default "Welcome Back".
- `postAuthDest(params, fallback)` is the single shared post-auth destination for both screens:
  `?next=` or the fallback, which is `/dashboard` for a returning user and `/listings` for an
  account that has just been created. The fallback is a parameter rather than a second copy of the
  safe-`next` rule, so neither screen can drift from the other on what counts as an in-app path.

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
- **`RefreshOriginGate` refuses a cross-site or same-site-sibling `POST /auth/refresh` with 403
  before the handler reads the cookie.** `SameSite=Lax` decides whether a cookie is *sent*, never
  whether one may be *set*, so without the gate any page could POST here and have the resulting 401
  expire the visitor's hint in their own jar — an unauthenticated write primitive that silently
  disables the ITP recovery. The same-site sibling case is the worse one and the only one an
  attacker actually gets: it *does* carry the cookie, so an ungated rotation would stale the
  visitor's token and their next refresh, well outside the grace window, would trip reuse-detection
  and burn every session they hold. Reading the response was never the point — CORS censors it — so
  the load-bearing property is that the token is still usable afterwards. The gate and
  `clearHint`'s own condition are both kept deliberately: one governs who may rotate, the other who
  may clear, and collapsing them would make one endpoint's behaviour depend on the other's
  reasoning. Note that MockMvc sends no `Sec-Fetch-Site` header, which is the "treat as ours"
  branch — so the whole condition could be deleted and every auth test bar the two in
  `AuthEndpointsTest` that pin it explicitly would stay green.
- Helpers: `roleLabel`, `firstName`, `initial`, `isInternal` (admin/staff).

> **The browser holds a cache, not a session.** The credential is a rotating refresh token
> (hashed server-side in `refresh_tokens`, 30d) plus a 15-minute access JWT; the OTP is real,
> and identity, roles and permissions are all resolved by the server.
> What sits in `localStorage` is a plain, user-editable JSON blob and the short-lived access token.
> The long-lived half is out of reach of any script on the page, so an XSS that reads storage steals
> at most fifteen minutes rather than a month.

### Client transport: 401 recovery, refresh coalescing and sign-out

The rules below live in `services/http.js`, `services/providers/http/authProvider.js` and
`context/AuthContext.jsx`. They are written down here because each of them is one "tidy-up" away
from signing real users out.

**401 → refresh → replay once.** An expired access token is the expected steady state, not an error.
The recovery is guarded on the path as well as on `auth`, so it is never applied to `/auth/refresh`
itself — a 401 there means the session is over, and retrying it would both loop and replay a
single-use token. The final clause asks "did we think we had a session?". It cannot ask after the
refresh token, which is an `HttpOnly` cookie we are not allowed to see; the access token stands in
for it, because the two are written and cleared together. Being wrong is cheap in the only direction
it can be wrong — a stale access token with no cookie behind it costs one 401 on `/auth/refresh`.

**Clearing the session follows an answer, never the absence of one.** `refreshAccessToken` resolves
`null` only when the server actually refused, and throws when it could not be reached at all, so an
unreachable server never reaches the `logoutUser()` line. Signing someone out is destructive and
irreversible from the client.

**Refresh is coalesced within *and* across tabs.** Refresh tokens are single-use and the backend
treats replay as theft: presenting an already-rotated token revokes the entire token family for that
user (`RefreshTokenService.rotate`). The server forgives a replay landing within a few seconds of
the rotation it lost to, precisely because a client cannot inspect the token to elect a winner — but
that is a safety net for a race, not a licence to run one. Two layers:

- `refreshInFlight` dedupes concurrent callers inside one tab (three requests 401-ing at once). It
  is module-scoped, so it is *only* ever a within-tab guard, by construction.
- A Web Lock (`draazy:auth-refresh`) serialises tabs, which share one cookie jar and would otherwise
  each refresh independently.

The second layer is load-bearing, not an optimisation, and the reason matters before anyone
simplifies it away on the grounds that the server forgives the loser anyway. Forgiveness settles who
gets a session; it does not settle who wins the *cookie*. Both responses carry a `Set-Cookie` and
the jar keeps whichever lands last. The graced tab's rotation revokes the token the winner's
response is still carrying, so if that response lands second the browser ends up holding a token the
server has already revoked. Nothing breaks then — the next refresh is inside the window — but the
next refresh is normally fifteen minutes later, by which point the grace window has closed, that
stale cookie reads as a replay, and the family burns. The user is signed out of everything by the
race the window was supposed to make survivable. The server cannot fix this from its side, so not
sending the second request is the fix.

Be honest about the gap: `navigator.locks` is undefined in non-secure contexts, which includes a
plain-http LAN dev host — the one setup `application-local.properties` turns off `Secure` for. There
the lock degrades to running inline and two tabs 401-ing together really can both spend the same
cookie. That is what the grace window absorbs, but it is a safety net being landed on rather than
held in reserve, so the degradation warns rather than passing silently. A `SecurityError` from
`navigator.locks.request` (opaque or sandboxed origin) degrades the same way: letting either
propagate would send a raw `SecurityError` out through `request()`, past the
`ApiError`/`NetworkError` normalisation every caller branches on.

**The loser of the race must not refresh again.** `doRefresh` compares the access token it entered
with against the current one; if another tab rotated or signed out, it hands back whatever is there.
The `entryToken &&` guard is load-bearing, and the obvious "tidy-up" of bailing when it is null is a
real regression (caught by `live-flow.spec.js`, which logs out instead of renewing): a null access
token does **not** mean there is no session to renew, because the credential this call spends is the
`HttpOnly` cookie. Entering with nothing is exactly the cold-boot case where refreshing is the only
way to find out, so the comparison must stay a guard against a token that *moved*, not a
precondition that one exists. The comparison is a good witness in the `localStorage` tier, where
tabs share storage; it is a no-op in the per-tab `sessionStorage` tier (`remember: false`), where the
lock is the only thing doing any work.

`sessionRemembered()` is resolved once, before the request, and reused for the write-back. Reading
it twice would straddle the response, whose own `Set-Cookie` lands before the promise resolves, so
the second read would be answering with the value the first read just caused. `remember` is restated
on the refresh body because the browser tells the server nothing about the lifetime of the cookie it
presents; without it a session the user declined to remember would quietly become a persistent one.
The refresh call itself is `auth: false` — the cookie *is* the credential, and sending the dead
access token alongside it would just 401 again.

**Only a rejection means the session is over.** A `NetworkError` is not an answer, and returning
`null` on one would let the caller sign the user out on the strength of a question that was never
asked. The case that proved this is not offline-with-a-dead-session; it is an in-flight refresh
cancelled by a navigation: `fetch` rejects with `AbortError`, `send` wraps it, and a session that
was fine a millisecond earlier gets cleared. Rare per navigation, but the window is exactly the
moment a user clicks a link on an expired token. It failed `live-flow.spec.js` only in the full
suite, where load widened the gap between the 401 and the reload.

Same reasoning one step further: a 429 or a 5xx is the server declining to answer, not answering
"no". Only a 401 is the refusal. This became consequential once the boot path called `logoutUser()`
on a null return, because that deletes the session hint — the one artifact that survives an ITP
wipe — leaving a refresh cookie with three weeks on it that nothing would ever spend again. Not
hypothetical: `/auth/refresh` is a mutating verb sent with `auth: false`, so the write rate limit
buckets it by IP with no principal to key on, and behind carrier-grade NAT one noisy neighbour on
the shared egress address turns a recoverable session into a permanent sign-out.

**`fromRefresh` marks an error as the renewal's, not the caller's.** Both throws above hand the
refresh's own failure to a caller that asked for something else, and the status travels with it.
Unannotated, a saved-properties fetch reports "Too many requests" for a rate limit the user never
hit on saved properties, and a 503 from `/auth/refresh` reads as the listings service being down.
The status is worth keeping — it is what makes the failure legible as transient and retryable — so
only the attribution is wrong, and only the human-facing string moves; `code`, `status`, `fields`
and `traceId` are untouched. Annotated in place rather than copied, because a copy loses the stack.

**`restoreSession()` is the cold-boot path**, and its own export rather than part of the 401
recovery: that path deliberately refuses to refresh without an access token, since for every
ordinary request an absent token means signed out, and loosening it would make each anonymous page
view retry through `/auth/refresh`. The cold boot is the one moment an absent token is genuinely
ambiguous — Safari's ITP clears web storage seven days in while leaving the server-set cookie
alone — so the ambiguity is resolved once per load instead of on every request. It shares
`refreshInFlight` and the lock, so a boot restore racing a request-driven refresh cannot present the
cookie twice.

**`persistTokens` asks two questions, not one.** `remember` is the user's *choice*; where the token
can actually go is separate. `writeTokens` writes to `localStorage` when told to remember, swallows
a failed `setItem` and then purges `sessionStorage` — so a remembered token in a store that throws
lands nowhere and every page load churns a fresh rotation. Demoting the tier keeps the session alive
locally and leaves the server's 30-day cookie, and the hint recording the choice, untouched. The
`AuthResponse` is destructured rather than passed whole so a new field never silently deposits
itself in storage; `refreshToken` in particular must never land there.

### `AuthContext` boot, and what `loading` covers

The cached user is read synchronously so the first paint is already correct and a returning user
never sees a flash of the signed-out UI. That cache still has to be revalidated — the session may
have been revoked, or the profile changed on another device — and `loading` covers exactly that.
**Route guards must not render a decision while it is true**, or a hard refresh bounces a signed-in
user to `/signin`. It also starts true when there is no cached user but the server's session-hint
cookie says there is a session: that boot has nothing to paint optimistically and everything to
recover.

`sessionGen` is a ref bumped by every deliberate change of identity and read by every background
write, so a slow reply cannot land on a session that has since moved on. Without it a `getMe()` in
flight when the user signs out resolves afterwards and re-signs them in — and worse than a render
glitch, `authProvider.getMe` writes the profile back to storage on the way through, so the cleared
cache returns too. A ref rather than state: nothing renders from it, and it must be readable by a
closure created before the change it guards against. The sign-out affordance is reachable while the
boot revalidation is still in flight (the navbar renders from the cached user without gating on
`loading`), and the ITP path prepends a whole `POST /auth/refresh` to the `getMe()`, so the window
is wide.

`sessionHinted()` is checked in the boot effect and not left to `loading`, whose other disjunct is a
cached user — the two are not the same question. A cached user with no hint is reachable: `getMe`
writes the profile to `localStorage` while an unremembered session's tokens stay in
`sessionStorage`, so after a browser restart the blob outlives both the tokens and the
session-scoped cookies. Refreshing on that costs a guaranteed 401 and, since nothing would clear the
blob, would recur on every cold boot forever — hence the `logoutUser()`: when the answer is
definitive, erase the evidence that asked the question. That erase sits inside the staleness guard,
and it matters more than the `setUser` does. A sign-in that starts and finishes inside the restore's
round trip has already written a fresh access token, user blob and marker cookie; an ungated
`logoutUser()` would delete all three on behalf of a session that is minutes dead, leaving the worst
reachable state — React still says "signed in", there is no token, and the 401 recovery cannot
rescue it because that path requires an access token to exist.

The `catch` distinguishes "the server says no" from "we couldn't ask". A rejected session (a 401 the
http client could not refresh) must clear. An unreachable server must not: signing users out on
every flaky-connection page load would be worse than trusting the cache for one more moment, and the
next real API call will 401 and clear it properly. A 429 or a 5xx is the same kind of non-answer as
a dead socket.

`refreshUser()` exists because the boot revalidation is mount-only, so anything the server derives
from what the user *did* is invisible for the rest of the session. The one that matters today is
`listingsCount`: posting your first listing makes you an owner server-side, and `hasEverListed`
would keep saying otherwise until the next full page load. It swallows failures deliberately — a
stale persona is a slightly wrong plan card, and signing someone out because a background refresh
failed right after they posted a listing is not a trade worth making — but it warns, because without
that a refresh that 500s is indistinguishable from a server that never incremented the counter.

`hasEverListed` is `(user.listingsCount ?? 0) > 0`: has this account **ever** posted a listing,
including listings since rejected or archived. It is deliberately not `role === 'owner'`, which is
what stood at those call sites: nothing in the application assigns that role — both signup paths
mint `buyer` and `setRole` has no call site outside account creation — so the test was a constant
`false` on every real account, and only the demo seed's hardcoded roles made it look answered. It is
also **not** interchangeable with `Dashboard.jsx`'s `isOwner` (`listings.length > 0 ||
ownsInventory`), which is LIVE inventory and the right question for a screen managing what is
currently posted. Two questions, two answers; one name would make them one wrong answer.

`login`, `register` and `staffLogin` all resolve with what the *server* returned, and that is part
of the contract. Two screens act inside the same handler, before the next render exists:
`/staff-login` needs the role and team to choose a console, and `/signin` needs to know whether the
account it just authenticated has a name yet. `register` resolves `wasNew` because `/auth/login`
provisions on the first verified code, so the provider's `register` is a sign-in plus a profile
patch and an existing account passes straight through it — after the patch every account has a name,
so only the provider can tell the two apart, and `/signup` must not land an established account
somewhere different than `/signin` would.

### `authProvider` notes

- **`sendOtp`** carries `turnstileToken` as a header rather than a body field, which keeps the
  `/auth/login` request schema — and therefore the OpenAPI contract — unchanged (tech-debt D130).
  Omitted entirely when the challenge is off. This is the step worth protecting: it spends an SMS,
  so a script hammering it costs real money whether or not it ever guesses a code.
- **`login`** sends `remember` as well as applying it locally: it decides the storage tier here, but
  only the server can scope the refresh cookie, and a cookie outliving the tab the user asked to
  forget would leave the longer-lived half of the session behind.
- **`register` is not a create.** There is no registration endpoint; `/auth/login` provisions a
  nameless buyer from the mobile alone, so this is a sign-in followed by a profile patch.
- **`staffLogin`** stays even though the `/staff-login` screen signs staff in with mobile + OTP:
  D206 removed the password from `POST /users/staff`, so a staff account has no password until its
  holder redeems an emailed invite, but the endpoint is real and redeemed accounts can use it. The
  argument check exists because a caller reaching it without credentials has almost certainly passed
  the OTP screen's user object by mistake, and a named message beats a bare 422.
- **`logout` clears locally even if the server call fails** — a user who clicks "sign out" must end
  up signed out regardless of connectivity. The server call does something the client cannot: revoke
  the family *and* expire the `__Host-draazy_rt` cookie, which `logoutUser()` cannot reach. If the
  request fails the cookie survives, and on a shared machine that leaves a spendable 30-day
  credential any script on the origin can use. That is the same exposure an unclosed tab carries and
  is bounded the same way. What makes it worse here is the ITP cold-boot restore, which refreshes
  *without* an access token: if the session hint were left behind, the next launch would spend the
  surviving cookie and sign the user back into the account of whoever pressed sign-out. Hence
  `logoutUser()` expiring the hint itself — the one part of the residue the client can reach.
- **`getMe` / `updateMe` ask for the tier rather than defaulting it.** `writeUser`'s `remember`
  defaults to `true` and `writeKeyed` purges the other tier, so a bare `writeUser(user)` on a
  session the user asked *not* to be remembered moves the cached profile from `sessionStorage` into
  `localStorage`, where it outlives the tab — a signed-in-looking profile left behind on a shared
  computer next to an access token that correctly died with the tab.
- **`exportMyData`** returns the server's document as-is. Its `schemaVersion`, `redactionRule` and
  `excluded[]` fields are part of what the subject is entitled to receive; an export that quietly
  dropped the list of what was left out would be a worse answer. A counterparty appears as an opaque
  `partyRef`, never a name.
- **`requestErasure`** files a request, not a deletion: the account may be the counterparty on a
  live tenancy or a settled payment. `myErasureRequests` returns only pending and rejected ones — an
  approved request has already taken the account with it.

### `?next=` is validated in one place (`lib/authIntent.js`)

`safeInAppPath` decides whether a `next` is somewhere in this app *and* somewhere worth being sent
after signing in. Four rejections. The first three are about origin, and they are three rather than
one because the browser's URL parser normalises a string *before* it decides what the string means,
so anything that only looks at the first character is checking a value the browser never receives:

- it must begin with a single `/`, which rules out `https://evil.com` and the protocol-relative
  `//evil.com` — the same-looking string this guard began as, and the only one it caught;
- a backslash **is** a slash to that parser, so `/\evil.com` resolves to `https://evil.com`
  (react-router agrees — its own absolute-URL test spells the pair `[\\/]{2}`);
- tabs, newlines and other C0 controls are stripped first, so `/\t/evil.com` — which arrives already
  percent-decoded from `URLSearchParams`, e.g. from `?next=/%09/evil.com` — becomes `//evil.com`.
  Rejected rather than sanitised: nothing in this app produces such a `next`.

The fourth is about sense: an auth screen is never a destination. `?next=/signin` survives every
check above, and none of the three screens has a guest-only guard to bounce it, so honouring it
`replace`-navigates a user who just signed in back onto the sign-in form — which reads as the
sign-in having failed.

`postAuthDest` is the single post-auth destination shared by Sign In and Sign Up, so the same
authentication never lands users in two different places. Its `fallback` exists so a caller that
knows the dashboard would be empty can offer somewhere better without re-deriving the rule; both
auth screens pass `/listings` on exactly one condition — the account had no name before this
authentication, i.e. it was created by it — so the shared destination still holds. The condition is
not "which screen am I", because `/signup` has no create endpoint behind it. The fallback is
validated too, so a future caller cannot turn that trusted literal seam into another redirect path.

`resolveAuthIntent` resolves i18n **keys**, never copy: the strings live in
`i18n/locales/<lang>/auth.json` under `auth.intent.*`, so a Marathi visitor sent here by a gate
reads the reason in Marathi, and English text here would make the module a second, untranslated copy
deck.

### OTP verification errors are classified on `code`, never status

`lib/otpVerifyError.js` is shared because every OTP screen posts to a route that goes through the
same server primitive, so they all face the same refusals — and the one thing none of them may do is
render `err.message`. The API answers in English; these screens ship in three languages, so showing
the server's sentence is itself the bug.

The statuses collide in both directions: a 401 is "wrong digits" *or* "this account is archived",
and a 429 is "this code is burnt" *or* "the IP you share is busy" — opposite remedies behind one
number. Only the code separates them. `attemptsRemaining: 0` is the last allowed guess reporting
back, not a refusal: the server has burnt the code and the next submit could only 429, so it is
terminal. A 401 with no count is a code the server no longer holds — expired (5-minute TTL, which a
user who switched apps to read the SMS will meet) or already spent — so telling them to try again
would loop them against a code that can never succeed. No status at all means the request was never
answered and the guess is untouched, so retry.

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
OTP sent (server-set resend wait) --(any 6 digits)--> verifying --> signed in
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

## 9. Invariants the live auth specs pin

`e2e/tests/platform/auth/live-flow.spec.js` and `live-improvements.spec.js` carry only one-line
comments; the reasoning lives here.

**No user-enumeration oracle.** The live API deliberately has no "does this mobile exist?" endpoint —
answering it publicly is an enumeration oracle. `POST /auth/login` provisions the account on first
verified login instead, so an unknown number and a registered one are indistinguishable from outside.
Both halves are asserted in one test, because "the unknown number went to OTP" is only evidence of
non-disclosure if a known number does exactly the same thing.

**The name is asked for *after* the code, never before.** Branching at the mobile step is exactly the
oracle above. Putting the ask behind the OTP costs a genuine new user the same number of screens and
discloses nothing, because by then the caller has read back a code sent to that handset. Asserted as a
pair for the same reason: "a new account was asked for a name" is only evidence of a new-account rule
if an account that already has one is *not* asked. Reaching the dashboard on the second sign-in **is**
the assertion — the step is a full-screen replacement of the same card, so a named account arriving
anywhere else could not have skipped it, and the trigger is derived from the profile rather than from
"this row was just inserted".

**First-time accounts land on listings, not the dashboard.** Every dashboard card is derived from real
activity, and an account three seconds old has none, so the hub would open as a page of zeros at the
one moment this person is most willing to look at inventory. Sign Up applies the identical rule.

**The refresh token is out of JavaScript's reach *and* the session still renews.** Either half alone is
worthless: hiding the token is easy if you break renewal, renewal is easy if you leave the token where
an XSS payload can read it. This is also the only level at which the claim is testable — MockMvc has no
cookie jar, no `document.cookie` and no same-origin policy, so a backend test can prove the `HttpOnly`
attribute was set but not that a browser honours it or that `credentials: 'include'` sends it back.

- `Path=/` is deliberate, and the narrower `/api/auth` was given up on purpose: path scoping only
  defended against our own code forwarding or logging a request carrying the cookie, and nothing in the
  backend logs cookies. `Path=/` is a hard requirement of the `__Host-` prefix production uses, which
  is what stops another host under the registrable domain planting a same-named `Domain=` cookie the
  browser might hand over instead — an attack no page-level attribute can prevent, and one the
  cold-boot restore would carry out automatically. The name is read from the server rather than
  hardcoded because the harness runs over plain HTTP, where a browser rejects the prefix outright.
- Renewal is reached by **tampering** with the access token, not deleting it: the token is valid for
  fifteen minutes and no spec should wait, while an absent token takes a different path (the recovery
  gate reads it as "not signed in" and never refreshes). The signature is corrupted by **flipping** its
  first character, not appending one — an HS384 signature is exactly 64 base64url characters with no
  spare bits, so a 65th decodes to nothing, the token verifies happily, and the test passes proving
  nothing. That is what the first run of that spec did.
- The renewal poll asserts *usable **and** new*, as one conjunction. `.not.toBe(tampered)` alone also
  passes when the store was cleared (`undefined !== tampered`), so a sign-out satisfied the assertion
  meant to prove renewal and surfaced a line later as a URL mismatch that read like a routing bug.
  "Is a JWT" alone is worse: the tampered token is still JWT-shaped, so that poll passed before the
  recovery had even sent `/auth/refresh`, making the test a race between `reload()` and a
  401-plus-refresh round trip — one it won for a long time and lost when an unrelated change shifted
  boot timing by milliseconds.

**A remembered session survives a web-storage wipe.** Safari's ITP deletes script-writable storage
after seven days without first-party interaction while leaving server-set cookies alone, so on day
eight a remembered user has no cached profile, no access token, and a perfectly good refresh cookie
with three weeks left on it. Without the session-hint cookie nothing spends that cookie — an absent
access token reads as "signed out" everywhere else, deliberately — so a 30-day promise quietly meant a
quarter of that. Clearing web storage while keeping the cookie jar reproduces the eviction's end state
exactly, which is the whole input to the code under test.

**...and an unremembered one is never promoted.** This is the dangerous direction: a rescue that
promotes an unremembered session hands a 30-day cookie to someone who asked for one that dies with the
browser, on a shared machine, silently, while every screen still reads "signed in". The pair is the
point — `remember` is restated by the client on every rotation from one value, so a single wrong read
moves both cases, and each alone passes for one of the two wrong readings ("always true" or "always
false"). The wipe in that test is not ITP's timer (an unremembered session is gone long before day
seven) but any mid-session storage loss with the jar intact, which lands in the same recovery path.
`expires === -1` is Playwright's spelling of a session cookie: the marker is scoped exactly like the
token it describes, so it cannot outlive it and claim a session that is gone.

**Sign-out must leave nothing claiming a session** — that is why the marker is a cookie the server
clears rather than a flag the client sets. A hint outliving its revoked token sends every cold boot
into a refresh that can only 401, shaped exactly like reuse-detection tripping, on the one path we
watch for. The offline case matters most: `authProvider.logout` posts best-effort and swallows a
NetworkError, on the reasoning that the residue is unreachable — the recovery path above is exactly
such a thing, so that reasoning expired the day it was written. Aborting the request is the only way to
reach the branch, since a reachable server clears the hint itself and the assertion would pass for the
wrong reason.

**The OTP attempt count comes from the server, not a local tally.** The page cannot see attempts a
second tab or an earlier visit already spent, so a local counter would promise three guesses to someone
who has one. Asserting the *numbers* is the point: an off-by-one either burns a guess the user was owed
or offers one the server will refuse, and both read as a working form. The wording is read as rendered
because the server's prose is English-only and the form ships in three languages — a screen showing the
server's sentence would be the bug. Sign Up posts to the same `/auth/login` and so spends the same
budget, but it also raises refusals Sign In never can: a signup *validation* message names the field to
fix and keeps the server's text, while everything else is a refusal about the code or the account and
must be translated.

**A hostile `next` cannot steer a freshly-authenticated session off-site.** `next` is the one piece of
post-auth routing an attacker gets to write, and it is acted on at the exact moment the session becomes
valuable. The three payloads each defeat a *different* naive guard, because the browser's URL parser
normalises a string before deciding what it means:

- `//evil.com` — protocol-relative, the case any guard thinks of first.
- `/\evil.com` — resolves to `https://evil.com` too, because a backslash *is* a slash to that parser
  (react-router's own absolute-URL test spells the pair `[\\/]{2}`).
- `/%09/evil.com` — arrives from `URLSearchParams` already decoded as `/<TAB>/evil.com`, and C0 controls
  are stripped before resolution, so it becomes `//evil.com` after every first-character check has
  waved it through.

Asserting the *landing* rather than "still on localhost" is what makes those tests mean anything: every
call site navigates with `replace: true`, and `history.replaceState` throws on a cross-origin URL, so a
vulnerable guard leaves the browser sitting on the sign-in page — still on localhost — and an
origin-only assertion passes against the bug it exists to catch. `/staff-login` gets its own case
because it reaches the guard by a different route: it filters `next` by role as well, and for a long
time the role filter was the *only* check, so a host starting with neither `/admin` nor `/ops` passed
through untouched. One payload suffices now that both doors call the same function; the point is that
they still do.

**The demo-mode hint is inverted under live auth.** `Signin.jsx` renders "enter any 6 digits" only when
auth is not live. Against a real OTP that hint is a lie costing a support ticket per user, and it is
invisible to every other gate — nothing throws, nothing 500s, the screen just tells people the wrong
thing.

**Session tiering is all-or-nothing.** `lib/auth.js` passes one `remember` flag to both stores precisely
so a session cannot be half-scoped: a tab-scoped user profile sitting next to a remembered *access*
token is a shared-computer leak that looks, from the UI, exactly like a signed-out browser. Only the
access token is in reach from a spec — the refresh token is an `HttpOnly` cookie scoped by the server
from the same flag — but the storage half is the half a script on the page can read.

**City copy on the auth panels.** City selection is client state; what the panel *says* about a city is
not. Pune's inventory count next to "launching in Mumbai soon" is not a cosmetic slip — it is a claim
about stock that does not exist. These assertions move again when the cities/geo work lands
(`cities.live` becomes a server fact); recorded in `docs/migration/README.md` under decision 2.

**The resend countdown is the server's number.** It was a hardcoded 30s in the browser while a
deployment enforces a 60s gap, so the button came back while the server still refused and a person who
waited for it got a rate-limit error rather than a code. No constant can be right in both places — e2e
and local profiles run a mock sender with no gap at all — so the send acknowledgement carries the
cooldown. The spec asserts 47s precisely because neither side would pick it: 30 is the old constant and
60 the deployed gap, so either could pass against the bug.
