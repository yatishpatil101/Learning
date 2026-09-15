# Flow: Admin Settings, Team & Staff

> The control room: site branding/contact/legal details, the fee schedule + Move-in Pack pricing,
> Google Places geo policy, application + admin-module feature flags, the audit log, and the
> Team & Access console (internal accounts, roles, permissions, ops-team scoping).
> **Status:** documented from React source - **Primary role(s):** admin (super-admin only)

---

## 1. Purpose & user problem
- **Persona:** a super-admin / platform owner configuring how Draazy behaves and who can operate it.
- **Job-to-be-done:** "Edit site details and fees, flip features on/off safely, review the audit trail,
  and create internal accounts whose permissions map to exactly the API surface and service teams they need."
- **Why it matters:** these settings drive money math ([`finance.md`](./finance.md)), consumer behaviour
  (flags), locality search (geo policy), and - via team-scoping - which ops queues each staffer sees. Team &
  Access is the RBAC substrate every other admin flow is gated by.

## 2. Entry points
- **Routes:** `/admin/settings` (tabs: general, fees, maps, flags [sub-tabs application/admin], audit),
  `/admin/team` (tabs: members, pending approvals). Both are `adminOnly` modules.
- **Tiles / triggers:** Settings save buttons per section, flag toggles (confirmation-gated), audit
  export/clear; Team "Add member" and per-row Edit / Suspend. Dashboard "Feature flags"
  and "Add staff" quick actions link here.
- **Source components:**
  - `src/pages/admin/AdminSettings.jsx` + `settings/AppFlagsPanel.jsx`, `AdminFlagsPanel.jsx`, `MapsGeoPanel.jsx`.
  - `src/pages/admin/AdminTeam.jsx` (members + the permission grid); `src/lib/adminModules.js`,
    `src/services/permissionsService.js`.
  - Persistence `src/lib/mockApi/collections.js` (`getSettings`, `updateSettings`), `src/lib/mockApi/team.js`.

## 3. Actors & roles
- **Administrators only.** `/admin` is `RoleRoute roles={['admin']}`, and both `team` and `settings`
  carry administrator-only atoms (`users:write`, `settings:read`/`settings:write`) that are excluded
  from `STAFF_BASELINE`, so no grant can add them to an operations account.
- Enforcement is server-side: every guarded route carries `@PreAuthorize` over the same atom the
  console reads from `GET /me`, so the nav filter is a convenience and not the control.

## 4. Entities touched
- [`settings`](../../system/data-model.md) - **read / updated**: `site`, `fees`, `movePack`, `geo`,
  `flags` (app), `adminFlags` (admin modules, via `AdminFlagsContext`).
  **Not** `customRoles`: `PUT /admin/settings` answers **422** for that key
  (`AdminSettingsService.UNSUPPORTED_KEYS`; migration `V61` deletes the stored row - D67). The
  console-side collection that survived it was retired by D209; see 5.8.
- [`back_office_permissions`](../../system/data-model.md) - **read / replaced** (one row per scoped
  account; no delete).
- [`team`](../../system/data-model.md) (internal accounts, separate from consumer `users`) - **read / created / updated / deleted**.
- [`audit_log`](../../system/data-model.md) - **read / created / cleared** (Settings audit tab; every save/toggle logs).

## 5. Business rules & logic  *(the meat)*

### 5.1 General (site) settings
`SITE_FIELDS` = name, legalName, tagline, supportEmail, supportPhone, whatsapp, supportHours, address, gst.
`saveSite()` -> `updateSettings({ site })` + audit "Updated branding / contact / legal details". Free-text; no validation today.

### 5.2 Fees + Move-in Pack
- Fees are the flat `settings.fees` map (seed: `ownerPlanYearly 999`, `ownerProYearly 2499`,
  `rentAgreementPlatform 500`, `seekerPlusTopup 199`, `featuredListing 999`, `gstPercent 18`).
  `setFee(k, v) = Number(v) || 0`; keys containing "percent" render a `%` suffix (else a rupee prefix). Labels are humanized.
  `saveFees()` -> `updateSettings({ fees })` + audit "Updated platform charges & fee schedule". These feed Finance math.
- **Move-in Pack** (`settings.movePack`): `{ enabled, items:{ movers, clean, agreement, paint, verify, internet } }`.
  Per-item price inputs (`Number||0`), an `enabled` switch labelled Live vs "Coming soon"; `saveMovePack()` audits
  "Saved prices; status: Live|Coming soon". Read by the consumer `/services` bundle.

### 5.3 Maps & Places (geo policy)
`MapsGeoPanel` edits `settings.geo` (city limit + blacklist for Google Places). `saveGeo(nextGeo, detail)`
optimistically sets state, `updateSettings({ geo })`, audits "Maps & Places" with a detail, and is read live by
`lib/geoConfig.js` across every locality/area search.

