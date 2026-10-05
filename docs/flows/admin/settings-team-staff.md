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
  `/admin/team` (members and permissions). Both are `adminOnly` modules.
- **Tiles / triggers:** Settings save buttons per section, flag toggles (confirmation-gated), audit
  export/clear; Team "Add member" and per-row Edit / Suspend. Dashboard "Feature flags"
  and "Add staff" quick actions link here.
- **Source components:**
  - `src/pages/admin/AdminSettings.jsx` + `settings/AppFlagsPanel.jsx`, `AdminFlagsPanel.jsx`, `MapsGeoPanel.jsx`.
  - `src/pages/admin/AdminTeam.jsx` (members + the permission grid); `src/lib/adminModules.js`,
    `src/services/permissionsService.js`.

## 3. Actors & roles
- **One shared console.** `/admin` is `RoleRoute roles={['staff', 'manager', 'admin']}`; the nav shows
  only modules whose atom the caller holds, and `/ops/*` redirects into it. `team` opens with
  `users:write`, so managers manage staff; `settings` and `finance` stay administrator-only.
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
**Three internal roles.** `Role` is `buyer|owner|staff|manager|admin`; D209 removed only the old
dead manager label, not this real schema role.
- **admin:** exactly one; always holds every atom and cannot be narrowed (`PUT .../permissions` is
  422 for the admin).
- **manager:** below admin, above staff. Holds every function by default plus `users:write` and
  `audit:read`; creates and manages staff only, and can add only functions it holds (it may keep or remove ones the
  administrator granted). Reset-2FA and reissue-invite on a staffer holding a function the manager
  lacks are 403, since either hands over that account. Monitors
  staff via Staff Activity and Team Performance.
- **staff:** granted **functions** (`kyc`, `propertyVerification`, `listingModeration`,
  `postOnBehalf`, `desk:*`, `support`, `content`, `reports`, `analytics`); one person may hold many.
  The server derives atoms from them. No stored functions means dashboard only. Analytics
  (`analytics:read`: Analytics page, scorecard, SLA, traffic) is never granted by default. A staff
  dashboard is `GET /admin/my-work`: only the caller's own handled counts and the queues of the
  functions they hold. Desk scoping for service requests and tickets comes from `desk:*` functions.

The browser resolves nothing. `GET /me` returns `User.permissions`, the caller's own resolved atom
list, and `canAccessModule(user, key)` in `adminModules.js` is a set membership test against it. The
grantable grid is `GET /admin/permission-catalogue`; the console holds no list of its own, so a
renamed atom cannot leave a tickable box that grants nothing.

The five administrator-only atoms are `finance:read`, `users:write`, `audit:read`,
`settings:read`, `settings:write`. They are excluded from `STAFF_BASELINE`, so an ops
account cannot be granted one - the `PUT` answers 422, and the console hides the row rather than
offering something that will be refused.

**`properties:verify` is gone.** It was a console-only sub-scope with no route behind it, invented by
the module map; `rbac.spec.js` asserts it never reappears in the catalogue.

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

## 6. Staff creation and audit
- **This console is not a maker-checker flow** in the propose/approve sense - a single super-admin edits and it
  takes effect immediately (flag toggles are only *confirmation*-gated, not two-person). Audit provides the
  after-the-fact trail.
- **Creating a back-office account is staff-or-manager only.** `POST /users/staff` refuses
  `role=admin`; there is one administrator per environment, created by startup bootstrap. Staff and
  manager accounts are created with **no usable password**, and the response returns a one-time,
  time-limited `/staff-invite#...` link to the creator. An unredeemed invite blocks login on every
  path.
- Maker-checker on the *other* sensitive changes (fee schedule, kill-switches like `maintenanceMode`) per
  [`../../system/cross-cutting.md`](../../system/cross-cutting.md) section 2 is still not present today.

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

Rationale relocated from `UserAdminService.addStaff` Javadoc.

- **Role is validated, not trusted.** The contract's `StaffCreate` carries a free `role` field;
  without a `staff|manager` check the endpoint is a general-purpose account factory, and an admin
  typo mints an account with a role the platform has no notion of.
- **`mobile` is required** (spec fix S33). `users.mobile` is `NOT NULL UNIQUE`, so the row
  cannot be inserted without it; relaxing the column would have weakened the natural key for every
  user to accommodate a handful of colleagues.
- **Activation (D206).** The account is created with no usable password and a single-use,
  time-limited invite link is returned once to the creator; the colleague sets their own credential
  via `POST /auth/staff-invite/redeem`. The token reaches neither logs nor the audit row.
- **Single administrator.** `POST /users/staff` refuses `role=admin`; the only administrator is
  created by startup bootstrap and can be recovered with a one-use nonce.
- **Blocked at authentication, not at permissions.** An account with an open invite cannot obtain a
  token until its holder sets a password. A token-capable account with no permissions is still a
  foothold if a future route misses its guard.
- **Access is functions, not a team.** `POST /users/staff` takes `functions`; the legacy
  `users.team` is no longer written, and unknown function names are 422.
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