### 5.4 Feature flags (two namespaces, confirmation-gated)
- **Application flags** (`settings.flags`, ~30 booleans e.g. `mapSearch`, `zeroBrokerage`, `scheduleVisit`,
  `staffLoginEnabled`, `maintenanceMode`): `requestAppFlagToggle(k)` opens a `ConfirmDialog` ("Enable/Disable
  <Humanized>?", `danger` when disabling); on confirm it writes the full `flags` map via `updateSettings` and
  audits "App flag <Name> enabled|disabled".
- **Admin-module flags** (`settings.adminFlags`, grouped tab/dash/analytics/finance/properties/users/services/
  enquiries/content/reports/flatmates/staffActivity): managed through `AdminFlagsContext` (`setFlag(section, key, value)`);
  `requestAdminFlagToggle` shows the same confirm and toasts. These are the `optionEnabled('<section>.<key>')`
  gates every admin page reads. Disabling a module reduces "API cost" and hides UI.
- Both share `humanize(k)` (camelCase -> Title, with SaaS/SMS/EMI fixups). A risk legend (Low/Med/High) is shown for admin modules.

### 5.5 Audit log
On entering the audit tab, `listAudit()` populates the table (When = localized `at`, User = `who`, Action badge,
Detail). `exportAudit()` -> CSV `['When','User','Action','Detail']`; `wipeAudit()` -> `clearAudit()` (both toast on empty).
A banner cross-links to `/admin/staff-activity` for operational (staff) activity.

### 5.6 Team & Access - the RBAC model (server-resolved permission atoms)
**Two internal roles, and only two.** `Role` is `buyer|owner|staff|admin`; `manager` was never one of
them. It was a console label attached to a custom-role bundle, and D209 retired both.
- **admin:** holds all 27 atoms and is the only role that may open `/admin`
  (`RoleRoute roles={['admin']}`, `src/App.jsx`).
- **staff (ops):** holds the 20 non-administrator-only atoms by default and lives in the `/ops`
  portal. Those atoms govern what the **API** grants them, not which console they may load - the
  admin shell stays administrator-only, so an ops staffer's grid narrows their API reach rather than
  promoting them to a different screen.

The browser resolves nothing. `GET /me` returns `User.permissions`, the caller's own resolved atom
list, and `canAccessModule(user, key)` in `adminModules.js` is a set membership test against it. The
grantable grid is `GET /admin/permission-catalogue`; the console holds no list of its own, so a
renamed atom cannot leave a tickable box that grants nothing.

The six administrator-only atoms are `finance:read`, `users:write`, `conversations:read`,
`audit:read`, `settings:read`, `settings:write`. They are excluded from `STAFF_BASELINE`, so an ops
account cannot be granted one - the `PUT` answers 422, and the console hides the row rather than
offering something that will be refused.

**`properties:verify` is gone.** It was a console-only sub-scope with no route behind it, invented by
the module map; `live-rbac.spec.js` asserts it never reappears in the catalogue.

### 5.7 Team & Access - member CRUD + guardrails
`accessSummary(m)`: admin -> "Every module"; staff -> its team labels; otherwise "Open the record to
see" (a per-row summary would cost one request per member to answer a question nobody has asked yet).

`saveMember()` validation and payload shaping:
- Name required. **Mobile only on create**: it is the sign-in credential, there is no route that
  changes it, and the directory publishes it masked (`97XXXXX115`), so the edit form renders it
  read-only and omits it from the `PATCH`.
- **Last-admin guardrail:** editing cannot demote or suspend the final active admin. This is a
  console-only path precisely because the contract has no role-change route at all - `teamProvider`
  refuses a role or team change outright rather than PATCHing the subset the server accepts and
  reporting success for the rest.
- `saveTeamMember` posts to `/users/staff` on create and `PATCH /users/{id}` (name, email) on edit.
- Suspend is `PATCH /users/{id}/archive`; there is no `DELETE /users/{id}` anywhere in the contract,
  so the console offers no Remove.

### 5.8 Team & Access - the permission document
Opening a member fetches `GET /users/{id}/permissions`, which answers
`{ scoped, permissions, effective }`. `permissions` is what an administrator scoped them to;
`effective` is what that resolves to against the role baseline. Both are shown, because they differ
in the case that matters: a document may only **narrow**, so an atom ticked here that the role never
held stays off in `effective`, and an operator not shown that will believe they granted it.

`PUT /users/{id}/permissions` replaces the list wholesale. Three properties of it drive the UI:
- **An empty list is legal and means "holds no guarded back-office route".** It is not the same as
  having no document.
- **There is no delete route.** Once a document exists it cannot be removed; scoping cannot be
  undone. Restoring means writing the role's full baseline back.
- Refusals: 403 on editing your own; 422 on an unknown name, on a name outside the role's ceiling, or
  on a consumer account; and the last-administrator floor still applies.

Because an unscoped account is shown its baseline ticked, the console **change-gates the write**: the
second request only fires when the grid actually changed. Otherwise correcting a colleague's email
would silently pin them to whatever their role allowed on the day of the typo.

**Custom roles are retired.** They were a *widening* union (`BASE ∪ bundle ∪ moduleAccess`) against a
server model that may only narrow, so honouring them server-side would have been privilege
escalation - which is why `PUT /admin/settings` answered 422 for the key and V61 deleted the stored
row. The bundles therefore granted nothing, and the tab carried a banner saying so. D209 resolves
open decision 3 in favour of the server's model and deletes `lib/permissions.js` with them.

### 5.9 How team-scoping drives ops queues
A staff member's `teams[]` (or a role's `teams`) select which service verticals they own; the Services desk
([`services-moderation.md`](./services-moderation.md)) filters staff by `role==='staff' && team===<ticket.team>`
for assignment, and the staff portal shows a member only their own desk — enforced by the server
(`ServiceDeskAuthority.deskFilterFor`, D44), not by a route guard. Team labels
(`OPS_TEAMS`/`TEAM_LABEL`) are the single source shared by Settings, the ticket desk and staff login.

### 5.10 What MUST move server-side
- ~~All permission resolution and every last-admin guardrail~~ - **done (D209).** Atoms are resolved
  by `AccountPermissions` and enforced by `@PreAuthorize` on every guarded route;
  `AccountPermissionsGuardTest` asserts that each catalogued atom actually guards one, so an atom
  that grants nothing cannot be published. The console's remaining guardrail is the role-change
  refusal, which is console-only because the route it would call does not exist.
- Flag writes and settings persistence (a manipulated client must not be able to grant itself `settings`/`team`).
- Fee/geo changes must be validated and authorized server-side (they change money and search behaviour).

## 6. Maker-checker / approval
- **This console is not a maker-checker flow** in the propose/approve sense - a single super-admin edits and it
  takes effect immediately (flag toggles are only *confirmation*-gated, not two-person). Audit provides the
  after-the-fact trail.
- **Creating a back-office account is the exception, and it is real server-side.** `POST /users/staff` mints the
  account in a pending state and a *second* administrator must clear it (`staff_account_approvals`, D200) before
  it can authenticate. The maker also never sets the credential: the account is created with **no usable
  password** and a single-use, time-limited invite is issued to the colleague's own handset, redeemed by them
  through `POST /auth/staff-invite/redeem` (`staff_invites`, V71, D206). Neither administrator ever learns the
  token, and an unredeemed invite blocks login on every path. The admin console has no screen for either yet
  (D205), which is why nothing on this page reflects it.
- Maker-checker on the *other* sensitive changes (fee schedule, kill-switches like `maintenanceMode`) per
  [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 2 is still not present today.

- **Invariants the gate depends on** (pinned by `StaffAccountApprovalTest`):
  - The gate sits in the shared token-issue funnel, not in `staffLogin`. A minted account has a mobile
    number and mobile-OTP login needs no password, so a password-path gate would refuse only the door
    an attacker was never going to use. `/auth/refresh` is gated for the same reason — it mints access
    tokens directly, so a hold placed on an account that already has a session must kill it too.
  - **Bootstrap escape:** the first administrator on a fresh install has no peer to co-sign with, so a
    hire is not held when no other admin-role account exists. The count includes **archived** accounts
    and is taken **before** the new user is inserted. Excluding archived ones would let an attacker
    archive their peers one at a time and then mint freely; counting after the insert makes a new
    administrator count itself, stranding a lone founder's first admin colleague permanently.
  - The checker-is-not-maker rule is also a database constraint
    (`staff_account_approvals_checker_is_not_maker`), because a two-key rule enforced only in the
    service is a one-key rule for any repair script or batch job that bypasses it.
  - A refused self-approval is audited (`user.staff.approve.refused`). It otherwise leaves no trace at
    all — the account simply stays held, which looks identical to nobody having got round to it.

## 7. State machine
- **Settings fields:** no lifecycle - each save overwrites (`updateSettings` merges the patched section).
- **Feature flag:** `on <-> off` (confirmation-gated).
- **Team member:** `active <-> suspended`; `create -> (edit)* -> delete`. Terminal-ish `suspended` still counts as
  a member; last-active-admin is protected from demotion/suspension/deletion.
- **Permission document:** `narrow -> (re-narrow)*`; there is no delete, so "restore" is writing the
  role's full baseline back.

## 8. Edge cases, validation & error states
- **Loading:** `<Loading />` until `getSettings()` (Settings) / `listTeamMembers()`+`listCustomRoles()` (Team) resolve.
- **Confirmation dialogs:** every flag toggle is gated; `danger` styling when disabling.
- **Member validation:** required name, 10-digit mobile, duplicate-mobile rejection, last-admin protections (3 sites).
- **Audit empty:** export/clear no-op with a toast when the log is empty; render shows "No changes logged yet."
- **Fee coercion:** non-numeric fee input becomes `0`.
- **Cross-tab sync:** `updateSettings` and role writes dispatch `draazy-settings-change` so nav/guards refresh in-tab.
- **Concurrency:** shared store; `updateSettings` merges by section, but two concurrent section saves can clobber each other (last write wins).

## Staff account creation

Rationale relocated from `UserAdminService.addStaff` / `approve` Javadoc.

- **Role is validated, not trusted.** The contract's `StaffCreate` carries a free `role` field;
  without a `staff|admin` check the endpoint is a general-purpose account factory, and an admin
  typo mints an account with a role the platform has no notion of.
- **`mobile` is required** (spec fix S33). `users.mobile` is `NOT NULL UNIQUE`, so the row
  cannot be inserted without it; relaxing the column would have weakened the natural key for every
  user to accommodate a handful of colleagues. It is also where the invite is delivered.
- **Activation (D206).** The account is created with no usable password and a single-use,
  time-limited invite goes to the colleague's own mobile; they set their own credential via `POST
  /auth/staff-invite/redeem`. Neither administrator ever learns the token - it is handed straight
  to the delivery seam inside `StaffInviteService#issue` and reaches neither the 201 body nor the
  audit row. Returning it "for the maker to pass on" would put the person's credential back in the
  maker's hands, which is exactly what the second signature exists to prevent. The invite is issued
  whether or not the account is held for approval, including on the bootstrap escape - a
  passwordless account is not unreachable, because OTP login needs no password.
- **Maker-checker (D200).** A new staff or admin account cannot authenticate until a second
  administrator approves it. Without this, an administrator narrowed to `users:write` could mint a
  fresh administrator - which has no permission document and therefore resolves to the full role
  baseline - and recover every module it had just been scoped out of. Every call in that sequence is
  individually authorised, so this is the only place the chain can be broken.
- **Blocked at authentication, not at permissions.** An account that can obtain a token but holds
  nothing is still a foothold: it has a session, it is in the directory, and every future route that
  forgets its guard is reachable from it. `AuthService` refuses tokens on both the password and
  the mobile-OTP path.
- **The bootstrap escape.** With no other `admin`-role account in existence, no approval row is
  written and the account is live immediately: maker-checker's only guarantee is that two people
  agreed, and on a one-administrator platform that is unobtainable, so requiring a self-co-sign buys
  nothing and costs the first team expansion a permanent lockout. It is re-evaluated per creation,
  so it closes itself once a second administrator exists, and is audited under its own action name
  so "this account skipped maker-checker" is searchable. It depends on the archive floor: the escape
  asks whether a second administrator has ever existed, and the floor stops an attacker archiving
  their way back down to being the only one.
- **A staff account must name a team.** `users.team` is nullable, and `PermissionMap` keys its
  allow-list by team, so a team-less staff account has no bundle and cannot be narrowed by *any*
  edit an administrator makes to that document - while a named-but-emptied team holds nothing. The
  way to grant the most authority was to grant no desk, which is backwards and silent. Refused here
  rather than patched in the map, because this is the only place that can answer whether such a
  caller should exist. `Teams.isKnown` duplicates the column CHECK on purpose: a 422 naming the
  field beats a 500 from a constraint. The `admin` role is the exception - it resolves to the
  literal key `admin`, so a team on it would be a fact nothing reads, and is refused rather than
  ignored so it cannot look effective.
- **Approval is not idempotent.** Re-approving is 409, not a silent repeat: the second caller would
  believe they were the checker on a decision somebody else made. Approving an account that was
  never held is 409 for the same reason - it would manufacture a record of a decision that never
  happened. The maker/checker split is enforced here *and* by a CHECK constraint in V67, because a
  two-key rule enforced in one place is a one-key rule with extra steps.
- **The approver's liveness is checked here.** Reaching the method proves only that the caller held
  a valid access token; an administrator archived five minutes ago still holds one until it expires.
- **Audit rows survive the refusals** because `AuditService` is `REQUIRES_NEW`. Nothing else on
  the refusal paths mutates state - if you add a write above them it will roll back and the audit
  row will not.
